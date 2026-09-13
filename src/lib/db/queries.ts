/**
 * Consultas a la base de datos.
 *
 * Regla general: SIEMPRE filtrar por la última fecha de observación
 * disponible para el producto consultado (los precios históricos conviven
 * en la tabla `precios`); computar agregados en SQL (no en JS) y usar los
 * índices existentes.
 */
import { eq, sql, and, ne, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "./schema";

/** SELECT genérico tipado contra el driver async (equivale al antiguo db.all síncrono). */
function all<T>(q: SQL): Promise<T[]> {
  return db.all(q) as unknown as Promise<T[]>;
}

/** Última fecha de observación disponible para un producto. */
export async function getUltimaFechaProducto(productoId: number): Promise<string | null> {
  const row = await db
    .select({ fecha: sql<string>`MAX(${schema.precios.fechaObservacion})` })
    .from(schema.precios)
    .where(eq(schema.precios.productoId, productoId))
    .get();
  return row?.fecha ?? null;
}

/** Última fecha de observación disponible en toda la base de datos. */
export async function getUltimaFechaGlobal(): Promise<string | null> {
  const row = await db
    .select({ fecha: sql<string>`MAX(${schema.precios.fechaObservacion})` })
    .from(schema.precios)
    .get();
  return row?.fecha ?? null;
}

/** Fila de resumen de precios de un producto en un ámbito geográfico. */
export interface ResumenProducto {
  productoId: number;
  nombre: string;
  abreviatura: string;
  precioMedio: number | null;
  precioMin: number | null;
  precioMax: number | null;
  totalEstaciones: number;
  fecha: string | null;
}

/** Ámbito geográfico opcional para las consultas agregadas. */
export interface AmbitoGeografico {
  ccaaId?: string;
  provinciaId?: string;
  municipioId?: string;
}

function condicionesAmbito(ambito: AmbitoGeografico) {
  if (ambito.municipioId) {
    return sql`e.municipio_id = ${ambito.municipioId}`;
  }
  if (ambito.provinciaId) {
    return sql`e.provincia_id = ${ambito.provinciaId}`;
  }
  if (ambito.ccaaId) {
    return sql`e.ccaa_id = ${ambito.ccaaId}`;
  }
  return sql`1=1`;
}

/**
 * Resumen de precios (media/min/max/estaciones) de UN producto en un ámbito,
 * usando solo la última fecha de observación disponible de ese producto.
 */
export async function getResumenProducto(
  productoId: number,
  ambito: AmbitoGeografico = {}
): Promise<ResumenProducto | null> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return null;

  const row = await all<{
    producto_id: number;
    nombre: string;
    abreviatura: string;
    precio_medio: number | null;
    precio_min: number | null;
    precio_max: number | null;
    total_estaciones: number;
  }>(sql`
      SELECT
        pr.producto_id,
        p.nombre,
        p.abreviatura,
        ROUND(AVG(pr.precio), 4) AS precio_medio,
        MIN(pr.precio) AS precio_min,
        MAX(pr.precio) AS precio_max,
        COUNT(DISTINCT pr.estacion_id) AS total_estaciones
      FROM precios pr
      JOIN productos p ON p.id = pr.producto_id
      JOIN estaciones e ON e.id = pr.estacion_id
      WHERE pr.producto_id = ${productoId}
        AND pr.fecha_observacion = ${fecha}
        AND pr.precio IS NOT NULL
        AND ${condicionesAmbito(ambito)}
      GROUP BY pr.producto_id, p.nombre, p.abreviatura
    `);

  const r = row[0];
  if (!r || r.total_estaciones === 0) return null;
  return {
    productoId: r.producto_id,
    nombre: r.nombre,
    abreviatura: r.abreviatura,
    precioMedio: r.precio_medio,
    precioMin: r.precio_min,
    precioMax: r.precio_max,
    totalEstaciones: r.total_estaciones,
    fecha,
  };
}

/**
 * Resumen de precios de los principales productos en un ámbito.
 * (productos: gasolina 95 E5, gasolina 98 E5, gasóleo A, gasóleo premium)
 */
export async function getResumenProductosPrincipales(
  ambito: AmbitoGeografico = {}
): Promise<ResumenProducto[]> {
  const ids = [1, 3, 4, 5];
  const res = await Promise.all(ids.map((id) => getResumenProducto(id, ambito)));
  return res.filter((r): r is ResumenProducto => r !== null);
}

