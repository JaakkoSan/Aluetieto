// Koodiajon mittaus kolmella oikealla tehtävällä oikeita lähteitä (YTJ, StatFin) vasten.
// Ajo: node test/mittaus.mjs [--json]
//
// Kaksi tapaa samalle tehtävälle:
// - perinteinen: malli kutsuu työkaluja yksi kerrallaan, ja jokaisen kutsun teksti tulee mallin kontekstiin;
// - koodiajo (tapa A, koodi ajetaan asiakkaalla): malli kirjoittaa ohjelman, joka kutsuu työkaluja ja käyttää niiden
//   rakenteista tulosta (structuredContent); kontekstiin tulevat vain ohjelman teksti, palautettu tulos ja niiden
//   työkalujen tekstit, joilla ei ole rakenteista tulosta.
// Koodiajoa ei mitata, jos tarvittavilla työkaluilla ei ole structuredContentia (esim. ennen rungon käyttöönottoa).
// Pituus on merkkeinä (JSON-RPC-kääre ei mukana); tokenit noin merkit / 3,5 suomenkielisessä tekstissä.

import worker from "../src/index.js";

const JSON_ULOS = process.argv.includes("--json");
let id = 0;
async function rpc(method, params) {
  const req = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return (await worker.fetch(req, {})).json();
}

