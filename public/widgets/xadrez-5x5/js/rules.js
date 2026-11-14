/* rules.js — conjunto de regras da sessão (project.md v0.3).
 * Todos os números são inteiros. Fichas em UNIDADES DE MEIA FICHA (1 ficha = 2 unidades). */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});

  const KINDS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  const VALUE = { pawn: 1, knight: 2, bishop: 2, rook: 3, queen: 4, king: 5 };

  /* Bônus logarítmico pré-calculado: T[c] = round(50 × log2(1 + c)), c = fichas inteiras no pote.
   * Fixo na tabela (sem Math.log em jogo) para ser idêntico em todos os navegadores. */
  const BONUS_PCT = [0, 50, 79, 100, 116, 129, 140, 150, 158, 166, 173, 179, 185, 190, 195, 200, 204, 208, 212, 216, 220];

  /* Sorteio: intervalo uniforme 0..13999 (seção 5.3). */
  const DRAW_TABLE = [
    { upTo: 5399, kind: 'pawn' },
    { upTo: 8099, kind: 'knight' },
    { upTo: 10799, kind: 'bishop' },
    { upTo: 12599, kind: 'rook' },
    { upTo: 13999, kind: 'queen' },
  ];

  const RULES = {
    id: 'pgl-rules-0.3',
    board: 5,
    energyStart: 10,
    energyMax: 15,
    chipsStartUnits: 6, // 3 fichas
    chipsPerTurnUnits: 2, // +1 ficha por turno próprio
    energyPerTurn: 1,
    buyChipsUnits: 4, // 2 fichas por sorteio
    buyEnergy: 1,
    moveEnergy: 1,
    kingMoveEnergy: 0,
    attackEnergy: 1,
    stakeMaxUnits: 40, // 20 fichas
    buyinMaxUnits: 20, // 10 fichas trazidas da carteira
    maxDrawsPerTurn: 5,
    placementRadius: 2,
    kingStart: { P1: 'A3', P2: 'E3' },
    value: VALUE,
    bonusPct: BONUS_PCT,
    drawTable: DRAW_TABLE,
    drawModulo: 14000,
    drawThreshold: 4294962000, // maior múltiplo de 14000 ≤ 2^32
  };

  function maxHp(kind) { return 2 * VALUE[kind]; }
  function baseDamage(kind) { return VALUE[kind]; }
  /** Dano total com bônus do pote (seção 4.6.3). potUnits em meias-fichas. */
  function damage(kind, potUnits) {
    const c = Math.min(Math.floor(potUnits / 2), BONUS_PCT.length - 1);
    const v = VALUE[kind];
    return v + Math.floor((v * BONUS_PCT[c]) / 100);
  }

  /** Hash do conjunto de regras: entra em #rules e prova que os dois usam as mesmas regras. */
  function rulesHash() {
    const lines = [];
    const keys = Object.keys(RULES).sort();
    for (const k of keys) lines.push(k + '=' + JSON.stringify(RULES[k]));
    return PGL.util.sha256Hex('PGL1/RULES\n' + lines.join('\n'));
  }

  PGL.rules = { KINDS, VALUE, RULES, maxHp, baseDamage, damage, rulesHash };
})(typeof window !== 'undefined' ? window : globalThis);