// ─── Estadísticas por municipio (para páginas de provincia) ───────────────

export interface MunicipioStats {
  municipioId: string;
  municipioNombre: string;
  totalEstaciones: number;
  precioMedio: number | null;
  precioMin: number | null;
  precioMax: number | null;
}

/** Municipios de una provincia con estadísticas del producto indicado. */
export async function getMunicipiosDeProvincia(
  provinciaId: string,
  productoId: number
): Promise<MunicipioStats[]> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return [];

  const filas = await all<{
    municipio_id: string;
    municipio_nombre: string;
    total_estaciones: number;
    precio_medio: number | null;
    precio_min: number | null;
    precio_max: number | null;
  }>(sql`
      SELECT
        m.id AS municipio_id,
        m.nombre AS municipio_nombre,
        COUNT(DISTINCT e.id) AS total_estaciones,
        ROUND(AVG(pr.precio), 4) AS precio_medio,
        MIN(pr.precio) AS precio_min,
        MAX(pr.precio) AS precio_max
      FROM municipios m
      JOIN estaciones e ON e.municipio_id = m.id
      LEFT JOIN precios pr
        ON pr.estacion_id = e.id
        AND pr.producto_id = ${productoId}
        AND pr.fecha_observacion = ${fecha}
      WHERE m.provincia_id = ${provinciaId}
      GROUP BY m.id, m.nombre
      HAVING total_estaciones > 0
      ORDER BY m.nombre ASC
    `);

  return filas.map((f) => ({
    municipioId: f.municipio_id,
    municipioNombre: f.municipio_nombre,
    totalEstaciones: f.total_estaciones,
    precioMedio: f.precio_medio,
    precioMin: f.precio_min,
    precioMax: f.precio_max,
  }));
}

// ─── Estaciones de un municipio con precios del producto ─────────────────

export interface EstacionConPrecio {
  id: string;
  rotulo: string | null;
  direccion: string;
  localidad: string;
  precio: number | null;
  fechaActualizacion: string;
}

/** Estaciones de un municipio, ordenadas por precio del producto indicado. */
export async function getEstacionesDeMunicipio(
  municipioId: string,
  productoId: number,
  limite = 200
): Promise<EstacionConPrecio[]> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return [];

  const filas = await all<{
    id: string;
    rotulo: string | null;
    direccion: string;
    localidad: string;
    fecha_actualizacion: string;
    precio: number | null;
  }>(sql`
      SELECT
        e.id,
        e.rotulo,
        e.direccion,
        e.localidad,
        e.fecha_actualizacion,
        (
          SELECT pr.precio
          FROM precios pr
          WHERE pr.estacion_id = e.id
            AND pr.producto_id = ${productoId}
            AND pr.fecha_observacion = ${fecha}
          LIMIT 1
        ) AS precio
      FROM estaciones e
      WHERE e.municipio_id = ${municipioId}
      ORDER BY precio IS NULL, precio ASC, e.localidad ASC, e.id ASC
      LIMIT ${limite}
    `);
  return filas.map((f) => ({
    id: f.id,
    rotulo: f.rotulo,
    direccion: f.direccion,
    localidad: f.localidad,
    fechaActualizacion: f.fecha_actualizacion,
    precio: f.precio,
  }));
}

/** Estaciones de una provincia (para páginas de provincia), con precio. */
export async function getEstacionesDeProvincia(
  provinciaId: string,
  productoId: number,
  limite = 50
): Promise<EstacionConPrecio[]> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return [];

  const filas = await all<{
    id: string;
    rotulo: string | null;
    direccion: string;
    localidad: string;
    fecha_actualizacion: string;
    precio: number | null;
  }>(sql`
      SELECT
        e.id,
        e.rotulo,
        e.direccion,
        e.localidad,
        e.fecha_actualizacion,
        (
          SELECT pr.precio
          FROM precios pr
          WHERE pr.estacion_id = e.id
            AND pr.producto_id = ${productoId}
            AND pr.fecha_observacion = ${fecha}
          LIMIT 1
        ) AS precio
      FROM estaciones e
      WHERE e.provincia_id = ${provinciaId}
      ORDER BY precio IS NULL, precio ASC, e.localidad ASC, e.id ASC
      LIMIT ${limite}
    `);
  return filas.map((f) => ({
    id: f.id,
    rotulo: f.rotulo,
    direccion: f.direccion,
    localidad: f.localidad,
    fechaActualizacion: f.fecha_actualizacion,
    precio: f.precio,
  }));
}

