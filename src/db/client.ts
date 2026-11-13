// Conexão com o banco (Neon por HTTP: funciona nas funções do Vercel sem manter conexão aberta).
// Só para desenvolvimento e testes locais: DB_DRIVER=pg usa um Postgres comum (node-postgres) no lugar do Neon.
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let instance: Db | undefined;

// o nome do módulo fica numa variável para o bundler não empacotar o driver local no site
const localModule = 'drizzle-orm/node-postgres';
const local = process.env.DB_DRIVER === 'pg' && process.env.DATABASE_URL
  ? ((await import(/* @vite-ignore */ localModule)).drizzle(process.env.DATABASE_URL, { schema }) as unknown as Db)
  : undefined;
// o Neon executa vários comandos numa ida só (batch); no Postgres local eles rodam em sequência
if (local) (local as unknown as { batch: (q: PromiseLike<unknown>[]) => Promise<unknown[]> }).batch = async (q) => { const out: unknown[] = []; for (const x of q) out.push(await x); return out; };

export function db() {
  if (local) return local;
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não configurada');
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}
export { schema };
