// Marcador de referência: <ref: nome | link> no pseudocódigo, :::ref no Markdown e a lista numerada do fim no site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { parsePseudo, pseudoToPost, postToPseudo, pseudoToModel } from '../../src/lib/pseudo.ts';
import { markedBlocks } from '../../src/lib/rich-blocks.ts';
import { linkCitations, pullRefs, refsFromList, refsListHtml } from '../../src/lib/refs.ts';

const SRC = `<doc: Teste (
  <txt: Turing propôs o teste [1] e Dartmouth deu nome à área [2]. Fora da lista: [9].>
  <ref: Turing, A. M. Computing Machinery and Intelligence. Mind, 1950. | https://doi.org/10.1093/mind/LIX.236.433>
  <ref: McCarthy, J. et al. A Proposal for the Dartmouth Summer Research Project (1955). | https://ojs.aaai.org/index.php/aimagazine/article/view/1904>
)>`;

test('<ref: nome | link> vira :::ref e volta igual', () => {
  const n = parsePseudo(SRC)[0].children!.filter((c) => c.tag === 'ref');
  assert.equal(n.length, 2);
  const { body } = pseudoToPost(SRC);
  assert.match(body, /:::ref \{name="Turing, A\. M\. Computing Machinery and Intelligence\. Mind, 1950\." url="https:\/\/doi\.org\/10\.1093\/mind\/LIX\.236\.433"\} :::/);
  const again = pseudoToPost(postToPseudo('Teste', body)).body;
  assert.equal(again, body);
  assert.match(postToPseudo('Teste', body), /<ref: McCarthy, J\. et al\. A Proposal for the Dartmouth Summer Research Project \(1955\)\. \| https:\/\/ojs/);
});

test('no site: referências saem do meio, ficam numeradas no fim e [n] vira link', () => {
  const { body } = pseudoToPost(SRC);
  const tokens = new Marked({ gfm: true, extensions: markedBlocks() } as any).lexer(body) as any[];
  const refs = pullRefs(tokens);
  assert.deepEqual(refs.map((r) => r.url.slice(0, 15)), ['https://doi.org', 'https://ojs.aaa']);
  const html = linkCitations(new Marked({ gfm: true, extensions: markedBlocks() } as any).parser(tokens) as string, refs.length);
  assert.match(html, /<a href="#ref-1" class="lab-cite">\[1\]<\/a>/);
  assert.match(html, /<a href="#ref-2" class="lab-cite">\[2\]<\/a>/);
  assert.match(html, /\[9\]/);
  assert.doesNotMatch(html, /#ref-9/);
  assert.doesNotMatch(html, /lab-ref-edit/);
  const list = refsListHtml(refs);
  assert.match(list, /<li id="ref-1"><a href="https:\/\/doi\.org\/10\.1093\/mind\/LIX\.236\.433" target="_blank" rel="noopener">Turing/);
});

test('[n] dentro de link ou código não é mexido', () => {
  const html = linkCitations('<p>ver [1] e <a href="x">[1]</a> e <code>a[1]</code></p>', 3);
  assert.equal((html.match(/lab-cite/g) ?? []).length, 1);
});

test('PDF/DOCX: as referências entram numeradas no fim, com link', () => {
  const m = pseudoToModel(SRC);
  const last = m.blocks!.at(-1) as any;
  assert.equal(last.kind, 'list');
  assert.equal(last.listType, 'NUMBERED');
  assert.equal(last.items[0].runs[1].format.link, 'https://doi.org/10.1093/mind/LIX.236.433');
});

test('lista "## Referências" antiga vira marcadores :::ref', () => {
  const md = 'Texto [1].\n\n## Referências\n\n1. Autor. Título um. Editora, 2020. [https://a.org/x](https://a.org/x)\n2. Autor dois. Título dois, 2021. https://b.org/y.\n\n## Depois\n\nFim.\n';
  const out = refsFromList(md)!;
  assert.doesNotMatch(out, /## Referências/);
  assert.match(out, /:::ref \{name="Autor\. Título um\. Editora, 2020\." url="https:\/\/a\.org\/x"\} :::/);
  assert.match(out, /:::ref \{name="Autor dois\. Título dois, 2021\." url="https:\/\/b\.org\/y"\} :::/);
  assert.match(out, /## Depois\n\nFim\./);
  assert.equal(refsFromList(out), null);
});
