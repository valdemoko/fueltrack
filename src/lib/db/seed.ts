/**
 * Script de seed para poblar la base de datos con datos iniciales de MITECO
 *
 * Uso: npx tsx src/lib/db/seed.ts
 *
 * Proceso:
 * 1. Crear tablas (si no existen)
 * 2. Insertar productos petrolíferos
 * 3. Insertar estaciones de Málaga con precios actuales
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import {
  ingestEstaciones,
  ingestProductos,
} from "@/lib/miteco/ingestion";
import { PROVINCIA_MALAGA } from "@/lib/types/miteco";

/** Ruta al archivo de base de datos */
const DB_PATH = "./data/combustible.db";

async function main() {
  console.log("=== Seed de FuelTrack ===\n");

  // Inicializar base de datos
  console.log(`[seed] Conectando a ${DB_PATH}...`);
  const client = createClient({ url: `file:${DB_PATH}` });
  const db = drizzle(client, { schema });

  // Aplicar migraciones
  console.log("[seed] Aplicando migraciones...");
  try {
    console.log("[seed] (migraciones omitidas: las tablas se crean abajo si no existen)");
  } catch (error) {
    // Si no hay migraciones, crear tablas manualmente
    console.log("[seed] No hay migraciones, creando tablas manualmente...");
    await client.executeMultiple(`
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
    console.log("[seed] Tablas creadas correctamente");
  }

  // Insertar CCAA de Andalucía
  console.log("[seed] Insertando CCAA...");
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
  console.log("[seed] Insertando productos...");
  const numProductos = await ingestProductos(db);
  console.log(`[seed] ${numProductos} productos insertados`);

  // Insertar estaciones de Málaga
  console.log("[seed] Insertando estaciones de Málaga...");
  const numEstaciones = await ingestEstaciones(db, PROVINCIA_MALAGA);
  console.log(`[seed] ${numEstaciones} estaciones insertadas`);

  // Resumen
  const estacionesCount = await db
    .select({ count: schema.estaciones.id })
    .from(schema.estaciones)
    .all();
  const preciosCount = await db
    .select({ count: schema.precios.estacionId })
    .from(schema.precios)
    .all();
  const productosCount = await db
    .select({ count: schema.productos.id })
    .from(schema.productos)
    .all();

  console.log("\n=== Resumen ===");
  console.log(`CCAA: 1`);
  console.log(`Provincias: 1`);
  console.log(`Estaciones: ${estacionesCount.length}`);
  console.log(`Productos: ${productosCount.length}`);
  console.log(`Observaciones de precio: ${preciosCount.length}`);
  console.log("\n[seed] ¡Completado!");
}

main().catch((error) => {
  console.error("[seed] Error:", error);
  process.exit(1);
});
