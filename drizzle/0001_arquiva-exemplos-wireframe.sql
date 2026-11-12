-- Arquiva os 9 exemplos do wireframe (EXP-001...OBS-001) que ainda estão como rascunho e com o aviso de exemplo.
-- Ficam no banco (dá para reabrir no admin), mas saem das listas e nunca vão para o site público.
UPDATE "posts" SET "status" = 'archived', "updated_at" = now()
WHERE "status" = 'draft'
  AND "code" IN ('EXP-001', 'EXP-002', 'FN-001', 'FN-002', 'RES-001', 'RES-002', 'VA-001', 'LAB-001', 'OBS-001')
  AND "body" LIKE '%Exemplo do wireframe%';
