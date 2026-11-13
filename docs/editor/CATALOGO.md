# Catálogo de funcionalidades do editor

> Gerado de `src/editor-core/catalog.ts` com `npm run catalog:editor`. Não edite à mão.

**260 funcionalidades** · ✅ 260 prontas · 🟡 0 parciais · ⬜ 0 a fazer

## Resumo por categoria

| ID | Categoria | Responsabilidade | ✅ | 🟡 | ⬜ |
| --- | --- | --- | --- | --- | --- |
| 01 | Edição de conteúdo | Criar e modificar conteúdo | 16 | 0 | 0 |
| 02 | Formatação | Definir aparência | 30 | 0 | 0 |
| 03 | Estrutura e organização | Organizar hierarquias | 13 | 0 | 0 |
| 04 | Inserção de elementos | Adicionar componentes | 16 | 0 | 0 |
| 05 | Manipulação de objetos | Transformar e posicionar | 17 | 0 | 0 |
| 06 | Tabelas e dados | Organizar informações | 17 | 0 | 0 |
| 07 | Cálculos e fórmulas | Processar informações | 16 | 0 | 0 |
| 08 | Visualização de dados | Representar informações | 15 | 0 | 0 |
| 09 | Layout e composição | Organizar espaços | 16 | 0 | 0 |
| 10 | Temas e estilos | Padronizar aparência | 12 | 0 | 0 |
| 11 | Animações e transições | Controlar movimento | 13 | 0 | 0 |
| 12 | Revisão e validação | Verificar conteúdo | 13 | 0 | 0 |
| 13 | Comentários e colaboração | Trabalhar em conjunto | 11 | 0 | 0 |
| 14 | Histórico e recuperação | Preservar alterações | 9 | 0 | 0 |
| 15 | Referências e elementos automáticos | Vincular informações | 11 | 0 | 0 |
| 16 | Importação e exportação | Gerenciar formatos | 12 | 0 | 0 |
| 17 | Automação e extensibilidade | Ampliar capacidades | 9 | 0 | 0 |
| 18 | Visualização e navegação | Controlar a experiência | 14 | 0 | 0 |

## Motores

| Motor | Camada | Funcionalidades |
| --- | --- | --- |
| Núcleo de operações (`CORE`) | 1 | 4 |
| Seleção e área de transferência (`SELECTION`) | 1 | 7 |
| Histórico e versões (`HISTORY`) | 1 | 11 |
| Hierarquia e organização (`ORGANIZE`) | 1 | 15 |
| Formatação, estilos e temas (`FORMAT`) | 1 | 42 |
| Inserção de conteúdo (`CONTENT`) | 1 | 10 |
| Texto (`TEXT`) | 1 | 5 |
| Manipulação de objetos (`OBJECTS`) | 1 | 20 |
| Comentários e colaboração (`COLLAB`) | 1 | 11 |
| Importação e exportação (`IO`) | 1 | 12 |
| Visualização e navegação (`VIEW`) | 1 | 15 |
| Tabelas e dados (`TABLE`) | 2 | 21 |
| Cálculos e fórmulas (`FORMULA`) | 2 | 18 |
| Visualização de dados (`CHART`) | 2 | 11 |
| Diagramas (`DIAGRAM`) | 2 | 4 |
| Layout e composição (`PAGE`) | 2 | 11 |
| Animações e transições (`ANIMATION`) | 2 | 13 |
| Revisão e validação (`REVIEW`) | 2 | 8 |
| Referências e elementos automáticos (`REFERENCE`) | 2 | 13 |
| Automação e extensibilidade (`AUTOMATION`) | 2 | 8 |
| Persistência (banco de dados) (`STORAGE`) | 3 | 1 |

## 01. Edição de conteúdo

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F01.01 | Criar conteúdo | CORE | `CREATE` `INSERT_CONTENT` | parentId, nodeType\|contentType, data, layout, index | Cria qualquer elemento na árvore do documento. |
| ✅ | F01.02 | Editar conteúdo | CORE | `UPDATE` `UPDATE_CONTENT` `TEXT_SET` `TEXT_INSERT` `TEXT_DELETE` `SET_CELL` | targetId, payload | Altera dados, texto ou célula de um elemento existente. |
| ✅ | F01.03 | Selecionar elementos | SELECTION | `SELECT` `DESELECT` `SELECT_AREA` `CLEAR_SELECTION` | targetId, additive, deep \| retângulo | Seleção simples, múltipla (aditiva), por área e dentro de grupos (deep). |
| ✅ | F01.04 | Copiar | SELECTION | `COPY` | targetIds? | Guarda uma cópia da seleção na área de transferência. |
| ✅ | F01.05 | Recortar | SELECTION | `CUT` | targetIds? | Copia e remove; a cópia completa fica guardada e dá para desfazer. Depende de F01.04. |
| ✅ | F01.06 | Colar | SELECTION | `PASTE` `PASTE_TEXT` | parentId?, index? | Insere o conteúdo copiado com IDs novos e relações internas remapeadas. Depende de F01.04. |
| ✅ | F01.07 | Colar especial | SELECTION | `PASTE` `COPY_CELLS` `CUT_CELLS` `PASTE_CELLS` | mode: TEXT_ONLY\|FORMAT_ONLY\|LINK\|VALUES\|FORMULAS\|ALL, transpose | Elementos: só texto, só formatação, como vínculo. Células: tudo, só valores, só fórmulas, só formatação, transposto, vínculo; recortar move e atualiza referências. Depende de F01.06. |
| ✅ | F01.08 | Arrastar e soltar | SELECTION | `DROP` | targetIds, destinationId, x?, y?, index?, copy?, files? | Solta elementos (ou arquivos) num destino: reposiciona, muda de contêiner ou de ordem; com copy solta uma cópia. Depende de F05.01. |
| ✅ | F01.09 | Excluir conteúdo | CORE | `DELETE` `CLEAR_CELL` | targetIds | Remove elementos (com descendentes) tratando referências. |
| ✅ | F01.10 | Desfazer | HISTORY | `UNDO` |  | Reverte a última transação. |
| ✅ | F01.11 | Refazer | HISTORY | `REDO` |  | Reaplica a transação desfeita. |
| ✅ | F01.12 | Repetir última ação | HISTORY | `REPEAT` |  | Repete a última alteração na seleção atual. |
| ✅ | F01.13 | Localizar | TEXT | `FIND` | query, matchCase, wholeWord, regex, scope | Procura em textos, tabelas e planilhas (maiúsculas, palavra inteira, expressão regular). |
| ✅ | F01.14 | Substituir | TEXT | `REPLACE` | query, replacement, all, cells | Substitui ocorrências mantendo a formatação. Depende de F01.13. |
| ✅ | F01.15 | Selecionar tudo | SELECTION | `SELECT_ALL` | parentId? | Seleciona tudo no contexto atual (bloco, slide, planilha). |
| ✅ | F01.16 | Duplicar elementos | CORE | `DUPLICATE` | targetIds, offset | Cria cópia independente da subárvore, ao lado do original. |

