// Kokeilun kuusi työkalua yhteisen rungon tyokalu()-muodossa (koodiajo-valmius, 1.16.0): etsi_toimiala, hae_yrityksia,
// alueen_vaesto, aluetarkistus, hae_tilastoja ja tilasto. Logiikka on tools.js:n funktioissa (<nimi>Tulos hakee ja
// palauttaa rakenteisen tuloksen, <nimi>Teksti muotoilee siitä saman tekstin kuin ennen), ja työkalu on ohut kuori
// niiden päällä. Kaikki vain lukevat (oikeus "luku"). Muut 24 työkalua ovat yhä tools.js:n TOOLS-listassa (callTool).

import { tyokalu, NaytettavaVirhe, LAHDE_SKEEMA, VIRHE_SKEEMA } from "./mcp-runko.js";
import { BudgetError, HttpError } from "./http.js";
import { COMPANY_FORMS } from "./ytj.js";
import {
  etsiToimialaTulos,
  etsiToimialaTeksti,
  haeYrityksiaTulos,
  haeYrityksiaTeksti,
  alueenVaestoTulos,
  alueenVaestoTeksti,
  aluetarkistusTulos,
  aluetarkistusTeksti,
  haeTilastojaTulos,
  haeTilastojaTeksti,
  tilastoTulos,
  tilastoTeksti,
  ALUETARKISTUS_YRITYKSET_ENINTAAN,
  UserError,
  EiLoydyVirhe,
  TARGETS,
  TITLES,
  areaProps,
} from "./tools.js";

// ---------- virheet ----------

/**
 * Liittimen virheet rungon NaytettavaVirhe-muotoon samoin tekstein kuin callTool: puuttuva taulukko tai tieto (ei_loydy),
 * syötteen virhe (syote), liian monta hakua (raja) ja lähteen virhe tiloineen (lahde). Muut poikkeukset menevät rungolle,
 * joka näyttää yleisen tekstin eikä kirjaa sisäistä tekstiä.
 */
function virheet(hae) {
  return async (args, env, ctx) => {
    try {
      return await hae(args ?? {}, env, ctx);
    } catch (e) {
      if (e instanceof NaytettavaVirhe) throw e;
      if (e instanceof EiLoydyVirhe) throw new NaytettavaVirhe(e.message, "ei_loydy");
      if (e instanceof UserError) throw new NaytettavaVirhe(e.message, "syote");
      if (e instanceof BudgetError) {
        throw new NaytettavaVirhe("Haku olisi vaatinut liian monta pyyntöä kerralla. Rajaa aluetta tai toimialaa.", "raja");
      }
      if (e instanceof HttpError) {
        throw new NaytettavaVirhe(`Tietolähteen haku epäonnistui: ${e.message}. Yritä hetken päästä uudelleen.`, "lahde", {
          lahteen_koodi: e.status ? String(e.status) : undefined,
        });
      }
      // http.js:n NaytettavaVirhe: tarkoituksella näytettävä lähteen tila (esim. Paavon taulukko puuttuu).
      if (e?.name === "NaytettavaVirhe") throw new NaytettavaVirhe(e.message, "lahde");
      throw e;
    }
  };
}

/** Lukeva työkalu (oikeus luku), otsikko TITLES-taulukosta kuten muilla työkaluilla. */
const luku = ({ nimi, hae, ...muut }) =>
  tyokalu({ nimi, otsikko: TITLES[nimi] ?? nimi, oikeus: "luku", avoin: true, hae: virheet(hae), ...muut });

// ---------- tulosskeemat ----------

const mj = (description) => ({ type: "string", description });
const kl = (description) => ({ type: "integer", description });
const lista = (items, description) => ({ type: "array", items, description });
const taiNull = (skeema, description) => ({ anyOf: [skeema, { type: "null" }], description });
const lukuTaiNull = (description) => taiNull({ type: "number" }, description);

/** Onnistunut tulos tai rakenteinen virhe { virhe }, jotta isError-tuloskin noudattaa outputSchemaa. */
const taiVirhe = (onnistunut) => ({
  type: "object",
  oneOf: [onnistunut, { type: "object", properties: { virhe: VIRHE_SKEEMA }, required: ["virhe"] }],
});

/** Sivutus (lähteen tai liittimen sivunumero). */
const SIVUTUS = {
  sivu: { type: "integer", minimum: 1, description: "Tämän tuloksen sivu (parametri sivu)." },
  sivuja: { type: "integer", minimum: 1, description: "Sivuja yhteensä." },
  seuraava: taiNull({ type: "integer" }, "Seuraavan sivun numero tai null (viimeinen sivu)."),
};

