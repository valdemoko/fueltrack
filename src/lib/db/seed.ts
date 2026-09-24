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
import { sql } from "drizzle-orm";
import { db, queryGet } from "@/lib/db";
import * as schema from "./schema";
import {
  ingestEstaciones,
  ingestProductos,
} from "@/lib/miteco/ingestion";
import { PROVINCIA_MALAGA } from "@/lib/types/miteco";

async function main() {
  console.log("=== Seed de FuelTrack ===\n");

  // Inicializar base de datos
  console.log("[seed] Usando la base de datos configurada (Postgres/Neon)...");

  // El esquema NO se define aquí.
  //
  // Antes este script traía su propio CREATE TABLE (con `REAL` y claves
  // foráneas). Eso creaba un segundo esquema, distinto del de `schema.ts`
  // (`REAL` es float4, no double precision) y con FK que MITECO incumple.
  // La única fuente de verdad es `src/lib/db/schema.ts` + `./drizzle`, y se
  // aplica con `npm run db:migrate`.
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
  console.log("[seed] Insertando CCAA...");
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
    .execute();
  const preciosCount = await db
    .select({ count: schema.precios.estacionId })
    .from(schema.precios)
    .execute();
  const productosCount = await db
    .select({ count: schema.productos.id })
    .from(schema.productos)
    .execute();

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
