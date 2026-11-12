// Comportamento do editor de publicação (src/components/admin/Editor.astro).
// O corpo é editado com Tiptap e guardado em Markdown; título e resumo são editados direto no texto da página.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import { prepareFile, sendFile, kb, type Prepared } from './media-upload';

type Dep = { id: number; slug: string; name: string; code: string };
type Media = { id: string; url: string; alt: string | null; caption?: string | null; width: number | null; height: number | null; kind?: string; size?: number };
const data = JSON.parse(document.getElementById('editorData')!.textContent!) as {
  id: string | null; draft: Record<string, any>; updatedAt: string | null; login: string; departments: Dep[]; site: string; cover: Media | null;
  posts: { id: string; code: string | null; title: string; status: string }[];
  attachments: Media[];
  areas: { id: number; name: string }[]; contentTypes: { id: number; name: string }[];
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
// textContent, e não innerText: innerText devolve o texto com o CSS aplicado (o título aparece em caixa alta)
const plain = (el: HTMLElement) => (el.textContent || '').replace(/\s+/g, ' ').trim();

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
// o endereço acompanha o título só em publicação nova: depois de salva, muda apenas se for editado à mão
let slugTouched = Boolean(data.id) || (Boolean(data.draft.slug) && data.draft.slug !== slugify(data.draft.title ?? ''));
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
    references: collectRefs(),
    attachments: [...attList.querySelectorAll<HTMLElement>('li')].map((li) => ({ mediaId: li.dataset.id! })),
    relations: [...relList.querySelectorAll<HTMLElement>('li')].map((li) => ({ postId: li.dataset.post!, kind: li.querySelector('select')!.value })),
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
  const ref = field.match(/^references\.(\d+)\.(\w+)/);
  if (ref) {
    const input = refList.children[Number(ref[1])]?.querySelector<HTMLElement>(`[data-field="${ref[2]}"]`);
    if (input) { setDetails(true); input.setAttribute('aria-invalid', 'true'); input.focus(); }
    return;
  }
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
    (out.refIds as number[] | undefined)?.forEach((rid, i) => { const li = refList.children[i] as HTMLElement | undefined; if (li) li.dataset.id = String(rid); });
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
  const wrap = document.createElement('span');
  wrap.className = 'flex shrink-0 gap-1';
  for (const [attr, text] of [['compare', 'Comparar'], ['restore', 'Restaurar']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset[attr] = String(id);
    b.className = 'cursor-pointer rounded-[4px] px-2 py-1 text-xs text-ink hover:bg-[#141414]';
    b.textContent = text;
    wrap.append(b);
  }
  return wrap;
}
revList.addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-compare]');
  if (c && postId) void openDiff(Number(c.dataset.compare));
});
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
let mode: 'cover' | 'inline' | 'attachment' = 'inline';
let picked: Media | null = null;
let prepared: Prepared | null = null;

