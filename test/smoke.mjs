// Savutesti oikeita lähteitä (YTJ, Tilastokeskus, ePerusteet ym.) vasten. Ajo: node test/smoke.mjs [-v]
import worker, { ASETUKSET } from "../src/index.js";
import { luoPalvelin } from "../src/mcp-runko.js";
import pkg from "../package.json" with { type: "json" };
import { cellText, resolveOccupation } from "../src/tyonv.js";
import * as kal from "../src/kalenteri.js";

// MML_API_KEY ympäristömuuttujana testaa geokoodauksen oikeaa rajapintaa vasten.
const ENV = process.env.MML_API_KEY ? { MML_API_KEY: process.env.MML_API_KEY } : {};
const MML = !!ENV.MML_API_KEY;
// Ulkoisten pyyntöjen laskuri (ePerusteet-testit tarkistavat pyyntömäärän kutsua kohden; Node-testissä ei ole välimuistia).
const realFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = (...a) => {
  fetchCount++;
  return realFetch(...a);
};
let id = 0;
async function rpc(method, params) {
  const req = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return (await worker.fetch(req, ENV)).json();
}
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  return { isError: !!r.result.isError, text: r.result.content.map((c) => c.text).join("\n") };
}
function check(cond, label) {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
check(init.result?.serverInfo?.name === "aluetieto" && init.result.serverInfo.version === pkg.version && init.result.instructions.includes("tutkinnon_osaaminen") && init.result.instructions.includes("avoimet_tyopaikat") && init.result.instructions.includes("tulevat_paivat"), "initialize");
// Claude-asiakkaat katkaisevat palvelinohjeen noin 4 096 merkin kohdalta.
check(init.result.instructions.length < 4000, `palvelinohje alle 4 000 merkkiä (${init.result.instructions.length})`);
const list = await rpc("tools/list", {});
check(list.result?.tools?.length === 30 && list.result.tools.every((t) => t.annotations?.readOnlyHint), "tools/list (30, readOnlyHint)");
check(list.result.tools.filter((t) => ["tulevat_paivat", "koululomat"].includes(t.name)).every((t) => t.annotations.openWorldHint === false), "kalenterityökalut: openWorldHint false");

// Työnvälitystilasto: salassa pidetty luku ei saa näkyä nollana.
check(cellText({ value: null, status: "..." }) === "salassa (...)" && cellText({ value: 0, status: null }) === "0" && cellText({ value: null, status: null }) === "ei tietoa", "avoimet_tyopaikat: salassa pidetty luku (..., 0, puuttuva)");

// Ammattinimien muunnos (AML 2010) ilman rajapintaa.
{
  const codes = ["5141", "5142", "3230", "5329", "3255", "5321", "5322"];
  const occVar = { values: codes, texts: codes.map((c) => `${c} Ryhmä ${c}`) };
  const want = { "hermoratahieroja": "3230", "lymfahieroja": "3230", "äänimaljahieroja": "3230", "hieroja": "5329", "jalkahoitaja": "5142", "tatuoija": "5142", "lähihoitaja": "5321", "jalkojenhoitaja": "3255", "5322": "5322" };
  const bad = Object.entries(want).filter(([n, c]) => resolveOccupation(n, occVar).code !== c);
  check(!bad.length, `avoimet_tyopaikat: ammattinimet koodeiksi${bad.length ? ` (väärin: ${bad.map(([n]) => n).join(", ")})` : ""}`);
}

// Markkinointikalenteri: laskusäännöt tunnettuja päiviä vasten (lähteet kommenteissa, ei muistista).
{
  const f = (d) => kal.iso(d);
  // Gregoriaaninen pääsiäispäivä: Utrechtin yliopisto, R. H. van Gent, "Astronomical and Gregorian Easter Sunday"
  // (Meeus, Mathematical Astronomy Morsels), https://webspace.science.uu.nl/~gent0113/easter/easter_text3a.htm, luettu 13.11.2026.
  // 2026: pitkäperjantai 3.4. ja 2. pääsiäispäivä 6.4. (myhelsinki.fi, Pääsiäinen 2026 Helsingissä) => 5.4.
  // 2027: Yliopiston almanakkatoimisto, Liputuspäivät 2027: Marian ilmestyspäivä siirtyy palmusunnuntaita edeltävään sunnuntaihin 14.3.2027 => palmusunnuntai 21.3., pääsiäinen 28.3.
  const easter = { 2019: "2019-04-21", 2026: "2026-04-05", 2027: "2027-03-28", 2038: "2038-04-25", 2045: "2045-04-09", 2049: "2049-04-18", 2057: "2057-04-22", 2069: "2069-04-14", 2076: "2076-04-19", 2089: "2089-04-03", 2095: "2095-04-24", 2096: "2096-04-15" };
  const bad = Object.entries(easter).filter(([y, d]) => f(kal.paasiainen(+y)) !== d);
  check(!bad.length, `kalenteri: pääsiäispäivä 12 vuotena (2019–2096)${bad.length ? ` väärin: ${bad.map(([y]) => y).join(", ")}` : ""}`);
  // Yliopiston almanakkatoimisto, Liputuspäivät 2026 ja 2027 (luettu 13.11.2026).
  const want = [
    [(y) => kal.nsViikonpaiva(y, 5, 0, 2), { 2026: "2026-05-10", 2027: "2027-05-09" }, "äitienpäivä"],
    [(y) => kal.nsViikonpaiva(y, 5, 0, 3), { 2026: "2026-05-17", 2027: "2027-05-16" }, "kaatuneitten muistopäivä"],
    [(y) => kal.viikonpaivaAlkaen(y, 6, 20, 6), { 2026: "2026-06-20", 2027: "2027-06-26" }, "juhannus"],
    [(y) => kal.viimeinenViikonpaiva(y, 8, 6), { 2026: "2026-08-29", 2027: "2027-08-28" }, "Suomen luonnon päivä"],
    [(y) => kal.nsViikonpaiva(y, 11, 0, 2), { 2026: "2026-11-08", 2027: "2027-11-14" }, "isänpäivä"],
    // OPH: Kotkan koulu päättyy 5.6.2027 (perusopetusasetus 7 §: viikon 22 viimeinen arkipäivä).
    [(y) => kal.koulunPaattyminen(y), { 2027: "2027-06-05" }, "koulun päättyminen"],
  ];
  for (const [fn, ref, nimi] of want) {
    const v = Object.entries(ref).filter(([y, d]) => f(fn(+y)) !== d);
    check(!v.length, `kalenteri: ${nimi} ${Object.keys(ref).join(", ")}${v.length ? ` väärin: ${v.map(([y]) => `${y} ${f(fn(+y))}`).join(", ")}` : ""}`);
  }
  // Säännöt kaikille vuosille 2026–2100.
  const viat = [];
  for (let y = 2026; y <= 2100; y++) {
    const e = kal.paasiainen(y);
    if (e.getUTCDay() !== 0 || e < kal.pvm(y, 3, 22) || e > kal.pvm(y, 4, 25)) viat.push(`pääsiäinen ${y}`);
    const j = kal.viikonpaivaAlkaen(y, 6, 20, 6);
    if (j.getUTCDay() !== 6 || j < kal.pvm(y, 6, 20) || j > kal.pvm(y, 6, 26)) viat.push(`juhannus ${y}`);
    const p = kal.viikonpaivaAlkaen(y, 10, 31, 6);
    if (p.getUTCDay() !== 6 || p < kal.pvm(y, 10, 31) || p > kal.pvm(y, 11, 6)) viat.push(`pyhäinpäivä ${y}`);
    const k = kal.koulunPaattyminen(y);
    if (k.getUTCDay() !== 6 || kal.isoViikko(k) !== 22) viat.push(`koulu ${y}`);
    const bf = kal.blackFriday(y);
    if (bf.getUTCDay() !== 5 || bf.getUTCMonth() !== 10 || bf.getUTCDate() < 23 || bf.getUTCDate() > 29) viat.push(`Black Friday ${y}`);
    for (const m of [3, 10]) {
      const s = kal.viimeinenViikonpaiva(y, m, 0);
      if (s.getUTCDay() !== 0 || s.getUTCMonth() !== m - 1 || s.getUTCDate() < 25) viat.push(`kesäaika ${m}/${y}`);
    }
    for (const n of [2, 3]) {
      const s = kal.nsViikonpaiva(y, 5, 0, n);
      if (s.getUTCDay() !== 0 || s.getUTCDate() <= (n - 1) * 7 || s.getUTCDate() > n * 7) viat.push(`toukokuun ${n}. sunnuntai ${y}`);
    }
  }
  check(!viat.length, `kalenteri: säännöt vuosille 2026–2100${viat.length ? ` (${viat.slice(0, 5).join(", ")})` : ""}`);
  check(f(kal.paasiainen(2026)) === "2026-04-05" && f(kal.lisaa(kal.paasiainen(2026), 39)) === "2026-05-14" && f(kal.lisaa(kal.paasiainen(2026), -49)) === "2026-02-15" && f(kal.blackFriday(2026)) === "2026-11-27" && f(kal.viikonpaivaAlkaen(2026, 10, 31, 6)) === "2026-10-31", "kalenteri: 2026 helatorstai, laskiaissunnuntai, Black Friday, pyhäinpäivä");
  check(kal.PAIVAT.every((p) => p.lahde?.url?.startsWith("https://") && p.saanto && p.luokat.every((l) => kal.LUOKAT[l])), "kalenteri: jokaisella päivällä lähde, sääntö ja tunnettu luokka");
  const m = kal.maaratLuokittain();
  check(m.teema === 10 && m.jarjesto <= 10 && m.liputus_vakiintunut === 15, `kalenteri: määrät ${JSON.stringify(m)}`);
  check(kal.jasennaPvm("31.2.2026") === null && f(kal.jasennaPvm("13.11.2026")) === "2026-11-13" && kal.kuluvaLukuvuosi(kal.pvm(2026, 11, 13)) === "2026-2027" && kal.kuluvaLukuvuosi(kal.pvm(2027, 7, 31)) === "2026-2027", "kalenteri: päivämäärän jäsennys ja lukuvuosi");
}

const show = process.argv.includes("-v");
const monthLines = (t) => (t.match(/^  \d{1,2}\/\d{4}: /gm) ?? []).length;
const TP_NUM = /Uusin kuukausi \d{1,2}\/20\d\d: (\d[\d\u00a0 ]*|salassa \(\.\.\.\)) avointa työpaikkaa/;
const cases = [
  // Markkinointikalenteri (ei verkkohakuja: pyyntöjä 0).
  ["tulevat_paivat", { alkaen: "2026-11-13", paivia: 30 }, (t) => t.includes("pe 27.11.2026 Black Friday") && t.includes("2 luku 11 §; pykälä koskee tavaroita") && !t.includes("ei palveluja") && t.includes("https://www.finlex.fi/fi/lainsaadanto/1978/38") && t.includes("ma 30.11.2026 Cyber Monday") && t.includes("Lapsen oikeuksien päivä") && t.includes("käsin ylläpidettyjä") && !t.includes("Joululoma"), 0],
  ["tulevat_paivat", { alkaen: "1.12.2026", paivia: 40, kunta: "Kotka", ennakko_paivia: 14 }, (t) => t.includes("su 20.12.2026 Joululoma alkaa (Kotka), 20.12.2026–6.1.2027") && t.includes("Kampanja alkaa: su 22.11.2026 (14 päivää ennen, ennen aikavälin alkua)") && t.includes("Varmista ne kunnan") && t.includes("Lähde: Opetushallitus"), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", loppuu: "2027-06-30", luokat: ["pyha", "aatto", "liputus_virallinen", "liputus_vakiintunut", "koululoma"], kunta: "Kotka" }, (t) => t.includes("pe 26.3.2027 Pitkäperjantai") && t.includes("su 28.3.2027 Pääsiäispäivä") && t.includes("to 6.5.2027 Helatorstai") && t.includes("su 18.4.2027 Eduskuntavaalit") && t.includes("la 26.6.2027 Juhannuspäivä") && t.includes("pe 25.6.2027 Juhannusaatto") && t.includes("Kaatuneitten muistopäivä") && t.includes("Ei tarjouksiin") && t.includes("la 5.6.2027 Koulu päättyy, kesäloma alkaa (Kotka)") && !t.includes("valtakunnallinen sääntö") && !t.includes("Black Friday"), 0],
  ["tulevat_paivat", { alkaen: "2027-01-01", paivia: 365, luokat: ["teema", "jarjesto"], ala: "kauneus" }, (t) => t.includes("Kansainvälinen naistenpäivä") && t.includes("Atopiapäivä") && t.includes("Maailman psoriasispäivä") && !t.includes("Maailman sydänpäivä") && t.includes("Kansainvälinen käsihygieniapäivä (World Hand Hygiene Day)") && !t.includes("Maailman käsihygieniapäivä") && t.includes("Vakiintunut suomenkielinen nimi (THL)") && t.includes("web.archive.org/web/20250505185900") && t.includes("Vakiintunutta suomenkielistä nimeä ei ole (tarkistettu 13.11.2026)") && t.includes("ei pidä esittää virallisena"), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", paivia: 60, luokat: ["aika"] }, (t) => t.includes("su 28.3.2027 Kesäaika alkaa") && t.includes("Päiviä: 1"), 0],
  ["tulevat_paivat", { alkaen: "2025-12-01" }, (t) => t.includes("kattaa vuodet 2026–2100"), 0],
  ["tulevat_paivat", { alkaen: "2026-12-01", paivia: 401 }, (t) => t.includes("1–400"), 0],
  ["tulevat_paivat", { alkaen: "31.2.2027" }, (t) => t.includes("ei ole päivämäärä"), 0],
  ["tulevat_paivat", { alkaen: "2026-12-01", kunta: "Helsinki" }, (t) => t.includes("Kunnan \"Helsinki\" koululomia ei ole taulukossa"), 0],
  ["koululomat", { kunta: "kotka" }, (t) => t.includes("Kotka, lukuvuosi 2026–2027") && t.includes("Syysloma: ma 19.10.2026–pe 23.10.2026") && t.includes("Joululoma: su 20.12.2026–ke 6.1.2027") && t.includes("Talviloma: ma 1.3.2027–pe 5.3.2027") && t.includes("Koulu päättyy: la 5.6.2027") && t.includes("tarkistettu 13.11.2026") && t.includes("suuntaa antavia"), 0],
  ["koululomat", { kunta: "Kotka", lukuvuosi: "2027–2028" }, (t) => t.includes("lukuvuoden 2027–2028 loma-aikoja ei ole taulukossa") && t.includes("la 3.6.2028") && t.includes("Lähde: perusopetuslaki 628/1998, 23 §, https://www.finlex.fi/fi/lainsaadanto/1998/628; perusopetusasetus 852/1998, 7 §"), 0],
  ["koululomat", { kunta: "Helsinki" }, (t) => t.includes("ei ole taulukossa") && /Lähde: perusopetuslaki 628\/1998.*852; Opetushallitus, https:\/\/www\.oph\.fi/.test(t), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", paivia: 60, luokat: "aika" }, (t) => t.includes("su 28.3.2027 Kesäaika alkaa") && t.includes("Päiviä: 1"), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", paivia: 60, luokat: "aika, kesä" }, (t) => t.includes("Tuntematon luokka: kesä"), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", luokat: 5 }, (t) => t.includes("luokat on lista"), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", ennakko_paivia: 0 }, (t) => t.includes("ennakko_paivia on kokonaisluku 1–120"), 0],
  ["tulevat_paivat", { alkaen: "2027-03-01", ennakko_paivia: 121 }, (t) => t.includes("ennakko_paivia on kokonaisluku 1–120"), 0],
  ["tulevat_paivat", { alkaen: "2027-06-01", paivia: 30, luokat: ["aatto"] }, (t) => t.includes("pe 25.6.2027 Juhannusaatto") && t.includes("https://intermin.fi/suomen-lippu/liputuspaivat"), 0],
  ["etsi_toimiala", { hakusana: "kauneudenhoito" }, (t) => t.includes("96220")],
  ["etsi_toimiala", { hakusana: "881" }, (t) => t.includes("88101")],
  ["hae_yrityksia", { toimiala: "96220", paikkakunta: "Kotka" }, (t) => t.includes("YTJ-haku") && t.includes("Toiminimet")],
  ["yrityksen_tiedot", { y_tunnus: "0112038-9" }, (t) => t.includes("Nokia Oyj") && t.includes("Rekisterit")],
  ["alueen_vaesto", { postinumerot: ["48100", "48600"] }, (t) => t.includes("48100") && t.includes("Mediaanitulo")],
  ["alueen_vaesto", { kunta: "Pyhtää" }, (t) => t.includes("Pyhtää")],
  ["aluetarkistus", { toimiala: "962", kunta: "Kotka", kohderyhma: "naiset" }, (t) => t.includes("Asukasta / yritys") && t.includes("Yhteensä")],
  ["aluetarkistus", { toimiala: "kotihoito", postinumerot: ["48100", "48600", "49220"], kohderyhma: "75+" }, (t) => t.includes("88101")],
  ["toimipaikat_maakunnittain", { toimiala: "96", maakunta: "Kymenlaakso" }, (t) => t.includes("Kymenlaakso") && /\d/.test(t)],
  ["aluetarkistus", { toimiala: "962", kunta: "Helsinki" }, (t) => t.includes("enintään")],
  // Sotkanet lukee D1:stä; Node-testissä kantaa ei ole, joten odotetaan selkeä ilmoitus.
  ["sote_indikaattorit", {}, (t) => t.includes("ei ole kytketty")],
  ["hintaindeksi", {}, (t) => t.includes("Pisteluku") && t.includes("Tilastokeskus")],
  ["indeksitarkistus", { lahtokohta: "2024-03", tarkistus: "2025-03", summa: 850 }, (t) => t.includes("Muutos") && t.includes("850,00")],
  ["indeksitarkistus", { indeksi: "elinkustannus", lahtokohta: "2023", tarkistus: "2025" }, (t) => t.includes("vuosikeskiarvot")],
  ["korot", { paiva: "2026-10-31" }, (t) => t.includes("viitekorko 1.7.2026–31.12.2026: 2,5 %") && t.includes("9,5 %") && t.includes("10,5 %")],
  // Verotiedot luetaan D1:stä; Node-testissä kantaa ei ole. Tilinpäätös haetaan PRH:lta.
  ["yrityksen_talous", { y_tunnus: "0100379-9", tilikausi: "2024-12-31" }, (t) => t.includes("Asuntotekniikka Oy") && /Rahoitustuotot ja -kulut \(netto, \+ = tuotto\): 13.493/.test(t) && t.includes("ei ole kytketty")],
  ["yrityksen_talous", { y_tunnus: "2474190-3" }, (t) => t.includes("ei ole digitaalista tilinpäätöstä")],
  ["yhteisoverot", { kunta: "Kotka" }, (t) => t.includes("ei ole kytketty")],
  ["hae_tilastoja", { hakusana: "väestö iän ja sukupuolen mukaan" }, (t) => t.includes("vaerak/") && t.includes("StatFin")],
  ["tilaston_rakenne", { taulukko: "vaerak/11rc" }, (t) => t.includes("ikaryhma_10_20180101 (Ikä)") && t.includes("85- = 85 -")],
  ["tilasto", { taulukko: "vaerak/11rc", valinnat: { Vuosi: "2024", Ikä: ["75 - 79", "80 - 84", "85 -"] } }, (t) => /75 - 79: 310.766/.test(t)],
  ["tilasto", { taulukko: "vaerak/11rc", valinnat: { Vuosi: "*", Ikä: "*", Sukupuoli: "*" } }, (t) => t.includes("enintään 3000")],
  ["hae_julkisia_palveluja", { alue: "Kymenlaakson hyvinvointialue", hakusana: "kotihoito" }, (t) => t.includes("Kotihoito (") && t.includes("palvelutietovaranto")],
  ["julkinen_palvelu", { palvelu: "72d2a7e0-1deb-4970-aac3-e8ff915ffb57" }, (t) => t.includes("Kymenlaakson hyvinvointialue") && t.includes("Palveluseteli: käytössä") && t.includes("Asiointikanavat")],
  ["asiakastarkistus", { y_tunnus: "0469852-2" }, (t) => t.includes("konkurssissa") && t.includes("HAVAINNOT") && t.includes("verovelkarekisteri".slice(1))],
  ["asiakastarkistus", { y_tunnus: "0100379-9" }, (t) => t.includes("Digitaalinen tilinpäätös") && t.includes("Julkisista rekistereistä ei löytynyt huomioitavaa")],
  ["saavutettavuusalue", { keskipiste: "48100", sade_km: 5 }, (t) => t.includes("Kotkansaari") && /Asukkaat alueella: \d/.test(t) && t.includes("CC BY 4.0")],
  ["saavutettavuusalue", { keskipiste: "60.4635, 26.9403", sade_km: 3, toimiala: "96220" }, (t) => t.includes("Kauneudenhoitopalvelut") && t.includes("per yritys")],
  ["kaupparekisteri_ilmoitukset", { y_tunnus: "3578202-2" }, (t) => t.includes("Guild Lounge Oy") && t.includes("Perusilmoitus (dnro 2025/558640)") && t.includes("CC BY 4.0")],
  ["kaupparekisteri_ilmoitukset", { asia: "konkurssi", alkaen: "2026-10-01", asti: "2026-10-31" }, (t) => t.includes("Konkurssi (KONALK)") && /Tiedonanto \(dnro [^)]+\): Konkurssi/.test(t)],
  ["kaupparekisteri_ilmoitukset", { asia: "uudet yritykset", paikkakunta: "Kotka", alkaen: "2026-10-01", asti: "2026-10-31" }, (t) => t.includes("Perusilmoitus") && t.includes("KOTKA")],
  ["kaupparekisteri_ilmoitukset", { ilmoitustyyppi: "perusilmoitus" }, (t) => t.includes("Koko maan haku vaatii asian")],
  // Koko maan viikko useammalla toimialalla (liidivahti): kaikki yritykset käydään läpi. Kuukautta ei testata, koska se kuluttaa PRH:n käyttörajan (429).
  ["kaupparekisteri_ilmoitukset", { asia: "uudet yritykset", toimiala: "96210, 96220, 96230, 86950, 86990, 93130", alkaen: "2026-11-02", asti: "2026-11-08" }, (t) => /käytiin läpi \d[\d\s]* eli kaikki/.test(t) && t.includes("Toimialoittain: 96210:") && t.includes("toimialat 96210")],
  ["kaupparekisteri_ilmoitukset", { asia: "uudet yritykset", alkaen: "2026-11-02", asti: "2026-11-08", toimiala: "74999, 62" }, (t) => t.includes("Kotisivu: https://")],
  ["kaupparekisteri_ilmoitukset", { asia: "uudet yritykset", toimiala: "1,2,3,4,5,6,7,8,9,10,11" }, (t) => t.includes("enintään 10 toimialaa")],
  ["korot", { paiva: "2024-03-15" }, (t) => t.includes("4,5 %") && t.includes("11,5 %")],
  ...(MML
    ? [
        ["osoitteen_sijainti", { osoite: "Keskuskatu 10, Kotka" }, (t) => t.includes("Keskuskatu 10 (Kotka)") && /60\.4\d+, 26\.9\d+/.test(t) && t.includes("postinumero 48100") && t.includes("Maanmittauslaitos")],
        ["saavutettavuusalue", { keskipiste: "Keskuskatu 10, Kotka", sade_km: 2 }, (t) => /Asukkaat alueella: \d/.test(t) && t.includes("Maanmittauslaitos")],
      ]
    : [
        ["osoitteen_sijainti", { osoite: "Keskuskatu 10, Kotka" }, (t) => t.includes("Geokoodausta ei ole kytketty")],
        ["saavutettavuusalue", { keskipiste: "Keskuskatu 10, Kotka" }, (t) => t.includes("Geokoodausta ei ole kytketty") && t.includes("koordinaatit")],
      ]),
  ["kela_etuudet", { alue: "Kotka", kuukausi: "2025-12" }, (t) => t.includes("Kotka (kunta), 12/2025") && t.includes("Lapsilisä |") && t.includes("Lähde: Kela")],
  ["kela_etuudet", { alue: "Kymenlaakso", vuosi: 2024 }, (t) => t.includes("Kymenlaakson hyvinvointialue (6 kuntaa), vuosi 2024") && t.includes("Vuositasolla ei ole")],
  ["kela_etuudet", { alue: "Helsinki", etuus: "lapsilisä", alkaen: "2025-01", kuukausi: "2025-06" }, (t) => t.includes("Lapsilisä, Helsinki") && t.includes("1/2025 |") && t.includes("6/2025 |")],
  ["kela_etuudet", { etuus: "tuki" }, (t) => t.includes("Useita etuuksia")],
  ["kela_vammaistuet", { alue: "Pyhtää", kuukausi: "2025-06" }, (t) => t.includes("Pyhtää (kunta), 6/2025") && t.includes("Eläkettä saavan hoitotuki") && t.includes("Ikäryhmä") && t.includes("Pienissä luvuissa")],
  ["kela_vammaistuet", { alue: "koko maa", kuukausi: "2019-06", sairausryhmat: true }, (t) => t.includes("Koko maa, 6/2019") && t.includes("F00-F99")],
  // ePerusteet (Opetushallitus). Neljäs arvo = ulkoisten pyyntöjen enimmäismäärä ilman välimuistia.
  ["hae_tutkintoja", { hakusana: "kosmetologi" }, (t) => t.includes("Hius- ja kauneudenhoitoalan perustutkinto (perustutkinto") && t.includes("Osuma: tutkintonimike Kosmetologi") && t.includes("OPH-7086-2025") && /OPH-5162-2024: siirtymäajalla 31\.7\.2030 asti/.test(t) && t.includes("uudempi peruste OPH-7086-2025") && t.includes("Lähde: Opetushallitus, ePerusteet"), 1],
  ["hae_tutkintoja", { hakusana: "hieronnan", tyyppi: "ammattitutkinto" }, (t) => t.includes("Hieronnan ammattitutkinto (ammattitutkinto") && !t.includes("erikoisammattitutkinto (") && t.includes("Osuma: osaamisala Koirahieronnan osaamisala"), 1],
  ["hae_tutkintoja", { hakusana: "lähihoitaja" }, (t) => t.includes("Sosiaali- ja terveysalan perustutkinto") && t.includes("OPH-7059-2025"), 1],
  ["hae_tutkintoja", { hakusana: "sosiaali- ja terveysalan erikoisammattitutkinto", voimassaolo: "tulevat" }, (t) => t.includes("OPH-191-2026: tulossa, voimaan 1.1.2027"), 1],
  ["hae_tutkintoja", { hakusana: "massage", kieli: "sv" }, (t) => t.includes("Specialyrkesexamen i massage") && t.includes("#/sv/ammatillinen/"), 1],
  ["hae_tutkintoja", { hakusana: "lentokapteeni" }, (t) => t.includes("ei löytynyt")],
  ["hae_tutkintoja", { hakusana: "a".repeat(201) }, (t) => t.includes("liian pitkä")],
  ["tutkinnon_peruste", { peruste: "OPH-7086-2025" }, (t) => t.includes("Hius- ja kauneudenhoitoalan perustutkinto (perustutkinto), peruste OPH-7086-2025") && t.includes("Kauneudenhoidon osaamisala (vähintään 125 osp)") && t.includes("- Kasvohoitokokonaisuuksien toteuttaminen, 40 osp") && t.includes("Määräys (PDF): https://eperusteet.opintopolku.fi/eperusteet-service/api/perusteet/9715351/liitteet/") && t.includes("/ammatillinen/9715351/tiedot"), 3],
  ["tutkinnon_peruste", { peruste: "Sosiaali- ja terveysalan perustutkinto", osaamisala: "ikääntyneiden" }, (t) => t.includes("peruste OPH-7059-2025") && t.includes("Tutkintonimike: Lähihoitaja") && t.includes("Pakolliset tutkinnon osat (vähintään 115 osp)") && t.includes("Rajattu pois:") && t.includes("Saman tutkinnon muut perusteet: OPH-4417-2023") && t.includes("julkiterhikki.lvv.fi"), 3],
  ["tutkinnon_peruste", { peruste: "OPH-1934-2018" }, (t) => t.includes("siirtymäajalla 31.7.2028 asti") && t.includes("- Tuki- ja liikuntaelinongelmaisen potilaan terveyden ja toimintakyvyn edistäminen, 70 osp")],
  ["tutkinnon_peruste", { peruste: "OPH-9999-2025" }, (t) => t.includes("ei löytynyt")],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025" }, (t) => t.includes("- Kasvohoitokokonaisuuksien toteuttaminen, 40 osp: pakollinen (Kauneudenhoidon osaamisala)") && t.includes("Yhteiset tutkinnon osat:"), 2],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "kasvohoito" }, (t) => t.includes("(tutkinnon osan koodi 107623), 40 osp") && t.includes("Kasvohoitokokonaisuuksien toteuttaminen:") && t.includes("- tekee ihoanalyysin") && t.includes("AMMATTITAIDON OSOITTAMISTAVAT") && t.includes("pyydä arviointi: true") && !t.includes("Kiitettävä 5") && t.includes("/tutkinnonosat/9715291"), 3],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "kasvohoito", hakusana: "hieronta", arviointi: true }, (t) => t.includes("Hakusana \"hieronta\": 1 vaatimus") && t.includes("klassisen hieronnan ottein") && !t.includes("tekee ihoanalyysin")],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "Kasvohoitokokonaisuuksien toteuttaminen", arviointi: true }, (t) => t.includes("ARVIOINTI") && t.includes("Tyydyttävä 1:") && t.includes("Kiitettävä 5:")],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "kasvohoito", kieli: "sv" }, (t) => t.includes("Att genomföra helheter för ansiktsbehandling") && t.includes("Den studerande") && t.includes("#/sv/ammatillinen/")],
  ["tutkinnon_osaaminen", { peruste: "OPH-1934-2018", tutkinnon_osa: "Tuki- ja liikuntaelinongelmaisen", arviointi: true }, (t) => t.includes("Opiskelija osaa") && t.includes("- arvioida erilaisten tuki- ja liikuntaelinongelmaisten") && t.includes("Hyväksytyn suorituksen kriteerit:") && t.includes("julkiterhikki.lvv.fi"), 3],
  ["tutkinnon_osaaminen", { peruste: "OPH-5085-2021", tutkinnon_osa: "ensihoidossa" }, (t) => t.includes("Ensihoidossa toimiminen (tutkinnon osan koodi 106225), 40 osp") && t.includes("pakollinen (Perustason ensihoidon osaamisala)") && t.includes("Opiskelija osaa")],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "Viestintä- ja vuorovaikutusosaaminen", hakusana: "ruotsi" }, (t) => t.includes("OSA-ALUE: Viestintä ja vuorovaikutus toisella kotimaisella kielellä, ruotsi (VVTK26)") && t.includes("Pakolliset osaamistavoitteet, 1 osp:") && t.includes("Asema tutkinnossa: pakollinen")],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "107623" }, (t) => t.includes("Kasvohoitokokonaisuuksien toteuttaminen (tutkinnon osan koodi 107623)"), 4],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "999999" }, (t) => t.includes("koodia 999999 ei ole perusteessa")],
  ["tutkinnon_osaaminen", { peruste: "OPH-7086-2025", tutkinnon_osa: "lentokoneen huolto" }, (t) => t.includes("ei löytynyt perusteesta OPH-7086-2025") && t.includes("- Ihokarvojen poistaminen")],
  // Avoimet työpaikat (KEHA-keskuksen työnvälitystilasto, StatFin). Neljäs arvo = pyyntöjen enimmäismäärä.
  ["avoimet_tyopaikat", { ammatti: ["kosmetologi"], alue: "Uusimaa" }, (t) => t.includes("5142 KOSMETOLOGIT YM., Uusimaa") && TP_NUM.test(t) && t.includes("Vuotta aiemmin") && monthLines(t) === 12 && t.includes("Maakunnat") && t.includes("(valittu alue)") && t.includes("51 Palvelutyöntekijät") && t.includes("Työmarkkinatorille") && t.includes("ei tarkoita nollaa") && t.includes("Lähde: KEHA-keskus, työnvälitystilasto; Tilastokeskus, StatFin (CC BY 4.0), https://stat.fi/tilasto/tyonv"), 3],
  ["avoimet_tyopaikat", { ammatti: ["kosmetologi"] }, (t) => t.includes("Alue: Koko maa") && t.includes("5142 KOSMETOLOGIT YM., Koko maa") && TP_NUM.test(t)],
  ["avoimet_tyopaikat", { ammatti: ["kampaaja"] }, (t) => t.includes("5141 KAMPAAJAT JA PARTURIT, Koko maa") && TP_NUM.test(t) && /Maakunnat \d{1,2}\/20\d\d \(koko maa \d/.test(t)],
  ["avoimet_tyopaikat", { ammatti: ["parturi-kampaaja"], alue: "Pirkanmaa", kuukausia: 12 }, (t) => t.includes("5141 KAMPAAJAT JA PARTURIT, Pirkanmaa") && monthLines(t) === 12],
  ["avoimet_tyopaikat", { ammatti: ["5142"], alue: "MK06", kuukausia: 36 }, (t) => t.includes("Pirkanmaa") && monthLines(t) === 36 && t.includes("Keskiarvo")],
  ["avoimet_tyopaikat", { ammatti: ["hieroja"], vertailu: true }, (t) => t.includes("5329 MUUT TERVEYDENHUOLTOALAN TYÖNTEKIJÄT") && t.includes("ei ole pelkkien hierojien") && /Työnhakijoita \d{1,2}\/20\d\d kuukauden aikana: \d/.test(t) && t.includes("työnhakijaa kohden") && t.includes("myös työssä olevat hakijat") && t.includes("avoimia | työnhakijoita | työttömiä")],
  ["avoimet_tyopaikat", { ammatti: ["kosmetologi", "parturi-kampaaja"], alue: "Kuopio", kuukausia: 3 }, (t) => t.includes("Alue: Pohjois-Savo (kunta Kuopio") && t.includes("5141 KAMPAAJAT JA PARTURIT, Pohjois-Savo") && t.includes("KUNTA KUOPIO") && /Avoimia työpaikkoja kuukauden laskentapäivänä \d{1,2}\/20\d\d: \d/.test(t) && t.includes("tyonv/12r5")],
  ["avoimet_tyopaikat", { ammatti: ["lähihoitaja"], kuukausia: 1 }, (t) => t.includes("5321 LÄHIHOITAJAT, Koko maa") && t.includes("ryhmässä 5322 Kodinhoitajat") && t.includes("koodilla 5322")],
  ["avoimet_tyopaikat", { ammatti: ["kosmetologi"], kuukausia: 0 }, (t) => t.includes("kuukausia on kokonaisluku 1–36"), 0],
  ["avoimet_tyopaikat", { ammatti: ["kosmetologi"], kuukausia: 37 }, (t) => t.includes("kuukausia on kokonaisluku 1–36"), 0],
  ["avoimet_tyopaikat", { ammatti: ["avaruuslentäjä"] }, (t) => t.includes("Ammattia \"avaruuslentäjä\" ei löytynyt") && t.includes("tilaston_rakenne")],
  ["avoimet_tyopaikat", { ammatti: ["opettaja"] }, (t) => t.includes("vastaa useaa ammattiryhmää") && t.includes("2320 Ammatillisen koulutuksen opettajat")],
  ["avoimet_tyopaikat", { ammatti: ["kampaaja"], alue: "Atlantis" }, (t) => t.includes("Aluetta \"Atlantis\" ei löytynyt")],
];
for (const [name, args, pred, maxFetch] of cases) {
  const t0 = Date.now();
  fetchCount = 0;
  const r = await tool(name, args);
  const ok = pred(r.text) && (maxFetch === undefined || fetchCount <= maxFetch);
  check(ok, `${name} ${JSON.stringify(args)} (${Date.now() - t0} ms${maxFetch !== undefined ? `, pyyntöjä ${fetchCount}/${maxFetch}` : ""})`);
  if (show || !ok) console.log(r.text.slice(0, 3000), "\n------");
}