/**
 * Resumen histórico textual de un producto en una estación (para SSR):
 * precio actual, precio hace X días, min/max del periodo y variación.
 * Devuelve null si no hay observaciones suficientes.
 */
export interface ResumenHistorico {
  precioActual: number;
  precioHaceX: number | null;
  diasPrimerDato: number | null;
  precioMin: number;
  precioMax: number;
  variacion: number | null;
  observaciones: number;
}

export async function getResumenHistoricoEstacion(
  estacionId: string,
  productoId: number,
  dias = 30
): Promise<ResumenHistorico | null> {
  const desde = new Date(Date.now() - dias * 86400000)
    .toISOString()
    .slice(0, 10);

  const filas = await all<{ fecha_observacion: string; precio: number }>(sql`
      SELECT fecha_observacion, precio
      FROM precios
      WHERE estacion_id = ${estacionId}
        AND producto_id = ${productoId}
        AND fecha_observacion >= ${desde}
        AND precio IS NOT NULL
      ORDER BY fecha_observacion ASC
    `);

  if (filas.length === 0) return null;

  const precios = filas.map((f) => f.precio);
  const precioActual = precios[precios.length - 1];
  const precioMin = Math.min(...precios);
  const precioMax = Math.max(...precios);

  const primerDato = filas[0];
  const diasPrimerDato = Math.round(
    (Date.now() - new Date(`${primerDato.fecha_observacion}T00:00:00Z`).getTime()) /
      86400000
  );

  const precioHaceX = diasPrimerDato > 0 ? primerDato.precio : null;
  const variacion =
    precioHaceX !== null ? precioActual - precioHaceX : null;

  return {
    precioActual,
    precioHaceX,
    diasPrimerDato: diasPrimerDato > 0 ? diasPrimerDato : null,
    precioMin,
    precioMax,
    variacion,
    observaciones: filas.length,
  };
}

// ─── Entidades geográficas ────────────────────────────────────────────────

export interface CcaaInfo {
  id: string;
  nombre: string;
  totalEstaciones: number;
}

export async function getCcaaConEstaciones(): Promise<CcaaInfo[]> {
  const filas = await all<{ id: string; nombre: string; total_estaciones: number }>(sql`
      SELECT c.id, c.nombre, COUNT(e.id) AS total_estaciones
      FROM ccaa c
      JOIN estaciones e ON e.ccaa_id = c.id
      GROUP BY c.id, c.nombre
      ORDER BY c.nombre ASC
    `);
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    totalEstaciones: Number(f.total_estaciones),
  }));
}

export async function getCcaaById(id: string): Promise<{ id: string; nombre: string } | null> {
  return (
    (await db
      .select({ id: schema.ccaa.id, nombre: schema.ccaa.nombre })
      .from(schema.ccaa)
      .where(eq(schema.ccaa.id, id))
      .get()) ?? null
  );
}

export interface ProvinciaInfo {
  id: string;
  nombre: string;
  ccaaId: string;
  ccaaNombre: string;
  totalEstaciones: number;
}

export async function getProvinciasDeCcaa(ccaaId: string): Promise<ProvinciaInfo[]> {
  const filas = (await await all(sql`
      SELECT p.id, p.nombre, p.ccaa_id, c.nombre AS ccaa_nombre,
             COUNT(e.id) AS total_estaciones
      FROM provincias p
      JOIN ccaa c ON c.id = p.ccaa_id
      JOIN estaciones e ON e.provincia_id = p.id
      WHERE p.ccaa_id = ${ccaaId}
      GROUP BY p.id, p.nombre, p.ccaa_id, c.nombre
      ORDER BY p.nombre ASC
    `)) as Array<{
    id: string;
    nombre: string;
    ccaa_id: string;
    ccaa_nombre: string;
    total_estaciones: number;
  }>;
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    ccaaId: f.ccaa_id,
    ccaaNombre: f.ccaa_nombre,
    totalEstaciones: Number(f.total_estaciones),
  }));
}

export async function getProvinciaById(
  id: string
): Promise<{ id: string; nombre: string; ccaaId: string; ccaaNombre: string } | null> {
  const row = (await await all(sql`
      SELECT p.id, p.nombre, p.ccaa_id, c.nombre AS ccaa_nombre
      FROM provincias p
      JOIN ccaa c ON c.id = p.ccaa_id
      WHERE p.id = ${id}
    `)) as Array<{
    id: string;
    nombre: string;
    ccaa_id: string;
    ccaa_nombre: string;
  }>;
  const r = row[0];
  return r
    ? { id: r.id, nombre: r.nombre, ccaaId: r.ccaa_id, ccaaNombre: r.ccaa_nombre }
    : null;
}

