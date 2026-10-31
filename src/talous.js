// Hintaindeksit (Tilastokeskus) ja korot (Euroopan keskuspankki, korkolaki).
//
// Kuluttajahintaindeksi ja elinkustannusindeksi: Tilastokeskuksen PxWeb-rajapinta,
// taulukot StatFin/khi (CC BY 4.0, lähde Tilastokeskus).
// EKP:n ohjauskorot: EKP:n tietoportaalin rajapinta (data-api.ecb.europa.eu), sarjat
// FM.B.U2.EUR.4F.KR.{MRR_FR,DFR,MLFR}.LEV (muutospäivät). EKP:n tilastojen uudelleenkäyttö
// on maksutonta, kun lähde mainitaan eikä tietoja muuteta.
// Korkolain (633/1982) viitekorko (12 §) lasketaan EKP:n perusrahoitusoperaatioiden korosta:
// viimeisin korko ennen puolivuotiskauden ensimmäistä päivää pyöristettynä ylöspäin
// seuraavaan puoleen prosenttiyksikköön. Viivästyskorko = viitekorko + 7 (4 §),
// kaupallisissa sopimuksissa + 8 prosenttiyksikköä (4 a §).
// Euribor ei ole mukana: EKP:n Euribor-sarjat ovat Refinitivin toimittamaa kolmannen
// osapuolen dataa, jonka uudelleenkäyttö vaatii tuottajan luvan.

import { fetchJson, HttpError } from "./http.js";

const KHI = "https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi";
const ECB = "https://data-api.ecb.europa.eu/service/data/FM";
const DAY = 86400;

// ---------- Hintaindeksit ----------

/** Indeksisarjat: kuukausitaulukko, vuositaulukko ja niiden valinnat. */
const SERIES = {
  khi: {
    name: "Kuluttajahintaindeksi",
    bases: ["2025", "2015", "2010", "2005", "2000", "1995", "1990", "1985", "1981", "1977", "1972"],
    defaultBase: "2015",
    monthly: (base) => ({ table: "11xs.px", query: [{ code: "contentscode", selection: { filter: "item", values: [`ip_0_${base}`] } }] }),
    // Vuositaulukossa ei ole perusvuotta 2025 (vuoden 2025 keskiarvo on määritelmän mukaan 100).
    yearly: (base) => (base === "2025" ? null : { table: "11xt.px", query: [{ code: "indeksisarja_1_20160101", selection: { filter: "item", values: [`0_${base}`] } }] }),
    label: (base) => `kuluttajahintaindeksi ${base}=100`,
  },
  elinkustannus: {
    name: "Elinkustannusindeksi",
    bases: ["1951:10"],
    defaultBase: "1951:10",
    monthly: () => ({ table: "11xl.px", query: [] }),
    yearly: () => ({ table: "11xm.px", query: [] }),
    label: () => "elinkustannusindeksi 1951:10=100",
  },
};

export function seriesInfo(kind, base) {
  const s = SERIES[kind];
  if (!s) return null;
  const b = base ? String(base).trim().replace(/=100$/, "") : s.defaultBase;
  if (!s.bases.includes(b)) return { error: `${s.name}: perusvuosi ${b} ei ole saatavilla. Vaihtoehdot: ${s.bases.join(", ")}.` };
  return { kind, base: b, name: s.name, label: s.label(b) };
}

// Sarja luetaan kokonaan (enintään ~900 kuukautta) ja pidetään välimuistissa vuorokauden.
async function querySeries(table, query, budget) {
  const ds = await fetchJson(`${KHI}/${table}`, { method: "POST", body: { query, response: { format: "json-stat2" } }, ttl: DAY, budget });
  if (!ds) throw new HttpError(`Tilastokeskuksen taulukkoa ${table} ei löytynyt`, 404);
  const timeDim = ds.id.find((d) => d.startsWith("timeperiod"));
  const idx = ds.dimension[timeDim].category.index;
  const out = new Map();
  for (const [period, i] of Object.entries(idx)) {
    const v = ds.value[i];
    if (v !== null && v !== undefined) out.set(period, v);
  }
  return { values: out, updated: ds.updated ?? null };
}

/** Kuukausisarja (avain "2026M09") tai vuosisarja (avain "2025"). null, jos vuositaulukkoa ei ole. */
export async function indexSeries(info, yearly, budget) {
  const s = SERIES[info.kind];
  const spec = yearly ? s.yearly(info.base) : s.monthly(info.base);
  if (!spec) return null;
  return querySeries(spec.table, spec.query, budget);
}

