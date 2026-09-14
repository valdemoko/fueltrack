/**
 * Migración v2 a Turso — dataset reducido optimizado para cuotas.
 *
 * ⚠️ NO EJECUTAR sin leer el informe de cuotas. El script tiene guardas
 * duras: si la estimación no cabe en la cuota declarada, ABORTA sin
 * escribir nada (fase --plan, por defecto, no escribe ni conecta).
 *
 * Qué sube (estimación verificada sobre combustible.db, 2026-09):
 *   ccaa 19 · provincias 52 · municipios 3.539 · productos 30
 *   estaciones 13.129
 *   precios (ACTUALES: 1 fila estación×producto)     ~43.000
 *   precios_historico (32 días)                     ~1.400.000
 *   hist_geo_dia (95 días, mun+prov+ccaa+nac)         ~370.000
 *   hist_nac_dia (728 días, permanente)                ~13.000
 *   hist_mun_mes (24 meses × 4 productos)             ~272.000
 *   hist_prov_mes                                        ~5.200
 *   hist_ccaa_mes                                        ~1.900
 *   hist_estacion_mes (24 meses × 4 productos)        ~856.000
 *   TOTAL filas subidas                              ~2.970.000
 *
 * Cuota consumida (estimación conservadora):
 *   Rows Written: ~3,0M (INSERT multi-row VALUES = filas lógicas)  → 30% de 10M
 *   Rows Read:    ~8M  (probes de PK al insertar, sin reintentos)  →  1,6% de 500M
 *
 * Índices: SOLO los PK. La app no necesita más (todas las consultas van
 * por clave compuesta o por fecha con índice PK). Ahorra ~3M escrituras
 * de creación de índices y ~35% de almacenamiento.
 *
 * Uso:
 *   node scripts/migrar-turso-v2.mjs --plan           # estimación (no conecta)
 *   node scripts/migrar-turso-v2.mjs --ejecutar       # requiere flag explícito
 *   + env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *   + env opcional: CUOTA_ESCRITURA_DISPONIBLE=7000000
 */
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ─── Config ─────────────────────────────────────────────────────────────────

const MODO = process.argv.includes("--ejecutar")
  ? "ejecutar"
  : process.argv.includes("--plan")
    ? "plan"
    : "plan";

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

// Solo el nombre canónico NUEVO: NO acepta el alias TURSO_URL del .env.local
// de la cuenta antigua, para que jamás pueda apuntar a la base vieja por error.
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
/** Host EXACTO de la base antigua (bloqueada). El script se niega a usarla.
 *  OJO: comparación de host exacto, NO prefijo — la base nueva
 *  "fueltrack-valdemokoo" (doble "o") comparte prefijo con la antigua. */
const HOST_ANTIGUO_PROHIBIDO = "fueltrack-valdemoko.aws-eu-west-1.turso.io";

// Cuota mensual Turso Free y margen de seguridad exigido
const CUOTA_ESCRITURA_TOTAL = 10_000_000;
const CUOTA_LECTURA_TOTAL = 500_000_000;
/** Escrituras ya consumidas este mes (dashboard); se puede sobreescribir. */
const ESCRITAS_YA_CONSUMIDAS = Number(
  process.env.CUOTA_ESCRITURA_CONSUMIDA ?? 16_350_000
);
/** Cuota disponible declarada manualmente (override del cálculo anterior). */
const DISPONIBLE_OVERRIDE = process.env.CUOTA_ESCRITURA_DISPONIBLE;
/**
 * Margen de seguridad: no gastar más de esta fracción de lo disponible.
 * Override: CUOTA_FRACCION_MAXIMA (p.ej. 0.6 en cuenta nueva con cuota llena).
 */
const FRACCCION_MAXIMA = Number(process.env.CUOTA_FRACCION_MAXIMA ?? 0.4);

/**
 * Fuente de la migración: la BD ORIGINAL completa (29,8M precios).
 * El dataset reducido se EXTRAE de ella — nunca de una BD ya reducida.
 */
const LOCAL_DB = process.env.LOCAL_DB_ORIGINAL || "./data/combustible-original.db";
const RETENCION_HISTORICO_DIAS = 32;
const RETENCION_GEO_DIAS = 95;
const LOTE_FILAS = 800; // filas por statement multi-VALUES

// ─── Fase 0: PLAN (siempre primero, sin conectar) ──────────────────────────

