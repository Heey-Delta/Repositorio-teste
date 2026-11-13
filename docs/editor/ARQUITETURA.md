# Editor unificado (documentos, apresentações e planilhas)

Objetivo: um único editor com as funções essenciais do Word, do PowerPoint e do Excel, construído sobre uma anatomia
universal. Cada funcionalidade existe uma vez só; as três aplicações compartilham o mesmo núcleo.

Código: `src/editor-core/` (TypeScript puro, sem interface e sem dependências externas).
Testes: `npm run test:editor` (36 testes, `node --test`). Tipos: `npm run check:editor` (TypeScript estrito).

## Regras da arquitetura

1. **Universalidade**: todo conteúdo é um nó da coleção `NODES` e é manipulado pelo mesmo núcleo.
2. **Especialização**: o que é específico (células, fórmulas, séries, trechos de texto) fica em `data`, sem duplicar o núcleo.
3. **Não duplicação**: negrito, mover, copiar etc. são propriedades ou operações, nunca estruturas novas.

## Estrutura de dados

| Estrutura | Onde | O que guarda |
| --- | --- | --- |
| `DOCUMENT` | `doc.document` | identidade, aplicação, raiz, tema ativo, grade, guias, nomes definidos |
| `NODES` | `doc.nodes` (indexado por ID) | árvore de elementos: `id, type, parentId, children, order, data, styleId, styleOverrides, layout, metadata` |
| `ASSETS` | `doc.assets` | referências a arquivos (o arquivo fica no armazenamento, ex.: Vercel Blob) |
| `STYLES` / temas | `doc.styles`, `doc.themes` | estilos reutilizáveis e temas globais |
| `EDITOR_STATE` | `engine.state` | seleção, área de transferência, superfície ativa, modo, zoom (não é salvo) |
| `HISTORY` | `engine.history` | transações com antes/depois de cada item alterado; versões completas em `engine.snapshots` |

Uma superfície para cada aplicação, no mesmo formato:

```
Documento     SECTION → BLOCK (fluxo; as páginas são calculadas pelo layout, não armazenadas)
Apresentação  SECTION → SURFACE (SLIDE, posicionamento livre)
Planilha      SECTION → SURFACE (SHEET, células esparsas: data.cells['A1'])
```

## Camadas e motores

