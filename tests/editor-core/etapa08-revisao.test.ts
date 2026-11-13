// Etapa 08: ortografia, gramática, estilo, acessibilidade, consistência, correções, tradução e estatísticas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, translateContent, contrastRatio } from '../../src/editor-core/index.ts';

function doc(app: any = 'DOCUMENT_EDITOR') {
  const e = createEngine(createDocument(app));
  const ins = (contentType: string, data: any, parentId = e.state.activeSurface!) => e.run({ type: 'INSERT_CONTENT', payload: { contentType, parentId, data } }).id as string;
  const txt = (text: string, textType = 'PARAGRAPH') => ins('TEXT', { text, textType });
  const issues = (type: string, payload: any = {}) => e.run({ type, payload }) as any[];
  const text = (id: string) => e.get(id).data.runs.map((r: any) => r.text).join('');
  return { e, ins, txt, issues, text };
}
const rules = (list: any[]) => list.map((i) => i.rule);

test('ortografia: erros comuns, provedor de dicionário e dicionário do documento', () => {
  const { e, txt, issues } = doc();
  const p = txt('Derrepente a excessão virou previlégio do Hallan.');
  const sp = issues('CHECK_SPELLING');
  assert.deepEqual(sp.map((i) => [i.text, i.suggestions[0]]), [['Derrepente', 'De repente'], ['excessão', 'exceção'], ['previlégio', 'privilégio']]);
  assert.equal(sp[0].nodeId, p);
  e.services.spellcheck = { check: (w: string) => !['Hallan'].includes(w), suggest: () => ['Allan'] };
  assert.deepEqual(issues('CHECK_SPELLING').map((i) => i.rule).at(-1), 'UNKNOWN_WORD');
  e.run({ type: 'ADD_TO_DICTIONARY', payload: { word: 'Hallan' } });
  assert.equal(issues('CHECK_SPELLING').length, 3, 'palavra do dicionário do documento não é erro');
  e.run({ type: 'UNDO' });
  assert.equal(issues('CHECK_SPELLING').length, 4);
});

test('gramática: espaços, pontuação, repetição, maiúscula, crase, haver/fazer, para mim', () => {
  const { txt, issues } = doc();
  txt('Eu  fui ao mercado , comprei pão,leite e e café. depois voltei (cansado. O Sr. silva chegou.');
  txt('Houveram problemas. Fazem dois anos que saí. Voltei à partir de hoje e entreguei à ele. Isto é para mim fazer.');
  const g = issues('CHECK_GRAMMAR');
  for (const r of ['DOUBLE_SPACE', 'SPACE_BEFORE_PUNCT', 'MISSING_SPACE_AFTER_PUNCT', 'REPEATED_WORD', 'SENTENCE_CAPITAL', 'UNBALANCED_PARENS', 'HAVER_IMPESSOAL', 'FAZER_TEMPO', 'CRASE_BEFORE_VERB', 'CRASE_BEFORE_PRONOUN', 'PARA_MIM_INFINITIVO']) assert.ok(rules(g).includes(r), r);
  assert.equal(g.filter((i) => i.rule === 'SENTENCE_CAPITAL').length, 1, 'abreviação "Sr." não exige maiúscula');
  assert.deepEqual(g.find((i) => i.rule === 'FAZER_TEMPO').suggestions, ['faz dois anos']);
});

