// MCP-työkalut: määrittelyt ja toteutukset.

import { BudgetError, HttpError, newBudget } from "./http.js";
import {
  searchCompanies,
  searchAll,
  currentName,
  auxNames,
  isActive,
  statusText,
  situations,
  businessLine,
  companyForm,
  address,
  registers,
  COMPANY_FORMS,
} from "./ytj.js";
import { postAreas, areasOfMunicipality, population, establishments, establishmentsMeta } from "./stat.js";
import { TOL2025 } from "./tol2025.js";
import { seriesInfo, indexSeries, khiAnnualChange, parsePeriod, periodLabel, yearBefore, ecbRates, rateOn, referenceRate, periodStart, periodEnd, FIRST_REFERENCE_PERIOD } from "./talous.js";
import { financialPeriods, financialStatement, mcLabel, PL_MAIN, BS_MAIN, veroLoaded, veroForCompany, veroTop, veroKunta } from "./yritystalous.js";
import { listIndicators, findIndicator, findRegions, countryRegion, values as soteValues, categoryLabel, pendingYears } from "./sotkanet.js";

const MAX_OUTPUT = 50_000;
const MAX_POSTCODES = 30;

const YTJ_NOTE =
  "Huom: YTJ:n avoimessa datassa ovat vain kaupparekisteriin merkityt yhteisöt (oy, ky, ay, osuuskunta ym.). Toiminimet eli yksityiset elinkeinonharjoittajat puuttuvat, joten esimerkiksi kauneudenhoidossa todellinen yritysmäärä on selvästi suurempi.";

const TARGETS = {
  kaikki: { key: "total", label: "asukkaat yhteensä" },
  naiset: { key: "women", label: "naiset" },
  "0-17": { key: "age0_17", label: "0–17-vuotiaat" },
  "18-64": { key: "age18_64", label: "18–64-vuotiaat" },
  "65+": { key: "age65p", label: "65 vuotta täyttäneet" },
  "75+": { key: "age75p", label: "75 vuotta täyttäneet" },
};

const SOURCES_FOOTER =
  "Lähteet: Patentti- ja rekisterihallitus, YTJ avoin data; Tilastokeskus, Paavo – postinumeroalueittainen avoin tieto (CC BY 4.0).";

// ---------- Määrittelyt ----------

const areaProps = {
  postinumerot: {
    type: "array",
    items: { type: "string" },
    description: `Postinumerot, esim. ["48100", "48600"]. Enintään ${MAX_POSTCODES}.`,
  },
  kunta: { type: "string", description: "Kunnan nimi, esim. \"Kotka\". Käytetään, jos postinumeroita ei anneta." },
};

