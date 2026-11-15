// Ícones das stacks e dos cursos: o nome de uma marca do Simple Icons (simpleicons.org, ex.: "react", "figma")
// ou um desenho próprio (o "d" de um <path> SVG, que começa com M). Só roda no servidor e no build.
import * as si from 'simple-icons';

export interface Icon { path: string; hex: string; title: string }
let bySlug: Map<string, Icon> | undefined;
const all = () => (bySlug ??= new Map(Object.values(si as unknown as Record<string, { slug: string; path: string; hex: string; title: string }>)
  .filter((x) => x && typeof x === 'object' && 'slug' in x).map((x) => [x.slug, { path: x.path, hex: x.hex, title: x.title }])));

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, 'dot').replace(/\+/g, 'plus').replace(/#/g, 'sharp').replace(/[^a-z0-9]/g, '');

/** "react", "Three.js", "M12 2…" → ícone; null se não existir. `hex` (sem #) troca a cor. */
export function resolveIcon(icon: string, hex?: string): Icon | null {
  const v = (icon ?? '').trim();
  if (!v) return null;
  if (/^[Mm][\d\s.,-]/.test(v)) return { path: v, hex: (hex || 'F2F2EE').replace('#', ''), title: '' };
  const found = all().get(v.toLowerCase()) ?? all().get(norm(v));
  return found ? { ...found, hex: (hex || found.hex).replace('#', '') } : null;
}
