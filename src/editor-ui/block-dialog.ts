// Janela para criar/editar forma, gráfico, diagrama, equação, imagem ou círculo, com pré-visualização ao vivo.
// Usada pelo editor de Publicações (Tiptap) e pelo editor de Documentos.
import { ALIGNS, blockHtml, CHART_DEFAULT, CHART_KINDS, DIAGRAM_DEFAULT, DIAGRAM_KINDS, SHAPE_DEFAULT, SHAPE_KINDS, type BlockName } from '../lib/rich-blocks.ts';

type Field = { key: string; label: string; kind: 'text' | 'textarea' | 'select' | 'color' | 'number'; options?: [string, string][]; hint?: string; rows?: number };
const SIZE: Field[] = [
  { key: 'width', label: 'Largura (px)', kind: 'number', hint: 'Vazio = largura do texto. Também dá para arrastar as alças no editor.' },
  { key: 'align', label: 'Alinhamento', kind: 'select', options: ALIGNS },
];
const FIELDS: Record<Exclude<BlockName, 'slides'>, { title: string; fields: Field[]; defaults: Record<string, string> }> = {
  shape: {
    title: 'Forma',
    defaults: { ...SHAPE_DEFAULT },
    fields: [
      { key: 'kind', label: 'Forma', kind: 'select', options: SHAPE_KINDS },
      { key: 'text', label: 'Texto dentro', kind: 'text' },
      { key: 'fill', label: 'Preenchimento', kind: 'color' },
      { key: 'stroke', label: 'Contorno', kind: 'color', hint: 'Deixe igual ao preenchimento para não ter contorno.' },
      { key: 'textColor', label: 'Cor do texto', kind: 'color' },
      { key: 'width', label: 'Largura (px)', kind: 'number' },
      { key: 'height', label: 'Altura (px)', kind: 'number' },
      { key: 'align', label: 'Alinhamento', kind: 'select', options: ALIGNS },
    ],
  },
  picture: {
    title: 'Imagem',
    defaults: { src: '', alt: '', width: '480', align: 'center' },
    fields: [
      { key: 'src', label: 'Endereço da imagem', kind: 'text' },
      { key: 'alt', label: 'Descrição (texto alternativo)', kind: 'text' },
      ...SIZE,
    ],
  },
  chart: {
    title: 'Gráfico',
    defaults: { ...CHART_DEFAULT },
    fields: [
      { key: 'type', label: 'Tipo', kind: 'select', options: CHART_KINDS },
      { key: 'title', label: 'Título', kind: 'text' },
      { key: 'data', label: 'Dados', kind: 'textarea', rows: 7, hint: 'Uma linha por item, colunas separadas por ";". A primeira linha tem os nomes das séries; a primeira coluna, as categorias. Dá para colar do Excel.' },
      { key: 'colors', label: 'Cores das séries', kind: 'text', hint: 'Opcional. Ex.: #FBBF00, #F2F2EE, #5C5C58' },
      ...SIZE,
    ],
  },
  diagram: {
    title: 'Diagrama',
    defaults: { ...DIAGRAM_DEFAULT },
    fields: [
      { key: 'type', label: 'Tipo', kind: 'select', options: DIAGRAM_KINDS },
      { key: 'outline', label: 'Tópicos', kind: 'textarea', rows: 9, hint: 'Um tópico por linha. Recue com 2 espaços (ou "-") para pôr um tópico dentro do outro.' },
      ...SIZE,
    ],
  },
  math: {
    title: 'Equação',
    defaults: { tex: 'E = mc^2' },
    fields: [{ key: 'tex', label: 'Equação (LaTeX)', kind: 'textarea', rows: 3, hint: 'Ex.: \\frac{a}{b}, x^2, \\sqrt{x}, \\sum_{i=1}^{n} i, \\alpha' }, SIZE[1]],
  },
  circle: {
    title: 'Círculo de destaque',
    defaults: { text: '112%', color: '#FBBF00', size: '180' },
    fields: [
      { key: 'text', label: 'Texto', kind: 'text' },
      { key: 'color', label: 'Cor', kind: 'color' },
      { key: 'size', label: 'Tamanho (px)', kind: 'number' },
    ],
  },
};