export const TOOLS = [
  {
    name: "etsi_toimiala",
    description:
      "Etsii toimialaluokituksen TOL 2025 koodeja nimen osalla tai koodilla (esim. \"kauneudenhoito\" -> 96220, \"kotihoito\" -> 88101). YTJ käyttää TOL 2025 -koodeja. Lyhyempi koodi (esim. \"962\") kattaa kaikki sen alaluokat.",
    inputSchema: {
      type: "object",
      properties: { hakusana: { type: "string", description: "Nimen osa tai koodin alku." } },
      required: ["hakusana"],
    },
  },
  {
    name: "hae_yrityksia",
    description:
      "Hakee yrityksiä PRH:n YTJ-tiedoista toimialan, postinumeron, postitoimipaikan, nimen tai yritysmuodon perusteella. Palauttaa nimen, y-tunnuksen, toimialan, yritysmuodon, osoitteen ja tilan. Toiminimet eivät ole mukana avoimessa datassa.",
    inputSchema: {
      type: "object",
      properties: {
        toimiala: { type: "string", description: "TOL 2025 -koodi tai sen alku (esim. \"96220\", \"962\") tai toimialan nimi." },
        postinumero: { type: "string", description: "Käynti- tai postiosoitteen postinumero." },
        paikkakunta: { type: "string", description: "Postitoimipaikka, esim. \"Kotka\"." },
        nimi: { type: "string", description: "Toiminimi tai sen osa." },
        yritysmuoto: { type: "string", enum: Object.keys(COMPANY_FORMS), description: "Yritysmuoto, esim. OY, KY, AY, OK." },
        rekisteroity_alkaen: { type: "string", description: "Rekisteröity aikaisintaan (vvvv-kk-pp). Uusien yritysten seurantaan." },
        rekisteroity_paattyen: { type: "string", description: "Rekisteröity viimeistään (vvvv-kk-pp)." },
        vain_toimivat: { type: "boolean", description: "Vain kaupparekisterissä olevat, toimivat yritykset (oletus true)." },
        sivu: { type: "integer", description: "Tulossivu (100 yritystä/sivu)." },
      },
    },
  },
  {
    name: "yrityksen_tiedot",
    description:
      "Palauttaa yhden yrityksen YTJ-tiedot y-tunnuksella: nimet ja aputoiminimet, yritysmuoto, päätoimiala, osoite, rekisterit (kaupparekisteri, ALV, ennakkoperintä, työnantajarekisteri), tila ja mahdollinen konkurssi, saneeraus tai selvitystila.",
    inputSchema: {
      type: "object",
      properties: { y_tunnus: { type: "string", description: "Y-tunnus, esim. \"0112038-9\"." } },
      required: ["y_tunnus"],
    },
  },
  {
    name: "alueen_vaesto",
    description:
      "Palauttaa Tilastokeskuksen Paavo-tiedoista asukasmäärän, sukupuolijakauman, keski-iän, ikäryhmät (0–17, 18–64, 65+, 75+) ja mediaanitulot postinumeroalueittain. Anna postinumerot tai kunta.",
    inputSchema: {
      type: "object",
      properties: {
        ...areaProps,
        vuosi: { type: "integer", description: "Tilastovuosi (oletus uusin)." },
      },
    },
  },
  {
    name: "aluetarkistus",
    description:
      "Laskee alueen yritysten määrän toimialalla (YTJ) ja vertaa sitä asukasmäärään (Paavo) postinumeroalueittain: toimijoita, asukkaita ja asukasta per toimija. Kohderyhmänä voi käyttää esim. naisia tai 75 vuotta täyttäneitä. Toiminimet puuttuvat YTJ:n avoimesta datasta, joten toimijamäärä on alaraja.",
    inputSchema: {
      type: "object",
      properties: {
        toimiala: { type: "string", description: "TOL 2025 -koodi tai sen alku, esim. \"96220\" tai \"962\"." },
        ...areaProps,
        kohderyhma: { type: "string", enum: Object.keys(TARGETS), description: "Väestöryhmä, johon toimijamäärää verrataan (oletus kaikki)." },
        nayta_yritykset: { type: "boolean", description: "Listaa löydetyt yritykset (oletus true)." },
      },
      required: ["toimiala"],
    },
  },
  {
    name: "toimipaikat_maakunnittain",
    description:
      "Tilastokeskuksen yritysten toimipaikkatilasto maakunnittain ja toimialoittain: toimipaikkojen määrä ja henkilöstö. Sisältää myös toiminimet, toisin kuin YTJ. Toimialaluokitus on TOL 2008, ja maakuntatasolla tietoa on yleensä vain kahden numeron tasolla (esim. 96 Muut henkilökohtaiset palvelut, 88 Sosiaalihuollon avopalvelut).",
    inputSchema: {
      type: "object",
      properties: {
        toimiala: { type: "string", description: "TOL 2008 -koodi (esim. \"96\", \"88\") tai nimen osa." },
        maakunta: { type: "string", description: "Maakunnan nimi, esim. \"Kymenlaakso\". Tyhjä = koko maa ja kaikki maakunnat." },
      },
      required: ["toimiala"],
    },
  },
  {
    name: "sote_indikaattorit",
    description:
      "Listaa Sotkanetista (THL) ladatut sote- ja väestöindikaattorit: tunnus, nimi, tuottaja, yksikkö, vuodet ja päivityspäivä. Mukana mm. säännöllisen kotihoidon asiakasosuudet ikäryhmittäin, kotona asuvat ja yksinasuvat 75 vuotta täyttäneet, omaishoidon tuki, ympärivuorokautinen palveluasuminen, ikärakenne ja väestöennusteet 2030 ja 2040.",
    inputSchema: {
      type: "object",
      properties: { hakusana: { type: "string", description: "Rajaa nimen osalla (valinnainen)." } },
    },
  },
  {
    name: "sote_tilasto",
    description:
      "Palauttaa yhden Sotkanet-indikaattorin arvot kunnille, hyvinvointialueille tai maakunnille vuosittain (enintään 6 viimeisintä vuotta) sekä vertailuksi koko maan arvon. Anna indikaattorin tunnus tai nimen osa ja alueiden nimet, esim. [\"Kotka\", \"Pyhtää\", \"Kymenlaakson hyvinvointialue\"].",
    inputSchema: {
      type: "object",
      properties: {
        indikaattori: { type: "string", description: "Indikaattorin tunnus (esim. \"5513\") tai nimen osa." },
        alueet: { type: "array", items: { type: "string" }, description: "Alueiden nimet: kunta, hyvinvointialue, maakunta tai seutukunta." },
        vuodet: { type: "array", items: { type: "integer" }, description: "Rajaa vuosiin (valinnainen)." },
      },
      required: ["indikaattori", "alueet"],
    },
  },
  {
    name: "yrityksen_talous",
    description:
      "Yrityksen taloustiedot kahdesta avoimesta lähteestä: (1) PRH:n digitaalinen tilinpäätös (tuloslaskelma ja tase, edellinen tilikausi vertailuna) niiltä yrityksiltä, jotka ovat ilmoittaneet tilinpäätöksen iXBRL-muodossa, ja (2) Verohallinnon yhteisöjen tuloverotuksen julkiset tiedot vuosittain (verotettava tulo, maksuunpannut verot, veronpalautus, jäännösvero, muutosverotus). Anna Y-tunnus tai nimi.",
    inputSchema: {
      type: "object",
      properties: {
        y_tunnus: { type: "string", description: "Y-tunnus, esim. 2474190-3." },
        nimi: { type: "string", description: "Yrityksen nimi, jos Y-tunnus ei ole tiedossa (haku YTJ:stä)." },
        tilikausi: { type: "string", description: "Tilikauden päättymispäivä (vvvv-kk-pp). Oletus: uusin digitaalinen tilinpäätös." },
        kaikki_erat: { type: "boolean", description: "true = kaikki tilinpäätöksen erät, ei vain keskeisiä." },
      },
    },
  },
  {
    name: "yhteisoverot",
    description:
      "Verohallinnon yhteisöjen tuloverotuksen julkiset tiedot listana: kunnan tai koko maan suurimmat yhteisöveron maksajat tai verotettavan tulon mukaan, valinnaisesti nimen osalla rajattuna, sekä yhteissummat. Kunta on yhteisön kotikunta kaupparekisterissä.",
    inputSchema: {
      type: "object",
      properties: {
        kunta: { type: "string", description: "Kunnan nimi tai numero (esim. \"Kotka\" tai \"285\"). Valinnainen; ilman kuntaa koko maa." },
        vuosi: { type: "integer", description: "Verovuosi. Oletus: uusin ladattu." },
        jarjestys: { type: "string", enum: ["verot", "tulo"], description: "verot (oletus) = maksuunpannut verot, tulo = verotettava tulo." },
        hakusana: { type: "string", description: "Nimen osa, esim. \"hoiva\" tai \"kotihoito\". Valinnainen." },
        sivu: { type: "integer", description: "Tulossivu, 1 = ensimmäinen (25 riviä sivulla)." },
      },
    },
  },
  {
    name: "hintaindeksi",
    description:
      "Kuluttajahintaindeksin tai elinkustannusindeksin pisteluvut ja vuosimuutos kuukausittain (Tilastokeskus). Oletuksena viimeiset 13 kuukautta. Inflaatio, hintojen nousu, indeksisidonnaiset sopimukset.",
    inputSchema: {
      type: "object",
      properties: {
        indeksi: { type: "string", enum: ["khi", "elinkustannus"], description: "khi = kuluttajahintaindeksi (oletus), elinkustannus = elinkustannusindeksi 1951:10=100." },
        perusvuosi: { type: "string", description: "Kuluttajahintaindeksin perusvuosi: 2015 (oletus), 2025, 2010, 2005, 2000, 1995 … 1972." },
        alkaen: { type: "string", description: "Ensimmäinen kuukausi (VVVV-KK). Valinnainen." },
        paattyen: { type: "string", description: "Viimeinen kuukausi (VVVV-KK). Oletus: viimeisin julkaistu." },
      },
    },
  },
  {
    name: "indeksitarkistus",
    description:
      "Laskee indeksitarkistuksen (esim. vuokran tai sopimushinnan korotus) kuluttajahinta- tai elinkustannusindeksillä: pisteluvut lähtö- ja tarkistusajankohtana, muutosprosentti, kerroin ja tarkistettu summa.",
    inputSchema: {
      type: "object",
      properties: {
        indeksi: { type: "string", enum: ["khi", "elinkustannus"], description: "khi = kuluttajahintaindeksi (oletus), elinkustannus = elinkustannusindeksi 1951:10=100." },
        perusvuosi: { type: "string", description: "Kuluttajahintaindeksin perusvuosi, esim. 2015 (oletus) tai 2010." },
        lahtokohta: { type: "string", description: "Perusindeksin ajankohta: kuukausi (VVVV-KK, esim. \"2024-03\") tai vuosi (VVVV, vuosikeskiarvo)." },
        tarkistus: { type: "string", description: "Tarkistusajankohta samassa muodossa. Oletus: viimeisin julkaistu." },
        summa: { type: "number", description: "Tarkistettava summa, esim. nykyinen vuokra. Valinnainen." },
      },
      required: ["lahtokohta"],
    },
  },
  {
    name: "korot",
    description:
      "Korkolain viitekorko ja viivästyskorot (tavallinen ja kaupallisten sopimusten) annettuna päivänä sekä EKP:n ohjauskorot (talletuskorko, perusrahoitusoperaatiot, maksuvalmiusluotto). Valinnaisesti viitekorkojen historia puolivuosittain vuodesta 2009.",
    inputSchema: {
      type: "object",
      properties: {
        paiva: { type: "string", description: "Päivä (VVVV-KK-PP). Oletus: tänään." },
        historia: { type: "boolean", description: "true = myös viitekorot puolivuosittain." },
      },
    },
  },
];

