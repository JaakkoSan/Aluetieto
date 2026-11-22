// Yhteisen rungon tyokalu()-muodossa olevat työkalut (koodiajo-valmius). 1.16.0: etsi_toimiala, hae_yrityksia,
// alueen_vaesto, aluetarkistus, hae_tilastoja ja tilasto; 1.17.0: yrityksen_tiedot, hintaindeksi, indeksitarkistus, korot,
// hae_julkisia_palveluja, tulevat_paivat ja koululomat. Logiikka on tools.js:n funktioissa (<nimi>Tulos hakee ja
// palauttaa rakenteisen tuloksen, <nimi>Teksti muotoilee siitä saman tekstin kuin ennen), ja työkalu on ohut kuori
// niiden päällä. Kaikki vain lukevat (oikeus "luku"). Muut 17 työkalua ovat yhä tools.js:n TOOLS-listassa (callTool).

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
  yrityksenTiedotTulos,
  yrityksenTiedotTeksti,
  hintaindeksiTulos,
  hintaindeksiTeksti,
  indeksitarkistusTulos,
  indeksitarkistusTeksti,
  korotTulos,
  korotTeksti,
  haeJulkisiaPalvelujaTulos,
  haeJulkisiaPalvelujaTeksti,
  tulevatPaivatTulos,
  tulevatPaivatTeksti,
  koululomatTulos,
  koululomatTeksti,
  PALVELUJA_ENINTAAN,
  ALUETARKISTUS_YRITYKSET_ENINTAAN,
  TILASTO_RIVEJA_SIVULLA,
  UserError,
  EiLoydyVirhe,
  TARGETS,
  TITLES,
  areaProps,
} from "./tools.js";
import * as kal from "./kalenteri.js";

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

/** Hinta- tai elinkustannusindeksin sarja. */
const INDEKSI = {
  type: "object",
  properties: {
    tunnus: { type: "string", enum: ["khi", "elinkustannus"], description: "khi = kuluttajahintaindeksi, elinkustannus = elinkustannusindeksi." },
    nimi: mj("Indeksin nimi."),
    sarja: mj("Sarja ja perusvuosi tekstinä (esim. 2015=100)."),
    perusvuosi: mj("Perusvuosi."),
  },
  required: ["tunnus", "nimi", "sarja", "perusvuosi"],
};

/** Indeksin ajankohta ja pisteluku. */
const AJANKOHTA = {
  type: "object",
  properties: { ajankohta: mj("Kuukausi (VVVV-KK) tai vuosi (VVVV, vuosikeskiarvo)."), pisteluku: { type: "number", description: "Pisteluku." } },
  required: ["ajankohta", "pisteluku"],
};

