# aluetieto-mcp

Claude-liitin (MCP-palvelin), joka yhdistää PRH:n YTJ-yritystiedot, Tilastokeskuksen Paavo-väestötiedot ja THL:n Sotkanet-indikaattorit. Lisäksi yritysten taloustiedot (PRH:n digitaaliset tilinpäätökset ja Verohallinnon yhteisöverotiedot), kuluttajahinta- ja elinkustannusindeksi, indeksitarkistuslaskuri sekä korkolain viitekorko, viivästyskorot ja EKP:n ohjauskorot. Tarkoitettu aluetarkistuksiin: montako saman toimialan yritystä alueella on suhteessa asukkaisiin tai kohderyhmään. Toimii Cloudflare Workerina, ei tallenna mitään eikä tarvitse API-avaimia.

## Työkalut

| Työkalu | Mitä tekee |
|---|---|
| `etsi_toimiala` | TOL 2025 -toimialakoodit nimen osalla tai koodilla (luokitus mukana koodissa) |
| `hae_yrityksia` | YTJ-haku toimialan, postinumeron, postitoimipaikan, nimen, yritysmuodon tai rekisteröintipäivän mukaan |
| `yrityksen_tiedot` | Yhden yrityksen tiedot y-tunnuksella: nimet, toimiala, osoite, rekisterit (ALV, ennakkoperintä, työnantaja), tila |
| `alueen_vaesto` | Paavo: asukkaat, naiset, ikäryhmät (0–17, 18–64, 65+, 75+), keski-ikä ja mediaanitulo postinumeroittain tai kunnittain |
| `aluetarkistus` | Yritykset toimialalla vs. asukkaat tai kohderyhmä postinumeroittain, asukasta per yritys |
| `toimipaikat_maakunnittain` | Tilastokeskuksen toimipaikkatilasto (myös toiminimet) maakunnittain, TOL 2008 |
| `sote_indikaattorit` | Ladatut Sotkanet-indikaattorit (kotihoito, ikääntyneiden palvelut, ikärakenne, väestöennusteet) |
| `sote_tilasto` | Indikaattorin arvot kunnittain, hyvinvointialueittain tai maakunnittain, 6 viimeisintä vuotta, vertailuna koko maa |
| `hintaindeksi` | Kuluttajahintaindeksin (perusvuosi valittavissa) tai elinkustannusindeksin (1951:10=100) pisteluvut ja vuosimuutos kuukausittain |
| `indeksitarkistus` | Indeksitarkistus kahden kuukauden tai vuosikeskiarvon välillä: muutosprosentti, kerroin ja tarkistettu summa (esim. vuokra) |
| `yrityksen_talous` | PRH:n digitaalinen tilinpäätös (tuloslaskelma ja tase, vertailuvuosi) ja Verohallinnon julkiset verotiedot vuosittain Y-tunnuksella tai nimellä |
| `yhteisoverot` | Kunnan tai koko maan yhteisöt maksuunpantujen verojen tai verotettavan tulon mukaan, nimen osalla rajattuna, yhteissummat |
| `korot` | Korkolain viitekorko ja viivästyskorot (4 ja 4 a §) annettuna päivänä, EKP:n ohjauskorot, viitekorkojen historia vuodesta 2009 |

## Tärkeä rajoitus

YTJ:n avoimessa datassa ovat vain kaupparekisteriin merkityt yhteisöt (oy, ky, ay, osuuskunta ym.). Toiminimet puuttuvat, joten aluetarkistuksen yritysmäärä on alaraja. Esimerkiksi Kotkassa YTJ:ssä on 21 toimivaa kampaamo- ja kauneudenhoitoalan yhteisöä, kun Tilastokeskuksen mukaan koko Kymenlaaksossa on 835 toimipaikkaa toimialalla 96 (muut henkilökohtaiset palvelut, toiminimet mukaan lukien). Kokonaiskuvaan kannattaa käyttää rinnalla `toimipaikat_maakunnittain`-työkalua.

## Lähteet ja rajapinnat

