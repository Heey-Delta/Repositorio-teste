// Comportamento do editor de publicação (src/components/admin/Editor.astro).
// O corpo é editado com Tiptap e guardado em Markdown; título e resumo são editados direto no texto da página.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';

type Dep = { id: number; slug: string; name: string; code: string };
const data = JSON.parse(document.getElementById('editorData')!.textContent!) as {
  id: string | null; draft: Record<string, any>; updatedAt: string | null; login: string; departments: Dep[]; site: string;
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const form = $<HTMLFormElement>('#meta');
const f = (name: string) => form.elements.namedItem(name) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const titleEl = $('#title'), summaryEl = $('#summary'), stateEl = $('#saveState'), saveBtn = $<HTMLButtonElement>('#saveBtn');

let postId = data.id;
let baseUpdatedAt = data.updatedAt;
let dirty = false;
let saving = false;

const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const plain = (el: HTMLElement) => (el.innerText || '').replace(/\s+/g, ' ').trim();

// ---------- corpo (Tiptap) ----------
const editor = new Editor({
  element: $('#body'),
  extensions: [
    StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
    Markdown,
    Placeholder.configure({ placeholder: 'Escreva aqui. Use a barra acima para títulos de seção, listas e links.' }),
  ],
  content: data.draft.body ?? '',
  contentType: 'markdown',
  onUpdate: () => markDirty(),
  onTransaction: () => syncToolbar(),
});

const commands: Record<string, () => void> = {
  h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  bold: () => editor.chain().focus().toggleBold().run(),
  italic: () => editor.chain().focus().toggleItalic().run(),
  bullet: () => editor.chain().focus().toggleBulletList().run(),
  ordered: () => editor.chain().focus().toggleOrderedList().run(),
  quote: () => editor.chain().focus().toggleBlockquote().run(),
  code: () => editor.chain().focus().toggleCodeBlock().run(),
  hr: () => editor.chain().focus().setHorizontalRule().run(),
  undo: () => editor.chain().focus().undo().run(),
  redo: () => editor.chain().focus().redo().run(),
  link: () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Endereço do link (vazio remove o link)', prev ?? 'https://');
    if (url === null) return;
    if (!url.trim() || url.trim() === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  },
};
const active: Record<string, () => boolean> = {
  h2: () => editor.isActive('heading', { level: 2 }), h3: () => editor.isActive('heading', { level: 3 }),
  bold: () => editor.isActive('bold'), italic: () => editor.isActive('italic'), bullet: () => editor.isActive('bulletList'),
  ordered: () => editor.isActive('orderedList'), quote: () => editor.isActive('blockquote'), code: () => editor.isActive('codeBlock'),
};
const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('#toolbar [data-cmd]')];
toolButtons.forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
toolButtons.forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd!]?.()));
function syncToolbar() {
  for (const b of toolButtons) if (active[b.dataset.cmd!]) b.setAttribute('aria-pressed', String(active[b.dataset.cmd!]()));
}

// ---------- título, resumo e contadores ----------
let slugTouched = Boolean(data.draft.slug) && data.draft.slug !== slugify(data.draft.title ?? '');
for (const el of [titleEl, summaryEl]) {
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain').replace(/\s+/g, ' ') ?? '');
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (el === titleEl) { summaryEl.focus(); return; }
    editor.view.focus();
    editor.commands.setTextSelection(1);
  });
  el.addEventListener('input', () => { markDirty(); refreshDerived(); });
}
titleEl.addEventListener('input', () => {
  if (!slugTouched) { f('slug').value = slugify(plain(titleEl)); refreshDerived(); }
});
f('slug').addEventListener('input', () => { slugTouched = true; });

function dep() { return data.departments.find((d) => d.id === Number(f('departmentId').value)) ?? data.departments[0]; }

