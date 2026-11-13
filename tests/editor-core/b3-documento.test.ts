// B3 · página (marca d'água, borda, numeração, linhas), autocorreção, sinônimos, proteção, inspeção, formulários e mala direta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, sha256, autocorrect } from '../../src/editor-core/index.ts';

const setup = () => {
  const e = createEngine(createDocument('DOCUMENT_EDITOR'));
  const blk = e.state.activeSurface!;
  const p = (text: string) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: blk, data: { text } } }).id as string;
  const txt = (id: string) => e.get(id).data.runs.map((r: any) => r.text).join('');
  return { e, blk, p, txt };
};

test('sha256 confere com o padrão', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

test('página: marca d\'água, borda, numeração romana, números de linha, hifenização, medianiz e espelhadas', () => {
  const { e } = setup();
  assert.deepEqual(e.run({ type: 'SET_WATERMARK', payload: { text: 'CONFIDENCIAL' } }), { text: 'CONFIDENCIAL', color: '#C0C0C0', opacity: 0.15, diagonal: true, fontSize: 72 });
  assert.throws(() => e.run({ type: 'SET_WATERMARK', payload: { opacity: 0.5 } }), /texto|imagem/);
  e.run({ type: 'SET_PAGE_BORDER', payload: { style: 'DOUBLE', width: 3, color: '#FBBF00' } });
  assert.equal((e.doc.document.settings as any).pageBorder.style, 'DOUBLE');
  assert.deepEqual((e.run({ type: 'SET_PAGE_NUMBERING', payload: { format: 'LOWER_ROMAN', start: 1 } }) as any).sample, ['i', 'ii', 'iii']);
  e.run({ type: 'SET_LINE_NUMBERS', payload: { countBy: 5, restart: 'SECTION' } });
  e.run({ type: 'SET_HYPHENATION', payload: { auto: true } });
  const page = e.run({ type: 'SET_PAGE', payload: { gutter: 36, mirrorMargins: true, verticalAlign: 'CENTER' } }) as any;
  assert.deepEqual([page.gutter, page.mirrorMargins, page.verticalAlign], [36, true, 'CENTER']);
  e.run({ type: 'SET_WATERMARK', payload: null as any });
  assert.equal((e.doc.document.settings as any).watermark, undefined);
});

test('autocorreção: regras, duas maiúsculas, início de frase; regra própria e documento inteiro', () => {
  const { e, p, txt } = setup();
  assert.equal(autocorrect('vc viu (c) 2024 -- OLha. tb acho', [['vc', 'você'], ['(c)', '©'], ['--', '—'], ['tb', 'também']]), 'Você viu © 2024 — Olha. Também acho');
  assert.equal(e.run({ type: 'AUTOCORRECT_TEXT', payload: { text: 'entao, informacao' } }), 'Então, informação');
  e.run({ type: 'ADD_AUTOCORRECT', payload: { from: 'hd', to: 'Hallan Dante' } });
  e.run({ type: 'REMOVE_AUTOCORRECT', payload: { from: 'q' } });
  const a = p('o hd disse q vc ja sabia');
  assert.equal(e.run({ type: 'AUTOCORRECT_DOCUMENT' }), 1);
  assert.equal(txt(a), 'O Hallan Dante disse q você já sabia');
});

test('sinônimos: dicionário de base, mão dupla e os do documento', () => {
  const { e } = setup();
  assert.ok((e.run({ type: 'THESAURUS', payload: { word: 'Importante' } }) as string[]).includes('relevante'));
  assert.ok((e.run({ type: 'THESAURUS', payload: { word: 'relevante' } }) as string[]).includes('importante'));
  e.run({ type: 'ADD_SYNONYMS', payload: { word: 'portfólio', synonyms: ['acervo', 'coleção'] } });
  assert.deepEqual(e.run({ type: 'THESAURUS', payload: { word: 'portfólio' } }), ['acervo', 'coleção']);
});

test('proteção com senha: só leitura, só comentários, só formulário; final; desproteger', () => {
  const { e, p } = setup();
  const a = p('texto');
  e.run({ type: 'PROTECT_DOCUMENT', payload: { mode: 'READ_ONLY', password: 'segredo' } });
  assert.doesNotMatch(JSON.stringify(e.doc.document.settings), /segredo/);
  assert.throws(() => e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'x' } }), /só leitura/);
  assert.throws(() => e.run({ type: 'UNPROTECT_DOCUMENT', payload: { password: 'errada' } }), /Senha incorreta/);
  e.run({ type: 'UNPROTECT_DOCUMENT', payload: { password: 'segredo' } });
  e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'livre' } });
  const f = e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'nome', formType: 'TEXT', required: true } }) as string;
  e.run({ type: 'PROTECT_DOCUMENT', payload: { mode: 'FORMS' } });
  assert.throws(() => e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'x' } }), /formulário/);
  e.run({ type: 'SET_FORM_VALUE', payload: { name: 'nome', value: 'Ana' } });
  assert.equal(e.get(f).data.value, 'Ana');
  e.run({ type: 'UNPROTECT_DOCUMENT' });
  e.run({ type: 'MARK_FINAL' });
  assert.throws(() => e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'x' } }), /final/);
  e.run({ type: 'MARK_FINAL', payload: { final: false } });
  e.run({ type: 'TEXT_SET', targetId: a, payload: { text: 'de novo' } });
});

