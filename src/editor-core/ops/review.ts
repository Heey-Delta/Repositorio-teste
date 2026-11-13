// Motor de revisão e validação (F12): ortografia, gramática, estilo, acessibilidade, consistência, fórmulas,
// tradução e estatísticas.
//
// Toda verificação devolve PROBLEMAS (issues) — nada é alterado até alguém aplicar uma sugestão:
//   { id, category, rule, severity: ERROR|WARNING|INFO, nodeId, cell?, start?, end?, text?, message, suggestions[] }
// O id é estável (regra + nó + texto + ocorrência), então "ignorar" sobrevive a edições em outros lugares.
//
// Ortografia: o dicionário completo é um provedor plugável (e.services.spellcheck — Hunspell/serviço na interface);
// sem ele, o motor ainda pega os erros comuns do português. Dicionário do documento: settings.dictionary.
// Tradução: provedor assíncrono (e.services.translate); o motor separa os trechos e aplica tudo numa transação só.
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { deleteText, insertText, textHandlers, textOf } from './text.ts';
import { tableHandlers } from './table.ts';
import { resolveStyle } from './format.ts';
import { paginate } from './page.ts';
import { clone, fail } from '../util.ts';

export type Category = 'SPELLING' | 'GRAMMAR' | 'STYLE' | 'ACCESSIBILITY' | 'CONSISTENCY' | 'FORMULA';
export type Severity = 'ERROR' | 'WARNING' | 'INFO';
export interface Issue { id: string; category: Category; rule: string; severity: Severity; nodeId: string; cell?: string; start?: number; end?: number; text?: string; message: string; suggestions: string[] }
export interface SpellProvider { check(word: string, lang: string): boolean; suggest?(word: string, lang: string): string[] }
export type TranslateProvider = (texts: string[], to: string, from?: string) => Promise<string[]>;

const CATEGORIES: Category[] = ['SPELLING', 'GRAMMAR', 'STYLE', 'ACCESSIBILITY', 'CONSISTENCY', 'FORMULA'];

// ---------------------------------------------------------------- dados do português

/** Erros frequentes (funcionam mesmo sem dicionário completo). */
export const COMMON_MISSPELLINGS: Record<string, string[]> = {
  concerteza: ['com certeza'], derrepente: ['de repente'], excessão: ['exceção'], excesão: ['exceção'], previlégio: ['privilégio'],
  mendingo: ['mendigo'], beneficiente: ['beneficente'], advinhar: ['adivinhar'], impecilho: ['empecilho'], asterístico: ['asterisco'],
  seje: ['seja'], esteje: ['esteja'], menas: ['menos'], mortandela: ['mortadela'], cabelereiro: ['cabeleireiro'], pobrema: ['problema'],
  rúbrica: ['rubrica'], gratuíto: ['gratuito'], própio: ['próprio'], metereologia: ['meteorologia'], reinvidicar: ['reivindicar'],
  entertido: ['entretido'], encomodar: ['incomodar'], sombrancelha: ['sobrancelha'], bicabornato: ['bicarbonato'], atravéz: ['através'],
  porisso: ['por isso'], apartir: ['a partir'], nescessário: ['necessário'], necesário: ['necessário'], nessessário: ['necessário'],
  ancioso: ['ansioso'], extresse: ['estresse'], previlegiado: ['privilegiado'],
  iorgute: ['iogurte'], cincoenta: ['cinquenta'], losângulo: ['losango'], supertição: ['superstição'], mussarela: ['muçarela'],
  'auto-estima': ['autoestima'], 'auto-escola': ['autoescola'], idéia: ['ideia'], assembléia: ['assembleia'],
  heróico: ['heroico'], vôo: ['voo'], enjôo: ['enjoo'], lêem: ['leem'], vêem: ['veem'], crêem: ['creem'], tranqüilo: ['tranquilo'],
  freqüência: ['frequência'], conseqüência: ['consequência'], agüentar: ['aguentar'], lingüiça: ['linguiça'], pingüim: ['pinguim'],
  ezemplo: ['exemplo'], exemplu: ['exemplo'], diguinidade: ['dignidade'], adevogado: ['advogado'], adivogado: ['advogado'],
  pertubar: ['perturbar'], estrupo: ['estupro'], previnir: ['prevenir'], disinteria: ['disenteria'],
};

const ABBR = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'p', 'ex', 'etc', 'pág', 'págs', 'n', 'nº', 'vol', 'cap', 'fig', 'obs', 'prof', 'profa', 'av', 'art', 'tel', 'ed', 'séc', 'aprox', 'min', 'máx', 'cia', 'ltda', 'inc', 'vs']);
const STOP = new Set(['para', 'pelos', 'pelas', 'pelo', 'pela', 'como', 'mais', 'muito', 'muita', 'quando', 'onde', 'sobre', 'entre', 'depois', 'antes', 'ainda', 'também', 'porque', 'porém', 'então', 'assim', 'mesmo', 'mesma', 'cada', 'todos', 'todas', 'outro', 'outra', 'esses', 'essas', 'estes', 'estas', 'aquele', 'aquela', 'nossa', 'nosso', 'sendo', 'tendo', 'seria', 'pode', 'podem', 'deve', 'devem', 'sempre', 'nunca', 'apenas', 'desde', 'até', 'contra', 'sem', 'após']);
const L = '\\p{L}';
const W = (s: string) => new RegExp(`(?<![${L}])${s}(?![${L}])`, 'giu');

