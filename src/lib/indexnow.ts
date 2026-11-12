// IndexNow: avisa Bing, Yandex, Seznam e outros buscadores (o Bing alimenta o ChatGPT Search, o Copilot e o
// DuckDuckGo) de que páginas foram criadas ou mudaram, em vez de esperar o robô passar sozinho.
// A chave não é segredo: o protocolo exige que ela fique pública, em /<chave>.txt (public/).
// O Google não usa IndexNow: para ele, o caminho é o Search Console (sitemap + "Solicitar indexação").
import { getLabEntries } from './lab-public';
import { departments } from '../lab/data';

export const INDEXNOW_KEY = '300a13bda8d1a5b45720a286f0aed98d';

// endereços públicos do site; com `sinceDays`, só o que mudou nesse período (mais a home e o Lab, que listam tudo)
export async function publicUrls(site: URL, sinceDays?: number) {
  const live = (await getLabEntries()).filter((e) => !e.data.draft);
  const at = (p: string) => new URL(p, site).href;
  const cut = sinceDays ? Date.now() - sinceDays * 86_400_000 : 0;
  const recent = live.filter((e) => +(e.data.updated ?? e.data.date) >= cut);
  if (sinceDays && !recent.length) return [];
  const deps = departments.filter((d) => recent.some((e) => e.data.department === d.slug)).map((d) => at(`/lab/${d.slug}/`));
  return [at('/'), ...(live.length ? [at('/lab/')] : []), ...deps, ...recent.map((e) => at(`/lab/${e.id}/`))];
}

export async function pingIndexNow(site: URL, urls: string[]) {
  if (!urls.length) return { sent: 0, status: null as number | null };
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: site.host, key: INDEXNOW_KEY, keyLocation: new URL(`/${INDEXNOW_KEY}.txt`, site).href, urlList: urls.slice(0, 10_000) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return { sent: urls.length, status: res ? res.status : null };   // 200/202 = recebido; 422 = endereço não bate com o host
}
