/**
 * Migración v5 — copia LIMPIA de la BD de producción activa a una BD nueva.
 *
 * Diferencias sobre la v4:
 *  - El ORIGEN es la BD Turso activa (TURSO_DATABASE_URL de .env.local,
 *    gasofa-proyectoss), no un fichero local desactualizado.
 *  - El DESTINO va por entorno (DEST_URL / DEST_TOKEN): la BD nueva
 *    (combustible-final). NUNCA escribe en el origen.
 *  - Aplica la MISMA política de retención (precios_historico 32 días,
 *    hist_geo_dia 35 días) para que la nueva BD nazca limpia y pequeña.
 *  - El esquema se vuelca del ORIGEN (sqlite_master), idéntico al actual.
 *  - Checkpoints en scripts/migracion-v5-progreso.json (reanudable).
 *
 * Uso:
 *   DEST_URL='libsql://combustible-final...' DEST_TOKEN='eyJ...' \
 *   node scripts/migrar-turso-v5.mjs --plan
 *   ... node scripts/migrar-turso-v5.mjs --ejecutar            # esquema + datos
 *   ... node scripts/migrar-turso-v5.mjs --ejecutar --solo-esquema
 *   ... node scripts/migrar-turso-v5.mjs --ejecutar --recrear  # DROP + redo
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

// ─── Config ─────────────────────────────────────────────────────────────────

const MODO = process.argv.includes("--ejecutar") ? "ejecutar" : "plan";
const SOLO_ESQUEMA = process.argv.includes("--solo-esquema");
const RECREAR = process.argv.includes("--recrear");
const LOTE = Number(process.env.LOTE_FILAS || 1000);
const PROGRESO_FILE = "scripts/migracion-v5-progreso.json";

// ─── OBSOLETO: NO RE-EJECUTAR ───────────────────────────────────────────────
// Este script pagina con `LIMIT/OFFSET`, lo que en SQLite re-escanea desde el
// principio en cada página: copiar 2,8M filas costaba ~1.100 MILLONES de
// filas leídas por ejecución (el 100 % de la cuota de Turso Free) y fue una
// de las causas del bloqueo de la cuenta. Su sustituto es
// `scripts/migrar-turso-v7.mjs`, que pagina por keyset (coste lineal).
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

/** Política de retención (idéntica a src/lib/db/mantenimiento.ts y v4). */
const RETENCION_DIAS_HISTORICO = 32;
const RETENCION_DIAS_GEO = 35;
function corteDias(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

/** Tablas en orden de migración; filtro = retención aplicada al copiar. */
const TABLAS = [
  { nombre: "ccaa", filtro: null },
  { nombre: "provincias", filtro: null },
  { nombre: "municipios", filtro: null },
  { nombre: "productos", filtro: null },
  { nombre: "estaciones", filtro: null },
  { nombre: "precios", filtro: null },
  {
    nombre: "precios_historico",
    filtro: `fecha >= '${corteDias(RETENCION_DIAS_HISTORICO)}'`,
  },
  {
    nombre: "hist_geo_dia",
    filtro: `fecha >= '${corteDias(RETENCION_DIAS_GEO)}'`,
  },
  { nombre: "hist_nac_dia", filtro: null },
  { nombre: "hist_mun_mes", filtro: null },
  { nombre: "hist_prov_mes", filtro: null },
  { nombre: "hist_ccaa_mes", filtro: null },
  { nombre: "hist_estacion_mes", filtro: null },
  { nombre: "hist_meses_procesados", filtro: null },
  { nombre: "resumen_nacional", filtro: null },
  { nombre: "cron_progreso", filtro: null },
];

function validarCredenciales() {
  if (!ORIGEN_URL || !ORIGEN_TOKEN) {
    console.error("Faltan TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (origen) en .env.local");
    process.exit(1);
  }
  if (!DESTINO_URL || !DESTINO_TOKEN) {
    console.error("Faltan DEST_URL/DEST_TOKEN (BD nueva) por entorno. Ej.:\n" +
      "  DEST_URL='libsql://combustible-final.aws-eu-west-1.turso.io' DEST_TOKEN='eyJ...' node scripts/migrar-turso-v5.mjs --plan");
    process.exit(1);
  }
  if (ORIGEN_URL === DESTINO_URL) {
    console.error("ABORTADO: origen y destino son la misma BD.");
    process.exit(1);
  }
}

const origen = () => createClient({ url: ORIGEN_URL, authToken: ORIGEN_TOKEN });
const destino = () => createClient({ url: DESTINO_URL, authToken: DESTINO_TOKEN });

// ─── PLAN ───────────────────────────────────────────────────────────────────

async function plan() {
  validarCredenciales();
  const o = origen();
  console.log(`ORIGEN : ${ORIGEN_URL}`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);

  // Esquema del origen
  const objs = await o.execute(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`
  );
  const ddl = objs.rows.map((r) => `${r.sql};`).join("\n\n");
  writeFileSync("scripts/migracion-v5-esquema.sql", ddl);
  console.log(`✔ Esquema exportado: scripts/migracion-v5-esquema.sql (${objs.rows.length} objetos)`);

  console.log("\n== CONTEOS A MIGRAR (origen, tras retención) ==");
  const conteos = {};
  for (const t of TABLAS) {
    try {
      const r = await o.execute(
        t.filtro
          ? `SELECT COUNT(*) n FROM ${t.nombre} WHERE ${t.filtro}`
          : `SELECT COUNT(*) n FROM ${t.nombre}`
      );
      const n = Number(r.rows[0].n);
      conteos[t.nombre] = { a_migrar: n, filtro: t.filtro };
      console.log(`  ${t.nombre.padEnd(22)} ${String(n).padStart(9)} ${t.filtro ? `(filtro: ${t.filtro})` : "(íntegra)"}`);
    } catch (e) {
      conteos[t.nombre] = "NO_EXISTE";
      console.log(`  ${t.nombre.padEnd(22)} NO_EXISTE (${e.message.slice(0, 60)})`);
    }
  }
  writeFileSync("scripts/migracion-v5-conteos-origen.json", JSON.stringify(conteos, null, 2));
  console.log("\n✔ Conteos guardados: scripts/migracion-v5-conteos-origen.json");
  const total = TABLAS.reduce((s, t) => s + (typeof conteos[t.nombre] === "object" ? conteos[t.nombre].a_migrar : 0), 0);
  console.log(`\nTOTAL filas a copiar: ~${total} (con LOTE=${LOTE}: ~${Math.ceil(total / LOTE)} escrituras remotas)`);
}

// ─── EJECUTAR ───────────────────────────────────────────────────────────────

function cargarProgreso() {
  if (existsSync(PROGRESO_FILE) && !RECREAR) {
    return JSON.parse(readFileSync(PROGRESO_FILE, "utf-8"));
  }
  return { esquema_creado: false, tablas: {} };
}
function guardarProgreso(p) {
  writeFileSync(PROGRESO_FILE, JSON.stringify(p, null, 2));
}

async function crearEsquema(o, d, progreso) {
  const ddl = readFileSync("scripts/migracion-v5-esquema.sql", "utf-8");
  const statements = ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (RECREAR) {
    console.log("--recrear: borrando tablas previas en destino...");
    const nombres = TABLAS.map((t) => t.nombre);
    const drops = nombres
      .slice()
      .reverse()
      .map((n) => ({ sql: `DROP TABLE IF EXISTS "${n}"`, args: [] }));
    // Índices sueltos también, por si quedan huérfanos
    for (const s of statements) {
      const m = s.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)
        || s.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(\w+)/i);
      if (m) drops.push({ sql: `DROP INDEX IF EXISTS "${m[1]}"`, args: [] });
    }
    await d.batch(drops, "write");
  }
  console.log(`Ejecutando ${statements.length} sentencias DDL en BD nueva...`);
  // En tandas para no pasarnos del tamaño de batch
  for (let i = 0; i < statements.length; i += 40) {
    await d.batch(statements.slice(i, i + 40).map((sql) => ({ sql, args: [] })), "write");
  }
  console.log("✔ Esquema creado (idéntico al origen).");
  progreso.esquema_creado = true;
  guardarProgreso(progreso);
}

async function migrarTabla(o, d, tabla, progreso) {
  const nombre = tabla.nombre;
  if (progreso.tablas[nombre]?.completada) {
    console.log(`= ${nombre}: ya migrada (${progreso.tablas[nombre].filas} filas), salto`);
    return;
  }
  const where = tabla.filtro ? ` WHERE ${tabla.filtro}` : "";
  const totalR = await o.execute(`SELECT COUNT(*) n FROM ${nombre}${where}`);
  const total = Number(totalR.rows[0].n);
  const desdeFila = progreso.tablas[nombre]?.fila || 0;
  if (desdeFila > 0) console.log(`→ ${nombre}: reanudando desde fila ${desdeFila}/${total}`);

  // Columnas (una vez)
  const colsR = await o.execute(`SELECT * FROM ${nombre}${where} LIMIT 1`);
  const columnas = colsR.columns;
  const colSql = columnas.map((c) => `"${c}"`).join(", ");
  const placeholderFila = `(${columnas.map(() => "?").join(", ")})`;

  let fila = 0;
  let escritas = 0;
  while (fila < total) {
    const r = await o.execute(`SELECT * FROM ${nombre}${where} LIMIT ${LOTE} OFFSET ${fila}`);
    if (r.rows.length === 0) break;
    const valuesSql = r.rows.map(() => placeholderFila).join(", ");
    const args = r.rows.flatMap((row) => columnas.map((c) => row[c]));
    await d.execute({
      sql: `INSERT OR REPLACE INTO "${nombre}" (${colSql}) VALUES ${valuesSql}`,
      args,
    });
    fila += r.rows.length;
    escritas += r.rows.length;
    progreso.tablas[nombre] = { fila, escritas };
    guardarProgreso(progreso);
  }
  progreso.tablas[nombre] = { fila: total, escritas, completada: true };
  guardarProgreso(progreso);
  console.log(`✔ ${nombre}: ${escritas} filas subidas${tabla.filtro ? " (retención aplicada)" : ""}`);
}

async function verificar(o, d) {
  const conteos = JSON.parse(readFileSync("scripts/migracion-v5-conteos-origen.json", "utf-8"));
  console.log("\n== VERIFICACIÓN (destino vs origen-tras-retención) ==");
  let ok = true;
  for (const t of TABLAS) {
    let esperado = null;
    try {
      if (typeof conteos[t.nombre] === "object") {
        // Recuento fresco del origen (los datos pueden haber avanzado un día)
        const r = await o.execute(
          t.filtro
            ? `SELECT COUNT(*) n FROM ${t.nombre} WHERE ${t.filtro}`
            : `SELECT COUNT(*) n FROM ${t.nombre}`
        );
        esperado = Number(r.rows[0].n);
      }
    } catch { esperado = null; }
    if (esperado === null) {
      console.log(`  ${t.nombre.padEnd(22)} (no existe en origen, se omite)`);
      continue;
    }
    const r = await d.execute(`SELECT COUNT(*) n FROM ${t.nombre}`);
    const n = Number(r.rows[0].n);
    // Margen del 1% por ingesta nueva durante la copia
    const match = Math.abs(n - esperado) <= Math.ceil(esperado * 0.01);
    if (!match) ok = false;
    console.log(`  ${t.nombre.padEnd(22)} destino=${String(n).padStart(9)}  origen=${String(esperado).padStart(9)} ${match ? "✔" : "✗ MISMATCH"}`);
  }
  console.log(ok ? "\n✔ MIGRACIÓN V5 COMPLETADA Y VERIFICADA" : "\n✗ HAY DISCREPANCIAS — revisar");
  return ok;
}

async function ejecutar() {
  validarCredenciales();
  const o = origen();
  const d = destino();
  const progreso = cargarProgreso();

  console.log(`ORIGEN : ${ORIGEN_URL} (SOLO LECTURA)`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);

  if (!progreso.esquema_creado || RECREAR) {
    // Re-exportar esquema por si el origen cambió
    const objs = await o.execute(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`
    );
    writeFileSync(
      "scripts/migracion-v5-esquema.sql",
      objs.rows.map((r) => `${r.sql};`).join("\n\n")
    );
    await crearEsquema(o, d, progreso);
  } else {
    console.log("= Esquema ya creado, salto");
  }

  if (!SOLO_ESQUEMA) {
    for (const t of TABLAS) {
      try {
        await migrarTabla(o, d, t, progreso);
      } catch (e) {
        console.error(`✗ ERROR en ${t.nombre}: ${e.message}`);
        console.error("  (reanuda con el mismo comando: continúa donde quedó)");
        process.exit(1);
      }
    }
  }

  await verificar(o, d);
}

if (MODO === "plan") {
  plan().catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
} else {
  ejecutar().catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  });
}
