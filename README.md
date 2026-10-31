# aluetieto-mcp

Claude-liitin (MCP-palvelin), joka yhdistää PRH:n YTJ-yritystiedot, Tilastokeskuksen Paavo-väestötiedot ja THL:n Sotkanet-indikaattorit. Tarkoitettu aluetarkistuksiin: montako saman toimialan yritystä alueella on suhteessa asukkaisiin tai kohderyhmään. Toimii Cloudflare Workerina, ei tallenna mitään eikä tarvitse API-avaimia.

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

## Tärkeä rajoitus

YTJ:n avoimessa datassa ovat vain kaupparekisteriin merkityt yhteisöt (oy, ky, ay, osuuskunta ym.). Toiminimet puuttuvat, joten aluetarkistuksen yritysmäärä on alaraja. Esimerkiksi Kotkassa YTJ:ssä on 21 toimivaa kampaamo- ja kauneudenhoitoalan yhteisöä, kun Tilastokeskuksen mukaan koko Kymenlaaksossa on 835 toimipaikkaa toimialalla 96 (muut henkilökohtaiset palvelut, toiminimet mukaan lukien). Kokonaiskuvaan kannattaa käyttää rinnalla `toimipaikat_maakunnittain`-työkalua.

## Lähteet ja rajapinnat

- YTJ: `https://avoindata.prh.fi/opendata-ytj-api/v3/companies` (Patentti- ja rekisterihallitus). PRH:n ehto: alkuperäinen lähde mainitaan, eikä palvelussa käytetä PRH:n tai YTJ:n logoa tai ulkoasua.
- Paavo: `https://pxdata.stat.fi/PxWeb/api/v1/fi/Postinumeroalueittainen_avoin_tieto/uusin` (Tilastokeskus, CC BY 4.0). Taulukot haetaan otsikon perusteella, koska tunnukset vaihtuvat vuosittain.
- Toimipaikat: `https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/alyr/13ww.px` (Tilastokeskus, CC BY 4.0).
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

Koodi: MIT, ks. [LICENSE](LICENSE). Data: PRH (YTJ avoin data), Tilastokeskus (CC BY 4.0) ja THL Sotkanet.fi (THL:n ja Tilastokeskuksen indikaattorit, CC BY 4.0). Tämä ei ole PRH:n, Tilastokeskuksen eikä THL:n palvelu.
