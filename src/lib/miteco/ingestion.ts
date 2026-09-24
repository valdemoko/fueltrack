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
import { queryAll, queryGet, type DB } from "@/lib/db";
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
 * Filas por sentencia INSERT.
 *
 * Una provincia cabe en un lote, pero una ingesta de DÍA COMPLETO (relleno
 * histórico: ~11k estaciones × ~10 productos) genera decenas de miles de
 * tuplas y revienta la pila al construir la consulta. Trocear mantiene cada
 * sentencia en un tamaño seguro y no cambia el número de filas escritas.
 */
const FILAS_POR_SENTENCIA = 400;

/** Divide una lista en trozos de tamaño fijo. */
function enLotes<T>(items: T[], tamano = FILAS_POR_SENTENCIA): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}

/**
 * Upsert de estaciones en lote (troceado en varias sentencias).
 */
async function upsertEstacionesLote(
  database: DB,
  estaciones: EstacionNormalizada[]
): Promise<void> {
  if (estaciones.length === 0) return;
  for (const lote of enLotes(estaciones)) {
  await database
    .insert(schema.estaciones)
    .values(
      lote.map((estacion) => ({
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
      }))
    )
    .onConflictDoUpdate({
      target: schema.estaciones.id,
      set: {
        rotulo: sql`excluded.rotulo`,
        direccion: sql`excluded.direccion`,
        localidad: sql`excluded.localidad`,
        codigoPostal: sql`excluded.codigo_postal`,
        latitud: sql`excluded.latitud`,
        longitud: sql`excluded.longitud`,
        horario: sql`excluded.horario`,
        margen: sql`excluded.margen`,
        tipoVenta: sql`excluded.tipo_venta`,
        bioetanolPct: sql`excluded.bioetanol_pct`,
        esterMetilicoPct: sql`excluded.ester_metilico_pct`,
        fechaActualizacion: sql`excluded.fecha_actualizacion`,
      },
    })
    .execute();
  }
}

/**
 * Upsert de precios en un lote (una sola llamada a la BD).
 *
 * Arquitectura de cuotas — doble escritura idempotente:
 *  1. `precios`: fila única (estación, producto) con el precio ACTUAL.
 *     Re-ejecutar el mismo día NO crea filas nuevas (ON CONFLICT UPDATE).
 *  2. `precios_historico`: observación diaria dentro de la ventana corta.
 *     PK (estación, producto, fecha) → idempotente; el mantenimiento
 *     diario borra lo que sale de la ventana.
 *
 * AHORRO DE CUOTA (rows written): la foto histórica del día NO cambia entre
 * pasadas del cron, solo el precio actual. Antes de escribir el histórico se
 * cuenta cuántas filas de (estación, producto, fecha) ya existen: si están
 * todas, se salta el lote entero (1 lectura indexada ≈ 900 filas en vez de
 * ~900 escrituras). Si MITECO cambió la fecha del parte (publicación tardía),
 * el conteo no cuadra y se escribe el día nuevo con normalidad.
 */
async function upsertPreciosLote(
  database: DB,
  precios: PrecioNormalizado[],
  soloHistorico = false
): Promise<void> {
  const conPrecio = precios.filter((p) => p.precio !== null);
  if (conPrecio.length === 0) return;

  // `soloHistorico` (relleno de fechas pasadas): NUNCA tocar la tabla de
  // precios ACTUALES. Escribir ahí una fecha antigua dejaría a la web
  // mostrando un precio "actual" que en realidad es de hace días.
  if (!soloHistorico) {
    for (const lote of enLotes(conPrecio)) {
      await database
        .insert(schema.precios)
        .values(
          lote.map((precio) => ({
            estacionId: precio.estacionId,
            productoId: precio.productoId,
            fechaObservacion: precio.fechaObservacion,
            precio: precio.precio,
          }))
        )
        .onConflictDoUpdate({
          target: [schema.precios.estacionId, schema.precios.productoId],
          set: {
            precio: sql`excluded.precio`,
            fechaObservacion: sql`excluded.fecha_observacion`,
          },
        })
        .execute();
    }
  }

  // ── Histórico: solo si falta alguna fila del día para estas estaciones ──
  const fecha = conPrecio[0].fechaObservacion;
  const estacionIds = [...new Set(conPrecio.map((p) => p.estacionId))];
  const yaEscritas = await queryGet<{ n: number }>(sql`
    SELECT COUNT(*) AS n
    FROM precios_historico
    WHERE fecha = ${fecha}
      AND estacion_id IN (${sql.join(estacionIds.map((id) => sql`${id}`), sql`, `)})
  `);

  if (Number(yaEscritas?.n ?? 0) >= conPrecio.length) {
    console.log(
      `[ingest] Histórico ${fecha} ya escrito para ${estacionIds.length} estaciones: 0 escrituras`
    );
    return;
  }

  for (const lote of enLotes(conPrecio)) {
    await database
      .insert(schema.preciosHistorico)
      .values(
        lote.map((precio) => ({
          estacionId: precio.estacionId,
          productoId: precio.productoId,
          fecha: precio.fechaObservacion,
          precio: precio.precio,
        }))
      )
      .onConflictDoUpdate({
        target: [
          schema.preciosHistorico.estacionId,
          schema.preciosHistorico.productoId,
          schema.preciosHistorico.fecha,
        ],
        set: {
          precio: sql`excluded.precio`,
        },
      })
      .execute();
  }
}