const KATTAVUUS = {
  type: "object",
  description: "YTJ:n avoimen datan kattavuus: vain kaupparekisteriin merkityt yhteisöt, toiminimet puuttuvat. Kerro tämä, kun esität yritysmääriä.",
  properties: {
    vain_kaupparekisteri: { type: "boolean", const: true },
    toiminimet_puuttuvat: { type: "boolean", const: true },
    huomautus: mj("Sama varaus tekstinä."),
  },
  required: ["vain_kaupparekisteri", "toiminimet_puuttuvat", "huomautus"],
};

const TOIMIALA = {
  type: "object",
  properties: { koodi: mj("TOL 2025 -koodi."), nimi: mj("Toimialan nimi.") },
  required: ["koodi"],
};

const YRITYS_RIVI = {
  type: "object",
  properties: {
    y_tunnus: mj("Y-tunnus."),
    nimi: mj("Voimassa oleva nimi."),
    yritysmuoto: taiNull({ type: "string" }, "Yritysmuoto."),
    toimiala: taiNull(TOIMIALA, "Päätoimiala (yrityksen ilmoittama)."),
    osoite: taiNull({ type: "string" }, "Käynti- tai postiosoite."),
    postinumero: taiNull({ type: "string" }, "Osoitteen postinumero."),
    toimiva: { type: "boolean", description: "Kaupparekisterissä ja toiminnassa." },
    tila: mj("Tila tekstinä (esim. rekisterissä, lakannut)."),
    tilanteet: lista({ type: "string" }, "Konkurssi, saneeraus, selvitystila ym."),
    linkki: taiNull({ type: "string" }, "Yrityksen sivu YTJ:n tietopalvelussa."),
  },
  required: ["y_tunnus", "nimi", "toimiva", "tila", "tilanteet"],
};

const VAESTO_LUVUT = {
  asukkaat: lukuTaiNull("Asukkaat yhteensä (null = salattu tai puuttuu)."),
  naiset: lukuTaiNull("Naiset."),
  miehet: lukuTaiNull("Miehet."),
  ika_0_17: lukuTaiNull("0–17-vuotiaat."),
  ika_18_64: lukuTaiNull("18–64-vuotiaat."),
  ika_65_plus: lukuTaiNull("65 vuotta täyttäneet."),
  ika_75_plus: lukuTaiNull("75 vuotta täyttäneet."),
};

const VUOSI = { anyOf: [{ type: "integer" }, { type: "string" }], description: "Tilastovuosi." };

// ---------- työkalut ----------