function contar(sql) {
  const local = new Database(LOCAL_DB, { readonly: true });
  const n = local.prepare(sql).get().n;
  local.close();
  return n;
}

function plan() {
  if (!existsSync(LOCAL_DB)) {
    console.error(`No existe ${LOCAL_DB}`);
    process.exit(1);
  }
  const hoy = contar("SELECT MAX(fecha_observacion) AS n FROM precios").valueOf?.() ??
    new Database(LOCAL_DB, { readonly: true }).prepare("SELECT MAX(fecha_observacion) m FROM precios").get().m;
  console.log(`Fecha de referencia: ${hoy}\n`);

  const conteos = {
    ccaa: 19, provincias: 52, municipios: 3539, productos: 30, estaciones: 13129,
  };
  const local = new Database(LOCAL_DB, { readonly: true });
  const preciosActuales = local
    .prepare("SELECT COUNT(*) n FROM precios")
    .get(); // aún vieja: 30M — pero el dataset nuevo = 1 fila est×prod
  const actuales = local
    .prepare(
      `SELECT COUNT(*) n FROM (
         SELECT estacion_id, producto_id FROM precios GROUP BY 1, 2
       )`
    )
    .get().n;
  const hist = local
    .prepare(
      `SELECT COUNT(*) n FROM precios
       WHERE fecha_observacion >= date('${hoy}', '-${RETENCION_HISTORICO_DIAS} day')
         AND producto_id IN (1,3,4,5)`
    )
    .get().n;
  const geoDia = local
    .prepare(
      `SELECT COUNT(*) n FROM (
         SELECT e.municipio_id, p.producto_id, p.fecha_observacion
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.fecha_observacion >= date('${hoy}', '-${RETENCION_GEO_DIAS} day')
           AND p.precio IS NOT NULL
           AND p.producto_id IN (1,3,4,5)
         GROUP BY 1, 2, 3
       )`
    )
    .get().n;
  const nacDia = local
    .prepare(
      `SELECT COUNT(DISTINCT fecha_observacion || ':' || producto_id) n
       FROM precios`
    )
    .get().n;
  const munMes = local
    .prepare(
      `SELECT COUNT(*) n FROM (
         SELECT e.municipio_id, p.producto_id, substr(p.fecha_observacion,1,7) mes
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL
         GROUP BY 1, 2, 3
       )`
    )
    .get().n;
  const provMes = local
    .prepare(
      `SELECT COUNT(*) n FROM (
         SELECT e.provincia_id, p.producto_id, substr(p.fecha_observacion,1,7) mes
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL
         GROUP BY 1, 2, 3
       )`
    )
    .get().n;
  const ccaaMes = local
    .prepare(
      `SELECT COUNT(*) n FROM (
         SELECT e.ccaa_id, p.producto_id, substr(p.fecha_observacion,1,7) mes
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL
         GROUP BY 1, 2, 3
       )`
    )
    .get().n;
  const estMes = local
    .prepare(
      `SELECT COUNT(*) n FROM (
         SELECT estacion_id, producto_id, substr(fecha_observacion,1,7) mes
         FROM precios
         WHERE precio IS NOT NULL
           AND producto_id IN (1, 3, 4, 5)
         GROUP BY 1, 2, 3
       )`
    )
    .get().n;
  local.close();

  const dataset = {
    "ccaa": conteos.ccaa,
    "provincias": conteos.provincias,
    "municipios": conteos.municipios,
    "productos": conteos.productos,
    "estaciones": conteos.estaciones,
    "precios (actuales)": actuales,
    "precios_historico (32d)": hist,
    "hist_geo_dia (95d)": geoDia,
    "hist_nac_dia": nacDia,
    "hist_mun_mes": munMes,
    "hist_prov_mes": provMes,
    "hist_ccaa_mes": ccaaMes,
    "hist_estacion_mes (4 prod)": estMes,
  };

  let total = 0;
  console.log("=== DATASET A SUBIR ===");
  for (const [k, v] of Object.entries(dataset)) {
    console.log(`  ${k.padEnd(30)} ${v.toLocaleString("es-ES")}`);
    total += v;
  }
  console.log(`  ${"TOTAL".padEnd(30)} ${total.toLocaleString("es-ES")}\n`);

  const escriturasEstimadas = Math.ceil(total * 1.1); // +10% por upserts/conFLICTOS
  const lecturasEstimadas = Math.ceil(total * 2.7); // probes de PK ~2,7 niveles

  const disponible =
    DISPONIBLE_OVERRIDE !== undefined
      ? Number(DISPONIBLE_OVERRIDE)
      : Math.max(0, CUOTA_ESCRITURA_TOTAL - ESCRITAS_YA_CONSUMIDAS);
  const presupuestoMax = Math.floor(disponible * FRACCCION_MAXIMA);

  console.log("=== CUOTA ===");
  console.log(`  Escrituras estimadas:   ${escriturasEstimadas.toLocaleString("es-ES")}`);
  console.log(`  Lecturas estimadas:     ${lecturasEstimadas.toLocaleString("es-ES")}`);
  console.log(`  Disponible declarado:   ${disponible.toLocaleString("es-ES")}`);
  console.log(`  Presupuesto máx (${Math.round(FRACCCION_MAXIMA * 100)}%): ${presupuestoMax.toLocaleString("es-ES")}\n`);

  if (escriturasEstimadas > presupuestoMax) {
    console.error(
      `❌ ABORTADO EN PLAN: la migración (${escriturasEstimadas.toLocaleString("es-ES")}) ` +
        `supera el presupuesto seguro (${presupuestoMax.toLocaleString("es-ES")}).\n` +
        `Opciones: renovar cuota mensual, subir CUOTA_ESCRITURA_DISPONIBLE ` +
        `si el dashboard muestra más margen, o reducir el dataset.\n` +
        `NO se ha conectado a Turso ni escrito nada.`
    );
    process.exit(2);
  }

  console.log("✅ PLAN OK: la migración cabe en el presupuesto seguro.");
  console.log("   Para ejecutar: node scripts/migrar-turso-v2.mjs --ejecutar");
  if (MODO !== "ejecutar") {
    console.log("\n(modo plan: no se ha conectado a Turso)");
    return;
  }
  ejecutar(dataset);
}

