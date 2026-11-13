-- Arquiva as publicações de teste feitas até aqui (pedido do autor): saem do site, mas continuam no admin
-- (status "Arquivado"); para trazer uma de volta, é só mudar o status no editor. Os volumes de teste viram rascunho.
UPDATE "posts" SET "status" = 'archived', "updated_at" = now() WHERE "status" <> 'archived' AND "created_at" < '2026-11-14T03:00:00Z';--> statement-breakpoint
UPDATE "volumes" SET "status" = 'draft', "updated_at" = now() WHERE "created_at" < '2026-11-14T03:00:00Z';--> statement-breakpoint
DELETE FROM "search_vectors";
