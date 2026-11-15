-- Volume com uma experiência (jogo, protótipo, página interativa): link e texto do botão na página do volume.
ALTER TABLE "volumes" ADD COLUMN IF NOT EXISTS "experience_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "volumes" ADD COLUMN IF NOT EXISTS "experience_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Configurações da página inicial editáveis no admin (stacks, cursos e volumes em destaque), uma linha por chave.
CREATE TABLE IF NOT EXISTS "site_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