// mesmas cores, fontes e campos do admin (shared.css): fundo preto, linhas cinza, rótulos discretos e o amarelo de destaque
const CSS = `
.bd{border:1px solid var(--line,#2B2B2B);border-radius:8px;background:var(--bg,#000);color:var(--ink,#F2F2EE);padding:0;width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 24px);font-family:var(--font-sans,Arial,Helvetica,sans-serif)}
.bd::backdrop{background:rgb(0 0 0/.7)}
.bd form{display:grid;grid-template-columns:1fr;gap:16px;padding:20px}
@media(min-width:760px){.bd form{grid-template-columns:1fr 1fr}}
.bd h2{margin:0;grid-column:1/-1;font-family:var(--font-display,Anton,Impact,sans-serif);font-size:24px;font-weight:400;line-height:1;text-transform:uppercase}
.bd label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted,#A6A6A0)}
.bd input,.bd select,.bd textarea{width:100%;box-sizing:border-box;background:var(--bg,#000);color:var(--ink,#F2F2EE);border:1px solid var(--line,#2B2B2B);border-radius:6px;padding:8px 12px;font:14px/1.5 var(--font-sans,Arial,Helvetica,sans-serif)}
.bd input,.bd select{min-height:40px}
.bd input:focus-visible,.bd select:focus-visible,.bd textarea:focus-visible{outline:none;border-color:var(--accent,#FBBF00)}
.bd input[type=color]{padding:3px;width:64px}
.bd small{color:var(--muted,#A6A6A0);font-size:12px;line-height:1.4;opacity:.8}
.bd .bd-prev{border:1px solid var(--line,#2B2B2B);min-height:140px;display:grid;place-items:center;padding:12px;overflow:auto}
.bd .bd-prev figure{margin:0;border:0;padding:0;width:100%}
.bd .bd-prev svg{max-width:100%;height:auto;display:block;margin:auto}
.bd .bd-row{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}
.bd button{min-height:40px;padding:0 20px;border-radius:6px;border:1px solid var(--line,#2B2B2B);background:transparent;color:var(--ink,#F2F2EE);cursor:pointer;font:14px var(--font-sans,Arial,Helvetica,sans-serif)}
.bd button:hover{border-color:var(--ink,#F2F2EE)}
.bd button.bd-ok{background:var(--accent,#FBBF00);color:#000;border-color:var(--accent,#FBBF00);font-weight:700}`;

/** Abre a janela; devolve os atributos (ou null se cancelar). */
export function ensureDialogCss() { if (!document.getElementById('bd-css')) { const st = document.createElement('style'); st.id = 'bd-css'; st.textContent = CSS; document.head.append(st); } }
export function openBlockDialog(kind: Exclude<BlockName, 'slides'>, current?: Record<string, unknown>): Promise<Record<string, string> | null> {
  ensureDialogCss();
  const spec = FIELDS[kind];
  const values: Record<string, string> = { ...spec.defaults, ...Object.fromEntries(Object.entries(current ?? {}).map(([k, v]) => [k, String(v ?? '')])) };
  const dlg = document.createElement('dialog');
  dlg.className = 'bd';
  dlg.setAttribute('aria-label', spec.title);
  const form = document.createElement('form');
  form.method = 'dialog';
  const left = document.createElement('div');
  left.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  const prev = document.createElement('div');
  prev.className = 'bd-prev';
  prev.setAttribute('aria-label', 'Pré-visualização');
  const draw = () => { try { prev.innerHTML = blockHtml(kind, values); } catch (x) { prev.textContent = (x as Error).message; } };
  for (const f of spec.fields) {
    const label = document.createElement('label');
    label.append(f.label);
    let el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (f.kind === 'select') { el = document.createElement('select'); for (const [v, l] of f.options!) el.append(new Option(l, v)); }
    else if (f.kind === 'textarea') { el = document.createElement('textarea'); (el as HTMLTextAreaElement).rows = f.rows ?? 4; el.spellcheck = false; }
    else { el = document.createElement('input'); (el as HTMLInputElement).type = f.kind === 'number' ? 'number' : f.kind === 'color' ? 'color' : 'text'; if (f.kind === 'number') { (el as HTMLInputElement).min = '10'; (el as HTMLInputElement).max = '1200'; } }
    el.name = f.key;
    el.value = f.kind === 'color' ? (/^#[0-9a-f]{6}$/i.test(values[f.key]) ? values[f.key] : f.key === 'textColor' ? '#000000' : values.fill || '#FBBF00') : values[f.key] ?? '';
    el.addEventListener('input', () => { values[f.key] = el.value; draw(); });
    label.append(el);
    if (f.hint) { const s = document.createElement('small'); s.textContent = f.hint; label.append(s); }
    left.append(label);
  }
  const h2 = document.createElement('h2');
  h2.textContent = current ? `Editar ${spec.title.toLowerCase()}` : `Inserir ${spec.title.toLowerCase()}`;
  const row = document.createElement('div');
  row.className = 'bd-row';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar';
  const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'bd-ok'; ok.textContent = current ? 'Salvar' : 'Inserir';
  row.append(cancel, ok);
  form.append(h2, left, prev, row);
  dlg.append(form);
  document.body.append(dlg);
  draw();
  return new Promise((resolve) => {
    let result: Record<string, string> | null = null;
    cancel.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', () => { result = { ...values }; });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    (left.querySelector('input,textarea,select') as HTMLElement | null)?.focus();
  });
}
