# Repositorio-teste

Site principal **/DANTE** (Digital Experience Designer) feito com **Astro** e **Tailwind CSS v4**, a partir dos wireframes
de desktop e mobile. A **Cidade Isométrica 3D** (Three.js) fica dentro do card "Nexus" e continua sendo um arquivo
estático, fora do Astro. Os 3 sites de demonstração (pizzaria, cafeteria, restaurante) são os projetos da cidade.

## Como rodar

```bash
npm install
npm run dev        # servidor de desenvolvimento
npm run build      # gera dist/ (site estático)
npm run preview    # serve dist/ localmente
npm run check:widgets
```

## Estrutura

- `src/pages/index.astro` — o site principal: Hero → Works → About → Services → Process → Lab → Contact → Footer.
- `src/components/` — uma seção por componente (`Hero`, `Works`, `About`, `Services`, `Process`, `Lab`, `Contact`, `Footer`), mais `Header`, `Media`, `Loader`, `CityCard` e `DevPanel`.
- `src/styles/global.css` — tema do site principal (preto, branco e lime; Anton, Drunk e Arial). Cada demo tem o seu CSS (`pizzaria.css`, `cafeteria.css`, `restaurante.css`).
- `src/layouts/` — `Base` (site principal) e `Site` (demos).
- `src/pages/widgets/cidade-isometrica/{pizzaria,cafeteria,restaurante}.astro` — os 3 sites de demonstração, em `widgets/cidade-isometrica/<nome>/index.html`.
  O `restaurante` é o **Kaoru Kaze** (香る風): conteúdo e imagens do artefato "Kaoru Kaze — Wireframe" (landing final). As imagens ficam em `public/widgets/cidade-isometrica/restaurante/img/`.
- `public/widgets/cidade-isometrica/` — a cidade 3D (HTML, modelos, texturas) e as imagens das demos. Copiado como está para `dist/`.
- `widgets.json` — lista os widgets e diz quais são obrigatórios e em que seção.
- `scripts/` — `check-widgets.sh` e `artifact-fragment.py` (prepara `dist/index.html` para publicar como artefato).

## Desktop e mobile

Uma única página responsiva: o mobile é o desktop adaptado, com o ponto de virada em `lg` (1024px).
Abaixo disso o layout segue o wireframe mobile (hero com a imagem atrás do título, Works em carrossel com setas e contador,
menu hambúrguer, Process vertical com 5 etapas, Services em 2 colunas só com os nomes). Do `lg` para cima segue o wireframe desktop
(Works em grade, Process horizontal com 6 etapas, descrições nos serviços).

## Fontes

Anton (títulos e números), Drunk (menu, rótulos e botões) e Arial (textos). A Drunk não está no Google Fonts: ela aparece se estiver
instalada no computador; senão vale a Chakra Petch (carregada do Google Fonts). Para usar a Drunk de verdade, coloque o arquivo em
`public/fonts/` e declare um `@font-face` em `src/styles/global.css`.

## Imagens

As imagens do hero, de About, de Lab e dos cards Vértice e Aurora ainda são marcadores (`Media.astro`). Para trocar, coloque o arquivo em
`public/img/` e passe `src="img/nome.jpg"` ao `<Media>` correspondente.

## Cidade Isométrica no card do Nexus

O card do Nexus é a cidade (iframe `widgets/cidade-isometrica/index.html`). Ela é um **widget obrigatório** da seção `#works`
(`widgets.json`): `scripts/check-widgets.sh` falha se a seção não carregar a cidade, e o workflow `Build e widgets obrigatórios` roda o build
e essa verificação a cada push e PR.

- **Tela de carregamento** (`Loader.astro`): cobre a página até os modelos 3D carregarem. A cidade manda `{ type: 'city:loaded' }`, a página tira a tela
  e responde `{ type: 'city:start' }` para disparar a animação de entrada. Limite de 5 s: se a cidade não tiver carregado, a página abre sozinha e a
  cidade anima quando ficar pronta.
- **Card dos prédios por fora** (`CityCard.astro`): ao clicar num prédio, o card abre por cima da seção de baixo, preso à borda inferior da seção `#works`
  (`relative z-30`), sem empurrar o conteúdo. Fecha com Voltar, Esc ou clicando fora. O visual vem de `public/widgets/cidade-isometrica/card.css`.
- **Painel da câmera** (`DevPanel.astro`): escondido. Abra o site com `?camera` na URL (ex.: `index.html?camera`) para ver zoom, inclinação e giro
  da cidade ao vivo e copiar os valores. Como o card do Nexus é menor que a tela, o zoom padrão da cidade se ajusta ao espaço; use o painel para
  escolher o enquadramento e depois fixe `DEFAULT_ZOOM`, `DEFAULT_ANGLE` e `DEFAULT_PITCH` em `public/widgets/cidade-isometrica/index.html`.

## Voltar à cidade

O botão "← Voltar à cidade" dos 3 sites (`SiteBack.astro`) leva para `../../../index.html#works`, a seção de projetos do site principal.
O cabeçalho publica a própria altura em `--header-h`, usada como `scroll-padding-top`, então as âncoras param abaixo dele.

## Detalhes do build

- Os estilos ficam dentro de cada página (`inlineStylesheets: 'always'`) e os scripts são `is:inline`. A saída não usa caminhos absolutos como `/_astro/`
  e funciona em qualquer pasta, inclusive publicada como artefato. Os links entre páginas são relativos, escritos à mão.
- Tailwind v4 aplica a regra de CSS mais tardia, não a ordem das classes no atributo. Evite duas classes que definem a mesma propriedade no mesmo elemento.
- O formulário de contato é de demonstração: ainda não envia nada. Os links de redes sociais, WhatsApp e e-mail são marcadores.