export async function getMunicipioById(
  id: string
): Promise<{
  id: string;
  nombre: string;
  provinciaId: string;
  provinciaNombre: string;
  ccaaId: string;
  ccaaNombre: string;
} | null> {
  const row = await all<{
    id: string;
    nombre: string;
    provincia_id: string;
    provincia_nombre: string;
    ccaa_id: string;
    ccaa_nombre: string;
  }>(sql`
      SELECT m.id, m.nombre, m.provincia_id, p.nombre AS provincia_nombre,
             p.ccaa_id, c.nombre AS ccaa_nombre
      FROM municipios m
      JOIN provincias p ON p.id = m.provincia_id
      JOIN ccaa c ON c.id = p.ccaa_id
      WHERE m.id = ${id}
    `);
  const r = row[0];
  return r
    ? {
        id: r.id,
        nombre: r.nombre,
        provinciaId: r.provincia_id,
        provinciaNombre: r.provincia_nombre,
        ccaaId: r.ccaa_id,
        ccaaNombre: r.ccaa_nombre,
      }
    : null;
}

// ─── Detalle de estación ──────────────────────────────────────────────────

export interface EstacionDetalle {
  id: string;
  rotulo: string | null;
  direccion: string;
  localidad: string;
  codigoPostal: string;
  horario: string;
  margen: string;
  tipoVenta: string;
  latitud: number;
  longitud: number;
  fechaActualizacion: string;
  municipioId: string;
  municipioNombre: string;
  provinciaId: string;
  provinciaNombre: string;
  ccaaId: string;
  ccaaNombre: string;
}

export async function getEstacionDetalle(id: string): Promise<EstacionDetalle | null> {
  const row = await all(sql`
      SELECT e.*, m.nombre AS municipio_nombre,
             p.id AS provincia_id, p.nombre AS provincia_nombre,
             c.id AS ccaa_id, c.nombre AS ccaa_nombre
      FROM estaciones e
      JOIN municipios m ON m.id = e.municipio_id
      JOIN provincias p ON p.id = e.provincia_id
      JOIN ccaa c ON c.id = e.ccaa_id
      WHERE e.id = ${id}
    `) as Array<Record<string, unknown> & {
    id: string;
    rotulo: string | null;
    direccion: string;
    localidad: string;
    codigo_postal: string;
    horario: string;
    margen: string;
    tipo_venta: string;
    latitud: number;
    longitud: number;
    fecha_actualizacion: string;
    municipio_id: string;
    municipio_nombre: string;
    provincia_id: string;
    provincia_nombre: string;
    ccaa_id: string;
    ccaa_nombre: string;
  }>;

  const r = row[0];
  if (!r) return null;
  return {
    id: r.id,
    rotulo: r.rotulo,
    direccion: r.direccion,
    localidad: r.localidad,
    codigoPostal: r.codigo_postal,
    horario: r.horario,
    margen: r.margen,
    tipoVenta: r.tipo_venta,
    latitud: r.latitud,
    longitud: r.longitud,
    fechaActualizacion: r.fecha_actualizacion,
    municipioId: r.municipio_id,
    municipioNombre: r.municipio_nombre,
    provinciaId: r.provincia_id,
    provinciaNombre: r.provincia_nombre,
    ccaaId: r.ccaa_id,
    ccaaNombre: r.ccaa_nombre,
  };
}

/**
 * Precios actuales de una estación, un registro por producto:
 * el más reciente por fecha de observación.
 */
export interface PrecioProducto {
  productoId: number;
  nombre: string;
  abreviatura: string;
  precio: number | null;
  fecha: string;
}

export async function getPreciosActualesEstacion(
  estacionId: string
): Promise<PrecioProducto[]> {
  const filas = await all<{
    producto_id: number;
    precio: number | null;
    fecha_observacion: string;
    nombre: string;
    abreviatura: string;
  }>(sql`
      SELECT pr.producto_id, pr.precio, pr.fecha_observacion,
             p.nombre, p.abreviatura
      FROM precios pr
      JOIN productos p ON p.id = pr.producto_id
      WHERE pr.estacion_id = ${estacionId}
        AND pr.fecha_observacion = (
          SELECT MAX(fecha_observacion) FROM precios
          WHERE estacion_id = pr.estacion_id AND producto_id = pr.producto_id
        )
    `);
  return filas.map((f) => ({
    productoId: f.producto_id,
    nombre: f.nombre,
    abreviatura: f.abreviatura,
    precio: f.precio,
    fecha: f.fecha_observacion,
  }));
}

