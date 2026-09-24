/**
 * Ingesta manual de precios de hoy contra la BD configurada en .env.local.
 *
 * Reproduce la lógica del cron de Vercel (mismas funciones de ingesta y
 * mantenimiento), pero sin límite de 60 s: útil para poner al día una BD
 * tras una migración o para disparar la actualización fuera de la ventana
 * del cron.
 *
 * Uso:
 *   npx tsx scripts/ingestar-hoy.ts                 # ingesta + mantenimiento
 *   npx tsx scripts/ingestar-hoy.ts --sin-mantenimiento
 *   npx tsx scripts/ingestar-hoy.ts --provincia 29  # solo una provincia (prueba)
 *
 * Trabaja contra `DATABASE_URL` (Neon). Antes de escribir comprueba que la BD
 * responde y que tiene el esquema creado: es preferible un error claro aquí
 * que una ingesta a medias contra una base vacía.
 */
import { readFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";

// ─── Env ─────────────────────────────────────────────────────────────────────

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const SOLO_PROVINCIA = (() => {
  const i = process.argv.indexOf("--provincia");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const CON_MANTENIMIENTO = !process.argv.includes("--sin-mantenimiento");

// Las 52 provincias, igual que el cron
const PROVINCIAS = [
  "01","02","03","04","05","06","07","08","09","10","11","12","13","14","15",
  "16","17","18","19","20","21","22","23","24","25","26","27","28","29","30",
  "31","32","33","34","35","36","37","38","39","40","41","42","43","44","45",
  "46","47","48","49","50","51","52",
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Import dinámico: `@/lib/db` lee el entorno al importarse, así que debe
  // hacerse DESPUÉS de cargar .env.local.
  const { db, queryGet, URL_EFECTIVA, isPostgres } = await import("@/lib/db");
  const { ingestEstaciones, ingestProductos } = await import("@/lib/miteco/ingestion");

  if (!isPostgres) {
    console.error(
      `ABORTADO: DATABASE_URL no apunta a Postgres/Neon (${URL_EFECTIVA}).\n` +
        "Comprueba .env.local o exporta DATABASE_URL."
    );
    process.exit(1);
  }
  console.log(`BD: ${URL_EFECTIVA}`);

  const fechaMaxima = async (): Promise<string | null> => {
    const r = await queryGet<{ f: string | null }>(
      sql`SELECT MAX(fecha_observacion) AS f FROM precios`
    );
    return r?.f ?? null;
  };

  // Comprobación previa: que el esquema exista. Escribir contra una base sin
  // tablas fallaría provincia a provincia con errores crípticos.
  const tablas = await queryGet<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const nTablas = Number(tablas?.n ?? 0);
  if (nTablas === 0) {
    console.error(
      "ABORTADO: la BD responde pero no tiene tablas.\n" +
        "Crea el esquema primero (npm run db:generate + aplicación del SQL) o migra los datos."
    );
    process.exit(1);
  }
  console.log(`Tablas en el esquema: ${nTablas}`);
  console.log(`Fecha máxima actual: ${await fechaMaxima()}\n`);

  // 1. Catálogo de productos (idempotente)
  console.log("→ Ingesta de productos...");
  await ingestProductos(db);

  // 2. Estaciones + precios por provincia (concurrencia limitada, igual que el cron)
  const objetivo = SOLO_PROVINCIA ? [SOLO_PROVINCIA] : PROVINCIAS;
  const CONCURRENCIA = 8;
  let procesadas = 0;
  let errores = 0;
  const erroresDetalle: string[] = [];

  for (let i = 0; i < objetivo.length; i += CONCURRENCIA) {
    const tanda = objetivo.slice(i, i + CONCURRENCIA);
    const resultados = await Promise.allSettled(
      tanda.map((p) => ingestEstaciones(db, p))
    );
    resultados.forEach((r, j) => {
      if (r.status === "fulfilled") {
        procesadas++;
      } else {
        errores++;
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        erroresDetalle.push(`${tanda[j]}: ${msg}`);
        console.error(`  ✗ provincia ${tanda[j]}: ${msg}`);
      }
    });
    console.log(`  [${Math.min(i + CONCURRENCIA, objetivo.length)}/${objetivo.length}] provincias procesadas...`);
  }

  console.log(`\n✔ Ingesta completada: ${procesadas}/${objetivo.length} provincias, ${errores} con error`);
  if (erroresDetalle.length) console.log(erroresDetalle.join("\n"));
  console.log(`Fecha máxima tras ingesta: ${await fechaMaxima()}`);

  if (!CON_MANTENIMIENTO) return;

  // 3. Mantenimiento diario: agregados del día + retención + cierre mensual +
  //    refresh de resumen_nacional.
  console.log("\n→ Mantenimiento diario (agregados, retención, resumen_nacional)...");
  const { mantenimientoDiario } = await import("@/lib/db/mantenimiento");
  const mant = await mantenimientoDiario(false);
  console.log(
    `✔ Agregados: ${mant.agregados} filas | Borrados (retención): ${mant.borrados} | Mes cerrado: ${mant.mesCerrado ?? "—"}`
  );

  console.log(`\n✔ TODO LISTO — fecha máxima en BD: ${await fechaMaxima()}`);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
