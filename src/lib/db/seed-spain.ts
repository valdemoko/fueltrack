/**
 * Script de ingesta MASIVA para toda España
 *
 * Uso: npx tsx src/lib/db/seed-spain.ts
 *
 * Proceso:
 * 1. Crear/conectar base de datos con optimizaciones (WAL, índices)
 * 2. Insertar TODAS las CCAA y provincias de España
 * 3. Ingestar datos actuales de las 52 provincias (~11k estaciones)
 * 4. Ingestar histórico: últimos 2 años diario, 2007-2023 mensual
 * 5. Mostrar resumen completo
 *
 * Optimizaciones:
 * - WAL mode para mejor rendimiento de escritura
 * - Batch inserts con transacciones
 * - Índices en columnas de consulta frecuente
 * - Foreign keys OFF durante ingesta (MITECO no inserta municipios primero)
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import {
  normalizarEstacion,
  extraerPrecios,
  normalizarFechaIso,
} from "@/lib/miteco/ingestion";
import {
  fetchEstacionesByProvincia,
  fetchHistorico,
  fetchProductos,
} from "@/lib/miteco/client";
import { MITECO_PRECIO_TO_PRODUCTO } from "@/lib/types/miteco";

/** Ruta al archivo de base de datos */
const DB_PATH = "./data/combustible.db";

// ─── Lista completa de provincias de España ──────────────────────────────────

/** Provincias españolas: código → { ccaaId, nombre } */
const PROVINCIAS_ESPANIA: Record<string, { ccaaId: string; nombre: string }> = {
  "01": { ccaaId: "15", nombre: "Álava" },
  "02": { ccaaId: "08", nombre: "Albacete" },
  "03": { ccaaId: "17", nombre: "Alicante" },
  "04": { ccaaId: "01", nombre: "Almería" },
  "05": { ccaaId: "07", nombre: "Ávila" },
  "06": { ccaaId: "10", nombre: "Badajoz" },
  "07": { ccaaId: "04", nombre: "Baleares" },
  "08": { ccaaId: "09", nombre: "Barcelona" },
  "09": { ccaaId: "07", nombre: "Burgos" },
  "10": { ccaaId: "10", nombre: "Cáceres" },
  "11": { ccaaId: "01", nombre: "Cádiz" },
  "12": { ccaaId: "17", nombre: "Castellón" },
  "13": { ccaaId: "08", nombre: "Ciudad Real" },
  "14": { ccaaId: "01", nombre: "Córdoba" },
  "15": { ccaaId: "11", nombre: "A Coruña" },
  "16": { ccaaId: "08", nombre: "Cuenca" },
  "17": { ccaaId: "09", nombre: "Girona" },
  "18": { ccaaId: "01", nombre: "Granada" },
  "19": { ccaaId: "08", nombre: "Guadalajara" },
  "20": { ccaaId: "15", nombre: "Guipúzcoa" },
  "21": { ccaaId: "01", nombre: "Huelva" },
  "22": { ccaaId: "02", nombre: "Huesca" },
  "23": { ccaaId: "01", nombre: "Jaén" },
  "24": { ccaaId: "07", nombre: "León" },
  "25": { ccaaId: "09", nombre: "Lleida" },
  "26": { ccaaId: "16", nombre: "La Rioja" },
  "27": { ccaaId: "11", nombre: "Lugo" },
  "28": { ccaaId: "12", nombre: "Madrid" },
  "29": { ccaaId: "01", nombre: "Málaga" },
  "30": { ccaaId: "13", nombre: "Murcia" },
  "31": { ccaaId: "14", nombre: "Navarra" },
  "32": { ccaaId: "11", nombre: "Ourense" },
  "33": { ccaaId: "03", nombre: "Asturias" },
  "34": { ccaaId: "07", nombre: "Palencia" },
  "35": { ccaaId: "05", nombre: "Las Palmas" },
  "36": { ccaaId: "11", nombre: "Pontevedra" },
  "37": { ccaaId: "07", nombre: "Salamanca" },
  "38": { ccaaId: "05", nombre: "S/C de Tenerife" },
  "39": { ccaaId: "06", nombre: "Cantabria" },
  "40": { ccaaId: "07", nombre: "Segovia" },
  "41": { ccaaId: "01", nombre: "Sevilla" },
  "42": { ccaaId: "07", nombre: "Soria" },
  "43": { ccaaId: "09", nombre: "Tarragona" },
  "44": { ccaaId: "02", nombre: "Teruel" },
  "45": { ccaaId: "08", nombre: "Toledo" },
  "46": { ccaaId: "17", nombre: "Valencia" },
  "47": { ccaaId: "07", nombre: "Valladolid" },
  "48": { ccaaId: "15", nombre: "Vizcaya" },
  "49": { ccaaId: "07", nombre: "Zamora" },
  "50": { ccaaId: "02", nombre: "Zaragoza" },
  "51": { ccaaId: "51", nombre: "Ceuta" },
  "52": { ccaaId: "52", nombre: "Melilla" },
};