function mediaFail(msg: string) { mediaError.textContent = msg; mediaError.hidden = false; }
const pickHint = $('#mediaPick').innerHTML;
async function openMedia(m: 'cover' | 'inline' | 'attachment') {
  mode = m; picked = null; prepared = null;
  const pdf = m === 'attachment';
  fileInput.value = ''; altInput.value = ''; captionInput.value = '';
  fileInput.accept = pdf ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/avif,image/gif';
  altInput.removeAttribute('aria-invalid'); mediaError.hidden = true;
  preview.hidden = true; $('#mediaPick').hidden = false;
  $('#mediaPick').innerHTML = pdf ? 'Escolher PDF do computador <span class="block text-xs text-muted">Até 4 MB.</span>' : pickHint;
  $('#mediaAltLabel').textContent = pdf ? 'Título do arquivo' : 'Texto alternativo';
  $('#mediaAltHint').textContent = pdf ? 'Obrigatório. É o nome que aparece no link de download.' : 'Obrigatório. Descreva o que a imagem mostra para quem não consegue vê-la.';
  mediaOk.textContent = pdf ? 'Anexar' : 'Usar imagem';
  $('#mediaTitle').textContent = m === 'cover' ? 'Imagem de capa' : pdf ? 'Anexar PDF' : 'Inserir imagem no texto';
  dialog.showModal();
  try {
    const res = await fetch('/api/media');
    const { media } = await res.json() as { media: Media[] };
    const images = media.filter((x) => x.kind === (pdf ? 'pdf' : 'image'));
    $('#mediaLibWrap').hidden = images.length === 0;
    lib.replaceChildren(...images.map((x) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'media-lib-item block aspect-square w-full cursor-pointer overflow-hidden rounded-[4px] border border-line';
      b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', x.alt ?? 'Imagem sem descrição');
      if (pdf) {
        b.className += ' grid place-items-center p-2 text-center text-[11px] text-muted';
        b.textContent = `PDF · ${x.alt ?? 'sem título'}`;
      } else {
        const img = document.createElement('img'); img.src = x.url; img.alt = ''; img.loading = 'lazy'; img.className = 'size-full object-cover';
        b.append(img);
      }
      b.addEventListener('click', () => {
        lib.querySelectorAll('[aria-pressed]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        picked = x; prepared = null; fileInput.value = '';
        if (pdf) $('#mediaPick').textContent = `PDF escolhido: ${x.alt ?? 'sem título'}`;
        else { preview.src = x.url; preview.hidden = false; $('#mediaPick').hidden = true; }
        altInput.value = x.alt ?? ''; captionInput.value = x.caption ?? '';
      });
      li.append(b);
      return li;
    }));
  } catch { $('#mediaLibWrap').hidden = true; }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  mediaError.hidden = true; picked = null;
  lib.querySelectorAll('[aria-pressed]').forEach((o) => o.setAttribute('aria-pressed', 'false'));
  try {
    prepared = await prepareFile(file);
    if (mode === 'attachment') {
      $('#mediaPick').textContent = `${file.name} · ${kb(file.size)}`;
      if (!altInput.value) altInput.value = file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
    } else { preview.src = URL.createObjectURL(prepared.blob); preview.hidden = false; $('#mediaPick').hidden = true; }
    if (prepared.blob.size > 4 * 1024 * 1024) mediaFail(mode === 'attachment' ? 'O PDF passou de 4 MB. Reduza o arquivo e tente de novo.' : 'Mesmo reduzida, a imagem passou de 4 MB. Tente outra.');
    altInput.focus();
  } catch { prepared = null; mediaFail('Não consegui abrir esse arquivo. Tente outro.'); }
});

$('#mediaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  mediaError.hidden = true;
  const alt = altInput.value.trim(), caption = captionInput.value.trim();
  const pdf = mode === 'attachment';
  if (!picked && !prepared) return mediaFail(pdf ? 'Escolha um PDF do computador ou um já enviado.' : 'Escolha uma imagem do computador ou uma já enviada.');
  if (alt.length < 3) { altInput.setAttribute('aria-invalid', 'true'); altInput.focus(); return mediaFail(pdf ? 'Dê um título ao arquivo.' : 'Escreva o texto alternativo.'); }
  altInput.removeAttribute('aria-invalid');
  mediaOk.disabled = true; mediaOk.textContent = 'Enviando…';
  try {
    let media: Media;
    if (prepared) {
      try { media = await sendFile(prepared, { alt, caption }); } catch (err) { return mediaFail((err as Error).message); }
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
    else if (mode === 'attachment') addAttachment(media);
    else editor.chain().focus().setImage({ src: media.url, alt: media.alt ?? '' }).run();
    markDirty();
    dialog.close();
  } catch {
    mediaFail('Sem conexão. Tente de novo.');
  } finally {
    mediaOk.disabled = false; mediaOk.textContent = mode === 'attachment' ? 'Anexar' : 'Usar imagem';
  }
});
for (const id of ['#mediaClose', '#mediaCancel']) $(id).addEventListener('click', () => dialog.close());

