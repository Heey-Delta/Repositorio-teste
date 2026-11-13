// D1 · seções, mestre e rodapé, notas, apresentador, ensaio, marcações, mídia, folhetos, tópicos, imagens e reutilizar slides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createDocument, exportDocument } from '../../src/editor-core/index.ts';

const deck = (n = 4) => {
  const e = createEngine(createDocument('PRESENTATION_EDITOR'));
  const root = e.doc.document.rootId;
  const ids = [e.state.activeSurface!];
  for (let i = 1; i < n; i++) ids.push(e.run({ type: 'INSERT_STRUCTURE', payload: { structureType: 'SURFACE', surfaceType: 'SLIDE', parentId: root } }) as string);
  ids.forEach((id, i) => e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'TEXT', parentId: id, data: { textType: 'TITLE', text: `Título ${i + 1}` }, layout: { x: 64, y: 40, width: 800, height: 80 } } }));
  return { e, ids };
};

test('seções: criar, listar, renomear, mover e remover', () => {
  const { e, ids } = deck(4);
  const a = e.run({ type: 'ADD_SLIDE_SECTION', payload: { name: 'Abertura', startSlideId: ids[0] } }) as string;
  const b = e.run({ type: 'ADD_SLIDE_SECTION', payload: { name: 'Resultados', startSlideId: ids[2] } }) as string;
  assert.deepEqual((e.run({ type: 'LIST_SLIDE_SECTIONS' }) as any[]).map((s) => [s.name, s.slideIds.length]), [['Abertura', 2], ['Resultados', 2]]);
  e.run({ type: 'RENAME_SLIDE_SECTION', payload: { id: b, name: 'Números' } });
  assert.deepEqual(e.run({ type: 'MOVE_SLIDE_SECTION', payload: { id: b, toIndex: 0 } }), ['Números', 'Abertura']);
  const order = (e.run({ type: 'OUTLINE' }) as any[]).map((x) => x.title);
  assert.deepEqual(order, ['Título 3', 'Título 4', 'Título 1', 'Título 2']);
  e.run({ type: 'REMOVE_SLIDE_SECTION', payload: { id: a, deleteSlides: true } });
  assert.equal((e.run({ type: 'OUTLINE' }) as any[]).length, 2);
});

test('slide mestre: fundo, logotipo e rodapé com número aparecem em todos os slides (menos onde ocultar)', () => {
  const { e, ids } = deck(3);
  const m = e.run({ type: 'ENSURE_MASTER' }) as string;
  e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'SHAPE', parentId: m, data: { shapeType: 'RECTANGLE', text: 'LOGO' }, layout: { x: 1100, y: 20, width: 140, height: 60 } } });
  e.run({ type: 'SET_MASTER', payload: { background: '#000000', footer: { text: 'Hallan · 2026', slideNumber: true, hideOnTitleSlide: true } } });
  assert.equal((e.run({ type: 'LIST_NOTES' }) as any[]).length, 3, 'o mestre não conta como slide');
  e.run({ type: 'SET_SLIDE_MASTER', targetId: ids[2], payload: { hideMaster: true } });
  const svg = (e.run({ type: 'EXPORT_SLIDE_IMAGES' }) as any[]).map((x) => x.data as string);
  assert.equal(svg.length, 3);
  assert.doesNotMatch(svg[0], />Hallan</);   // slide de título sem rodapé
  assert.match(svg[1], /LOGO/); assert.match(svg[1], />Hallan</); assert.match(svg[1], />2</); assert.match(svg[1], /fill="#000000"/);
  assert.doesNotMatch(svg[2], /LOGO/);
  const pptx = exportDocument(e, 'PPTX');
  assert.ok((pptx.data as Uint8Array).length > 1000);
});

