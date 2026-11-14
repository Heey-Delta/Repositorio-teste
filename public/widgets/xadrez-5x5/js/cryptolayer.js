/* cryptolayer.js — Ed25519 (WebCrypto nativo), hashes de documento/ação e sorteio privado.
 * project.md §5.4 e §13. */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const U = PGL.util;
  const P = PGL.pgl;
  const subtle = () => G.crypto.subtle;

  /* ---------------- Chaves ---------------- */
  async function supported() {
    try {
      await subtle().generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
      return true;
    } catch (e) { return false; }
  }
  /** Par de chaves efêmero da sessão. A chave privada é não-exportável e nunca sai do aparelho. */
  async function newIdentity() {
    const kp = await subtle().generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const pubRaw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
    return { privateKey: kp.privateKey, pubRaw, pubB64: U.toB64u(pubRaw), id: fingerprint(pubRaw) };
  }
  function fingerprint(pubRaw) { return U.sha256Hex(U.concat(U.utf8('PGL1/KEY\0'), pubRaw)); }
  /** Fingerprint curto para conferência humana: 4 grupos de 4 caracteres. */
  function shortFingerprint(id) { return id.slice(0, 16).toUpperCase().match(/.{4}/g).join('-'); }

  async function importPub(pubB64) {
    return subtle().importKey('raw', U.fromB64u(pubB64), { name: 'Ed25519' }, false, ['verify']);
  }
  async function signBytes(identity, bytes) {
    return new Uint8Array(await subtle().sign({ name: 'Ed25519' }, identity.privateKey, bytes));
  }
  async function verifyBytes(pubKey, sigB64, bytes) {
    try { return await subtle().verify({ name: 'Ed25519' }, pubKey, U.fromB64u(sigB64), bytes); } catch (e) { return false; }
  }

  /* ---------------- Documento ---------------- */
  function docHash(root) { return U.sha256Hex(P.serialize(P.without(root, ['#doc_hash', '#sign']))); }
  function docSigMessage(type, hash) { return U.utf8('PGL1/DOC\0' + type + '\0' + hash); }

  /** Recebe a raiz SEM #doc_hash/#sign, acrescenta os dois e devolve o texto canônico. */
  async function sealDoc(root, identity) {
    const type = P.get(root, '#type');
    const h = docHash(root);
    const sig = await signBytes(identity, docSigMessage(type, h));
    root.children.push(P.F('#doc_hash', h));
    root.children.push(P.B('#sign', [P.F('#alg', 'ed25519'), P.F('#sig', U.toB64u(sig))]));
    return { text: P.serialize(root), hash: h, root };
  }
  /** Confere #doc_hash e a assinatura externa. Não substitui esquema nem regras. */
  async function verifyDoc(root, pubKey) {
    const type = P.get(root, '#type');
    const h = docHash(root);
    if (h !== P.get(root, '#doc_hash')) return false;
    const sig = P.get(P.get(root, '#sign'), '#sig');
    return verifyBytes(pubKey, sig, docSigMessage(type, h));
  }

  /* ---------------- Ação ---------------- */
  function actionHash(actionNode) { return U.sha256Hex(P.serializeNode(P.without(actionNode, ['#ahash', '#asig']))); }
  function actionSigMessage(ctx, ahash) {
    return U.utf8(['PGL1/ACTION', ctx.session, ctx.sender, String(ctx.seq), ahash].join('\0'));
  }
  async function sealAction(actionNode, ctx, identity) {
    const ah = actionHash(actionNode);
    const sig = await signBytes(identity, actionSigMessage(ctx, ah));
    actionNode.children.push(P.F('#ahash', ah));
    actionNode.children.push(P.F('#asig', U.toB64u(sig)));
    return actionNode;
  }
  async function verifyAction(actionNode, ctx, pubKey) {
    const ah = actionHash(actionNode);
    if (ah !== P.get(actionNode, '#ahash')) return false;
    return verifyBytes(pubKey, P.get(actionNode, '#asig'), actionSigMessage(ctx, ah));
  }

  /* ---------------- Sorteio privado (§5.4) ---------------- */
  const R = () => PGL.rules.RULES;
  function drawCommit(session, drawId, secret) { return U.toHex(U.domainHash('PGL1/DRAW-COMMIT', session, drawId, secret)); }
  function drawPieceId(session, drawId, secret) { return U.toHex(U.domainHash('PGL1/PIECE-ID', session, drawId, secret)); }
  /** Converte sem viés para 0..13999 e mapeia na tabela. */
  function drawKind(session, drawId, secret, seed) {
    let r = U.domainHash('PGL1/DRAW-RESULT', session, drawId, secret, seed);
    for (let round = 0; round < 64; round++) {
      const dv = new DataView(r.buffer, r.byteOffset, 32);
      for (let i = 0; i < 8; i++) {
        const x = dv.getUint32(i * 4);
        if (x < R().drawThreshold) {
          const n = x % R().drawModulo;
          return R().drawTable.find((e) => n <= e.upTo).kind;
        }
      }
      r = U.domainHash('PGL1/DRAW-RETRY', r);
    }
    throw new Error('sorteio sem resultado');
  }
  function newDraw(session) {
    const drawId = U.randomHex(32);
    const secret = U.randomHex(32);
    return { drawId, secret, commit: drawCommit(session, drawId, secret) };
  }

  PGL.crypto = {
    supported, newIdentity, fingerprint, shortFingerprint, importPub, signBytes, verifyBytes,
    docHash, sealDoc, verifyDoc, actionHash, sealAction, verifyAction,
    drawCommit, drawPieceId, drawKind, newDraw,
  };
})(typeof window !== 'undefined' ? window : globalThis);
