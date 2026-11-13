// Opetushallituksen ePerusteet: ammatillisten tutkintojen perusteet (perus-, ammatti- ja
// erikoisammattitutkinnot). Julkinen rajapinta /eperusteet-service/api/external, ei avainta.
//
// - Haku /perusteet (nimi, diaarinumero, koulutustyyppi, voimassaolo), välimuisti 1 vrk.
// - Muodostuminen /peruste/{id}/suoritustavat ja yksi tutkinnon osa
//   /peruste/{id}/perusteenosa/{tutkinnonOsaId}, välimuisti 7 vrk.
// - Koko perustetta (/peruste/{id}, jopa 4 Mt) ei haeta.
// Tutkinnon perusteet ovat Opetushallituksen määräyksiä (laki ammatillisesta koulutuksesta
// 531/2017 15 §), joissa ei ole tekijänoikeutta (tekijänoikeuslaki 404/1961 9 §).

import { fetchJson } from "./http.js";

const API = "https://eperusteet.opintopolku.fi/eperusteet-service/api/external";
const WEB = "https://eperusteet.opintopolku.fi";
const HEADERS = { "Caller-Id": "aluetieto-mcp" };
const DAY = 86400;

export const EP_SOURCE = "Lähde: Opetushallitus, ePerusteet (tutkinnon perusteet)";

export const TYPES = {
  koulutustyyppi_1: "perustutkinto",
  koulutustyyppi_11: "ammattitutkinto",
  koulutustyyppi_12: "erikoisammattitutkinto",
};

/** Tyyppi tekstistä: palauttaa koulutustyyppikoodin tai null. */
export function parseType(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("erikois") || s === "eat") return "koulutustyyppi_12";
  if (s.startsWith("ammatti") || s === "at") return "koulutustyyppi_11";
  if (s.startsWith("perus") || s === "pt") return "koulutustyyppi_1";
  return undefined;
}

const VOIMASSAOLO = {
  voimassa: { voimassa: true, siirtyma: false, tulevat: false, poistuneet: false },
  siirtyma: { voimassa: false, siirtyma: true, tulevat: false, poistuneet: false },
  tulevat: { voimassa: false, siirtyma: false, tulevat: true, poistuneet: false },
  kaikki: { voimassa: true, siirtyma: true, tulevat: true, poistuneet: true },
};
export const VOIMASSAOLO_VALUES = Object.keys(VOIMASSAOLO);

// ---------- Teksti ----------

/** Kielistetty teksti: valittu kieli, sitten suomi, ruotsi ja englanti. */
export function L(obj, kieli = "fi") {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj[kieli] ?? obj.fi ?? obj.sv ?? obj.en ?? "";
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", shy: "" };

/** HTML tekstiksi: luettelot viivoina, kappaleet riveinä. */
export function htmlText(html) {
  if (!html) return "";
  let s = String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*(li|dd)[^>]*>/gi, "\n- ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/?\s*(p|div|ul|ol|dl|dt|h\d|tr|table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/ /g, " ")
    .replace(/•\s*/g, "- ")
    .replace(/\n-[ \t]*(?:\n[ \t]*)+(?=[^\s-])/g, "\n- ");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l && l !== "-")
    .join("\n");
}

// ---------- Päivät ja voimassaolo ----------

const fiDate = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric" });
const isoDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" });

export const fmtDay = (ms) => (ms ? fiDate.format(new Date(ms)) : null);
const ymd = (ms) => (ms ? isoDay.format(new Date(ms)) : null);

