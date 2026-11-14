/* pgl.js — linguagem PGL: parser estrito, serializador canônico e esquemas.
 *
 * Segurança (project.md §10 e §14):
 *  - PGL é só dado. Nada é avaliado, interpolado ou executado.
 *  - Só ASCII imprimível + LF. Limites de bytes, linhas, profundidade e nós.
 *  - Só a FORMA CANÔNICA é aceita: depois do parse o documento é re-serializado e precisa
 *    gerar exatamente os mesmos bytes. Isso elimina ambiguidade antes de hashes e assinaturas.
 *  - Todo campo/comando precisa existir no esquema do tipo de documento, na ordem certa,
 *    com o tipo certo. Campo desconhecido, duplicado ou fora de ordem = rejeição.
 */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const U = PGL.util;

  class PGLError extends Error {
    constructor(code, msg) { super(msg || code); this.code = code; }
  }

  const LIMITS = {
    maxBytes: 32768,
    maxLines: 400,
    maxDepth: 6,
    maxLineLen: 16384,
    maxValueLen: 16000,
  };

  const NAME_RE = /^[#@][a-z][a-z0-9_]{0,23}$/;
  const VALUE_RE = /^[A-Za-z0-9_.-]+$/;

  /* ---------------- Nós ---------------- */
  function F(name, value) { return { kind: 'field', name, value: String(value) }; }
  function B(name, children) { return { kind: 'block', name, children: children.filter(Boolean) }; }

  /* ---------------- Serialização canônica ---------------- */
  function serializeLines(node, depth, out) {
    const ind = '  '.repeat(depth);
    if (node.kind === 'field') {
      out.push(ind + node.name + ':' + node.value);
    } else {
      out.push(ind + node.name + '<');
      for (const c of node.children) serializeLines(c, depth + 1, out);
      out.push(ind + '>');
    }
  }
  /** Documento completo: raiz "<#pgl" … ">" + LF final. */
  function serialize(root) {
    const out = ['<#pgl'];
    for (const c of root.children) serializeLines(c, 1, out);
    out.push('>');
    return out.join('\n') + '\n';
  }
  /** Sub-árvore isolada (para hash de ação), sempre a partir da profundidade 0. */
  function serializeNode(node) {
    const out = [];
    serializeLines(node, 0, out);
    return out.join('\n') + '\n';
  }

  /* ---------------- Parser ---------------- */
  function parse(text) {
    if (typeof text !== 'string') throw new PGLError('invalid_syntax', 'entrada não é texto');
    if (text.length > LIMITS.maxBytes) throw new PGLError('invalid_syntax', 'documento grande demais');
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c !== 10 && (c < 0x20 || c > 0x7e)) throw new PGLError('invalid_syntax', 'caractere proibido');
    }
    if (!text.endsWith('\n')) throw new PGLError('invalid_syntax', 'falta LF final');
    const lines = text.slice(0, -1).split('\n');
    if (lines.length > LIMITS.maxLines) throw new PGLError('invalid_syntax', 'linhas demais');
    if (lines[0] !== '<#pgl') throw new PGLError('invalid_syntax', 'cabeçalho inválido');
    const root = { kind: 'block', name: '#pgl', children: [] };
    const stack = [root];
    for (let li = 1; li < lines.length; li++) {
      const line = lines[li];
      if (line.length > LIMITS.maxLineLen) throw new PGLError('invalid_syntax', 'linha longa demais');
      const m = /^( *)(.*)$/.exec(line);
      const body = m[2];
      if (body === '>') {
        stack.pop();
        if (stack.length === 0) {
          if (li !== lines.length - 1) throw new PGLError('invalid_syntax', 'conteúdo após o fim');
          break;
        }
        continue;
      }
      if (stack.length === 0) throw new PGLError('invalid_syntax', 'conteúdo após o fim');
      if (body.endsWith('<')) {
        const name = body.slice(0, -1);
        if (!NAME_RE.test(name)) throw new PGLError('invalid_syntax', 'nome de bloco inválido');
        if (stack.length >= LIMITS.maxDepth) throw new PGLError('invalid_syntax', 'profundidade excessiva');
        const blk = { kind: 'block', name, children: [] };
        stack[stack.length - 1].children.push(blk);
        stack.push(blk);
        continue;
      }
      const colon = body.indexOf(':');
      if (colon < 0) throw new PGLError('invalid_syntax', 'linha sem ":"');
      const name = body.slice(0, colon);
      const value = body.slice(colon + 1);
      if (!NAME_RE.test(name) || name[0] !== '#') throw new PGLError('invalid_syntax', 'nome de campo inválido');
      if (!value.length || value.length > LIMITS.maxValueLen || !VALUE_RE.test(value))
        throw new PGLError('invalid_syntax', 'valor inválido');
      stack[stack.length - 1].children.push({ kind: 'field', name, value });
    }
    if (stack.length !== 0) throw new PGLError('invalid_syntax', 'bloco não fechado');
    // Canonicidade: só aceitamos os bytes exatamente canônicos.
    if (serialize(root) !== text) throw new PGLError('invalid_syntax', 'documento não canônico');
    return root;
  }

  /* ---------------- Acesso ---------------- */
  function get(node, name) {
    const f = node.children.find((c) => c.name === name);
    return f ? (f.kind === 'field' ? f.value : f) : undefined;
  }
  function getAll(node, name) { return node.children.filter((c) => c.name === name); }
  function without(node, names) {
    return { kind: 'block', name: node.name, children: node.children.filter((c) => !names.includes(c.name)) };
  }

  /* ---------------- Tipos de valor ---------------- */
  function decodeName(v) {
    let s;
    try { s = U.fromUtf8(U.fromB64u(v)); } catch (e) { return null; }
    return validName(s) ? s : null;
  }
  function validName(s) {
    if (typeof s !== 'string') return false;
    if (s.normalize('NFC') !== s) return false;
    const cps = Array.from(s);
    if (cps.length < 1 || cps.length > 16) return false;
    if (s.trim() !== s || /  /.test(s)) return false;
    return /^[\p{L}\p{N} _-]+$/u.test(s);
  }
  function encodeName(s) { return U.toB64u(U.utf8(s)); }

  function b64Len(min, max) {
    return (v) => {
      try { const b = U.fromB64u(v); return b.length >= min && b.length <= max; } catch (e) { return false; }
    };
  }
  const T = {
    hex64: (v) => /^[0-9a-f]{64}$/.test(v),
    coord: (v) => /^[A-E][1-5]$/.test(v),
    coordOrInv: (v) => v === 'inv' || /^[A-E][1-5]$/.test(v),
    pub: b64Len(32, 32),
    sig: b64Len(64, 64),
    sdp: b64Len(10, 11000),
    name: (v) => decodeName(v) !== null,
    int: (min, max) => (v) => /^(0|[1-9][0-9]{0,8})$/.test(v) && +v >= min && +v <= max,
    en: (...vals) => (v) => vals.includes(v),
  };

  /* ---------------- Esquemas ---------------- */
  // f = campo, b = bloco. opt = opcional. rep = [min, max] repetível. set = bloco de filhos
  // sem ordem fixa, cada um no máximo uma vez, com no máximo "max" filhos (usado por @act).
  const f = (name, check, extra) => Object.assign({ f: name, check }, extra || {});
  const b = (name, kids, extra) => Object.assign({ b: name, kids }, extra || {});

  const SIGN = b('#sign', [f('#alg', T.en('ed25519')), f('#sig', T.sig)]);
  const HEAD = (type) => [f('#v', T.en('1.0')), f('#type', T.en(type))];
  const TAIL = [f('#doc_hash', T.hex64), SIGN];
  const KING_PIECE = b('#piece', [f('#piece', T.hex64), f('#kind', T.en('king')), f('#owner', T.en('P1', 'P2')), f('#position', T.coord), f('#hp', T.int(10, 10))]);
  const ACTION_SIG = [f('#ahash', T.hex64), f('#asig', T.sig)];
  const REVEAL = b('#reveal', [f('#draw_id', T.hex64), f('#kind', T.en('pawn', 'knight', 'bishop', 'rook', 'queen')), f('#secret', T.hex64)]);

  const BUY = b('@buy', [b('#draw', [f('#draw_id', T.hex64)], { rep: [1, 5] }), ...ACTION_SIG]);
  const MOVE = b('@move', [f('#piece', T.hex64), f('#from', T.coordOrInv), f('#to', T.coord), Object.assign({}, REVEAL, { opt: true }), ...ACTION_SIG]);
  const ATTACK = b('@attack', [f('#piece', T.hex64), f('#from', T.coord), f('#target', T.hex64), f('#at', T.coord), ...ACTION_SIG]);

  const CHAIN = [f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64), f('#seq', T.int(1, 100000)), f('#turn', T.int(1, 100000)), f('#prev', T.hex64)];

  const SCHEMAS = {
    connect_request: [...HEAD('connect_request'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#pub', T.pub), f('#name', T.name),
      b('@c_r', [f('#transport', T.en('webrtc')), f('#mode', T.en('direct')), f('#offer', T.sdp), f('#ice', T.en('inline'))]), ...TAIL],
    connect_answer: [...HEAD('connect_answer'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#reply_to', T.hex64), f('#sender', T.hex64), f('#pub', T.pub), f('#name', T.name),
      b('@c_a', [f('#transport', T.en('webrtc')), f('#mode', T.en('direct')), f('#answer', T.sdp), f('#ice', T.en('inline'))]), ...TAIL],
    ready: [...HEAD('ready'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64), b('@ready', [f('#status', T.en('ok'))]), ...TAIL],
    init: [...HEAD('init'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64),
      f('#board', T.en('5x5')), f('#energy_start', T.int(10, 10)), f('#energy_max', T.int(15, 15)), f('#chips_start', T.int(3, 3)), f('#stake_max', T.int(40, 40)),
      f('#first', T.en('P1')), f('#rules', T.hex64), f('#buyin', T.int(0, 20)), b('@init', [KING_PIECE, KING_PIECE]), ...TAIL],
    accept: [...HEAD('accept'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64), f('#reply_to', T.hex64),
      f('#buyin', T.int(0, 20)), b('@accept', [f('#status', T.en('ok'))]), f('#state_after', T.hex64), ...TAIL],
    draw_request: [...HEAD('draw_request'), ...CHAIN, b('@draw_req', [b('#draw', [f('#draw_id', T.hex64), f('#commit', T.hex64)], { rep: [1, 5] })]), ...TAIL],
    draw_seed: [...HEAD('draw_seed'), ...CHAIN, f('#reply_to', T.hex64), b('@draw_seed', [b('#draw', [f('#draw_id', T.hex64), f('#seed', T.hex64)], { rep: [1, 5] })]), ...TAIL],
    turn: [...HEAD('turn'), ...CHAIN, f('#state_before', T.hex64), f('#rules', T.hex64),
      b('@stake', [f('#add', T.int(1, 40)), f('#total', T.int(1, 40))], { opt: true }),
      { b: '@act', set: [BUY, MOVE, ATTACK], max: 3 },
      f('#state_after', T.hex64), ...TAIL],
    ack: [...HEAD('ack'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64), f('#reply_to', T.hex64),
      b('@ack', [f('#seq', T.int(0, 100000)), f('#state', T.hex64), f('#status', T.en('accepted'))]), ...TAIL],
    reject: [...HEAD('reject'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64), f('#reply_to', T.hex64),
      b('@reject', [f('#reason_code', T.en(...REASONS()))]), ...TAIL],
    final: [...HEAD('final'), f('#session', T.hex64), f('#doc_id', T.hex64), f('#sender', T.hex64), f('#recipient', T.hex64), f('#prev', T.hex64), f('#state', T.hex64),
      b('@final', [f('#winner', T.en('P1', 'P2')), Object.assign({}, REVEAL, { rep: [0, 60] })]), ...TAIL],
  };

  function REASONS() {
    return ['invalid_signature', 'invalid_syntax', 'invalid_schema', 'unknown_field', 'unknown_command', 'session_mismatch', 'sender_mismatch',
      'recipient_mismatch', 'replay_detected', 'out_of_sequence', 'state_mismatch', 'rules_mismatch', 'duplicate_action', 'insufficient_energy',
      'insufficient_chips', 'invalid_piece', 'invalid_position', 'illegal_move', 'illegal_attack', 'invalid_draw', 'unsettled_draw', 'invalid_reveal',
      'card_already_revealed', 'stake_limit_exceeded', 'stake_mismatch', 'not_your_turn', 'game_already_finished', 'too_many_actions'];
  }

  function matchKids(kids, specs, path) {
    let i = 0;
    for (const s of specs) {
      const name = s.f || s.b;
      if (s.rep) {
        let n = 0;
        while (i < kids.length && kids[i].name === name) { checkNode(kids[i], s, path); i++; n++; }
        if (n < s.rep[0] || n > s.rep[1]) throw new PGLError('invalid_schema', path + name + ': quantidade inválida');
        continue;
      }
      if (i < kids.length && kids[i].name === name) { checkNode(kids[i], s, path); i++; continue; }
      if (s.opt) continue;
      throw new PGLError('invalid_schema', path + name + ': obrigatório');
    }
    if (i < kids.length) {
      const n = kids[i];
      const known = specs.some((s) => (s.f || s.b) === n.name);
      throw new PGLError(known ? 'invalid_schema' : n.name[0] === '@' ? 'unknown_command' : 'unknown_field', path + n.name + ': inesperado');
    }
  }
  function checkNode(node, spec, path) {
    if (spec.f) {
      if (node.kind !== 'field') throw new PGLError('invalid_schema', path + spec.f + ': deveria ser campo');
      if (!spec.check(node.value)) throw new PGLError('invalid_schema', path + spec.f + ': valor inválido');
      return;
    }
    if (node.kind !== 'block') throw new PGLError('invalid_schema', path + spec.b + ': deveria ser bloco');
    if (spec.set) {
      if (node.children.length > spec.max) throw new PGLError('too_many_actions', '@act aceita no máximo ' + spec.max + ' parâmetros');
      const seen = new Set();
      for (const k of node.children) {
        const sub = spec.set.find((s) => s.b === k.name);
        if (!sub) throw new PGLError('unknown_command', path + k.name);
        if (seen.has(k.name)) throw new PGLError('duplicate_action', k.name + ' repetido no turno');
        seen.add(k.name);
        checkNode(k, sub, path + spec.b + '/');
      }
      return;
    }
    matchKids(node.children, spec.kids, path + spec.b + '/');
  }

  /** Valida a raiz contra o esquema do seu #type. Retorna o tipo. */
  function validate(root) {
    const typeNode = root.children[1];
    const type = typeNode && typeNode.name === '#type' ? typeNode.value : null;
    if (!type || !Object.prototype.hasOwnProperty.call(SCHEMAS, type)) throw new PGLError('invalid_schema', 'tipo de documento desconhecido');
    matchKids(root.children, SCHEMAS[type], '');
    return type;
  }

  PGL.pgl = { PGLError, LIMITS, F, B, serialize, serializeNode, parse, validate, get, getAll, without, encodeName, decodeName, validName, REASONS: REASONS() };
})(typeof window !== 'undefined' ? window : globalThis);
