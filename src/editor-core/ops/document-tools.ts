// B3 · Página, revisão, segurança, formulários e mala direta (o que faltava em relação ao Word).
//   Página:     SET_WATERMARK · SET_PAGE_BORDER · SET_PAGE_NUMBERING · SET_LINE_NUMBERS · SET_HYPHENATION
//               (margens espelhadas, medianiz e alinhamento vertical entram em SET_PAGE — ver page.ts)
//   Revisão:    AUTOCORRECT_RULES · ADD_AUTOCORRECT · REMOVE_AUTOCORRECT · AUTOCORRECT_TEXT · AUTOCORRECT_DOCUMENT · THESAURUS · ADD_SYNONYMS
//   Segurança:  PROTECT_DOCUMENT · UNPROTECT_DOCUMENT · MARK_FINAL · INSPECT_DOCUMENT · REMOVE_PERSONAL_INFO
//   Formulário: INSERT_FORM_FIELD · SET_FORM_VALUE · FORM_DATA · VALIDATE_FORM
//   Mala direta: SET_MERGE_SOURCE · INSERT_MERGE_FIELD · MERGE_PREVIEW · MERGE_RUN
import type { DocumentModel, EditorNode } from '../types.ts';
import type { CommitHook, Engine, Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';
import { createNode } from './basic.ts';
import { textOf } from './text.ts';
import { NUMBER_FORMATS, formatNumber, type NumberFormat } from './word.ts';

const settings = (e: Engine) => (e.touch('document', 'info') as any).settings as Record<string, any>;
const readSettings = (e: Engine) => e.doc.document.settings as Record<string, any>;
const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

// ---------------------------------------------------------------- SHA-256 (proteção por senha sem depender do navegador)
const K = Array.from({ length: 64 }, (_, i) => {
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
  return Math.floor(Math.abs(Math.cbrt(primes[i]) % 1) * 2 ** 32) >>> 0;
});
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
  const view = new DataView(m.buffer); view.setUint32(total - 4, (len * 8) >>> 0); view.setUint32(total - 8, Math.floor(len / 2 ** 29));
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, f, g, h, k] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(f, 6) ^ rotr(f, 11) ^ rotr(f, 25)) + ((f & g) ^ (~f & h)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = h; h = g; g = f; f = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, f, g, h, k].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return H.map((v) => v.toString(16).padStart(8, '0')).join('');
}
/** Senha guardada só como resumo com sal (e repetido para atrasar tentativas). */
function hashPassword(password: string, salt: string) {
  let h = `${salt}:${password}`;
  for (let i = 0; i < 1000; i++) h = sha256(h);
  return h;
}

// ---------------------------------------------------------------- proteção
export const PROTECTION_MODES = ['READ_ONLY', 'COMMENTS', 'TRACKED_CHANGES', 'FORMS'] as const;
const ALWAYS = new Set(['PROTECT_DOCUMENT', 'UNPROTECT_DOCUMENT', 'MARK_FINAL', 'SELECT', 'DESELECT', 'CLEAR_SELECTION', 'SELECT_ALL', 'SELECT_AREA', 'SET_VIEW', 'GO_TO', 'NAVIGATE', 'MERGE_PREVIEW']);
/** Bloqueia o que a proteção (ou "marcar como final") não deixa fazer. Vem antes das permissões. */
export const protectionHook: CommitHook = (e, { type, changes, remote }) => {
  if (remote || ALWAYS.has(type)) return;
  const s = readSettings(e);
  const docOnly = changes.every((c) => c.collection === 'document');
  if (s.final) fail('LOCKED', 'O documento foi marcado como final. Desmarque para editar.');
  const p = s.protection;
  if (!p) return;
  if (p.mode === 'READ_ONLY') fail('LOCKED', 'Documento protegido: só leitura.');
  if (p.mode === 'COMMENTS' && changes.some((c) => c.collection !== 'comments')) fail('LOCKED', 'Documento protegido: só comentários.');
  if (p.mode === 'FORMS' && type !== 'SET_FORM_VALUE' && !docOnly) fail('LOCKED', 'Documento protegido: só o preenchimento dos campos do formulário.');
  if (p.mode === 'TRACKED_CHANGES' && ['SET_TRACK_CHANGES', 'ACCEPT_CHANGE', 'REJECT_CHANGE'].includes(type)) fail('LOCKED', 'Documento protegido: as alterações continuam sendo controladas.');
};
export function installProtection(e: Engine) { e.commitHooks.unshift(protectionHook); }