/** Perusteen tila hakuhetkellä (Suomen aikaa): { key, text }. */
export function status(p, now = Date.now()) {
  const today = ymd(now);
  const a = ymd(p.voimassaoloAlkaa);
  const l = ymd(p.voimassaoloLoppuu);
  const s = ymd(p.siirtymaPaattyy);
  if (a && a > today) return { key: "tuleva", text: `tulossa, voimaan ${fmtDay(p.voimassaoloAlkaa)}` };
  if (!l || l >= today) {
    const from = a ? ` ${fmtDay(p.voimassaoloAlkaa)} alkaen` : "";
    const to = l ? `, voimassaolo päättyy ${fmtDay(p.voimassaoloLoppuu)}` : "";
    return { key: "voimassa", text: `voimassa${from}${to}` };
  }
  if (s && s >= today) {
    return {
      key: "siirtyma",
      text: `siirtymäajalla ${fmtDay(p.siirtymaPaattyy)} asti (voimassa ${fmtDay(p.voimassaoloAlkaa) ?? "?"}–${fmtDay(p.voimassaoloLoppuu)})`,
    };
  }
  return { key: "poistunut", text: `poistunut (${s ? "siirtymäaika päättyi " + fmtDay(p.siirtymaPaattyy) : "voimassaolo päättyi " + fmtDay(p.voimassaoloLoppuu)})` };
}

// ---------- Linkit ----------

export const perusteUrl = (id, kieli = "fi") => `${WEB}/#/${kieli}/ammatillinen/${id}/tiedot`;
export const rakenneUrl = (id, kieli = "fi") => `${WEB}/#/${kieli}/ammatillinen/${id}/rakenne`;
export const osaUrl = (id, viiteId, kieli = "fi") => `${WEB}/#/${kieli}/ammatillinen/${id}/tutkinnonosat/${viiteId}`;
export const liiteUrl = (id, liiteId) => `${WEB}/eperusteet-service/api/perusteet/${id}/liitteet/${liiteId}`;

// ---------- Haut ----------

/**
 * Perusteiden haku. tyypit = koulutustyyppikoodit (oletus kaikki ammatilliset).
 * Palauttaa { total, data: [...] }.
 */
export async function search({ nimi, diaarinumero, tyypit, voimassaolo, kieli = "fi", sivu = 0, sivukoko = 10, budget }) {
  const p = new URLSearchParams();
  if (nimi) p.set("nimi", nimi);
  if (diaarinumero) p.set("diaarinumero", diaarinumero);
  p.set("kieli", kieli);
  for (const t of tyypit?.length ? tyypit : Object.keys(TYPES)) p.append("koulutustyyppi", t);
  const v = VOIMASSAOLO[voimassaolo];
  if (v) for (const [k, val] of Object.entries(v)) p.set(k, String(val));
  p.set("sivu", String(sivu));
  p.set("sivukoko", String(sivukoko));
  const res = await fetchJson(`${API}/perusteet?${p}`, { ttl: DAY, budget, headers: HEADERS });
  return { total: res?.["kokonaismäärä"] ?? 0, data: res?.data ?? [] };
}

export async function suoritustavat(id, budget) {
  return fetchJson(`${API}/peruste/${id}/suoritustavat`, { ttl: 7 * DAY, budget, headers: HEADERS });
}

export async function tutkinnonOsa(id, osaId, budget) {
  return fetchJson(`${API}/peruste/${id}/perusteenosa/${osaId}`, { ttl: 7 * DAY, budget, headers: HEADERS });
}

export async function maarayskirje(id, budget) {
  return fetchJson(`${API}/peruste/${id}/maarayskirje`, { ttl: 7 * DAY, budget, headers: HEADERS }).catch(() => null);
}

/** Tutkinnon osa koodilla (esim. 107623). Rajapinta on hidas (noin 10 s), siksi pitkä välimuisti. */
export async function osaByCode(code, budget) {
  const res = await fetchJson(`${API}/peruste/tutkinnonosa/tutkinnonosat_${code}`, { ttl: 7 * DAY, budget, headers: HEADERS });
  if (typeof res === "string") {
    try {
      return JSON.parse(res);
    } catch {
      return null;
    }
  }
  return res;
}

async function diaariOfId(id, budget) {
  const d = await fetchJson(`${API}/peruste/${id}/diaarinumero`, { ttl: 7 * DAY, budget, headers: HEADERS });
  return typeof d === "string" ? d : null;
}

const DIAARI_RE = /^(OPH-\d+-\d{4}|\d+\/\d{3}\/\d{4})$/i;
const fold = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Saman tutkinnon tunnus ryhmittelyä varten. */
export const tutkintoKey = (p) => p.koulutukset?.[0]?.koulutuskoodiArvo ?? fold(L(p.nimi));

