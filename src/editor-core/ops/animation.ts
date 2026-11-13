// Motor de animações e transições (F11).
//
// As animações ficam no SLIDE (data.animations), em ordem — a ordem é a sequência de reprodução:
//   { id, targetId, kind: ENTRANCE|EMPHASIS|EXIT|MOTION_PATH, effect, duration, delay,
//     trigger: ON_CLICK|WITH_PREVIOUS|AFTER_PREVIOUS|ON_OBJECT_CLICK, triggerId?, direction?, easing?, repeat?,
//     color? (mudar cor), path? (trajetória), scale? (crescer/encolher) }
// A transição de entrada do slide fica em data.transition: { effect, duration, direction?, advanceAfter? }.
//
// O motor calcula a linha do tempo (início/fim de cada efeito, em ms, por passo de clique) e o estado de cada
// passo (quem está visível), que a reprodução e a apresentação só seguem. Passo 0 = automático (ao abrir o slide).
import type { EditorNode } from '../types.ts';
import type { Engine, Handler } from '../engine.ts';
import { clone, fail } from '../util.ts';

export const EFFECTS: Record<string, string[]> = {
  ENTRANCE: ['APPEAR', 'FADE', 'FLY_IN', 'ZOOM', 'WIPE', 'SPLIT', 'FLOAT', 'BOUNCE', 'GROW'],
  EMPHASIS: ['PULSE', 'SPIN', 'GROW_SHRINK', 'COLOR_CHANGE', 'TRANSPARENCY', 'TEETER', 'BOLD_FLASH'],
  EXIT: ['DISAPPEAR', 'FADE', 'FLY_OUT', 'ZOOM', 'WIPE', 'SPLIT', 'FLOAT', 'SHRINK'],
  MOTION_PATH: ['LINE', 'ARC', 'CIRCLE', 'CUSTOM'],
};
export const TRANSITIONS = ['NONE', 'FADE', 'PUSH', 'WIPE', 'SPLIT', 'REVEAL', 'COVER', 'ZOOM', 'MORPH', 'FLIP', 'CUBE'];
const TRIGGERS = ['ON_CLICK', 'WITH_PREVIOUS', 'AFTER_PREVIOUS', 'ON_OBJECT_CLICK'];
const DIRECTIONS = ['LEFT', 'RIGHT', 'UP', 'DOWN'];
const EASINGS = ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'];
const DIRECTIONAL = ['FLY_IN', 'FLY_OUT', 'WIPE', 'FLOAT', 'PUSH', 'COVER', 'REVEAL', 'LINE', 'ARC'];
const INSTANT = ['APPEAR', 'DISAPPEAR'];

export interface Animation {
  id: string; targetId: string; kind: string; effect: string; duration: number; delay: number; trigger: string;
  triggerId?: string; direction?: string; easing?: string; repeat?: number; color?: string; path?: { x: number; y: number }[]; scale?: number;
}
export interface TimelineItem { animationId: string; targetId: string; kind: string; effect: string; start: number; end: number }
export interface TimelineStep { index: number; trigger: 'AUTO' | 'CLICK' | 'OBJECT'; triggerId?: string; duration: number; items: TimelineItem[] }

const num = (v: unknown, what: string, min: number, max: number) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail('VALIDATION', `${what}: número de ${min} a ${max}.`); };

function slideOf(e: Engine, id: string): EditorNode {
  const s = [id, ...e.ancestors(id)].map((x) => e.find(x)).find((x) => x?.type === 'SURFACE');
  if (!s || s.data.surfaceType !== 'SLIDE') fail('INVALID_OPERATION', 'Animações e transições valem para slides.');
  return s!;
}

