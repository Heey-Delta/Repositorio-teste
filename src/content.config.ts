// Publicações do Experimental Lab: um arquivo .md por publicação em src/content/lab/<departamento>/<slug>.md.
// A URL fica /lab/<departamento>/<slug>/ (o nome do arquivo é o slug: use palavras em português, sem acento, separadas por hífen).
// `draft: true` mantém a publicação fora do Google (noindex e fora do sitemap) enquanto é rascunho ou exemplo do wireframe.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { departmentSlugs, areaNames, formats } from './lab/data';

const lab = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/lab' }),
  schema: z.object({
    title: z.string(),
    code: z.string().regex(/^(EXP|FN|RES|VA|LAB|OBS)-\d{3}$/),   // EXP-001, FN-001, RES-001...
    department: z.enum(departmentSlugs),
    description: z.string().max(170),   // vira a meta description: até ~160 caracteres
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('Hallan'),
    areas: z.array(z.enum(areaNames)).min(1),
    tags: z.array(z.string()).default([]),
    level: z.enum(['Introdutório', 'Intermediário', 'Aprofundado']).default('Introdutório'),
    status: z.enum(['concept', 'in-progress', 'active', 'completed', 'archived']).default('concept'),
    format: z.enum(formats).optional(),   // só Field Notes
    related: z.array(z.string()).default([]),   // códigos de outras publicações (ex.: 'RES-001')
    references: z.array(z.object({ title: z.string(), url: z.string().url().optional() })).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { lab };
