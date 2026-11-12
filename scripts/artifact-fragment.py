#!/usr/bin/env python3
"""Converte dist/index.html em um fragmento para publicar como artefato.

O artefato recebe a página sem <!doctype>, <html>, <head> e <body> (a plataforma monta esse
esqueleto), então este script pega o conteúdo do <head> (menos charset e viewport) e do <body>.
Uso: python3 scripts/artifact-fragment.py dist/index.html saida.html
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8").read()
head = re.search(r"<head[^>]*>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body[^>]*>(.*?)</body>", html, re.S).group(1)
head = re.sub(r'<meta charset="[^"]*"\s*/?>', "", head)
head = re.sub(r'<meta name="viewport"[^>]*>', "", head)
fragment = '<meta name="claude:viewport-fit-sides" content="cover">\n' + head.strip() + "\n" + body.strip() + "\n"
open(out, "w", encoding="utf-8").write(fragment)
print(f"{out}: {len(fragment)} bytes")