## 02. Formatação

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| | | **Tipografia** | | | | |
| ✅ | F02.01 | Família tipográfica | FORMAT | `FORMAT` `TEXT_FORMAT` | fontFamily | Fonte do elemento ou de um trecho. |
| ✅ | F02.02 | Tamanho da fonte | FORMAT | `FORMAT` `TEXT_FORMAT` | fontSize | Tamanho em pontos. |
| ✅ | F02.03 | Negrito | FORMAT | `FORMAT` `TEXT_FORMAT` | bold | Peso da fonte. |
| ✅ | F02.04 | Itálico | FORMAT | `FORMAT` `TEXT_FORMAT` | italic | Inclinação. |
| ✅ | F02.05 | Sublinhado | FORMAT | `FORMAT` `TEXT_FORMAT` | underline | Sublinhado. |
| ✅ | F02.06 | Tachado | FORMAT | `FORMAT` `TEXT_FORMAT` | strike | Tachado. |
| ✅ | F02.07 | Cor do texto | FORMAT | `FORMAT` `TEXT_FORMAT` | color | Cor (aceita referência ao tema). |
| ✅ | F02.08 | Realce | FORMAT | `FORMAT` `TEXT_FORMAT` | highlight | Cor de fundo do texto. |
| ✅ | F02.09 | Maiúsculas e minúsculas | FORMAT | `FORMAT` `CHANGE_CASE` | textTransform \| mode: UPPER\|LOWER\|TITLE\|SENTENCE | Transformação visual ou alteração real do texto. |
| ✅ | F02.10 | Sobrescrito e subscrito | FORMAT | `TEXT_FORMAT` | baseline | Posição do trecho na linha. |
| ✅ | F02.11 | Espaçamento entre caracteres | FORMAT | `FORMAT` `TEXT_FORMAT` | letterSpacing | Espaçamento entre letras. |
| | | **Parágrafos e alinhamento** | | | | |
| ✅ | F02.12 | Alinhar à esquerda | FORMAT | `FORMAT` | align: LEFT | Alinhamento horizontal. |
| ✅ | F02.13 | Centralizar | FORMAT | `FORMAT` | align: CENTER | Alinhamento horizontal. |
| ✅ | F02.14 | Alinhar à direita | FORMAT | `FORMAT` | align: RIGHT | Alinhamento horizontal. |
| ✅ | F02.15 | Justificar | FORMAT | `FORMAT` | align: JUSTIFY | Alinhamento horizontal. |
| ✅ | F02.16 | Recuos | FORMAT | `FORMAT` | indentLeft, indentRight, indentFirstLine | Recuo à esquerda, à direita e da primeira linha. |
| ✅ | F02.17 | Espaçamento entre linhas | FORMAT | `FORMAT` | lineHeight | Altura da linha. |
| ✅ | F02.18 | Espaçamento entre parágrafos | FORMAT | `FORMAT` | spaceBefore, spaceAfter | Espaço antes e depois. |
| ✅ | F02.19 | Direção do texto | FORMAT | `FORMAT` | direction | Esquerda→direita, direita→esquerda, vertical. |
| ✅ | F02.20 | Alinhamento vertical | FORMAT | `FORMAT` | verticalAlign | Topo, meio ou base dentro da caixa. |
| | | **Aparência dos elementos** | | | | |
| ✅ | F02.21 | Cor de preenchimento | FORMAT | `FORMAT` | fill | Preenchimento. |
| ✅ | F02.22 | Cor de contorno | FORMAT | `FORMAT` | stroke | Cor da linha de contorno. |
| ✅ | F02.23 | Espessura do contorno | FORMAT | `FORMAT` | strokeWidth | Largura do contorno. |
| ✅ | F02.24 | Transparência | FORMAT | `FORMAT` | opacity | Opacidade de 0 a 1. |
| ✅ | F02.25 | Bordas | FORMAT | `FORMAT` `FORMAT_CELLS` | border: { top, right, bottom, left } | Bordas por lado (cor, espessura, estilo). Lados top/right/bottom/left/all/insideH/insideV validados (Etapa 05). |
| ✅ | F02.26 | Sombras | FORMAT | `FORMAT` | shadow: { x, y, blur, color } | Sombra (deslocamento, desfoque, cor). x, y, blur, spread, color, inset validados (Etapa 05). |
| ✅ | F02.27 | Efeitos visuais | FORMAT | `FORMAT` | effects: { glow, reflection, blur, softEdges, grayscale } | Brilho, reflexo, desfoque, bordas suaves, filtros. Também sépia, brilho, contraste, saturação, matiz e inversão (Etapa 05). |
| ✅ | F02.28 | Estilos predefinidos | FORMAT | `APPLY_STYLE` | styleId | Aplicar um estilo do documento. |
| ✅ | F02.29 | Copiar formatação | FORMAT | `COPY_FORMAT` `PASTE_FORMAT` |  | Pincel de formatação. |
| ✅ | F02.30 | Remover formatação | FORMAT | `CLEAR_FORMAT` |  | Remove ajustes individuais (mantém o estilo). |

## 03. Estrutura e organização

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F03.01 | Criar estruturas | ORGANIZE | `INSERT_STRUCTURE` | structureType | Seções, blocos, superfícies, regiões, listas e quebras. |
| ✅ | F03.02 | Criar seções | ORGANIZE | `INSERT_STRUCTURE` | structureType: SECTION, title | Divide o documento em partes. |
| ✅ | F03.03 | Criar subseções | ORGANIZE | `INSERT_STRUCTURE` | structureType: SECTION, parentId | Seção dentro de seção. |
| ✅ | F03.04 | Organizar níveis hierárquicos | ORGANIZE | `MOVE` `SET_LIST_LEVEL` | newParentId \| level | Move entre níveis da árvore ou da lista. |
| ✅ | F03.05 | Criar listas | ORGANIZE | `INSERT_STRUCTURE` | structureType: LIST, items | Lista com marcadores. |
| ✅ | F03.06 | Criar listas numeradas | ORGANIZE | `INSERT_STRUCTURE` | listType: NUMBERED, numberFormat, start | Numeração automática. |
| ✅ | F03.07 | Criar listas multinível | ORGANIZE | `INSERT_STRUCTURE` `SET_LIST_LEVEL` | listType: MULTILEVEL | Até 9 níveis. |
| ✅ | F03.08 | Alterar níveis de hierarquia | ORGANIZE | `SET_LIST_LEVEL` | level \| delta | Aumentar/diminuir recuo do item. |
| ✅ | F03.09 | Reordenar elementos | ORGANIZE | `REORDER` | newOrder | Muda a ordem estrutural. |
| ✅ | F03.10 | Agrupar elementos | ORGANIZE | `GROUP` | targetIds | Cria um GROUP com os selecionados. |
| ✅ | F03.11 | Desagrupar elementos | ORGANIZE | `UNGROUP` | targetIds | Desfaz o grupo preservando os filhos. |
| ✅ | F03.12 | Ocultar elementos | ORGANIZE | `HIDE` `SHOW` |  | Marca como invisível (o renderizador não desenha). |
| ✅ | F03.13 | Expandir e recolher estruturas | ORGANIZE | `COLLAPSE` `EXPAND` |  | Recolhe seções/listas no painel e na tela. Depende de F18.08. Na tela: título recolhido esconde o conteúdo até o próximo título do mesmo nível (Etapa 15). |

