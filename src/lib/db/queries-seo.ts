/**
 * Consultas orientadas a SEO y selección de combustible.
 *
 * Complementan queries.ts con:
 *  - Cobertura real de productos en un ámbito (para el selector de combustible)
 *  - Estaciones de un municipio por producto (selector + listado)
 *  - Municipios cercanos (enlazado interno)
 *  - Resumen histórico agregado de un ámbito (históricos indexables)
 *
 * Reglas de rendimiento (BD ~30M observaciones):
 *  - NUNCA escanear toda la tabla `precios`: siempre filtrar por
 *    (producto_id, fecha_observacion), que usa idx_precios_producto_fecha.
 *  - Las fechas máximas por producto se resuelven con seeks individuales
 *    (O(log n) por producto), no con GROUP BY global ni subqueries
 *    correlacionadas sobre 30M filas.
 *
 * Solo datos reales de la BD. Sin interpolaciones ni estimaciones.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { slugify } from "@/lib/geografia";

// ─── Fechas de referencia por producto ─────────────────────────────────────

/** Mapa productoId → última fecha de observación (1 seek por producto). */
export async function getUltimasFechasProductos(): Promise<Map<number, string>> {
  const productos = (await db.all(
    sql`SELECT id FROM productos WHERE EXISTS (
          SELECT 1 FROM precios WHERE precios.producto_id = productos.id
        )`
  )) as unknown as Array<{ id: number }>;

  const mapa = new Map<number, string>();
  for (const p of productos) {
    const row = (await db.get(
      sql`SELECT MAX(fecha_observacion) AS fecha FROM precios WHERE producto_id = ${p.id}`
    )) as unknown as { fecha: string } | undefined;
    if (row?.fecha) mapa.set(p.id, row.fecha);
  }
  return mapa;
}

// ─── Cobertura de productos en un ámbito ────────────────────────────────────

export interface CoberturaProducto {
  productoId: number;
  nombre: string;
  abreviatura: string;
  /** Estaciones con precio publicado del producto en la última observación */
  estacionesConPrecio: number;
  /** Media de la última observación (null si no hay datos) */
  precioMedio: number | null;
  fecha: string | null;
}

/**
 * Productos con cobertura real (≥ minEstaciones estaciones con precio) en un
 * ámbito geográfico, ordenados por número de estaciones descendente.
 * Si no se indica ámbito, calcula sobre toda la BD.
 */
export async function getCoberturaProductos(
  ambito: { ccaaId?: string; provinciaId?: string; municipioId?: string } = {},
  minEstaciones = 1
): Promise<CoberturaProducto[]> {
  const productos = (await db.all(
    sql`SELECT id, nombre, abreviatura FROM productos WHERE EXISTS (
          SELECT 1 FROM precios WHERE precios.producto_id = productos.id
        )`
  )) as unknown as Array<{ id: number; nombre: string; abreviatura: string }>;

  const resultado: CoberturaProducto[] = [];

  for (const producto of productos) {
    // Seek directo a la última fecha del producto (índice producto+fecha)
    const fechaRow = (await db.get(
      sql`SELECT MAX(fecha_observacion) AS fecha FROM precios WHERE producto_id = ${producto.id}`
    )) as unknown as { fecha: string } | undefined;
    if (!fechaRow?.fecha) continue;
    const fecha = fechaRow.fecha;

    // Agregado del ámbito, acotado por (producto, fecha) → índice
    const filtroAmbito = ambito.municipioId
      ? sql`AND e.municipio_id = ${ambito.municipioId}`
      : ambito.provinciaId
        ? sql`AND e.provincia_id = ${ambito.provinciaId}`
        : ambito.ccaaId
          ? sql`AND e.ccaa_id = ${ambito.ccaaId}`
          : sql``;

    const stats = (await db.get(sql`
      SELECT COUNT(DISTINCT pr.estacion_id) AS con_precio,
             ROUND(AVG(pr.precio), 4) AS precio_medio
      FROM precios pr
      JOIN estaciones e ON e.id = pr.estacion_id
      WHERE pr.producto_id = ${producto.id}
        AND pr.fecha_observacion = ${fecha}
        AND pr.precio IS NOT NULL
        ${filtroAmbito}
    `)) as unknown as { con_precio: number; precio_medio: number | null } | undefined;

    if (!stats) continue;
    const conPrecio = Number(stats.con_precio);
    if (conPrecio < minEstaciones) continue;

    resultado.push({
      productoId: producto.id,
      nombre: producto.nombre,
      abreviatura: producto.abreviatura,
      estacionesConPrecio: conPrecio,
      precioMedio: stats.precio_medio,
      fecha,
    });
  }

  resultado.sort((a, b) => b.estacionesConPrecio - a.estacionesConPrecio);
  return resultado;
}

// ─── Estaciones de un municipio por producto ────────────────────────────────

