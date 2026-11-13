// Gráficos e visualização de dados (Camada 10). O gráfico NÃO guarda cópia dos dados: guarda a fonte
// (intervalo de planilha, tabela ou valores digitados) e as opções visuais. Os dados são lidos na hora (chartData),
// então mudar a planilha muda o gráfico. Quem desenha é o renderizador da interface; este módulo decide O QUE
// desenhar: categorias, séries, eixos, legenda e rótulos.
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { isSheet } from '../formula/service.ts';
import { parseRange } from '../formula/parse.ts';
import { readCell } from '../ops/table.ts';
import { isErr } from '../formula/functions.ts';
import { targetsOf } from '../ops/selection.ts';
import { clone, fail, merge } from '../util.ts';

export const CHART_TYPES = ['BAR', 'COLUMN', 'LINE', 'AREA', 'PIE', 'DOUGHNUT', 'SCATTER', 'BUBBLE', 'RADAR', 'COMBO'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Opções que cada tipo aceita (pizza não tem eixos; dispersão não tem categorias). */
const OPTIONS: Record<ChartType, string[]> = {
  BAR: ['title', 'legend', 'axes', 'labels', 'stacked', 'gridlines'],
  COLUMN: ['title', 'legend', 'axes', 'labels', 'stacked', 'gridlines'],
  LINE: ['title', 'legend', 'axes', 'labels', 'smooth', 'markers', 'gridlines'],
  AREA: ['title', 'legend', 'axes', 'labels', 'stacked', 'smooth', 'gridlines'],
  PIE: ['title', 'legend', 'labels', 'startAngle'],
  DOUGHNUT: ['title', 'legend', 'labels', 'startAngle', 'hole'],
  SCATTER: ['title', 'legend', 'axes', 'labels', 'markers', 'trendline', 'gridlines'],
  BUBBLE: ['title', 'legend', 'axes', 'labels', 'gridlines'],
  RADAR: ['title', 'legend', 'labels', 'markers'],
  COMBO: ['title', 'legend', 'axes', 'labels', 'gridlines', 'smooth'],
};

export interface SeriesData { id: string; name: string; values: (number | null)[]; color?: string; visible: boolean; axis: 'PRIMARY' | 'SECONDARY'; type?: ChartType; sizes?: (number | null)[] }
export interface ChartData { chartType: ChartType; categories: (string | number)[]; series: SeriesData[]; warnings: string[]; error?: string }

function validateSource(e: Engine, s: any) {
  if (!s || !['RANGE', 'TABLE', 'MANUAL'].includes(s.type)) fail('VALIDATION', 'Fonte de dados: RANGE (planilha), TABLE (tabela) ou MANUAL.');
  if (s.type === 'MANUAL') {
    if (!Array.isArray(s.series) || !s.series.length) fail('VALIDATION', 'Informe ao menos uma série com valores.');
    for (const x of s.series) if (!Array.isArray(x.values)) fail('VALIDATION', `A série ${x.name ?? ''} precisa de uma lista de valores.`);
    return;
  }
  if (s.missing) return;   // a planilha/tabela de origem foi excluída: o gráfico existe, mas mostra o aviso
  const t = e.get(s.targetId);
  if (s.type === 'RANGE' && !isSheet(t)) fail('VALIDATION', 'RANGE precisa apontar para uma planilha.');
  if (s.type === 'TABLE' && t.type !== 'TABLE') fail('VALIDATION', 'TABLE precisa apontar para uma tabela.');
  if (s.type === 'RANGE') { try { parseRange(s.range); } catch { fail('VALIDATION', `Intervalo inválido: ${s.range}.`); } }
  if (s.orientation && !['COLUMNS', 'ROWS'].includes(s.orientation)) fail('VALIDATION', 'Orientação: COLUMNS ou ROWS.');
}

export function validateChartData(e: Engine, d: Record<string, any>) {
  if (!CHART_TYPES.includes(d.chartType)) fail('VALIDATION', `Tipo de gráfico: ${CHART_TYPES.join(', ')}.`);
  validateSource(e, d.source);
  const allowed = new Set(OPTIONS[d.chartType as ChartType]);
  if (d.axes && Object.keys(d.axes).length && !allowed.has('axes')) fail('VALIDATION', `Gráfico ${d.chartType} não tem eixos.`);
  if (d.legend?.position && !['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'NONE'].includes(d.legend.position)) fail('VALIDATION', 'Legenda: TOP, BOTTOM, LEFT, RIGHT ou NONE.');
  if (d.labels?.position && !['INSIDE', 'OUTSIDE', 'CENTER'].includes(d.labels.position)) fail('VALIDATION', 'Rótulos: INSIDE, OUTSIDE ou CENTER.');
}

/** Lê a grade de valores da fonte (já calculados: fórmulas viram resultados). */
function grid(e: Engine, s: any): unknown[][] {
  const t = e.get(s.targetId);
  let r: { r1: number; c1: number; r2: number; c2: number };
  if (s.type === 'TABLE' && !s.range) r = { r1: 1, c1: 1, r2: t.data.rows.length, c2: t.data.columns.length };
  else r = parseRange(String(s.range).replace(/^.*!/, ''));
  const out: unknown[][] = [];
  for (let row = r.r1; row <= r.r2; row++) {
    const line: unknown[] = [];
    for (let col = r.c1; col <= r.c2; col++) { const v = readCell(e, t, row, col).display; line.push(isErr(v) ? null : v); }
    out.push(line);
  }
  return s.orientation === 'ROWS' ? out[0].map((_, c) => out.map((line) => line[c])) : out;
}

const num = (v: unknown, warn: () => void): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(',', '.'));
  if (Number.isNaN(n)) { warn(); return null; }
  return n;
};

/** Dados prontos para desenhar: categorias e séries (com as personalizações de nome, cor, eixo e visibilidade). */
export function chartData(e: Engine, chart: EditorNode): ChartData {
  const d = chart.data;
  const out: ChartData = { chartType: d.chartType, categories: [], series: [], warnings: [] };
  const s = d.source;
  if (s?.missing) return { ...out, error: 'A planilha ou tabela de origem foi excluída. Escolha outra fonte de dados.' };
  let base: { name: string; values: unknown[]; sizes?: unknown[] }[] = [];
  if (s.type === 'MANUAL') {
    out.categories = clone(s.categories ?? s.series[0].values.map((_: unknown, i: number) => i + 1));
    base = s.series;
  } else {
    const g = grid(e, s);
    const header = s.header ?? true;
    const cols = g[0]?.length ?? 0;
    const hasCats = s.categoriesInFirst ?? (cols > 1);
    const body = header ? g.slice(1) : g;
    out.categories = hasCats ? body.map((line, i) => (line[0] === null ? `${i + 1}` : line[0] as string | number)) : body.map((_, i) => i + 1);
    for (let c = hasCats ? 1 : 0; c < cols; c++) base.push({ name: header ? String(g[0][c] ?? `Série ${c}`) : `Série ${base.length + 1}`, values: body.map((line) => line[c]) });
    if (d.chartType === 'BUBBLE' && base.length >= 2) base = [{ name: base[0].name, values: base[0].values, sizes: base[1].values }];
  }
  const overrides: any[] = d.series ?? [];
  out.series = base.map((b, i) => {
    const o = overrides.find((x) => x.index === i) ?? {};
    return {
      id: o.id ?? `SER_${i + 1}`,
      name: o.name ?? b.name ?? `Série ${i + 1}`,
      values: b.values.map((v) => num(v, () => out.warnings.push(`"${String(v)}" em ${b.name} não é número e ficou de fora.`))),
      ...(b.sizes ? { sizes: b.sizes.map((v) => num(v, () => {})) } : {}),
      ...(o.color ? { color: o.color } : {}),
      visible: o.visible ?? true,
      axis: o.axis ?? 'PRIMARY',
      ...(o.type ? { type: o.type } : {}),
    };
  });
  if (['PIE', 'DOUGHNUT'].includes(d.chartType) && out.series.length > 1) out.warnings.push('Pizza e rosca mostram só a primeira série.');
  if (['PIE', 'DOUGHNUT'].includes(d.chartType) && out.series[0]?.values.some((v) => v !== null && v < 0)) out.warnings.push('Pizza não representa valores negativos.');
  return out;
}

/** Gráficos que leem de um nó (planilha/tabela): os que precisam ser redesenhados quando ele muda. */
export const chartsUsing = (e: Engine, sourceId: string) => Object.values(e.doc.nodes).filter((n) => n.type === 'CHART' && n.data.source?.targetId === sourceId).map((n) => n.id);

function chartNode(e: Engine, id: string | null | undefined, editable = true) {
  const n = e.get(id);
  if (n.type !== 'CHART') fail('INVALID_OPERATION', `${n.id} não é um gráfico.`);
  if (!editable) return n;
  e.assertEditable(n.id);
  return e.touchNode(n.id);
}

export const chartHandlers: Record<string, Handler> = {
  /** CREATE_CHART { chartType, source, parentId?, layout? } — atalho para INSERT_CONTENT de CHART. */
  CREATE_CHART: (e, op) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'CHART', parentId: op.payload?.parentId, layout: op.payload?.layout, data: { ...op.payload } } }),

  SET_CHART_TYPE: (e, op) => targetsOf(e, op).map((id) => { const n = chartNode(e, id); n.data.chartType = op.payload?.chartType; if (!OPTIONS[n.data.chartType as ChartType]?.includes('axes')) n.data.axes = {}; validateChartData(e, n.data); return id; }),

  /** Troca a fonte (outra planilha, outro intervalo, tabela ou valores digitados). */
  SET_DATA_SOURCE: (e, op) => { const n = chartNode(e, op.targetId); n.data.source = clone(op.payload?.source); validateChartData(e, n.data); return chartData(e, n); },
  UPDATE_DATA_SOURCE: (e, op) => { const n = chartNode(e, op.targetId); n.data.source = merge(n.data.source, op.payload ?? {}); delete n.data.source.missing; validateChartData(e, n.data); return chartData(e, n); },

  /** Série nova: em fonte MANUAL, { name, values }; em planilha, amplie o intervalo da fonte. */
  ADD_SERIES: (e, op) => {
    const n = chartNode(e, op.targetId);
    if (n.data.source.type !== 'MANUAL') fail('INVALID_OPERATION', 'Para gráficos ligados a planilha ou tabela, inclua a coluna no intervalo da fonte (UPDATE_DATA_SOURCE).');
    const { name = `Série ${n.data.source.series.length + 1}`, values = [] } = op.payload ?? {};
    n.data.source.series.push({ name, values });
    validateChartData(e, n.data);
    return n.data.source.series.length - 1;
  },
  REMOVE_SERIES: (e, op) => {
    const n = chartNode(e, op.targetId);
    const i = Number(op.payload?.index);
    if (n.data.source.type === 'MANUAL') { if (n.data.source.series.length <= 1) fail('INVALID_OPERATION', 'O gráfico precisa de pelo menos uma série.'); n.data.source.series.splice(i, 1); }
    else { n.data.series = [...(n.data.series ?? []).filter((x: any) => x.index !== i), { index: i, visible: false }]; }   // em planilha: esconde
    return i;
  },
  /** UPDATE_SERIES { index, name?, color?, visible?, axis?, type?, values? (só MANUAL) } */
  UPDATE_SERIES: (e, op) => {
    const n = chartNode(e, op.targetId);
    const { index, values, ...rest } = op.payload ?? {};
    if (values) { if (n.data.source.type !== 'MANUAL') fail('INVALID_OPERATION', 'Os valores vêm da planilha; altere as células.'); n.data.source.series[index].values = values; }
    if (rest.axis && !['PRIMARY', 'SECONDARY'].includes(rest.axis)) fail('VALIDATION', 'Eixo: PRIMARY ou SECONDARY.');
    if (rest.type && n.data.chartType !== 'COMBO') fail('VALIDATION', 'Tipo por série só em gráfico combinado (COMBO).');
    const list = n.data.series ?? [];
    const cur = list.find((x: any) => x.index === index) ?? {};
    n.data.series = [...list.filter((x: any) => x.index !== index), merge({ ...cur, index }, rest)];
    return index;
  },

  /** SET_CHART_OPTION { option: title|legend|axes|labels|stacked|…, value } — valida se o tipo aceita a opção. */
  SET_CHART_OPTION: (e, op) => {
    const n = chartNode(e, op.targetId);
    const { option, value } = op.payload ?? {};
    if (!OPTIONS[n.data.chartType as ChartType].includes(option)) fail('VALIDATION', `Gráfico ${n.data.chartType} não tem a opção "${option}".`);
    n.data[option] = value !== null && typeof value === 'object' && !Array.isArray(value) ? merge(n.data[option] ?? {}, value) : value;
    validateChartData(e, n.data);
    return n.data[option];
  },

  /** Dados atuais para desenhar (consulta). */
  CHART_DATA: (e, op) => chartData(e, chartNode(e, op.targetId, false)),
  REFRESH_CHART: (e, op) => { const data = chartData(e, chartNode(e, op.targetId, false)); e.emit('chart', { id: op.targetId, data }); return data; },
  CHARTS_USING: (e, op) => chartsUsing(e, op.targetId ?? fail('INVALID_PAYLOAD', 'Informe targetId (planilha ou tabela).')),
};

/** Liga a atualização automática: quando uma planilha/tabela muda, avisa os gráficos que dependem dela. */
export function watchCharts(e: Engine) {
  e.on('change', ({ transaction }) => {
    const changed = new Set<string>(transaction.changes.filter((c: any) => c.collection === 'nodes').map((c: any) => c.id));
    const affected = new Set<string>();
    for (const id of changed) for (const cid of chartsUsing(e, id)) affected.add(cid);
    for (const id of affected) e.emit('chart', { id, data: chartData(e, e.get(id)) });
  });
}