## 04. Inserção de elementos

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F04.01 | Texto | CONTENT | `INSERT_CONTENT` | contentType: TEXT, textType, text\|runs | Parágrafos, títulos, citações, código. |
| ✅ | F04.02 | Imagens | CONTENT | `INSERT_CONTENT` `IMPORT_ASSET` `REPLACE_ASSET` | assetId, alt, crop | Imagem a partir da biblioteca de arquivos, com texto alternativo. |
| ✅ | F04.03 | Formas geométricas | CONTENT | `INSERT_CONTENT` | shapeType, path? | 14 formas e forma personalizada (caminho vetorial). |
| ✅ | F04.04 | Linhas e conectores | CONTENT | `INSERT_CONTENT` | lineType, start, end | Linha reta, cotovelo, curva ou conector entre objetos. |
| ✅ | F04.05 | Tabelas | TABLE | `INSERT_CONTENT` | rows, columns \| values | Tabela vazia ou com valores (aceita fórmulas). |
| ✅ | F04.06 | Gráficos | CHART | `INSERT_CONTENT` `CREATE_CHART` | chartType, source | Gráfico ligado a uma fonte de dados. |
| ✅ | F04.07 | Diagramas | DIAGRAM | `INSERT_CONTENT` | diagramType, items, connections \| outline | Fluxograma, organograma, processo, mapa mental, ciclo, Venn. Layout automático ao inserir (Etapa 06). |
| ✅ | F04.08 | Hiperlinks | CONTENT | `INSERT_CONTENT` | url \| targetId, text | Link externo ou para um elemento do documento. |
| ✅ | F04.09 | Símbolos | CONTENT | `INSERT_CONTENT` | char | Caractere especial. |
| ✅ | F04.10 | Equações | CONTENT | `INSERT_CONTENT` | latex, display | Equação em LaTeX. Desenhada com KaTeX no documento e nos slides (Etapa 15). |
| ✅ | F04.11 | Áudio | CONTENT | `INSERT_CONTENT` | assetId \| url, autoplay, loop | Arquivo ou endereço de áudio. |
| ✅ | F04.12 | Vídeo | CONTENT | `INSERT_CONTENT` | assetId \| url, poster, captions | Arquivo ou endereço de vídeo. |
| ✅ | F04.13 | Caixas de texto | CONTENT | `INSERT_CONTENT` |  | Texto com posicionamento livre (TEXT em layout ABSOLUTE). |
| ✅ | F04.14 | Cabeçalhos e rodapés | PAGE | `INSERT_STRUCTURE` `SET_HEADER_FOOTER` `PAGINATE` | regionType: HEADER\|FOOTER, applyTo | Regiões repetidas nas páginas: todas, primeira diferente, pares e ímpares. Depende de F09.01. |
| ✅ | F04.15 | Numeração automática | REFERENCE | `INSERT_CONTENT` `UPDATE_FIELDS` `FIELD_TEXT` | contentType: FIELD, fieldType | Número de página, total de páginas, slide, figura, tabela e notas. Depende de F15.11. |
| ✅ | F04.16 | Data e hora | REFERENCE | `INSERT_CONTENT` `UPDATE_FIELDS` | fieldType: DATE\|TIME\|DATETIME, format | Campo de data/hora atualizável, formato livre (ex.: 13 de novembro de 2026). Depende de F15.10. |

## 05. Manipulação de objetos

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F05.01 | Mover | OBJECTS | `MOVE` | x,y \| dx,dy | Desloca (grupos levam os filhos). |
| ✅ | F05.02 | Redimensionar | OBJECTS | `RESIZE` | width, height, from | Altera largura/altura (grupo escala os filhos). |
| ✅ | F05.03 | Girar | OBJECTS | `TRANSFORM` | rotation | Rotação em graus. |
| ✅ | F05.04 | Inverter | OBJECTS | `TRANSFORM` | flipH, flipV | Espelhar na horizontal/vertical. |
| ✅ | F05.05 | Alinhar | OBJECTS | `ALIGN` | alignment, relativeTo | Entre objetos ou em relação ao slide. |
| ✅ | F05.06 | Distribuir | OBJECTS | `DISTRIBUTE` | axis | Espaços iguais entre 3+ objetos. |
| ✅ | F05.07 | Posicionar por coordenadas | OBJECTS | `SET_POSITION` | x, y, snap? | Posição exata. |
| ✅ | F05.08 | Organizar camadas | OBJECTS | `BRING_FORWARD` `SEND_BACKWARD` `BRING_TO_FRONT` `SEND_TO_BACK` |  | Ordem visual entre irmãos. |
| ✅ | F05.09 | Trazer para frente | OBJECTS | `BRING_FORWARD` `BRING_TO_FRONT` |  | Avança uma camada ou vai para a frente de todos. |
| ✅ | F05.10 | Enviar para trás | OBJECTS | `SEND_BACKWARD` `SEND_TO_BACK` |  | Recua uma camada ou vai para trás de todos. |
| ✅ | F05.11 | Bloquear | OBJECTS | `LOCK` |  | Impede alterações (vale para os filhos do grupo). |
| ✅ | F05.12 | Desbloquear | OBJECTS | `UNLOCK` |  | Libera alterações. |
| ✅ | F05.13 | Agrupar | ORGANIZE | `GROUP` |  | Mesmo que F03.10 (uma funcionalidade, um lugar). Depende de F03.10. |
| ✅ | F05.14 | Desagrupar | ORGANIZE | `UNGROUP` |  | Mesmo que F03.11. Depende de F03.11. |
| ✅ | F05.15 | Ajustar ao grid | OBJECTS | `SET_GRID` `SNAP` `SET_POSITION` | grid.size, snap | Encaixa na grade. |
| ✅ | F05.16 | Ajustar a outros objetos | OBJECTS | `SNAP` `SET_POSITION` | threshold | Encaixa em bordas e centros dos vizinhos e guias. |
| ✅ | F05.17 | Redimensionar proporcionalmente | OBJECTS | `RESIZE` `SET_CONSTRAINT` | keepRatio \| lockAspectRatio | Mantém a proporção e respeita limites. |

