/* p2p.js — conexão WebRTC sem servidor de sinalização (project.md §1.2, §12.1–§12.3).
 *
 * Fluxo:
 *  1. P1 cria a oferta, espera os candidatos ICE e gera um connect_request ASSINADO.
 *     Esse documento vira um código (texto compactado) + QR Code para o amigo.
 *  2. P2 cola/lê o código, confere esquema + assinatura + fingerprint e responde com
 *     connect_answer assinado, que também vira código + QR.
 *  3. P1 cola a resposta. O canal de dados abre e a partida começa.
 * A chave pública vem dentro do documento; por isso os dois conferem o fingerprint curto
 * (§12.3). O SDP assinado inclui o fingerprint DTLS do WebRTC, amarrando o canal à chave.
 */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const U = PGL.util, P = PGL.pgl, C = PGL.crypto;
  const { F, B } = P;

  // STUN público ajuda a atravessar NAT. Para redes móveis com CGNAT, adicione um TURN aqui.
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const PREFIX = 'PGL1.';

  /* ---------- código compartilhável ---------- */
  /** Passa bytes por um stream de (des)compressão, abortando se passar de "limit" bytes. */
  async function pipe(bytes, stream, limit) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (limit && total > limit) { reader.cancel(); throw new Error('Código grande demais.'); }
      parts.push(value);
    }
    return U.concat(...parts);
  }
  async function toCode(text) {
    if (typeof CompressionStream === 'undefined') return PREFIX + 'r' + U.toB64u(U.utf8(text));
    return PREFIX + 'z' + U.toB64u(await pipe(U.utf8(text), new CompressionStream('deflate-raw')));
  }
  async function fromCode(code) {
    const c = String(code).replace(/\s+/g, '');
    if (!c.startsWith(PREFIX) || c.length > 60000) throw new Error('Código inválido.');
    const kind = c[PREFIX.length];
    const body = U.fromB64u(c.slice(PREFIX.length + 1));
    let bytes;
    if (kind === 'r') bytes = body;
    else if (kind === 'z') {
      // Limite de descompressão contra "bombas": o documento PGL tem no máximo 32 KB.
      bytes = await pipe(body, new DecompressionStream('deflate-raw'), P.LIMITS.maxBytes);
    } else throw new Error('Código inválido.');
    if (bytes.length > P.LIMITS.maxBytes) throw new Error('Código grande demais.');
    return U.fromUtf8(bytes);
  }

  /* ---------- transporte sobre DataChannel ---------- */
  function channelTransport(pc, dc) {
    const msg = [], cls = [];
    let closed = false;
    const doClose = () => { if (closed) return; closed = true; cls.forEach((h) => h()); };
    dc.onmessage = (e) => { if (typeof e.data === 'string') msg.forEach((h) => h(e.data)); };
    dc.onclose = doClose;
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) setTimeout(() => { if (pc.connectionState !== 'connected') doClose(); }, pc.connectionState === 'disconnected' ? 8000 : 0); });
    return {
      send(t) { if (dc.readyState === 'open') dc.send(t); },
      onMessage(h) { msg.push(h); },
      onClose(h) { cls.push(h); },
      close() { closed = true; try { dc.close(); pc.close(); } catch (e) { /* ok */ } },
    };
  }

  function waitIce(pc, ms) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  function waitOpen(dc, ms) {
    return new Promise((res, rej) => {
      if (dc.readyState === 'open') return res();
      const t = setTimeout(() => rej(new Error('A conexão não abriu a tempo. Redes móveis às vezes exigem um servidor TURN.')), ms);
      dc.addEventListener('open', () => { clearTimeout(t); res(); });
    });
  }

  /** Lê e valida um documento de conexão recebido como código. Retorna dados do par. */
  async function readConnectDoc(code, expectType) {
    const text = await fromCode(code);
    const root = P.parse(text);
    const type = P.validate(root);
    if (type !== expectType) throw new Error('Este código não é ' + (expectType === 'connect_request' ? 'um convite.' : 'uma resposta.'));
    const pub = P.get(root, '#pub');
    if (C.fingerprint(U.fromB64u(pub)) !== P.get(root, '#sender')) throw new Error('Fingerprint não confere com a chave.');
    if (!(await C.verifyDoc(root, await C.importPub(pub)))) throw new Error('Assinatura inválida.');
    const blk = P.get(root, type === 'connect_request' ? '@c_r' : '@c_a');
    return {
      root, hash: P.get(root, '#doc_hash'), session: P.get(root, '#session'), replyTo: P.get(root, '#reply_to'),
      peer: { id: P.get(root, '#sender'), pub, name: P.decodeName(P.get(root, '#name')) },
      sdp: U.fromUtf8(U.fromB64u(P.get(blk, type === 'connect_request' ? '#offer' : '#answer'))),
    };
  }

  /* ---------- P1: cria convite ---------- */
  async function host(identity, myName) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel('pgl', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc, 5000);
    const session = U.randomHex(32);
    const root = B('#pgl', [F('#v', '1.0'), F('#type', 'connect_request'), F('#session', session), F('#doc_id', U.randomHex(32)), F('#sender', identity.id),
      F('#pub', identity.pubB64), F('#name', P.encodeName(myName)),
      B('@c_r', [F('#transport', 'webrtc'), F('#mode', 'direct'), F('#offer', U.toB64u(U.utf8(pc.localDescription.sdp))), F('#ice', 'inline')])]);
    const sealed = await C.sealDoc(root, identity);
    const code = await toCode(sealed.text);
    return {
      code, session,
      /** Recebe o código de resposta do amigo e abre o canal. */
      async accept(answerCode) {
        const ans = await readConnectDoc(answerCode, 'connect_answer');
        if (ans.session !== session || ans.replyTo !== sealed.hash) throw new Error('Esta resposta é de outro convite.');
        if (ans.peer.id === identity.id) throw new Error('Você colou o seu próprio código.');
        await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
        await waitOpen(dc, 25000);
        return { transport: channelTransport(pc, dc), peer: ans.peer, session };
      },
      cancel() { try { pc.close(); } catch (e) { /* ok */ } },
    };
  }

  /* ---------- P2: responde ao convite ---------- */
  async function inspectInvite(code) { return readConnectDoc(code, 'connect_request'); }
  async function join(identity, myName, invite) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dcP = new Promise((res) => { pc.ondatachannel = (e) => res(e.channel); });
    await pc.setRemoteDescription({ type: 'offer', sdp: invite.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc, 5000);
    const root = B('#pgl', [F('#v', '1.0'), F('#type', 'connect_answer'), F('#session', invite.session), F('#doc_id', U.randomHex(32)), F('#reply_to', invite.hash),
      F('#sender', identity.id), F('#pub', identity.pubB64), F('#name', P.encodeName(myName)),
      B('@c_a', [F('#transport', 'webrtc'), F('#mode', 'direct'), F('#answer', U.toB64u(U.utf8(pc.localDescription.sdp))), F('#ice', 'inline')])]);
    const sealed = await C.sealDoc(root, identity);
    const code = await toCode(sealed.text);
    return {
      code,
      async connected() {
        const dc = await dcP;
        await waitOpen(dc, 60000);
        return { transport: channelTransport(pc, dc), peer: invite.peer, session: invite.session };
      },
      cancel() { try { pc.close(); } catch (e) { /* ok */ } },
    };
  }

  PGL.p2p = { host, join, inspectInvite, toCode, fromCode, ICE_SERVERS };
})(typeof window !== 'undefined' ? window : globalThis);
