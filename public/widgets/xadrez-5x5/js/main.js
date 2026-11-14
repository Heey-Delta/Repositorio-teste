/* main.js — fluxo de telas: início → nome → modo → (robô | amigo) → partida → resultado. */
(function (G) {
  'use strict';
  const PGL = G.PGL;
  const U = PGL.util, P = PGL.pgl, C = PGL.crypto, W = PGL.wallet;
  const $ = (id) => document.getElementById(id);

  const app = { home3d: null, name: null, wallet: W.load(), session: null, view: null, hostCtx: null, joinCtx: null, invite: null, buyinTaken: 0, mode: null };

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    $('hud').hidden = id === 'screen-game'; // na partida, recursos e vitórias ficam na mesa
    if (app.home3d) { if (id === 'screen-home') app.home3d.start(); else app.home3d.stop(); }
    if (id !== 'screen-game') renderWalletHud();
    window.scrollTo(0, 0);
  }
  function renderWalletHud() {
    $('hud-gold').textContent = String(app.wallet.gold);
    $('hud-silver').textContent = U.unitsToText(app.wallet.silverUnits);
  }
  function err(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

  /* ---------- início ---------- */
  $('home-board').append(PGL.ui.homeBoardSVG());
  // Com Three.js disponível, a imagem da tela inicial vira o tabuleiro 3D do artefato.
  PGL.board3d.load(6000).then((T) => {
    if (!T) return;
    try {
      const box = $('home-board');
      box.replaceChildren();
      box.classList.add('is3d');
      app.home3d = PGL.board3d.createHome(box);
    } catch (e) { console.warn('3D indisponível', e); }
  });
  renderWalletHud();
  $('btn-start').onclick = () => {
    $('in-name').value = app.name || '';
    err('name-err', '');
    show('screen-name');
    $('in-name').focus();
  };

  /* ---------- nome ---------- */
  function confirmName() {
    const v = $('in-name').value.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!P.validName(v)) return err('name-err', 'Use de 1 a 16 letras, números, espaço, "-" ou "_".');
    app.name = v;
    $('mode-name').textContent = v;
    const max = Math.min(10, Math.floor(app.wallet.silverUnits / 2));
    $('in-buyin').max = String(max);
    $('in-buyin').value = String(Math.min(+$('in-buyin').value, max));
    $('buyin-val').textContent = $('in-buyin').value;
    show('screen-mode');
  }
  $('btn-name-ok').onclick = confirmName;
  $('in-name').onkeydown = (e) => { if (e.key === 'Enter') confirmName(); };
  $('btn-name-back').onclick = () => show('screen-home');

  /* ---------- modo ---------- */
  $('in-buyin').oninput = () => { $('buyin-val').textContent = $('in-buyin').value; };
  $('btn-mode-back').onclick = () => show('screen-name');
  $('btn-bot').onclick = startBot;
  $('btn-friend').onclick = () => { show('screen-friend'); selectTab('host'); };

  async function checkCrypto() {
    if (!(G.crypto && G.crypto.subtle) || !(await C.supported())) {
      alert('Este navegador não tem Ed25519 no Web Crypto. Atualize para Chrome 137+, Firefox 129+ ou Safari 17+.');
      return false;
    }
    return true;
  }

  /* ---------- partida com robô ---------- */
  async function startBot() {
    if (!(await checkCrypto())) return;
    app.mode = 'bot';
    app.buyinTaken = 0;
    const [tMe, tBot] = PGL.protocol.loopbackPair();
    const me = await C.newIdentity(), bot = await C.newIdentity();
    const session = U.randomHex(32);
    const s = new PGL.protocol.GameSession({ role: 'P1', identity: me, peer: { id: bot.id, pub: bot.pubB64, name: 'Robô' }, myName: app.name, session, transport: tMe, buyin: 0 });
    const sb = new PGL.protocol.GameSession({ role: 'P2', identity: bot, peer: { id: me.id, pub: me.pubB64, name: app.name }, myName: 'Robô', session, transport: tBot, buyin: 0 });
    PGL.bot.attach(sb, { delay: 650 });
    enterGame(s, 'Robô', false);
    await s.start();
    await sb.start();
  }

  /* ---------- partida com amigo ---------- */
  function selectTab(which) {
    $('tab-host').classList.toggle('active', which === 'host');
    $('tab-join').classList.toggle('active', which === 'join');
    $('pane-host').hidden = which !== 'host';
    $('pane-join').hidden = which !== 'join';
    err('friend-err', '');
    if (which === 'host' && !app.hostCtx) createInvite();
  }
  $('tab-host').onclick = () => selectTab('host');
  $('tab-join').onclick = () => selectTab('join');
  $('btn-friend-back').onclick = () => { cancelFriend(); show('screen-mode'); };

  function cancelFriend() {
    if (app.hostCtx) app.hostCtx.ctx.cancel();
    if (app.joinCtx) app.joinCtx.ctx.cancel();
    app.hostCtx = app.joinCtx = app.invite = null;
    $('host-share').hidden = true;
    $('host-status').textContent = 'Gerando chaves e convite…';
    $('join-confirm').hidden = true;
    $('join-share').hidden = true;
    $('join-invite').value = '';
    $('host-answer').value = '';
  }

  function drawQR(canvas, code) {
    const qr = PGL.qr.encodeText(code);
    canvas.hidden = !qr;
    if (qr) PGL.qr.drawToCanvas(canvas, qr, 4);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado!'); } catch (e) { toast('Selecione o texto e copie manualmente.'); }
  }
  function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; setTimeout(() => { t.hidden = true; }, 2000); }

  async function createInvite() {
    if (!(await checkCrypto())) return;
    try {
      const identity = await C.newIdentity();
      const ctx = await PGL.p2p.host(identity, app.name);
      app.hostCtx = { identity, ctx };
      $('host-code').value = ctx.code;
      drawQR($('host-qr'), ctx.code);
      $('host-fp').textContent = C.shortFingerprint(identity.id);
      $('host-status').textContent = 'Convite pronto.';
      $('host-share').hidden = false;
    } catch (e) { err('friend-err', 'Não foi possível criar o convite: ' + e.message); }
  }
  $('btn-copy-host').onclick = () => copy($('host-code').value);
  $('btn-host-connect').onclick = async () => {
    err('friend-err', '');
    const btn = $('btn-host-connect');
    btn.disabled = true; btn.textContent = 'Conectando…';
    try {
      const { transport, peer, session } = await app.hostCtx.ctx.accept($('host-answer').value);
      startFriendGame('P1', app.hostCtx.identity, peer, session, transport);
    } catch (e) { err('friend-err', e.message || String(e)); }
    btn.disabled = false; btn.textContent = 'Conectar';
  };

  $('btn-join-read').onclick = async () => {
    err('friend-err', '');
    if (!(await checkCrypto())) return;
    try {
      app.invite = await PGL.p2p.inspectInvite($('join-invite').value);
      $('join-host-name').textContent = app.invite.peer.name;
      $('join-host-fp').textContent = C.shortFingerprint(app.invite.peer.id);
      $('join-confirm').hidden = false;
    } catch (e) { err('friend-err', 'Convite inválido: ' + (e.message || e.code)); }
  };
  $('btn-join-accept').onclick = async () => {
    err('friend-err', '');
    try {
      const identity = await C.newIdentity();
      const ctx = await PGL.p2p.join(identity, app.name, app.invite);
      app.joinCtx = { identity, ctx };
      $('join-code').value = ctx.code;
      drawQR($('join-qr'), ctx.code);
      $('join-fp').textContent = C.shortFingerprint(identity.id);
      $('join-confirm').hidden = true;
      $('join-share').hidden = false;
      const { transport, peer, session } = await ctx.connected();
      startFriendGame('P2', identity, peer, session, transport);
    } catch (e) { err('friend-err', e.message || String(e)); }
  };
  $('btn-copy-join').onclick = () => copy($('join-code').value);

  async function startFriendGame(role, identity, peer, session, transport) {
    app.mode = 'friend';
    const want = Math.min(+$('in-buyin').value * 2, 20);
    app.buyinTaken = W.takeBuyin(app.wallet, want);
    const s = new PGL.protocol.GameSession({ role, identity, peer, myName: app.name, session, transport, buyin: app.buyinTaken });
    app.hostCtx = app.joinCtx = null;
    enterGame(s, peer.name, true);
    await s.start();
  }

  /* ---------- partida ---------- */
  function enterGame(session, foeName, friend) {
    app.session = session;
    if (app.view) app.view.destroy();
    show('screen-game');
    app.view = new PGL.ui.GameView(session, {
      myName: app.name, foeName, wallet: app.wallet, foeBuyinUnverified: friend,
      onFinish: (r) => finish(r),
      onLost: (msg) => lost(msg),
    });
  }

  function finish(r) {
    const s = app.session;
    let text = r.iWon ? 'Você destruiu o rei adversário.' : 'Seu rei foi destruído.';
    text += r.verified ? ' Resultado conferido pelos dois lados.' : ' ATENÇÃO: a auditoria final falhou — o adversário pode ter trapaceado.';
    if (app.mode === 'friend') {
      W.settle(app.wallet, r, s.role);
      text += r.iWon ? ' Você levou o pote do perdedor e a ficha dourada do rei dele.' : '';
    } else text += ' (Treino contra o robô: a carteira não muda.)';
    overlay(r.iWon ? 'Vitória!' : 'Derrota', text, true);
  }
  function lost(msg) {
    if (!app.session || app.session.result) return;
    if (app.mode === 'friend' && app.buyinTaken) { app.wallet.silverUnits += app.buyinTaken; W.save(app.wallet); app.buyinTaken = 0; }
    overlay('Partida interrompida', msg + ' Sem resultado; as fichas trazidas da carteira foram devolvidas.', false);
  }
  function overlay(title, text, coins) {
    $('ov-title').textContent = title;
    $('ov-text').textContent = text;
    $('ov-coins').hidden = !coins;
    $('ov-gold').textContent = String(app.wallet.gold);
    $('ov-silver').textContent = U.unitsToText(app.wallet.silverUnits);
    $('overlay').hidden = false;
  }
  $('ov-btn').onclick = () => {
    $('overlay').hidden = true;
    if (app.session) { app.session.closed = true; try { app.session.transport.close(); } catch (e) { /* ok */ } }
    app.session = null;
    show('screen-home');
  };

  PGL.app = app; // para depuração no console
})(window);
