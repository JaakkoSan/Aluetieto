// Saavutettavuusalue: kuka asuu tietyn matkan tai ajoajan päässä pisteestä.
// Väestö: Tilastokeskuksen 1 km väestöruutujen keskipisteet (WFS vaestoruutu:vaki2025_1km_kp).
//   Ruuduissa, joissa on alle 10 asukasta, sukupuoli- ja ikäjakauma on salattu (-1); asukasluku on aina mukana.
// Postinumeroalueet: Paavo-aineiston rajat ja asukasluku (WFS postialue:pno_tilasto_2026).
// Molemmat CC BY 4.0, lähde Tilastokeskus. Haku rajataan alueen ympäröivään suorakulmioon (bbox),
// ja alueeseen kuuluminen ratkaistaan tässä (piste säteen tai ajoaika-alueen monikulmion sisällä).

import { fetchJson } from "./http.js";

const WFS = "https://geo.stat.fi/geoserver";
export const GRID_LAYER = "vaestoruutu:vaki2025_1km_kp";
export const PNO_LAYER = "postialue:pno_tilasto_2026";
export const SAAV_SOURCE = "Lähde: Tilastokeskus, väestöruutuaineisto 1 km 2025 ja Paavo 2026 -postinumeroalueet (CC BY 4.0)";

const R_EARTH = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

/** Suorakulmio [minLon, minLat, maxLon, maxLat] pisteen ympärille. */
export function bboxAround(lat, lon, km) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos(rad(lat)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Monikulmion (GeoJSON Polygon tai MultiPolygon) suorakulmio. */
export function bboxOf(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Onko piste (lon, lat) monikulmion sisällä (reiät huomioiden). */
export function inGeometry(x, y, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const poly of polys) {
    if (!inRing(x, y, poly[0])) continue;
    let hole = false;
    for (let k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) hole = true;
    if (!hole) return true;
  }
  return false;
}

const inBbox = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function wfsUrl(service, layer, { bbox, cql, props }) {
  const q = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layer,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  if (props) q.set("propertyName", props.join(","));
  // WFS 2.0 + EPSG:4326: akselijärjestys lat,lon on GeoServerissä vältettävissä antamalla CRS bboxin perässä
  // muodossa minLon,minLat,maxLon,maxLat,EPSG:4326 (testattu 1.11.2026).
  if (bbox) q.set("bbox", `${bbox.map((v) => v.toFixed(5)).join(",")},EPSG:4326`);
  if (cql) q.set("cql_filter", cql);
  return `${WFS}/${service}/wfs?${q.toString()}`;
}

/** Väestöruudut suorakulmiossa: [{ lon, lat, pop, women, men, a0_14, a15_64, a65 }]. */
export async function gridPoints(bbox, budget) {
  const d = await fetchJson(wfsUrl("vaestoruutu", GRID_LAYER, { bbox, props: ["vaesto", "naiset", "miehet", "ika_0_14", "ika_15_64", "ika_65_", "geom"] }), { ttl: 30 * 86400, budget });
  return (d?.features ?? [])
    .filter((f) => f.geometry?.type === "Point")
    .map((f) => {
      const p = f.properties;
      return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], pop: p.vaesto, women: p.naiset, men: p.miehet, a0_14: p.ika_0_14, a15_64: p.ika_15_64, a65: p.ika_65_ };
    });
}

/** Postinumeroalueet suorakulmiossa: [{ code, name, kunta, pop, geom, bbox }]. */
export async function postalAreas(bbox, budget) {
  const d = await fetchJson(wfsUrl("postialue", PNO_LAYER, { bbox, props: ["postinumeroalue", "nimi", "kunta", "he_vakiy", "geom"] }), { ttl: 30 * 86400, budget });
  return (d?.features ?? [])
    .filter((f) => f.geometry)
    .map((f) => ({ code: f.properties.postinumeroalue, name: f.properties.nimi, kunta: f.properties.kunta, pop: f.properties.he_vakiy, geom: f.geometry, bbox: bboxOf(f.geometry) }));
}

/** Yksi postinumeroalue rajoineen. */
export async function postalArea(code, budget) {
  if (!/^\d{5}$/.test(code)) return null;
  const d = await fetchJson(wfsUrl("postialue", PNO_LAYER, { cql: `postinumeroalue='${code}'`, props: ["postinumeroalue", "nimi", "kunta", "he_vakiy", "geom"] }), { ttl: 30 * 86400, budget });
  const f = d?.features?.[0];
  if (!f?.geometry) return null;
  return { code, name: f.properties.nimi, kunta: f.properties.kunta, pop: f.properties.he_vakiy, geom: f.geometry, bbox: bboxOf(f.geometry) };
}

/** Postinumeroalueen väestöpainotettu keskipiste (asutuksen keskipiste, ei maantieteellinen). */
export async function postalCenter(code, budget) {
  const a = await postalArea(code, budget);
  if (!a) return null;
  const pts = (await gridPoints(a.bbox, budget)).filter((p) => inGeometry(p.lon, p.lat, a.geom));
  const w = pts.reduce((s, p) => s + p.pop, 0);
  if (w > 0) return { lat: pts.reduce((s, p) => s + p.lat * p.pop, 0) / w, lon: pts.reduce((s, p) => s + p.lon * p.pop, 0) / w, area: a };
  return { lat: (a.bbox[1] + a.bbox[3]) / 2, lon: (a.bbox[0] + a.bbox[2]) / 2, area: a };
}

/**
 * Laskee alueen väestön. inside(lon, lat) ratkaisee, kuuluuko ruudun keskipiste alueeseen.
 * Palauttaa summat ja postinumeroalueittaisen jaon (asukkaat alueella / Paavon asukasluku).
 */
export async function summarize(bbox, inside, budget) {
  const [grid, areas] = await Promise.all([gridPoints(bbox, budget), postalAreas(bbox, budget)]);
  const tot = { pop: 0, women: 0, men: 0, a0_14: 0, a15_64: 0, a65: 0, cells: 0, hidden: 0, hiddenPop: 0 };
  const byCode = new Map();
  for (const p of grid) {
    if (!inside(p.lon, p.lat)) continue;
    tot.cells++;
    tot.pop += p.pop;
    if (p.women < 0) {
      tot.hidden++;
      tot.hiddenPop += p.pop;
    } else {
      tot.women += p.women;
      tot.men += p.men;
      tot.a0_14 += p.a0_14;
      tot.a15_64 += p.a15_64;
      tot.a65 += p.a65;
    }
    const a = areas.find((x) => inBbox(p.lon, p.lat, x.bbox) && inGeometry(p.lon, p.lat, x.geom));
    if (a) byCode.set(a.code, (byCode.get(a.code) ?? 0) + p.pop);
  }
  const postal = areas
    .filter((a) => byCode.has(a.code))
    .map((a) => ({ code: a.code, name: a.name, kunta: a.kunta, inside: byCode.get(a.code), pop: a.pop, share: a.pop > 0 ? Math.min(1, byCode.get(a.code) / a.pop) : null }))
    .sort((x, y) => y.inside - x.inside);
  return { tot, postal };
}
