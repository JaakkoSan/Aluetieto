// Maanmittauslaitoksen avoin geokoodauspalvelu (Pelias v2): osoite tai paikannimi -> koordinaatit.
// Maksuton API-avaimella (MML:n Oma tili), lisenssi MML:n avoimen tietoaineiston Nimeä CC 4.0;
// rakennusosoitteet SYKE:n Ryhti-järjestelmästä (CC BY 4.0). Käyttöehtojen mukaan palvelu on
// tarkoitettu käyttöön, jossa suorituskyky ei ole kriittistä eikä volyymi suuri, joten haut
// pidetään välimuistissa 30 päivää.
// Kuvaus: https://www.maanmittauslaitos.fi/geokoodauspalvelu

import { fetchJson, HttpError } from "./http.js";

const BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/geocoding/v2/pelias";
const TTL = 30 * 86400;
const SOURCES = "addresses,interpolated-road-addresses,geographic-names";

export const MML_SOURCE =
  "Lähde: Maanmittauslaitos, geokoodauspalvelu (MML:n avoimen tietoaineiston Nimeä CC 4.0; rakennusosoitteet SYKE, Ryhti, CC BY 4.0), https://www.maanmittauslaitos.fi/geokoodauspalvelu";

export class NoKeyError extends Error {}

const SOURCE_LABELS = {
  addresses: "rakennuksen osoite",
  "interpolated-road-addresses": "tieosoite (arvioitu kohta)",
  "geographic-names": "paikannimi",
};

function authHeader(key) {
  // HTTP Basic: avain käyttäjänimenä, tyhjä salasana. Avain ei kulje URL:ssa eikä välimuistiavaimessa.
  return { Authorization: `Basic ${btoa(`${key}:`)}` };
}

/**
 * Hakee osoitteen tai paikannimen. Palauttaa enintään `size` osumaa:
 * [{ label, lat, lon, kunta, kuntanro, postinumero, lahde }].
 */
export async function geocode(text, env, { size = 5, budget } = {}) {
  const key = env?.MML_API_KEY;
  if (!key) throw new NoKeyError("Geokoodausta ei ole kytketty (MML:n API-avain puuttuu).");
  const q = String(text ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const url = `${BASE}/search?text=${encodeURIComponent(q)}&sources=${SOURCES}&size=${size}&lang=fi`;
  let data;
  try {
    data = await fetchJson(url, { ttl: TTL, budget, headers: authHeader(key) });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      throw new HttpError("MML:n geokoodaus hylkäsi API-avaimen", e.status);
    }
    throw e;
  }
  return (data?.features ?? [])
    .map((f) => {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      const p = f.properties ?? {};
      const src = p.source ?? p["source"] ?? null;
      return {
        label: String(p.label ?? p.name ?? q).replace(/\s+/g, " "),
        lat: Number(lat),
        lon: Number(lon),
        kunta: p["label:municipality"] ?? null,
        kuntanro: p.municipality ?? null,
        postinumero: p.postinumero ?? null,
        lahde: SOURCE_LABELS[src] ?? p.placeType ?? src ?? null,
      };
    })
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon))
    .slice(0, size);
}
