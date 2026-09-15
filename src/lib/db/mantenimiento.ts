/**
 * Mantenimiento diario de datos — ejecutado por /api/cron tras la ingesta.
 *
 * Responsabilidades (todo idempotente, re-ejecutable sin duplicar):
 *  1. Agregados diarios del día: hist_geo_dia (mun/prov/ccaa/nac) e
 *     hist_nac_dia — una fila por ámbito×producto×fecha.
 *  2. Retención: borrar precios_historico e hist_geo_dia fuera de su
 *     ventana (32 y 95 días) — pocas filas/día.
 *  3. Cierre mensual (solo cuando cambia el mes, ~1 vez/día de chequeo):
 *     consolidar el mes completado en hist_mun_mes / hist_prov_mes /
 *     hist_ccaa_mes / hist_estacion_mes y marcarlo en hist_meses_procesados.
 *
 * Coste de cuota diario estimado: ~2.400 escrituras + lecturas acotadas
 * a la ventana reciente (≤ 1,5M filas indexadas, con índice por fecha).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "./schema";

/** Días de histórico detallado por estación que se conservan. */
export const RETENCION_DIAS_HISTORICO = 32;
/**
 * Días de agregados diarios geográficos que se conservan.
 * Alineado con la política "30 días diarios + mensual para el pasado":
 * las gráficas de 1 mes usan estos datos; más allá, las tablas mensuales.
 */
