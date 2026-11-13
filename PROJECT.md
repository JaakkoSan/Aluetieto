# PROJECT.md: aluetieto-mcp

Claude-liitin aluetarkistuksiin: YTJ-yritystiedot + Paavo-väestötiedot. Tehty 31.10.2026.

## Käyttötarkoitus

- Aluetarkistus: toimijoiden määrä suhteessa asukkaisiin tai kohderyhmään.
- Kotihoidon kysyntä (75+ postinumeroittain) ja kilpailijat.
- Yrityksen tiedot y-tunnuksella.

## Päätökset

- Cloudflare Worker, tilaton MCP (Streamable HTTP, JSON-vastaukset), ei ajonaikaisia riippuvuuksia.
- Ei tallennusta. Välimuisti vain Cloudflaren Cache API:ssa.
- Toimialaluokitus TOL 2025 mukana koodissa (YTJ käyttää TOL 2025 -koodeja 1.1.2026 alkaen).
- Toiminimien puuttuminen YTJ:n avoimesta datasta kerrotaan jokaisessa yritysmäärätulosteessa.
- Sotkanet haetaan eränä D1:een (EU), koska THL:n ohje ei tarkoita rajapintaa suoraan online-käyttöön (päätös 31.10.2026). D1: aluetieto-sotkanet.

## Rakenne

- `src/index.js`: MCP-protokolla ja käyttörajoitus
- `src/tools.js`: työkalut
- `src/ytj.js`: YTJ-haku ja tulkinta
- `src/yritystalous.js`: PRH:n digitaaliset tilinpäätökset (XBRL) ja Verohallinnon yhteisöverotiedot (D1-lataus ja kyselyt)
- `src/sbrLabels.js`: SBR-taksonomian erien suomenkieliset nimet (generoitu)
- `src/statfin.js`: StatFinin yleinen taulukkohaku, rakenne ja kysely (PxWeb, json-stat2)
- `src/saavutettavuus.js`: väestö säteellä 1 km väestöruuduista ja Paavon postinumeroalueista (WFS)
- `src/krek.js`, `src/krekCodes.js`: PRH:n kaupparekisterin rekisteröidyt ilmoitukset ja rekisterimerkintöjen otsikot
- `src/ptv.js`: Suomi.fi-palvelutietovaranto (alueen palvelut, palvelun tiedot ja asiointikanavat)
- `src/talous.js`: hintaindeksit (Tilastokeskus, StatFin/khi) ja korot (EKP:n rajapinta, korkolain viitekorko)
- `src/stat.js`: Paavo ja toimipaikkatilasto (PxWeb)
- `src/http.js`: HTTP, välimuisti, alipyyntöbudjetti
- `src/tol2025.js`: toimialaluokitus
- `src/sotkanet.js`: Sotkanet-eräpäivitys (cron) ja D1-luku
- `src/geokoodaus.js`: MML:n geokoodauspalvelu (Pelias v2, API-avain salaisuutena MML_API_KEY)
- `src/eperusteet.js`: Opetushallituksen ePerusteet (ammatillisten tutkintojen haku, perusteen ratkaisu, rakennepuu, tutkinnon osan kaksi sisältömuotoa, HTML tekstiksi, voimassaolo Suomen ajassa)
- `src/tyonv.js`: KEHA-keskuksen työnvälitystilasto StatFinissä (ammattinimien muunnos AML 2010 -koodeiksi, maakunnan ja kunnan ratkaisu, kyselyt 12tu, 12uz ja 12r5)
- `src/kela.js`: Kelan etuustilastot (avoindata.fi:n CKAN DataStore, SQL-kyselyt) ja hyvinvointialueiden kunnat (Tilastokeskuksen luokitusavain)
- `src/kalenteri.js`: markkinointikalenteri (laskusäännöt, päivätaulukko lähteineen, Kotkan koululomat); ei verkkohakuja
- `test/smoke.mjs`: savutesti

## Muutokset

