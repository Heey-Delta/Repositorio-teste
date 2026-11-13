// Formatação de texto extra do editor de publicações: sobrescrito, subscrito, cor do texto, realce e alinhamento.
// No Markdown, as marcas viram HTML simples que o site exibe como está (<sup>, <sub>, <span style="color">, <mark>),
// e o alinhamento vira um bloco ":::align {value="center"} … :::" que envolve os parágrafos.
import { Mark, Node as TiptapNode, createBlockMarkdownSpec, mergeAttributes } from '@tiptap/core';

const COLOR = /^#[0-9a-f]{3,8}$/i;

/** Marca com uma tag HTML fixa; `styleProp` guarda uma cor no atributo style (ex.: color, background). */
function htmlMark(name: string, tag: string, styleProp?: string) {
  const open = new RegExp(`^<${tag}(?:\\s+style="${styleProp ?? 'x'}:\\s*(#[0-9a-fA-F]{3,8})\\s*;?")?>`, 'i');
  const close = new RegExp(`</${tag}>`, 'gi');
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
        close.lastIndex = m[0].length;
        const end = close.exec(src);
        if (!end) return undefined;
        const text = src.slice(m[0].length, end.index);
        if (!text) return undefined;
        return { type: name, raw: src.slice(0, end.index + end[0].length), text, color: m[1] ?? null, tokens: lexer.inlineTokens(text) } as any;
      },
    },
  });
}
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

export const TextExtras = [Superscript, Subscript, TextColor, Highlight, Align];