export interface EstacionMunicipioProducto {
  id: string;
  rotulo: string | null;
  direccion: string;
  localidad: string;
  municipioNombre: string;
  precio: number | null;
  /** Fecha de la última observación del producto con precio de esta estación */
  fechaUltimoPrecio: string | null;
  /** Fecha de la última observación del producto en todo el país */
  fechaReferencia: string | null;
}

/**
 * Estaciones de un municipio con el precio del producto indicado
 * (última observación disponible del producto), ordenadas por precio.
 * Las estaciones cuyo último dato es anterior a la referencia nacional
 * quedan marcadas mediante fechaUltimoPrecio (control de obsoletos).
 */
export async function getEstacionesMunicipioProducto(
  municipioId: string,
  productoId: number
): Promise<EstacionMunicipioProducto[]> {
  // Fecha de referencia nacional del producto (1 seek)
  const refRow = (await db.get(
    sql`SELECT MAX(fecha_observacion) AS fecha FROM precios WHERE producto_id = ${productoId}`
  )) as unknown as { fecha: string } | undefined;
  const fechaReferencia = refRow?.fecha ?? null;

  const filas = (await db.all(sql`
    SELECT
      e.id, e.rotulo, e.direccion, e.localidad,
      m.nombre AS municipio_nombre,
      pr.precio,
      pr.fecha_observacion AS fecha_ultimo_precio
    FROM estaciones e
    JOIN municipios m ON m.id = e.municipio_id
    LEFT JOIN precios pr
      ON pr.estacion_id = e.id
      AND pr.producto_id = ${productoId}
      AND pr.precio IS NOT NULL
      AND pr.fecha_observacion = (
        SELECT MAX(p3.fecha_observacion) FROM precios p3
        WHERE p3.estacion_id = e.id AND p3.producto_id = ${productoId}
      )
    WHERE e.municipio_id = ${municipioId}
    ORDER BY pr.precio IS NULL, pr.precio ASC, e.localidad ASC, e.id ASC
  `) as unknown as Array<{
    id: string;
    rotulo: string | null;
    direccion: string;
    localidad: string;
    municipio_nombre: string;
    precio: number | null;
    fecha_ultimo_precio: string | null;
  }>);

  return filas.map((f) => ({
    id: f.id,
    rotulo: f.rotulo,
    direccion: f.direccion,
    localidad: f.localidad,
    municipioNombre: f.municipio_nombre,
    precio: f.precio,
    fechaUltimoPrecio: f.fecha_ultimo_precio,
    fechaReferencia,
  }));
}

// ─── Municipios cercanos (enlazado interno) ────────────────────────────────

export interface MunicipioCercano {
  id: string;
  nombre: string;
  distanciaKm: number;
  totalEstaciones: number;
  ccaaSlug: string;
  provinciaSlug: string;
  municipioSlug: string;
}

/** Municipios con estaciones a menos de radioKm del municipio indicado. */
export async function getMunicipiosCercanos(
  municipioId: string,
  limite = 8,
  radioKm = 30
): Promise<MunicipioCercano[]> {
  const centro = (await db.all(sql`
    SELECT m.id, m.nombre, p.ccaa_id, p.id AS provincia_id,
           (SELECT AVG(e.latitud) FROM estaciones e WHERE e.municipio_id = m.id) AS lat,
           (SELECT AVG(e.longitud) FROM estaciones e WHERE e.municipio_id = m.id) AS lon
    FROM municipios m
    JOIN provincias p ON p.id = m.provincia_id
    WHERE m.id = ${municipioId}
  `) as unknown as Array<{
    id: string;
    nombre: string;
    provincia_id: string;
    ccaa_id: string;
    lat: number | null;
    lon: number | null;
  }>);

  const c = centro[0];
  if (!c || c.lat === null || c.lon === null) return [];

  const dLat = radioKm / 111;
  const cos = Math.cos((c.lat * Math.PI) / 180) || 1;
  const dLon = radioKm / (111 * cos);

  // Vecinos: bounding box + agregación por municipio (índice municipio_id)
  const vecinos = (await db.all(sql`
    SELECT * FROM (
      SELECT
        m2.id, m2.nombre,
        COUNT(e.id) AS total_estaciones,
        AVG(e.latitud) AS lat, AVG(e.longitud) AS lon,
        (
          6371 * acos(MIN(1.0,
            COS(RADIANS(${c.lat})) * COS(RADIANS(AVG(e.latitud))) *
            COS(RADIANS(AVG(e.longitud)) - RADIANS(${c.lon})) +
            SIN(RADIANS(${c.lat})) * SIN(RADIANS(AVG(e.latitud)))
          ))
        ) AS distancia_km
      FROM municipios m2
      JOIN estaciones e ON e.municipio_id = m2.id
      WHERE m2.id != ${municipioId}
        AND m2.id IN (
          SELECT municipio_id FROM estaciones
          WHERE latitud BETWEEN ${c.lat - dLat} AND ${c.lat + dLat}
            AND longitud BETWEEN ${c.lon - dLon} AND ${c.lon + dLon}
        )
      GROUP BY m2.id, m2.nombre
      HAVING total_estaciones > 0
    )
    WHERE distancia_km <= ${radioKm}
    ORDER BY distancia_km ASC
    LIMIT ${limite}
  `) as unknown as Array<{
    id: string;
    nombre: string;
    total_estaciones: number;
    distancia_km: number;
  }>);

  if (vecinos.length === 0) return [];

  // Slugs de los vecinos (1 query para todos)
  const ids = vecinos.map((v) => v.id);
  const slugRows = (await db.all(sql`
    SELECT m.id, c.nombre AS ccaa_nombre, p.nombre AS provincia_nombre
    FROM municipios m
    JOIN provincias p ON p.id = m.provincia_id
    JOIN ccaa c ON c.id = p.ccaa_id
    WHERE m.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `) as unknown as Array<{
    id: string;
    ccaa_nombre: string;
    provincia_nombre: string;
  }>);
  const slugs = new Map(
    slugRows.map((s) => [
      s.id,
      { ccaa: slugify(s.ccaa_nombre), prov: slugify(s.provincia_nombre) },
    ])
  );

  return vecinos
    .map((f) => {
      const s = slugs.get(f.id);
      if (!s) return null;
      return {
        id: f.id,
        nombre: f.nombre,
        distanciaKm: f.distancia_km,
        totalEstaciones: Number(f.total_estaciones),
        ccaaSlug: s.ccaa,
        provinciaSlug: s.prov,
        municipioSlug: slugify(f.nombre),
      };
    })
    .filter((m): m is MunicipioCercano => m !== null);
}