## 06. Tabelas e dados

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F06.01 | Criar tabelas | TABLE | `INSERT_CONTENT` | rows, columns, values | Tabela de documento/slide ou planilha. |
| ✅ | F06.02 | Editar tabelas | TABLE | `SET_CELL` `SET_CELLS` `CLEAR_CELL` | cell, value | Valores, fórmulas e limpeza. |
| ✅ | F06.03 | Inserir e excluir linhas | TABLE | `INSERT_ROW` `DELETE_ROW` | index, count | Ajusta fórmulas e gráficos. |
| ✅ | F06.04 | Inserir e excluir colunas | TABLE | `INSERT_COLUMN` `DELETE_COLUMN` | index, count | Ajusta fórmulas e gráficos. |
| ✅ | F06.05 | Mesclar células | TABLE | `MERGE_CELLS` | range | Retângulo de células vira uma. |
| ✅ | F06.06 | Dividir células | TABLE | `SPLIT_CELLS` | cell | Desfaz a mesclagem. |
| ✅ | F06.07 | Redimensionar células | TABLE | `RESIZE_ROW` `RESIZE_COLUMN` | index, height\|width | Altura de linha e largura de coluna. |
| ✅ | F06.08 | Distribuir linhas e colunas | TABLE | `DISTRIBUTE_ROWS` `DISTRIBUTE_COLUMNS` |  | Tamanhos iguais. |
| ✅ | F06.09 | Formatar células | TABLE | `FORMAT_CELLS` | range, properties | Fonte, cores, alinhamento por célula. |
| ✅ | F06.10 | Aplicar bordas | TABLE | `FORMAT_CELLS` | border | Bordas por célula e por lado. Depende de F02.25. Etapa 05. |
| ✅ | F06.11 | Aplicar preenchimentos | TABLE | `FORMAT_CELLS` | fill | Cor de fundo das células. |
| ✅ | F06.12 | Ordenar dados | TABLE | `SORT` | column, direction, header, range | Crescente/decrescente, com cabeçalho, vazios no fim. |
| ✅ | F06.13 | Filtrar dados | TABLE | `FILTER` `CLEAR_FILTER` `FILTERED_ROWS` | column, rule \| conditions[], join: AND\|OR | Mostra só as linhas que atendem aos critérios. Vários critérios combinados na Etapa 05. |
| ✅ | F06.14 | Validar entradas | TABLE | `SET_VALIDATION` | range, rule | Números, datas, tamanho do texto. |
| ✅ | F06.15 | Criar listas suspensas | TABLE | `SET_VALIDATION` | rule: { type: 'LIST', values } | Regra LIST. |
| ✅ | F06.16 | Converter texto em tabela | TABLE | `TEXT_TO_TABLE` | separator | Parágrafos → linhas. |
| ✅ | F06.17 | Converter tabela em texto | TABLE | `TABLE_TO_TEXT` | separator | Linhas → parágrafos. |

## 07. Cálculos e fórmulas

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F07.01 | Criar fórmulas | FORMULA | `SET_FORMULA` `SET_CELL` | cell, formula | Texto começando com "=" vira fórmula validada. |
| ✅ | F07.02 | Editar fórmulas | FORMULA | `SET_FORMULA` `SET_CELL` |  | Substitui e recalcula. |
| ✅ | F07.03 | Executar operações matemáticas | FORMULA | `SET_FORMULA` |  | + - * / ^ %, SOMA, PRODUTO, ARRED, RAIZ, MOD… |
| ✅ | F07.04 | Executar operações lógicas | FORMULA | `SET_FORMULA` |  | Comparações, SE, E, OU, NÃO, SEERRO. |
| ✅ | F07.05 | Executar cálculos estatísticos | FORMULA | `SET_FORMULA` |  | MÉDIA, MED, MÍNIMO, MÁXIMO, CONT.*, DESVPAD. |
| ✅ | F07.06 | Executar cálculos financeiros | FORMULA | `SET_FORMULA` |  | VP, VF, PGTO, NPER, TAXA. |
| ✅ | F07.07 | Trabalhar com datas e horários | FORMULA | `SET_FORMULA` |  | HOJE, AGORA, DATA, DIA, MÊS, ANO, DIAS. |
| ✅ | F07.08 | Trabalhar com textos | FORMULA | `SET_FORMULA` |  | CONCATENAR, ESQUERDA, EXT.TEXTO, SUBSTITUIR, TEXTO… |
| ✅ | F07.09 | Utilizar funções predefinidas | FORMULA | `SET_FORMULA` |  | 59 funções, nomes em português e inglês. |
| ✅ | F07.10 | Criar funções personalizadas | FORMULA | `DEFINE_FUNCTION` `DELETE_FUNCTION` `LIST_FUNCTIONS` | name, params, body | Função do usuário escrita como fórmula com parâmetros (ex.: IMPOSTO(x) = x*0.15). Fica no documento; redefinir recalcula; desfazer volta; recursão infinita vira #NUM! (Etapa 12). |
| ✅ | F07.11 | Utilizar referências entre células | FORMULA | `SET_FORMULA` |  | A1, $A$1, intervalos. |
| ✅ | F07.12 | Utilizar referências entre planilhas | FORMULA | `SET_FORMULA` |  | Planilha2!A1, 'Nome com espaço'!B2. |
| ✅ | F07.13 | Criar intervalos nomeados | FORMULA | `DEFINE_NAME` `DELETE_NAME` | name, range | Nomes para intervalos. |
| ✅ | F07.14 | Calcular automaticamente | FORMULA | `SET_CELL` |  | Recalcula só o que depende do que mudou, em ordem. |
| ✅ | F07.15 | Recalcular manualmente | FORMULA | `RECALCULATE` |  | Recalcula tudo. |
| ✅ | F07.16 | Identificar erros de cálculo | FORMULA | `FORMULA_ERRORS` |  | #DIV/0!, #VALUE!, #REF!, #NAME?, #N/A, #NUM!, #CYCLE!. |