| Camada | Arquivo | Operações |
| --- | --- | --- |
| Motor de operações e transações | `engine.ts` | `execute`/`run`, transações, desfazer/refazer, eventos `change`, `selection`, `chart` |
| Operações básicas | `ops/basic.ts` | `CREATE` · `GET` · `UPDATE` · `MOVE` · `DUPLICATE` · `DELETE` |
| Histórico | `ops/history.ts` | `UNDO` · `REDO` · `REPEAT` · `CREATE_VERSION` · `RESTORE_VERSION` · `LIST_VERSIONS` · `LIST_HISTORY` |
| Interação | `ops/selection.ts` | `SELECT` · `DESELECT` · `CLEAR_SELECTION` · `SELECT_ALL` · `SELECT_AREA` · `COPY` · `CUT` · `PASTE` · `PASTE_TEXT` |
| Organização | `ops/organize.ts` | `GROUP` · `UNGROUP` · `REORDER` · `BRING_FORWARD` · `SEND_BACKWARD` · `BRING_TO_FRONT` · `SEND_TO_BACK` · `LOCK` · `UNLOCK` · `HIDE` · `SHOW` · `COLLAPSE` · `EXPAND` |
| Formatação | `ops/format.ts` | `FORMAT` · `CLEAR_FORMAT` · `COPY_FORMAT` · `PASTE_FORMAT` · `CREATE_STYLE` · `UPDATE_STYLE` · `DELETE_STYLE` · `APPLY_STYLE` · `REMOVE_STYLE` · `CREATE_THEME` · `UPDATE_THEME` · `APPLY_THEME` · `RESOLVE_STYLE` |
| Layout | `ops/layout.ts` | `SET_POSITION` · `RESIZE` · `TRANSFORM` · `ALIGN` · `DISTRIBUTE` · `SET_LAYOUT` · `UPDATE_LAYOUT` · `SET_CONSTRAINT` · `SET_GRID` · `ADD_GUIDE` · `MOVE_GUIDE` · `REMOVE_GUIDE` · `SNAP` |
| Texto | `ops/text.ts` | `TEXT_SET` · `TEXT_INSERT` · `TEXT_DELETE` · `TEXT_FORMAT` · `CHANGE_CASE` · `FIND` · `REPLACE` · `TEXT_STATS` |
| Conteúdo | `ops/content.ts` | `INSERT_CONTENT` (16 tipos) · `UPDATE_CONTENT` · `CONVERT_CONTENT` · `INSERT_STRUCTURE` · `SET_LIST_LEVEL` · `IMPORT_ASSET` · `REPLACE_ASSET` · `REMOVE_UNUSED_ASSETS` |
| Tabelas e planilhas | `ops/table.ts` | `SET_CELL` · `SET_CELLS` · `SET_FORMULA` · `GET_CELL` · `GET_RANGE` · `CLEAR_CELL` · `INSERT_ROW` · `DELETE_ROW` · `INSERT_COLUMN` · `DELETE_COLUMN` · `MERGE_CELLS` · `SPLIT_CELLS` · `RESIZE_ROW` · `RESIZE_COLUMN` · `DISTRIBUTE_*` · `SORT` · `FILTER` · `CLEAR_FILTER` · `FILTERED_ROWS` · `SET_VALIDATION` · `FORMAT_CELLS` · `COPY_FORMULA` · `FILL` · `DEFINE_NAME` · `DELETE_NAME` · `RECALCULATE` · `FORMULA_ERRORS` · `TEXT_TO_TABLE` · `TABLE_TO_TEXT` |
| Fórmulas | `formula/*.ts` | lexer, parser (AST), avaliador, 59 funções (118 nomes em PT e EN), dependências, recálculo ordenado, ciclos, ajuste de referências |
| Gráficos | `charts/chart.ts` | `CREATE_CHART` · `SET_CHART_TYPE` · `SET_DATA_SOURCE` · `UPDATE_DATA_SOURCE` · `ADD_SERIES` · `REMOVE_SERIES` · `UPDATE_SERIES` · `SET_CHART_OPTION` · `CHART_DATA` · `REFRESH_CHART` · `CHARTS_USING` |

## Como usar

```ts
import { createEngine, createDocument } from '../editor-core/index.ts';

const e = createEngine(createDocument('SPREADSHEET_EDITOR'));
const sheet = e.state.activeSurface;
e.run({ type: 'SET_CELLS', targetId: sheet, payload: { start: 'A1', values: [['Mês', 'Vendas'], ['Jan', 120], ['Fev', 180]] } });
e.run({ type: 'SET_CELL', targetId: sheet, payload: { cell: 'B4', value: '=SOMA(B2:B3)' } });
e.run({ type: 'UNDO' });

const r = e.execute({ type: 'DELETE', targetId: 'XYZ' });   // { ok: false, error: { code: 'NOT_FOUND', message } }
e.on('change', ({ transaction }) => { /* redesenhar o que mudou, salvar */ });
```

## Decisões importantes

- **Histórico por item, não por documento**: cada transação guarda o antes/depois só do que mudou. Operações que
  falham no meio são desfeitas por inteiro (nada fica pela metade).
