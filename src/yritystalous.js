// Yritysten taloustiedot:
// 1) PRH:n digitaaliset tilinpäätökset (avoin data, CC BY 4.0): tuloslaskelma ja tase niiltä
//    yrityksiltä, jotka ovat ilmoittaneet tilinpäätöksen iXBRL-muodossa. Rajapinta
//    https://avoindata.prh.fi/opendata-xbrl-api/v3 (kuvaus /schema?lang=fi). Nimikkeet SBR-taksonomiasta.
// 2) Verohallinnon yhteisöjen tuloverotuksen julkiset tiedot (avoin data, CC BY 4.0): verotettava tulo,
//    maksuunpannut verot, veronpalautus ja jäännösvero yhteisöittäin, vuosittaiset CSV-tiedostot
//    (https://www.vero.fi/avoindata) ladataan ajastetusti D1-kantaan (EU-lainkäyttöalue).

import { fetchJson, HttpError } from "./http.js";
import { MC_LABELS } from "./sbrLabels.js";

const XBRL = "https://avoindata.prh.fi/opendata-xbrl-api/v3";
const USER_AGENT = "aluetieto-mcp/1.3 (Claude-liitin; Cloudflare Worker)";

// ---------- PRH: digitaaliset tilinpäätökset ----------

/** Tilikaudet, joista on digitaalinen tilinpäätös: [{ date, registered }], uusin ensin. */
export async function financialPeriods(ytunnus, budget) {
  const d = await fetchJson(`${XBRL}/financials?businessId=${encodeURIComponent(ytunnus)}`, { ttl: 86400, budget });
  return (d?.financials ?? []).map((f) => ({ date: f.financialDate, registered: f.registrationDate ?? null })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function fetchXml(url) {
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
    if (hit) return hit.status === 404 ? null : await hit.text();
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/xml" } }).catch((e) => ({ ok: false, status: 0, err: e }));
    if (res.status === 404 || res.status === 400) return null;
    if (res.ok) {
      const text = await res.text();
      if (cache) await cache.put(key, new Response(text, { headers: { "Content-Type": "text/xml", "Cache-Control": "max-age=2592000" } }));
      return text;
    }
    last = new HttpError(`PRH:n tilinpäätösrajapinta vastasi ${res.status}`, res.status);
    if (res.status && res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
  }
  throw last;
}

/**
 * Tilinpäätöksen tiedot: { name, start, end, cur: { pl: {code: v}, bs: {code: v} }, prev: {...} }.
 * md103 = tilikauden kertymä (tuloslaskelma), mi53 = kirjanpitoarvo (tase). REF-ulottuvuus = vertailuvuosi.
 */
export async function financialStatement(ytunnus, date) {
  const xml = await fetchXml(`${XBRL}/financial?businessId=${encodeURIComponent(ytunnus)}&financialDate=${encodeURIComponent(date)}`);
  if (!xml) return null;
  const ctx = new Map();
  for (const m of xml.matchAll(/<context id="([^"]+)">([\s\S]*?)<\/context>/g)) {
    const dims = {};
    for (const d of m[2].matchAll(/dimension="([^"]+)">([^<]+)</g)) dims[d[1]] = d[2].trim();
    ctx.set(m[1], dims);
  }
  const out = { name: null, start: null, end: null, cur: { pl: {}, bs: {} }, prev: { pl: {}, bs: {} } };
  for (const m of xml.matchAll(/<fi_met:(\w+)\s+([^>]*?)(?:\/>|>([^<]*)<\/fi_met:\1>)/g)) {
    const [, metric, attrs, raw] = m;
    const value = (raw ?? "").trim();
    if (metric === "si168") out.name = value;
    else if (metric === "di120") out.start = value;
    else if (metric === "di121") out.end = value;
    if (metric !== "md103" && metric !== "mi53") continue;
    const ref = attrs.match(/contextRef="([^"]+)"/)?.[1];
    const dims = ctx.get(ref) ?? {};
    const code = String(dims["fi_dim:MCY"] ?? "").replace(/^fi_MC:/, "");
    const n = Number(value);
    if (!code || !Number.isFinite(n)) continue;
    const bucket = dims["fi_dim:REF"] ? out.prev : out.cur;
    bucket[metric === "md103" ? "pl" : "bs"][code] = n;
  }
  return out;
}

