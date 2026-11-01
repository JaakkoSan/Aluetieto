// Suomi.fi-palvelutietovaranto (PTV), Digi- ja väestötietovirasto. Avoin lukurajapinta
// https://api.palvelutietovaranto.suomi.fi/api/v11 (kuvaus /swagger/v11/swagger.json), tiedot avointa
// dataa (avoindata.fi: CC0 1.0). Julkisten organisaatioiden (kunnat, hyvinvointialueet, valtio) palvelut
// ja asiointikanavat: kuvaukset, palveluseteli, maksullisuus, puhelinnumerot, osoitteet, aukioloajat.

import { fetchJson } from "./http.js";

const API = "https://api.palvelutietovaranto.suomi.fi/api/v11";
export const PTV_SOURCE = "Lähde: Suomi.fi-palvelutietovaranto (Digi- ja väestötietovirasto), avoin data";
const DAY = 86400;

const fi = (arr, type) => {
  const list = Array.isArray(arr) ? arr : [];
  const pick = (l) => list.find((x) => x.language === l && (!type || x.type === type))?.value ?? null;
  return pick("fi") ?? pick("sv") ?? pick("en");
};
const fold = (s) => String(s ?? "").trim().toLowerCase();

let areaMemo = null;

/** Kunnat ja hyvinvointialueet: [{ type: "Municipality"|"WellbeingServiceCounties", code, name }]. */
export async function ptvAreas(budget) {
  if (areaMemo && areaMemo.exp > Date.now()) return areaMemo.value;
  const [m, w] = await Promise.all([
    fetchJson(`${API}/CodeList/GetMunicipalityCodes`, { ttl: 7 * DAY, budget }),
    fetchJson(`${API}/CodeList/GetAreaCodes/type/WellbeingServiceCounties`, { ttl: 7 * DAY, budget }),
  ]);
  const value = [
    ...(m ?? []).map((x) => ({ type: "Municipality", code: x.code, name: fi(x.names) })),
    ...(w ?? []).map((x) => ({ type: "WellbeingServiceCounties", code: x.code, name: fi(x.names) })),
  ].filter((x) => x.name);
  areaMemo = { value, exp: Date.now() + 3600_000 };
  return value;
}

export async function resolvePtvArea(input, budget) {
  const q = fold(input);
  const list = await ptvAreas(budget);
  const exact = list.filter((a) => fold(a.name) === q || a.code === q);
  if (exact.length === 1) return exact[0];
  const part = list.filter((a) => fold(a.name).includes(q));
  if (part.length === 1) return part[0];
  if (exact.length > 1) return exact.find((a) => a.type === "Municipality");
  return part.length ? { ambiguous: part.slice(0, 15).map((a) => a.name) } : null;
}

/** Alueen palvelut: [{ id, name }] (kaikki sivut, enintään 10). */
export async function servicesInArea(area, { wholeCountry = false, budget } = {}) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const d = await fetchJson(
      `${API}/Service/area/${area.type}/code/${encodeURIComponent(area.code)}?page=${page}${wholeCountry ? "&includeWholeCountry=true" : ""}`,
      { ttl: DAY, budget },
    );
    for (const x of d?.itemList ?? []) out.push({ id: x.id, name: x.name });
    if (!d || page >= (d.pageCount ?? 1)) break;
  }
  return out;
}

export async function service(id, budget) {
  return fetchJson(`${API}/Service/${encodeURIComponent(id)}`, { ttl: DAY, budget });
}

export async function channels(ids, budget) {
  if (!ids.length) return [];
  const d = await fetchJson(`${API}/ServiceChannel/list?guids=${ids.map(encodeURIComponent).join(",")}`, { ttl: DAY, budget });
  return Array.isArray(d) ? d : [];
}

const DAYS = { Monday: "ma", Tuesday: "ti", Wednesday: "ke", Thursday: "to", Friday: "pe", Saturday: "la", Sunday: "su" };
const hhmm = (t) => String(t ?? "").slice(0, 5).replace(/^0/, "");