function refreshDerived() {
  const d = dep(), title = plain(titleEl), summary = plain(summaryEl);
  $('#depLabel').textContent = d.name;
  $('#codeLabel').textContent = f('code').value.trim().toUpperCase() || 'sem código';
  $('#slugPrefix').textContent = `/lab/${d.slug}/`;
  $('#slugEcho').textContent = f('slug').value;
  $('#formatWrap').hidden = d.slug !== 'field-notes';
  $('#scheduledWrap').hidden = f('status').value !== 'scheduled';
  $('#summaryCount').textContent = String(summary.length);
  $('#summaryCount').style.color = summary.length > 160 ? '#ff8a8a' : '';
  const metaTitle = f('metaTitle').value.trim(), metaDesc = f('metaDescription').value.trim();
  $('#metaTitleCount').textContent = String(metaTitle.length);
  $('#metaDescCount').textContent = String(metaDesc.length);
  f('metaTitle').placeholder = title ? `Vazio: "${title.slice(0, 50)}"` : 'Vazio: usa o título';
  $('#serpUrl').textContent = `${data.site.replace(/^https:\/\//, '')} › lab › ${d.slug} › ${f('slug').value || '…'}`;
  $('#serpTitle').textContent = cut(metaTitle || `${title || 'Sem título'} · Experimental Lab`, 60);
  $('#serpDesc').textContent = cut(metaDesc || summary || 'Sem descrição: o Google vai escolher um trecho do texto.', 160);
}
const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

form.addEventListener('input', () => { markDirty(); refreshDerived(); });
form.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t === f('departmentId')) {
    const code = f('code').value.trim().toUpperCase();
    if (!code || !code.startsWith(`${dep().code}-`)) void generateCode();
  }
  markDirty(); refreshDerived();
});
form.addEventListener('submit', (e) => e.preventDefault());

$('#genCode').addEventListener('click', () => void generateCode());
async function generateCode() {
  const res = await fetch(`/api/posts/next-code?departmentId=${dep().id}`);
  if (!res.ok) return;
  const { code } = await res.json();
  if (code) { f('code').value = code; markDirty(); refreshDerived(); }
}

// ---------- gaveta de detalhes ----------
const details = $('#details'), detailsBtn = $<HTMLButtonElement>('#detailsBtn');
function setDetails(open: boolean) {
  details.dataset.open = String(open);
  document.body.dataset.details = String(open);
  detailsBtn.setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('hallan-editor-details', open ? '1' : '0'); } catch {}
}
detailsBtn.addEventListener('click', () => setDetails(details.dataset.open !== 'true'));
$('#detailsClose').addEventListener('click', () => { setDetails(false); detailsBtn.focus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && details.dataset.open === 'true' && innerWidth < 1280) { setDetails(false); detailsBtn.focus(); }
});
let remembered: string | null = null;
try { remembered = localStorage.getItem('hallan-editor-details'); } catch {}
details.classList.add('no-anim');
setDetails(innerWidth >= 1280 && remembered !== '0');
requestAnimationFrame(() => requestAnimationFrame(() => details.classList.remove('no-anim')));

// ---------- gravação ----------
function setState(text: string, tone: 'ok' | 'dirty' | 'error' = 'ok') {
  stateEl.textContent = text;
  stateEl.dataset.tone = tone;
}
function markDirty() {
  if (saving) return;
  dirty = true;
  setState('Alterações não salvas', 'dirty');
}