/**
 * Ingesta las estaciones de una provincia con sus precios actuales.
 * Realiza upsert por IDEESS.
 *
 * @param db - Instancia de Drizzle ORM
 * @param provinciaId - ID de la provincia (ej: "29")
 * @returns Número de estaciones procesadas
 */
export async function ingestEstaciones(
  db: DB,
  provinciaId: string
): Promise<number> {
  console.log(`[ingest] Obteniendo estaciones de provincia ${provinciaId}...`);

  const response = await fetchEstacionesByProvincia(provinciaId);
  // Normalizar a ISO (yyyy-MM-dd): MITECO devuelve "dd/MM/yyyy HH:mm:ss"
  const fechaConsulta = normalizarFechaIso(response.Fecha);

  console.log(
    `[ingest] Fecha de consulta: ${fechaConsulta}, estaciones: ${response.ListaEESSPrecio.length}`
  );

  // Normalizar todas las estaciones primero (saltar las sin coordenadas)
  const estaciones = response.ListaEESSPrecio
    .map((raw) => normalizarEstacion(raw, fechaConsulta))
    .filter((e): e is EstacionNormalizada => e !== null);

  // Upsert de estaciones en un solo lote (redondo único a la BD)
  await upsertEstacionesLote(db, estaciones);

  // Precios: normalizar todo el lote y validar de una vez (1 consulta
  // previa para traer los últimos precios de TODAS las estaciones de la
  // provincia, en lugar de una por estación). Así la ingesta entera cabe
  // en el límite de 60 s de Vercel Hobby.
  const rawPorId = new Map(
    response.ListaEESSPrecio.map((r) => [r.IDEESS, r] as [string, MitecoEstacionRaw])
  );
  const preciosBrutos = estaciones.flatMap((e) =>
    extraerPrecios(rawPorId.get(e.id) as MitecoEstacionRaw, fechaConsulta)
  );
  const { validos } = await validarLote(db, preciosBrutos, fechaConsulta);
  await upsertPreciosLote(db, validos);

  console.log(
    `[ingest] Ingestión completada: ${estaciones.length} estaciones`
  );
  return estaciones.length;
}

/**
 * Valida un lote de precios contra los últimos precios válidos previos.
 * Usa una única consulta previa por lote (no una por estación).
 */
