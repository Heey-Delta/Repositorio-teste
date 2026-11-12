// Perfil do autor (spec 9.1): nome, título profissional, bio, especialidades e perfis em outros sites.
// Vira a identidade de autoria nos dados estruturados do Lab; salvar atualiza o site.
import { z } from 'astro/zod';
import { eq } from 'drizzle-orm';
import { db, schema as s } from '../db/client';
import { triggerRebuild } from './rebuild';

export const authorInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(80),
  jobTitle: z.string().trim().max(120).transform((v) => v || null),
  bio: z.string().trim().max(2000).transform((v) => v || null),
  specialties: z.array(z.string().trim().min(1).max(60)).max(12),
  sameAs: z.array(z.string().trim().regex(/^https:\/\/\S+$/, 'Cada link precisa começar com https://')).max(10),
});

export async function getAuthorProfile() {
  const [a] = await db().select().from(s.authors).where(eq(s.authors.slug, 'hallan'));
  return a;
}

export async function saveAuthorProfile(input: z.infer<typeof authorInput>, login: string) {
  await db().batch([
    db().update(s.authors).set(input).where(eq(s.authors.slug, 'hallan')),
    db().insert(s.adminLog).values({ login, action: 'author.save', target: 'hallan' }),
  ]);
  return { site: await triggerRebuild(login, 'perfil do autor') };
}
