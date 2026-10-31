// Sotkanet (THL): sote-indikaattorit kunnittain ja hyvinvointialueittain.
//
// THL:n ohjeen mukaan Sotkanetin REST-rajapinta on tarkoitettu tietojen noutamiseen
// erissä, ei suoraan online-käyttöön. Siksi tiedot haetaan ajastetusti (cron) D1-kantaan,
// ja Clauden työkalut lukevat vain D1:stä. Yksi ajo käsittelee enintään yhden
// indikaattorin, ja dataa haetaan uudelleen vain, jos THL on päivittänyt sitä.

const API = "https://sotkanet.fi/rest/1.1";
const USER_AGENT = "aluetieto-mcp/1.1 (Claude-liitin; weekly batch)";
const RECHECK_DAYS = 7;
const YEARS_BACK = 6;
const REGION_CATEGORIES = ["KUNTA", "HYVINVOINTIALUE", "MAAKUNTA", "SEUTUKUNTA", "MAA"];

/**
 * Ladattavat indikaattorit. Vain THL:n ja Tilastokeskuksen tuottamia (CC BY 4.0).
 * Lisää rivi, niin seuraava ajo hakee sen.
 */
export const INDICATORS = [
  // Kotihoito ja ikääntyneiden palvelut (THL)
  5513, // Säännöllisen kotihoidon 75 v täyttäneet asiakkaat, % vastaavan ikäisestä väestöstä
  3314, // Säännöllisen kotihoidon 65 v täyttäneet asiakkaat, %
  5512, // Säännöllisen kotihoidon 85 v täyttäneet asiakkaat, %
  3313, // Säännöllisen kotihoidon asiakkaat, % väestöstä
  1570, // Kotona asuvat 75 v täyttäneet, %
  2722, // Iäkkäiden ympärivuorokautisen palveluasumisen 75 v täyttäneet asiakkaat 31.12.
  3262, // Omaishoidon tuen 75 v täyttäneet hoidettavat, %
  // Väestö ja ennusteet (Tilastokeskus)
  127, // Väestö 31.12.
  1068, // 65 v täyttäneet, % väestöstä
  171, // 75 v täyttäneet, % väestöstä
  237, // Yksinasuvat 75 v täyttäneet, %
  761, // Huoltosuhde, demografinen
  746, // Väestöennuste 2030
  751, // Väestöennuste 2040
  749, // 65 v täyttäneet, % väestöstä, ennuste 2030
  745, // 75 v täyttäneet, % väestöstä, ennuste 2030
  757, // 75 v täyttäneet, % väestöstä, ennuste 2040
];

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS regions (id INTEGER PRIMARY KEY, category TEXT NOT NULL, code TEXT, title TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS regions_title ON regions (title COLLATE NOCASE)",
  "CREATE TABLE IF NOT EXISTS indicators (id INTEGER PRIMARY KEY, title TEXT, organization TEXT, unit TEXT, decimals INTEGER, range_start INTEGER, range_end INTEGER, data_updated TEXT, description TEXT, limits TEXT, last_checked TEXT, last_loaded TEXT, row_count INTEGER)",
  "CREATE TABLE IF NOT EXISTS data (indicator INTEGER NOT NULL, region INTEGER NOT NULL, year INTEGER NOT NULL, gender TEXT NOT NULL, value REAL, abs_value REAL, PRIMARY KEY (indicator, region, year, gender))",
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)",
];

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Sotkanet ${res.status}: ${url}`);
  return res.json();
}

const nowIso = () => new Date().toISOString();
const daysAgoIso = (d) => new Date(Date.now() - d * 86400_000).toISOString();
const stripHtml = (s) => String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// ---------- Eräpäivitys (cron) ----------

/** Yksi päivitysaskel. Palauttaa kuvauksen tehdystä työstä lokia varten. */
export async function refreshStep(db) {
  await db.batch(SCHEMA.map((s) => db.prepare(s)));

  // 1) Alueet viikoittain.
  const regionsAt = await db.prepare("SELECT value FROM meta WHERE key = 'regions_loaded'").first("value");
  if (!regionsAt || regionsAt < daysAgoIso(RECHECK_DAYS)) {
    const list = await getJson(`${API}/regions`);
    const rows = list.filter((r) => REGION_CATEGORIES.includes(r.category));
    const stmts = [db.prepare("DELETE FROM regions")];
    for (const r of rows) {
      stmts.push(
        db.prepare("INSERT INTO regions (id, category, code, title) VALUES (?, ?, ?, ?)").bind(r.id, r.category, String(r.code ?? ""), r.title?.fi ?? ""),
      );
    }
    stmts.push(db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('regions_loaded', ?)").bind(nowIso()));
    await db.batch(stmts);
    return `alueet päivitetty (${rows.length})`;
  }

  // 2) Seuraava indikaattori, jota ei ole tarkistettu viikkoon.
  const known = new Map(
    (await db.prepare("SELECT id, last_checked, data_updated, row_count FROM indicators").all()).results.map((r) => [r.id, r]),
  );
  const due = INDICATORS.map((id) => ({ id, row: known.get(id) }))
    .filter((x) => !x.row?.last_checked || x.row.last_checked < daysAgoIso(RECHECK_DAYS))
    .sort((a, b) => String(a.row?.last_checked ?? "").localeCompare(String(b.row?.last_checked ?? "")));
  if (!due.length) return "ei tehtävää";
  const { id, row } = due[0];

  const meta = await getJson(`${API}/indicators/${id}`);
  const updated = meta["data-updated"] ?? null;
  const rangeEnd = meta.range?.end ?? null;
  const rangeStart = meta.range?.start ?? null;
  const metaStmt = db
    .prepare(
      `INSERT INTO indicators (id, title, organization, unit, decimals, range_start, range_end, data_updated, description, limits, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, organization=excluded.organization, unit=excluded.unit,
         decimals=excluded.decimals, range_start=excluded.range_start, range_end=excluded.range_end,
         description=excluded.description, limits=excluded.limits, last_checked=excluded.last_checked`,
    )
    .bind(
      id,
      meta.title?.fi ?? null,
      meta.organization?.title?.fi ?? null,
      meta.primaryValueType?.title?.fi ?? null,
      meta.decimals ?? null,
      rangeStart,
      rangeEnd,
      row?.data_updated ?? null,
      stripHtml(meta.description?.fi).slice(0, 1500),
      stripHtml(meta.limits?.fi).slice(0, 800),
      nowIso(),
    );

  if (row && row.data_updated === updated && row.row_count > 0) {
    await metaStmt.run();
    return `indikaattori ${id}: ei muutoksia`;
  }
  if (!rangeEnd) {
    await metaStmt.run();
    return `indikaattori ${id}: ei vuosia`;
  }

  const years = [];
  for (let y = rangeEnd; y > rangeEnd - YEARS_BACK && y >= (rangeStart ?? 0); y--) years.push(y);
  const url = `${API}/json?indicator=${id}&${years.map((y) => `years=${y}`).join("&")}&genders=total`;
  const data = await getJson(url);
  const regionIds = new Set((await db.prepare("SELECT id FROM regions").all()).results.map((r) => r.id));
  const rows = data.filter((d) => regionIds.has(d.region));

  const stmts = [metaStmt, db.prepare("DELETE FROM data WHERE indicator = ?").bind(id)];
  // Monirivinen INSERT: 6 parametria/rivi, enintään 100 parametria/lause -> 16 riviä.
  for (let i = 0; i < rows.length; i += 16) {
    const chunk = rows.slice(i, i + 16);
    const sql = `INSERT OR REPLACE INTO data (indicator, region, year, gender, value, abs_value) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`;
    stmts.push(db.prepare(sql).bind(...chunk.flatMap((d) => [id, d.region, d.year, d.gender, d.value ?? null, d.absValue ?? null])));
  }
  stmts.push(
    db.prepare("UPDATE indicators SET data_updated = ?, last_loaded = ?, row_count = ? WHERE id = ?").bind(updated, nowIso(), rows.length, id),
  );
  await db.batch(stmts);
  return `indikaattori ${id}: ladattu ${rows.length} riviä (${years[years.length - 1]}–${years[0]})`;
}

// ---------- Luku (työkalut) ----------

export async function listIndicators(db) {
  try {
    return (await db.prepare("SELECT id, title, organization, unit, range_start, range_end, data_updated, last_loaded, row_count FROM indicators ORDER BY id").all()).results;
  } catch {
    return [];
  }
}

export async function findIndicator(db, q) {
  const s = String(q ?? "").trim();
  if (/^\d+$/.test(s)) return db.prepare("SELECT * FROM indicators WHERE id = ?").bind(Number(s)).first();
  const rows = (await db.prepare("SELECT * FROM indicators WHERE title LIKE ? ORDER BY id").bind(`%${s}%`).all()).results;
  return rows.length === 1 ? rows[0] : rows.length ? { ambiguous: rows } : null;
}

const CATEGORY_LABEL = { KUNTA: "kunta", HYVINVOINTIALUE: "hyvinvointialue", MAAKUNTA: "maakunta", SEUTUKUNTA: "seutukunta", MAA: "koko maa" };
export const categoryLabel = (c) => CATEGORY_LABEL[c] ?? c.toLowerCase();

export async function findRegions(db, names) {
  const out = [];
  const missing = [];
  for (const n of names) {
    const s = String(n).trim();
    const rows = (await db.prepare("SELECT * FROM regions WHERE title = ? COLLATE NOCASE").bind(s).all()).results;
    if (rows.length) out.push(...rows);
    else missing.push(s);
  }
  return { regions: out, missing };
}

export async function countryRegion(db) {
  return db.prepare("SELECT * FROM regions WHERE category = 'MAA' LIMIT 1").first();
}

export async function values(db, indicator, regionIds, years) {
  if (!regionIds.length) return [];
  const yq = years?.length ? ` AND year IN (${years.map(() => "?").join(",")})` : "";
  const sql = `SELECT region, year, value, abs_value FROM data WHERE indicator = ? AND gender = 'total' AND region IN (${regionIds.map(() => "?").join(",")})${yq} ORDER BY region, year`;
  return (await db.prepare(sql).bind(indicator, ...regionIds, ...(years ?? [])).all()).results;
}
