// Formatação e aparência (Camada 6): FORMAT · CLEAR_FORMAT · COPY_FORMAT · PASTE_FORMAT · estilos · temas.
// Aparência final = padrões do TEMA → propriedades do ESTILO (styleId) → ajustes do próprio nó (styleOverrides).
// A aparência final é calculada (resolveStyle), nunca gravada. Valores "theme:primary" ou "theme:font.heading"
// apontam para o tema: trocar a cor principal do tema muda todos os objetos que usam essa referência.
import type { NodeType, Style, Theme } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { targetsOf } from './selection.ts';
import { clone, fail, merge } from '../util.ts';

// ---------------------------------------------------------------- catálogo de propriedades

const TEXT_PROPS = [
  'fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'textTransform',
  'baseline', 'letterSpacing', 'align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indentLeft', 'indentRight',
  'indentFirstLine', 'direction', 'verticalAlign',
  // B1 · caractere: tipo e cor do sublinhado, tachado duplo, versalete, contorno, sombra, escala, oculto, kerning, idioma
  'underlineStyle', 'underlineColor', 'doubleStrike', 'smallCaps', 'textOutline', 'textShadow', 'scale', 'hidden', 'kerning', 'language', 'noProof',
  // B1 · parágrafo: quebras (manter com o próximo, linhas juntas, quebra antes, viúvas/órfãs), tabulações, capitular, nível de tópico
  'keepWithNext', 'keepTogether', 'pageBreakBefore', 'widowControl', 'tabStops', 'dropCap', 'outlineLevel', 'lineSpacingRule',
];
export const UNDERLINE_STYLES = ['SINGLE', 'DOUBLE', 'THICK', 'DOTTED', 'DASHED', 'WAVY', 'WORDS'];
const BOX_PROPS = ['fill', 'stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'radius', 'shadow', 'blur', 'border', 'effects'];
const LINE_PROPS = ['stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'arrowStart', 'arrowEnd', 'shadow'];
const TABLE_PROPS = ['cellPadding', 'headerFill', 'bandedRows', 'numberFormat', 'wrapText', 'textRotation'];

/** Propriedades de formatação que cada tipo aceita. */
export function allowedProps(type: NodeType): Set<string> {
  if (type === 'LINE') return new Set(LINE_PROPS);
  if (type === 'IMAGE' || type === 'VIDEO' || type === 'AUDIO' || type === 'BREAK') return new Set(BOX_PROPS);
  if (type === 'TABLE') return new Set([...TEXT_PROPS, ...BOX_PROPS, ...TABLE_PROPS]);
  return new Set([...TEXT_PROPS, ...BOX_PROPS]);
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(.+\)|transparent|theme:[\w.]+)$/i;
export const isColor = (v: unknown) => typeof v === 'string' && COLOR.test(v);

const LINE_STYLES = ['SOLID', 'DASHED', 'DOTTED', 'DOUBLE', 'NONE'];
const num = (v: unknown, what: string, min = 0, max = Infinity) => { if (typeof v !== 'number' || v < min || v > max) fail('VALIDATION', `${what}: número de ${min} a ${max === Infinity ? '…' : max}.`); };

/** Borda: { color, width, style } para todos os lados, ou { top, right, bottom, left, all } com um desses em cada. */
function validateBorder(b: any) {
  if (b === false) return;
  const side = (x: any, where: string) => {
    if (x === null || x === false) return;
    if (typeof x !== 'object') fail('VALIDATION', `Borda ${where}: { color, width, style }.`);
    if (x.color !== undefined && !isColor(x.color)) fail('VALIDATION', `Cor inválida na borda ${where}.`);
    if (x.width !== undefined) num(x.width, `Espessura da borda ${where}`, 0, 100);
    if (x.style !== undefined && !LINE_STYLES.includes(x.style)) fail('VALIDATION', `Estilo da borda: ${LINE_STYLES.join(', ')}.`);
  };
  if (typeof b !== 'object') fail('VALIDATION', 'Borda: objeto { color, width, style } ou por lado { top, right, bottom, left }.');
  const sides = ['top', 'right', 'bottom', 'left', 'all', 'insideH', 'insideV'].filter((k) => k in b);
  if (sides.length) { for (const k of Object.keys(b)) if (!sides.includes(k)) fail('VALIDATION', `Borda: lado desconhecido "${k}".`); sides.forEach((k) => side(b[k], k)); }
  else {
    const extra = Object.keys(b).filter((k) => !['color', 'width', 'style'].includes(k));
    if (extra.length) fail('VALIDATION', `Borda: lado desconhecido "${extra[0]}".`);
    side(b, '');
  }
}

/** Sombra: { x, y, blur, spread?, color, inset? } (false remove). */
function validateShadow(v: any) {
  if (v === false) return;
  if (typeof v !== 'object') fail('VALIDATION', 'Sombra: { x, y, blur, color }.');
  for (const k of ['x', 'y']) if (v[k] !== undefined) num(v[k], `Sombra ${k}`, -500, 500);
  if (v.blur !== undefined) num(v.blur, 'Desfoque da sombra', 0, 500);
  if (v.spread !== undefined) num(v.spread, 'Espalhamento da sombra', -500, 500);
  if (v.color !== undefined && !isColor(v.color)) fail('VALIDATION', 'Cor da sombra inválida.');
}

const EFFECTS = ['glow', 'reflection', 'blur', 'softEdges', 'grayscale', 'sepia', 'brightness', 'contrast', 'saturation', 'hueRotate', 'invert'];
/** Efeitos visuais: brilho externo, reflexo, desfoque, bordas suaves e filtros de cor. */
function validateEffects(v: any) {
  if (typeof v !== 'object' || v === null) fail('VALIDATION', 'Efeitos: objeto, ex.: { glow: { color, size }, blur: 4 }.');
  for (const [k, x] of Object.entries<any>(v)) {
    if (!EFFECTS.includes(k)) fail('VALIDATION', `Efeito desconhecido: ${k}. Use ${EFFECTS.join(', ')}.`);
    if (x === null || x === false) continue;
    if (k === 'glow') { if (!isColor(x.color)) fail('VALIDATION', 'Brilho: color.'); num(x.size, 'Tamanho do brilho', 0, 200); }
    else if (k === 'reflection') { num(x.size ?? 50, 'Tamanho do reflexo (%)', 0, 100); num(x.distance ?? 0, 'Distância do reflexo', 0, 500); num(x.opacity ?? 0.5, 'Opacidade do reflexo', 0, 1); }
    else if (k === 'grayscale' || k === 'sepia' || k === 'invert') { if (typeof x !== 'boolean' && (typeof x !== 'number' || x < 0 || x > 1)) fail('VALIDATION', `${k}: true/false ou de 0 a 1.`); }
    else if (k === 'hueRotate') num(x, 'Matiz', -360, 360);
    else if (k === 'blur' || k === 'softEdges') num(x, k === 'blur' ? 'Desfoque' : 'Bordas suaves', 0, 200);
    else num(x, k, 0, 3);
  }
}

/** Valida nome e valor. Lança erro com a lista do que não serve. */
export function validateProps(type: NodeType | null, props: Record<string, unknown>) {
  const ok = type ? allowedProps(type) : new Set([...TEXT_PROPS, ...BOX_PROPS, ...LINE_PROPS, ...TABLE_PROPS]);
  const bad = Object.keys(props).filter((k) => !ok.has(k));
  if (bad.length) fail('VALIDATION', `${type ?? 'Estilo'} não aceita: ${bad.join(', ')}.`);
  for (const [k, v] of Object.entries(props)) {
    if (v === null) continue;   // null = remover a propriedade
    if (['color', 'fill', 'stroke', 'highlight', 'headerFill'].includes(k) && (typeof v !== 'string' || !COLOR.test(v))) fail('VALIDATION', `Cor inválida em ${k}: ${String(v)}.`);
    if (['fontSize', 'strokeWidth', 'lineHeight', 'letterSpacing', 'spaceBefore', 'spaceAfter', 'radius', 'blur', 'cellPadding'].includes(k) && typeof v !== 'number') fail('VALIDATION', `${k} precisa ser um número.`);
    if (k === 'fontSize' && (v as number) <= 0) fail('VALIDATION', 'O tamanho da fonte precisa ser maior que zero.');
    if (k === 'opacity' && (typeof v !== 'number' || v < 0 || v > 1)) fail('VALIDATION', 'Transparência (opacity) vai de 0 a 1.');
    if (k === 'align' && !['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'].includes(v as string)) fail('VALIDATION', 'Alinhamento: LEFT, CENTER, RIGHT ou JUSTIFY.');
    if (k === 'textTransform' && !['NONE', 'UPPERCASE', 'LOWERCASE', 'CAPITALIZE'].includes(v as string)) fail('VALIDATION', 'Maiúsculas/minúsculas: NONE, UPPERCASE, LOWERCASE ou CAPITALIZE.');
    if (k === 'baseline' && !['NORMAL', 'SUPERSCRIPT', 'SUBSCRIPT'].includes(v as string)) fail('VALIDATION', 'Sobrescrito/subscrito: NORMAL, SUPERSCRIPT ou SUBSCRIPT.');
    if (k === 'direction' && !['LTR', 'RTL', 'VERTICAL'].includes(v as string)) fail('VALIDATION', 'Direção do texto: LTR, RTL ou VERTICAL.');
    if (k === 'verticalAlign' && !['TOP', 'MIDDLE', 'BOTTOM'].includes(v as string)) fail('VALIDATION', 'Alinhamento vertical: TOP, MIDDLE ou BOTTOM.');
    if (k === 'underlineStyle' && !UNDERLINE_STYLES.includes(v as string)) fail('VALIDATION', `Sublinhado: ${UNDERLINE_STYLES.join(', ')}.`);
    if (k === 'underlineColor' && (typeof v !== 'string' || !COLOR.test(v))) fail('VALIDATION', `Cor inválida em ${k}: ${String(v)}.`);
    if (['doubleStrike', 'smallCaps', 'textOutline', 'hidden', 'noProof', 'keepWithNext', 'keepTogether', 'pageBreakBefore', 'widowControl'].includes(k) && typeof v !== 'boolean') fail('VALIDATION', `${k} é sim/não (true/false).`);
    if (k === 'scale' && (typeof v !== 'number' || v < 1 || v > 600)) fail('VALIDATION', 'Escala do caractere vai de 1 a 600 (%).');
    if (k === 'kerning' && (typeof v !== 'number' || v < 0)) fail('VALIDATION', 'Kerning: tamanho mínimo da fonte (pt), 0 desliga.');
    if (k === 'language' && (typeof v !== 'string' || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(v))) fail('VALIDATION', 'Idioma no formato pt-BR, en-US…');
    if (k === 'outlineLevel' && (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 9)) fail('VALIDATION', 'Nível de tópico: 0 (corpo do texto) a 9.');
    if (k === 'lineSpacingRule' && !['MULTIPLE', 'EXACT', 'AT_LEAST'].includes(v as string)) fail('VALIDATION', 'Regra do entrelinhas: MULTIPLE, EXACT ou AT_LEAST.');
    if (k === 'textShadow' && v !== false) validateShadow(v);
    if (k === 'dropCap' && v !== false && (typeof v !== 'object' || !['DROPPED', 'IN_MARGIN'].includes((v as any).mode) || !((v as any).lines >= 2 && (v as any).lines <= 10))) fail('VALIDATION', 'Capitular: { mode: DROPPED|IN_MARGIN, lines: 2–10 }.');
    if (k === 'tabStops') {
      if (!Array.isArray(v)) fail('VALIDATION', 'Tabulações: lista de { position, align, leader }.');
      for (const t of v as any[]) {
        if (typeof t?.position !== 'number' || t.position < 0) fail('VALIDATION', 'Posição da tabulação precisa ser um número ≥ 0.');
        if (t.align && !['LEFT', 'CENTER', 'RIGHT', 'DECIMAL', 'BAR'].includes(t.align)) fail('VALIDATION', 'Tabulação: LEFT, CENTER, RIGHT, DECIMAL ou BAR.');
        if (t.leader && !['NONE', 'DOTS', 'DASHES', 'LINE'].includes(t.leader)) fail('VALIDATION', 'Preenchimento da tabulação: NONE, DOTS, DASHES ou LINE.');
      }
    }
    if (k === 'numberFormat' && (typeof v !== 'string' || !v.trim() || v.length > 120)) fail('VALIDATION', 'Formato numérico: um código (ex.: "#.##0,00", "dd/mm/aaaa") ou um pronto (CURRENCY, PERCENT, DATE_SHORT…).');
    if (k === 'wrapText' && typeof v !== 'boolean') fail('VALIDATION', 'Quebrar texto é sim/não.');
    if (k === 'textRotation' && (typeof v !== 'number' || v < -90 || v > 90)) fail('VALIDATION', 'Rotação do texto: de -90 a 90 graus.');
    if (k === 'border') validateBorder(v);
    if (k === 'shadow') validateShadow(v);
    if (k === 'effects') validateEffects(v);
    if (k === 'strokeStyle' && !LINE_STYLES.includes(v as string)) fail('VALIDATION', `Estilo do contorno: ${LINE_STYLES.join(', ')}.`);
  }
}

// ---------------------------------------------------------------- aparência final

export function activeTheme(e: Engine): Theme | undefined {
  return e.doc.themes[e.doc.document.themeId ?? ''];
}

/** Troca "theme:primary" / "theme:font.heading" pelo valor do tema. */
export function resolveThemeValue(theme: Theme | undefined, v: unknown): unknown {
  if (typeof v !== 'string' || !v.startsWith('theme:') || !theme) return v;
  const key = v.slice(6);
  if (key.startsWith('font.')) return theme.fonts[key.slice(5)] ?? v;
  return theme.colors[key] ?? v;
}

/** Aparência calculada de um nó: tema → estilo → ajustes individuais (com referências ao tema resolvidas). */
export function resolveStyle(e: Engine, id: string): Record<string, unknown> {
  const n = e.get(id);
  const theme = activeTheme(e);
  let out: Record<string, unknown> = { ...(theme?.defaults['*'] ?? {}), ...(theme?.defaults[n.type] ?? {}) };
  if (n.styleId && e.doc.styles[n.styleId]) out = merge(out, e.doc.styles[n.styleId].properties);
  out = merge(out, n.styleOverrides);
  for (const k of Object.keys(out)) out[k] = resolveThemeValue(theme, out[k]);
  return out;
}

// ---------------------------------------------------------------- operações

const props = (p: Record<string, any> | undefined) => (p?.properties ?? p ?? {}) as Record<string, unknown>;

export const formatHandlers: Record<string, Handler> = {
  /** FORMAT { fill: '#f00', fontSize: 18 } nos alvos (ou na seleção). Só altera o que foi informado. */
  FORMAT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const p = props(op.payload);
    validateProps(e.get(id).type, p);
    const n = e.touchNode(id);
    n.styleOverrides = merge(n.styleOverrides, p);
    return id;
  }),

  /** Remove a formatação individual (e a dos trechos de texto); o estilo vinculado continua. */
  CLEAR_FORMAT: (e, op) => targetsOf(e, op).map((id) => {
    e.assertEditable(id);
    const n = e.touchNode(id);
    n.styleOverrides = {};
    if (n.type === 'TEXT' && Array.isArray(n.data.runs)) n.data.runs.forEach((r: any) => { r.format = {}; });
    return id;
  }),

  /** Pincel de formatação: guarda estilo + ajustes do objeto principal da seleção. */
  COPY_FORMAT: (e, op) => {
    const n = e.get(op.targetId ?? e.state.selection.primaryId ?? fail('INVALID_PAYLOAD', 'Nada selecionado.'));
    (e.state as any).formatPainter = { type: n.type, styleId: n.styleId, styleOverrides: clone(n.styleOverrides) };
    return true;
  },

  PASTE_FORMAT: (e, op) => {
    const fp = (e.state as any).formatPainter ?? fail('EMPTY_CLIPBOARD', 'Copie uma formatação primeiro.');
    return targetsOf(e, op).map((id) => {
      e.assertEditable(id);
      const n = e.touchNode(id);
      const ok = allowedProps(n.type);
      n.styleId = fp.styleId;
      n.styleOverrides = Object.fromEntries(Object.entries(fp.styleOverrides).filter(([k]) => ok.has(k)));   // só o que faz sentido para o tipo
      return id;
    });
  },

  CREATE_STYLE: (e, op) => {
    const { name, type = null, properties = {} } = op.payload ?? {};
    if (!name) fail('INVALID_PAYLOAD', 'Dê um nome ao estilo.');
    validateProps(type, properties);
    const id = e.newId('STYLE');
    e.put('styles', id, { id, name, type, properties: clone(properties) } satisfies Style);
    return id;
  },

  /** Muda o estilo: todos os objetos vinculados mudam juntos. */
  UPDATE_STYLE: (e, op) => {
    const s = e.doc.styles[op.targetId ?? ''] ?? fail('NOT_FOUND', `Estilo ${op.targetId} não existe.`);
    const { name, properties } = op.payload ?? {};
    if (properties) validateProps(s.type, properties);
    const t = e.touch('styles', s.id) as Style;
    if (name) t.name = name;
    if (properties) t.properties = merge(t.properties, properties);
    return s.id;
  },

  /** Apaga o estilo; quem usava fica com a mesma aparência (as propriedades passam para os ajustes individuais). */
  DELETE_STYLE: (e, op) => {
    const s = e.doc.styles[op.targetId ?? ''] ?? fail('NOT_FOUND', `Estilo ${op.targetId} não existe.`);
    for (const n of Object.values(e.doc.nodes)) {
      if (n.styleId !== s.id) continue;
      const t = e.touchNode(n.id);
      t.styleId = null;
      t.styleOverrides = { ...s.properties, ...t.styleOverrides };
    }
    e.del('styles', s.id);
    return s.id;
  },

  APPLY_STYLE: (e, op) => {
    const styleId = op.payload?.styleId;
    const s = e.doc.styles[styleId] ?? fail('NOT_FOUND', `Estilo ${styleId} não existe.`);
    return targetsOf(e, op).map((id) => {
      e.assertEditable(id);
      if (s.type && s.type !== e.get(id).type) fail('VALIDATION', `O estilo "${s.name}" é para ${s.type}, não para ${e.get(id).type}.`);
      e.touchNode(id).styleId = s.id;
      return id;
    });
  },

  /** Desvincula o estilo do objeto (o estilo continua existindo no documento). */
  REMOVE_STYLE: (e, op) => targetsOf(e, op).map((id) => { e.assertEditable(id); e.touchNode(id).styleId = null; return id; }),

  CREATE_THEME: (e, op) => {
    const base = activeTheme(e);
    const { name, colors = {}, fonts = {}, defaults } = op.payload ?? {};
    if (!name) fail('INVALID_PAYLOAD', 'Dê um nome ao tema.');
    const id = e.newId('THEME');
    e.put('themes', id, { id, name, colors: { ...(base?.colors ?? {}), ...colors }, fonts: { heading: 'Arial', body: 'Arial', ...(base?.fonts ?? {}), ...fonts }, defaults: clone(defaults ?? base?.defaults ?? {}) } satisfies Theme);
    return id;
  },

  UPDATE_THEME: (e, op) => {
    const th = e.doc.themes[op.targetId ?? e.doc.document.themeId ?? ''] ?? fail('NOT_FOUND', 'Tema não existe.');
    const t = e.touch('themes', th.id) as Theme;
    const { name, colors, fonts, defaults } = op.payload ?? {};
    if (name) t.name = name;
    if (colors) t.colors = merge(t.colors, colors);
    if (fonts) t.fonts = merge(t.fonts, fonts);
    if (defaults) t.defaults = merge(t.defaults, defaults);
    return th.id;
  },

  APPLY_THEME: (e, op) => {
    const id = op.targetId ?? op.payload?.themeId;
    if (!e.doc.themes[id]) fail('NOT_FOUND', `Tema ${id} não existe.`);
    (e.touch('document', 'info') as any).themeId = id;
    return id;
  },

  /** Aparência final calculada (consulta, não altera nada). */
  RESOLVE_STYLE: (e, op) => resolveStyle(e, op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId.')),
};