## 08. Visualização de dados

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F08.01 | Criar gráficos | CHART | `CREATE_CHART` | chartType, source | 10 tipos ligados a planilha, tabela ou dados digitados. |
| ✅ | F08.02 | Editar gráficos | CHART | `SET_CHART_OPTION` `UPDATE_SERIES` |  | Opções e séries. |
| ✅ | F08.03 | Alterar fontes de dados | CHART | `SET_DATA_SOURCE` `UPDATE_DATA_SOURCE` |  | Outro intervalo, planilha ou tabela. |
| ✅ | F08.04 | Alterar tipos de gráficos | CHART | `SET_CHART_TYPE` |  | Barras, colunas, linhas, área, pizza, rosca, dispersão, bolhas, radar, combinado. |
| ✅ | F08.05 | Personalizar cores | CHART | `UPDATE_SERIES` `FORMAT` | color \| fill, stroke | Cor por série e aparência do gráfico. |
| ✅ | F08.06 | Editar títulos | CHART | `SET_CHART_OPTION` |  | option: title. |
| ✅ | F08.07 | Editar legendas | CHART | `SET_CHART_OPTION` |  | option: legend. |
| ✅ | F08.08 | Editar eixos | CHART | `SET_CHART_OPTION` |  | option: axes (só tipos com eixos). |
| ✅ | F08.09 | Inserir rótulos | CHART | `SET_CHART_OPTION` |  | option: labels. |
| ✅ | F08.10 | Criar diagramas | DIAGRAM | `DIAGRAM_ADD_ITEM` `DIAGRAM_CONNECT` `DIAGRAM_LAYOUT` | algorithm: TREE\|LAYERED\|RADIAL\|LINEAR\|CYCLE\|VENN, direction | Itens, conexões e layout automático. Depende de F04.07. Também promover/rebaixar, mover, tópicos ↔ diagrama, troca de tipo, modo manual (Etapa 06). |
| ✅ | F08.11 | Criar fluxogramas | DIAGRAM | `DIAGRAM_ADD_ITEM` `DIAGRAM_CONNECT` `DIAGRAM_LAYOUT` | diagramType: FLOWCHART, kind, connectFrom, connectionLabel | Processo, decisão, início/fim, em camadas. Depende de F08.10. Camadas pelo caminho mais longo, retornos não quebram (Etapa 06). |
| ✅ | F08.12 | Criar organogramas | DIAGRAM | `DIAGRAM_FROM_TEXT` `DIAGRAM_PROMOTE` `DIAGRAM_DEMOTE` `DIAGRAM_LAYOUT` | diagramType: ORGCHART, parentId | Árvore hierárquica. Depende de F08.10. Pai centrado sobre os filhos (Etapa 06). |
| ✅ | F08.13 | Criar visualizações comparativas | CHART | `CREATE_CHART` | series[].axis, chartType: COMBO | Várias séries, eixo secundário e gráfico combinado. |
| ✅ | F08.14 | Aplicar formatação condicional | TABLE | `ADD_CONDITIONAL_FORMAT` `CONDITIONAL_STYLES` | range, rule, style | Formatação conforme o valor (maior que, entre, texto, duplicados). Também maiores/menores, média, erros, vazios, por fórmula; prioridade e parar se verdadeiro (Etapa 05). |
| ✅ | F08.15 | Criar regras visuais | TABLE | `ADD_CONDITIONAL_FORMAT` | rule: COLOR_SCALE\|DATA_BAR\|ICON_SET | Escalas de cor, barras de dados e ícones. Depende de F08.14. Etapa 05. |

## 09. Layout e composição

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| | | **Organização de páginas e telas** | | | | |
| ✅ | F09.01 | Definir dimensões | PAGE | `SET_PAGE` `SET_SLIDE_SIZE` | size \| width, height \| preset | Tamanho da página (A3, A4, A5, Carta, Ofício, personalizado) ou do slide (16:9, 4:3…, conteúdo acompanha). |
| ✅ | F09.02 | Definir orientação | PAGE | `SET_PAGE` | orientation | Retrato ou paisagem (por documento ou por seção). |
| ✅ | F09.03 | Configurar margens | PAGE | `SET_PAGE` | margins | Margens livres ou prontas (Normal, Estreita, Larga, ABNT). |
| ✅ | F09.04 | Definir espaçamentos | PAGE | `UPDATE_LAYOUT` `FORMAT` | gap, padding, spaceBefore/After | Espaço entre elementos e parágrafos. |
| ✅ | F09.05 | Criar colunas | PAGE | `SET_COLUMNS` `PAGINATE` | count, gap | Texto em colunas no documento ou numa seção; quebra de coluna manual. |
| ✅ | F09.06 | Configurar planos de fundo | PAGE | `SET_BACKGROUND` | color \| assetId \| gradient, fit | Cor, imagem ou gradiente do documento, da seção ou do slide. |
| ✅ | F09.07 | Definir áreas de conteúdo | PAGE | `PAGINATE` `PAGE_SETUP` |  | Área útil = página menos margens, cabeçalho e rodapé; paginação calculada (medição plugável). Depende de F09.03. |
| ✅ | F09.08 | Criar quebras de página | PAGE | `INSERT_STRUCTURE` `PAGINATE` | breakType: PAGE\|COLUMN | Quebra manual + quebras automáticas (parágrafos divididos por linha, sem linhas sozinhas). |
| ✅ | F09.09 | Criar quebras de seção | PAGE | `INSERT_STRUCTURE` | breakType: SECTION | Nova seção (pode mudar página/colunas). |
| ✅ | F09.10 | Configurar impressão | PAGE | `SET_PRINT` | range, copies, scale, fitToPage, gridlines, headings, repeatRows | Intervalo, cópias, escala, ajustar à página, linhas de grade e cabeçalhos de planilha. |
| | | **Organização visual** | | | | |
| ✅ | F09.11 | Utilizar grade | OBJECTS | `SET_GRID` | enabled, size, snap | Grade de alinhamento. |
| ✅ | F09.12 | Utilizar régua | VIEW | `SET_VIEW` `RULER` | showRuler, rulerUnit | Régua com unidade (cm, pol, px). Escala acompanha o zoom; margens e recuos do parágrafo (Etapa 13). |
| ✅ | F09.13 | Utilizar guias | OBJECTS | `ADD_GUIDE` `MOVE_GUIDE` `REMOVE_GUIDE` |  | Guias horizontais e verticais. |
| ✅ | F09.14 | Definir alinhamentos | OBJECTS | `ALIGN` `UPDATE_LAYOUT` |  | Alinhamento de objetos e do contêiner. |
| ✅ | F09.15 | Configurar espaçamento entre elementos | OBJECTS | `DISTRIBUTE` `UPDATE_LAYOUT` |  | Distribuir ou definir gap. |
| ✅ | F09.16 | Definir posicionamento de objetos | OBJECTS | `SET_LAYOUT` `SET_POSITION` |  | Fluxo ou posição livre. |

## 10. Temas e estilos

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F10.01 | Criar temas | FORMAT | `CREATE_THEME` |  | Cores, fontes e padrões por tipo. |
| ✅ | F10.02 | Aplicar temas | FORMAT | `APPLY_THEME` |  | Troca o tema ativo. |
| ✅ | F10.03 | Personalizar cores | FORMAT | `UPDATE_THEME` | colors | Paleta do tema. |
| ✅ | F10.04 | Personalizar fontes | FORMAT | `UPDATE_THEME` | fonts | Fontes de títulos e texto. |
| ✅ | F10.05 | Criar estilos | FORMAT | `CREATE_STYLE` |  | Conjunto reutilizável de propriedades. |
| ✅ | F10.06 | Aplicar estilos | FORMAT | `APPLY_STYLE` |  | Vincula estilo aos elementos. |
| ✅ | F10.07 | Editar estilos | FORMAT | `UPDATE_STYLE` `DELETE_STYLE` |  | Muda todos os vinculados. |
| ✅ | F10.08 | Criar modelos | FORMAT | `CREATE_TEMPLATE` | name | Modelo a partir do documento atual (estrutura, tema, estilos). keepContent: false guarda só a identidade (Etapa 05). |
| ✅ | F10.09 | Salvar modelos | FORMAT | `CREATE_TEMPLATE` `LIST_TEMPLATES` |  | Biblioteca de modelos. Depende de F10.08. Biblioteca em memória; banco na Etapa 14. |
| ✅ | F10.10 | Reutilizar layouts | FORMAT | `APPLY_TEMPLATE` `SAVE_LAYOUT` `APPLY_LAYOUT` | templateId \| layoutId | Novo slide/página a partir de um layout salvo. Depende de F10.08. Também SAVE_LAYOUT, LIST_LAYOUTS, DELETE_LAYOUT (Etapa 05). |
| ✅ | F10.11 | Definir padrões visuais | FORMAT | `UPDATE_THEME` | defaults | Padrões por tipo no tema. |
| ✅ | F10.12 | Aplicar alterações globalmente | FORMAT | `UPDATE_THEME` `UPDATE_STYLE` |  | Mudar tema/estilo muda todos os vinculados. |

