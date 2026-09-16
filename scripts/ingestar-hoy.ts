/**
 * Ingesta manual de precios de hoy contra la BD configurada en .env.local.
 *
 * Reproduce la lógica del cron de Vercel (mismas funciones de ingesta y
 * mantenimiento), pero sin límite de 60 s: útil para poner al día una BD
 * tras una migración o para disparar la actualización fuera de la ventana
 * de las 06:00 UTC.
 *
 * Uso:
 *   npx tsx scripts/ingestar-hoy.ts                 # ingesta + mantenimiento
 *   npx tsx scripts/ingestar-hoy.ts --sin-mantenimiento
 *   npx tsx scripts/ingestar-hoy.ts --provincia 29  # solo una provincia (prueba)
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";
import { ingestEstaciones, ingestProductos } from "@/lib/miteco/ingestion";

// ─── Env ─────────────────────────────────────────────────────────────────────

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const HOSTS_PROHIBIDOS = [
  "fueltrack-valdemokoo.aws-eu-west-1.turso.io",
  "combustible-webssssss.aws-eu-west-1.turso.io",
];

const URL_BD = process.env.TURSO_DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;
if (!URL_BD || !TOKEN) {
  console.error("Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN en .env.local");
  process.exit(1);
}
for (const host of HOSTS_PROHIBIDOS) {
  if (URL_BD.includes(host)) {
    console.error(`BLOQUEADO: la URL apunta a una BD anterior (${host})`);
    process.exit(1);
  }
}

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

const client = createClient({ url: URL_BD, authToken: TOKEN });
const db = drizzle(client, { schema });

async function fechaMaxima(): Promise<string | null> {
  const r = await client.execute("SELECT MAX(fecha_observacion) f FROM precios");
  return (r.rows[0]?.f as string) ?? null;
}

async function main() {
  console.log(`BD: ${URL_BD}`);
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

  // 3. Mantenimiento diario: agregados del día + retención semanal +
  //    cierre mensual + refresh de resumen_nacional.
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