export const mcLabel = (code) => MC_LABELS[code] ?? code;

// Keskeiset rivit esitysjärjestyksessä (etumerkkikäytäntö päätellään tools.js:ssä tilinpäätöskohtaisesti).
export const PL_MAIN = ["x673", "x49", "x758", "x5", "x6", "x448", "x1869", "x689", "x12", "x738", "x350", "x541", "x740"];
export const BS_MAIN = ["x513", "x435", "x399", "x360", "x376", "x4116", "x932", "x2895", "x424", "x1830", "x1811", "x481"];

// ---------- Verohallinto: yhteisöjen tuloverotuksen julkiset tiedot ----------

const VERO_PAGE = "https://www.vero.fi/tietoa-verohallinnosta/tilastot/avoin_dat/";
const VERO_HOST = "https://www.vero.fi";
const VERO_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS vero (vuosi INTEGER NOT NULL, ytunnus TEXT NOT NULL, nimi TEXT, kunta_nro TEXT, kunta TEXT, tulo REAL, verot REAL, palautus REAL, jaannos REAL, PRIMARY KEY (vuosi, ytunnus))",
  "CREATE INDEX IF NOT EXISTS vero_ytunnus ON vero (ytunnus)",
  "CREATE INDEX IF NOT EXISTS vero_kunta ON vero (kunta_nro, vuosi, verot)",
  "CREATE TABLE IF NOT EXISTS vero_muutos (vuosi INTEGER NOT NULL, ytunnus TEXT NOT NULL, muutos INTEGER NOT NULL, nimi TEXT, kunta_nro TEXT, kunta TEXT, tulo REAL, verot REAL, palautus REAL, jaannos REAL, PRIMARY KEY (vuosi, ytunnus, muutos))",
  "CREATE TABLE IF NOT EXISTS vero_files (url TEXT PRIMARY KEY, kind TEXT, vuosi INTEGER, etag TEXT, modified TEXT, rows INTEGER, loaded_at TEXT, status TEXT)",
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)",
];
const RECHECK_HOURS = 24;
const ROWS_PER_STMT = 900;
const MAX_STMT_CHARS = 90_000;

// Windows-1252 / ISO-8859-1 -tekstin purku (Verohallinnon CSV:t ovat ISO-8859-merkistössä).
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
export function decode1252(bytes) {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(bytes.length, i + CHUNK);
    let s = "";
    for (let j = i; j < end; j++) {
      const b = bytes[j];
      s += b >= 0x80 && b < 0xa0 ? CP1252[b - 0x80] : String.fromCharCode(b);
    }
    out += s;
  }
  return out;
}

const num = (s) => {
  const n = Number(String(s ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** CSV-rivi → kentät. Verohallinnon tiedostoissa ei käytetä lainausmerkkejä kenttien ympärillä. */
export function parseVeroLine(line, withChange) {
  const f = line.split(";");
  if (f.length < (withChange ? 9 : 8)) return null;
  const vuosi = Number(f[0]);
  if (!Number.isInteger(vuosi) || !/^\d{7}-\d$/.test(f[1].trim())) return null;
  const k = f[3].trim().match(/^(\d{3})\s+(.*)$/);
  return {
    vuosi,
    ytunnus: f[1].trim(),
    nimi: f[2].trim(),
    kunta_nro: k ? k[1] : null,
    kunta: k ? k[2] : f[3].trim(),
    tulo: num(f[4]),
    verot: num(f[5]),
    palautus: num(f[6]),
    jaannos: num(f[7]),
    muutos: withChange ? Number(f[8]) || 0 : null,
  };
}

const sqlStr = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sqlNum = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "NULL" : String(n));

async function ensureVeroSchema(db) {
  await db.batch(VERO_SCHEMA.map((s) => db.prepare(s)));
}

/** Verohallinnon avoimen datan sivun CSV-linkit: [{ url, kind: "vuosi" | "muutos" }]. */
async function veroLinks() {
  const res = await fetch(VERO_PAGE, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
  if (!res.ok) throw new Error(`vero.fi ${res.status}`);
  const html = await res.text();
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="([^"]+\.csv)"/gi)) {
    const href = m[1].startsWith("http") ? m[1] : VERO_HOST + m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const name = decodeURIComponent(href.split("/").pop()).toLowerCase();
    if (/muutosverot/.test(name)) out.push({ url: href, kind: "muutos" });
    else if (/yhteis[oö]|tuloverot/.test(name)) out.push({ url: href, kind: "vuosi" });
  }
  return out;
}

