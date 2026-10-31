// HTTP-apu: välimuisti (Cloudflare Cache API), uudelleenyritykset ja
// alipyyntöbudjetti (Workersin ilmaistasolla enintään 50 ulkoista pyyntöä / kutsu).

const USER_AGENT = "aluetieto-mcp/1.0 (Claude-liitin; Cloudflare Worker)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class BudgetError extends Error {}

/** Pyyntökohtainen budjetti ulkoisille hauille. Välimuistiosumat eivät kuluta budjettia. */
export function newBudget(max = 45) {
  return { left: max };
}

function cacheApi() {
  try {
    return typeof caches !== "undefined" && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hakee JSONin. GET tai POST (body = objekti). 404 palauttaa null.
 * ttl sekunteina; 0 = ei välimuistia.
 */
export async function fetchJson(url, { method = "GET", body, ttl = 3600, budget } = {}) {
  const cache = cacheApi();
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const keyUrl = payload ? `${url}${url.includes("?") ? "&" : "?"}_body=${await sha256(payload)}` : url;
  const cacheKey = new Request(keyUrl);
  if (cache && ttl > 0) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.status === 404 ? null : await hit.json();
  }

  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (budget) {
      if (budget.left <= 0) throw new BudgetError("Haku vaatisi liian monta pyyntöä kerralla.");
      budget.left--;
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload,
      });
    } catch (e) {
      lastErr = e;
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.status === 404) {
      if (cache && ttl > 0) {
        await cache.put(cacheKey, new Response("null", { status: 404, headers: { "Cache-Control": "max-age=600" } }));
      }
      return null;
    }
    if (res.ok) {
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new HttpError(`Lähde palautti virheellisen vastauksen (${url.split("?")[0]})`, res.status);
      }
      if (cache && ttl > 0) {
        await cache.put(
          cacheKey,
          new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } }),
        );
      }
      return data;
    }
    lastErr = new HttpError(`Lähde vastasi ${res.status}`, res.status);
    if (!RETRY_STATUS.has(res.status)) break;
    await sleep(500 * 2 ** attempt);
  }
  throw lastErr instanceof HttpError ? lastErr : new HttpError(`Lähteeseen ei saatu yhteyttä: ${lastErr?.message ?? lastErr}`, 0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