interface TextRule { rule: string; category: Category; severity: Severity; re: RegExp; message: string; fix?: (m: RegExpMatchArray) => string[]; keep?: (m: RegExpMatchArray, text: string) => boolean }
const NUMS = '(\\d+|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|muitos|muitas|vários|várias|alguns|algumas)';
const TEMPO = '(anos|meses|dias|semanas|horas|minutos|séculos|décadas)';

const GRAMMAR: TextRule[] = [
  { rule: 'DOUBLE_SPACE', category: 'GRAMMAR', severity: 'WARNING', re: / {2,}/g, message: 'Espaços repetidos.', fix: () => [' '] },
  { rule: 'SPACE_BEFORE_PUNCT', category: 'GRAMMAR', severity: 'WARNING', re: / +([,.;:!?])(?!\.)/g, message: 'Espaço antes da pontuação.', fix: (m) => [m[1]] },
  { rule: 'MISSING_SPACE_AFTER_PUNCT', category: 'GRAMMAR', severity: 'WARNING', re: new RegExp(`([${L}])([,;])([${L}])`, 'gu'), message: 'Falta espaço depois da pontuação.', fix: (m) => [`${m[1]}${m[2]} ${m[3]}`] },
  { rule: 'REPEATED_WORD', category: 'GRAMMAR', severity: 'WARNING', re: new RegExp(`(?<![${L}])([${L}]+)\\s+\\1(?![${L}])`, 'giu'), message: 'Palavra repetida.', fix: (m) => [m[1]] },
  {
    rule: 'SENTENCE_CAPITAL', category: 'GRAMMAR', severity: 'WARNING', re: new RegExp(`([${L}\\d)]+)([.!?]\\s+)(\\p{Ll})`, 'gu'), message: 'Frase deve começar com letra maiúscula.',
    fix: (m) => [m[1] + m[2] + m[3].toUpperCase()], keep: (m) => !(m[2].startsWith('.') && ABBR.has(m[1].toLowerCase())),
  },
  { rule: 'CRASE_BEFORE_VERB', category: 'GRAMMAR', severity: 'ERROR', re: W('à\\s+(partir|fazer|ser|ter|ver|dizer|começar|contar|pagar|sair|chegar|estudar|trabalhar|correr|falar)'), message: 'Não há crase antes de verbo.', fix: (m) => [`a ${m[1]}`] },
  { rule: 'CRASE_BEFORE_PRONOUN', category: 'GRAMMAR', severity: 'ERROR', re: W('à\\s+(ele|eles|você|vocês|isso|isto|aquilo|um|cada|todos|nós|mim|ti|quem)'), message: 'Não há crase antes de pronome masculino, pessoal ou indefinido.', fix: (m) => [`a ${m[1]}`] },
  { rule: 'HAVER_IMPESSOAL', category: 'GRAMMAR', severity: 'ERROR', re: W('houveram'), message: 'No sentido de "existir", haver não vai para o plural.', fix: () => ['houve'] },
  { rule: 'FAZER_TEMPO', category: 'GRAMMAR', severity: 'ERROR', re: W(`fazem\\s+${NUMS}\\s+${TEMPO}`), message: 'Indicando tempo, fazer não vai para o plural.', fix: (m) => [`faz ${m[1]} ${m[2]}`] },
  { rule: 'PARA_MIM_INFINITIVO', category: 'GRAMMAR', severity: 'ERROR', re: W(`para\\s+mim\\s+([${L}]+(?:ar|er|ir|or))`), message: 'Antes de verbo no infinitivo, use "eu".', fix: (m) => [`para eu ${m[1]}`] },
];

const WORDY: Record<string, string[]> = {
  'a nível de': ['em', 'no âmbito de'], 'fazer uma análise': ['analisar'], 'fazer uma avaliação': ['avaliar'], 'dar início': ['iniciar', 'começar'],
  'tomar uma decisão': ['decidir'], 'com o objetivo de': ['para'], 'no presente momento': ['agora', 'atualmente'], 'subir para cima': ['subir'],
  'descer para baixo': ['descer'], 'elo de ligação': ['elo'], 'encarar de frente': ['encarar'], 'há anos atrás': ['há anos', 'anos atrás'],
  'surpresa inesperada': ['surpresa'], 'planejar antecipadamente': ['planejar'], 'repetir de novo': ['repetir'], 'a grosso modo': ['grosso modo'],
};
const STYLE: TextRule[] = [
  { rule: 'PASSIVE_VOICE', category: 'STYLE', severity: 'INFO', re: W(`(foi|foram|é|são|será|serão|era|eram|seja|sejam)\\s+([${L}]+(?:ado|ada|ados|adas|ido|ida|idos|idas))\\s+(por|pela|pelo|pelas|pelos)`), message: 'Voz passiva: a voz ativa costuma ser mais direta.' },
  { rule: 'WORDY', category: 'STYLE', severity: 'INFO', re: W(`(${Object.keys(WORDY).map((k) => k.replace(/ /g, '\\s+')).join('|')})`), message: 'Expressão que pode ser mais simples.', fix: (m) => WORDY[m[0].toLowerCase().replace(/\s+/g, ' ')] ?? [] },
];

