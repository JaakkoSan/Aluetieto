// PRH:n kaupparekisterin rekisteröidyt ilmoitukset (avoin data, CC BY 4.0).
// Rajapinta: https://avoindata.prh.fi/opendata-registerednotices-api/v3 (kuvaus /schema?lang=fi,
// selain https://avoindata.prh.fi/fi/krek/swagger-ui). Ilmoituksesta tulevat päivä, diaarinumero,
// ilmoituksen tyyppi ja rekisteröityjen asioiden koodit, ei ilmoituksen tekstiä.
// Havaittu 1.11.2026: koko maan haku pelkällä aikavälillä tai ilmoitustyypillä aikakatkaistaan (504,
// 30 s), haku rekisterimerkinnän koodilla, postitoimipaikalla, nimellä tai yritysmuodolla toimii.

import { fetchJson } from "./http.js";
import { ENTRY_CODES } from "./krekCodes.js";

const BASE = "https://avoindata.prh.fi/opendata-registerednotices-api/v3";
export const KREK_SOURCE = "Lähde: Patentti- ja rekisterihallitus, kaupparekisterin rekisteröidyt ilmoitukset (avoin data, CC BY 4.0)";
export const PAGE_SIZE = 50;
export { ENTRY_CODES };

// Ilmoituksen tyypit (koodisto NRT, /description?code=NRT&lang=FI).
export const NOTICE_TYPES = {
  DIF: "Diffuusiohakemus",
  FUU: "Fuusiohakemus",
  H: "Hakemus",
  JH: "Julkinen haaste velkojille",
  KM: "Kuntamuutosilmoitus",
  M: "Muutosilmoitus",
  OI: "Oikaisu",
  T: "Tiedonanto",
  TA: "Tilinpäätös",
  U: "Perusilmoitus",
  VA: "Valvonta-asia",
};

// Yleisimmät haut arkikielellä. "uudet" = perustaminen perusilmoituksella.
export const TOPICS = {
  "uudet yritykset": { entryCode: "PERUS", type: "U", label: "uudet yritykset (perusilmoitus, perustaminen)" },
  uudet: { entryCode: "PERUS", type: "U", label: "uudet yritykset (perusilmoitus, perustaminen)" },
  perustaminen: { entryCode: "PERUS", type: "U", label: "uudet yritykset (perusilmoitus, perustaminen)" },
  konkurssi: { entryCode: "KONALK" },
  konkurssit: { entryCode: "KONALK" },
  "konkurssin lopettaminen": { entryCode: "KONLOP" },
  "konkurssin raukeaminen": { entryCode: "KONRAU" },
  selvitystila: { entryCode: "SELAS" },
  "selvitystilan lopettaminen": { entryCode: "SELLOP" },
  saneeraus: { entryCode: "SANALK" },
  yrityssaneeraus: { entryCode: "SANALK" },
  saneerausmenettely: { entryCode: "SANALK" },
  "saneerausmenettelyn lakkaaminen": { entryCode: "SANLOP" },
  purkautuminen: { entryCode: "LAKK" },
  lopettaminen: { entryCode: "LAKK" },
  "rekisteristä poistaminen": { entryCode: "POISTO" },
  poisto: { entryCode: "POISTO" },
  poistouhka: { entryCode: "POIUH" },
  hallitus: { entryCode: "HAL" },
  toimitusjohtaja: { entryCode: "TOIM" },
  prokura: { entryCode: "NIMP" },
  toiminimi: { entryCode: "TMI" },
  aputoiminimi: { entryCode: "TMIA" },
  toimiala: { entryCode: "TAL" },
  kotipaikka: { entryCode: "KOTI" },
  yhtiöjärjestys: { entryCode: "STA" },
  tilinpäätös: { entryCode: "TASE" },
  tilintarkastaja: { entryCode: "TILTAR" },
  osakepääoma: { entryCode: "OPO" },
  sulautuminen: { entryCode: "SULTIE" },
  "tosiasialliset edunsaajat": { entryCode: "ESR" },
};

const fold = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Asia → { entryCode, type?, label } tai { ambiguous: [[koodi, otsikko]] } tai null.
 * Hyväksyy koodin (KONALK), arkisanan (konkurssi) tai otsikon osan (konkurssin raukeaminen).
 */
export function resolveTopic(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (ENTRY_CODES[up]) return { entryCode: up, label: `${ENTRY_CODES[up]} (${up})` };
  const t = TOPICS[fold(s)];
  if (t) return { ...t, label: t.label ?? `${ENTRY_CODES[t.entryCode]} (${t.entryCode})` };
  const q = fold(s);
  const hits = Object.entries(ENTRY_CODES).filter(([, d]) => fold(d).includes(q));
  const exact = hits.filter(([, d]) => fold(d) === q);
  const pick = exact.length === 1 ? exact : hits;
  if (pick.length === 1) return { entryCode: pick[0][0], label: `${pick[0][1]} (${pick[0][0]})` };
  return hits.length ? { ambiguous: hits.slice(0, 25) } : null;
}

export function resolveNoticeType(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  if (NOTICE_TYPES[s.toUpperCase()]) return s.toUpperCase();
  const q = fold(s).replace(/^tilinpäätö(s|kset)$/, "tilinpäätös");
  const hit = Object.entries(NOTICE_TYPES).find(([, d]) => fold(d) === q || fold(d).startsWith(q));
  return hit ? hit[0] : undefined;
}

export function entryText(code) {
  return ENTRY_CODES[code] ?? code;
}

/** Yrityksen kaikki ilmoitukset Y-tunnuksella. null = ei löytynyt. */
export async function companyNotices(businessId, budget) {
  return fetchJson(`${BASE}/${encodeURIComponent(businessId)}`, { ttl: 6 * 3600, budget }).catch((e) => {
    // Tuntematon Y-tunnus: 400/404 ja virhekoodi 1006.
    if (e?.status === 400) return null;
    throw e;
  });
}

/** Haku: { name, location, companyForm, entryCode, noticeRegistrationType, noticeRegistrationDateStart, noticeRegistrationDateEnd, page }. */
export async function searchNotices(params, budget) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const data = await fetchJson(`${BASE}/?${q.toString()}`, { ttl: 6 * 3600, budget });
  return { total: data?.totalResults ?? 0, companies: data?.companies ?? [] };
}

export const ytjWebUrl = (id) => `https://tietopalvelu.ytj.fi/yritys/${encodeURIComponent(id)}`;
