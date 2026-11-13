// Savutesti oikeita lähteitä (YTJ, Tilastokeskus, ePerusteet ym.) vasten. Ajo: node test/smoke.mjs [-v]
import worker from "../src/index.js";

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
check(init.result?.serverInfo?.name === "aluetieto" && init.result.instructions.includes("tutkinnon_osaaminen"), "initialize");
const list = await rpc("tools/list", {});
check(list.result?.tools?.length === 27 && list.result.tools.every((t) => t.annotations?.readOnlyHint), "tools/list (27, readOnlyHint)");

const show = process.argv.includes("-v");
const cases = [
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
];
for (const [name, args, pred, maxFetch] of cases) {
  const t0 = Date.now();
  fetchCount = 0;
  const r = await tool(name, args);
  const ok = pred(r.text) && (maxFetch === undefined || fetchCount <= maxFetch);
  check(ok, `${name} ${JSON.stringify(args)} (${Date.now() - t0} ms${maxFetch !== undefined ? `, pyyntöjä ${fetchCount}/${maxFetch}` : ""})`);
  if (show || !ok) console.log(r.text.slice(0, 3000), "\n------");
}
