/**
 * Migración v7 — copia COMPLETA y LINEAL a una cuenta Turso nueva.
 *
 * ── Qué arregla respecto a v4/v5/v6 (que bloquearon la cuenta) ─────────────
 *
 * 1. PAGINACIÓN POR KEYSET, no por OFFSET.
 *    v5/v6 hacían `SELECT * FROM t LIMIT 1000 OFFSET n`: SQLite re-escanea
 *    desde el principio en cada página, así que copiar 2,8M filas costaba
 *    ~1.100 MILLONES de filas leídas por ejecución (el 100% de la cuota de
 *    lecturas de Turso Free).
 *    Aquí: `WHERE rowid > ? ORDER BY rowid LIMIT n` → cada fila se lee UNA
 *    vez: ~2,8M lecturas en total (0,6% de la cuota).
 *
 * 2. LOS ÍNDICES SE CREAN AL FINAL. Turso cuenta CREATE INDEX como lecturas
 *    (1 por fila), no como escrituras. Cargar sin índices secundarios deja
 *    las escrituras en ~1 por fila.
 *
 * 3. ESQUEMA FINAL, no el heredado. No se copian los índices redundantes de
 *    la BD vieja (`idx_precios_fecha` y `idx_precios_producto` los cubre
 *    `idx_precios_producto_fecha`): menos espacio y menos escrituras por fila
 *    (cada índice se mantiene en cada INSERT).
 *
 * 4. LA FUENTE PUEDE SER LOCAL. Leer el fichero SQLite local NO CONSUME
 *    CUOTA (la cuota se gasta en la BD remota). Con `--fuente local` la
 *    copia solo cuesta las ESCRITURAS de destino.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *
 *   # 1. Ver qué se va a copiar y cuánto cuesta (no escribe nada)
 *   DEST_URL='libsql://nueva...' DEST_TOKEN='eyJ...' \
 *     node scripts/migrar-turso-v7.mjs --plan
 *
 *   # 2. Copiar (reanudable: repite el mismo comando si se corta)
 *   DEST_URL='...' DEST_TOKEN='...' node scripts/migrar-turso-v7.mjs --ejecutar
 *
 *   # Fuente remota (si esa cuenta aún puede leer) en vez del fichero local
 *   SRC_URL='libsql://vieja...' SRC_TOKEN='...' ... --fuente turso
 *
 *   # Solo unas tablas (para repartir la cuota en varios días)
 *   ... --ejecutar --tablas=precios,precios_historico
 *
 *   # Empezar de cero en el destino
 *   ... --ejecutar --recrear
 *
 * Orden recomendado en cuota libre (10M escrituras/mes): la copia completa
 * son ~2,9M escrituras (29%). Si se prefiere ir por partes: primero
 * `--tablas=ccaa,provincias,municipios,productos,estaciones,precios`
 * (la web queda operativa con datos actuales) y después las tablas de
 * histórico.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

// ─── Configuración ──────────────────────────────────────────────────────────

const MODO = process.argv.includes("--ejecutar") ? "ejecutar" : "plan";
const RECREAR = process.argv.includes("--recrear");
const FUENTE = (process.argv.find((a) => a.startsWith("--fuente="))?.split("=")[1]) ||
  (process.argv.includes("--fuente") ? process.argv[process.argv.indexOf("--fuente") + 1] : "local");
const LOTE = Number(process.env.LOTE_FILAS || 500);
const PROGRESO_FILE = "scripts/migracion-v7-progreso.json";
const SOLO_TABLAS = process.argv
  .filter((a) => a.startsWith("--tablas="))
  .flatMap((a) => a.slice("--tablas=".length).split(","))
  .map((s) => s.trim())
  .filter(Boolean);

/** Días de ventana diaria que se copian (política: 30 días diarios). */
const RETENCION_DIAS_HISTORICO = 30;
const RETENCION_DIAS_GEO = 30;