function hoursText(hours) {
  const now = (hours ?? []).filter((h) => h.serviceHourType === "DaysOfTheWeek" && h.validForNow !== false);
  if (!now.length) return null;
  const h = now[0];
  if (h.isAlwaysOpen) return "aina avoinna";
  if (h.isReservation) return "ajanvarauksella";
  const parts = (h.openingHour ?? []).map((o) => `${DAYS[o.dayFrom] ?? o.dayFrom}${o.dayTo ? `–${DAYS[o.dayTo] ?? o.dayTo}` : ""} ${hhmm(o.from)}–${hhmm(o.to)}`);
  const extra = fi(h.additionalInformation);
  const base = parts.join(", ");
  return base ? (extra ? `${base} (${extra})` : base) : extra || null;
}

const CH_TYPE = { Phone: "puhelin", EChannel: "verkkoasiointi", WebPage: "verkkosivu", PrintableForm: "lomake", ServiceLocation: "palvelupiste" };

/** Asiointikanava tiiviinä tekstinä. */
export function channelText(c) {
  const name = fi(c.serviceChannelNames, "Name") ?? fi(c.serviceChannelNames) ?? "(nimetön kanava)";
  const bits = [];
  for (const p of c.phoneNumbers ?? []) {
    if (p.language && p.language !== "fi") continue;
    bits.push(`puh. ${p.prefixNumber ?? ""} ${p.number}`.replace(/\s+/g, " ").trim() + (p.serviceChargeType === "Chargeable" && p.chargeDescription ? ` (${p.chargeDescription})` : ""));
  }
  for (const e of c.emails ?? []) if (!e.language || e.language === "fi") bits.push(e.value);
  for (const a of c.addresses ?? []) {
    const s = a.streetAddress;
    if (!s) continue;
    bits.push(`${fi(s.street) ?? ""} ${s.streetNumber ?? ""}, ${s.postalCode ?? ""} ${fi(s.postOffice) ?? ""}`.replace(/\s+/g, " ").replace(/\s,/, ",").trim());
  }
  const web = (c.webPages ?? []).find((w) => w.language === "fi") ?? (c.webPages ?? [])[0];
  if (web?.url) bits.push(web.url);
  const h = hoursText(c.serviceHours);
  if (h) bits.push(`aukiolo: ${h}`);
  return `${name} (${CH_TYPE[c.serviceChannelType] ?? c.serviceChannelType})${bits.length ? `: ${bits.join(" | ")}` : ""}`;
}

export function serviceSummary(s) {
  const desc = (t) => fi(s.serviceDescriptions, t);
  return {
    name: fi(s.serviceNames, "Name") ?? fi(s.serviceNames),
    type: s.type,
    funding: s.fundingType,
    charge: s.serviceChargeType,
    orgs: (s.organizations ?? []).map((o) => ({ name: o.organization?.name, role: o.roleType, provision: o.provisionType })),
    areas: (s.areas ?? []).map((a) => fi(a.name)).filter(Boolean),
    areaType: s.areaType,
    summary: desc("Summary"),
    description: desc("Description"),
    instruction: desc("UserInstruction"),
    chargeInfo: desc("ChargeTypeAdditionalInfo"),
    deadline: desc("DeadLine"),
    processing: desc("ProcessingTime"),
    validity: desc("ValidityTime"),
    requirements: fi(s.requirements),
    vouchers: s.serviceVouchersInUse ? (s.serviceVouchers ?? []).filter((v) => !v.language || v.language === "fi").map((v) => [v.value, v.url, v.additionalInformation].filter(Boolean).join(" – ")) : null,
    legislation: (s.legislation ?? []).map((l) => fi(l.names) ?? fi(l.webPages)).filter(Boolean),
    channelIds: (s.serviceChannels ?? []).map((c) => c.serviceChannel?.id).filter(Boolean),
    modified: s.modified,
  };
}
