# Repositorio-teste

## Estrutura

- `index.html` — a landing page publicada. Abra pelo servidor (`python3 -m http.server`) para a cidade 3D carregar.
- `landing-page/` — fonte do canvas de Design (Wireframe Portfolio): `Main.dc.html`, `CidadeIsometrica.dc.html` e `canvas.json`.
- `widgets/` — widgets reutilizáveis. `widgets/widgets.json` lista cada um e diz se é obrigatório.
  - `widgets/cidade-isometrica/` — Cidade Isométrica 3D (Three.js). Abra `index.html` para ver o widget sozinho.

## Widget obrigatório: Cidade Isométrica

Todo projeto com seção de Projetos (`<section id="portfolio">`) precisa montar a cidade com
`<dc-import name="CidadeIsometrica">` e ter o arquivo `CidadeIsometrica.dc.html` ao lado.
No canvas de Design ele aparece como um espaço reservado (o canvas não roda Three.js); no site
publicado, esse espaço é ocupado por `widgets/cidade-isometrica/index.html`.

Em páginas `.html` comuns, como `index.html`, a seção `#portfolio` precisa carregar a cidade num `<iframe>` apontando para `widgets/cidade-isometrica/index.html`.

`scripts/check-widgets.sh` confere isso, e o workflow `Widgets obrigatórios` roda essa verificação a cada push e PR.

## Tela de carregamento

`index.html` cobre a página com uma tela de carregamento até os modelos 3D da cidade terminarem de carregar.
O iframe usa `widgets/cidade-isometrica/index.html?hold=1`: com esse parâmetro a cidade manda `{ type: 'city:loaded' }`
para a página, que tira a tela de carregamento e responde `{ type: 'city:start' }` para disparar a animação de entrada.
Sem `?hold=1` (widget aberto sozinho) a animação dispara assim que a cidade aparece. Se a cidade não avisar, a página libera sozinha após 25 s.