/**
 * Estadísticas del producto en el municipio de la estación (para comparar
 * el precio de la estación con su zona). Devuelve null si no hay datos.
 */
export interface ComparativaZona {
  precioMedio: number;
  precioMin: number;
  precioMax: number;
  totalEstaciones: number;
}

export async function getComparativaZona(
  municipioId: string,
  productoId: number
): Promise<ComparativaZona | null> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return null;

  const row = await all<{
    precio_medio: number | null;
    precio_min: number | null;
    precio_max: number | null;
    total_estaciones: number;
  }>(sql`
      SELECT
        ROUND(AVG(pr.precio), 4) AS precio_medio,
        MIN(pr.precio) AS precio_min,
        MAX(pr.precio) AS precio_max,
        COUNT(DISTINCT pr.estacion_id) AS total_estaciones
      FROM precios pr
      JOIN estaciones e ON e.id = pr.estacion_id
      WHERE e.municipio_id = ${municipioId}
        AND pr.producto_id = ${productoId}
        AND pr.fecha_observacion = ${fecha}
        AND pr.precio IS NOT NULL
    `);

  const r = row[0];
  if (!r || r.total_estaciones === 0 || r.precio_medio === null) return null;
  return {
    precioMedio: r.precio_medio,
    precioMin: r.precio_min ?? 0,
    precioMax: r.precio_max ?? 0,
    totalEstaciones: r.total_estaciones,
  };
}

/**
 * Estaciones cercanas (aprox. por bounding box + fórmula haversine en SQL).
 * Devuelve hasta `limite` estaciones a menos de `radioKm` km, con el precio
 * del producto indicado, excluyendo la estación de referencia.
 */
export interface EstacionCercana {
  id: string;
  rotulo: string | null;
  direccion: string;
  localidad: string;
  distanciaKm: number;
  precio: number | null;
}

export async function getEstacionesCercanas(
  estacionId: string,
  latitud: number,
  longitud: number,
  productoId: number,
  radioKm = 10,
  limite = 8
): Promise<EstacionCercana[]> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return [];

  // Aproximación del bounding box: 1 grado lat ≈ 111 km; lon ≈ 111·cos(lat)
  const dLat = radioKm / 111;
  const dLon = radioKm / (111 * Math.cos((latitud * Math.PI) / 180) || 1);

  const filas = await all<{
    id: string;
    rotulo: string | null;
    direccion: string;
    localidad: string;
    distancia_km: number;
    precio: number | null;
  }>(sql`
      SELECT * FROM (
        SELECT
          e.id,
          e.rotulo,
          e.direccion,
          e.localidad,
          (
            6371 * acos(
              MIN(1.0,
                COS(RADIANS(${latitud})) * COS(RADIANS(e.latitud)) *
                COS(RADIANS(e.longitud) - RADIANS(${longitud})) +
                SIN(RADIANS(${latitud})) * SIN(RADIANS(e.latitud))
              )
            )
          ) AS distancia_km,
          (
            SELECT pr.precio
            FROM precios pr
            WHERE pr.estacion_id = e.id
              AND pr.producto_id = ${productoId}
              AND pr.fecha_observacion = ${fecha}
            LIMIT 1
          ) AS precio
        FROM estaciones e
        WHERE e.id != ${estacionId}
          AND e.latitud BETWEEN ${latitud - dLat} AND ${latitud + dLat}
          AND e.longitud BETWEEN ${longitud - dLon} AND ${longitud + dLon}
      )
      WHERE distancia_km <= ${radioKm}
      ORDER BY distancia_km ASC
      LIMIT ${limite}
    `);
  return filas.map((f) => ({
    id: f.id,
    rotulo: f.rotulo,
    direccion: f.direccion,
    localidad: f.localidad,
    distanciaKm: f.distancia_km,
    precio: f.precio,
  }));
}

// ─── Municipios (listado general para SEO) ────────────────────────────────

