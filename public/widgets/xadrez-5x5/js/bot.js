/* bot.js — oponente local. É um cliente completo: tem chaves próprias e joga pelo mesmo
 * protocolo PGL (assina, pede sorteio, revela cartas). A estratégia é gulosa e simples. */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const E = PGL.engine, RU = PGL.rules;

  function attach(session, opts) {
    const delay = (opts && opts.delay) != null ? opts.delay : 700;
    let thinking = false;
    let drewThisTurn = -1;

    const myPieces = (s) => Object.values(s.pieces).filter((p) => p.owner === session.role);
    const dist = (a, b) => { const A = E.toXY(a), B = E.toXY(b); return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y)); };

    function tryPreview(turn) { try { return session.preview(turn); } catch (e) { return null; } }

    function bestAttack(s, turn) {
      let best = null;
      for (const pc of myPieces(s)) {
        for (const tid of E.legalAttacks(s, pc.id)) {
          const tg = s.pieces[tid];
          const dmg = E.damageOf(s, pc);
          const kills = dmg >= tg.hp;
          const score = (tg.kind === 'king' ? (kills ? 10000 : 300 + dmg * 10) : (kills ? 100 + RU.VALUE[tg.kind] * 20 : dmg * 5)) - RU.VALUE[pc.kind];
          const a = { type: 'attack', piece: pc.id, from: pc.pos, target: tid, at: tg.pos };
          if (!tryPreview({ stake: turn.stake, actions: [...turn.actions, a] })) continue;
          if (!best || score > best.score) best = { score, a };
        }
      }
      return best;
    }

    function bestMove(s, turn) {
      const foeKing = E.kingOf(s, E.other(session.role));
      const myKing = E.kingOf(s, session.role);
      let best = null;
      // 1) posicionar uma carta da mão, o mais perto possível do rei inimigo
      for (const card of session.myCards()) {
        for (const sq of E.placementSquares(s, session.role)) {
          const a = session.placeAction(card.drawId, sq);
          const score = 50 + RU.VALUE[card.kind] * 5 - dist(sq, foeKing.pos) * 4;
          if (!tryPreview({ stake: turn.stake, actions: [...turn.actions, a] })) continue;
          if (!best || score > best.score) best = { score, a };
        }
      }
      // 2) avançar uma peça (não o rei) em direção ao rei inimigo
      for (const pc of myPieces(s)) {
        if (pc.kind === 'king') continue;
        for (const sq of E.legalMoves(s, pc.id)) {
          const gain = dist(pc.pos, foeKing.pos) - dist(sq, foeKing.pos);
          if (gain <= 0) continue;
          const a = { type: 'move', piece: pc.id, from: pc.pos, to: sq };
          const after = tryPreview({ stake: turn.stake, actions: [...turn.actions, a] });
          if (!after) continue;
          const canHitNext = E.legalAttacks(after, pc.id).length;
          const score = 20 + gain * 6 + canHitNext * 8;
          if (!best || score > best.score) best = { score, a };
        }
      }
      // 3) rei foge se estiver ameaçado e sem nada melhor
      if (!best && myKing) {
        const threatened = Object.values(s.pieces).some((p) => p.owner !== session.role && E.legalAttacks(s, p.id).includes(myKing.id));
        if (threatened) {
          for (const sq of E.legalMoves(s, myKing.id)) {
            const a = { type: 'move', piece: myKing.id, from: myKing.pos, to: sq };
            const after = tryPreview({ stake: turn.stake, actions: [...turn.actions, a] });
            if (!after) continue;
            const still = Object.values(after.pieces).some((p) => p.owner !== session.role && E.legalAttacks(after, p.id).includes(myKing.id));
            if (!still) { best = { score: 1, a }; break; }
          }
        }
      }
      return best;
    }

    async function decide() {
      const s = session.state;
      const me = s.players[session.role];
      const pend = s.pending && s.pending.player === session.role ? s.pending : null;

      // Comprar no começo do turno (uma vez por turno)
      const owned = myPieces(s).length + session.myCards().length;
      if (!pend && drewThisTurn !== s.turn && me.free >= 4 + 2 && me.energy >= 3 && owned < 5) {
        drewThisTurn = s.turn;
        const n = me.free >= 10 && me.energy >= 5 && owned < 3 ? 2 : 1;
        await session.requestDraws(n);
        return; // continua quando a semente chegar
      }

      const turn = { stake: null, actions: [] };
      if (pend) turn.actions.push({ type: 'buy', draws: pend.draws.map((d) => d.drawId) });

      // Aposta: chegar a 3 fichas no pote (zona mais eficiente da curva) sem travar compras
      const freeAfterBuy = me.free - (pend ? pend.draws.length * 4 : 0);
      if (me.pot < 6 && freeAfterBuy >= 6) {
        const add = Math.min(6 - me.pot, freeAfterBuy - 4);
        if (add > 0) turn.stake = { add, total: me.pot + add };
      }

      // Ataque primeiro; se não houver, movimento e depois ataque.
      let st = tryPreview(turn) || s;
      const atk = bestAttack(st, turn);
      if (atk) {
        turn.actions.push(atk.a);
        st = tryPreview(turn) || st;
        if (st.phase === 'play') { const mv = bestMove(st, turn); if (mv) turn.actions.push(mv.a); }
      } else {
        const mv = bestMove(st, turn);
        if (mv) {
          turn.actions.push(mv.a);
          st = tryPreview(turn) || st;
          const atk2 = bestAttack(st, turn);
          if (atk2) turn.actions.push(atk2.a);
        }
      }
      if (!tryPreview(turn)) { turn.stake = null; turn.actions = turn.actions.filter((a) => a.type === 'buy'); }
      await session.submitTurn(turn);
    }

    function poke() {
      if (thinking || !session.isMyTurn()) return;
      thinking = true;
      setTimeout(async () => {
        try { if (session.isMyTurn()) await decide(); } catch (e) { console.error('bot', e); }
        thinking = false;
        poke();
      }, delay);
    }
    session.on('state', poke);
    session.on('rejected', () => { setTimeout(async () => { try { if (session.isMyTurn()) await session.submitTurn({ stake: null, actions: [] }); } catch (e) { /* nada */ } }, delay); });
    return { poke };
  }

  PGL.bot = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