export const RETENCION_DIAS_GEO = 35;

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fechaMenosDias(dias: number): string {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

/** Mes anterior al actual en formato yyyy-MM (solo se cierran meses completos). */
function mesAnterior(): string {
  const d = new Date();
  d.setDate(0); // último día del mes anterior
  return d.toISOString().slice(0, 7);
}

/**
 * Ejecuta el mantenimiento completo. `soloAgregados` limita el trabajo
 * (útil si el cron se queda sin tiempo: la retención puede esperar).
 */
export async function mantenimientoDiario(
  soloAgregados = false
): Promise<{ agregados: number; borrados: number; mesCerrado: string | null }> {
  const fecha = hoyIso();
  let agregados = 0;
  let borrados = 0;
  let mesCerrado: string | null = null;

  // ── 1. Agregados diarios de HOY ────────────────────────────────────────
  // Lectura: solo precios de hoy (≤43k filas, índice por fecha_observacion).

  // Resumen nacional precalculado (1 fila por producto, ~30 filas):
  // protege la cuota — las páginas de estación y resúmenes nacionales
  // leen esta tabla (≤30 filas) en vez de escanear `precios` (~46k).
  // Coste: 1 pasada por precios/día (~46k lecturas + ~30 escrituras).
  await db.run(sql`
    INSERT INTO resumen_nacional (producto_id, precio_medio, precio_min, precio_max, total_estaciones, fecha)
    SELECT producto_id, ROUND(AVG(precio), 4), MIN(precio), MAX(precio), COUNT(DISTINCT estacion_id), MAX(fecha_observacion)
    FROM precios WHERE precio IS NOT NULL
    GROUP BY producto_id
    ON CONFLICT (producto_id) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      precio_min = excluded.precio_min,
      precio_max = excluded.precio_max,
      total_estaciones = excluded.total_estaciones,
      fecha = excluded.fecha
  `);

  // Nacional diario + permanente (hist_nac_dia nunca se poda: ~13k filas/2a)
  await db.run(sql`
    INSERT INTO hist_nac_dia (producto_id, fecha, precio_medio, n_estaciones)
    SELECT producto_id, ${fecha}, ROUND(AVG(precio), 4), COUNT(*)
    FROM precios WHERE precio IS NOT NULL
    GROUP BY producto_id
    ON CONFLICT (producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);

  // Ámbitos geográficos del día (hist_geo_dia): mun/prov/ccaa/nac
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'mun', e.municipio_id, p.producto_id, ${fecha},
           ROUND(AVG(p.precio), 4), COUNT(*)
    FROM precios p JOIN estaciones e ON e.id = p.estacion_id
    WHERE p.precio IS NOT NULL
      AND p.producto_id IN (1, 3, 4, 5)
    GROUP BY e.municipio_id, p.producto_id
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'prov', e.provincia_id, p.producto_id, ${fecha},
           ROUND(AVG(p.precio), 4), COUNT(*)
    FROM precios p JOIN estaciones e ON e.id = p.estacion_id
    WHERE p.precio IS NOT NULL
    GROUP BY e.provincia_id, p.producto_id
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'ccaa', e.ccaa_id, p.producto_id, ${fecha},
           ROUND(AVG(p.precio), 4), COUNT(*)
    FROM precios p JOIN estaciones e ON e.id = p.estacion_id
    WHERE p.precio IS NOT NULL
    GROUP BY e.ccaa_id, p.producto_id
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'nac', 'ES', producto_id, ${fecha}, ROUND(AVG(precio), 4), COUNT(*)
    FROM precios WHERE precio IS NOT NULL
    GROUP BY producto_id
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);

  const diaRow = (await db.get(sql`
    SELECT
      (SELECT COUNT(*) FROM hist_geo_dia WHERE fecha = ${fecha}) +
      (SELECT COUNT(*) FROM hist_nac_dia WHERE fecha = ${fecha}) AS n
  `)) as { n: number } | undefined;
  agregados = Number(diaRow?.n ?? 0);

  if (soloAgregados) {
    return { agregados, borrados: 0, mesCerrado: null };
  }

  // ── 2. Retención (solo 1 vez por semana) ─────────────────────────────
  // Los DELETE por fecha no pueden usar la PK (la fecha no es la columna
  // inicial) → cada pasada escanea millones de filas (~2,2M lecturas).
  // Ejecutándolo solo los lunes el coste baja de ~66M lecturas/mes a ~9M,
  // sin efecto visible: la ventana se desplaza como mucho 6 días.
  const esLunes = new Date().getUTCDay() === 1;
  if (!esLunes) {
    return { agregados, borrados: 0, mesCerrado: null };
  }
  const corteHist = fechaMenosDias(RETENCION_DIAS_HISTORICO);
  const corteGeo = fechaMenosDias(RETENCION_DIAS_GEO);

  const r1 = await db.run(sql`
    DELETE FROM precios_historico WHERE fecha < ${corteHist}
  `);
  const r2 = await db.run(sql`
    DELETE FROM hist_geo_dia WHERE fecha < ${corteGeo}
  `);
  borrados = r1.rowsAffected + r2.rowsAffected;

  // ── 3. Cierre mensual idempotente ──────────────────────────────────────
  const mes = mesAnterior();
  const yaProcesado = await db.get(sql`
    SELECT mes FROM hist_meses_procesados WHERE mes = ${mes}
  `);
  if (!yaProcesado) {
    await cerrarMes(mes);
    mesCerrado = mes;
  }

  return { agregados, borrados, mesCerrado };
}

/**
 * Consolida el mes indicado en las tablas mensuales permanentes.
 * Fuente: hist_geo_dia del mes (~370k filas de la ventana) — los datos ya
 * son agregados, así que el coste es proporcional a ellos, no a precios.
 * El histórico de estación mensual viene de precios_historico (~1,4M filas
 * de la ventana, con índice PK que arranca por estacion_id).
 */
async function cerrarMes(mes: string): Promise<void> {
  const desde = `${mes}-01`;
  const hasta = `${mes}-31`;

  // Mensual por municipio / provincia / ccaa (desde hist_geo_dia)
  await db.run(sql`
    INSERT INTO hist_mun_mes (municipio_id, producto_id, mes, precio_medio, n_estaciones)
    SELECT geo_id, producto_id, ${mes}, ROUND(AVG(precio_medio), 4), MAX(n_estaciones)
    FROM hist_geo_dia
    WHERE ambito = 'mun' AND fecha BETWEEN ${desde} AND ${hasta}
    GROUP BY geo_id, producto_id
    ON CONFLICT (municipio_id, producto_id, mes) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
  await db.run(sql`
    INSERT INTO hist_prov_mes (provincia_id, producto_id, mes, precio_medio, n_estaciones)
    SELECT geo_id, producto_id, ${mes}, ROUND(AVG(precio_medio), 4), MAX(n_estaciones)
    FROM hist_geo_dia
    WHERE ambito = 'prov' AND fecha BETWEEN ${desde} AND ${hasta}
    GROUP BY geo_id, producto_id
    ON CONFLICT (provincia_id, producto_id, mes) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
  await db.run(sql`
    INSERT INTO hist_ccaa_mes (ccaa_id, producto_id, mes, precio_medio, n_estaciones)
    SELECT geo_id, producto_id, ${mes}, ROUND(AVG(precio_medio), 4), MAX(n_estaciones)
    FROM hist_geo_dia
    WHERE ambito = 'ccaa' AND fecha BETWEEN ${desde} AND ${hasta}
    GROUP BY geo_id, producto_id
    ON CONFLICT (ccaa_id, producto_id, mes) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);

  // Mensual por estación (desde precios_historico de la ventana)
  await db.run(sql`
    INSERT INTO hist_estacion_mes (estacion_id, producto_id, mes, precio_medio, n_observaciones)
    SELECT estacion_id, producto_id, ${mes}, ROUND(AVG(precio), 4), COUNT(*)
    FROM precios_historico
    WHERE fecha BETWEEN ${desde} AND ${hasta} AND precio IS NOT NULL
    GROUP BY estacion_id, producto_id
    ON CONFLICT (estacion_id, producto_id, mes) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_observaciones = excluded.n_observaciones
  `);

  // Marcar mes como procesado (idempotencia)
  await db.run(sql`
    INSERT INTO hist_meses_procesados (mes, procesado_en)
    VALUES (${mes}, ${new Date().toISOString()})
    ON CONFLICT (mes) DO NOTHING
  `);
}