/** Lomajakso. */
const JAKSO = {
  type: "object",
  properties: { alkaa: mj("Ensimmäinen päivä (VVVV-KK-PP)."), paattyy: mj("Viimeinen päivä (VVVV-KK-PP).") },
  required: ["alkaa", "paattyy"],
};

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

        sivu: { type: "integer", minimum: 1, description: `Rivisivu, 1 = ensimmäinen (enintään ${TILASTO_RIVEJA_SIVULLA} riviä sivulla, pitkillä riveillä vähemmän).` },
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
        soluja: kl("Rivejä (soluja) kyselyssä yhteensä, enintään 3 000."),
        ...SIVUTUS,
        sivun_koko: kl(`Rivejä sivulla enintään (${TILASTO_RIVEJA_SIVULLA}, tai vähemmän, jos rivit ovat pitkiä; sama kuin tekstissä).`),
        rivit_alkaen: kl("Tämän sivun ensimmäisen rivin järjestysnumero (1 = ensimmäinen; 0, jos rivejä ei ole)."),
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
          "Tämän sivun luvut (sama rajaus kuin tekstissä).",
        ),
        huomautukset: lista({ type: "string" }, "Taulukon huomautukset (enintään 5)."),
        lahde: LAHDE_SKEEMA,
      },
      required: ["taulukko", "otsikko", "paivitetty", "aika", "rajaus", "oletusvalinnat", "yksikot", "sarakkeet", "soluja", "sivu", "sivuja", "seuraava", "sivun_koko", "rivit_alkaen", "rivit", "huomautukset", "lahde"],
    }),
    hae: tilastoTulos,
    teksti: tilastoTeksti,
  }),
  // ---------- 1.17.0: koodiajo-valmiuden toinen erä ----------
  luku({
    nimi: "yrityksen_tiedot",
    kuvaus:
      "Palauttaa yhden yrityksen YTJ-tiedot y-tunnuksella: nimet ja aputoiminimet, yritysmuoto, päätoimiala, osoite, rekisterit (kaupparekisteri, ALV, ennakkoperintä, työnantajarekisteri), tila ja mahdollinen konkurssi, saneeraus tai selvitystila.",
    syote: {
      type: "object",
      properties: { y_tunnus: { type: "string", description: "Y-tunnus, esim. \"0112038-9\"." } },
      required: ["y_tunnus"],
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        y_tunnus: mj("Y-tunnus."),
        loytyi: { type: "boolean", description: "false = Y-tunnuksella ei löytynyt yritystä YTJ:n avoimesta datasta (toiminimet puuttuvat); muut tiedot puuttuvat silloin." },
        nimi: mj("Voimassa oleva nimi."),
        tila: mj("Tila tekstinä (esim. rekisterissä, lakannut)."),
        toimiva: { type: "boolean", description: "Kaupparekisterissä ja toiminnassa." },
        tilanteet: lista({ type: "string" }, "Konkurssi, saneeraus, selvitystila ym."),
        yritysmuoto: taiNull({ type: "string" }, "Yritysmuoto."),
        toimiala: taiNull(TOIMIALA, "Päätoimiala (yrityksen ilmoittama)."),
        osoite: taiNull({ type: "string" }, "Käynti- tai postiosoite."),
        postinumero: taiNull({ type: "string" }, "Osoitteen postinumero."),
        rekisteroity: taiNull({ type: "string" }, "Rekisteröintipäivä (VVVV-KK-PP)."),
        muut_nimet: lista({ type: "string" }, "Voimassa olevat muut nimet (aputoiminimet ym.)."),
        rekisterit: lista(
          {
            type: "object",
            properties: {
              rekisteri: mj("Rekisteri ja tila tekstinä (kaupparekisteri, ALV, ennakkoperintä, työnantajarekisteri)."),
              alkaen: taiNull({ type: "string" }, "Merkitty rekisteriin (VVVV-KK-PP)."),
              paattyy: taiNull({ type: "string" }, "Merkintä päättyy (VVVV-KK-PP)."),
            },
            required: ["rekisteri", "alkaen", "paattyy"],
          },
          "Voimassa olevat rekisterimerkinnät.",
        ),
        paivitetty: taiNull({ type: "string" }, "Viimeisin muutos YTJ:ssä lähteen aikaleimana (VVVV-KK-PPTHH:MM:SS; tekstissä vain päivä)."),
        linkki: mj("Yrityksen sivu YTJ:n tietopalvelussa."),
        kattavuus: KATTAVUUS,
        lahde: LAHDE_SKEEMA,
      },
      required: ["y_tunnus", "loytyi", "kattavuus", "lahde"],
    }),
    hae: yrityksenTiedotTulos,
    teksti: yrityksenTiedotTeksti,
  }),
  luku({
    nimi: "hintaindeksi",
    kuvaus:
      "Kuluttajahintaindeksin tai elinkustannusindeksin pisteluvut ja vuosimuutos kuukausittain (Tilastokeskus). Oletuksena viimeiset 13 kuukautta. Inflaatio, hintojen nousu, indeksisidonnaiset sopimukset. Kerro lähde (Tilastokeskus).",
    syote: {
      type: "object",
      properties: {
        indeksi: { type: "string", enum: ["khi", "elinkustannus"], description: "khi = kuluttajahintaindeksi (oletus), elinkustannus = elinkustannusindeksi 1951:10=100." },
        perusvuosi: { type: "string", description: "Kuluttajahintaindeksin perusvuosi: 2015 (oletus), 2025, 2010, 2005, 2000, 1995 … 1972." },
        alkaen: { type: "string", description: "Ensimmäinen kuukausi (VVVV-KK). Valinnainen." },
        paattyen: { type: "string", description: "Viimeinen kuukausi (VVVV-KK). Oletus: viimeisin julkaistu." },
      },
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        indeksi: INDEKSI,
        alkaen: mj("Ensimmäinen kuukausi (VVVV-KK)."),
        paattyen: mj("Viimeinen kuukausi (VVVV-KK)."),
        viimeisin: mj("Viimeisin julkaistu kuukausi (VVVV-KK)."),
        vuosimuutos_peruste: {
          type: "string",
          enum: ["virallinen", "laskettu"],
          description: "virallinen = Tilastokeskuksen kuluttajahintaindeksin vuosimuutos (taulukko 122p, sama kaikilla perusvuosilla); laskettu = 12 kuukauden muutos pisteluvuista.",
        },
        kuukaudet: lista(
          {
            type: "object",
            properties: {
              kuukausi: mj("Kuukausi (VVVV-KK)."),
              pisteluku: { type: "number", description: "Pisteluku." },
              vuosimuutos: lukuTaiNull("Vuosimuutos prosentteina (null = ei tiedossa)."),
            },
            required: ["kuukausi", "pisteluku", "vuosimuutos"],
          },
          "Kuukaudet vanhimmasta uusimpaan, enintään 240.",
        ),
        paivitetty: taiNull({ type: "string" }, "Taulukon päivitysaika lähteen mukaan."),
        lahde: LAHDE_SKEEMA,
      },
      required: ["indeksi", "alkaen", "paattyen", "viimeisin", "vuosimuutos_peruste", "kuukaudet", "paivitetty", "lahde"],
    }),
    hae: hintaindeksiTulos,
    teksti: hintaindeksiTeksti,
  }),
  luku({
    nimi: "indeksitarkistus",
    kuvaus:
      "Laskee indeksitarkistuksen (esim. vuokran tai sopimushinnan korotus) kuluttajahinta- tai elinkustannusindeksillä: pisteluvut lähtö- ja tarkistusajankohtana, muutosprosentti, kerroin ja tarkistettu summa. Kerro indeksi, perusvuosi ja kuukaudet sekä lähde (Tilastokeskus). Sopimuksen ehdot (indeksi, perusvuosi, tarkistuskuukausi, rajat) ratkaisevat.",
    syote: {
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
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        indeksi: INDEKSI,
        vuosikeskiarvot: { type: "boolean", description: "true = vuosikeskiarvot (ajankohdat vuosia), false = kuukaudet." },
        lahtokohta: AJANKOHTA,
        tarkistus: {
          ...AJANKOHTA,
          properties: { ...AJANKOHTA.properties, viimeisin_julkaistu: { type: "boolean", description: "true = tarkistusajankohtaa ei annettu, joten käytettiin viimeisintä julkaistua." } },
          required: [...AJANKOHTA.required, "viimeisin_julkaistu"],
        },
        muutos_prosenttia: { type: "number", description: "Muutos prosentteina (4 desimaalia; tekstissä 2)." },
        kerroin: { type: "number", description: "Kerroin = tarkistuksen pisteluku / lähtökohdan pisteluku (6 desimaalia; tekstissä 4)." },
        summa: taiNull(
          {
            type: "object",
            properties: {
              alkuperainen: { type: "number", description: "Annettu summa." },
              tarkistettu: { type: "number", description: "Tarkistettu summa, 2 desimaalia." },
              muutos: { type: "number", description: "Muutos, 2 desimaalia." },
            },
            required: ["alkuperainen", "tarkistettu", "muutos"],
          },
          "Tarkistettu summa (null, jos summaa ei annettu).",
        ),
        lahde: LAHDE_SKEEMA,
      },
      required: ["indeksi", "vuosikeskiarvot", "lahtokohta", "tarkistus", "muutos_prosenttia", "kerroin", "summa", "lahde"],
    }),
    hae: indeksitarkistusTulos,
    teksti: indeksitarkistusTeksti,
  }),
  luku({
    nimi: "korot",
    kuvaus:
      "Korkolain viitekorko ja viivästyskorot (tavallinen ja kaupallisten sopimusten) annettuna päivänä sekä EKP:n ohjauskorot (talletuskorko, perusrahoitusoperaatiot, maksuvalmiusluotto). Valinnaisesti viitekorkojen historia puolivuosittain vuodesta 2009. Kerro lähde (Tilastokeskus tai EKP). Viitekorko on laskettu korkolain 12 §:n mukaan; virallisen viitekoron julkaisee Suomen Pankki.",
    syote: {
      type: "object",
      properties: {
        paiva: { type: "string", description: "Päivä (VVVV-KK-PP). Oletus: tänään." },
        historia: { type: "boolean", description: "true = myös viitekorot puolivuosittain." },
      },
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        paiva: mj("Päivä (VVVV-KK-PP), jolle korot on haettu."),
        viitekorko_ennen_2009: { type: "boolean", description: "true = päivän puolivuotiskausi alkaa ennen vuotta 2009, joten viitekorkoa ei lasketa (katso Suomen Pankin julkaisemat viitekorot)." },
        viitekorko: taiNull(
          {
            type: "object",
            properties: {
              kausi_alkaa: mj("Puolivuotiskauden alku (VVVV-KK-PP)."),
              kausi_paattyy: mj("Puolivuotiskauden loppu (VVVV-KK-PP)."),
              korko: { type: "number", description: "Korkolain 12 §:n viitekorko, %." },
              ekp_perusrahoituskorko: { type: "number", description: "EKP:n perusrahoitusoperaatioiden korko ennen kauden alkua, %." },
              ekp_perusrahoituskorko_alkaen: mj("Mainittu korko voimassa alkaen (VVVV-KK-PP)."),
              viivastyskorko: { type: "number", description: "Viitekorko + 7 prosenttiyksikköä (korkolaki 4 §), %." },
              viivastyskorko_kaupallinen: { type: "number", description: "Viitekorko + 8 prosenttiyksikköä (korkolaki 4 a §, kaupalliset sopimukset), %." },
            },
            required: ["kausi_alkaa", "kausi_paattyy", "korko", "ekp_perusrahoituskorko", "ekp_perusrahoituskorko_alkaen", "viivastyskorko", "viivastyskorko_kaupallinen"],
          },
          "Laskettu viitekorko ja viivästyskorot (null, jos ei laskettu). Virallisen viitekoron julkaisee Suomen Pankki.",
        ),
        ohjauskorot: lista(
          {
            type: "object",
            properties: {
              tunnus: { type: "string", enum: ["talletuskorko", "perusrahoitusoperaatiot", "maksuvalmiusluotto"] },
              nimi: mj("Koron nimi."),
              korko: { type: "number", description: "Korko päivänä, %." },
              alkaen: mj("Voimassa alkaen (VVVV-KK-PP)."),
            },
            required: ["tunnus", "nimi", "korko", "alkaen"],
          },
          "EKP:n ohjauskorot päivänä.",
        ),
        historia: taiNull(
          lista(
            {
              type: "object",
              properties: { kausi_alkaa: { type: "string" }, kausi_paattyy: { type: "string" }, korko: { type: "number" } },
              required: ["kausi_alkaa", "kausi_paattyy", "korko"],
            },
            "Viitekorot puolivuosittain uusin ensin, enintään 40 kautta.",
          ),
          "Viitekorkojen historia (vain, kun historia = true; muuten null).",
        ),
        lahde: LAHDE_SKEEMA,
      },
      required: ["paiva", "viitekorko_ennen_2009", "viitekorko", "ohjauskorot", "historia", "lahde"],
    }),
    hae: korotTulos,
    teksti: korotTeksti,
  }),
  luku({
    nimi: "hae_julkisia_palveluja",
    kuvaus:
      "Hakee kunnan tai hyvinvointialueen julkisia palveluja Suomi.fi-palvelutietovarannosta (kunnat, hyvinvointialueet, valtion virastot): palvelun nimi ja tunniste. Rajaa hakusanalla, esim. \"kotihoito\", \"palveluseteli\", \"omaishoito\". Palvelun tiedot (kuvaus, palveluseteli, maksut, yhteystiedot) julkinen_palvelu-työkalulla. Mukana voi olla myös yritysten markkinaehtoisia palveluja.",
    syote: {
      type: "object",
      properties: {
        alue: { type: "string", description: "Kunta tai hyvinvointialue, esim. \"Kotka\" tai \"Kymenlaakson hyvinvointialue\"." },
        hakusana: { type: "string", description: "Sana palvelun nimestä. Valinnainen; ilman hakusanaa koko luettelo." },
        koko_maa: { type: "boolean", description: "true = myös koko maata koskevat palvelut (esim. Kela, Verohallinto)." },
      },
      required: ["alue"],
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        alue: mj("Alue (kunta tai hyvinvointialue) palvelutietovarannon mukaan."),
        hakusana: taiNull({ type: "string" }, "Annettu hakusana (null = ei hakusanaa)."),
        koko_maa: { type: "boolean", description: "true = mukana myös koko maata koskevat palvelut." },
        yhteensa: kl("Palveluja yhteensä hakuehdoilla."),
        rajattu: { type: "boolean", description: `true = palveluja yli ${PALVELUJA_ENINTAAN}, listassa ${PALVELUJA_ENINTAAN} ensimmäistä; rajaa hakusanalla.` },
        palvelut: lista(
          {
            type: "object",
            properties: {
              tunniste: mj("Palvelun tunniste (GUID) julkinen_palvelu-työkalulle."),
              nimi: taiNull({ type: "string" }, "Palvelun nimi."),
            },
            required: ["tunniste", "nimi"],
          },
          `Palvelut nimen mukaan aakkosjärjestyksessä, enintään ${PALVELUJA_ENINTAAN}.`,
        ),
        lahde: LAHDE_SKEEMA,
      },
      required: ["alue", "hakusana", "koko_maa", "yhteensa", "rajattu", "palvelut", "lahde"],
    }),
    hae: haeJulkisiaPalvelujaTulos,
    teksti: haeJulkisiaPalvelujaTeksti,
  }),
  luku({
    nimi: "tulevat_paivat",
    // Käsin ylläpidetty taulukko, ei verkkohakuja (openWorldHint false kuten ennen).
    avoin: false,
    kuvaus:
      "Markkinointikalenteri: pyhä- ja juhlapäivät, aatot, viralliset ja vakiintuneet liputuspäivät, kaupalliset sesongit (esim. ystävänpäivä, äitienpäivä, Black Friday), kesäajan vaihdokset, alalle sopivat YK:n ja WHO:n teemapäivät, suomalaisten järjestöjen teemapäivät ja valinnaisesti kunnan koululomat aikavälillä. Pyhäpäivät ja liikkuvat juhlat lasketaan säännöistä; muut ovat käsin ylläpidetty taulukko lähteineen (ei verkkohakuja). Valinnaisesti kampanjan aloituspäivä N päivää ennen. Kerro päivä, sääntö ja Lähde-linkki. Tiedot on tarkistettu käsin tiettynä päivänä; kehota tarkistamaan tärkeän kampanjan päivä lähteestä ja koululomat kunnalta. Teemapäivän nimeä, jossa on merkintä \"virallista suomenkielistä nimeä ei ole tarkistettu\", ei pidä esittää virallisena. Alennuskampanjoissa kerro kuluttajansuojalain 2 luvun 11 §:n huomautus (alin hinta 30 päivältä, koskee tavaroita) mutta älä anna muuta oikeudellista neuvontaa. Nimipäiviä ei ole.",
    syote: {
      type: "object",
      properties: {
        alkaen: { type: "string", description: "Aikavälin alku muodossa 2026-11-13 tai 13.11.2026. Oletus: tänään (Suomen aikaa)." },
        paivia: { type: "integer", minimum: 1, maximum: 400, description: "Aikavälin pituus päivinä, 1–400. Oletus 60. Ei käytetä, jos loppuu annetaan." },
        loppuu: { type: "string", description: "Aikavälin loppu (mukaan lukien). Enintään 400 päivää alusta." },
        luokat: {
          type: "array",
          items: { type: "string", enum: Object.keys(kal.LUOKAT) },
          description: "Rajaa luokkiin: pyha, aatto, liputus_virallinen, liputus_vakiintunut, sesonki, teema (YK, WHO), jarjesto (suomalaiset järjestöt), koululoma, aika (kesäaika). Oletus: kaikki.",
        },
        ala: { type: "string", enum: kal.ALAT, description: "kauneus, hyvinvointi tai terveys rajaa teemapäivät alalle sopiviin (muut luokat näkyvät aina). Oletus kaikki." },
        kunta: { type: "string", description: "Kunta, jonka koululomat lisätään (nyt taulukossa: Kotka). Oletus: vain valtakunnallinen koulun päättymissääntö." },
        ennakko_paivia: { type: "integer", minimum: 1, maximum: 120, description: "Näytä kampanjan aloituspäivä näin monta päivää ennen jokaista päivää (esim. 14). Mukaan tulevat myös päivät, joiden kampanja alkaa aikavälillä." },
      },
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        alkaen: mj("Aikavälin alku (VVVV-KK-PP)."),
        loppuu: mj("Aikavälin loppu (VVVV-KK-PP), mukaan lukien."),
        luokat: taiNull(lista({ type: "string" }), "Rajatut luokat (null = kaikki)."),
        ala: { type: "string", enum: kal.ALAT, description: "Teemapäivien ala." },
        kunta: taiNull({ type: "string" }, "Kunta, jonka koululomat ovat mukana (null = ei kuntaa)."),
        kunta_ei_taulukossa: taiNull({ type: "string" }, "Annettu kunta, jonka koululomia ei ole taulukossa (mukana vain valtakunnallinen koulun päättymissääntö)."),
        kunnat_taulukossa: lista({ type: "string" }, "Kunnat, joiden koululomat ovat taulukossa."),
        ennakko_paivia: taiNull({ type: "integer" }, "Kampanjan aloitus näin monta päivää ennen (null = ei)."),
        maara: kl("Päiviä tuloksessa."),
        paivat: lista(
          {
            type: "object",
            properties: {
              pvm: mj("Päivä (VVVV-KK-PP)."),
              nimi: mj("Päivän nimi."),
              luokat: lista({ type: "string", enum: Object.keys(kal.LUOKAT) }, "Luokat (pyha, aatto, liputus_virallinen, liputus_vakiintunut, sesonki, teema, jarjesto, koululoma, aika)."),
              saanto: mj("Miten päivä määräytyy."),
              asema: taiNull({ type: "string" }, "Säädöksen mukainen asema."),
              tarjouksiin: taiNull({ type: "boolean", const: false }, "false = ei sovi tarjouksiin; null = ei rajoitusta."),
              kampanja_alkaa: taiNull({ type: "string" }, "Kampanjan aloituspäivä (VVVV-KK-PP), kun ennakko_paivia on annettu."),
              aikavalin_jalkeen: { type: "boolean", description: "true = päivä on aikavälin jälkeen, mutta sen kampanja alkaa aikavälillä." },
              huom: taiNull({ type: "string" }, "Huomautus (esim. alennusmarkkinointi, kuluttajansuojalaki 2 luku 11 §)."),
              lahde: { ...LAHDE_SKEEMA, description: "Päivän lähde ja linkki." },
              lisalahde: taiNull(LAHDE_SKEEMA, "Lisälähde."),
            },
            required: ["pvm", "nimi", "luokat", "saanto", "asema", "tarjouksiin", "kampanja_alkaa", "aikavalin_jalkeen", "huom", "lahde", "lisalahde"],
          },
          "Päivät aikajärjestyksessä (aikaväli enintään 400 päivää).",
        ),
        tarkistettu: mj("Taulukon tarkistuspäivä."),
        lahde: LAHDE_SKEEMA,
      },
      required: ["alkaen", "loppuu", "luokat", "ala", "kunta", "kunta_ei_taulukossa", "kunnat_taulukossa", "ennakko_paivia", "maara", "paivat", "tarkistettu", "lahde"],
    }),
    hae: tulevatPaivatTulos,
    teksti: tulevatPaivatTeksti,
  }),
  luku({
    nimi: "koululomat",
    avoin: false,
    kuvaus:
      "Kunnan peruskoulujen työ- ja loma-ajat lukuvuodelta: koulun alku, syys-, joulu- ja talviloma sekä päättyminen, lähde ja tarkistuspäivä. Käsin ylläpidetty taulukko Opetushallituksen luettelosta (nyt Kotka 2026–2027) sekä valtakunnalliset säännöt (lukuvuosi 1.8.–31.7., koulutyö päättyy viikon 22 lauantaina). Kerro päivä, lähde ja tarkistuspäivä sekä Lähde-linkki, ja kehota tarkistamaan koululomat kunnalta.",
    syote: {
      type: "object",
      properties: {
        kunta: { type: "string", description: "Kunnan nimi, esim. \"Kotka\"." },
        lukuvuosi: { type: "string", description: "Lukuvuosi muodossa 2026-2027. Oletus: kuluva lukuvuosi." },
      },
      required: ["kunta"],
    },
    tulosSkeema: taiVirhe({
      type: "object",
      properties: {
        kunta: mj("Kunta (taulukon kirjoitusasu, tai annettu nimi, jos kuntaa ei ole taulukossa)."),
        tila: {
          type: "string",
          enum: ["loytyi", "kunta_ei_taulukossa", "lukuvuosi_ei_taulukossa"],
          description: "loytyi = loma-ajat taulukosta; muuten vain valtakunnalliset säännöt (tarkista kunnalta).",
        },
        lukuvuosi: mj("Lukuvuosi (VVVV-VVVV)."),
        koulu_paattyy_saannon_mukaan: taiNull({ type: "string" }, "Koulutyön päättymispäivä perusopetusasetuksen säännön mukaan (VVVV-KK-PP)."),
        saannot: lista({ type: "string" }, "Valtakunnalliset säännöt tekstinä lähteineen."),
        kunnat_taulukossa: lista({ type: "string" }, "Kunnat, joiden loma-ajat ovat taulukossa."),
        kunnan_lukuvuodet: lista({ type: "string" }, "Kunnan lukuvuodet taulukossa (vain, kun tila = lukuvuosi_ei_taulukossa)."),
        loma_ajat: taiNull(
          {
            type: "object",
            properties: {
              alkaa: mj("Koulu alkaa (VVVV-KK-PP)."),
              syysloma: JAKSO,
              joululoma: JAKSO,
              talviloma: JAKSO,
              paattyy: mj("Koulu päättyy (VVVV-KK-PP)."),
            },
            required: ["alkaa", "syysloma", "joululoma", "talviloma", "paattyy"],
          },
          "Kunnan loma-ajat (null, jos ei taulukossa).",
        ),
        tarkistettu: mj("Tietojen tarkistuspäivä (vain, kun tila = loytyi)."),
        lahde: LAHDE_SKEEMA,
        lisalahde: taiNull(LAHDE_SKEEMA, "Kunnan oma lähde (vain, kun tila = loytyi)."),
        lahteet: lista(LAHDE_SKEEMA, "Kaikki lähteet linkkeineen."),
      },
      required: ["kunta", "tila", "lukuvuosi", "koulu_paattyy_saannon_mukaan", "saannot", "kunnat_taulukossa", "loma_ajat", "lahde"],
    }),
    hae: koululomatTulos,
    teksti: koululomatTeksti,
  }),
];