test('inspecionar e remover informações pessoais', () => {
  const { e, p } = setup();
  e.run({ type: 'SET_USER', payload: { id: 'u1', name: 'Hallan' } });
  const a = p('oi');
  e.run({ type: 'ADD_COMMENT', targetId: a, payload: { text: 'revisar' } });
  e.run({ type: 'FORMAT', targetId: a, payload: { hidden: true } });
  const r = e.run({ type: 'INSPECT_DOCUMENT' }) as any;
  assert.deepEqual([r.comments, r.hiddenText, r.authors.includes('u1')], [1, 1, true]);
  assert.ok((e.run({ type: 'REMOVE_PERSONAL_INFO' }) as number) >= 1);
  const r2 = e.run({ type: 'INSPECT_DOCUMENT' }) as any;
  assert.ok(!r2.authors.includes('u1'));
});

test('formulário: tipos validados, texto exibido, dados e obrigatórios', () => {
  const { e } = setup();
  e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'nome', label: 'Nome', formType: 'TEXT', required: true, maxLength: 20 } });
  e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'idade', formType: 'NUMBER', min: 0, max: 130 } });
  e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'nascimento', formType: 'DATE' } });
  const c = e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'aceite', formType: 'CHECKBOX', required: true } }) as string;
  const d = e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'plano', formType: 'DROPDOWN', options: ['Básico', 'Pro'] } }) as string;
  assert.throws(() => e.run({ type: 'INSERT_FORM_FIELD', payload: { name: 'nome', formType: 'TEXT' } }), /Já existe/);
  assert.throws(() => e.run({ type: 'SET_FORM_VALUE', payload: { name: 'idade', value: 200 } }), /máximo 130/);
  assert.throws(() => e.run({ type: 'SET_FORM_VALUE', payload: { name: 'plano', value: 'Gold' } }), /opções/);
  assert.throws(() => e.run({ type: 'SET_FORM_VALUE', payload: { name: 'nascimento', value: '31/12/2000' } }), /AAAA-MM-DD/);
  assert.deepEqual((e.run({ type: 'VALIDATE_FORM' }) as any[]).map((x) => x.name), ['nome', 'aceite']);
  e.run({ type: 'SET_FORM_VALUE', payload: { name: 'nome', value: 'Ana' } });
  e.run({ type: 'SET_FORM_VALUE', payload: { name: 'idade', value: '31' } });
  e.run({ type: 'SET_FORM_VALUE', payload: { name: 'nascimento', value: '1993-04-05' } });
  e.run({ type: 'SET_FORM_VALUE', targetId: c, payload: { value: true } });
  e.run({ type: 'SET_FORM_VALUE', targetId: d, payload: { value: 'Pro' } });
  assert.deepEqual(e.run({ type: 'FORM_DATA' }), { nome: 'Ana', idade: 31, nascimento: '1993-04-05', aceite: true, plano: 'Pro' });
  assert.deepEqual(e.run({ type: 'VALIDATE_FORM' }), []);
  assert.equal(e.run({ type: 'FIELD_TEXT', targetId: c }), '☒');
});

test('mala direta: CSV, campos, pré-visualização e geração de um documento por registro', () => {
  const { e, p } = setup();
  assert.deepEqual(e.run({ type: 'SET_MERGE_SOURCE', payload: { csv: 'nome;cidade\nAna;Recife\n"Silva; Bruno";São Paulo\nCaio;Recife\n' } }), { records: 3, fields: ['nome', 'cidade'] });
  p('Prezado(a),');
  const f = e.run({ type: 'INSERT_MERGE_FIELD', payload: { name: 'nome' } }) as string;
  p('Sua cidade: «cidade».');
  assert.throws(() => e.run({ type: 'INSERT_MERGE_FIELD', payload: { name: 'email' } }), /não tem o campo email/);
  assert.equal(e.run({ type: 'FIELD_TEXT', targetId: f }), '«nome»');
  e.run({ type: 'MERGE_PREVIEW', payload: { record: 1 } });
  assert.equal(e.run({ type: 'FIELD_TEXT', targetId: f }), 'Silva; Bruno');
  const out = e.run({ type: 'MERGE_RUN', payload: { filter: { field: 'cidade', equals: 'Recife' } } }) as any;
  assert.equal(out.count, 2);
  const texts = (d: any) => Object.values<any>(d.nodes).filter((n) => Array.isArray(n.data.runs)).map((n) => n.data.runs.map((r: any) => r.text).join(''));
  assert.ok(texts(out.documents[0]).includes('Ana') && texts(out.documents[0]).includes('Sua cidade: Recife.'));
  assert.ok(texts(out.documents[1]).includes('Caio'));
  assert.equal(out.documents[0].document.settings.mailMerge, undefined);
});