const TITLES = {
  etsi_toimiala: "Etsi toimialakoodi",
  hae_yrityksia: "Hae yrityksiä (YTJ)",
  yrityksen_tiedot: "Yrityksen tiedot (YTJ)",
  alueen_vaesto: "Alueen väestö (Paavo)",
  aluetarkistus: "Aluetarkistus",
  toimipaikat_maakunnittain: "Toimipaikat maakunnittain",
  sote_indikaattorit: "Sote-indikaattorit (Sotkanet)",
  sote_tilasto: "Sote-tilasto alueittain (Sotkanet)",
  hintaindeksi: "Kuluttajahinta- ja elinkustannusindeksi",
  indeksitarkistus: "Indeksitarkistus",
  korot: "Viitekorko, viivästyskorko ja EKP:n korot",
  yrityksen_talous: "Yrityksen talous (tilinpäätös ja verotiedot)",
  yhteisoverot: "Yhteisöjen verotiedot",
};
for (const t of TOOLS) {
  t.annotations = {
    title: TITLES[t.name] ?? t.name,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

// ---------- Apufunktiot ----------

class UserError extends Error {}

const nf = new Intl.NumberFormat("fi-FI");
const fmt = (n) => (n === null || n === undefined ? "–" : nf.format(Math.round(n)));

function clip(text) {
  if (text.length <= MAX_OUTPUT) return text;
  return text.slice(0, MAX_OUTPUT) + "\n\n… (Tuloste katkaistu pituuden vuoksi. Rajaa hakua.)";
}

function fmtDate(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]}.${+m[2]}.${m[1]}` : iso ?? "";
}

/** Muuntaa toimialan koodiksi: koodi sellaisenaan, nimi -> paras TOL 2025 -osuma. */
function resolveIndustry(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  if (/^\d{2,5}$/.test(s)) {
    const hit = TOL2025.find((r) => r[0] === s);
    return { code: s, name: hit ? hit[2] : null };
  }
  const q = s.toLowerCase();
  const hits = TOL2025.filter((r) => /^\d+$/.test(r[0]) && r[2].toLowerCase().includes(q));
  if (!hits.length) throw new UserError(`Toimialaa "${s}" ei löytynyt. Käytä työkalua etsi_toimiala.`);
  // Suosi lyhintä koodia (kattaa alaluokat), jonka nimi täsmää.
  hits.sort((a, b) => a[0].length - b[0].length);
  return { code: hits[0][0], name: hits[0][2] };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function normPostcodes(list) {
  return [...new Set((list ?? []).map((p) => String(p).trim()).filter((p) => /^\d{5}$/.test(p)))];
}

async function resolveArea(args, budget) {
  let codes = normPostcodes(args.postinumerot);
  let label;
  if (codes.length) {
    label = `postinumerot ${codes.join(", ")}`;
  } else if (args.kunta) {
    const { areas } = await postAreas(budget);
    const list = areasOfMunicipality(areas, args.kunta);
    if (!list.length) throw new UserError(`Kunnalle "${args.kunta}" ei löytynyt postinumeroalueita. Tarkista kunnan nimi.`);
    codes = list.map((a) => a.code);
    label = `${list[0].kunta} (${codes.length} postinumeroaluetta)`;
  } else {
    throw new UserError("Anna postinumerot tai kunta.");
  }
  return { codes, label };
}

function companyLine(c) {
  const bl = businessLine(c);
  const a = address(c);
  const sit = situations(c);
  const parts = [
    `${currentName(c)} (${c.businessId?.value})`,
    companyForm(c),
    bl ? `${bl.code} ${bl.name}` : null,
    a?.text,
    isActive(c) ? null : statusText(c),
    sit.length ? sit.join(", ") : null,
  ].filter(Boolean);
  return "- " + parts.join(" | ");
}

// ---------- Toteutukset ----------

async function etsiToimiala(args) {
  const q = String(args.hakusana ?? "").trim().toLowerCase();
  if (q.length < 2) throw new UserError("Anna vähintään 2 merkkiä.");
  const isCode = /^\d+$/.test(q);
  const hits = TOL2025.filter((r) => (isCode ? r[0].startsWith(q) : r[2].toLowerCase().includes(q)) && /^\d+$/.test(r[0]));
  if (!hits.length) return `Ei osumia hakusanalle "${args.hakusana}".`;
  const lines = hits.slice(0, 40).map((r) => `${"  ".repeat(Math.max(0, r[1] - 2))}${r[0]} ${r[2]}`);
  let out = `Toimialaluokitus TOL 2025, osumat (${hits.length}${hits.length > 40 ? ", näytetään 40" : ""}):\n` + lines.join("\n");
  out += "\n\nYTJ-haussa koodin alku kattaa alaluokat (esim. 962 = kampaamot, kauneudenhoito ja kylpylät).";
  out += "\nLähde: Tilastokeskus, toimialaluokitus TOL 2025.";
  return out;
}

async function haeYrityksia(args) {
  const budget = newBudget();
  const ind = args.toimiala ? resolveIndustry(args.toimiala) : null;
  const params = {
    mainBusinessLine: ind?.code,
    postCode: args.postinumero,
    location: args.paikkakunta,
    name: args.nimi,
    companyForm: args.yritysmuoto,
    registrationDateStart: args.rekisteroity_alkaen,
    registrationDateEnd: args.rekisteroity_paattyen,
    page: Math.max(1, Number(args.sivu) || 1),
  };
  if (!params.mainBusinessLine && !params.postCode && !params.location && !params.name && !params.registrationDateStart) {
    throw new UserError("Anna vähintään toimiala, postinumero, paikkakunta, nimi tai rekisteröintipäivä.");
  }
  const { total, companies } = await searchCompanies(params, { budget });
  const onlyActive = args.vain_toimivat !== false;
  const list = onlyActive ? companies.filter(isActive) : companies;
  const pages = Math.ceil(total / 100);
  const head = [
    `YTJ-haku${ind ? `, toimiala ${ind.code}${ind.name ? ` ${ind.name}` : ""}` : ""}: ${fmt(total)} yritystä hakuehdoilla, sivu ${params.page}/${Math.max(pages, 1)}.`,
    onlyActive ? `Tällä sivulla toimivia: ${list.length} (lakanneet ja poistetut jätetty pois).` : `Tällä sivulla: ${list.length}.`,
  ];
  const lines = list.map(companyLine);
  let out = head.join("\n") + "\n\n" + (lines.length ? lines.join("\n") : "(ei yrityksiä)");
  if (params.page < pages) out += `\n\nLisää tuloksia: sivu ${params.page + 1}.`;
  out += `\n\n${YTJ_NOTE}\nLähde: Patentti- ja rekisterihallitus, YTJ avoin data.`;
  return clip(out);
}

async function yrityksenTiedot(args) {
  const id = String(args.y_tunnus ?? "").trim();
  if (!/^\d{7}-\d$/.test(id)) throw new UserError("Anna y-tunnus muodossa 1234567-8.");
  const { companies } = await searchCompanies({ businessId: id }, { budget: newBudget(5), ttl: 6 * 3600 });
  const c = companies[0];
  if (!c) return `Y-tunnuksella ${id} ei löytynyt yritystä YTJ:n avoimesta datasta. Toiminimet eivät ole avoimessa datassa.`;
  const bl = businessLine(c);
  const a = address(c);
  const lines = [
    `${currentName(c)} (${id})`,
    `Tila: ${statusText(c)}${situations(c).length ? `, ${situations(c).join(", ")}` : ""}`,
    `Yritysmuoto: ${companyForm(c) ?? "–"}`,
    `Päätoimiala: ${bl ? `${bl.code} ${bl.name}` : "–"}`,
    `Osoite: ${a?.text ?? "–"}`,
    `Rekisteröity: ${fmtDate(c.registrationDate)}`,
  ];
  const aux = auxNames(c);
  if (aux.length) lines.push(`Muut nimet (aputoiminimet ym.): ${aux.join(", ")}`);
  const regs = registers(c);
  if (regs.length) {
    lines.push("", "Rekisterit:");
    for (const r of regs) lines.push(`- ${r.text}${r.since ? ` (alkaen ${fmtDate(r.since)}` : ""}${r.until ? `${r.since ? ", " : " ("}päättyy ${fmtDate(r.until)}` : ""}${r.since || r.until ? ")" : ""}`);
  }
  lines.push("", `Päivitetty YTJ:ssä: ${fmtDate(c.lastModified)}`, "Lähde: Patentti- ja rekisterihallitus, YTJ avoin data.");
  return lines.join("\n");
}

async function alueenVaesto(args) {
  const budget = newBudget();
  const { codes, label } = await resolveArea(args, budget);
  if (codes.length > 120) throw new UserError(`Alueella on ${codes.length} postinumeroa. Rajaa postinumeroilla.`);
  const { year, rows, unknown } = await population(codes, { year: args.vuosi, budget });
  if (!rows.length) throw new UserError("Postinumeroille ei löytynyt Paavo-tietoja.");
  const sum = (k) => rows.reduce((s, r) => (r[k] === null || s === null ? null : s + r[k]), 0);
  const lines = [
    `Väestö ${year}, ${label}`,
    "",
    "Postinumero | Alue | Asukkaat | Naiset | 0–17 | 18–64 | 65+ | 75+ | Keski-ikä | Mediaanitulo €",
  ];
  for (const r of rows) {
    lines.push(
      `${r.code} | ${r.name} | ${fmt(r.total)} | ${fmt(r.women)} | ${fmt(r.age0_17)} | ${fmt(r.age18_64)} | ${fmt(r.age65p)} | ${fmt(r.age75p)} | ${r.avgAge ?? "–"} | ${fmt(r.medianIncome)}`,
    );
  }
  if (rows.length > 1) {
    lines.push(
      `Yhteensä | | ${fmt(sum("total"))} | ${fmt(sum("women"))} | ${fmt(sum("age0_17"))} | ${fmt(sum("age18_64"))} | ${fmt(sum("age65p"))} | ${fmt(sum("age75p"))} | | `,
    );
  }
  if (unknown.length) lines.push("", `Tuntemattomat postinumerot: ${unknown.join(", ")}`);
  lines.push(
    "",
    "Alle 30 asukkaan alueiden tiedot on salattu (–). Mediaanitulo = 18 vuotta täyttäneiden asukkaiden käytettävissä olevien rahatulojen mediaani.",
    "Lähde: Tilastokeskus, Paavo – postinumeroalueittainen avoin tieto (CC BY 4.0).",
  );
  return clip(lines.join("\n"));
}

async function aluetarkistus(args) {
  const budget = newBudget();
  const ind = resolveIndustry(args.toimiala);
  if (!ind) throw new UserError("Anna toimiala.");
  const { codes, label } = await resolveArea(args, budget);
  if (codes.length > MAX_POSTCODES) {
    throw new UserError(
      `Alueella on ${codes.length} postinumeroa, enintään ${MAX_POSTCODES} kerralla. Anna haluamasi postinumerot (alueen_vaesto listaa kunnan postinumerot).`,
    );
  }
  const target = TARGETS[args.kohderyhma] ?? TARGETS.kaikki;

  const pop = await population(codes, { budget });

  // YTJ postinumeroittain; sama yritys voi osua kahteen postinumeroon (käynti- ja postiosoite).
  const byId = new Map();
  const perCode = new Map(codes.map((c) => [c, new Set()]));
  let truncated = false;
  // Rinnakkain, enintään 5 kerrallaan (Workers sallii 6 samanaikaista yhteyttä).
  const results = await mapLimit(codes, 5, (code) =>
    searchAll({ mainBusinessLine: ind.code, postCode: code }, { budget, maxPages: 3 }).then((r) => ({ code, r })),
  );
  for (const { code, r } of results) {
    truncated ||= r.truncated;
    for (const c of r.companies) {
      if (!isActive(c)) continue;
      const id = c.businessId?.value;
      if (!id || byId.has(id)) continue;
      byId.set(id, c);
      const pc = address(c)?.postCode;
      (perCode.get(pc) ?? perCode.get(code)).add(id);
    }
  }

  const lines = [
    `Aluetarkistus: toimiala ${ind.code}${ind.name ? ` ${ind.name}` : ""}, ${label}`,
    `Väestö: ${target.label}, ${pop.year}. Yritykset: YTJ, toimivat kaupparekisteriyhteisöt.`,
    "",
    `Postinumero | Alue | Yrityksiä | ${target.label} | Asukasta / yritys`,
  ];
  let totalCompanies = 0;
  let totalPop = 0;
  let popMissing = false;
  for (const r of pop.rows) {
    const n = perCode.get(r.code)?.size ?? 0;
    const p = r[target.key];
    totalCompanies += n;
    if (p === null) popMissing = true;
    else totalPop += p;
    const ratio = n && p !== null ? fmt(p / n) : n ? "–" : "ei yrityksiä";
    lines.push(`${r.code} | ${r.name} | ${n} | ${fmt(p)} | ${ratio}`);
  }
  lines.push(
    `Yhteensä | | ${totalCompanies} | ${fmt(totalPop)}${popMissing ? " (osa salattu)" : ""} | ${totalCompanies ? fmt(totalPop / totalCompanies) : "ei yrityksiä"}`,
  );
  if (pop.unknown.length) lines.push(`Postinumerot, joille ei ole Paavo-tietoa: ${pop.unknown.join(", ")}`);
  if (truncated) lines.push("Huom: jollakin postinumerolla oli yli 300 osumaa, joten kaikkia ei laskettu.");

  if (args.nayta_yritykset !== false && byId.size) {
    lines.push("", "Yritykset:");
    // Postinumerot ovat numeromerkkijonoja: tavallinen vertailu (ei ICU-lajittelua).
    const pcOf = (c) => address(c)?.postCode ?? "";
    for (const c of [...byId.values()].sort((a, b) => (pcOf(a) < pcOf(b) ? -1 : pcOf(a) > pcOf(b) ? 1 : 0))) {
      lines.push(companyLine(c));
    }
  }
  lines.push(
    "",
    YTJ_NOTE,
    "Toimialatieto on yrityksen ilmoittama päätoimiala; sivutoimialoja ei näy. Yritys lasketaan käynti- tai postiosoitteen postinumeron mukaan.",
    SOURCES_FOOTER,
  );
  return clip(lines.join("\n"));
}

async function toimipaikatMaakunnittain(args) {
  const budget = newBudget(10);
  const meta = await establishmentsMeta(budget);
  const q = String(args.toimiala ?? "").trim();
  if (!q) throw new UserError("Anna toimiala.");
  let inds;
  if (/^\d{1,5}$/.test(q)) {
    inds = meta.industries.filter((i) => i.code.replace(/^[A-Z]/, "") === q);
  } else {
    const ql = q.toLowerCase();
    inds = meta.industries.filter((i) => i.name.toLowerCase().includes(ql)).slice(0, 8);
  }
  if (!inds.length) throw new UserError(`Toimialaa "${q}" ei löytynyt TOL 2008 -luokituksesta. Kokeile kahden numeron koodia, esim. "96".`);
  let regions;
  if (args.maakunta) {
    const ml = String(args.maakunta).toLowerCase();
    regions = meta.regions.filter((r) => r.name.toLowerCase().includes(ml));
    if (!regions.length) throw new UserError(`Maakuntaa "${args.maakunta}" ei löytynyt.`);
    regions = [...regions, meta.regions.find((r) => r.code === "SSS")];
  } else {
    regions = meta.regions.filter((r) => r.code !== "X");
  }
  const res = await establishments(
    regions.map((r) => r.code),
    inds.map((i) => i.code),
    { budget },
  );
  if (!res.year) return "Valituille toimialoille ei ole julkaistua tietoa maakuntatasolla. Kokeile kahden numeron koodia, esim. \"96\".";
  const val = (reg, ind, content) => res.rows.find((r) => r.region === reg && r.industry === ind && r.content === content)?.value ?? null;
  const lines = [`Yritysten toimipaikat ${res.year} (Tilastokeskus, TOL 2008), sisältää myös toiminimet`, ""];
  for (const ind of inds) {
    lines.push(`${ind.name}`, "Alue | Toimipaikat | Henkilöstö (htv)");
    for (const r of regions) {
      const n = val(r.code, ind.code, "Tplukumaara2");
      const h = val(r.code, ind.code, "henkmaara2");
      lines.push(`${r.name} | ${n === null ? "ei tietoa" : fmt(n)} | ${h === null ? "ei tietoa" : fmt(h)}`);
    }
    lines.push("");
  }
  lines.push(
    "Maakuntatasolla tieto on yleensä saatavilla vain kahden numeron toimialatasolla. \"ei tietoa\" = Tilastokeskus ei julkaise lukua.",
    "Lähde: Tilastokeskus, yritysten toimipaikat toimialoittain ja maakunnittain (CC BY 4.0).",
  );
  return clip(lines.join("\n"));
}

// ---------- Sotkanet (luetaan D1:stä, ei suoria hakuja THL:lle) ----------

function needDb(env) {
  if (!env?.DB) throw new UserError("Sotkanet-tietokantaa ei ole kytketty tähän palvelimeen.");
  return env.DB;
}

async function soteIndikaattorit(args, env) {
  const db = needDb(env);
  let rows = await listIndicators(db);
  if (!rows.length) return "Indikaattoreita ei ole vielä ladattu. Ajastettu päivitys hakee ne Sotkanetista vähitellen (yksi vuosi kerrallaan 15 minuutin välein).";
  if (args.hakusana) {
    const q = String(args.hakusana).toLowerCase();
    rows = rows.filter((r) => String(r.title ?? "").toLowerCase().includes(q));
  }
  const lines = rows.map((r) => {
    const left = pendingYears(r);
    const loaded = left.length ? ` (lataus kesken, puuttuu vuodet ${[...left].sort().join(", ")})` : r.row_count ? "" : " (ei vielä ladattu)";
    return `${r.id} ${r.title ?? "?"} | ${r.organization ?? "?"} | ${r.unit ?? ""} | vuodet ${r.range_start ?? "?"}–${r.range_end ?? "?"} | päivitetty ${fmtDate(r.data_updated) || "–"}${loaded}`;
  });
  return clip(
    `Sotkanet-indikaattorit (${rows.length}):\n` +
      lines.join("\n") +
      "\n\nHae arvot työkalulla sote_tilasto. Tietokantaan on tallennettu kuusi viimeisintä vuotta.\nLähde: THL, Sotkanet.fi. Tiedot päivitetään viikoittain eränä.",
  );
}

async function soteTilasto(args, env) {
  const db = needDb(env);
  const ind = await findIndicator(db, args.indikaattori);
  if (!ind) throw new UserError(`Indikaattoria "${args.indikaattori}" ei löytynyt ladatuista. Katso sote_indikaattorit.`);
  if (ind.ambiguous) {
    return "Useita osumia, tarkenna tunnuksella:\n" + ind.ambiguous.map((r) => `${r.id} ${r.title}`).join("\n");
  }
  const left = pendingYears(ind);
  if (!ind.row_count && !left.length) throw new UserError(`Indikaattoria ${ind.id} ei ole vielä ladattu. Ajastettu päivitys hakee sen pian.`);
  const names = (args.alueet ?? []).map(String).filter(Boolean);
  if (!names.length) throw new UserError("Anna vähintään yksi alue.");
  if (names.length > 30) throw new UserError("Enintään 30 aluetta kerralla.");
  const { regions, missing } = await findRegions(db, names);
  const country = await countryRegion(db);
  const all = [...regions];
  if (country && !all.some((r) => r.id === country.id)) all.push(country);
  const years = Array.isArray(args.vuodet) && args.vuodet.length ? args.vuodet.map(Number).filter(Number.isInteger) : null;
  const rows = await soteValues(db, ind.id, all.map((r) => r.id), years);
  if (!rows.length && left.length) {
    throw new UserError(`Indikaattorin ${ind.id} lataus on kesken (puuttuu vuodet ${[...left].sort().join(", ")}). Ajastettu päivitys hakee yhden vuoden 15 minuutin välein.`);
  }
  const yearList = [...new Set(rows.map((r) => r.year))].sort();
  const dec = Number.isInteger(ind.decimals) ? ind.decimals : 1;
  const nfDec = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const cell = (r) => {
    if (!r || r.value === null) return "–";
    const v = nfDec.format(r.value);
    return r.abs_value !== null && r.abs_value !== undefined && r.abs_value !== r.value ? `${v} (${fmt(r.abs_value)})` : v;
  };
  const lines = [
    `${ind.title} [${ind.id}]`,
    `Tuottaja: ${ind.organization ?? "?"}. Yksikkö: ${ind.unit ?? "?"}. Suluissa absoluuttinen määrä, jos se on saatavilla.`,
    "",
    `Alue | ${yearList.join(" | ")}`,
  ];
  for (const r of all) {
    const byYear = new Map(rows.filter((x) => x.region === r.id).map((x) => [x.year, x]));
    lines.push(`${r.title} (${categoryLabel(r.category)}) | ${yearList.map((y) => cell(byYear.get(y))).join(" | ")}`);
  }
  if (left.length) {
    lines.push("", `HUOM: lataus on kesken, vuodet ${[...left].sort().join(", ")} puuttuvat vielä.${ind.row_count ? " Taulukossa voi olla sekaisin uutta ja edellistä päivitystä." : ""}`);
  }
  if (missing.length) lines.push("", `Alueita ei löytynyt: ${missing.join(", ")}. Käytä virallista nimeä, esim. "Kymenlaakson hyvinvointialue".`);
  if (ind.description) lines.push("", `Kuvaus: ${ind.description.slice(0, 600)}${ind.description.length > 600 ? "…" : ""}`);
  if (ind.limits) lines.push(`Rajoitukset: ${ind.limits.slice(0, 400)}${ind.limits.length > 400 ? "…" : ""}`);
  lines.push(
    "",
    `Lähde: THL, Sotkanet.fi, indikaattori ${ind.id}; tiedontuottaja ${ind.organization ?? "?"}. Tiedot päivitetty Sotkanetissa ${fmtDate(ind.data_updated)}, haettu ${fmtDate(ind.last_loaded)}.`,
  );
  return clip(lines.join("\n"));
}

// ---------- Hintaindeksit ja korot ----------

const fmtDec = (n, d = 2) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const neg = n < 0;
  const [i, f] = Math.abs(n).toFixed(d).split(".");
  return (neg ? "−" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (f ? "," + f : "");
};
const KHI_SOURCE = "Lähde: Tilastokeskus, kuluttajahintaindeksi (CC BY 4.0), https://stat.fi/tilasto/khi";

function resolveSeries(args) {
  const kind = String(args.indeksi ?? "khi").trim().toLowerCase().replace("kuluttajahintaindeksi", "khi").replace("elinkustannusindeksi", "elinkustannus");
  const info = seriesInfo(kind, args.perusvuosi);
  if (!info) throw new UserError('indeksi: "khi" (kuluttajahintaindeksi) tai "elinkustannus" (elinkustannusindeksi 1951:10=100).');
  if (info.error) throw new UserError(info.error);
  return info;
}

async function hintaindeksi(args) {
  const info = resolveSeries(args);
  const budget = newBudget(6);
  const { values, updated } = await indexSeries(info, false, budget);
  const periods = [...values.keys()];
  const latest = periods.at(-1);
  let from = args.alkaen ? parsePeriod(args.alkaen) : null;
  let to = args.paattyen ? parsePeriod(args.paattyen) : latest;
  if ((args.alkaen && !/M/.test(from ?? "")) || (args.paattyen && !/M/.test(to ?? ""))) throw new UserError('Anna kuukausi muodossa VVVV-KK, esim. "2025-09".');
  if (!from) {
    const i = Math.max(0, periods.indexOf(to) - 12);
    from = periods[i];
  }
  const rows = periods.filter((p) => p >= from && p <= to);
  if (!rows.length) throw new UserError(`Ei tietoja väliltä ${periodLabel(from)}–${periodLabel(to)}. Sarja alkaa ${periodLabel(periods[0])} ja viimeisin on ${periodLabel(latest)}.`);
  if (rows.length > 240) throw new UserError("Väli on liian pitkä (yli 240 kuukautta). Rajaa alkaen- ja paattyen-kuukausilla.");
  let official = null;
  if (info.kind === "khi") official = (await khiAnnualChange(budget)).values;
  const out = [`${info.name} (${info.label}), kuukausittain ${periodLabel(rows[0])}–${periodLabel(rows.at(-1))}. Viimeisin julkaistu kuukausi: ${periodLabel(latest)}.`];
  out.push("", "Kuukausi | Pisteluku | Vuosimuutos %");
  for (const p of rows) {
    const prev = values.get(yearBefore(p));
    const change = official?.get(p) ?? (prev ? (values.get(p) / prev - 1) * 100 : null);
    out.push(`${periodLabel(p)} | ${fmtDec(values.get(p))} | ${change === null ? "–" : fmtDec(change, 1)}`);
  }
  out.push(
    "",
    info.kind === "khi"
      ? "Vuosimuutos on Tilastokeskuksen virallinen kuluttajahintaindeksin vuosimuutos (taulukko 122p), joka on sama kaikilla perusvuosilla."
      : "Vuosimuutos on laskettu pisteluvuista (12 kuukauden muutos).",
    `${KHI_SOURCE}. Taulukko päivitetty ${updated ? fmtDate(updated) : "?"}.`,
  );
  return clip(out.join("\n"));
}

async function indeksitarkistus(args) {
  const info = resolveSeries(args);
  const fromP = parsePeriod(args.lahtokohta);
  if (!fromP) throw new UserError('Anna lahtokohta kuukautena (VVVV-KK, esim. "2024-03") tai vuotena (VVVV, vuosikeskiarvo).');
  const yearly = !/M/.test(fromP);
  let toP = args.tarkistus ? parsePeriod(args.tarkistus) : null;
  if (args.tarkistus && (!toP || /M/.test(toP) === yearly)) throw new UserError("Anna tarkistusajankohta samassa muodossa kuin lähtökohta (molemmat kuukausia tai molemmat vuosia).");
  const series = await indexSeries(info, yearly, newBudget(4));
  if (!series) throw new UserError(`Vuosikeskiarvoja ei ole perusvuodelle ${info.base}. Käytä kuukausia tai toista perusvuotta (esim. 2015).`);
  const { values } = series;
  const latest = [...values.keys()].at(-1);
  toP ??= latest;
  const a = values.get(fromP);
  const b = values.get(toP);
  if (a === undefined) throw new UserError(`Pistelukua ei löydy ajankohdalle ${periodLabel(fromP)} (${info.label}). Sarjan viimeisin: ${periodLabel(latest)}.`);
  if (b === undefined) throw new UserError(`Pistelukua ei löydy ajankohdalle ${periodLabel(toP)} (${info.label}). Viimeisin julkaistu: ${periodLabel(latest)}.`);
  const ratio = b / a;
  const out = [`Indeksitarkistus: ${info.label}${yearly ? " (vuosikeskiarvot)" : ""}`];
  out.push(`Lähtökohta ${periodLabel(fromP)}: ${fmtDec(a)}`);
  out.push(`Tarkistus ${periodLabel(toP)}: ${fmtDec(b)}${!args.tarkistus ? " (viimeisin julkaistu)" : ""}`);
  out.push(`Muutos: ${fmtDec((ratio - 1) * 100, 2)} % (kerroin ${ratio.toFixed(4).replace(".", ",")})`);
  const sum = Number(String(args.summa ?? "").replace(/\s/g, "").replace(",", "."));
  if (args.summa !== undefined && args.summa !== null && args.summa !== "") {
    if (!Number.isFinite(sum)) throw new UserError("Anna summa numerona, esim. 850 tai 850,50.");
    out.push(`Summa ${fmtDec(sum)} → ${fmtDec(sum * ratio)} (muutos ${fmtDec(sum * ratio - sum)})`);
  }
  out.push(
    "",
    "Laskenta: uusi summa = summa × tarkistuksen pisteluku / lähtökohdan pisteluku. Tarkista sopimuksesta indeksi, perusvuosi, tarkistuskuukausi sekä mahdolliset rajat (esim. vähimmäiskorotus tai korotuksen vain ylöspäin). Pisteluvut ovat Tilastokeskuksen julkaisemia pyöristettyjä lukuja.",
    KHI_SOURCE + ".",
  );
  return clip(out.join("\n"));
}

async function korot(args) {
  const d = args.paiva ? String(args.paiva).trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new UserError('Anna päivä muodossa VVVV-KK-PP, esim. "2026-10-31".');
  const { mro, dfr, mlf } = await ecbRates();
  const out = [`Korot ${fmtDate(d)}`];
  const start = periodStart(d);
  if (start < FIRST_REFERENCE_PERIOD) {
    out.push("", "Viitekorkoa ennen vuotta 2009 ei lasketa (EKP:n perusrahoitusoperaatiot olivat vaihtuvakorkoisia 2000–2008). Katso Suomen Pankin julkaisemat viitekorot.");
  } else {
    const ref = referenceRate(mro, start);
    if (ref) {
      out.push(
        "",
        `Korkolain viitekorko ${fmtDate(start)}–${fmtDate(periodEnd(start))}: ${fmtDec(ref.rate, 1)} %`,
        `  (EKP:n perusrahoitusoperaatioiden korko ennen kauden alkua ${fmtDec(ref.mro)} %, voimassa ${fmtDate(ref.mroDate)} alkaen, pyöristettynä ylöspäin puoleen prosenttiyksikköön; korkolaki 633/1982 12 §)`,
        `Viivästyskorko: ${fmtDec(ref.rate + 7, 1)} % (viitekorko + 7 prosenttiyksikköä, korkolaki 4 §)`,
        `Viivästyskorko kaupallisissa sopimuksissa: ${fmtDec(ref.rate + 8, 1)} % (viitekorko + 8 prosenttiyksikköä, korkolaki 4 a §)`,
      );
    }
  }
  const cur = (list) => rateOn(list, d);
  const lines = [
    ["Talletuskorko", cur(dfr)],
    ["Perusrahoitusoperaatioiden korko", cur(mro)],
    ["Maksuvalmiusluoton korko", cur(mlf)],
  ].filter(([, r]) => r);
  if (lines.length) {
    out.push("", "EKP:n ohjauskorot:");
    for (const [name, r] of lines) out.push(`- ${name}: ${fmtDec(r.value)} % (${fmtDate(r.date)} alkaen)`);
  }
  if (args.historia) {
    out.push("", "Viitekorot puolivuosittain (uusin ensin):");
    const starts = [];
    for (let y = +d.slice(0, 4); y >= 2009; y--) for (const m of ["07", "01"]) if (`${y}-${m}-01` <= start) starts.push(`${y}-${m}-01`);
    for (const s of starts.slice(0, 40)) {
      const r = referenceRate(mro, s);
      if (r) out.push(`- ${fmtDate(s)}–${fmtDate(periodEnd(s))}: ${fmtDec(r.rate, 1)} %`);
    }
  }
  out.push(
    "",
    "Viitekorko on laskettu EKP:n julkaisemasta korosta korkolain 12 §:n mukaan; Suomen Pankki julkaisee virallisen viitekoron. Viivästyskorko voi sopimuksen tai korkolain 4 §:n 2 momentin perusteella olla toinen.",
    "Lähde: EKP:n tilastot (Source: ECB statistics), data-api.ecb.europa.eu. Euribor-korot eivät ole mukana, koska ne ovat kolmannen osapuolen lisensoimaa dataa.",
  );
  return clip(out.join("\n"));
}

// ---------- Yritysten talous: PRH:n digitaaliset tilinpäätökset ja Verohallinnon yhteisöverotiedot ----------

const PRH_FIN_SOURCE = "Lähde: Patentti- ja rekisterihallitus, digitaaliset tilinpäätöstiedot (avoin data, CC BY 4.0); nimikkeet SBR-taksonomiasta (Valtiokonttori).";
const VERO_SOURCE = "Lähde: Verohallinto, yhteisöjen tuloverotuksen julkiset tiedot (avoin data, CC BY 4.0), https://www.vero.fi/avoindata";
const eur = (n) => (n === null || n === undefined ? "–" : `${nf.format(Math.round(n))} €`);
const pct = (a, b) => (a !== undefined && b ? `${fmtDec((a / b) * 100, 1)} %` : null);

async function resolveCompany(args, budget) {
  const id = String(args.y_tunnus ?? "").trim();
  if (id) {
    if (!/^\d{7}-\d$/.test(id)) throw new UserError("Anna y-tunnus muodossa 1234567-8.");
    return { id, name: null };
  }
  const q = String(args.nimi ?? "").trim();
  if (!q) throw new UserError("Anna Y-tunnus tai nimi.");
  const { companies } = await searchCompanies({ name: q }, { budget });
  const list = companies.filter(isActive);
  const exact = list.filter((c) => currentName(c).toLowerCase() === q.toLowerCase());
  const pick = exact.length === 1 ? exact : list;
  if (pick.length === 1) return { id: pick[0].businessId?.value, name: currentName(pick[0]) };
  if (!pick.length) throw new UserError(`Nimellä "${q}" ei löytynyt toimivaa yritystä YTJ:stä. Anna Y-tunnus.`);
  throw new UserError(`Nimellä "${q}" löytyi useita yrityksiä. Anna Y-tunnus:\n${pick.slice(0, 15).map((c) => `- ${c.businessId?.value} ${currentName(c)}`).join("\n")}`);
}

// Etumerkit vaihtelevat ilmoittajittain ja jopa saman yhtiön vuosien välillä (havaittu otoksesta),
// joten käytäntö päätellään tilinpäätöskohtaisesti: kulut näytetään positiivisina ja
// rahoituserien netto käännetään, jos liikevoitto − rahoituserät = voitto ennen tilinpäätössiirtoja.
const COST_CODES = ["x758", "x5", "x6", "x448", "x1869", "x541"];
function signConvention(pl) {
  const costSum = COST_CODES.reduce((a, c) => a + (pl[c] ?? 0), 0);
  const cost = costSum < 0 ? -1 : 1;
  let fin = 1;
  let finKnown = false;
  if (pl.x689 !== undefined && pl.x12 !== undefined && pl.x738 !== undefined) {
    if (Math.abs(pl.x689 + pl.x12 - pl.x738) < 1) finKnown = true;
    else if (Math.abs(pl.x689 - pl.x12 - pl.x738) < 1) {
      fin = -1;
      finKnown = true;
    }
  }
  return { cost, fin, finKnown };
}

function finLine(code, cur, prev, sc = null, scPrev = null) {
  const factor = (conv) => (!conv ? 1 : COST_CODES.includes(code) ? conv.cost : code === "x12" ? conv.fin : 1);
  const a = cur[code];
  const b = prev[code];
  if (a === undefined && b === undefined) return null;
  const base = mcLabel(code).replace(/\s*\+ \(-\)$/, "");
  const label = code === "x12" && sc ? `${base} (netto, + = tuotto${sc.finKnown ? "" : "; etumerkki ilmoitetussa muodossa"})` : base;
  return `- ${label}: ${a === undefined ? "–" : eur(a * factor(sc))}${b === undefined ? "" : ` (ed. ${eur(b * factor(scPrev ?? sc))})`}`;
}

async function yrityksenTalous(args, env) {
  const budget = newBudget(10);
  const { id, name } = await resolveCompany(args, budget);
  const out = [];
  const periods = await financialPeriods(id, budget).catch(() => null);
  let st = null;
  let date = null;
  if (periods?.length) {
    date = args.tilikausi ? String(args.tilikausi).trim() : periods[0].date;
    if (!periods.some((p) => p.date === date)) throw new UserError(`Tilikaudelta ${date} ei ole digitaalista tilinpäätöstä. Saatavilla: ${periods.map((p) => p.date).join(", ")}.`);
    st = await financialStatement(id, date);
  }
  const vero = env?.DB ? await veroForCompany(env.DB, id).catch(() => null) : null;
  const veroName = vero?.rows?.length ? vero.rows[vero.rows.length - 1].nimi : null;
  out.push(`${st?.name ?? name ?? veroName ?? "Yritys"} (${id})`);
  out.push("", "TILINPÄÄTÖS (PRH, digitaalinen tilinpäätös)");
  if (!st) {
    out.push(
      periods === null
        ? "PRH:n tilinpäätösrajapinta ei vastannut."
        : "Yritykseltä ei ole digitaalista tilinpäätöstä PRH:n avoimessa datassa. Avoimessa datassa ovat vain iXBRL-muodossa ilmoitetut tilinpäätökset (tilikaudelta 2025 n. 12 000 yritystä); muut tilinpäätökset saa PRH:n Virre-palvelusta.",
    );
  } else {
    out.push(`Tilikausi ${fmtDate(st.start)}–${fmtDate(st.end)}${periods.length > 1 ? `; muut tilikaudet: ${periods.filter((p) => p.date !== date).map((p) => fmtDate(p.date)).join(", ")}` : ""}.`);
    const { pl, bs } = st.cur;
    const ppl = st.prev.pl;
    const pbs = st.prev.bs;
    const sc = signConvention(pl);
    const scPrev = Object.keys(ppl).length ? signConvention(ppl) : sc;
    const plLines = PL_MAIN.map((c) => finLine(c, pl, ppl, sc, scPrev)).filter(Boolean);
    const bsLines = BS_MAIN.map((c) => finLine(c, bs, pbs)).filter(Boolean);
    if (plLines.length) out.push("", "Tuloslaskelma (kulut positiivisina, suluissa edellinen tilikausi):", ...plLines);
    if (bsLines.length) out.push("", "Tase:", ...bsLines);
    const ratios = [];
    const lvp = pct(pl.x689, pl.x673);
    if (lvp) ratios.push(`liikevoitto-% ${lvp}`);
    const oa = pct(bs.x376, bs.x481);
    if (oa) ratios.push(`oman pääoman osuus vastattavista ${oa}`);
    if (ratios.length) out.push("", `Laskettu: ${ratios.join(", ")} (yksinkertaistettu; virallisissa tunnusluvuissa oikaisut voivat muuttaa lukuja).`);
    if (args.kaikki_erat) {
      const main = new Set([...PL_MAIN, ...BS_MAIN]);
      const rest = (cur, prev, title) => {
        const codes = [...new Set([...Object.keys(cur), ...Object.keys(prev)])].filter((c) => !main.has(c));
        if (!codes.length) return;
        out.push("", title, ...codes.sort((a, b) => (mcLabel(a) < mcLabel(b) ? -1 : mcLabel(a) > mcLabel(b) ? 1 : 0)).map((c) => finLine(c, cur, prev)).filter(Boolean));
      };
      rest(pl, ppl, "Muut tuloslaskelman erät (etumerkit ilmoitetussa muodossa, ne vaihtelevat ilmoittajittain):");
      rest(bs, pbs, "Muut taseen erät:");
    } else {
      out.push("Kaikki erät: kaikki_erat: true.");
    }
    out.push(PRH_FIN_SOURCE);
  }

  out.push("", "VEROTIEDOT (Verohallinto, yhteisöjen tuloverotuksen julkiset tiedot)");
  if (!env?.DB) {
    out.push("Verotietokantaa ei ole kytketty.");
  } else {
    const loaded = await veroLoaded(env.DB);
    if (!loaded.length) {
      out.push("Verotietoja ei ole vielä ladattu (ajastettu lataus hakee vuodet vähitellen).");
    } else {
      const { rows, changes } = vero ?? (await veroForCompany(env.DB, id));
      if (!rows.length) {
        out.push(`Yhteisöä ei ole ladatuissa verotiedoissa (vuodet ${loaded.map((l) => l.vuosi).join(", ")}).`);
      } else {
        for (const r of rows) {
          out.push(`- ${r.vuosi}: verotettava tulo ${eur(r.tulo)}, maksuunpannut verot ${eur(r.verot)}, veronpalautus ${eur(r.palautus)}, jäännösvero ${eur(r.jaannos)} (kotikunta ${r.kunta ?? "?"})`);
        }
        if (changes.length) {
          out.push("Muutosverotus (verotukseen tehdyt muutokset; tiedot julkisia verovuodesta 2022):");
          for (const c of changes) out.push(`- ${c.vuosi} muutos ${c.muutos}: verotettava tulo ${eur(c.tulo)}, maksuunpannut verot ${eur(c.verot)}, veronpalautus ${eur(c.palautus)}, jäännösvero ${eur(c.jaannos)}`);
        }
      }
      out.push(VERO_SOURCE);
    }
  }
  return clip(out.join("\n"));
}

async function yhteisoverot(args, env) {
  if (!env?.DB) throw new UserError("Verotietokantaa ei ole kytketty tähän palvelimeen.");
  const db = env.DB;
  const loaded = await veroLoaded(db);
  if (!loaded.length) return "Verotietoja ei ole vielä ladattu. Ajastettu lataus hakee vuodet Verohallinnon avoimesta datasta vähitellen.";
  const years = loaded.map((l) => l.vuosi).filter(Boolean);
  const vuosi = args.vuosi ? Number(args.vuosi) : Math.max(...years);
  if (!years.includes(vuosi)) throw new UserError(`Verovuotta ${vuosi} ei ole ladattu. Saatavilla: ${years.join(", ")}.`);
  let kunta = null;
  if (args.kunta) {
    kunta = await veroKunta(db, args.kunta);
    if (!kunta) throw new UserError(`Kuntaa "${args.kunta}" ei löytynyt verotiedoista.`);
  }
  const page = Math.max(1, Number(args.sivu) || 1);
  const order = args.jarjestys === "tulo" ? "tulo" : "verot";
  const { rows, sum } = await veroTop(db, { kunta_nro: kunta?.nro, vuosi, order, hakusana: args.hakusana ? String(args.hakusana).trim() : null, limit: 25, offset: (page - 1) * 25 });
  const where = kunta ? `${kunta.nimi ?? kunta.nro}` : "koko maa";
  const out = [
    `Yhteisöjen tuloverotus ${vuosi}, ${where}${args.hakusana ? `, nimessä "${args.hakusana}"` : ""}: ${fmt(sum?.n)} yhteisöä, joista veroa maksaneita ${fmt(sum?.maksajia)}; maksuunpannut verot yhteensä ${eur(sum?.verot)}, verotettava tulo yhteensä ${eur(sum?.tulo)}.`,
    `Järjestys: ${order === "tulo" ? "verotettava tulo" : "maksuunpannut verot"}, sivu ${page}.`,
    "",
  ];
  rows.forEach((r, i) => out.push(`${(page - 1) * 25 + i + 1}. ${r.nimi} (${r.ytunnus}${kunta ? "" : `, ${r.kunta}`}): verot ${eur(r.verot)}, verotettava tulo ${eur(r.tulo)}${r.palautus ? `, palautus ${eur(r.palautus)}` : ""}${r.jaannos ? `, jäännösvero ${eur(r.jaannos)}` : ""}`));
  if ((sum?.n ?? 0) > page * 25) out.push("", `Lisää: sivu ${page + 1}.`);
  out.push(
    "",
    "Kunta on yhteisön kotikunta kaupparekisterissä. Yhteisöveron kuntaosuus jaetaan toimipaikkojen ja henkilöstön sijainnin mukaan, joten kunnan yhteisöverotulo ei ole sama kuin tämä summa.",
    VERO_SOURCE,
  );
  return clip(out.join("\n"));
}

const HANDLERS = {
  etsi_toimiala: etsiToimiala,
  hae_yrityksia: haeYrityksia,
  yrityksen_tiedot: yrityksenTiedot,
  alueen_vaesto: alueenVaesto,
  aluetarkistus,
  toimipaikat_maakunnittain: toimipaikatMaakunnittain,
  sote_indikaattorit: soteIndikaattorit,
  sote_tilasto: soteTilasto,
  hintaindeksi,
  indeksitarkistus,
  korot,
  yrityksen_talous: yrityksenTalous,
  yhteisoverot,
};

export async function callTool(name, args = {}, env = {}) {
  const fn = HANDLERS[name];
  if (!fn) return { isError: true, content: [{ type: "text", text: `Tuntematon työkalu: ${name}` }] };
  try {
    const text = await fn(args ?? {}, env);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    const msg =
      e instanceof UserError
        ? e.message
        : e instanceof BudgetError
          ? "Haku olisi vaatinut liian monta pyyntöä kerralla. Rajaa aluetta tai toimialaa."
          : e instanceof HttpError
            ? `Tietolähteen haku epäonnistui: ${e.message}. Yritä hetken päästä uudelleen.`
            : `Odottamaton virhe: ${e?.message ?? e}`;
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
}
