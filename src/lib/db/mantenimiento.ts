/**
 * Mantenimiento diario de datos — ejecutado por /api/cron tras la ingesta.
 *
 * Responsabilidades (todo idempotente, re-ejecutable sin duplicar):
 *  1. Agregados diarios del día: hist_geo_dia (mun/prov/ccaa/nac) e
 *     hist_nac_dia — una fila por ámbito×producto×fecha.
 *  2. Agregado de la semana en curso: hist_geo_semana (mun/prov/ccaa).
 *  3. Retención (solo 1 vez por semana): precios_historico, hist_geo_dia y
 *     hist_geo_semana fuera de sus ventanas.
 *  4. Cierre mensual (solo cuando cambia el mes): consolidar el mes
 *     completado en hist_mun_mes / hist_prov_mes / hist_ccaa_mes /
 *     hist_estacion_mes y marcarlo en hist_meses_procesados.
 *
 * VENTANAS DE RETENCIÓN (política: "30 días diarios + semanal + mensual"):
 *   - precios_historico  ......... 30 días (detalle por estación)
 *   - hist_geo_dia ............... 30 días (detalle por municipio/prov/ccaa/nac)
 *   - hist_geo_semana ............ 200 días (puente 1-6 meses)
 *   - hist_*_mes ................. permanente (histórico largo)
 *   - hist_nac_dia ............... permanente (serie diaria nacional, ~6,6k
 *                                   filas/año: da resolución diaria de por vida)
 * La purga corre los lunes: la ventana efectiva nunca es MENOR que la
 * política (30-36 días), así que las gráficas de "1 mes" siempre tienen sus
 * 30 días completos.
 *
 * Coste de cuota con una única pasada diaria (2,5M filas en total):
 *   - agregados:  ~5 pasadas sobre `precios` (46,8k) + 1 sobre la semana de
 *     hist_geo_dia (~82k) ≈ 330k lecturas y ~18k escrituras.
 *   - purga (lunes): ~1,1M lecturas (precios_historico 30d) + borrados.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Días de histórico detallado por estación que se conservan. */
export const RETENCION_DIAS_HISTORICO = 30;
/** Días de agregados diarios geográficos que se conservan. */
export const RETENCION_DIAS_GEO = 30;
/** Días de agregados semanales que se conservan (puente hacia el mensual). */
export const RETENCION_DIAS_SEMANA = 200;

