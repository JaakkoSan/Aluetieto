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
