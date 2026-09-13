/**
 * Importación de la BD local (4,4 GB) a Turso.
 *
 * Fases:
 *  1. Esquema (tablas, SIN índices secundarios durante la carga)
 *  2. Datos pequeños: ccaa, provincias, municipios, productos, estaciones
 *  3. Precios: 29,8M filas por lotes (batch de 500 INSERT en una transacción),
 *     leídas por rango de rowid de la BD local (keyset paginación).
 *  4. Índices secundarios al final (mucho más rápidos que durante la carga).
 *
 * Uso: node scripts/importar-turso.mjs
 * Requiere: TURSO_DATABASE_URL y TURSO_AUTH_TOKEN (o los alias TURSO_URL/
 * TURSO_TOKEN/DATABASE_URL/DATABASE_AUTH_TOKEN) en .env.local o entorno.
 *
 * Reanudable: guarda el progreso en scripts/import-progress.json. Si se corta,
 * vuelve a ejecutar el mismo comando y continúa por donde iba (los INSERT son
 * INSERT OR IGNORE, así que re-ejecutar no duplica datos).
 */
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ─── Configuración ──────────────────────────────────────────────────────────

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const TURSO_URL =
  process.env.TURSO_DATABASE_URL ||
  process.env.TURSO_URL ||
  process.env.DATABASE_URL;
const TURSO_TOKEN =
  process.env.TURSO_AUTH_TOKEN ||
  process.env.TURSO_TOKEN ||
  process.env.DATABASE_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_URL.startsWith("libsql://")) {
  console.error("Falta TURSO_DATABASE_URL (libsql://...). Edita .env.local y vuelve a ejecutar.");
  process.exit(1);
}
if (!TURSO_TOKEN) {
  console.error("Falta TURSO_AUTH_TOKEN. Edita .env.local y vuelve a ejecutar.");
  process.exit(1);
}

const LOCAL_DB = "./data/combustible.db";
const LOTE = 2000; // INSERTs por batch (transacción de ~2000 filas)
const PROGRESO_CADA = 50; // logs

const local = new Database(LOCAL_DB, { readonly: true });
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// FK off durante la importación (la ingesta local también corría con FK off;
// hay estaciones huérfanas de municipio). Se reintegra la integridad después.
await turso.execute("PRAGMA foreign_keys = OFF");

