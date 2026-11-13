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
];
const BOX_PROPS = ['fill', 'stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'radius', 'shadow', 'blur', 'border'];
const LINE_PROPS = ['stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'arrowStart', 'arrowEnd', 'shadow'];
const TABLE_PROPS = ['cellPadding', 'headerFill', 'bandedRows'];

/** Propriedades de formatação que cada tipo aceita. */
export function allowedProps(type: NodeType): Set<string> {
  if (type === 'LINE') return new Set(LINE_PROPS);
  if (type === 'IMAGE' || type === 'VIDEO' || type === 'AUDIO' || type === 'BREAK') return new Set(BOX_PROPS);
  if (type === 'TABLE') return new Set([...TEXT_PROPS, ...BOX_PROPS, ...TABLE_PROPS]);
  return new Set([...TEXT_PROPS, ...BOX_PROPS]);
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(.+\)|transparent|theme:[\w.]+)$/i;

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
