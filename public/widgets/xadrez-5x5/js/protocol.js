/* protocol.js — sessão de jogo entre dois pares (project.md §12–§16).
 *
 * Pipeline de recebimento (§14.1):
 *   limites → parse canônico → assinatura (chave do par) → esquema → sessão/remetente/
 *   destinatário → sequência/#prev/replay → regras (simulação) → hash de estado → commit → ack/reject
 *
 * O cliente nunca aplica nada que o motor de regras não tenha validado, nem os próprios documentos:
 * um turno enviado só é aplicado depois do @ack do adversário com o mesmo hash de estado.
 */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const U = PGL.util, P = PGL.pgl, C = PGL.crypto, E = PGL.engine, RU = PGL.rules;
  const { F, B } = P;

  /* ---------------- Transporte em memória (modo robô e testes) ---------------- */
  function loopbackPair() {
    const mk = () => ({ handlers: [], closeHandlers: [], peer: null, open: true });
    const a = mk(), b = mk();
    a.peer = b; b.peer = a;
    const api = (side) => ({
      send(text) {
        if (!side.open) return;
        const dst = side.peer;
        setTimeout(() => dst.open && dst.handlers.forEach((h) => h(text)), 0);
      },
      onMessage(h) { side.handlers.push(h); },
      onClose(h) { side.closeHandlers.push(h); },
      close() {
        if (!side.open) return;
        side.open = false; side.peer.open = false;
        side.peer.closeHandlers.forEach((h) => h());
      },
    });
    return [api(a), api(b)];
  }

  const PT = { pawn: 'peão', knight: 'cavalo', bishop: 'bispo', rook: 'torre', queen: 'dama', king: 'rei' };

  /** Ação do motor → bloco PGL (sem #ahash/#asig; a assinatura é acrescentada ao enviar). */
  function actionNode(a) {
    if (a.type === 'buy') return B('@buy', a.draws.map((id) => B('#draw', [F('#draw_id', id)])));
    if (a.type === 'move') return B('@move', [F('#piece', a.piece), F('#from', a.from), F('#to', a.to),
      a.reveal ? B('#reveal', [F('#draw_id', a.reveal.drawId), F('#kind', a.reveal.kind), F('#secret', a.reveal.secret)]) : null]);
    return B('@attack', [F('#piece', a.piece), F('#from', a.from), F('#target', a.target), F('#at', a.at)]);
  }
  /** Rascunho legível do turno em PGL (o que vai ser assinado e enviado). */
  function draftTurnPGL(turn) {
    const parts = [];
    if (turn.stake) parts.push(B('@stake', [F('#add', turn.stake.add), F('#total', turn.stake.total)]));
    parts.push(B('@act', turn.actions.map(actionNode)));
    return parts.map(P.serializeNode).join('');
  }

  class ProtocolError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

  /* ---------------- Sessão ---------------- */
  class GameSession {
    /**
     * opts: { role:'P1'|'P2', identity, peer:{ id, pub, name }, myName, session, transport, buyin (unidades) }
     */
    constructor(opts) {
      this.role = opts.role;
      this.peerRole = E.other(opts.role);
      this.identity = opts.identity;
      this.peer = opts.peer;
      this.myName = opts.myName;
      this.session = opts.session;
      this.transport = opts.transport;
      this.buyin = opts.buyin || 0;
      this.listeners = {};
      this.state = null;
      this.lastSeq = 0;
      this.lastHash = null;
      this.processed = new Map(); // doc_hash → resposta já enviada (replay)
      this.hand = []; // privado: {drawId, secret, kind, pieceId, status}
      this.out = null; // documento meu aguardando resposta
      this.readySent = false;
      this.peerReady = false;
      this.initDoc = null;
      this.finalSent = false;
      this.peerFinal = null;
      this.result = null;
      this.closed = false;
      this.queue = Promise.resolve();
      this.log = [];
      this.transport.onMessage((t) => { this.queue = this.queue.then(() => this._receive(t)).catch((e) => this._emit('error', e)); });
      this.transport.onClose(() => { if (!this.closed) { this.closed = true; this._emit('disconnected'); } });
    }

    /* ---------- eventos ---------- */
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    _emit(ev, data) { (this.listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
    _log(msg) { this.log.push(msg); this._emit('log', msg); }

    async start() {
      this.peerKey = await C.importPub(this.peer.pub);
      this.readySent = true;
      await this._send(this._head('ready', [F('#recipient', this.peer.id)], [B('@ready', [F('#status', 'ok')])]));
      this._maybeInit();
    }

    /* ---------- consultas para a interface ---------- */
    isMyTurn() { return !!this.state && this.state.phase === 'play' && this.state.active === this.role && !this.out; }
    myCards() { return this.hand.filter((c) => c.status === 'hand' || c.status === 'drawn'); }
    pendingDrawCards() { return this.hand.filter((c) => c.status === 'drawn'); }
    /** Simula um turno em construção sem passar a vez (para a interface mostrar alvos legais). */
    preview(turn) { return E.applyTurn(this.state, this.role, turn, { preview: true }); }

    /* ---------- construção de documentos ---------- */
    _head(type, afterSender, body) {
      return B('#pgl', [F('#v', '1.0'), F('#type', type), F('#session', this.session), F('#doc_id', U.randomHex(32)), F('#sender', this.identity.id), ...afterSender, ...body]);
    }
    _chainHead(type) {
      return [F('#v', '1.0'), F('#type', type), F('#session', this.session), F('#doc_id', U.randomHex(32)), F('#sender', this.identity.id),
        F('#recipient', this.peer.id), F('#seq', this.lastSeq + 1), F('#turn', this.state.turn), F('#prev', this.lastHash)];
    }
    async _send(root) {
      const sealed = await C.sealDoc(root, this.identity);
      this.transport.send(sealed.text);
      return sealed;
    }
    async _reject(replyTo, code) {
      const code2 = P.REASONS.includes(code) ? code : 'invalid_schema';
      this._log('Documento do adversário rejeitado: ' + code2);
      this._emit('peer-invalid', code2);
      await this._send(this._head('reject', [F('#recipient', this.peer.id), F('#reply_to', replyTo)], [B('@reject', [F('#reason_code', code2)])]));
    }

    /* ---------- início da partida ---------- */
    async _maybeInit() {
      if (this.role !== 'P1' || !this.readySent || !this.peerReady || this.initDoc) return;
      const kings = { P1: U.randomHex(32), P2: U.randomHex(32) };
      const root = this._head('init', [F('#recipient', this.peer.id), F('#board', '5x5'), F('#energy_start', 10), F('#energy_max', 15), F('#chips_start', 3), F('#stake_max', 40),
        F('#first', 'P1'), F('#rules', RU.rulesHash()), F('#buyin', this.buyin)], [B('@init', ['P1', 'P2'].map((p) => B('#piece', [F('#piece', kings[p]), F('#kind', 'king'), F('#owner', p), F('#position', RU.RULES.kingStart[p]), F('#hp', 10)])))]);
      const sealed = await this._send(root);
      this.initDoc = { hash: sealed.hash, kings, buyin: this.buyin };
      this.out = { type: 'init', hash: sealed.hash };
    }
    _ids() { return this.role === 'P1' ? { P1: this.identity.id, P2: this.peer.id } : { P1: this.peer.id, P2: this.identity.id }; }

    /* ---------- recebimento ---------- */
    async _receive(text) {
      if (this.closed) return;
      if (typeof text !== 'string' || text.length > P.LIMITS.maxBytes) return this._log('Mensagem descartada: tamanho');
      let root;
      try { root = P.parse(text); } catch (e) { return this._log('Mensagem descartada: ' + e.code); }
      // Envelope mínimo para checar a assinatura antes de interpretar o conteúdo.
      const docHash = P.get(root, '#doc_hash');
      const signBlk = P.get(root, '#sign');
      if (typeof docHash !== 'string' || !signBlk || signBlk.kind !== 'block') return this._log('Mensagem descartada: sem assinatura');
      if (!(await C.verifyDoc(root, this.peerKey))) return this._log('Mensagem descartada: assinatura inválida');
      let type;
      try { type = P.validate(root); } catch (e) { return this._reject(docHash, e.code); }
      if (P.get(root, '#session') !== this.session) return this._reject(docHash, 'session_mismatch');
      if (P.get(root, '#sender') !== this.peer.id) return this._reject(docHash, 'sender_mismatch');
      const rcpt = P.get(root, '#recipient');
      if (rcpt !== undefined && rcpt !== this.identity.id) return this._reject(docHash, 'recipient_mismatch');
      if (this.processed.has(docHash)) {
        const prev = this.processed.get(docHash);
        if (prev) this.transport.send(prev);
        return this._log('Documento repetido ignorado (replay)');
      }
      this.processed.set(docHash, null);
      try {
        await this['_on_' + type](root, docHash);
      } catch (e) {
        if (e instanceof E.RuleError || e instanceof ProtocolError || e instanceof P.PGLError) return this._reject(docHash, e.code);
        throw e;
      }
    }

    async _on_ready() { this.peerReady = true; this._maybeInit(); }

    async _on_init(root, h) {
      if (this.role !== 'P2' || this.state) throw new ProtocolError('out_of_sequence');
      if (P.get(root, '#rules') !== RU.rulesHash()) throw new ProtocolError('rules_mismatch');
      const pieces = P.getAll(P.get(root, '@init'), '#piece');
      const kings = {};
      for (const pc of pieces) kings[P.get(pc, '#owner')] = P.get(pc, '#piece');
      if (!kings.P1 || !kings.P2 || kings.P1 === kings.P2) throw new ProtocolError('invalid_piece');
      if (P.get(pieces[0], '#position') !== 'A3' || P.get(pieces[1], '#position') !== 'E3' || P.get(pieces[0], '#owner') !== 'P1') throw new ProtocolError('invalid_position');
      const buyins = { P1: +P.get(root, '#buyin'), P2: this.buyin };
      this.state = E.initialState({ session: this.session, ids: this._ids(), kingIds: kings, buyins });
      const acc = await this._send(this._head('accept', [F('#recipient', this.peer.id), F('#reply_to', h), F('#buyin', this.buyin)], [B('@accept', [F('#status', 'ok')]), F('#state_after', E.stateHash(this.state))]));
      this.lastSeq = 0;
      this.lastHash = acc.hash;
      this._log('Partida iniciada');
      this._emit('started', this.state);
      this._emit('state', this.state);
    }

    async _on_accept(root, h) {
      if (this.role !== 'P1' || !this.out || this.out.type !== 'init' || P.get(root, '#reply_to') !== this.out.hash) throw new ProtocolError('out_of_sequence');
      const buyins = { P1: this.initDoc.buyin, P2: +P.get(root, '#buyin') };
      const st = E.initialState({ session: this.session, ids: this._ids(), kingIds: this.initDoc.kings, buyins });
      if (E.stateHash(st) !== P.get(root, '#state_after')) throw new ProtocolError('state_mismatch');
      this.state = st;
      this.out = null;
      this.lastSeq = 0;
      this.lastHash = h;
      this._log('Partida iniciada');
      this._emit('started', this.state);
      this._emit('state', this.state);
    }

    _checkChain(root) {
      if (!this.state) throw new ProtocolError('out_of_sequence');
      if (+P.get(root, '#seq') !== this.lastSeq + 1) throw new ProtocolError('out_of_sequence');
      if (P.get(root, '#prev') !== this.lastHash) throw new ProtocolError('out_of_sequence');
      if (+P.get(root, '#turn') !== this.state.turn) throw new ProtocolError('out_of_sequence');
    }
    _commit(newState, seq, hash) {
      this.state = newState;
      this.lastSeq = seq;
      this.lastHash = hash;
      this._emit('state', this.state);
    }

    /* ----- sorteio: o adversário pede, eu envio a semente ----- */
    async _on_draw_request(root, h) {
      this._checkChain(root);
      const draws = P.getAll(P.get(root, '@draw_req'), '#draw').map((d) => ({ drawId: P.get(d, '#draw_id'), commit: P.get(d, '#commit') }));
      const st = E.applyDrawRequest(this.state, this.peerRole, draws);
      this._commit(st, this.lastSeq + 1, h);
      const seeds = draws.map((d) => ({ drawId: d.drawId, seed: U.randomHex(32) }));
      const root2 = B('#pgl', [...this._chainHead('draw_seed'), F('#reply_to', h), B('@draw_seed', seeds.map((sd) => B('#draw', [F('#draw_id', sd.drawId), F('#seed', sd.seed)])))]);
      const st2 = E.applyDrawSeed(this.state, this.role, seeds);
      const sealed = await this._send(root2);
      this._commit(st2, this.lastSeq + 1, sealed.hash);
      this._log(`O adversário sorteou ${draws.length} carta(s) (ocultas)`);
      this._emit('peer-draw', draws.length);
    }

    /* ----- sorteio: eu pedi, chegou a semente ----- */
    async _on_draw_seed(root, h) {
      if (!this.out || this.out.type !== 'draw_request' || P.get(root, '#reply_to') !== this.out.hash) throw new ProtocolError('out_of_sequence');
      // Primeiro o meu draw_request entra na cadeia (o adversário o aceitou ao responder).
      this._commit(this.out.state, this.out.seq, this.out.hash);
      this._checkChain(root);
      const seeds = P.getAll(P.get(root, '@draw_seed'), '#draw').map((d) => ({ drawId: P.get(d, '#draw_id'), seed: P.get(d, '#seed') }));
      const st = E.applyDrawSeed(this.state, this.peerRole, seeds);
      for (const sd of seeds) {
        const card = this.hand.find((c) => c.drawId === sd.drawId);
        card.kind = C.drawKind(this.session, card.drawId, card.secret, sd.seed);
        card.status = 'drawn';
      }
      this.out = null;
      this._commit(st, this.lastSeq + 1, h);
      this._log('Você sorteou: ' + seeds.map((sd) => PT[this.hand.find((c) => c.drawId === sd.drawId).kind]).join(', '));
      this._emit('hand', this.myCards());
    }

    /* ----- turno do adversário ----- */
    _parseTurn(root, seq) {
      const turn = { stake: null, actions: [] };
      const st = P.get(root, '@stake');
      if (st) turn.stake = { add: +P.get(st, '#add'), total: +P.get(st, '#total') };
      for (const a of P.get(root, '@act').children) {
        if (a.name === '@buy') turn.actions.push({ type: 'buy', draws: P.getAll(a, '#draw').map((d) => P.get(d, '#draw_id')), node: a });
        else if (a.name === '@move') {
          const rv = P.get(a, '#reveal');
          turn.actions.push({ type: 'move', piece: P.get(a, '#piece'), from: P.get(a, '#from'), to: P.get(a, '#to'),
            reveal: rv ? { drawId: P.get(rv, '#draw_id'), kind: P.get(rv, '#kind'), secret: P.get(rv, '#secret') } : null, node: a });
        } else if (a.name === '@attack') turn.actions.push({ type: 'attack', piece: P.get(a, '#piece'), from: P.get(a, '#from'), target: P.get(a, '#target'), at: P.get(a, '#at'), node: a });
      }
      return turn;
    }
    async _on_turn(root, h) {
      this._checkChain(root);
      const seq = +P.get(root, '#seq');
      if (P.get(root, '#rules') !== RU.rulesHash()) throw new ProtocolError('rules_mismatch');
      if (P.get(root, '#state_before') !== E.stateHash(this.state)) throw new ProtocolError('state_mismatch');
      const turn = this._parseTurn(root, seq);
      for (const a of turn.actions) {
        if (!(await C.verifyAction(a.node, { session: this.session, sender: this.peer.id, seq }, this.peerKey))) throw new ProtocolError('invalid_signature');
      }
      const st = E.applyTurn(this.state, this.peerRole, turn);
      const sh = E.stateHash(st);
      if (sh !== P.get(root, '#state_after')) throw new ProtocolError('state_mismatch');
      this._commit(st, seq, h);
      const ack = await this._send(this._head('ack', [F('#recipient', this.peer.id), F('#reply_to', h)], [B('@ack', [F('#seq', seq), F('#state', sh), F('#status', 'accepted')])]));
      this.processed.set(h, ack.text);
      this._emit('peer-turn', turn);
      this._afterCommit();
    }

    async _on_ack(root) {
      if (!this.out || this.out.type !== 'turn' || P.get(root, '#reply_to') !== this.out.hash) throw new ProtocolError('out_of_sequence');
      const ack = P.get(root, '@ack');
      if (P.get(ack, '#state') !== E.stateHash(this.out.state) || +P.get(ack, '#seq') !== this.out.seq) {
        this._emit('desync');
        throw new ProtocolError('state_mismatch');
      }
      const o = this.out;
      this.out = null;
      for (const id of o.settles) { const c = this.hand.find((x) => x.drawId === id); c.status = 'hand'; }
      for (const id of o.places) { const c = this.hand.find((x) => x.drawId === id); c.status = 'placed'; }
      this._commit(o.state, o.seq, o.hash);
      this._emit('hand', this.myCards());
      this._emit('turn-accepted');
      this._afterCommit();
    }

    async _on_reject(root) {
      const code = P.get(P.get(root, '@reject'), '#reason_code');
      const rt = P.get(root, '#reply_to');
      if (this.out && rt === this.out.hash) {
        if (this.out.type === 'draw_request') this.hand = this.hand.filter((c) => c.status !== 'requested');
        this.out = null;
      }
      this._log('O adversário rejeitou meu documento: ' + code);
      this._emit('rejected', code);
    }

    /* ---------- minhas jogadas ---------- */
    async requestDraws(n) {
      if (!this.isMyTurn()) throw new ProtocolError('not_your_turn');
      const draws = [];
      for (let i = 0; i < n; i++) draws.push(C.newDraw(this.session));
      const st = E.applyDrawRequest(this.state, this.role, draws.map((d) => ({ drawId: d.drawId, commit: d.commit })));
      for (const d of draws) this.hand.push({ drawId: d.drawId, secret: d.secret, kind: null, pieceId: C.drawPieceId(this.session, d.drawId, d.secret), status: 'requested' });
      const root = B('#pgl', [...this._chainHead('draw_request'), B('@draw_req', draws.map((d) => B('#draw', [F('#draw_id', d.drawId), F('#commit', d.commit)])))]);
      const seq = this.lastSeq + 1;
      this.out = { type: 'draw_request', seq, state: st, hash: null };
      const sealed = await this._send(root);
      this.out.hash = sealed.hash;
      return draws.map((d) => d.drawId);
    }

    /** turn: { stake:{add,total}|null, actions:[...] } — mesmo formato do motor. */
    async submitTurn(turn) {
      if (!this.isMyTurn()) throw new ProtocolError('not_your_turn');
      const seq = this.lastSeq + 1;
      const newState = E.applyTurn(this.state, this.role, turn); // valida localmente antes de enviar
      const ctx = { session: this.session, sender: this.identity.id, seq };
      const actNodes = [];
      for (const a of turn.actions) actNodes.push(await C.sealAction(actionNode(a), ctx, this.identity));
      const root = B('#pgl', [...this._chainHead('turn'), F('#state_before', E.stateHash(this.state)), F('#rules', RU.rulesHash()),
        turn.stake ? B('@stake', [F('#add', turn.stake.add), F('#total', turn.stake.total)]) : null,
        B('@act', actNodes), F('#state_after', E.stateHash(newState))]);
      const settles = turn.actions.filter((a) => a.type === 'buy').flatMap((a) => a.draws);
      const places = turn.actions.filter((a) => a.type === 'move' && a.reveal).map((a) => a.reveal.drawId);
      this.out = { type: 'turn', seq, state: newState, hash: null, settles, places };
      const sealed = await this._send(root);
      this.out.hash = sealed.hash;
    }

    /** Monta a ação de posicionar uma carta da minha mão. */
    placeAction(drawId, to) {
      const c = this.hand.find((x) => x.drawId === drawId);
      return { type: 'move', piece: c.pieceId, from: 'inv', to, reveal: { drawId: c.drawId, kind: c.kind, secret: c.secret } };
    }

    /* ---------- fim da partida (§4.6.5, §5.4.5) ---------- */
    async _afterCommit() {
      if (this.state.phase !== 'finished' || this.finalSent) return;
      this.finalSent = true;
      const reveals = this.hand.filter((c) => c.status === 'hand').map((c) => B('#reveal', [F('#draw_id', c.drawId), F('#kind', c.kind), F('#secret', c.secret)]));
      await this._send(this._head('final', [F('#recipient', this.peer.id), F('#prev', this.lastHash), F('#state', E.stateHash(this.state))], [B('@final', [F('#winner', this.state.winner), ...reveals])]));
      this._maybeFinish();
    }
    async _on_final(root) {
      this.peerFinal = root;
      this._maybeFinish();
    }
    _maybeFinish() {
      if (!this.finalSent || !this.peerFinal || this.result) return;
      const root = this.peerFinal;
      let verified = P.get(root, '#prev') === this.lastHash && P.get(root, '#state') === E.stateHash(this.state) && P.get(P.get(root, '@final'), '#winner') === this.state.winner;
      // Auditoria: todas as cartas ocultas do adversário precisam ser reveladas corretamente.
      const hidden = this.state.players[this.peerRole].hidden;
      const reveals = P.getAll(P.get(root, '@final'), '#reveal');
      if (reveals.length !== hidden.length) verified = false;
      const peerHand = [];
      for (const rv of reveals) {
        const id = P.get(rv, '#draw_id'), kind = P.get(rv, '#kind'), secret = P.get(rv, '#secret');
        const h = hidden.find((x) => x.drawId === id);
        if (!h || C.drawCommit(this.session, id, secret) !== h.commit || C.drawKind(this.session, id, secret, h.seed) !== kind) verified = false;
        peerHand.push(kind);
      }
      this.result = { winner: this.state.winner, iWon: this.state.winner === this.role, verified, peerHand, state: this.state };
      this._log(verified ? 'Resultado conferido pelos dois lados' : 'ATENÇÃO: auditoria final falhou (possível fraude)');
      this._emit('finished', this.result);
    }

    close() { this.closed = true; this.transport.close(); }
  }

  PGL.protocol = { GameSession, loopbackPair, ProtocolError, actionNode, draftTurnPGL };
})(typeof window !== 'undefined' ? window : globalThis);
