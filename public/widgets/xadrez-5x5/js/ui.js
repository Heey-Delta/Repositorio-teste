/* ui.js — mesa de jogo: tabuleiro no centro, recursos no topo, card da peça e cartas embaixo.
 * As cartas são arrastadas até o tabuleiro; cada gesto vira uma ação PGL (@move #from:inv …),
 * mostrada ao vivo em "Turno em PGL". Nada recebido do adversário entra como HTML. */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const E = PGL.engine, RU = PGL.rules, U = PGL.util;
  const NS = 'http://www.w3.org/2000/svg';

  const NAME = { king: 'Rei', queen: 'Dama', rook: 'Torre', bishop: 'Bispo', knight: 'Cavalo', pawn: 'Peão' };
  const RANGE = {
    pawn: 'Anda 1 casa para a frente · ataca 1 casa para os lados',
    knight: 'Movimento em L · salta outras peças',
    bishop: 'Até 2 casas na diagonal',
    rook: 'Até 3 casas em linha reta',
    queen: 'Até 4 casas em qualquer direção reta',
    king: '1 casa em qualquer direção · mover custa 0 energia',
  };
  const CARD_IMG = { king: 'carta_rei_K', queen: 'carta_dama_Q', rook: 'carta_torre_R', bishop: 'carta_bispo_B', knight: 'carta_cavalo_N', pawn: 'carta_peao_P' };
  const REASON = {
    illegal_move: 'movimento ilegal', illegal_attack: 'ataque ilegal', insufficient_energy: 'energia insuficiente', insufficient_chips: 'moedas insuficientes',
    invalid_position: 'posicione a até 2 casas do seu rei, numa casa vazia', duplicate_action: 'cada tipo de jogada só uma vez por turno', too_many_actions: 'máximo de 3 jogadas',
    stake_limit_exceeded: 'o pote vai até 20 fichas', unsettled_draw: 'pague as cartas sorteadas neste turno', invalid_draw: 'sorteio inválido',
    invalid_reveal: 'revelação inválida', state_mismatch: 'estados divergentes', not_your_turn: 'não é sua vez', game_already_finished: 'partida encerrada',
  };
  const ICONS = {
    bolt: 'M13 1 3 14h7l-2 9 11-13h-7l1-9z',
    sword: 'M20 2h2v2L11 15l2 2-2 2-2-2-3 3H4v-2l3-3-2-2 2-2 2 2L20 2z',
    heart: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z',
    cards: 'M4 5h10v15H4zM9 2h11v15h-3V5H9z',
    move: 'M12 2l4 4h-3v5h5V8l4 4-4 4v-3h-5v5h3l-4 4-4-4h3v-5H6v3l-4-4 4-4v3h5V6H8z',
  };
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(name, cls) {
    const span = el('span', 'ico' + (cls ? ' ' + cls : ''));
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name]); p.setAttribute('fill', 'currentColor');
    s.append(p); span.append(s);
    return span;
  }
  function fillIcons(root) { root.querySelectorAll('[data-icon]').forEach((n) => { if (!n.firstChild) n.replaceWith(icon(n.dataset.icon)); }); }
  const chips = (u) => U.unitsToText(u);
  const reason = (code) => REASON[code] || code;
  const bonusPct = (pot) => RU.RULES.bonusPct[Math.min(Math.floor(pot / 2), 20)];

  class GameView {
    constructor(session, opts) {
      this.s = session;
      this.names = { me: opts.myName, foe: opts.foeName };
      this.wallet = opts.wallet;
      this.onFinish = opts.onFinish;
      this.onLost = opts.onLost;
      this.foeBuyinUnverified = opts.foeBuyinUnverified;
      this.plan = { stake: 0, actions: [] };
      this.sel = null; // {type:'piece'|'card', id}
      this.buyN = 1;
      this.busy = false;
      this.last = [];
      this.logs = [];
      this.newCards = new Set();
      this.drag = null;
      this.toastTimer = null;
      fillIcons(document.getElementById('screen-game'));
      this._bind();
      this.view3d = null;
      this.use3d = false;
      this._setup3d();
      session.on('state', () => this.render());
      session.on('hand', (cards) => { cards.filter((c) => c.status === 'drawn').forEach((c) => this.newCards.add(c.drawId)); this.busy = false; this.render(); });
      session.on('log', (m) => this.logs.push(m));
      session.on('peer-turn', (t) => this._describePeer(t));
      session.on('peer-draw', (n) => this.toast(`${this.names.foe} comprou ${n} carta(s).`));
      session.on('turn-accepted', () => { this.plan = { stake: 0, actions: [] }; this.sel = null; this.busy = false; this.newCards.clear(); this.render(); });
      session.on('rejected', (c) => { this.busy = false; this.toast('O adversário rejeitou: ' + reason(c)); this.render(); });
      session.on('peer-invalid', (c) => this.toast('Jogada inválida do adversário ignorada (' + c + ').'));
      session.on('desync', () => this.onLost && this.onLost('Os estados divergiram. A partida foi pausada.'));
      session.on('finished', (r) => this.onFinish && this.onFinish(r));
      session.on('disconnected', () => { if (!session.result) this.onLost && this.onLost('A conexão com o adversário caiu.'); });
      this.render();
    }

    /* ---------- 3D ---------- */
    async _setup3d() {
      const B3 = PGL.board3d;
      const btn = $('btn-view');
      btn.hidden = true;
      if (!B3 || !(await B3.load(6000))) return; // sem Three.js: tabuleiro 2D
      try {
        this.view3d = B3.createBoard($('board3d'), { flip: this.s.role === 'P2' });
        this.view3d.onSquare((c) => this._clickSquare(c));
        this.use3d = true;
      } catch (e) { console.warn('3D indisponível', e); this.view3d = null; return; }
      btn.hidden = false;
      btn.onclick = () => { this.use3d = !this.use3d; this.render(); };
      this.render();
    }
    destroy() { if (this.view3d) { this.view3d.dispose(); this.view3d = null; } }

    /* ---------- utilidades ---------- */
    toast(msg) {
      const t = $('toast');
      t.textContent = msg; t.hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
    }
    turnObj() {
      const pot = this.s.state.players[this.s.role].pot;
      return { stake: this.plan.stake > 0 ? { add: this.plan.stake, total: pot + this.plan.stake } : null, actions: this.plan.actions.slice() };
    }
    previewState() { try { return this.s.preview(this.turnObj()); } catch (e) { return null; } }
    used(type) { return this.plan.actions.some((a) => a.type === type); }
    canAct() { return this.s.isMyTurn() && !this.busy; }
    tryAdd(action) {
      const t = this.turnObj();
      t.actions.push(action);
      try { this.s.preview(t); } catch (e) { this.toast('Não dá: ' + reason(e.code)); return false; }
      this.plan.actions.push(action);
      this.sel = action.type === 'move' ? { type: 'piece', id: action.piece } : null;
      this.render();
      return true;
    }

    /* ---------- controles ---------- */
    _bind() {
      $('btn-buy-minus').onclick = () => { this.buyN = Math.max(1, this.buyN - 1); this.render(); };
      $('btn-buy-plus').onclick = () => { this.buyN = Math.min(5, this.buyN + 1); this.render(); };
      $('deck').onclick = () => this._buy();
      $('btn-stake-minus').onclick = () => { this.plan.stake = Math.max(0, this.plan.stake - 2); this.render(); };
      $('btn-stake-plus').onclick = () => {
        const prev = this.plan.stake;
        this.plan.stake += 2;
        if (!this.previewState()) { this.plan.stake = prev; this.toast('Moedas livres insuficientes ou pote no limite (20).'); }
        this.render();
      };
      $('btn-undo').onclick = () => {
        const a = this.plan.actions[this.plan.actions.length - 1];
        if (!a) return;
        if (a.type === 'buy') return this.toast('A compra já foi sorteada e precisa ser paga neste turno.');
        this.plan.actions.pop();
        this.sel = null;
        this.render();
      };
      $('btn-end').onclick = () => this._end();
    }
    async _buy() {
      if (!this.canAct() || this.used('buy') || this.s.state.pending) return;
      if (this.plan.actions.length >= 3) return this.toast('Máximo de 3 jogadas por turno.');
      const pme = (this.previewState() || this.s.state).players[this.s.role];
      if (pme.free < 4 * this.buyN) return this.toast(`Moedas insuficientes: cada carta custa 2 (você tem ${chips(pme.free)}).`);
      if (pme.energy < this.buyN) return this.toast('Energia insuficiente: 1 por carta.');
      this.busy = true;
      this.render();
      try {
        const ids = await this.s.requestDraws(this.buyN);
        this.plan.actions.push({ type: 'buy', draws: ids });
      } catch (e) { this.busy = false; this.toast('Não dá: ' + reason(e.code)); }
      this.render();
    }
    async _end() {
      if (!this.canAct()) return;
      const t = this.turnObj();
      try { this.s.preview(t); } catch (e) { return this.toast('Turno inválido: ' + reason(e.code)); }
      this.busy = true;
      this.sel = null;
      this.render();
      try { await this.s.submitTurn(t); } catch (e) { this.busy = false; this.toast('Não dá: ' + reason(e.code)); this.render(); }
    }

    /* ---------- tabuleiro: clique ---------- */
    _clickSquare(coord) {
      const pv = (this.canAct() && this.previewState()) || this.s.state;
      const here = E.board(pv)[coord];
      if (this.canAct() && this.sel && this.sel.type === 'piece') {
        const pc = pv.pieces[this.sel.id];
        if (pc && pc.owner === this.s.role) {
          if (!this.used('move') && E.legalMoves(pv, pc.id).includes(coord)) return this.tryAdd({ type: 'move', piece: pc.id, from: pc.pos, to: coord });
          if (here && !this.used('attack') && E.legalAttacks(pv, pc.id).includes(here.id)) return this.tryAdd({ type: 'attack', piece: pc.id, from: pc.pos, target: here.id, at: coord });
        }
      }
      if (this.canAct() && this.sel && this.sel.type === 'card' && !this.used('move') && E.placementSquares(pv, this.s.role).includes(coord))
        return this.tryAdd(this.s.placeAction(this.sel.id, coord));
      this.sel = here ? { type: 'piece', id: here.id } : null; // qualquer peça: mostra o card
      this.render();
    }

    /* ---------- cartas: arrastar até o tabuleiro ---------- */
    _squareAt(x, y) {
      if (this.use3d && this.view3d) return this.view3d.squareAt(x, y);
      const n = document.elementFromPoint(x, y);
      const sq = n && n.closest && n.closest('.sq');
      return sq ? sq.dataset.coord : null;
    }
    _cardDown(e, card, node) {
      if (!this.canAct() || this.plan.actions.some((a) => a.reveal && a.reveal.drawId === card.drawId)) return;
      if (this.used('move')) { this.toast('Você já usou a jogada de mover/posicionar neste turno.'); return; }
      e.preventDefault();
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      this.drag = { card, node, x0: e.clientX, y0: e.clientY, moved: false, hot: null };
    }
    _cardMove(e) {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      const ghost = $('drag-ghost');
      if (!d.moved) {
        d.moved = true;
        d.node.classList.add('used');
        ghost.replaceChildren(d.node.querySelector('img').cloneNode());
        ghost.hidden = false;
        this.sel = { type: 'card', id: d.card.drawId };
        this._renderBoard(this.previewState() || this.s.state, true);
      }
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      if (!this.use3d) {
        const c = this._squareAt(e.clientX, e.clientY);
        if (c !== d.hot) {
          document.querySelectorAll('.sq.hot').forEach((n) => n.classList.remove('hot'));
          const n = c && document.querySelector(`.sq[data-coord="${c}"]`);
          if (n) n.classList.add('hot');
          d.hot = c;
        }
      }
    }
    _cardUp(e) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      $('drag-ghost').hidden = true;
      if (!d.moved) { // toque simples: seleciona a carta (alternativa ao arrastar)
        this.sel = this.sel && this.sel.type === 'card' && this.sel.id === d.card.drawId ? null : { type: 'card', id: d.card.drawId };
        return this.render();
      }
      const coord = this._squareAt(e.clientX, e.clientY);
      const pv = this.previewState() || this.s.state;
      if (coord && E.placementSquares(pv, this.s.role).includes(coord)) {
        if (this.tryAdd(this.s.placeAction(d.card.drawId, coord))) return;
      } else if (coord) this.toast('Solte numa casa azul: vazia e a até 2 casas do seu rei.');
      this.sel = null;
      this.render();
    }

    _describePeer(turn) {
      this.last = [];
      const st = this.s.state;
      const parts = [];
      if (turn.stake) parts.push(`apostou ${chips(turn.stake.add)}`);
      for (const a of turn.actions) {
        if (a.type === 'buy') parts.push(`comprou ${a.draws.length}`);
        if (a.type === 'move') {
          const pc = st.pieces[a.piece];
          parts.push(a.from === 'inv' ? `posicionou ${NAME[a.reveal.kind]} em ${a.to}` : `moveu ${pc ? NAME[pc.kind] : 'peça'} para ${a.to}`);
          if (a.from !== 'inv') this.last.push(a.from);
          this.last.push(a.to);
        }
        if (a.type === 'attack') { parts.push(`atacou em ${a.at}`); this.last.push(a.from, a.at); }
      }
      const msg = `${this.names.foe}: ${parts.length ? parts.join(', ') : 'passou a vez'}`;
      this.logs.push(msg);
      this.toast(msg);
    }

    /* ---------- desenho ---------- */
    render() {
      const st0 = this.s.state;
      if (!st0) { $('turn-banner').textContent = 'Preparando a partida…'; return; }
      const myTurn = this.canAct();
      const pv = (myTurn && this.previewState()) || st0;
      const role = this.s.role, foe = E.other(role);
      const me = pv.players[role];

      // Topo esquerdo: energia, moedas, pote
      $('me-energy').textContent = String(me.energy);
      $('me-ebar').style.width = (me.energy / 15) * 100 + '%';
      $('me-coins').textContent = chips(me.free);
      $('me-pot').textContent = chips(me.pot);
      $('me-bonus').textContent = '+' + bonusPct(me.pot) + '% dano';
      // Topo direito: vitórias (só aparece se houver)
      const wins = this.wallet ? this.wallet.gold : 0;
      $('t-wins').hidden = wins <= 0;
      $('wins-n').textContent = String(wins);
      // Centro: vez + adversário
      const tb = $('turn-banner');
      tb.className = 'turn-banner' + (myTurn ? ' mine' : '');
      tb.textContent = st0.phase === 'finished' ? 'Partida encerrada' : myTurn ? `Sua vez · turno ${st0.turn}` : this.busy || this.s.out ? 'Aguardando o adversário…' : `Vez de ${this.names.foe}`;
      this._renderFoe(st0, foe);

      if (!this.drag) this._renderBoard(pv, myTurn);
      this._renderSlots(pv);
      this._renderPieceCard(pv);
      this._renderPGL();
      if (!this.drag) this._renderHand(myTurn);

      // Controles
      const lock = !myTurn;
      $('deck').disabled = lock || this.used('buy') || !!st0.pending;
      $('btn-buy-minus').disabled = $('btn-buy-plus').disabled = $('deck').disabled;
      $('buy-n').textContent = String(this.buyN);
      $('btn-stake-minus').disabled = lock || this.plan.stake === 0;
      $('btn-stake-plus').disabled = lock;
      $('stake-n').textContent = chips(this.plan.stake);
      $('stake-info').textContent = this.plan.stake ? `pote ${chips(me.pot)}` : 'apostar';
      $('btn-undo').disabled = lock || !this.plan.actions.length;
      $('btn-end').disabled = lock;
      $('btn-end').textContent = this.plan.actions.length || this.plan.stake ? 'Finalizar turno' : 'Passar a vez';
    }

    _renderFoe(st, foe) {
      const pl = st.players[foe];
      const box = $('foe-strip');
      box.replaceChildren();
      box.append(el('span', 'fname', this.names.foe));
      const v = (node, txt) => { const s = el('span', 'fv'); s.append(node, el('b', null, txt)); box.append(s); };
      v(icon('bolt'), String(pl.energy));
      v(el('span', 'coin coin-silver'), chips(pl.free));
      const pot = el('span', 'fv', 'pote ');
      pot.append(el('b', null, chips(pl.pot)));
      box.append(pot);
      const n = pl.hidden.length + (st.pending && st.pending.player === foe ? st.pending.draws.length : 0);
      const backs = el('span', 'backs');
      for (let i = 0; i < Math.min(n, 8); i++) backs.append(el('span', 'back'));
      const h = el('span', 'fv'); h.append(backs, el('b', null, String(n)));
      box.append(h);
      if (this.foeBuyinUnverified && pl.buyin > 0) box.append(el('span', 'unv', `+${chips(pl.buyin)} da carteira (não verificado)`));
    }

    _highlights(st, myTurn) {
      let moves = [], targets = [], places = [];
      const selPc = this.sel && this.sel.type === 'piece' ? st.pieces[this.sel.id] : null;
      if (selPc) {
        // Peça própria: caminhos possíveis. Peça inimiga: até onde ela alcança (para ler o perigo).
        const own = selPc.owner === this.s.role;
        if (!own || !myTurn || !this.used('move')) moves = E.legalMoves(st, selPc.id);
        if (!own || !myTurn || !this.used('attack')) targets = E.legalAttacks(st, selPc.id).map((id) => st.pieces[id].pos);
      }
      if (myTurn && this.sel && this.sel.type === 'card' && !this.used('move')) places = E.placementSquares(st, this.s.role);
      return { moves, targets, places, sel: selPc ? selPc.pos : null, last: this.last };
    }

    _renderBoard(st, myTurn) {
      const hl = this._highlights(st, myTurn);
      const show3d = this.use3d && this.view3d;
      $('board3d').hidden = !show3d;
      $('board').hidden = !!show3d;
      $('btn-view').textContent = show3d ? '2D' : '3D';
      if (show3d) {
        this.view3d.update(st, hl, (pc) => E.damageOf(st, pc));
        return;
      }
      const b = $('board');
      b.replaceChildren();
      const flip = this.s.role === 'P2';
      const bd = E.board(st);
      for (let row = 4; row >= 0; row--) {
        for (let i = 0; i < 5; i++) {
          const x = flip ? 4 - i : i;
          const coord = E.toCoord(x, row);
          const sq = el('div', 'sq ' + ((x + row) % 2 === 0 ? 'dark' : 'light'));
          sq.setAttribute('role', 'gridcell');
          sq.dataset.coord = coord;
          if (hl.moves.includes(coord)) sq.classList.add('move');
          if (hl.places.includes(coord)) sq.classList.add('place');
          if (hl.targets.includes(coord)) sq.classList.add('target');
          if (hl.last.includes(coord)) sq.classList.add('last');
          if (hl.sel === coord) sq.classList.add('sel');
          sq.append(el('span', 'coord', coord));
          const pc = bd[coord];
          if (pc) {
            const facingRight = (pc.owner === 'P1') !== flip;
            sq.append(PGL.pieceArt.svg(pc.kind, pc.owner, facingRight));
            const max = RU.maxHp(pc.kind);
            const bar = el('div', 'hpbar' + (pc.hp * 2 <= max ? ' low' : ''));
            const fill = el('i');
            fill.style.width = Math.max(0, (pc.hp / max) * 100) + '%';
            bar.append(fill);
            sq.append(bar, el('span', 'dmg', String(E.damageOf(st, pc))));
          }
          sq.onclick = () => this._clickSquare(coord);
          b.append(sq);
        }
      }
    }

    _renderSlots(pv) {
      const st = this.s.state;
      const vals = { buy: '', move: '', attack: '' };
      for (const a of this.plan.actions) {
        if (a.type === 'buy') vals.buy = `${a.draws.length} carta${a.draws.length > 1 ? 's' : ''}`;
        if (a.type === 'move') {
          if (a.from === 'inv') vals.move = `${NAME[a.reveal.kind]} → ${a.to}`;
          else { const pc = st.pieces[a.piece]; vals.move = `${pc ? NAME[pc.kind] : 'Peça'} ${a.from}→${a.to}`; }
        }
        if (a.type === 'attack') { const pc = st.pieces[a.piece] || pv.pieces[a.piece]; vals.attack = `${pc ? NAME[pc.kind] : 'Peça'} → ${a.at}`; }
      }
      document.querySelectorAll('.slot').forEach((n) => {
        const k = n.dataset.slot;
        n.classList.toggle('on', !!vals[k]);
        n.querySelector('.s-val').textContent = vals[k];
      });
    }

    _renderPieceCard(st) {
      const box = $('piece-card');
      const pc = this.sel && this.sel.type === 'piece' ? st.pieces[this.sel.id] : null;
      if (!pc) { box.hidden = true; return; }
      box.hidden = false;
      box.replaceChildren();
      const mine = pc.owner === this.s.role;
      const art = el('div', 'pc-art');
      art.append(PGL.pieceArt.svg(pc.kind, pc.owner, pc.owner === 'P1'));
      const title = el('div', 'pc-title', NAME[pc.kind]);
      title.append(el('small', null, (mine ? 'sua · ' : `de ${this.names.foe} · `) + pc.pos));
      const max = RU.maxHp(pc.kind);
      const dmg = E.damageOf(st, pc);
      const stats = el('div', 'pc-stats');
      const hp = el('span');
      const hpb = el('span', 'pc-hp'); const hpi = el('i'); hpi.style.width = (pc.hp / max) * 100 + '%'; hpb.append(hpi);
      hp.append(icon('heart', 'heart'), el('b', null, `${pc.hp}/${max}`), hpb);
      const dm = el('span');
      dm.append(icon('sword', 'sword'), el('b', null, String(dmg)), el('small', 'muted', dmg > RU.VALUE[pc.kind] ? ` (base ${RU.VALUE[pc.kind]})` : ''));
      stats.append(hp, dm);
      const range = el('div', 'pc-range', RANGE[pc.kind]);
      const hash = el('div', 'pc-hash', 'hash ' + pc.id);
      hash.title = 'Clique para copiar';
      hash.onclick = () => { try { navigator.clipboard.writeText(pc.id); this.toast('Hash copiado.'); } catch (e) { /* ok */ } };
      box.append(art, title, stats, range, hash);
    }

    _renderPGL() {
      const pre = $('pgl-preview');
      try { pre.textContent = PGL.protocol.draftTurnPGL(this.turnObj()); } catch (e) { pre.textContent = ''; }
    }

    _renderHand(myTurn) {
      const h = $('hand');
      h.replaceChildren();
      const cards = this.s.myCards();
      if (!cards.length) { h.append(el('span', 'empty', 'Sem cartas. Toque no baralho para comprar.')); return; }
      for (const c of cards) {
        const placed = this.plan.actions.some((a) => a.reveal && a.reveal.drawId === c.drawId);
        const d = el('div', 'card' + (this.sel && this.sel.type === 'card' && this.sel.id === c.drawId ? ' sel' : '') + (this.newCards.has(c.drawId) ? ' new' : '') + (placed ? ' used' : '') + (myTurn ? '' : ' locked'));
        d.dataset.kind = c.kind;
        const img = el('img');
        img.src = 'assets/cartas/' + CARD_IMG[c.kind] + '.png';
        img.alt = NAME[c.kind];
        img.draggable = false;
        d.append(img);
        d.title = `${NAME[c.kind]} · vida ${RU.maxHp(c.kind)} · dano ${RU.VALUE[c.kind]} — arraste até o tabuleiro`;
        d.addEventListener('pointerdown', (e) => this._cardDown(e, c, d));
        d.addEventListener('pointermove', (e) => this._cardMove(e));
        d.addEventListener('pointerup', (e) => this._cardUp(e));
        d.addEventListener('pointercancel', () => { this.drag = null; $('drag-ghost').hidden = true; this.render(); });
        h.append(d);
      }
    }
  }

  /* ---------- tabuleiro da tela inicial (sem 3D) ---------- */
  function homeBoardSVG() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 500 500');
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', c * 100); rect.setAttribute('y', r * 100);
      rect.setAttribute('width', 100); rect.setAttribute('height', 100);
      rect.setAttribute('fill', (c + (4 - r)) % 2 === 0 ? '#7a5234' : '#e2c999');
      svg.append(rect);
    }
    for (const [x, owner] of [[0, 'P1'], [400, 'P2']]) {
      const k = PGL.pieceArt.svg('king', owner, owner === 'P1');
      k.setAttribute('x', x + 12); k.setAttribute('y', 206); k.setAttribute('width', 76); k.setAttribute('height', 88);
      svg.append(k);
    }
    return svg;
  }

  PGL.ui = { GameView, homeBoardSVG, NAME, reason };
})(typeof window !== 'undefined' ? window : globalThis);
