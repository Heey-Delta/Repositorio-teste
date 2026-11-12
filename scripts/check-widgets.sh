#!/usr/bin/env bash
# Garante que toda página com a seção indicada em widgets.json (requiredIn) monta os widgets obrigatórios.
#  - páginas Astro/HTML: o <iframe> da seção indicada em widgets.json precisa carregar o widget;
#  - páginas de Design (.dc.html): a seção precisa de <dc-import> e do arquivo do componente.
# Uso: scripts/check-widgets.sh   (sai com erro se faltar algum)
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
excludes=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro --exclude-dir=public)

section_of() {  # imprime o conteúdo da <section id="$2"> do arquivo $1
  python3 - "$1" "$2" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<section[^>]*id="' + re.escape(sys.argv[2]) + r'"[^>]*>(.*?)</section>', html, re.S)
print(m.group(1) if m else "")
PY
}

required=$(python3 -c '
import json
d = json.load(open("widgets.json"))["widgets"]
for k, v in d.items():
    if v.get("required"):
        print(k, v["component"], v["entry"], v["requiredIn"].split("#")[-1])
')

while read -r slug component entry sec; do
  [ -z "$slug" ] && continue
  if [ ! -f "public/$entry" ]; then
    echo "ERRO: widget '$slug' não encontrado em public/$entry"; fail=1
  fi

  # Páginas de Design (canvas)
  while IFS= read -r page; do
    section=$(section_of "$page" "$sec")
    if ! grep -q "<dc-import name=\"$component\"" <<<"$section"; then
      echo "ERRO: $page não monta o widget obrigatório '$slug' (<dc-import name=\"$component\">) na seção #$sec"; fail=1
    fi
    if [ ! -f "$(dirname "$page")/$component.dc.html" ]; then
      echo "ERRO: $(dirname "$page")/$component.dc.html não existe (componente do widget '$slug')"; fail=1
    fi
  done < <(grep -rl --include='*.dc.html' "id=\"$sec\"" . "${excludes[@]}" || true)

  # Páginas publicadas (Astro e HTML): a seção indicada precisa carregar o widget de verdade
  while IFS= read -r page; do
    section=$(section_of "$page" "$sec")
    if ! grep -qE "<iframe[^>]*src=\"[./]*$entry(\\?[^\"]*)?\"" <<<"$section"; then
      echo "ERRO: $page não carrega o widget obrigatório '$slug' ($entry) na seção #$sec"; fail=1
    fi
  done < <(grep -rl --include='*.astro' --include='*.html' "id=\"$sec\"" . "${excludes[@]}" | grep -v '\.dc\.html$' || true)
done <<<"$required"

[ "$fail" -eq 0 ] && echo "OK: todos os projetos montam os widgets obrigatórios."
exit "$fail"
