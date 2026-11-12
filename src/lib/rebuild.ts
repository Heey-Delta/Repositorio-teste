// Atualiza o site público: o Lab é gerado no build, então publicar algo dispara um novo deploy de produção
// pelo Deploy Hook do Vercel (VERCEL_DEPLOY_HOOK_URL). O site atualiza em cerca de 1 minuto.
import { db, schema as s } from '../db/client';

export type RebuildResult = 'started' | 'unconfigured' | 'failed';

export const isLive = (status: string, scheduledAt: Date | null, now = new Date()) =>
  status === 'published' || (status === 'scheduled' && !!scheduledAt && scheduledAt <= now);

export async function triggerRebuild(login: string, reason: string): Promise<RebuildResult> {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) return 'unconfigured';
  try {
    const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'failed';
    await db().insert(s.adminLog).values({ login, action: 'site.rebuild', target: reason });
    return 'started';
  } catch {
    return 'failed';
  }
}