// ---------------------------------------------------------------- autocorreção e sinônimos
export const DEFAULT_AUTOCORRECT: [string, string][] = [
  ['(c)', '©'], ['(r)', '®'], ['(tm)', '™'], ['--', '—'], ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['...', '…'], ['1/2', '½'], ['1/4', '¼'], ['3/4', '¾'],
  ['vc', 'você'], ['vcs', 'vocês'], ['tb', 'também'], ['tbm', 'também'], ['pq', 'porque'], ['q', 'que'], ['naõ', 'não'], ['nao', 'não'], ['entao', 'então'], ['voce', 'você'],
  ['tambem', 'também'], ['ja', 'já'], ['ate', 'até'], ['agua', 'água'], ['informacao', 'informação'], ['analise', 'análise'], ['numero', 'número'], ['codigo', 'código'], ['pagina', 'página'],
];
/** Corrige um trecho: regras da lista (palavra inteira), DUas MAiúsculas, início de frase e "i" sozinho não existe em pt-BR. */
export function autocorrect(text: string, rules: [string, string][], opts: { capitalize?: boolean; twoCaps?: boolean } = {}) {
  let out = text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [from, to] of [...rules].sort((a, b) => b[0].length - a[0].length)) {
    const word = /^[\p{L}\d]+$/u.test(from);
    const re = word ? new RegExp(`(?<![\\p{L}\\d])${esc(from)}(?![\\p{L}\\d])`, 'gu') : new RegExp(esc(from), 'g');
    out = out.replace(re, (m) => (word && m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));
  }
  if (opts.twoCaps !== false) out = out.replace(/(?<![\p{L}])(\p{Lu})(\p{Lu})(\p{Ll}{2,})/gu, (_, a, b, rest) => a + b.toLowerCase() + rest);
  if (opts.capitalize !== false) out = out.replace(/(^\s*|[.!?]\s+)(\p{Ll})/gu, (_, sp, c) => sp + c.toUpperCase());
  return out;
}
/** Dicionário de sinônimos de base (pt-BR); o documento pode acrescentar os seus (ADD_SYNONYMS). */
export const THESAURUS_PT: Record<string, string[]> = {
  bom: ['ótimo', 'excelente', 'adequado', 'positivo'], ruim: ['mau', 'péssimo', 'inadequado', 'negativo'], grande: ['amplo', 'extenso', 'enorme', 'vasto'], pequeno: ['reduzido', 'curto', 'diminuto', 'menor'],
  rápido: ['ágil', 'veloz', 'ligeiro', 'célere'], lento: ['vagaroso', 'demorado', 'moroso'], importante: ['relevante', 'essencial', 'fundamental', 'significativo'], difícil: ['complexo', 'árduo', 'complicado', 'trabalhoso'],
  fácil: ['simples', 'acessível', 'descomplicado'], novo: ['recente', 'inédito', 'atual', 'moderno'], antigo: ['velho', 'anterior', 'tradicional'], bonito: ['belo', 'atraente', 'elegante'],
  mostrar: ['exibir', 'apresentar', 'demonstrar', 'evidenciar'], fazer: ['realizar', 'executar', 'produzir', 'elaborar'], usar: ['utilizar', 'empregar', 'aplicar'], ajudar: ['auxiliar', 'apoiar', 'colaborar'],
  começar: ['iniciar', 'principiar', 'dar início'], terminar: ['concluir', 'finalizar', 'encerrar'], melhorar: ['aprimorar', 'aperfeiçoar', 'otimizar'], aumentar: ['ampliar', 'elevar', 'expandir'],
  diminuir: ['reduzir', 'baixar', 'encolher'], problema: ['dificuldade', 'questão', 'obstáculo', 'falha'], solução: ['resposta', 'saída', 'resolução'], objetivo: ['meta', 'propósito', 'finalidade', 'alvo'],
  resultado: ['efeito', 'consequência', 'desfecho', 'produto'], análise: ['exame', 'estudo', 'avaliação'], ideia: ['conceito', 'noção', 'proposta'], empresa: ['companhia', 'organização', 'firma'],
  cliente: ['consumidor', 'comprador', 'usuário'], dizer: ['afirmar', 'declarar', 'falar', 'mencionar'], pensar: ['refletir', 'considerar', 'ponderar'], muito: ['bastante', 'demais', 'extremamente'],
  pouco: ['escasso', 'insuficiente', 'reduzido'], claro: ['evidente', 'nítido', 'óbvio', 'transparente'], certo: ['correto', 'exato', 'preciso'], errado: ['incorreto', 'equivocado', 'inexato'],
  feliz: ['contente', 'alegre', 'satisfeito'], triste: ['abatido', 'desanimado', 'melancólico'], forte: ['robusto', 'resistente', 'intenso'], fraco: ['frágil', 'débil', 'tênue'],
  principal: ['central', 'essencial', 'primordial'], exemplo: ['caso', 'modelo', 'amostra'], parte: ['porção', 'trecho', 'fração', 'seção'], forma: ['maneira', 'modo', 'jeito', 'formato'],
  mudar: ['alterar', 'modificar', 'transformar'], criar: ['gerar', 'produzir', 'conceber', 'desenvolver'], precisar: ['necessitar', 'carecer', 'requerer'], conseguir: ['obter', 'alcançar', 'atingir'],
};