/** Työkalukutsu: palauttaa tekstin ja rakenteisen tuloksen ja kirjaa kontekstiin tulevan pituuden lokiin. */
function kutsuja(loki, { tekstiKontekstiin }) {
  return async (nimi, args) => {
    const r = await rpc("tools/call", { name: nimi, arguments: args });
    const teksti = (r.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const sc = r.result?.structuredContent ?? null;
    loki.kutsut++;
    loki.argumentit += JSON.stringify(args).length + nimi.length;
    // Perinteisessä tavassa teksti tulee aina kontekstiin; koodiajossa vain, jos rakenteista tulosta ei ole.
    if (tekstiKontekstiin || !sc) loki.kontekstiin += teksti.length;
    else loki.rakenteisena += JSON.stringify(sc).length;
    if (r.result?.isError) loki.virheet.push(`${nimi}: ${teksti.slice(0, 200)}`);
    return { teksti, sc };
  };
}

const uusiLoki = () => ({ kutsut: 0, argumentit: 0, kontekstiin: 0, rakenteisena: 0, ohjelma: 0, tulos: 0, virheet: [] });

// Edellinen kokonainen viikko maanantaista sunnuntaihin (liidivahdin jakso).
function edellinenViikko(nyt = new Date()) {
  const d = new Date(Date.UTC(nyt.getUTCFullYear(), nyt.getUTCMonth(), nyt.getUTCDate()));
  const vp = (d.getUTCDay() + 6) % 7; // ma = 0
  const ma = new Date(d.getTime() - (vp + 7) * 86400000);
  const su = new Date(ma.getTime() + 6 * 86400000);
  return [ma.toISOString().slice(0, 10), su.toISOString().slice(0, 10)];
}
const [ALKU, LOPPU] = edellinenViikko();
const LIIDI_TOIMIALAT = ["96210", "96220", "96230", "86950", "86990", "93130"];

// ---------- Tehtävät ----------
// Jokaisella tehtävällä on perinteinen kulku (mitä malli kutsuisi ja lukisi) ja koodiajon ohjelma.
// Koodiajon ohjelman lähdekoodin pituus lasketaan kontekstiin (malli kirjoittaa sen).

const TEHTAVAT = [
  {
    nimi: "T1 Liidivahdin viikkokooste (uudet yritykset kohdealoilla, koko maa)",
    kuvaus: `Edellisen viikon (${ALKU}–${LOPPU}) uudet kaupparekisteriyritykset toimialoilla ${LIIDI_TOIMIALAT.join(", ")}: lista ja määrä toimialoittain.`,
    async perinteinen(k) {
      const maarat = {};
      for (const t of LIIDI_TOIMIALAT) {
        let sivu = 1;
        let n = 0;
        for (;;) {
          const { teksti } = await k("hae_yrityksia", { toimiala: t, rekisteroity_alkaen: ALKU, rekisteroity_paattyen: LOPPU, sivu });
          n += (teksti.match(/^- /gm) ?? []).length;
          if (!/Lisää tuloksia: sivu/.test(teksti)) break;
          sivu++;
        }
        maarat[t] = n;
      }
      return maarat;
    },
    // Koodiajon ohjelma: kutsuu samat haut ja palauttaa vain koosteen rivit ja määrät.
    async koodiajo(k) {
      const maarat = {};
      const rivit = [];
      for (const t of ["96210", "96220", "96230", "86950", "86990", "93130"]) {
        let sivu = 1;
        for (;;) {
          const { sc } = await k("hae_yrityksia", { toimiala: t, rekisteroity_alkaen: ALKU, rekisteroity_paattyen: LOPPU, sivu });
          for (const y of sc.yritykset) rivit.push([y.nimi, y.y_tunnus, y.toimiala?.koodi, y.postitoimipaikka, y.rekisteroity]);
          maarat[t] = (maarat[t] ?? 0) + sc.yritykset.length;
          if (!sc.seuraava) break;
          sivu = sc.seuraava;
        }
      }
      return { maarat, rivit, lahde: "PRH, YTJ avoin data" };
    },
    tarkista: (p, k) => JSON.stringify(p) === JSON.stringify(k.maarat),
  },
  {
    nimi: "T2 Alueen yritysmäärä toimialoittain (Tampere, kauneus ja hyvinvointi)",
    kuvaus: "Toimivien kaupparekisteriyritysten määrä Tampereella toimialoittain (962-alaluokat ja 86950): koodit etsi_toimiala-työkalulla, määrät kaikilta sivuilta.",
    async perinteinen(k) {
      const koodit = [];
      for (const h of ["962", "8695"]) {
        const { teksti } = await k("etsi_toimiala", { hakusana: h });
        for (const m of teksti.matchAll(/^\s*(\d{5}) /gm)) koodit.push(m[1]);
      }
      const maarat = {};
      for (const t of koodit) {
        let sivu = 1;
        let n = 0;
        for (;;) {
          const { teksti } = await k("hae_yrityksia", { toimiala: t, paikkakunta: "Tampere", sivu });
          n += Number(/Tällä sivulla toimivia: (\d+)/.exec(teksti)?.[1] ?? 0);
          if (!/Lisää tuloksia: sivu/.test(teksti)) break;
          sivu++;
        }
        maarat[t] = n;
      }
      return maarat;
    },
    async koodiajo(k) {
      const koodit = [];
      for (const h of ["962", "8695"]) {
        const { sc } = await k("etsi_toimiala", { hakusana: h });
        for (const o of sc.osumat) if (o.koodi.length === 5) koodit.push(o.koodi);
      }
      const maarat = {};
      for (const t of koodit) {
        let sivu = 1;
        let n = 0;
        for (;;) {
          const { sc } = await k("hae_yrityksia", { toimiala: t, paikkakunta: "Tampere", sivu });
          n += sc.yritykset.length;
          if (!sc.seuraava) break;
          sivu = sc.seuraava;
        }
        maarat[t] = n;
      }
      return { maarat, lahde: "PRH, YTJ avoin data" };
    },
    tarkista: (p, k) => JSON.stringify(p) === JSON.stringify(k.maarat),
  },
  {
    nimi: "T3 Tilastoketju (toimipaikkojen kasvu kunnittain)",
    kuvaus: "Kymmenen kuntaa (vähintään 500 toimipaikkaa), joissa yritysten toimipaikkojen määrä kasvoi suhteellisesti eniten kahden viimeisimmän vuoden välillä: hae_tilastoja -> tilaston_rakenne -> tilasto.",
    async perinteinen(k) {
      await k("hae_tilastoja", { hakusana: "yritysten toimipaikat kunnittain" });
      await k("tilaston_rakenne", { taulukko: "alyr/13wz" });
      const { teksti } = await k("tilasto", { taulukko: "alyr/13wz", valinnat: { Vuosi: "viimeiset 2", Kunta: "*", Tiedot: "Tplukumaara2" } });
      // Malli laskee kasvun tekstistä: rivit "vuosi | kunta: arvo" tai "kunta | vuosi: arvo".
      const arvot = {};
      for (const m of teksti.matchAll(/^(.+?) \| (.+?): ([\d ]+)$/gm)) {
        const [a, b] = /^\d{4}$/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
        (arvot[b] ??= {})[a] = Number(m[3].replace(/ /g, ""));
      }
      return kasvu(arvot);
    },
    async koodiajo(k) {
      // Taulukon tunnus ja muuttujat haetaan tekstinä (näillä työkaluilla ei vielä rakenteista tulosta).
      await k("hae_tilastoja", { hakusana: "yritysten toimipaikat kunnittain" });
      await k("tilaston_rakenne", { taulukko: "alyr/13wz" });
      const { sc } = await k("tilasto", { taulukko: "alyr/13wz", valinnat: { Vuosi: "viimeiset 2", Kunta: "*", Tiedot: "Tplukumaara2" } });
      const iv = sc.muuttujat.findIndex((m) => m.aika);
      const ik = sc.muuttujat.findIndex((m) => m.nimi === "Kunta");
      const arvot = {};
      for (const r of sc.rivit) (arvot[r.tekstit[ik]] ??= {})[r.tekstit[iv]] = r.arvo;
      return { kymmenen: kasvu(arvot), taulukko: sc.taulukko, lahde: sc.lahde.nimi };
    },
    tarkista: (p, k) => JSON.stringify(p) === JSON.stringify(k.kymmenen),
  },
];

/** Kymmenen suurinta suhteellista kasvua kunnista, joissa vähintään 500 toimipaikkaa (koko maa pois). */
function kasvu(arvot) {
  const out = [];
  for (const [kunta, v] of Object.entries(arvot)) {
    const vuodet = Object.keys(v).sort();
    if (vuodet.length < 2 || /KOKO MAA/i.test(kunta)) continue;
    const [a, b] = [v[vuodet[0]], v[vuodet[1]]];
    if (!(a >= 500) || !Number.isFinite(b)) continue;
    out.push([kunta, a, b, Math.round(((b - a) / a) * 1000) / 10]);
  }
  return out.sort((x, y) => y[3] - x[3] || x[0].localeCompare(y[0], "fi")).slice(0, 10);
}

// ---------- Ajo ----------

const list = await rpc("tools/list", {});
const tyokalut = list.result.tools;
const maaritykset = JSON.stringify(tyokalut).length;
const rakenteiset = tyokalut.filter((t) => t.outputSchema).map((t) => t.name);

const tulokset = [];
for (const t of TEHTAVAT) {
  const p = uusiLoki();
  const pTulos = await t.perinteinen(kutsuja(p, { tekstiKontekstiin: true }));
  p.tulos = JSON.stringify(pTulos).length;
  let ka = null;
  let oikein = null;
  const koodiTyokalut = { T1: ["hae_yrityksia"], T2: ["etsi_toimiala", "hae_yrityksia"], T3: ["tilasto"] }[t.nimi.slice(0, 2)];
  if (koodiTyokalut.every((n) => rakenteiset.includes(n))) {
    ka = uusiLoki();
    const kTulos = await t.koodiajo(kutsuja(ka, { tekstiKontekstiin: false }));
    ka.ohjelma = t.koodiajo.toString().length;
    ka.tulos = JSON.stringify(kTulos).length;
    oikein = t.tarkista(pTulos, kTulos);
  }
  tulokset.push({ tehtava: t.nimi, kuvaus: t.kuvaus, perinteinen: p, koodiajo: ka, sama_tulos: oikein, tulos: pTulos });
}

const yhteensa = (l) => (l ? l.argumentit + l.kontekstiin + l.ohjelma + l.tulos : null);
if (JSON_ULOS) {
  console.log(JSON.stringify({ paiva: new Date().toISOString(), maaritykset, tyokaluja: tyokalut.length, rakenteiset, tulokset }, null, 1));
} else {
  console.log(`Työkalujen määritykset (tools/list): ${maaritykset} merkkiä, ${tyokalut.length} työkalua, rakenteisia: ${rakenteiset.join(", ") || "ei yhtään"}`);
  for (const r of tulokset) {
    console.log(`\n${r.tehtava}\n  ${r.kuvaus}`);
    const p = r.perinteinen;
    console.log(`  perinteinen: ${p.kutsut} kutsua, kontekstiin ${yhteensa(p)} merkkiä (tulosteet ${p.kontekstiin}, argumentit ${p.argumentit})${p.virheet.length ? `, virheitä ${p.virheet.length}` : ""}`);
    const k = r.koodiajo;
    if (k) console.log(`  koodiajo:    ${k.kutsut} kutsua, kontekstiin ${yhteensa(k)} merkkiä (ohjelma ${k.ohjelma}, tulos ${k.tulos}, tekstinä ${k.kontekstiin}, argumentit ${k.argumentit}); rakenteinen data jäi ohjelmaan ${k.rakenteisena} merkkiä; sama tulos: ${r.sama_tulos ? "kyllä" : "EI"}`);
    else console.log("  koodiajo:    ei mitattavissa (työkaluilla ei rakenteista tulosta)");
    console.log(`  tulos: ${JSON.stringify(r.tulos).slice(0, 300)}`);
  }
}
if (tulokset.some((r) => r.sama_tulos === false || r.perinteinen.virheet.length || r.koodiajo?.virheet.length)) process.exitCode = 1;
