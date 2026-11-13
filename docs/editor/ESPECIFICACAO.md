# Especificação do editor unificado — organizada passo a passo

Este documento organiza a especificação entregue (arquitetura funcional unificada, Registro Mestre 1.0, estrutura de
dados e motores) na ordem em que o editor é construído. Cada passo aponta para o código e para o catálogo.

- Catálogo completo (260 funcionalidades, com ID, motor, operações e situação): [`CATALOGO.md`](./CATALOGO.md)
- Arquitetura técnica e decisões: [`ARQUITETURA.md`](./ARQUITETURA.md)
- Código: `src/editor-core/` · Testes: `npm run test:editor` · Tipos: `npm run check:editor`

---

## Parte A — Princípios

1. **Uma funcionalidade existe uma vez só.** Copiar, colar, desfazer e refazer não são três conjuntos (documento,
   slide, planilha): são recursos do núcleo universal.
2. **Três camadas.**
   - Camada 1 — Núcleo universal: edição, formatação, estrutura, inserção, manipulação, temas, histórico,
     colaboração, importação/exportação, visualização.
   - Camada 2 — Motores especializados: tabelas, fórmulas, gráficos, diagramas, layout de páginas, animações,
     revisão, referências, automação.
   - Camada 3 — Aplicações: editor de documentos, de apresentações e de planilhas (interface).
3. **Três regras do Registro Mestre.**
   - Universalidade: todo conteúdo é um elemento manipulável pelo núcleo.
   - Especialização: o que é específico (células, fórmulas, animações) usa estruturas próprias, sem duplicar o núcleo.
   - Não duplicação: negrito, mover, copiar etc. são propriedades ou operações, nunca estruturas.
4. **Separar três coisas que costumam se misturar:** marcadores de estrutura (o que o documento é), propriedades
   (como cada coisa é) e operações (o que se faz com ela).

## Parte B — As 18 categorias (o "quê")

| ID | Categoria | Responsabilidade | Motor principal |
| --- | --- | --- | --- |
| 01 | Edição de conteúdo | Criar e modificar conteúdo | Núcleo, Seleção, Histórico, Texto |
| 02 | Formatação | Definir aparência | Formatação |
| 03 | Estrutura e organização | Organizar hierarquias | Organização |
| 04 | Inserção de elementos | Adicionar componentes | Conteúdo |
| 05 | Manipulação de objetos | Transformar e posicionar | Objetos (layout espacial) |
| 06 | Tabelas e dados | Organizar informações | Tabelas |
| 07 | Cálculos e fórmulas | Processar informações | Fórmulas |
| 08 | Visualização de dados | Representar informações | Gráficos, Diagramas |
| 09 | Layout e composição | Organizar espaços | Páginas |
| 10 | Temas e estilos | Padronizar aparência | Formatação |
| 11 | Animações e transições | Controlar movimento | Animações |
| 12 | Revisão e validação | Verificar conteúdo | Revisão |
| 13 | Comentários e colaboração | Trabalhar em conjunto | Colaboração |
| 14 | Histórico e recuperação | Preservar alterações | Histórico, Persistência |
| 15 | Referências e elementos automáticos | Vincular informações | Referências |
| 16 | Importação e exportação | Gerenciar formatos | Importação/Exportação |
| 17 | Automação e extensibilidade | Ampliar capacidades | Automação |
| 18 | Visualização e navegação | Controlar a experiência | Visualização |

Cada item de cada categoria está no catálogo com identificador `Fcc.ii` (ex.: `F06.05` = Mesclar células).

## Parte C — Registro Mestre 1.0 (marcadores) e onde cada um está no código