/**
 * Yksi päivitysaskel: tarkistaa vuorokauden välein Verohallinnon tiedostot ja lataa enintään
 * yhden uuden tai muuttuneen tiedoston. Palauttaa kuvauksen lokia varten.
 */
export async function veroStep(db) {
  await ensureVeroSchema(db);
  const checked = await db.prepare("SELECT value FROM meta WHERE key = 'vero_checked'").first("value");
  const pending = await db.prepare("SELECT url, kind FROM vero_files WHERE status = 'pending' ORDER BY url LIMIT 1").first();
  if (!pending) {
    if (checked && checked > new Date(Date.now() - RECHECK_HOURS * 3600_000).toISOString()) return "ei tehtävää";
    const links = await veroLinks();
    const known = new Map((await db.prepare("SELECT url, etag, modified, status FROM vero_files").all()).results.map((r) => [r.url, r]));
    const stmts = [];
    for (const l of links) {
      const head = await fetch(l.url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
      if (!head.ok) continue;
      const etag = head.headers.get("etag");
      const modified = head.headers.get("last-modified");
      const k = known.get(l.url);
      if (!k || k.status !== "ok" || k.etag !== etag || k.modified !== modified) {
        stmts.push(
          db
            .prepare("INSERT INTO vero_files (url, kind, etag, modified, status) VALUES (?, ?, ?, ?, 'pending') ON CONFLICT(url) DO UPDATE SET kind = excluded.kind, etag = excluded.etag, modified = excluded.modified, status = 'pending'")
            .bind(l.url, l.kind, etag, modified),
        );
      }
    }
    stmts.push(db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('vero_checked', ?)").bind(new Date().toISOString()));
    await db.batch(stmts);
    return `tiedostot tarkistettu, ladattavia ${stmts.length - 1}`;
  }
  return loadVeroFile(db, pending.url, pending.kind);
}

const BATCH_STMTS = 10;

/**
 * Lataa tiedoston virtana (27 Mt ei mahdu muistiin riveinä): rivit kootaan monirivisiksi
 * INSERT-lauseiksi ja ajetaan D1:een kymmenen lauseen erissä. Vuoden vanhat rivit poistetaan
 * ensin; jos lataus keskeytyy, tiedosto jää tilaan 'pending' ja seuraava ajo lataa sen alusta.
 */
async function loadVeroFile(db, url, kind) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`vero.fi ${res.status} ${url}`);
  const withChange = kind === "muutos";
  const table = withChange ? "vero_muutos" : "vero";
  const head = withChange
    ? "INSERT OR REPLACE INTO vero_muutos (vuosi, ytunnus, muutos, nimi, kunta_nro, kunta, tulo, verot, palautus, jaannos) VALUES "
    : "INSERT OR REPLACE INTO vero (vuosi, ytunnus, nimi, kunta_nro, kunta, tulo, verot, palautus, jaannos) VALUES ";
  const years = new Set();
  let deleted = false;
  let count = 0;
  let statements = 0;
  let buf = [];
  let len = 0;
  let pend = [];

  const runPending = async (force) => {
    if (pend.length && (force || pend.length >= BATCH_STMTS)) {
      await db.batch(pend);
      statements += pend.length;
      pend = [];
    }
  };
  const flushRows = async () => {
    if (!buf.length) return;
    pend.push(db.prepare(head + buf.join(",")));
    buf = [];
    len = 0;
    await runPending(false);
  };
  const handle = async (line) => {
    const r = parseVeroLine(line, withChange);
    if (!r) return;
    if (!years.has(r.vuosi)) {
      years.add(r.vuosi);
      // Ennen ensimmäistä lisäystä kyseisen vuoden vanhat rivit pois.
      await flushRows();
      await runPending(true);
      await db.prepare(`DELETE FROM ${table} WHERE vuosi = ?`).bind(r.vuosi).run();
      deleted = true;
    }
    const v = withChange
      ? `(${r.vuosi},${sqlStr(r.ytunnus)},${r.muutos},${sqlStr(r.nimi)},${sqlStr(r.kunta_nro)},${sqlStr(r.kunta)},${sqlNum(r.tulo)},${sqlNum(r.verot)},${sqlNum(r.palautus)},${sqlNum(r.jaannos)})`
      : `(${r.vuosi},${sqlStr(r.ytunnus)},${sqlStr(r.nimi)},${sqlStr(r.kunta_nro)},${sqlStr(r.kunta)},${sqlNum(r.tulo)},${sqlNum(r.verot)},${sqlNum(r.palautus)},${sqlNum(r.jaannos)})`;
    if (buf.length >= ROWS_PER_STMT || len + v.length > MAX_STMT_CHARS) await flushRows();
    buf.push(v);
    len += v.length + 1;
    count++;
  };

  const reader = res.body.getReader();
  let carry = "";
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parts = (carry + decode1252(value)).split(/\r?\n/);
    carry = parts.pop();
    for (const line of parts) {
      if (first) {
        first = false; // otsikkorivi
        continue;
      }
      if (line) await handle(line);
    }
  }
  if (carry && !first) await handle(carry);
  await flushRows();
  await runPending(true);
  if (!count) throw new Error(`tiedostossa ei rivejä: ${url}`);
  const ys = [...years];
  await db
    .prepare("UPDATE vero_files SET status = 'ok', vuosi = ?, rows = ?, loaded_at = ? WHERE url = ?")
    .bind(ys.length === 1 ? ys[0] : null, count, new Date().toISOString(), url)
    .run();
  return `ladattu ${count} riviä (${kind}, vuodet ${ys.join(", ")}${deleted ? ", vanhat korvattu" : ""}) ${statements} lauseella`;
}

