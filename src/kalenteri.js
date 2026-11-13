// Markkinointikalenteri: pyhä-, juhla-, liputus- ja teemapäivät, kaupalliset sesongit, kesäaika ja koululomat.
// Staattinen taulukko ja laskusäännöt ilman ajonaikaisia hakuja (käyttäjän päätös 13.11.2026).
// Suunnitelma: Liittimet/suunnitelmat/markkinointikalenteri.md. Vuosittainen ylläpito: ks. PROJECT.md.
//
// Päivämäärät käsitellään UTC-keskiyön Date-olioina, joten aikavyöhyke ei vaikuta laskuun.

export const TARKISTETTU = "13.11.2026";
/** Taulukon voimassaolo: menneitä vuosia ei tueta, koska luettelot kuvaavat tilannetta 13.11.2026. */
export const ENSIMMAINEN_VUOSI = 2026;
export const VIIMEINEN_VUOSI = 2100;

// ---------- Laskusäännöt ----------

export function pvm(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}

export function lisaa(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Pääsiäispäivä gregoriaanisella laskulla (Meeus/Jones/Butcher). */
export function paasiainen(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return pvm(y, month, day);
}

/** Kuukauden n:s viikonpäivä (wd 0 = sunnuntai). */
export function nsViikonpaiva(y, m, wd, n) {
  const first = pvm(y, m, 1);
  const offset = (wd - first.getUTCDay() + 7) % 7;
  return pvm(y, m, 1 + offset + (n - 1) * 7);
}

/** Kuukauden viimeinen viikonpäivä. */
export function viimeinenViikonpaiva(y, m, wd) {
  const last = new Date(Date.UTC(y, m, 0));
  const back = (last.getUTCDay() - wd + 7) % 7;
  return lisaa(last, -back);
}

/** Ensimmäinen viikonpäivä wd annetusta päivästä alkaen (päivä mukaan lukien). */
export function viikonpaivaAlkaen(y, m, d, wd) {
  const start = pvm(y, m, d);
  return lisaa(start, (wd - start.getUTCDay() + 7) % 7);
}

/** ISO-viikon maanantai. */
export function isoViikonMaanantai(y, week) {
  const jan4 = pvm(y, 1, 4);
  const mondayW1 = lisaa(jan4, -((jan4.getUTCDay() + 6) % 7));
  return lisaa(mondayW1, (week - 1) * 7);
}

/** ISO-viikon numero. */
export function isoViikko(date) {
  const thursday = lisaa(date, 3 - ((date.getUTCDay() + 6) % 7));
  const jan4 = pvm(thursday.getUTCFullYear(), 1, 4);
  const mondayW1 = lisaa(jan4, -((jan4.getUTCDay() + 6) % 7));
  return 1 + Math.round((thursday - mondayW1) / (7 * 86_400_000));
}

/** Lukuvuoden koulutyön päättyminen: ISO-viikon 22 viimeinen arkipäivä eli lauantai (perusopetusasetus 7 §). */
export function koulunPaattyminen(y) {
  return lisaa(isoViikonMaanantai(y, 22), 5);
}

/** Black Friday: Yhdysvaltain kiitospäivää (marraskuun neljäs torstai) seuraava perjantai. */
export function blackFriday(y) {
  return lisaa(nsViikonpaiva(y, 11, 4, 4), 1);
}

// ---------- Lähteet ----------

const FINLEX = (vuosi, nro) => `https://www.finlex.fi/fi/lainsaadanto/${vuosi}/${nro}`;
const L = {
  kirkkolaki: { nimi: "kirkkolaki 652/2023, 1 luku 6 §", url: FINLEX(2023, 652) },
  kirkkojarjestys: { nimi: "kirkkojärjestys 657/2023, 1 luku 4 §", url: FINLEX(2023, 657) },
  liputusasetus: { nimi: "asetus liputuksesta Suomen lipulla 383/1978, 2 §", url: FINLEX(1978, 383) },
  itsenaisyyspaiva: { nimi: "laki itsenäisyyspäivän viettämisestä 388/1937, 1 §", url: FINLEX(1937, 388) },
  sisaministerio: { nimi: "sisäministeriö, liputuspäivät", url: "https://intermin.fi/suomen-lippu/liputuspaivat" },
  vaalit: { nimi: "oikeusministeriö, vaalit.fi: eduskuntavaalit (vaalipäivä huhtikuun kolmas sunnuntai)", url: "https://vaalit.fi/eduskuntavaalit" },
  perusopetusasetus: { nimi: "perusopetusasetus 852/1998, 7 §", url: FINLEX(1998, 852) },
  perusopetuslaki: { nimi: "perusopetuslaki 628/1998, 23 §", url: FINLEX(1998, 628) },
  kesaaika: { nimi: "direktiivi 2000/84/EY, 2 ja 3 artikla", url: "https://eur-lex.europa.eu/legal-content/FI/TXT/?uri=CELEX:32000L0084" },
  ksl: { nimi: "kuluttajansuojalaki 38/1978, 2 luku 11 §", url: FINLEX(1978, 38) },
  kiitospaiva: { nimi: "5 U.S.C. § 6103 (kiitospäivä marraskuun neljäs torstai)", url: "https://www.law.cornell.edu/uscode/text/5/6103" },
  wikidata: (q, nimi) => ({ nimi: `Wikidata ${q} (${nimi}, CC0)`, url: `https://www.wikidata.org/wiki/${q}` }),
  yk: (res, nimi) => ({ nimi: `YK:n yleiskokouksen päätöslauselma ${res} (${nimi})`, url: `https://undocs.org/${res}` }),
  who: (nimi, url) => ({ nimi: `WHO, ${nimi}`, url }),
  thl_kasihygienia: { nimi: "THL, tiedote 5.5.2025: Kansainvälinen käsihygieniapäivä 5.5. muistuttaa suojakäsineiden oikeasta käytöstä (alkuperäinen sivu poistunut, arkistoitu kopio)", url: "https://web.archive.org/web/20250505185900/https://thl.fi/-/kansainvalinen-kasihygieniapaiva-5.5.-muistuttaa-suojakasineiden-oikeasta-kaytosta" },
  jarjesto: (nimi, url) => ({ nimi, url }),
};

const KSL_HUOM =
  "Alennusmarkkinointi: tavaran alennuksessa on ilmoitettava myös alin hinta, jolla tavaraa on markkinoitu alennusta edeltäneiden 30 päivän aikana (kuluttajansuojalaki 2 luku 11 §; pykälä koskee tavaroita; ei oikeudellinen neuvo). Lähde: " +
  L.ksl.url;
const SAVY_HUOM = "Muistopäivä: ei sovi tarjouksiin eikä kevyeen markkinointiin.";

// ---------- Luokat ja alat ----------

export const LUOKAT = {
  pyha: "pyhä- ja juhlapäivä",
  aatto: "aatto",
  liputus_virallinen: "virallinen liputuspäivä",
  liputus_vakiintunut: "vakiintunut liputuspäivä",
  sesonki: "kaupallinen sesonki tai vakiintunut päivä",
  teema: "kansainvälinen teemapäivä (YK, WHO)",
  jarjesto: "suomalaisen järjestön teemapäivä",
  koululoma: "koulut",
  aika: "kesäaika",
};

export const ALAT = ["kaikki", "kauneus", "hyvinvointi", "terveys"];

// ---------- Päivätaulukko ----------
// Kentät: nimi, luokat, paiva(y) -> Date, saanto (teksti), asema (säädöksen mukainen asema, valinnainen),
// ala (oletus kaikki), lahde {nimi, url}, huom (valinnainen), tarjouksiin (oletus true), vuodet (valinnainen rajaus).

const kiintea = (m, d) => (y) => pvm(y, m, d);
const paasiaisesta = (n) => (y) => lisaa(paasiainen(y), n);
const juhannus = (y) => viikonpaivaAlkaen(y, 6, 20, 6);
const pyhainpaiva = (y) => viikonpaivaAlkaen(y, 10, 31, 6);
const PAASIAINEN_SAANTO = "läntisen kristikunnan tapa (gregoriaaninen pääsiäislasku)";

export const PAIVAT = [
  // Pyhä- ja juhlapäivät (kirkkolaki 1:6, kirkkojärjestys 1:4, laki 388/1937)
  { nimi: "Uudenvuodenpäivä", luokat: ["pyha"], paiva: kiintea(1, 1), saanto: "1.1.", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },
  { nimi: "Loppiainen", luokat: ["pyha"], paiva: kiintea(1, 6), saanto: "6.1.", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },
  { nimi: "Pitkäperjantai", luokat: ["pyha"], paiva: paasiaisesta(-2), saanto: `pääsiäispäivää edeltävä perjantai; ${PAASIAINEN_SAANTO}`, asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki, huom: "Kirkkovuoden hiljainen päivä: harkitse markkinoinnin sävyä." },
  { nimi: "Pääsiäispäivä", luokat: ["pyha"], paiva: paasiaisesta(0), saanto: `kevätpäiväntasauksen jälkeistä täydenkuun päivää seuraava sunnuntai (${PAASIAINEN_SAANTO})`, asema: "kirkollinen juhlapäivä", lahde: L.kirkkojarjestys, lisalahde: L.kirkkolaki },
  { nimi: "Toinen pääsiäispäivä", luokat: ["pyha"], paiva: paasiaisesta(1), saanto: "pääsiäispäivää seuraava maanantai", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },
  { nimi: "Helatorstai", luokat: ["pyha"], paiva: paasiaisesta(39), saanto: "39 päivää pääsiäispäivän jälkeen", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },
  { nimi: "Helluntai", luokat: ["pyha"], paiva: paasiaisesta(49), saanto: "49 päivää pääsiäispäivän jälkeen", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },
  { nimi: "Juhannuspäivä, Suomen lipun päivä", luokat: ["pyha", "liputus_virallinen"], paiva: juhannus, saanto: "kesäkuun 19. päivää seuraava lauantai (20.–26.6.)", asema: "kirkollinen juhlapäivä ja virallinen liputuspäivä", lahde: L.kirkkojarjestys, lisalahde: L.liputusasetus },
  { nimi: "Pyhäinpäivä", luokat: ["pyha"], paiva: pyhainpaiva, saanto: "lokakuun 30. päivää seuraava lauantai (31.10.–6.11.)", asema: "kirkollinen juhlapäivä", lahde: L.kirkkojarjestys, lisalahde: L.kirkkolaki, huom: "Vainajien muistamisen päivä: harkitse markkinoinnin sävyä." },
  { nimi: "Itsenäisyyspäivä", luokat: ["pyha", "liputus_virallinen"], paiva: kiintea(12, 6), saanto: "6.12.", asema: "yleinen juhla- ja vapaapäivä (laki 388/1937) ja virallinen liputuspäivä", lahde: L.itsenaisyyspaiva, lisalahde: L.liputusasetus },
  { nimi: "Joulupäivä", luokat: ["pyha"], paiva: kiintea(12, 25), saanto: "25.12.", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },
  { nimi: "Tapaninpäivä (toinen joulupäivä)", luokat: ["pyha"], paiva: kiintea(12, 26), saanto: "26.12.", asema: "kirkollinen juhlapäivä", lahde: L.kirkkolaki },

  // Aatot (vakiintuneet; aattopäivät eivät ole säädöksissä juhlapäiviä)
  { nimi: "Vappuaatto", luokat: ["aatto"], paiva: kiintea(4, 30), saanto: "30.4., vappua edeltävä päivä", lahde: L.liputusasetus },
  { nimi: "Juhannusaatto", luokat: ["aatto"], paiva: (y) => lisaa(juhannus(y), -1), saanto: "juhannuspäivää edeltävä perjantai (19.–25.6.)", lahde: L.kirkkojarjestys, lisalahde: L.sisaministerio, huom: "Suomen lipun päivän liputus alkaa juhannusaattona klo 18 (sisäministeriö)." },
  { nimi: "Jouluaatto", luokat: ["aatto"], paiva: kiintea(12, 24), saanto: "24.12., joulupäivää edeltävä päivä", lahde: L.kirkkolaki },
  { nimi: "Uudenvuodenaatto", luokat: ["aatto"], paiva: kiintea(12, 31), saanto: "31.12., uudenvuodenpäivää edeltävä päivä", lahde: L.kirkkolaki },

  // Viralliset liputuspäivät (asetus 383/1978, 2 §)
  { nimi: "Kalevalan päivä, suomalaisen kulttuurin päivä", luokat: ["liputus_virallinen"], paiva: kiintea(2, 28), saanto: "28.2.", lahde: L.liputusasetus },
  { nimi: "Vappu, suomalaisen työn päivä", luokat: ["liputus_virallinen"], paiva: kiintea(5, 1), saanto: "1.5.", lahde: L.liputusasetus },
  { nimi: "Äitienpäivä", luokat: ["liputus_virallinen", "sesonki"], paiva: (y) => nsViikonpaiva(y, 5, 0, 2), saanto: "toukokuun toinen sunnuntai", lahde: L.liputusasetus, ala: ["kaikki"] },
  { nimi: "Puolustusvoimain lippujuhlan päivä", luokat: ["liputus_virallinen"], paiva: kiintea(6, 4), saanto: "4.6.", lahde: L.liputusasetus },
  { nimi: "Isänpäivä", luokat: ["liputus_virallinen", "sesonki"], paiva: (y) => nsViikonpaiva(y, 11, 0, 2), saanto: "marraskuun toinen sunnuntai", lahde: L.liputusasetus },
  { nimi: "Eduskuntavaalit (vaalipäivä)", luokat: ["liputus_virallinen"], paiva: () => pvm(2027, 4, 18), vuodet: [2027], saanto: "vaalivuoden huhtikuun kolmas sunnuntai, jollei pääsiäisestä muuta johdu; vaalipäivä on virallinen liputuspäivä", lahde: L.vaalit, lisalahde: L.liputusasetus },

  // Vakiintuneet liputuspäivät (sisäministeriö; omat lyhyet nimet)
  { nimi: "J. L. Runebergin päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(2, 5), saanto: "5.2.", lahde: L.sisaministerio },
  { nimi: "Minna Canthin päivä, tasa-arvon päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(3, 19), saanto: "19.3.", lahde: L.sisaministerio },
  { nimi: "Mikael Agricolan päivä, suomen kielen päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(4, 9), saanto: "9.4.", lahde: L.sisaministerio },
  { nimi: "Kansallinen veteraanipäivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(4, 27), saanto: "27.4.", lahde: L.sisaministerio, tarjouksiin: false, huom: SAVY_HUOM },
  { nimi: "Eurooppa-päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(5, 9), saanto: "9.5.", lahde: L.sisaministerio },
  { nimi: "J. V. Snellmanin päivä, suomalaisuuden päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(5, 12), saanto: "12.5.", lahde: L.sisaministerio },
  { nimi: "Kaatuneitten muistopäivä", luokat: ["liputus_vakiintunut"], paiva: (y) => nsViikonpaiva(y, 5, 0, 3), saanto: "toukokuun kolmas sunnuntai", lahde: L.sisaministerio, tarjouksiin: false, huom: SAVY_HUOM },
  { nimi: "Eino Leinon päivä, runon ja suven päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(7, 6), saanto: "6.7.", lahde: L.sisaministerio },
  { nimi: "Suomen luonnon päivä", luokat: ["liputus_vakiintunut"], paiva: (y) => viimeinenViikonpaiva(y, 8, 6), saanto: "elokuun viimeinen lauantai", lahde: L.sisaministerio, ala: ["kaikki"] },
  { nimi: "Miina Sillanpään päivä, kansalaisvaikuttamisen päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(10, 1), saanto: "1.10.", lahde: L.sisaministerio },
  { nimi: "Aleksis Kiven päivä, suomalaisen kirjallisuuden päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(10, 10), saanto: "10.10.", lahde: L.sisaministerio },
  { nimi: "YK:n päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(10, 24), saanto: "24.10.", lahde: L.sisaministerio },
  { nimi: "Ruotsalaisuuden päivä (svenska dagen)", luokat: ["liputus_vakiintunut"], paiva: kiintea(11, 6), saanto: "6.11.", lahde: L.sisaministerio },
  { nimi: "Lapsen oikeuksien päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(11, 20), saanto: "20.11.", lahde: L.sisaministerio },
  { nimi: "Jean Sibeliuksen päivä, suomalaisen musiikin päivä", luokat: ["liputus_vakiintunut"], paiva: kiintea(12, 8), saanto: "8.12.", lahde: L.sisaministerio },

  // Kaupalliset sesongit ja vakiintuneet päivät (ei säädöstä, ellei toisin mainita)
  { nimi: "Ystävänpäivä", luokat: ["sesonki"], paiva: kiintea(2, 14), saanto: "14.2., vakiintunut päivä", lahde: L.wikidata("Q37587", "ystävänpäivä") },
  { nimi: "Laskiaissunnuntai", luokat: ["sesonki"], paiva: paasiaisesta(-49), saanto: "49 päivää ennen pääsiäispäivää", lahde: L.kirkkojarjestys, lisalahde: L.wikidata("Q4845365", "laskiainen") },
  { nimi: "Laskiaistiistai", luokat: ["sesonki"], paiva: paasiaisesta(-47), saanto: "47 päivää ennen pääsiäispäivää", lahde: L.kirkkojarjestys, lisalahde: L.wikidata("Q4845365", "laskiainen") },
  { nimi: "Palmusunnuntai", luokat: ["sesonki"], paiva: paasiaisesta(-7), saanto: "pääsiäispäivää edeltävä sunnuntai", lahde: L.kirkkojarjestys },
  { nimi: "Halloween", luokat: ["sesonki"], paiva: kiintea(10, 31), saanto: "31.10., vakiintunut päivä", lahde: L.wikidata("Q251868", "halloween") },
  { nimi: "Sinkkujen päivä (Singles' Day)", luokat: ["sesonki"], paiva: kiintea(11, 11), saanto: "11.11., kaupallinen käytäntö", lahde: L.wikidata("Q4158493", "sinkkujen päivä"), huom: KSL_HUOM },
  { nimi: "Black Friday", luokat: ["sesonki"], paiva: blackFriday, saanto: "Yhdysvaltain kiitospäivää (marraskuun neljäs torstai) seuraava perjantai, kaupallinen käytäntö", lahde: L.wikidata("Q86483", "Black Friday"), lisalahde: L.kiitospaiva, huom: KSL_HUOM },
  { nimi: "Cyber Monday", luokat: ["sesonki"], paiva: (y) => lisaa(blackFriday(y), 3), saanto: "Black Fridayta seuraava maanantai, kaupallinen käytäntö", lahde: L.wikidata("Q112055", "Cyber Monday"), huom: KSL_HUOM },

  // Kesäaika (direktiivi 2000/84/EY: klo 1.00 UTC)
  { nimi: "Kesäaika alkaa: kelloa siirretään tunti eteenpäin (Suomessa klo 3.00 -> 4.00)", luokat: ["aika"], paiva: (y) => viimeinenViikonpaiva(y, 3, 0), saanto: "maaliskuun viimeinen sunnuntai klo 1.00 UTC", lahde: L.kesaaika, huom: "Tarkista ajastettujen julkaisujen kellonajat." },
  { nimi: "Kesäaika päättyy: kelloa siirretään tunti taaksepäin (Suomessa klo 4.00 -> 3.00)", luokat: ["aika"], paiva: (y) => viimeinenViikonpaiva(y, 10, 0), saanto: "lokakuun viimeinen sunnuntai klo 1.00 UTC", lahde: L.kesaaika, huom: "Tarkista ajastettujen julkaisujen kellonajat." },

  // Koulut: valtakunnallinen sääntö (kuntakohtaiset lomat KOULULOMAT-taulukossa)
  { nimi: "Koulujen lukuvuosi päättyy, kesäloma alkaa (valtakunnallinen sääntö)", luokat: ["koululoma"], paiva: koulunPaattyminen, saanto: "ISO-viikon 22 viimeinen arkipäivä eli lauantai; opetuksen järjestäjä voi poiketa, jos menetettyjä työpäiviä korvataan", lahde: L.perusopetusasetus, ala: ["kaikki"], yleinenKoulu: true },

  // Kansainväliset teemapäivät (käsin valittu; YK:n luetteloa ei kopioida)
  { nimi: "Kansainvälinen naistenpäivä", luokat: ["teema"], paiva: kiintea(3, 8), saanto: "8.3.", lahde: { nimi: "YK, International Women's Day (YK tunnusti päivän 1977)", url: "https://www.un.org/en/observances/womens-day/background" }, ala: ["kauneus", "hyvinvointi"] },
  { nimi: "Kansainvälinen onnellisuuden päivä", luokat: ["teema"], paiva: kiintea(3, 20), saanto: "20.3.", lahde: L.yk("A/RES/66/281", "International Day of Happiness"), ala: ["hyvinvointi"] },
  { nimi: "Maailman terveyspäivä", luokat: ["teema"], paiva: kiintea(4, 7), saanto: "7.4. (WHO:n perustamispäivä)", lahde: L.who("World Health Day", "https://www.who.int/campaigns/world-health-day"), ala: ["hyvinvointi", "terveys"] },
  { nimi: "Kansainvälinen hyvinvointipäivä (International Wellness Day)", luokat: ["teema"], paiva: kiintea(4, 15), saanto: "15.4. (ensimmäisen kerran 2026)", lahde: L.yk("A/RES/80/249", "International Wellness Day"), ala: ["kauneus", "hyvinvointi"], huom: "Vakiintunutta suomenkielistä nimeä ei ole (tarkistettu 13.11.2026); nimi on käännös, älä esitä sitä virallisena." },
  { nimi: "Kansainvälinen käsihygieniapäivä (World Hand Hygiene Day)", luokat: ["teema"], paiva: kiintea(5, 5), saanto: "5.5.", lahde: L.who("World Hand Hygiene Day", "https://www.who.int/campaigns/world-hand-hygiene-day"), ala: ["kauneus", "terveys"], lisalahde: L.thl_kasihygienia, huom: "Vakiintunut suomenkielinen nimi (THL), ei virallista nimeä." },
  { nimi: "Kansainvälinen perheiden päivä", luokat: ["teema"], paiva: kiintea(5, 15), saanto: "15.5.", lahde: L.yk("A/RES/47/237", "International Day of Families"), ala: ["hyvinvointi"] },
  { nimi: "Kansainvälinen joogan päivä", luokat: ["teema"], paiva: kiintea(6, 21), saanto: "21.6.", lahde: L.yk("A/RES/69/131", "International Day of Yoga"), ala: ["hyvinvointi"] },
  { nimi: "Kansainvälinen ystävyyden päivä", luokat: ["teema"], paiva: kiintea(7, 30), saanto: "30.7.", lahde: L.yk("A/RES/65/275", "International Day of Friendship"), ala: ["kauneus", "hyvinvointi"] },
  { nimi: "Kansainvälinen ikääntyneiden päivä", luokat: ["teema"], paiva: kiintea(10, 1), saanto: "1.10.", lahde: L.yk("A/RES/45/106", "International Day of Older Persons"), ala: ["hyvinvointi", "terveys"] },
  { nimi: "Maailman mielenterveyspäivä", luokat: ["teema"], paiva: kiintea(10, 10), saanto: "10.10.", lahde: L.who("World Mental Health Day", "https://www.who.int/campaigns/world-mental-health-day"), ala: ["hyvinvointi", "terveys"] },

  // Suomalaisten järjestöjen teemapäivät (tarkistettu järjestön omalta sivulta 13.11.2026)
  { nimi: "Kansainvälinen fysioterapiapäivä", luokat: ["jarjesto"], paiva: kiintea(9, 8), saanto: "8.9., vuosittain", lahde: L.jarjesto("Suomen Fysioterapeutit", "https://www.suomenfysioterapeutit.fi/ajankohtaista/kansainvalisen-fysioterapiapaivan-8-9-teemana-pitkakestoinen-korona/"), ala: ["hyvinvointi", "terveys"] },
  { nimi: "Atopiapäivä", luokat: ["jarjesto"], paiva: kiintea(9, 14), saanto: "14.9., vuosittain", lahde: L.jarjesto("Allergia-, iho- ja astmaliitto", "https://allergia.fi/vaikuttaminen/kampanjat-ja-teemapaivat/atopiapaiva/"), ala: ["kauneus", "terveys"] },
  { nimi: "Maailman sydänpäivä", luokat: ["jarjesto"], paiva: kiintea(9, 29), saanto: "29.9., vuosittain", lahde: L.jarjesto("Sydänliitto", "https://sydan.fi/maailmansydanpaiva/"), ala: ["hyvinvointi", "terveys"] },
  { nimi: "Maailman psoriasispäivä", luokat: ["jarjesto"], paiva: kiintea(10, 29), saanto: "29.10., vuosittain", lahde: L.jarjesto("Psoriasisliitto", "https://psori.fi/ajankohtaista/maailman-psoriasispaiva/"), ala: ["kauneus", "terveys"] },
  { nimi: "Maailman diabetespäivä", luokat: ["jarjesto"], paiva: kiintea(11, 14), saanto: "14.11., vuosittain", lahde: L.jarjesto("Diabetesliitto", "https://diabetes.fi/ajankohtaista/maailman-diabetespaiva/"), ala: ["hyvinvointi", "terveys"] },
];

// ---------- Koululomat (käsin, OPH:n luettelo; vain päätetyt kunnat) ----------

const OPH_2026 = {
  nimi: "Opetushallitus, Koulujen työ- ja loma-ajat lukuvuonna 2026–2027 (julkaistu 10.4.2026)",
  url: "https://www.oph.fi/fi/uutiset/2026/koulujen-tyo-ja-loma-ajat-lukuvuonna-2026-2027",
};

export const KOULULOMAT = [
  {
    kunta: "Kotka",
    lukuvuosi: "2026-2027",
    alkaa: "2026-08-12",
    syysloma: ["2026-10-19", "2026-10-23"],
    joululoma: ["2026-12-20", "2027-01-06"],
    talviloma: ["2027-03-01", "2027-03-05"],
    paattyy: "2027-06-05",
    lahde: OPH_2026,
    lisalahde: { nimi: "Kotkan kaupunki, esiopetuksen tiedote 2026–2027 (lukuvuosi 12.8.2026–5.6.2027)", url: "https://www.kotka.fi/wp-content/uploads/2025/12/Esiopetus-2026-2027.pdf" },
    tarkistettu: TARKISTETTU,
  },
];

export const KOULU_HUOM =
  "Koulujen loma-ajat ovat suuntaa antavia (OPH:n luettelo). Varmista ne kunnan tai koulun omasta tiedotteesta ennen kampanjan lukitsemista.";
export const YLEINEN_HUOM =
  "Tiedot ovat käsin ylläpidettyjä (tarkistettu 13.11.2026) ja ne päivitetään kerran vuodessa. Tarkista tärkeän kampanjan päivä lähteestä. Ahvenanmaan ja saamelaisten omat liputuspäivät, nimipäivät (Yliopiston almanakkatoimiston tekijänoikeus), kertaluonteiset liputussuositukset ja paikalliset tapahtumat eivät ole mukana. Vaalipäivät lisätään käsin, kun vaali on päätetty.";

// ---------- Apufunktiot ----------

const VKP = ["su", "ma", "ti", "ke", "to", "pe", "la"];

export function iso(date) {
  return date.toISOString().slice(0, 10);
}

export function fiPvm(date) {
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}.${date.getUTCFullYear()}`;
}

export function fiPvmVkp(date) {
  return `${VKP[date.getUTCDay()]} ${fiPvm(date)}`;
}

export function isoPvm(s) {
  const [y, m, d] = s.split("-").map(Number);
  return pvm(y, m, d);
}

/** Jäsentää päivämäärän muodossa 2026-11-13 tai 13.11.2026. Palauttaa null, jos ei kelpaa. */
export function jasennaPvm(input) {
  const s = String(input ?? "").trim();
  let y, m, d;
  let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) [y, m, d] = [+mm[1], +mm[2], +mm[3]];
  else if ((mm = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [d, m, y] = [+mm[1], +mm[2], +mm[3]];
  else return null;
  const date = pvm(y, m, d);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Tämä päivä Suomen aikaa. */
export function tanaan(now = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return isoPvm(s);
}

/** Kuluva lukuvuosi (elokuusta heinäkuuhun, perusopetuslaki 23 §), esim. "2026-2027". */
export function kuluvaLukuvuosi(date) {
  const y = date.getUTCFullYear();
  return date.getUTCMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function etsiKunta(nimi) {
  const s = String(nimi ?? "").trim().toLowerCase();
  if (!s) return null;
  const kunnat = [...new Set(KOULULOMAT.map((r) => r.kunta))];
  return kunnat.find((k) => k.toLowerCase() === s) ?? null;
}

export function kunnatTaulukossa() {
  return [...new Set(KOULULOMAT.map((r) => r.kunta))];
}

/** Kunnan koululomat tapahtumina (alku- ja loppupäivä). */
function koululomaTapahtumat(kunta) {
  const out = [];
  for (const r of KOULULOMAT.filter((x) => x.kunta === kunta)) {
    const base = { luokat: ["koululoma"], lahde: r.lahde, lisalahde: r.lisalahde, ala: ["kaikki"], kunta: true, saanto: `${kunta}, lukuvuosi ${r.lukuvuosi.replace("-", "–")}` };
    out.push({ ...base, nimi: `Koulu alkaa (${kunta})`, date: isoPvm(r.alkaa) });
    for (const [key, label] of [["syysloma", "Syysloma"], ["joululoma", "Joululoma"], ["talviloma", "Talviloma"]]) {
      const [a, b] = r[key];
      out.push({ ...base, nimi: `${label} alkaa (${kunta}), ${fiPvm(isoPvm(a))}–${fiPvm(isoPvm(b))}`, date: isoPvm(a) });
    }
    out.push({ ...base, nimi: `Koulu päättyy, kesäloma alkaa (${kunta})`, date: isoPvm(r.paattyy) });
  }
  return out;
}

/**
 * Päivät aikavälillä [alku, loppu]. Valinnainen ennakko (päivää): mukaan myös päivät, joiden
 * kampanja alkaa aikavälillä, vaikka päivä itse on aikavälin jälkeen.
 */
export function paivatValilla(alku, loppu, { luokat = null, ala = "kaikki", kunta = null, ennakko = 0 } = {}) {
  const hakuLoppu = lisaa(loppu, ennakko);
  const tulos = [];
  for (let y = alku.getUTCFullYear(); y <= hakuLoppu.getUTCFullYear(); y++) {
    for (const p of PAIVAT) {
      if (p.vuodet && !p.vuodet.includes(y)) continue;
      tulos.push({ ...p, date: p.paiva(y) });
    }
  }
  if (kunta) tulos.push(...koululomaTapahtumat(kunta));

  // Kunnan oma päättymispäivä korvaa valtakunnallisen säännön samana päivänä.
  const kunnanPaattyy = new Set(tulos.filter((t) => t.kunta).map((t) => iso(t.date)));
  return tulos
    .filter((t) => !(t.yleinenKoulu && kunnanPaattyy.has(iso(t.date))))
    .filter((t) => !luokat || t.luokat.some((l) => luokat.includes(l)))
    .filter((t) => ala === "kaikki" || !t.ala || t.ala.includes("kaikki") || t.ala.includes(ala))
    .map((t) => ({ ...t, kampanja: ennakko ? lisaa(t.date, -ennakko) : null }))
    .filter((t) => (t.date >= alku && t.date <= loppu) || (t.kampanja && t.kampanja >= alku && t.kampanja <= loppu && t.date > loppu))
    .sort((a, b) => a.date - b.date || a.nimi.localeCompare(b.nimi, "fi"));
}

/** Luokkakohtaiset määrät taulukossa (testit ja raportti). */
export function maaratLuokittain() {
  const m = {};
  for (const p of PAIVAT) {
    const l = p.luokat[0];
    m[l] = (m[l] ?? 0) + 1;
  }
  return m;
}