function collect() {
  const nullable = (name: string) => f(name).value.trim() || null;
  const scheduled = f('scheduledAt').value;
  return {
    title: plain(titleEl),
    summary: plain(summaryEl),
    body: editor.getMarkdown(),
    departmentId: Number(f('departmentId').value),
    contentTypeId: f('contentTypeId').value ? Number(f('contentTypeId').value) : null,
    status: f('status').value,
    stage: f('stage').value,
    level: f('level').value,
    format: dep().slug === 'field-notes' ? nullable('format') : null,
    code: f('code').value.trim().toUpperCase() || null,
    slug: f('slug').value.trim(),
    areaIds: [...form.querySelectorAll<HTMLInputElement>('input[name="areaIds"]:checked')].map((i) => Number(i.value)),
    tags: f('tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    relatedProject: nullable('relatedProject'),
    methodology: nullable('methodology'),
    aiAssistance: nullable('aiAssistance'),
    scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
    seo: {
      metaTitle: nullable('metaTitle'),
      metaDescription: nullable('metaDescription'),
      canonicalUrl: nullable('canonicalUrl'),
      noindex: (f('noindex') as HTMLInputElement).checked,
      schemaType: nullable('schemaType'),
    },
  };
}

const fieldTarget: Record<string, () => HTMLElement> = { title: () => titleEl, summary: () => summaryEl, body: () => $('#body .ProseMirror') };
function showFieldError(field?: string) {
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (!field) return;
  const key = field.replace(/^seo\./, '');
  const el = fieldTarget[key]?.() ?? (form.elements.namedItem(key) as HTMLElement | null);
  if (!el) return;
  if (form.contains(el)) { setDetails(true); el.setAttribute('aria-invalid', 'true'); }
  el.focus();
}

async function save() {
  if (saving) return;
  if (!f('slug').value.trim() && plain(titleEl)) f('slug').value = slugify(plain(titleEl));
  saving = true;
  saveBtn.disabled = true;
  setState('Salvando…');
  try {
    const res = await fetch(postId ? `/api/posts/${postId}` : '/api/posts', {
      method: postId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post: collect(), baseUpdatedAt }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) { setState('Sua sessão expirou. Entre de novo em outra aba e salve outra vez.', 'error'); return; }
    if (!res.ok) { setState(out.error ?? 'Não deu para salvar.', 'error'); showFieldError(out.field); return; }
    showFieldError();
    const created = !postId;
    postId = out.id;
    baseUpdatedAt = out.updatedAt;
    dirty = false;
    setState(`Salvo às ${new Date(out.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    addRevision(out.revisionId, created ? 'Criada' : null);
    if (created) history.replaceState(null, '', `/admin/publicacoes/${postId}/`);
    document.title = `${plain(titleEl) || 'Sem título'} · Editor · Admin`;
  } catch {
    setState('Sem conexão. Nada foi perdido: tente salvar de novo.', 'error');
  } finally {
    saving = false;
    saveBtn.disabled = false;
  }
}
saveBtn.addEventListener('click', () => void save());
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
});
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// ---------- versões ----------
const revList = $('#revList');
function addRevision(id: number, note: string | null) {
  if (!id) return;
  $('#revEmpty').hidden = true;
  const current = revList.querySelector('li span.text-xs');
  if (current) current.replaceWith(restoreButton(Number(revList.querySelector('li')!.dataset.rev ?? 0)));
  const li = document.createElement('li');
  li.className = 'flex items-center justify-between gap-3 border-t border-line py-2.5 text-[13px] last:border-b';
  li.dataset.rev = String(id);
  const when = new Date().toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const label = document.createElement('span');
  label.className = 'min-w-0';
  label.innerHTML = `<span class="font-mono text-muted tabular-nums">#${id}</span> `;
  label.append(when);
  if (note) { const n = document.createElement('span'); n.className = 'text-muted'; n.textContent = ` · ${note}`; label.append(n); }
  const tag = document.createElement('span');
  tag.className = 'shrink-0 text-xs text-muted';
  tag.textContent = 'atual';
  li.append(label, tag);
  revList.prepend(li);
}
function restoreButton(id: number) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.restore = String(id);
  b.className = 'shrink-0 cursor-pointer rounded-[4px] px-2 py-1 text-xs text-ink hover:bg-[#141414]';
  b.textContent = 'Restaurar';
  return b;
}
revList.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-restore]');
  if (!b || !postId) return;
  const msg = dirty
    ? `Você tem alterações não salvas, e elas serão perdidas. Restaurar a versão #${b.dataset.restore}?`
    : `Restaurar a versão #${b.dataset.restore}? O conteúdo atual continua guardado no histórico.`;
  if (!confirm(msg)) return;
  b.disabled = true;
  setState('Restaurando…');
  const res = await fetch(`/api/posts/${postId}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisionId: Number(b.dataset.restore) }),
  });
  if (res.ok) { dirty = false; location.reload(); return; }
  const out = await res.json().catch(() => ({}));
  setState(out.error ?? 'Não deu para restaurar.', 'error');
  b.disabled = false;
});

refreshDerived();
syncToolbar();
if (!postId) titleEl.focus();