/** Kuluttajahintaindeksin virallinen vuosimuutos (%) kuukausittain (taulukko 122p). */
export async function khiAnnualChange(budget) {
  return querySeries("122p.px", [], budget);
}

/** "2026-09", "9/2026", "2026M09" → "2026M09"; "2025" → "2025". null, jos ei kelpaa. */
export function parsePeriod(s) {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{4})[-/.M](\d{1,2})$/i);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}M${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}M${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})$/);
  return m ? m[1] : null;
}

export const periodLabel = (p) => {
  const m = String(p).match(/^(\d{4})M(\d{2})$/);
  return m ? `${+m[2]}/${m[1]}` : String(p);
};

/** Edellinen vuosi samasta kuukaudesta: "2026M09" → "2025M09". */
export const yearBefore = (p) => {
  const m = String(p).match(/^(\d{4})M(\d{2})$/);
  return m ? `${+m[1] - 1}M${m[2]}` : String(+p - 1);
};

// ---------- Korot ----------

async function fetchCsv(url, ttl) {
  const cache = (() => {
    try {
      return typeof caches !== "undefined" && caches.default ? caches.default : null;
    } catch {
      return null;
    }
  })();
  const key = new Request(url);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return await hit.text();
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "text/csv", "User-Agent": "aluetieto-mcp/1.0 (Claude-liitin; Cloudflare Worker)" } });
      if (res.ok) {
        const text = await res.text();
        if (cache) await cache.put(key, new Response(text, { headers: { "Content-Type": "text/csv", "Cache-Control": `max-age=${ttl}` } }));
        return text;
      }
      last = new HttpError(`EKP:n rajapinta vastasi ${res.status}`, res.status);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = new HttpError(`EKP:n rajapintaan ei saatu yhteyttä: ${e?.message ?? e}`, 0);
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw last;
}

/** Muutospäivät ja tasot: [{ date: "2026-09-16", value: 2.65 }] vanhimmasta uusimpaan. */
async function rateChanges(code) {
  const text = await fetchCsv(`${ECB}/B.U2.EUR.4F.KR.${code}.LEV?format=csvdata&detail=dataonly&startPeriod=1999-01-01`, 6 * 3600);
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(",");
  const iT = head.indexOf("TIME_PERIOD");
  const iV = head.indexOf("OBS_VALUE");
  const out = [];
  for (const l of lines) {
    const c = l.split(",");
    const v = Number(c[iV]);
    if (c[iT] && Number.isFinite(v)) out.push({ date: c[iT], value: v });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export async function ecbRates() {
  const [mro, dfr, mlf] = await Promise.all([rateChanges("MRR_FR"), rateChanges("DFR"), rateChanges("MLFR")]);
  return { mro, dfr, mlf };
}

/** Korko päivänä d (ISO): viimeisin muutos, jonka päivä on <= d. */
export function rateOn(changes, d) {
  let r = null;
  for (const c of changes) {
    if (c.date <= d) r = c;
    else break;
  }
  return r;
}

// Kiinteäkorkoiset perusrahoitusoperaatiot alkoivat 15.10.2008; sitä ennen sovellettiin
// vaihtuvakorkoisia huutokauppoja (minimitarjouskorko), joita tämä laskenta ei kata.
export const FIRST_REFERENCE_PERIOD = "2009-01-01";

/**
 * Korkolain 12 §:n viitekorko puolivuotiskaudelle, joka alkaa päivänä start ("2026-07-01").
 * Viimeisin perusrahoitusoperaatioiden korko ennen kauden ensimmäistä päivää,
 * pyöristettynä ylöspäin seuraavaan puoleen prosenttiyksikköön.
 */
export function referenceRate(mro, start) {
  let r = null;
  for (const c of mro) {
    if (c.date < start) r = c;
    else break;
  }
  if (!r) return null;
  // Pyöristys ylöspäin 0,5:n tarkkuuteen; liukulukuvirheen välttämiseksi sadasosina.
  const hundredths = Math.round(r.value * 100);
  const rounded = Math.ceil(hundredths / 50) * 50;
  return { rate: rounded / 100, mro: r.value, mroDate: r.date };
}

/** Puolivuotiskauden alkupäivä päivälle d: "2026-10-31" → "2026-07-01". */
export function periodStart(d) {
  const [y, m] = d.split("-").map(Number);
  return `${y}-${m >= 7 ? "07" : "01"}-01`;
}

export function periodEnd(start) {
  const [y, m] = start.split("-").map(Number);
  return m === 7 ? `${y}-12-31` : `${y}-06-30`;
}
