/**
 * Migra los datos de `data/combustible.db` (SQLite) a Neon (Postgres).
 *
 * Uso:
 *   npx tsx scripts/migrar-sqlite-a-neon.ts                  # inventario (no escribe)
 *   npx tsx scripts/migrar-sqlite-a-neon.ts --ejecutar
 *   npx tsx scripts/migrar-sqlite-a-neon.ts --ejecutar --tabla=precios_historico
 *   npx tsx scripts/migrar-sqlite-a-neon.ts --ejecutar --rehacer=hist_geo_dia
 *
 * ── DISEÑO (por qué es seguro reejecutarlo) ─────────────────────────────────
 *
 * · RECONCILIANTE: antes de cada tabla cuenta las filas del destino. Si ya
 *   están todas, la salta sin escribir nada (0 bytes de tráfico). Si está a
 *   medias, aborta esa tabla y pide `--rehacer=<tabla>` en lugar de duplicar.
 * · VERIFICADO: al terminar compara recuento Y suma de las columnas numéricas
 *   ('precio', 'precio_medio', 'latitud', 'longitud'…). Un recuento igual con
 *   una suma distinta significa filas corruptas o columnas desalineadas.
 * · TAMAÑO A LA VISTA: imprime `pg_database_size()` tras CADA tabla. Neon Free
 *   da 0,5 GB y no avisa antes de llenarse: se migran primero las tablas
 *   pequeñas para ver la curva de crecimiento y poder parar a tiempo.
 * · SIN CLAVES FORÁNEAS en el destino, así que el orden de las tablas es
 *   indiferente (ver schema.ts).
 *
 * ── SOLO SE MIGRA LA VENTANA DE RETENCIÓN (`--todo` para saltárselo) ───────
 *
 * Neon Free son 512 MB y NO AVISA antes de llenarse: cuando se supera, las
 * escrituras fallan con "project size limit exceeded" y la ingesta diaria se
 * cae. Medido: el volcado completo del fichero SQLite lo rebasa (~600 MB).
 *
 * El fichero local guarda MÁS de lo que la aplicación conserva:
 * `precios_historico` e `hist_geo_dia` se purgan a los 30 días y
 * `hist_geo_semana` a los 200 (ver `mantenimiento.ts`). Migrar lo que ya está
 * fuera de esas ventanas ocupa espacio que el primer lunes se borraría —y
 * Postgres no devuelve el fichero al sistema al borrar, así que el hueco se
 * queda ocupado hasta que otra escritura lo reutilice.
 *
 * Por eso, por defecto, esas tres tablas se copian solo dentro de la ventana.
 * Los agregados mensuales y `hist_nac_dia` son PERMANENTES y van completos.
 *
 * ── POR QUÉ NO USA `pg_dump` NI COPY ────────────────────────────────────────
 *
 * No hay Postgres local ni `psql` en esta máquina, y el driver HTTP de Neon no
 * implementa COPY. Se insertan lotes por HTTP: 1.000 filas por sentencia y 4
 * sentencias por transacción (una ida y vuelta de red por cada 4.000 filas).
 */
import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { cargarEnvLocal } from "./cargar-env";

cargarEnvLocal();

