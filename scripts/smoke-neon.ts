/**
 * Comprobación de humo de la base de datos (Neon).
 *
 * Ejercita las funciones que usan las páginas —no SQL suelto— porque lo que
 * hay que validar es que la capa de datos (driver, tipos, SQL de Postgres)
 * responde, no que la base tenga filas.
 *
 * Uso:
 *   npx tsx scripts/smoke-neon.ts
 *   npx tsx scripts/smoke-neon.ts --mantenimiento   # además: ejecuta el
 *       mantenimiento diario y compara el resultado con el snapshot SQLite
 *   npx tsx scripts/smoke-neon.ts --cierre          # además: valida la
 *       retención y el cierre mensual (ver nota al final del fichero)
 *
 * No escribe nada salvo con `--mantenimiento` (que es idempotente y es
 * exactamente lo que hace el cron: recalcula los agregados de HOY).
 */
import { cargarEnvLocal } from "./cargar-env";
import { existsSync } from "node:fs";

cargarEnvLocal();

const CON_MANTENIMIENTO = process.argv.includes("--mantenimiento");
const CON_CIERRE = process.argv.includes("--cierre");
const RUTA_SQLITE = "./data/combustible.db";

async function main() {
  const db = await import("@/lib/db");
  const queries = await import("@/lib/db/queries");
  const seo = await import("@/lib/db/queries-seo");
  const geografia = await import("@/lib/geografia");

  console.log(`BD: ${db.URL_EFECTIVA}`);
  console.log(`¿Postgres? ${db.isPostgres}`);

  if (!db.isPostgres) {
    console.error("ABORTADO: DATABASE_URL no es de Postgres/Neon.");
    process.exit(1);
  }

  const tablas = await db.queryAll<{ tabla: string; filas: number }>(
    (await import("drizzle-orm")).sql`
      SELECT relname AS tabla, n_live_tup AS filas
      FROM pg_stat_user_tables ORDER BY relname
    `,
  );
  const vacias = tablas.filter((t) => Number(t.filas) === 0);
  console.log(`\nTablas (${tablas.length}), vacías: ${vacias.length}`);
  for (const t of tablas) {
    console.log(`  ${t.tabla.padEnd(24)} ${Number(t.filas).toLocaleString("es-ES")}`);
  }

  // ─── Tipos de retorno ───────────────────────────────────────────────────
  // Postgres NO devuelve lo mismo que SQLite: `numeric` llega como TEXTO (para
  // no perder precisión) y `bigint` (COUNT(*)) también. Un `?.toFixed()` o una
  // suma sobre un texto dan resultados silenciosamente incorrectos, así que el
  // reparto de tipos se comprueba aquí. Regla: si se va a operar en JS, la
  // columna tiene que salir como `double precision` (::float8) o `::int`.
  console.log("\nTipos que devuelve el driver:");
  const tipos = await db.queryGet<Record<string, unknown>>(
    (await import("drizzle-orm")).sql`
      SELECT
        COUNT(*) AS n_sin_cast,
        COUNT(*)::int AS n_int,
        AVG(precio) AS avg_float8,
        ROUND(AVG(precio)::numeric, 4) AS round_numeric,
        ROUND(AVG(precio)::numeric, 4)::float8 AS round_float8
      FROM precios
    `,
  );
  for (const [col, valor] of Object.entries(tipos ?? {})) {
    console.log(`  ${col.padEnd(16)} ${typeof valor}  ${JSON.stringify(valor)}`);
  }

  const tamano = await db.queryGet<{ t: string; limite: string }>(
    (await import("drizzle-orm")).sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS t,
             '512 MB' AS limite
    `,
  );
  console.log(`\nTamaño: ${tamano?.t} de ${tamano?.limite} (Neon Free)`);

  // Las consultas reales que usan las páginas.
  const funciones: Array<[string, () => Promise<unknown>]> = [
    ["precios medios nacionales", () => queries.getResumenProductosPrincipales()],
    ["municipios de Málaga (G95)", () => queries.getMunicipiosDeProvincia("29", 1)],
    ["estaciones de Málaga", () => queries.getEstacionesDeProvincia("29", 1)],
    ["detalle de una estación", () => queries.getEstacionDetalle("1163")],
    ["provincias de Andalucía", () => queries.getProvinciasDeCcaa("01")],
    ["ccaa con estaciones", () => queries.getCcaaConEstaciones()],
    ["últimas fechas por producto", () => seo.getUltimasFechasProductos()],
    ["histórico nacional 1 año (G95)", () => seo.getHistoricoAmbito(1, 365)],
    ["cobertura de productos (Málaga)", () => seo.getCoberturaProductos({ provinciaId: "29" })],
    ["provincia por slug", () => geografia.getProvinciaBySlug("malaga", "01")],
    ["municipio por slug", () => geografia.getMunicipioBySlug("malaga", "29")],
    ["ccaa por slug", () => geografia.getCcaaBySlug("andalucia")],
  ];
  for (const [nombre, fn] of funciones) {
    const inicio = Date.now();
    try {
      const r = await fn();
      const resumen = Array.isArray(r) ? `${r.length} filas` : r ? "con datos" : "SIN DATOS";
      const marca = r ? "✔" : "⚠";
      console.log(`${marca} ${nombre}: ${resumen} (${Date.now() - inicio}ms)`);
    } catch (e) {
      console.error(`✗ ${nombre}: ${e instanceof Error ? e.message : String(e)}`);
      // `DrizzleQueryError` envuelve el error real de Postgres en `cause`: sin
      // esto el mensaje solo repite la consulta y oculta el motivo.
      const causa = (e as { cause?: unknown }).cause;
      if (causa) console.error(`   causa: ${causa instanceof Error ? causa.message : String(causa)}`);
      process.exitCode = 1;
    }
  }

  if (CON_MANTENIMIENTO) await probarMantenimiento();
  if (CON_CIERRE) await validarCierre();
}

/**
 * Valida el SQL de las dos rutas de mantenimiento que casi nunca se ejecutan:
 * la PURGA de retención (solo lunes) y el CIERRE MENSUAL (solo el día 1).
 *
 * Hoja de ruta segura:
 *
 *  · `aplicarRetencion()`. en el estado actual los cortes caen EXACTAMENTE en
 *    el borde de las ventanas migradas, así que debe borrar 0 filas. Comprobar
 *    los 3 DELETE tiene valor: llevan la PK por ámbito geográfico, no por
 *    fecha, y por eso no son una simple búsqueda por índice.
 *
 *  · `cerrarMes('2026-09')`. El mes en curso está a medias, así que recalcula
 *    exactamente los mismos valores que ya hay (la fuente —los primeros 24
 *    días— es la misma). Después se BORRA la marca del mes a propósito: el
 *    cierre de verdad tiene que ocurrir el 1 de octubre con el mes completo.
 *    Si se dejara marcado, septiembre se quedaría con los días 1-24.
 */
async function validarCierre() {
  const db = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { aplicarRetencion, cerrarMes } = await import("@/lib/db/mantenimiento");

  const mes = new Date().toISOString().slice(0, 7);
  console.log(`\n=== RETENCIÓN Y CIERRE MENSUAL (mes en curso: ${mes}) ===`);

  console.log("→ aplicarRetencion()...");
  const borradas = await aplicarRetencion();
  console.log(`  filas borradas: ${borradas} (0 es lo correcto: los cortes caen en el borde de la ventana migrada)`);

  const cuentas = async () => ({
    mun: await db.queryGet<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM hist_mun_mes WHERE mes = ${mes}`),
    prov: await db.queryGet<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM hist_prov_mes WHERE mes = ${mes}`),
    ccaa: await db.queryGet<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM hist_ccaa_mes WHERE mes = ${mes}`),
    est: await db.queryGet<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM hist_estacion_mes WHERE mes = ${mes}`),
    media: await db.queryGet<{ m: number }>(
      sql`SELECT ROUND(AVG(precio_medio)::numeric, 4)::float8 AS m FROM hist_estacion_mes WHERE mes = ${mes}`,
    ),
  });

  const antes = await cuentas();
  console.log(
    `  antes: mun ${antes.mun?.n} · prov ${antes.prov?.n} · ccaa ${antes.ccaa?.n} · estación ${antes.est?.n} · media estación ${antes.media?.m}`
  );

  console.log(`→ cerrarMes('${mes}')...`);
  await cerrarMes(mes);

  const despues = await cuentas();
  console.log(
    `  después: mun ${despues.mun?.n} · prov ${despues.prov?.n} · ccaa ${despues.ccaa?.n} · estación ${despues.est?.n} · media estación ${despues.media?.m}`
  );
  const igual =
    despues.mun?.n === antes.mun?.n &&
    despues.prov?.n === antes.prov?.n &&
    despues.ccaa?.n === antes.ccaa?.n &&
    despues.est?.n === antes.est?.n &&
    Math.abs((despues.media?.m ?? 0) - (antes.media?.m ?? 0)) < 0.0001;
  console.log(
    `${igual ? "✔" : "✗"} el cierre reproduce las filas y la media que ya había ` +
      `(misma fuente: el mes en curso va por la mitad)`
  );
  if (!igual) process.exitCode = 1;

  // La marca se retira SIEMPRE: el cierre definitivo es el del día 1.
  await db.queryRun(sql`DELETE FROM hist_meses_procesados WHERE mes = ${mes}`);
  console.log(`  marca de "${mes} ya procesado" retirada (el cierre real es el día 1 de octubre con el mes entero)`);
}

/**
 * Ejecuta el mantenimiento diario (ESCRIBE: recalcula los agregados de hoy,
 * que es justo lo que hace el cron) y comprueba que el resultado coincide con
 * el que calculó la implementación anterior sobre SQLite para el mismo día.
 *
 * Es la única forma de validar el SQL de Postgres de `mantenimiento.ts`: el
 * cron no ejecuta los caminos de retención ni de cierre mensual casi nunca, y
 * un error ahí tardaría semanas en aparecer.
 */
async function probarMantenimiento() {
  const db = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { mantenimientoDiario } = await import("@/lib/db/mantenimiento");

  const hoy = new Date().toISOString().slice(0, 10);
  console.log(`\n=== MANTENIMIENTO DIARIO (${hoy}) ===`);
  const mant = await mantenimientoDiario(false);
  console.log(
    `  agregados: ${mant.agregados} | borrados: ${mant.borrados} | ` +
      `mes cerrado: ${mant.mesCerrado ?? "— (solo se cierra el día 1)"}`
  );

  const neonNac = await db.queryAll<{ producto_id: number; precio_medio: number; n_estaciones: number }>(
    sql`SELECT producto_id, precio_medio, n_estaciones FROM hist_nac_dia WHERE fecha = ${hoy}`,
  );
  const neonRes = await db.queryAll<{ producto_id: number; precio_medio: number; total_estaciones: number; fecha: string }>(
    sql`SELECT producto_id, precio_medio, total_estaciones, fecha FROM resumen_nacional`,
  );
  console.log(`  hist_nac_dia de hoy: ${neonNac.length} filas · resumen_nacional: ${neonRes.length} filas`);
  for (const r of neonNac) {
    console.log(`    producto ${r.producto_id}: ${r.precio_medio} €/L · ${r.n_estaciones} estaciones`);
  }

  if (!existsSync(RUTA_SQLITE)) {
    console.log("  (sin snapshot SQLite: no se puede comparar con el motor anterior)");
    return;
  }

  const Database = (await import("better-sqlite3")).default;
  const bd = new Database(RUTA_SQLITE, { readonly: true });
  const sqliteNac = bd
    .prepare("SELECT producto_id, precio_medio, n_estaciones FROM hist_nac_dia WHERE fecha = ?")
    .all(hoy) as Array<{ producto_id: number; precio_medio: number; n_estaciones: number }>;
  const sqliteRes = bd
    .prepare("SELECT producto_id, precio_medio, total_estaciones, fecha FROM resumen_nacional")
    .all() as Array<{ producto_id: number; precio_medio: number; total_estaciones: number; fecha: string }>;
  bd.close();

  /** Diferencia máxima entre dos series indexadas por producto. */
  const comparar = (
    etiqueta: string,
    a: Array<{ producto_id: number } & Record<string, unknown>>,
    b: Array<{ producto_id: number } & Record<string, unknown>>,
    columnas: string[],
  ) => {
    const mapaB = new Map(b.map((f) => [f.producto_id, f]));
    let max = 0;
    let comparados = 0;
    for (const fa of a) {
      const fb = mapaB.get(fa.producto_id);
      if (!fb) continue;
      for (const c of columnas) {
        const va = Number(fa[c]);
        const vb = Number(fb[c]);
        if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
        max = Math.max(max, Math.abs(va - vb));
        comparados++;
      }
    }
    const ok = comparados > 0 && max < 0.0001;
    console.log(
      `${ok ? "✔" : "✗"} ${etiqueta}: ${comparados} valores comparados, diferencia máxima ${max.toFixed(6)}`
    );
    if (!ok) process.exitCode = 1;
  };

  // El mismo día calculado por las dos implementaciones debe dar lo mismo.
  comparar("hist_nac_dia (Neon vs SQLite)", neonNac, sqliteNac, ["precio_medio", "n_estaciones"]);
  comparar("resumen_nacional (Neon vs SQLite)", neonRes, sqliteRes, ["precio_medio", "total_estaciones"]);
  console.log(
    `  resumen_nacional fechado en: ${[...new Set(neonRes.map((r) => r.fecha))].join(", ")}`
  );
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
