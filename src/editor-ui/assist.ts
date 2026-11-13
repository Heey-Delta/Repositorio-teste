// Assistente (IA no servidor), leitura em voz alta, ditado por voz e tema claro/escuro do editor.
import type { Engine } from '../editor-core/index.ts';
import { h, toast } from './dom.ts';

// ---------------------------------------------------------------- tema
const THEME_KEY = 'editor-theme';
export function applyTheme(root: HTMLElement, theme?: 'light' | 'dark') {
  let t = theme;
  if (!t) { try { t = (localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null) ?? 'dark'; } catch { t = 'dark'; } }
  root.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* sem armazenamento: vale só nesta visita */ }
  return t;
}

// ---------------------------------------------------------------- leitura em voz alta
let speaking = false;
export function readAloud(e: Engine, onState: (on: boolean) => void) {
  const synth = (globalThis as any).speechSynthesis as SpeechSynthesis | undefined;
  if (!synth) return toast('Este navegador não lê em voz alta.', 'error');
  if (speaking) { synth.cancel(); speaking = false; onState(false); return; }
  const r = e.execute({ type: 'READING_ORDER', payload: {} });
  const sel = window.getSelection()?.toString().trim();
  const parts: string[] = sel ? [sel] : r.ok ? (r.value as { text: string }[]).map((x) => x.text).filter(Boolean) : [];
  if (!parts.length) return toast('Nada para ler.', 'error');
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt-br')) ?? synth.getVoices().find((v) => v.lang.startsWith('pt'));
  speaking = true; onState(true);
  parts.forEach((txt, i) => {
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'pt-BR'; if (voice) u.voice = voice;
    if (i === parts.length - 1) u.onend = () => { speaking = false; onState(false); };
    synth.speak(u);
  });
}

// ---------------------------------------------------------------- ditado
let rec: any = null;
export function dictate(onText: (text: string) => void, onState: (on: boolean) => void) {
  const SR = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
  if (!SR) return toast('Este navegador não tem ditado por voz (use o Chrome ou o Edge).', 'error');
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = false;
  rec.onresult = (ev: any) => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) onText(String(ev.results[i][0].transcript).trim()); };
  rec.onerror = (ev: any) => toast(ev.error === 'not-allowed' ? 'Permita o microfone para ditar.' : `Ditado: ${ev.error}`, 'error');
  rec.onend = () => { rec = null; onState(false); };
  rec.start(); onState(true);
  toast('Ditando… fale normalmente. Clique de novo para parar.');
}

// ---------------------------------------------------------------- assistente
const ACTIONS: Record<string, [string, string][]> = {
  DOCUMENT_EDITOR: [['rewrite', 'Reescrever'], ['summarize', 'Resumir'], ['expand', 'Expandir'], ['tone', 'Mudar o tom'], ['grammar', 'Corrigir gramática'], ['translate', 'Traduzir'], ['titles', 'Sugerir títulos'], ['ideas', 'Gerar ideias'], ['outline', 'Criar estrutura'], ['ask', 'Perguntar sobre o documento']],
  PRESENTATION_EDITOR: [['slides', 'Gerar slides a partir de texto'], ['notes', 'Escrever notas do apresentador'], ['rewrite', 'Reescrever'], ['summarize', 'Resumir'], ['titles', 'Sugerir títulos'], ['translate', 'Traduzir'], ['ideas', 'Gerar ideias'], ['ask', 'Perguntar sobre a apresentação']],
  SPREADSHEET_EDITOR: [['formula', 'Criar fórmula'], ['explain_formula', 'Explicar fórmula'], ['analyze', 'Analisar dados'], ['ask', 'Perguntar sobre os dados']],
};
const NEEDS_INSTRUCTION = new Set(['tone', 'translate', 'ask', 'formula', 'ideas', 'outline']);

export interface AssistHooks {
  /** texto selecionado (ou a fórmula/valor da célula ativa nas planilhas) */
  selected: () => string;
  /** texto do documento inteiro, para dar contexto */
  whole: () => string;
  insert: (text: string, action: string) => void;
  replace?: (text: string) => void;
}

export function assistantPanel(e: Engine, hooks: AssistHooks): Node[] {
  const app = e.doc.document.application;
  const action = h('select', { class: 'ed-select', 'aria-label': 'O que fazer' }, ...ACTIONS[app].map(([v, l]) => h('option', { value: v }, l)));
  const instruction = h('textarea', { class: 'ed-input', rows: '3', placeholder: 'Instrução (ex.: "tom formal", "para espanhol", "soma das vendas do Sul")', 'aria-label': 'Instrução' });
  const out = h('div', { class: 'ed-ai-out', 'aria-live': 'polite' });
  const go = h('button', { type: 'button', class: 'ed-btn ed-primary' }, 'Pedir ao assistente');
  const useAll = h('input', { type: 'checkbox', id: 'aiAll' });
  const sync = () => { instruction.hidden = !NEEDS_INSTRUCTION.has(action.value) && !instruction.value; };
  action.addEventListener('change', sync); sync();
  go.addEventListener('click', async () => {
    const a = action.value;
    const sel = hooks.selected();
    const text = useAll.checked || !sel ? '' : sel;
    if (!text && !['ask', 'formula', 'ideas', 'outline', 'analyze'].includes(a) && !useAll.checked) return toast('Selecione um trecho ou marque "usar o documento inteiro".', 'error');
    if (NEEDS_INSTRUCTION.has(a) && !instruction.value.trim() && a !== 'ideas' && a !== 'outline') return toast('Escreva a instrução.', 'error');
    go.setAttribute('disabled', ''); go.textContent = 'Pensando…';
    out.replaceChildren(h('p', { class: 'ed-muted' }, 'Pensando…'));
    try {
      const res = await fetch('/api/editor/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: a, text: text || (a === 'ideas' || a === 'outline' ? instruction.value : ''), instruction: instruction.value || undefined, context: useAll.checked || ['ask', 'analyze', 'summarize', 'notes'].includes(a) ? hooks.whole().slice(0, 100_000) : undefined }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { out.replaceChildren(h('p', { class: 'ed-err' }, body.error ?? 'Não deu certo.')); return; }
      const result = String(body.text ?? '');
      out.replaceChildren(
        h('div', { class: 'ed-ai-text' }, result),
        ...(body.truncated ? [h('p', { class: 'ed-muted' }, 'A resposta foi cortada por ser longa.')] : []),
        h('div', { class: 'ed-row' },
          h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => hooks.insert(result, a) }, a === 'slides' ? 'Criar slides' : a === 'formula' ? 'Pôr na célula' : 'Inserir'),
          hooks.replace && sel && !['ask', 'ideas', 'outline', 'titles', 'analyze', 'notes', 'formula', 'explain_formula', 'slides'].includes(a) ? h('button', { type: 'button', class: 'ed-btn', onclick: () => hooks.replace!(result) }, 'Substituir a seleção') : null,
          h('button', { type: 'button', class: 'ed-btn', onclick: () => { void navigator.clipboard?.writeText(result); toast('Copiado.'); } }, 'Copiar')),
      );
    } catch { out.replaceChildren(h('p', { class: 'ed-err' }, 'Sem conexão com o assistente.')); }
    finally { go.removeAttribute('disabled'); go.textContent = 'Pedir ao assistente'; }
  });
  return [
    h('p', { class: 'ed-muted' }, 'Selecione um trecho (ou uma célula) e escolha o que fazer. O resultado aparece aqui antes de entrar no documento.'),
    action, instruction, h('label', { class: 'ed-check', for: 'aiAll' }, useAll, ' Usar o documento inteiro'), go, out,
  ];
}