/**
 * Peruste diaarinumerolla, perusteen id:llä tai tutkinnon nimellä.
 * Palauttaa { peruste, muut: [saman tutkinnon muut perusteet] } tai { ehdokkaat: [...] } tai null.
 */
export async function resolvePeruste(input, { kieli = "fi", budget } = {}) {
  const q = String(input ?? "").trim();
  if (!q) return null;
  let diaari = DIAARI_RE.test(q) ? q : null;
  if (!diaari && /^\d{5,}$/.test(q)) {
    diaari = await diaariOfId(q, budget);
    if (!diaari) return null;
  }
  if (diaari) {
    const res = await search({ diaarinumero: diaari, voimassaolo: "kaikki", kieli, sivukoko: 25, budget });
    const p = res.data.find((x) => fold(x.diaarinumero) === fold(diaari)) ?? (res.data.length === 1 ? res.data[0] : null);
    if (!p) return null;
    return { peruste: p, muut: [] };
  }
  const res = await search({ nimi: q, kieli, sivukoko: 25, budget });
  if (!res.data.length) return null;
  const f = fold(q);
  const score = (p) => {
    if (fold(L(p.nimi, kieli)) === f) return 4;
    if ((p.tutkintonimikkeet ?? []).some((t) => fold(L(t.nimi, kieli)).replace(/\s*\((at|eat|yt|sye)\)$/, "") === f)) return 3;
    if ((p.osaamisalat ?? []).some((o) => fold(L(o.nimi, kieli)) === f)) return 3;
    if (fold(L(p.nimi, kieli)).includes(f)) return 2;
    return 1;
  };
  const groups = new Map();
  for (const p of res.data) {
    const k = tutkintoKey(p);
    if (!groups.has(k)) groups.set(k, { score: 0, list: [] });
    const g = groups.get(k);
    g.list.push(p);
    g.score = Math.max(g.score, score(p));
  }
  const ranked = [...groups.values()].sort((a, b) => b.score - a.score);
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    return { ehdokkaat: ranked.filter((g) => g.score === ranked[0].score).map((g) => newest(g.list)) };
  }
  const list = ranked[0].list;
  const now = Date.now();
  const pick =
    newest(list.filter((p) => status(p, now).key === "voimassa")) ??
    newest(list.filter((p) => status(p, now).key === "tuleva")) ??
    newest(list);
  return { peruste: pick, muut: list.filter((p) => p !== pick).sort((a, b) => (b.voimassaoloAlkaa ?? 0) - (a.voimassaoloAlkaa ?? 0)) };
}

function newest(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => (b.voimassaoloAlkaa ?? 0) - (a.voimassaoloAlkaa ?? 0))[0];
}

// ---------- Muodostuminen ----------

/**
 * Osassa vanhoja perusteita rakennepuun tutkinnon osilta puuttuu nimi. Nimet haetaan silloin
 * osa kerrallaan (pieni vastaus, välimuisti 7 vrk) ja lisätään puuhun. Palauttaa haettujen määrän.
 */
export async function ensureNames(perusteId, st, budget) {
  const vm = viiteMap(st);
  const missing = [];
  const walk = (n) => {
    if (!n) return;
    if (n._tutkinnonOsaViite && !L(n.nimi)) missing.push(n);
    for (const c of n.osat ?? []) walk(c);
  };
  walk(st?.rakenne);
  if (!missing.length) return 0;
  const ids = [...new Set(missing.map((n) => vm.get(String(n._tutkinnonOsaViite))?.osaId).filter(Boolean))];
  const names = new Map();
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(
      ids.slice(i, i + 8).map(async (id) => {
        const nm = await fetchJson(`${API}/peruste/${perusteId}/tutkinnonOsat/${id}/nimi`, { ttl: 7 * DAY, budget, headers: HEADERS }).catch(() => null);
        if (nm && typeof nm === "object") names.set(id, nm);
      }),
    );
  }
  for (const n of missing) {
    const id = vm.get(String(n._tutkinnonOsaViite))?.osaId;
    n.nimi = names.get(id) ?? { fi: `(nimi puuttuu, tutkinnon osa ${id ?? n._tutkinnonOsaViite})` };
  }
  return ids.length;
}

