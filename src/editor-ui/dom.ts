// Utilitários de tela do editor: criar elementos, desenhar trechos de texto e ler/posicionar o cursor
// por deslocamento de caractere (o modelo trabalha com "posição no texto", a tela com nós do DOM).
export type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: any) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Run { id?: string; text: string; format?: Record<string, any> }
/** Trechos → HTML (o texto visível é exatamente o texto do modelo; quebras de linha via white-space). */
export function runsHtml(runs: Run[] = []): string {
  return runs.map((r) => {
    const f = r.format ?? {};
    const st = [
      f.bold ? 'font-weight:700' : '', f.italic ? 'font-style:italic' : '',
      f.underline || f.strike ? `text-decoration:${[f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].join(' ').trim()}` : '',
      typeof f.color === 'string' && f.color.startsWith('#') ? `color:${f.color}` : '',
      typeof f.highlight === 'string' && f.highlight.startsWith('#') ? `background:${f.highlight}` : '',
      typeof f.fontSize === 'number' ? `font-size:${f.fontSize}pt` : '',
      typeof f.fontFamily === 'string' && !f.fontFamily.startsWith('theme:') ? `font-family:${esc(f.fontFamily)}` : '',
      f.baseline === 'SUPERSCRIPT' ? 'vertical-align:super;font-size:.75em' : f.baseline === 'SUBSCRIPT' ? 'vertical-align:sub;font-size:.75em' : '',
    ].filter(Boolean).join(';');
    return st ? `<span style="${st}">${esc(r.text)}</span>` : esc(r.text);
  }).join('');
}

/** Deslocamento (em caracteres) de um ponto do DOM dentro de `root`. */
export function offsetIn(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  try { r.setEnd(node, offset); } catch { return 0; }
  return r.toString().length;
}

/** Coloca o cursor (ou uma seleção) num deslocamento de caractere dentro de `root`. */
export function placeCaret(root: Node, start: number, end = start) {
  const sel = window.getSelection();
  if (!sel) return;
  const find = (target: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0, last: Node | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.textContent!.length;
      if (target <= acc + len) return [n, target - acc];
      acc += len; last = n;
    }
    return last ? [last, last.textContent!.length] : [root, 0];
  };
  const [a, ao] = find(start), [b, bo] = find(end);
  const r = document.createRange();
  r.setStart(a, ao); r.setEnd(b, bo);
  sel.removeAllRanges(); sel.addRange(r);
}

/** Lê um arquivo como data URI. */
export const readDataUrl = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(f); });
export const readBytes = async (f: File) => new Uint8Array(await f.arrayBuffer());

/** Baixa um arquivo gerado no navegador. */
export function download(name: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** SVG → PNG pelo canvas (é o que completa "exportar imagens"). */
export async function svgToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Não foi possível desenhar o SVG.')); img.src = url; });
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Pequeno aviso no canto (erros do motor, confirmações). */
export function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', class: 'ed-toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `ed-toast ed-toast-${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 2500);
}
