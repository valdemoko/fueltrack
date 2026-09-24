/**
 * Mide, SIN GASTAR CUOTA, cuántas filas escribe una ingesta diaria completa.
 *
 * POR QUÉ
 *   La estimación anterior de "~130.000 filas/día" era una suposición, y las
 *   suposiciones son justo lo que bloqueó la cuenta de Turso. Este script
 *   reproduce una jornada real (productos + 52 provincias + mantenimiento)
 *   contra una COPIA del fichero SQLite local y cuenta las filas modificadas
 *   con `SELECT total_changes()` de SQLite, que es exacto: cuenta filas
 *   insertadas, modificadas y borradas por la propia conexión.
 *
 *   Turso factura esa misma magnitud (más las entradas de índice que
 *   mantenga cada escritura), así que este número es el suelo del consumo
 *   diario: si ya es alto aquí, no hay multiplicador de Turso que lo salve.
 *
 * Uso:
 *   npx tsx scripts/medir-ingesta.ts                     # copia + día nuevo
 *   npx tsx scripts/medir-ingesta.ts --sin-dia-nuevo      # mide sobre el estado actual
 *   npx tsx scripts/medir-ingesta.ts --provincias=8       # muestra rápida
 *   npx tsx scripts/medir-ingesta.ts --sin-mantenimiento
 *
 * NUNCA escribe en Turso: fuerza DB_LOCAL=1 antes de importar la app.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";

const opcion = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const FUENTE = opcion("fuente") ?? "./data/combustible.db";
const COPIA = opcion("copia") ?? "./data/medicion.db";
const LIMITE_PROV = Number(opcion("provincias") ?? 0) || 52;
const DIA_NUEVO = !process.argv.includes("--sin-dia-nuevo");
const CON_MANTENIMIENTO = !process.argv.includes("--sin-mantenimiento");

const PROVINCIAS_TODAS = [
  "01","02","03","04","05","06","07","08","09","10","11","12","13","14","15",
  "16","17","18","19","20","21","22","23","24","25","26","27","28","29","30",
  "31","32","33","34","35","36","37","38","39","40","41","42","43","44","45",
  "46","47","48","49","50","51","52",
];

const TABLAS = [
  "estaciones",
  "precios",
  "precios_historico",
  "hist_geo_dia",
  "hist_geo_semana",
  "hist_nac_dia",
  "resumen_nacional",
];

const CUOTA_FREE = 10_000_000;

async function main() {
  if (!existsSync(FUENTE)) {
    console.error(`No existe la BD de origen: ${FUENTE}`);
    process.exit(1);
  }

  // ─── Copia de trabajo (nunca se toca el fichero de trabajo) ───────────────
  mkdirSync("./data", { recursive: true });
  for (const sufijo of ["", "-shm", "-wal"]) rmSync(`${COPIA}${sufijo}`, { force: true });
  copyFileSync(FUENTE, COPIA);
  console.log(
    `Copia: ${COPIA} (${(statSync(COPIA).size / 1e6).toFixed(1)} MB) — el original NO se toca`
  );

  // La app debe abrir la COPIA: esto se fija ANTES de importarla.
  process.env.DB_LOCAL = "1";
  process.env.LOCAL_DB = COPIA;
  // Sin credenciales de Turso a la vista, para que un fallo no pueda escribir fuera.
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;

  const { db, URL_EFECTIVA } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { ingestEstaciones, ingestProductos } = await import("@/lib/miteco/ingestion");
  const { mantenimientoDiario } = await import("@/lib/db/mantenimiento");

  console.log(`BD en uso: ${URL_EFECTIVA}`);
  if (!String(URL_EFECTIVA).startsWith("file:")) {
    console.error("ABORTADO: no se está trabajando sobre un fichero local.");
    process.exit(1);
  }

  // ─── Medidor ──────────────────────────────────────────────────────────────

  /** Filas modificadas por la conexión desde que se abrió (función de SQLite). */
  async function totalCambios(): Promise<number> {
    const r = (await db.get(sql`SELECT total_changes() AS n`)) as { n: number } | undefined;
    return Number(r?.n ?? 0);
  }

  async function contar(tabla: string): Promise<number> {
    const r = (await db.get(sql.raw(`SELECT COUNT(*) AS n FROM ${tabla}`))) as
      | { n: number }
      | undefined;
    return Number(r?.n ?? 0);
  }

  async function instantanea(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of TABLAS) out[t] = await contar(t);
    return out;
  }

  const registro: Array<{ etapa: string; cambios: number; detalle: string }> = [];
  let acumulado = 0;

  /** Ejecuta una etapa y anota cuántas filas ha escrito. */
  async function etapa(nombre: string, fn: () => Promise<string>) {
    const antes = await totalCambios();
    const antesPorTabla = await instantanea();
    const detalle = await fn();
    const cambios = (await totalCambios()) - antes;
    acumulado += cambios;

    const despuesPorTabla = await instantanea();
    const delta = TABLAS.map((t) => {
      const d = despuesPorTabla[t] - antesPorTabla[t];
      return d === 0 ? null : `${t} ${d >= 0 ? "+" : ""}${d}`;
    })
      .filter(Boolean)
      .join(", ");

    registro.push({
      etapa: nombre,
      cambios,
      detalle: [detalle, delta].filter(Boolean).join(" | "),
    });
    console.log(
      `  ${nombre.padEnd(14)} ${String(cambios).padStart(9)} filas escritas` +
        (delta ? `  (${delta})` : "")
    );
  }

  // ─── 0. Simular el arranque de un día nuevo ───────────────────────────────

  const hoy = new Date().toISOString().slice(0, 10);
  const lunes = (() => {
    const d = new Date(`${hoy}T00:00:00Z`);
    const dia = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dia === 0 ? -6 : 1 - dia));
    return d.toISOString().slice(0, 10);
  })();

  const fechaMax = (
    (await db.get(sql`SELECT MAX(fecha_observacion) AS f FROM precios`)) as
      | { f: string | null }
      | undefined
  )?.f;

  console.log(`\nFecha máxima en el histórico actual: ${fechaMax}`);
  console.log(`Fecha de hoy (UTC): ${hoy} | lunes de esta semana: ${lunes}\n`);

  if (DIA_NUEVO) {
    const antes = await totalCambios();
    // Se borra SOLO la jornada de hoy: precios (foto actual) y catálogos intactos.
    await db.run(sql`DELETE FROM precios_historico WHERE fecha = ${hoy}`);
    await db.run(sql`DELETE FROM hist_geo_dia WHERE fecha = ${hoy}`);
    await db.run(sql`DELETE FROM hist_nac_dia WHERE fecha = ${hoy}`);
    await db.run(sql`DELETE FROM hist_geo_semana WHERE semana = ${lunes}`);
    const borradas = (await totalCambios()) - antes;
    console.log(
      `Preparación (simular día nuevo): ${borradas} filas borradas para dejar el histórico de hoy vacío\n`
    );
  }

  // ─── 1..3. La jornada real ────────────────────────────────────────────────

  const PROVINCIAS = PROVINCIAS_TODAS.slice(0, LIMITE_PROV);
  console.log(`=== INGESTA DE UNA JORNADA (${PROVINCIAS.length} provincias) ===`);

  await etapa("productos", async () => {
    const n = await ingestProductos(db);
    return `${n} productos`;
  });

  const CONCURRENCIA = 8;
  let estaciones = 0;
  let errores = 0;
  await etapa("provincias", async () => {
    for (let i = 0; i < PROVINCIAS.length; i += CONCURRENCIA) {
      const tanda = PROVINCIAS.slice(i, i + CONCURRENCIA);
      const res = await Promise.allSettled(tanda.map((p) => ingestEstaciones(db, p)));
      res.forEach((r, j) => {
        if (r.status === "fulfilled") estaciones += r.value as number;
        else {
          errores++;
          console.error(`    ✗ provincia ${tanda[j]}: ${(r.reason as Error).message}`);
        }
      });
    }
    return `${estaciones} estaciones, ${errores} errores`;
  });

  if (CON_MANTENIMIENTO) {
    await etapa("mantenimiento", async () => {
      const m = await mantenimientoDiario(false);
      return `agregados ${m.agregados}, borrados ${m.borrados}, mes ${m.mesCerrado ?? "—"}`;
    });
  }

  // ─── Informe ──────────────────────────────────────────────────────────────

  console.log("\n================ CONSUMO DE UNA JORNADA ================");
  console.log(`  Filas escritas en total: ${acumulado.toLocaleString("es-ES")}\n`);

  const porTabla = await instantanea();
  console.log("  Estado final de las tablas:");
  for (const t of TABLAS) console.log(`    ${t.padEnd(20)} ${porTabla[t].toLocaleString("es-ES")}`);

  const mensual = acumulado * 30;
  console.log(`\n  Escrituras estimadas al mes (30 días): ${mensual.toLocaleString("es-ES")}`);
  console.log(`  Cuota Turso Free (10M): ${((mensual / CUOTA_FREE) * 100).toFixed(1)} %`);
  console.log("\n  (Turso cuenta además las entradas de índice que mantiene cada");
  console.log("   escritura: el consumo real será este número × 1,0–1,5.)");

  console.log("\nPor etapa:");
  for (const f of registro) {
    console.log(`  ${f.etapa.padEnd(14)} ${String(f.cambios).padStart(9)}  ${f.detalle}`);
  }
  console.log(
    "\n(el fichero de la copia sigue abierto por el driver: bórralo a mano cuando quieras)"
  );
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
