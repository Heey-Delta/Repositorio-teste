# Repositorio-teste

## Estrutura

- `landing-page/` — fonte do canvas de Design (Wireframe Portfolio): `Main.dc.html`, `CidadeIsometrica.dc.html` e `canvas.json`.
- `widgets/` — widgets reutilizáveis. `widgets/widgets.json` lista cada um e diz se é obrigatório.
  - `widgets/cidade-isometrica/` — Cidade Isométrica 3D (Three.js). Abra `index.html` para ver o widget sozinho.

## Widget obrigatório: Cidade Isométrica

Todo projeto com seção de Projetos (`<section id="portfolio">`) precisa montar a cidade com
`<dc-import name="CidadeIsometrica">` e ter o arquivo `CidadeIsometrica.dc.html` ao lado.
No canvas de Design ele aparece como um espaço reservado (o canvas não roda Three.js); no site
publicado, esse espaço é ocupado por `widgets/cidade-isometrica/index.html`.

`scripts/check-widgets.sh` confere isso, e o workflow `Widgets obrigatórios` roda essa verificação a cada push e PR.
