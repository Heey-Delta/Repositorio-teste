// Biblioteca única de formas: o mesmo desenho na tela (documentos, slides), no SVG/PDF exportado e nas publicações.
// Cada forma é um caminho SVG numa caixa 0..100 × 0..100 que estica para o tamanho do objeto.
// shapeD() devolve o caminho já na posição e tamanho finais (os arcos esticam junto, pois não têm rotação).

export const SHAPES: Record<string, { label: string; d: string; square?: boolean; open?: boolean }> = {
  RECTANGLE: { label: 'Retângulo', d: 'M0,0 H100 V100 H0 Z' },
  SQUARE: { label: 'Quadrado', d: 'M0,0 H100 V100 H0 Z', square: true },
  ROUNDED_RECTANGLE: { label: 'Retângulo arredondado', d: 'M14,0 H86 Q100,0 100,14 V86 Q100,100 86,100 H14 Q0,100 0,86 V14 Q0,0 14,0 Z' },
  CIRCLE: { label: 'Círculo', d: 'M0,50 A50,50 0 1 1 100,50 A50,50 0 1 1 0,50 Z', square: true },
  ELLIPSE: { label: 'Elipse', d: 'M0,50 A50,50 0 1 1 100,50 A50,50 0 1 1 0,50 Z' },
  TRIANGLE: { label: 'Triângulo', d: 'M50,0 L100,100 L0,100 Z' },
  RIGHT_TRIANGLE: { label: 'Triângulo retângulo', d: 'M0,0 L0,100 L100,100 Z' },
  DIAMOND: { label: 'Losango', d: 'M50,0 L100,50 L50,100 L0,50 Z' },
  PARALLELOGRAM: { label: 'Paralelogramo', d: 'M22,0 L100,0 L78,100 L0,100 Z' },
  TRAPEZOID: { label: 'Trapézio', d: 'M22,0 L78,0 L100,100 L0,100 Z' },
  PENTAGON: { label: 'Pentágono', d: 'M50,0 L100,38 L81,100 L19,100 L0,38 Z' },
  HEXAGON: { label: 'Hexágono', d: 'M25,0 L75,0 L100,50 L75,100 L25,100 L0,50 Z' },
  OCTAGON: { label: 'Octógono', d: 'M29,0 L71,0 L100,29 L100,71 L71,100 L29,100 L0,71 L0,29 Z', square: true },
  STAR: { label: 'Estrela', d: 'M50,0 L61,35 L98,35 L68,57 L79,92 L50,71 L21,92 L32,57 L2,35 L39,35 Z', square: true },
  STAR6: { label: 'Estrela de 6 pontas', d: 'M50,0 L62,27 L93,25 L75,50 L93,75 L62,73 L50,100 L38,73 L7,75 L25,50 L7,25 L38,27 Z', square: true },
  ARROW: { label: 'Seta para a direita', d: 'M0,30 L62,30 L62,3 L100,50 L62,97 L62,70 L0,70 Z' },
  ARROW_LEFT: { label: 'Seta para a esquerda', d: 'M100,30 L38,30 L38,3 L0,50 L38,97 L38,70 L100,70 Z' },
  ARROW_UP: { label: 'Seta para cima', d: 'M30,100 L30,38 L3,38 L50,0 L97,38 L70,38 L70,100 Z' },
  ARROW_DOWN: { label: 'Seta para baixo', d: 'M30,0 L30,62 L3,62 L50,100 L97,62 L70,62 L70,0 Z' },
  DOUBLE_ARROW: { label: 'Seta dupla', d: 'M0,50 L25,8 L25,32 L75,32 L75,8 L100,50 L75,92 L75,68 L25,68 L25,92 Z' },
  CHEVRON: { label: 'Divisa', d: 'M0,0 L70,0 L100,50 L70,100 L0,100 L30,50 Z' },
  CALLOUT: { label: 'Balão de fala', d: 'M8,0 H92 Q100,0 100,8 V62 Q100,70 92,70 H42 L22,100 L26,70 H8 Q0,70 0,62 V8 Q0,0 8,0 Z' },
  CLOUD: { label: 'Nuvem', d: 'M25,86 Q1,86 3,64 Q4,47 22,46 Q20,20 44,19 Q58,2 75,19 Q98,17 97,42 Q100,63 84,72 Q86,87 66,86 Z' },
  HEART: { label: 'Coração', d: 'M50,96 C18,73 0,53 0,30 C0,12 14,2 29,2 C40,2 47,9 50,18 C53,9 60,2 71,2 C86,2 100,12 100,30 C100,53 82,73 50,96 Z', square: true },
  CROSS: { label: 'Cruz', d: 'M34,0 L66,0 L66,34 L100,34 L100,66 L66,66 L66,100 L34,100 L34,66 L0,66 L0,34 L34,34 Z', square: true },
  LIGHTNING: { label: 'Raio', d: 'M58,0 L13,56 L44,56 L33,100 L87,38 L55,38 L71,0 Z' },
  MOON: { label: 'Lua', d: 'M70,2 A50,50 0 1 0 70,98 A38,48 0 1 1 70,2 Z' },
  DOCUMENT: { label: 'Documento (fluxograma)', d: 'M0,0 H100 V86 Q75,70 50,86 Q25,100 0,86 Z' },
  CYLINDER: { label: 'Cilindro (banco de dados)', d: 'M0,12 A50,12 0 0 1 100,12 V88 A50,12 0 0 1 0,88 Z M0,12 A50,12 0 0 0 100,12' },
  LINE: { label: 'Linha', d: 'M0,50 L100,50', open: true },
};
/** Nomes antigos e das publicações → nomes do motor. */
export const SHAPE_ALIASES: Record<string, string> = { ROUNDED: 'ROUNDED_RECTANGLE', ARROW_RIGHT: 'ARROW' };
export const shapeKind = (k: string | undefined) => (k && SHAPES[k] ? k : k && SHAPE_ALIASES[k] ? SHAPE_ALIASES[k] : 'RECTANGLE');