// ---------- Kyselyt ----------

export async function veroLoaded(db) {
  try {
    const r = await db.prepare("SELECT vuosi, rows, loaded_at FROM vero_files WHERE status = 'ok' AND kind = 'vuosi' ORDER BY vuosi").all();
    return r.results;
  } catch {
    return [];
  }
}

export async function veroForCompany(db, ytunnus) {
  const [base, changes] = await Promise.all([
    db.prepare("SELECT vuosi, nimi, kunta_nro, kunta, tulo, verot, palautus, jaannos FROM vero WHERE ytunnus = ? ORDER BY vuosi").bind(ytunnus).all(),
    db.prepare("SELECT vuosi, muutos, tulo, verot, palautus, jaannos FROM vero_muutos WHERE ytunnus = ? ORDER BY vuosi, muutos").bind(ytunnus).all().catch(() => ({ results: [] })),
  ]);
  return { rows: base.results, changes: changes.results };
}

export async function veroByName(db, q, limit = 10) {
  const r = await db
    .prepare("SELECT ytunnus, nimi, kunta, max(vuosi) AS vuosi FROM vero WHERE nimi LIKE ? GROUP BY ytunnus ORDER BY vuosi DESC, nimi LIMIT ?")
    .bind(`%${q}%`, limit)
    .all();
  return r.results;
}

export async function veroTop(db, { kunta_nro, vuosi, order, hakusana, limit, offset }) {
  const col = order === "tulo" ? "tulo" : "verot";
  const where = ["vuosi = ?"];
  const binds = [vuosi];
  if (kunta_nro) {
    where.push("kunta_nro = ?");
    binds.push(kunta_nro);
  }
  if (hakusana) {
    where.push("nimi LIKE ?");
    binds.push(`%${hakusana}%`);
  }
  const w = where.join(" AND ");
  const [rows, sum] = await Promise.all([
    db.prepare(`SELECT ytunnus, nimi, kunta, tulo, verot, palautus, jaannos FROM vero WHERE ${w} ORDER BY ${col} DESC, nimi LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all(),
    db.prepare(`SELECT count(*) AS n, sum(verot) AS verot, sum(tulo) AS tulo, sum(CASE WHEN verot > 0 THEN 1 ELSE 0 END) AS maksajia FROM vero WHERE ${w}`).bind(...binds).first(),
  ]);
  return { rows: rows.results, sum };
}

export async function veroKunta(db, q) {
  const s = String(q ?? "").trim();
  if (/^\d{1,3}$/.test(s)) return { nro: s.padStart(3, "0") };
  const r = await db.prepare("SELECT kunta_nro, kunta FROM vero WHERE kunta = ? COLLATE NOCASE LIMIT 1").bind(s).first();
  return r ? { nro: r.kunta_nro, nimi: r.kunta } : null;
}