- 31.10.2026 v1.0: ensimmäinen versio.
- 31.10.2026 v1.1: Sotkanet-indikaattorit (sote_indikaattorit, sote_tilasto), eräpäivitys D1:een.
- 31.10.2026 v1.1.1: Sotkanet-lataus yksi vuosi per ajo (ilmaistason 10 ms CPU-raja).
- 31.10.2026 v1.1.2: Tilastokeskuksen metatiedot (Paavo, toimipaikat) käsitellään kerran isolaattia kohden; postinumerot puretaan vasta tarvittaessa (CPU-aika aluetarkistuksessa noin kolmannes aiemmasta).
- 31.10.2026 v1.2: hintaindeksi, indeksitarkistus (Tilastokeskus, kuluttajahinta- ja elinkustannusindeksi) ja korot (korkolain viitekorko ja viivästyskorot EKP:n perusrahoitusoperaatioiden korosta, EKP:n ohjauskorot). Euribor jätetty pois lisenssin vuoksi (Refinitivin data EKP:n rajapinnassa).
- 1.11.2026 v1.3: yrityksen_talous (PRH:n digitaalinen tilinpäätös ja Verohallinnon julkiset verotiedot) ja yhteisoverot. Verotiedot ladataan ajastetusti D1:een (tiedosto virtana, kymmenen lauseen erät, vuoden vanhat rivit korvataan). Tilinpäätösten etumerkit vaihtelevat ilmoittajittain (havaittu otoksesta 40 yritystä), joten käytäntö päätellään tilinpäätöskohtaisesti. Kelan etuustilastot (kohta 3) jätettiin pois, koska avoindata.fi:n rajapinta palautti 403 liittimen omalla User-Agentilla; tunnistetta ei vaihdettu eston kiertämiseksi.
- 1.11.2026 v1.4: StatFinin yleinen taulukkohaku (hae_tilastoja, tilaston_rakenne, tilasto). Valinnat koodeina tai teksteinä, oletusvalinnat kerrotaan, enintään 3 000 solua.
- 1.11.2026 v1.5: Suomi.fi-palvelutietovaranto (hae_julkisia_palveluja, julkinen_palvelu). Rajapinnassa ei ole tekstihakua; alueen palvelujen nimet haetaan (kevyt luettelo) ja rajataan nimellä, tiedot haetaan palvelu kerrallaan.
- 1.11.2026 v1.6: kaupparekisteri_ilmoitukset (PRH:n rekisteröidyt ilmoitukset). Koko maan haku vaatii rekisterimerkinnän koodin, koska pelkkä aikaväli tai ilmoitustyyppi aikakatkaistaan rajapinnassa. Toimiala suodatetaan paikallisesti enintään 500 yrityksestä.
- 1.11.2026 v1.7: saavutettavuusalue (väestö säteellä, postinumeroalueiden osuudet, toimialan yritykset). Ajoaika-alueet odottavat reitityspalvelun valintaa (openrouteservice tai Mapbox, molemmat vaativat avaimen).
- 1.11.2026 v1.8: asiakastarkistus (Soklon asiakkaan taustatarkistus julkisista tiedoista). Havainnot ovat tosiasioita, ei luottokelpoisuusarviota. Korjattu samalla: yrityksen tilanteen koodit näkyvät suomeksi (KONK = konkurssissa) myös yrityksen_tiedot-työkalussa.
- 12.11.2026 v1.9: kela_etuudet (Kelan etuuksien saajat ja maksetut etuudet kunnittain, hyvinvointialueittain ja koko maa; kuukausi vuodesta 2018, vuosi vuodesta 2008, yhden etuuden sarja) ja kela_vammaistuet (vammaistuet ja eläkettä saavan hoitotuki tuen tason, iän, sukupuolen ja sairauspääryhmän mukaan vuodesta 2016). Avoindata.fi:n 403-esto (1.11.) oli poistunut: rajapinta vastasi 12.11. liittimen omalla tunnisteella 200 myös Cloudflaren reunalta. Pienissä luvuissa (alle 5 saajaa) osien summa ei aina täsmää yhteensä-lukuun (arvo 4 on aineistossa poikkeuksellisen yleinen), joten tulosteessa siitä on huomautus. Korjattu samalla: Tilastokeskus poisti Paavon uusin-kansion, mikä rikkoi alueen_vaesto- ja aluetarkistus-työkalut (400); taulukot haetaan nyt uusimmasta julkaisuvuoden kansiosta.
- 12.11.2026 v1.10: osoitteen_sijainti (MML:n avoin geokoodauspalvelu, osoite tai paikannimi -> koordinaatit ja kunta) ja saavutettavuusalueen keskipisteeksi katuosoite tai paikannimi. Avain HTTP Basic -otsakkeessa (ei URL:ssa eikä välimuistiavaimessa), haut välimuistissa 30 päivää, koska MML:n ehdot sallivat maksuttoman tuotantokäytön vain pienellä volyymilla. Ilman avainta työkalut kertovat, ettei geokoodausta ole kytketty. Testit: MML_API_KEY=... node test/smoke.mjs.
- 13.11.2026 v1.11: Opetushallituksen ePerusteet (suunnitelma Liittimet/suunnitelmat/eperusteet.md, päätökset Ohjaamo J1): hae_tutkintoja, tutkinnon_peruste ja tutkinnon_osaaminen. Vain ammatilliset perus-, ammatti- ja erikoisammattitutkinnot; arviointikriteerit vain valinnalla arviointi; kieli fi oletuksena, sv valinnainen. Koko perustetta (/peruste/{id}, jopa 7 Mt) ei haeta; haut 1 vrk ja rakenne sekä tutkinnon osat 7 vrk Cache API:ssa, otsake Caller-Id: aluetieto-mcp. Huomautus terveydenhuollon nimikesuojauksesta (asetus 564/1994 1 §: lähihoitaja, koulutettu hieroja) ja JulkiTerhikistä, jonka ylläpitäjä on nyt Lupa- ja valvontavirasto (julkiterhikki.valvira.fi ohjaa osoitteeseen julkiterhikki.lvv.fi). Poikkeamat suunnitelmasta:
- 13.11.2026 v1.11 (tarkastuksen korjaukset ennen julkaisua): ulkoisille hauille aikakatkaisu 15 s (src/http.js; koskee kaikkia työkaluja, aikakatkaisu antaa selkeän virheen eikä uusi hakua); nimikesuojaushuomautus ei enää tule koirahieronnasta eikä lääkehoidosta (EP_HEALTH_RE); hakusana enintään 200 merkkiä (hae_tutkintoja, tutkinnon_osaaminen); http.js:n kommentti päivitetty Workers Paidin alipyyntörajaan.
  - Pyyntöjä kutsua kohden ilman välimuistia: hae_tutkintoja 1, tutkinnon_peruste 3 (haku, suoritustavat, määräyskirje PDF-linkkiä varten), tutkinnon_osaaminen 3 (haku, suoritustavat, tutkinnon osa); perusteen id:llä +1 (diaarinumero). Suunnitelman enintään 2 ei riittänyt PDF-linkkiin.
  - Tutkinnon osan koodia (esim. 107623) ei ole rakenteessa. Koodilla haetaan osa /peruste/tutkinnonosa/{koodi} (noin 5–10 s, välimuisti 7 vrk) ja täsmätään nimellä; ensin tarkistetaan hakutuloksen koodit-listasta, että koodi kuuluu perusteeseen. Rakennepuussa ei siksi näytetä osien koodeja, vain nimi ja osaamispisteet.
  - Perusteen OPH-5085-2021 (sosiaali- ja terveysala, siirtymäajalla 31.7.2028 asti) rakennepuusta puuttuvat tutkinnon osien nimet. Puuttuvat nimet haetaan osa kerrallaan (/peruste/{id}/tutkinnonOsat/{osaId}/nimi, 40 pientä pyyntöä, välimuisti 7 vrk, oma budjetti 80).
  - Suoritustavat on sote-perusteilla noin 225 kt ja yhteinen tutkinnon osa (osa-alueineen) noin 620 kt, eli suunnitelman arvioita (80 kt ja 75 kt) suurempia; molemmat jäsennetään yhdellä kerralla.
  - Rakennepuun pakollisuus päätellään ryhmän nimestä (Pakolliset / Valinnaiset tutkinnon osat), koska osien pakollinen-tieto on usein false myös pakollisissa ryhmissä. Yhteiset tutkinnon osat ovat pakollisia, ellei niitä ole ryhmitelty valinnaisiksi.
  - Tutkinnon osan linkki käyttää viitteen id:tä (/tutkinnonosat/{viiteId}, eperusteet-opintopolku router.ts), ei tutkinnon osan id:tä. Koulutustyypin polku ammatillinen tarkistettu eperusteet-frontend-utils-kirjastosta; linkkejä ei avattu selaimessa.
  - Hakusana rajaa vaatimukset sanan alulla (yli 5 merkin sanoista pudotetaan kaksi viimeistä merkkiä: hieronta osuu sanaan hieronnan).