/** Polígono regular de n lados (POLYGON { sides }). */
export function polygonD(sides: number) {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  return Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return `${i ? 'L' : 'M'}${round(50 + 50 * Math.cos(a))},${round(50 + 50 * Math.sin(a))}`; }).join(' ') + ' Z';
}
const round = (v: number) => Math.round(v * 100) / 100;

/** Estica um caminho 0..100 para a caixa (x, y, w, h). Aceita comandos absolutos M L H V Q C A Z. */
export function fitPath(d: string, x: number, y: number, w: number, h: number) {
  const sx = w / 100, sy = h / 100;
  const tokens = d.match(/[MLHVQCAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: string[] = [];
  let cmd = '', args: number[] = [];
  const need: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, Z: 0 };
  const flush = () => {
    if (!cmd) return;
    const n = need[cmd.toUpperCase()];
    if (n === 0) { out.push('Z'); return; }
    for (let i = 0; i + n <= args.length; i += n) {
      const a = args.slice(i, i + n);
      const C = cmd.toUpperCase();
      const X = (v: number) => round(x + v * sx), Y = (v: number) => round(y + v * sy);
      if (C === 'H') out.push(`H${X(a[0])}`);
      else if (C === 'V') out.push(`V${Y(a[0])}`);
      else if (C === 'A') out.push(`A${round(a[0] * sx)},${round(a[1] * sy)} ${a[2]} ${a[3]} ${a[4]} ${X(a[5])},${Y(a[6])}`);
      else out.push(C + a.map((v, k) => (k % 2 === 0 ? X(v) : Y(v))).join(','));
    }
  };
  for (const t of tokens) {
    if (/^[a-z]$/i.test(t)) { flush(); cmd = t; args = []; if (t.toUpperCase() === 'Z') { flush(); cmd = ''; } }
    else args.push(Number(t));
  }
  flush();
  return out.join(' ');
}

/** Caminho final de uma forma do motor. */
export function shapeD(kind: string | undefined, x: number, y: number, w: number, h: number, extra?: { path?: string; sides?: number }) {
  if (kind === 'CUSTOM' && extra?.path) return fitPath(extra.path, x, y, w, h);
  if (kind === 'POLYGON') return fitPath(polygonD(extra?.sides ?? 8), x, y, w, h);
  return fitPath(SHAPES[shapeKind(kind)].d, x, y, w, h);
}

/** Pontos de um caminho (para editar pontos / operações booleanas): só os vértices de M e L. */
export function pathPoints(d: string): [number, number][] {
  const pts: [number, number][] = [];
  for (const m of d.matchAll(/[ML]\s*(-?\d*\.?\d+)[ ,]+(-?\d*\.?\d+)/gi)) pts.push([Number(m[1]), Number(m[2])]);
  return pts;
}
export const pointsPath = (pts: [number, number][], closed = true) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${round(px)},${round(py)}`).join(' ') + (closed ? ' Z' : '');

export interface ShapeGeometry { shapeType?: string; path?: string; sides?: number; boolean?: { mode: BooleanMode; parts: string[] } }
export const BOOLEAN_MODES = ['UNION', 'COMBINE', 'SUBTRACT', 'INTERSECT'] as const;
export type BooleanMode = (typeof BOOLEAN_MODES)[number];
let uid = 0;
/**
 * Elementos SVG da forma numa caixa (0,0)–(w,h). Formas combinadas (operações booleanas) guardam as partes e são
 * desenhadas assim: unir = contornos por baixo e preenchimentos por cima (as linhas internas somem); combinar =
 * regra par-ímpar (a sobreposição vira buraco); subtrair = máscara; interseção = recorte encadeado.
 */
export function shapeSvg(g: ShapeGeometry, w: number, h: number, look: { fill?: string; stroke?: string; strokeWidth?: number; dash?: string }) {
  const fill = look.fill ?? '#4472C4', sw = look.stroke ? look.strokeWidth ?? 2 : 0;
  const strokeAttr = (k = 1) => (look.stroke ? ` stroke="${look.stroke}" stroke-width="${sw * k}"${look.dash ? ` stroke-dasharray="${look.dash}"` : ''} stroke-linejoin="round"` : '');
  const fit = (d: string) => fitPath(d, 0, 0, w, h);
  if (g.boolean?.parts.length) {
    const parts = g.boolean.parts.map(fit);
    const id = `bo${++uid}`;
    switch (g.boolean.mode) {
      case 'COMBINE': return `<path d="${parts.join(' ')}" fill="${fill}" fill-rule="evenodd"${strokeAttr()}/>`;
      case 'SUBTRACT': return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-10%" y="-10%" width="120%" height="120%"><rect x="-${w}" y="-${h}" width="${w * 3}" height="${h * 3}" fill="#fff"/>${parts.slice(1).map((d) => `<path d="${d}" fill="#000"/>`).join('')}</mask></defs><path d="${parts[0]}" fill="${fill}"${strokeAttr()} mask="url(#${id})"/>`;
      case 'INTERSECT': {
        const defs = parts.slice(1).map((d, i) => `<clipPath id="${id}c${i}"><path d="${d}"/></clipPath>`).join('');
        let inner = `<path d="${parts[0]}" fill="${fill}"${strokeAttr()}/>`;
        parts.slice(1).forEach((_, i) => { inner = `<g clip-path="url(#${id}c${i})">${inner}</g>`; });
        return `<defs>${defs}</defs>${inner}`;
      }
      default: return `${look.stroke ? parts.map((d) => `<path d="${d}" fill="none"${strokeAttr(2)}/>`).join('') : ''}${parts.map((d) => `<path d="${d}" fill="${fill}"/>`).join('')}`;
    }
  }
  const kind = g.shapeType === 'CUSTOM' || g.shapeType === 'POLYGON' ? g.shapeType : shapeKind(g.shapeType);
  const d = shapeD(kind, 0, 0, w, h, g);
  if (kind !== 'CUSTOM' && SHAPES[kind]?.open) return `<path d="${d}" fill="none" stroke="${look.stroke ?? fill}" stroke-width="${look.strokeWidth ?? 3}"${look.dash ? ` stroke-dasharray="${look.dash}"` : ''}/>`;
  return `<path d="${d}" fill="${fill}"${strokeAttr()}/>`;
}