| Grupo | Marcador | No código |
| --- | --- | --- |
| Estrutura central | DOC | `doc.document` (`DocumentInfo`) |
| | SEC · BLK · GRP · SURFACE · REGION · LIST · ITEM · BREAK | tipos `SECTION`, `BLOCK`, `GROUP`, `SURFACE`, `REGION`, `LIST`, `LIST_ITEM`, `BREAK` |
| | ELM | qualquer nó de conteúdo (`EditorNode` com tipo de conteúdo) |
| Tipos de conteúdo | TXT · IMG · SHP · LIN · TBL · CHT · DGM · LINK · SYM · EQN · AUD · VID · FIELD · NOTE · CAPTION · CITATION | `type` do nó: `TEXT`, `IMAGE`, `SHAPE`, `LINE`, `TABLE`, `CHART`, `DIAGRAM`, `LINK`, `SYMBOL`, `EQUATION`, `AUDIO`, `VIDEO`, `FIELD`, `NOTE`, `CAPTION`, `CITATION` (prefixo do ID = marcador: `TXT_000012`) |
| Dados e cálculos | ROW · COL · CELL | `data.rows/columns/cells` (tabela) ou `data.cells['A1']` (planilha) |
| | RANGE · REF | endereços `A1:B5`, `Planilha2!A1` (parser de fórmulas) |
| | FORMULA · FUNCTION | `cell.formula` + `formula/` (registro de funções) |
| | SOURCE · SERIES | `chart.data.source` + `chart.data.series` |
| | RULE | `cell.validation` (validação); `data.conditionalFormats` (formatação condicional, `ops/conditional.ts`) |
| Formatação | FORMAT | `styleOverrides` (e `runs[].format` no texto) |
| | STYLE · THEME | `doc.styles`, `doc.themes` |
| | TEMPLATE | biblioteca `e.services.templates` (`ops/template.ts`); layouts em `settings.layouts` |
| Posicionamento | LAYOUT · TRANSFORM · CONSTRAINT | `node.layout` (`mode`, `x`, `y`, `width`, `rotation`, `scaleX`, `flipH`, `constraints`) |
| | GRID · GUIDE | `settings.grid`, `settings.guides` |
| | LAYER | `layout.zIndex` (ordem visual entre irmãos) |
| Animação | ANIM · TRANS · TRIGGER | `slide.data.animations[]` (ordem = sequência), `slide.data.transition` (`ops/animation.ts`) |
| Revisão/colaboração | COMMENT · USER · PERM · PRESENCE · ISSUE | `doc.comments` (fios), `doc.revisions` (controle de alterações), `settings.permissions`, `engine.user`, presença em memória (`ops/collab.ts`); problemas da revisão calculados (`ops/review.ts`) |
| | CHANGE | `Transaction` (antes/depois por item) |
| | VERSION | `engine.snapshots` (banco na Etapa 14) |
| Controle e execução | ACTION | `Operation` (o que entra) e `Transaction` (o que ficou registrado) |
| | CLIPBOARD · SELECTION · VIEW | `engine.state` (EDITOR_STATE) |
| | SETTING | `doc.document.settings` |
| | ASSET | `doc.assets` |
| | EVENT | `engine.on()/emit()` (`change`, `selection`, `chart`…) |
| | AUTOMATION · TASK · EXTENSION | Etapa 12 |

Propriedades universais (`id`, `type`, `parentId`, `children`, `order`, `data`, `styleId`, `layout`, `metadata`)
são campos do nó, não marcadores.

## Parte D — Estrutura de dados

```
DocumentModel
├── document   identidade, aplicação, raiz, tema ativo, configurações (grade, guias, nomes, página, slide)
├── nodes      { [id]: EditorNode }   árvore indexada por ID (cada nó conhece pai e filhos)
├── assets     { [id]: Asset }        referências a arquivos
├── styles     { [id]: Style }
└── themes     { [id]: Theme }
EditorState    seleção, área de transferência, superfície ativa, modo, zoom (não é salvo)
HistoryState   past[] / future[] de transações (antes/depois por item)
```

Regras: ID único; todo nó tem pai (exceto a raiz); filhos por ID; todo nó tem tipo; cada tipo tem seus dados;
estilos compartilhados; referências por ID; excluir trata descendentes e referências; integridade verificada
(quem pode ficar dentro de quem: `schema.ts`).

## Parte E — Construção passo a passo

Cada passo usa o anterior. ✅ concluído · 🔨 em andamento · ⬜ a fazer.

