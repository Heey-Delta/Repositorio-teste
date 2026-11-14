/* board3d.js — tabuleiro e peças 3D low poly (portados do artefato "Xadrez 5×5 — modelos 3D low poly").
 *
 * Carrega o Three.js 0.160.0 pela CDN (mesma versão do artefato) via import dinâmico + importmap.
 * Se não carregar (offline, bloqueado), o jogo continua com o tabuleiro 2D.
 * Unidades em mm: rei = 95 mm, casa = 46 mm.
 *
 * Mapeamento para as regras: coluna A→E é o eixo de avanço (P1 em A, P2 em E);
 * a câmera fica atrás do próprio rei do jogador.
 */
(function (G) {
  'use strict';
  const PGL = (G.PGL = G.PGL || {});
  let THREE = null;
  let loading = null;

  /** Three.js vem de vendor/three-r128.min.js (global THREE). Sem ele, o jogo usa o 2D. */
  function load() {
    if (!THREE && G.THREE && G.THREE.WebGLRenderer) THREE = G.THREE;
    if (THREE) {
      try { const c = document.createElement('canvas'); if (!(c.getContext('webgl2') || c.getContext('webgl'))) THREE = null; } catch (e) { THREE = null; }
    }
    return Promise.resolve(THREE);
  }
  /** r128 não tem gestão de cor automática: converte as cores sRGB para linear, como o 0.160 faz. */
  const legacy = () => +THREE.REVISION < 152;
  const srgb = (c) => { const col = new THREE.Color(c); if (legacy()) col.convertSRGBToLinear(); return col; };

  /* ================= Geometria (do artefato) ================= */
  const SEG = 12;
  const COLORS = { white: 0xf0dcae, black: 0x5c2611, detail: 0x24110a, light: 0xe2c999, dark: 0x7a5234, frame: 0x34200f };
  // Perfis compartilhados com o 2D (pieceart.js)
  const { PROF, HEAD, KIND_TO, HEIGHT } = PGL.pieceArt;
  const SQ = 46, N = 5, FR = 14;

  let GEO = null, MAT = null;
  function buildAssets() {
    if (GEO) return;
    const T = THREE;
    const mk = (c) => new T.MeshStandardMaterial({ color: srgb(c), flatShading: true, roughness: 0.62, metalness: 0.0, side: T.DoubleSide });
    MAT = { white: mk(COLORS.white), black: mk(COLORS.black), detail: mk(COLORS.detail), light: mk(COLORS.light), dark: mk(COLORS.dark), frame: mk(COLORS.frame) };
    MAT.detail.roughness = 0.9;
    const lathe = (p) => new T.LatheGeometry(p.map(([r, h]) => new T.Vector2(r, h)), SEG);
    const rAt = (profile, y) => {
      for (let i = 1; i < profile.length - 1; i++) {
        const [r1, h1] = profile[i], [r2, h2] = profile[i + 1];
        if (y >= h1 && y <= h2 && h2 > h1) return r1 + ((r2 - r1) * (y - h1)) / (h2 - h1);
      }
      return 0;
    };
    const crossGeoms = () => {
      const v = new T.BoxGeometry(4.5, 15, 4); v.translate(0, 87.5, 0);
      const h = new T.BoxGeometry(12, 4, 4); h.translate(0, 89, 0);
      return [v, h];
    };
    const crownPoints = () => {
      const out = [];
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        const g = new T.ConeGeometry(2, 3.4, 4);
        g.rotateY(-a + Math.PI / 4);
        g.translate(Math.cos(a) * 9.4, 70.5 + 1.6, Math.sin(a) * 9.4);
        out.push(g);
      }
      const ball = new T.IcosahedronGeometry(3.2, 1); ball.translate(0, 76.8, 0);
      out.push(ball);
      return out;
    };
    const slitGeom = () => {
      const P1 = [-6.3, 52.5], P2 = [2.6, 44.3], n = 6, w = 0.7;
      const dx = P2[0] - P1[0], dy = P2[1] - P1[1], L = Math.hypot(dx, dy);
      const px = -dy / L, py = dx / L;
      const pos = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = P1[0] + dx * t, y = P1[1] + dy * t;
        for (const s of [-1, 1]) {
          const X = x + px * w * s, Y = y + py * w * s, r = rAt(PROF.bispo, Y) + 0.2;
          pos.push(X, Y, Math.sqrt(Math.max(r * r - X * X, 0)));
        }
      }
      for (let i = 0; i < n; i++) { const a = 2 * i, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const merlons = () => {
      const out = [], R = 11.2, r = 7.5, gap = Math.asin(1.5 / R) * 2;
      for (let k = 0; k < 4; k++) {
        const a0 = (k * Math.PI) / 2 + gap / 2, a1 = ((k + 1) * Math.PI) / 2 - gap / 2;
        const s = new T.Shape();
        s.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
        s.absarc(0, 0, R, a0, a1, false);
        s.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
        s.absarc(0, 0, r, a1, a0, true);
        s.closePath();
        const g = new T.ExtrudeGeometry(s, { depth: 3.5, bevelEnabled: false, curveSegments: 3 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, 46.5, 0);
        out.push(g);
      }
      return out;
    };
    const knightHead = () => {
      const s = new T.Shape(); HEAD.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      const g = new T.ExtrudeGeometry(s, { depth: 11, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.6, bevelSegments: 1, curveSegments: 1 });
      g.translate(0, 0, -5.5);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        let k = 1;
        if (x > 6) k *= 1 - 0.34 * Math.min((x - 6) / 9, 1);
        if (y > 52) k *= 0.84;
        if (x < -9) k *= 0.86;
        p.setZ(i, z * k);
      }
      g.computeVertexNormals();
      const eyes = [1, -1].map((sd) => { const e = new T.BoxGeometry(2.2, 1.1, 0.6); e.rotateZ(-0.45); e.translate(6.3, 47.2, sd * 6.35); return e; });
      const nostrils = [1, -1].map((sd) => { const e = new T.BoxGeometry(1.2, 0.8, 0.5); e.translate(13.6, 39.6, sd * 4.2); return e; });
      [g, ...eyes, ...nostrils].forEach((x) => x.rotateY(-Math.PI / 2));
      return { body: g, detail: [...eyes, ...nostrils] };
    };
    GEO = {};
    GEO.rei = { body: [lathe(PROF.rei), ...crossGeoms()], detail: [] };
    GEO.dama = { body: [lathe(PROF.dama), ...crownPoints()], detail: [] };
    GEO.bispo = { body: [lathe(PROF.bispo)], detail: [slitGeom()] };
    const kh = knightHead();
    GEO.cavalo = { body: [lathe(PROF.cavalo), kh.body], detail: kh.detail };
    GEO.torre = { body: [lathe(PROF.torre), ...merlons()], detail: [] };
    GEO.peao = { body: [lathe(PROF.peao)], detail: [] };
  }

  function makePiece(kind, color) {
    const grp = new THREE.Group();
    GEO[kind].body.forEach((g) => { const m = new THREE.Mesh(g, MAT[color]); m.castShadow = m.receiveShadow = true; grp.add(m); });
    GEO[kind].detail.forEach((g) => grp.add(new THREE.Mesh(g, MAT.detail)));
    return grp;
  }

  /* ================= Cena básica ================= */
  const COLS = 'ABCDE';
  /** Casa do jogo → posição 3D. Coluna (A..E) vira profundidade; linha (1..5) vira lateral. */
  function sqPos(coord) {
    const x = COLS.indexOf(coord[0]), y = +coord[1] - 1;
    return new THREE.Vector3((y - 2) * SQ, 0, (2 - x) * SQ);
  }

  function makeScene(container, onResize) {
    buildAssets();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    if (legacy()) { renderer.outputEncoding = THREE.sRGBEncoding; renderer.physicallyCorrectLights = true; }
    renderer.setPixelRatio(Math.min(G.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
    scene.add(new THREE.HemisphereLight(srgb(0xf4f1ea), srgb(0x2a3442), 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(160, 320, 220); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 50, far: 900 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Tabuleiro: mesma cor da versão 2D (A1 escura)
    const squares = {};
    const sqGeo = new THREE.BoxGeometry(SQ, 5, SQ); sqGeo.translate(0, -2.5, 0);
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      const coord = COLS[x] + (y + 1);
      const m = new THREE.Mesh(sqGeo, (x + y) % 2 === 0 ? MAT.dark : MAT.light);
      m.position.copy(sqPos(coord));
      m.receiveShadow = true;
      m.userData.coord = coord;
      scene.add(m);
      squares[coord] = m;
    }
    const W = N * SQ + FR * 2;
    const fr = new THREE.BoxGeometry(W, 10, W); fr.translate(0, -5.8, 0);
    const fm = new THREE.Mesh(fr, MAT.frame); fm.receiveShadow = fm.castShadow = true;
    scene.add(fm);

    function resize() {
      const w = container.clientWidth || 300, h = container.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (onResize) onResize(camera);
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else G.addEventListener('resize', resize);
    resize();
    return { renderer, scene, camera, squares, resize, dispose() { if (ro) ro.disconnect(); renderer.setAnimationLoop(null); renderer.dispose(); renderer.domElement.remove(); } };
  }

  /* ================= Tela inicial: tabuleiro girando com os dois reis ================= */
  function createHome(container) {
    const S = makeScene(container);
    for (const [coord, color] of [['A3', 'white'], ['E3', 'black']]) {
      const k = makePiece('rei', color);
      k.position.copy(sqPos(coord));
      k.rotation.y = color === 'white' ? Math.PI : 0;
      S.scene.add(k);
    }
    // Gira devagar a ~30 fps, só enquanto a tela inicial está visível.
    let t = 0, last = 0, running = false;
    const loop = (now) => {
      if (now - last < 33) return;
      last = now;
      t += 0.007;
      S.camera.position.set(Math.sin(t) * 330, 250, Math.cos(t) * 330);
      S.camera.lookAt(0, 15, 0);
      S.renderer.render(S.scene, S.camera);
    };
    S.start = () => { if (!running) { running = true; S.renderer.setAnimationLoop(loop); } };
    S.stop = () => { running = false; S.renderer.setAnimationLoop(null); };
    S.start();
    return S;
  }

  /* ================= Tabuleiro da partida ================= */
  const HL = { move: 0x2e7d50, place: 0x2e6eaa, target: 0xe0645a, sel: 0xf0c96a, last: 0xf0c96a };

  function createBoard(container, opts) {
    const flip = !!(opts && opts.flip);
    // Câmera atrás do próprio rei (P1 olha de A para E; P2 de E para A), afastada o bastante
    // para o tabuleiro inteiro caber na tela em qualquer proporção.
    const camZ = flip ? -1 : 1;
    const frameCam = (cam) => {
      const v = THREE.MathUtils.degToRad(cam.fov);
      const hf = 2 * Math.atan(Math.tan(v / 2) * cam.aspect);
      const R = 146; // meia largura do tabuleiro com moldura
      const el = THREE.MathUtils.degToRad(58);
      const d = Math.max(R / Math.tan(hf / 2), (R * 1.05) / Math.tan(v / 2)) + 70;
      cam.position.set(0, d * Math.sin(el), camZ * d * Math.cos(el));
      cam.lookAt(0, 8, camZ * 12);
    };
    const S = makeScene(container, frameCam);

    // Camada de rótulos HTML (vida e dano), posicionada por projeção
    const labels = document.createElement('div');
    labels.className = 'labels3d';
    container.appendChild(labels);

    // Marcadores de destaque, um por casa
    const marks = {};
    const markGeo = new THREE.PlaneGeometry(SQ * 0.86, SQ * 0.86); markGeo.rotateX(-Math.PI / 2);
    for (const coord in S.squares) {
      const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: srgb(0xffffff), transparent: true, opacity: 0.5, depthWrite: false }));
      m.position.copy(sqPos(coord)); m.position.y = 0.6;
      m.visible = false;
      S.scene.add(m);
      marks[coord] = m;
    }

    const pieces = new Map(); // id → { obj, label, target:Vector3 }
    let clickCb = null;

    // Clique → casa (ignora arrastes)
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const el = S.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, S.camera);
      const objs = [...Object.values(S.squares)];
      for (const p of pieces.values()) objs.push(p.obj);
      const hit = ray.intersectObjects(objs, true)[0];
      if (!hit) return;
      let o = hit.object;
      while (o && !o.userData.coord && o.parent) o = o.parent;
      if (o && o.userData.coord && clickCb) clickCb(o.userData.coord);
    });

    function update(st, hl, dmgOf) {
      // Peças
      const seen = new Set();
      for (const id in st.pieces) {
        const pc = st.pieces[id];
        seen.add(id);
        let e = pieces.get(id);
        if (!e) {
          const obj = makePiece(KIND_TO[pc.kind], pc.owner === 'P1' ? 'white' : 'black');
          obj.rotation.y = pc.owner === 'P1' ? Math.PI : 0;
          obj.position.copy(sqPos(pc.pos));
          obj.position.y = 60; // entra caindo no tabuleiro
          S.scene.add(obj);
          const label = document.createElement('div');
          label.className = 'lbl3d';
          const bar = document.createElement('div'); bar.className = 'hpbar';
          const fill = document.createElement('i'); bar.append(fill);
          const dm = document.createElement('span'); dm.className = 'dmg';
          dm.title = 'dano';
          label.append(bar, dm);
          labels.append(label);
          e = { obj, label, fill, bar, dm, target: new THREE.Vector3(), kind: KIND_TO[pc.kind] };
          pieces.set(id, e);
        }
        e.obj.userData.coord = pc.pos;
        e.target.copy(sqPos(pc.pos));
        const max = 2 * PGL.rules.VALUE[pc.kind];
        e.fill.style.width = Math.max(0, (pc.hp / max) * 100) + '%';
        e.bar.className = 'hpbar' + (pc.hp * 2 <= max ? ' low' : '');
        e.dm.textContent = String(dmgOf(pc));
      }
      for (const [id, e] of pieces) {
        if (seen.has(id)) continue;
        S.scene.remove(e.obj); e.label.remove(); pieces.delete(id);
      }
      // Destaques
      for (const c in marks) marks[c].visible = false;
      const paint = (list, color, op) => (list || []).forEach((c) => { const m = marks[c]; if (!m) return; m.material.color.copy(srgb(color)); m.material.opacity = op; m.visible = true; });
      paint(hl.last, HL.last, 0.28);
      paint(hl.moves, HL.move, 0.55);
      paint(hl.places, HL.place, 0.5);
      paint(hl.targets, HL.target, 0.6);
      if (hl.sel) paint([hl.sel], HL.sel, 0.6);
      markDirty();
    }

    const v = new THREE.Vector3();
    let dirty = 2;
    const markDirty = () => { dirty = 2; };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(markDirty).observe(container);
    S.renderer.setAnimationLoop(() => {
      let moving = false;
      for (const e of pieces.values()) if (e.obj.position.distanceToSquared(e.target) > 0.05) moving = true;
      if (!moving && !dirty) return; // nada mudou: não redesenha (economiza bateria)
      if (dirty) dirty--;
      for (const e of pieces.values()) {
        e.obj.position.lerp(e.target, 0.18);
        v.copy(e.obj.position); v.y += HEIGHT[e.kind] + 8;
        v.project(S.camera);
        const w = el.clientWidth, h = el.clientHeight;
        e.label.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      }
      S.renderer.render(S.scene, S.camera);
    });

    /** Casa sob um ponto da tela (usado ao soltar uma carta arrastada). */
    function squareAt(clientX, clientY) {
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, S.camera);
      const hit = ray.intersectObjects(Object.values(S.squares), false)[0];
      return hit ? hit.object.userData.coord : null;
    }

    return {
      update,
      squareAt,
      onSquare(cb) { clickCb = cb; },
      dispose() { labels.remove(); S.dispose(); },
    };
  }

  PGL.board3d = { load, createHome, createBoard, get ready() { return !!THREE; } };
})(typeof window !== 'undefined' ? window : globalThis);