- 13.11.2026 v1.12: avoimet_tyopaikat (suunnitelma Liittimet/suunnitelmat/tyomarkkinatori.md vaihe A, päätös Ohjaamo C1). KEHA-keskuksen työnvälitystilasto StatFinissä (CC BY 4.0): kuukausisarja (oletus 12, enintään 36 kk), uusin kuukausi ja muutos vuodentakaisesta samasta kuukaudesta, maakuntien järjestys, työnantajan sektori (12uz) ja valinnaisesti työnhakijat (kaikki ja työttömät) sekä suhdeluku. Salassa pidetyt pienet luvut näkyvät muodossa "salassa (...)", ei nollana. Kunta ohjataan maakuntaan, ja kunnan kaikki avoimet työpaikat haetaan taulukosta 12r5. Kyselyt: 12tu-rakenne (GET, välimuisti 1 vrk) ja enintään 3 datakyselyä (12tu, 12uz, kunnalla 12r5); kunnan maakuntaa varten lisäksi 12r5-rakenne ja luokitusavain. Välimuistiton 12tu-kysely kestää StatFinissä noin 5–9 s (mitattu 13.11.2026), Cache API 1 vrk. Poikkeamat suunnitelmasta:
  - Hierojat ovat AML 2010:ssä luokassa 53294, joka on 4-numerotasolla ryhmässä 5329 Muut terveydenhuoltoalan työntekijät (mukana mm. hammashoitajat ja välinehuoltajat), ei 3255. Jalkojenhoitaja (terveydenhuolto) ja jalkaterapeutti ovat ryhmässä 3255, pedikyristi ryhmässä 5142. Ryhmä 3259 on toimintaterapeutit, kiropraktikot, osteopaatit ja naprapaatit. Tarkistettu Tilastokeskuksen luokituspalvelusta (ammatti_1_20100101). Ryhmän sisältö kerrotaan tulosteessa.
  - Työnantajan sektori (12uz ja 12v6) on vain kahden numeron ammattiluokille (esim. 51 Palvelutyöntekijät), ei yksittäiselle ammattiryhmälle. Tulosteessa kerrotaan tämä.
  - Kunnan luvut (12r5) ovat avoimet työpaikat laskentapäivänä ja uudet avoimet työpaikat kuukauden aikana, eivät avoinna kuukauden aikana; ammattijakoa ei ole.
  - Salassapitomerkintä on StatFinissä "..." (suunnitelmassa ".."); molemmat tulkitaan salassa pidetyksi.
  - Tarkastuksen korjaukset (13.11.2026): lähihoitaja 5321 kattaa vain laitosten lähihoitajat; kotihoidon lähihoitajat (53221) ovat ryhmässä 5322 Kodinhoitajat, josta tulosteessa on huomautus (hae koodilla 5322). Hermorata-, lymfa- ja äänimaljahierojat ohjataan ryhmään 3230 (sääntö ennen hierojasääntöä), jalkahoitaja (kauneudenhoito) ja tatuoija ryhmään 5142 (luokituksen hakemisto). Suhdeluku vain, kun työnhakijoita on yli 0, ja siinä varaus: työnhakijoihin kuuluvat myös työssä olevat hakijat, ja ammattiryhmä on asiakasrekisteriin hakijalle kirjattu ammatti (Tilastokeskuksen tilastokuvaus ei tarkenna, onko se haettu vai aiempi ammatti). kuukausia 1–36, muuten virhe; inputSchemassa ammatti enintään 3 ja kuukausia 1–36.
