/* pieceart.js — desenho das peças. Os perfis vêm do artefato "Xadrez 5×5 — modelos 3D low poly".
 * O 3D usa os perfis em LatheGeometry; o 2D usa a mesma silhueta (perfil espelhado) em SVG,
 * para que as duas visões tenham a mesma peça. Sem emojis/fontes. */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const NS = 'http://www.w3.org/2000/svg';

  const PROF = {
    rei: [[0, 0], [19, 0], [19, 2.5], [16.5, 7], [14, 10], [15, 12.5], [15, 14], [10, 19], [7.2, 33], [6.2, 48], [9.5, 50.5], [7.5, 53], [9, 55.5], [7.2, 58], [8.8, 68], [11.5, 75.5], [11.5, 77], [6, 79.3], [0, 80]],
    dama: [[0, 0], [17.5, 0], [17.5, 2.5], [15, 6.8], [12.8, 9.5], [13.8, 11.5], [13.8, 13.3], [9.2, 18], [6.7, 31], [5.8, 43], [8.8, 45.5], [7, 48], [8.3, 50], [6.7, 52.3], [8.4, 62], [11, 68.5], [11, 70.5], [8.5, 70.5], [6, 73], [0, 73.5]],
    bispo: [[0, 0], [15.5, 0], [15.5, 2.2], [13.3, 6], [11.3, 8.5], [12.2, 10.3], [12.2, 11.8], [8.2, 16], [5.9, 27], [5.2, 35.5], [8.2, 38], [5, 41], [8.3, 46], [8.6, 48.5], [6.6, 54.5], [2.4, 58.4], [2.8, 60.5], [2.4, 63.4], [0, 65]],
    cavalo: [[0, 0], [15.5, 0], [15.5, 2.2], [13.3, 6], [11.3, 8.5], [12.2, 10.3], [12.2, 12], [10.5, 13.5], [10.5, 15.5], [10, 17], [0, 17]],
    torre: [[0, 0], [15.5, 0], [15.5, 2.2], [13.3, 6], [11.3, 8.5], [12.2, 10.3], [12.2, 12], [8.9, 16], [7.7, 29], [7.8, 33], [9.4, 35], [9.4, 36.3], [8.3, 37.3], [11.2, 41.5], [11.2, 46.5], [7.5, 46.5], [7.5, 43.5], [0, 43.5]],
    peao: [[0, 0], [13.5, 0], [13.5, 2], [11.4, 5.4], [9.6, 7.6], [10.4, 9.2], [10.4, 10.6], [6.8, 14.5], [4.6, 26], [7.6, 28.3], [5.6, 30.3], [3.2, 31.6], [6.2, 33], [7.6, 35.5], [7.6, 39.4], [6.2, 42.6], [3.4, 44.5], [0, 45]],
  };
  const HEAD = [[-10, 16], [-11.8, 23], [-12.5, 30], [-12, 38], [-10.2, 45], [-7.4, 50.5], [-4.6, 54.6], [-2.2, 58.6], [-0.8, 56.6], [0.8, 54.4], [4.5, 52.4], [8.6, 48.6], [12.2, 44.4], [14.6, 41], [15.2, 38.8], [13.4, 36], [10.8, 35.8], [12.6, 34.8], [12.2, 33.2], [9, 32.7], [5, 33.6], [3, 32], [2.6, 29], [3.8, 25.6], [6.2, 22.6], [8.6, 19.6], [10, 16]];
  const KIND_TO = { king: 'rei', queen: 'dama', bishop: 'bispo', knight: 'cavalo', rook: 'torre', pawn: 'peao' };
  const HEIGHT = { rei: 95, dama: 78, bispo: 66, cavalo: 60, torre: 50, peao: 46 };
  const COLORS = { P1: { fill: '#f0dcae', edge: '#3b2412', detail: '#24110a' }, P2: { fill: '#5c2611', edge: '#e8c58a', detail: '#e8c58a' } };

  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const silhouette = (prof) => {
    const right = prof.filter((p) => p[0] > 0 || p === prof[0]).map(([r, h]) => `${r},${-h}`);
    const left = prof.slice().reverse().filter((p) => p[0] > 0).map(([r, h]) => `${-r},${-h}`);
    return right.concat(left).join(' ');
  };

  /** SVG da peça. facingRight vira o cavalo para a direita. */
  function svg(kind, owner, facingRight) {
    const k = KIND_TO[kind];
    const c = COLORS[owner] || COLORS.P1;
    const s = svgEl('svg', { viewBox: '-26 -100 52 104', class: 'piece-svg', 'aria-hidden': 'true' });
    const g = svgEl('g', { fill: c.fill, stroke: c.edge, 'stroke-width': '1.6', 'stroke-linejoin': 'round' });
    s.append(g);
    if (k === 'cavalo') {
      g.append(svgEl('polygon', { points: silhouette(PROF.cavalo) }));
      const flip = facingRight ? 1 : -1;
      g.append(svgEl('polygon', { points: HEAD.map(([x, y]) => `${x * flip},${-y}`).join(' ') }));
      g.append(svgEl('circle', { cx: 6.3 * flip, cy: -47.2, r: 1.4, fill: c.detail, stroke: 'none' }));
    } else {
      g.append(svgEl('polygon', { points: silhouette(PROF[k]) }));
      if (k === 'rei') {
        g.append(svgEl('rect', { x: -2.25, y: -95, width: 4.5, height: 15, rx: 0.6 }));
        g.append(svgEl('rect', { x: -6, y: -91, width: 12, height: 4, rx: 0.6 }));
      } else if (k === 'dama') {
        for (const x of [-9.4, -4.7, 0, 4.7, 9.4]) g.append(svgEl('circle', { cx: x, cy: -72.5, r: 2 }));
        g.append(svgEl('circle', { cx: 0, cy: -76.8, r: 3.2 }));
      } else if (k === 'torre') {
        for (const [x0, x1] of [[-11.2, -4.6], [-2.4, 2.4], [4.6, 11.2]]) g.append(svgEl('rect', { x: x0, y: -50, width: x1 - x0, height: 4.2 }));
      } else if (k === 'bispo') {
        g.append(svgEl('line', { x1: -6.3, y1: -52.5, x2: 2.6, y2: -44.3, stroke: c.detail, 'stroke-width': 1.4 }));
      }
    }
    return s;
  }

  PGL.pieceArt = { PROF, HEAD, KIND_TO, HEIGHT, svg };
})(typeof window !== 'undefined' ? window : globalThis);