// Virhetekstit (22.11.2026): odottamattoman poikkeuksen teksti ei näy vastauksessa eikä lokissa;
// tarkoitukselliset virheet (syötteen muoto, lähteen tila, NaytettavaVirhe) näkyvät yhä.
// Lopussa, koska vale-fetch voisi jättää isolaatin muistiin tyhjiä tuloksia muille testeille.
{
  const SALAISUUS = "SISAINEN-salaisuus-xyz";
  const orig = globalThis.fetch;
  const origErr = console.error;
  const loki = [];
  console.error = (...a) => loki.push(a.map(String).join(" "));
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => { throw new Error(SALAISUUS); },
      json: async () => { throw new Error(SALAISUUS); },
      arrayBuffer: async () => { throw new Error(SALAISUUS); },
    });
    const r = await tool("yrityksen_tiedot", { y_tunnus: "0112038-9" });
    check(r.isError && !r.text.includes(SALAISUUS) && r.text.includes("Haku epäonnistui"), "virheteksti: odottamaton poikkeus piilotetaan vastauksesta");
    check(loki.length > 0 && !loki.some((l) => l.includes(SALAISUUS)) && loki.some((l) => l.includes("yrityksen_tiedot") && l.includes("Error")), "virheteksti: lokiin vain työkalu ja virheen nimi");
    globalThis.fetch = async () => new Response("", { status: 403 });
    const f = await tool("yrityksen_tiedot", { y_tunnus: "0112038-9" });
    check(f.isError && f.text.includes("Tietolähteen haku epäonnistui: Lähde vastasi 403"), "virheteksti: lähteen tila (403) näkyy yhä");
    const meta = { title: "Koe", variables: [{ code: "Vuosi", text: "Vuosi", values: ["2024"], valueTexts: ["2024"], time: true }] };
    globalThis.fetch = async () => new Response(JSON.stringify(meta), { status: 200 });
    const n = await tool("tilasto", { taulukko: "vaerak/koe1", valinnat: { Tuntematon: "1" } });
    check(n.isError && n.text.includes('Muuttujaa "Tuntematon" ei ole taulukossa'), "virheteksti: NaytettavaVirhe (StatFinin valintavirhe) näkyy yhä");
  } finally {
    globalThis.fetch = orig;
    console.error = origErr;
  }
  const u = await tool("yrityksen_tiedot", { y_tunnus: "abc" });
  check(u.isError && u.text.includes("Anna y-tunnus muodossa"), "virheteksti: syötteen muotovirhe näkyy yhä");
}

