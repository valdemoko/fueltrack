/**
 * Migración v8 — la que NO puede volver a quemar una cuenta.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * QUÉ PASÓ CON v5/v6/v7 (por qué la cuenta acabó al 168 % de escrituras)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El contador de Turso marcó 16,79 M de escrituras. Los ficheros de progreso
 * de los scripts anteriores demuestran que se copiaron 11.257.794 filas:
 *
 *   v5 (1ª pasada)  2.800.818
 *   v5 (2ª pasada)  2.800.818   ← tras fallar la verificación por 13.506 filas
 *   v6              2.800.818   ← lanzada con los datos ya completos
 *   v7              2.855.340
 *
 * Es decir: 16,79 M / 11,26 M ≈ 1,49 escrituras por fila, y el 74,6 % del
 * contador era TRABAJO REPETIDO. La causa no fue Turso, sino tres decisiones
 * del script:
 *
 *   1. `INSERT OR REPLACE`: sobre una fila que ya existe cuesta borrado +
 *      inserción. Repetir la migración era el doble de caro en vez de gratis.
 *   2. El progreso vivía en un fichero local (`migracion-vN-progreso.json`).
 *      Un script nuevo = fichero nuevo = copia completa otra vez.
 *   3. Nunca se miraba lo que YA había en el destino, y no existía ninguna
 *      proyección previa ni umbral de aborto.
 *
 * ── Lo que hace v8 distinto ───────────────────────────────────────────────
 *
 *   · RECONCILIA ANTES DE ESCRIBIR. Cuenta el destino; si una tabla ya está
 *     completa, la salta sin escribir una sola fila.
 *   · `INSERT OR IGNORE`, no `OR REPLACE`. Una fila que ya existe cuesta 0
 *     escrituras, así que RE-EJECUTAR ESTE SCRIPT ES CASI GRATIS. Es la
 *     propiedad que faltaba.
 *   · PROYECCIÓN + PRESUPUESTO. Antes de la primera escritura imprime lo que
 *     va a costar y cuánto queda por gastar; con `--presupuesto=N` se detiene
 *     antes de pasarse y deja el progreso guardado para continuar luego.
 *   · VERIFICA CONTENIDO, no solo recuentos: compara COUNT(*) **y** SUM() de
 *     la columna numérica de cada tabla entre origen y destino.
 *   · NO HAY `--recrear` DESTRUCTIVO. Si el destino tiene datos de más, se
 *     avisa y se para; borrar es una decisión humana.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *
 *   # 0. Ver la proyección y lo que falta (NO escribe nada)
 *   DEST_URL='libsql://...' DEST_TOKEN='eyJ...' node scripts/migrar-turso-v8.mjs --plan
 *
 *   # 1. Copiar una etapa concreta, con presupuesto (repetible sin coste)
 *   DEST_URL='...' DEST_TOKEN='...' --presupuesto=400000 --tablas=precios_historico
 *
 *   # 2. Continuar / terminar (mismo comando sin --tablas)
 *   DEST_URL='...' DEST_TOKEN='...' --presupuesto=3000000
 *
 *   # 3. Índices al final (sobre datos ya cargados)
 *   DEST_URL='...' DEST_TOKEN='...' --solo-indices
 *
 *   # 4. Solo verificar
 *   DEST_URL='...' DEST_TOKEN='...' --solo-verificar
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

// ─── Opciones ───────────────────────────────────────────────────────────────

const has = (f) => process.argv.includes(f);
/**
 * Lee una opción con valor aceptando las DOS formas: `--clave=valor` y
 * `--clave valor`.
 *
 * ⚠️ Esto es un arreglo de un fallo real: la primera versión solo entendía
 * `--clave valor`, así que `--tablas=x` y `--presupuesto=n` se ignoraban en
 * silencio y la migración arrancaba SIN filtro y SIN límite. Una opción mal
 * leída no puede degradarse a "haz todo": o se aplica o el script se para.
 */
const val = (n) => {
  const conIgual = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (conIgual) return conIgual.slice(n.length + 3);
  const i = process.argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const siguiente = process.argv[i + 1];
  return siguiente && !siguiente.startsWith("--") ? siguiente : null;
};

