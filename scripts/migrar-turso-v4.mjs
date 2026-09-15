/**
 * Migración v4 — a cuenta Turso nueva (gasofa-proyectoss), "limpia".
 *
 * Mejoras sobre la v3:
 *  1. APLICACIÓN DE LA POLÍTICA DE RETENCIÓN durante la copia:
 *     - precios_historico: solo últimos 32 días (los más antiguos ya viven
 *       como medias en hist_estacion_mes y hist_geo_dia/mensuales).
 *     - hist_geo_dia: solo últimos 35 días ("30 días diarios + mensual").
 *     - hist_nac_dia: íntegra (serie diaria nacional permanente, la usan
 *       las gráficas largas).
 *     - tablas mensuales y catálogos: íntegros.
 *  2. CREA Y PRECARGA `resumen_nacional` (una fila por producto), para que
 *     el primer render de producción ya sea barato.
 *  3. Crea también `cron_progreso` (el cron la creará igualmente si falta).
 *
 * Uso (las credenciales de la BD NUEVA van por entorno, no se toca .env.local):
 *   TURSO_DATABASE_URL='libsql://gasofa-proyectoss...' \
 *   TURSO_AUTH_TOKEN='eyJ...' \
 *   node scripts/migrar-turso-v4.mjs --plan
 *   ... node scripts/migrar-turso-v4.mjs --ejecutar --solo-esquema
 *   ... node scripts/migrar-turso-v4.mjs --ejecutar
 *
 * Reanudable por checkpoints (scripts/migracion-v4-progreso.json).
 * LEE SOLO del fichero local ./data/combustible.db (fuente de verdad);
 * jamás toca las BD Turso antiguas.
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
const PROGRESO_FILE = "scripts/migracion-v4-progreso.json";

/** Política de retención (debe coincidir con src/lib/db/mantenimiento.ts). */
const RETENCION_DIAS_HISTORICO = 32;
const RETENCION_DIAS_GEO = 35;

/** Hosts de BDs ANTIGUAS (prohibido escribir). */
const HOSTS_PROHIBIDOS = [
  "fueltrack-valdemokoo.aws-eu-west-1.turso.io",
  "combustible-webssssss.aws-eu-west-1.turso.io",
];

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

// ─── Tablas y orden de migración ─────────────────────────────────────────────
// `filtro` = recorte por retención aplicado al copiar (null = íntegra).

function corteDias(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

const TABLAS = [
  { nombre: "ccaa", pk: "id", filtro: null },
  { nombre: "provincias", pk: "id", filtro: null },
  { nombre: "municipios", pk: "id", filtro: null },
  { nombre: "productos", pk: "id", filtro: null },
  { nombre: "estaciones", pk: "id", filtro: null },
  { nombre: "precios", pk: "estacion_id, producto_id", filtro: null },
  {
    nombre: "precios_historico",
    pk: "estacion_id, producto_id, fecha",
    filtro: `fecha >= '${corteDias(RETENCION_DIAS_HISTORICO)}'`,
  },
  {
    nombre: "hist_geo_dia",
    pk: "ambito, geo_id, producto_id, fecha",
    filtro: `fecha >= '${corteDias(RETENCION_DIAS_GEO)}'`,
  },
  { nombre: "hist_nac_dia", pk: "producto_id, fecha", filtro: null },
  { nombre: "hist_mun_mes", pk: "municipio_id, producto_id, mes", filtro: null },
  { nombre: "hist_prov_mes", pk: "provincia_id, producto_id, mes", filtro: null },
  { nombre: "hist_ccaa_mes", pk: "ccaa_id, producto_id, mes", filtro: null },
  { nombre: "hist_estacion_mes", pk: "estacion_id, producto_id, mes", filtro: null },
  { nombre: "hist_meses_procesados", pk: "mes", filtro: null },
];

// ─── FASE 1: PLAN — DDL exacto + conteos post-retención ─────────────────────

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
  writeFileSync("scripts/migracion-v4-esquema.sql", ddl);
  console.log(`✔ Esquema exportado: scripts/migracion-v4-esquema.sql (${objetos.length} objetos)`);

  console.log("\n== CONTEOS A MIGRAR (local, tras aplicar retención) ==");
  const conteos = {};
  for (const t of TABLAS) {
    try {
      const n = t.filtro
        ? local.prepare(`SELECT COUNT(*) n FROM ${t.nombre} WHERE ${t.filtro}`).get().n
        : local.prepare(`SELECT COUNT(*) n FROM ${t.nombre}`).get().n;
      const total = local.prepare(`SELECT COUNT(*) n FROM ${t.nombre}`).get().n;
      conteos[t.nombre] = { a_migrar: n, total_local: total, filtro: t.filtro };
      console.log(`  ${t.nombre}: ${n} de ${total} ${t.filtro ? `(filtro: ${t.filtro})` : "(íntegra)"}`);
    } catch {
      conteos[t.nombre] = "NO_EXISTE";
    }
  }
  writeFileSync("scripts/migracion-v4-conteos-origen.json", JSON.stringify(conteos, null, 2));
  console.log("\n✔ Conteos guardados: scripts/migracion-v4-conteos-origen.json");
  local.close();
}

// ─── FASE 2: EJECUTAR ───────────────────────────────────────────────────────