// ---------------------------------------------------------------- coleta de textos

interface Segment { nodeId: string; cell?: string; text: string }

function scopeIds(e: Engine, scope?: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => { const n = e.doc.nodes[id]; if (!n) return; out.push(id); for (const c of n.children) walk(c); };
  walk(scope ?? e.doc.document.rootId);
  return out;   // ordem do documento
}

function segments(e: Engine, scope?: string): Segment[] {
  const out: Segment[] = [];
  for (const id of scopeIds(e, scope)) {
    const n = e.doc.nodes[id];
    if (Array.isArray(n.data.runs)) out.push({ nodeId: id, text: textOf(n) });
    if (n.type === 'TABLE') n.data.rows?.forEach((row: any) => row.cells.forEach((c: any) => { if (typeof c.value === 'string' && !c.formula) out.push({ nodeId: id, cell: c.id, text: c.value }); }));
    if (n.data.surfaceType === 'SHEET') for (const [a, c] of Object.entries<any>(n.data.cells ?? {})) if (typeof c.value === 'string' && !c.formula) out.push({ nodeId: id, cell: a, text: c.value });
  }
  return out;
}

const settings = (e: Engine) => e.doc.document.settings;
const reviewSettings = (e: Engine) => (settings(e).review ?? { ignored: [], disabledRules: [] }) as { ignored: string[]; disabledRules: string[]; maxSentenceWords?: number };
const dictionary = (e: Engine) => new Set<string>(((settings(e).dictionary as string[]) ?? []).map((w) => w.toLowerCase()));
const lang = (e: Engine) => String(settings(e).language ?? 'pt-BR');

/** Gera ids estáveis: mesma regra + mesmo nó + mesmo texto → contador de ocorrência. */
function idMaker() {
  const seen = new Map<string, number>();
  return (rule: string, nodeId: string, cell: string | undefined, text: string) => {
    const base = `${rule}:${nodeId}:${cell ?? ''}:${text.toLowerCase()}`;
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return `${base}:${k}`;
  };
}

// ---------------------------------------------------------------- verificações