## 11. Animações e transições

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F11.01 | Criar animações | ANIMATION | `ADD_ANIMATION` `REMOVE_ANIMATION` `CLEAR_ANIMATIONS` `COPY_ANIMATION` | targetId, kind, effect | Animação num elemento do slide. Etapa 07. |
| ✅ | F11.02 | Configurar entrada | ANIMATION | `ADD_ANIMATION` | kind: ENTRANCE | Aparecer, esmaecer, voar, zoom… Etapa 07. |
| ✅ | F11.03 | Configurar ênfase | ANIMATION | `ADD_ANIMATION` | kind: EMPHASIS | Pulsar, girar, mudar cor… Etapa 07. |
| ✅ | F11.04 | Configurar saída | ANIMATION | `ADD_ANIMATION` | kind: EXIT | Desaparecer, esmaecer, voar… Etapa 07. |
| ✅ | F11.05 | Criar trajetórias de movimento | ANIMATION | `ADD_ANIMATION` | kind: MOTION_PATH, path | Caminho (linha, arco, livre). Etapa 07. |
| ✅ | F11.06 | Definir duração | ANIMATION | `UPDATE_ANIMATION` | duration | Em milissegundos. Etapa 07. |
| ✅ | F11.07 | Definir atraso | ANIMATION | `UPDATE_ANIMATION` | delay | Espera antes de começar. Etapa 07. |
| ✅ | F11.08 | Organizar sequência | ANIMATION | `REORDER_ANIMATION` `LIST_ANIMATIONS` | animationId, newIndex | Ordem das animações do slide. Etapa 07. |
| ✅ | F11.09 | Configurar gatilhos | ANIMATION | `UPDATE_ANIMATION` | trigger | Ao clicar, com a anterior, após a anterior, ao clicar num objeto. Etapa 07. |
| ✅ | F11.10 | Criar transições | ANIMATION | `SET_TRANSITION` | effect | Transição de entrada do slide. Etapa 07. |
| ✅ | F11.11 | Configurar velocidade de transição | ANIMATION | `SET_TRANSITION` | duration | Duração da transição. Etapa 07. |
| ✅ | F11.12 | Visualizar animações | ANIMATION | `ANIMATION_TIMELINE` | surfaceId | Linha do tempo calculada (início/fim de cada efeito). Etapa 07. |
| ✅ | F11.13 | Reproduzir animações | ANIMATION | `ANIMATION_STEPS` `ANIMATION_STATE` | surfaceId | Passos de reprodução (cada clique). Etapa 07. |

## 12. Revisão e validação

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F12.01 | Verificar ortografia | REVIEW | `CHECK_SPELLING` `ADD_TO_DICTIONARY` | scope, language | Palavras fora do dicionário pt-BR, com sugestões. Erros comuns embutidos; dicionário completo por provedor (services.spellcheck); dicionário do documento (Etapa 08). |
| ✅ | F12.02 | Verificar gramática | REVIEW | `CHECK_GRAMMAR` | scope | Regras: espaços, pontuação, repetições, concordância comum. Etapa 08. |
| ✅ | F12.03 | Corrigir erros | REVIEW | `APPLY_SUGGESTION` `APPLY_ALL_SUGGESTIONS` `IGNORE_ISSUE` | issueId, suggestion \| index | Aplica a sugestão escolhida. Também corrigir todos de uma regra e ignorar (Etapa 08). |
| ✅ | F12.04 | Sugerir melhorias | REVIEW | `CHECK_STYLE` | scope | Frases longas, voz passiva, palavras repetidas. Etapa 08. |
| ✅ | F12.05 | Traduzir conteúdo | REVIEW | `TRANSLATION_SEGMENTS` `APPLY_TRANSLATION` | targetIds, to | Tradução por provedor configurável. translateContent(): provedor assíncrono (services.translate), aplicado numa transação, mantendo a formatação (Etapa 08). |
| ✅ | F12.06 | Localizar problemas | REVIEW | `REVIEW_DOCUMENT` |  | Relatório único: ortografia, gramática, fórmulas, acessibilidade, consistência. Depende de F12.01, F12.02, F12.08, F12.13. Etapa 08. |
| ✅ | F12.07 | Verificar consistência | REVIEW | `CHECK_CONSISTENCY` |  | Fontes e estilos misturados, termos escritos de formas diferentes, referências quebradas. Etapa 08. |
| ✅ | F12.08 | Identificar erros em fórmulas | FORMULA | `FORMULA_ERRORS` |  | Lista células com erro. |
| ✅ | F12.09 | Validar dados | TABLE | `SET_VALIDATION` |  | Regras de entrada. |
| ✅ | F12.10 | Contar palavras | TEXT | `TEXT_STATS` |  | Palavras do documento ou trecho. |
| ✅ | F12.11 | Contar caracteres | TEXT | `TEXT_STATS` |  | Com e sem espaços. |
| ✅ | F12.12 | Gerar estatísticas | TEXT | `TEXT_STATS` `DOCUMENT_STATS` |  | Parágrafos, páginas, slides, tempo de leitura, elementos por tipo. Também frases, legibilidade (Flesch PT) e tempo de fala (Etapa 08). |
| ✅ | F12.13 | Verificar acessibilidade | REVIEW | `CHECK_ACCESSIBILITY` |  | Texto alternativo, contraste, ordem de títulos, tabelas com cabeçalho, links descritivos. Etapa 08. |