// ---------------------------------------------------------------- formulários e mala direta
export const FORM_TYPES = ['TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'DROPDOWN'] as const;
const fieldsOf = (e: Engine, kind: 'FORM' | 'MERGE') => Object.values(e.doc.nodes).filter((n) => n.type === 'FIELD' && n.data.fieldType === kind);
function checkFormValue(d: Record<string, any>, v: unknown) {
  if (v === null || v === '') return v === '' && d.formType !== 'CHECKBOX' ? '' : null;
  switch (d.formType) {
    case 'CHECKBOX': if (typeof v !== 'boolean') fail('VALIDATION', `${d.label || d.name}: marque ou desmarque (true/false).`); return v;
    case 'NUMBER': { const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) fail('VALIDATION', `${d.label || d.name}: precisa ser um número.`); if (d.min !== undefined && n < d.min) fail('VALIDATION', `${d.label || d.name}: mínimo ${d.min}.`); if (d.max !== undefined && n > d.max) fail('VALIDATION', `${d.label || d.name}: máximo ${d.max}.`); return n; }
    case 'DATE': { const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail('VALIDATION', `${d.label || d.name}: data no formato AAAA-MM-DD.`); return s; }
    case 'DROPDOWN': if (!d.options.includes(String(v))) fail('VALIDATION', `${d.label || d.name}: escolha uma das opções (${d.options.join(', ')}).`); return String(v);
    default: { const s = String(v); if (d.maxLength && s.length > d.maxLength) fail('VALIDATION', `${d.label || d.name}: até ${d.maxLength} caracteres.`); if (d.pattern && !new RegExp(d.pattern).test(s)) fail('VALIDATION', `${d.label || d.name}: formato inválido.`); return s; }
  }
}
/** Texto que o campo mostra (formulário: valor ou o rótulo vazio; mala direta: valor do registro em pré-visualização ou «campo»). */
export function formFieldText(e: Engine, n: EditorNode) {
  const d = n.data;
  if (d.fieldType === 'FORM') {
    if (d.formType === 'CHECKBOX') return d.value ? '☒' : '☐';
    if (d.value === null || d.value === undefined || d.value === '') return d.placeholder ?? `[${d.label || d.name}]`;
    if (d.formType === 'DATE') { const [y, m, dd] = String(d.value).split('-'); return `${dd}/${m}/${y}`; }
    return String(d.value);
  }
  const m = readSettings(e).mailMerge;
  const rec = m?.preview != null ? m.rows?.[m.preview] : null;
  return rec ? String(rec[d.name] ?? '') : `«${d.name}»`;
}
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c !== '')) rows.push(row);
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export const documentToolHandlers: Record<string, Handler> = {
  // ---------------------------------------------------------------- página
  /** Marca d'água: SET_WATERMARK { text, color, opacity, diagonal, fontSize } | { assetId, opacity, washout } | null. */
  SET_WATERMARK: (e, op) => {
    const p = op.payload;
    const s = settings(e);
    if (p === null || p === undefined) { delete s.watermark; return null; }
    if (!p.text && !p.assetId) fail('VALIDATION', 'Marca d\'água: texto (ex.: CONFIDENCIAL) ou imagem (assetId).');
    if (p.assetId && !e.doc.assets[p.assetId]) fail('NOT_FOUND', `Imagem ${p.assetId} não existe.`);
    if (p.color && !COLOR.test(p.color)) fail('VALIDATION', 'Cor da marca d\'água: #RRGGBB.');
    const opacity = p.opacity ?? 0.15;
    if (typeof opacity !== 'number' || opacity <= 0 || opacity > 1) fail('VALIDATION', 'Transparência da marca d\'água: de 0 a 1.');
    s.watermark = p.text ? { text: String(p.text).slice(0, 60), color: p.color ?? '#C0C0C0', opacity, diagonal: p.diagonal !== false, fontSize: p.fontSize ?? 72 } : { assetId: p.assetId, opacity, washout: p.washout !== false };
    return s.watermark;
  },

  /** Borda da página: SET_PAGE_BORDER { style: SOLID|DOUBLE|DASHED|DOTTED, width, color, offset, pages: ALL|FIRST|NOT_FIRST } | null. */
  SET_PAGE_BORDER: (e, op) => {
    const p = op.payload;
    const s = settings(e);
    if (p === null || p === undefined) { delete s.pageBorder; return null; }
    if (!['SOLID', 'DOUBLE', 'DASHED', 'DOTTED', 'SHADOW', 'THREE_D'].includes(p.style ?? 'SOLID')) fail('VALIDATION', 'Estilo da borda: SOLID, DOUBLE, DASHED, DOTTED, SHADOW ou THREE_D.');
    if (p.color && !COLOR.test(p.color)) fail('VALIDATION', 'Cor da borda: #RRGGBB.');
    const width = p.width ?? 1;
    if (typeof width !== 'number' || width <= 0 || width > 31) fail('VALIDATION', 'Espessura da borda: de 0,25 a 31 pt.');
    if (p.pages && !['ALL', 'FIRST', 'NOT_FIRST'].includes(p.pages)) fail('VALIDATION', 'Páginas: ALL, FIRST ou NOT_FIRST.');
    s.pageBorder = { style: p.style ?? 'SOLID', width, color: p.color ?? '#000000', offset: p.offset ?? 24, pages: p.pages ?? 'ALL' };
    return s.pageBorder;
  },

  /** Numeração de páginas: SET_PAGE_NUMBERING { format: DECIMAL|LOWER_ROMAN|UPPER_ROMAN|LOWER_ALPHA…, start, chapterPrefix? } por documento ou seção (targetId). */
  SET_PAGE_NUMBERING: (e, op) => {
    const p = op.payload ?? {};
    if (p.format && !NUMBER_FORMATS.includes(p.format)) fail('VALIDATION', `Formato: ${NUMBER_FORMATS.join(', ')}.`);
    if (p.start !== undefined && !(Number.isInteger(p.start) && p.start >= 0)) fail('VALIDATION', 'Começar em: número inteiro ≥ 0.');
    const value = { format: (p.format ?? 'DECIMAL') as NumberFormat, start: p.start ?? null, chapterPrefix: p.chapterPrefix ?? null };
    if (op.targetId) {
      const sec = e.get(op.targetId);
      if (sec.type !== 'SECTION') fail('INVALID_OPERATION', 'A numeração vale para o documento ou para uma seção.');
      e.touchNode(sec.id).data.pageNumbering = value;
    } else settings(e).pageNumbering = value;
    return { ...value, sample: [1, 2, 3].map((n) => formatNumber((value.start ?? 1) + n - 1, value.format)) };
  },

  /** Números de linha: SET_LINE_NUMBERS { countBy, start, restart: PAGE|SECTION|CONTINUOUS, distance } | null. */
  SET_LINE_NUMBERS: (e, op) => {
    const p = op.payload;
    const s = settings(e);
    if (p === null || p === undefined) { delete s.lineNumbers; return null; }
    if (p.restart && !['PAGE', 'SECTION', 'CONTINUOUS'].includes(p.restart)) fail('VALIDATION', 'Reiniciar: PAGE, SECTION ou CONTINUOUS.');
    if (p.countBy !== undefined && !(Number.isInteger(p.countBy) && p.countBy >= 1 && p.countBy <= 100)) fail('VALIDATION', 'Contar de: 1 a 100.');
    s.lineNumbers = { countBy: p.countBy ?? 1, start: p.start ?? 1, restart: p.restart ?? 'PAGE', distance: p.distance ?? 18 };
    return s.lineNumbers;
  },

  /** Hifenização: SET_HYPHENATION { auto, zone, limit (hífens seguidos), caps } */
  SET_HYPHENATION: (e, op) => {
    const p = op.payload ?? {};
    const s = settings(e);
    s.hyphenation = { auto: Boolean(p.auto ?? true), zone: p.zone ?? 18, limit: p.limit ?? 0, caps: Boolean(p.caps ?? true) };
    return s.hyphenation;
  },

  // ---------------------------------------------------------------- revisão
  AUTOCORRECT_RULES: (e) => {
    const s = readSettings(e).autocorrect ?? {};
    const removed = new Set<string>(s.removed ?? []);
    return [...DEFAULT_AUTOCORRECT.filter(([f]) => !removed.has(f)), ...Object.entries<string>(s.custom ?? {})];
  },
  ADD_AUTOCORRECT: (e, op) => {
    const { from, to } = op.payload ?? {};
    if (!from || typeof to !== 'string' || /\s/.test(from)) fail('VALIDATION', 'Autocorreção: "from" (sem espaços) e "to".');
    const s = settings(e); s.autocorrect = { ...(s.autocorrect ?? {}), custom: { ...(s.autocorrect?.custom ?? {}), [from]: to } };
    return s.autocorrect.custom;
  },
  REMOVE_AUTOCORRECT: (e, op) => {
    const from = op.payload?.from;
    const s = settings(e); const a = { custom: { ...(s.autocorrect?.custom ?? {}) }, removed: [...(s.autocorrect?.removed ?? [])] };
    if (from in a.custom) delete a.custom[from]; else if (DEFAULT_AUTOCORRECT.some(([f]) => f === from)) a.removed.push(from); else fail('NOT_FOUND', `Não há regra para "${from}".`);
    s.autocorrect = a;
    return true;
  },
  /** Corrige um texto com as regras do documento (a interface chama a cada espaço/pontuação). */
  AUTOCORRECT_TEXT: (e, op) => autocorrect(String(op.payload?.text ?? ''), e.run({ type: 'AUTOCORRECT_RULES' }) as [string, string][], op.payload ?? {}),
  /** Aplica a autocorreção a todos os parágrafos; devolve quantos mudaram. */
  AUTOCORRECT_DOCUMENT: (e, op) => {
    const rules = documentToolHandlers.AUTOCORRECT_RULES(e, { type: 'AUTOCORRECT_RULES' }) as [string, string][];
    let changed = 0;
    for (const n of Object.values(e.doc.nodes)) {
      if (n.type !== 'TEXT' || e.isLocked(n.id)) continue;
      const runs = n.data.runs as { text: string }[];
      const fixed = runs.map((r, i) => autocorrect(r.text, rules, { ...(op.payload ?? {}), capitalize: i === 0 && op.payload?.capitalize !== false }));
      if (fixed.some((t, i) => t !== runs[i].text)) { const t = e.touchNode(n.id); t.data.runs.forEach((r: any, i: number) => { r.text = fixed[i]; }); changed++; }
    }
    return changed;
  },
  /** Sinônimos de uma palavra (dicionário de base + os do documento). */
  THESAURUS: (e, op) => {
    const w = String(op.payload?.word ?? '').trim().toLocaleLowerCase('pt-BR');
    if (!w) fail('INVALID_PAYLOAD', 'Informe a palavra.');
    const own = readSettings(e).synonyms ?? {};
    const direct = [...(own[w] ?? []), ...(THESAURUS_PT[w] ?? [])];
    // também acha quem tem a palavra como sinônimo (sinônimo é de mão dupla)
    const reverse = Object.entries({ ...THESAURUS_PT, ...own }).filter(([, list]) => (list as string[]).includes(w)).flatMap(([k, list]) => [k, ...(list as string[]).filter((x) => x !== w)]);
    return [...new Set([...direct, ...reverse])];
  },
  ADD_SYNONYMS: (e, op) => {
    const { word, synonyms } = op.payload ?? {};
    if (!word || !Array.isArray(synonyms) || !synonyms.length) fail('VALIDATION', 'Informe word e synonyms (lista).');
    const s = settings(e); s.synonyms = { ...(s.synonyms ?? {}), [String(word).toLocaleLowerCase('pt-BR')]: synonyms.map(String) };
    return s.synonyms[String(word).toLocaleLowerCase('pt-BR')];
  },

  // ---------------------------------------------------------------- segurança
  /** Restringe a edição com senha: PROTECT_DOCUMENT { mode: READ_ONLY|COMMENTS|TRACKED_CHANGES|FORMS, password? }. */
  PROTECT_DOCUMENT: (e, op) => {
    const { mode, password } = op.payload ?? {};
    if (!PROTECTION_MODES.includes(mode)) fail('VALIDATION', `Proteção: ${PROTECTION_MODES.join(', ')}.`);
    if (readSettings(e).protection) fail('INVALID_OPERATION', 'O documento já está protegido. Desproteja antes de trocar.');
    if (password !== undefined && (typeof password !== 'string' || password.length < 4)) fail('VALIDATION', 'A senha precisa ter pelo menos 4 caracteres.');
    const s = settings(e);
    const salt = e.newId('SALT');
    s.protection = { mode, ...(password ? { salt, hash: hashPassword(password, salt) } : {}), at: new Date().toISOString(), by: e.user?.id ?? null };
    if (mode === 'TRACKED_CHANGES') s.trackChanges = true;
    return { mode, hasPassword: Boolean(password) };
  },
  UNPROTECT_DOCUMENT: (e, op) => {
    const p = readSettings(e).protection;
    if (!p) return false;
    if (p.hash && hashPassword(String(op.payload?.password ?? ''), p.salt) !== p.hash) fail('PERMISSION_DENIED', 'Senha incorreta.');
    delete settings(e).protection;
    return true;
  },
  /** "Marcar como final": avisa e bloqueia a edição até ser desmarcado. */
  MARK_FINAL: (e, op) => {
    const s = settings(e);
    s.final = op.payload?.final !== false;
    if (s.final) s.status = 'FINAL';
    return s.final;
  },
  /** Inspecionar documento: o que há de oculto ou pessoal antes de compartilhar. */
  INSPECT_DOCUMENT: (e) => {
    const nodes = Object.values(e.doc.nodes);
    const s = readSettings(e);
    const authors = new Set<string>();
    for (const n of nodes) { if (n.metadata.createdBy) authors.add(String(n.metadata.createdBy)); if (n.metadata.updatedBy) authors.add(String(n.metadata.updatedBy)); }
    for (const c of Object.values<any>(e.doc.comments ?? {})) for (const m of [c, ...(c.messages ?? []), ...(c.replies ?? [])]) if (m?.authorId) authors.add(String(m.authorId));
    return {
      comments: Object.keys(e.doc.comments ?? {}).length,
      trackedChanges: (s.changes ?? []).length ?? 0,
      hiddenText: nodes.filter((n) => n.styleOverrides.hidden || (n.data.runs ?? []).some((r: any) => r.format?.hidden)).length,
      hiddenObjects: nodes.filter((n) => n.metadata.hidden || n.metadata.visible === false).length,
      authors: [...authors],
      properties: { author: s.author ?? null, company: s.company ?? null, info: s.info ?? null },
      formFields: fieldsOf(e, 'FORM').length,
      mergeFields: fieldsOf(e, 'MERGE').length,
      protected: Boolean(s.protection), final: Boolean(s.final), watermark: Boolean(s.watermark),
    };
  },
  /** Remove nomes de autores e propriedades pessoais (comentários continuam, como "Autor"). */
  REMOVE_PERSONAL_INFO: (e) => {
    let count = 0;
    for (const n of Object.values(e.doc.nodes)) if (n.metadata.createdBy || n.metadata.updatedBy) { const t = e.touchNode(n.id); delete t.metadata.createdBy; delete t.metadata.updatedBy; count++; }
    for (const id of Object.keys(e.doc.comments ?? {})) {
      const c = e.touch('comments', id) as any;
      for (const m of [c, ...(c.messages ?? []), ...(c.replies ?? [])]) if (m?.authorId || m?.authorName) { m.authorId = 'autor'; m.authorName = 'Autor'; count++; }
    }
    const s = settings(e);
    for (const k of ['author', 'company', 'lastModifiedBy']) if (s[k]) { delete s[k]; count++; }
    if (s.info) { for (const k of ['author', 'company', 'manager']) delete s.info[k]; }
    return count;
  },

  // ---------------------------------------------------------------- formulários
  /** INSERT_FORM_FIELD { parentId, name, label, formType: TEXT|NUMBER|DATE|CHECKBOX|DROPDOWN, options?, required?, value?, placeholder?, min?, max?, maxLength?, pattern? } */
  INSERT_FORM_FIELD: (e, op) => {
    const p = op.payload ?? {};
    if (!FORM_TYPES.includes(p.formType)) fail('VALIDATION', `Tipo do campo: ${FORM_TYPES.join(', ')}.`);
    if (!p.name || !/^[\p{L}_][\p{L}\d_]*$/u.test(p.name)) fail('VALIDATION', 'Nome do campo: letras, números e _ (sem espaços).');
    if (fieldsOf(e, 'FORM').some((n) => n.data.name === p.name)) fail('VALIDATION', `Já existe um campo chamado ${p.name}.`);
    if (p.formType === 'DROPDOWN' && (!Array.isArray(p.options) || !p.options.length)) fail('VALIDATION', 'Lista suspensa precisa de opções.');
    if (p.pattern) { try { new RegExp(p.pattern); } catch { fail('VALIDATION', 'Padrão (pattern) inválido.'); } }
    const data: Record<string, any> = { fieldType: 'FORM', formType: p.formType, name: p.name, label: p.label ?? p.name, required: Boolean(p.required), options: p.options?.map(String), placeholder: p.placeholder, min: p.min, max: p.max, maxLength: p.maxLength, pattern: p.pattern, value: null };
    data.value = p.value !== undefined ? checkFormValue(data, p.value) : p.formType === 'CHECKBOX' ? false : null;
    const parentId = p.parentId ?? e.state.activeSurface ?? e.doc.document.rootId;
    return createNode(e, { parentId, nodeType: 'FIELD', data: JSON.parse(JSON.stringify(data)), layout: { mode: 'FLOW' }, index: p.index }).id;
  },
  /** Preenche um campo (por targetId ou name). Funciona também com o documento protegido para formulários. */
  SET_FORM_VALUE: (e, op) => {
    const n = op.targetId ? e.get(op.targetId) : fieldsOf(e, 'FORM').find((x) => x.data.name === op.payload?.name) ?? fail('NOT_FOUND', `Campo ${op.payload?.name} não existe.`);
    if (n.type !== 'FIELD' || n.data.fieldType !== 'FORM') fail('INVALID_OPERATION', `${n.id} não é um campo de formulário.`);
    const v = checkFormValue(n.data, op.payload?.value);
    e.touchNode(n.id).data.value = v;
    return v;
  },
  FORM_DATA: (e) => Object.fromEntries(fieldsOf(e, 'FORM').map((n) => [n.data.name, n.data.value ?? null])),
  /** Campos obrigatórios vazios. */
  VALIDATE_FORM: (e) => fieldsOf(e, 'FORM').filter((n) => n.data.required && (n.data.value === null || n.data.value === '' || n.data.value === false)).map((n) => ({ name: n.data.name, label: n.data.label, nodeId: n.id })),

  // ---------------------------------------------------------------- mala direta
  /** Fonte de dados: SET_MERGE_SOURCE { rows: [{ nome, email… }] } ou { csv: "nome;email\n…" }. */
  SET_MERGE_SOURCE: (e, op) => {
    const p = op.payload ?? {};
    const rows: Record<string, any>[] = p.csv ? parseCsv(String(p.csv)) : p.rows;
    if (!Array.isArray(rows) || !rows.length || rows.some((r) => typeof r !== 'object' || r === null)) fail('VALIDATION', 'Fonte de dados: lista de registros (rows) ou texto CSV com cabeçalho.');
    if (rows.length > 5000) fail('VALIDATION', 'Até 5000 registros por mala direta.');
    const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    settings(e).mailMerge = { rows: clone(rows), fields, preview: null };
    return { records: rows.length, fields };
  },
  /** Campo de mesclagem «nome»: INSERT_MERGE_FIELD { name, parentId?, index? }. */
  INSERT_MERGE_FIELD: (e, op) => {
    const name = String(op.payload?.name ?? '');
    const m = readSettings(e).mailMerge;
    if (!name) fail('INVALID_PAYLOAD', 'Informe o nome do campo.');
    if (m && !m.fields.includes(name)) fail('VALIDATION', `A fonte de dados não tem o campo ${name}. Campos: ${m.fields.join(', ')}.`);
    const parentId = op.payload?.parentId ?? e.state.activeSurface ?? e.doc.document.rootId;
    return createNode(e, { parentId, nodeType: 'FIELD', data: { fieldType: 'MERGE', name }, layout: { mode: 'FLOW' }, index: op.payload?.index }).id;
  },
  /** Mostra os dados de um registro no lugar dos campos (record: índice, ou null para voltar aos «nomes»). */
  MERGE_PREVIEW: (e, op) => {
    const m = readSettings(e).mailMerge ?? fail('INVALID_OPERATION', 'Defina a fonte de dados antes (SET_MERGE_SOURCE).');
    const r = op.payload?.record ?? null;
    if (r !== null && !(Number.isInteger(r) && r >= 0 && r < m.rows.length)) fail('VALIDATION', `Registro de 0 a ${m.rows.length - 1}.`);
    settings(e).mailMerge = { ...clone(m), preview: r };
    return r === null ? null : m.rows[r];
  },
  /**
   * Gera os documentos finais: um por registro (os campos viram texto de verdade). MERGE_RUN { filter?: { field, equals }, from?, to? }.
   * Devolve os documentos (modelos) — a interface/servidor salva, exporta em PDF ou junta num só.
   */
  MERGE_RUN: (e, op) => {
    const m = readSettings(e).mailMerge ?? fail('INVALID_OPERATION', 'Defina a fonte de dados antes (SET_MERGE_SOURCE).');
    const p = op.payload ?? {};
    let rows: Record<string, any>[] = m.rows.slice(p.from ?? 0, p.to === undefined ? undefined : p.to + 1);
    if (p.filter) rows = rows.filter((r) => String(r[p.filter.field] ?? '') === String(p.filter.equals));
    const base = clone(e.doc);
    const merged = rows.map((rec, i) => {
      const d: DocumentModel = clone(base);
      for (const n of Object.values(d.nodes)) if (n.type === 'FIELD' && n.data.fieldType === 'MERGE') {
        n.type = 'TEXT' as EditorNode['type'];
        n.data = { textType: 'PARAGRAPH', runs: [{ id: `RUN_MERGE_${n.id}`, text: String(rec[n.data.name] ?? ''), format: {} }] };
      }
      for (const n of Object.values(d.nodes)) if (Array.isArray(n.data.runs)) for (const r of n.data.runs) r.text = String(r.text).replace(/«([^»]+)»/g, (_, k) => String(rec[k] ?? ''));
      d.document.name = `${base.document.name} — ${i + 1}`;
      delete (d.document.settings as any).mailMerge;
      return d;
    });
    return { count: merged.length, documents: merged };
  },
};

/** Texto plano de um parágrafo com os campos de formulário/mala direta (para quem precisa só ler). */
export const plainWithFields = (e: Engine, n: EditorNode) => (n.type === 'FIELD' && ['FORM', 'MERGE'].includes(n.data.fieldType) ? formFieldText(e, n) : textOf(n));