- **Uma ação = uma transação**: mudar a cor de três formas desfaz de uma vez.
- **Hierarquia ≠ camada**: `parentId/children/order` dizem quem está dentro de quem; `layout.zIndex` diz quem aparece na frente.
- **Aparência calculada**: tema → estilo → ajustes individuais. Valores `theme:primary` seguem o tema.
- **Gráfico não copia dados**: guarda a fonte (`RANGE`, `TABLE` ou `MANUAL`) e lê os valores na hora.
- **Fórmula nunca vira código**: é lida por um parser próprio. Separador `;` ou `,`; casa decimal com ponto.
- **Referências**: conector, gráfico, legenda e link apontam por ID. Copiar remapeia; excluir solta o conector e marca a fonte perdida.
- **Recorte**: o objeto sai na hora, mas a cópia completa fica na área de transferência (e dá para desfazer).

## Cobertura das 18 categorias

| # | Categoria | Situação |
| --- | --- | --- |
| 01 | Edição de conteúdo | pronto no motor (criar, editar, selecionar, copiar/recortar/colar, colar especial, excluir, desfazer/refazer, repetir, localizar/substituir, duplicar) |
| 02 | Formatação | pronto no motor (tipografia, parágrafo, aparência dos elementos, estilos, copiar/remover formatação) |
| 03 | Estrutura e organização | pronto (seções, blocos, listas multinível, agrupar, reordenar, ocultar, recolher) |
| 04 | Inserção de elementos | pronto (16 tipos com validação; cabeçalho/rodapé como REGION; campos automáticos) |
| 05 | Manipulação de objetos | pronto (mover, redimensionar, girar, inverter, alinhar, distribuir, camadas, bloquear, grade, guias, encaixe) |
| 06 | Tabelas e dados | pronto (tabelas e planilhas, mesclar, ordenar, filtrar, validar, listas suspensas, converter texto ↔ tabela) |
| 07 | Cálculos e fórmulas | pronto (operadores, 59 funções, referências relativas/absolutas, entre planilhas, nomes, recálculo, erros) |
| 08 | Visualização de dados | gráficos prontos; diagramas só como dados (motor de diagramas é a próxima etapa); formatação condicional pendente |
| 09 | Layout e composição | posicionamento pronto; paginação, margens e impressão dependem do renderizador |
| 10 | Temas e estilos | pronto (temas, estilos, referências ao tema); modelos (templates) pendentes |
| 11 | Animações e transições | pendente |
| 12 | Revisão e validação | contagem de palavras, erros de fórmula e validação de dados prontos; ortografia/gramática/tradução pendentes |
| 13 | Comentários e colaboração | pendente |
| 14 | Histórico e recuperação | pronto no motor (transações, versões, restaurar); salvar automaticamente depende da persistência |
| 15 | Referências e automáticos | links, campos, notas, legendas e citações como conteúdo; sumário, índice e bibliografia pendentes |
| 16 | Importação e exportação | pendente |
| 17 | Automação e extensibilidade | funções personalizadas prontas (`registerFunction`); macros e extensões pendentes |
| 18 | Visualização e navegação | estado (modo, zoom, superfície ativa) pronto; telas dependem da interface |

## Próximas etapas (em ordem)

1. **Persistência**: tabelas `documents`, `document_versions` e `document_actions` no Neon, com salvamento automático
   a partir do evento `change`. O documento é salvo como JSON; as transações viram o histórico.
2. **Renderizador e interface**: desenhar `NODES` (texto em fluxo, slides em posição livre, grade de planilha), barra
   de ferramentas por aplicação e atalhos. O motor não muda: a interface só chama `execute`.
3. **Motor de diagramas**: fluxogramas, organogramas e conexões com pontos de ancoragem.
4. **Animações e transições**, **comentários e colaboração**, **importação/exportação** (PDF, DOCX, XLSX, PPTX, CSV),
   **revisão** (ortografia e acessibilidade), **referências automáticas** (sumário, índice, bibliografia).

Limites conhecidos desta versão: o histórico de planilhas guarda a planilha alterada inteira por transação (ótimo até
alguns milhares de células; a próxima otimização é guardar só as células alteradas); intervalos de coluna inteira
(`A:A`) e fórmulas matriciais ainda não são aceitos.
