# Repositorio-teste

Landing page e sites de demonstração feitos com **Astro** e **Tailwind CSS v4**, mais o widget da
**Cidade Isométrica 3D** (Three.js), que é um arquivo estático e continua fora do Astro.

## Como rodar

```bash
npm install
npm run dev        # servidor de desenvolvimento
npm run build      # gera dist/ (site estático)
npm run preview    # serve dist/ localmente
npm run check:widgets
```

## Estrutura

- `src/pages/index.astro` — a landing page.
- `src/components/` — uma seção por componente: `About`, `Services`, `Process`, `Stacks`, `BlogLatest`, `Contact` (mais `Header`, `Button`, `SectionHead`...). Os dados editáveis ficam em `src/data/`.
- `src/pages/blog/` — a lista de posts (`index.astro`) e um arquivo por post (`<slug>.astro`).
- `src/pages/widgets/cidade-isometrica/{pizzaria,cafeteria,restaurante}.astro` — os 3 sites de demonstração.
  Cada um sai em `widgets/cidade-isometrica/<nome>/index.html`, o mesmo endereço que a cidade já usa nos links.
- `src/styles/` — `global.css` (landing) e um CSS por site (`pizzaria.css`, `cafeteria.css`, `restaurante.css`).
  Cada site tem o seu `@theme` do Tailwind com as cores, fontes e breakpoints da marca, então nada vaza de um para o outro.
- `src/layouts/` e `src/components/` — layouts (`Base`, `Site`) e componentes (`Header`, `Button`, `Loader`, `DevPanel`, `SiteBack`).
- `public/widgets/cidade-isometrica/` — a cidade 3D (HTML, modelos, texturas) e as imagens dos 3 sites. É copiado como está para `dist/`.
- `widgets.json` — lista os widgets e diz quais são obrigatórios.
- `landing-page/` — fonte do canvas de Design (Wireframe Portfolio): `Main.dc.html`, `CidadeIsometrica.dc.html` e `canvas.json`.
  O canvas de Design usa outro formato e não passa pelo Astro nem pelo Tailwind.
- `scripts/` — `check-widgets.sh` (verificação dos widgets obrigatórios) e `artifact-fragment.py` (prepara `dist/index.html` para publicar como artefato).

## Detalhes do build

- Os estilos ficam dentro de cada página (`inlineStylesheets: 'always'`) e os scripts das páginas são `is:inline`.
  Assim a saída não usa caminhos absolutos como `/_astro/` e funciona em qualquer pasta, inclusive publicada como artefato.
  Os links entre páginas são relativos, escritos à mão.
- Tailwind v4 aplica a regra de CSS mais tardia, não a ordem das classes no atributo. Evite duas classes que definem a mesma propriedade no mesmo elemento.
- Os sites usam `text-[14px]` em vez de `text-sm`, e `leading-[normal]` em botões, para manter a altura de linha herdada do design original.

## Seções da landing page

Ordem: Hero → **Sobre** → **Projetos** (a cidade) → **Serviços** → **Processo de trabalho** → **Stacks** → **Blog** → **Contato**.
O menu do cabeçalho tem um link para cada uma (menos Contato, que é o botão "Fale comigo").
Os textos entre `[colchetes]` são marcadores para você preencher.

- **Stacks:** edite `src/data/stacks.ts`. Cada grupo vira uma coluna.
- **Blog:** a landing mostra os 3 posts mais recentes; `/blog/` mostra todos.

### Como adicionar um post

1. Copie `src/pages/blog/exemplo-1.astro` para `src/pages/blog/<slug>.astro` e escreva o post em HTML comum dentro do `<Blog>` (títulos, parágrafos, listas, `code`, `pre`, imagens e citações já saem formatados).
2. Adicione uma entrada em `src/data/blog.ts` com o mesmo `<slug>`, título, data (`AAAA-MM-DD`), tema e resumo.

Pronto: o post aparece na seção Blog (se for um dos 3 mais recentes) e em `/blog/`. Os 3 `exemplo-*` são só marcadores: apague-os e tire as entradas de `blog.ts` quando tiver posts de verdade.

## Widget obrigatório: Cidade Isométrica

Todo projeto com seção de Projetos (`<section id="portfolio">`) precisa carregar a cidade:

- **Astro/HTML:** um `<iframe>` apontando para `widgets/cidade-isometrica/index.html`.
- **Canvas de Design:** `<dc-import name="CidadeIsometrica">` e o arquivo `CidadeIsometrica.dc.html` ao lado.
  No canvas ele aparece como um espaço reservado, porque o canvas não roda Three.js.

`scripts/check-widgets.sh` confere isso, e o workflow `Build e widgets obrigatórios` roda o build e a verificação a cada push e PR.

## Tela de carregamento

A landing page cobre a tela até os modelos 3D da cidade terminarem de carregar (`src/components/Loader.astro`).
O iframe usa `widgets/cidade-isometrica/index.html?hold=1`: com esse parâmetro a cidade manda `{ type: 'city:loaded' }`
para a página, que tira a tela de carregamento e responde `{ type: 'city:start' }` para disparar a animação de entrada.
Sem `?hold=1` (widget aberto sozinho) a animação dispara assim que a cidade aparece. Se a cidade não avisar, aparece o botão "Entrar sem esperar" depois de 6 s e a página libera sozinha após 15 s.
A cidade avisa mesmo estando fora da tela dentro de outro site (o navegador pausa `requestAnimationFrame` em iframes de outra origem que não estão visíveis, então o aviso não depende dele).

## Card dos prédios por fora

Ao clicar num prédio, o card abre fora da cidade, por cima da seção de baixo (`src/components/CityCard.astro`).
Ele é `position: absolute` preso à borda inferior da seção `#portfolio` (que é `relative z-30`), então não empurra o conteúdo. Fecha com Voltar, Esc ou clicando fora.
O iframe usa `&card=out`: a cidade continua montando o card (dados, horários, valores ao vivo) e manda para a página
`{ type: 'city:card', open, html, ... }` e `{ type: 'city:card-live', updates }`; a página responde `{ type: 'city:card-back' }`
(voltar) e `{ type: 'city:card-act', act: 'feed' }` (alimentar os pássaros). Com o card por fora a câmera não sobe para abrir espaço.
O visual do card fica em `public/widgets/cidade-isometrica/card.css`, usado pela cidade (card interno) e pela página.
Sem `&card=out` (widget aberto sozinho) o card continua abrindo dentro da cidade.

## Voltar à cidade

O botão "← Voltar à cidade" dos 3 sites (`src/components/SiteBack.astro`) é um link para `../../../index.html#portfolio`:
leva de volta à landing page, na seção de projetos onde fica a cidade, em vez da página solta da cidade.
O cabeçalho fixo publica a própria altura em `--header-h`, que o `html` usa como `scroll-padding-top`,
então a âncora `#portfolio` para logo abaixo do cabeçalho.

## Painel temporário da câmera

`src/components/DevPanel.astro` mostra zoom, inclinação e giro da cidade ao vivo (o iframe usa `&debug=1`).
Para remover: apague o componente, o `<DevPanel />` do `Header.astro` e o `&debug=1` do iframe em `index.astro`.
