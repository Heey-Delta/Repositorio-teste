ALTER TABLE "authors" ADD COLUMN "job_title" text;--> statement-breakpoint
-- valores iniciais do perfil (os mesmos que estavam fixos no código); editáveis em /admin/perfil/
UPDATE "authors" SET "job_title" = 'Designer e desenvolvedor de sites' WHERE "slug" = 'hallan' AND "job_title" IS NULL;
--> statement-breakpoint
UPDATE "authors" SET "specialties" = '["Design de interfaces","Desenvolvimento web","Experiências 3D na web","Percepção visual"]'::jsonb WHERE "slug" = 'hallan' AND "specialties" = '[]'::jsonb;
