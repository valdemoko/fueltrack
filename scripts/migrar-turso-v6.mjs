/**
 * Migración v6 — copia OPTIMIZADA EN CUOTA a una BD/cuenta nueva.
 *
 * Diferencia clave sobre la v5 (que consumió ~10,7M escrituras):
 *  - Los ÍNDICES SECUNDARIOS se crean DESPUÉS de cargar los datos.
 *    Turso cobra CREATE INDEX como lecturas (1 por fila), no escrituras.
 *    Así la migración baja de ~10,7M a ~5-6M de escrituras.
 *  - Sin quitar contenido: mismas tablas, misma retención (32/35 días).
 *
 * Origen: la BD que esté en .env.local (combustible-final, datos al día).
 * Destino: por entorno DEST_URL / DEST_TOKEN (cuenta nueva).
 *
 * Uso:
 *   DEST_URL='libsql://...' DEST_TOKEN='eyJ...' node scripts/migrar-turso-v6.mjs --plan
 *   DEST_URL='...' DEST_TOKEN='...' node scripts/migrar-turso-v6.mjs --ejecutar
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

const MODO = process.argv.includes("--ejecutar") ? "ejecutar" : "plan";
const SOLO_ESQUEMA = process.argv.includes("--solo-esquema");
const LOTE = Number(process.env.LOTE_FILAS || 1000);
const PROGRESO_FILE = "scripts/migracion-v6-progreso.json";

// ─── OBSOLETO: NO RE-EJECUTAR ───────────────────────────────────────────────
// Sigue paginando con `LIMIT/OFFSET` (coste cuadrático en filas leídas). Su
// sustituto es `scripts/migrar-turso-v7.mjs`, con paginación por keyset.
if (!process.argv.includes("--si-se-que-quema-la-cuota")) {
  console.error(
    "ABORTADO: script obsoleto y caro en cuota. Usa scripts/migrar-turso-v7.mjs.\n" +
      "Si aun así quieres ejecutarlo: añade --si-se-que-quema-la-cuota"
  );
  process.exit(1);
}

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const ORIGEN_URL = process.env.TURSO_DATABASE_URL;
const ORIGEN_TOKEN = process.env.TURSO_AUTH_TOKEN;
const DESTINO_URL = process.env.DEST_URL;
const DESTINO_TOKEN = process.env.DEST_TOKEN;

const RETENCION_DIAS_HISTORICO = 32;
const RETENCION_DIAS_GEO = 35;
function corteDias(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

const TABLAS = [
  { nombre: "ccaa", filtro: null },
  { nombre: "provincias", filtro: null },
  { nombre: "municipios", filtro: null },
  { nombre: "productos", filtro: null },
  { nombre: "estaciones", filtro: null },
  { nombre: "precios", filtro: null },
  { nombre: "precios_historico", filtro: `fecha >= '${corteDias(RETENCION_DIAS_HISTORICO)}'` },
  { nombre: "hist_geo_dia", filtro: `fecha >= '${corteDias(RETENCION_DIAS_GEO)}'` },
  { nombre: "hist_nac_dia", filtro: null },
  { nombre: "hist_mun_mes", filtro: null },
  { nombre: "hist_prov_mes", filtro: null },
  { nombre: "hist_ccaa_mes", filtro: null },
  { nombre: "hist_estacion_mes", filtro: null },
  { nombre: "hist_meses_procesados", filtro: null },
  { nombre: "resumen_nacional", filtro: null },
  { nombre: "cron_progreso", filtro: null },
];

function validar() {
  if (!ORIGEN_URL || !ORIGEN_TOKEN) {
    console.error("Faltan TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (origen) en .env.local");
    process.exit(1);
  }
  if (!DESTINO_URL || !DESTINO_TOKEN) {
    console.error("Faltan DEST_URL/DEST_TOKEN (BD nueva) por entorno");
    process.exit(1);
  }
  if (ORIGEN_URL === DESTINO_URL) {
    console.error("ABORTADO: origen y destino son la misma BD.");
    process.exit(1);
  }
}

const origen = () => createClient({ url: ORIGEN_URL, authToken: ORIGEN_TOKEN });
const destino = () => createClient({ url: DESTINO_URL, authToken: DESTINO_TOKEN });

/** Obtiene DDL de tablas (sin índices) y de índices por separado. */
async function obtenerDdl(o) {
  const objs = await o.execute(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`
  );
  const tablas = [];
  const indices = [];
  for (const r of objs.rows) {
    if (r.type === "table") tablas.push(`${r.sql};`);
    else if (r.type === "index") indices.push(`${r.sql};`);
  }
  return { tablas, indices };
}

// ─── PLAN ───────────────────────────────────────────────────────────────────

async function plan() {
  validar();
  const o = origen();
  console.log(`ORIGEN : ${ORIGEN_URL}`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);
  const { tablas, indices } = await obtenerDdl(o);
  writeFileSync("scripts/migracion-v6-esquema-tablas.sql", tablas.join("\n\n"));
  writeFileSync("scripts/migracion-v6-esquema-indices.sql", indices.join("\n\n"));
  console.log(`✔ DDL tablas: ${tablas.length} | índices: ${indices.length} (se crearán AL FINAL)`);

  console.log("\n== CONTEOS A MIGRAR (origen, tras retención) ==");
  const conteos = {};
  let total = 0;
  for (const t of TABLAS) {
    try {
      const r = await o.execute(
        t.filtro ? `SELECT COUNT(*) n FROM ${t.nombre} WHERE ${t.filtro}` : `SELECT COUNT(*) n FROM ${t.nombre}`
      );
      const n = Number(r.rows[0].n);
      conteos[t.nombre] = { a_migrar: n, filtro: t.filtro };
      total += n;
      console.log(`  ${t.nombre.padEnd(22)} ${String(n).padStart(9)} ${t.filtro ? "(retención)" : "(íntegra)"}`);
    } catch {
      conteos[t.nombre] = "NO_EXISTE";
    }
  }
  writeFileSync("scripts/migracion-v6-conteos-origen.json", JSON.stringify(conteos, null, 2));
  console.log(`\nTOTAL filas: ~${total} → escrituras estimadas: ~${Math.round(total * 2.1)} (tablas + PKs, índices al final costan lecturas)`);
}

// ─── EJECUTAR ───────────────────────────────────────────────────────────────

function cargarProgreso() {
  if (existsSync(PROGRESO_FILE)) return JSON.parse(readFileSync(PROGRESO_FILE, "utf-8"));
  return { esquema_creado: false, datos: false, indices_creados: false, tablas: {} };
}
const guardarProgreso = (p) => writeFileSync(PROGRESO_FILE, JSON.stringify(p, null, 2));

async function crearEsquemaTablas(d) {
  const ddl = readFileSync("scripts/migracion-v6-esquema-tablas.sql", "utf-8");
  const statements = ddl.split(";").map((s) => s.trim()).filter(Boolean);
  console.log(`Creando ${statements.length} tablas (SIN índices secundarios)...`);
  for (let i = 0; i < statements.length; i += 40) {
    await d.batch(statements.slice(i, i + 40).map((sql) => ({ sql, args: [] })), "write");
  }
  console.log("✔ Tablas creadas.");
}

async function crearIndices(d) {
  const ddl = readFileSync("scripts/migracion-v6-esquema-indices.sql", "utf-8");
  const statements = ddl.split(";").map((s) => s.trim()).filter(Boolean);
  console.log(`Creando ${statements.length} índices sobre datos ya cargados (cuesta LECTURAS, no escrituras)...`);
  for (const s of statements) {
    try {
      await d.execute(s);
    } catch (e) {
      console.error(`  índice falló: ${e.message.slice(0, 120)}\n  SQL: ${s.slice(0, 120)}`);
    }
  }
  console.log("✔ Índices creados.");
}

async function migrarTabla(o, d, tabla, progreso) {
  const nombre = tabla.nombre;
  if (progreso.tablas[nombre]?.completada) {
    console.log(`= ${nombre}: ya migrada, salto`);
    return;
  }
  const where = tabla.filtro ? ` WHERE ${tabla.filtro}` : "";
  const totalR = await o.execute(`SELECT COUNT(*) n FROM ${nombre}${where}`);
  const total = Number(totalR.rows[0].n);
  const desdeFila = progreso.tablas[nombre]?.fila || 0;

  const colsR = await o.execute(`SELECT * FROM ${nombre}${where} LIMIT 1`);
  const columnas = colsR.columns;
  const colSql = columnas.map((c) => `"${c}"`).join(", ");
  const ph = `(${columnas.map(() => "?").join(", ")})`;

  let fila = 0;
  while (fila < total) {
    const r = await o.execute(`SELECT * FROM ${nombre}${where} LIMIT ${LOTE} OFFSET ${fila}`);
    if (r.rows.length === 0) break;
    const valuesSql = r.rows.map(() => ph).join(", ");
    const args = r.rows.flatMap((row) => columnas.map((c) => row[c]));
    await d.execute({
      sql: `INSERT OR REPLACE INTO "${nombre}" (${colSql}) VALUES ${valuesSql}`,
      args,
    });
    fila += r.rows.length;
    progreso.tablas[nombre] = { fila, escritas: fila };
    guardarProgreso(progreso);
  }
  progreso.tablas[nombre] = { fila: total, escritas: total, completada: true };
  guardarProgreso(progreso);
  console.log(`✔ ${nombre}: ${total} filas`);
}

async function verificar(o, d) {
  const conteos = JSON.parse(readFileSync("scripts/migracion-v6-conteos-origen.json", "utf-8"));
  console.log("\n== VERIFICACIÓN ==");
  let ok = true;
  for (const t of TABLAS) {
    if (typeof conteos[t.nombre] !== "object") continue;
    let esperado;
    try {
      const r = await o.execute(
        t.filtro ? `SELECT COUNT(*) n FROM ${t.nombre} WHERE ${t.filtro}` : `SELECT COUNT(*) n FROM ${t.nombre}`
      );
      esperado = Number(r.rows[0].n);
    } catch { continue; }
    const r = await d.execute(`SELECT COUNT(*) n FROM ${t.nombre}`);
    const n = Number(r.rows[0].n);
    const match = Math.abs(n - esperado) <= Math.ceil(esperado * 0.01);
    if (!match) ok = false;
    console.log(`  ${t.nombre.padEnd(22)} destino=${String(n).padStart(9)} origen=${String(esperado).padStart(9)} ${match ? "✔" : "✗"}`);
  }
  console.log(ok ? "\n✔ MIGRACIÓN V6 COMPLETADA Y VERIFICADA" : "\n✗ DISCREPANCIAS");
  return ok;
}

async function ejecutar() {
  validar();
  const o = origen();
  const d = destino();
  const progreso = cargarProgreso();

  console.log(`ORIGEN : ${ORIGEN_URL} (solo lectura)`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);

  const { tablas: ddlTablas, indices: ddlIndices } = await obtenerDdl(o);
  writeFileSync("scripts/migracion-v6-esquema-tablas.sql", ddlTablas.join("\n\n"));
  writeFileSync("scripts/migracion-v6-esquema-indices.sql", ddlIndices.join("\n\n"));

  if (!progreso.esquema_creado) {
    await crearEsquemaTablas(d);
    progreso.esquema_creado = true;
    guardarProgreso(progreso);
  }

  if (!SOLO_ESQUEMA) {
    if (!progreso.datos) {
      for (const t of TABLAS) {
        try {
          await migrarTabla(o, d, t, progreso);
        } catch (e) {
          console.error(`✗ ERROR en ${t.nombre}: ${e.message}`);
          console.error("(reanuda con el mismo comando)");
          process.exit(1);
        }
      }
      progreso.datos = true;
      guardarProgreso(progreso);
    }
    if (!progreso.indices_creados) {
      await crearIndices(d);
      progreso.indices_creados = true;
      guardarProgreso(progreso);
    }
  }

  await verificar(o, d);
}

if (MODO === "plan") {
  plan().catch((e) => { console.error("ERROR:", e); process.exit(1); });
} else {
  ejecutar().catch((e) => { console.error("ERROR:", e); process.exit(1); });
}
