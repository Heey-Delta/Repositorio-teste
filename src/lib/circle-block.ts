// Círculo de destaque nas publicações do Lab. No Markdown fica numa linha própria:
//   :::circle {text="112%" color="#FBBF00" size="180"} :::
// O editor (Tiptap) e o site (marked) usam estas mesmas funções, então o que se vê no editor é o que vai ao ar.
export interface CircleAttrs { text: string; color: string; size: number }
export const CIRCLE_DEFAULT: CircleAttrs = { text: '', color: '#FBBF00', size: 160 };
export const CIRCLE_RE = /^ {0,3}:::circle(?:\s+\{([^}]*)\})?\s*:::(?:\n|$)/;

const unq = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const q = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function parseCircleAttrs(src: string): CircleAttrs {
  const a: Record<string, string> = {};
  for (const m of src.matchAll(/(\w+)="([^"]*)"/g)) a[m[1]] = unq(m[2]);
  const color = /^#[0-9a-f]{3,8}$/i.test(a.color ?? '') ? a.color : CIRCLE_DEFAULT.color;
  const size = Math.min(400, Math.max(60, Number(a.size) || CIRCLE_DEFAULT.size));
  return { text: (a.text ?? '').slice(0, 80), color, size };
}
export const serializeCircleAttrs = (a: Partial<CircleAttrs>) => `text="${q(String(a.text ?? ''))}" color="${q(String(a.color ?? CIRCLE_DEFAULT.color))}" size="${Number(a.size ?? CIRCLE_DEFAULT.size)}"`;
export const circleMarkdown = (a: Partial<CircleAttrs>) => `:::circle {${serializeCircleAttrs(a)}} :::`;

/** Texto escuro em fundo claro e vice-versa (contraste). */
export function circleInk(hex: string) {
  const h = hex.replace('#', ''), f = h.length < 6 ? h.slice(0, 3).split('').map((x) => x + x).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#FFFFFF';
}
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function circleHtml(a: CircleAttrs) {
  return `<div class="lab-circle" role="img" aria-label="${esc(a.text || 'Círculo')}" style="--c:${a.color};--s:${a.size}px;color:${circleInk(a.color)}"><span>${esc(a.text)}</span></div>`;
}
