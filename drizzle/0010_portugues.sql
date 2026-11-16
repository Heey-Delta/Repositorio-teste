-- Site todo em português: categorias, áreas e formatos do laboratório (os endereços /lab/<slug>/ não mudam).
UPDATE "departments" SET "name" = 'Experimentos' WHERE "slug" = 'experiments';--> statement-breakpoint
UPDATE "departments" SET "name" = 'Notas de campo' WHERE "slug" = 'field-notes';--> statement-breakpoint
UPDATE "departments" SET "name" = 'Pesquisas' WHERE "slug" = 'research';--> statement-breakpoint
UPDATE "departments" SET "name" = 'Acervo visual' WHERE "slug" = 'visual-archive';--> statement-breakpoint
UPDATE "departments" SET "name" = 'Laboratório aberto' WHERE "slug" = 'open-lab';--> statement-breakpoint
UPDATE "departments" SET "name" = 'Observatório' WHERE "slug" = 'observatory';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Cultura visual', "slug" = 'cultura-visual' WHERE "slug" = 'visual-culture';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Design digital', "slug" = 'design-digital' WHERE "slug" = 'digital-design';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Tecnologia criativa', "slug" = 'tecnologia-criativa' WHERE "slug" = 'creative-technology';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Comportamento humano', "slug" = 'comportamento-humano' WHERE "slug" = 'human-behavior';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Arte experimental', "slug" = 'arte-experimental' WHERE "slug" = 'experimental-art';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Arquitetura e espaço', "slug" = 'arquitetura-e-espaco' WHERE "slug" = 'architecture-e-space';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Ciência dos materiais', "slug" = 'ciencia-dos-materiais' WHERE "slug" = 'material-science';--> statement-breakpoint
UPDATE "areas" SET "name" = 'Estudos do futuro', "slug" = 'estudos-do-futuro' WHERE "slug" = 'future-studies';--> statement-breakpoint
UPDATE "posts" SET "format" = CASE "format" WHEN 'Essay' THEN 'Ensaio' WHEN 'Observation' THEN 'Observação' WHEN 'Idea' THEN 'Ideia' WHEN 'Opinion' THEN 'Opinião' ELSE "format" END WHERE "format" IN ('Essay', 'Observation', 'Idea', 'Opinion');