test('notas, modo do apresentador com cronômetro, ensaio, ponteiro, tela preta e marcações mantidas', () => {
  const { e, ids } = deck(3);
  let t = 0; e.services.now = () => new Date(1_700_000_000_000 + t * 1000);
  e.run({ type: 'SET_SPEAKER_NOTES', targetId: ids[0], payload: { notes: 'Cumprimentar a turma.' } });
  e.run({ type: 'PRESENT_START' });
  let v = e.run({ type: 'PRESENTER_VIEW' }) as any;
  assert.deepEqual([v.current.title, v.next.title, v.notes, v.total], ['Título 1', 'Título 2', 'Cumprimentar a turma.', 3]);
  t = 45; e.run({ type: 'PRESENT_NEXT' });
  v = e.run({ type: 'PRESENTER_VIEW' }) as any;
  assert.deepEqual([v.current.index, v.elapsedSeconds, v.slideSeconds], [2, 45, 0]);
  e.run({ type: 'RECORD_SLIDE_TIME', targetId: ids[0], payload: { seconds: 45 } });
  assert.equal((e.run({ type: 'SET_SLIDE_TIMINGS', payload: { use: true } }) as any).total, 45);
  assert.equal(e.run({ type: 'SET_POINTER', payload: { mode: 'LASER' } }), 'LASER');
  assert.equal(e.run({ type: 'SET_SCREEN', payload: { mode: 'BLACK' } }), 'BLACK');
  e.run({ type: 'ANNOTATE', payload: { points: [[100, 100], [200, 150], [300, 120]], tool: 'PEN' } });
  e.run({ type: 'ANNOTATE', payload: { points: [[100, 300], [400, 300]], tool: 'HIGHLIGHTER' } });
  assert.equal((e.run({ type: 'PRESENTER_VIEW' }) as any).annotations, 2);
  e.run({ type: 'PRESENT_END' });
  const before = e.get(ids[1]).children.length;
  assert.equal(e.run({ type: 'KEEP_ANNOTATIONS' }), 2);
  const kids = e.get(ids[1]).children.map((c: string) => e.get(c));
  assert.equal(kids.length, before + 2);
  assert.deepEqual([kids.at(-1)!.data.shapeType, kids.at(-1)!.styleOverrides.opacity, kids.at(-2)!.layout.width], ['CUSTOM', 0.5, 200]);
});

test('mídia: cortar, volume, início, repetir e validações', () => {
  const { e, ids } = deck(1);
  const v = e.run({ type: 'INSERT_CONTENT', payload: { contentType: 'VIDEO', parentId: ids[0], data: { url: 'https://example.com/v.mp4' } } }).id as string;
  assert.deepEqual(e.run({ type: 'MEDIA_SETTINGS', targetId: v, payload: { trimStart: 2, trimEnd: 30, volume: 0.5, start: 'AUTO', loop: true, playAcrossSlides: true } }), { trimStart: 2, trimEnd: 30, volume: 0.5, start: 'AUTO', loop: true, playAcrossSlides: true });
  assert.throws(() => e.run({ type: 'MEDIA_SETTINGS', targetId: v, payload: { trimEnd: 1 } }), /depois do início/);
  assert.throws(() => e.run({ type: 'MEDIA_SETTINGS', targetId: v, payload: { volume: 3 } }), /Volume/);
});

test('folhetos, tópicos e reutilizar/mesclar slides de outra apresentação', () => {
  const { e } = deck(7);
  const h = e.run({ type: 'HANDOUT_LAYOUT', payload: { perPage: 6, notes: true } }) as any;
  assert.deepEqual([h.pages.length, h.pages[0].slides.length, h.pages[1].slides.length], [2, 6, 1]);
  assert.ok(h.pages[0].slides[1].x > h.pages[0].slides[0].x);
  assert.equal((e.run({ type: 'HANDOUT_LAYOUT', payload: { perPage: 3 } }) as any).pages[0].noteLines, true);
  const other = deck(2);
  other.e.run({ type: 'ADD_SLIDE_SECTION', payload: { name: 'Anexo', startSlideId: other.ids[0] } });
  const ids = e.run({ type: 'MERGE_PRESENTATION', payload: { from: other.e.doc } }) as string[];
  assert.equal(ids.length, 2);
  const out = e.run({ type: 'OUTLINE' }) as any[];
  assert.deepEqual([out.length, out.at(-1).title], [9, 'Título 2']);
  assert.equal((e.run({ type: 'LIST_SLIDE_SECTIONS' }) as any[]).at(-1).name, 'Anexo');
  const one = e.run({ type: 'REUSE_SLIDES', payload: { from: other.e.doc, slideIds: [other.ids[1]], index: 1 } }) as string[];
  assert.equal((e.run({ type: 'OUTLINE' }) as any[])[0].slideId === one[0] || (e.run({ type: 'OUTLINE' }) as any[]).some((x) => x.slideId === one[0]), true);
});