const EJECUTAR = process.argv.includes("--ejecutar");
const opcion = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const SOLO_TABLA = opcion("tabla") ?? process.argv.find((a) => a.startsWith("--tabla="))?.split("=")[1] ?? null;
/** Tablas a vaciar antes de copiar (lista separada por comas). */
const REHACER = (
  opcion("rehacer") ?? process.argv.find((a) => a.startsWith("--rehacer="))?.split("=")[1] ?? ""
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const ORIGEN = opcion("origen") ?? "./data/combustible.db";

/** Filas por sentencia INSERT (límite de Postgres: 65.535 parámetros). */
const FILAS_POR_SENTENCIA = 1000;
/** Sentencias por transacción = peticiones HTTP por cada N × 1000 filas. */
const SENTENCIAS_POR_TRANSACCION = 4;

/**
 * Orden de migración: de la tabla más pequeña a la más grande.
 * No hay dependencias (sin claves foráneas), así que el criterio es poder ver
 * pronto el tamaño real en Neon y abortar antes de gastar 400 MB.
 */
const ORDEN = [
  "productos",
  "hist_meses_procesados",
  "resumen_nacional",
  "ccaa",
  "provincias",
  "municipios",
  "hist_ccaa_mes",
  "hist_prov_mes",
  "hist_nac_dia",
  "hist_geo_semana",
  "estaciones",
  "precios",
  "hist_mun_mes",
  "hist_estacion_mes",
  "hist_geo_dia",
  "precios_historico",
] as const;

/**
 * Tablas con ventana de retención: `tabla -> { columna, dias }`.
 * El corte se calcula con la fecha de hoy, igual que hace el mantenimiento.
 */
const VENTANAS: Record<string, { columna: string; dias: number }> = {
  precios_historico: { columna: "fecha", dias: 30 },
  hist_geo_dia: { columna: "fecha", dias: 30 },
  hist_geo_semana: { columna: "semana", dias: 200 },
};

/** Con `--todo` se migran también las filas fuera de la ventana de retención. */
const MIGRAR_TODO = process.argv.includes("--todo");

/** Corte ISO (yyyy-MM-dd) de la ventana de una tabla, o null si no tiene. */
function corteDe(tabla: string): string | null {
  if (MIGRAR_TODO) return null;
  const v = VENTANAS[tabla];
  if (!v) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - v.dias);
  return d.toISOString().slice(0, 10);
}

