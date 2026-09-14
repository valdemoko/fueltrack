/**
 * Migración v3 — a cuenta Turso nueva (combustible-webssssss).
 * FASE 1 (--plan): genera el DDL EXACTO de la BD local (fuente de verdad,
 * ya "limpia" tras la v2) + conteos de validación. NO conecta, NO escribe.
 *
 * FASE 2 (--ejecutar): crea el esquema en la BD nueva y sube los datos en
 * lotes con checkpoints reanudables, leyendo SOLO del fichero local
 * (no toca la BD Turso antigua en ningún momento).
 *
 * Uso:
 *   node scripts/migrar-turso-v3.mjs --plan
 *   node scripts/migrar-turso-v3.mjs --ejecutar --solo-esquema   # FASE 2a
 *   node scripts/migrar-turso-v3.mjs --ejecutar                  # FASE 2b datos
 *
 * Env (leído de .env.local si existen):
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN  → apuntando a la BD NUEVA
 *   LOCAL_DB (opcional, default ./data/combustible.db)
 *   LOTE_FILAS (opcional, default 800)
 */
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ─── Config ─────────────────────────────────────────────────────────────────

const MODO = process.argv.includes("--ejecutar") ? "ejecutar" : "plan";
const SOLO_ESQUEMA = process.argv.includes("--solo-esquema");

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const LOCAL_DB = process.env.LOCAL_DB || "./data/combustible.db";
const LOTE = Number(process.env.LOTE_FILAS || 800);
const PROGRESO_FILE = "scripts/migracion-v3-progreso.json";

/** Host de la BD ANTIGUA (prohibido escribir). Copia de seguridad fuera de alcance. */
const HOST_ANTIGUO_PROHIBIDO = "fueltrack-valdemokoo.aws-eu-west-1.turso.io";

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

// ─── Tablas y orden de migración (respetando dependencias lógicas) ─────────

const TABLAS = [
  { nombre: "ccaa", pk: "id" },
  { nombre: "provincias", pk: "id" },
  { nombre: "municipios", pk: "id" },
  { nombre: "productos", pk: "id" },
  { nombre: "estaciones", pk: "id" },
  { nombre: "precios", pk: "estacion_id, producto_id" },
  { nombre: "precios_historico", pk: "estacion_id, producto_id, fecha" },
  { nombre: "hist_geo_dia", pk: "ambito, geo_id, producto_id, fecha" },
  { nombre: "hist_nac_dia", pk: "producto_id, fecha" },
  { nombre: "hist_mun_mes", pk: "municipio_id, producto_id, mes" },
  { nombre: "hist_prov_mes", pk: "provincia_id, producto_id, mes" },
  { nombre: "hist_ccaa_mes", pk: "ccaa_id, producto_id, mes" },
  { nombre: "hist_estacion_mes", pk: "estacion_id, producto_id, mes" },
  { nombre: "hist_meses_procesados", pk: "mes" },
];

// ─── FASE 1: PLAN — DDL exacto + conteos ────────────────────────────────────

