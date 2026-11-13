// Formatos numéricos das planilhas (os mesmos códigos do Excel/LibreOffice), em português do Brasil:
//   "0", "0,00", "#.##0,00", "0%", "0,00%", "R$ #.##0,00", "0,00E+00", "# ?/?", "dd/mm/aaaa", "hh:mm:ss", "@",
//   seções "positivo;negativo;zero;texto", cores [Vermelho]/[Red], texto literal "..." e \x.
// Também aceita o código em notação americana ("#,##0.00"): vírgula de milhar e ponto decimal.
// Datas são o número de série das planilhas (dias desde 30/12/1899).

export const FORMAT_PRESETS: Record<string, { label: string; code: string }> = {
  GENERAL: { label: 'Geral', code: 'Geral' },
  NUMBER: { label: 'Número', code: '#.##0,00' },
  INTEGER: { label: 'Número inteiro', code: '#.##0' },
  CURRENCY: { label: 'Moeda (R$)', code: 'R$ #.##0,00;[Vermelho]-R$ #.##0,00' },
  ACCOUNTING: { label: 'Contábil', code: 'R$ * #.##0,00;R$ * (#.##0,00);R$ * "-"??' },
  USD: { label: 'Dólar (US$)', code: 'US$ #.##0,00' },
  EUR: { label: 'Euro (€)', code: '€ #.##0,00' },
  PERCENT: { label: 'Porcentagem', code: '0%' },
  PERCENT2: { label: 'Porcentagem com 2 casas', code: '0,00%' },
  SCIENTIFIC: { label: 'Científico', code: '0,00E+00' },
  FRACTION: { label: 'Fração', code: '# ?/?' },
  DATE_SHORT: { label: 'Data abreviada', code: 'dd/mm/aaaa' },
  DATE_LONG: { label: 'Data por extenso', code: 'dddd, d "de" mmmm "de" aaaa' },
  MONTH_YEAR: { label: 'Mês e ano', code: 'mmm/aa' },
  TIME: { label: 'Hora', code: 'hh:mm:ss' },
  TIME_SHORT: { label: 'Hora (sem segundos)', code: 'hh:mm' },
  DATETIME: { label: 'Data e hora', code: 'dd/mm/aaaa hh:mm' },
  DURATION: { label: 'Duração (horas acumuladas)', code: '[h]:mm:ss' },
  TEXT: { label: 'Texto', code: '@' },
  CEP: { label: 'CEP', code: '00000-000' },
  CPF: { label: 'CPF', code: '000"."000"."000-00' },
  CNPJ: { label: 'CNPJ', code: '00"."000"."000"/"0000-00' },
  PHONE: { label: 'Telefone', code: '(00) 00000-0000' },
};
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const COLORS: Record<string, string> = { vermelho: '#C00000', red: '#C00000', azul: '#0070C0', blue: '#0070C0', verde: '#00B050', green: '#00B050', preto: '#000000', black: '#000000', amarelo: '#FFC000', yellow: '#FFC000', magenta: '#FF00FF', ciano: '#00B0F0', cyan: '#00B0F0', branco: '#FFFFFF', white: '#FFFFFF' };
const EPOCH = Date.UTC(1899, 11, 30);

export interface Formatted { text: string; color?: string; align?: 'LEFT' | 'RIGHT' }