// ─── Histórico agregado de un ámbito ───────────────────────────────────────

export interface PuntoHistorico {
  fecha: string;
  precio: number;
}

export interface ResumenHistoricoAmbito {
  serie: PuntoHistorico[];
  precioActual: number | null;
  precioHace30: number | null;
  variacion30: number | null;
  precioMin: number | null;
  precioMax: number | null;
  observaciones: number;
  primeraFecha: string | null;
}

/**
 * Serie agregada (media diaria del ámbito) del producto indicado.
 * `dias` limita el periodo (30/90/180/365/730).
 * Acotada por (producto_id, rango de fechas) → índice.
 */
export async function getHistoricoAmbito(
  productoId: number,
  dias: number,
  ambito: { ccaaId?: string; provinciaId?: string; municipioId?: string } = {}
): Promise<ResumenHistoricoAmbito | null> {
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const hoy = new Date().toISOString().slice(0, 10);

  const filtroAmbito = ambito.municipioId
    ? sql`AND e.municipio_id = ${ambito.municipioId}`
    : ambito.provinciaId
      ? sql`AND e.provincia_id = ${ambito.provinciaId}`
      : ambito.ccaaId
        ? sql`AND e.ccaa_id = ${ambito.ccaaId}`
        : sql``;

  const serie = (await db.all(sql`
    SELECT pr.fecha_observacion AS fecha,
           ROUND(AVG(pr.precio), 4) AS precio
    FROM precios pr
    JOIN estaciones e ON e.id = pr.estacion_id
    WHERE pr.producto_id = ${productoId}
      AND pr.precio IS NOT NULL
      AND pr.fecha_observacion >= ${desde}
      AND pr.fecha_observacion <= ${hoy}
      ${filtroAmbito}
    GROUP BY pr.fecha_observacion
    ORDER BY pr.fecha_observacion ASC
  `)) as unknown as Array<{ fecha: string; precio: number }>;

  if (serie.length === 0) return null;

  const precios = serie.map((s) => s.precio);
  const actual = precios[precios.length - 1];

  // Precio de hace ~30 días: observación más cercana a hace 30 días
  const objetivo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  let precioHace30: number | null = null;
  let mejorDif = Number.POSITIVE_INFINITY;
  for (const punto of serie) {
    const dif = Math.abs(punto.fecha.localeCompare(objetivo));
    if (dif < mejorDif) {
      mejorDif = dif;
      precioHace30 = punto.precio;
    }
  }

  return {
    serie: serie.map((s) => ({ fecha: s.fecha, precio: s.precio })),
    precioActual: actual,
    precioHace30,
    variacion30:
      precioHace30 !== null && dias >= 30 ? actual - precioHace30 : null,
    precioMin: Math.min(...precios),
    precioMax: Math.max(...precios),
    observaciones: serie.length,
    primeraFecha: serie[0].fecha,
  };
}

/** Nombre del producto por ID (para títulos). */
export async function getProductoById(
  productoId: number
): Promise<{ id: number; nombre: string; abreviatura: string } | null> {
  const row = (await db.all(
    sql`SELECT id, nombre, abreviatura FROM productos WHERE id = ${productoId}`
  )) as unknown as Array<{ id: number; nombre: string; abreviatura: string }>;
  return row[0] ?? null;
}
