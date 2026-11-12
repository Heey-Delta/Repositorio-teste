// Conexão com o banco (Neon por HTTP: funciona nas funções do Vercel sem manter conexão aberta)
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function db() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não configurada');
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}
export { schema };