function clienteTurso() {
  if (!TURSO_URL || !TURSO_TOKEN) {
    console.error("Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (BD nueva) por entorno");
    process.exit(1);
  }
  for (const host of HOSTS_PROHIBIDOS) {
    if (TURSO_URL.includes(host)) {
      console.error(`BLOQUEADO: la URL apunta a una BD anterior (${host})`);
      process.exit(1);
    }
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

/** Quita las FK del DDL: la app nunca ha dependido de la integridad referencial. */
function sinForeignKeys(ddl) {
  return ddl.replace(/\s*REFERENCES\s+"?\w+"?(\s*\([^)]*\))?/gi, "");
}

/** DDL del esquema local + tablas auxiliares nuevas. */
function ddlCompleto() {
  const ddlLocal = sinForeignKeys(
    readFileSync("scripts/migracion-v4-esquema.sql", "utf-8")
  );
  const extras = `
CREATE TABLE IF NOT EXISTS resumen_nacional (
  producto_id INTEGER PRIMARY KEY,
  precio_medio REAL NOT NULL,
  precio_min REAL NOT NULL,
  precio_max REAL NOT NULL,
  total_estaciones INTEGER NOT NULL,
  fecha TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cron_progreso (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provincia_idx INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL
);
-- Índices secundarios (las PK solos no cubren los filtros de la app;
-- sin ellos cada consulta escanea tablas enteras y quema la cuota):
CREATE INDEX IF NOT EXISTS idx_estaciones_provincia ON estaciones(provincia_id);
CREATE INDEX IF NOT EXISTS idx_estaciones_ccaa ON estaciones(ccaa_id);
CREATE INDEX IF NOT EXISTS idx_estaciones_municipio ON estaciones(municipio_id);
CREATE INDEX IF NOT EXISTS idx_estaciones_lat_lon ON estaciones(latitud, longitud);
CREATE INDEX IF NOT EXISTS idx_precios_producto ON precios(producto_id);
CREATE INDEX IF NOT EXISTS idx_precios_fecha ON precios(fecha_observacion);
CREATE INDEX IF NOT EXISTS idx_precios_producto_fecha ON precios(producto_id, fecha_observacion);
CREATE INDEX IF NOT EXISTS idx_municipios_provincia ON municipios(provincia_id);
CREATE INDEX IF NOT EXISTS idx_provincias_ccaa ON provincias(ccaa_id);
CREATE INDEX IF NOT EXISTS idx_hist_fecha ON precios_historico(fecha);
CREATE INDEX IF NOT EXISTS idx_hist_geo_fecha ON hist_geo_dia(fecha);
`;
  // resumen_nacional podría ya venir en el esquema local (futuro); evitar duplicado
  const sinDuplicado = ddlLocal.includes("CREATE TABLE resumen_nacional")
    ? ddlLocal
    : ddlLocal + extras;
  return sinDuplicado;
}

async function crearEsquema(client, recrear = false) {
  const ddl = ddlCompleto();
  const statements = ddl
    .split(";\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (recrear) {
    const drops = [...TABLAS]
      .reverse()
      .map((t) => ({ sql: `DROP TABLE IF EXISTS ${t.nombre}`, args: [] }));
    drops.push({ sql: "DROP TABLE IF EXISTS resumen_nacional", args: [] });
    drops.push({ sql: "DROP TABLE IF EXISTS cron_progreso", args: [] });
    console.log(`--recrear: borrando tablas previas...`);
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

  const where = tabla.filtro ? ` WHERE ${tabla.filtro}` : "";
  const total = local
    .prepare(`SELECT COUNT(*) n FROM ${nombre}${where}`)
    .get().n;
  const desdeFila = progreso.tablas[nombre]?.fila || 0;
  console.log(`→ ${nombre}: ${total} filas${tabla.filtro ? ` (retención: ${tabla.filtro})` : ""} (desde fila ${desdeFila})`);

  const stmt = local.prepare(`SELECT * FROM ${nombre}${where}`);
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

/** Precarga resumen_nacional desde la tabla precios recién migrada. */
async function precargarResumenNacional(client) {
  console.log("→ Precargando resumen_nacional...");
  const r = await client.execute(`
    INSERT INTO resumen_nacional (producto_id, precio_medio, precio_min, precio_max, total_estaciones, fecha)
    SELECT pr.producto_id,
           ROUND(AVG(pr.precio), 4),
           MIN(pr.precio),
           MAX(pr.precio),
           COUNT(DISTINCT pr.estacion_id),
           MAX(pr.fecha_observacion)
    FROM precios pr
    WHERE pr.precio IS NOT NULL
    GROUP BY pr.producto_id
    ON CONFLICT (producto_id) DO UPDATE SET
      precio_medio = excluded.precio_medio,
      precio_min = excluded.precio_min,
      precio_max = excluded.precio_max,
      total_estaciones = excluded.total_estaciones,
      fecha = excluded.fecha
  `);
  const n = await client.execute("SELECT COUNT(*) n FROM resumen_nacional");
  console.log(`✔ resumen_nacional: ${Number(n.rows[0].n)} productos (${r.rowsAffected} filas)`);
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
    await precargarResumenNacional(client);
  }

  // Verificación final: la BD nueva debe tener exactamente las filas
  // "a_migrar" declaradas en el plan (local tras aplicar retención).
  const esperados = JSON.parse(
    readFileSync("scripts/migracion-v4-conteos-origen.json", "utf-8")
  );
  console.log("\n== VERIFICACIÓN FINAL (nueva BD vs plan) ==");
  let ok = true;
  for (const t of TABLAS) {
    const r = await client.execute(`SELECT COUNT(*) n FROM ${t.nombre}`);
    const n = Number(r.rows[0].n);
    const esperado =
      typeof esperados[t.nombre] === "object"
        ? esperados[t.nombre].a_migrar
        : esperados[t.nombre];
    const match = n === esperado;
    if (!match) ok = false;
    console.log(`  ${t.nombre}: ${n} / ${esperado} ${match ? "✔" : "✗ MISMATCH"}`);
  }
  console.log(ok ? "\n✔ MIGRACIÓN V4 COMPLETADA Y VERIFICADA" : "\n✗ HAY DISCREPANCIAS — revisar");

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