## 13. Comentários e colaboração

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F13.01 | Inserir comentários | COLLAB | `ADD_COMMENT` | targetId, range?, text | Comentário ancorado num elemento, trecho ou célula. Etapa 09. |
| ✅ | F13.02 | Responder comentários | COLLAB | `REPLY_COMMENT` | commentId, text | Resposta no mesmo fio. Depende de F13.01. Etapa 09. |
| ✅ | F13.03 | Editar comentários | COLLAB | `EDIT_COMMENT` | commentId, text | Só o autor. Depende de F13.01. Etapa 09. |
| ✅ | F13.04 | Excluir comentários | COLLAB | `DELETE_COMMENT` | commentId | Autor ou dono. Depende de F13.01. Etapa 09. |
| ✅ | F13.05 | Resolver comentários | COLLAB | `RESOLVE_COMMENT` `REOPEN_COMMENT` | commentId | Fecha/reabre o fio. Depende de F13.01. Etapa 09. |
| ✅ | F13.06 | Mencionar usuários | COLLAB | `ADD_COMMENT` | mentions | @nome no comentário notifica a pessoa. Depende de F13.01. Etapa 09. |
| ✅ | F13.07 | Compartilhar arquivos | COLLAB | `SHARE` `UNSHARE` `SET_LINK_ACCESS` `LIST_MEMBERS` | userId\|email, role | Convida pessoas com um papel. Depende de F13.08. Envio de convite por e-mail na Etapa 14. |
| ✅ | F13.08 | Definir permissões | COLLAB | `SET_PERMISSION` | userId, role | Papéis: dono, editor, comentador, leitor; o motor bloqueia o que o papel não permite. Etapa 09. |
| ✅ | F13.09 | Editar simultaneamente | COLLAB | `APPLY_REMOTE` | transactions[] | Recebe operações de outros editores e aplica sem conflito. Mesclagem em três vias por campo e por lista de filhos; SyncSession; desfazer preserva o trabalho dos outros. Servidor (ordem/transmissão) na Etapa 14. |
| ✅ | F13.10 | Visualizar alterações de colaboradores | COLLAB | `SET_PRESENCE` `LIST_PRESENCE` | userId, selection | Quem está no documento e o que selecionou. Etapa 09. |
| ✅ | F13.11 | Controlar alterações | COLLAB | `SET_TRACK_CHANGES` `LIST_CHANGES` `ACCEPT_CHANGE` `REJECT_CHANGE` | changeId | Modo revisão: cada alteração tem autor e pode ser aceita ou rejeitada. Etapa 09. |

## 14. Histórico e recuperação

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F14.01 | Registrar alterações | HISTORY | `LIST_HISTORY` |  | Toda transação com antes/depois. |
| ✅ | F14.02 | Desfazer operações | HISTORY | `UNDO` |  | Mesmo que F01.10. Depende de F01.10. |
| ✅ | F14.03 | Refazer operações | HISTORY | `REDO` |  | Mesmo que F01.11. Depende de F01.11. |
| ✅ | F14.04 | Criar versões | HISTORY | `CREATE_VERSION` | label | Fotografia completa do documento. Também gravada no banco (editor_versions) quando o documento está no armazenamento (Etapa 14). |
| ✅ | F14.05 | Consultar histórico | HISTORY | `LIST_HISTORY` `LIST_VERSIONS` |  | Transações e versões. |
| ✅ | F14.06 | Comparar versões | HISTORY | `COMPARE_VERSIONS` | fromId, toId | Elementos criados, alterados e excluídos; diferença de texto. Depende de F14.04. Diferença por palavra, por célula, movidos, estilos e temas (Etapa 10). |
| ✅ | F14.07 | Restaurar versões anteriores | HISTORY | `RESTORE_VERSION` | versionId | Vira uma transação (dá para desfazer). |
| ✅ | F14.08 | Recuperar arquivos | HISTORY | `EXPORT_STATE` `RECOVER` `CHECK_INTEGRITY` `REPAIR_DOCUMENT` | state \| base, entries | Reconstrói o documento a partir da última versão + operações. Depende de F14.04. Diário (Journal) + rebuild; integridade da árvore verificada e consertada (Etapa 10). |
| ✅ | F14.09 | Salvar automaticamente | STORAGE | `AUTOSAVE` | enabled, interval, flush | Grava a cada alteração (com intervalo). AutoSaver: espera parar de digitar (com tempo máximo), concorrência otimista com mesclagem, sem rede tenta de novo; API /api/editor/documents no Neon (Etapa 14). |

## 15. Referências e elementos automáticos

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F15.01 | Criar hiperlinks | REFERENCE | `INSERT_CONTENT` |  | Mesmo que F04.08. Depende de F04.08. |
| ✅ | F15.02 | Criar indicadores | REFERENCE | `ADD_BOOKMARK` `REMOVE_BOOKMARK` `LIST_BOOKMARKS` | targetId, name | Marca um ponto do documento com um nome único (destino de links e referências). |
| ✅ | F15.03 | Criar referências cruzadas | REFERENCE | `INSERT_CONTENT` `UPDATE_FIELDS` | fieldType: CROSS_REFERENCE, targetId \| bookmark, show | "Veja a Figura 3, página 7" sempre atualizado (texto, número, rótulo, página, acima/abaixo). Depende de F15.02. |
| ✅ | F15.04 | Inserir notas | REFERENCE | `INSERT_CONTENT` `UPDATE_FIELDS` | noteType | Notas de rodapé (1, 2, 3) e de fim (i, ii, iii) numeradas. |
| ✅ | F15.05 | Inserir legendas | REFERENCE | `INSERT_CONTENT` `UPDATE_FIELDS` | label, targetId | "Figura 1 — …" numerada por rótulo, renumera ao mudar a ordem. |
| ✅ | F15.06 | Criar sumários automáticos | REFERENCE | `BUILD_TOC` `UPDATE_FIELDS` | levels | Títulos e páginas, atualizável (duas passadas de paginação). Depende de F09.07. |
| ✅ | F15.07 | Criar índices | REFERENCE | `MARK_INDEX_ENTRY` `UNMARK_INDEX_ENTRY` `BUILD_INDEX` | term, subterm | Índice remissivo de termos (e subtermos) marcados, em ordem alfabética com páginas. |
| ✅ | F15.08 | Gerenciar citações | REFERENCE | `INSERT_CONTENT` `FORMAT_CITATION` `SET_CITATION_STYLE` | sourceId \| source, page, style | Citação no texto formatada (ABNT, APA, MLA, Chicago); trocar a norma reformata tudo. |
| ✅ | F15.09 | Gerenciar bibliografia | REFERENCE | `ADD_SOURCE` `UPDATE_SOURCE` `REMOVE_SOURCE` `LIST_SOURCES` `BUILD_BIBLIOGRAPHY` | source, style, onlyCited | Fontes do documento e lista de referências em ordem alfabética. Depende de F15.08. |
| ✅ | F15.10 | Atualizar campos automáticos | REFERENCE | `UPDATE_FIELDS` `FIELD_TEXT` |  | Recalcula todos os campos, numerações, sumário, índice e bibliografia (campos de cabeçalho/rodapé são calculados por página). |
| ✅ | F15.11 | Inserir numeração automática | REFERENCE | `INSERT_CONTENT` `UPDATE_FIELDS` |  | Listas, páginas, slides, figuras, tabelas e notas. Depende de F04.15. |