// ─── Esquema (sin índices secundarios) ──────────────────────────────────────

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS ccaa (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS provincias (
    id TEXT PRIMARY KEY,
    ccaa_id TEXT NOT NULL REFERENCES ccaa(id),
    nombre TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS municipios (
    id TEXT PRIMARY KEY,
    provincia_id TEXT NOT NULL REFERENCES provincias(id),
    nombre TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS estaciones (
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
  )`,
  `CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    abreviatura TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS precios (
    estacion_id TEXT NOT NULL,
    producto_id INTEGER NOT NULL,
    fecha_observacion TEXT NOT NULL,
    precio REAL,
    PRIMARY KEY (estacion_id, producto_id, fecha_observacion)
  )`,
];

// Creados AL FINAL de la carga
const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_estaciones_provincia ON estaciones(provincia_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_ccaa ON estaciones(ccaa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_municipio ON estaciones(municipio_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_lat_lon ON estaciones(latitud, longitud)`,
  `CREATE INDEX IF NOT EXISTS idx_municipios_provincia ON municipios(provincia_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provincias_ccaa ON provincias(ccaa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_estacion ON precios(estacion_id)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_producto ON precios(producto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_fecha ON precios(fecha_observacion)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_estacion_producto ON precios(estacion_id, producto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_producto_fecha ON precios(producto_id, fecha_observacion)`,
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString().slice(11, 19);

async function insertarFilas(tabla, columnas, filas) {
  if (filas.length === 0) return 0;
  const placeholders = `(${columnas.map(() => "?").join(",")})`;
  const stmt = `INSERT OR IGNORE INTO ${tabla} (${columnas.join(",")}) VALUES `;
  let total = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await turso.batch(
      lote.map((f) => ({ sql: stmt + placeholders, args: f })),
      "write"
    );
    total += lote.length;
  }
  return total;
}

function filasAArgs(filas, columnas) {
  return filas.map((f) => columnas.map((c) => f[c]));
}

// ─── Fase 1: esquema ────────────────────────────────────────────────────────

console.log(`[${now()}] Fase 1: creando esquema en Turso...`);
for (const ddl of TABLAS) {
  await turso.execute(ddl);
}
console.log(`[${now()}] Tablas creadas.`);

// ─── Fase 2: datos geográficos y estaciones ─────────────────────────────────

console.log(`[${now()}] Fase 2: geografía y estaciones...`);

let n = await insertarFilas(
  "ccaa",
  ["id", "nombre"],
  filasAArgs(local.prepare("SELECT id, nombre FROM ccaa").all(), ["id", "nombre"])
);
console.log(`[${now()}]   ccaa: ${n}`);

n = await insertarFilas(
  "provincias",
  ["id", "ccaa_id", "nombre"],
  filasAArgs(
    local.prepare("SELECT id, ccaa_id, nombre FROM provincias").all(),
    ["id", "ccaa_id", "nombre"]
  )
);
console.log(`[${now()}]   provincias: ${n}`);

n = await insertarFilas(
  "municipios",
  ["id", "provincia_id", "nombre"],
  filasAArgs(
    local.prepare("SELECT id, provincia_id, nombre FROM municipios").all(),
    ["id", "provincia_id", "nombre"]
  )
);
console.log(`[${now()}]   municipios: ${n}`);

n = await insertarFilas(
  "productos",
  ["id", "nombre", "abreviatura"],
  filasAArgs(
    local.prepare("SELECT id, nombre, abreviatura FROM productos").all(),
    ["id", "nombre", "abreviatura"]
  )
);
console.log(`[${now()}]   productos: ${n}`);

// Estaciones: 13k filas con 16 columnas → lotes
{
  const columnas = [
    "id", "municipio_id", "provincia_id", "ccaa_id", "rotulo", "direccion",
    "localidad", "codigo_postal", "latitud", "longitud", "horario", "margen",
    "tipo_venta", "bioetanol_pct", "ester_metilico_pct", "fecha_actualizacion",
  ];
  const stmt = local.prepare(
    `SELECT ${columnas.join(",")} FROM estaciones`
  );
  let enviadas = 0;
  // better-sqlite3 itera de forma perezosa; acumulamos en memoria por lotes
  let buffer = [];
  for (const fila of stmt.iterate()) {
    buffer.push(columnas.map((c) => fila[c]));
    if (buffer.length === LOTE) {
      await insertarFilas("estaciones", columnas, buffer);
      enviadas += buffer.length;
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    await insertarFilas("estaciones", columnas, buffer);
    enviadas += buffer.length;
  }
  console.log(`[${now()}]   estaciones: ${enviadas}`);
}

// ─── Fase 3: precios (29,8M filas, keyset por rowid) ────────────────────────

console.log(`[${now()}] Fase 3: precios (esto tardará)...`);

const totalPrecios = local
  .prepare("SELECT COUNT(*) AS n FROM precios")
  .get().n;
console.log(`[${now()}]   filas a importar: ${totalPrecios.toLocaleString("es-ES")}`);

const selectLote = local.prepare(
  "SELECT rowid AS rid, estacion_id, producto_id, fecha_observacion, precio FROM precios WHERE rowid > ? ORDER BY rowid LIMIT ?"
);

// Reanudar desde el último punto de control si existe (misma BD local)
let ultimaRowid = 0;
let importadas = 0;
if (existsSync("scripts/import-progress.json")) {
  try {
    const chk = JSON.parse(readFileSync("scripts/import-progress.json", "utf-8"));
    if (Number.isFinite(chk.ultimaRowid) && chk.ultimaRowid > 0) {
      ultimaRowid = chk.ultimaRowid;
      importadas = chk.importadas ?? 0;
      console.log(
        `[${now()}]   reanudando desde rowid=${ultimaRowid} (${importadas.toLocaleString("es-ES")} filas ya importadas)`
      );
    }
  } catch {
    // checkpoint corrupto: empezar de cero (INSERT OR IGNORE evita duplicados)
  }
}
const inicio = Date.now();

while (true) {
  const filas = selectLote.all(ultimaRowid, LOTE * 15); // 30.000 filas por lectura local
  if (filas.length === 0) break;

  // Enviar en sub-lotes de LOTE para no exceder límites del batch de Turso
  for (let i = 0; i < filas.length; i += LOTE) {
    const sub = filas.slice(i, i + LOTE);
    await turso.batch(
      sub.map((f) => ({
        sql: "INSERT OR IGNORE INTO precios (estacion_id, producto_id, fecha_observacion, precio) VALUES (?,?,?,?)",
        args: [f.estacion_id, f.producto_id, f.fecha_observacion, f.precio],
      })),
      "write"
    );
  }

  ultimaRowid = filas[filas.length - 1].rid;
  importadas += filas.length;

  if (Math.floor(importadas / 100000) !== Math.floor((importadas - filas.length) / 100000) || importadas >= totalPrecios) {
    const pct = ((importadas / totalPrecios) * 100).toFixed(1);
    const mins = ((Date.now() - inicio) / 60000).toFixed(1);
    const filasPorSeg = Math.round(importadas / ((Date.now() - inicio) / 1000));
    console.log(
      `[${now()}]   ${importadas.toLocaleString("es-ES")}/${totalPrecios.toLocaleString("es-ES")} (${pct}%) — ${mins} min — ${filasPorSeg}/s`
    );
    // Punto de control para reanudar si se corta
    writeFileSync("scripts/import-progress.json", JSON.stringify({ ultimaRowid, importadas }));
  }
}

console.log(`[${now()}] Fase 3 completada.`);

// ─── Fase 4: índices secundarios ────────────────────────────────────────────

console.log(`[${now()}] Fase 4: creando índices (puede tardar varios minutos)...`);
for (const ddl of INDICES) {
  const t0 = Date.now();
  await turso.execute(ddl);
  console.log(`[${now()}]   OK (${((Date.now() - t0) / 1000).toFixed(1)}s): ${ddl.slice(0, 60)}...`);
}

// ─── Verificación final ─────────────────────────────────────────────────────

console.log(`[${now()}] Verificación:`);
for (const tabla of ["ccaa", "provincias", "municipios", "productos", "estaciones", "precios"]) {
  const r = await turso.execute(`SELECT COUNT(*) AS n FROM ${tabla}`);
  console.log(`  ${tabla}: ${r.rows[0].n.toLocaleString("es-ES")}`);
}

local.close();
console.log(`[${now()}] ✅ Importación completada.`);
