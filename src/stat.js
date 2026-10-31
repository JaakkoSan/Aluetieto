// Tilastokeskuksen PxWeb-rajapinta: Paavo (postinumeroalueittainen avoin tieto)
// ja yritysten toimipaikat maakunnittain ja toimialoittain.

import { fetchJson } from "./http.js";

const PX = "https://pxdata.stat.fi/PxWeb/api/v1/fi";
const PAAVO = `${PX}/Postinumeroalueittainen_avoin_tieto/uusin`;
const TOIMIPAIKAT = `${PX}/StatFin/alyr/13ww.px`;

const DAY = 86400;

// Käsitelty metatieto (taulukkoluettelo, postinumerot, toimialaluettelo) pidetään
// isolaatin muistissa vuorokauden. Sama metatieto luetaan yhdessä kutsussa useaan
// kertaan, ja sen läpikäynti (esim. noin 3 000 postinumeroa) on Workersin
// ilmaistason CPU-rajaan (10 ms) nähden kallista. Virheitä eikä keep-ehdon
// hylkäämiä (esim. puuttuvia) tuloksia tallenneta.
const memo = new Map();
async function memoized(key, build, keep = () => true) {
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await build();
  if (keep(value)) memo.set(key, { value, exp: Date.now() + DAY * 1000 });
  return value;
}

// ---------- Paavo ----------

/** Etsii Paavon taulukot otsikon alun perusteella (tunnukset vaihtuvat vuosittain). */
async function paavoTables(budget) {
  return memoized("paavo:tables", () => buildPaavoTables(budget), (t) => t.asukasrakenne && t.tulot);
}

async function buildPaavoTables(budget) {
  const list = await fetchJson(PAAVO, { ttl: DAY, budget });
  const find = (prefix) => (list ?? []).find((t) => String(t.text).includes(prefix))?.id ?? null;
  return {
    asukasrakenne: find("1. Asukasrakenne"),
    tulot: find("3. Asukkaiden käytettävissä olevat rahatulot"),
  };
}

async function tableMeta(id, budget) {
  return memoized(`paavo:${id}`, () => buildTableMeta(id, budget));
}

async function buildTableMeta(id, budget) {
  const meta = await fetchJson(`${PAAVO}/${id}`, { ttl: DAY, budget });
  if (!meta) throw new Error(`Paavon taulukkoa ${id} ei löytynyt.`);
  const pVar = meta.variables.find((v) => /postinumero/i.test(v.text));
  const yVar = meta.variables.find((v) => v.code === "timeperiod_y" || /vuosi/i.test(v.text));
  const cVar = meta.variables.find((v) => v.code === "contentscode");
  let areas = null;
  const value = {
    postVar: pVar.code,
    yearVar: yVar.code,
    years: yVar.values,
    contents: Object.fromEntries(cVar.values.map((c, i) => [c, cVar.valueTexts[i]])),
    // Postinumeroalueet puretaan vasta tarvittaessa (tulotaulukolla niitä ei tarvita).
    get areas() {
      if (!areas) {
        areas = new Map();
        pVar.values.forEach((code, i) => {
          const text = pVar.valueTexts[i];
          const m = text.match(/^\S+\s+(.*?)\s*\(([^)]+)\)\s*$/);
          areas.set(code, { code, name: m ? m[1].trim() : text, kunta: m ? m[2].trim() : null });
        });
      }
      return areas;
    },
  };
  return value;
}

/** Postinumeroalueet (koodi, nimi, kunta). */
export async function postAreas(budget) {
  const t = await paavoTables(budget);
  const m = await tableMeta(t.asukasrakenne, budget);
  return { areas: m.areas, latestYear: m.years[m.years.length - 1] };
}

export function areasOfMunicipality(areas, kunta) {
  const k = String(kunta).trim().toLowerCase();
  return [...areas.values()].filter((a) => a.kunta && a.kunta.toLowerCase() === k);
}

function parseJsonStat(ds) {
  // Palauttaa { [alue]: { [sisältö]: arvo } } kahdelle ensimmäiselle ulottuvuudelle (alue, sisältö), vuosi = 1.
  const ids = ds.id;
  const sizes = ds.size;
  const cats = ids.map((id) => {
    const idx = ds.dimension[id].category.index;
    return Array.isArray(idx) ? idx : Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
  });
  const out = {};
  const total = sizes.reduce((a, b) => a * b, 1);
  for (let i = 0; i < total; i++) {
    let rem = i;
    const coord = [];
    for (let d = ids.length - 1; d >= 0; d--) {
      coord[d] = rem % sizes[d];
      rem = Math.floor(rem / sizes[d]);
    }
    const area = cats[0][coord[0]];
    const content = cats[1][coord[1]];
    out[area] ??= {};
    const v = ds.value[i];
    out[area][content] = v === null || v === undefined ? null : v;
  }
  return out;
}

async function queryPaavo(tableId, meta, codes, contents, year, budget) {
  const body = {
    query: [
      { code: meta.postVar, selection: { filter: "item", values: codes } },
      { code: "contentscode", selection: { filter: "item", values: contents } },
      { code: meta.yearVar, selection: { filter: "item", values: [year] } },
    ],
    response: { format: "json-stat2" },
  };
  const ds = await fetchJson(`${PAAVO}/${tableId}`, { method: "POST", body, ttl: 7 * DAY, budget });
  return ds ? parseJsonStat(ds) : {};
}

const AGE_CONTENTS = [
  "he_vakiy", "he_naiset", "he_miehet", "he_kika",
  "he_0_2", "he_3_6", "he_7_12", "he_13_15", "he_16_17",
  "he_18_19", "he_20_24", "he_25_29", "he_30_34", "he_35_39", "he_40_44", "he_45_49",
  "he_50_54", "he_55_59", "he_60_64",
  "he_65_69", "he_70_74", "he_75_79", "he_80_84", "he_85_",
];

