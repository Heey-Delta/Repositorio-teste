#!/usr/bin/env bash
# Garante que todo projeto (página .dc.html com seção #portfolio) monta os widgets obrigatórios.
# Uso: scripts/check-widgets.sh   (sai com erro se faltar algum)
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
# Widgets obrigatórios declarados em widgets/widgets.json
required=$(python3 -c '
import json
d = json.load(open("widgets/widgets.json"))["widgets"]
for k, v in d.items():
    if v.get("required"):
        print(k, v["component"], v["entry"])
')

while read -r slug component entry; do
  [ -z "$slug" ] && continue
  if [ ! -f "$entry" ]; then
    echo "ERRO: widget '$slug' não encontrado em $entry"; fail=1
  fi
  # Cada projeto: pasta com uma página que tem a seção de Projetos
  while IFS= read -r page; do
    dir=$(dirname "$page")
    section=$(python3 - "$page" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<section[^>]*id="portfolio"[^>]*>(.*?)</section>', html, re.S)
print(m.group(1) if m else "")
PY
)
    if ! grep -q "<dc-import name=\"$component\"" <<<"$section"; then
      echo "ERRO: $page não monta o widget obrigatório '$slug' (<dc-import name=\"$component\">) na seção #portfolio"; fail=1
    fi
    if [ ! -f "$dir/$component.dc.html" ]; then
      echo "ERRO: $dir/$component.dc.html não existe (componente do widget '$slug')"; fail=1
    fi
  done < <(grep -rl --include='*.dc.html' 'id="portfolio"' . --exclude-dir=.git --exclude-dir=widgets || true)
done <<<"$required"

[ "$fail" -eq 0 ] && echo "OK: todos os projetos montam os widgets obrigatórios."
exit "$fail"