/** Divide nas seções, respeitando ; dentro de aspas. */
function sections(code: string) {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') q = !q;
    if (ch === '\\' && !q) { cur += ch + (code[++i] ?? ''); continue; }
    if (ch === ';' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const isDateCode = (c: string) => /(^|[^"\\])[dmyaDMYAhHsS]/.test(c.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/E[+-]/g, ''));

function fmtDate(serial: number, code: string) {
  const ms = EPOCH + Math.round(serial * 86_400_000);
  const d = new Date(ms);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), wd = d.getUTCDay();
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  const ampm = /AM\/PM|A\/P/i.test(code);
  const p2 = (v: number) => String(v).padStart(2, '0');
  let out = '';
  const tokens = code.match(/"[^"]*"|\\.|\[h+\]|\[m+\]|\[s+\]|AM\/PM|A\/P|d{1,4}|m{1,5}|[ya]{1,4}|h{1,2}|s{1,2}|0+|./gi) ?? [];
  tokens.forEach((tk, i) => {
    const low = tk.toLowerCase();
    if (tk.startsWith('"')) { out += tk.slice(1, -1); return; }
    if (tk.startsWith('\\')) { out += tk.slice(1); return; }
    if (/^\[h+\]$/i.test(tk)) { out += String(Math.floor(serial * 24)).padStart(tk.length - 2, '0'); return; }
    if (/^\[m+\]$/i.test(tk)) { out += String(Math.floor(serial * 1440)).padStart(tk.length - 2, '0'); return; }
    if (/^\[s+\]$/i.test(tk)) { out += String(Math.floor(serial * 86400)); return; }
    if (low === 'am/pm') { out += h < 12 ? 'AM' : 'PM'; return; }
    if (low === 'a/p') { out += h < 12 ? 'A' : 'P'; return; }
    if (/^d+$/.test(low)) { out += low.length === 1 ? D : low.length === 2 ? p2(D) : low.length === 3 ? DAYS[wd].slice(0, 3) : DAYS[wd]; return; }
    if (/^[ya]+$/.test(low)) { out += low.length <= 2 ? p2(Y % 100) : String(Y); return; }
    if (/^h+$/.test(low)) { const hh = ampm ? (h % 12 || 12) : h; out += low.length === 1 ? hh : p2(hh); return; }
    if (/^s+$/.test(low)) { out += low.length === 1 ? s : p2(s); return; }
    if (/^m+$/.test(low)) {
      // "m" depois de hora ou antes de segundos é minuto
      const prev = tokens.slice(0, i).reverse().find((x) => /^[a-z\[]/i.test(x) && !x.startsWith('"'));
      const next = tokens.slice(i + 1).find((x) => /^[a-z\[]/i.test(x) && !x.startsWith('"'));
      const minute = (prev && /^h|^\[h/i.test(prev)) || (next && /^s/i.test(next));
      if (minute && low.length <= 2) { out += low.length === 1 ? mi : p2(mi); return; }
      out += low.length === 1 ? M + 1 : low.length === 2 ? p2(M + 1) : low.length === 3 ? MONTHS[M].slice(0, 3) : low.length === 5 ? MONTHS[M][0] : MONTHS[M];
      return;
    }
    if (/^0+$/.test(tk) && out.match(/[:.,]$/) && /s/i.test(tokens.slice(0, i).join(''))) { out += String(Math.round((serial * 86400 % 1) * 10 ** tk.length)).padStart(tk.length, '0'); return; }
    out += tk;
  });
  return out;
}

/** Converte o código para a notação interna (ponto decimal, vírgula de milhar) entendendo as duas. */
function normalizeNumberCode(c: string) {
  const bare = c.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  // pt-BR: "#.##0,00" (ponto antes de 3 dígitos-código, vírgula decimal) → "#,##0.00"
  const usThousands = /#,##[#0]/.test(bare);
  if (/[#0]\.[#0]{3}(?![#0])/.test(bare) || (!usThousands && /[#0?],[0#?]/.test(bare) && !/\.[0#?]/.test(bare))) {
    return c.replace(/("[^"]*"|\\.)|[.,]/g, (m, lit) => (lit ? lit : m === '.' ? ',' : '.'));
  }
  return c;
}

function fmtNumber(v: number, code: string): string {
  code = normalizeNumberCode(code);
  let lits = '';
  if (!/[#0?]/.test(code.replace(/"[^"]*"|\\./g, ''))) return (code.match(/"[^"]*"|\\.|./g) ?? []).map((tk) => (tk.startsWith('"') ? tk.slice(1, -1) : tk.startsWith('\\') ? tk.slice(1) : tk)).join('');
  // percentuais e escala por vírgulas finais (1000)
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  if (bare.includes('%')) v *= 100 ** (bare.match(/%/g)!.length);
  const trailing = /([0#?]),+(?![0#?])/.exec(bare);
  if (trailing) v /= 1000 ** (trailing[0].length - 1);
  // científico
  const sci = /([0#.?]+)E([+-])(0+)/i.exec(bare);
  if (sci) {
    const decs = (sci[1].split('.')[1] ?? '').length;
    const exp = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)));
    const mant = v / 10 ** exp;
    const es = `${exp < 0 ? '-' : sci[2] === '+' ? '+' : ''}${String(Math.abs(exp)).padStart(sci[3].length, '0')}`;
    return code.replace(/"([^"]*)"/g, '$1').replace(sci[0], `${mant.toFixed(decs).replace('.', ',')}E${es}`);
  }
  // frações
  const frac = /(#*0*)\s+(\?+|#+|0+)\/(\?+|\d+)/.exec(bare);
  if (frac) {
    const whole = Math.trunc(v), rest = Math.abs(v - whole);
    let num = 0, den = 1;
    if (/^\d+$/.test(frac[3])) { den = Number(frac[3]); num = Math.round(rest * den); }
    else { const maxDen = 10 ** frac[3].length - 1; let best = Infinity; for (let d = 1; d <= maxDen; d++) { const nn = Math.round(rest * d); const e = Math.abs(rest - nn / d); if (e < best - 1e-12) { best = e; num = nn; den = d; } } }
    const w = whole !== 0 || !frac[1] ? String(whole) : (v < 0 ? '-' : '');
    return num === 0 ? (w || '0') : `${w ? `${w} ` : ''}${num}/${den}`;
  }
  // máscara só com zeros e literais (CEP, CPF, telefone)
  if (/^[0"\\.\-\/() ]+$/.test(code.replace(/"[^"]*"/g, '"')) && !/[#,?.]0/.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, '')) && (code.replace(/"[^"]*"|\\./g, '').match(/0/g) ?? []).length >= 4) {
    const digits = String(Math.round(Math.abs(v))).padStart((code.replace(/"[^"]*"|\\./g, '').match(/0/g) ?? []).length, '0');
    let k = digits.length - (code.replace(/"[^"]*"|\\./g, '').match(/0/g) ?? []).length;
    let out = digits.slice(0, Math.max(0, k));
    for (const tk of code.match(/"[^"]*"|\\.|./g) ?? []) {
      if (tk === '0') out += digits[k++] ?? '';
      else out += tk.startsWith('"') ? tk.slice(1, -1) : tk.startsWith('\\') ? tk.slice(1) : tk;
    }
    return out;
  }
  if (!/[#0?]/.test(bare)) return (code.match(/"[^"]*"|\\.|./g) ?? []).map((tk) => (tk.startsWith('"') ? tk.slice(1, -1) : tk.startsWith('\\') ? tk.slice(1) : tk)).join('');
  const m = /([#0?,]*)(\.([0#?]*))?/.exec(bare.slice(bare.search(/[#0?]/)))!;
  const intPart = m?.[1] ?? '0', decPart = m?.[3] ?? '';
  const minDec = (decPart.match(/0/g) ?? []).length, maxDec = decPart.length;
  const grouping = intPart.includes(',');
  const minInt = (intPart.replace(/,/g, '').match(/0/g) ?? []).length;
  const abs = Math.abs(v);
  let s = abs.toLocaleString('pt-BR', { minimumFractionDigits: minDec, maximumFractionDigits: maxDec, useGrouping: grouping, minimumIntegerDigits: Math.max(1, minInt) });
  if (minInt === 0 && s.startsWith('0,')) s = s.slice(1);
  if (minInt === 0 && s === '0') s = '';
  // monta: o que vem antes do primeiro dígito-código, o número, e o que vem depois
  const tokens = code.match(/"[^"]*"|\\.|\*.|_.|[#0?,.]+|E[+-]0+|./g) ?? [];
  let placed = false;
  for (const tk of tokens) {
    if (/^[#0?,.]+$/.test(tk) && /[#0?]/.test(tk)) { if (!placed) { lits += s; placed = true; } continue; }
    if (tk === '%') { lits += '%'; continue; }
    if (tk.startsWith('"')) lits += tk.slice(1, -1);
    else if (tk.startsWith('\\')) lits += tk.slice(1);
    else if (tk.startsWith('_')) lits += ' ';
    else if (tk.startsWith('*')) lits += ' ';
    else if (tk !== ',' && tk !== '.') lits += tk;
  }
  if (!placed) lits += s;
  return lits.replace(/\s{2,}/g, ' ');
}

/**
 * Formata um valor com o código. Devolve o texto e, se o código pedir, a cor ([Vermelho]) e o alinhamento.
 * Sem código (ou "Geral"), números saem com vírgula decimal e até 10 casas.
 */
export function formatValue(value: unknown, code?: string | null): Formatted {
  const c = code && FORMAT_PRESETS[code] ? FORMAT_PRESETS[code].code : code;
  if (value === null || value === undefined || value === '') return { text: '' };
  if (typeof value === 'boolean') return { text: value ? 'VERDADEIRO' : 'FALSO', align: 'RIGHT' };
  if (typeof value !== 'number') {
    const secs = c ? sections(c) : [];
    const textSec = secs[3] ?? (secs.length === 1 && secs[0].includes('@') ? secs[0] : null);
    if (textSec) return { text: textSec.replace(/"([^"]*)"/g, '$1').replace('@', String(value)) };
    return { text: String(value), align: 'LEFT' };
  }
  if (!c || /^(geral|general)$/i.test(c)) {
    const r = Math.round(value * 1e10) / 1e10;
    return { text: Math.abs(r) >= 1e11 || (Math.abs(r) < 1e-9 && r !== 0) ? r.toExponential(5).replace('.', ',').replace('e', 'E') : String(r).replace('.', ','), align: 'RIGHT' };
  }
  if (c === '@') return { text: String(value).replace('.', ','), align: 'LEFT' };
  const secs = sections(c);
  let sec = secs[0], v = value;
  // condições [>100] nas seções
  const cond = (s: string) => /\[(<=|>=|<>|<|>|=)(-?\d+(?:[.,]\d+)?)\]/.exec(s);
  if (secs.some((s) => cond(s))) {
    const pick = secs.find((s) => { const m = cond(s); if (!m) return false; const k = Number(m[2].replace(',', '.')); return { '<': v < k, '>': v > k, '<=': v <= k, '>=': v >= k, '=': v === k, '<>': v !== k }[m[1]]; });
    sec = pick ?? secs.find((s) => !cond(s)) ?? secs[0];
  } else if (v < 0 && secs[1] !== undefined) { sec = secs[1]; v = -v; }
  else if (v === 0 && secs[2] !== undefined) sec = secs[2];
  let color: string | undefined;
  sec = sec.replace(/\[([^\]]+)\]/g, (m, inner: string) => {
    const k = inner.toLowerCase();
    if (COLORS[k]) { color = COLORS[k]; return ''; }
    if (/^(<=|>=|<>|<|>|=)/.test(inner)) return '';
    if (/^\$/.test(inner)) return inner.slice(1).split('-')[0];
    return m;   // [h], [mm] (duração) ficam
  });
  const text = isDateCode(sec) && !/[#0?]/.test(sec.replace(/"[^"]*"/g, '').replace(/[hms]0+/gi, '')) ? fmtDate(v, sec) : fmtNumber(v, sec);
  return { text: (value < 0 && sec === secs[0] && !text.startsWith('-') && v < 0 ? '-' : '') + text, color, align: 'RIGHT' };
}