async function validarLote(
  database: DB,
  precios: PrecioNormalizado[],
  fechaObservacion: string
): Promise<{ validos: PrecioNormalizado[] }> {
  const estacionIds = [...new Set(precios.map((p) => p.estacionId))];
  if (estacionIds.length === 0) return { validos: precios };

  // Último precio válido previo por (estación, producto):
  // fecha máxima anterior a la observación actual. Se consulta por lotes de
  // estaciones (una ingesta de día completo son ~11k ids: una sola sentencia
  // con 11k parámetros desbordaría).
  const previos = new Map<string, number>();
  for (const lote of enLotes(estacionIds, 500)) {
    const filas = await queryAll<{
      estacion_id: string;
      producto_id: number;
      precio: number;
    }>(sql`
      SELECT estacion_id, producto_id, precio
      FROM precios p
      WHERE p.fecha_observacion = (
        SELECT MAX(p2.fecha_observacion) FROM precios p2
        WHERE p2.estacion_id = p.estacion_id
          AND p2.producto_id = p.producto_id
          AND p2.fecha_observacion < ${fechaObservacion}
      )
        AND p.precio IS NOT NULL
        AND p.estacion_id IN (${sql.join(lote.map((id) => sql`${id}`), sql`, `)})
    `);

    for (const f of filas) {
      previos.set(`${f.estacion_id}:${f.producto_id}`, f.precio);
    }
  }

  const validos: PrecioNormalizado[] = [];
  for (const precio of precios) {
    if (precio.precio === null) continue; // sin dato: no se guarda
    const previo = previos.get(`${precio.estacionId}:${precio.productoId}`) ?? null;
    const resultado = validarPrecio(precio.precio, precio.productoId, previo);
    if (!resultado.valido) {
      console.warn(
        `[ingest] Precio descartado ${precio.estacionId}/prod ${precio.productoId}: ${resultado.motivo}`
      );
      continue;
    }
    if (resultado.sospechoso) {
      console.warn(
        `[ingest] Precio sospechoso (guardado) ${precio.estacionId}/prod ${precio.productoId}: ${resultado.motivo}`
      )
    }
    validos.push(precio);
  }
  return { validos };
}

/**
 * Ingesta el histórico de estaciones para una fecha específica.
 *
 * `soloHistorico` (relleno de días perdidos / migraciones): escribe
 * ÚNICAMENTE `precios_historico`. No toca `precios` (la fecha antigua
 * envenenaría los precios actuales) ni `estaciones` (sobrescribiría
 * `fecha_actualizacion` con una fecha vieja y la web marcaría las estaciones
 * como obsoletas).
 *
 * @param db - Instancia de Drizzle ORM
 * @param fecha - Fecha en formato "dd-MM-yyyy"
 * @returns Número de estaciones procesadas
 */
export async function ingestHistorico(
  db: DB,
  fecha: string,
  soloHistorico = false
): Promise<number> {
  console.log(`[ingest] Obteniendo histórico para ${fecha}...`);

  const response = await fetchHistorico(fecha);
  // La API responde con su propia fecha ("dd/MM/yyyy H:mm:ss" o "dd/MM/yyyy").
  // Hay que normalizarla a ISO: si se guardara el argumento tal cual, las
  // filas de precios_historico quedarían con fechas no ISO y la retención
  // (comparación de texto) las purgaría por error.
  const fechaObservacion = normalizarFechaIso(response.Fecha) || fecha;

  console.log(
    `[ingest] Histórico ${fecha}: ${response.ListaEESSPrecio.length} estaciones`
  );

  // Normalizar (mismos helpers que ingestEstaciones)
  const estaciones = response.ListaEESSPrecio
    .map((raw) => normalizarEstacion(raw, response.Fecha))
    .filter((e): e is EstacionNormalizada => e !== null);

  if (!soloHistorico) {
    await upsertEstacionesLote(db, estaciones);
  }

  const rawPorId = new Map(
    response.ListaEESSPrecio.map((r) => [r.IDEESS, r] as [string, MitecoEstacionRaw])
  );
  const preciosBrutos = estaciones.flatMap((e) =>
    extraerPrecios(rawPorId.get(e.id) as MitecoEstacionRaw, fechaObservacion)
  );
  const { validos } = await validarLote(db, preciosBrutos, fechaObservacion);
  await upsertPreciosLote(db, validos, soloHistorico);

  console.log(
    `[ingest] Histórico completado: ${estaciones.length} estaciones`
  );
  return estaciones.length;
}

/**
 * Ingesta la lista de productos petrolíferos.
 *
 * @param db - Instancia de Drizzle ORM
 * @returns Número de productos procesados
 */
export async function ingestProductos(
  db: DB
): Promise<number> {
  console.log("[ingest] Obteniendo productos petrolíferos...");

  const productos = await fetchProductos();

  for (const prod of productos) {
    await db.insert(schema.productos)
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
      .execute();
  }

  console.log(`[ingest] Productos completados: ${productos.length} productos`);
  return productos.length;
}
