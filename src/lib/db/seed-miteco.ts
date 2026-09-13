/**
 * Script de seed REAL contra la API MITECO
 *
 * Uso: npx tsx src/lib/db/seed-miteco.ts
 *
 * Proceso:
 * 1. Crear/conectar base de datos
 * 2. Crear tablas si no existen
 * 3. Insertar CCAA Andalucía
 * 4. Insertar provincia Málaga
 * 5. Fetch y insertar productos petrolíferos
 * 6. Fetch y upsert estaciones de Málaga (~309 estaciones)
 * 7. Mostrar resumen
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import {
  ingestEstaciones,
  ingestProductos,
} from "@/lib/miteco/ingestion";
import { PROVINCIA_MALAGA } from "@/lib/types/miteco";

/** Ruta al archivo de base de datos */
const DB_PATH = "./data/combustible.db";

async function main() {
  console.log("=== Seed REAL de FuelTrack (MITECO) ===\n");

  // Inicializar base de datos
  console.log(`[seed] Conectando a ${DB_PATH}...`);
  const sqlite = new Database(DB_PATH);
  const db = drizzle(sqlite, { schema });

  // Crear tablas si no existen
  console.log("[seed] Creando tablas si no existen...");
  sqlite.pragma("foreign_keys = OFF");
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
  console.log("[seed] Tablas listas");

  // Insertar CCAA de Andalucía
  console.log("[seed] Insertando CCAA Andalucía...");
  db.insert(schema.ccaa)
    .values({ id: "01", nombre: "Andalucía" })
    .onConflictDoNothing()
    .run();

  // Insertar provincia de Málaga
  console.log("[seed] Insertando provincia de Málaga...");
  db.insert(schema.provincias)
    .values({ id: PROVINCIA_MALAGA, ccaaId: "01", nombre: "Málaga" })
    .onConflictDoNothing()
    .run();

  // Insertar productos
  console.log("[seed] Obteniendo productos de MITECO...");
  const numProductos = await ingestProductos(db);
  console.log(`[seed] ${numProductos} productos insertados`);

  // Insertar estaciones de Málaga
  console.log("[seed] Obteniendo estaciones de Málaga de MITECO...");
  const numEstaciones = await ingestEstaciones(db, PROVINCIA_MALAGA);
  console.log(`[seed] ${numEstaciones} estaciones insertadas`);

  // Resumen final
  const estacionesCount = db
    .select({ count: schema.estaciones.id })
    .from(schema.estaciones)
    .all();
  const preciosCount = db
    .select({ count: schema.precios.estacionId })
    .from(schema.precios)
    .all();
  const productosCount = db
    .select({ count: schema.productos.id })
    .from(schema.productos)
    .all();

  // Contar municipios únicos
  const municipiosCount = db
    .select({ count: schema.estaciones.municipioId })
    .from(schema.estaciones)
    .all();
  const municipiosUnicos = new Set(municipiosCount.map((m) => m.count));

  console.log("\n=== Resumen ===");
  console.log(`CCAA: 1 (Andalucía)`);
  console.log(`Provincias: 1 (Málaga)`);
  console.log(`Municipios con estaciones: ${municipiosUnicos.size}`);
  console.log(`Estaciones: ${estacionesCount.length}`);
  console.log(`Productos: ${productosCount.length}`);
  console.log(`Observaciones de precio: ${preciosCount.length}`);
  console.log("\n[seed] ¡Completado! Base de datos lista.");

  // Reactivar foreign keys
  sqlite.pragma("foreign_keys = ON");

  // Cerrar conexión
  sqlite.close();
}

main().catch((error) => {
  console.error("[seed] Error:", error);
  process.exit(1);
});