// ---------- referências ----------
type Ref = { id: number | null; title: string; author: string | null; url: string | null; sourceType: string | null; publisher: string | null; publishedOn: string | null; accessedOn: string | null };
const refList = $('#refList');
const sourceTypes = ['Livro', 'Artigo científico', 'Artigo ou post', 'Site', 'Vídeo', 'Podcast', 'Documento ou relatório', 'Entrevista', 'Outro'];
const inputCls = 'w-full rounded-[6px] border border-line bg-bg px-3 text-[13px] text-ink focus-visible:border-lime aria-[invalid=true]:border-[#ff5a5a]';
function refInput(field: string, label: string, value: string | null, placeholder = '') {
  const wrap = document.createElement('label');
  wrap.className = 'flex flex-col gap-1 text-xs text-muted';
  wrap.textContent = label;
  const input = document.createElement('input');
  input.dataset.field = field; input.value = value ?? ''; input.placeholder = placeholder;
  input.className = `${inputCls} h-10`;
  if (field === 'url') input.type = 'url';
  wrap.append(input);
  return wrap;
}
function addRef(r: Partial<Ref> = {}) {
  const li = document.createElement('li');
  li.className = 'flex flex-col gap-2 rounded-[8px] border border-line p-3';
  if (r.id) li.dataset.id = String(r.id);
  const head = document.createElement('div');
  head.className = 'flex items-center justify-between gap-2';
  const num = document.createElement('span'); num.className = 'ref-num font-mono text-xs text-muted tabular-nums';
  const tools = document.createElement('span'); tools.className = 'flex gap-1';
  for (const [act, glyph, name] of [['up', '↑', 'Subir'], ['down', '↓', 'Descer'], ['remove', '✕', 'Remover referência']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.act = act; b.textContent = glyph; b.setAttribute('aria-label', name); b.title = name;
    b.className = 'grid size-8 cursor-pointer place-items-center rounded-[4px] text-[13px] text-muted hover:bg-[#141414] hover:text-ink';
    tools.append(b);
  }
  head.append(num, tools);
  const type = document.createElement('label');
  type.className = 'flex flex-col gap-1 text-xs text-muted';
  type.textContent = 'Tipo de fonte';
  const sel = document.createElement('select');
  sel.dataset.field = 'sourceType'; sel.className = `${inputCls} h-10`;
  sel.append(new Option('Sem tipo', ''), ...sourceTypes.map((t) => new Option(t, t)));
  sel.value = r.sourceType ?? '';
  type.append(sel);
  const pair = document.createElement('div'); pair.className = 'grid grid-cols-2 gap-2';
  pair.append(refInput('publishedOn', 'Publicado em', r.publishedOn ?? null, '2024'), refInput('accessedOn', 'Acessado em', r.accessedOn ?? null, '12/11/2026'));
  li.append(head, refInput('title', 'Título *', r.title ?? null), refInput('author', 'Autor', r.author ?? null), refInput('url', 'Link', r.url ?? null, 'https://'),
    type, refInput('publisher', 'Editora ou instituição', r.publisher ?? null), pair);
  refList.append(li);
  renumberRefs();
  return li;
}
function renumberRefs() {
  [...refList.children].forEach((li, i) => { li.querySelector('.ref-num')!.textContent = `#${i + 1}`; });
}
function collectRefs(): Ref[] {
  return [...refList.querySelectorAll<HTMLElement>('li')].map((li) => {
    const v = (k: string) => (li.querySelector<HTMLInputElement>(`[data-field="${k}"]`)?.value.trim() || null);
    return { id: li.dataset.id ? Number(li.dataset.id) : null, title: v('title') ?? '', author: v('author'), url: v('url'), sourceType: v('sourceType'), publisher: v('publisher'), publishedOn: v('publishedOn'), accessedOn: v('accessedOn') };
  });
}
refList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
  if (!b) return;
  const li = b.closest('li')!;
  if (b.dataset.act === 'remove') li.remove();
  if (b.dataset.act === 'up' && li.previousElementSibling) li.previousElementSibling.before(li);
  if (b.dataset.act === 'down' && li.nextElementSibling) li.nextElementSibling.after(li);
  renumberRefs(); markDirty();
});
$('#addRef').addEventListener('click', () => { addRef().querySelector<HTMLInputElement>('[data-field="title"]')!.focus(); markDirty(); });
for (const r of (data.draft.references ?? []) as Ref[]) addRef(r);

