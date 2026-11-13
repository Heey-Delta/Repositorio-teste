// Arquivo JSON de cada dado em tabela (tabela, planilha, gráfico, diagrama, apresentação), gerado no build.
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
  return new Response(JSON.stringify({ nome: it.name, tipo: it.kind, publicacao: title, registros: toJsonRecords(it.rows) }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
