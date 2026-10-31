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

const HANDLERS = {
  etsi_toimiala: etsiToimiala,
  hae_yrityksia: haeYrityksia,
  yrityksen_tiedot: yrityksenTiedot,
  alueen_vaesto: alueenVaesto,
  aluetarkistus,
  toimipaikat_maakunnittain: toimipaikatMaakunnittain,
  sote_indikaattorit: soteIndikaattorit,
  sote_tilasto: soteTilasto,
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
