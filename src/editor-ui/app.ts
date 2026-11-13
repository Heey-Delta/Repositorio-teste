// Casca do editor (/admin/editor/[id]): abre o documento do banco, liga o salvamento automático e monta
// a barra de ferramentas, a visão da aplicação (documento, slides ou planilha) e os painéis laterais.
import { createEngine, HttpStore, openStored, exportDocument, importFile, diffDocuments, normalizeKeys, type Engine } from '../editor-core/index.ts';
import { h, download, svgToPng, toast, readDataUrl, readBytes } from './dom.ts';
import { DocView } from './doc-view.ts';
import { SlideView, present } from './slide-view.ts';
import { SheetView } from './sheet-view.ts';

type View = DocView | SlideView | SheetView;
const STATUS: Record<string, string> = { idle: 'Pronto', pending: 'Alterações a salvar…', saving: 'Salvando…', saved: 'Salvo', error: 'Erro ao salvar — tentando de novo', offline: 'Sem conexão — salvará quando voltar' };

export async function boot(root: HTMLElement, id: string, login: string) {
  const store = new HttpStore('/api/editor/documents');
  let opened: Awaited<ReturnType<typeof openStored>>;
  try { opened = await openStored((doc) => createEngine(doc), store, id); }
  catch (x) { root.replaceChildren(h('p', { class: 'ed-fatal' }, `Não foi possível abrir: ${(x as Error).message}`)); return; }
  const { engine: e, saver } = opened;
  e.user = { id: login, name: login };
  const app = e.doc.document.application;

  // ---------------------------------------------------------------- estrutura
  const nameInput = h('input', { class: 'ed-name', value: e.doc.document.name, 'aria-label': 'Nome do documento', onchange: () => run({ type: 'RENAME_DOCUMENT', payload: { name: nameInput.value } }) });
  const status = h('span', { class: 'ed-status', role: 'status', 'aria-live': 'polite' }, 'Pronto');
  const toolbar = h('div', { class: 'ed-toolbar', role: 'toolbar', 'aria-label': 'Ferramentas' });
  const main = h('div', { class: `ed-main ed-app-${app.split('_')[0].toLowerCase()}` });
  const panel = h('aside', { class: 'ed-panel', 'aria-label': 'Painel' });
  const panelTabs = h('div', { class: 'ed-panel-tabs', role: 'tablist' });
  const panelBody = h('div', { class: 'ed-panel-body' });
  panel.append(panelTabs, panelBody);
  root.replaceChildren(
    h('header', { class: 'ed-head' }, h('a', { href: '/admin/editor/', class: 'ed-back', 'aria-label': 'Voltar para a lista' }, '←'), nameInput, status),
    toolbar, h('div', { class: 'ed-body' }, main, panel),
  );

  const run = (op: any) => { const r = e.execute(op); if (!r.ok) toast(r.error.message, 'error'); return r; };
  const view: View = app === 'PRESENTATION_EDITOR' ? new SlideView(e, main) : app === 'SPREADSHEET_EDITOR' ? new SheetView(e, main) : new DocView(e, main);

  // ---------------------------------------------------------------- barra de ferramentas
  const btn = (label: string, title: string, fn: () => void, extra: Record<string, any> = {}) => h('button', { type: 'button', class: 'ed-btn', title, 'aria-label': title, onclick: fn, ...extra }, label);
  const sep = () => h('span', { class: 'ed-sep', 'aria-hidden': 'true' });
  const select = (title: string, opts: [string, string][], fn: (v: string) => void) => { const s = h('select', { class: 'ed-select', 'aria-label': title, title }, ...opts.map(([v, l]) => h('option', { value: v }, l))); s.addEventListener('change', () => { if (s.value) fn(s.value); s.selectedIndex = 0; }); return s; };
  const color = (title: string, fn: (v: string) => void) => { const c = h('input', { type: 'color', class: 'ed-color', title, 'aria-label': title, value: '#FBBF00' }); c.addEventListener('change', () => fn(c.value.toUpperCase())); return c; };
  const pickFile = (accept: string, fn: (f: File) => void) => { const i = h('input', { type: 'file', accept }); i.addEventListener('change', () => { if (i.files?.[0]) fn(i.files[0]); }); i.click(); };

  const common = [
    btn('↶', 'Desfazer (Ctrl+Z)', () => run({ type: 'UNDO' })), btn('↷', 'Refazer (Ctrl+Y)', () => run({ type: 'REDO' })), sep(),
    btn('−', 'Diminuir zoom', () => run({ type: 'SET_VIEW', payload: { zoomOut: true } })),
    h('span', { class: 'ed-zoom', id: 'edZoom' }, '100%'),
    btn('+', 'Aumentar zoom', () => run({ type: 'SET_VIEW', payload: { zoomIn: true } })), sep(),
  ];
  const fmt = (p: Record<string, unknown>) => (view instanceof DocView ? view.format(p) : view instanceof SheetView ? view.format(p) : run({ type: 'FORMAT', targetIds: e.state.selection.selectedIds, payload: p }));
  const toggle = (prop: string) => (view instanceof DocView ? view.toggle(prop) : fmt({ [prop]: true }));
  const textTools = [btn('B', 'Negrito (Ctrl+B)', () => toggle('bold'), { style: 'font-weight:700' }), btn('I', 'Itálico (Ctrl+I)', () => toggle('italic'), { style: 'font-style:italic' }), btn('U', 'Sublinhado (Ctrl+U)', () => toggle('underline'), { style: 'text-decoration:underline' }), btn('S', 'Riscado', () => toggle('strike'), { style: 'text-decoration:line-through' }), color('Cor do texto', (c) => fmt({ color: c }))];
  if (view instanceof DocView) {
    toolbar.append(...common,
      select('Tipo de parágrafo', [['', 'Estilo…'], ['PARAGRAPH', 'Parágrafo'], ['TITLE', 'Título do documento'], ['SUBTITLE', 'Subtítulo'], ['HEADING_1', 'Título 1'], ['HEADING_2', 'Título 2'], ['HEADING_3', 'Título 3'], ['QUOTE', 'Citação'], ['CODE', 'Código']], (v) => view.setType(v)),
      select('Tamanho', [['', 'Tamanho'], ...[9, 10, 11, 12, 14, 16, 18, 24, 32].map((n) => [String(n), `${n} pt`] as [string, string])], (v) => view.format({ fontSize: Number(v) })),
      ...textTools, color('Marca-texto', (c) => view.format({ highlight: c })), sep(),
      btn('⯇', 'Alinhar à esquerda', () => view.align('LEFT')), btn('≡', 'Centralizar', () => view.align('CENTER')), btn('⯈', 'Alinhar à direita', () => view.align('RIGHT')), btn('☰', 'Justificar', () => view.align('JUSTIFY')), sep(),
      select('Inserir', [['', 'Inserir…'], ['LIST_BULLET', 'Lista com marcadores'], ['LIST_NUMBERED', 'Lista numerada'], ['TABLE', 'Tabela 3×3'], ['IMAGE', 'Imagem…'], ['EQUATION', 'Equação…'], ['CIRCLE', 'Círculo'], ['RECTANGLE', 'Retângulo'], ['BREAK', 'Quebra de página'], ['TOC', 'Sumário']], (v) => {
        if (v === 'CIRCLE' || v === 'RECTANGLE') { const t = prompt('Texto dentro da forma (opcional):', '') ?? ''; view.insert('SHAPE', { shapeType: v, ...(t ? { text: t } : {}) }, v === 'CIRCLE' ? { width: 160, height: 160 } : { width: 240, height: 120 }); return; }
        if (v.startsWith('LIST')) view.insert('LIST', { listType: v === 'LIST_NUMBERED' ? 'NUMBERED' : 'BULLET', items: [''] });
        else if (v === 'TABLE') view.insert('TABLE', { header: true, values: [['', '', ''], ['', '', ''], ['', '', '']] });
        else if (v === 'BREAK') view.insert('BREAK', { breakType: 'PAGE' });
        else if (v === 'TOC') { view.insert('FIELD', { fieldType: 'TOC' }); run({ type: 'UPDATE_FIELDS' }); }
        else if (v === 'EQUATION') { const l = prompt('Equação em LaTeX:', 'E = mc^2'); if (l) view.insert('EQUATION', { latex: l, display: 'BLOCK' }); }
        else if (v === 'IMAGE') pickFile('image/*', async (f) => { const alt = prompt('Descreva a imagem (texto alternativo):', '') ?? ''; const asset = run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: f.name, source: await readDataUrl(f), mimeType: f.type, size: f.size } }); if (asset.ok) view.insert('IMAGE', { assetId: asset.value, alt }); });
      }));
  } else if (view instanceof SlideView) {
    toolbar.append(...common,
      select('Inserir', [['', 'Inserir…'], ['TEXT', 'Caixa de texto'], ['RECTANGLE', 'Retângulo'], ['ROUNDED_RECTANGLE', 'Retângulo arredondado'], ['ELLIPSE', 'Elipse'], ['TRIANGLE', 'Triângulo'], ['DIAMOND', 'Losango'], ['ARROW', 'Seta'], ['STAR', 'Estrela'], ['LINE', 'Linha'], ['TABLE', 'Tabela'], ['IMAGE', 'Imagem…'], ['EQUATION', 'Equação…']], (v) => {
        if (v === 'TEXT') view.insert('TEXT', { text: 'Texto' }, [400, 60]);
        else if (v === 'LINE') view.insert('LINE', { lineType: 'STRAIGHT' }, [300, 2]);
        else if (v === 'TABLE') view.insert('TABLE', { header: true, values: [['A', 'B', 'C'], ['', '', ''], ['', '', '']] }, [480, 150]);
        else if (v === 'EQUATION') { const l = prompt('Equação em LaTeX:', 'a^2 + b^2 = c^2'); if (l) view.insert('EQUATION', { latex: l }, [400, 100]); }
        else if (v === 'IMAGE') pickFile('image/*', async (f) => { const alt = prompt('Descreva a imagem:', '') ?? ''; const asset = run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: f.name, source: await readDataUrl(f), mimeType: f.type, size: f.size } }); if (asset.ok) view.insert('IMAGE', { assetId: asset.value, alt }, [400, 300]); });
        else view.insert('SHAPE', { shapeType: v }, [240, 160]);
      }),
      ...textTools, color('Preenchimento', (c) => fmt({ fill: c })), color('Contorno', (c) => fmt({ stroke: c, strokeWidth: 3 })), sep(),
      btn('⇡', 'Trazer para frente', () => run({ type: 'BRING_TO_FRONT', targetIds: e.state.selection.selectedIds })), btn('⇣', 'Enviar para trás', () => run({ type: 'SEND_TO_BACK', targetIds: e.state.selection.selectedIds })),
      btn('⧉', 'Duplicar (Ctrl+D)', () => run({ type: 'DUPLICATE', targetIds: e.state.selection.selectedIds })), btn('🗑', 'Excluir', () => run({ type: 'DELETE', targetIds: e.state.selection.selectedIds })), sep(),
      btn('▶ Apresentar', 'Apresentar desde o início (F5)', () => present(e, 'start'), { class: 'ed-btn ed-primary' }));
  } else {
    toolbar.append(...common, ...textTools.slice(0, 2), color('Cor do texto', (c) => fmt({ color: c })), color('Preenchimento', (c) => fmt({ fill: c })), sep(),
      btn('⯇', 'Alinhar à esquerda', () => fmt({ align: 'LEFT' })), btn('≡', 'Centralizar', () => fmt({ align: 'CENTER' })), btn('⯈', 'Alinhar à direita', () => fmt({ align: 'RIGHT' })), sep(),
      btn('Σ', 'Soma do intervalo selecionado', () => { const sv = view as SheetView; const range = sv.range(); if (!range.includes(':')) return toast('Selecione um intervalo (Shift + setas).', 'error'); const end = range.split(':')[1]; const m = /^([A-Z]+)(\d+)$/.exec(end)!; run({ type: 'SET_CELL', targetId: sv.sheet()!.id, payload: { cell: `${m[1]}${Number(m[2]) + 1}`, value: `=SOMA(${range})` } }); }));
  }
  toolbar.append(sep(), btn('Ler', 'Alternar entre edição e leitura', () => run({ type: 'SET_VIEW', payload: { mode: e.state.mode === 'READ' ? 'EDIT' : 'READ' } }), { id: 'edMode' }));

  // ---------------------------------------------------------------- painéis
  const PANELS: [string, string, () => Node[]][] = [
    ['nav', app === 'PRESENTATION_EDITOR' ? 'Slides' : app === 'SPREADSHEET_EDITOR' ? 'Planilhas' : 'Navegação', navPanel],
    ['comments', 'Comentários', commentsPanel],
    ['review', 'Revisão', reviewPanel],
    ...(app === 'PRESENTATION_EDITOR' ? [['anim', 'Animações', animPanel] as [string, string, () => Node[]]] : []),
    ['versions', 'Versões', versionsPanel],
    ['files', 'Arquivo', filesPanel],
  ];
  let currentPanel = 'nav';
  const drawPanel = () => {
    panelTabs.replaceChildren(...PANELS.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: `ed-tab${k === currentPanel ? ' is-active' : ''}`, 'aria-selected': String(k === currentPanel), onclick: () => { currentPanel = k; drawPanel(); } }, label)));
    try { panelBody.replaceChildren(...PANELS.find(([k]) => k === currentPanel)![2]()); } catch (x) { panelBody.replaceChildren(h('p', { class: 'ed-muted' }, (x as Error).message)); }
  };

  function navPanel(): Node[] {
    const tree = e.execute({ type: 'NAVIGATION_TREE' }).value as any[];
    const item = (n: any): Node => h('li', {},
      h('button', { type: 'button', class: `ed-nav${n.active ? ' is-active' : ''}`, onclick: () => { run(n.kind === 'HEADING' ? { type: 'GO_TO', targetId: n.id } : { type: 'SET_ACTIVE_SURFACE', targetId: n.id }); render(); if (n.kind === 'HEADING' && view instanceof DocView) view.focusText(n.id, 0); } },
        n.kind === 'HEADING' ? `${n.title}${n.page ? `  · p. ${n.page}` : ''}` : `${n.index}. ${n.title}${n.hidden ? ' (oculto)' : ''}`),
      n.children?.length ? h('ul', {}, ...n.children.map(item)) : null);
    return tree.length ? [h('ul', { class: 'ed-tree' }, ...tree.map(item))] : [h('p', { class: 'ed-muted' }, app === 'DOCUMENT_EDITOR' ? 'Use títulos (Título 1, 2, 3) para navegar pelo documento.' : 'Nada por aqui ainda.')];
  }

  function anchorNow(): { targetId: string; start?: number; end?: number; cell?: string } | null {
    if (view instanceof DocView) { const r = view.range() ?? view.last; if (!r) return null; return r.start.id === r.end.id && !r.collapsed ? { targetId: r.start.id, start: r.start.offset, end: r.end.offset } : { targetId: r.start.id }; }
    if (view instanceof SheetView) return { targetId: view.sheet()!.id, cell: view.active() };
    const id = e.state.selection.primaryId ?? e.state.activeSurface;
    return id ? { targetId: id } : null;
  }
  function commentsPanel(): Node[] {
    const list = e.execute({ type: 'LIST_COMMENTS' }).value as any[];
    const box = h('textarea', { class: 'ed-input', rows: '3', placeholder: 'Comentário sobre a seleção… (@nome menciona)', 'aria-label': 'Novo comentário' });
    const add = btn('Comentar', 'Adicionar comentário na seleção', () => { const a = anchorNow(); if (!a) return toast('Selecione onde comentar.', 'error'); if (run({ type: 'ADD_COMMENT', targetId: a.targetId, payload: { text: box.value, start: a.start, end: a.end, cell: a.cell } }).ok) drawPanel(); }, { class: 'ed-btn ed-primary' });
    return [box, add, ...list.map((t) => h('article', { class: `ed-card${t.status === 'RESOLVED' ? ' is-done' : ''}` },
      t.anchor.quote ? h('blockquote', {}, `“${t.anchor.quote}”`) : t.anchor.cell ? h('blockquote', {}, `Célula ${t.anchor.cell}`) : null,
      ...t.messages.map((m: any) => h('p', {}, h('strong', {}, m.authorName), ` ${m.text}`)),
      h('div', { class: 'ed-row' },
        btn('Responder', 'Responder', () => { const v = prompt('Resposta:'); if (v) { run({ type: 'REPLY_COMMENT', payload: { commentId: t.id, text: v } }); drawPanel(); } }),
        btn(t.status === 'RESOLVED' ? 'Reabrir' : 'Resolver', 'Resolver ou reabrir', () => { run({ type: t.status === 'RESOLVED' ? 'REOPEN_COMMENT' : 'RESOLVE_COMMENT', payload: { commentId: t.id } }); drawPanel(); }),
        btn('Ir', 'Mostrar no documento', () => { if (!t.anchor.detached) { run({ type: 'GO_TO', targetId: t.anchor.targetId, payload: t.anchor.cell ? { cell: t.anchor.cell } : {} }); render(); if (view instanceof DocView && t.anchor.start !== undefined) view.focusText(t.anchor.targetId, t.anchor.start, t.anchor.end); } }),
        btn('Excluir', 'Excluir o comentário', () => { run({ type: 'DELETE_COMMENT', payload: { commentId: t.id } }); drawPanel(); })),
    ))];
  }

  function reviewPanel(): Node[] {
    const { issues, summary } = e.execute({ type: 'REVIEW_DOCUMENT' }).value as any;
    const stats = e.execute({ type: 'DOCUMENT_STATS' }).value as any;
    return [
      h('p', { class: 'ed-muted' }, `${stats.words} palavras · ${stats.sentences} frases · leitura ${stats.readingMinutes} min${stats.readability !== null ? ` · legibilidade ${stats.readability}/100` : ''}`),
      h('p', {}, summary.total ? `${summary.total} ponto(s): ${summary.bySeverity.ERROR} erro(s), ${summary.bySeverity.WARNING} aviso(s), ${summary.bySeverity.INFO} sugestão(ões).` : 'Nenhum problema encontrado.'),
      ...issues.slice(0, 80).map((i: any) => h('article', { class: `ed-card ed-${i.severity.toLowerCase()}` },
        h('p', {}, h('strong', {}, i.text ? `“${i.text}” ` : ''), i.message),
        h('div', { class: 'ed-row' },
          ...i.suggestions.slice(0, 3).map((s: string) => btn(`→ ${s}`, `Trocar por ${s}`, () => { run({ type: 'APPLY_SUGGESTION', payload: { issueId: i.id, suggestion: s } }); drawPanel(); })),
          btn('Ir', 'Mostrar', () => { if (view instanceof DocView && i.start !== undefined && !i.cell) view.focusText(i.nodeId, i.start, i.end); else { run({ type: 'GO_TO', targetId: i.nodeId, payload: i.cell ? { cell: i.cell } : {} }); render(); } }),
          btn('Ignorar', 'Ignorar este ponto', () => { run({ type: 'IGNORE_ISSUE', payload: { issueId: i.id } }); drawPanel(); }))),
      ),
    ];
  }

  function animPanel(): Node[] {
    const sel = e.state.selection.primaryId;
    const slide = e.state.activeSurface;
    const tr = slide ? e.find(slide)?.data.transition : null;
    const out: Node[] = [h('h3', {}, 'Transição do slide'), select('Transição', [['', tr ? `Atual: ${tr.effect}` : 'Nenhuma'], ['NONE', 'Nenhuma'], ['FADE', 'Esmaecer'], ['PUSH', 'Empurrar'], ['WIPE', 'Revelar'], ['ZOOM', 'Zoom'], ['MORPH', 'Transformar']], (v) => { run({ type: 'SET_TRANSITION', targetId: slide, payload: { effect: v === 'NONE' ? null : v } }); drawPanel(); })];
    if (!sel || sel === slide) return [...out, h('p', { class: 'ed-muted' }, 'Selecione um elemento para animar.')];
    const list = e.execute({ type: 'LIST_ANIMATIONS', targetId: sel }).value as any[] ?? [];
    out.push(h('h3', {}, 'Animações do elemento'),
      select('Adicionar animação', [['', 'Adicionar…'], ['ENTRANCE:FADE', 'Entrada: esmaecer'], ['ENTRANCE:FLY_IN', 'Entrada: voar'], ['ENTRANCE:ZOOM', 'Entrada: zoom'], ['EMPHASIS:PULSE', 'Ênfase: pulsar'], ['EMPHASIS:SPIN', 'Ênfase: girar'], ['EXIT:FADE', 'Saída: esmaecer']], (v) => { const [kind, effect] = v.split(':'); run({ type: 'ADD_ANIMATION', targetId: sel, payload: { kind, effect } }); drawPanel(); }),
      ...list.map((a) => h('div', { class: 'ed-row' }, `${a.kind} · ${a.effect} · ${a.trigger === 'ON_CLICK' ? 'ao clicar' : a.trigger === 'WITH_PREVIOUS' ? 'com a anterior' : 'após a anterior'}`,
        btn('↻', 'Mudar gatilho', () => { const order = ['ON_CLICK', 'WITH_PREVIOUS', 'AFTER_PREVIOUS']; run({ type: 'UPDATE_ANIMATION', payload: { animationId: a.id, trigger: order[(order.indexOf(a.trigger) + 1) % 3] } }); drawPanel(); }),
        btn('✕', 'Remover animação', () => { run({ type: 'REMOVE_ANIMATION', payload: { animationId: a.id } }); drawPanel(); }))));
    return out;
  }

  function versionsPanel(): Node[] {
    const list = h('div', {}, h('p', { class: 'ed-muted' }, 'Carregando…'));
    store.listVersions(id).then((vs: any[]) => {
      list.replaceChildren(...(vs.length ? vs.map((v) => h('article', { class: 'ed-card' }, h('p', {}, h('strong', {}, v.label), ` · ${new Date(v.createdAt).toLocaleString('pt-BR')}`),
        h('div', { class: 'ed-row' },
          btn('Comparar', 'Comparar com o atual', async () => { const { doc } = await store.getVersion(id, v.id); const d = diffDocuments(doc, e.doc); toast(`Desde "${v.label}": ${d.summary.inserted} criado(s), ${d.summary.deleted} excluído(s), ${d.summary.modified} alterado(s), ${d.summary.moved} movido(s).`); }),
          btn('Restaurar', 'Voltar a esta versão (dá para desfazer)', async () => { if (!confirm(`Voltar o documento para "${v.label}"?`)) return; const { doc } = await store.getVersion(id, v.id); const snap = { id: `SRV_${v.id}`, label: v.label, timestamp: Date.now(), doc }; e.snapshots.push(snap); run({ type: 'RESTORE_VERSION', targetId: snap.id }); render(); })),
      )) : [h('p', { class: 'ed-muted' }, 'Nenhuma versão ainda.')]));
    }).catch((x) => list.replaceChildren(h('p', { class: 'ed-muted' }, x.message)));
    return [btn('Criar versão', 'Guardar uma fotografia do documento', () => { const label = prompt('Nome da versão:', `Versão de ${new Date().toLocaleDateString('pt-BR')}`); if (label) { run({ type: 'CREATE_VERSION', payload: { label } }); setTimeout(drawPanel, 800); } }, { class: 'ed-btn ed-primary' }), list];
  }

  function filesPanel(): Node[] {
    const formats = app === 'SPREADSHEET_EDITOR' ? ['XLSX', 'CSV', 'PDF', 'HTML', 'JSON'] : app === 'PRESENTATION_EDITOR' ? ['PPTX', 'PDF', 'HTML', 'SVG', 'PNG', 'JSON'] : ['DOCX', 'PDF', 'MD', 'HTML', 'TXT', 'JSON'];
    const exp = async (f: string) => {
      try {
        if (f === 'PNG' || f === 'SVG') {
          const target = e.state.selection.primaryId && ['CHART', 'DIAGRAM'].includes(e.get(e.state.selection.primaryId).type) ? e.state.selection.primaryId : e.state.activeSurface;
          const svg = exportDocument(e, 'SVG', { targetId: target });
          if (f === 'SVG') return download(svg.fileName, svg.data, svg.mimeType);
          return download(svg.fileName.replace(/\.svg$/, '.png'), await svgToPng(String(svg.data)), 'image/png');
        }
        const r = exportDocument(e, f, f === 'CSV' ? { options: { delimiter: ';', decimal: ',', bom: true } } : {});
        download(r.fileName, r.data, r.mimeType);
      } catch (x) { toast((x as Error).message, 'error'); }
    };
    return [
      h('h3', {}, 'Exportar'), h('div', { class: 'ed-grid2' }, ...formats.map((f) => btn(f, `Baixar em ${f}`, () => exp(f)))),
      h('h3', {}, 'Importar para este documento'),
      btn('Escolher arquivo…', 'Importar conteúdo de um arquivo', () => pickFile('.docx,.xlsx,.pptx,.md,.html,.htm,.txt,.csv,.json', async (f) => { try { await importFile(e, { name: f.name, data: await readBytes(f) }); render(); toast(`“${f.name}” importado.`); } catch (x) { toast((x as Error).message, 'error'); } })),
      h('h3', {}, 'Imprimir'), btn('Gerar PDF para imprimir', 'Imprimir', () => exp('PDF')),
    ];
  }

  // ---------------------------------------------------------------- atualizações e atalhos
  let frame = 0;
  const render = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
    view.render();
    (document.getElementById('edZoom') as HTMLElement).textContent = `${e.state.zoom}%`;
    (document.getElementById('edMode') as HTMLElement).textContent = e.state.mode === 'READ' ? 'Editar' : 'Ler';
    main.classList.toggle('is-reading', e.state.mode === 'READ');
    if (view instanceof DocView) view.root.setAttribute('contenteditable', e.state.mode === 'READ' ? 'false' : 'true');
    if (nameInput.value !== e.doc.document.name && document.activeElement !== nameInput) nameInput.value = e.doc.document.name;
    if (currentPanel !== 'versions' && currentPanel !== 'files') drawPanel();
  }); };
  e.on('change', render);
  e.on('view', render);
  e.on('navigate', render);
  view.onSelect = () => { if (currentPanel === 'anim' || currentPanel === 'nav') drawPanel(); };
  e.on('save-status', (s: any) => { status.textContent = STATUS[s.state] ?? s.state; status.dataset.state = s.state; if (s.state === 'saved' && s.lastSavedAt) status.title = `Salvo às ${new Date(s.lastSavedAt).toLocaleTimeString('pt-BR')}`; });

  document.addEventListener('keydown', (ev) => {
    if (document.querySelector('.pr-overlay')) return;
    const keys = [ev.ctrlKey || ev.metaKey ? 'Ctrl' : '', ev.altKey ? 'Alt' : '', ev.shiftKey ? 'Shift' : '', ev.key.length === 1 ? ev.key.toUpperCase() : ev.key].filter(Boolean).join('+');
    if (!/^(Ctrl|Alt|F\d)/.test(keys)) return;
    const inField = (ev.target as HTMLElement).closest('input, textarea, select');
    const inText = view instanceof DocView && view.root.contains(ev.target as Node);
    // copiar/colar/selecionar tudo dentro de texto ficam com o navegador
    if ((inField || inText) && ['Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+A'].includes(keys)) return;
    if (inField && !['Ctrl+S'].includes(keys)) return;
    let b: any;
    try { b = e.execute({ type: 'RESOLVE_SHORTCUT', payload: { keys: normalizeKeys(keys) } }).value; } catch { return; }
    if (inText && keys === 'Ctrl+B') b = { command: 'BOLD' };
    if (inText && keys === 'Ctrl+I') b = { command: 'ITALIC' };
    if (inText && keys === 'Ctrl+U') b = { command: 'UNDERLINE' };
    if (!b) return;
    ev.preventDefault();
    if (b.operation) { const op = { ...b.operation }; if (['DUPLICATE', 'DELETE', 'GROUP', 'UNGROUP', 'COPY', 'CUT'].includes(op.type)) op.targetIds = e.state.selection.selectedIds; run(op); }
    else if (b.macro) run({ type: 'RUN_MACRO', payload: { name: b.macro, applyToSelection: true } });
    else if (b.command === 'SAVE') void saver.flush().then(() => toast('Salvo.'));
    else if (b.command === 'PRINT') { const r = exportDocument(e, 'PDF'); download(r.fileName, r.data, r.mimeType); }
    else if (b.command === 'PRESENT' && app === 'PRESENTATION_EDITOR') present(e, 'start');
    else if (b.command === 'REVIEW') { currentPanel = 'review'; drawPanel(); }
    else if (b.command === 'FIND' || b.command === 'REPLACE') {
      const q = prompt('Localizar:'); if (!q) return;
      if (b.command === 'REPLACE') { const rep = prompt(`Substituir “${q}” por:`); if (rep === null) return; const r = run({ type: 'REPLACE', payload: { query: q, replacement: rep, cells: true } }); if (r.ok) toast(`${r.value} substituição(ões).`); return; }
      const found = e.execute({ type: 'FIND', payload: { query: q } }).value as any[];
      if (!found?.length) return toast('Nada encontrado.', 'error');
      toast(`${found.length} ocorrência(s).`);
      if (view instanceof DocView && !found[0].cell) view.focusText(found[0].nodeId, found[0].start, found[0].end); else { run({ type: 'GO_TO', targetId: found[0].nodeId, payload: found[0].cell ? { cell: found[0].cell } : {} }); render(); }
    }
    else if (b.command === 'BOLD' || b.command === 'ITALIC' || b.command === 'UNDERLINE') toggle(b.command.toLowerCase());
  });
  window.addEventListener('beforeunload', (ev) => { if (saver.status().pending || saver.state === 'saving') { void saver.flush(); ev.preventDefault(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void saver.flush(); });

  drawPanel();
  render();
  return e as Engine;
}