/** Productos principales (los que se agregan por ámbito geográfico). */
const PRODUCTOS_GEO = [1, 3, 4, 5];
const LISTA_PRODUCTOS_GEO = sql.join(
  PRODUCTOS_GEO.map((id) => sql`${id}`),
  sql`, `
);

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fechaMenosDias(dias: number): string {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

/**
 * Lunes de la semana ISO a la que pertenece `fecha` (yyyy-MM-dd).
 * SQLite calcula lo mismo con date(fecha,'weekday 0','-6 days').
 */
export function lunesDeSemana(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = d.getUTCDay(); // 0=domingo
  const desplazamiento = dia === 0 ? -6 : 1 - dia;
  d.setUTCDate(d.getUTCDate() + desplazamiento);
  return d.toISOString().slice(0, 10);
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

  // Autocuración: la tabla semanal se crea sola si la BD es heredada (así el
  // cron nunca falla por una tabla que falta tras una migración a mano).
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS hist_geo_semana (
      ambito TEXT NOT NULL,
      geo_id TEXT NOT NULL,
      producto_id INTEGER NOT NULL,
      semana TEXT NOT NULL,
      precio_medio REAL NOT NULL,
      n_estaciones INTEGER NOT NULL,
      PRIMARY KEY (ambito, geo_id, producto_id, semana)
    )
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_hist_geo_semana ON hist_geo_semana(semana)
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS resumen_nacional (
      producto_id INTEGER PRIMARY KEY,
      precio_medio REAL NOT NULL,
      precio_min REAL NOT NULL,
      precio_max REAL NOT NULL,
      total_estaciones INTEGER NOT NULL,
      fecha TEXT NOT NULL
    )
  `);

  // ── 1. Agregados diarios de HOY ────────────────────────────────────────
  // Lectura: solo `precios` (46,8k filas = foto actual, sin filtro de fecha).

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

  // Nacional diario + permanente (hist_nac_dia nunca se poda: ~6,6k filas/año)
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
      AND p.producto_id IN (${LISTA_PRODUCTOS_GEO})
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
      AND p.producto_id IN (${LISTA_PRODUCTOS_GEO})
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
      AND p.producto_id IN (${LISTA_PRODUCTOS_GEO})
    GROUP BY e.ccaa_id, p.producto_id
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'nac', 'ES', producto_id, ${fecha}, ROUND(AVG(precio), 4), COUNT(*)
    FROM precios WHERE precio IS NOT NULL
      AND producto_id IN (${LISTA_PRODUCTOS_GEO})
    GROUP BY producto_id
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);

  // ── 2. Agregado de la semana en curso ──────────────────────────────────
  // Puente entre el detalle diario (30 días) y las medias mensuales: las
  // gráficas de 1-6 meses leen esta tabla (resolución semanal). Solo se
  // recalcula la semana EN CURSO (≤7 días de hist_geo_dia, ~82k lecturas);
  // las semanas ya cerradas no se vuelven a tocar.
  const lunes = lunesDeSemana(fecha);
  await agregarSemanas(lunes, fecha);

  const diaRow = (await db.get(sql`
    SELECT
      (SELECT COUNT(*) FROM hist_geo_dia WHERE fecha = ${fecha}) +
      (SELECT COUNT(*) FROM hist_nac_dia WHERE fecha = ${fecha}) AS n
  `)) as { n: number } | undefined;
  agregados = Number(diaRow?.n ?? 0);

  if (soloAgregados) {
    return { agregados, borrados: 0, mesCerrado: null };
  }

  // ── 3. Retención (solo 1 vez por semana) ───────────────────────────────
  // Los DELETE por fecha usan el índice de fecha, pero cada pasada recorre
  // la ventana que queda por delante del corte (~1,1M filas). Ejecutándolo
  // solo los lunes el coste baja de ~33M lecturas/mes a ~5M, sin efecto
  // visible: la ventana se desplaza como mucho 6 días.
  const esLunes = new Date().getUTCDay() === 1;
  if (!esLunes) {
    return { agregados, borrados: 0, mesCerrado: null };
  }
  borrados = await aplicarRetencion();

  // ── 4. Cierre mensual idempotente ──────────────────────────────────────
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
 * Aplica la política de retención (borra lo que sale de cada ventana).
 *
 * Exportada para poder ejecutarse y verificarse por separado (pruebas sobre
 * una copia, recuperación manual) sin depender de que sea lunes.
 *
 * @returns número total de filas borradas
 */
export async function aplicarRetencion(): Promise<number> {
  const corteHist = fechaMenosDias(RETENCION_DIAS_HISTORICO);
  const corteGeo = fechaMenosDias(RETENCION_DIAS_GEO);
  const corteSemana = fechaMenosDias(RETENCION_DIAS_SEMANA);

  const r1 = await db.run(sql`
    DELETE FROM precios_historico WHERE fecha < ${corteHist}
  `);
  const r2 = await db.run(sql`
    DELETE FROM hist_geo_dia WHERE fecha < ${corteGeo}
  `);
  const r3 = await db.run(sql`
    DELETE FROM hist_geo_semana WHERE semana < ${corteSemana}
  `);
  return r1.rowsAffected + r2.rowsAffected + r3.rowsAffected;
}

/**
 * Recalcula los buckets semanales de hist_geo_semana a partir de
 * hist_geo_dia en el rango [desde, hasta] (ambos inclusive).
 *
 * Se usa a diario con el rango de la semana en curso y también para
 * reconstruir semanas pasadas (migración / relleno de días perdidos).
 * Media = media de las medias diarias, igual que el cierre mensual.
 */
async function agregarSemanas(desde: string, hasta: string): Promise<void> {
  await db.run(sql`
    INSERT INTO hist_geo_semana (ambito, geo_id, producto_id, semana, precio_medio, n_estaciones)
    SELECT ambito, geo_id, producto_id,
           date(fecha, 'weekday 0', '-6 days') AS semana,
           ROUND(AVG(precio_medio), 4), MAX(n_estaciones)
    FROM hist_geo_dia
    WHERE ambito IN ('mun', 'prov', 'ccaa')
      AND fecha BETWEEN ${desde} AND ${hasta}
    GROUP BY ambito, geo_id, producto_id, semana
    ON CONFLICT (ambito, geo_id, producto_id, semana) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
}

/**
 * Reconstruye hist_geo_dia para un rango de fechas a partir de las
 * observaciones de precios_historico.
 *
 * El mantenimiento diario agrega la FOTO ACTUAL (`precios`); para fechas
 * pasadas la única fuente son las observaciones históricas. Necesario al
 * rellenar días perdidos (paradas del cron, migraciones).
 */
export async function reconstruirGeoDia(
  desde: string,
  hasta: string
): Promise<void> {
  const filtro = sql`
    FROM precios_historico h JOIN estaciones e ON e.id = h.estacion_id
    WHERE h.fecha BETWEEN ${desde} AND ${hasta}
      AND h.precio IS NOT NULL
      AND h.producto_id IN (${LISTA_PRODUCTOS_GEO})
  `;
  const conflicto = sql`
    ON CONFLICT (ambito, geo_id, producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `;

  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'mun', e.municipio_id, h.producto_id, h.fecha, ROUND(AVG(h.precio), 4), COUNT(*)
    ${filtro}
    GROUP BY e.municipio_id, h.producto_id, h.fecha
    ${conflicto}
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'prov', e.provincia_id, h.producto_id, h.fecha, ROUND(AVG(h.precio), 4), COUNT(*)
    ${filtro}
    GROUP BY e.provincia_id, h.producto_id, h.fecha
    ${conflicto}
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'ccaa', e.ccaa_id, h.producto_id, h.fecha, ROUND(AVG(h.precio), 4), COUNT(*)
    ${filtro}
    GROUP BY e.ccaa_id, h.producto_id, h.fecha
    ${conflicto}
  `);
  await db.run(sql`
    INSERT INTO hist_geo_dia (ambito, geo_id, producto_id, fecha, precio_medio, n_estaciones)
    SELECT 'nac', 'ES', h.producto_id, h.fecha, ROUND(AVG(h.precio), 4), COUNT(*)
    FROM precios_historico h
    WHERE h.fecha BETWEEN ${desde} AND ${hasta}
      AND h.precio IS NOT NULL
      AND h.producto_id IN (${LISTA_PRODUCTOS_GEO})
    GROUP BY h.producto_id, h.fecha
    ${conflicto}
  `);
}

/**
 * Reconstruye hist_geo_semana e hist_nac_dia para un rango de fechas.
 * (hist_nac_dia se rellena desde hist_geo_dia ámbito 'nac', que ya está
 * reconstruido por `reconstruirGeoDia`.)
 */
export async function reconstruirSemanasYNacional(
  desde: string,
  hasta: string
): Promise<void> {
  await agregarSemanas(desde, hasta);
  await db.run(sql`
    INSERT INTO hist_nac_dia (producto_id, fecha, precio_medio, n_estaciones)
    SELECT producto_id, fecha, precio_medio, n_estaciones
    FROM hist_geo_dia
    WHERE ambito = 'nac' AND fecha BETWEEN ${desde} AND ${hasta}
    ON CONFLICT (producto_id, fecha) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      n_estaciones = excluded.n_estaciones
  `);
}

/**
 * Consolida el mes indicado en las tablas mensuales permanentes.
 *
 * ⚠️ Solo se puede cerrar un mes cuya ventana DIARIA esté completa: la media
 * se calcula desde hist_geo_dia y precios_historico, que solo conservan 30
 * días. Llamarla con un mes ya purgado SOBRESCRIBIRÍA su media con datos
 * parciales. El cron lo hace el día 1 con el mes recién terminado, que sigue
 * entero dentro de la ventana.
 *
 * Fuente: hist_geo_dia del mes (los datos ya son agregados, así que el coste
 * es proporcional a ellos, no a precios). El histórico de estación mensual
 * viene de precios_historico (con índice PK que arranca por estacion_id).
 *
 * NOTA: para que el mes cierre completo, precios_historico e hist_geo_dia
 * deben cubrir todo el mes; por eso el cierre ocurre el día 1 y las ventanas
 * diarias (30 días) nunca son menores que un mes.
 */
export async function cerrarMes(mes: string): Promise<void> {
  const desde = `${mes}-01`;
  const hasta = `${mes}-31`;

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

  await db.run(sql`
    INSERT INTO hist_meses_procesados (mes, procesado_en)
    VALUES (${mes}, ${new Date().toISOString()})
    ON CONFLICT (mes) DO NOTHING
  `);
}
