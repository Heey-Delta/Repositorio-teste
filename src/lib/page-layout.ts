// Layout da página e regras de formatação de cada publicação (aba "Layout" e "Regras" do editor).
// Viram variáveis CSS e atributos no bloco de texto (.lab-prose): o editor e o site usam a mesma função,
// então o que se ajusta no editor é exatamente o que vai ao ar.
import { z } from 'astro/zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal('')).default('');
export const pageLayoutSchema = z.object({
  // layout da página
  width: z.enum(['estreita', 'normal', 'larga', 'total']).default('normal'),
  fontSize: z.number().min(14).max(24).default(17),
  lineHeight: z.number().min(1.2).max(2.4).default(1.7),
  spacing: z.number().min(0.3).max(3).default(1.1),
  align: z.enum(['left', 'justify']).default('left'),
  columns: z.union([z.literal(1), z.literal(2)]).default(1),
  font: z.enum(['arial', 'anton', 'times']).default('arial'),
  // regras de formatação
  headingFont: z.enum(['anton', 'arial', 'times']).default('anton'),
  h2Size: z.number().min(18).max(56).default(30),
  h2Color: hex, h3Color: hex, linkColor: hex, boldColor: hex, quoteColor: hex,
  numberHeadings: z.boolean().default(false),
  dropCap: z.boolean().default(false),
  indent: z.boolean().default(false),
  zebra: z.boolean().default(false),
  imageBorder: z.boolean().default(true),
}).partial();
export type PageLayout = z.infer<typeof pageLayoutSchema>;
export const WIDTHS = { estreita: 620, normal: 720, larga: 920, total: 1200 } as const;
export const LAYOUT_DEFAULT: Required<PageLayout> = {
  width: 'normal', fontSize: 17, lineHeight: 1.7, spacing: 1.1, align: 'left', columns: 1, font: 'arial',
  headingFont: 'anton', h2Size: 30, h2Color: '', h3Color: '', linkColor: '', boldColor: '', quoteColor: '',
  numberHeadings: false, dropCap: false, indent: false, zebra: false, imageBorder: true,
};

/** Lê o que veio do banco ou do formulário, descartando valores fora do esperado. */
export function readLayout(v: unknown): PageLayout {
  const r = pageLayoutSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
}
/** Só o que difere do padrão (é o que se guarda: publicações antigas continuam iguais). */
export function compactLayout(l: PageLayout): PageLayout | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(l)) if (v !== undefined && v !== (LAYOUT_DEFAULT as Record<string, unknown>)[k]) out[k] = v;
  return Object.keys(out).length ? (out as PageLayout) : null;
}

/** Estilo e atributos do bloco de texto. `maxWidth` vai no contêiner da coluna de texto. */
export function layoutAttrs(input: unknown) {
  const l = { ...LAYOUT_DEFAULT, ...readLayout(input) };
  const vars: string[] = [
    `--pl-fs:${l.fontSize}px`, `--pl-lh:${l.lineHeight}`, `--pl-gap:${l.spacing}em`, `--pl-h2:${l.h2Size}px`,
  ];
  if (l.h2Color) vars.push(`--pl-h2c:${l.h2Color}`);
  if (l.h3Color) vars.push(`--pl-h3c:${l.h3Color}`);
  if (l.linkColor) vars.push(`--pl-link:${l.linkColor}`);
  if (l.boldColor) vars.push(`--pl-bold:${l.boldColor}`);
  if (l.quoteColor) vars.push(`--pl-quote:${l.quoteColor}`);
  const flags = [
    l.align === 'justify' && 'justify', l.columns === 2 && 'cols2', l.font !== 'arial' && `f-${l.font}`, l.headingFont !== 'anton' && `h-${l.headingFont}`,
    l.numberHeadings && 'num', l.dropCap && 'dropcap', l.indent && 'indent', l.zebra && 'zebra', !l.imageBorder && 'noborder',
  ].filter(Boolean).join(' ');
  return { style: vars.join(';'), flags, maxWidth: WIDTHS[l.width] };
}
