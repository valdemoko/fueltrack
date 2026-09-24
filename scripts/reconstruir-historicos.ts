/**
 * Relleno de días perdidos en el histórico diario + reconstrucción de agregados.
 *
 * PARA QUÉ SIRVE
 *   El cron diario solo escribe los datos de HOY. Si la BD se queda sin los
 *   días intermedios (parada del cron, migración a otra cuenta, restauración
 *   desde el fichero local), esas fechas nunca se recuperarían solas.
 *   MITECO publica un parte por día en su API histórica:
 *     /EstacionesTerrestresHist/{dd-MM-yyyy}
 *   así que este script detecta el hueco y lo rellena fecha a fecha.
 *
 * QUÉ ESCRIBE
 *   1. `precios_historico`: las observaciones de cada día que falte
 *      (NO toca `precios` ni `estaciones`: ver ingestHistorico(soloHistorico)).
 *   2. `hist_geo_dia`: agregados mun/prov/ccaa/nac de esos días, calculados
 *      desde las observaciones recién cargadas.
 *   3. `hist_geo_semana` e `hist_nac_dia`: agregados semanales y serie
 *      nacional diaria del mismo rango.
 *
 * Uso:
 *   npx tsx scripts/reconstruir-historicos.ts                    # plan (no escribe)
 *   npx tsx scripts/reconstruir-historicos.ts --ejecutar
 *   npx tsx scripts/reconstruir-historicos.ts --ejecutar --desde=2026-09-14 --hasta=2026-09-23
 *
 * Coste: por día ~47k filas de observaciones + ~9k de agregados. En Neon no
 * hay cuota por fila, pero sí un límite de 10 s por sentencia: por eso la
 * ingesta va por lotes (ver FILAS_POR_SENTENCIA en la ingesta).
 */
import { readFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";

// ─── Entorno ─────────────────────────────────────────────────────────────────

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL (en .env.local o por entorno)");
  process.exit(1);
}
/** URL con la contraseña oculta, para poder imprimirla. */
const URL_ENMASCARADA = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@/]*@/, "//***@");

const EJECUTAR = process.argv.includes("--ejecutar");
const opcion = (nombre: string): string | null => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const DESDE_ARG = opcion("desde");
const HASTA_ARG = opcion("hasta");
/** Tope de días por ejecución (evita reventar la cuota de una tacada). */
const MAX_DIAS = Number(opcion("max-dias") ?? 35);

// ─── Fechas (ISO yyyy-MM-dd) ─────────────────────────────────────────────────

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function isoADdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
function ayerIso(): string {
  return sumarDias(new Date().toISOString().slice(0, 10), -1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Import dinámico: `@/lib/db` lee las variables de entorno al importarse,
  // así que debe hacerse DESPUÉS de cargar .env.local.
  const { db, queryAll, queryGet } = await import("@/lib/db");
  const { ingestHistorico } = await import("@/lib/miteco/ingestion");
  const { reconstruirGeoDia, reconstruirSemanasYNacional, RETENCION_DIAS_HISTORICO } =
    await import("@/lib/db/mantenimiento");

  const ayer = ayerIso();
  const corte = DESDE_ARG ?? sumarDias(ayer, -(RETENCION_DIAS_HISTORICO - 1));
  const fin = HASTA_ARG ?? ayer;

  const nHist = await queryGet<{ n: number }>(sql`SELECT COUNT(*) AS n FROM precios_historico`);
  const nGeo = await queryGet<{ n: number }>(sql`SELECT COUNT(*) AS n FROM hist_geo_dia`);

  console.log(`BD: ${URL_ENMASCARADA}`);
  console.log(`precios_historico: ${nHist?.n ?? 0} filas`);
  console.log(`hist_geo_dia:      ${nGeo?.n ?? 0} filas`);
  console.log(`Ventana que debe existir: ${corte} … ${fin}\n`);

  // Días esperados de la ventana
  const esperados: string[] = [];
  for (let d = corte; d <= fin; d = sumarDias(d, 1)) esperados.push(d);

  // Días realmente presentes (incluye huecos INTERIORES: una parada del cron
  // a mitad de mes no se detectaría mirando solo la fecha máxima).
  const leerFechas = async (tabla: string): Promise<Set<string>> => {
    const filas = await queryAll<{ fecha: string }>(sql.raw(
      `SELECT DISTINCT fecha FROM ${tabla} WHERE fecha BETWEEN '${corte}' AND '${fin}'`
    ));
    return new Set(filas.map((f) => f.fecha));
  };
  const presentesHist = await leerFechas("precios_historico");
  const presentesGeo = await leerFechas("hist_geo_dia");

  const faltanHist = esperados.filter((d) => !presentesHist.has(d)).slice(0, MAX_DIAS);
  const faltanGeo = esperados.filter((d) => !presentesGeo.has(d));

  console.log(`Días SIN observaciones (precios_historico): ${faltanHist.length}`);
  if (faltanHist.length) console.log(`  ${faltanHist.join(" ")}`);
  console.log(`Días SIN agregados (hist_geo_dia):        ${faltanGeo.length}`);
  if (faltanGeo.length) console.log(`  ${faltanGeo.join(" ")}`);

  if (faltanHist.length === 0 && faltanGeo.length === 0) {
    console.log("\nNada que rellenar: la ventana diaria está completa.");
    return;
  }

  console.log(
    `\nVolumen a escribir: ~${(faltanHist.length * 56000).toLocaleString("es-ES")} filas ` +
      `en ${faltanHist.length} día(s) de observaciones + agregados.`
  );
  if (!EJECUTAR) {
    console.log("\nModo plan: no se escribe nada. Añade --ejecutar para rellenar.");
    return;
  }

  // 1. Observaciones de cada día que falta (solo precios_historico)
  let ok = 0;
  const fallos: string[] = [];
  for (const dia of faltanHist) {
    try {
      const n = await ingestHistorico(db, isoADdMmYyyy(dia), true);
      ok++;
      console.log(`✔ ${dia}: ${n} estaciones`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ ${dia}: ${msg}`);
      fallos.push(dia);
    }
  }

  // 2. Agregados de todos los días afectados (los recién cargados y los que
  //    solo les faltaban los agregados), desde las observaciones ya presentes.
  const afectados = [...new Set([...faltanGeo, ...faltanHist])].sort();
  if (afectados.length > 0) {
    const d0 = afectados[0];
    const d1 = afectados[afectados.length - 1];
    console.log(`\n→ Reconstruyendo hist_geo_dia (${d0} … ${d1})...`);
    await reconstruirGeoDia(d0, d1);
    console.log("→ Reconstruyendo hist_geo_semana e hist_nac_dia...");
    await reconstruirSemanasYNacional(d0, d1);

    const comprobacion = await queryGet<{ n: number }>(sql`
      SELECT COUNT(DISTINCT fecha) AS n FROM hist_geo_dia
      WHERE fecha BETWEEN ${d0} AND ${d1}
    `);
    console.log(
      `\n✔ hist_geo_dia: ${comprobacion?.n ?? 0} días con datos en el rango reconstruido`
    );
  }

  console.log(`\nResumen: ${ok}/${faltanHist.length} días con observaciones rellenadas.`);
  if (fallos.length) {
    console.error(`Fallaron: ${fallos.join(", ")} (vuelve a ejecutar para reintentarlos)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
