/* engine.js — motor de regras determinístico (project.md §3–§9, §15).
 *
 * Funções puras: recebem um estado, devolvem um NOVO estado ou lançam RuleError(código).
 * Os dois clientes executam exatamente este código sobre os mesmos documentos aceitos
 * e chegam ao mesmo estado público (conferido por stateHash).
 * Só inteiros. Fichas em meias-fichas (unidades).
 */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const U = PGL.util;
  const RU = PGL.rules;
  const R = RU.RULES;
  const C = PGL.crypto;

  class RuleError extends Error {
    constructor(code, msg) { super(msg || code); this.code = code; }
  }
  const fail = (code, msg) => { throw new RuleError(code, msg); };

  const COLS = 'ABCDE';
  function toXY(coord) { return { x: COLS.indexOf(coord[0]), y: +coord[1] - 1 }; }
  function toCoord(x, y) { return COLS[x] + (y + 1); }
  function inBoard(x, y) { return x >= 0 && x < 5 && y >= 0 && y < 5; }
  const other = (p) => (p === 'P1' ? 'P2' : 'P1');
  const clone = (s) => JSON.parse(JSON.stringify(s));

  /* ---------------- Estado inicial ---------------- */
  function initialState({ session, ids, kingIds, buyins }) {
    const s = {
      v: 1,
      session,
      rules: RU.rulesHash(),
      phase: 'play',
      turn: 1,
      active: 'P1',
      winner: null,
      pending: null,
      players: {},
      pieces: {},
    };
    for (const p of ['P1', 'P2']) {
      s.players[p] = { id: ids[p], energy: R.energyStart, free: R.chipsStartUnits + (buyins[p] || 0), pot: 0, gold: 0, buyin: buyins[p] || 0, hidden: [], revealed: [] };
      s.pieces[kingIds[p]] = { id: kingIds[p], kind: 'king', owner: p, pos: R.kingStart[p], hp: RU.maxHp('king') };
    }
    return beginTurn(s);
  }

  /** Recuperação no início do turno do jogador ativo (§4.2, incluindo o primeiro turno). */
  function beginTurn(s) {
    const pl = s.players[s.active];
    pl.energy = Math.min(R.energyMax, pl.energy + R.energyPerTurn);
    pl.free += R.chipsPerTurnUnits;
    return s;
  }

  /* ---------------- Consultas ---------------- */
  function board(s) {
    const m = {};
    for (const id in s.pieces) m[s.pieces[id].pos] = s.pieces[id];
    return m;
  }
  function kingOf(s, p) {
    for (const id in s.pieces) if (s.pieces[id].owner === p && s.pieces[id].kind === 'king') return s.pieces[id];
    return null;
  }
  function pathClear(bd, from, dx, dy, dist) {
    for (let i = 1; i < dist; i++) if (bd[toCoord(from.x + dx * i, from.y + dy * i)]) return false;
    return true;
  }
  /** Geometria de alcance: igual para mover e atacar, exceto o peão. */
  function reaches(bd, piece, toC, mode) {
    const a = toXY(piece.pos), b = toXY(toC);
    if (!inBoard(b.x, b.y)) return false;
    const dx = b.x - a.x, dy = b.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx === 0 && ady === 0) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    switch (piece.kind) {
      case 'pawn': {
        const dir = piece.owner === 'P1' ? 1 : -1;
        if (mode === 'move') return dx === dir && dy === 0;
        return dx === 0 && ady === 1; // ataque lateral (§7.3)
      }
      case 'knight': return (adx === 1 && ady === 2) || (adx === 2 && ady === 1);
      case 'bishop': return adx === ady && adx <= 2 && pathClear(bd, a, sx, sy, adx);
      case 'rook': return (adx === 0 || ady === 0) && Math.max(adx, ady) <= 3 && pathClear(bd, a, sx, sy, Math.max(adx, ady));
      case 'queen': {
        const straight = adx === 0 || ady === 0 || adx === ady;
        const d = Math.max(adx, ady);
        return straight && d <= 4 && pathClear(bd, a, sx, sy, d);
      }
      case 'king': return Math.max(adx, ady) === 1;
    }
    return false;
  }
  function legalMoves(s, pieceId) {
    const pc = s.pieces[pieceId];
    if (!pc) return [];
    const bd = board(s);
    const out = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      const c = toCoord(x, y);
      if (!bd[c] && reaches(bd, pc, c, 'move')) out.push(c);
    }
    return out;
  }
  function legalAttacks(s, pieceId) {
    const pc = s.pieces[pieceId];
    if (!pc) return [];
    const bd = board(s);
    const out = [];
    for (const id in s.pieces) {
      const t = s.pieces[id];
      if (t.owner !== pc.owner && reaches(bd, pc, t.pos, 'attack')) out.push(t.id);
    }
    return out;
  }
  function placementSquares(s, player) {
    const k = kingOf(s, player);
    if (!k) return [];
    const kp = toXY(k.pos);
    const bd = board(s);
    const out = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      const c = toCoord(x, y);
      if (!bd[c] && Math.max(Math.abs(x - kp.x), Math.abs(y - kp.y)) <= R.placementRadius) out.push(c);
    }
    return out;
  }
  function damageOf(s, piece) { return RU.damage(piece.kind, s.players[piece.owner].pot); }

  function usedDrawIds(s) {
    const set = new Set();
    for (const p of ['P1', 'P2']) {
      for (const h of s.players[p].hidden) set.add(h.drawId);
      for (const r of s.players[p].revealed) set.add(r);
    }
    if (s.pending) for (const d of s.pending.draws) set.add(d.drawId);
    return set;
  }

  /* ---------------- Sorteio (draw_request / draw_seed) ---------------- */
  function applyDrawRequest(s0, sender, draws) {
    const s = clone(s0);
    if (s.phase !== 'play') fail('game_already_finished');
    if (sender !== s.active) fail('not_your_turn');
    if (s.pending) fail('invalid_draw', 'já existe sorteio neste turno');
    if (!draws.length || draws.length > R.maxDrawsPerTurn) fail('invalid_draw');
    const used = usedDrawIds(s);
    const ids = new Set();
    for (const d of draws) {
      if (used.has(d.drawId) || ids.has(d.drawId)) fail('invalid_draw', 'draw_id repetido');
      ids.add(d.drawId);
    }
    const pl = s.players[sender];
    if (pl.free < R.buyChipsUnits * draws.length) fail('insufficient_chips');
    if (pl.energy < R.buyEnergy * draws.length) fail('insufficient_energy');
    s.pending = { player: sender, draws: draws.map((d) => ({ drawId: d.drawId, commit: d.commit, seed: null })) };
    return s;
  }
  function applyDrawSeed(s0, sender, seeds) {
    const s = clone(s0);
    if (!s.pending || sender !== other(s.pending.player)) fail('invalid_draw');
    if (s.pending.draws.some((d) => d.seed)) fail('invalid_draw', 'sementes já enviadas');
    if (seeds.length !== s.pending.draws.length) fail('invalid_draw');
    seeds.forEach((sd, i) => {
      if (sd.drawId !== s.pending.draws[i].drawId) fail('invalid_draw');
      s.pending.draws[i].seed = sd.seed;
    });
    return s;
  }

  /* ---------------- Turno ---------------- */
  function transfer(s, victim, killer, units) {
    const v = s.players[victim], k = s.players[killer];
    const fromPot = Math.min(v.pot, units);
    v.pot -= fromPot;
    const fromFree = Math.min(v.free, units - fromPot);
    v.free -= fromFree;
    k.free += fromPot + fromFree;
  }

  /**
   * turn = { stake: {add,total} | null, actions: [ {type:'buy', draws:[drawId]} |
   *   {type:'move', piece, from, to, reveal:{drawId,kind,secret}|null} |
   *   {type:'attack', piece, from, target, at} ] }
   * Simula tudo numa cópia; qualquer erro rejeita o turno inteiro (§3.4).
   */
  function applyTurn(s0, sender, turn, opts) {
    const s = clone(s0);
    if (s.phase !== 'play') fail('game_already_finished');
    if (sender !== s.active) fail('not_your_turn');
    const me = s.players[sender];
    const foe = other(sender);

    if (turn.actions.length > 3) fail('too_many_actions');
    const types = turn.actions.map((a) => a.type);
    if (new Set(types).size !== types.length) fail('duplicate_action');

    // Aposta (parâmetro de medição) — processada antes das ações.
    if (turn.stake) {
      const { add, total } = turn.stake;
      if (!(add > 0)) fail('stake_mismatch');
      if (add > me.free) fail('insufficient_chips');
      if (total !== me.pot + add) fail('stake_mismatch');
      if (total > R.stakeMaxUnits) fail('stake_limit_exceeded');
      me.free -= add;
      me.pot = total;
    }

    // Sorteios pedidos neste turno precisam ser liquidados por @buy.
    const buy = turn.actions.find((a) => a.type === 'buy');
    if (s.pending) {
      if (s.pending.player !== sender || s.pending.draws.some((d) => !d.seed)) fail('invalid_draw');
      if (!buy) fail('unsettled_draw');
      const want = s.pending.draws.map((d) => d.drawId).join(',');
      if (buy.draws.join(',') !== want) fail('unsettled_draw');
    } else if (buy) fail('unsettled_draw', '@buy sem draw_request aceito');

    for (const a of turn.actions) {
      if (s.phase !== 'play') fail('game_already_finished');
      if (a.type === 'buy') {
        const n = a.draws.length;
        if (me.free < R.buyChipsUnits * n) fail('insufficient_chips');
        if (me.energy < R.buyEnergy * n) fail('insufficient_energy');
        me.free -= R.buyChipsUnits * n;
        me.energy -= R.buyEnergy * n;
        for (const d of s.pending.draws) me.hidden.push({ drawId: d.drawId, commit: d.commit, seed: d.seed });
        s.pending = null;
      } else if (a.type === 'move') {
        const bd = board(s);
        if (!/^[A-E][1-5]$/.test(a.to)) fail('invalid_position');
        if (bd[a.to]) fail('illegal_move', 'destino ocupado');
        if (a.from === 'inv') {
          const rv = a.reveal;
          if (!rv) fail('invalid_reveal');
          const idx = me.hidden.findIndex((h) => h.drawId === rv.drawId);
          if (idx < 0) fail(me.revealed.includes(rv.drawId) ? 'card_already_revealed' : 'invalid_piece');
          const h = me.hidden[idx];
          if (C.drawCommit(s.session, rv.drawId, rv.secret) !== h.commit) fail('invalid_reveal');
          if (C.drawKind(s.session, rv.drawId, rv.secret, h.seed) !== rv.kind) fail('invalid_draw');
          if (C.drawPieceId(s.session, rv.drawId, rv.secret) !== a.piece) fail('invalid_reveal');
          if (s.pieces[a.piece]) fail('invalid_piece');
          if (!placementSquares(s, sender).includes(a.to)) fail('invalid_position', 'longe do rei');
          if (me.energy < R.moveEnergy) fail('insufficient_energy');
          me.energy -= R.moveEnergy;
          me.hidden.splice(idx, 1);
          me.revealed.push(rv.drawId);
          s.pieces[a.piece] = { id: a.piece, kind: rv.kind, owner: sender, pos: a.to, hp: RU.maxHp(rv.kind) };
        } else {
          if (a.reveal) fail('invalid_schema');
          const pc = s.pieces[a.piece];
          if (!pc || pc.owner !== sender) fail('invalid_piece');
          if (pc.pos !== a.from) fail('invalid_position');
          if (!reaches(bd, pc, a.to, 'move')) fail('illegal_move');
          const cost = pc.kind === 'king' ? R.kingMoveEnergy : R.moveEnergy;
          if (me.energy < cost) fail('insufficient_energy');
          me.energy -= cost;
          pc.pos = a.to;
        }
      } else if (a.type === 'attack') {
        const bd = board(s);
        const pc = s.pieces[a.piece];
        if (!pc || pc.owner !== sender) fail('invalid_piece');
        if (pc.pos !== a.from) fail('invalid_position');
        const tg = s.pieces[a.target];
        if (!tg || tg.owner === sender || tg.pos !== a.at) fail('illegal_attack');
        if (!reaches(bd, pc, tg.pos, 'attack')) fail('illegal_attack');
        if (me.energy < R.attackEnergy) fail('insufficient_energy');
        me.energy -= R.attackEnergy;
        tg.hp -= damageOf(s, pc);
        if (tg.hp <= 0) {
          delete s.pieces[tg.id];
          transfer(s, foe, sender, 2 * RU.VALUE[tg.kind]);
          pc.pos = a.at; // captura: atacante ocupa a casa (§9.1)
          if (tg.kind === 'king') {
            s.phase = 'finished';
            s.winner = sender;
            me.free += me.pot + s.players[foe].pot; // vencedor leva o pote do perdedor (§4.6.5)
            me.pot = 0;
            s.players[foe].pot = 0;
            me.gold += 1; // ficha dourada do rei derrotado
          }
        }
      } else fail('unknown_command');
    }

    if (s.phase === 'play' && !(opts && opts.preview)) {
      s.active = foe;
      s.turn += 1;
      beginTurn(s);
    }
    return s;
  }

  /* ---------------- Hash do estado público (§15.3) ---------------- */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('estado com número não inteiro');
    return JSON.stringify(v);
  }
  function stateHash(s) { return U.sha256Hex('PGL1/STATE\n' + canon(s)); }

  PGL.engine = {
    RuleError, toXY, toCoord, other, clone, initialState, board, kingOf, legalMoves, legalAttacks,
    placementSquares, damageOf, applyDrawRequest, applyDrawSeed, applyTurn, stateHash, canon,
  };
})(typeof window !== 'undefined' ? window : globalThis);
