// Tilastokeskuksen StatFin-tietokanta (PxWeb API v1), lisenssi CC BY 4.0, lähde Tilastokeskus.
// Haku: GET /StatFin?query=…, taulukon rakenne: GET /StatFin/{alue}/{taulukko}.px,
// kysely: POST samaan osoitteeseen (json-stat2). Rajapinta rajoittaa pyyntöjen määrää
// (n. 10 pyyntöä / 10 s / IP), joten vastaukset välimuistitetaan.

import { fetchJson, HttpError } from "./http.js";

const BASE = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin";
export const STATFIN_SOURCE = "Lähde: Tilastokeskus, StatFin (CC BY 4.0)";
export const MAX_CELLS = 3000;

export async function searchTables(q, budget) {
  const query = String(q).trim().split(/\s+/).map(encodeURIComponent).join("+");
  const res = await fetchJson(`${BASE}?query=${query}`, { ttl: 86400, budget });
  return (res ?? []).map((x) => ({
    id: `${String(x.path ?? "").replace(/^\//, "")}/${String(x.id ?? "").replace(/\.px$/, "")}`,
    title: String(x.title ?? "").replace(/^\S+\s+--\s+/, ""),
    published: x.published ?? null,
    score: x.score ?? 0,
  }));
}

/** "tyti/135z" tai "tyti/135z.px" tai "statfin_tyti_pxt_135z.px" → { area, table }. */
export function parseTableId(v) {
  const s = String(v ?? "").trim().replace(/^\/+/, "");
  let m = s.match(/^([a-z0-9_]+)\/([a-z0-9_]+?)(?:\.px)?$/i);
  if (m) return { area: m[1].toLowerCase(), table: m[2].toLowerCase() };
  m = s.match(/^statfin_([a-z0-9]+)_pxt_([a-z0-9]+)(?:\.px)?$/i);
  if (m) return { area: m[1].toLowerCase(), table: m[2].toLowerCase() };
  return null;
}

const tableUrl = ({ area, table }) => `${BASE}/${area}/${table}.px`;

export async function tableMeta(id, budget) {
  const res = await fetchJson(tableUrl(id), { ttl: 86400, budget });
  if (!res?.variables) return null;
  return {
    title: res.title,
    variables: res.variables.map((v) => ({
      code: v.code,
      text: v.text,
      values: v.values,
      texts: v.valueTexts,
      elimination: !!v.elimination,
      time: !!v.time,
    })),
  };
}

const fold = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Valinnat: { muuttuja (koodi tai nimi): arvot }, arvo on koodi tai teksti, "*" = kaikki,
 * "viimeisin" / "viimeiset N" = aikamuuttujan viimeiset. Muuttujat, joita ei anneta:
 * aika = viimeisin, eliminoitava = jätetään pois (summa), muut = ensimmäinen arvo.
 * Palauttaa { query, chosen: [{ v, codes }], notes }.
 */
export function buildQuery(meta, selections = {}) {
  const notes = [];
  const sel = new Map();
  for (const [k, raw] of Object.entries(selections ?? {})) {
    const v = meta.variables.find((x) => fold(x.code) === fold(k) || fold(x.text) === fold(k));
    if (!v) throw new Error(`Muuttujaa "${k}" ei ole taulukossa. Muuttujat: ${meta.variables.map((x) => `${x.code} (${x.text})`).join(", ")}.`);
    sel.set(v.code, raw);
  }
  const chosen = [];
  for (const v of meta.variables) {
    let codes;
    if (sel.has(v.code)) {
      const raw = sel.get(v.code);
      const list = Array.isArray(raw) ? raw : [raw];
      codes = [];
      for (const item of list) {
        const s = String(item).trim();
        const last = s.match(/^viimei(?:nen|sin|set)(?:\s+(\d+))?$/i);
        if (s === "*") codes.push(...v.values);
        else if (last) codes.push(...v.values.slice(-(Number(last[1]) || 1)));
        else {
          const i = v.values.findIndex((c) => fold(c) === fold(s));
          const j = i >= 0 ? i : v.texts.findIndex((t) => fold(t) === fold(s));
          const k = j >= 0 ? j : v.texts.findIndex((t) => fold(t).includes(fold(s)));
          if (k < 0) throw new Error(`Muuttujalla ${v.code} (${v.text}) ei ole arvoa "${s}". Katso arvot tilaston_rakenne-työkalulla.`);
          codes.push(v.values[k]);
        }
      }
      codes = [...new Set(codes)];
    } else if (v.time) {
      codes = v.values.slice(-1);
      notes.push(`${v.text}: viimeisin (${v.texts.at(-1)})`);
    } else if (v.elimination) {
      continue;
    } else {
      codes = v.values.slice(0, 1);
      if (v.values.length > 1) notes.push(`${v.text}: ${v.texts[0]} (ensimmäinen arvo; valitse muut valinnat-parametrilla)`);
    }
    chosen.push({ v, codes });
  }
  const cells = chosen.reduce((a, c) => a * c.codes.length, 1);
  if (cells > MAX_CELLS) throw new Error(`Kysely tuottaisi ${cells} solua (enintään ${MAX_CELLS}). Rajaa valintoja.`);
  return {
    query: { query: chosen.map(({ v, codes }) => ({ code: v.code, selection: { filter: "item", values: codes } })), response: { format: "json-stat2" } },
    chosen,
    notes,
    cells,
  };
}

export async function runQuery(id, query, budget) {
  const ds = await fetchJson(tableUrl(id), { method: "POST", body: query, ttl: 86400, budget });
  if (!ds?.value) throw new HttpError("Tilastokeskus ei palauttanut tuloksia", 0);
  return ds;
}

/** json-stat2 → rivit: [{ labels: [..], value, status }] sekä ulottuvuuksien otsikot. */
export function rowsOf(ds) {
  const dims = ds.id.map((d) => {
    const cat = ds.dimension[d].category;
    const order = Object.entries(cat.index).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    return { id: d, label: ds.dimension[d].label, codes: order, labels: order.map((k) => cat.label?.[k] ?? k), unit: cat.unit ?? null };
  });
  const sizes = ds.size;
  const total = sizes.reduce((a, b) => a * b, 1);
  const rows = [];
  for (let i = 0; i < total; i++) {
    let rem = i;
    const idx = new Array(sizes.length);
    for (let d = sizes.length - 1; d >= 0; d--) {
      idx[d] = rem % sizes[d];
      rem = Math.floor(rem / sizes[d]);
    }
    const value = Array.isArray(ds.value) ? ds.value[i] : ds.value?.[i] ?? null;
    const status = ds.status ? (Array.isArray(ds.status) ? ds.status[i] : ds.status[i]) : null;
    rows.push({ labels: idx.map((k, d) => dims[d].labels[k]), value, status });
  }
  return { dims, rows };
}
