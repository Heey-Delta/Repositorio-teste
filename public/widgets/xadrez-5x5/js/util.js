/* util.js — utilitários puros: bytes, hex, base64url, SHA-256 síncrono, aleatoriedade.
 * Tudo aqui é determinístico, exceto randomBytes. Sem dependências externas. */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});

  const te = new TextEncoder();
  const td = new TextDecoder('utf-8', { fatal: true });

  function utf8(str) { return te.encode(str); }
  function fromUtf8(bytes) { return td.decode(bytes); }

  function concat(...parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  const HEX = '0123456789abcdef';
  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    return s;
  }
  function fromHex(hex) {
    if (!/^([0-9a-f]{2})*$/.test(hex)) throw new Error('hex inválido');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function toB64u(bytes) {
    let s = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rem = bytes.length - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    } else if (rem === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
    }
    return s;
  }
  const B64IDX = {};
  for (let i = 0; i < 64; i++) B64IDX[B64[i]] = i;
  function fromB64u(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('base64url inválido');
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let o = 0;
    let i = 0;
    for (; i + 3 < s.length; i += 4) {
      const n = (B64IDX[s[i]] << 18) | (B64IDX[s[i + 1]] << 12) | (B64IDX[s[i + 2]] << 6) | B64IDX[s[i + 3]];
      out[o++] = (n >> 16) & 255; out[o++] = (n >> 8) & 255; out[o++] = n & 255;
    }
    const rem = s.length - i;
    if (rem === 2) {
      const n = (B64IDX[s[i]] << 18) | (B64IDX[s[i + 1]] << 12);
      out[o++] = (n >> 16) & 255;
    } else if (rem === 3) {
      const n = (B64IDX[s[i]] << 18) | (B64IDX[s[i + 1]] << 12) | (B64IDX[s[i + 2]] << 6);
      out[o++] = (n >> 16) & 255; out[o++] = (n >> 8) & 255;
    }
    const res = out.subarray(0, o);
    // Forma canônica: re-codificar precisa dar a mesma string (rejeita bits de sobra).
    if (toB64u(res) !== s) throw new Error('base64url não canônico');
    return res;
  }

  /* ---------- SHA-256 síncrono (FIPS 180-4) ----------
   * Usado pelo motor de regras e pelo PGL para que o processamento seja síncrono e
   * idêntico em todos os navegadores. */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256(data) {
    const bytes = typeof data === 'string' ? utf8(data) : data;
    const l = bytes.length;
    const withPad = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(withPad);
    m.set(bytes);
    m[l] = 0x80;
    const bitLenHi = Math.floor((l * 8) / 0x100000000);
    const bitLenLo = (l * 8) >>> 0;
    const dv = new DataView(m.buffer);
    dv.setUint32(withPad - 8, bitLenHi);
    dv.setUint32(withPad - 4, bitLenLo);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    for (let off = 0; off < withPad; off += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
      for (let t = 16; t < 64; t++) {
        const x = W[t - 15], y = W[t - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }
  function sha256Hex(data) { return toHex(sha256(data)); }

  /** Hash com separação de domínio: SHA-256(tag ‖ 0x00 ‖ parte1 ‖ 0x00 ‖ parte2 ...). */
  function domainHash(tag, ...parts) {
    const chunks = [utf8(tag)];
    for (const p of parts) {
      chunks.push(new Uint8Array([0]));
      chunks.push(typeof p === 'string' ? utf8(p) : p);
    }
    return sha256(concat(...chunks));
  }

  function randomBytes(n) {
    const b = new Uint8Array(n);
    G.crypto.getRandomValues(b);
    return b;
  }
  function randomHex(nBytes) { return toHex(randomBytes(nBytes)); }

  /** Meias-fichas (inteiro) → texto "7,5". */
  function unitsToText(u) {
    const whole = Math.floor(u / 2);
    return u % 2 ? whole + ',5' : String(whole);
  }

  PGL.util = { utf8, fromUtf8, concat, toHex, fromHex, toB64u, fromB64u, sha256, sha256Hex, domainHash, randomBytes, randomHex, unitsToText };
})(typeof window !== 'undefined' ? window : globalThis);
