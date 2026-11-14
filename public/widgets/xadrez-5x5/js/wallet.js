/* wallet.js — carteira local entre partidas (project.md §4.6.6).
 * Formato do valor: "douradas;prateadas", ex.: "3;7,5". Fica só neste navegador (localStorage).
 * É editável pelo próprio usuário; por isso o buy-in por partida é limitado a 10 fichas. */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  const U = PGL.util;

  const KEY_ID = 'pgl.wallet.id';
  const KEY_VAL = 'pgl.wallet.value';
  const VALUE_RE = /^(\d{1,6});(\d{1,7})(,5)?$/;
  const DEFAULT = { gold: 0, silverUnits: 6 }; // 0 douradas, 3 prateadas

  const mem = {};
  function store() {
    try { const ls = G.localStorage; ls.setItem('pgl.t', '1'); ls.removeItem('pgl.t'); return ls; } catch (e) {
      return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    }
  }

  function parseValue(v) {
    const m = VALUE_RE.exec(v || '');
    if (!m) return null;
    return { gold: +m[1], silverUnits: +m[2] * 2 + (m[3] ? 1 : 0) };
  }
  function formatValue(w) { return w.gold + ';' + U.unitsToText(w.silverUnits); }

  function load() {
    const s = store();
    let id = s.getItem(KEY_ID);
    if (!/^[0-9a-f]{32}$/.test(id || '')) { id = U.randomHex(16); s.setItem(KEY_ID, id); }
    const w = parseValue(s.getItem(KEY_VAL)) || { ...DEFAULT };
    s.setItem(KEY_VAL, formatValue(w)); // regrava a cada visita (renova validade)
    try { if (G.navigator && G.navigator.storage && G.navigator.storage.persist) G.navigator.storage.persist(); } catch (e) { /* opcional */ }
    return { id, gold: w.gold, silverUnits: w.silverUnits };
  }
  function save(w) { store().setItem(KEY_VAL, formatValue(w)); }

  /** Retira o buy-in ao começar a partida (máx. 10 fichas = 20 unidades). */
  function takeBuyin(w, units) {
    const u = Math.max(0, Math.min(units, 20, w.silverUnits));
    w.silverUnits -= u;
    save(w);
    return u;
  }
  /** Ao fim da partida: devolve à carteira o que passar das 3 fichas da casa; vencedor ganha a dourada. */
  function settle(w, result, role) {
    const me = result.state.players[role];
    w.silverUnits += Math.max(0, me.free - 6);
    w.gold += me.gold;
    save(w);
    return w;
  }

  function exportCode(w) { return formatValue(w); }
  function importCode(w, text) {
    const v = parseValue(String(text).trim());
    if (!v) return false;
    w.gold = v.gold; w.silverUnits = v.silverUnits;
    save(w);
    return true;
  }

  PGL.wallet = { load, save, takeBuyin, settle, parseValue, formatValue, exportCode, importCode };
})(typeof window !== 'undefined' ? window : globalThis);
