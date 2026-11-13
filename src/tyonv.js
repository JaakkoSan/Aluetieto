// KEHA-keskuksen työnvälitystilasto Tilastokeskuksen StatFinissä (CC BY 4.0): avoimet työpaikat
// ja työnhakijat ammattiryhmittäin (AML 2010, 4 numeroa) maakunnittain kuukauden aikana (tyonv/12tu),
// työnantajan sektori kahden numeron ammattiluokittain puolivuosittain (tyonv/12uz) ja kunnan kaikki
// avoimet työpaikat kuukausittain (tyonv/12r5). Tilasto kattaa vain TE-palveluihin
// (Työmarkkinatorille) ilmoitetut paikat. Kunnan maakunta Tilastokeskuksen luokitusavaimesta.

import { fetchJson } from "./http.js";
import { tableMeta, runQuery } from "./statfin.js";

const STAT_CLASS = "https://data.stat.fi/api/classifications/v2";
const DAY = 86400;

export const TYONV = {
  ammatit: { area: "tyonv", table: "12tu" },
  sektorit: { area: "tyonv", table: "12uz" },
  kunnat: { area: "tyonv", table: "12r5" },
};
export const TYONV_SOURCE =
  "Lähde: KEHA-keskus, työnvälitystilasto; Tilastokeskus, StatFin (CC BY 4.0), https://stat.fi/tilasto/tyonv";

const fold = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Alan ammattinimet AML 2010 -koodeiksi (Tilastokeskuksen ammattiluokitus 2010, esimerkit ja
 * hakemistonimikkeet, tarkistettu 13.11.2026). Tilastossa on vain 4-numerotaso.
 */
const NAME_RULES = [
  { re: /parturi|kampaa|hiusmuotoil|hiusala/, code: "5141" },
  { re: /kosmetolog|manikyr|pedikyr|maskeera|meikk|kynsi|ripsi|kauneudenhoi|ihonhoit|sokeroi|depilaa|karvanpoist|jalkahoit|tatuoi/, code: "5142" },
  // Ennen hierojasääntöä: hermorata-, lymfa- ja äänimaljahierojat ovat ryhmässä 3230.
  { re: /luontaishoit|vaihtoehtohoit|vyöhyketerap|refleksolog|aromaterap|akupunkt|shiatsu|homeopa|hermoratahier|lymfa|äänimalja/, code: "3230" },
  { re: /hieroj|hieront|kuntohoitaj|hammashoitaj|välinehuoltaj/, code: "5329" },
  { re: /fysioterap|jalkaterap|jalkojenhoit/, code: "3255" },
  { re: /kiroprakt|osteopa|naprapa|toimintaterap/, code: "3259" },
  { re: /lähihoitaj|perushoitaj/, code: "5321" },
  { re: /sairaanhoitaj|terveydenhoitaj/, code: "3221" },
];

/** Huomautukset ryhmistä, joissa nimi ja luokka eivät vastaa toisiaan suoraan. */
export const CODE_NOTES = {
  "5329": "Ryhmä 5329 Muut terveydenhuoltoalan työntekijät sisältää hierojat ja kuntohoitajat (53294) sekä mm. hammashoitajat, välinehuoltajat ja apteekkien lääketyöntekijät. Tilastossa ei ole tarkempaa jakoa, joten luku ei ole pelkkien hierojien.",
  "3255": "Ryhmä 3255 Fysioterapeutit ym. sisältää fysioterapeutit, jalkaterapeutit ja terveydenhuollon jalkojenhoitajat. Hierojat ovat ryhmässä 5329 ja pedikyristit ryhmässä 5142.",
  "5142": "Ryhmä 5142 Kosmetologit ym. sisältää myös mm. manikyristit, pedikyristit, jalkahoitajat (kauneudenhoito), kynsi- ja ripsiteknikot, maskeeraajat ja tatuoijat.",
  "3230": "Ryhmä 3230 Luontais- ja vaihtoehtohoitajat sisältää mm. vyöhyketerapeutit, aromaterapeutit, akupunktiohoitajat, shiatsuhoitajat sekä hermorata-, lymfa- ja äänimaljahierojat.",
  "5321": "Ryhmä 5321 Lähihoitajat kattaa laitoksissa työskentelevät lähihoitajat. Kotihoidon lähihoitajat (53221) ovat ryhmässä 5322 Kodinhoitajat (kotipalvelutoiminta), jota ei ole laskettu mukaan; hae tarvittaessa koodilla 5322.",
  "3259": "Ryhmä 3259 sisältää mm. toimintaterapeutit, kiropraktikot, osteopaatit ja naprapaatit.",
};

const cleanText = (t) => String(t ?? "").replace(/^\S+\s+/, "").trim();

