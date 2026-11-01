// Savutesti oikeita lähteitä (YTJ, Tilastokeskus) vasten. Ajo: node test/smoke.mjs [-v]
import worker from "../src/index.js";

let id = 0;
async function rpc(method, params) {
  const req = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return (await worker.fetch(req, {})).json();
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
check(init.result?.serverInfo?.name === "aluetieto", "initialize");
const list = await rpc("tools/list", {});
check(list.result?.tools?.length === 16 && list.result.tools.every((t) => t.annotations?.readOnlyHint), "tools/list (16, readOnlyHint)");

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
  ["korot", { paiva: "2024-03-15" }, (t) => t.includes("4,5 %") && t.includes("11,5 %")],
];
for (const [name, args, pred] of cases) {
  const t0 = Date.now();
  const r = await tool(name, args);
  const ok = pred(r.text);
  check(ok, `${name} ${JSON.stringify(args)} (${Date.now() - t0} ms)`);
  if (show || !ok) console.log(r.text.slice(0, 3000), "\n------");
}
