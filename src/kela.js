// Kelan etuustilastot kunnittain: Kelan avoin data avoindata.fi-palvelussa (CKAN DataStore),
// lisenssi CC BY 4.0, lähde Kela (Kelasto). Tiedot päivittyvät kuukausittain 20. päivään mennessä.
//
// - Kelan etuuksien saajat ja maksetut etuudet: kunnittain, kuukausittain vuodesta 2018 ja
//   vuositasolla vuodesta 2008.
// - Vammaistukien saajat ja maksetut etuudet: alle 16-vuotiaan ja 16 vuotta täyttäneen
//   vammaistuki sekä eläkettä saavan hoitotuki kunnittain, tuen tason, ikäryhmän ja sukupuolen
//   mukaan kuukausittain vuodesta 2016 (vuosittain oma resurssi).
//
// Kyselyt tehdään DataStoren SQL-rajapinnalla (datastore_search_sql), joten aineistoa ei tarvitse
// ladata kokonaan (vammaistukiaineisto on n. 250 Mt vuodessa). Hyvinvointialueet muodostetaan
// Tilastokeskuksen kuntien ja hyvinvointialueiden luokitusavaimella (CC BY 4.0).

import { fetchJson, HttpError } from "./http.js";

const CKAN = "https://avoindata.suomi.fi/data/api/3/action";
const STAT_CLASS = "https://data.stat.fi/api/classifications/v2";
const DAY = 86400;

export const KELA_SOURCE = "Lähde: Kela, Kelasto (avoin data avoindata.fi, CC BY 4.0)";
export const KELA_URL = {
  etuudet: "https://avoindata.suomi.fi/data/fi/dataset/kelan-etuuksien-saajat-ja-maksetut-etuudet",
  vammaistuet: "https://avoindata.suomi.fi/data/fi/dataset/vammaistukien-saajat-ja-maksetut-etuudet",
};

const DATASETS = {
  etuudet: "kelan-etuuksien-saajat-ja-maksetut-etuudet",
  vammaistuet: "vammaistukien-saajat-ja-maksetut-etuudet",
};

