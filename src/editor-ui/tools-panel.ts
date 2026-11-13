// Painel "Recursos": dá acesso, pela interface, às operações novas do motor (B1–D1) sem encher a barra de ferramentas.
// Cada recurso vira um botão; os que precisam de dados abrem um formulário curto no mesmo estilo das outras janelas.
// O resultado aparece embaixo (tabela, lista ou mensagem). Mesma fonte, cores e botões do resto do editor.
import type { Engine } from '../editor-core/index.ts';
import { h, toast } from './dom.ts';
import { ensureDialogCss } from './block-dialog.ts';

type App = 'DOCUMENT_EDITOR' | 'PRESENTATION_EDITOR' | 'SPREADSHEET_EDITOR';
type Field = { key: string; label: string; kind?: 'text' | 'number' | 'select' | 'color' | 'check' | 'textarea' | 'json'; options?: [string, string][]; value?: string | number | boolean; hint?: string };
type Ctx = { e: Engine; selection: string[]; surface: string | null; range: string | null; cell: string | null };
export interface Tool {
  group: string; label: string; apps: App[]; op: string; hint?: string; fields?: Field[];
  /** monta o pedido a partir do formulário */
  build?: (v: Record<string, any>, c: Ctx) => { targetId?: string | null; targetIds?: string[]; payload?: any };
  /** precisa de algo selecionado */
  needs?: 'selection' | 'surface';
}

const D: App[] = ['DOCUMENT_EDITOR'], P: App[] = ['PRESENTATION_EDITOR'], S: App[] = ['SPREADSHEET_EDITOR'], ALL: App[] = [...D, ...P, ...S], DP: App[] = [...D, ...P];
const sel = (c: Ctx) => c.selection[0] ?? null;
const csv = (s: string) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const NUMS: [string, string][] = [['DECIMAL', '1, 2, 3'], ['LOWER_ALPHA', 'a, b, c'], ['UPPER_ALPHA', 'A, B, C'], ['LOWER_ROMAN', 'i, ii, iii'], ['UPPER_ROMAN', 'I, II, III'], ['DECIMAL_ZERO', '01, 02'], ['ORDINAL', '1º, 2º'], ['DISC', '•'], ['CIRCLE', '◦'], ['SQUARE', '▪'], ['DASH', '–'], ['ARROW', '➢'], ['CHECK', '✓']];
const FORMATS: [string, string][] = [['GENERAL', 'Geral'], ['NUMBER', 'Número'], ['CURRENCY', 'Moeda (R$)'], ['ACCOUNTING', 'Contábil'], ['PERCENT', 'Porcentagem'], ['PERCENT2', 'Porcentagem 0,00'], ['SCIENTIFIC', 'Científico'], ['FRACTION', 'Fração'], ['DATE_SHORT', 'Data'], ['DATE_LONG', 'Data por extenso'], ['TIME', 'Hora'], ['DURATION', 'Duração'], ['TEXT', 'Texto'], ['CEP', 'CEP'], ['CPF', 'CPF'], ['CNPJ', 'CNPJ'], ['PHONE', 'Telefone']];