function checkText(e: Engine, scope: string | undefined, cats: Set<Category>): Issue[] {
  const out: Issue[] = [];
  const mk = idMaker();
  const dict = dictionary(e);
  const spell: SpellProvider | undefined = e.services.spellcheck;
  const lg = lang(e);
  const maxWords = reviewSettings(e).maxSentenceWords ?? 35;
  const push = (seg: Segment, cat: Category, rule: string, sev: Severity, start: number, end: number, message: string, suggestions: string[] = []) => {
    const text = seg.text.slice(start, end);
    out.push({ id: mk(rule, seg.nodeId, seg.cell, text), category: cat, rule, severity: sev, nodeId: seg.nodeId, ...(seg.cell ? { cell: seg.cell } : {}), start, end, text, message, suggestions });
  };
  const rules = [...(cats.has('GRAMMAR') ? GRAMMAR : []), ...(cats.has('STYLE') ? STYLE : [])];
  for (const seg of segments(e, scope)) {
    const t = seg.text;
    if (cats.has('SPELLING')) {
      for (const m of t.matchAll(new RegExp(`[${L}][${L}'’-]*`, 'gu'))) {
        const w = m[0].replace(/[-'’]+$/, '');
        const low = w.toLowerCase();
        if (w.length < 2 || dict.has(low)) continue;
        const known = lg.startsWith('pt') ? COMMON_MISSPELLINGS[low] : undefined;
        if (known) { push(seg, 'SPELLING', 'MISSPELLING', 'ERROR', m.index!, m.index! + w.length, `"${w}" está escrito errado.`, known.map((s) => (w[0] === w[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s))); continue; }
        if (spell && !/^\p{Lu}+$/u.test(w) && !spell.check(w, lg)) push(seg, 'SPELLING', 'UNKNOWN_WORD', 'ERROR', m.index!, m.index! + w.length, `"${w}" não está no dicionário.`, spell.suggest?.(w, lg) ?? []);
      }
    }
    for (const r of rules) {
      for (const m of t.matchAll(new RegExp(r.re.source, r.re.flags))) {
        if (r.keep && !r.keep(m, t)) continue;
        push(seg, r.category, r.rule, r.severity, m.index!, m.index! + m[0].length, r.message, r.fix?.(m) ?? []);
      }
    }
    if (cats.has('GRAMMAR')) {
      const open = (t.match(/\(/g) ?? []).length, close = (t.match(/\)/g) ?? []).length;
      if (open !== close) push(seg, 'GRAMMAR', 'UNBALANCED_PARENS', 'WARNING', 0, t.length, open > close ? 'Parêntese aberto e não fechado.' : 'Parêntese fechado sem ter sido aberto.');
      const quotes = (t.match(/"/g) ?? []).length, curlyOpen = (t.match(/“/g) ?? []).length, curlyClose = (t.match(/”/g) ?? []).length;
      if (quotes % 2 || curlyOpen !== curlyClose) push(seg, 'GRAMMAR', 'UNBALANCED_QUOTES', 'WARNING', 0, t.length, 'Aspas abertas e não fechadas.');
    }
    if (cats.has('STYLE')) {
      for (const m of t.matchAll(/[^.!?]+[.!?]*/g)) {
        const words = m[0].match(new RegExp(`[${L}\\d]+`, 'gu')) ?? [];
        if (words.length > maxWords) { const s = m.index! + (m[0].length - m[0].trimStart().length); push(seg, 'STYLE', 'LONG_SENTENCE', 'INFO', s, m.index! + m[0].trimEnd().length, `Frase longa (${words.length} palavras). Considere dividir.`); }
      }
      const words = [...t.matchAll(new RegExp(`[${L}]+`, 'gu'))];
      const last = new Map<string, number>();
      words.forEach((m, i) => {
        const w = m[0].toLowerCase();
        if (w.length < 5 || STOP.has(w)) return;
        const prev = last.get(w);
        if (prev !== undefined && i - prev <= 12) push(seg, 'STYLE', 'REPEATED_NEAR', 'INFO', m.index!, m.index! + m[0].length, `"${m[0]}" aparece de novo logo em seguida.`);
        last.set(w, i);
      });
      if (!seg.cell && words.length > 150) push(seg, 'STYLE', 'LONG_PARAGRAPH', 'INFO', 0, t.length, `Parágrafo longo (${words.length} palavras).`);
    }
  }
  return out;
}

const hexRgb = (c: string) => { const h = c.replace('#', ''); const f = h.length <= 4 ? h.slice(0, 3).split('').map((x) => x + x).join('') : h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); };
const lum = (c: string) => { const [r, g, b] = hexRgb(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Contraste WCAG entre duas cores (1 a 21). */
export const contrastRatio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

function backgroundOf(e: Engine, n: EditorNode): string {
  for (const id of [n.id, ...e.ancestors(n.id)]) {
    const x = e.doc.nodes[id];
    const own = id === n.id ? (x.styleOverrides.fill ?? (x.styleId ? e.doc.styles[x.styleId]?.properties.fill : undefined)) : resolveStyle(e, id).fill;
    const fill = typeof own === 'string' && own.startsWith('theme:') ? resolveStyle(e, id).fill : own;
    if (isHex(fill) && !(fill.length === 9 && fill.endsWith('00'))) return fill;
    if (x.type === 'SURFACE' && isHex(x.data.background?.color)) return x.data.background.color;
  }
  const bg = e.doc.themes[e.doc.document.themeId ?? '']?.colors.background;
  return isHex(bg) ? bg : '#FFFFFF';
}

function checkAccessibility(e: Engine, scope?: string): Issue[] {
  const out: Issue[] = [];
  const mk = idMaker();
  const add = (n: EditorNode, rule: string, severity: Severity, message: string, extra: Partial<Issue> = {}) => out.push({ id: mk(rule, n.id, extra.cell, ''), category: 'ACCESSIBILITY', rule, severity, nodeId: n.id, message, suggestions: [], ...extra });
  const ids = scopeIds(e, scope);
  let lastLevel = 0, emptyRun = 0;
  for (const id of ids) {
    const n = e.doc.nodes[id];
    if (n.type === 'IMAGE' && !n.data.decorative && !String(n.data.alt ?? '').trim()) add(n, 'IMAGE_ALT', 'ERROR', 'Imagem sem texto alternativo (alt) — leitores de tela não sabem o que ela mostra. Se for só decorativa, marque decorative.');
    if (n.type === 'CHART' && !String(n.data.alt ?? '').trim() && !String(n.data.title?.text ?? '').trim()) add(n, 'CHART_DESCRIPTION', 'WARNING', 'Gráfico sem título nem descrição (alt).');
    if ((n.type === 'VIDEO' || n.type === 'AUDIO') && !n.data.captions && !n.data.transcript) add(n, 'MEDIA_CAPTIONS', 'WARNING', `${n.type === 'VIDEO' ? 'Vídeo' : 'Áudio'} sem legendas ou transcrição.`);
    if (n.type === 'TABLE' && !n.data.header) add(n, 'TABLE_HEADER', 'WARNING', 'Tabela sem linha de cabeçalho.');
    if (n.type === 'LINK') {
      const t = textOf(n).trim().toLowerCase();
      if (['clique aqui', 'aqui', 'saiba mais', 'link', 'leia mais', 'veja', 'click here', 'here', 'more'].includes(t) || (n.data.url && t === String(n.data.url).toLowerCase())) add(n, 'LINK_TEXT', 'WARNING', 'Texto do link não diz para onde ele leva.');
    }
    if (n.type === 'TEXT') {
      const tt: string = n.data.textType ?? 'PARAGRAPH';
      const lvl = tt === 'TITLE' ? 1 : tt.startsWith('HEADING_') ? Number(tt.slice(8)) : 0;
      if (lvl) { if (lastLevel && lvl > lastLevel + 1) add(n, 'HEADING_ORDER', 'WARNING', `Título pula de nível (H${lastLevel} → H${lvl}).`); lastLevel = lvl; }
      const text = textOf(n);
      emptyRun = text.trim() ? 0 : emptyRun + 1;
      if (emptyRun === 3) add(n, 'EMPTY_PARAGRAPHS', 'INFO', 'Vários parágrafos vazios seguidos para dar espaço — use espaçamento de parágrafo.');
    }
    if (Array.isArray(n.data.runs) && textOf(n).trim()) {
      const st = resolveStyle(e, n.id);
      const bg = backgroundOf(e, n);
      const size = Number(st.fontSize ?? 11);
      for (const r of n.data.runs) {
        if (!r.text.trim()) continue;
        const color = r.format.color ?? st.color;
        if (!isHex(color)) continue;
        const bold = Boolean(r.format.bold ?? st.bold), fs = Number(r.format.fontSize ?? size);
        const large = fs >= 24 || (bold && fs >= 18.66);
        const ratio = contrastRatio(color, bg);
        if (ratio < (large ? 3 : 4.5)) { add(n, 'CONTRAST', 'ERROR', `Contraste baixo entre texto ${color} e fundo ${bg} (${ratio.toFixed(2)}:1; mínimo ${large ? '3' : '4,5'}:1).`); break; }
      }
      if (size < 9) add(n, 'SMALL_TEXT', 'INFO', `Texto muito pequeno (${size}pt).`);
    }
    if (n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE') {
      const hasTitle = [...e.descendants(n.id)].some((c) => { const x = e.doc.nodes[c]; return x?.type === 'TEXT' && ['TITLE', 'HEADING_1'].includes(x.data.textType) && textOf(x).trim(); });
      if (!hasTitle) add(n, 'SLIDE_TITLE', 'WARNING', 'Slide sem título — quem navega por leitor de tela se orienta por eles.');
    }
  }
  return out;
}

function checkConsistency(e: Engine, scope?: string): Issue[] {
  const out: Issue[] = [];
  const mk = idMaker();
  const ids = scopeIds(e, scope);
  for (const id of ids) {
    const n = e.doc.nodes[id];
    if (n.data.broken || (n.type === 'CHART' && n.data.source?.missing)) out.push({ id: mk('BROKEN_REFERENCE', id, undefined, ''), category: 'CONSISTENCY', rule: 'BROKEN_REFERENCE', severity: 'ERROR', nodeId: id, message: n.type === 'CHART' ? 'A fonte dos dados do gráfico foi apagada.' : 'Aponta para um elemento que não existe mais.', suggestions: [] });
  }
  // fontes diretas misturadas
  const theme = e.doc.themes[e.doc.document.themeId ?? ''];
  const themeFonts = new Set(Object.values(theme?.fonts ?? {}).map(String));
  const fonts = new Map<string, string>();
  for (const id of ids) {
    const n = e.doc.nodes[id];
    const fams = [n.styleOverrides.fontFamily, ...((n.data.runs ?? []) as any[]).map((r) => r.format.fontFamily)].filter((f): f is string => typeof f === 'string' && !f.startsWith('theme:') && !themeFonts.has(f));
    for (const f of fams) if (!fonts.has(f)) fonts.set(f, id);
  }
  if (themeFonts.size + fonts.size > 3) for (const [f, id] of fonts) out.push({ id: mk('MIXED_FONTS', id, undefined, f), category: 'CONSISTENCY', rule: 'MIXED_FONTS', severity: 'WARNING', nodeId: id, text: f, message: `Fonte "${f}" fora do tema — o documento usa ${themeFonts.size + fonts.size} fontes.`, suggestions: [...themeFonts] });
  // títulos do mesmo nível com aparências diferentes
  const groups = new Map<string, { id: string; sig: string }[]>();
  for (const id of ids) {
    const n = e.doc.nodes[id];
    if (n.type !== 'TEXT' || !/^(TITLE|HEADING_\d)$/.test(n.data.textType ?? '')) continue;
    const st = resolveStyle(e, id);
    const f = (n.data.runs?.[0]?.format ?? {}) as Record<string, unknown>;
    const sig = JSON.stringify([f.fontSize ?? st.fontSize, f.fontFamily ?? st.fontFamily, f.color ?? st.color, f.bold ?? st.bold]);
    groups.set(n.data.textType, [...(groups.get(n.data.textType) ?? []), { id, sig }]);
  }
  for (const [tt, list] of groups) {
    if (list.length < 2) continue;
    const count = new Map<string, number>();
    for (const x of list) count.set(x.sig, (count.get(x.sig) ?? 0) + 1);
    const main = [...count].sort((a, b) => b[1] - a[1])[0][0];
    for (const x of list) if (x.sig !== main) out.push({ id: mk('HEADING_STYLE', x.id, undefined, tt), category: 'CONSISTENCY', rule: 'HEADING_STYLE', severity: 'WARNING', nodeId: x.id, message: `Este ${tt === 'TITLE' ? 'título' : `título de nível ${tt.slice(8)}`} tem aparência diferente dos outros do mesmo nível.`, suggestions: [] });
  }
  // o mesmo termo escrito de formas diferentes (e-mail/email, JavaScript/Javascript)
  const forms = new Map<string, Map<string, { seg: Segment; start: number; word: string }[]>>();
  for (const seg of segments(e, scope)) for (const m of seg.text.matchAll(new RegExp(`[${L}\\d]+(?:-[${L}\\d]+)*`, 'gu'))) {
    const w = m[0];
    if (w.length < 4 || /^\d+$/.test(w)) continue;
    const key = w.toLowerCase().replace(/-/g, '');
    const form = w[0].toLowerCase() + w.slice(1);
    const byForm = forms.get(key) ?? new Map();
    byForm.set(form, [...(byForm.get(form) ?? []), { seg, start: m.index!, word: w }]);
    forms.set(key, byForm);
  }
  for (const byForm of forms.values()) {
    if (byForm.size < 2) continue;
    const ranked = [...byForm].sort((a, b) => b[1].length - a[1].length);
    const best = ranked[0][1][0].word;
    for (const [, occ] of ranked.slice(1)) for (const o of occ) {
      const sugg = o.word[0] === o.word[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best[0].toLowerCase() + best.slice(1);
      out.push({ id: mk('TERM_VARIANT', o.seg.nodeId, o.seg.cell, o.word), category: 'CONSISTENCY', rule: 'TERM_VARIANT', severity: 'WARNING', nodeId: o.seg.nodeId, ...(o.seg.cell ? { cell: o.seg.cell } : {}), start: o.start, end: o.start + o.word.length, text: o.word, message: `"${o.word}" também aparece como "${best}" no documento.`, suggestions: [sugg] });
    }
  }
  return out;
}

function checkFormulas(e: Engine, scope?: string): Issue[] {
  const inScope = scope ? new Set(scopeIds(e, scope)) : null;
  const mk = idMaker();
  return (tableHandlers.FORMULA_ERRORS(e, { type: 'FORMULA_ERRORS' }) as { nodeId: string; cell: string; code: string; message: string }[])
    .filter((x) => !inScope || inScope.has(x.nodeId))
    .map((x) => ({ id: mk('FORMULA_ERROR', x.nodeId, x.cell, x.code), category: 'FORMULA' as const, rule: 'FORMULA_ERROR', severity: 'ERROR' as const, nodeId: x.nodeId, cell: x.cell, text: x.code, message: `${x.cell}: ${x.code} — ${x.message}`, suggestions: [] }));
}

/** Revisão completa (ou só as categorias pedidas), sem os problemas ignorados e as regras desligadas. */
export function review(e: Engine, opts: { categories?: Category[]; scope?: string; includeIgnored?: boolean } = {}): Issue[] {
  const cats = new Set<Category>(opts.categories ?? CATEGORIES);
  for (const c of cats) if (!CATEGORIES.includes(c)) fail('VALIDATION', `Categoria: ${CATEGORIES.join(', ')}.`);
  if (opts.scope) e.get(opts.scope);
  const rs = reviewSettings(e);
  const all = [
    ...(cats.has('SPELLING') || cats.has('GRAMMAR') || cats.has('STYLE') ? checkText(e, opts.scope, cats) : []),
    ...(cats.has('ACCESSIBILITY') ? checkAccessibility(e, opts.scope) : []),
    ...(cats.has('CONSISTENCY') ? checkConsistency(e, opts.scope) : []),
    ...(cats.has('FORMULA') ? checkFormulas(e, opts.scope) : []),
  ];
  return all.filter((i) => !rs.disabledRules.includes(i.rule) && (opts.includeIgnored || !rs.ignored.includes(i.id)));
}

// ---------------------------------------------------------------- aplicar correções

function applyFix(e: Engine, issue: Issue, replacement: string) {
  if (issue.start === undefined || issue.end === undefined) fail('INVALID_OPERATION', 'Este problema não tem correção automática.');
  e.assertEditable(issue.nodeId);
  const n = e.touchNode(issue.nodeId);
  if (issue.cell) {
    const cell = n.type === 'TABLE' ? n.data.rows.flatMap((r: any) => r.cells).find((c: any) => c.id === issue.cell) : n.data.cells?.[issue.cell];
    if (!cell || typeof cell.value !== 'string') fail('NOT_FOUND', 'A célula mudou desde a revisão.');
    cell.value = cell.value.slice(0, issue.start) + replacement + cell.value.slice(issue.end);
    return;
  }
  deleteText(e, n, issue.start!, issue.end!);
  if (replacement) insertText(e, n, issue.start!, replacement);
}

const touchReview = (e: Engine) => {
  const info = e.touch('document', 'info') as any;
  info.settings.review = { ignored: [], disabledRules: [], ...(info.settings.review ?? {}) };
  return info.settings.review as { ignored: string[]; disabledRules: string[]; maxSentenceWords?: number };
};

// ---------------------------------------------------------------- estatísticas

const syllables = (w: string) => Math.max(1, (w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[aeiouy]+/g) ?? []).length);

export function documentStats(e: Engine, scope?: string) {
  const base = textHandlers.TEXT_STATS(e, { type: 'TEXT_STATS', payload: scope ? { scope } : {} }) as { paragraphs: number; words: number; characters: number; charactersNoSpaces: number };
  const ids = scopeIds(e, scope);
  const texts = ids.map((id) => e.doc.nodes[id]).filter((n) => Array.isArray(n.data.runs)).map(textOf).join('\n');
  const words = texts.match(new RegExp(`[${L}\\d][${L}\\d'’-]*`, 'gu')) ?? [];
  const sentences = Math.max(words.length ? 1 : 0, (texts.match(/[^.!?\n]*[\p{L}\d][^.!?\n]*([.!?]+|\n|$)/gu) ?? []).length);
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const elements: Record<string, number> = {};
  for (const id of ids) { const t = e.doc.nodes[id].type; elements[t] = (elements[t] ?? 0) + 1; }
  const surfaces = ids.map((id) => e.doc.nodes[id]).filter((n) => n.type === 'SURFACE');
  let pages: number | null = null;
  if (e.doc.document.application === 'DOCUMENT_EDITOR' && !scope) { try { pages = paginate(e).length; } catch { pages = null; } }
  // legibilidade: Flesch adaptado ao português (Martins et al., 1996); 0–100, maior = mais fácil
  const flesch = words.length && sentences ? Math.round(Math.max(0, Math.min(100, 248.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length)))) : null;
  return {
    ...base,
    sentences,
    wordsPerSentence: sentences ? Math.round((words.length / sentences) * 10) / 10 : 0,
    readability: flesch,
    readingMinutes: Math.ceil(words.length / 200),
    speakingMinutes: Math.ceil(words.length / 130),
    pages,
    slides: surfaces.filter((s) => s.data.surfaceType === 'SLIDE').length,
    sheets: surfaces.filter((s) => s.data.surfaceType === 'SHEET').length,
    elements,
  };
}

// ---------------------------------------------------------------- tradução

export interface TranslationSegment { nodeId: string; runId?: string; cell?: string; text: string }

export function translationSegments(e: Engine, ids: string[]): TranslationSegment[] {
  const out: TranslationSegment[] = [];
  const seen = new Set<string>();
  for (const root of ids) for (const id of scopeIds(e, root)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const n = e.doc.nodes[id];
    if (Array.isArray(n.data.runs)) for (const r of n.data.runs) if (r.text.trim()) out.push({ nodeId: id, runId: r.id, text: r.text });
    if (n.type === 'TABLE') n.data.rows?.forEach((row: any) => row.cells.forEach((c: any) => { if (typeof c.value === 'string' && c.value.trim() && !c.formula) out.push({ nodeId: id, cell: c.id, text: c.value }); }));
    if (n.data.surfaceType === 'SHEET') for (const [a, c] of Object.entries<any>(n.data.cells ?? {})) if (typeof c.value === 'string' && c.value.trim() && !c.formula) out.push({ nodeId: id, cell: a, text: c.value });
  }
  return out;
}

/** Traduz com o provedor (assíncrono) e aplica tudo numa transação: um desfazer volta o original. */
export async function translateContent(e: Engine, opts: { targetIds?: string[]; to: string; from?: string }, provider: TranslateProvider | undefined = e.services.translate) {
  if (!provider) fail('INVALID_OPERATION', 'Nenhum serviço de tradução configurado (services.translate).');
  const segs = e.run({ type: 'TRANSLATION_SEGMENTS', payload: { targetIds: opts.targetIds } }) as TranslationSegment[];
  const texts = await provider!(segs.map((s) => s.text), opts.to, opts.from);
  if (texts.length !== segs.length) fail('VALIDATION', 'O serviço de tradução devolveu uma quantidade diferente de trechos.');
  return e.run({ type: 'APPLY_TRANSLATION', payload: { to: opts.to, segments: segs.map((s, i) => ({ ...s, text: texts[i] })) } });
}

// ---------------------------------------------------------------- operações

const opts = (p: any) => ({ scope: p?.scope, includeIgnored: p?.includeIgnored });
const summary = (issues: Issue[]) => ({
  total: issues.length,
  byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, issues.filter((i) => i.category === c).length])),
  bySeverity: { ERROR: issues.filter((i) => i.severity === 'ERROR').length, WARNING: issues.filter((i) => i.severity === 'WARNING').length, INFO: issues.filter((i) => i.severity === 'INFO').length },
});

export const reviewHandlers: Record<string, Handler> = {
  CHECK_SPELLING: (e, op) => review(e, { ...opts(op.payload), categories: ['SPELLING'] }),
  CHECK_GRAMMAR: (e, op) => review(e, { ...opts(op.payload), categories: ['GRAMMAR'] }),
  CHECK_STYLE: (e, op) => review(e, { ...opts(op.payload), categories: ['STYLE'] }),
  CHECK_ACCESSIBILITY: (e, op) => review(e, { ...opts(op.payload), categories: ['ACCESSIBILITY'] }),
  CHECK_CONSISTENCY: (e, op) => review(e, { ...opts(op.payload), categories: ['CONSISTENCY'] }),
  /** REVIEW_DOCUMENT { categories?, scope? } → { issues, summary } */
  REVIEW_DOCUMENT: (e, op) => { const issues = review(e, { ...opts(op.payload), categories: op.payload?.categories }); return { issues, summary: summary(issues) }; },

  /** APPLY_SUGGESTION { issueId, suggestion? (texto) | index? } — revisa de novo para usar as posições atuais. */
  APPLY_SUGGESTION: (e, op) => {
    const p = op.payload ?? {};
    const issue = review(e, { includeIgnored: true }).find((i) => i.id === p.issueId) ?? fail('NOT_FOUND', 'O problema não existe mais (o texto mudou ou já foi corrigido).');
    const rep = typeof p.suggestion === 'string' ? p.suggestion : issue!.suggestions[p.index ?? 0];
    if (rep === undefined) fail('INVALID_OPERATION', 'Este problema não tem sugestão; informe suggestion.');
    applyFix(e, issue!, rep);
    return issue!.id;
  },
  /** APPLY_ALL_SUGGESTIONS { rule? | category?, scope? } — aplica a 1ª sugestão de cada problema (do fim para o começo). */
  APPLY_ALL_SUGGESTIONS: (e, op) => {
    const p = op.payload ?? {};
    const list = review(e, { scope: p.scope, categories: p.category ? [p.category] : undefined })
      .filter((i) => i.suggestions.length && i.start !== undefined && (!p.rule || i.rule === p.rule) && i.category !== 'FORMULA');
    // um trecho por vez: do fim para o começo, sem sobreposição
    list.sort((a, b) => (a.nodeId + (a.cell ?? '')).localeCompare(b.nodeId + (b.cell ?? '')) || b.start! - a.start!);
    let applied = 0, lastKey = '', lastStart = Infinity;
    for (const i of list) {
      const key = i.nodeId + (i.cell ?? '');
      if (key !== lastKey) { lastKey = key; lastStart = Infinity; }
      if (i.end! > lastStart) continue;
      applyFix(e, i, i.suggestions[0]);
      lastStart = i.start!;
      applied++;
    }
    return applied;
  },
  IGNORE_ISSUE: (e, op) => { const r = touchReview(e); const ids: string[] = op.payload?.issueIds ?? [op.payload?.issueId]; r.ignored = [...new Set([...r.ignored, ...ids.filter(Boolean)])]; return r.ignored.length; },
  CLEAR_IGNORED: (e) => { const r = touchReview(e); const n = r.ignored.length; r.ignored = []; return n; },
  /** SET_REVIEW_OPTIONS { disabledRules?, maxSentenceWords?, language? } */
  SET_REVIEW_OPTIONS: (e, op) => {
    const p = op.payload ?? {};
    const r = touchReview(e);
    if (p.disabledRules) { if (!Array.isArray(p.disabledRules)) fail('VALIDATION', 'disabledRules: lista de regras.'); r.disabledRules = [...p.disabledRules]; }
    if (p.maxSentenceWords !== undefined) { if (!(Number(p.maxSentenceWords) >= 5)) fail('VALIDATION', 'maxSentenceWords: 5 ou mais.'); r.maxSentenceWords = Number(p.maxSentenceWords); }
    if (p.language) (e.touch('document', 'info') as any).settings.language = String(p.language);
    return clone(r);
  },
  ADD_TO_DICTIONARY: (e, op) => {
    const words: string[] = (op.payload?.words ?? [op.payload?.word]).map((w: unknown) => String(w ?? '').trim()).filter(Boolean);
    if (!words.length) fail('VALIDATION', 'Informe a palavra.');
    const info = e.touch('document', 'info') as any;
    info.settings.dictionary = [...new Set([...(info.settings.dictionary ?? []), ...words.map((w) => w.toLowerCase())])].sort();
    return info.settings.dictionary.length;
  },
  REMOVE_FROM_DICTIONARY: (e, op) => {
    const info = e.touch('document', 'info') as any;
    const w = String(op.payload?.word ?? '').toLowerCase();
    info.settings.dictionary = (info.settings.dictionary ?? []).filter((x: string) => x !== w);
    return info.settings.dictionary.length;
  },

  /** Trechos para traduzir: TRANSLATION_SEGMENTS { targetIds? } (padrão: documento inteiro). */
  TRANSLATION_SEGMENTS: (e, op) => translationSegments(e, op.payload?.targetIds?.length ? op.payload.targetIds : op.targetIds?.length ? op.targetIds : [e.doc.document.rootId]),
  /** APPLY_TRANSLATION { to, segments: [{ nodeId, runId? | cell?, text }] } — mantém a formatação de cada trecho. */
  APPLY_TRANSLATION: (e, op) => {
    const p = op.payload ?? {};
    if (!p.to || !Array.isArray(p.segments)) fail('INVALID_PAYLOAD', 'Informe to e segments.');
    const nodes = new Set<string>();
    for (const s of p.segments as TranslationSegment[]) {
      e.assertEditable(s.nodeId);
      const n = e.touchNode(s.nodeId);
      if (s.runId) {
        const r = (n.data.runs ?? []).find((x: any) => x.id === s.runId) ?? fail('NOT_FOUND', `Trecho ${s.runId} não existe mais.`);
        r.text = String(s.text);
      } else if (s.cell) {
        const cell = n.type === 'TABLE' ? n.data.rows.flatMap((r: any) => r.cells).find((c: any) => c.id === s.cell) : n.data.cells?.[s.cell];
        if (!cell) fail('NOT_FOUND', `Célula ${s.cell} não existe mais.`);
        cell.value = String(s.text);
      }
      n.data.lang = String(p.to);
      nodes.add(s.nodeId);
    }
    return [...nodes];
  },

  /** DOCUMENT_STATS { scope? } — palavras, frases, legibilidade, tempo de leitura/fala, páginas, slides, elementos. */
  DOCUMENT_STATS: (e, op) => documentStats(e, op.payload?.scope),
};
