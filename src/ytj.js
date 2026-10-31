// PRH:n YTJ-avoin data (v3): kaupparekisteriin merkityt yritykset.
// Rajapinta: https://avoindata.prh.fi/opendata-ytj-api/v3  (kuvaus: https://avoindata.prh.fi/fi/ytj/swagger-ui)
// HUOM: avoimessa datassa ovat vain kaupparekisteriin merkityt yhteisöt (oy, ky, ay, osuuskunta ym.).
// Yksityiset elinkeinonharjoittajat (toiminimet) eivät ole mukana.

import { fetchJson } from "./http.js";

const BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3";
const PAGE_SIZE = 100;

export const COMPANY_FORMS = {
  OY: "Osakeyhtiö",
  OYJ: "Julkinen osakeyhtiö",
  KY: "Kommandiittiyhtiö",
  AY: "Avoin yhtiö",
  OK: "Osuuskunta",
  SÄÄ: "Säätiö",
  AYH: "Aatteellinen yhdistys",
  SL: "Sivuliike",
  KOY: "Keskinäinen kiinteistöosakeyhtiö",
  AOY: "Asunto-osakeyhtiö",
};

const REGISTERS = {
  1: "Kaupparekisteri",
  2: "Säätiörekisteri",
  3: "Yhdistysrekisteri",
  4: "Verohallinnon perustiedot",
  5: "Ennakkoperintärekisteri",
  6: "Arvonlisäverovelvollisuus",
  7: "Työnantajarekisteri",
  8: "Vakuutusmaksuverovelvollisten rekisteri",
};

export function searchUrl(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  return `${BASE}/companies?${q.toString()}`;
}

export async function searchCompanies(params, { budget, ttl = 12 * 3600 } = {}) {
  const data = await fetchJson(searchUrl(params), { ttl, budget });
  return { total: data?.totalResults ?? 0, companies: data?.companies ?? [] };
}

/** Hakee kaikki sivut (enintään maxPages). */
export async function searchAll(params, { budget, maxPages = 5 } = {}) {
  const first = await searchCompanies({ ...params, page: 1 }, { budget });
  const all = [...first.companies];
  const pages = Math.ceil(first.total / PAGE_SIZE);
  let truncated = false;
  for (let p = 2; p <= pages; p++) {
    if (p > maxPages) {
      truncated = true;
      break;
    }
    const r = await searchCompanies({ ...params, page: p }, { budget });
    all.push(...r.companies);
  }
  return { total: first.total, companies: all, truncated };
}

// ---------- Tulkinta ----------

const today = () => new Date().toISOString().slice(0, 10);
/** Voimassa nyt: ei päättymispäivää tai se on tulevaisuudessa. */
const isCurrent = (x) => !x.endDate || x.endDate >= today();

const fi = (descs) => (descs ?? []).find((d) => d.languageCode === "1")?.description ?? (descs ?? [])[0]?.description ?? null;

export function currentName(c) {
  const names = (c.names ?? []).filter(isCurrent);
  const main = names.find((n) => n.type === "1") ?? names[0] ?? (c.names ?? [])[0];
  return main?.name ?? "(nimetön)";
}

export function auxNames(c) {
  return (c.names ?? []).filter((n) => isCurrent(n) && n.type !== "1").map((n) => n.name);
}

export function isActive(c) {
  return c.status === "2" && c.tradeRegisterStatus === "1";
}

export function statusText(c) {
  if (c.status === "1") return "vireillä";
  if (c.status === "5") return "y-tunnus poistettu käytöstä";
  const kr = { 1: "rekisterissä", 2: "poistettu rekisteristä", 3: "ei rekisteröity perustaminen", 4: "lakannut" }[c.tradeRegisterStatus];
  return kr ?? "tuntematon tila";
}

export function situations(c) {
  return (c.companySituations ?? []).map((s) => fi(s.descriptions) ?? s.type).filter(Boolean);
}

export function businessLine(c) {
  const b = c.mainBusinessLine;
  if (!b) return null;
  return { code: b.type, name: fi(b.descriptions) };
}

export function companyForm(c) {
  const f = (c.companyForms ?? []).find(isCurrent) ?? (c.companyForms ?? [])[0];
  return f ? fi(f.descriptions) : null;
}

export function address(c) {
  const list = (c.addresses ?? []).filter(isCurrent);
  // Tyyppi 1 = käyntiosoite, 2 = postiosoite.
  const a = list.find((x) => x.type === 1) ?? list.find((x) => x.type === 2) ?? list[0];
  if (!a) return null;
  const street = [a.street, a.buildingNumber, a.entrance, a.apartmentNumber].filter(Boolean).join(" ");
  const city = (a.postOffices ?? []).find((p) => p.languageCode === "1")?.city ?? (a.postOffices ?? [])[0]?.city ?? "";
  return {
    text: [a.co ? (/^c\/o/i.test(a.co) ? a.co : `c/o ${a.co}`) : null, street || (a.postOfficeBox ? `PL ${a.postOfficeBox}` : null), [a.postCode, city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
    postCode: a.postCode ?? null,
    municipalityCode: (a.postOffices ?? [])[0]?.municipalityCode ?? null,
  };
}

export function registers(c) {
  return (c.registeredEntries ?? [])
    .filter(isCurrent)
    .filter((e) => !(e.register === "1" && e.type === "0"))
    .map((e) => {
      const reg = REGISTERS[e.register] ?? `rekisteri ${e.register}`;
      const d = fi(e.descriptions);
      const text = d && d !== "Rekisterissä" ? `${reg}: ${d}` : reg;
      return { text, since: e.registrationDate ?? null, until: e.endDate ?? null };
    });
}