// ---------- anexos (PDF) ----------
const attList = $('#attList');
function addAttachment(m: Media) {
  if (attList.querySelector(`[data-id="${m.id}"]`)) return;
  const li = document.createElement('li');
  li.dataset.id = m.id;
  li.className = 'flex items-center justify-between gap-2 border-t border-line py-2.5 text-[13px] last:border-b';
  const a = document.createElement('a');
  a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'min-w-0 truncate hover:text-lime';
  a.textContent = `${m.alt ?? 'Arquivo sem título'}${m.size ? ` · ${kb(m.size)}` : ''}`;
  const rm = document.createElement('button');
  rm.type = 'button'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remover anexo'); rm.title = 'Remover anexo';
  rm.className = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-[4px] text-[13px] text-muted hover:bg-[#141414] hover:text-ink';
  rm.addEventListener('click', () => { li.remove(); markDirty(); });
  li.append(a, rm);
  attList.append(li);
}
$('#addAtt').addEventListener('click', () => openMedia('attachment'));
for (const m of (data.attachments ?? []) as Media[]) addAttachment(m);

// ---------- publicações relacionadas ----------
const relList = $('#relList'), relPick = $<HTMLSelectElement>('#relPick');
const kinds: [string, string][] = [['related', 'Relacionada'], ['origin', 'Deu origem a esta'], ['documents', 'Documenta esta'], ['continues', 'Continuação']];
function addRel(postId: string, kind = 'related') {
  const p = data.posts.find((x) => x.id === postId);
  if (!p || relList.querySelector(`[data-post="${postId}"]`)) return;
  const li = document.createElement('li');
  li.dataset.post = postId;
  li.className = 'flex flex-col gap-2 border-t border-line py-3 last:border-b';
  const row = document.createElement('div'); row.className = 'flex items-start justify-between gap-2';
  const name = document.createElement('span'); name.className = 'min-w-0 text-[13px]';
  name.textContent = [p.code, p.title || 'Sem título'].filter(Boolean).join(' · ');
  const rm = document.createElement('button');
  rm.type = 'button'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remover ligação'); rm.title = 'Remover ligação';
  rm.className = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-[4px] text-[13px] text-muted hover:bg-[#141414] hover:text-ink';
  rm.addEventListener('click', () => { li.remove(); markDirty(); });
  row.append(name, rm);
  const sel = document.createElement('select');
  sel.className = `${inputCls} h-9`; sel.setAttribute('aria-label', 'Tipo de ligação');
  sel.append(...kinds.map(([v, t]) => new Option(t, v)));
  sel.value = kind;
  li.append(row, sel);
  relList.append(li);
}
$('#addRel').addEventListener('click', () => { if (relPick.value) { addRel(relPick.value); relPick.value = ''; markDirty(); } });
for (const r of (data.draft.relations ?? []) as { postId: string; kind: string }[]) addRel(r.postId, r.kind);

// ---------- comparar versões ----------
// Compara a versão escolhida com a última salva: campos que mudaram e o corpo linha a linha
const diffDialog = $<HTMLDialogElement>('#diffDialog'), diffBody = $('#diffBody');
$('#diffClose').addEventListener('click', () => diffDialog.close());
type Snap = Record<string, any>;
const nameOf = (list: { id: number; name: string }[] | undefined, id: unknown) => list?.find((x) => x.id === id)?.name ?? (id == null ? '' : String(id));
const statusNames: Record<string, string> = { idea: 'Ideia', draft: 'Rascunho', review: 'Revisão', scheduled: 'Agendado', published: 'Publicado', archived: 'Arquivado' };
const fields: [string, (s: Snap) => string][] = [
  ['Título', (s) => s.title ?? ''], ['Resumo', (s) => s.summary ?? ''], ['Status', (s) => statusNames[s.status] ?? s.status ?? ''],
  ['Departamento', (s) => nameOf(data.departments, s.departmentId)], ['Tipo de conteúdo', (s) => nameOf(data.contentTypes, s.contentTypeId)],
  ['Código', (s) => s.code ?? ''], ['Endereço', (s) => s.slug ?? ''], ['Estágio', (s) => s.stage ?? ''], ['Nível', (s) => s.level ?? ''], ['Formato', (s) => s.format ?? ''],
  ['Assuntos', (s) => (s.areaIds ?? []).map((id: number) => nameOf(data.areas, id)).join(', ')], ['Tags', (s) => (s.tags ?? []).join(', ')],
  ['Projeto relacionado', (s) => s.relatedProject ?? ''], ['Metodologia', (s) => s.methodology ?? ''], ['Uso de IA', (s) => s.aiAssistance ?? ''],
  ['Capa', (s) => (s.coverMediaId ? 'com capa' : 'sem capa')], ['Título no Google', (s) => s.seo?.metaTitle ?? ''], ['Descrição no Google', (s) => s.seo?.metaDescription ?? ''],
  ['URL canônica', (s) => s.seo?.canonicalUrl ?? ''], ['Fora do Google', (s) => (s.seo?.noindex ? 'sim' : 'não')],
  ['Referências', (s) => (s.references ?? []).map((r: Snap) => r.title).join(' · ')], ['Anexos', (s) => String((s.attachments ?? []).length)],
  ['Relacionadas', (s) => (s.relations ?? []).map((r: Snap) => data.posts.find((p) => p.id === r.postId)?.title ?? '?').join(' · ')],
];

// diferença linha a linha (maior subsequência comum); textos muito longos caem numa comparação simples
function diffLines(a: string[], b: string[]): [string, string][] {
  if (a.length * b.length > 4_000_000) return [...a.map((l) => ['-', l] as [string, string]), ...b.map((l) => ['+', l] as [string, string])];
  const n = a.length, m = b.length, w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out: [string, string][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push(['-', a[i++]]);
    else out.push(['+', b[j++]]);
  }
  while (i < n) out.push(['-', a[i++]]);
  while (j < m) out.push(['+', b[j++]]);
  return out;
}

async function openDiff(revId: number) {
  const newest = Number(revList.querySelector('li')?.dataset.rev ?? 0);
  diffBody.textContent = 'Carregando…';
  $('#diffTitle').textContent = `Versão #${revId} → atual (#${newest})`;
  diffDialog.showModal();
  try {
    const [oldRes, newRes] = await Promise.all([fetch(`/api/posts/${postId}/revisions/${revId}`), fetch(`/api/posts/${postId}/revisions/${newest}`)]);
    if (!oldRes.ok || !newRes.ok) throw new Error();
    const a = (await oldRes.json()).snapshot as Snap, b = (await newRes.json()).snapshot as Snap;
    diffBody.replaceChildren();
    if (dirty) {
      const p = document.createElement('p'); p.className = 'm-0 text-[13px] text-[#ffd34d]';
      p.textContent = 'Você tem alterações não salvas: a comparação usa a última versão salva.';
      diffBody.append(p);
    }
    const changed = fields.filter(([, get]) => get(a) !== get(b));
    const sec = document.createElement('section'); sec.className = 'flex flex-col gap-2';
    const h = document.createElement('h3'); h.className = 'label-ui m-0 text-[11px] text-muted'; h.textContent = 'Campos';
    sec.append(h);
    if (!changed.length) { const p = document.createElement('p'); p.className = 'm-0 text-muted'; p.textContent = 'Nenhum campo mudou.'; sec.append(p); }
    else {
      const dl = document.createElement('dl'); dl.className = 'm-0 grid gap-x-4 gap-y-3 sm:grid-cols-[160px_1fr]';
      for (const [label, get] of changed) {
        const dt = document.createElement('dt'); dt.className = 'text-[13px] text-muted'; dt.textContent = label;
        const dd = document.createElement('dd'); dd.className = 'm-0 flex flex-col gap-1';
        const was = document.createElement('span'); was.className = 'diff-line rounded-[4px]'; was.dataset.op = '-'; was.textContent = get(a) || '(vazio)';
        const now = document.createElement('span'); now.className = 'diff-line rounded-[4px]'; now.dataset.op = '+'; now.textContent = get(b) || '(vazio)';
        dd.append(was, now); dl.append(dt, dd);
      }
      sec.append(dl);
    }
    diffBody.append(sec);
    const body = document.createElement('section'); body.className = 'flex flex-col gap-2';
    const h2 = document.createElement('h3'); h2.className = 'label-ui m-0 text-[11px] text-muted'; h2.textContent = 'Texto';
    body.append(h2);
    const ops = diffLines(String(a.body ?? '').split('\n'), String(b.body ?? '').split('\n'));
    if (ops.every(([op]) => op === ' ')) { const p = document.createElement('p'); p.className = 'm-0 text-muted'; p.textContent = 'O texto não mudou.'; body.append(p); }
    else {
      const box = document.createElement('div'); box.className = 'overflow-hidden rounded-[6px] border border-line py-1';
      // mostra só os trechos alterados, com 2 linhas de contexto
      const keep = ops.map((_, k) => ops.slice(Math.max(0, k - 2), k + 3).some(([op]) => op !== ' '));
      let skipped = false;
      ops.forEach(([op, line], k) => {
        if (!keep[k]) { if (!skipped) { const d = document.createElement('div'); d.className = 'diff-line'; d.dataset.op = '…'; d.textContent = '…'; box.append(d); } skipped = true; return; }
        skipped = false;
        const d = document.createElement('div'); d.className = 'diff-line'; d.dataset.op = op; d.textContent = `${op === ' ' ? ' ' : op} ${line}`;
        box.append(d);
      });
      body.append(box);
    }
    diffBody.append(body);
  } catch {
    diffBody.textContent = 'Não deu para carregar as versões. Tente de novo.';
  }
}

// ---------- duplicar ----------
document.getElementById('duplicatePost')?.addEventListener('click', async () => {
  if (dirty && !confirm('A cópia usa a versão salva. Você tem alterações não salvas que não vão para a cópia. Continuar?')) return;
  setState('Duplicando…');
  const res = await fetch(`/api/posts/${postId}/duplicate`, { method: 'POST' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { setState(out.error ?? 'Não deu para duplicar.', 'error'); return; }
  dirty = false;
  location.href = `/admin/publicacoes/${out.id}/`;
});

// ---------- exclusão ----------
document.getElementById('deletePost')?.addEventListener('click', async () => {
  const title = plain(titleEl) || 'esta publicação';
  if (!confirm(`Excluir "${title}" de vez? As versões e as ligações também somem, e não dá para desfazer.`)) return;
  const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { setState(out.error ?? 'Não deu para excluir.', 'error'); return; }
  dirty = false;
  location.href = '/admin/publicacoes/';
});

// ---------- pré-visualização ----------
// A prévia mostra o que está salvo: com alterações pendentes, salva antes. A aba abre já no clique (senão o navegador bloqueia).
$('#previewBtn').addEventListener('click', async () => {
  const tab = window.open('', '_blank');
  if (dirty || !postId) await save();
  if (!postId || dirty) { tab?.close(); return; }
  const url = `/admin/publicacoes/${postId}/previa/`;
  if (tab) tab.location.href = url; else location.href = url;
});

renderCover();
refreshDerived();
syncToolbar();
if (!postId) titleEl.focus();