// Rakenteinen tulos (koodiajo-valmius): rungon testitila tarkistaa structuredContentin tulosSkeemaa vasten ja vaatii
// lahde.nimen; poikkeama heittää, jolloin testi kaatuu.
{
  const varoitukset = [];
  const testi = luoPalvelin({ ...ASETUKSET, tarkistaTulokset: true, varoita: (v) => varoitukset.push(v) });
  const kutsu = async (name, args) => {
    const req = new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
    });
    return (await (await testi.fetch(req, ENV)).json()).result;
  };
  const lista = (await rpc("tools/list", {})).result.tools;
  const rakenteiset = lista.filter((t) => t.outputSchema).map((t) => t.name).sort();
  check(
    JSON.stringify(rakenteiset) ===
      '["alueen_vaesto","aluetarkistus","etsi_toimiala","hae_julkisia_palveluja","hae_tilastoja","hae_yrityksia","hintaindeksi","indeksitarkistus","korot","koululomat","tilasto","tulevat_paivat","yrityksen_tiedot"]',
    `rakenteinen: outputSchema 13 työkalulla (${rakenteiset.join(", ")})`,
  );
  check(!varoitukset.length, `rakenteinen: ei testitilan varoituksia${varoitukset.length ? ` (${varoitukset.join("; ")})` : ""}`);
  const e = await kutsu("etsi_toimiala", { hakusana: "962" });
  check(!e.isError && e.structuredContent.osumat.some((o) => o.koodi === "96220" && o.taso === 5) && e.content[0].text.includes("96220 Kauneudenhoitopalvelut"), "rakenteinen: etsi_toimiala osumat ja teksti");
  const y = await kutsu("hae_yrityksia", { toimiala: "96220", paikkakunta: "Kotka" });
  const ys = y.structuredContent;
  check(!y.isError && ys.yritykset.length > 0 && ys.yritykset.every((x) => x.y_tunnus && x.toimiva) && ys.lahde.linkki.startsWith("https://avoindata.prh.fi/") && ys.seuraava === null, "rakenteinen: hae_yrityksia yritykset, lähde ja sivutus");
  check(y.content[0].text.split("\n").filter((l) => l.startsWith("- ")).length === ys.yritykset.length, "rakenteinen: hae_yrityksia tekstin rivit = yritykset");
  const s = await kutsu("tilasto", { taulukko: "vaerak/11rc", valinnat: { Vuosi: "2024", Ikä: ["75 - 79", "80 - 84", "85 -"] } });
  const ss = s.structuredContent;
  check(!s.isError && ss.rivit.length === 3 && ss.rivit.some((r) => r.tekstit[0] === "75 - 79" && r.arvo === 310766) && ss.lahde.linkki.endsWith("/vaerak/11rc.px"), "rakenteinen: tilasto rivit ja lähde");
  const v = await kutsu("hae_yrityksia", { toimiala: "96220", sivu: "2" });
  check(v.isError && v.content[0].text.startsWith("Syöte ei kelpaa") && !v.structuredContent, "rakenteinen: väärän tyyppinen syöte on syötevirhe (tarkistaSyote)");
  check(ys.katkaistu === false && ys.naytetty === ys.yritykset.length && ys.rivit_yhteensa === ys.yritykset.length, "rakenteinen: hae_yrityksia ei katkaistu (katkaistu, naytetty, rivit_yhteensa)");
  check(ss.katkaistu === false && ss.naytetty === 3 && ss.rivit_yhteensa === 3, "rakenteinen: tilasto ei katkaistu");
  // Sivu yli viimeisen: sivuja kokonaismäärästä, ei pyydetystä sivusta; yhteensa on aina luku.
  const yli = await kutsu("hae_yrityksia", { toimiala: "96220", paikkakunta: "Kotka", sivu: 99 });
  const ylis = yli.structuredContent;
  check(!yli.isError && ylis.sivu === 99 && ylis.sivuja === ys.sivuja && ylis.seuraava === null && Number.isInteger(ylis.yhteensa) && ylis.yritykset.length === 0, `rakenteinen: hae_yrityksia sivu yli viimeisen (sivuja ${ylis?.sivuja})`);
  // Rajaus: pitkä tilasto katkaistaan tekstissä, ja rakenteisessa tuloksessa ovat vain tekstissä kokonaan näkyvät rivit.
  const p = await kutsu("tilasto", { taulukko: "alyr/13wz", valinnat: { Vuosi: "viimeiset 2", Kunta: "*", Tiedot: "*" } });
  const ps = p.structuredContent;
  const viim = ps?.rivit.at(-1);
  const viimRivi = viim ? `${viim.tekstit.join(" | ")}: ` : "";
  check(!p.isError && ps.katkaistu === true && ps.naytetty === ps.rivit.length && ps.naytetty < ps.rivit_yhteensa && p.content[0].text.includes("Tuloste katkaistu") && p.content[0].text.includes(`\n${viimRivi}`) && JSON.stringify(ps).length < 100000, `rakenteinen: tilasto rajattu tekstin rajaan (${ps?.naytetty}/${ps?.rivit_yhteensa})`);
  const t = await kutsu("tilasto", { taulukko: "huono" });
  check(t.isError && t.content[0].text.includes("alue/taulukko"), "rakenteinen: liittimen syötevirheen teksti ennallaan");
  // 1.16.0: alueen_vaesto, aluetarkistus ja hae_tilastoja.
  const av = await kutsu("alueen_vaesto", { postinumerot: ["48100", "48600"] });
  const avs = av.structuredContent;
  check(
    !av.isError && avs.postinumeroalueet.length === 2 && avs.postinumeroalueet.every((r) => r.asukkaat > 0) && avs.yhteensa.asukkaat === avs.postinumeroalueet[0].asukkaat + avs.postinumeroalueet[1].asukkaat && av.content[0].text.startsWith(`Väestö ${avs.vuosi}, `),
    "rakenteinen: alueen_vaesto alueet, summa ja vuosi",
  );
  const av1 = await kutsu("alueen_vaesto", { postinumerot: ["48100"] });
  check(!av1.isError && av1.structuredContent.yhteensa === null, "rakenteinen: alueen_vaesto yksi alue, yhteensa null");
  const at = await kutsu("aluetarkistus", { toimiala: "96220", postinumerot: ["48100", "48600"], kohderyhma: "naiset" });
  const ats = at.structuredContent;
  const atRivit = at.content[0].text.split("\n").filter((l) => l.startsWith("- ")).length;
  check(
    !at.isError && ats.kohderyhma.tunnus === "naiset" && ats.postinumeroalueet.length === 2 && ats.yhteensa.yrityksia === ats.postinumeroalueet.reduce((s, r) => s + r.yrityksia, 0) && ats.yritykset.length === atRivit && ats.katkaistu === false && ats.rivit_yhteensa === atRivit && ats.lahteet.length === 2,
    `rakenteinen: aluetarkistus alueet, yritykset (${atRivit}) ja lähteet`,
  );
  const at2 = await kutsu("aluetarkistus", { toimiala: "96220", postinumerot: ["48100"], nayta_yritykset: false });
  check(!at2.isError && at2.structuredContent.yritykset.length === 0 && at2.structuredContent.nayta_yritykset === false && !at2.content[0].text.includes("\nYritykset:\n"), "rakenteinen: aluetarkistus ilman yrityslistaa");
  const ht = await kutsu("hae_tilastoja", { hakusana: "väestö" });
  const hts = ht.structuredContent;
  check(
    !ht.isError && hts.taulukot.length === 20 && hts.seuraava === 2 && hts.sivuja > 1 && hts.taulukot.every((x) => ht.content[0].text.includes(`${x.tunnus} ${x.otsikko}`)),
    "rakenteinen: hae_tilastoja taulukot ja sivutus",
  );
  const ht0 = await kutsu("hae_tilastoja", { hakusana: "qwxzyv" });
  check(!ht0.isError && ht0.structuredContent.yhteensa === 0 && ht0.structuredContent.taulukot.length === 0 && ht0.content[0].text.includes("ei löytynyt"), "rakenteinen: hae_tilastoja ei osumia");
  // 1.17.0: yrityksen_tiedot, hintaindeksi, indeksitarkistus, korot, hae_julkisia_palveluja, tulevat_paivat ja koululomat.
  const yt = await kutsu("yrityksen_tiedot", { y_tunnus: "0112038-9" });
  const yts = yt.structuredContent;
  check(!yt.isError && yts.loytyi === true && yts.nimi === "Nokia Oyj" && yts.toimiva === true && yts.rekisterit.length > 0 && yts.lahde.linkki.includes("0112038-9"), "rakenteinen: yrityksen_tiedot");
  const yt0 = await kutsu("yrityksen_tiedot", { y_tunnus: "1234567-1" });
  check(!yt0.isError && yt0.structuredContent.loytyi === false && yt0.content[0].text.includes("ei löytynyt"), "rakenteinen: yrityksen_tiedot ei löytynyt");
  const hi = await kutsu("hintaindeksi", { alkaen: "2024-01", paattyen: "2024-12" });
  const his = hi.structuredContent;
  check(!hi.isError && his.kuukaudet.length === 12 && his.alkaen === "2024-01" && his.paattyen === "2024-12" && his.vuosimuutos_peruste === "virallinen" && his.indeksi.tunnus === "khi", "rakenteinen: hintaindeksi");
  const it = await kutsu("indeksitarkistus", { lahtokohta: "2024-03", tarkistus: "2025-03", summa: 850 });
  const its = it.structuredContent;
  check(!it.isError && its.lahtokohta.ajankohta === "2024-03" && its.tarkistus.viimeisin_julkaistu === false && Math.abs(its.summa.tarkistettu - 850 * its.kerroin) < 1e-9, "rakenteinen: indeksitarkistus");
  const ko = await kutsu("korot", { paiva: "2026-10-31", historia: true });
  const kos = ko.structuredContent;
  check(!ko.isError && kos.viitekorko.korko === 2.5 && kos.viitekorko.viivastyskorko === 9.5 && kos.ohjauskorot.length === 3 && kos.historia.length > 10, "rakenteinen: korot");
  const ko0 = await kutsu("korot", { paiva: "2005-03-01" });
  check(!ko0.isError && ko0.structuredContent.viitekorko_ennen_2009 === true && ko0.structuredContent.viitekorko === null && ko0.structuredContent.historia === null, "rakenteinen: korot ennen 2009");
  const jp = await kutsu("hae_julkisia_palveluja", { alue: "Kymenlaakson hyvinvointialue", hakusana: "kotihoito" });
  const jps = jp.structuredContent;
  check(!jp.isError && jps.palvelut.length > 0 && jps.palvelut.length === jps.naytetty && jps.katkaistu === false && jps.palvelut.every((p) => jp.content[0].text.includes(`(${p.tunniste})`)), "rakenteinen: hae_julkisia_palveluja");
  const tp = await kutsu("tulevat_paivat", { alkaen: "1.12.2026", paivia: 40, kunta: "Kotka", ennakko_paivia: 14 });
  const tps = tp.structuredContent;
  check(!tp.isError && tps.paivat.length > 0 && tps.kunta === "Kotka" && tps.ennakko_paivia === 14 && tps.paivat.every((p) => p.kampanja_alkaa) && tps.katkaistu === false, "rakenteinen: tulevat_paivat");
  const tpm = await kutsu("tulevat_paivat", { alkaen: "2027-03-01", paivia: 60, luokat: "aika" });
  check(!tpm.isError && tpm.structuredContent.luokat[0] === "aika", "rakenteinen: tulevat_paivat luokat merkkijonona (oma syötteen käsittely)");
  const tpl = await kutsu("tulevat_paivat", { alkaen: "2026-11-25", paivia: 400 });
  const tpls = tpl.structuredContent;
  check(!tpl.isError && tpls.naytetty === tpls.paivat.length && tpls.rivit_yhteensa >= tpls.naytetty && tpl.content[0].text.includes(`Päiviä: ${tpls.rivit_yhteensa}`), `rakenteinen: tulevat_paivat 400 päivää (${tpls?.naytetty}/${tpls?.rivit_yhteensa})`);
  const kl = await kutsu("koululomat", { kunta: "kotka", lukuvuosi: "2026-2027" });
  const kls = kl.structuredContent;
  check(!kl.isError && kls.tila === "loytyi" && kls.kunta === "Kotka" && kls.loma_ajat.syysloma.alkaa === "2026-10-19", "rakenteinen: koululomat");
  const kl0 = await kutsu("koululomat", { kunta: "Helsinki" });
  check(!kl0.isError && kl0.structuredContent.tila === "kunta_ei_taulukossa" && kl0.structuredContent.loma_ajat === null, "rakenteinen: koululomat kunta ei taulukossa");
}

// Salainen polku: kun MCP_PATH_SECRET on asetettu, vain /mcp/<salaisuus> vastaa (sama kuin ennen runkoa).
{
  const S = "testisalaisuus-123456";
  const pyynto = (polku) => new Request(`https://example.test${polku}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/list", params: {} }),
  });
  const julkinen = await worker.fetch(pyynto("/mcp"), { MCP_PATH_SECRET: S });
  const salainen = await worker.fetch(pyynto(`/mcp/${S}`), { MCP_PATH_SECRET: S });
  check(julkinen.status === 404 && salainen.status === 200, `salainen polku: /mcp ${julkinen.status}, /mcp/<salaisuus> ${salainen.status}`);
}
