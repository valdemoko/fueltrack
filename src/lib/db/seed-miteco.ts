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
import { sql } from "drizzle-orm";
import { db, queryGet } from "@/lib/db";
import * as schema from "./schema";
import {
  ingestEstaciones,
  ingestProductos,
} from "@/lib/miteco/ingestion";
import { PROVINCIA_MALAGA } from "@/lib/types/miteco";

async function main() {
  console.log("=== Seed REAL de FuelTrack (MITECO) ===\n");

  // Inicializar base de datos
  console.log("[seed] Usando la base de datos configurada (Postgres/Neon)...");

  // El esquema NO se define aquí: la única fuente de verdad es
  // `src/lib/db/schema.ts` + `./drizzle` (ver la nota en seed.ts).
  console.log("[seed] Comprobando el esquema...");
  const cuenta = await queryGet<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
  `);
  if ((cuenta?.n ?? 0) === 0) {
    console.error(
      "[seed] ABORTADO: la base de datos no tiene tablas.\n" +
        "       Crea el esquema primero:  npm run db:generate && npm run db:migrate"
    );
    process.exit(1);
  }
  console.log(`[seed] Esquema presente (${cuenta?.n} tablas)`);

  // Insertar CCAA de Andalucía
  console.log("[seed] Insertando CCAA Andalucía...");
  db.insert(schema.ccaa)
    .values({ id: "01", nombre: "Andalucía" })
    .onConflictDoNothing()
    .execute();

  // Insertar provincia de Málaga
  console.log("[seed] Insertando provincia de Málaga...");
  db.insert(schema.provincias)
    .values({ id: PROVINCIA_MALAGA, ccaaId: "01", nombre: "Málaga" })
    .onConflictDoNothing()
    .execute();

  // Insertar productos
  console.log("[seed] Obteniendo productos de MITECO...");
  const numProductos = await ingestProductos(db);
  console.log(`[seed] ${numProductos} productos insertados`);

  // Insertar estaciones de Málaga
  console.log("[seed] Obteniendo estaciones de Málaga de MITECO...");
  const numEstaciones = await ingestEstaciones(db, PROVINCIA_MALAGA);
  console.log(`[seed] ${numEstaciones} estaciones insertadas`);

  // Resumen final
  const estacionesCount = await db
    .select({ count: schema.estaciones.id })
    .from(schema.estaciones)
    .execute();
  const preciosCount = await db
    .select({ count: schema.precios.estacionId })
    .from(schema.precios)
    .execute();
  const productosCount = await db
    .select({ count: schema.productos.id })
    .from(schema.productos)
    .execute();

  // Contar municipios únicos
  const municipiosCount = await db
    .select({ count: schema.estaciones.municipioId })
    .from(schema.estaciones)
    .execute();
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
}

main().catch((error) => {
  console.error("[seed] Error:", error);
  process.exit(1);
});