### Fundação (concluída)

| Passo | O que | Onde | Funcionalidades |
| --- | --- | --- | --- |
| ✅ 1 | Estrutura de dados e documentos novos (documento, apresentação, planilha) | `types.ts`, `document.ts`, `schema.ts` | base de todas |
| ✅ 2 | Motor de operações: CREATE, GET, UPDATE, MOVE, DUPLICATE, DELETE, com integridade e bloqueio | `engine.ts`, `ops/basic.ts` | F01.01–02, F01.09, F01.16 |
| ✅ 3 | Histórico: transações, UNDO, REDO, REPEAT, versões | `engine.ts`, `ops/history.ts` | F01.10–12, F14 |
| ✅ 4 | Seleção e área de transferência | `ops/selection.ts` | F01.03–07, F01.15 |
| ✅ 5 | Organização e camadas | `ops/organize.ts` | F03, F05.08–14 |
| ✅ 6 | Formatação, estilos e temas | `ops/format.ts` | F02, F10 |
| ✅ 7 | Layout e posicionamento | `ops/layout.ts` | F05, F09.11–16 |
| ✅ 8 | Texto (trechos formatados, localizar, substituir, contagem) | `ops/text.ts` | F01.13–14, F02, F12.10–11 |
| ✅ 9 | Inserção de conteúdo (16 tipos) e estruturas | `ops/content.ts` | F03, F04 |
| ✅ 10 | Tabelas e planilhas | `ops/table.ts` | F06 |
| ✅ 11 | Fórmulas: lexer, parser, avaliador, funções, dependências, recálculo | `formula/` | F07 |
| ✅ 12 | Gráficos ligados à fonte | `charts/chart.ts` | F08.01–09, F08.13 |

### Completar as 18 categorias (Etapas 01–15)

| Etapa | O que | Funcionalidades |
| --- | --- | --- |
| ✅ 01 | Especificação organizada (este documento) + catálogo no código e teste de conformidade | todas |
| ✅ 02 | Edição: colar especial (valores, transposto, vínculo), arrastar e soltar | F01.07–08 |
| ✅ 03 | Layout de páginas: tamanho, orientação, margens, colunas, fundo, paginação, cabeçalho/rodapé por página, impressão | F09.01–10, F04.14 |
| ✅ 04 | Referências: campos calculados, indicadores, referências cruzadas, numeração de notas e legendas, sumário, índice, citações e bibliografia | F15, F04.15–16 |
| ✅ 05 | Formatação condicional e regras visuais, bordas/sombras/efeitos estruturados, filtros combinados, modelos | F02.25–27, F06.10, F06.13, F08.14–15, F10.08–10 |
| ✅ 06 | Motor de diagramas (fluxograma, organograma, layout automático, conectores) | F04.07, F08.10–12 |
| ✅ 07 | Animações e transições (linha do tempo e reprodução) | F11 |
| ✅ 08 | Revisão: ortografia, gramática, sugestões, tradução, consistência, acessibilidade, estatísticas | F12 |
| ✅ 09 | Comentários, permissões, presença, controle de alterações, edição simultânea | F13 |
| ✅ 10 | Comparar versões e recuperação | F14.06, F14.08 |
| ✅ 11 | Importação e exportação (JSON, TXT, MD, HTML, CSV, SVG, DOCX, XLSX, PPTX, PDF), impressão | F16 |
| ✅ 12 | Automação: macros, scripts, automações por evento, atalhos, extensões, webhooks, funções do usuário | F17, F07.10 |
| ⬜ 13 | Visualização e navegação: modos, zoom, navegação, painéis, várias janelas, leitura assistida | F18, F09.12 |
| ⬜ 14 | Persistência no banco e salvamento automático | F14.04, F14.09 |
| ⬜ 15 | Interface: renderizador e editores de documento, apresentação e planilha | Camada 3 |

A situação de cada funcionalidade é atualizada no catálogo (`src/editor-core/catalog.ts`) ao fim de cada etapa;
o teste `catalog.test.ts` impede marcar como pronta uma funcionalidade sem operação no motor.