export const TOOLS: Tool[] = [
  // ---------------------------------------------------------------- texto (B1)
  { group: 'Texto e parágrafo', label: 'Estilos prontos', apps: DP, op: 'INSTALL_BUILTIN_STYLES', hint: 'Normal, Título, Título 1–6, Citação, Legenda, Código…' },
  { group: 'Texto e parágrafo', label: 'Selecionar formatação semelhante', apps: DP, op: 'SELECT_SIMILAR', needs: 'selection', build: (_, c) => ({ targetId: sel(c) }) },
  { group: 'Texto e parágrafo', label: 'Inspetor de estilos', apps: DP, op: 'STYLE_INSPECTOR', needs: 'selection', build: (_, c) => ({ targetId: sel(c) }) },
  { group: 'Texto e parágrafo', label: 'Efeitos de fonte', apps: DP, op: 'FORMAT', needs: 'selection', fields: [
    { key: 'underlineStyle', label: 'Sublinhado', kind: 'select', options: [['', 'Sem mudança'], ['SINGLE', 'Simples'], ['DOUBLE', 'Duplo'], ['THICK', 'Grosso'], ['DOTTED', 'Pontilhado'], ['DASHED', 'Tracejado'], ['WAVY', 'Ondulado']] },
    { key: 'smallCaps', label: 'Versalete', kind: 'check' }, { key: 'doubleStrike', label: 'Tachado duplo', kind: 'check' }, { key: 'textOutline', label: 'Contorno', kind: 'check' },
    { key: 'scale', label: 'Escala horizontal (%)', kind: 'number' }, { key: 'letterSpacing', label: 'Espaçamento entre letras (pt)', kind: 'number' }, { key: 'hidden', label: 'Texto oculto', kind: 'check' },
  ], build: (v, c) => ({ targetIds: c.selection, payload: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== false && x !== null)) }) },
  { group: 'Texto e parágrafo', label: 'Parágrafo: quebras e tabulações', apps: D, op: 'FORMAT', needs: 'selection', fields: [
    { key: 'keepWithNext', label: 'Manter com o próximo', kind: 'check' }, { key: 'keepTogether', label: 'Manter linhas juntas', kind: 'check' }, { key: 'pageBreakBefore', label: 'Quebra de página antes', kind: 'check' }, { key: 'widowControl', label: 'Controle de linhas órfãs/viúvas', kind: 'check', value: true },
    { key: 'tabs', label: 'Tabulações (posições em pt, separadas por vírgula)', kind: 'text', hint: 'Ex.: 72, 144, 360' }, { key: 'dropCap', label: 'Letra capitular (linhas, 0 = não)', kind: 'number', value: 0 },
  ], build: (v, c) => ({ targetIds: c.selection, payload: { keepWithNext: v.keepWithNext, keepTogether: v.keepTogether, pageBreakBefore: v.pageBreakBefore, widowControl: v.widowControl, ...(v.tabs ? { tabStops: csv(v.tabs).map((x) => ({ position: Number(x), align: 'LEFT' })) } : {}), ...(Number(v.dropCap) >= 2 ? { dropCap: { mode: 'DROPPED', lines: Number(v.dropCap) } } : {}) } }) },
  { group: 'Texto e parágrafo', label: 'Formato da lista', apps: DP, op: 'LIST_SET_FORMAT', needs: 'selection', fields: [{ key: 'l1', label: 'Nível 1', kind: 'select', options: NUMS }, { key: 'l2', label: 'Nível 2', kind: 'select', options: [['LOWER_ALPHA', 'a, b, c'], ...NUMS] }, { key: 'separator', label: 'Separador', kind: 'select', options: [['.', '1.'], [')', '1)'], ['', '1']] }], build: (v, c) => ({ targetId: sel(c), payload: { levelFormats: [v.l1, v.l2], separator: v.separator } }) },
  { group: 'Texto e parágrafo', label: 'Reiniciar numeração aqui', apps: DP, op: 'LIST_RESTART', needs: 'selection', fields: [{ key: 'start', label: 'Começar em', kind: 'number', value: 1 }], build: (v, c) => ({ targetId: sel(c), payload: { start: Number(v.start) } }) },
  { group: 'Texto e parágrafo', label: 'Continuar numeração', apps: DP, op: 'LIST_CONTINUE', needs: 'selection', build: (_, c) => ({ targetId: sel(c) }) },
  { group: 'Texto e parágrafo', label: 'Classificar parágrafos', apps: D, op: 'SORT_PARAGRAPHS', needs: 'selection', fields: [{ key: 'by', label: 'Por', kind: 'select', options: [['TEXT', 'Texto'], ['NUMBER', 'Número'], ['DATE', 'Data']] }, { key: 'order', label: 'Ordem', kind: 'select', options: [['ASC', 'Crescente'], ['DESC', 'Decrescente']] }], build: (v, c) => ({ payload: { ids: c.selection, by: v.by, order: v.order } }) },
  { group: 'Texto e parágrafo', label: 'Caracteres especiais', apps: DP, op: 'SPECIAL_CHARACTERS', hint: 'Lista para copiar: travessão, espaço inseparável, ©…' },
  // ---------------------------------------------------------------- objetos (B2)
  { group: 'Imagens, formas e tabelas', label: 'Recortar imagem', apps: DP, op: 'IMAGE_CROP', needs: 'selection', fields: [{ key: 'aspect', label: 'Proporção', kind: 'select', options: [['', 'Livre'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9'], ['3:2', '3:2']] }, { key: 'shape', label: 'Na forma', kind: 'select', options: [['', 'Retângulo'], ['CIRCLE', 'Círculo'], ['ROUNDED_RECTANGLE', 'Arredondado'], ['TRIANGLE', 'Triângulo'], ['DIAMOND', 'Losango'], ['HEXAGON', 'Hexágono'], ['STAR', 'Estrela'], ['HEART', 'Coração']] }, { key: 'margins', label: 'Margens % (esq, cima, dir, baixo)', kind: 'text', hint: 'Ex.: 10, 0, 10, 0' }],
    build: (v, c) => { const [l, t, r, b] = csv(v.margins).map((x) => Number(x) / 100); return { targetId: sel(c), payload: { ...(v.aspect ? { aspect: v.aspect } : {}), ...(v.shape ? { shape: v.shape } : {}), ...(v.margins ? { left: l || 0, top: t || 0, right: r || 0, bottom: b || 0 } : {}) } }; } },
  { group: 'Imagens, formas e tabelas', label: 'Ajustar imagem', apps: DP, op: 'IMAGE_ADJUST', needs: 'selection', fields: [{ key: 'brightness', label: 'Brilho (−100 a 100)', kind: 'number', value: 0 }, { key: 'contrast', label: 'Contraste (−100 a 100)', kind: 'number', value: 0 }, { key: 'saturation', label: 'Saturação (−100 a 100)', kind: 'number', value: 0 }, { key: 'transparency', label: 'Transparência (0 a 1)', kind: 'number', value: 0 }, { key: 'grayscale', label: 'Escala de cinza', kind: 'check' }, { key: 'sepia', label: 'Sépia', kind: 'check' }, { key: 'recolor', label: 'Recolorir', kind: 'color', value: '' }],
    build: (v, c) => ({ targetId: sel(c), payload: { brightness: Number(v.brightness), contrast: Number(v.contrast), saturation: Number(v.saturation), transparency: Number(v.transparency), grayscale: v.grayscale, sepia: v.sepia, recolor: v.recolor || null } }) },
  { group: 'Imagens, formas e tabelas', label: 'Redefinir imagem', apps: DP, op: 'IMAGE_RESET', needs: 'selection', build: (_, c) => ({ targetId: sel(c), payload: { size: true } }) },
  { group: 'Imagens, formas e tabelas', label: 'Girar ou espelhar', apps: DP, op: 'TRANSFORM', needs: 'selection', fields: [{ key: 'rotation', label: 'Ângulo (graus)', kind: 'number', value: 0 }, { key: 'flipH', label: 'Espelhar na horizontal', kind: 'check' }, { key: 'flipV', label: 'Espelhar na vertical', kind: 'check' }], build: (v, c) => ({ targetIds: c.selection, payload: { rotation: Number(v.rotation), ...(v.flipH ? { flipH: 'TOGGLE' } : {}), ...(v.flipV ? { flipV: 'TOGGLE' } : {}) } }) },
  { group: 'Imagens, formas e tabelas', label: 'Mesclar formas', apps: P, op: 'SHAPE_BOOLEAN', needs: 'selection', fields: [{ key: 'mode', label: 'Como', kind: 'select', options: [['UNION', 'Unir'], ['COMBINE', 'Combinar'], ['SUBTRACT', 'Subtrair'], ['INTERSECT', 'Interseção']] }], build: (v, c) => ({ payload: { ids: c.selection, mode: v.mode } }) },
  { group: 'Imagens, formas e tabelas', label: 'Agrupar', apps: P, op: 'GROUP', needs: 'selection', build: (_, c) => ({ targetIds: c.selection }) },
  { group: 'Imagens, formas e tabelas', label: 'Desagrupar', apps: P, op: 'UNGROUP', needs: 'selection', build: (_, c) => ({ targetIds: c.selection }) },
  { group: 'Imagens, formas e tabelas', label: 'Alinhar objetos', apps: P, op: 'ALIGN', needs: 'selection', fields: [{ key: 'to', label: 'Alinhar', kind: 'select', options: [['LEFT', 'À esquerda'], ['CENTER', 'Ao centro'], ['RIGHT', 'À direita'], ['TOP', 'Em cima'], ['MIDDLE', 'No meio'], ['BOTTOM', 'Embaixo']] }], build: (v, c) => ({ targetIds: c.selection, payload: { alignment: v.to } }) },
  { group: 'Imagens, formas e tabelas', label: 'Estilo de tabela', apps: DP, op: 'TABLE_STYLE', needs: 'selection', fields: [{ key: 'style', label: 'Estilo', kind: 'select', options: [['GRID', 'Grade'], ['PLAIN', 'Simples'], ['BLUE', 'Azul'], ['ORANGE', 'Laranja'], ['GREEN', 'Verde'], ['GRAY', 'Cinza'], ['DARK', 'Escura'], ['ACCENT', 'Destaque']] }, { key: 'headerRow', label: 'Linha de cabeçalho', kind: 'check', value: true }, { key: 'totalRow', label: 'Linha de total', kind: 'check' }, { key: 'firstColumn', label: 'Primeira coluna', kind: 'check' }, { key: 'bandedRows', label: 'Linhas em faixas', kind: 'check', value: true }, { key: 'bandedColumns', label: 'Colunas em faixas', kind: 'check' }],
    build: (v, c) => ({ targetId: sel(c), payload: v }) },
  { group: 'Imagens, formas e tabelas', label: 'Dividir tabela', apps: DP, op: 'TABLE_SPLIT', needs: 'selection', fields: [{ key: 'row', label: 'Antes da linha (1 = segunda linha)', kind: 'number', value: 1 }, { key: 'repeatHeader', label: 'Repetir cabeçalho', kind: 'check', value: true }], build: (v, c) => ({ targetId: sel(c), payload: { row: Number(v.row), repeatHeader: v.repeatHeader } }) },
  { group: 'Imagens, formas e tabelas', label: 'Ajuste automático da tabela', apps: DP, op: 'TABLE_AUTOFIT', needs: 'selection', fields: [{ key: 'mode', label: 'Ajustar', kind: 'select', options: [['CONTENT', 'Ao conteúdo'], ['WINDOW', 'À janela'], ['FIXED', 'Largura fixa']] }], build: (v, c) => ({ targetId: sel(c), payload: v }) },
  { group: 'Imagens, formas e tabelas', label: 'Propriedades da tabela', apps: DP, op: 'TABLE_PROPERTIES', needs: 'selection', fields: [{ key: 'repeatHeader', label: 'Repetir cabeçalho em cada página', kind: 'check' }, { key: 'align', label: 'Alinhamento', kind: 'select', options: [['LEFT', 'Esquerda'], ['CENTER', 'Centro'], ['RIGHT', 'Direita']] }, { key: 'caption', label: 'Legenda', kind: 'text' }], build: (v, c) => ({ targetId: sel(c), payload: v }) },
  // ---------------------------------------------------------------- página e revisão (B3)
  { group: 'Página', label: 'Marca d\'água', apps: D, op: 'SET_WATERMARK', fields: [{ key: 'text', label: 'Texto (vazio remove)', kind: 'text', value: 'CONFIDENCIAL' }, { key: 'color', label: 'Cor', kind: 'color', value: '#C0C0C0' }, { key: 'opacity', label: 'Opacidade (0 a 1)', kind: 'number', value: 0.15 }, { key: 'diagonal', label: 'Na diagonal', kind: 'check', value: true }], build: (v) => ({ payload: v.text ? { text: v.text, color: v.color, opacity: Number(v.opacity), diagonal: v.diagonal } : null }) },
  { group: 'Página', label: 'Borda da página', apps: D, op: 'SET_PAGE_BORDER', fields: [{ key: 'style', label: 'Estilo', kind: 'select', options: [['', 'Sem borda'], ['SOLID', 'Simples'], ['DOUBLE', 'Dupla'], ['DASHED', 'Tracejada'], ['DOTTED', 'Pontilhada']] }, { key: 'width', label: 'Espessura (pt)', kind: 'number', value: 2 }, { key: 'color', label: 'Cor', kind: 'color', value: '#000000' }], build: (v) => ({ payload: v.style ? { style: v.style, width: Number(v.width), color: v.color } : null }) },
  { group: 'Página', label: 'Margens, medianiz e alinhamento vertical', apps: D, op: 'SET_PAGE', fields: [{ key: 'margins', label: 'Margens', kind: 'select', options: [['', 'Sem mudança'], ['NORMAL', 'Normal'], ['NARROW', 'Estreita'], ['WIDE', 'Larga'], ['ABNT', 'ABNT']] }, { key: 'orientation', label: 'Orientação', kind: 'select', options: [['', 'Sem mudança'], ['PORTRAIT', 'Retrato'], ['LANDSCAPE', 'Paisagem']] }, { key: 'gutter', label: 'Medianiz (px)', kind: 'number', value: 0 }, { key: 'mirrorMargins', label: 'Margens espelhadas', kind: 'check' }, { key: 'verticalAlign', label: 'Texto na página', kind: 'select', options: [['TOP', 'Em cima'], ['CENTER', 'Centralizado'], ['JUSTIFY', 'Justificado'], ['BOTTOM', 'Embaixo']] }],
    build: (v) => ({ payload: { ...(v.margins ? { margins: v.margins } : {}), ...(v.orientation ? { orientation: v.orientation } : {}), gutter: Number(v.gutter), mirrorMargins: v.mirrorMargins, verticalAlign: v.verticalAlign } }) },
  { group: 'Página', label: 'Numeração de páginas', apps: D, op: 'SET_PAGE_NUMBERING', fields: [{ key: 'format', label: 'Formato', kind: 'select', options: NUMS.slice(0, 7) }, { key: 'start', label: 'Começar em', kind: 'number', value: 1 }], build: (v) => ({ payload: { format: v.format, start: Number(v.start) } }) },
  { group: 'Página', label: 'Números de linha', apps: D, op: 'SET_LINE_NUMBERS', fields: [{ key: 'on', label: 'Mostrar', kind: 'check', value: true }, { key: 'countBy', label: 'De quantas em quantas', kind: 'number', value: 1 }, { key: 'restart', label: 'Reiniciar', kind: 'select', options: [['PAGE', 'A cada página'], ['SECTION', 'A cada seção'], ['CONTINUOUS', 'Contínuo']] }], build: (v) => ({ payload: v.on ? { countBy: Number(v.countBy), restart: v.restart } : null }) },
  { group: 'Página', label: 'Hifenização automática', apps: D, op: 'SET_HYPHENATION', fields: [{ key: 'auto', label: 'Ligada', kind: 'check', value: true }], build: (v) => ({ payload: v }) },
  { group: 'Revisão', label: 'Autocorreção no documento', apps: DP, op: 'AUTOCORRECT_DOCUMENT', hint: 'vc → você, (c) → ©, -- → —, início de frase…' },
  { group: 'Revisão', label: 'Nova regra de autocorreção', apps: ALL, op: 'ADD_AUTOCORRECT', fields: [{ key: 'from', label: 'Ao digitar', kind: 'text' }, { key: 'to', label: 'Trocar por', kind: 'text' }], build: (v) => ({ payload: v }) },
  { group: 'Revisão', label: 'Sinônimos', apps: ALL, op: 'THESAURUS', fields: [{ key: 'word', label: 'Palavra', kind: 'text' }], build: (v) => ({ payload: v }) },
  { group: 'Revisão', label: 'Inspecionar documento', apps: ALL, op: 'INSPECT_DOCUMENT' },
  { group: 'Revisão', label: 'Remover informações pessoais', apps: ALL, op: 'REMOVE_PERSONAL_INFO' },
  { group: 'Segurança', label: 'Proteger com senha', apps: DP, op: 'PROTECT_DOCUMENT', fields: [{ key: 'mode', label: 'Permitir', kind: 'select', options: [['READ_ONLY', 'Só leitura'], ['COMMENTS', 'Só comentários'], ['TRACKED_CHANGES', 'Só alterações controladas'], ['FORMS', 'Só preencher formulário']] }, { key: 'password', label: 'Senha (opcional, 4+ caracteres)', kind: 'text' }], build: (v) => ({ payload: { mode: v.mode, ...(v.password ? { password: v.password } : {}) } }) },
  { group: 'Segurança', label: 'Desproteger', apps: DP, op: 'UNPROTECT_DOCUMENT', fields: [{ key: 'password', label: 'Senha', kind: 'text' }], build: (v) => ({ payload: v }) },
  { group: 'Segurança', label: 'Marcar como final (alternar)', apps: ALL, op: 'MARK_FINAL', build: (_, c) => ({ payload: { final: !(c.e.doc.document.settings as any).final } }) },
  { group: 'Formulários e mala direta', label: 'Campo de formulário', apps: D, op: 'INSERT_FORM_FIELD', fields: [{ key: 'name', label: 'Nome (sem espaços)', kind: 'text' }, { key: 'label', label: 'Rótulo', kind: 'text' }, { key: 'formType', label: 'Tipo', kind: 'select', options: [['TEXT', 'Texto'], ['NUMBER', 'Número'], ['DATE', 'Data'], ['CHECKBOX', 'Caixa de seleção'], ['DROPDOWN', 'Lista suspensa']] }, { key: 'options', label: 'Opções da lista (separadas por vírgula)', kind: 'text' }, { key: 'required', label: 'Obrigatório', kind: 'check' }],
    build: (v, c) => ({ payload: { name: v.name, label: v.label || v.name, formType: v.formType, required: v.required, parentId: c.surface, ...(v.formType === 'DROPDOWN' ? { options: csv(v.options) } : {}) } }) },
  { group: 'Formulários e mala direta', label: 'Preencher campo', apps: D, op: 'SET_FORM_VALUE', fields: [{ key: 'name', label: 'Nome do campo', kind: 'text' }, { key: 'value', label: 'Valor', kind: 'text' }], build: (v) => ({ payload: { name: v.name, value: v.value === 'true' ? true : v.value === 'false' ? false : v.value } }) },
  { group: 'Formulários e mala direta', label: 'Dados do formulário', apps: D, op: 'FORM_DATA' },
  { group: 'Formulários e mala direta', label: 'Fonte da mala direta (CSV)', apps: D, op: 'SET_MERGE_SOURCE', fields: [{ key: 'csv', label: 'Cole o CSV (primeira linha = nomes dos campos)', kind: 'textarea', value: 'nome;cidade\nAna;Recife' }], build: (v) => ({ payload: v }) },
  { group: 'Formulários e mala direta', label: 'Inserir campo «nome»', apps: D, op: 'INSERT_MERGE_FIELD', fields: [{ key: 'name', label: 'Campo', kind: 'text' }], build: (v, c) => ({ payload: { name: v.name, parentId: c.surface } }) },
  { group: 'Formulários e mala direta', label: 'Pré-visualizar registro', apps: D, op: 'MERGE_PREVIEW', fields: [{ key: 'record', label: 'Registro (1, 2, … ; vazio volta aos nomes)', kind: 'number' }], build: (v) => ({ payload: { record: v.record === '' ? null : Number(v.record) - 1 } }) },
  { group: 'Formulários e mala direta', label: 'Gerar documentos', apps: D, op: 'MERGE_RUN', hint: 'Um documento por registro.' },
  // ---------------------------------------------------------------- planilhas (C1/C2)
  { group: 'Células e grade', label: 'Formato numérico', apps: S, op: 'FORMAT_CELLS', needs: 'surface', fields: [{ key: 'preset', label: 'Formato', kind: 'select', options: FORMATS }, { key: 'code', label: 'Ou código personalizado', kind: 'text', hint: 'Ex.: #.##0,00;[Vermelho]-#.##0,00 · dd/mm/aaaa · 0,0%' }], build: (v, c) => ({ targetId: c.surface, payload: { range: c.range ?? c.cell, properties: { numberFormat: v.code || v.preset } } }) },
  { group: 'Células e grade', label: 'Congelar painéis', apps: S, op: 'FREEZE_PANES', needs: 'surface', fields: [{ key: 'rows', label: 'Linhas', kind: 'number', value: 1 }, { key: 'columns', label: 'Colunas', kind: 'number', value: 0 }], build: (v, c) => ({ targetId: c.surface, payload: { rows: Number(v.rows), columns: Number(v.columns) } }) },
  { group: 'Células e grade', label: 'Ocultar linhas', apps: S, op: 'HIDE_ROWS', needs: 'surface', fields: [{ key: 'rows', label: 'Linhas (ex.: 3:7)', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Células e grade', label: 'Reexibir todas as linhas', apps: S, op: 'SHOW_ROWS', needs: 'surface', build: (_, c) => ({ targetId: c.surface }) },
  { group: 'Células e grade', label: 'Ocultar colunas', apps: S, op: 'HIDE_COLUMNS', needs: 'surface', fields: [{ key: 'columns', label: 'Colunas (ex.: B:D)', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Células e grade', label: 'Reexibir todas as colunas', apps: S, op: 'SHOW_COLUMNS', needs: 'surface', build: (_, c) => ({ targetId: c.surface }) },
  { group: 'Células e grade', label: 'Agrupar linhas', apps: S, op: 'GROUP_LINES', needs: 'surface', fields: [{ key: 'range', label: 'Linhas (ex.: 2:10)', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: { axis: 'ROW', range: v.range } }) },
  { group: 'Células e grade', label: 'Autoajustar colunas', apps: S, op: 'AUTOFIT_COLUMNS', needs: 'surface', fields: [{ key: 'columns', label: 'Colunas', kind: 'text', value: 'A:H' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Células e grade', label: 'Cor da guia e ocultar planilha', apps: S, op: 'SHEET_PROPERTIES', needs: 'surface', fields: [{ key: 'tabColor', label: 'Cor da guia', kind: 'color', value: '#FBBF00' }, { key: 'hidden', label: 'Ocultar', kind: 'check' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Células e grade', label: 'Desbloquear células selecionadas', apps: S, op: 'LOCK_CELLS', needs: 'surface', build: (_, c) => ({ targetId: c.surface, payload: { range: c.range ?? c.cell, locked: false } }) },
  { group: 'Células e grade', label: 'Proteger planilha', apps: S, op: 'PROTECT_SHEET', needs: 'surface', fields: [{ key: 'password', label: 'Senha (opcional)', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: v.password ? v : {} }) },
  { group: 'Células e grade', label: 'Desproteger planilha', apps: S, op: 'UNPROTECT_SHEET', needs: 'surface', fields: [{ key: 'password', label: 'Senha', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Dados', label: 'Criar tabela', apps: S, op: 'CREATE_SHEET_TABLE', needs: 'surface', fields: [{ key: 'name', label: 'Nome', kind: 'text', value: 'Tabela1' }, { key: 'totalRow', label: 'Linha de totais', kind: 'check' }], build: (v, c) => ({ targetId: c.surface, payload: { range: c.range, name: v.name, totalRow: v.totalRow } }) },
  { group: 'Dados', label: 'Remover duplicatas', apps: S, op: 'REMOVE_DUPLICATES', needs: 'surface', build: (_, c) => ({ targetId: c.surface, payload: { range: c.range } }) },
  { group: 'Dados', label: 'Subtotais', apps: S, op: 'SUBTOTALS', needs: 'surface', fields: [{ key: 'groupBy', label: 'Agrupar pela coluna (nome)', kind: 'text' }, { key: 'columns', label: 'Somar as colunas (nomes, vírgula)', kind: 'text' }, { key: 'fn', label: 'Usando', kind: 'select', options: [['SUM', 'Soma'], ['AVERAGE', 'Média'], ['COUNT', 'Contagem'], ['MAX', 'Máximo'], ['MIN', 'Mínimo']] }], build: (v, c) => ({ targetId: c.surface, payload: { range: c.range, groupBy: v.groupBy, columns: csv(v.columns), fn: v.fn } }) },
  { group: 'Dados', label: 'Tabela dinâmica', apps: S, op: 'PIVOT_TABLE', needs: 'surface', fields: [{ key: 'rows', label: 'Linhas (colunas da origem, vírgula)', kind: 'text' }, { key: 'columns', label: 'Colunas (opcional)', kind: 'text' }, { key: 'value', label: 'Valor', kind: 'text' }, { key: 'fn', label: 'Resumo', kind: 'select', options: [['SUM', 'Soma'], ['AVERAGE', 'Média'], ['COUNT', 'Contagem'], ['MAX', 'Máximo'], ['MIN', 'Mínimo'], ['DISTINCT', 'Distintos']] }, { key: 'dest', label: 'Colocar a partir de', kind: 'text', value: 'J1' }],
    build: (v, c) => ({ targetId: c.surface, payload: { source: c.range, rows: csv(v.rows), columns: csv(v.columns), values: [{ column: v.value, fn: v.fn }], dest: v.dest } }) },
  { group: 'Dados', label: 'Preenchimento relâmpago', apps: S, op: 'FLASH_FILL', needs: 'surface', fields: [{ key: 'source', label: 'Coluna de origem (ex.: A2:A50)', kind: 'text' }, { key: 'target', label: 'Coluna com exemplos (ex.: B2:B50)', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Dados', label: 'Transformar dados', apps: S, op: 'TRANSFORM_DATA', needs: 'surface', fields: [{ key: 'steps', label: 'Etapas (JSON)', kind: 'json', value: '[{"op":"REMOVE_DUPLICATES"},{"op":"SORT","column":"A"}]', hint: 'SELECT_COLUMNS, REMOVE_COLUMNS, RENAME_COLUMN, FILTER_ROWS, SPLIT_COLUMN, MERGE_COLUMNS, ADD_COLUMN, FILL_DOWN, SORT, GROUP_BY, PIVOT, UNPIVOT, TRANSPOSE…' }, { key: 'dest', label: 'Resultado a partir de', kind: 'text', value: 'J1' }], build: (v, c) => ({ targetId: c.surface, payload: { source: c.range, steps: v.steps, dest: v.dest } }) },
  { group: 'Análise', label: 'Atingir meta', apps: S, op: 'GOAL_SEEK', needs: 'surface', fields: [{ key: 'setCell', label: 'Definir a célula', kind: 'text' }, { key: 'toValue', label: 'Para o valor', kind: 'number' }, { key: 'byChanging', label: 'Alterando a célula', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: { ...v, toValue: Number(v.toValue) } }) },
  { group: 'Análise', label: 'Novo cenário', apps: S, op: 'ADD_SCENARIO', needs: 'surface', fields: [{ key: 'name', label: 'Nome', kind: 'text' }, { key: 'cells', label: 'Valores (JSON: {"B1": 10})', kind: 'json', value: '{}' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Análise', label: 'Resumo dos cenários', apps: S, op: 'SCENARIO_SUMMARY', needs: 'surface', fields: [{ key: 'cells', label: 'Células de resultado (vírgula)', kind: 'text' }], build: (v, c) => ({ targetId: c.surface, payload: { resultCells: csv(v.cells) } }) },
  { group: 'Análise', label: 'Estatística descritiva', apps: S, op: 'DESCRIPTIVE_STATS', needs: 'surface', build: (_, c) => ({ targetId: c.surface, payload: { range: c.range } }) },
  { group: 'Análise', label: 'Previsão', apps: S, op: 'FORECAST_SERIES', needs: 'surface', fields: [{ key: 'periods', label: 'Períodos', kind: 'number', value: 3 }, { key: 'method', label: 'Método', kind: 'select', options: [['LINEAR', 'Linear'], ['EXPONENTIAL', 'Suavização exponencial'], ['MOVING_AVERAGE', 'Média móvel']] }], build: (v, c) => ({ targetId: c.surface, payload: { range: c.range, periods: Number(v.periods), method: v.method } }) },
  { group: 'Análise', label: 'Rastrear precedentes', apps: S, op: 'TRACE_PRECEDENTS', needs: 'surface', build: (_, c) => ({ targetId: c.surface, payload: { cell: c.cell } }) },
  { group: 'Análise', label: 'Rastrear dependentes', apps: S, op: 'TRACE_DEPENDENTS', needs: 'surface', build: (_, c) => ({ targetId: c.surface, payload: { cell: c.cell } }) },
  // ---------------------------------------------------------------- apresentações (D1)
  { group: 'Slides', label: 'Nova seção a partir deste slide', apps: P, op: 'ADD_SLIDE_SECTION', needs: 'surface', fields: [{ key: 'name', label: 'Nome da seção', kind: 'text' }], build: (v, c) => ({ payload: { name: v.name, startSlideId: c.surface } }) },
  { group: 'Slides', label: 'Seções', apps: P, op: 'LIST_SLIDE_SECTIONS' },
  { group: 'Slides', label: 'Ocultar slide na apresentação', apps: P, op: 'HIDE', needs: 'surface', build: (_, c) => ({ targetId: c.surface }) },
  { group: 'Slides', label: 'Mostrar slide de novo', apps: P, op: 'SHOW', needs: 'surface', build: (_, c) => ({ targetId: c.surface }) },
  { group: 'Slides', label: 'Anotações do apresentador', apps: P, op: 'SET_SPEAKER_NOTES', needs: 'surface', fields: [{ key: 'notes', label: 'Notas deste slide', kind: 'textarea' }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Slides', label: 'Estrutura de tópicos', apps: P, op: 'OUTLINE' },
  { group: 'Slides', label: 'Folhetos', apps: P, op: 'HANDOUT_LAYOUT', fields: [{ key: 'perPage', label: 'Slides por página', kind: 'select', options: [['6', '6'], ['1', '1'], ['2', '2'], ['3', '3 (com linhas)'], ['4', '4'], ['9', '9']] }, { key: 'notes', label: 'Com notas', kind: 'check' }], build: (v) => ({ payload: { perPage: Number(v.perPage), notes: v.notes } }) },
  { group: 'Slide mestre', label: 'Rodapé, número e data', apps: P, op: 'SET_MASTER', fields: [{ key: 'text', label: 'Texto do rodapé', kind: 'text' }, { key: 'slideNumber', label: 'Número do slide', kind: 'check', value: true }, { key: 'date', label: 'Data', kind: 'check' }, { key: 'hideOnTitleSlide', label: 'Não mostrar no primeiro slide', kind: 'check', value: true }], build: (v) => ({ payload: { footer: v } }) },
  { group: 'Slide mestre', label: 'Fundo de todos os slides', apps: P, op: 'SET_MASTER', fields: [{ key: 'background', label: 'Cor', kind: 'color', value: '#FFFFFF' }], build: (v) => ({ payload: { background: v.background } }) },
  { group: 'Slide mestre', label: 'Ocultar o mestre neste slide', apps: P, op: 'SET_SLIDE_MASTER', needs: 'surface', fields: [{ key: 'hideMaster', label: 'Ocultar', kind: 'check', value: true }], build: (v, c) => ({ targetId: c.surface, payload: v }) },
  { group: 'Apresentação', label: 'Usar tempos ensaiados', apps: P, op: 'SET_SLIDE_TIMINGS', fields: [{ key: 'use', label: 'Avançar sozinho com os tempos', kind: 'check', value: true }], build: (v) => ({ payload: v }) },
  { group: 'Apresentação', label: 'Configurar áudio/vídeo', apps: P, op: 'MEDIA_SETTINGS', needs: 'selection', fields: [{ key: 'trimStart', label: 'Começar em (s)', kind: 'number', value: 0 }, { key: 'trimEnd', label: 'Terminar em (s, vazio = fim)', kind: 'number' }, { key: 'volume', label: 'Volume (0 a 1)', kind: 'number', value: 1 }, { key: 'start', label: 'Iniciar', kind: 'select', options: [['CLICK', 'Ao clicar'], ['AUTO', 'Automaticamente']] }, { key: 'loop', label: 'Repetir', kind: 'check' }, { key: 'playAcrossSlides', label: 'Continuar entre slides', kind: 'check' }],
    build: (v, c) => ({ targetId: sel(c), payload: { trimStart: Number(v.trimStart), ...(v.trimEnd !== '' ? { trimEnd: Number(v.trimEnd) } : {}), volume: Number(v.volume), start: v.start, loop: v.loop, playAcrossSlides: v.playAcrossSlides } }) },
];

/** Formulário curto (mesma janela das outras: fonte, cores e botões do projeto). */
function ask(title: string, fields: Field[], hint?: string): Promise<Record<string, any> | null> {
  ensureDialogCss();
  const dlg = h('dialog', { class: 'bd', 'aria-label': title });
  const form = h('form', { method: 'dialog' });
  const inputs: [Field, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement][] = [];
  const left = h('div', { style: 'display:flex;flex-direction:column;gap:12px;grid-column:1/-1' });
  if (hint) left.append(h('small', {}, hint));
  for (const f of fields) {
    const label = h('label', {});
    let el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (f.kind === 'select') { el = h('select', {}); for (const [v, l] of f.options!) el.append(new Option(l, v)); }
    else if (f.kind === 'textarea' || f.kind === 'json') { el = h('textarea', { rows: '5', spellcheck: 'false' }); }
    else el = h('input', { type: f.kind === 'number' ? 'number' : f.kind === 'color' ? 'color' : f.kind === 'check' ? 'checkbox' : 'text', step: 'any' });
    if (f.kind === 'check') { (el as HTMLInputElement).checked = Boolean(f.value); label.style.flexDirection = 'row'; label.style.alignItems = 'center'; label.append(el, f.label); }
    else { if (f.value !== undefined) el.value = String(f.value); label.append(f.label, el); }
    if (f.hint) label.append(h('small', {}, f.hint));
    inputs.push([f, el]); left.append(label);
  }
  const ok = h('button', { type: 'submit', class: 'bd-ok' }, 'Aplicar');
  const cancel = h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancelar');
  form.append(h('h2', {}, title), left, h('div', { class: 'bd-row' }, cancel, ok));
  dlg.append(form); document.body.append(dlg);
  return new Promise((resolve) => {
    let out: Record<string, any> | null = null;
    form.addEventListener('submit', (ev) => {
      try {
        out = Object.fromEntries(inputs.map(([f, el]) => [f.key, f.kind === 'check' ? (el as HTMLInputElement).checked : f.kind === 'json' ? JSON.parse(el.value || 'null') : el.value]));
      } catch { ev.preventDefault(); toast('JSON inválido.', 'error'); }
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(out); });
    dlg.showModal();
    (left.querySelector('input,select,textarea') as HTMLElement | null)?.focus();
  });
}

/** Resultado legível: tabela (lista de listas), lista de objetos, objeto chave → valor ou texto. */
function show(value: unknown): Node {
  const fmt = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Math.round(v * 1e6) / 1e6).toLocaleString('pt-BR') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (Array.isArray(value) && value.length && Array.isArray(value[0])) return h('table', { class: 'ed-result' }, ...(value as unknown[][]).slice(0, 60).map((r, i) => h('tr', {}, ...r.map((c) => h(i === 0 ? 'th' : 'td', {}, fmt(c))))));
  if (Array.isArray(value)) return h('ul', { class: 'ed-result-list' }, ...value.slice(0, 80).map((x) => h('li', {}, typeof x === 'object' && x ? Object.entries(x).filter(([k]) => !['data', 'path'].includes(k)).map(([k, v]) => `${k}: ${fmt(v)}`).join(' · ') : fmt(x))));
  if (value && typeof value === 'object') return h('dl', { class: 'ed-result-dl' }, ...Object.entries(value).filter(([k]) => k !== 'documents').flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, typeof v === 'object' && v && 'value' in (v as any) ? `${fmt((v as any).value)} (${(v as any).from ?? ''})` : fmt(v))]));
  return h('p', {}, value === undefined ? 'Feito.' : fmt(value));
}

export function toolsPanel(e: Engine, ctx: () => Omit<Ctx, 'e'>, after: () => void): Node[] {
  const app = e.doc.document.application as App;
  const list = TOOLS.filter((t) => t.apps.includes(app));
  const out = h('div', { class: 'ed-tools-out', 'aria-live': 'polite' });
  const search = h('input', { class: 'ed-input', type: 'search', placeholder: 'Procurar recurso…', 'aria-label': 'Procurar recurso' });
  const groups = h('div', {});
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = list.filter((t) => !q || `${t.group} ${t.label} ${t.hint ?? ''}`.toLowerCase().includes(q));
    const byGroup = new Map<string, Tool[]>();
    for (const t of shown) (byGroup.get(t.group) ?? byGroup.set(t.group, []).get(t.group)!).push(t);
    groups.replaceChildren(...[...byGroup].map(([g, ts]) => h('section', { class: 'ed-tools-group' }, h('h3', {}, g), h('div', { class: 'ed-tools-grid' }, ...ts.map((t) => h('button', { type: 'button', class: 'ed-btn', title: t.hint ?? t.label, onclick: () => void use(t) }, t.label))))));
    if (!shown.length) groups.replaceChildren(h('p', { class: 'ed-muted' }, 'Nada encontrado.'));
  };
  async function use(t: Tool) {
    const c = { e, ...ctx() };
    if (t.needs === 'selection' && !c.selection.length) return toast('Selecione um objeto antes.', 'error');
    if (t.needs === 'surface' && !c.surface) return toast('Abra um slide ou planilha antes.', 'error');
    const v = t.fields?.length ? await ask(t.label, t.fields, t.hint) : {};
    if (v === null) return;
    const req = t.build ? t.build(v, c) : {};
    const r = e.execute({ type: t.op, ...req } as any);
    if (!r.ok) { toast(r.error.message, 'error'); return; }
    out.replaceChildren(h('h3', {}, t.label), show(r.value));
    if (t.op === 'MERGE_RUN') {
      const docs = (r.value as any).documents as unknown[];
      const blob = new Blob([JSON.stringify(docs)], { type: 'application/json' });
      out.append(h('a', { class: 'ed-btn', href: URL.createObjectURL(blob), download: 'mala-direta.json' }, `Baixar ${docs.length} documentos`));
    }
    after();
  }
  search.addEventListener('input', draw);
  draw();
  return [search, out, groups];
}