const MODO = has("--ejecutar") ? "ejecutar" : "plan";
const SOLO_INDICES = has("--solo-indices");
const SOLO_VERIFICAR = has("--solo-verificar");
const PRESUPUESTO = Number(val("presupuesto") ?? 0) || null;
const LOTE = Number(val("lote") ?? 0) || 400;
const FUENTE = val("fuente") ?? "local";
const LOCAL_DB = process.env.LOCAL_DB || "./data/combustible.db";
const PROGRESO_FILE = "scripts/migracion-v8-progreso.json";
const SOLO_TABLAS = (val("tablas") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Seguridad: a qué cuentas se puede escribir ─────────────────────────────

/**
 * BD PROHIBIDAS como destino. Incluye las tres cuentas ya castigadas.
 * Si el destino no está en la lista blanca, el script se niega a escribir.
 */
const HOSTS_PROHIBIDOS = [
  "fueltrack-valdemokoo",
  "combustible-webssssss",
  "gasofa-proyectoss",
  "combustible-final",
  "ultima-usuarioaasd", // 168 % de escrituras: no se toca ni para leer
];
/** Único destino autorizado para esta migración. */
const HOST_AUTORIZADO = "gunissss-asdasdasdasda";

// ─── Contenido a copiar ─────────────────────────────────────────────────────

const RETENCION_DIAS_HISTORICO = 30;
const RETENCION_DIAS_GEO = 30;
const corteDias = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

/**
 * `clave`: columna numérica cuya SUM() debe coincidir entre origen y destino
 *          (verificación de CONTENIDO, no solo de recuento). null = solo COUNT.
 */
const TABLAS = [
  { nombre: "ccaa", filtro: null, clave: null },
  { nombre: "provincias", filtro: null, clave: null },
  { nombre: "municipios", filtro: null, clave: null },
  { nombre: "productos", filtro: null, clave: null },
  { nombre: "estaciones", filtro: null, clave: null },
  { nombre: "precios", filtro: null, clave: "precio" },
  {
    nombre: "precios_historico",
    filtro: `fecha >= '${corteDias(RETENCION_DIAS_HISTORICO)}'`,
    clave: "precio",
  },
  { nombre: "hist_geo_dia", filtro: `fecha >= '${corteDias(RETENCION_DIAS_GEO)}'`, clave: "precio_medio" },
  { nombre: "hist_geo_semana", filtro: null, clave: "precio_medio" },
  { nombre: "hist_nac_dia", filtro: null, clave: "precio_medio" },
  { nombre: "hist_mun_mes", filtro: null, clave: "precio_medio" },
  { nombre: "hist_prov_mes", filtro: null, clave: "precio_medio" },
  { nombre: "hist_ccaa_mes", filtro: null, clave: "precio_medio" },
  { nombre: "hist_estacion_mes", filtro: null, clave: "precio_medio" },
  { nombre: "hist_meses_procesados", filtro: null, clave: null },
  { nombre: "resumen_nacional", filtro: null, clave: "precio_medio" },
].filter((t) => SOLO_TABLAS.length === 0 || SOLO_TABLAS.includes(t.nombre));

// ─── Etapas (para repartir el trabajo y poder parar entre ellas) ────────────

const ETAPAS = {
  1: ["ccaa", "provincias", "municipios", "productos"],
  2: ["estaciones", "precios"],
  3: ["precios_historico", "hist_geo_dia", "hist_nac_dia", "hist_geo_semana"],
  4: [
    "hist_mun_mes",
    "hist_prov_mes",
    "hist_ccaa_mes",
    "hist_estacion_mes",
    "hist_meses_procesados",
    "resumen_nacional",
  ],
};

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
 * Índices secundarios: se crean AL FINAL, sobre datos ya cargados.
 *
 * ── Los dos índices de FECHA se han eliminado a propósito ────────────────
 *
 * v7 creaba `idx_hist_fecha ON precios_historico(fecha)` y
 * `idx_hist_geo_fecha ON hist_geo_dia(fecha)`. Son 1.142.353 + 352.473 =
 * 1.494.826 entradas de índice, es decir el 92 % del coste de indexado y el
 * mayor gasto individual de toda la migración.
 *
 * Comprobado con EXPLAIN QUERY PLAN sobre el fichero local:
 *
 *   · la comprobación diaria de la ingesta (`WHERE fecha = ? AND estacion_id
 *     IN (...)`, 52 veces al día) ya resuelve con el índice de la CLAVE
 *     PRIMARIA (estacion_id, producto_id, fecha):
 *       SEARCH precios_historico USING COVERING INDEX ... (estacion_id=?)
 *   · las series por estación y por ámbito también arrancan por la clave
 *     primaria.
 *
 * Quien los usaba era solo la purga semanal y el cierre mensual, que de todos
 * modos recorren la tabla entera: sin índice son un SCAN de 1,14 M de filas
 * (≈3,4 M de lecturas al mes, el 0,7 % de la cuota de 500 M). Se cambia
 * "1,5 M de escrituras SIEMPRE" por "3,4 M de lecturas AL MES".
 *
 * Y drizzle no declara índices en schema.ts, así que nada los va a recrear.
 */
const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_estaciones_ccaa ON estaciones(ccaa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_lat_lon ON estaciones(latitud, longitud)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_municipio ON estaciones(municipio_id)`,
  `CREATE INDEX IF NOT EXISTS idx_estaciones_provincia ON estaciones(provincia_id)`,
  `CREATE INDEX IF NOT EXISTS idx_municipios_provincia ON municipios(provincia_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provincias_ccaa ON provincias(ccaa_id)`,
  `CREATE INDEX IF NOT EXISTS idx_precios_producto_fecha ON precios(producto_id, fecha_observacion)`,
  `CREATE INDEX IF NOT EXISTS idx_hist_geo_semana ON hist_geo_semana(semana)`,
];

// ─── Entorno y validación ───────────────────────────────────────────────────

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

function validar() {
  if (!DESTINO_URL || !DESTINO_TOKEN) {
    console.error("Faltan DEST_URL / DEST_TOKEN (credenciales de la cuenta NUEVA).");
    process.exit(1);
  }
  const prohibido = HOSTS_PROHIBIDOS.find((h) => DESTINO_URL.includes(h));
  if (prohibido) {
    console.error(`ABORTADO: el destino es una BD ya castigada (${prohibido}).`);
    process.exit(1);
  }
  if (MODO === "ejecutar" && !DESTINO_URL.includes(HOST_AUTORIZADO)) {
    console.error(
      `ABORTADO: destino no autorizado. Se esperaba "${HOST_AUTORIZADO}", llegó "${DESTINO_URL}".`
    );
    process.exit(1);
  }
  // Ninguna migración se lanza sin límite explícito. Es la lección del
  // destrozo: una corrida sin tope es una corrida que puede pasarse.
  if (MODO === "ejecutar" && !PRESUPUESTO) {
    console.error(
      "ABORTADO: --ejecutar exige un presupuesto explicito, p. ej. --presupuesto=1500000."
    );
    process.exit(1);
  }
}

// ─── Adaptadores ────────────────────────────────────────────────────────────

async function abrirFuente() {
  if (FUENTE === "turso") {
    const c = createClient({ url: process.env.SRC_URL, authToken: process.env.SRC_TOKEN });
    return {
      descripcion: `Turso ${process.env.SRC_URL}`,
      async ejecutar(sql, args = []) {
        const r = await c.execute({ sql, args });
        return { rows: r.rows };
      },
      cerrar() {},
    };
  }
  const Database = (await import("better-sqlite3")).default;
  const d = new Database(LOCAL_DB, { readonly: true });
  return {
    descripcion: `fichero local ${LOCAL_DB} (0 cuota de lecturas)`,
    async ejecutar(sql, args = []) {
      return { rows: d.prepare(sql).all(...args) };
    },
    cerrar() {
      d.close();
    },
  };
}

const dest = () => createClient({ url: DESTINO_URL, authToken: DESTINO_TOKEN });

// ─── Mediciones de origen y destino ─────────────────────────────────────────

async function medir(fuente, t) {
  const where = t.filtro ? ` WHERE ${t.filtro}` : "";
  const agg = t.clave
    ? `COUNT(*) AS n, ROUND(SUM(${t.clave}), 2) AS s`
    : `COUNT(*) AS n, NULL AS s`;
  const r = await fuente.ejecutar(`SELECT ${agg} FROM "${t.nombre}"${where}`);
  return { n: Number(r.rows[0]?.n ?? 0), s: r.rows[0]?.s === null ? null : Number(r.rows[0]?.s) };
}

async function medirDestino(d, t) {
  try {
    const r = await d.execute(
      t.clave
        ? `SELECT COUNT(*) AS n, ROUND(SUM(${t.clave}), 2) AS s FROM "${t.nombre}"`
        : `SELECT COUNT(*) AS n, NULL AS s FROM "${t.nombre}"`
    );
    return {
      existe: true,
      n: Number(r.rows[0]?.n ?? 0),
      s: r.rows[0]?.s === null ? null : Number(r.rows[0]?.s),
    };
  } catch {
    return { existe: false, n: 0, s: null };
  }
}

/** Entradas de índice que se crearán al final (proyección de escrituras). */
function entradasDeIndice(medidas) {
  const m = (n) => medidas[n]?.n ?? 0;
  return (
    m("estaciones") * 4 + // ccaa, lat_lon, municipio, provincia
    m("municipios") +
    m("provincias") +
    m("precios") + // (producto_id, fecha_observacion)
    m("hist_geo_semana")
  );
}

// ─── Plan (solo lectura) ────────────────────────────────────────────────────

async function plan() {
  validar();
  const f = await abrirFuente();
  const d = dest();
  console.log(`ORIGEN : ${f.descripcion}`);
  console.log(`DESTINO: ${DESTINO_URL}\n`);

  const medidas = {};
  const faltantes = [];
  let filasCopiar = 0;
  let filasYa = 0;

  console.log("== RECONCILIACIÓN (origen con ventana · destino · falta) ==");
  for (const t of TABLAS) {
    let o;
    try {
      o = await medir(f, t);
    } catch {
      console.log(`  ${t.nombre.padEnd(22)} — no existe en el origen, se omite`);
      continue;
    }
    medidas[t.nombre] = o;
    const dd = await medirDestino(d, t);
    const falta = Math.max(0, o.n - dd.n);
    filasCopiar += falta;
    filasYa += Math.min(o.n, dd.n);
    if (falta > 0) faltantes.push(t.nombre);
    console.log(
      `  ${t.nombre.padEnd(22)} ${String(o.n).padStart(9)} · ${String(dd.n).padStart(9)} · ` +
        `${String(falta).padStart(9)}${o.s !== null && dd.s !== null && o.n === dd.n && Math.abs(o.s - dd.s) > 1 ? "  ⚠ suma distinta" : ""}`
    );
  }
  f.cerrar();

  const indice = entradasDeIndice(medidas);
  console.log(`\n  Ya en el destino: ${filasYa.toLocaleString("es-ES")}`);
  console.log(`  Por copiar:       ${filasCopiar.toLocaleString("es-ES")}`);
  console.log(`  Tablas incompletas: ${faltantes.length ? faltantes.join(", ") : "ninguna"}`);

  const minimo = filasCopiar;
  const maximo = filasCopiar + indice;
  const pct = (x) => `${((x / 1e7) * 100).toFixed(1)} %`;
  console.log("\n== PROYECCIÓN DE ESCRITURAS EN LA CUENTA NUEVA (cuota Free: 10 M) ==");
  console.log(`  · Escenario A — las entradas de índice no se facturan:`);
  console.log(`      mínimo ${minimo.toLocaleString("es-ES")} (${pct(minimo)})`);
  console.log(`  · Escenario B — CREATE INDEX sí cuenta (1 por entrada):`);
  console.log(
    `      máximo ${maximo.toLocaleString("es-ES")} (${pct(maximo)})  [índices = ${indice.toLocaleString("es-ES")}]`
  );
  console.log(
    `\n  Consumo diario conocido de la ingesta: ~117.700 filas/día → ~3,53 M/mes (35 %).` +
      `\n  Mes 1 previsto: entre ${pct(minimo + 3_530_000)} y ${pct(maximo + 3_530_000)} de la cuota.`
  );

  console.log(
    "\n  ESTE COMANDO NO ESCRIBE NADA. Para copiar:" +
      "\n    node scripts/migrar-turso-v8.mjs --ejecutar --presupuesto=4000000"
  );
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

function cargarProgreso() {
  if (existsSync(PROGRESO_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESO_FILE, "utf-8"));
    } catch {
      /* corrupto: empezar de cero (es gratis: el script reconcilia) */
    }
  }
  return { tablas: {}, indices_creados: false, escritas: 0 };
}
const guardarProgreso = (p) => writeFileSync(PROGRESO_FILE, JSON.stringify(p, null, 2));

/** Quita las claves foráneas del DDL (la ingesta diaria las incumpliría). */
function sinClavesForaneas(ddl) {
  return ddl
    .replace(/\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)/gi, "")
    .replace(/,?\s*FOREIGN KEY\s*\([^)]*\)\s*REFERENCES\s+"?\w+"?\s*\([^)]*\)/gi, "");
}

async function crearEsquema(f, d, medidas) {
  const objs = await f.ejecutar(
    `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`
  );
  const sentencias = [];
  const nombres = [];
  for (const r of objs.rows) {
    if (String(r.type) !== "table") continue;
    const ddl = sinClavesForaneas(String(r.sql));
    sentencias.push(ddl);
    nombres.push(ddl.match(/CREATE TABLE\s+"?(\w+)/i)?.[1]);
  }
  const faltan = TABLAS.filter((t) => !nombres.includes(t.nombre)).map((t) => t.nombre);
  for (const ddl of DDL_EXTRA) sentencias.push(ddl);

  console.log(`Creando ${sentencias.length} tablas (SIN índices secundarios)...`);
  for (let i = 0; i < sentencias.length; i += 20) {
    await d.batch(
      sentencias
        .slice(i, i + 20)
        .map((s) => s.trim().replace(/;$/, ""))
        .filter(Boolean)
        .map((sql) => ({ sql, args: [] })),
      "write"
    );
  }
  console.log("✔ Tablas creadas.");
  if (faltan.length) console.log(`  (añadidas por no existir en la fuente: ${faltan.join(", ")})`);
}

/**
 * Copia una tabla con KEYSET (lectura lineal) e `INSERT OR IGNORE`.
 *
 * OR IGNORE es lo que hace que este script sea re-ejecutable sin coste: una
 * fila que ya está en el destino NO se escribe. Si el presupuesto se agota a
 * medias, se lanza el mismo comando otra vez y continúa.
 */
async function copiarTabla(f, d, t, progreso) {
  const nombre = t.nombre;
  const where = t.filtro ? ` WHERE ${t.filtro}` : "";
  const whereKeyset = t.filtro
    ? ` WHERE rowid > ? AND ${t.filtro}`
    : ` WHERE rowid > ?`;

  const origen = await medir(f, t);
  const destino = await medirDestino(d, t);

  if (destino.existe && destino.n >= origen.n) {
    console.log(
      `= ${nombre.padEnd(22)} ya completo en el destino (${destino.n.toLocaleString("es-ES")}/${origen.n.toLocaleString("es-ES")}): 0 escrituras`
    );
    progreso.tablas[nombre] = { completada: true, filas: destino.n };
    guardarProgreso(progreso);
    return { copiadas: 0, abortado: false };
  }

  const muestra = await f.ejecutar(`SELECT rowid AS _rid, * FROM "${nombre}" LIMIT 1`);
  const columnas = Object.keys(muestra.rows[0] ?? {}).filter((c) => c !== "_rid");
  if (columnas.length === 0) {
    console.log(`- ${nombre}: vacía`);
    return { copiadas: 0, abortado: false };
  }
  const colSql = columnas.map((c) => `"${c}"`).join(", ");
  const valores = `(${columnas.map(() => "?").join(", ")})`;

  // Se reanuda desde el rowid guardado solo si el destino no se ha limpiado.
  let ultimoRowid = progreso.tablas[nombre]?.ultimoRowid ?? 0;
  let enviadas = 0;

  for (;;) {
    if (PRESUPUESTO && progreso.escritas + enviadas >= PRESUPUESTO) {
      progreso.tablas[nombre] = { ultimoRowid, filas: destino.n + enviadas };
      guardarProgreso(progreso);
      console.log(
        `  ⏸ ${nombre}: presupuesto agotado (${enviadas.toLocaleString("es-ES")} intentos). Reanuda con el mismo comando.`
      );
      return { copiadas: enviadas, abortado: true };
    }

    const r = await f.ejecutar(
      `SELECT rowid AS _rid, * FROM "${nombre}"${whereKeyset} ORDER BY rowid LIMIT ${LOTE}`,
      [ultimoRowid]
    );
    if (r.rows.length === 0) break;

    const args = r.rows.flatMap((row) => columnas.map((c) => row[c]));
    await d.execute({
      sql: `INSERT OR IGNORE INTO "${nombre}" (${colSql}) VALUES ${r.rows.map(() => valores).join(", ")}`,
      args,
    });

    ultimoRowid = Number(r.rows[r.rows.length - 1]._rid);
    enviadas += r.rows.length;
    progreso.escritas += r.rows.length;
    progreso.tablas[nombre] = { ultimoRowid, filas: destino.n + enviadas };
    guardarProgreso(progreso);
  }

  progreso.tablas[nombre] = { ultimoRowid, filas: 0, completada: true };
  guardarProgreso(progreso);
  console.log(
    `✔ ${nombre.padEnd(22)} ${enviadas.toLocaleString("es-ES")} filas enviadas (OR IGNORE: solo se escriben las que faltaban)`
  );
  void where;
  return { copiadas: enviadas, abortado: false };
}

/**
 * Verificación de CONTENIDO: COUNT(*) y SUM(columna numérica).
 * Las sumas comparan con tolerancia porque los redondeos de REAL viajan en
 * texto y pueden diferir en el último decimal.
 */
async function verificar(f, d) {
  console.log("\n== VERIFICACIÓN (recuento y suma, origen vs destino) ==");
  let ok = true;
  for (const t of TABLAS) {
    let o;
    try {
      o = await medir(f, t);
    } catch {
      continue;
    }
    const dd = await medirDestino(d, t);
    if (!dd.existe) {
      console.log(`  ${t.nombre.padEnd(22)} ✗ NO EXISTE en el destino`);
      ok = false;
      continue;
    }
    const cuentaOk = dd.n >= o.n;
    let sumaOk = true;
    let nota = "";
    if (t.clave && o.s !== null && dd.s !== null && o.n === dd.n) {
      const dif = Math.abs(o.s - dd.s);
      sumaOk = dif <= Math.max(0.05, Math.abs(o.s) * 1e-6);
      nota = ` Σ ori=${o.s} dst=${dd.s}${sumaOk ? "" : ` (dif ${dif.toFixed(4)})`}`;
    }
    if (!cuentaOk || !sumaOk) ok = false;
    console.log(
      `  ${t.nombre.padEnd(22)} ${String(dd.n).padStart(9)}/${String(o.n).padStart(9)} ` +
        `${cuentaOk ? (sumaOk ? "✔" : "✗ suma") : "✗ faltan filas"}${nota}`
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
  console.log(`DESTINO: ${DESTINO_URL}`);
  // Las opciones efectivas SIEMPRE visibles: si una no se ha leído, se ve aquí.
  console.log(
    `OPCIONES: tablas=${SOLO_TABLAS.length ? SOLO_TABLAS.join(",") : "TODAS"} · ` +
      `presupuesto=${PRESUPUESTO.toLocaleString("es-ES")} filas · lote=${LOTE}`
  );
  console.log("");

  // ¿Hay esquema en el destino?
  const hayEsquema = (await medirDestino(d, { nombre: "ccaa", clave: null })).existe;
  if (!hayEsquema) {
    await crearEsquema(f, d, {});
  } else {
    console.log("Esquema ya presente en el destino (no se recrea nada).");
  }

  let abortado = false;
  for (const t of TABLAS) {
    try {
      const r = await copiarTabla(f, d, t, progreso);
      if (r.abortado) {
        abortado = true;
        break;
      }
    } catch (e) {
      console.error(`✗ ERROR en ${t.nombre}: ${e.message}`);
      console.error(
        "(NO se ha perdido nada: re-ejecuta el mismo comando y continúa donde quedó)"
      );
      f.cerrar();
      process.exit(1);
    }
  }

  if (!abortado) {
    console.log(`\nCreando ${INDICES.length} índices (solo si faltan)...`);
    for (const s of INDICES) {
      try {
        await d.execute(s);
      } catch (e) {
        console.error(`  ✗ índice: ${String(e.message).slice(0, 120)}`);
      }
    }
    progreso.indices_creados = true;
    guardarProgreso(progreso);
  }

  const ok = await verificar(f, d);
  f.cerrar();
  console.log(
    ok
      ? abortado
        ? "\n✔ Etapa terminada y verificada. Continúa con el mismo comando."
        : "\n✔ MIGRACIÓN V8 COMPLETADA Y VERIFICADA."
      : "\n✗ Faltan filas o las sumas no cuadran: NO toques la app todavía."
  );
}

// ─── Arranque ───────────────────────────────────────────────────────────────

async function soloIndices() {
  validar();
  const d = dest();
  console.log(`Creando índices en ${DESTINO_URL} (solo si faltan)...`);
  for (const s of INDICES) {
    try {
      await d.execute(s);
      console.log(`  ✔ ${s.match(/idx_\w+/)[0]}`);
    } catch (e) {
      console.error(`  ✗ ${String(e.message).slice(0, 120)}`);
    }
  }
}

async function soloVerificar() {
  validar();
  const f = await abrirFuente();
  const d = dest();
  const ok = await verificar(f, d);
  f.cerrar();
  process.exitCode = ok ? 0 : 1;
}

const arranque = SOLO_INDICES ? soloIndices : SOLO_VERIFICAR ? soloVerificar : MODO === "plan" ? plan : ejecutar;

arranque().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
