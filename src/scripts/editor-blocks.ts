// Blocos extras do editor de publicações: círculo de destaque (a tabela vem do TableKit do Tiptap).
import { Node as TiptapNode, createAtomBlockMarkdownSpec } from '@tiptap/core';
import { CIRCLE_DEFAULT, circleInk, parseCircleAttrs, serializeCircleAttrs } from '../lib/circle-block';

// ---------- círculo de destaque (mesma sintaxe e mesmo desenho do site: src/lib/circle-block.ts) ----------
export const Circle = TiptapNode.create({
  name: 'circle', group: 'block', atom: true, draggable: true, selectable: true,
  addAttributes() {
    return { text: { default: CIRCLE_DEFAULT.text }, color: { default: CIRCLE_DEFAULT.color }, size: { default: CIRCLE_DEFAULT.size } };
  },
  parseHTML() {
    return [{ tag: 'div[data-circle]', getAttrs: (el) => parseCircleAttrs(`text="${(el as HTMLElement).dataset.text ?? ''}" color="${(el as HTMLElement).dataset.color ?? ''}" size="${(el as HTMLElement).dataset.size ?? ''}"`) }];
  },
  renderHTML({ node }) {
    const { text, color, size } = node.attrs as { text: string; color: string; size: number };
    return ['div', { 'data-circle': '', 'data-text': text, 'data-color': color, 'data-size': String(size), class: 'lab-circle', role: 'img', 'aria-label': text || 'Círculo', style: `--c:${color};--s:${size}px;color:${circleInk(color)}` }, ['span', {}, text]];
  },
  ...createAtomBlockMarkdownSpec({ nodeName: 'circle', parseAttributes: (src) => parseCircleAttrs(src), serializeAttributes: (a) => serializeCircleAttrs(a) }),
});

/** Pergunta texto, cor e tamanho do círculo (para inserir ou editar). */
export function askCircle(cur = CIRCLE_DEFAULT) {
  const text = window.prompt('Texto dentro do círculo (ex.: 112%)', cur.text);
  if (text === null) return null;
  const color = window.prompt('Cor (ex.: #FBBF00 amarelo, #2563EB azul, #16A34A verde)', cur.color);
  if (color === null) return null;
  const size = window.prompt('Tamanho em pixels (60 a 400)', String(cur.size));
  if (size === null) return null;
  return parseCircleAttrs(serializeCircleAttrs({ text, color: color.trim(), size: Number(size) }));
}

