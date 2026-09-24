import { defineConfig } from "drizzle-kit";

/**
 * Configuración de drizzle-kit — PostgreSQL (Neon).
 *
 * `db:generate` NO necesita la URL: sólo lee el esquema y escribe el SQL en
 * `./drizzle` para que puedas REVISARLO antes de aplicarlo. Eso es
 * deliberado: aplicar DDL a ciegas es lo que dejó el proyecto sin forma de
 * saber qué había en la base de datos.
 *
 * Aplicar: `npm run db:migrate` (usa el migrador de Drizzle y registra lo
 * aplicado en `drizzle.__drizzle_migrations`, así que es reejecutable).
 *
 * `drizzle-kit push` NO tiene script en package.json a propósito: compara y
 * aplica a ciegas, y puede emitir un DROP TABLE si no reconoce algo. Si de
 * verdad hace falta, se invoca con npx — drizzle-kit lee `.env`, no
 * `.env.local`:
 *
 *   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)" \
 *     npx drizzle-kit push
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