/** Mismo esquema de retención que src/lib/db/mantenimiento.ts. */
function corteDias(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const DESTINO_URL = process.env.DEST_URL;
const DESTINO_TOKEN = process.env.DEST_TOKEN;
const LOCAL_DB = process.env.LOCAL_DB || "./data/combustible.db";

/** Hosts de las BDs antiguas: PROHIBIDO escribir en ellas. */
const HOSTS_PROHIBIDOS = [
  "fueltrack-valdemokoo",
  "combustible-webssssss",
  "gasofa-proyectoss",
  "combustible-final",
];

// ─── Tablas y filtros ───────────────────────────────────────────────────────

/** `filtro` = recorte por política de retención (null = íntegra). */
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
  { nombre: "hist_geo_semana", filtro: null },
].filter((t) => SOLO_TABLAS.length === 0 || SOLO_TABLAS.includes(t.nombre));

/**
 * DDL de las tablas que pueden faltar en la fuente.
 * (La BD local compactada no tiene las tablas creadas por la app.)
 */
const DDL_EXTRA = [
  `CREATE TABLE IF NOT EXISTS cron_progreso (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provincia_idx INTEGER NOT NULL DEFAULT 0,
    fecha TEXT,
    actualizado_en TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS resumen_nacional (
    producto_id INTEGER PRIMARY KEY,
    precio_medio REAL NOT NULL,
    precio_min REAL NOT NULL,
    precio_max REAL NOT NULL,
    total_estaciones INTEGER NOT NULL,
    fecha TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hist_geo_semana (
    ambito TEXT NOT NULL,
    geo_id TEXT NOT NULL,
    producto_id INTEGER NOT NULL,
    semana TEXT NOT NULL,
    precio_medio REAL NOT NULL,
    n_estaciones INTEGER NOT NULL,
    PRIMARY KEY (ambito, geo_id, producto_id, semana)
  )`,
];

/**
 * Índices que SÍ se crean (al final, sobre datos ya cargados).
 * NO se crean `precios(fecha_observacion)` ni `precios(producto_id)`:
 * `precios(producto_id, fecha_observacion)` cubre las dos consultas por
 * prefijo y ahorra un índice por fila en la tabla que más se escribe.
 */
