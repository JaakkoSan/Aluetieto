# Jono: aluetieto-mcp

Liittimen jono. Valmis kohta poistetaan ja kirjataan MUUTOSLOKI.md:hen samassa commitissa.

## Työn alla

1. **Koodiajo-valmius: Aluetieto kokeiluliittimenä, ensin siirto yhteiseen runkoon.**
   Ensin siirto yhteiseen runkoon omana julkaisunaan (PR #3, v1.15.0; src/index.js, scheduled ja D1 säilyvät), sitten kokeilun kuusi työkalua (etsi_toimiala, hae_yrityksia, alueen_vaesto, aluetarkistus, hae_tilastoja, tilasto) rakenteisiksi (PR #4, v1.16.0, PR #3:n päällä). Perustelut ja aloitusehto keskusrepon JONO.md:ssä.
   Valmis, kun: PR #3 ja PR #4 on yhdistetty ja julkaistu ja tuotannon savutesti antaa 0 virhettä.

## Seuraavaksi

(tyhjä)

## Myöhemmin

- **Viitekorkotarkistus 1.1.2027.** Aluetiedon viitekorko: Suomen Pankin julkaisema vs. laskettu.
- **Markkinointikalenterin vuosittainen ylläpito.** Lähde: PROJECT.md, luku Markkinointikalenterin vuosittainen ylläpito (tammikuussa liputuspäivät ja vaalipäivät, huhtikuussa Opetushallituksen koulujen loma-ajat ja Kotkan tiedote; noin 30 minuuttia vuodessa). Samassa luvussa merkitty tarkistettavaksi: International Wellness Day, päätöslauselman numero (A/RES/80/249 tai 80/248). Automaattinen tarkistus 22.11.2026 ei onnistunut (docs.un.org, digitallibrary.un.org ja un.org/en/observances palauttivat 403 automaattihaulle; estoa ei kierretty), joten tarkistus tehdään käsin selaimella: docs.un.org/en/A/RES/80/249, docs.un.org/en/A/RES/80/248 ja digitallibrary.un.org. Korjattavat kohdat: src/kalenteri.js:206 (L.yk-lähde, saanto, paiva) ja PROJECT.md:86. Valmis, kun: numero, hyväksymispäivä ja päivämäärä on varmistettu YK:n lähteestä ja kirjattu.
- **Anthropicin liitinhakemiston hakemus (finlex, eurlex, Aluetieto).** Perustelut keskusrepon JONO.md:ssä.
- **Työmarkkinatorin vaihe B (avoimet_tyopaikat).** Ei aloiteta ennen ilmoitusta. Valmis, kun: tarvittavat luvat ja tekniset ehdot on selvitetty ja kohta on otettu työn alle. Perustelut ja ehdot keskusrepon JONO.md:ssä.

## Hylätty

(tyhjä)
