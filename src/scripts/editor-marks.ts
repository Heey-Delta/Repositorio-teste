// Formatação de texto extra do editor de publicações: sobrescrito, subscrito, cor do texto, realce e alinhamento.
// No Markdown, as marcas viram HTML simples que o site exibe como está (<sup>, <sub>, <span style="color">, <mark>),
// e o alinhamento vira um bloco ":::align {value="center"} … :::" que envolve os parágrafos.
import { Mark, Node as TiptapNode, createBlockMarkdownSpec, mergeAttributes } from '@tiptap/core';

const COLOR = /^#[0-9a-f]{3,8}$/i;

/** Marca com uma tag HTML fixa; `styleProp` guarda uma cor no atributo style (ex.: color, background). */
function htmlMark(name: string, tag: string, styleProp?: string) {
  const open = new RegExp(`^<${tag}(?:\\s+style="${styleProp ?? 'x'}:\\s*(#[0-9a-fA-F]{3,8})\\s*;?")?>`, 'i');
  return Mark.create({
    name,
    addAttributes() {
      if (!styleProp) return {};
      return {
        color: {
          default: null,
          parseHTML: (el) => { const v = (el as HTMLElement).style.getPropertyValue(styleProp === 'background' ? 'background-color' : styleProp) || (el as HTMLElement).style.background; return v ? toHex(v) : null; },
          renderHTML: (a) => (a.color && COLOR.test(a.color) ? { style: `${styleProp}:${a.color}` } : {}),
        },
      };
    },
    parseHTML() {
      return tag === 'span' ? [{ tag: 'span', getAttrs: (el) => ((el as HTMLElement).style.color ? null : false) }] : [{ tag }];
    },
    renderHTML({ HTMLAttributes }) { return [tag, mergeAttributes(HTMLAttributes), 0]; },
    parseMarkdown(token, helpers) {
      return helpers.applyMark(name, helpers.parseInline(token.tokens || []), styleProp ? { color: (token as any).color ?? null } : undefined);
    },
    renderMarkdown(node, helpers) {
      const c = (node as any).attrs?.color;
      const style = styleProp && c && COLOR.test(c) ? ` style="${styleProp}:${c}"` : '';
      return `<${tag}${style}>${helpers.renderChildren(node)}</${tag}>`;
    },
    markdownTokenizer: {
      name, level: 'inline',
      start(src) { return src.toLowerCase().indexOf(`<${tag}`); },
      tokenize(src, _t, lexer) {
        const m = open.exec(src);
        if (!m || (tag === 'span' && !m[1])) return undefined;
        const end = closeOf(src, tag, m[0].length);
        if (!end) return undefined;
        const text = src.slice(m[0].length, end.index);
        if (!text) return undefined;
        return { type: name, raw: src.slice(0, end.index + end.length), text, color: m[1] ?? null, tokens: lexer.inlineTokens(text) } as any;
      },
    },
  });
}
/** Fechamento que corresponde à abertura (conta as tags iguais de dentro: cor dentro de fonte, por exemplo). */
function closeOf(src: string, tag: string, from: number) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1, m: RegExpExecArray | null;
  while ((m = re.exec(src))) { depth += m[1] ? -1 : 1; if (!depth) return { index: m.index, length: m[0].length }; }
  return null;
}

/** Fonte de um trecho: só Anton, Arial e Times New Roman. No Markdown: <span data-font="anton">…</span>. */
export const FONTS = [['anton', 'Anton'], ['arial', 'Arial'], ['times', 'Times New Roman']] as const;
const FONT_KEYS = FONTS.map(([k]) => k) as string[];
export const FontFamily = Mark.create({
  name: 'fontFamily',
  addAttributes() { return { font: { default: null, parseHTML: (el) => (el as HTMLElement).dataset.font ?? null, renderHTML: (a) => (FONT_KEYS.includes(a.font) ? { 'data-font': a.font } : {}) } }; },
  parseHTML() { return [{ tag: 'span[data-font]', getAttrs: (el) => (FONT_KEYS.includes((el as HTMLElement).dataset.font ?? '') ? null : false) }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0]; },
  parseMarkdown(token, helpers) { return helpers.applyMark('fontFamily', helpers.parseInline(token.tokens || []), { font: (token as any).font }); },
  renderMarkdown(node, helpers) {
    const f = (node as any).attrs?.font;
    return FONT_KEYS.includes(f) ? `<span data-font="${f}">${helpers.renderChildren(node)}</span>` : helpers.renderChildren(node);
  },
  markdownTokenizer: {
    name: 'fontFamily', level: 'inline',
    start(src) { return src.indexOf('<span data-font='); },
    tokenize(src, _t, lexer) {
      const m = /^<span data-font="(anton|arial|times)">/.exec(src);
      if (!m) return undefined;
      const end = closeOf(src, 'span', m[0].length);
      if (!end) return undefined;
      const text = src.slice(m[0].length, end.index);
      if (!text) return undefined;
      return { type: 'fontFamily', raw: src.slice(0, end.index + end.length), text, font: m[1], tokens: lexer.inlineTokens(text) } as any;
    },
  },
});

function toHex(v: string) {
  if (COLOR.test(v)) return v;
  const m = v.match(/\d+/g);
  return m && m.length >= 3 ? `#${m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : null;
}

export const Superscript = htmlMark('superscript', 'sup');
export const Subscript = htmlMark('subscript', 'sub');
export const TextColor = htmlMark('textColor', 'span', 'color');
export const Highlight = htmlMark('highlight', 'mark', 'background');

/** Bloco que alinha os parágrafos de dentro (esquerda é o padrão, então não precisa de bloco). */
export const ALIGN_VALUES = ['center', 'right', 'justify'] as const;
export const Align = TiptapNode.create({
  name: 'align', group: 'block', content: 'block+', defining: true,
  addAttributes() { return { value: { default: 'center' } }; },
  parseHTML() { return [{ tag: 'div[data-align]', getAttrs: (el) => ({ value: (el as HTMLElement).dataset.align }) }]; },
  renderHTML({ node }) { return ['div', { 'data-align': node.attrs.value, class: 'lab-align', style: `text-align:${node.attrs.value}` }, 0]; },
  ...createBlockMarkdownSpec({ nodeName: 'align', content: 'block', allowedAttributes: ['value'] }),
});

export const TextExtras = [Superscript, Subscript, TextColor, Highlight, FontFamily, Align];
