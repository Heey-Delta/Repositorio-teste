// Editor de apresentação (bloco "Apresentação" das publicações): lista de slides à esquerda, o slide em 16:9 no meio.
// Cada item (título, texto, imagem, forma) é arrastado e redimensionado pelas alças; duplo clique edita o texto.
// Títulos em Anton e textos em Arial, como no site. O que se vê aqui é o que vai ao ar.
import { ensureDialogCss } from './block-dialog.ts';
import { DECK_DEFAULT, newId, parseDeck, slideHtml, slideItemHtml, slideTemplate, SHAPE_KINDS, type Deck, type Slide, type SlideItem } from '../lib/rich-blocks.ts';

export interface DeckHooks { pickImage?: () => Promise<{ src: string; alt: string } | null> }

const CSS = `
.dk{width:min(1280px,calc(100vw - 16px));max-width:none}
.dk form{grid-template-columns:1fr!important;gap:12px}
.dk .dk-body{display:grid;grid-template-columns:170px 1fr;gap:14px;min-height:0}
@media(max-width:760px){.dk .dk-body{grid-template-columns:1fr}.dk .dk-rail{flex-direction:row;overflow-x:auto;max-height:none}}
.dk .dk-rail{display:flex;flex-direction:column;gap:8px;max-height:62vh;overflow:auto;padding:2px}
.dk .dk-thumb{position:relative;border:1px solid var(--line,#2B2B2B);border-radius:4px;cursor:pointer;flex:0 0 auto;width:160px;padding:0;background:none}
.dk .dk-thumb[aria-current="true"]{outline:2px solid var(--accent,#FBBF00);outline-offset:1px}
.dk .dk-thumb .lab-slide{pointer-events:none}
.dk .dk-num{position:absolute;left:0;top:0;z-index:2;background:#000;color:#F2F2EE;font-size:11px;padding:0 5px;border-radius:0 0 4px 0}
.dk .dk-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dk .dk-tools button,.dk .dk-tools select,.dk .dk-tools label{min-height:34px;font-size:13px}
.dk .dk-tools button{padding:0 10px}
.dk .dk-tools select{width:auto;min-height:34px;padding:0 8px}
.dk .dk-tools input[type=color]{width:40px;min-height:34px;padding:2px}
.dk .dk-tools input[type=number]{width:70px;min-height:34px;padding:0 6px}
.dk .dk-tools label{display:flex;flex-direction:row;align-items:center;gap:6px}
.dk .dk-sep{width:1px;align-self:stretch;background:var(--line,#2B2B2B)}
.dk .dk-stage{position:relative;border:1px solid var(--line,#2B2B2B);user-select:none}
.dk .dk-stage .lab-slide{cursor:default}
.dk .dk-stage .lab-si{cursor:move}
.dk .dk-stage .lab-si.is-sel{outline:1px solid var(--accent,#FBBF00);overflow:visible}
.dk .dk-stage .lab-si[contenteditable=true]{cursor:text;outline:2px solid var(--accent,#FBBF00);background:rgb(0 0 0/.35)}
.dk .dk-h{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#000;border:2px solid var(--accent,#FBBF00);z-index:5;touch-action:none}
.dk .dk-hint{font-size:12px;color:var(--muted,#A6A6A0)}`;
const HANDLES: [string, number, number, string][] = [['nw', 0, 0, 'nwse-resize'], ['n', 50, 0, 'ns-resize'], ['ne', 100, 0, 'nesw-resize'], ['e', 100, 50, 'ew-resize'], ['se', 100, 100, 'nwse-resize'], ['s', 50, 100, 'ns-resize'], ['sw', 0, 100, 'nesw-resize'], ['w', 0, 50, 'ew-resize']];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; };

