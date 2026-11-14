// Blocos extras do editor de publicações: forma, gráfico, diagrama, equação, imagem com tamanho e o círculo antigo
// (a tabela vem do TableKit). Cada bloco é um nó "atômico": aparece desenhado igual ao site (src/lib/rich-blocks.ts),
// vira uma linha ":::nome {atributos} :::" no Markdown e abre a janela de edição com duplo clique (ou Enter).
// Selecionado, mostra as alças nos cantos e nas laterais (como no Word/PowerPoint): arrastar muda largura e altura.
import { Node as TiptapNode, createAtomBlockMarkdownSpec } from '@tiptap/core';
import { blockHtml, parseAttrs, serializeAttrs, SHAPE_DEFAULT, SHEET_DEFAULT, type BlockName } from '../lib/rich-blocks.ts';
import { openBlockDialog } from '../editor-ui/block-dialog.ts';

const SIZE = { width: '', align: 'center' };
export const DEFAULTS: Record<BlockName, Record<string, string>> = {
  shape: { ...SHAPE_DEFAULT },
  // id e name: viram a rota da página de dados (/dados/<publicação>/<nome>) e o {hash.nome} do pseudocódigo
  chart: { id: '', name: '', type: 'COLUMN', title: '', data: '', colors: '', ...SIZE },
  diagram: { id: '', name: '', type: 'ORGCHART', outline: '', ...SIZE },
  math: { tex: '', ...SIZE },
  picture: { src: '', alt: '', ...SIZE },
  slides: { id: '', name: '', deck: '', ...SIZE },
  sheet: { ...SHEET_DEFAULT, name: '', cells: '{}' },
  circle: { text: '', color: '#FBBF00', size: '160' },
  ref: { name: '', url: '' },
};
/** Blocos com altura própria (as alças de cima/baixo mexem na altura); os demais mantêm a proporção. */
const FREE_HEIGHT = new Set<BlockName>(['shape']);
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

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
      return ({ node, editor, getPos }) => {
        let attrs = node.attrs as Record<string, string>;
        const dom = document.createElement('div');
        dom.dataset.block = name;
        dom.className = 'rich-block';
        dom.contentEditable = 'false';
        dom.title = 'Duplo clique para editar';
        const body = document.createElement('div');
        body.className = 'rich-body';
        const frame = document.createElement('div');
        frame.className = 'rich-frame';
        frame.setAttribute('aria-hidden', 'true');
        const draw = () => {
          try { body.innerHTML = blockHtml(name, attrs); } catch (x) { body.textContent = (x as Error).message; }
          if (name === 'slides') {
            wireDeck(body);   // Anterior/Próximo funcionam no editor também
            // no editor a faixa de slides não recebe foco: o primeiro toque seleciona o bloco (antes, ia para a faixa)
            body.querySelectorAll('.lab-deck-track').forEach((t) => t.removeAttribute('tabindex'));
          }
          placeFrame();
        };
        // a moldura acompanha o elemento desenhado (que pode estar alinhado à esquerda, ao centro ou à direita)
        const placeFrame = () => {
          const el = body.firstElementChild as HTMLElement | null;
          if (!el) return;
          frame.style.left = `${el.offsetLeft}px`; frame.style.top = `${el.offsetTop}px`;
          frame.style.width = `${el.offsetWidth}px`; frame.style.height = `${el.offsetHeight}px`;
        };
        if (name !== 'circle' && name !== 'ref') {
          for (const h of HANDLES) {
            if (!FREE_HEIGHT.has(name) && (h === 'n' || h === 's')) continue;
            const dot = document.createElement('span');
            dot.className = `rich-handle rich-${h}`;
            dot.dataset.handle = h;
            frame.append(dot);
          }
          frame.addEventListener('pointerdown', (e) => startResize(e));
        }
        function startResize(e: PointerEvent) {
          const h = (e.target as HTMLElement).dataset.handle;
          const el = body.firstElementChild as HTMLElement | null;
          if (!h || !el) return;
          e.preventDefault(); e.stopPropagation();
          const startX = e.clientX, startY = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
          const max = dom.clientWidth;
          // centralizado cresce para os dois lados: o arrasto conta em dobro
          const k = attrs.align === 'left' || attrs.align === 'right' ? 1 : 2;
          const dirX = h.includes('w') ? -1 : h.includes('e') ? 1 : 0;
          const dirY = h.includes('n') ? -1 : h.includes('s') ? 1 : 0;
          let next: Record<string, string> = {};
          const move = (ev: PointerEvent) => {
            let w = Math.round(Math.min(max, Math.max(24, w0 + dirX * (ev.clientX - startX) * k)));
            let hh = Math.round(Math.max(8, h0 + dirY * (ev.clientY - startY)));
            if (!dirX) w = w0;
            if (!FREE_HEIGHT.has(name) && !dirX) return;
            if (FREE_HEIGHT.has(name) && ev.shiftKey && dirX && dirY) hh = Math.round(w * (h0 / w0)); // Shift mantém a proporção
            next = FREE_HEIGHT.has(name) ? { width: String(w), height: String(dirY ? hh : h0) } : { width: String(w) };
            attrs = { ...attrs, ...next };
            draw();
          };
          const up = () => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
            dom.classList.remove('resizing');
            const pos = typeof getPos === 'function' ? getPos() : null;
            if (pos == null || !Object.keys(next).length) return;
            editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }); return true; }).setNodeSelection(pos).run();
          };
          dom.classList.add('resizing');
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
        }
        dom.append(body, frame);
        draw();
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(placeFrame) : null;
        ro?.observe(dom);
        // imagens e fontes carregam depois: reposiciona a moldura
        dom.addEventListener('load', placeFrame, true);
        return {
          dom,
          update: (n) => { if (n.type.name !== name) return false; node = n; attrs = n.attrs as Record<string, string>; draw(); return true; },
          selectNode: () => { dom.classList.add('ProseMirror-selectednode'); placeFrame(); },
          deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
          stopEvent: (e) => { const t = e.target as HTMLElement; return Boolean(t.classList?.contains('rich-handle') || (e.type !== 'dblclick' && e.type !== 'mousedown' && t.closest?.('.lab-deck-nav button'))); },
          ignoreMutation: () => true,
          destroy: () => ro?.disconnect(),
        };
      };
    },
    ...createAtomBlockMarkdownSpec({ nodeName: name, parseAttributes: (src) => parseAttrs(src), serializeAttributes: (a) => serializeAttrs(a) }),
  });
}

export const RichBlocks = (['shape', 'chart', 'diagram', 'math', 'picture', 'slides', 'sheet', 'circle', 'ref'] as BlockName[]).map(makeBlock);
export { openBlockDialog };

/** Liga os botões e o contador de uma apresentação já na página (site e editor). */
export function wireDeck(root: ParentNode) {
  for (const deck of root.querySelectorAll<HTMLElement>('[data-deck]')) {
    if (deck.dataset.wired) continue;
    deck.dataset.wired = '1';
    const track = deck.querySelector<HTMLElement>('.lab-deck-track')!, count = deck.querySelector<HTMLElement>('[data-deck-count]');
    const total = track.children.length;
    const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const go = (i: number) => track.scrollTo({ left: Math.max(0, Math.min(total - 1, i)) * track.clientWidth, behavior: 'smooth' });
    deck.querySelector('[data-deck-prev]')?.addEventListener('click', () => go(at() - 1));
    deck.querySelector('[data-deck-next]')?.addEventListener('click', () => go(at() + 1));
    track.addEventListener('scroll', () => { if (count) count.textContent = `${at() + 1} / ${total}`; }, { passive: true });
    track.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowRight') { ev.preventDefault(); go(at() + 1); } if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(at() - 1); } });
  }
}