/** Valitsee suoritustavan (reformi ensin). */
export function pickSuoritustapa(st) {
  if (!Array.isArray(st) || !st.length) return null;
  return st.find((s) => s.suoritustapakoodi === "reformi") ?? st[0];
}

const UNIT = { OSAAMISPISTE: "osp", OPINTOVIIKKO: "ov", OPINTOPISTE: "op", KURSSI: "kurssia" };

export function unitOf(st) {
  return UNIT[st?.laajuusYksikko] ?? "osp";
}

function ruleText(ms, unit) {
  const l = ms?.laajuus;
  const k = ms?.koko;
  const part = (min, max, u) => {
    if (min == null && max == null) return null;
    if (min != null && max != null) return min === max ? `${fmtN(min)} ${u}` : `${fmtN(min)}–${fmtN(max)} ${u}`;
    if (min != null) return `vähintään ${fmtN(min)} ${u}`;
    return `enintään ${fmtN(max)} ${u}`;
  };
  const parts = [part(l?.minimi || null, l?.maksimi, unit), part(k?.minimi || null, k?.maksimi, "tutkinnon osaa")].filter(Boolean);
  return parts.join(", ");
}

const fmtN = (n) => String(Math.round(Number(n) * 10) / 10).replace(".", ",");

/** Viitteet: viiteId -> { osaId, laajuus }. */
export function viiteMap(st) {
  const m = new Map();
  for (const v of st?.tutkinnonOsaViitteet ?? []) m.set(String(v.id), { osaId: String(v._tutkinnonOsa), laajuus: v.laajuus });
  return m;
}

const isMandatoryGroup = (n, kieli) => /^pakollis|^obligatorisk/i.test(L(n.nimi, "fi") || L(n.nimi, kieli));

/**
 * Tutkinnon osat rakennepuusta: [{ viiteId, osaId, nimi, laajuus, asemat: [{ osaamisala, pakollinen }] }].
 */
export function osatOf(st, kieli = "fi") {
  const vm = viiteMap(st);
  const by = new Map();
  const walk = (n, ctx) => {
    if (!n) return;
    if (n._tutkinnonOsaViite) {
      const id = String(n._tutkinnonOsaViite);
      const v = vm.get(id) ?? {};
      const key = v.osaId ?? id;
      if (!by.has(key)) by.set(key, { viiteId: id, osaId: v.osaId, nimi: L(n.nimi, kieli), nimiFi: L(n.nimi, "fi"), laajuus: v.laajuus, asemat: [] });
      // Yhteiset tutkinnon osat ovat pakollisia, ellei niitä ole ryhmitelty valinnaisiksi.
      const pak = !!n.pakollinen || ctx.pakollinen === true || (ctx.pakollinen === null && ctx.ryhma === "yhteiset");
      const o = by.get(key);
      if (!o.asemat.some((a) => a.osaamisala === ctx.osaamisala && a.pakollinen === pak)) o.asemat.push({ osaamisala: ctx.osaamisala, pakollinen: pak, ryhma: ctx.ryhma });
      return;
    }
    const next = { ...ctx };
    if (n.rooli === "osaamisala" || n.osaamisala) next.osaamisala = L(n.osaamisala?.nimi, kieli) || L(n.nimi, kieli);
    if (n.rooli === "vieras" || /yhteiset tutkinnon osat/i.test(L(n.nimi, "fi"))) next.ryhma = "yhteiset";
    if (isMandatoryGroup(n, kieli)) next.pakollinen = true;
    else if (/^valinnai|^valbar/i.test(L(n.nimi, "fi") || L(n.nimi, kieli))) next.pakollinen = false;
    for (const c of n.osat ?? []) walk(c, next);
  };
  walk(st?.rakenne, { osaamisala: null, pakollinen: null, ryhma: "ammatilliset" });
  return [...by.values()];
}

/**
 * Rakennepuu tekstinä. osaamisala = rajaus (nimen osa tai koodi). Toistuvat pitkät
 * valintaluettelot tiivistetään viittaukseksi ensimmäiseen.
 */
