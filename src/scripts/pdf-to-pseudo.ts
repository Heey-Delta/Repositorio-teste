// PDF → pseudocódigo (no navegador, com o pdf.js). Lê o texto com posição e tamanho de letra e reconhece:
//   títulos (letra maior que a do corpo), parágrafos (linhas próximas juntas), tópicos (•, -, 1.)
//   e tabelas (linhas com colunas separadas por espaços largos, alinhadas umas com as outras).
// Imagens e gráficos desenhados no PDF não viram dados: entram só os textos deles.
import { tableRowsToPseudo } from '../lib/pseudo';

type Item = { str: string; x: number; y: number; w: number; size: number; bold: boolean };
type Line = { items: Item[]; y: number; size: number; bold: boolean; text: string; page: number };

export async function pdfToPseudo(file: File | ArrayBuffer, name?: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: Line[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    await page.getOperatorList();   // carrega as fontes: o nome real (ex.: Helvetica-Bold) diz o que é negrito
    const tc = await page.getTextContent();
    const fontName = (id: string) => { try { return (page.commonObjs.get(id) as any)?.name ?? ''; } catch { return ''; } };
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    const items: Item[] = [];
    for (const raw of tc.items as any[]) {
      if (!raw.str?.trim()) continue;
      const [a, b, , , x, y] = raw.transform as number[];
      const font = `${raw.fontName ?? ''} ${styles[raw.fontName]?.fontFamily ?? ''} ${fontName(raw.fontName)}`;
      items.push({ str: raw.str, x, y, w: raw.width ?? 0, size: Math.round(Math.hypot(a, b) * 10) / 10, bold: /bold|black|heavy|semibold/i.test(font) });
    }
    // agrupa por linha (mesma altura, com tolerância) e ordena da esquerda para a direita
    items.sort((m, n) => n.y - m.y || m.x - n.x);
    for (const it of items) {
      const last = lines.at(-1);
      if (last && last.page === p && Math.abs(last.y - it.y) <= Math.max(2, it.size * 0.35)) last.items.push(it);
      else lines.push({ items: [it], y: it.y, size: it.size, bold: it.bold, text: '', page: p });
    }
  }
  for (const l of lines) {
    l.items.sort((m, n) => m.x - n.x);
    l.size = Math.max(...l.items.map((i) => i.size));
    l.bold = l.items.every((i) => i.bold);
    // trechos em negrito no meio de uma linha comum viram *negrito*
    l.text = joinItems(l.bold ? l.items : l.items.map((i) => (i.bold && i.str.trim() ? { ...i, str: i.str.replace(/^(\s*)(.*?)(\s*)$/, '$1*$2*$3') } : i)));
  }
  // título do documento: a maior letra da primeira página, se estiver no começo
  const maxSize = Math.max(...lines.filter((l) => l.page === 1).map((l) => l.size));
  // tamanho do corpo = o mais comum (por quantidade de letras)
  const freq = new Map<number, number>();
  for (const l of lines) freq.set(l.size, (freq.get(l.size) ?? 0) + l.text.length);
  const body = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
  // tira número de página ("3", "3 / 10", "Página 3")
  const content = lines.filter((l) => !/^(p[aá]gina\s*)?\d+(\s*(\/|de)\s*\d+)?$/i.test(l.text.trim()));

  const out: string[] = [];
  let title = '';
  let para: string[] = [];
  let lastY = Infinity, lastPage = 0;
  const flush = () => { if (para.length) { out.push(`  <txt: ${esc(para.join(' ').replace(/\s+/g, ' ').trim())}>`); para = []; } };
  for (let k = 0; k < content.length; k++) {
    const l = content[k];
    // tabela: linha com 2+ colunas separadas por espaço largo, seguida de outras com o mesmo número de colunas
    const cols = columns(l, body);
    if (cols.length >= 2) {
      const block = [cols];
      let j = k + 1;
      while (j < content.length && content[j].page === l.page) { const c = columns(content[j], body); if (c.length !== cols.length) break; block.push(c); j++; }
      if (block.length >= 2) { flush(); out.push(tableRowsToPseudo(block, '  ')); k = j - 1; lastY = content[j - 1].y; lastPage = l.page; continue; }
    }
    const bullet = /^\s*([•●◦▪‣–\-*]|\d+[.)])\s+/.exec(l.text);
    if (bullet) {
      flush();
      const ordered = /\d/.test(bullet[1]);
      const items = [l.text.slice(bullet[0].length)];
      let j = k + 1;
      while (j < content.length) {
        const b = /^\s*([•●◦▪‣–\-*]|\d+[.)])\s+/.exec(content[j].text);
        if (b) { items.push(content[j].text.slice(b[0].length)); j++; continue; }
        // linha que continua o tópico anterior (sem marcador, mesma letra, recuada)
        if (content[j].size === l.size && content[j].items[0].x > l.items[0].x + 2 && content[j].page === content[j - 1].page) { items[items.length - 1] += ` ${content[j].text}`; j++; continue; }
        break;
      }
      out.push(`  <lst${ordered ? '.num' : ''}: ${items.map((t) => `- ${esc(t.trim())}`).join('\n    ')}>`);
      k = j - 1; lastY = content[j - 1].y; lastPage = content[j - 1].page;
      continue;
    }
    const heading = l.size >= body * 1.6 ? 'h1' : l.size >= body * 1.3 ? 'h2' : (l.size >= body * 1.12 || (l.bold && l.text.length < 90 && !/[.:;,]$/.test(l.text))) ? 'h3' : null;
    if (heading) {
      flush();
      if (!title && out.length === 0 && l.page === 1 && l.size >= maxSize - 0.5) { title = l.text.replace(/^\*|\*$/g, ''); continue; }
      out.push(`  <${heading === 'h1' ? 'h1.anton' : heading}: ${esc(l.text)}>`);
      lastY = l.y; lastPage = l.page;
      continue;
    }
    // parágrafo: junta linhas próximas; espaço maior (ou mudança de página com frase terminada) começa outro
    const gap = lastPage === l.page ? lastY - l.y : Infinity;
    if (para.length && (gap > l.size * 1.9 || (lastPage !== l.page && /[.!?:]$/.test(para.at(-1)!)))) flush();
    const prev = para.at(-1);
    if (prev && /-$/.test(prev) && /^[a-zà-ú]/.test(l.text)) para[para.length - 1] = prev.slice(0, -1) + l.text;   // palavra quebrada com hífen
    else para.push(l.text);
    lastY = l.y; lastPage = l.page;
  }
  flush();
  return `<doc: ${esc(title || name || 'Documento importado').replace(/\(/g, '\\(')} (\n${out.join('\n')}\n)>\n`;
}

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/</g, '\\<').replace(/>/g, '\\>');
/** Junta os pedaços de texto de uma linha pondo espaço onde há distância entre eles. */
function joinItems(items: Item[]) {
  let s = '';
  items.forEach((it, i) => {
    if (i) { const prev = items[i - 1]; const gap = it.x - (prev.x + prev.w); if (gap > it.size * 0.15 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' '; }
    s += it.str;
  });
  return s.replace(/\s+/g, ' ').trim();
}
/** Colunas de uma linha: pedaços separados por um espaço largo (≥ 1,8× a letra do corpo). */
function columns(l: Line, body: number) {
  const out: Item[][] = [[]];
  l.items.forEach((it, i) => {
    if (i) { const prev = l.items[i - 1]; if (it.x - (prev.x + prev.w) >= body * 1.8) out.push([]); }
    out.at(-1)!.push(it);
  });
  return out.length >= 2 ? out.map(joinItems) : [];
}
