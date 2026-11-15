// Métricas do laboratório (seção /Metrics da página inicial): total de registros, total de raios (curtidas somadas),
// dias com registro no último ano e a atividade por dia (estilo GitHub, em amarelo).
import { liveCards, activity } from './lab-feed';

export async function labMetrics(now = new Date()) {
  const all = process.env.DATABASE_URL ? await liveCards().catch(() => []) : [];
  const act = activity(all.map((c) => c.date), now);
  return { posts: all.length, likes: all.reduce((n, c) => n + c.likes, 0), active: act.active, act };
}