export function treeText(st, { kieli = "fi", osaamisala } = {}) {
  const vm = viiteMap(st);
  const unit = unitOf(st);
  const lines = [];
  const seen = new Map();
  const filt = osaamisala ? fold(osaamisala) : null;
  const skipped = [];
  let matched = 0;
  const osaLine = (n, ind) => {
    const v = vm.get(String(n._tutkinnonOsaViite)) ?? {};
    const lj = v.laajuus != null ? `, ${fmtN(v.laajuus)} ${unit}` : "";
    return `${"  ".repeat(ind)}- ${L(n.nimi, kieli)}${lj}`;
  };
  const walk = (n, ind, osaamisalaName) => {
    const isOa = n.rooli === "osaamisala" || !!n.osaamisala;
    if (isOa && filt) {
      const nm = L(n.osaamisala?.nimi, kieli) || L(n.nimi, kieli);
      const code = n.osaamisala?.osaamisalakoodiArvo;
      if (!fold(nm).includes(filt) && code !== filt) {
        skipped.push(nm);
        return;
      }
      matched++;
    }
    const name = ind === 0 ? "Tutkinto" : L(n.nimi, kieli) || "Ryhmä";
    const prefix = n.rooli === "tutkintonimike" ? "Tutkintonimike: " : "";
    const rule = ruleText(n.muodostumisSaanto, unit);
    const kids = n.osat ?? [];
    const leaves = kids.filter((c) => c._tutkinnonOsaViite);
    const oaName = isOa ? L(n.osaamisala?.nimi, kieli) || name : osaamisalaName;
    if (leaves.length >= 6) {
      const sig = kids.map((c) => c._tutkinnonOsaViite ?? `g:${L(c.nimi, "fi")}`).join(",");
      const prev = seen.get(sig);
      if (prev && prev.oa !== oaName) {
        lines.push(`${"  ".repeat(ind)}${prefix}${name}${rule ? ` (${rule})` : ""}: samat ${leaves.length} tutkinnon osaa ja valintamahdollisuudet kuin kohdassa ${prev.oa ?? prev.name}`);
        return;
      }
      if (!prev) seen.set(sig, { oa: oaName, name });
    }
    lines.push(`${"  ".repeat(ind)}${prefix}${name}${rule ? ` (${rule})` : ""}`);
    for (const c of kids) {
      if (c._tutkinnonOsaViite) lines.push(osaLine(c, ind + 1));
      else walk(c, ind + 1, oaName);
    }
  };
  if (st?.rakenne) walk(st.rakenne, 0, null);
  return { text: lines.join("\n"), skipped, matched };
}

/** Rakennepuun osaamisalat [{ nimi, koodi }]. */
export function osaamisalatOf(st, kieli = "fi") {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.rooli === "osaamisala" || n.osaamisala) out.push({ nimi: L(n.osaamisala?.nimi, kieli) || L(n.nimi, kieli), koodi: n.osaamisala?.osaamisalakoodiArvo ?? null });
    for (const c of n.osat ?? []) walk(c);
  };
  walk(st?.rakenne);
  return out;
}

// ---------- Tutkinnon osan sisältö ----------

const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** Hakusanat: pienaakkosin, pitkistä sanoista vartalo (taivutus: hieronta -> hieron). */
export function searchWords(q) {
  return String(q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length >= 6 ? w.slice(0, -2) : w));
}

const matchAll = (text, words) => words.every((w) => fold(text).includes(w));

/**
 * Ammattitaitovaatimukset 2019-muodossa (kohdealueet ja vaatimukset).
 * Palauttaa { lines, count, hits }.
 */
export function vaatimukset2019(av, { kieli = "fi", words = [] } = {}) {
  const lines = [];
  let count = 0;
  let hits = 0;
  if (!av) return { lines, count, hits };
  const kohde = L(av.kohde, kieli);
  const vText = (v) => (L(v.vaatimus, kieli) || L(v.koodi?.nimi, kieli)).replace(/\s+/g, " ").trim();
  const emit = (title, list) => {
    const items = list.map(vText).filter(Boolean);
    count += items.length;
    const keep = words.length ? items.filter((t) => matchAll(t, words) || matchAll(title ?? "", words)) : items;
    hits += keep.length;
    if (!keep.length) return;
    if (title) lines.push(`${title}:`);
    for (const t of keep) lines.push(`- ${t}`);
  };
  if (kohde) lines.push(`${kohde}:`);
  if (av.vaatimukset?.length) emit(null, av.vaatimukset);
  for (const ka of av.kohdealueet ?? []) emit(L(ka.kuvaus, kieli), ka.vaatimukset ?? []);
  if (kohde && lines.length === 1) lines.length = 0;
  return { lines, count, hits };
}

