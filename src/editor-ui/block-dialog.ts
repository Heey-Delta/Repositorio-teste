// Janela para criar/editar gráfico, diagrama, equação ou círculo, com pré-visualização ao vivo.
// Usada pelo editor de Publicações (Tiptap) e pelo editor de Documentos.
import { blockHtml, CHART_DEFAULT, CHART_KINDS, DIAGRAM_DEFAULT, DIAGRAM_KINDS, type BlockName } from '../lib/rich-blocks.ts';

type Field = { key: string; label: string; kind: 'text' | 'textarea' | 'select' | 'color' | 'number'; options?: [string, string][]; hint?: string; rows?: number };
const FIELDS: Record<BlockName, { title: string; fields: Field[]; defaults: Record<string, string> }> = {
  chart: {
    title: 'Gráfico',
    defaults: { ...CHART_DEFAULT },
    fields: [
      { key: 'type', label: 'Tipo', kind: 'select', options: CHART_KINDS },
      { key: 'title', label: 'Título', kind: 'text' },
      { key: 'data', label: 'Dados', kind: 'textarea', rows: 7, hint: 'Uma linha por item, colunas separadas por ";". A primeira linha tem os nomes das séries; a primeira coluna, as categorias. Dá para colar do Excel.' },
    ],
  },
  diagram: {
    title: 'Diagrama',
    defaults: { ...DIAGRAM_DEFAULT },
    fields: [
      { key: 'type', label: 'Tipo', kind: 'select', options: DIAGRAM_KINDS },
      { key: 'outline', label: 'Tópicos', kind: 'textarea', rows: 9, hint: 'Um tópico por linha. Recue com 2 espaços (ou "-") para pôr um tópico dentro do outro.' },
    ],
  },
  math: {
    title: 'Equação',
    defaults: { tex: 'E = mc^2' },
    fields: [{ key: 'tex', label: 'Equação (LaTeX)', kind: 'textarea', rows: 3, hint: 'Ex.: \\frac{a}{b}, x^2, \\sqrt{x}, \\sum_{i=1}^{n} i, \\alpha' }],
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

const CSS = `
.bd{border:1px solid #2b2b2b;border-radius:10px;background:#0a0a0a;color:#f2f2ee;padding:0;width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 24px)}
.bd::backdrop{background:rgb(0 0 0/.7)}
.bd form{display:grid;grid-template-columns:1fr;gap:12px;padding:16px}
@media(min-width:760px){.bd form{grid-template-columns:1fr 1fr}}
.bd h2{margin:0;font-size:16px;grid-column:1/-1}
.bd label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#a6a6a0}
.bd input,.bd select,.bd textarea{background:#000;color:#f2f2ee;border:1px solid #2b2b2b;border-radius:6px;padding:8px;font:14px/1.4 ui-monospace,monospace}
.bd input[type=color]{padding:2px;height:40px}
.bd small{color:#7c7c78;font-size:12px;line-height:1.4}
.bd .bd-prev{background:#fff;border-radius:8px;min-height:120px;display:grid;place-items:center;padding:8px;overflow:auto;color:#111}
.bd .bd-prev svg{max-width:100%;height:auto}
.bd .bd-row{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}
.bd button{min-height:40px;padding:0 16px;border-radius:6px;border:1px solid #2b2b2b;background:transparent;color:#f2f2ee;cursor:pointer}
.bd button.bd-ok{background:#FBBF00;color:#000;border-color:#FBBF00;font-weight:700}`;

/** Abre a janela; devolve os atributos (ou null se cancelar). */
export function openBlockDialog(kind: BlockName, current?: Record<string, unknown>): Promise<Record<string, string> | null> {
  if (!document.getElementById('bd-css')) { const st = document.createElement('style'); st.id = 'bd-css'; st.textContent = CSS; document.head.append(st); }
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
    else { el = document.createElement('input'); (el as HTMLInputElement).type = f.kind === 'number' ? 'number' : f.kind === 'color' ? 'color' : 'text'; if (f.kind === 'number') { (el as HTMLInputElement).min = '60'; (el as HTMLInputElement).max = '400'; } }
    el.name = f.key;
    el.value = f.kind === 'color' ? (/^#[0-9a-f]{6}$/i.test(values[f.key]) ? values[f.key] : '#FBBF00') : values[f.key] ?? '';
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