function plan() {
  if (!existsSync(LOCAL_DB)) {
    console.error(`No existe ${LOCAL_DB}`);
    process.exit(1);
  }
  const local = new Database(LOCAL_DB, { readonly: true });

  const objetos = local
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`
    )
    .all();

  const ddl = objetos.map((o) => `${o.sql};`).join("\n\n");
  writeFileSync("scripts/migracion-v3-esquema.sql", ddl);
  console.log(`✔ Esquema exportado: scripts/migracion-v3-esquema.sql (${objetos.length} objetos)`);

  console.log("\n== CONTEOS DE VALIDACIÓN (local) ==");
  const conteos = {};
  for (const t of TABLAS) {
    try {
      const n = local.prepare(`SELECT COUNT(*) n FROM ${t.nombre}`).get().n;
      conteos[t.nombre] = n;
      console.log(`  ${t.nombre}: ${n}`);
    } catch {
      conteos[t.nombre] = "NO_EXISTE";
    }
  }
  writeFileSync("scripts/migracion-v3-conteos-origen.json", JSON.stringify(conteos, null, 2));
  console.log("\n✔ Conteos guardados: scripts/migracion-v3-conteos-origen.json");

  const fechas = local
    .prepare("SELECT MIN(fecha) min, MAX(fecha) max FROM precios_historico")
    .get();
  console.log(`  precios_historico fechas: ${fechas.min} → ${fechas.max}`);

  local.close();
  console.log("\nSiguiente paso: node scripts/migrar-turso-v3.mjs --ejecutar --solo-esquema");
}

// ─── FASE 2: EJECUTAR ───────────────────────────────────────────────────────

function clienteTurso() {
  if (!TURSO_URL || !TURSO_TOKEN) {
    console.error("Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (BD nueva) en .env.local");
    process.exit(1);
  }
  if (TURSO_URL.includes(HOST_ANTIGUO_PROHIBIDO)) {
    console.error(`BLOQUEADO: la URL apunta a la BD antigua (${HOST_ANTIGUO_PROHIBIDO})`);
    process.exit(1);
  }
  return createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
}

function cargarProgreso() {
  if (existsSync(PROGRESO_FILE)) {
    return JSON.parse(readFileSync(PROGRESO_FILE, "utf-8"));
  }
  return { esquema_creado: false, tablas: {} };
}

function guardarProgreso(p) {
  writeFileSync(PROGRESO_FILE, JSON.stringify(p, null, 2));
}

/** Quita las FK del DDL: la BD local tiene huérfanos (ingesta con FK OFF)
 *  y la app nunca ha dependido de la integridad referencial. */
function sinForeignKeys(ddl) {
  return ddl.replace(/\s*REFERENCES\s+"?\w+"?(\s*\([^)]*\))?/gi, "");
}

async function crearEsquema(client, recrear = false) {
  const ddl = sinForeignKeys(
    readFileSync("scripts/migracion-v3-esquema.sql", "utf-8")
  );
  // statements individuales (sqlite_master ya los separa con ';')
  const statements = ddl
    .split(";\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (recrear) {
    const drops = [...TABLAS]
      .reverse()
      .map((t) => ({ sql: `DROP TABLE IF EXISTS ${t.nombre}`, args: [] }));
    console.log(`--recrear: borrando ${drops.length} tablas previas...`);
    await client.batch(drops, "write");
  }
  console.log(`Ejecutando ${statements.length} sentencias DDL en BD nueva...`);
  await client.batch(statements.map((sql) => ({ sql, args: [] })), "write");
  console.log("✔ Esquema creado.");
}

async function migrarTabla(client, tabla, local, progreso) {
  const nombre = tabla.nombre;
  if (progreso.tablas[nombre]?.completada) {
    console.log(`= ${nombre}: ya migrada (${progreso.tablas[nombre].filas} filas), salto`);
    return;
  }

  const total = local.prepare(`SELECT COUNT(*) n FROM ${nombre}`).get().n;
  const desdeFila = progreso.tablas[nombre]?.fila || 0;
  console.log(`→ ${nombre}: ${total} filas (desde fila ${desdeFila})`);

  const stmt = local.prepare(`SELECT * FROM ${nombre}`);
  let fila = 0;
  let lote = [];
  let escritas = 0;

  for (const row of stmt.iterate()) {
    if (fila >= desdeFila) {
      lote.push(row);
      if (lote.length >= LOTE) {
        await insertarLote(client, nombre, lote);
        escritas += lote.length;
        lote = [];
        progreso.tablas[nombre] = { fila: fila + 1, escritas };
        guardarProgreso(progreso);
      }
    }
    fila++;
  }
  if (lote.length > 0) {
    await insertarLote(client, nombre, lote);
    escritas += lote.length;
  }

  progreso.tablas[nombre] = { fila: total, escritas, completada: true };
  guardarProgreso(progreso);
  console.log(`✔ ${nombre}: ${escritas} filas subidas`);
}

async function insertarLote(client, tabla, filas) {
  if (filas.length === 0) return;
  const columnas = Object.keys(filas[0]);
  const colSql = columnas.map((c) => `"${c}"`).join(", ");
  const placeholders = filas
    .map(() => `(${columnas.map(() => "?").join(", ")})`)
    .join(", ");
  const args = filas.flatMap((f) => columnas.map((c) => f[c]));

  await client.execute({
    sql: `INSERT OR REPLACE INTO "${tabla}" (${colSql}) VALUES ${placeholders}`,
    args,
  });
}

async function ejecutar() {
  const client = clienteTurso();
  const local = new Database(LOCAL_DB, { readonly: true });
  const progreso = cargarProgreso();

  const recrear = process.argv.includes("--recrear");
  if (recrear || !progreso.esquema_creado) {
    await crearEsquema(client, recrear);
    progreso.esquema_creado = true;
    progreso.tablas = {}; // reiniciar checkpoints al recrear
    guardarProgreso(progreso);
  } else {
    console.log("= Esquema ya creado, salto");
  }

  if (!SOLO_ESQUEMA) {
    for (const t of TABLAS) {
      await migrarTabla(client, t, local, progreso);
    }
  }

  // Verificación final de conteos
  console.log("\n== VERIFICACIÓN FINAL (nueva BD) ==");
  let ok = true;
  for (const t of TABLAS) {
    const r = await client.execute(`SELECT COUNT(*) n FROM ${t.nombre}`);
    const n = Number(r.rows[0].n);
    const esperado = local.prepare(`SELECT COUNT(*) n FROM ${t.nombre}`).get().n;
    const match = n === esperado;
    if (!match) ok = false;
    console.log(`  ${t.nombre}: ${n} / ${esperado} ${match ? "✔" : "✗ MISMATCH"}`);
  }
  console.log(ok ? "\n✔ MIGRACIÓN ÍNTEGRA COMPLETADA" : "\n✗ HAY DISCREPANCIAS — revisar");

  local.close();
}

if (MODO === "plan") {
  plan();
} else {
  ejecutar().catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
}
