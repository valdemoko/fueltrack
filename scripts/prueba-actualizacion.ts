/**
 * Prueba de humo del flujo de actualización (solo lectura + una provincia):
 * ping a la BD, catálogo MITECO e ingesta de una provincia (29 = Málaga).
 * Uso: DATABASE_URL=postgresql://... npx tsx scripts/prueba-actualizacion.ts
 */
import { dbPing } from "../src/lib/db";
import { db } from "../src/lib/db";
import { fetchProductos } from "../src/lib/miteco/client";
import { ingestEstaciones } from "../src/lib/miteco/ingestion";

const t0 = Date.now();
async function main() {
  console.log("[prueba] ping BD =", await dbPing());
  const productos = await fetchProductos();
  console.log(`[prueba] MITECO productos = ${productos.length}`);
  const n = await ingestEstaciones(db, "29");
  console.log(`[prueba] ingesta Málaga = ${n} estaciones en ${Date.now() - t0}ms`);
  process.exit(0);
}
main().catch((e) => {
  console.error("[prueba] ERROR:", e);
  process.exit(1);
});