/** Municipios con estaciones, con conteo (para páginas de provincia). */
export async function getMunicipiosConEstaciones() {
  return await all<{
    municipio_id: string;
    municipio_nombre: string;
    total_estaciones: number;
  }>(sql`
      SELECT m.id AS municipio_id, m.nombre AS municipio_nombre,
             COUNT(e.id) AS total_estaciones
      FROM municipios m
      JOIN estaciones e ON e.municipio_id = m.id
      GROUP BY m.id, m.nombre
      ORDER BY m.nombre ASC
    `);
}

/** Municipios de una provincia con conteo de estaciones (todas). */
export async function getMunicipiosConConteo(provinciaId: string) {
  return await all<{
    municipio_id: string;
    municipio_nombre: string;
    total_estaciones: number;
  }>(sql`
      SELECT m.id AS municipio_id, m.nombre AS municipio_nombre,
             COUNT(e.id) AS total_estaciones
      FROM municipios m
      JOIN estaciones e ON e.municipio_id = m.id
      WHERE m.provincia_id = ${provinciaId}
      GROUP BY m.id, m.nombre
      HAVING total_estaciones > 0
      ORDER BY total_estaciones DESC, m.nombre ASC
    `);
}

// ─── Compatibilidad con landings existentes ───────────────────────────────

/**
 * @deprecated Usar getResumenProducto / getResumenProductosPrincipales.
 * Mantenida mientras existan páginas que la llamen.
 */
export async function getPreciosMedios() {
  return await all<{
    producto_id: number;
    nombre: string;
    abreviatura: string;
    precio_medio: number;
    precio_min: number;
    precio_max: number;
    total_estaciones: number;
  }>(sql`
      SELECT pr.producto_id, p.nombre, p.abreviatura,
             ROUND(AVG(pr.precio), 4) AS precio_medio,
             MIN(pr.precio) AS precio_min,
             MAX(pr.precio) AS precio_max,
             COUNT(DISTINCT pr.estacion_id) AS total_estaciones
      FROM precios pr
      JOIN productos p ON p.id = pr.producto_id
      WHERE pr.precio IS NOT NULL
      GROUP BY pr.producto_id, p.nombre, p.abreviatura
      ORDER BY pr.producto_id ASC
    `);
}

/** Estaciones más baratas de un producto en un ámbito. */
export async function getEstacionesBaratas(
  productoId: number,
  limite = 10,
  ambito: AmbitoGeografico = {}
): Promise<EstacionConPrecio[]> {
  const fecha = await getUltimaFechaProducto(productoId);
  if (!fecha) return [];

  const filas = await all<{
    id: string;
    rotulo: string | null;
    direccion: string;
    localidad: string;
    fecha_actualizacion: string;
    precio: number;
  }>(sql`
      SELECT
        e.id,
        e.rotulo,
        e.direccion,
        e.localidad,
        e.fecha_actualizacion,
        pr.precio
      FROM precios pr
      JOIN estaciones e ON e.id = pr.estacion_id
      WHERE pr.producto_id = ${productoId}
        AND pr.fecha_observacion = ${fecha}
        AND pr.precio IS NOT NULL
        AND ${condicionesAmbito(ambito)}
      ORDER BY pr.precio ASC
      LIMIT ${limite}
    `);
  return filas.map((f) => ({
    id: f.id,
    rotulo: f.rotulo,
    direccion: f.direccion,
    localidad: f.localidad,
    fechaActualizacion: f.fecha_actualizacion,
    precio: f.precio,
  }));
}

/**
 * @deprecated Usar getMunicipiosDeProvincia.
 * Media por municipio sin filtrar fecha (mantenida por compatibilidad).
 */
export async function getPreciosPorMunicipio(productoId: number) {
  return await all<{
    municipio_id: string;
    municipio_nombre: string;
    precio_medio: number;
    precio_min: number;
    precio_max: number;
    total_estaciones: number;
  }>(sql`
      SELECT m.id AS municipio_id, m.nombre AS municipio_nombre,
             ROUND(AVG(pr.precio), 4) AS precio_medio,
             MIN(pr.precio) AS precio_min,
             MAX(pr.precio) AS precio_max,
             COUNT(DISTINCT pr.estacion_id) AS total_estaciones
      FROM precios pr
      JOIN estaciones e ON e.id = pr.estacion_id
      JOIN municipios m ON m.id = e.municipio_id
      WHERE pr.producto_id = ${productoId} AND pr.precio IS NOT NULL
      GROUP BY m.id, m.nombre
      ORDER BY precio_medio ASC
    `);
}