test('corrigir: uma sugestão, todas de uma regra, ignorar e desfazer', () => {
  const { e, txt, issues, text } = doc();
  const p = txt('Ele  foi  embora concerteza. Eu  voltei.');
  const sp = issues('CHECK_SPELLING')[0];
  e.run({ type: 'APPLY_SUGGESTION', payload: { issueId: sp.id } });
  assert.equal(text(p), 'Ele  foi  embora com certeza. Eu  voltei.');
  assert.equal(e.run({ type: 'APPLY_ALL_SUGGESTIONS', payload: { rule: 'DOUBLE_SPACE' } }), 3);
  assert.equal(text(p), 'Ele foi embora com certeza. Eu voltei.');
  e.run({ type: 'UNDO' });
  assert.equal(text(p), 'Ele  foi  embora com certeza. Eu  voltei.');
  const ds = issues('CHECK_GRAMMAR');
  e.run({ type: 'IGNORE_ISSUE', payload: { issueId: ds[0].id } });
  assert.equal(issues('CHECK_GRAMMAR').length, ds.length - 1);
  e.run({ type: 'SET_REVIEW_OPTIONS', payload: { disabledRules: ['DOUBLE_SPACE'] } });
  assert.equal(issues('CHECK_GRAMMAR').length, 0);
  assert.equal(e.execute({ type: 'APPLY_SUGGESTION', payload: { issueId: 'nada' } }).ok, false);
});

test('estilo: frase longa, voz passiva, expressões, repetição próxima', () => {
  const { txt, issues, e } = doc();
  txt(Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(' ') + '.');
  txt('O relatório foi aprovado pela equipe. Vamos fazer uma análise a nível de empresa. O orçamento mudou e o orçamento cresceu.');
  const s = issues('CHECK_STYLE');
  for (const r of ['LONG_SENTENCE', 'PASSIVE_VOICE', 'WORDY', 'REPEATED_NEAR']) assert.ok(rules(s).includes(r), r);
  assert.deepEqual(s.filter((i) => i.rule === 'WORDY').map((i) => i.suggestions[0]), ['analisar', 'em']);
  e.run({ type: 'SET_REVIEW_OPTIONS', payload: { maxSentenceWords: 50 } });
  assert.ok(!rules(issues('CHECK_STYLE')).includes('LONG_SENTENCE'));
});

test('acessibilidade: alt, contraste, títulos, tabela, link, slide sem título', () => {
  const { e, ins, txt, issues } = doc();
  const asset = e.run({ type: 'IMPORT_ASSET', payload: { type: 'IMAGE', name: 'a', source: '/a' } });
  ins('IMAGE', { assetId: asset, alt: '' });
  ins('IMAGE', { assetId: asset, alt: '', decorative: true });
  txt('Capítulo', 'HEADING_1');
  txt('Detalhe', 'HEADING_3');
  const low = txt('cinza claro');
  e.run({ type: 'FORMAT', targetId: low, payload: { color: '#DDDDDD' } });
  ins('TABLE', { values: [['a', 'b'], [1, 2]], header: false });
  ins('LINK', { url: 'https://hallan.dev', text: 'clique aqui' });
  const a = issues('CHECK_ACCESSIBILITY');
  for (const r of ['IMAGE_ALT', 'HEADING_ORDER', 'CONTRAST', 'TABLE_HEADER', 'LINK_TEXT']) assert.ok(rules(a).includes(r), r);
  assert.equal(a.filter((i) => i.rule === 'IMAGE_ALT').length, 1, 'imagem decorativa não precisa de alt');
  assert.ok(contrastRatio('#000000', '#FFFFFF') > 20 && contrastRatio('#777777', '#777777') === 1);

  const p = doc('PRESENTATION_EDITOR');
  assert.ok(rules(p.issues('CHECK_ACCESSIBILITY')).includes('SLIDE_TITLE'));
  p.txt('Resultados', 'TITLE');
  assert.ok(!rules(p.issues('CHECK_ACCESSIBILITY')).includes('SLIDE_TITLE'));
  const dark = p.txt('texto amarelo');
  p.e.run({ type: 'FORMAT', targetId: dark, payload: { color: '#FBBF00' } });
  p.e.run({ type: 'FORMAT', targetId: p.e.state.activeSurface!, payload: { fill: '#000000' } });
  const contrast = p.issues('CHECK_ACCESSIBILITY').filter((i) => i.rule === 'CONTRAST').map((i) => i.nodeId);
  assert.ok(!contrast.includes(dark), 'amarelo sobre preto passa');
  assert.equal(contrast.length, 1, 'o título escuro sobre preto não passa');
});