const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_estaciones_ccaa ON estaciones(ccaa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_lat_lon ON estaciones(latitud, longitud)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_municipio ON estaciones(municipio_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_provincia ON estaciones(provincia_id)`,
  `CREATE INDEX IF NOT EXISTS idx_municipios_provincia ON municipios(provincia_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provincias_ccaa ON provincias(ccaa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_producto_fecha ON precios(producto_id, fecha_observacion)`,
  `CREATE INDEX IF NOT EXISTS idx_hist_fecha ON precios_historico(fecha)`,
  `CREATE INDEX IF NOT EXISTS idx_hist_geo_fecha ON hist_geo_dia(fecha)`,
  `CREATE INDEX IF NOT EXISTS idx_hist_geo_semana ON hist_geo_semana(semana)`,
];

// ─── Validación ─────────────────────────────────────────────────────────────

function validar() {
  if (!DESTINO_URL || !DESTINO_TOKEN) {
    console.error("Faltan DEST_URL / DEST_TOKEN (credenciales de la BD NUEVA).");
    process.exit(1);
  }
  const prohibido = HOSTS_PROHIBIDOS.find((h) => DESTINO_URL.includes(h));
  if (prohibido) {
    console.error(`ABORTADO: el destino es una BD antigua (${prohibido}).`);
    process.exit(1);
  }
  if (FUENTE === "turso") {
    const src = process.env.SRC_URL;
    if (!src) {
      console.error("Faltan SRC_URL / SRC_TOKEN para --fuente turso.");
      process.exit(1);
    }
    if (src === DESTINO_URL) {
      console.error("ABORTADO: origen y destino son la misma BD.");
      process.exit(1);
    }
  }
}

// ─── Adaptadores de fuente (misma interfaz para local y Turso) ──────────────

async function abrirFuente() {
  if (FUENTE === "turso") {
    const { createClient: cc } = await import("@libsql/client");
    const c = cc({
      url: process.env.SRC_URL,
      authToken: process.env.SRC_TOKEN,
    });
    return {
      descripcion: `Turso ${process.env.SRC_URL}`,
      async ejecutar(sql, args = []) {
        const r = await c.execute({ sql, args });
        return { rows: r.rows, columns: (r.columns || []).map(String) };
      },
      cerrar() {},
    };
  }
  const Database = (await import("better-sqlite3")).default;
  const d = new Database(LOCAL_DB, { readonly: true });
  return {
    descripcion: `fichero local ${LOCAL_DB} (0 lecturas de cuota)`,
    async ejecutar(sql, args = []) {
      const rows = d.prepare(sql).all(...args);
      return { rows, columns: rows.length ? Object.keys(rows[0]) : [] };
    },
    cerrar() {
      d.close();
    },
  };
}

const dest = () => createClient({ url: DESTINO_URL, authToken: DESTINO_TOKEN });

// ─── Plan ───────────────────────────────────────────────────────────────────

async function plan() {
  validar();
  const f = await abrirFuente();
  console.log(`ORIGEN : ${f.descripcion}`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);

  console.log("== FILAS A COPIAR (con recorte de retención) ==");
  let total = 0;
  for (const t of TABLAS) {
    try {
      const r = await f.ejecutar(
        t.filtro
          ? `SELECT COUNT(*) AS n FROM "${t.nombre}" WHERE ${t.filtro}`
          : `SELECT COUNT(*) AS n FROM "${t.nombre}"`
      );
      const n = Number(r.rows[0].n ?? 0);
      total += n;
      console.log(
        `  ${t.nombre.padEnd(22)} ${String(n).padStart(9)}${t.filtro ? "  (ventana)" : ""}`
      );
    } catch (e) {
      console.log(`  ${t.nombre.padEnd(22)} ${"no existe".padStart(9)}  (se omite)`);
    }
  }
  f.cerrar();

  console.log(`\nTOTAL filas: ~${total.toLocaleString("es-ES")}`);
  console.log("Coste estimado en la cuenta NUEVA:");
  console.log(
    `  · escrituras: ~${total.toLocaleString("es-ES")} (${((total / 1e7) * 100).toFixed(1)} % de 10M)`
  );
  console.log(
    `  · lecturas:   ~${(total + total).toLocaleString("es-ES")} (copia + creación de índices, ${(((total + total) / 5e8) * 100).toFixed(1)} % de 500M)`
  );
  console.log("\nSin --ejecutar no se escribe nada.");
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

function cargarProgreso() {
  if (existsSync(PROGRESO_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESO_FILE, "utf-8"));
    } catch {
      /* progreso corrupto: empezar de nuevo */
    }
  }
  return { esquema_creado: false, indices_creados: false, tablas: {} };
}
const guardarProgreso = (p) => writeFileSync(PROGRESO_FILE, JSON.stringify(p, null, 2));

/**
 * Quita las claves foráneas del DDL.
 *
 * El esquema del fichero local las declara (`municipio_id TEXT REFERENCES
 * municipios(id)`), pero la BD de producción en Turso NO las tiene y libSQL
 * las hace cumplir al insertar. Mantenerlas impediría cargar estaciones cuyo
 * municipio no está en el catálogo (caso real: el municipio 1927) y haría
 * fallar la ingesta diaria por un dato externo.
 */
function sinClavesForaneas(ddl) {
  return ddl
    .replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)/gi, "")
    .replace(/,?\s*FOREIGN KEY\s*\([^)]*\)\s*REFERENCES\s+"?\w+"?\s*\([^)]*\)/gi, "");
}

/** DDL de las tablas del origen (sin índices ni FKs) + las tablas que falten. */
async function crearEsquema(f, d) {
  const objs = await f.ejecutar(
    `SELECT type, name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`
  );
  const tablas = [];
  for (const r of objs.rows) {
    if (String(r.type) === "table") tablas.push(`${sinClavesForaneas(String(r.sql))};`);
  }
  const faltantes = [];
  const nombres = tablas.map((s) => s.match(/CREATE TABLE\s+"?(\w+)/i)?.[1]).filter(Boolean);
  for (const tabla of TABLAS) {
    if (!nombres.includes(tabla.nombre)) faltantes.push(tabla.nombre);
  }
  if (RECREAR) {
    console.log("Borrando tablas existentes del destino (--recrear)...");
    const existentes = await d.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    const todas = [...new Set([...nombres, ...faltantes, ...existentes.rows.map((r) => String(r.name))])];
    // Hijas primero: con claves foráneas activas, una tabla "padre" solo se
    // puede borrar cuando ya no la referencia ninguna "hija". Varias pasadas
    // para tolerar el retardo de propagación de Turso.
    const ORDEN_HIJAS = [
      "precios_historico", "precios", "hist_estacion_mes", "hist_mun_mes",
      "hist_prov_mes", "hist_ccaa_mes", "hist_geo_semana", "hist_geo_dia",
      "hist_nac_dia", "hist_meses_procesados", "resumen_nacional",
      "cron_progreso", "estaciones", "municipios", "provincias", "ccaa", "productos",
    ];
    todas.sort((a, b) => {
      const ia = ORDEN_HIJAS.indexOf(a);
      const ib = ORDEN_HIJAS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (let pasada = 0; pasada < 3; pasada++) {
      for (const t of todas) {
        try {
          await d.execute(`DROP TABLE IF EXISTS "${t}"`);
        } catch {
          /* se reintenta en la segunda pasada */
        }
      }
    }
    const restantes = await d.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    if (restantes.rows.length > 0) {
      console.error(
        `ABORTADO: no se pudieron borrar ${restantes.rows.length} tablas (${restantes.rows
          .map((r) => String(r.name))
          .slice(0, 6)
          .join(", ")}...). Borra la BD y créala vacía.`
      );
      process.exit(1);
    }
    console.log("✔ Destino vacío.");
  }

  const sentencias = [...tablas];
  for (const ddl of DDL_EXTRA) sentencias.push(`${ddl};`);
  console.log(`Creando ${sentencias.length} tablas (SIN índices secundarios)...`);
  for (let i = 0; i < sentencias.length; i += 30) {
    const lote = sentencias
      .slice(i, i + 30)
      .map((s) => s.trim().replace(/;$/, ""))
      .filter(Boolean);
    await d.batch(lote.map((sql) => ({ sql, args: [] })), "write");
  }
  console.log("✔ Tablas creadas.");
  if (faltantes.length) console.log(`  (añadidas por no existir en la fuente: ${faltantes.join(", ")})`);
}

async function crearIndices(d) {
  console.log(`Creando ${INDICES.length} índices sobre datos ya cargados (cuesta lecturas, no escrituras)...`);
  for (const s of INDICES) {
    try {
      await d.execute(s);
    } catch (e) {
      console.error(`  índice falló: ${String(e.message).slice(0, 120)}`);
    }
  }
  console.log("✔ Índices creados.");
}

/**
 * Copia una tabla con KEYSET (coste lineal): la clave es el rowid, así que
 * cada fila se lee exactamente una vez sea cual sea el tamaño de la tabla.
 */
async function copiarTabla(f, d, tabla, progreso) {
  const nombre = tabla.nombre;
  if (progreso.tablas[nombre]?.completada) {
    console.log(`= ${nombre}: ya copiada, salto`);
    return;
  }
  const where = tabla.filtro ? ` AND ${tabla.filtro}` : "";

  // ¿Existe en la fuente?
  try {
    await f.ejecutar(`SELECT 1 FROM "${nombre}" LIMIT 1`);
  } catch {
    console.log(`- ${nombre}: no existe en la fuente, se omite`);
    progreso.tablas[nombre] = { completada: true, filas: 0 };
    guardarProgreso(progreso);
    return;
  }

  const totalR = await f.ejecutar(
    tabla.filtro
      ? `SELECT COUNT(*) AS n FROM "${nombre}" WHERE ${tabla.filtro}`
      : `SELECT COUNT(*) AS n FROM "${nombre}"`
  );
  const total = Number(totalR.rows[0].n ?? 0);

  // Columnas reales (la primera lectura trae los metadatos).
  const muestra = await f.ejecutar(`SELECT rowid AS _rid, * FROM "${nombre}" LIMIT 1`);
  const columnas = Object.keys(muestra.rows[0] ?? {}).filter((c) => c !== "_rid");
  if (columnas.length === 0) {
    console.log(`- ${nombre}: vacía`);
    progreso.tablas[nombre] = { completada: true, filas: 0 };
    guardarProgreso(progreso);
    return;
  }
  const colSql = columnas.map((c) => `"${c}"`).join(", ");
  const placeholders = `(${columnas.map(() => "?").join(", ")})`;

  let ultimoRowid = progreso.tablas[nombre]?.ultimoRowid ?? 0;
  let copiadas = progreso.tablas[nombre]?.filas ?? 0;
  const inicio = copiadas;

  for (;;) {
    const r = await f.ejecutar(
      `SELECT rowid AS _rid, * FROM "${nombre}"
       WHERE rowid > ?${where}
       ORDER BY rowid
       LIMIT ${LOTE}`,
      [ultimoRowid]
    );
    const filas = r.rows;
    if (filas.length === 0) break;

    const valuesSql = filas.map(() => placeholders).join(", ");
    const args = filas.flatMap((row) => columnas.map((c) => row[c]));
    await d.execute({
      sql: `INSERT OR REPLACE INTO "${nombre}" (${colSql}) VALUES ${valuesSql}`,
      args,
    });

    ultimoRowid = Number(filas[filas.length - 1]._rid);
    copiadas += filas.length;
    progreso.tablas[nombre] = { ultimoRowid, filas: copiadas, total };
    guardarProgreso(progreso);
    if (copiadas % (LOTE * 20) < LOTE) {
      process.stdout.write(`  ${nombre}: ${copiadas}/${total}\r`);
    }
  }

  progreso.tablas[nombre] = { ultimoRowid, filas: copiadas, total, completada: true };
  guardarProgreso(progreso);
  console.log(
    `✔ ${nombre.padEnd(22)} ${String(copiadas).padStart(9)} filas (nuevas ${copiadas - inicio})`
  );
}

async function verificar(f, d) {
  console.log("\n== VERIFICACIÓN (destino vs origen, por tabla) ==");
  let ok = true;
  for (const t of TABLAS) {
    let esperado = 0;
    let existe = true;
    try {
      const r = await f.ejecutar(
        t.filtro
          ? `SELECT COUNT(*) AS n FROM "${t.nombre}" WHERE ${t.filtro}`
          : `SELECT COUNT(*) AS n FROM "${t.nombre}"`
      );
      esperado = Number(r.rows[0].n ?? 0);
    } catch {
      existe = false;
    }
    if (!existe) continue;
    const r2 = await d.execute(`SELECT COUNT(*) AS n FROM "${t.nombre}"`);
    const n = Number(r2.rows[0].n ?? 0);
    const match = n >= esperado;
    if (!match) ok = false;
    console.log(
      `  ${t.nombre.padEnd(22)} destino=${String(n).padStart(9)} origen=${String(esperado).padStart(9)} ${match ? "✔" : "✗ FALTAN FILAS"}`
    );
  }
  return ok;
}

async function ejecutar() {
  validar();
  const f = await abrirFuente();
  const d = dest();
  const progreso = cargarProgreso();

  console.log(`ORIGEN : ${f.descripcion}`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);

  if (!progreso.esquema_creado || RECREAR) {
    await crearEsquema(f, d);
    progreso.esquema_creado = true;
    progreso.tablas = {};
    guardarProgreso(progreso);
  }

  // 1) Datos (sin índices secundarios: escrituras mínimas)
  for (const t of TABLAS) {
    try {
      await copiarTabla(f, d, t, progreso);
    } catch (e) {
      console.error(`✗ ERROR en ${t.nombre}: ${e.message}`);
      console.error("(reanuda con el mismo comando: el progreso está guardado)");
      f.cerrar();
      process.exit(1);
    }
  }

  // 2) Índices (cuestan lecturas, no escrituras)
  if (!progreso.indices_creados || RECREAR) {
    await crearIndices(d);
    progreso.indices_creados = true;
    guardarProgreso(progreso);
  }

  const ok = await verificar(f, d);
  f.cerrar();
  console.log(
    ok
      ? "\n✔ MIGRACIÓN V7 COMPLETADA. Siguiente paso: rellenar los días que falten con\n  node scripts/reconstruir-historicos.mjs --plan"
      : "\n✗ Hay tablas con menos filas de las esperadas."
  );
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
