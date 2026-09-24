/**
 * Aplica las migraciones de `./drizzle` a la base de datos de Neon.
 *
 * Uso:
 *   npx tsx scripts/aplicar-migraciones.ts            # aplica lo que falte
 *   npx tsx scripts/aplicar-migraciones.ts --listar   # solo muestra el plan
 *
 * POR QUÉ UN SCRIPT Y NO `drizzle-kit push`
 *   `push` compara y aplica a ciegas: puede generar DROP TABLE si no reconoce
 *   algo. Este script usa el migrador de drizzle, que:
 *     · aplica SOLO los ficheros .sql de `./drizzle`, en orden,
 *     · los registra en la tabla `drizzle.__drizzle_migrations`, así que
 *       reejecutarlo es inocuo y queda constancia de qué se aplicó y cuándo,
 *     · no borra nada que no esté en un fichero de migración.
 *
 * Antes de aplicar imprime el estado (tablas existentes y tamaño) para que
 * quede en el log de dónde se partía.
 *
 * Se conecta con `DATABASE_URL_UNPOOLED` si está disponible: crear tablas por
 * un pooler en modo transacción es más frágil y no aporta nada aquí.
 */
import { readdirSync } from "node:fs";
import { cargarEnvLocal } from "./cargar-env";

cargarEnvLocal();

const SOLO_LISTAR = process.argv.includes("--listar");

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.error("Falta DATABASE_URL (Postgres) en .env.local o en el entorno.");
    process.exit(1);
  }
  console.log(`BD: ${url.replace(/\/\/[^@/]*@/, "//***@")}`);

  const ficheros = readdirSync("./drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  console.log(`Migraciones en ./drizzle: ${ficheros.join(", ") || "(ninguna)"}`);
  if (ficheros.length === 0) {
    console.error("No hay migraciones: ejecuta `npm run db:generate` antes.");
    process.exit(1);
  }
  if (SOLO_LISTAR) {
    console.log("Modo --listar: no se aplica nada.");
    return;
  }

  const { drizzle } = await import("drizzle-orm/neon-http");
  const { neon } = await import("@neondatabase/serverless");
  const { migrate } = await import("drizzle-orm/neon-http/migrator");

  const db = drizzle(neon(url));

  const estado = async (etiqueta: string) => {
    const r = (await db.execute(
      `SELECT COUNT(*)::int AS tablas FROM information_schema.tables WHERE table_schema = 'public'`
    )) as unknown as { rows: Array<{ tablas: number }> };
    const t = (await db.execute(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS t`
    )) as unknown as { rows: Array<{ t: string }> };
    console.log(`  ${etiqueta}: ${r.rows[0]?.tablas ?? 0} tablas, tamaño ${t.rows[0]?.t ?? "?"}`);
  };

  console.log("\nAntes:");
  await estado("estado");

  console.log("\nAplicando migraciones...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✔ Aplicadas");

  console.log("\nDespués:");
  await estado("estado");

  const tablas = (await db.execute(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  )) as unknown as { rows: Array<{ table_name: string }> };
  console.log(`\nTablas: ${tablas.rows.map((r) => r.table_name).join(", ")}`);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