/** Vapaa HTML-teksti riveinä, valinnaisesti rajattuna hakusanoilla. */
export function htmlLines(html, { words = [] } = {}) {
  const all = htmlText(html).split("\n").filter(Boolean);
  if (!words.length) return { lines: all, count: all.length, hits: all.length };
  const keep = all.filter((l) => matchAll(l, words));
  return { lines: keep, count: all.length, hits: keep.length };
}

const tasoNum = (t) => {
  const n = Number(t?.osaamistaso?.koodi?.arvo ?? t?._osaamistaso);
  return Number.isFinite(n) ? n : 99;
};

/** Yhteinen (geneerinen) arviointiasteikko kriteereineen. */
export function geneerinenText(g, { kieli = "fi", words = [] } = {}) {
  if (!g) return [];
  const out = [`${L(g.nimi, kieli) || "Arviointiasteikko"}${g.kohde ? ` (${L(g.kohde, kieli)})` : ""}:`];
  const list = [...(g.osaamistasonKriteerit ?? [])].sort((a, b) => tasoNum(a) - tasoNum(b));
  for (const ok of list) {
    const kr = (ok.kriteerit ?? []).map((k) => clean(L(k, kieli))).filter(Boolean);
    const keep = words.length ? kr.filter((t) => matchAll(t, words)) : kr;
    if (!keep.length) continue;
    out.push(`${L(ok.osaamistaso?.otsikko, kieli) || "Taso"}:`);
    for (const k of keep) out.push(`- ${k}`);
  }
  return out.length > 1 ? out : [];
}

/** Vanhan muodon arviointi: arvioinnin kohdealueet, kohteet ja osaamistasojen kriteerit. */
export function arviointiText(a, { kieli = "fi", words = [] } = {}) {
  const out = [];
  for (const ka of a?.arvioinninKohdealueet ?? []) {
    const block = [];
    for (const ko of ka.arvioinninKohteet ?? []) {
      const head = [clean(L(ko.otsikko, kieli)), clean(L(ko.selite, kieli))].filter(Boolean).join(": ");
      const sub = [];
      const levels = [...(ko.osaamistasonKriteerit ?? [])].sort((x, y) => (x.osaamistaso?.id ?? 0) - (y.osaamistaso?.id ?? 0));
      for (const ok of levels) {
        const kr = (ok.kriteerit ?? []).map((k) => clean(L(k, kieli))).filter(Boolean);
        const keep = words.length ? kr.filter((t) => matchAll(t, words) || matchAll(L(ka.otsikko, kieli), words)) : kr;
        if (!keep.length) continue;
        sub.push(`${L(ok.osaamistaso?.otsikko, kieli) || "Kriteerit"}:`);
        for (const k of keep) sub.push(`- ${k}`);
      }
      if (sub.length) block.push(...(head ? [head] : []), ...sub);
    }
    if (block.length) out.push(`${clean(L(ka.otsikko, kieli)) || "Arvioinnin kohde"}`, ...block, "");
  }
  if (a?.lisatiedot) out.push(htmlText(L(a.lisatiedot, kieli)));
  return out;
}

/** Kaikki kielistetyt tekstit järjestyksessä (varamuoto tuntemattomille rakenteille). */
export function flattenTexts(obj, kieli = "fi", out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const x of obj) flattenTexts(x, kieli, out);
    return out;
  }
  if (typeof obj.fi === "string" || typeof obj.sv === "string") {
    const t = htmlText(L(obj, kieli));
    if (t) out.push(...t.split("\n"));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_") || k === "koodi" || k === "arviointiAsteikko") continue;
    flattenTexts(v, kieli, out);
  }
  return out;
}