- 13.11.2026 v1.13.0: kaupparekisteri_ilmoitukset liidivahtia varten (Liittimet, suunnitelmat/liidivahti.md, käyttäjän päätös A+):
  - toimiala hyväksyy useita koodeja pilkulla eroteltuna (enintään 10), tulosteessa määrät toimialoittain.
  - Toimialasuodatus käy läpi enintään 2 000 yritystä (ennen 500). Koko maan uudet yritykset viikolta (noin 350) menevät kokonaan läpi; kuukausi (noin 1 900, 13.10.–12.11.2026) on rajalla.
  - PRH:n rajapinta antaa 429, kun hakuja tulee nopeasti noin 30–40 (rajaa ei ole julkaistu). Sivut haetaan kaksi rinnakkain, ja jos raja tulee vastaan, palautetaan jo haetut sivut ja HUOM-rivi puuttuvista sivuista.
  - Kotisivu (website.url) näytetään yrityksen alla, kun se on ilmoitettu.
- 13.11.2026 v1.14.0: markkinointikalenteri (suunnitelma Liittimet/suunnitelmat/markkinointikalenteri.md, käyttäjän päätökset Ohjaamossa 13.11.2026, 1/7–7/7): tulevat_paivat ja koululomat. Staattinen taulukko ja laskusäännöt ilman ajonaikaisia hakuja (`src/kalenteri.js`), vuodet 2026–2100.
  - Laskusäännöt: pääsiäinen (Meeus/Jones/Butcher), juhannus ja pyhäinpäivä (kirkkojärjestys 1:4), äitien- ja isänpäivä, kaatuneitten muistopäivä, Suomen luonnon päivä, koulun päättyminen (ISO-viikon 22 lauantai), Black Friday (kiitospäivä + 1), kesäaika (maaliskuun ja lokakuun viimeinen sunnuntai). Testattu vertailupäiviä vasten: pääsiäinen 12 vuotena 2019–2096 (Utrechtin yliopiston Meeus-taulukko, 2026 ja 2027 almanakkatoimiston ja myhelsinki.fi:n tiedoista), liputuspäivät 2026 ja 2027 Yliopiston almanakkatoimiston sivuilta, Kotkan koulun päättyminen OPH:n luettelosta; lisäksi sääntöjen ominaisuudet kaikille vuosille 2026–2100.
  - Taulukossa 63 riviä: pyhä- ja juhlapäivät 12, aatot 4, viralliset liputuspäivät 6 (lisäksi juhannus ja itsenäisyyspäivä pyhäpäivien rivillä), vakiintuneet liputuspäivät 15 (omat lyhyet nimet, Lähde-linkki sisäministeriöön), kaupalliset sesongit 8 (lisäksi äitien- ja isänpäivä liputuspäivien rivillä), kesäaika 2, valtakunnallinen koulun päättyminen 1, YK:n ja WHO:n teemapäivät 10 (päätöslauselma tai WHO:n sivu; YK:n luetteloa ei kopioitu), suomalaisten järjestöjen teemapäivät 5. Eduskuntavaalit 18.4.2027 kertaluonteisena rivinä (vaalit.fi, almanakka 2027).
  - Järjestöpäivät tarkistettu järjestön omalta sivulta 13.11.2026 (robots.txt ensin, tunniste `aluetieto-mcp/1.14 (Claude-liitin; markkinointikalenterin kertatarkistus)`, yksi haku per sivu; sivuilla ei käyttöehtoja, vain päivä ja oma nimi): fysioterapiapäivä 8.9. (Suomen Fysioterapeutit), atopiapäivä 14.9. (Allergia-, iho- ja astmaliitto), maailman sydänpäivä 29.9. (Sydänliitto), maailman psoriasispäivä 29.10. (Psoriasisliitto), maailman diabetespäivä 14.11. (Diabetesliitto). Pois jätetty: kansainvälinen miestenpäivä (miessakit.fi:n robots.txt kieltää ClaudeBotin, sivua ei haettu), Meikitön päivä (ajankohtaista lähdettä ei löytynyt), Ihoviikko ja Miesten viikko (viikko vaihtelee vuosittain), maailman unipäivä (ei suomalaisen järjestön sivua), hierojien ja jalkaterapeuttien päivät (ei löytynyt).
  - Koululomat: vain Kotka 2026–2027 (OPH 10.4.2026, varmistettu sivulta 13.11.2026; Kotkan esiopetuksen tiedote). Kunnan päättymispäivä korvaa samana päivänä valtakunnallisen säännön rivin.
  - Alennussesongeissa (Black Friday, Cyber Monday, sinkkujen päivä) huomautus kuluttajansuojalain 2 luvun 11 §:stä (sanamuoto 693/2022, tarkistettu Finlexistä 13.11.2026; koskee tavaroita) Finlex-linkillä; loppuun maininta joulun alennusmyynneistä. Muistopäivät (veteraanipäivä, kaatuneitten muistopäivä) merkitty "Ei tarjouksiin"; pitkäperjantaille ja pyhäinpäivälle sävyhuomautus.
  - Ei mukana: nimipäivät (almanakkatoimiston tekijänoikeus), Ahvenanmaan ja saamelaisten liputuspäivät (sisäministeriön sivulla ei päiviä; ei tarkistettu ensisijaisesta lähteestä), sisäministeriön kertaluonteiset liputussuositukset, Kotkan paikalliset tapahtumat (päätös 6/7).
  - Kalenterityökaluilla `openWorldHint: false`.
  - Tarkastuksen korjaukset (13.11.2026, versio pysyy 1.14.0): koululomat-työkalun puuttuvan kunnan ja lukuvuoden vastauksiin Lähde-rivi (perusopetuslaki 23 §, perusopetusasetus 7 §, OPH); KSL-huomautuksen muoto "pykälä koskee tavaroita"; luokat hyväksyy myös pilkuilla erotellun merkkijonon, muu muoto ja tuntematon luokka ovat virhe; ennakko_paivia 1–120 sekä skeemassa että koodissa; juhannusaaton riville sisäministeriön lähde.
  - Tarkistetaan seuraavassa ylläpidossa: International Wellness Day on rivillä päätöslauselmana A/RES/80/249 (hakutulokset 13.11.2026), mutta tarkastuksessa YK:n Digital Libraryssä näkyi numero 80/248; oikea numero varmistetaan päätöslauselman tekstistä.
  - Rehellisyyden vuoksi: suunnitteluvaiheessa tehtiin vahingossa yksi robots.txt-haku who.int-sivustolle tunnisteella "x" (ei liittimen koodissa; liitin ei hae mitään verkosta).

## Markkinointikalenterin vuosittainen ylläpito

Tiedot ovat käsin ylläpidettyjä (`src/kalenteri.js`). Noin 30 minuuttia vuodessa:

- Tammikuu: sisäministeriön liputussivu https://intermin.fi/suomen-lippu/liputuspaivat (vakiintuneet liputuspäivät, nyt 15) ja asetus 383/1978 2 § Finlexistä. Lisää tulevan vuoden vaalipäivät (`vuodet`-rajaus), kun vaali on päätetty.
- Huhtikuu: Opetushallituksen uutinen "Koulujen työ- ja loma-ajat lukuvuonna ..." (julkaistaan yleensä huhtikuussa) ja Kotkan oma tiedote; lisää Kotkan uusi rivi `KOULULOMAT`-taulukkoon ja uusi `OPH_`-lähde. Muut kunnat vain käyttäjän päätöksellä.
- Samalla: järjestöpäivien ja YK:n ja WHO:n päivien lähdelinkit (päivä ennallaan, sivu olemassa), `TARKISTETTU`-päivä ja testien vertailupäivät. Haku: robots.txt ensin, rehellinen tunniste, yksi haku per sivu.