function validate(e: Engine, slide: EditorNode, a: Animation) {
  if (!EFFECTS[a.kind]) fail('VALIDATION', `Tipo de animação: ${Object.keys(EFFECTS).join(', ')}.`);
  if (!EFFECTS[a.kind].includes(a.effect)) fail('VALIDATION', `Efeito de ${a.kind}: ${EFFECTS[a.kind].join(', ')}.`);
  const t = e.get(a.targetId);
  if (t.id === slide.id || !e.ancestors(t.id).includes(slide.id)) fail('VALIDATION', 'O elemento animado precisa estar no slide.');
  num(a.duration, 'Duração (ms)', 0, 60000);
  num(a.delay, 'Atraso (ms)', 0, 60000);
  if (!TRIGGERS.includes(a.trigger)) fail('VALIDATION', `Gatilho: ${TRIGGERS.join(', ')}.`);
  if (a.trigger === 'ON_OBJECT_CLICK') {
    if (!a.triggerId) fail('VALIDATION', 'Gatilho por objeto: informe triggerId (o objeto que será clicado).');
    if (!e.ancestors(e.get(a.triggerId).id).includes(slide.id)) fail('VALIDATION', 'O objeto do gatilho precisa estar no mesmo slide.');
  } else if (a.triggerId) fail('VALIDATION', 'triggerId só vale com o gatilho ON_OBJECT_CLICK.');
  if (a.direction !== undefined && !DIRECTIONS.includes(a.direction)) fail('VALIDATION', `Direção: ${DIRECTIONS.join(', ')}.`);
  if (a.easing !== undefined && !EASINGS.includes(a.easing)) fail('VALIDATION', `Aceleração: ${EASINGS.join(', ')}.`);
  if (a.repeat !== undefined) num(a.repeat, 'Repetições', 1, 100);
  if (a.effect === 'COLOR_CHANGE' && !/^#[0-9a-f]{3,8}$/i.test(a.color ?? '')) fail('VALIDATION', 'Mudar cor: informe color (#RRGGBB).');
  if (a.effect === 'GROW_SHRINK' && a.scale !== undefined) num(a.scale, 'Escala', 0.1, 10);
  if (a.effect === 'CUSTOM' && (!Array.isArray(a.path) || a.path.length < 2 || a.path.some((p) => typeof p?.x !== 'number' || typeof p?.y !== 'number'))) fail('VALIDATION', 'Trajetória livre: path com 2 ou mais pontos { x, y }.');
}

const DEFAULTS = { duration: 500, delay: 0, trigger: 'ON_CLICK' };
const list = (s: EditorNode): Animation[] => s.data.animations ?? [];
const findAnim = (e: Engine, id: string) => {
  for (const n of Object.values(e.doc.nodes)) if (n.type === 'SURFACE') { const a = list(n).find((x) => x.id === id); if (a) return { slide: n, anim: a }; }
  return fail('NOT_FOUND', `Animação ${id} não existe.`);
};

/** Trajetória pronta de cada efeito de movimento (deslocamento relativo, em px). */
export function motionPath(a: Animation): { x: number; y: number }[] {
  if (a.effect === 'CUSTOM') return clone(a.path!);
  const d = a.direction ?? 'RIGHT', L = 200;
  const v = { LEFT: [-1, 0], RIGHT: [1, 0], UP: [0, -1], DOWN: [0, 1] }[d]!;
  if (a.effect === 'LINE') return [{ x: 0, y: 0 }, { x: v[0] * L, y: v[1] * L }];
  if (a.effect === 'ARC') return [{ x: 0, y: 0 }, { x: v[0] * L / 2 + v[1] * L / 2, y: v[1] * L / 2 - Math.abs(v[0]) * L / 2 }, { x: v[0] * L, y: v[1] * L }];
  return Array.from({ length: 13 }, (_, i) => ({ x: Math.round(Math.sin((i / 12) * 2 * Math.PI) * 100), y: Math.round((1 - Math.cos((i / 12) * 2 * Math.PI)) * 100) }));
}

/** Linha do tempo do slide: sequência principal (passo 0 automático + um passo por clique) e sequências por objeto. */
export function timeline(e: Engine, slide: EditorNode) {
  const valid = list(slide).filter((a) => e.find(a.targetId));
  const build = (anims: Animation[], firstTrigger: 'AUTO' | 'CLICK' | 'OBJECT', triggerId?: string) => {
    const steps: TimelineStep[] = [];
    let prev: TimelineItem | null = null;
    for (const a of anims) {
      const len = (INSTANT.includes(a.effect) ? 0 : a.duration) * (a.repeat ?? 1);
      const opensStep = a.trigger === 'ON_CLICK' || a.trigger === 'ON_OBJECT_CLICK' || !steps.length;
      if (opensStep) steps.push({ index: steps.length, trigger: a.trigger === 'ON_CLICK' || a.trigger === 'ON_OBJECT_CLICK' ? (firstTrigger === 'OBJECT' ? 'OBJECT' : 'CLICK') : 'AUTO', ...(triggerId ? { triggerId } : {}), duration: 0, items: [] });
      const step = steps.at(-1)!;
      const base = opensStep ? 0 : a.trigger === 'WITH_PREVIOUS' ? prev!.start : prev!.end;
      const it: TimelineItem = { animationId: a.id, targetId: a.targetId, kind: a.kind, effect: a.effect, start: base + a.delay, end: base + a.delay + len };
      step.items.push(it);
      step.duration = Math.max(step.duration, it.end);
      prev = it;
    }
    // a sequência principal começa sempre num passo 0 automático (vazio quando a 1ª animação espera clique)
    if (firstTrigger === 'AUTO' && (!steps.length || steps[0].trigger !== 'AUTO')) { steps.unshift({ index: 0, trigger: 'AUTO', duration: 0, items: [] }); steps.forEach((s, i) => (s.index = i)); }
    return steps;
  };
  const main = valid.filter((a) => a.trigger !== 'ON_OBJECT_CLICK');
  const objects = [...new Set(valid.filter((a) => a.trigger === 'ON_OBJECT_CLICK').map((a) => a.triggerId!))];
  const steps = build(main, 'AUTO');
  const tr = slide.data.transition;
  return {
    transition: tr ? clone(tr) : null,
    steps,
    interactive: objects.map((tid) => ({ triggerId: tid, steps: build(valid.filter((a) => a.triggerId === tid), 'OBJECT', tid) })),
    clicks: steps.length - 1,
    total: steps.reduce((s, x) => s + x.duration, 0),
  };
}

/** Quem está escondido depois de reproduzir os passos 0..step da sequência principal. */
export function stateAt(e: Engine, slide: EditorNode, step: number) {
  const main = list(slide).filter((a) => e.find(a.targetId) && a.trigger !== 'ON_OBJECT_CLICK');
  const t = timeline(e, slide);
  const played = new Set(t.steps.filter((s) => s.index <= step).flatMap((s) => s.items.map((i) => i.animationId)));
  const hidden = new Set<string>();
  const seen = new Set<string>();
  for (const a of main) {   // começa escondido quem tem uma ENTRADA como primeira animação
    if (!seen.has(a.targetId) && a.kind === 'ENTRANCE') hidden.add(a.targetId);
    seen.add(a.targetId);
  }
  for (const a of main) if (played.has(a.id)) { if (a.kind === 'ENTRANCE') hidden.delete(a.targetId); if (a.kind === 'EXIT') hidden.add(a.targetId); }
  return { step: Math.min(step, t.steps.length - 1), hidden: [...hidden], done: step >= t.steps.length - 1 };
}

const pick = (p: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const k of ['kind', 'effect', 'duration', 'delay', 'trigger', 'triggerId', 'direction', 'easing', 'repeat', 'color', 'path', 'scale']) if (p[k] !== undefined) out[k] = clone(p[k]);
  return out;
};

