/**
 * Sondeo de SOLO LECTURA del estado de una base de datos Turso.
 *
 * No escribe absolutamente nada: sirve para comprobar que una cuenta nueva
 * responde, que está vacía y cuántas filas tiene cada tabla antes o después
 * de una migración.
 *
 * Uso:
 *   NEW_URL='libsql://...' NEW_TOKEN='eyJ...' node scripts/estado-bd.mjs
 *   # o, para ver la BD configurada en .env.local:
 *   node scripts/estado-bd.mjs --env
 *
 * El token NUNCA se imprime. El host sí, para saber qué cuenta se está
 * mirando.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

const USAR_ENV_LOCAL = process.argv.includes("--env");

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

let URL_DESTINO = process.env.NEW_URL;
let TOKEN_DESTINO = process.env.NEW_TOKEN;

if (USAR_ENV_LOCAL) {
  cargarEnvLocal();
  URL_DESTINO = process.env.TURSO_DATABASE_URL;
  TOKEN_DESTINO = process.env.TURSO_AUTH_TOKEN;
}

if (!URL_DESTINO || !TOKEN_DESTINO) {
  console.error("Faltan NEW_URL / NEW_TOKEN (o usa --env para leer .env.local).");
  process.exit(1);
}

/** Tablas que el proyecto espera encontrar. */
const TABLAS = [
  "ccaa",
  "provincias",
  "municipios",
  "productos",
  "estaciones",
  "precios",
  "precios_historico",
  "hist_geo_dia",
  "hist_geo_semana",
  "hist_nac_dia",
  "hist_mun_mes",
  "hist_prov_mes",
  "hist_ccaa_mes",
  "hist_estacion_mes",
  "hist_meses_procesados",
  "resumen_nacional",
  "cron_progreso",
];

const host = URL_DESTINO.replace(/^libsql:\/\//, "").split(".")[0];
console.log(`BD: ${host}`);
console.log(`(token: ${TOKEN_DESTINO.slice(0, 8)}… ${TOKEN_DESTINO.length} chars)\n`);

const c = createClient({ url: URL_DESTINO, authToken: TOKEN_DESTINO });

try {
  const ping = await c.execute("SELECT 1 AS ok");
  console.log(`Conexión OK (SELECT 1 → ${Number(ping.rows[0].ok)})`);
} catch (e) {
  console.error(`NO RESPONDE: ${e.message}`);
  process.exit(1);
}

// Qué tablas existen de verdad (incluidas las internas de SQLite).
const existentes = new Set(
  (await c.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(
    (r) => String(r.name)
  )
);
console.log(`Tablas en la BD: ${existentes.size}`);
const internas = [...existentes].filter((t) => t.startsWith("sqlite_"));
if (internas.length) console.log(`  (internas: ${internas.join(", ")})`);

let totalFilas = 0;
let faltan = [];
console.log("");
for (const t of TABLAS) {
  if (!existentes.has(t)) {
    faltan.push(t);
    console.log(`  ${t.padEnd(22)} — no existe`);
    continue;
  }
  const r = await c.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  const n = Number(r.rows[0].n);
  totalFilas += n;
  console.log(`  ${t.padEnd(22)} ${String(n).padStart(10)}`);
}

console.log(`\nTOTAL filas: ${totalFilas.toLocaleString("es-ES")}`);
if (faltan.length) {
  console.log(`Faltan ${faltan.length} tabla(s): ${faltan.join(", ")}`);
} else if (totalFilas === 0) {
  console.log("La BD está VACÍA y con las 17 tablas creadas.");
} else {
  console.log("La BD tiene datos.");
}

// Fechas máximas: solo si las tablas tienen filas (si no, es gratis igual).
for (const [tabla, col] of [
  ["precios", "fecha_observacion"],
  ["precios_historico", "fecha"],
  ["hist_geo_dia", "fecha"],
]) {
  if (!existentes.has(tabla)) continue;
  try {
    const r = await c.execute(`SELECT MIN(${col}) AS a, MAX(${col}) AS b FROM ${tabla}`);
    console.log(`  ${tabla}: ${r.rows[0]?.a ?? "-"} … ${r.rows[0]?.b ?? "-"}`);
  } catch {
    /* columna ausente: ignorar */
  }
}