/** Nombres de CCAA */
const NOMBRE_CCAA: Record<string, string> = {
  "01": "Andalucía",
  "02": "Aragón",
  "03": "Asturias, Principado de",
  "04": "Illes Balears",
  "05": "Canarias",
  "06": "Cantabria",
  "07": "Castilla y León",
  "08": "Castilla-La Mancha",
  "09": "Cataluña",
  "10": "Extremadura",
  "11": "Galicia",
  "12": "Comunidad de Madrid",
  "13": "Región de Murcia",
  "14": "Comunidad Foral de Navarra",
  "15": "País Vasco",
  "16": "La Rioja",
  "17": "Comunitat Valenciana",
  "51": "Ciudad Autónoma de Ceuta",
  "52": "Ciudad Autónoma de Melilla",
};

// ─── Helpers de rendimiento ──────────────────────────────────────────────────

/** Formatea fecha Date a "dd-MM-yyyy" para la API MITECO */
function formatDateMiteco(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Formatea fecha Date a "yyyy-MM-dd" para la BD */
function formatDateDb(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Ingesta optimizada con batch inserts ────────────────────────────────────

/**
 * Ingesta batch de estaciones para una provincia.
 * Usa transacciones y batch inserts para máximo rendimiento.
 */
async function ingestEstacionesBatch(
  db: ReturnType<typeof drizzle>,
  sqlite: InstanceType<typeof Database>,
  provinciaId: string
): Promise<number> {
  console.log(`  [ingest] Provincia ${provinciaId}...`);

  const response = await fetchEstacionesByProvincia(provinciaId);
  // Normalizar a ISO (yyyy-MM-dd) para consistencia con el histórico
  const fechaConsulta = normalizarFechaIso(response.Fecha);
  const estaciones = response.ListaEESSPrecio;

  console.log(`    → ${estaciones.length} estaciones, fecha: ${fechaConsulta}`);

  // Preparar statements batch
  const insertEstacion = sqlite.prepare(`
    INSERT INTO estaciones (id, municipio_id, provincia_id, ccaa_id, rotulo, direccion, localidad, codigo_postal, latitud, longitud, horario, margen, tipo_venta, bioetanol_pct, ester_metilico_pct, fecha_actualizacion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      rotulo = excluded.rotulo, direccion = excluded.direccion, localidad = excluded.localidad,
      codigo_postal = excluded.codigo_postal, latitud = excluded.latitud, longitud = excluded.longitud,
      horario = excluded.horario, margen = excluded.margen, tipo_venta = excluded.tipo_venta,
      bioetanol_pct = excluded.bioetanol_pct, ester_metilico_pct = excluded.ester_metilico_pct,
      fecha_actualizacion = excluded.fecha_actualizacion
  `);

  const insertPrecio = sqlite.prepare(`
    INSERT INTO precios (estacion_id, producto_id, fecha_observacion, precio)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(estacion_id, producto_id, fecha_observacion) DO UPDATE SET precio = excluded.precio
  `);

  // Ejecutar en transacción
  const result = sqlite.transaction(() => {
    let preciosInsertados = 0;
    let estacionesInsertadas = 0;

    for (const raw of estaciones) {
      const estacion = normalizarEstacion(raw, fechaConsulta);
      if (!estacion) continue; // Saltar estaciones sin coordenadas

      insertEstacion.run(
        estacion.id,
        estacion.municipioId,
        estacion.provinciaId,
        estacion.ccaaId,
        estacion.rotulo,
        estacion.direccion,
        estacion.localidad,
        estacion.codigoPostal,
        estacion.latitud,
        estacion.longitud,
        estacion.horario,
        estacion.margen,
        estacion.tipoVenta,
        estacion.bioetanolPct,
        estacion.esterMetilicoPct,
        estacion.fechaActualizacion
      );
      estacionesInsertadas++;

      // Extraer e insertar precios
      const precios = extraerPrecios(raw, fechaConsulta);
      for (const precio of precios) {
        if (precio.precio !== null) {
          insertPrecio.run(
            precio.estacionId,
            precio.productoId,
            precio.fechaObservacion,
            precio.precio
          );
          preciosInsertados++;
        }
      }
    }

    return { estaciones: estacionesInsertadas, precios: preciosInsertados };
  })();

  return result.estaciones;
}

/**
 * Ingesta batch de histórico para una fecha específica.
 * El endpoint retorna TODAS las estaciones de España.
 */
async function ingestHistoricoBatch(
  db: ReturnType<typeof drizzle>,
  sqlite: InstanceType<typeof Database>,
  fecha: string
): Promise<{ estaciones: number; precios: number }> {
  const response = await fetchHistorico(fecha);
  const estaciones = response.ListaEESSPrecio;

  if (estaciones.length === 0) {
    return { estaciones: 0, precios: 0 };
  }

  // Fecha ISO normalizada para consistencia con la BD
  const fechaIso = normalizarFechaIso(response.Fecha);

  const insertEstacion = sqlite.prepare(`
    INSERT INTO estaciones (id, municipio_id, provincia_id, ccaa_id, rotulo, direccion, localidad, codigo_postal, latitud, longitud, horario, margen, tipo_venta, bioetanol_pct, ester_metilico_pct, fecha_actualizacion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      rotulo = excluded.rotulo, direccion = excluded.direccion, localidad = excluded.localidad,
      codigo_postal = excluded.codigo_postal, latitud = excluded.latitud, longitud = excluded.longitud,
      horario = excluded.horario, margen = excluded.margen, tipo_venta = excluded.tipo_venta,
      bioetanol_pct = excluded.bioetanol_pct, ester_metilico_pct = excluded.ester_metilico_pct,
      fecha_actualizacion = excluded.fecha_actualizacion
  `);

  const insertPrecio = sqlite.prepare(`
    INSERT INTO precios (estacion_id, producto_id, fecha_observacion, precio)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(estacion_id, producto_id, fecha_observacion) DO UPDATE SET precio = excluded.precio
  `);

  const result = sqlite.transaction(() => {
    let preciosInsertados = 0;
    let estacionesInsertadas = 0;

    for (const raw of estaciones) {
      const estacion = normalizarEstacion(raw, fechaIso);
      if (!estacion) continue; // Saltar estaciones sin coordenadas

      insertEstacion.run(
        estacion.id,
        estacion.municipioId,
        estacion.provinciaId,
        estacion.ccaaId,
        estacion.rotulo,
        estacion.direccion,
        estacion.localidad,
        estacion.codigoPostal,
        estacion.latitud,
        estacion.longitud,
        estacion.horario,
        estacion.margen,
        estacion.tipoVenta,
        estacion.bioetanolPct,
        estacion.esterMetilicoPct,
        estacion.fechaActualizacion
      );
      estacionesInsertadas++;

      const precios = extraerPrecios(raw, fechaIso);
      for (const precio of precios) {
        if (precio.precio !== null) {
          insertPrecio.run(
            precio.estacionId,
            precio.productoId,
            precio.fechaObservacion,
            precio.precio
          );
          preciosInsertados++;
        }
      }
    }

    return { estaciones: estacionesInsertadas, precios: preciosInsertados };
  })();

  return result;
}

// ─── Script principal ────────────────────────────────────────────────────────

/** Opciones CLI */
interface CliOptions {
  /** Solo datos actuales (sin histórico) */
  currentOnly: boolean;
  /** Solo histórico (sin datos actuales) */
  historicalOnly: boolean;
  /** Fecha inicio histórico (YYYY-MM-DD) */
  from: string | null;
  /** Fecha fin histórico (YYYY-MM-DD) */
  to: string | null;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    currentOnly: args.includes("--current-only"),
    historicalOnly: args.includes("--historical-only"),
    from: null,
    to: null,
  };
  const fromIdx = args.indexOf("--from");
  if (fromIdx !== -1 && args[fromIdx + 1]) opts.from = args[fromIdx + 1];
  const toIdx = args.indexOf("--to");
  if (toIdx !== -1 && args[toIdx + 1]) opts.to = args[toIdx + 1];
  return opts;
}

/** Obtiene fechas de ingesta histórica según opciones CLI */
function getFechasHistoricas(opts: CliOptions): string[] {
  const hoy = new Date();
  hoy.setDate(hoy.getDate() - 1); // Ayer (MITECO tiene 1 día de retardo)

  // Determinar rango
  const inicio = opts.from
    ? new Date(opts.from + "T00:00:00")
    : (() => { const d = new Date(hoy); d.setFullYear(d.getFullYear() - 2); return d; })();

  const fin = opts.to
    ? new Date(opts.to + "T00:00:00")
    : hoy;

  const fechas: string[] = [];
  const fechaActual = new Date(inicio);
  while (fechaActual <= fin) {
    fechas.push(formatDateMiteco(fechaActual));
    fechaActual.setDate(fechaActual.getDate() + 1);
  }

  return fechas;
}

/** Fechas que ya tienen datos en la BD */
function getFechasYaIngeridas(sqlite: InstanceType<typeof Database>): Set<string> {
  const rows = sqlite.prepare(
    "SELECT DISTINCT fecha_observacion FROM precios"
  ).all() as { fecha_observacion: string }[];
  return new Set(rows.map((r) => r.fecha_observacion));
}

async function main() {
  const inicio = Date.now();
  const opts = parseCliArgs();
  const modo = opts.currentOnly ? "SOLO ACTUALES" : opts.historicalOnly ? "SOLO HISTÓRICO" : "COMPLETO";
  console.log(`=== Ingesta MASIVA de España (MITECO) — Modo: ${modo} ===`);
  if (opts.from || opts.to) console.log(`  Rango: ${opts.from || "inicio"} → ${opts.to || "hoy"}`);
  console.log("");

  // Inicializar base de datos
  console.log(`[db] Conectando a ${DB_PATH}...`);
  const sqlite = new Database(DB_PATH);
  const db = drizzle(sqlite, { schema });

  // Optimizaciones de rendimiento
  console.log("[db] Aplicando optimizaciones...");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = OFF");
  sqlite.pragma("cache_size = -64000"); // 64 MB cache
  sqlite.pragma("temp_store = MEMORY");

  // Crear tablas si no existen
  console.log("[db] Creando tablas...");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ccaa (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provincias (
      id TEXT PRIMARY KEY,
      ccaa_id TEXT NOT NULL REFERENCES ccaa(id),
      nombre TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS municipios (
      id TEXT PRIMARY KEY,
      provincia_id TEXT NOT NULL REFERENCES provincias(id),
      nombre TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS estaciones (
      id TEXT PRIMARY KEY,
      municipio_id TEXT NOT NULL REFERENCES municipios(id),
      provincia_id TEXT NOT NULL REFERENCES provincias(id),
      ccaa_id TEXT NOT NULL REFERENCES ccaa(id),
      rotulo TEXT,
      direccion TEXT NOT NULL,
      localidad TEXT NOT NULL,
      codigo_postal TEXT NOT NULL,
      latitud REAL NOT NULL,
      longitud REAL NOT NULL,
      horario TEXT NOT NULL,
      margen TEXT NOT NULL,
      tipo_venta TEXT NOT NULL,
      bioetanol_pct REAL NOT NULL DEFAULT 0,
      ester_metilico_pct REAL NOT NULL DEFAULT 0,
      fecha_actualizacion TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      abreviatura TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS precios (
      estacion_id TEXT NOT NULL REFERENCES estaciones(id),
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      fecha_observacion TEXT NOT NULL,
      precio REAL,
      PRIMARY KEY (estacion_id, producto_id, fecha_observacion)
    );
  `);

  // Crear índices para consultas rápidas
  console.log("[db] Creando índices...");
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_estaciones_provincia ON estaciones(provincia_id);
    CREATE INDEX IF NOT EXISTS idx_estaciones_ccaa ON estaciones(ccaa_id);
    CREATE INDEX IF NOT EXISTS idx_estaciones_municipio ON estaciones(municipio_id);
    CREATE INDEX IF NOT EXISTS idx_estaciones_lat_lon ON estaciones(latitud, longitud);
    CREATE INDEX IF NOT EXISTS idx_precios_producto ON precios(producto_id);
    CREATE INDEX IF NOT EXISTS idx_precios_fecha ON precios(fecha_observacion);
    CREATE INDEX IF NOT EXISTS idx_precios_estacion ON precios(estacion_id);
    CREATE INDEX IF NOT EXISTS idx_precios_estacion_producto ON precios(estacion_id, producto_id);
    CREATE INDEX IF NOT EXISTS idx_precios_producto_fecha ON precios(producto_id, fecha_observacion);
    CREATE INDEX IF NOT EXISTS idx_municipios_provincia ON municipios(provincia_id);
    CREATE INDEX IF NOT EXISTS idx_provincias_ccaa ON provincias(ccaa_id);
  `);
  console.log("[db] Índices creados");

  // ─── FASE 1: Insertar CCAA y Provincias ────────────────────────────────────

  console.log("\n=== FASE 1: CCAA y Provincias ===");
  for (const [id, nombre] of Object.entries(NOMBRE_CCAA)) {
    db.insert(schema.ccaa).values({ id, nombre }).onConflictDoNothing().run();
  }
  for (const [id, info] of Object.entries(PROVINCIAS_ESPANIA)) {
    db.insert(schema.provincias).values({ id, ccaaId: info.ccaaId, nombre: info.nombre }).onConflictDoNothing().run();
  }
  console.log(`  CCAA: ${Object.keys(NOMBRE_CCAA).length}, Provincias: ${Object.keys(PROVINCIAS_ESPANIA).length}`);

  // ─── FASE 2: Productos petrolíferos ────────────────────────────────────────

  console.log("\n=== FASE 2: Productos petrolíferos ===");
  const productos = await fetchProductos();
  for (const prod of productos) {
    db.insert(schema.productos)
      .values({ id: prod.IDProducto, nombre: prod.NombreProducto, abreviatura: prod.NombreProductoAbreviatura })
      .onConflictDoUpdate({ target: schema.productos.id, set: { nombre: prod.NombreProducto, abreviatura: prod.NombreProductoAbreviatura } })
      .run();
  }
  console.log(`  Productos: ${productos.length}`);

  // ─── FASE 3: Datos actuales (52 provincias) ────────────────────────────────

  if (!opts.historicalOnly) {
    console.log("\n=== FASE 3: Datos actuales de TODA España ===");
    const provinciasIds = Object.keys(PROVINCIAS_ESPANIA);
    let totalEstaciones = 0;

    for (let i = 0; i < provinciasIds.length; i++) {
      const pid = provinciasIds[i];
      const nombre = PROVINCIAS_ESPANIA[pid].nombre;
      console.log(`  [${i + 1}/${provinciasIds.length}] ${nombre} (${pid})`);
      try {
        const count = await ingestEstacionesBatch(db, sqlite, pid);
        totalEstaciones += count;
        console.log(`    ✓ ${count} estaciones`);
      } catch (error) {
        console.error(`    ✗ Error: ${error}`);
      }
      if (i < provinciasIds.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`\n  Total estaciones actuales: ${totalEstaciones}`);
  }

  // ─── FASE 3.5: Municipios (poblar desde las estaciones) ────────────────────

  console.log("\n=== FASE 3.5: Municipios ===");
  const insertMunicipio = sqlite.prepare(`
    INSERT OR IGNORE INTO municipios (id, provincia_id, nombre)
    SELECT DISTINCT municipio_id, provincia_id, TRIM(localidad)
    FROM estaciones
    WHERE municipio_id IS NOT NULL AND localidad IS NOT NULL
  `);
  const resultadoMunicipios = insertMunicipio.run();
  const countMunicipiosTabla = sqlite
    .prepare("SELECT COUNT(*) as n FROM municipios")
    .get() as { n: number };
  console.log(
    `  Municipios en tabla: ${countMunicipiosTabla.n} (insertados: ${resultadoMunicipios.changes})`
  );

  // ─── FASE 4: Histórico ─────────────────────────────────────────────────────

  if (!opts.currentOnly) {
    console.log("\n=== FASE 4: Ingesta histórica ===");
    const todasLasFechas = getFechasHistoricas(opts);

    // Saltar fechas ya ingeridas
    const yaIngeridas = getFechasYaIngeridas(sqlite);
    const fechasPendientes = todasLasFechas.filter((f) => {
      // La fecha en BD es "yyyy-MM-dd", la de MITECO es "dd-MM-yyyy"
      const partes = f.split("-");
      const fechaBd = `${partes[2]}-${partes[1]}-${partes[0]}`;
      return !yaIngeridas.has(fechaBd);
    });

    console.log(`  Fechas totales: ${todasLasFechas.length}`);
    console.log(`  Ya ingeridas: ${yaIngeridas.size}`);
    console.log(`  Pendientes: ${fechasPendientes.length}`);

    let fechasProcesadas = 0;
    let fechasConError = 0;
    let totalPreciosHistoricos = 0;

    for (let i = 0; i < fechasPendientes.length; i++) {
      const fecha = fechasPendientes[i];
      try {
        const resultado = await ingestHistoricoBatch(db, sqlite, fecha);
        fechasProcesadas++;
        totalPreciosHistoricos += resultado.precios;
        if ((i + 1) % 25 === 0 || i === fechasPendientes.length - 1) {
          const pct = ((i + 1) / fechasPendientes.length * 100).toFixed(1);
          console.log(`  [${i + 1}/${fechasPendientes.length}] ${pct}% — ${fecha} — Precios: ${totalPreciosHistoricos}`);
        }
      } catch (error) {
        fechasConError++;
        if (fechasConError <= 5) console.error(`  ✗ Error ${fecha}: ${error}`);
      }
      if ((i + 1) % 10 === 0) await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`  Procesadas: ${fechasProcesadas}, Errores: ${fechasConError}`);
  }

  // ─── Resumen final ─────────────────────────────────────────────────────────

  const duracion = ((Date.now() - inicio) / 1000 / 60).toFixed(1);
  const countEstaciones = sqlite.prepare("SELECT COUNT(*) as n FROM estaciones").get() as { n: number };
  const countPrecios = sqlite.prepare("SELECT COUNT(*) as n FROM precios").get() as { n: number };
  const countProductos = sqlite.prepare("SELECT COUNT(*) as n FROM productos").get() as { n: number };
  const countProvincias = sqlite.prepare("SELECT COUNT(DISTINCT provincia_id) as n FROM estaciones").get() as { n: number };
  const countCcaa = sqlite.prepare("SELECT COUNT(DISTINCT ccaa_id) as n FROM estaciones").get() as { n: number };
  const countMunicipios = sqlite.prepare("SELECT COUNT(*) as n FROM municipios").get() as { n: number };
  const countFechasHist = sqlite.prepare("SELECT COUNT(DISTINCT fecha_observacion) as n FROM precios").get() as { n: number };

  const fs = await import("fs");
  const stats = fs.statSync(DB_PATH);
  const dbSizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log("\n=== RESUMEN FINAL ===");
  console.log(`Duración: ${duracion} minutos`);
  console.log(`CCAA: ${countCcaa.n}`);
  console.log(`Provincias: ${countProvincias.n} de ${Object.keys(PROVINCIAS_ESPANIA).length}`);
  console.log(`Municipios: ${countMunicipios.n}`);
  console.log(`Estaciones: ${countEstaciones.n}`);
  console.log(`Productos: ${countProductos.n}`);
  console.log(`Observaciones de precio: ${countPrecios.n}`);
  console.log(`Fechas históricas: ${countFechasHist.n}`);
  console.log(`Tamaño BD: ${dbSizeMB} MB`);

  sqlite.pragma("foreign_keys = ON");
  sqlite.close();
  console.log("\n[seed] ¡Completado!");
}

main().catch((error) => {
  console.error("[seed] Error fatal:", error);
  process.exit(1);
});