/**
 * Ammatti nimellä tai koodilla → { code, name, how } tai { error } (ei löytynyt) tai { many: [...] }.
 * occVar = taulukon 12tu Ammattiryhmä-muuttuja.
 */
export function resolveOccupation(input, occVar) {
  const q = fold(input);
  const valid = occVar.values
    .map((c, i) => ({ code: c, name: cleanText(occVar.texts[i]) }))
    .filter((o) => /^\d{4}$/.test(o.code) && occVar.texts[occVar.values.indexOf(o.code)].startsWith(o.code));
  const byCode = (c) => valid.find((o) => o.code === c);
  if (!q) return { error: "Anna ammatti." };
  const digits = q.replace(/\s/g, "");
  if (/^\d{4,5}$/.test(digits)) {
    const o = byCode(digits.slice(0, 4));
    if (!o) return { error: `Ammattiryhmää ${digits} ei ole työnvälitystilastossa (AML 2010, 4 numeroa).` };
    return { ...o, how: digits.length === 5 ? `koodi ${digits} on tilastossa vain 4-numerotasolla` : "koodi" };
  }
  for (const r of NAME_RULES) {
    if (r.re.test(q)) {
      const o = byCode(r.code);
      if (o) return { ...o, how: `"${input}"` };
    }
  }
  // Tekstihaku taulukon ammattiryhmistä; lyhennetään sanan loppua taivutusmuotojen vuoksi.
  for (let len = q.length; len >= Math.max(4, q.length - 3); len--) {
    const stem = q.slice(0, len);
    const hits = valid.filter((o) => fold(o.name).includes(stem));
    if (hits.length === 1) return { ...hits[0], how: `"${input}" (tekstihaku)` };
    if (hits.length > 1) return { many: hits.slice(0, 15) };
  }
  return { error: `Ammattia "${input}" ei löytynyt työnvälitystilaston ammattiryhmistä.` };
}

let kuntaMemo = null;

/** Kuntien maakunnat: Map kuntakoodi (3 numeroa) → maakuntakoodi (2 numeroa). */
async function kuntaMaakunta(budget) {
  if (kuntaMemo && kuntaMemo.exp > Date.now()) return kuntaMemo.map;
  const year = new Date().getUTCFullYear();
  for (const y of [year, year - 1]) {
    const maps = await fetchJson(
      `${STAT_CLASS}/correspondenceTables/kunta_1_${y}0101%23maakunta_1_${y}0101/maps?content=data&format=json&lang=fi`,
      { ttl: 7 * DAY, budget },
    ).catch(() => null);
    if (Array.isArray(maps) && maps.length) {
      const map = new Map();
      for (const m of maps) {
        const k = m.sourceItem?.code;
        const t = m.targetItem?.code;
        if (k && t) map.set(String(k).padStart(3, "0"), String(t).padStart(2, "0"));
      }
      kuntaMemo = { map, exp: Date.now() + 6 * 3600_000 };
      return map;
    }
  }
  return null;
}

/**
 * Alue: koko maa, maakunta (nimi tai koodi) tai kunta (ohjataan maakuntaan).
 * Palauttaa { code: "SSS"|"MKxx", name, kunta?: { code: "KUxxx", name } } tai { error }.
 */
export async function resolveRegion(input, areaVar, budget) {
  const q = fold(input).replace(/^mk/, "");
  if (!q || q === "koko maa" || q === "suomi" || q === "maa" || q === "sss") return { code: "SSS", name: "Koko maa" };
  const regions = areaVar.values
    .map((c, i) => ({ code: c, name: cleanText(areaVar.texts[i]) }))
    .filter((r) => /^MK\d\d$/.test(r.code) && r.code !== "MK90");
  if (/^\d{1,2}$/.test(q)) {
    const r = regions.find((x) => x.code === `MK${q.padStart(2, "0")}`);
    if (r) return r;
  }
  const qq = q.replace(/\s*maakunta$/, "");
  const r = regions.find((x) => fold(x.name) === qq);
  if (r) return r;
  // Kunta: kuntien nimet taulukosta 12r5 ja maakunta luokitusavaimesta.
  const meta = await tableMeta(TYONV.kunnat, budget);
  const av = meta?.variables.find((v) => v.code === "Alue");
  if (av) {
    const i = av.values.findIndex((c, j) => /^KU\d{3}$/.test(c) && (fold(av.texts[j]) === fold(input) || c.slice(2) === q.padStart(3, "0")));
    if (i >= 0) {
      const kunta = { code: av.values[i], name: av.texts[i] };
      const map = await kuntaMaakunta(budget);
      const mk = map?.get(kunta.code.slice(2));
      const region = mk ? regions.find((x) => x.code === `MK${mk}`) : null;
      if (!region) return { error: `Kunnan ${kunta.name} maakuntaa ei saatu Tilastokeskuksen luokitusavaimesta. Anna maakunta.` };
      return { ...region, kunta };
    }
  }
  return { error: `Aluetta "${input}" ei löytynyt. Anna maakunta (${regions.map((x) => x.name).join(", ")}), kunta tai "koko maa".` };
}

