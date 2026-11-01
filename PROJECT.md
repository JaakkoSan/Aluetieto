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
- `src/krek.js`, `src/krekCodes.js`: PRH:n kaupparekisterin rekisteröidyt ilmoitukset ja rekisterimerkintöjen otsikot
- `src/ptv.js`: Suomi.fi-palvelutietovaranto (alueen palvelut, palvelun tiedot ja asiointikanavat)
- `src/talous.js`: hintaindeksit (Tilastokeskus, StatFin/khi) ja korot (EKP:n rajapinta, korkolain viitekorko)
- `src/stat.js`: Paavo ja toimipaikkatilasto (PxWeb)
- `src/http.js`: HTTP, välimuisti, alipyyntöbudjetti
- `src/tol2025.js`: toimialaluokitus
- `src/sotkanet.js`: Sotkanet-eräpäivitys (cron) ja D1-luku
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
