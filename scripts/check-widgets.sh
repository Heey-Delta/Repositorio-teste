#!/usr/bin/env bash
# Garante que todo projeto com seção #portfolio monta os widgets obrigatórios (widgets.json).
#  - páginas Astro/HTML: o <iframe> da seção #portfolio precisa carregar o widget;
#  - páginas de Design (.dc.html): a seção precisa de <dc-import> e do arquivo do componente.
# Uso: scripts/check-widgets.sh   (sai com erro se faltar algum)
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
excludes=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro --exclude-dir=public)

section_of() {  # imprime o conteúdo da <section id="portfolio"> do arquivo $1
  python3 - "$1" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<section[^>]*id="portfolio"[^>]*>(.*?)</section>', html, re.S)
print(m.group(1) if m else "")
PY
}

required=$(python3 -c '
import json
d = json.load(open("widgets.json"))["widgets"]
for k, v in d.items():
    if v.get("required"):
        print(k, v["component"], v["entry"])
')

while read -r slug component entry; do
  [ -z "$slug" ] && continue
  if [ ! -f "public/$entry" ]; then
    echo "ERRO: widget '$slug' não encontrado em public/$entry"; fail=1
  fi

  # Páginas de Design (canvas)
  while IFS= read -r page; do
    section=$(section_of "$page")
    if ! grep -q "<dc-import name=\"$component\"" <<<"$section"; then
      echo "ERRO: $page não monta o widget obrigatório '$slug' (<dc-import name=\"$component\">) na seção #portfolio"; fail=1
    fi
    if [ ! -f "$(dirname "$page")/$component.dc.html" ]; then
      echo "ERRO: $(dirname "$page")/$component.dc.html não existe (componente do widget '$slug')"; fail=1
    fi
  done < <(grep -rl --include='*.dc.html' 'id="portfolio"' . "${excludes[@]}" || true)

  # Páginas publicadas (Astro e HTML): a seção #portfolio precisa carregar o widget de verdade
  while IFS= read -r page; do
    section=$(section_of "$page")
    if ! grep -qE "<iframe[^>]*src=\"[./]*$entry(\\?[^\"]*)?\"" <<<"$section"; then
      echo "ERRO: $page não carrega o widget obrigatório '$slug' ($entry) na seção #portfolio"; fail=1
    fi
  done < <(grep -rl --include='*.astro' --include='*.html' 'id="portfolio"' . "${excludes[@]}" | grep -v '\.dc\.html$' || true)
done <<<"$required"

[ "$fail" -eq 0 ] && echo "OK: todos os projetos montam os widgets obrigatórios."
exit "$fail"