## 16. Importação e exportação

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F16.01 | Importar arquivos | IO | `IMPORT` | format, content \| model | JSON, texto, Markdown, HTML, CSV, XLSX, DOCX, PPTX. XLSX/DOCX/PPTX por importFile()/openFile() (leitura assíncrona do ZIP). Testado também com arquivos do LibreOffice (Etapa 11). |
| ✅ | F16.02 | Exportar arquivos | IO | `EXPORT` | format, targetId?, options? | Exporta no formato escolhido. TXT, MD, HTML, CSV, JSON, XLSX, DOCX, PPTX, PDF, SVG (Etapa 11). |
| ✅ | F16.03 | Converter formatos | IO | `IMPORT` `EXPORT` |  | Importar de um formato e exportar em outro. Depende de F16.01, F16.02. Etapa 11. |
| ✅ | F16.04 | Exportar PDF | IO | `EXPORT` | format: PDF | Páginas/slides em PDF. Depende de F09.07. PDF próprio: Helvetica/WinAnsi (acentos), tabelas, listas, quebras, slides, JPEG embutido, número da página (Etapa 11). |
| ✅ | F16.05 | Exportar imagens | IO | `EXPORT` | format: SVG\|PNG | Slides e gráficos em SVG/PNG. SVG no motor; PNG em 2× pelo canvas na interface (Etapa 15). |
| ✅ | F16.06 | Exportar texto | IO | `EXPORT` | format: TXT\|MD\|HTML | Texto puro, Markdown e HTML. Etapa 11. |
| ✅ | F16.07 | Exportar dados estruturados | IO | `EXPORT` | format: JSON\|CSV | JSON do documento e CSV de tabelas/planilhas. Etapa 11. |
| ✅ | F16.08 | Exportar planilhas | IO | `EXPORT` | format: XLSX | XLSX com valores e fórmulas. Fórmulas convertidas para nomes em inglês e separador "," (Etapa 11). |
| ✅ | F16.09 | Exportar apresentações | IO | `EXPORT` | format: PPTX | PPTX. Textos, formas, linhas, tabelas, imagens e fundo; anotações do orador ainda não (Etapa 11). |
| ✅ | F16.10 | Imprimir | IO | `PRINT_LAYOUT` `SET_PRINT` |  | Gera o layout de impressão (páginas prontas). Depende de F09.10. Etapa 11. |
| ✅ | F16.11 | Visualizar impressão | IO | `PRINT_LAYOUT` |  | Prévia com as páginas paginadas. Depende de F16.10. Etapa 11. |
| ✅ | F16.12 | Converter arquivos em lote | IO | `CONVERT_BATCH` | files, to | Vários arquivos de uma vez. Depende de F16.03. convertFiles() aceita todos os formatos (Etapa 11). |

## 17. Automação e extensibilidade

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F17.01 | Criar macros | AUTOMATION | `START_RECORDING` `STOP_RECORDING` `RUN_MACRO` `LIST_MACROS` `DELETE_MACRO` | name | Grava operações e reproduz. Etapa 12. |
| ✅ | F17.02 | Executar scripts | AUTOMATION | `RUN_SCRIPT` | steps | Sequência de operações com variáveis e repetição (sem executar código livre). Etapa 12. |
| ✅ | F17.03 | Criar automações | AUTOMATION | `ADD_AUTOMATION` `UPDATE_AUTOMATION` `REMOVE_AUTOMATION` `LIST_AUTOMATIONS` | event, condition, actions | Quando <evento> e <condição>, faça <ações>. Depende de F17.02. Etapa 12. |
| ✅ | F17.04 | Criar atalhos personalizados | AUTOMATION | `SET_SHORTCUT` `RESOLVE_SHORTCUT` `LIST_SHORTCUTS` `RESET_SHORTCUTS` | keys, operation | Tecla → operação. Etapa 12. |
| ✅ | F17.05 | Utilizar funções personalizadas | FORMULA | `DEFINE_FUNCTION` |  | Mesmo que F07.10. Depende de F07.10. Etapa 12. |
| ✅ | F17.06 | Instalar extensões | AUTOMATION | `INSTALL_EXTENSION` | manifest | Extensão adiciona operações, funções e atalhos. Etapa 12. |
| ✅ | F17.07 | Gerenciar extensões | AUTOMATION | `LIST_EXTENSIONS` `ENABLE_EXTENSION` `DISABLE_EXTENSION` `UNINSTALL_EXTENSION` |  | Ativar, desativar, remover. Depende de F17.06. Etapa 12. |
| ✅ | F17.08 | Integrar serviços externos | AUTOMATION | `ADD_WEBHOOK` `REMOVE_WEBHOOK` `CALL_SERVICE` | url, events | Avisar/consultar serviços por HTTP. Etapa 12. |
| ✅ | F17.09 | Criar ações automatizadas | AUTOMATION | `ADD_AUTOMATION` |  | Mesmo mecanismo das automações. Depende de F17.03. Etapa 12. |

## 18. Visualização e navegação

| | ID | Funcionalidade | Motor | Operações | Parâmetros | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| ✅ | F18.01 | Modo de edição | VIEW | `SET_VIEW` | mode: EDIT | Edição normal. Etapa 13. |
| ✅ | F18.02 | Modo de leitura | VIEW | `SET_VIEW` | mode: READ | Só leitura (bloqueia operações que alteram). Bloqueio pelo efeito (como as permissões); comentários continuam (Etapa 13). |
| ✅ | F18.03 | Modo de apresentação | VIEW | `SET_VIEW` `PRESENT_START` `PRESENT_NEXT` `PRESENT_PREV` `PRESENT_GOTO` `PRESENT_END` | mode: PRESENT | Slides em sequência com animações. Depende de F11.13. Etapa 13. |
| ✅ | F18.04 | Zoom | VIEW | `SET_VIEW` | zoom \| fit | 10% a 500%, ajustar à largura/página. Etapa 13. |
| ✅ | F18.05 | Navegação por páginas | VIEW | `GO_TO` | page | Ir para a página N. Depende de F09.07. Etapa 13. |
| ✅ | F18.06 | Navegação por seções | VIEW | `GO_TO` | targetId | Ir para seção/título. Etapa 13. |
| ✅ | F18.07 | Navegação por planilhas | VIEW | `GO_TO` `SET_ACTIVE_SURFACE` | surfaceId | Trocar planilha/slide ativo. Etapa 13. |
| ✅ | F18.08 | Painel de navegação | VIEW | `NAVIGATION_TREE` |  | Estrutura (títulos, slides, planilhas) para o painel. Etapa 13. |
| ✅ | F18.09 | Painel de seleção | VIEW | `SELECTION_PANEL` | surfaceId | Camadas do slide com nome, visível e bloqueado. Etapa 13. |
| ✅ | F18.10 | Tela cheia | VIEW | `SET_VIEW` | fullscreen | Estado de tela cheia. Etapa 13. |
| ✅ | F18.11 | Múltiplas janelas | VIEW | `OPEN_VIEW` `SWITCH_VIEW` `UPDATE_VIEW` `CLOSE_VIEW` `LIST_VIEWS` |  | Várias visões do mesmo documento (cada uma com zoom, superfície e rolagem). Etapa 13. |
| ✅ | F18.12 | Navegação por teclado | VIEW | `NAVIGATE` | direction | Próximo/anterior elemento, célula, slide. Depende de F17.04. Etapa 13. |
| ✅ | F18.13 | Leitura assistida | VIEW | `READING_ORDER` | surfaceId | Texto em ordem de leitura para leitor de tela/voz. Etapa 13. |
| ✅ | F18.14 | Exibição de elementos auxiliares | VIEW | `SET_VIEW` | showGrid, showGuides, showRuler, showMarks | Grade, guias, régua, marcas de formatação. Etapa 13. |