- YTJ: `https://avoindata.prh.fi/opendata-ytj-api/v3/companies` (Patentti- ja rekisterihallitus). PRH:n ehto: alkuperäinen lähde mainitaan, eikä palvelussa käytetä PRH:n tai YTJ:n logoa tai ulkoasua.
- Paavo: `https://pxdata.stat.fi/PxWeb/api/v1/fi/Postinumeroalueittainen_avoin_tieto/uusin` (Tilastokeskus, CC BY 4.0). Taulukot haetaan otsikon perusteella, koska tunnukset vaihtuvat vuosittain.
- Toimipaikat: `https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/alyr/13ww.px` (Tilastokeskus, CC BY 4.0).
- Hintaindeksit: `https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi` (Tilastokeskus, CC BY 4.0): kuukausitaulukot 11xs (kuluttajahintaindeksi, kaikki perusvuodet) ja 11xl (elinkustannusindeksi 1951:10=100), vuosikeskiarvot 11xt ja 11xm, virallinen vuosimuutos 122p.
- EKP:n ohjauskorot: `https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.{MRR_FR,DFR,MLFR}.LEV` (muutospäivät). EKP:n tilastojen uudelleenkäyttö on maksutonta, kun lähde mainitaan ("Source: ECB statistics") eikä tietoja muuteta. Euribor ei ole mukana: EKP:n Euribor-sarjat ovat Refinitivin toimittamaa kolmannen osapuolen dataa, jonka uudelleenkäyttö vaatii tuottajan luvan.
- Viitekorko lasketaan korkolain (633/1982) 12 §:n mukaan: EKP:n perusrahoitusoperaatioiden viimeisin korko ennen puolivuotiskauden ensimmäistä päivää pyöristettynä ylöspäin puoleen prosenttiyksikköön. Viivästyskorko on viitekorko + 7 (4 §) ja kaupallisissa sopimuksissa + 8 prosenttiyksikköä (4 a §). Laskenta alkaa vuodesta 2009, koska perusrahoitusoperaatiot olivat 2000–2008 vaihtuvakorkoisia. Suomen Pankki julkaisee virallisen viitekoron; laskettu arvo tarkistettiin sen tiedotteesta kaudelle 1.7.–31.12.2026 (2,5 %).
- Digitaaliset tilinpäätökset: `https://avoindata.prh.fi/opendata-xbrl-api/v3` (PRH, CC BY 4.0; kuvaus `/schema?lang=fi`). Tilikaudet `/financials?businessId=`, tilinpäätös XBRL-muodossa `/financial?businessId=&financialDate=`. Mukana vain iXBRL-muodossa ilmoitetut tilinpäätökset (tilikaudelta, joka päättyi 31.12.2025, 11 925 yritystä). Erien nimet SBR-taksonomiasta (Valtiokonttori, SBR-DPM-2026-06-02, avoindata.fi, CC BY 4.0), `src/sbrLabels.js`. Etumerkkikäytäntö vaihtelee ilmoittajittain, joten se päätellään tilinpäätöskohtaisesti (kulut positiivisina, rahoituserien netto tarkistetaan laskentakaavasta).
- Yhteisöjen verotiedot: Verohallinnon avoin data (`https://www.vero.fi/avoindata`, CC BY 4.0), yhteisöjen tuloverotuksen julkiset tiedot vuodesta 2020 ja muutosverotustiedot vuodesta 2022. CSV-tiedostot (n. 27 Mt, 380 000 riviä vuodessa) ladataan D1-kantaan: ajastettu tehtävä tarkistaa sivun linkit vuorokauden välein ja lataa uuden tai muuttuneen tiedoston (ETag, Last-Modified) virtana. Kanta on sama `aluetieto-sotkanet` (EU-lainkäyttöalue), taulut `vero`, `vero_muutos` ja `vero_files`.
- Toimialaluokitus TOL 2025: `src/tol2025.js`, generoitu Tilastokeskuksen luokituspalvelusta.
- Välimuisti: YTJ 12 h, Paavon metatiedot 1 vrk, tilastokyselyt 7 vrk (Cloudflaren Cache API).

## Sotkanet: eräpäivitys D1:een

THL:n ohjeen mukaan Sotkanetin REST-rajapinta on tarkoitettu tietojen noutamiseen erissä, ei suoraan online-käyttöön. Siksi:

- Ajastettu tehtävä (cron 15 min välein) tekee yhden askeleen: päivittää alueluettelon viikoittain, tarkistaa yhden indikaattorin metatiedot tai hakee yhden vuoden dataa. Yksi vuosi kerrallaan pitää ajon Workersin ilmaistason CPU-rajan (10 ms) alla. Data haetaan uudelleen vain, jos THL on päivittänyt sitä (`data-updated`); kesken olevat vuodet ovat jonossa sarakkeessa `pending_years`.
- Tiedot tallennetaan D1-kantaan `aluetieto-sotkanet` (EU-lainkäyttöalue). Työkalut lukevat vain kantaa.
- Ladattavat indikaattorit ovat listassa `src/sotkanet.js` (`INDICATORS`). Lisää tunnus listaan, niin seuraava ajo hakee sen. Mukana vain THL:n ja Tilastokeskuksen tuottamia indikaattoreita (CC BY 4.0); muiden tuottajien (esim. Kela, Valtiokonttori) käyttöehdot pitää tarkistaa erikseen.
- Tallennetaan kuusi viimeisintä vuotta, alueina kunnat, hyvinvointialueet, maakunnat, seutukunnat ja koko maa.

## Käyttörajoitus ja merkinnät

- 30 työkalukutsua minuutissa per MCP-istunto ja 300 per IP-osoite (Cloudflare Rate Limiting).
- Yksi kutsu tekee enintään 45 ulkoista hakua; aluetarkistus enintään 30 postinumerolle kerrallaan.
- Kaikilla työkaluilla `readOnlyHint: true`. Vastauksen enimmäispituus 50 000 merkkiä.

## Kehitys

```
npm install
npm test          # savutesti oikeita lähteitä vasten (Node 20+)
npm run dev       # paikallinen Worker osoitteessa http://localhost:8787/mcp
```

## Lisenssi

Koodi: MIT, ks. [LICENSE](LICENSE). Data: PRH (YTJ avoin data), Tilastokeskus (CC BY 4.0), THL Sotkanet.fi (THL:n ja Tilastokeskuksen indikaattorit, CC BY 4.0) ja EKP:n tilastot. Tämä ei ole PRH:n, Tilastokeskuksen, THL:n eikä EKP:n palvelu.
