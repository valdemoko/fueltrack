/**
 * Prueba de los dos caminos de mantenimiento que casi nunca se ejecutan:
 *   · purga de retención      → solo los lunes
 *   · cierre mensual          → solo el día 1
 *
 * POR QUÉ
 *   Un fallo ahí podría tardar meses en detectarse, y el cierre ESCRIBE medias
 *   permanentes: si se calculara con datos parciales, corrompería el histórico.
 *   Un fallo en la PURGA es aún peor: borra datos que ya no se pueden recuperar.
 *
 * ── CÓMO SE PRUEBA SIN ARRIESGAR NADA (rama de Neon) ─────────────────────
 *
 *   Este script BORRA datos a propósito (es lo que hace la retención), así que
 *   NUNCA debe apuntar a la base de datos de trabajo. La forma correcta en
 *   Neon es una RAMA del proyecto: es una copia por referencia (instantánea,
 *   sin duplicar almacenamiento) con su propia URL, y los cambios que se
 *   hagan en ella no llegan nunca a `production`.
 *
 *     neon branches create --project-id <id> --name pruebas --parent production
 *     # copia la connection string de esa rama y:
 *     PRUEBA_DATABASE_URL="postgresql://…-pruebas…" npx tsx scripts/probar-mantenimiento.ts --si
 *     neon branches delete pruebas --project-id <id>
 *
 *   El script aborta si `PRUEBA_DATABASE_URL` no está definida o si es
 *   idéntica a `DATABASE_URL` (protección contra el accidente obvio).
 *   El fichero SQLite local (`data/combustible.db`) ya NO sirve de fuente:
 *   el motor es Postgres y el SQL es distinto.
 *
 * QUÉ COMPRUEBA
 *   1. Cierre de un MES YA CERRADO (por defecto 2026-08) con el histórico
 *      diario completo: las medias que recalcula deben COINCIDIR con las que
 *      ya estaban guardadas (prueba de que calcula bien).
 *   2. Cierre del MES EN CURSO tras la purga, en el ORDEN REAL del cron
 *      (primero purga, después cierre): debe seguir escribiendo las 4 tablas,
 *      es decir, la purga no deja sin datos al mes que se va a cerrar.
 *   3. Purga: borra exactamente lo que queda fuera de cada ventana y no toca
 *      ni una fila de dentro.
 *   4. Idempotencia: reejecutar el mantenimiento no duplica ni recalcula un
 *      mes ya marcado como procesado.
 *
 * Uso:
 *   PRUEBA_DATABASE_URL="postgresql://…" npx tsx scripts/probar-mantenimiento.ts --si
 *   PRUEBA_DATABASE_URL="postgresql://…" npx tsx scripts/probar-mantenimiento.ts --si --mes-cerrado=2026-07
 */
import { readFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";

const opcion = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const MES_CERRADO = opcion("mes-cerrado") ?? "2026-08";
const MES_EN_CURSO = opcion("mes-curso") ?? new Date().toISOString().slice(0, 7);
const CONFIRMADO = process.argv.includes("--si");

// ─── Entorno ─────────────────────────────────────────────────────────────────

function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

const PRODUCCION = process.env.DATABASE_URL ?? "";
const PRUEBA = process.env.PRUEBA_DATABASE_URL ?? "";

if (!PRUEBA) {
  console.error(
    "ABORTADO: falta PRUEBA_DATABASE_URL.\n\n" +
      "Esta prueba BORRA datos (retención) y reescribe medias mensuales, así que no\n" +
      "puede correr contra la base de datos de trabajo. Crea una rama desechable:\n\n" +
      "  neon branches create --project-id <project-id> --name pruebas --parent production\n" +
      "  PRUEBA_DATABASE_URL='<connection string de la rama>' npx tsx scripts/probar-mantenimiento.ts --si\n" +
      "  neon branches delete pruebas --project-id <project-id>\n"
  );
  process.exit(1);
}
if (PRUEBA === PRODUCCION) {
  console.error("ABORTADO: PRUEBA_DATABASE_URL es idéntica a DATABASE_URL (la BD de trabajo).");
  process.exit(1);
}
if (!CONFIRMADO) {
  console.error(
    "ABORTADO: falta --si.\n" +
      "La prueba purga la retención y recalcula el cierre mensual: solo se ejecuta\n" +
      `contra una rama desechable. Se usaría: ${PRUEBA.replace(/\/\/[^@/]*@/, "//***@")}\n`
  );
  process.exit(1);
}

// La app debe abrir la RAMA DE PRUEBA: se fija ANTES de importar @/lib/db.
process.env.DATABASE_URL = PRUEBA;

const fallos: string[] = [];
const comprobar = (ok: boolean, texto: string) => {
  console.log(`${ok ? "✔" : "✗"} ${texto}`);
  if (!ok) fallos.push(texto);
};
const menosDias = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const TABLAS_MES: Array<{ tabla: string; clave: string }> = [
  { tabla: "hist_mun_mes", clave: "municipio_id" },
  { tabla: "hist_prov_mes", clave: "provincia_id" },
  { tabla: "hist_ccaa_mes", clave: "ccaa_id" },
  { tabla: "hist_estacion_mes", clave: "estacion_id" },
];

async function main() {
  const { URL_EFECTIVA, queryAll, queryGet } = await import("@/lib/db");
  const {
    aplicarRetencion,
    cerrarMes,
    mantenimientoDiario,
    RETENCION_DIAS_HISTORICO,
    RETENCION_DIAS_GEO,
    RETENCION_DIAS_SEMANA,
  } = await import("@/lib/db/mantenimiento");

  const filas = async (q: string): Promise<number> => {
    const r = await queryGet<{ n: number }>(sql.raw(q));
    return Number(r?.n ?? 0);
  };
  const cuentaMes = (tabla: string, mes: string) =>
    filas(`SELECT COUNT(*) AS n FROM ${tabla} WHERE mes = '${mes}'`);
  const mediaMes = async (tabla: string, mes: string) => {
    const r = await queryGet<{ m: number | string | null }>(sql.raw(
      `SELECT ROUND(AVG(precio_medio)::numeric, 4) AS m FROM ${tabla} WHERE mes = '${mes}'`
    ));
    return r?.m === null || r?.m === undefined ? null : Number(r.m);
  };
  /**
   * Muestra de filas concretas (clave+producto → valor) para comparar 1 a 1.
   * Si `fuente` es 'hist_geo_dia' o 'precios_historico', devuelve TAMBIÉN el
   * valor esperado calculado con una consulta INDEPENDIENTE sobre el origen
   * de datos: así se comprueba que el cierre calcula exactamente lo que dice
   * su definición (y no si coincide con lo que guardó el sistema anterior,
   * que puede venir de otra versión del pipeline).
   */
  const muestra = async (
    tabla: string,
    clave: string,
    mes: string,
    fuente?: "hist_geo_dia" | "precios_historico",
    ambito?: string
  ) => {
    const desde = `${mes}-01`;
    const hasta = `${mes}-31`;
    const subconsulta = !fuente
      ? "NULL"
      : fuente === "hist_geo_dia"
        ? `(SELECT ROUND(AVG(g.precio_medio), 4) FROM hist_geo_dia g
             WHERE g.ambito = '${ambito}' AND g.geo_id = t.${clave}
               AND g.producto_id = t.producto_id
               AND g.fecha BETWEEN '${desde}' AND '${hasta}')`
        : `(SELECT ROUND(AVG(h.precio), 4) FROM precios_historico h
             WHERE h.estacion_id = t.${clave} AND h.producto_id = t.producto_id
               AND h.fecha BETWEEN '${desde}' AND '${hasta}' AND h.precio IS NOT NULL)`;
    const r = await queryAll<{ k: string; p: number; v: number; esperado: number | string | null }>(sql.raw(
      `SELECT t.${clave} AS k, t.producto_id AS p, t.precio_medio AS v, ${subconsulta} AS esperado
       FROM ${tabla} t WHERE t.mes = '${mes}' ORDER BY t.${clave}, t.producto_id LIMIT 250`
    ));
    return r.map((x) => ({
      clave: `${x.k}:${x.p}`,
      guardado: Number(x.v),
      esperado: x.esperado === null ? null : Number(x.esperado),
    }));
  };

  /** Compara lo escrito por el cierre con el valor esperado (definición). */
  const compruebaDefinicion = (
    filasMuestra: Array<{ clave: string; guardado: number; esperado: number | null }>,
    etiqueta: string
  ) => {
    const comparables = filasMuestra.filter((f) => f.esperado !== null);
    let maxDif = 0;
    for (const f of comparables) {
      maxDif = Math.max(maxDif, Math.abs(f.guardado - f.esperado!));
    }
    comprobar(
      comparables.length > 0 && maxDif < 0.0001,
      `${etiqueta}: ${comparables.length} medias calculadas exactamente como manda la definición (diferencia máxima ${maxDif.toFixed(6)} €)`
    );
  };

  /** Diferencia con lo que había antes (informativo: viene del pipeline viejo). */
  const difConAnterior = (
    antesF: Array<{ clave: string; guardado: number }>,
    ahoraF: Array<{ clave: string; guardado: number }>,
    etiqueta: string
  ) => {
    const previo = new Map(antesF.map((f) => [f.clave, f.guardado]));
    let max = 0;
    let n = 0;
    for (const f of ahoraF) {
      const p = previo.get(f.clave);
      if (p === undefined) continue;
      n++;
      max = Math.max(max, Math.abs(f.guardado - p));
    }
    console.log(
      `  · ${etiqueta}: ${n} valores comparados con los del pipeline anterior → diferencia máxima ${max.toFixed(4)} €`
    );
  };

  console.log(`BD de prueba: ${URL_EFECTIVA}`);
  comprobar(URL_EFECTIVA !== PRODUCCION.replace(/\/\/[^@/]*@/, "//***@"), "la app trabaja sobre la RAMA de prueba, no sobre la BD de trabajo");

  // ─── 1. Cierre de un mes ya cerrado, con histórico completo ───────────────
  console.log(`\n=== 1. CIERRE DE UN MES YA CERRADO (${MES_CERRADO}) ===`);
  const diasCerrado = await filas(
    `SELECT COUNT(DISTINCT fecha) AS n FROM hist_geo_dia WHERE fecha LIKE '${MES_CERRADO}-%'`
  );
  const obsCerrado = await filas(
    `SELECT COUNT(*) AS n FROM precios_historico WHERE fecha LIKE '${MES_CERRADO}-%'`
  );
  console.log(
    `  Datos disponibles: ${diasCerrado} días en hist_geo_dia, ${obsCerrado} observaciones en precios_historico`
  );
  comprobar(
    diasCerrado >= 28 && obsCerrado > 0,
    "el mes está completo en el histórico diario: se puede recalcular y comparar"
  );

  const antes: Record<string, { filas: number; media: number | null; muestra: Array<{ clave: string; guardado: number }> }> = {};
  for (const t of TABLAS_MES) {
    antes[t.tabla] = {
      filas: await cuentaMes(t.tabla, MES_CERRADO),
      media: await mediaMes(t.tabla, MES_CERRADO),
      muestra: await muestra(t.tabla, t.clave, MES_CERRADO),
    };
    console.log(
      `  antes ${t.tabla.padEnd(18)} ${String(antes[t.tabla].filas).padStart(7)} filas · media ${antes[t.tabla].media}`
    );
  }

  await cerrarMes(MES_CERRADO);

  for (const t of TABLAS_MES) {
    const a = antes[t.tabla];
    const ahora = await cuentaMes(t.tabla, MES_CERRADO);
    comprobar(ahora >= a.filas, `${t.tabla}: no pierde filas (${a.filas} → ${ahora})`);
    // ¿Calcula exactamente lo que dice su definición? (consulta independiente)
    const fuente =
      t.tabla === "hist_estacion_mes" ? "precios_historico" : "hist_geo_dia";
    const ambito = t.tabla === "hist_mun_mes" ? "mun" : t.tabla === "hist_prov_mes" ? "prov" : "ccaa";
    const filasMuestra = await muestra(
      t.tabla,
      t.clave,
      MES_CERRADO,
      fuente as "hist_geo_dia" | "precios_historico",
      ambito
    );
    compruebaDefinicion(filasMuestra, t.tabla);
    difConAnterior(a.muestra, filasMuestra, t.tabla);
  }
  comprobar(
    (await filas(
      `SELECT COUNT(*) AS n FROM hist_meses_procesados WHERE mes = '${MES_CERRADO}'`
    )) === 1,
    `marca el mes como procesado (${MES_CERRADO})`
  );

  // ─── 2. Purga de retención ───────────────────────────────────────────────
  console.log("\n=== 2. PURGA DE RETENCIÓN ===");
  const ventanas = [
    { tabla: "precios_historico", col: "fecha", corte: menosDias(RETENCION_DIAS_HISTORICO), dias: RETENCION_DIAS_HISTORICO },
    { tabla: "hist_geo_dia", col: "fecha", corte: menosDias(RETENCION_DIAS_GEO), dias: RETENCION_DIAS_GEO },
    { tabla: "hist_geo_semana", col: "semana", corte: menosDias(RETENCION_DIAS_SEMANA), dias: RETENCION_DIAS_SEMANA },
  ];
  for (const v of ventanas) {
    console.log(`  ${v.tabla}: ventana de ${v.dias} días → corte ${v.corte}`);
  }

  const estado: Record<string, { fuera: number; dentro: number }> = {};
  for (const v of ventanas) {
    const existe = await filas(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = '${v.tabla}'`
    );
    if (existe === 0) {
      console.log(`- ${v.tabla}: no existe en esta copia, se omite`);
      continue;
    }
    estado[v.tabla] = {
      fuera: await filas(`SELECT COUNT(*) AS n FROM ${v.tabla} WHERE ${v.col} < '${v.corte}'`),
      dentro: await filas(`SELECT COUNT(*) AS n FROM ${v.tabla} WHERE ${v.col} >= '${v.corte}'`),
    };
    console.log(
      `  ${v.tabla.padEnd(20)} fuera: ${String(estado[v.tabla].fuera).padStart(8)} | dentro: ${String(estado[v.tabla].dentro).padStart(9)}`
    );
  }

  const borradas = await aplicarRetencion();
  console.log(`  → filas borradas: ${borradas}`);

  let esperadas = 0;
  for (const v of ventanas) {
    if (!estado[v.tabla]) continue;
    esperadas += estado[v.tabla].fuera;
    const fuera = await filas(`SELECT COUNT(*) AS n FROM ${v.tabla} WHERE ${v.col} < '${v.corte}'`);
    const dentro = await filas(`SELECT COUNT(*) AS n FROM ${v.tabla} WHERE ${v.col} >= '${v.corte}'`);
    comprobar(fuera === 0, `${v.tabla}: no queda nada fuera de la ventana (${estado[v.tabla].fuera} → ${fuera})`);
    comprobar(dentro === estado[v.tabla].dentro, `${v.tabla}: la ventana queda intacta (${estado[v.tabla].dentro} → ${dentro})`);
  }
  comprobar(borradas === esperadas, `la purga borró exactamente lo previsto (${borradas} = ${esperadas})`);

  // El mes YA CERRADO no debe perder sus medias mensuales al purgar.
  for (const t of TABLAS_MES) {
    const ahora = await cuentaMes(t.tabla, MES_CERRADO);
    comprobar(
      ahora === antes[t.tabla].filas,
      `${t.tabla}: el mes cerrado ${MES_CERRADO} sigue completo tras la purga (${antes[t.tabla].filas} = ${ahora})`
    );
  }

  // ─── 3. Orden real del cron: purga y luego cierre del mes en curso ───────
  console.log(`\n=== 3. ORDEN REAL DEL CRON (purga → cierre del mes en curso ${MES_EN_CURSO}) ===`);
  const diasCurso = await filas(
    `SELECT COUNT(DISTINCT fecha) AS n FROM hist_geo_dia WHERE fecha LIKE '${MES_EN_CURSO}-%'`
  );
  const obsCurso = await filas(
    `SELECT COUNT(*) AS n FROM precios_historico WHERE fecha LIKE '${MES_EN_CURSO}-%'`
  );
  console.log(
    `  Tras la purga quedan ${diasCurso} días y ${obsCurso} observaciones de ${MES_EN_CURSO}`
  );
  comprobar(
    diasCurso > 0 && obsCurso > 0,
    `la purga no deja sin datos al mes en curso (${diasCurso} días, ${obsCurso} observaciones)`
  );

  const antesCurso = {
    geo: await cuentaMes("hist_mun_mes", MES_EN_CURSO),
    est: await cuentaMes("hist_estacion_mes", MES_EN_CURSO),
  };
  await cerrarMes(MES_EN_CURSO);
  const despuesCurso = {
    geo: await cuentaMes("hist_mun_mes", MES_EN_CURSO),
    est: await cuentaMes("hist_estacion_mes", MES_EN_CURSO),
  };
  comprobar(
    despuesCurso.geo > antesCurso.geo,
    `escribe medias de municipio del mes en curso (${antesCurso.geo} → ${despuesCurso.geo})`
  );
  comprobar(
    despuesCurso.est > antesCurso.est,
    `escribe medias de estación del mes en curso desde precios_historico (${antesCurso.est} → ${despuesCurso.est})`
  );

  // ─── 4. Idempotencia ─────────────────────────────────────────────────────
  console.log("\n=== 4. IDEMPOTENCIA ===");
  const hoy = new Date().toISOString().slice(0, 10);
  const hoyAntes = {
    geoDia: await filas(`SELECT COUNT(*) AS n FROM hist_geo_dia WHERE fecha = '${hoy}'`),
    nacDia: await filas(`SELECT COUNT(*) AS n FROM hist_nac_dia WHERE fecha = '${hoy}'`),
    geoResumen: await filas(`SELECT COUNT(*) AS n FROM hist_geo_dia`),
  };
  const m1 = await mantenimientoDiario(false);
  const m2 = await mantenimientoDiario(false);
  const hoyDespues = {
    geoDia: await filas(`SELECT COUNT(*) AS n FROM hist_geo_dia WHERE fecha = '${hoy}'`),
    nacDia: await filas(`SELECT COUNT(*) AS n FROM hist_nac_dia WHERE fecha = '${hoy}'`),
    geoResumen: await filas(`SELECT COUNT(*) AS n FROM hist_geo_dia`),
  };
  console.log(
    `  ejecutado 2 veces: agregados ${m1.agregados}/${m2.agregados}, borrados ${m1.borrados}/${m2.borrados}, mes cerrado ${m1.mesCerrado}`
  );
  comprobar(
    m1.mesCerrado === null && m2.mesCerrado === null,
    `no vuelve a cerrar un mes ya procesado (${MES_CERRADO} está marcado)`
  );
  comprobar(
    hoyDespues.geoDia === hoyAntes.geoDia && hoyDespues.geoResumen === hoyAntes.geoResumen,
    `no duplica filas de hoy (geo_dia ${hoyAntes.geoDia} → ${hoyDespues.geoDia}; total ${hoyAntes.geoResumen} → ${hoyDespues.geoResumen})`
  );
  comprobar(
    hoyDespues.nacDia === hoyAntes.nacDia,
    `no duplica la serie nacional (${hoyAntes.nacDia} → ${hoyDespues.nacDia})`
  );

  // ─── Resultado ───────────────────────────────────────────────────────────
  console.log("\n================ RESULTADO ================");
  if (fallos.length === 0) {
    console.log("✔ TODO CORRECTO: el cierre mensual reproduce las medias guardadas,");
    console.log("  la purga borra solo lo que sale de cada ventana y nada se duplica.");
  } else {
    console.error(`✗ ${fallos.length} comprobación(es) FALLIDAS:`);
    for (const f of fallos) console.error(`   · ${f}`);
  }
  console.log("(la rama de prueba sigue existiendo: bórrala con `neon branches delete`)");
  if (fallos.length) process.exit(1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