/**
 * Väestö ja tulot postinumeroalueittain.
 * Palauttaa { year, rows: [{ code, name, kunta, total, women, men, avgAge, age0_17, age18_64, age65p, age75p, medianIncome }] }
 */
export async function population(codes, { year, budget } = {}) {
  const t = await paavoTables(budget);
  const meta = await tableMeta(t.asukasrakenne, budget);
  const y = year && meta.years.includes(String(year)) ? String(year) : meta.years[meta.years.length - 1];
  const valid = codes.filter((c) => meta.areas.has(c));
  const unknown = codes.filter((c) => !meta.areas.has(c));
  if (!valid.length) return { year: y, rows: [], unknown };

  const pop = await queryPaavo(t.asukasrakenne, meta, valid, AGE_CONTENTS, y, budget);
  let income = {};
  if (t.tulot) {
    try {
      const tm = await tableMeta(t.tulot, budget);
      const ty = tm.years.includes(y) ? y : tm.years[tm.years.length - 1];
      income = await queryPaavo(t.tulot, tm, valid, ["hr_mtu"], ty, budget);
    } catch {
      income = {};
    }
  }
  const sum = (o, keys) => {
    let s = 0;
    for (const k of keys) {
      if (o[k] === null || o[k] === undefined) return null;
      s += o[k];
    }
    return s;
  };
  const rows = valid.map((code) => {
    const a = meta.areas.get(code);
    const p = pop[code] ?? {};
    return {
      code,
      name: a.name,
      kunta: a.kunta,
      total: p.he_vakiy ?? null,
      women: p.he_naiset ?? null,
      men: p.he_miehet ?? null,
      avgAge: p.he_kika ?? null,
      age0_17: sum(p, ["he_0_2", "he_3_6", "he_7_12", "he_13_15", "he_16_17"]),
      age18_64: sum(p, ["he_18_19", "he_20_24", "he_25_29", "he_30_34", "he_35_39", "he_40_44", "he_45_49", "he_50_54", "he_55_59", "he_60_64"]),
      age65p: sum(p, ["he_65_69", "he_70_74", "he_75_79", "he_80_84", "he_85_"]),
      age75p: sum(p, ["he_75_79", "he_80_84", "he_85_"]),
      medianIncome: income[code]?.hr_mtu ?? null,
    };
  });
  return { year: y, rows, unknown };
}

// ---------- Toimipaikat maakunnittain (kaikki yritykset, myös toiminimet) ----------

async function toimipaikatMeta(budget) {
  return memoized("toimipaikat", () => buildToimipaikatMeta(budget));
}

async function buildToimipaikatMeta(budget) {
  const meta = await fetchJson(TOIMIPAIKAT, { ttl: DAY, budget });
  if (!meta) throw new Error("Toimipaikkataulukkoa ei löytynyt.");
  const v = (pred) => meta.variables.find(pred);
  const area = v((x) => /maakunta/i.test(x.text));
  const ind = v((x) => /toimiala/i.test(x.text));
  const year = v((x) => x.code === "timeperiod_y");
  return {
    title: meta.title,
    areaVar: area.code,
    indVar: ind.code,
    indLabel: ind.text,
    yearVar: year.code,
    years: year.values,
    regions: area.values.map((c, i) => ({ code: c, name: area.valueTexts[i].replace(/^MK\d+\s*/, "") })),
    industries: ind.values.map((c, i) => ({ code: c, name: ind.valueTexts[i] })),
  };
}

export async function establishmentsMeta(budget) {
  return toimipaikatMeta(budget);
}

/** Toimipaikkojen lukumäärä ja henkilöstö. Hakee viimeisimmän vuoden, jolle on dataa. */
export async function establishments(regionCodes, industryCodes, { budget } = {}) {
  const meta = await toimipaikatMeta(budget);
  const years = [...meta.years].reverse().slice(0, 3);
  for (const y of years) {
    const body = {
      query: [
        { code: meta.areaVar, selection: { filter: "item", values: regionCodes } },
        { code: meta.indVar, selection: { filter: "item", values: industryCodes } },
        { code: "contentscode", selection: { filter: "item", values: ["Tplukumaara2", "henkmaara2"] } },
        { code: meta.yearVar, selection: { filter: "item", values: [y] } },
      ],
      response: { format: "json-stat2" },
    };
    const ds = await fetchJson(TOIMIPAIKAT, { method: "POST", body, ttl: 7 * DAY, budget });
    if (!ds) continue;
    if (ds.value.every((x) => x === null)) continue;
    // Ulottuvuudet: vuosi, alue, toimiala, sisältö
    const idIdx = (name) => ds.id.indexOf(name);
    const order = ds.id;
    const cats = order.map((id) => {
      const idx = ds.dimension[id].category.index;
      return Array.isArray(idx) ? idx : Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
    });
    const res = [];
    const total = ds.size.reduce((a, b) => a * b, 1);
    for (let i = 0; i < total; i++) {
      let rem = i;
      const coord = [];
      for (let d = order.length - 1; d >= 0; d--) {
        coord[d] = rem % ds.size[d];
        rem = Math.floor(rem / ds.size[d]);
      }
      res.push({
        region: cats[idIdx(meta.areaVar)][coord[idIdx(meta.areaVar)]],
        industry: cats[idIdx(meta.indVar)][coord[idIdx(meta.indVar)]],
        content: cats[idIdx("contentscode")][coord[idIdx("contentscode")]],
        value: ds.value[i],
      });
    }
    return { year: y, rows: res, meta };
  }
  return { year: null, rows: [], meta };
}