// ─── Fase ejecución ─────────────────────────────────────────────────────────

async function ejecutar(dataset) {
  if (!TURSO_URL || !TURSO_TOKEN) {
    console.error("Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (cuenta NUEVA)");
    process.exit(1);
  }
  if (TURSO_URL.replace("libsql://", "").split("/")[0] === HOST_ANTIGUO_PROHIBIDO) {
    console.error("❌ ABORTADO: la URL apunta a la base ANTIGUA (fueltrack-valdemoko).");
    console.error("   Usa la URL de la cuenta NUEVA. No se ha escrito nada.");
    process.exit(3);
  }
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  const local = new Database(LOCAL_DB, { readonly: true });
  const now = () => new Date().toISOString().slice(11, 19);

  /** INSERT multi-row VALUES idempotente con reintentos NO duplicadores. */
  async function subirTabla(tabla, columnas, filas, checkpointKey) {
    // better-sqlite3 .all() devuelve OBJETOS; libSQL exige arrays de args.
    const filasArr = filas.map((f) =>
      Array.isArray(f) ? f : columnas.map((c) => f[c])
    );
    if (filasArr.length === 0) return 0;
    const archivoChk = `scripts/import-progress-v2-${checkpointKey}.json`;
    let desde = 0;
    if (existsSync(archivoChk)) {
      desde = JSON.parse(readFileSync(archivoChk, "utf-8")).fila ?? 0;
      console.log(`  [${now()}]   reanudando ${tabla} desde fila ${desde.toLocaleString("es-ES")}`);
    }
    const placeholders = `(${columnas.map(() => "?").join(",")})`;
    for (let i = desde; i < filasArr.length; i += LOTE_FILAS) {
      const sub = filasArr.slice(i, i + LOTE_FILAS);
      const args = sub.flat();
      // Si un statement falla por timeout, puede haberse confirmado: el
      // checkpoint SOLO avanza tras éxito, y ON CONFLICT DO NOTHING hace
      // que repetir desde el checkpoint jamás duplique filas.
      await conReintentos(() =>
        turso.execute({
          sql: `INSERT OR IGNORE INTO ${tabla} (${columnas.join(",")}) VALUES ${sub
            .map(() => placeholders)
            .join(",")}`,
          args,
        })
      );
      writeFileSync(archivoChk, JSON.stringify({ fila: i + sub.length }));
      if ((i + sub.length) % 100_000 < LOTE_FILAS) {
        console.log(
          `  [${now()}]   ${tabla}: ${(i + sub.length).toLocaleString("es-ES")}/${filasArr.length.toLocaleString("es-ES")}`
        );
      }
    }
    return filasArr.length;
  }

  async function conReintentos(fn, max = 5) {
    for (let i = 1; i <= max; i++) {
      try {
        return await fn();
      } catch (err) {
        const msg = String(err?.message ?? "");
        const recuperable = /timeout|network|socket|502|503|504|ECONN/i.test(msg);
        if (!recuperable || i === max) throw err;
        const espera = Math.min(30_000, 1000 * 2 ** i);
        console.log(`  [${now()}]   ⚠ reintento ${i}/${max}: ${msg.slice(0, 60)} — ${espera / 1000}s`);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }

  function loteDe(query, columnas) {
    // Lee por keyset de rowid en streaming (no carga todo en RAM a la vez:
    // el caller pagina por rangos).
    return local.prepare(query);
  }

  console.log(`[${now()}] Fase 1: esquema (solo tablas + PK, sin índices extra)`);
  const TABLAS = [
    `CREATE TABLE IF NOT EXISTS ccaa (id TEXT PRIMARY KEY, nombre TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS provincias (id TEXT PRIMARY KEY, ccaa_id TEXT NOT NULL REFERENCES ccaa(id), nombre TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS municipios (id TEXT PRIMARY KEY, provincia_id TEXT NOT NULL REFERENCES provincias(id), nombre TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS estaciones (
      id TEXT PRIMARY KEY, municipio_id TEXT NOT NULL REFERENCES municipios(id),
      provincia_id TEXT NOT NULL REFERENCES provincias(id), ccaa_id TEXT NOT NULL REFERENCES ccaa(id),
      rotulo TEXT, direccion TEXT NOT NULL, localidad TEXT NOT NULL, codigo_postal TEXT NOT NULL,
      latitud REAL NOT NULL, longitud REAL NOT NULL, horario TEXT NOT NULL, margen TEXT NOT NULL,
      tipo_venta TEXT NOT NULL, bioetanol_pct REAL NOT NULL DEFAULT 0,
      ester_metilico_pct REAL NOT NULL DEFAULT 0, fecha_actualizacion TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, abreviatura TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS precios (
      estacion_id TEXT NOT NULL, producto_id INTEGER NOT NULL, precio REAL,
      fecha_observacion TEXT NOT NULL,
      PRIMARY KEY (estacion_id, producto_id))`,
    `CREATE TABLE IF NOT EXISTS precios_historico (
      estacion_id TEXT NOT NULL, producto_id INTEGER NOT NULL, fecha TEXT NOT NULL, precio REAL,
      PRIMARY KEY (estacion_id, producto_id, fecha))`,
    `CREATE TABLE IF NOT EXISTS hist_geo_dia (
      ambito TEXT NOT NULL, geo_id TEXT NOT NULL, producto_id INTEGER NOT NULL,
      fecha TEXT NOT NULL, precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL,
      PRIMARY KEY (ambito, geo_id, producto_id, fecha))`,
    `CREATE TABLE IF NOT EXISTS hist_mun_mes (
      municipio_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL,
      precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL,
      PRIMARY KEY (municipio_id, producto_id, mes))`,
    `CREATE TABLE IF NOT EXISTS hist_prov_mes (
      provincia_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL,
      precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL,
      PRIMARY KEY (provincia_id, producto_id, mes))`,
    `CREATE TABLE IF NOT EXISTS hist_ccaa_mes (
      ccaa_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL,
      precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL,
      PRIMARY KEY (ccaa_id, producto_id, mes))`,
    `CREATE TABLE IF NOT EXISTS hist_estacion_mes (
      estacion_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL,
      precio_medio REAL NOT NULL, n_observaciones INTEGER NOT NULL,
      PRIMARY KEY (estacion_id, producto_id, mes))`,
    `CREATE TABLE IF NOT EXISTS hist_nac_dia (
      producto_id INTEGER NOT NULL, fecha TEXT NOT NULL,
      precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL,
      PRIMARY KEY (producto_id, fecha))`,
    `CREATE TABLE IF NOT EXISTS hist_meses_procesados (mes TEXT PRIMARY KEY, procesado_en TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS cron_progreso (
      id INTEGER PRIMARY KEY CHECK (id = 1), provincia_idx INTEGER NOT NULL DEFAULT 0,
      actualizado_en TEXT NOT NULL)`,
  ];
  for (const ddl of TABLAS) await turso.execute(ddl);
  // La BD local contiene 27 estaciones huérfanas de ccaa (ingesta histórica
  // con FK desactivado). Se suben tal cual, sin reescribir datos:
  // FK desactivado durante la carga, como en la migración v1.
  await turso.execute("PRAGMA foreign_keys = OFF");

  console.log(`[${now()}] Fase 2: geografía y estaciones`);
  await subirTabla("ccaa", ["id", "nombre"],
    local.prepare("SELECT id, nombre FROM ccaa").all(), "ccaa");
  await subirTabla("provincias", ["id", "ccaa_id", "nombre"],
    local.prepare("SELECT id, ccaa_id, nombre FROM provincias").all(), "provincias");
  await subirTabla("municipios", ["id", "provincia_id", "nombre"],
    local.prepare("SELECT id, provincia_id, nombre FROM municipios").all(), "municipios");
  await subirTabla("productos", ["id", "nombre", "abreviatura"],
    local.prepare("SELECT id, nombre, abreviatura FROM productos").all(), "productos");
  {
    const columnas = ["id","municipio_id","provincia_id","ccaa_id","rotulo","direccion",
      "localidad","codigo_postal","latitud","longitud","horario","margen","tipo_venta",
      "bioetanol_pct","ester_metilico_pct","fecha_actualizacion"];
    await subirTabla("estaciones", columnas,
      local.prepare(`SELECT ${columnas.join(",")} FROM estaciones`).all(), "estaciones");
  }

  console.log(`[${now()}] Fase 3: precios actuales (1 fila est×prod)`);
  await subirTabla(
    "precios",
    ["estacion_id", "producto_id", "precio", "fecha_observacion"],
    local
      .prepare(
        `SELECT estacion_id, producto_id, precio, MAX(fecha_observacion) AS fecha_observacion
         FROM precios WHERE precio IS NOT NULL
         GROUP BY estacion_id, producto_id`
      )
      .all()
      .map((f) => [f.estacion_id, f.producto_id, f.precio, f.fecha_observacion]),
    "precios"
  );

  console.log(`[${now()}] Fase 4: precios_historico (ventana 32d)`);
  {
    const hoy = local.prepare("SELECT MAX(fecha_observacion) m FROM precios").get().m;
    const filas = local
      .prepare(
        `SELECT estacion_id, producto_id, fecha_observacion, precio FROM precios
         WHERE fecha_observacion >= date(?, '-32 day') AND precio IS NOT NULL
           AND producto_id IN (1,3,4,5)`
      )
      .all(hoy)
      .map((f) => [f.estacion_id, f.producto_id, f.fecha_observacion, f.precio]);
    await subirTabla("precios_historico",
      ["estacion_id", "producto_id", "fecha", "precio"], filas, "hist-det");
  }

  console.log(`[${now()}] Fase 5: agregados (geo_dia, nac_dia, mensuales)`);
  {
    const hoy = local.prepare("SELECT MAX(fecha_observacion) m FROM precios").get().m;

    // hist_geo_dia: 95 días × mun/prov/ccaa/nac
    const geo = local
      .prepare(
        `SELECT 'mun' ambito, e.municipio_id geo_id, p.producto_id, p.fecha_observacion fecha,
                ROUND(AVG(p.precio),4) precio_medio, COUNT(*) n_estaciones
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL
           AND p.producto_id IN (1,3,4,5)
           AND p.fecha_observacion >= date(?, '-95 day')
         GROUP BY 1,2,3,4
         UNION ALL
         SELECT 'prov', e.provincia_id, p.producto_id, p.fecha_observacion,
                ROUND(AVG(p.precio),4), COUNT(*)
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL
           AND p.fecha_observacion >= date(?, '-95 day')
         GROUP BY 1,2,3,4
         UNION ALL
         SELECT 'ccaa', e.ccaa_id, p.producto_id, p.fecha_observacion,
                ROUND(AVG(p.precio),4), COUNT(*)
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL
           AND p.fecha_observacion >= date(?, '-95 day')
         GROUP BY 1,2,3,4
         UNION ALL
         SELECT 'nac', 'ES', p.producto_id, p.fecha_observacion,
                ROUND(AVG(p.precio),4), COUNT(*)
         FROM precios p
         WHERE p.precio IS NOT NULL
           AND p.fecha_observacion >= date(?, '-95 day')
         GROUP BY 1,2,3,4`
      )
      .all(hoy, hoy, hoy, hoy)
      .map((f) => [f.ambito, f.geo_id, f.producto_id, f.fecha, f.precio_medio, f.n_estaciones]);
    await subirTabla("hist_geo_dia",
      ["ambito","geo_id","producto_id","fecha","precio_medio","n_estaciones"], geo, "geo-dia");

    // hist_nac_dia: permanente
    const nac = local
      .prepare(
        `SELECT producto_id, fecha_observacion fecha,
                ROUND(AVG(precio),4) precio_medio, COUNT(*) n_estaciones
         FROM precios WHERE precio IS NOT NULL
         GROUP BY 1,2`
      )
      .all()
      .map((f) => [f.producto_id, f.fecha, f.precio_medio, f.n_estaciones]);
    await subirTabla("hist_nac_dia",
      ["producto_id","fecha","precio_medio","n_estaciones"], nac, "nac-dia");

    // hist_mun_mes / prov_mes / ccaa_mes / estacion_mes
    const mun = local
      .prepare(
        `SELECT e.municipio_id, p.producto_id, substr(p.fecha_observacion,1,7) mes,
                ROUND(AVG(p.precio),4) precio_medio,
                COUNT(DISTINCT p.estacion_id) n_estaciones
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL GROUP BY 1,2,3`
      )
      .all()
      .map((f) => [f.municipio_id, f.producto_id, f.mes, f.precio_medio, f.n_estaciones]);
    await subirTabla("hist_mun_mes",
      ["municipio_id","producto_id","mes","precio_medio","n_estaciones"], mun, "mun-mes");

    const prov = local
      .prepare(
        `SELECT e.provincia_id, p.producto_id, substr(p.fecha_observacion,1,7) mes,
                ROUND(AVG(p.precio),4) precio_medio, COUNT(DISTINCT p.estacion_id) n_estaciones
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL GROUP BY 1,2,3`
      )
      .all()
      .map((f) => [f.provincia_id, f.producto_id, f.mes, f.precio_medio, f.n_estaciones]);
    await subirTabla("hist_prov_mes",
      ["provincia_id","producto_id","mes","precio_medio","n_estaciones"], prov, "prov-mes");

    const ccaa = local
      .prepare(
        `SELECT e.ccaa_id, p.producto_id, substr(p.fecha_observacion,1,7) mes,
                ROUND(AVG(p.precio),4) precio_medio, COUNT(DISTINCT p.estacion_id) n_estaciones
         FROM precios p JOIN estaciones e ON e.id = p.estacion_id
         WHERE p.precio IS NOT NULL GROUP BY 1,2,3`
      )
      .all()
      .map((f) => [f.ccaa_id, f.producto_id, f.mes, f.precio_medio, f.n_estaciones]);
    await subirTabla("hist_ccaa_mes",
      ["ccaa_id","producto_id","mes","precio_medio","n_estaciones"], ccaa, "ccaa-mes");

    const est = local
      .prepare(
        `SELECT estacion_id, producto_id, substr(fecha_observacion,1,7) mes,
                ROUND(AVG(precio),4) precio_medio, COUNT(*) n_observaciones
         FROM precios
         WHERE precio IS NOT NULL AND producto_id IN (1,3,4,5)
         GROUP BY 1,2,3`
      )
      .all()
      .map((f) => [f.estacion_id, f.producto_id, f.mes, f.precio_medio, f.n_observaciones]);
    await subirTabla("hist_estacion_mes",
      ["estacion_id","producto_id","mes","precio_medio","n_observaciones"], est, "est-mes");
  }

  console.log(`[${now()}] ✅ Migración v2 completada.`);
  console.log(`   NOTA: los meses anteriores al mes pasado NO se marcan en
   hist_meses_procesados — el cron los considerará cerrados porque sus
   datos ya existen (ON CONFLICT DO UPDATE es idempotente).`);
  local.close();
}

// ─── Arranque ───────────────────────────────────────────────────────────────

//Nota: `plan()` puede invocar `ejecutar` (async); no await en top-level ESM
// para mantener el modo plan síncrono.
plan();
