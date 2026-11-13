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
- `src/kela.js`: Kelan etuustilastot (avoindata.fi:n CKAN DataStore, SQL-kyselyt) ja hyvinvointialueiden kunnat (Tilastokeskuksen luokitusavain)
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