/** SQL-literaali: vain merkkijonot ja kokonaisluvut, heittomerkit kahdennetaan. */
export function lit(v) {
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function sql(query, { ttl = DAY, budget } = {}) {
  const url = `${CKAN}/datastore_search_sql?sql=${encodeURIComponent(query)}`;
  const res = await fetchJson(url, { ttl, budget });
  if (!res?.success) throw new HttpError("Kelan avoimen datan kysely epäonnistui", 0);
  return res.result.records ?? [];
}

/** Aineiston resurssit: { etuudet: id } tai { vammaistuet: { 2026: id, ... } }. */
async function resources(name, budget) {
  const res = await fetchJson(`${CKAN}/package_show?id=${DATASETS[name]}`, { ttl: 6 * 3600, budget });
  if (!res?.success) throw new HttpError("Kelan aineiston tietoja ei saatu", 0);
  const list = (res.result.resources ?? []).filter((r) => r.datastore_active && String(r.format).toUpperCase() === "CSV");
  if (name === "etuudet") {
    const r = list[0];
    if (!r) throw new HttpError("Kelan etuusaineistoa ei löytynyt", 0);
    return { id: r.id, modified: r.last_modified ?? null };
  }
  const years = {};
  for (const r of list) {
    const m = String(r.name ?? r.url ?? "").match(/data_(\d{4})\.csv/);
    if (m) years[+m[1]] = { id: r.id, modified: r.last_modified ?? null };
  }
  return years;
}

export const etuudetResource = (budget) => resources("etuudet", budget);
export const vammaistukiResources = (budget) => resources("vammaistuet", budget);

// ---------- Alueet ----------

let areaMemo = null;

/**
 * Kunnat (Kelan aineiston nimillä ja numeroilla) ja hyvinvointialueet kuntineen.
 * { kunnat: [{ nro, nimi }], hva: [{ koodi, nimi, kunnat: [nro] }] }
 */
export async function areas(budget) {
  if (areaMemo && areaMemo.exp > Date.now()) return areaMemo.value;
  const { id } = await etuudetResource(budget);
  const max = await sql(`SELECT max(vuosikuukausi) AS m FROM "${id}" WHERE aikatyyppi = 'Kuukausi'`, { ttl: 6 * 3600, budget });
  const latest = Number(max[0]?.m);
  const rows = await sql(`SELECT DISTINCT kunta_nro, kunta_nimi FROM "${id}" WHERE vuosikuukausi = ${lit(latest)}`, { budget });
  const kunnat = rows.map((r) => ({ nro: String(r.kunta_nro), nimi: String(r.kunta_nimi) })).filter((k) => /^\d{3}$/.test(k.nro) && k.nro !== "000" && k.nro !== "199");
  const year = Math.floor(latest / 100);
  let hva = [];
  for (const y of [year, year - 1]) {
    const maps = await fetchJson(
      `${STAT_CLASS}/correspondenceTables/kunta_1_${y}0101%23hyvinvointialue_1_${y}0101/maps?content=data&format=json&lang=fi`,
      { ttl: 7 * DAY, budget },
    ).catch(() => null);
    if (Array.isArray(maps) && maps.length) {
      const by = new Map();
      for (const m of maps) {
        const code = m.targetItem?.code;
        const name = m.targetItem?.classificationItemNames?.find((n) => n.lang === "fi")?.name ?? m.targetItem?.classificationItemNames?.[0]?.name;
        const k = m.sourceItem?.code;
        if (!code || !k) continue;
        if (!by.has(code)) by.set(code, { koodi: code, nimi: name, kunnat: [] });
        by.get(code).kunnat.push(String(k).padStart(3, "0"));
      }
      hva = [...by.values()];
      break;
    }
  }
  const value = { kunnat, hva, latest };
  areaMemo = { value, exp: Date.now() + 3600_000 };
  return value;
}

const fold = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Alue nimellä tai numerolla: { label, kind: "kunta"|"hyvinvointialue"|"maa", nros: [..] | null }.
 * null = ei löytynyt; { ambiguous: [...] } = useita.
 */
export async function resolveArea(input, budget) {
  const q = fold(input);
  if (!q || q === "koko maa" || q === "suomi" || q === "maa") return { label: "Koko maa", kind: "maa", nros: null };
  const { kunnat, hva } = await areas(budget);
  if (/^\d{1,3}$/.test(q)) {
    const k = kunnat.find((x) => x.nro === q.padStart(3, "0"));
    if (k) return { label: k.nimi, kind: "kunta", nros: [k.nro] };
  }
  const k = kunnat.find((x) => fold(x.nimi) === q);
  if (k) return { label: k.nimi, kind: "kunta", nros: [k.nro] };
  const toHva = (h) => ({ label: h.nimi, kind: "hyvinvointialue", nros: h.kunnat });
  const hExact = hva.find((x) => fold(x.nimi) === q);
  if (hExact) return toHva(hExact);
  const hs = hva.filter((x) => fold(x.nimi).includes(q));
  if (hs.length === 1) return toHva(hs[0]);
  const ks = kunnat.filter((x) => fold(x.nimi).startsWith(q));
  if (ks.length === 1 && !hs.length) return { label: ks[0].nimi, kind: "kunta", nros: [ks[0].nro] };
  const cands = [...hs.map((x) => x.nimi), ...ks.map((x) => x.nimi)];
  return cands.length ? { ambiguous: cands.slice(0, 15) } : null;
}

/** WHERE-ehto alueelle. */
export function areaWhere(area) {
  if (!area.nros) return "kunta_nro = '000'";
  if (area.nros.length === 1) return `kunta_nro = ${lit(area.nros[0])}`;
  return `kunta_nro IN (${area.nros.map(lit).join(", ")})`;
}

// ---------- Kyselyt ----------

/** Kelan etuudet alueella yhdeltä kuukaudelta tai vuodelta: [{ etuus, saajat, eur, s_l, e_l }]. */
export async function benefitsFor(area, ym, { yearly = false, budget } = {}) {
  const { id } = await etuudetResource(budget);
  const time = yearly ? `aikatyyppi = 'Vuosi' AND vuosi = ${lit(Math.floor(ym / 100))}` : `aikatyyppi = 'Kuukausi' AND vuosikuukausi = ${lit(ym)}`;
  const rows = await sql(
    `SELECT etuus, sum(saaja_lkm) AS saajat, sum(maksettu_eur) AS eur, sum(saaja_laskenta_lkm) AS s_l, sum(maksettu_laskenta_eur) AS e_l FROM "${id}" WHERE ${time} AND ${areaWhere(area)} GROUP BY etuus`,
    { budget },
  );
  return rows.map((r) => ({ etuus: r.etuus, saajat: Number(r.saajat) || 0, eur: Number(r.eur) || 0, s_l: Number(r.s_l) || 0, e_l: Number(r.e_l) || 0 }));
}

/** Yhden etuuden kuukausisarja: [{ ym, saajat, eur, s_l, e_l }]. */
export async function benefitSeries(area, etuus, fromYm, toYm, budget) {
  const { id } = await etuudetResource(budget);
  const rows = await sql(
    `SELECT vuosikuukausi AS ym, sum(saaja_lkm) AS saajat, sum(maksettu_eur) AS eur, sum(saaja_laskenta_lkm) AS s_l, sum(maksettu_laskenta_eur) AS e_l FROM "${id}" WHERE aikatyyppi = 'Kuukausi' AND etuus = ${lit(etuus)} AND vuosikuukausi BETWEEN ${lit(fromYm)} AND ${lit(toYm)} AND ${areaWhere(area)} GROUP BY vuosikuukausi ORDER BY vuosikuukausi`,
    { budget },
  );
  return rows.map((r) => ({ ym: Number(r.ym), saajat: Number(r.saajat) || 0, eur: Number(r.eur) || 0, s_l: Number(r.s_l) || 0, e_l: Number(r.e_l) || 0 }));
}

export async function benefitNames(budget) {
  const { id } = await etuudetResource(budget);
  const rows = await sql(`SELECT DISTINCT etuus FROM "${id}"`, { budget });
  return rows.map((r) => r.etuus).filter(Boolean).sort();
}

export async function latestMonth(budget) {
  return (await areas(budget)).latest;
}

/** Vammaistuet: viimeisin kuukausi annetun vuoden resurssissa. */
export async function vtLatest(resId, budget) {
  const r = await sql(`SELECT max(vuosikuukausi) AS m FROM "${resId}" WHERE aikatyyppi = 'Kuukausi'`, { ttl: 6 * 3600, budget });
  return Number(r[0]?.m) || null;
}

/**
 * Vammaistuet kuukaudelta: summat etuuden, tason, ikäryhmän ja sukupuolen mukaan
 * (sairauspääryhmä "Yhteensä"; valinnaisesti sairauspääryhmittäin).
 */
export async function disabilityFor(resId, area, ym, { byDiagnosis = false, budget } = {}) {
  const base = `FROM "${resId}" WHERE aikatyyppi = 'Kuukausi' AND vuosikuukausi = ${lit(ym)} AND ${areaWhere(area)}`;
  const q = (cols, where = "") =>
    sql(`SELECT ${cols}, sum(saaja_lkm) AS saajat, sum(maksettu_eur) AS eur ${base} ${where} GROUP BY ${cols} ORDER BY ${cols}`, { budget });
  const [tasot, iat, sukupuolet, diag] = await Promise.all([
    q("etuus, etuustaso", "AND sairauspaaryhma = 'Yhteensä'"),
    q("etuus, ikaryhma", "AND sairauspaaryhma = 'Yhteensä' AND etuustaso = 'Yhteensä'"),
    q("etuus, sukupuoli", "AND sairauspaaryhma = 'Yhteensä' AND etuustaso = 'Yhteensä'"),
    byDiagnosis ? q("etuus, sairauspaaryhma", "AND etuustaso = 'Yhteensä' AND sairauspaaryhma <> 'Yhteensä'") : Promise.resolve([]),
  ]);
  const num = (rows) => rows.map((r) => ({ ...r, saajat: Number(r.saajat) || 0, eur: Number(r.eur) || 0 }));
  return { tasot: num(tasot), iat: num(iat), sukupuolet: num(sukupuolet), diag: num(diag) };
}

export const ymLabel = (ym) => `${ym % 100}/${Math.floor(ym / 100)}`;

export function parseYm(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return +m[1] * 100 + +m[2];
  m = s.match(/^(\d{1,2})[/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[2] * 100 + +m[1];
  m = s.match(/^(\d{6})$/);
  if (m && +s % 100 >= 1 && +s % 100 <= 12) return +s;
  return null;
}

export function addMonths(ym, n) {
  const y = Math.floor(ym / 100);
  const mo = (ym % 100) - 1 + n;
  const yy = y + Math.floor(mo / 12);
  return yy * 100 + (((mo % 12) + 12) % 12) + 1;
}
