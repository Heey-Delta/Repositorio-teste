// Blocos extras do editor de publicações: gráfico, diagrama, equação e círculo (a tabela vem do TableKit).
// Cada bloco é um nó "atômico": aparece desenhado igual ao site (src/lib/rich-blocks.ts), vira uma linha
// ":::nome {atributos} :::" no Markdown e abre a janela de edição com duplo clique (ou Enter quando selecionado).
import { Node as TiptapNode, createAtomBlockMarkdownSpec } from '@tiptap/core';
import { blockHtml, parseAttrs, serializeAttrs, type BlockName } from '../lib/rich-blocks.ts';
import { openBlockDialog } from '../editor-ui/block-dialog.ts';

const DEFAULTS: Record<BlockName, Record<string, string>> = {
  chart: { type: 'COLUMN', title: '', data: '' },
  diagram: { type: 'ORGCHART', outline: '' },
  math: { tex: '' },
  circle: { text: '', color: '#FBBF00', size: '160' },
};

function makeBlock(name: BlockName) {
  return TiptapNode.create({
    name, group: 'block', atom: true, draggable: true, selectable: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(DEFAULTS[name]).map(([k, v]) => [k, { default: v }]));
    },
    parseHTML() {
      return [{ tag: `div[data-block="${name}"]`, getAttrs: (el) => { try { return JSON.parse((el as HTMLElement).dataset.attrs ?? '{}'); } catch { return {}; } } }];
    },
    renderHTML({ node }) {
      return ['div', { 'data-block': name, 'data-attrs': JSON.stringify(node.attrs) }];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('div');
        dom.dataset.block = name;
        dom.className = 'rich-block';
        dom.contentEditable = 'false';
        dom.title = 'Duplo clique para editar';
        const draw = (attrs: Record<string, string>) => { try { dom.innerHTML = blockHtml(name, attrs); } catch (x) { dom.textContent = (x as Error).message; } };
        draw(node.attrs as Record<string, string>);
        return {
          dom,
          update: (n) => { if (n.type.name !== name) return false; draw(n.attrs as Record<string, string>); return true; },
          ignoreMutation: () => true,
        };
      };
    },
    ...createAtomBlockMarkdownSpec({ nodeName: name, parseAttributes: (src) => parseAttrs(src), serializeAttributes: (a) => serializeAttrs(a) }),
  });
}

export const RichBlocks = (['chart', 'diagram', 'math', 'circle'] as BlockName[]).map(makeBlock);
export { openBlockDialog };
