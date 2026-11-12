// Comportamento do editor de publicação (src/components/admin/Editor.astro).
// O corpo é editado com Tiptap e guardado em Markdown; título e resumo são editados direto no texto da página.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';

type Dep = { id: number; slug: string; name: string; code: string };
type Media = { id: string; url: string; alt: string | null; caption?: string | null; width: number | null; height: number | null; kind?: string };
const data = JSON.parse(document.getElementById('editorData')!.textContent!) as {
  id: string | null; draft: Record<string, any>; updatedAt: string | null; login: string; departments: Dep[]; site: string; cover: Media | null;
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
    Image.configure({ inline: false, allowBase64: false }),
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
  image: () => openMedia('inline'),
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
    coverMediaId: cover?.id ?? null,
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
    const at = `Salvo às ${new Date(out.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const site: Record<string, [string, 'ok' | 'error']> = {
      started: [' · o site atualiza em cerca de 1 minuto', 'ok'],
      unconfigured: [' · o site ainda não está ligado ao admin (falta o Deploy Hook)', 'error'],
      failed: [' · não deu para atualizar o site; salve de novo em instantes', 'error'],
    };
    const [extra, tone] = site[out.site] ?? ['', 'ok'];
    setState(at + extra + (out.redirected ? ` · ${out.redirected} agora leva para o novo endereço` : ''), tone);
    const view = $<HTMLAnchorElement>('#viewLink');
    view.href = `/lab/${dep().slug}/${f('slug').value}/`;
    view.hidden = f('status').value !== 'published';
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

// ---------- imagens: capa e imagens no texto ----------
let cover: Media | null = data.cover;
const coverBox = $('#coverBox');
function renderCover() {
  coverBox.replaceChildren();
  if (cover) {
    const fig = document.createElement('figure');
    fig.className = 'relative m-0 border-y border-line';
    const img = document.createElement('img');
    img.src = cover.url; img.alt = cover.alt ?? '';
    if (cover.width && cover.height) { img.width = cover.width; img.height = cover.height; }
    img.className = 'block max-h-[560px] w-full object-cover';
    const bar = document.createElement('div');
    bar.className = 'absolute top-3 right-3 flex gap-2';
    bar.append(coverButton('Trocar capa', () => openMedia('cover')), coverButton('Remover capa', () => { cover = null; renderCover(); markDirty(); }));
    fig.append(img, bar);
    coverBox.append(fig);
  } else {
    const add = coverButton('+ Adicionar imagem de capa', () => openMedia('cover'));
    add.className = 'flex min-h-[120px] w-full cursor-pointer items-center justify-center border-y border-dashed border-line text-sm text-muted hover:text-ink';
    coverBox.append(add);
  }
}
function coverButton(label: string, fn: () => void) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label;
  b.className = 'min-h-9 cursor-pointer rounded-[6px] bg-black/80 px-3 text-[13px] text-ink hover:bg-black';
  b.addEventListener('click', fn);
  return b;
}

const dialog = $<HTMLDialogElement>('#mediaDialog');
const fileInput = $<HTMLInputElement>('#mediaFile'), preview = $<HTMLImageElement>('#mediaPreview');
const altInput = $<HTMLTextAreaElement>('#mediaAlt'), captionInput = $<HTMLInputElement>('#mediaCaption');
const mediaError = $('#mediaError'), mediaOk = $<HTMLButtonElement>('#mediaOk'), lib = $('#mediaLib');
let mode: 'cover' | 'inline' = 'inline';
let picked: Media | null = null;
let prepared: { blob: Blob; name: string; width: number; height: number } | null = null;

function mediaFail(msg: string) { mediaError.textContent = msg; mediaError.hidden = false; }
async function openMedia(m: 'cover' | 'inline') {
  mode = m; picked = null; prepared = null;
  fileInput.value = ''; altInput.value = ''; captionInput.value = '';
  altInput.removeAttribute('aria-invalid'); mediaError.hidden = true;
  preview.hidden = true; $('#mediaPick').hidden = false;
  $('#mediaTitle').textContent = m === 'cover' ? 'Imagem de capa' : 'Inserir imagem no texto';
  dialog.showModal();
  try {
    const res = await fetch('/api/media');
    const { media } = await res.json() as { media: Media[] };
    const images = media.filter((x) => x.kind === 'image');
    $('#mediaLibWrap').hidden = images.length === 0;
    lib.replaceChildren(...images.map((x) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'media-lib-item block aspect-square w-full cursor-pointer overflow-hidden rounded-[4px] border border-line';
      b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', x.alt ?? 'Imagem sem descrição');
      const img = document.createElement('img'); img.src = x.url; img.alt = ''; img.loading = 'lazy'; img.className = 'size-full object-cover';
      b.append(img);
      b.addEventListener('click', () => {
        lib.querySelectorAll('[aria-pressed]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        picked = x; prepared = null; fileInput.value = '';
        preview.src = x.url; preview.hidden = false; $('#mediaPick').hidden = true;
        altInput.value = x.alt ?? ''; captionInput.value = x.caption ?? '';
      });
      li.append(b);
      return li;
    }));
  } catch { $('#mediaLibWrap').hidden = true; }
}

// Reduz para no máximo 2000 px de largura e converte para WebP; GIF fica como está (pode ser animado)
async function optimize(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / bitmap.width);
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  if (file.type === 'image/gif') return { blob: file as Blob, name: file.name, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  const webp = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.82));
  const blob = webp && webp.type === 'image/webp' && (webp.size < file.size || scale < 1) ? webp : file;
  return { blob, name: blob === file ? file.name : file.name.replace(/\.[a-z0-9]+$/i, '') + '.webp', width, height };
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  mediaError.hidden = true; picked = null;
  lib.querySelectorAll('[aria-pressed]').forEach((o) => o.setAttribute('aria-pressed', 'false'));
  try {
    prepared = await optimize(file);
    preview.src = URL.createObjectURL(prepared.blob); preview.hidden = false; $('#mediaPick').hidden = true;
    if (prepared.blob.size > 4 * 1024 * 1024) mediaFail('Mesmo reduzida, a imagem passou de 4 MB. Tente outra.');
    altInput.focus();
  } catch { prepared = null; mediaFail('Não consegui abrir essa imagem. Tente outro arquivo.'); }
});

$('#mediaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  mediaError.hidden = true;
  const alt = altInput.value.trim(), caption = captionInput.value.trim();
  if (!picked && !prepared) return mediaFail('Escolha uma imagem do computador ou uma já enviada.');
  if (alt.length < 3) { altInput.setAttribute('aria-invalid', 'true'); altInput.focus(); return mediaFail('Escreva o texto alternativo.'); }
  altInput.removeAttribute('aria-invalid');
  mediaOk.disabled = true; mediaOk.textContent = 'Enviando…';
  try {
    let media: Media;
    if (prepared) {
      const body = new FormData();
      body.append('file', prepared.blob, prepared.name);
      body.append('alt', alt); body.append('caption', caption);
      body.append('width', String(prepared.width)); body.append('height', String(prepared.height));
      const res = await fetch('/api/media', { method: 'POST', body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return mediaFail(out.error ?? 'Não deu para enviar a imagem.');
      media = out.media;
    } else {
      media = picked!;
      if ((media.alt ?? '') !== alt || (media.caption ?? '') !== caption) {
        const res = await fetch(`/api/media/${media.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt, caption }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) return mediaFail(out.error ?? 'Não deu para atualizar o texto alternativo.');
        media = out.media;
      }
    }
    if (mode === 'cover') { cover = media; renderCover(); }
    else editor.chain().focus().setImage({ src: media.url, alt: media.alt ?? '' }).run();
    markDirty();
    dialog.close();
  } catch {
    mediaFail('Sem conexão. Tente de novo.');
  } finally {
    mediaOk.disabled = false; mediaOk.textContent = 'Usar imagem';
  }
});
for (const id of ['#mediaClose', '#mediaCancel']) $(id).addEventListener('click', () => dialog.close());

renderCover();
refreshDerived();
syncToolbar();
if (!postId) titleEl.focus();