export const animationHandlers: Record<string, Handler> = {
  /** ADD_ANIMATION (targetId = elemento) { kind, effect, duration?, delay?, trigger?, triggerId?, direction?, easing?, repeat?, color?, path?, scale?, index? } */
  ADD_ANIMATION: (e, op) => {
    const el = e.get(op.targetId);
    const slide = slideOf(e, el.id);
    e.assertEditable(slide.id);
    const p = op.payload ?? {};
    const a = { id: e.newId('ANIM'), targetId: el.id, ...DEFAULTS, ...(DIRECTIONAL.includes(p.effect) && !p.direction ? { direction: 'LEFT' } : {}), ...pick(p) } as Animation;
    validate(e, slide, a);
    const s = e.touchNode(slide.id);
    const arr: Animation[] = (s.data.animations ??= []);
    arr.splice(p.index === undefined ? arr.length : Math.max(0, Math.min(arr.length, p.index)), 0, a);
    return a.id;
  },
  /** UPDATE_ANIMATION { animationId, …campos } */
  UPDATE_ANIMATION: (e, op) => {
    const { slide } = findAnim(e, op.payload?.animationId);
    e.assertEditable(slide.id);
    const s = e.touchNode(slide.id);
    const a = list(s).find((x) => x.id === op.payload?.animationId)!;
    const p = op.payload ?? {};
    const changes = pick(p);
    Object.assign(a, changes);
    for (const k of Object.keys(p)) if (p[k] === null) delete (a as any)[k];
    if (changes.trigger && changes.trigger !== 'ON_OBJECT_CLICK') delete a.triggerId;
    if (changes.kind && !changes.effect && !EFFECTS[a.kind]?.includes(a.effect)) a.effect = EFFECTS[a.kind]?.[0] ?? a.effect;
    validate(e, s, a);
    return a.id;
  },
  REMOVE_ANIMATION: (e, op) => {
    const ids: string[] = op.payload?.animationIds ?? [op.payload?.animationId];
    for (const id of ids) {
      const { slide } = findAnim(e, id);
      e.assertEditable(slide.id);
      const s = e.touchNode(slide.id);
      s.data.animations = list(s).filter((x) => x.id !== id);
    }
    return ids;
  },
  /** Remove todas as animações de um elemento (targetId) ou de um slide. */
  CLEAR_ANIMATIONS: (e, op) => {
    const n = e.get(op.targetId);
    const slide = slideOf(e, n.id);
    e.assertEditable(slide.id);
    const s = e.touchNode(slide.id);
    const before = list(s).length;
    s.data.animations = n.id === slide.id ? [] : list(s).filter((a) => a.targetId !== n.id);
    return before - s.data.animations.length;
  },
  /** REORDER_ANIMATION { animationId, newIndex } */
  REORDER_ANIMATION: (e, op) => {
    const { slide } = findAnim(e, op.payload?.animationId);
    e.assertEditable(slide.id);
    const s = e.touchNode(slide.id);
    const arr = list(s);
    const i = arr.findIndex((x) => x.id === op.payload?.animationId);
    const to = Number(op.payload?.newIndex);
    if (!Number.isInteger(to) || to < 0 || to >= arr.length) fail('VALIDATION', `newIndex de 0 a ${arr.length - 1}.`);
    const [a] = arr.splice(i, 1);
    arr.splice(to, 0, a);
    return arr.map((x) => x.id);
  },
  /** LIST_ANIMATIONS (targetId = slide ou elemento) */
  LIST_ANIMATIONS: (e, op) => {
    const n = e.get(op.targetId);
    const slide = slideOf(e, n.id);
    return clone(list(slide).filter((a) => n.id === slide.id || a.targetId === n.id));
  },
  /** Copia as animações de um elemento para outros (pincel de animação): COPY_ANIMATION { to: [ids] } */
  COPY_ANIMATION: (e, op) => {
    const src = e.get(op.targetId);
    const slide = slideOf(e, src.id);
    const mine = list(slide).filter((a) => a.targetId === src.id);
    if (!mine.length) fail('INVALID_OPERATION', 'O elemento de origem não tem animações.');
    const created: string[] = [];
    for (const to of op.payload?.to ?? []) {
      const ts = slideOf(e, e.get(to).id);
      e.assertEditable(ts.id);
      const s = e.touchNode(ts.id);
      s.data.animations = list(s).filter((a) => a.targetId !== to);
      for (const a of mine) {
        const c = { ...clone(a), id: e.newId('ANIM'), targetId: to };
        if (c.triggerId && ts.id !== slide.id) { c.trigger = 'ON_CLICK'; delete c.triggerId; }
        validate(e, s, c);
        s.data.animations.push(c);
        created.push(c.id);
      }
    }
    return created;
  },
  /** SET_TRANSITION (targetId = slide) { effect | null, duration?, direction?, advanceAfter?, all? } */
  SET_TRANSITION: (e, op) => {
    const p = op.payload ?? {};
    const slides = p.all ? Object.values(e.doc.nodes).filter((n) => n.type === 'SURFACE' && n.data.surfaceType === 'SLIDE') : [slideOf(e, e.get(op.targetId).id)];
    let tr: Record<string, any> | null = null;
    if (p.effect !== null && p.effect !== 'NONE') {
      if (!TRANSITIONS.includes(p.effect)) fail('VALIDATION', `Transição: ${TRANSITIONS.join(', ')}.`);
      tr = { effect: p.effect, duration: p.duration ?? 700 };
      num(tr.duration, 'Duração da transição (ms)', 0, 20000);
      if (p.direction !== undefined) { if (!DIRECTIONS.includes(p.direction)) fail('VALIDATION', `Direção: ${DIRECTIONS.join(', ')}.`); tr.direction = p.direction; }
      else if (DIRECTIONAL.includes(p.effect)) tr.direction = 'LEFT';
      if (p.advanceAfter !== undefined && p.advanceAfter !== null) { num(p.advanceAfter, 'Avançar após (ms)', 0, 3600000); tr.advanceAfter = p.advanceAfter; }
    }
    for (const s of slides) { e.assertEditable(s.id); e.touchNode(s.id).data.transition = tr ? clone(tr) : null; }
    return slides.map((s) => s.id);
  },
  /** Linha do tempo calculada do slide. */
  ANIMATION_TIMELINE: (e, op) => timeline(e, slideOf(e, e.get(op.targetId).id)),
  /** Passos da reprodução: { steps: [{ index, trigger, duration, items }], clicks }. */
  ANIMATION_STEPS: (e, op) => { const t = timeline(e, slideOf(e, e.get(op.targetId).id)); return { steps: t.steps, clicks: t.clicks, interactive: t.interactive }; },
  /** ANIMATION_STATE { step } — elementos escondidos depois do passo (para a apresentação e a pré-visualização). */
  ANIMATION_STATE: (e, op) => stateAt(e, slideOf(e, e.get(op.targetId).id), Number(op.payload?.step ?? 0)),
};