/** Columnas cuya suma se compara además del recuento. */
const COLUMNAS_SUMA = [
  "precio",
  "precio_medio",
  "precio_min",
  "precio_max",
  "latitud",
  "longitud",
  "n_estaciones",
  "n_observaciones",
  "total_estaciones",
  "bioetanol_pct",
  "ester_metilico_pct",
  "producto_id",
];

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.error("Falta DATABASE_URL (Postgres) en .env.local o en el entorno.");
    process.exit(1);
  }
  console.log(`Destino: ${url.replace(/\/\/[^@/]*@/, "//***@")}`);

  const bd = new Database(ORIGEN, { readonly: true });
  console.log(`Origen:  ${ORIGEN} (${(statSync(ORIGEN).size / 1e6).toFixed(1)} MB)\n`);

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Columnas reales de una tabla en Postgres (nombres, en orden del catálogo). */
  const columnasDestino = async (tabla: string): Promise<string[]> => {
    const filas = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tabla}
      ORDER BY ordinal_position
    ` as unknown as Array<{ column_name: string }>;
    return filas.map((f) => f.column_name);
  };

  /** Filas del origen a migrar: todas, o solo las de dentro de la ventana. */
  const contarOrigen = (tabla: string): number => {
    const corte = corteDe(tabla);
    const donde = corte ? ` WHERE ${VENTANAS[tabla].columna} >= '${corte}'` : "";
    return (bd.prepare(`SELECT COUNT(*) AS n FROM ${tabla}${donde}`).get() as { n: number }).n;
  };

  /** Filas totales del origen, sin filtrar (para poder informar de lo omitido). */
  const contarOrigenTotal = (tabla: string): number =>
    (bd.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;

  const contarDestino = async (tabla: string): Promise<number> => {
    const r = await sql.query(`SELECT COUNT(*)::int AS n FROM "${tabla}"`);
    return Number((r as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  };

  /**
   * Suma de una columna en el origen, con el MISMO filtro de ventana que la
   * copia: si no, la verificación compararía cosas distintas y daría un falso
   * positivo de corrupción.
   */
  const sumaOrigen = (tabla: string, col: string): number | null => {
    try {
      const corte = corteDe(tabla);
      const donde = corte ? ` WHERE ${VENTANAS[tabla].columna} >= '${corte}'` : "";
      const r = bd.prepare(`SELECT SUM("${col}") AS s FROM ${tabla}${donde}`).get() as { s: number | null };
      return r?.s === null || r?.s === undefined ? 0 : Number(r.s);
    } catch {
      return null;
    }
  };

  const sumaDestino = async (tabla: string, col: string): Promise<number | null> => {
    try {
      const r = await sql.query(`SELECT COALESCE(SUM("${col}"), 0)::float8 AS s FROM "${tabla}"`);
      return Number((r as unknown as Array<{ s: number }>)[0]?.s ?? 0);
    } catch {
      return null;
    }
  };

  const tamano = async (): Promise<string> => {
    const r = (await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS t`) as unknown as Array<{ t: string }>;
    return r[0]?.t ?? "?";
  };

  // ─── Inventario ─────────────────────────────────────────────────────────────

  const tablasOrigen = (
    bd.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>
  ).map((t) => t.name);

  console.log("─── INVENTARIO ───");
  console.log(`Origen: ${tablasOrigen.length} tablas · tamaño actual en Neon: ${await tamano()}\n`);
  const plan: string[] = [];
  for (const tabla of ORDEN) {
    if (!tablasOrigen.includes(tabla)) {
      console.log(`  ${tabla.padEnd(22)} ⚠ no existe en el origen, se omite`);
      continue;
    }
    const n = contarOrigen(tabla);
    const total = contarOrigenTotal(tabla);
    const d = await contarDestino(tabla);
    const estado = d === 0 ? "vacía" : d === n ? "completa" : `A MEDIAS (${d})`;
    const corte = corteDe(tabla);
    const ventana = corte ? ` (ventana ≥ ${corte}; se omiten ${(total - n).toLocaleString("es-ES")} de ${total.toLocaleString("es-ES")})` : "";
    console.log(`  ${tabla.padEnd(22)} ${String(n).padStart(9)} filas · destino: ${estado}${ventana}`);
    plan.push(tabla);
  }
  console.log("");

  if (!EJECUTAR) {
    console.log("Modo inventario: no se escribe nada. Añade --ejecutar para migrar.");
    return;
  }

  // `--tabla=a,b,c` permite migrar por tandas y medir el tamaño entre tandas.
  const seleccion = SOLO_TABLA ? SOLO_TABLA.split(",").map((t) => t.trim()) : null;
  const objetivo = seleccion ? plan.filter((t) => seleccion.includes(t)) : plan;
  if (objetivo.length === 0) {
    console.error(`No hay nada que migrar para --tabla=${SOLO_TABLA}`);
    process.exit(1);
  }

  // ─── Migración ──────────────────────────────────────────────────────────────

  const fallos: string[] = [];

  for (const tabla of objetivo) {
    const nOrigen = contarOrigen(tabla);
    let nDestino = await contarDestino(tabla);

    if (REHACER.includes(tabla)) {
      // TRUNCATE (no DELETE): Postgres no devuelve al sistema el espacio de
      // las filas borradas, pero sí el de una tabla truncada. En un plan con
      // límite de tamaño esa diferencia es la que decide si cabe o no.
      console.log(`[${tabla}] --rehacer: truncando ${nDestino} filas del destino...`);
      await sql.query(`TRUNCATE TABLE "${tabla}"`);
      nDestino = 0;
    }
    if (nDestino === nOrigen && nOrigen > 0) {
      console.log(`[${tabla}] ya está completa (${nOrigen} filas): 0 escrituras`);
      continue;
    }
    if (nDestino > 0) {
      console.error(
        `[${tabla}] ABORTADO: el destino tiene ${nDestino} de ${nOrigen} filas.\n` +
          `  Para rehacerla desde cero:  npx tsx scripts/migrar-sqlite-a-neon.ts --ejecutar --tabla=${tabla} --rehacer=${tabla}`
      );
      fallos.push(tabla);
      continue;
    }

    const cols = await columnasDestino(tabla);
    const colsOrigen = (
      bd.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    const faltan = colsOrigen.filter((c) => !cols.includes(c));
    if (faltan.length > 0) {
      console.error(`[${tabla}] ABORTADO: el origen tiene columnas que no existen en Postgres: ${faltan.join(", ")}`);
      fallos.push(tabla);
      continue;
    }

    const columnas = cols.join(", ");
    const inicio = Date.now();
    let escritas = 0;

    // Lotes de sentencias: cada transacción lleva SENTENCIAS_POR_TRANSACCION
    // INSERT y se espera una sola vez (una ida y vuelta por lote).
    // Se guardan como texto+parámetros (datos planos) en lugar de promesas del
    // driver: la transacción se construye con la forma de callback, que ya
    // trae los tipos del driver sin arrastrar sus genéricos hasta aquí.
    let pendientes: Array<{ texto: string; params: unknown[] }> = [];
    const enviar = async () => {
      if (pendientes.length === 0) return;
      const cola = pendientes;
      pendientes = [];
      await sql.transaction((tx) => cola.map((s) => tx.query(s.texto, s.params)));
    };

    const corte = corteDe(tabla);
    const donde = corte ? ` WHERE ${VENTANAS[tabla].columna} >= '${corte}'` : "";
    const consulta = bd.prepare(`SELECT rowid AS __rowid, * FROM ${tabla}${donde} ORDER BY rowid`);
    let lote: Record<string, unknown>[] = [];

    const vaciarLote = async () => {
      if (lote.length === 0) return;
      const placeholders = lote
        .map(
          (_, i) =>
            `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(", ")})`
        )
        .join(", ");
      const params = lote.flatMap((fila) => cols.map((c) => fila[c] ?? null));
      pendientes.push({
        texto: `INSERT INTO "${tabla}" (${columnas}) VALUES ${placeholders}`,
        params,
      });
      escritas += lote.length;
      lote = [];
      if (pendientes.length >= SENTENCIAS_POR_TRANSACCION) await enviar();
    };

    for (const fila of consulta.iterate() as IterableIterator<Record<string, unknown>>) {
      lote.push(fila);
      if (lote.length >= FILAS_POR_SENTENCIA) await vaciarLote();
      if (escritas > 0 && escritas % 100_000 === 0 && lote.length === 0) {
        const pct = ((escritas / nOrigen) * 100).toFixed(1);
        console.log(`  ${tabla}: ${escritas.toLocaleString("es-ES")} / ${nOrigen.toLocaleString("es-ES")} (${pct} %)`);
      }
    }
    await vaciarLote();
    await enviar();

    const segundos = ((Date.now() - inicio) / 1000).toFixed(0);

    // ── Verificación: recuento Y suma ──
    const nFinal = await contarDestino(tabla);
    let sumasOk = true;
    const detalles: string[] = [];
    for (const col of COLUMNAS_SUMA) {
      if (!colsOrigen.includes(col)) continue;
      const so = sumaOrigen(tabla, col);
      if (so === null) continue;
      const sd = await sumaDestino(tabla, col);
      if (sd === null || Math.abs(so - sd) > 0.01) {
        sumasOk = false;
        detalles.push(`${col}: origen ${so} ≠ destino ${sd}`);
      }
    }

    const ok = nFinal === nOrigen && sumasOk;
    if (!ok) fallos.push(tabla);
    console.log(
      `${ok ? "✔" : "✗"} ${tabla.padEnd(22)} ${escritas.toLocaleString("es-ES")} filas en ${segundos}s · ` +
        `verificado ${nFinal.toLocaleString("es-ES")}/${nOrigen.toLocaleString("es-ES")} · tamaño ${await tamano()}`
    );
    for (const d of detalles) console.error(`    ✗ suma ${d}`);
  }

  // ─── Resultado ──────────────────────────────────────────────────────────────

  console.log("\n================ RESULTADO ================");
  console.log(`Tamaño final de la base de datos: ${await tamano()}`);
  for (const t of objetivo) {
    const n = contarOrigen(t);
    const d = await contarDestino(t);
    console.log(`  ${t.padEnd(22)} ${d.toLocaleString("es-ES").padStart(9)} / ${n.toLocaleString("es-ES")} ${d === n ? "✔" : "✗"}`);
  }
  if (fallos.length) {
    console.error(`\n✗ Tablas con problemas: ${fallos.join(", ")}`);
    process.exit(1);
  }
  console.log("\n✔ Migración completa y verificada.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
