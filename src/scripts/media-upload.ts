// Envio de arquivos para a biblioteca de mídia, usado pelo editor e pela página Mídia.
// Imagens: reduz para no máximo 2000 px de largura e converte para WebP no navegador (GIF fica como está, pode ser animado).
export type Prepared = { blob: Blob; name: string; width: number | null; height: number | null };

export async function prepareFile(file: File): Promise<Prepared> {
  if (file.type === 'application/pdf') return { blob: file, name: file.name, width: null, height: null };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / bitmap.width);
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  if (file.type === 'image/gif') return { blob: file, name: file.name, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  const webp = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.82));
  const blob = webp && webp.type === 'image/webp' && (webp.size < file.size || scale < 1) ? webp : file;
  return { blob, name: blob === file ? file.name : file.name.replace(/\.[a-z0-9]+$/i, '') + '.webp', width, height };
}

export async function sendFile(p: Prepared, fields: { alt: string; caption: string }) {
  const body = new FormData();
  body.append('file', p.blob, p.name);
  body.append('alt', fields.alt); body.append('caption', fields.caption);
  if (p.width) { body.append('width', String(p.width)); body.append('height', String(p.height)); }
  const res = await fetch('/api/media', { method: 'POST', body });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? 'Não deu para enviar o arquivo.');
  return out.media;
}

export const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
