// Depois do build: acrescenta à configuração da Vercel (.vercel/output/config.json) as regras que o vercel.json não
// consegue aplicar, porque o adaptador do Astro gera essa configuração sozinho (Build Output API) e ignora
// "headers" e "redirects" do vercel.json. As regras entram antes do { handle: 'filesystem' }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = '.vercel/output/config.json';
if (!existsSync(file)) process.exit(0);   // build fora da Vercel (testes locais): nada a fazer
const config = JSON.parse(readFileSync(file, 'utf8'));
const extra = [
  // domínio antigo do projeto: manda tudo para o endereço oficial (evita conteúdo duplicado nos buscadores)
  { src: '^/(.*)$', has: [{ type: 'host', value: 'dnts-link-manager.vercel.app' }], status: 308, headers: { Location: 'https://hallan-dante.vercel.app/$1' } },
  // fontes, Three.js e modelos da cidade mudam pouco: cache longo no navegador (o resto segue revalidando)
  { src: '^/fonts/(.*)$', headers: { 'cache-control': 'public, max-age=2592000, stale-while-revalidate=86400' }, continue: true },
  { src: '^/widgets/cidade-isometrica/(vendor|models)/(.*)$', headers: { 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400' }, continue: true },
];
const routes = config.routes.filter((r) => !extra.some((e) => e.src === r.src && JSON.stringify(e.has) === JSON.stringify(r.has)));
const at = routes.findIndex((r) => r.handle === 'filesystem');
routes.splice(at < 0 ? 0 : at, 0, ...extra);
config.routes = routes;
writeFileSync(file, JSON.stringify(config, null, 2));
console.log(`vercel-routes: ${extra.length} regras adicionadas`);