/** json-stat2-kuutio koodeilla: get({ ulottuvuus: koodi }) → { value, status }. */
export function cube(ds) {
  const dims = ds.id.map((id, k) => {
    const idx = ds.dimension[id].category.index;
    const order = Array.isArray(idx) ? idx : Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
    return { id, k, order, pos: new Map(order.map((c, i) => [c, i])), label: ds.dimension[id].category.label ?? {} };
  });
  return {
    updated: ds.updated ?? null,
    codes: (id) => dims.find((d) => d.id === id)?.order ?? [],
    label: (id, c) => dims.find((d) => d.id === id)?.label[c] ?? c,
    get(sel) {
      let i = 0;
      for (const d of dims) {
        const p = d.pos.get(sel[d.id] ?? d.order[0]);
        if (p === undefined) return { value: null, status: null };
        i = i * ds.size[d.k] + p;
      }
      const value = Array.isArray(ds.value) ? ds.value[i] : ds.value?.[i];
      const status = ds.status ? ds.status[i] ?? ds.status[String(i)] ?? null : null;
      return { value: value ?? null, status };
    },
  };
}

const sel = (code, values, filter = "item") => ({ code, selection: { filter, values } });

/** Avoimet työpaikat (ja valinnaisesti työnhakijat) ammattiryhmittäin, kaikki maakunnat, viimeiset n kk. */
export async function occupationSeries({ occCodes, regionCodes, months, seekers }, budget) {
  const query = {
    query: [
      sel("Alue", regionCodes),
      sel("Ammattiryhmä", occCodes),
      sel("Työmarkkina-asema", seekers ? ["SSS", "2"] : ["SSS"]),
      sel("timeperiod_m", [String(months)], "top"),
      sel("contentscode", seekers ? ["AVPAIKATYHT", "HAKIJAYHT"] : ["AVPAIKATYHT"]),
    ],
    response: { format: "json-stat2" },
  };
  return cube(await runQuery(TYONV.ammatit, query, budget));
}

/** Avoimet työpaikat työnantajan sektorin mukaan, viimeisin tammi-kesäkuu, 2-numeroiset ammattiluokat. */
export async function sectorHalfYear({ groups, regionCode }, budget) {
  const query = {
    query: [
      sel("Alue", [regionCode]),
      sel("Ammattiryhmä", groups),
      sel("Työnantajan sektori", ["*"], "all"),
      sel("Työpaikan työn kesto", ["SSS"]),
      sel("timeperiod_y", ["1"], "top"),
      sel("contentscode", ["AVPAIKATYHTPV"]),
    ],
    response: { format: "json-stat2" },
  };
  return cube(await runQuery(TYONV.sektorit, query, budget));
}

/** Kunnan kaikki avoimet työpaikat (ei ammattijakoa), viimeiset 13 kk. */
export async function municipalityVacancies(kuntaCode, budget) {
  const query = {
    query: [sel("Alue", [kuntaCode]), sel("timeperiod_m", ["13"], "top"), sel("contentscode", ["AVPAIKATLOPUSSA", "UUDETAVP"])],
    response: { format: "json-stat2" },
  };
  return cube(await runQuery(TYONV.kunnat, query, budget));
}

/** "2026M09" → "9/2026". */
export const monthLabel = (m) => {
  const x = String(m).match(/^(\d{4})M(\d{2})$/);
  return x ? `${Number(x[2])}/${x[1]}` : String(m);
};

/** Sama kuukausi vuotta aiemmin: "2026M09" → "2025M09". */
export const yearEarlier = (m) => {
  const x = String(m).match(/^(\d{4})M(\d{2})$/);
  return x ? `${Number(x[1]) - 1}M${x[2]}` : null;
};

/** Taulukon rakenne nimellä (ammatit, sektorit, kunnat). */
export const tableMetaFor = (name, budget) => tableMeta(TYONV[name], budget);

/** Solun arvo tekstinä: luku, salassa pidetty pieni luku tai puuttuva. Salassa pidetty ei ole koskaan nolla. */
export function cellText({ value, status } = {}, fmtNum = String) {
  if (value !== null && value !== undefined) return fmtNum(value);
  if (status === "..." || status === "..") return "salassa (...)";
  return "ei tietoa";
}