export function openDeckEditor(current: string | undefined, hooks: DeckHooks = {}): Promise<string | null> {
  ensureDialogCss();
  if (!document.getElementById('dk-css')) { const st = el('style', { id: 'dk-css' }); st.textContent = CSS; document.head.append(st); }
  const deck: Deck = structuredClone(current ? parseDeck(current) : DECK_DEFAULT());
  if (!deck.slides.length) deck.slides.push(slideTemplate('cover'));
  let cur = 0, sel: string | null = null;
  const undo: string[] = [];
  const snap = () => { undo.push(JSON.stringify(deck)); if (undo.length > 60) undo.shift(); };

  const dlg = el('dialog', { class: 'bd dk', 'aria-label': 'Editar apresentação' });
  const form = el('form', { method: 'dialog', novalidate: '' });
  const rail = el('div', { class: 'dk-rail', role: 'listbox', 'aria-label': 'Slides' });
  const tools = el('div', { class: 'dk-tools', role: 'toolbar', 'aria-label': 'Slide' });
  const itemTools = el('div', { class: 'dk-tools', role: 'toolbar', 'aria-label': 'Item selecionado' });
  const stage = el('div', { class: 'dk-stage' });
  const hint = el('p', { class: 'dk-hint' }, 'Clique num item para selecionar, arraste para mover, use as bolinhas para mudar o tamanho e dê duplo clique para escrever. Delete apaga o item.');
  const slide = () => deck.slides[cur];
  const item = () => slide().items.find((i) => i.id === sel) ?? null;

  const btn = (label: string, title: string, fn: () => void) => { const b = el('button', { type: 'button', title, 'aria-label': title }, label); b.addEventListener('click', fn); return b; };
  // ---------------- barra do slide
  const layout = el('select', { 'aria-label': 'Novo slide' });
  for (const [v, l] of [['', '+ Slide…'], ['content', 'Título e texto'], ['cover', 'Capa'], ['image', 'Título, imagem e texto'], ['blank', 'Em branco']]) layout.append(new Option(l, v));
  layout.addEventListener('change', () => { if (!layout.value) return; snap(); deck.slides.splice(cur + 1, 0, slideTemplate(layout.value as any)); cur++; sel = null; layout.value = ''; draw(); });
  const bg = el('input', { type: 'color', 'aria-label': 'Fundo do slide', title: 'Fundo do slide' }) as HTMLInputElement;
  bg.addEventListener('input', () => { slide().bg = bg.value; draw(false); });
  bg.addEventListener('change', snap);
  const shapeSel = el('select', { 'aria-label': 'Inserir forma' });
  shapeSel.append(new Option('+ Forma…', ''));
  for (const [k, l] of SHAPE_KINDS) shapeSel.append(new Option(l, k));
  shapeSel.addEventListener('change', () => { if (!shapeSel.value) return; add({ type: 'shape', kind: shapeSel.value, x: 40, y: 35, w: 20, h: 30, fill: '#FBBF00' }); shapeSel.value = ''; });
  tools.append(
    layout,
    btn('Duplicar slide', 'Duplicar slide', () => { snap(); const c = structuredClone(slide()); c.id = newId('s'); c.items.forEach((i) => { i.id = newId(); }); deck.slides.splice(cur + 1, 0, c); cur++; draw(); }),
    btn('Subir', 'Mover o slide para antes', () => move(-1)), btn('Descer', 'Mover o slide para depois', () => move(1)),
    btn('Excluir slide', 'Excluir slide', () => { if (deck.slides.length === 1) return; snap(); deck.slides.splice(cur, 1); cur = Math.min(cur, deck.slides.length - 1); sel = null; draw(); }),
    el('span', { class: 'dk-sep' }),
    btn('+ Título', 'Inserir título', () => add({ type: 'title', x: 6, y: 8, w: 88, h: 14, text: 'Título', size: 4.6, color: '#F2F2EE' })),
    btn('+ Texto', 'Inserir texto', () => add({ type: 'text', x: 6, y: 30, w: 60, h: 30, text: 'Texto', size: 2.4, color: '#A6A6A0' })),
    btn('+ Imagem', 'Inserir imagem', async () => { const img = await pick(); if (img) add({ type: 'image', x: 30, y: 20, w: 40, h: 60, ...img }); }),
    shapeSel,
    el('span', { class: 'dk-sep' }),
    (() => { const l = el('label', {}, 'Fundo'); l.append(bg); return l; })(),
    btn('Desfazer', 'Desfazer (Ctrl+Z)', () => { const s = undo.pop(); if (s) { Object.assign(deck, JSON.parse(s)); cur = Math.min(cur, deck.slides.length - 1); sel = null; draw(); } }),
  );
  // ---------------- barra do item
  const color = el('input', { type: 'color', 'aria-label': 'Cor', title: 'Cor do texto ou da forma' }) as HTMLInputElement;
  const size = el('input', { type: 'number', min: '0.5', max: '20', step: 'any', 'aria-label': 'Tamanho da letra', title: 'Tamanho da letra (% da largura do slide)' }) as HTMLInputElement;
  const align = el('select', { 'aria-label': 'Alinhamento' });
  for (const [v, l] of [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']]) align.append(new Option(l, v));
  color.addEventListener('input', () => { const i = item(); if (!i) return; if (i.type === 'shape') i.fill = color.value; else i.color = color.value; draw(false); });
  color.addEventListener('change', snap);
  size.addEventListener('input', () => { const i = item(); if (i && Number(size.value) > 0) { i.size = Number(size.value); draw(false); } });
  align.addEventListener('change', () => { const i = item(); if (i) { snap(); i.align = align.value as SlideItem['align']; draw(false); } });
  const colorL = el('label', {}, 'Cor'); colorL.append(color);
  const sizeL = el('label', {}, 'Letra'); sizeL.append(size);
  itemTools.append(colorL, sizeL, align,
    btn('Negrito', 'Negrito', () => { const i = item(); if (i) { snap(); i.bold = !i.bold; draw(false); } }),
    btn('Trocar imagem', 'Trocar imagem', async () => { const i = item(); if (i?.type !== 'image') return; const img = await pick(); if (img) { snap(); Object.assign(i, img); draw(false); } }),
    btn('Para frente', 'Trazer para frente', () => order(1)), btn('Para trás', 'Enviar para trás', () => order(-1)),
    btn('Duplicar', 'Duplicar item', () => { const i = item(); if (i) add({ ...structuredClone(i), x: clamp(i.x + 3, 0, 90), y: clamp(i.y + 3, 0, 90) }); }),
    btn('Excluir item', 'Excluir item (Delete)', () => removeItem()),
  );

  function add(p: Omit<SlideItem, 'id'>) { snap(); const it = { id: newId(), ...p } as SlideItem; slide().items.push(it); sel = it.id; draw(); }
  function removeItem() { if (!sel) return; snap(); slide().items = slide().items.filter((i) => i.id !== sel); sel = null; draw(); }
  function order(d: number) { const its = slide().items, i = its.findIndex((x) => x.id === sel); if (i < 0) return; const j = clamp(i + d, 0, its.length - 1); if (i === j) return; snap(); its.splice(j, 0, its.splice(i, 1)[0]); draw(false); }
  function move(d: number) { const j = cur + d; if (j < 0 || j >= deck.slides.length) return; snap(); deck.slides.splice(j, 0, deck.slides.splice(cur, 1)[0]); cur = j; draw(); }
  async function pick() {
    if (hooks.pickImage) return hooks.pickImage();
    const src = prompt('Endereço da imagem (https://…):', '');
    if (!src) return null;
    return { src, alt: prompt('Descreva a imagem (texto alternativo):', '') ?? '' };
  }

  function draw(withRail = true) {
    if (withRail) {
      rail.replaceChildren(...deck.slides.map((s, i) => {
        const t = el('button', { type: 'button', class: 'dk-thumb', role: 'option', 'aria-current': String(i === cur), 'aria-label': `Slide ${i + 1}` });
        t.innerHTML = `<span class="dk-num">${i + 1}</span>${slideHtml(s, i, deck.slides.length, deck.ratio)}`;
        t.addEventListener('click', () => { cur = i; sel = null; draw(); });
        return t;
      }));
    } else {
      const t = rail.children[cur] as HTMLElement | undefined;
      if (t) t.innerHTML = `<span class="dk-num">${cur + 1}</span>${slideHtml(slide(), cur, deck.slides.length, deck.ratio)}`;
    }
    stage.innerHTML = slideHtml(slide(), cur, deck.slides.length, deck.ratio);
    bg.value = /^#[0-9a-f]{6}$/i.test(slide().bg ?? '') ? slide().bg! : '#000000';
    const it = item();
    itemTools.hidden = !it;
    if (it) {
      color.value = (it.type === 'shape' ? it.fill : it.color) ?? '#F2F2EE';
      size.value = String(it.size ?? (it.type === 'title' ? 4.6 : 2.4));
      align.value = it.align ?? 'left';
      const node = stage.querySelector<HTMLElement>(`[data-item="${it.id}"]`);
      if (node) {
        node.classList.add('is-sel');
        for (const [k, x, y, cursor] of HANDLES) { const hd = el('span', { class: 'dk-h', 'data-h': k }); hd.style.cssText = `left:${x}%;top:${y}%;cursor:${cursor}`; node.append(hd); }
      }
    }
  }

  // ---------------- arrastar, redimensionar e escrever no quadro
  stage.addEventListener('pointerdown', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.closest('[contenteditable=true]')) return;
    const node = target.closest<HTMLElement>('.lab-si');
    if (!node) { sel = null; draw(false); return; }
    const id = node.dataset.item!;
    if (sel !== id) { sel = id; draw(false); }
    const it = item()!, box = stage.querySelector('.lab-slide')!.getBoundingClientRect();
    const h = target.dataset.h;
    const sx = ev.clientX, sy = ev.clientY, o = { x: it.x, y: it.y, w: it.w, h: it.h };
    let moved = false;
    ev.preventDefault();
    const onMove = (e: PointerEvent) => {
      const dx = ((e.clientX - sx) / box.width) * 100, dy = ((e.clientY - sy) / box.height) * 100;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 0.3) return;
      if (!moved) { snap(); moved = true; }
      if (!h) { it.x = clamp(o.x + dx, -o.w + 2, 98); it.y = clamp(o.y + dy, -o.h + 2, 98); }
      else {
        if (h.includes('e')) it.w = clamp(o.w + dx, 2, 120);
        if (h.includes('s')) it.h = clamp(o.h + dy, 1, 120);
        if (h.includes('w')) { it.w = clamp(o.w - dx, 2, 120); it.x = o.x + (o.w - it.w); }
        if (h.includes('n')) { it.h = clamp(o.h - dy, 1, 120); it.y = o.y + (o.h - it.h); }
        if (e.shiftKey && h.length === 2 && it.type !== 'title' && it.type !== 'text') it.h = it.w * (o.h / o.w);
      }
      it.x = Math.round(it.x * 10) / 10; it.y = Math.round(it.y * 10) / 10; it.w = Math.round(it.w * 10) / 10; it.h = Math.round(it.h * 10) / 10;
      draw(false);
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });
  stage.addEventListener('dblclick', (ev) => {
    const node = (ev.target as HTMLElement).closest<HTMLElement>('.lab-si-title, .lab-si-text, .lab-si-shape');
    if (!node) { const im = (ev.target as HTMLElement).closest<HTMLElement>('.lab-si-img'); if (im) itemTools.querySelector<HTMLButtonElement>('button[title="Trocar imagem"]')?.click(); return; }
    const it = slide().items.find((i) => i.id === node.dataset.item);
    if (!it) return;
    node.querySelectorAll('.dk-h').forEach((x) => x.remove());
    const edit = node.querySelector<HTMLElement>('span') ?? node;
    // texto simples: cada linha vira uma linha; "- " no começo vira tópico
    edit.innerText = it.text ?? '';
    edit.style.textTransform = 'none';   // sem caixa alta durante a edição: o texto é salvo como foi digitado
    edit.contentEditable = 'true';
    edit.focus();
    document.getSelection()?.selectAllChildren(edit);
    // guarda o texto na hora; o redesenho vem depois (redesenhar dentro do blur quebra o quadro)
    const done = () => { edit.removeEventListener('blur', done); snap(); it.text = edit.innerText.replace(/\n$/, ''); edit.contentEditable = 'false'; setTimeout(() => draw(false), 0); };
    edit.addEventListener('blur', done);
    edit.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') edit.blur(); });
  });

  const save = el('button', { type: 'submit', class: 'bd-ok' }, 'Salvar apresentação');
  const cancel = el('button', { type: 'button' }, 'Cancelar');
  cancel.addEventListener('click', () => dlg.close());
  const row = el('div', { class: 'bd-row' }); row.append(cancel, save);
  const main = el('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:0' });
  main.append(tools, itemTools, stage, hint);
  const body = el('div', { class: 'dk-body' }); body.append(rail, main);
  form.append(el('h2', {}, current ? 'Editar apresentação' : 'Nova apresentação'), body, row);
  dlg.append(form);
  document.body.append(dlg);
  dlg.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).closest('input, select, textarea, [contenteditable=true]')) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { ev.preventDefault(); removeItem(); }
    if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); (tools.querySelector('button[title^="Desfazer"]') as HTMLButtonElement).click(); }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const it = item();
    if (it && arrows[ev.key]) { ev.preventDefault(); const k = ev.shiftKey ? 5 : 0.5; it.x += arrows[ev.key][0] * k; it.y += arrows[ev.key][1] * k; draw(false); }
  });
  draw();
  return new Promise((resolve) => {
    let out: string | null = null;
    form.addEventListener('submit', () => { (document.activeElement as HTMLElement | null)?.closest('[contenteditable=true]') && (document.activeElement as HTMLElement).blur(); out = JSON.stringify(deck); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(out); });
    dlg.showModal();
  });
}
export { slideItemHtml };
