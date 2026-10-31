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

## Rakenne

- `src/index.js`: MCP-protokolla ja käyttörajoitus
- `src/tools.js`: työkalut
- `src/ytj.js`: YTJ-haku ja tulkinta
- `src/stat.js`: Paavo ja toimipaikkatilasto (PxWeb)
- `src/http.js`: HTTP, välimuisti, alipyyntöbudjetti
- `src/tol2025.js`: toimialaluokitus
- `test/smoke.mjs`: savutesti

## Muutokset

- 31.10.2026 v1.0: ensimmäinen versio.
