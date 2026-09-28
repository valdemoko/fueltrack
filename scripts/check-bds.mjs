// Diagnóstico temporal: recuentos por tabla en las dos BDs.
// Uso: node scripts/check-bds.mjs
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const TABLAS = [
  "ccaa", "provincias", "municipios", "productos", "estaciones",
  "precios", "precios_historico", "hist_geo_dia", "hist_nac_dia",
  "hist_mun_mes", "hist_prov_mes", "hist_ccaa_mes", "hist_estacion_mes",
  "resumen_nacional", "cron_progreso",
];

async function explorar(nombre, url, token) {
  console.log(`\n=== ${nombre}: ${url} ===`);
  const c = createClient({ url, authToken: token });
  for (const t of TABLAS) {
    try {
      const r = await c.execute(`SELECT COUNT(*) n FROM ${t}`);
      console.log(`  ${t.padEnd(22)} ${Number(r.rows[0].n)}`);
    } catch (e) {
      console.log(`  ${t.padEnd(22)} ERR: ${e.message.slice(0, 80)}`);
    }
  }
  try {
    const r = await c.execute("SELECT MAX(fecha_observacion) f FROM precios");
    console.log(`  fecha máx precios: ${r.rows[0]?.f ?? "?"}`);
  } catch { /* ignore */ }
}

// Origen: credenciales actuales de .env.local (gasofa-proyectoss)
await explorar(
  "ORIGEN (actual en producción)",
  process.env.TURSO_DATABASE_URL,
  process.env.TURSO_AUTH_TOKEN
);

// Destino: credenciales por entorno (combustible-final)
const DEST_URL = process.env.DEST_URL;
const DEST_TOKEN = process.env.DEST_TOKEN;
if (DEST_URL && DEST_TOKEN) {
  await explorar("DESTINO (nueva)", DEST_URL, DEST_TOKEN);
} else {
  console.log("\n(DEST_URL/DEST_TOKEN no definidos: solo origen)");
}