test('consistência: termos, títulos diferentes, fontes misturadas, referência quebrada; revisão completa', () => {
  const { e, ins, txt, issues } = doc();
  txt('Mande um e-mail. Outro e-mail depois. Responda o email.');
  const h1 = txt('Um', 'HEADING_1'); txt('Dois', 'HEADING_1'); const h3 = txt('Três', 'HEADING_1');
  e.run({ type: 'FORMAT', targetId: h3, payload: { fontSize: 40 } });
  for (const f of ['Comic Sans MS', 'Papyrus', 'Impact']) e.run({ type: 'FORMAT', targetId: txt('y'), payload: { fontFamily: f } });
  const t = ins('TABLE', { header: true, values: [['Mês', 'Vendas'], ['Jan', 10]] });
  ins('CHART', { chartType: 'COLUMN', source: { type: 'TABLE', targetId: t }, title: { text: 'V', visible: true } });
  e.run({ type: 'DELETE', targetId: t });
  const c = issues('CHECK_CONSISTENCY');
  const tv = c.find((i) => i.rule === 'TERM_VARIANT');
  assert.equal(tv.text, 'email');
  assert.deepEqual(tv.suggestions, ['e-mail']);
  assert.equal(c.filter((i) => i.rule === 'HEADING_STYLE').map((i) => i.nodeId).includes(h3), true);
  assert.ok(rules(c).includes('MIXED_FONTS'));
  assert.ok(rules(c).includes('BROKEN_REFERENCE'));
  const all = e.run({ type: 'REVIEW_DOCUMENT' }) as any;
  assert.equal(all.summary.total, all.issues.length);
  assert.ok(all.summary.byCategory.CONSISTENCY >= 3);
  e.run({ type: 'APPLY_SUGGESTION', payload: { issueId: tv.id } });
  assert.ok(!rules(issues('CHECK_CONSISTENCY')).includes('TERM_VARIANT'));
});

test('fórmulas com erro entram na revisão', () => {
  const { e, issues } = doc('SPREADSHEET_EDITOR');
  const sh = e.state.activeSurface!;
  e.run({ type: 'SET_CELL', targetId: sh, payload: { cell: 'A1', value: '=1/0' } });
  const r = e.run({ type: 'REVIEW_DOCUMENT', payload: { categories: ['FORMULA'] } }) as any;
  assert.equal(r.issues[0].cell, 'A1');
  assert.equal(r.issues[0].text, '#DIV/0!');
  assert.equal(issues('CHECK_SPELLING').length, 0);
});

test('tradução: provedor assíncrono, formatação mantida, desfazer em um passo', async () => {
  const { e, txt, text } = doc();
  const p = txt('Olá mundo');
  e.run({ type: 'TEXT_FORMAT', targetId: p, payload: { start: 4, end: 9, format: { bold: true } } });
  const dict: Record<string, string> = { 'Olá ': 'Hello ', mundo: 'world' };
  await translateContent(e, { to: 'en' }, async (texts) => texts.map((t) => dict[t] ?? t));
  assert.equal(text(p), 'Hello world');
  assert.equal(e.get(p).data.runs[1].format.bold, true);
  assert.equal(e.get(p).data.lang, 'en');
  e.run({ type: 'UNDO' });
  assert.equal(text(p), 'Olá mundo');
  await assert.rejects(translateContent(e, { to: 'en' }), /tradução/);
});

test('estatísticas do documento', () => {
  const { e, txt, ins } = doc();
  txt('O gato subiu no telhado. Depois desceu.');
  txt('Fim.');
  ins('TABLE', { values: [['a']] });
  const s = e.run({ type: 'DOCUMENT_STATS' }) as any;
  assert.equal(s.words, 8);
  assert.equal(s.sentences, 3);
  assert.equal(s.readingMinutes, 1);
  assert.equal(s.pages, 1);
  assert.equal(s.elements.TABLE, 1);
  assert.ok(s.readability > 50 && s.readability <= 100, 'texto simples é fácil de ler');
});