export const TYOKALUT = [
  luku({
    nimi: "etsi_toimiala",
    kuvaus:
      "Etsii toimialaluokituksen TOL 2025 koodeja nimen osalla tai koodilla (esim. \"kauneudenhoito\" -> 96220, \"kotihoito\" -> 88101). YTJ käyttää TOL 2025 -koodeja. Lyhyempi koodi (esim. \"962\") kattaa kaikki sen alaluokat.",
    syote: {
      type: "object",
      properties: { hakusana: { type: "string", description: "Nimen osa tai koodin alku." } },
      required: ["hakusana"],
    },
    // Paikallinen luokitus (tol2025.js), ei verkkohakua; openWorldHint pysyy kuten ennen (true).
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        hakusana: mj("Annettu hakusana."),
        osumia: kl("Osumia yhteensä."),
        rajattu: { type: "boolean", description: "true = osumia yli 40, vain 40 ensimmäistä listassa." },
        toimialat: lista(
          { type: "object", properties: { koodi: mj("TOL 2025 -koodi."), taso: kl("Luokituksen taso (2 = kaksinumerotaso ... 5 = viisinumerotaso)."), nimi: mj("Nimi.") }, required: ["koodi", "taso", "nimi"] },
          "Osumat luokituksen järjestyksessä, enintään 40.",
        ),
        lahde: LAHDE_SKEEMA,
      },
      required: ["hakusana", "osumia", "rajattu", "toimialat", "lahde"],
    }),
    hae: etsiToimialaTulos,
    teksti: etsiToimialaTeksti,
  }),
  luku({
    nimi: "hae_yrityksia",
    kuvaus:
      "Hakee yrityksiä PRH:n YTJ-tiedoista toimialan, postinumeron, postitoimipaikan, nimen tai yritysmuodon perusteella. Palauttaa nimen, y-tunnuksen, toimialan, yritysmuodon, osoitteen ja tilan. Toiminimet eivät ole mukana avoimessa datassa. Mukana ovat vain kaupparekisteriin merkityt yhteisöt (oy, ky, ay, osuuskunta). Kerro tämä aina, kun esität yritysmääriä, ja käytä tarvittaessa toimipaikat_maakunnittain-työkalua kokonaiskuvaan.",
    syote: {
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
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        hakuehdot: {
          type: "object",
          description: "Annetut hakuehdot; toimiala koodiksi muunnettuna.",
          properties: {
            toimiala: TOIMIALA,
            postinumero: { type: "string" },
            paikkakunta: { type: "string" },
            nimi: { type: "string" },
            yritysmuoto: { type: "string" },
            rekisteroity_alkaen: { type: "string" },
            rekisteroity_paattyen: { type: "string" },
          },
        },
        vain_toimivat: { type: "boolean", description: "Onko lakanneet ja poistetut suodatettu sivulta pois." },
        yhteensa: kl("YTJ:n ilmoittama osumamäärä hakuehdoilla (ennen toimivien suodatusta)."),
        ...SIVUTUS,
        sivun_koko: kl("YTJ:n sivukoko (100)."),
        sivulla: kl("Yrityksiä tällä sivulla suodatuksen jälkeen."),
        pois_suodatettu: kl("Tältä sivulta pois suodatetut (lakanneet ja poistetut)."),
        yritykset: lista(YRITYS_RIVI, "Tämän sivun yritykset."),
        kattavuus: KATTAVUUS,
        lahde: LAHDE_SKEEMA,
      },
      required: ["hakuehdot", "vain_toimivat", "yhteensa", "sivu", "sivuja", "seuraava", "sivulla", "yritykset", "kattavuus", "lahde"],
    }),
    hae: haeYrityksiaTulos,
    teksti: haeYrityksiaTeksti,
  }),
  luku({
    nimi: "alueen_vaesto",
    kuvaus:
      "Palauttaa Tilastokeskuksen Paavo-tiedoista asukasmäärän, sukupuolijakauman, keski-iän, ikäryhmät (0–17, 18–64, 65+, 75+) ja mediaanitulot postinumeroalueittain. Anna postinumerot tai kunta.",
    syote: {
      type: "object",
      properties: {
        ...areaProps,
        vuosi: { type: "integer", description: "Tilastovuosi (oletus uusin)." },
      },
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        alue: mj("Alue tekstinä (postinumerot tai kunta ja alueiden määrä)."),
        vuosi: VUOSI,
        postinumeroalueet: lista(
          {
            type: "object",
            properties: {
              postinumero: mj("Postinumero."),
              nimi: mj("Postinumeroalueen nimi."),
              kunta: taiNull({ type: "string" }, "Kunta."),
              ...VAESTO_LUVUT,
              keski_ika: lukuTaiNull("Keski-ikä."),
              mediaanitulo: lukuTaiNull("18 vuotta täyttäneiden käytettävissä olevien rahatulojen mediaani, €."),
            },
            required: ["postinumero", "nimi", "asukkaat"],
          },
          "Postinumeroalueet (alle 30 asukkaan alueiden luvut ovat salattuja, null).",
        ),
        yhteensa: taiNull({ type: "object", properties: VAESTO_LUVUT }, "Summat, kun alueita on useampi (null, jos yksi); summa on null, jos jokin luku puuttuu."),
        tuntemattomat: lista({ type: "string" }, "Postinumerot, joille ei ole Paavo-tietoa."),
        lahde: LAHDE_SKEEMA,
      },
      required: ["alue", "vuosi", "postinumeroalueet", "yhteensa", "tuntemattomat", "lahde"],
    }),
    hae: alueenVaestoTulos,
    teksti: alueenVaestoTeksti,
  }),
  luku({
    nimi: "aluetarkistus",
    kuvaus:
      "Laskee alueen yritysten määrän toimialalla (YTJ) ja vertaa sitä asukasmäärään (Paavo) postinumeroalueittain: toimijoita, asukkaita ja asukasta per toimija. Kohderyhmänä voi käyttää esim. naisia tai 75 vuotta täyttäneitä. Toiminimet puuttuvat YTJ:n avoimesta datasta, joten toimijamäärä on alaraja. Mukana ovat vain kaupparekisteriin merkityt yhteisöt (oy, ky, ay, osuuskunta). Kerro tämä aina, kun esität yritysmääriä, ja käytä tarvittaessa toimipaikat_maakunnittain-työkalua kokonaiskuvaan.",
    syote: {
      type: "object",
      properties: {
        toimiala: { type: "string", description: "TOL 2025 -koodi tai sen alku, esim. \"96220\" tai \"962\"." },
        ...areaProps,
        kohderyhma: { type: "string", enum: Object.keys(TARGETS), description: "Väestöryhmä, johon toimijamäärää verrataan (oletus kaikki)." },
        nayta_yritykset: { type: "boolean", description: "Listaa löydetyt yritykset (oletus true)." },
      },
      required: ["toimiala"],
    },
    // Teksti listaa kaikki löydetyt yritykset; rakenteessa enintään ALUETARKISTUS_YRITYKSET_ENINTAAN.
    poisRakenteesta: ["yritykset_kaikki"],
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        toimiala: TOIMIALA,
        alue: mj("Alue tekstinä."),
        kohderyhma: {
          type: "object",
          properties: { tunnus: { type: "string", enum: Object.keys(TARGETS) }, nimi: mj("Väestöryhmä tekstinä.") },
          required: ["tunnus", "nimi"],
        },
        vuosi: VUOSI,
        postinumeroalueet: lista(
          {
            type: "object",
            properties: {
              postinumero: mj("Postinumero."),
              nimi: mj("Postinumeroalueen nimi."),
              yrityksia: kl("Toimivat kaupparekisteriyhteisöt toimialalla (alaraja, toiminimet puuttuvat)."),
              vaesto: lukuTaiNull("Kohderyhmän asukkaat (null = salattu)."),
              asukasta_per_yritys: lukuTaiNull("Kohderyhmän asukkaita yritystä kohden, 1 desimaali (null, jos yrityksiä 0 tai väestö salattu)."),
            },
            required: ["postinumero", "nimi", "yrityksia", "vaesto", "asukasta_per_yritys"],
          },
          "Postinumeroalueet.",
        ),
        yhteensa: {
          type: "object",
          properties: {
            yrityksia: kl("Yrityksiä yhteensä."),
            vaesto: { type: "number", description: "Kohderyhmän asukkaat yhteensä (salatut alueet puuttuvat)." },
            vaesto_osin_salattu: { type: "boolean" },
            asukasta_per_yritys: lukuTaiNull("Asukkaita yritystä kohden, 1 desimaali."),
          },
          required: ["yrityksia", "vaesto", "vaesto_osin_salattu", "asukasta_per_yritys"],
        },
        tuntemattomat: lista({ type: "string" }, "Postinumerot, joille ei ole Paavo-tietoa."),
        osin_laskematta: { type: "boolean", description: "true = jollakin postinumerolla oli yli 300 osumaa, joten kaikkia ei laskettu." },
        kattavuus: KATTAVUUS,
        yritykset: lista(YRITYS_RIVI, `Löydetyt yritykset postinumeron mukaan, enintään ${ALUETARKISTUS_YRITYKSET_ENINTAAN} (vain, kun nayta_yritykset ei ole false).`),
        yritykset_rajattu: { type: "boolean", description: `true = yrityksiä oli yli ${ALUETARKISTUS_YRITYKSET_ENINTAAN}; tekstissä ovat kaikki.` },
        lahde: LAHDE_SKEEMA,
        lahteet: lista(LAHDE_SKEEMA, "Kaikki lähteet linkkeineen (YTJ ja Paavo)."),
      },
      required: ["toimiala", "alue", "kohderyhma", "vuosi", "postinumeroalueet", "yhteensa", "tuntemattomat", "osin_laskematta", "kattavuus", "lahde"],
    }),
    hae: aluetarkistusTulos,
    teksti: aluetarkistusTeksti,
  }),
  luku({
    nimi: "hae_tilastoja",
    kuvaus:
      "Hakee Tilastokeskuksen StatFin-tietokannan taulukoita hakusanalla (esim. \"työttömyysaste\", \"kotitalouksien velat\", \"yritykset toimialoittain\", \"väestöennuste\"). Palauttaa taulukon tunnuksen (esim. tyti/135z), otsikon ja päivityspäivän. Rakenne tilaston_rakenne-työkalulla ja luvut tilasto-työkalulla.",
    syote: {
      type: "object",
      properties: {
        hakusana: { type: "string", description: "Hakusanat, esim. \"työllisyysaste kunnittain\"." },
        sivu: { type: "integer", description: "Tulossivu, 1 = ensimmäinen (20 taulukkoa sivulla)." },
      },
      required: ["hakusana"],
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        hakusana: mj("Hakusana."),
        yhteensa: kl("Osumia yhteensä (0 = ei osumia)."),
        ...SIVUTUS,
        sivun_koko: kl("Taulukoita sivulla (20)."),
        taulukot: lista(
          {
            type: "object",
            properties: {
              tunnus: mj("Taulukon tunnus tilasto- ja tilaston_rakenne-työkaluille, esim. \"tyti/135z\"."),
              otsikko: mj("Taulukon otsikko."),
              paivitetty: taiNull({ type: "string" }, "Päivityspäivä (VVVV-KK-PP)."),
              linkki: mj("Taulukon sivu Tilastokeskuksen PxWeb-palvelussa."),
            },
            required: ["tunnus", "otsikko", "linkki"],
          },
          "Tämän sivun taulukot osuvin ensin.",
        ),
        lahde: LAHDE_SKEEMA,
      },
      required: ["hakusana", "yhteensa", "sivu", "sivuja", "seuraava", "taulukot", "lahde"],
    }),
    hae: haeTilastojaTulos,
    teksti: haeTilastojaTeksti,
  }),
  luku({
    nimi: "tilasto",
    kuvaus:
      "Hakee luvut StatFin-taulukosta. valinnat: { muuttuja: arvo tai [arvot] }, muuttuja koodina tai nimenä, arvo koodina tai tekstinä; \"*\" = kaikki, \"viimeiset 5\" = aikamuuttujan viimeiset. Valitsematta jätetyt: aika = viimeisin, eliminoitava = yhteensä, muut = ensimmäinen arvo. Enintään 3 000 solua. Kerro taulukon tunnus ja nimi, rajaukset, vuosi tai kuukausi ja lähde (Tilastokeskus, StatFin).",
    syote: {
      type: "object",
      properties: {
        taulukko: { type: "string", description: "Taulukon tunnus, esim. \"vaerak/11rc\"." },
        valinnat: { type: "object", description: "Esim. {\"Vuosi\": \"viimeiset 3\", \"Ikä\": [\"75 - 79\", \"80 - 84\"], \"Sukupuoli\": \"Naiset\"}.", additionalProperties: true },
      },
      required: ["taulukko"],
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        taulukko: mj("Taulukon tunnus, esim. \"vaerak/11rc\"."),
        otsikko: mj("Taulukon otsikko."),
        paivitetty: taiNull({ type: "string" }, "Taulukon päivitysaika lähteen mukaan (ISO 8601)."),
        aika: taiNull(
          { type: "object", properties: { muuttuja: mj("Aikamuuttujan nimi (esim. Vuosi, Kuukausi)."), arvot: lista({ type: "string" }, "Valitut ajankohdat (tilastovuosi tai -kuukausi).") }, required: ["muuttuja", "arvot"] },
          "Tulokseen valitut ajankohdat.",
        ),
        rajaus: lista(
          { type: "object", properties: { muuttuja: { type: "string" }, arvo: { type: "string" } }, required: ["muuttuja", "arvo"] },
          "Muuttujat, joilla on yksi arvo.",
        ),
        oletusvalinnat: lista({ type: "string" }, "Valitsematta jätettyjen muuttujien oletusarvot."),
        yksikot: lista({ type: "object", properties: { nimi: { type: "string" }, yksikko: { type: "string" } }, required: ["nimi", "yksikko"] }, "Tietojen yksiköt (enintään 10)."),
        sarakkeet: lista({ type: "string" }, "Muuttujat, joilla on useampi arvo; rivin luokat ovat tässä järjestyksessä."),
        soluja: kl("Rivejä (soluja) yhteensä, enintään 3 000."),
        rivit: lista(
          {
            type: "object",
            properties: {
              luokat: lista({ type: "string" }, "Rivin luokat sarakkeiden järjestyksessä."),
              arvo: lukuTaiNull("Luku (null = tieto puuttuu tai on salassa pidettävä)."),
              tila: taiNull({ type: "string" }, "Lähteen merkintä arvosta (esim. \"..\")."),
            },
            required: ["luokat", "arvo", "tila"],
          },
          "Luvut.",
        ),
        huomautukset: lista({ type: "string" }, "Taulukon huomautukset (enintään 5)."),
        lahde: LAHDE_SKEEMA,
      },
      required: ["taulukko", "otsikko", "paivitetty", "aika", "rajaus", "oletusvalinnat", "yksikot", "sarakkeet", "soluja", "rivit", "huomautukset", "lahde"],
    }),
    hae: tilastoTulos,
    teksti: tilastoTeksti,
  }),
];
