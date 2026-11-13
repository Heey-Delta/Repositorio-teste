// Arquivo CSV de cada dado em tabela (tabela, planilha, gráfico, diagrama, apresentação), gerado no build.
import type { APIRoute } from 'astro';
import { getLabEntries, dataSlugOf } from '../../../lib/lab-public';
import { dataItems, toCsv, toJsonRecords, TABULAR } from '../../../lib/data-items';

export async function getStaticPaths() {
  const all = await getLabEntries();
  return all.flatMap((entry) => dataItems(entry.body)
    .filter((it) => TABULAR.includes(it.kind) || it.kind === 'diagrama' || it.kind === 'apresentacao')
    .map((it) => ({ params: { post: dataSlugOf(entry, all), item: it.slug }, props: { it, title: entry.data.title } })));
}
export const GET: APIRoute = ({ props }) => {
  const { it, title } = props as { it: ReturnType<typeof dataItems>[number]; title: string };
  void title;
  return new Response(toCsv(it.rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
};
