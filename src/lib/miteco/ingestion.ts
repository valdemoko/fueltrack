/**
 * Servicio de ingestión de datos desde MITECO a la base de datos local
 *
 * Proceso:
 * 1. Fetch datos de la API MITECO
 * 2. Normalizar (comas decimales, strings vacíos, coordenadas)
 * 3. Upsert en base de datos (INSERT OR REPLACE)
 * 4. Almacenar observaciones de precio
 */
import { eq, and, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import type {
  MitecoEstacionRaw,
  MitecoProductoRaw,
} from "@/lib/types/miteco";
import { MITECO_PRECIO_TO_PRODUCTO } from "@/lib/types/miteco";
import {
  fetchEstacionesByProvincia,
  fetchHistorico,
  fetchProductos,
  parsePrecio,
  parsePorcentaje,
  parseCoordenada,
} from "./client";
import { validarPrecio } from "./validacion";

/**
 * Último precio válido previo de una estación por producto (fecha anterior
 * a la observación actual). Se usa para detectar saltos anómalos.
 */
function preciosAnteriores(
  database: BetterSQLite3Database<typeof schema>,
  estacionId: string,
  fechaObservacion: string
): Map<number, number> {
  const filas = database.all(sql`
    SELECT p.producto_id, p.precio
    FROM precios p
    WHERE p.estacion_id = ${estacionId}
      AND p.precio IS NOT NULL
      AND p.fecha_observacion = (
        SELECT MAX(p2.fecha_observacion) FROM precios p2
        WHERE p2.estacion_id = p.estacion_id
          AND p2.producto_id = p.producto_id
          AND p2.fecha_observacion < ${fechaObservacion}
      )
  `) as unknown as Array<{ producto_id: number; precio: number }>;
  return new Map(filas.map((f) => [f.producto_id, f.precio] as [number, number]));
}

/**
 * Filtra precios anómalos de una estación antes de escribir en la BD.
 * Devuelve solo los precios válidos; registra los descartados y los
 * sospechosos (aceptados pero con salto grande).
 */
function validarPreciosEstacion(
  database: BetterSQLite3Database<typeof schema>,
  precios: PrecioNormalizado[],
  fechaObservacion: string
): { validos: PrecioNormalizado[]; descartados: number; sospechosos: number } {
  const previos = preciosAnteriores(database, precios[0]?.estacionId ?? "", fechaObservacion);
  const validos: PrecioNormalizado[] = [];
  let descartados = 0;
  let sospechosos = 0;

  for (const precio of precios) {
    if (precio.precio === null) {
      validos.push(precio); // sin dato: flujo normal (no se guarda)
      continue;
    }
    const previo = previos.get(precio.productoId) ?? null;
    const resultado = validarPrecio(precio.precio, precio.productoId, previo);
    if (!resultado.valido) {
      descartados++;
      console.warn(
        `[ingest] Precio descartado ${precio.estacionId}/prod ${precio.productoId}: ${resultado.motivo}`
      );
      continue;
    }
    if (resultado.sospechoso) {
      sospechosos++;
      console.warn(
        `[ingest] Precio sospechoso (guardado) ${precio.estacionId}/prod ${precio.productoId}: ${resultado.motivo}`
      );
    }
    validos.push(precio);
  }

  return { validos, descartados, sospechosos };
}

// ─── Normalización ──────────────────────────────────────────────────────────

/**
 * Normaliza una fecha MITECO ("dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy" o "dd-MM-yyyy")
 * al formato ISO usado en la BD ("yyyy-MM-dd").
 * Si el formato ya es ISO, lo devuelve tal cual.
 */
export function normalizarFechaIso(fecha: string): string {
  const trim = fecha.trim();
  // Ya está en ISO (yyyy-MM-dd...)
  if (/^\d{4}-\d{2}-\d{2}/.test(trim)) return trim.slice(0, 10);

  const diaMesAnio = trim.split(" ")[0].split(/[/-]/);
  if (diaMesAnio.length === 3 && diaMesAnio[2].length === 4) {
    return `${diaMesAnio[2]}-${diaMesAnio[1]}-${diaMesAnio[0]}`;
  }
  return trim;
}

/** Resultado de normalizar una estación MITECO */
interface EstacionNormalizada {
  id: string;
  municipioId: string;
  provinciaId: string;
  ccaaId: string;
  rotulo: string | null;
  direccion: string;
  localidad: string;
  codigoPostal: string;
  latitud: number;
  longitud: number;
  horario: string;
  margen: string;
  tipoVenta: string;
  bioetanolPct: number;
  esterMetilicoPct: number;
  fechaActualizacion: string;
}

/** Resultado de normalizar un precio */
interface PrecioNormalizado {
  estacionId: string;
  productoId: number;
  fechaObservacion: string;
  precio: number | null;
}

/**
 * Normaliza una estación cruda de MITECO a formato interno.
 * Devuelve null si la estación no tiene coordenadas válidas.
 */
export function normalizarEstacion(
  raw: MitecoEstacionRaw,
  fechaConsulta: string
): EstacionNormalizada | null {
  const latitud = parseCoordenada(raw["Latitud"]);
  const longitud = parseCoordenada(raw["Longitud (WGS84)"]);

  // Saltar estaciones sin coordenadas (datos antiguos incompletos)
  if (latitud === null || longitud === null) return null;

  return {
    id: raw.IDEESS,
    municipioId: raw.IDMunicipio,
    provinciaId: raw.IDProvincia,
    ccaaId: raw.IDCCAA,
    rotulo: raw["Rótulo"] || null,
    direccion: raw["Dirección"],
    localidad: raw["Localidad"],
    codigoPostal: raw["C.P."],
    latitud,
    longitud,
    horario: raw["Horario"],
    margen: raw["Margen"],
    tipoVenta: raw["Tipo Venta"],
    bioetanolPct: parsePorcentaje(raw["% BioEtanol"]),
    esterMetilicoPct: parsePorcentaje(raw["% Éster metílico"]),
    fechaActualizacion: fechaConsulta,
  };
}

/**
 * Extrae todas las observaciones de precio de una estación cruda.
 */
export function extraerPrecios(
  raw: MitecoEstacionRaw,
  fechaObservacion: string
): PrecioNormalizado[] {
  const precios: PrecioNormalizado[] = [];

  // Acceder a los campos de precio del objeto raw
  const rawFields = raw as unknown as Record<string, string>;

  for (const [campoMiteco, productoId] of Object.entries(
    MITECO_PRECIO_TO_PRODUCTO
  )) {
    const valorRaw = rawFields[campoMiteco];
    const precio = parsePrecio(valorRaw ?? "");

    precios.push({
      estacionId: raw.IDEESS,
      productoId,
      fechaObservacion,
      precio,
    });
  }

  return precios;
}

// ─── Ingestión en base de datos ─────────────────────────────────────────────

/**
 * Ingesta las estaciones de una provincia con sus precios actuales.
 * Realiza upsert por IDEESS.
 *
 * @param db - Instancia de Drizzle ORM
 * @param provinciaId - ID de la provincia (ej: "29")
 * @returns Número de estaciones procesadas
 */
export async function ingestEstaciones(
  db: BetterSQLite3Database<typeof schema>,
  provinciaId: string
): Promise<number> {
  console.log(`[ingest] Obteniendo estaciones de provincia ${provinciaId}...`);

  const response = await fetchEstacionesByProvincia(provinciaId);
  // Normalizar a ISO (yyyy-MM-dd): MITECO devuelve "dd/MM/yyyy HH:mm:ss"
  const fechaConsulta = normalizarFechaIso(response.Fecha);

  console.log(
    `[ingest] Fecha de consulta: ${fechaConsulta}, estaciones: ${response.ListaEESSPrecio.length}`
  );

  // Normalizar y upsert estaciones
  for (const raw of response.ListaEESSPrecio) {
    const estacion = normalizarEstacion(raw, fechaConsulta);
    if (!estacion) continue; // Saltar estaciones sin coordenadas

    // Upsert estación
    db.insert(schema.estaciones)
      .values({
        id: estacion.id,
        municipioId: estacion.municipioId,
        provinciaId: estacion.provinciaId,
        ccaaId: estacion.ccaaId,
        rotulo: estacion.rotulo,
        direccion: estacion.direccion,
        localidad: estacion.localidad,
        codigoPostal: estacion.codigoPostal,
        latitud: estacion.latitud,
        longitud: estacion.longitud,
        horario: estacion.horario,
        margen: estacion.margen,
        tipoVenta: estacion.tipoVenta,
        bioetanolPct: estacion.bioetanolPct,
        esterMetilicoPct: estacion.esterMetilicoPct,
        fechaActualizacion: estacion.fechaActualizacion,
      })
      .onConflictDoUpdate({
        target: schema.estaciones.id,
        set: {
          rotulo: estacion.rotulo,
          direccion: estacion.direccion,
          localidad: estacion.localidad,
          codigoPostal: estacion.codigoPostal,
          latitud: estacion.latitud,
          longitud: estacion.longitud,
          horario: estacion.horario,
          margen: estacion.margen,
          tipoVenta: estacion.tipoVenta,
          bioetanolPct: estacion.bioetanolPct,
          esterMetilicoPct: estacion.esterMetilicoPct,
          fechaActualizacion: estacion.fechaActualizacion,
        },
      })
      .run();

    // Extraer, validar e insertar precios
    const preciosBrutos = extraerPrecios(raw, fechaConsulta);
    const { validos } = validarPreciosEstacion(db, preciosBrutos, fechaConsulta);
    for (const precio of validos) {
      // Solo insertar si hay precio
      if (precio.precio !== null) {
        db.insert(schema.precios)
          .values({
            estacionId: precio.estacionId,
            productoId: precio.productoId,
            fechaObservacion: precio.fechaObservacion,
            precio: precio.precio,
          })
          .onConflictDoUpdate({
            target: [
              schema.precios.estacionId,
              schema.precios.productoId,
              schema.precios.fechaObservacion,
            ],
            set: {
              precio: precio.precio,
            },
          })
          .run();
      }
    }
  }

  console.log(
    `[ingest] Ingestión completada: ${response.ListaEESSPrecio.length} estaciones`
  );
  return response.ListaEESSPrecio.length;
}

/**
 * Ingesta el histórico de estaciones para una fecha específica.
 *
 * @param db - Instancia de Drizzle ORM
 * @param fecha - Fecha en formato "dd-MM-yyyy"
 * @returns Número de estaciones procesadas
 */
export async function ingestHistorico(
  db: BetterSQLite3Database<typeof schema>,
  fecha: string
): Promise<number> {
  console.log(`[ingest] Obteniendo histórico para ${fecha}...`);

  const response = await fetchHistorico(fecha);
  const fechaObservacion = fecha;

  console.log(
    `[ingest] Histórico ${fecha}: ${response.ListaEESSPrecio.length} estaciones`
  );

  // Normalizar y upsert estaciones
  for (const raw of response.ListaEESSPrecio) {
    const estacion = normalizarEstacion(raw, response.Fecha);
    if (!estacion) continue; // Saltar estaciones sin coordenadas

    // Upsert estación (misma lógica que ingestEstaciones)
    db.insert(schema.estaciones)
      .values({
        id: estacion.id,
        municipioId: estacion.municipioId,
        provinciaId: estacion.provinciaId,
        ccaaId: estacion.ccaaId,
        rotulo: estacion.rotulo,
        direccion: estacion.direccion,
        localidad: estacion.localidad,
        codigoPostal: estacion.codigoPostal,
        latitud: estacion.latitud,
        longitud: estacion.longitud,
        horario: estacion.horario,
        margen: estacion.margen,
        tipoVenta: estacion.tipoVenta,
        bioetanolPct: estacion.bioetanolPct,
        esterMetilicoPct: estacion.esterMetilicoPct,
        fechaActualizacion: estacion.fechaActualizacion,
      })
      .onConflictDoUpdate({
        target: schema.estaciones.id,
        set: {
          rotulo: estacion.rotulo,
          direccion: estacion.direccion,
          localidad: estacion.localidad,
          codigoPostal: estacion.codigoPostal,
          latitud: estacion.latitud,
          longitud: estacion.longitud,
          horario: estacion.horario,
          margen: estacion.margen,
          tipoVenta: estacion.tipoVenta,
          bioetanolPct: estacion.bioetanolPct,
          esterMetilicoPct: estacion.esterMetilicoPct,
          fechaActualizacion: estacion.fechaActualizacion,
        },
      })
      .run();

    // Extraer, validar e insertar precios históricos
    const preciosBrutos = extraerPrecios(raw, fechaObservacion);
    const { validos } = validarPreciosEstacion(db, preciosBrutos, fechaObservacion);
    for (const precio of validos) {
      if (precio.precio !== null) {
        db.insert(schema.precios)
          .values({
            estacionId: precio.estacionId,
            productoId: precio.productoId,
            fechaObservacion: precio.fechaObservacion,
            precio: precio.precio,
          })
          .onConflictDoUpdate({
            target: [
              schema.precios.estacionId,
              schema.precios.productoId,
              schema.precios.fechaObservacion,
            ],
            set: {
              precio: precio.precio,
            },
          })
          .run();
      }
    }
  }

  console.log(
    `[ingest] Histórico completado: ${response.ListaEESSPrecio.length} estaciones`
  );
  return response.ListaEESSPrecio.length;
}

/**
 * Ingesta la lista de productos petrolíferos.
 *
 * @param db - Instancia de Drizzle ORM
 * @returns Número de productos procesados
 */
export async function ingestProductos(
  db: BetterSQLite3Database<typeof schema>
): Promise<number> {
  console.log("[ingest] Obteniendo productos petrolíferos...");

  const productos = await fetchProductos();

  for (const prod of productos) {
    db.insert(schema.productos)
      .values({
        id: prod.IDProducto,
        nombre: prod.NombreProducto,
        abreviatura: prod.NombreProductoAbreviatura,
      })
      .onConflictDoUpdate({
        target: schema.productos.id,
        set: {
          nombre: prod.NombreProducto,
          abreviatura: prod.NombreProductoAbreviatura,
        },
      })
      .run();
  }

  console.log(`[ingest] Productos completados: ${productos.length} productos`);
  return productos.length;
}
