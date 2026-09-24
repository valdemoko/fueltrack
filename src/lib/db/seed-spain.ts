/**
 * Script de ingesta MASIVA para toda España (MITECO) → Postgres (Neon).
 *
 * Uso: npx tsx src/lib/db/seed-spain.ts [opciones]
 *
 * Proceso:
 * 1. Insertar TODAS las CCAA y provincias de España (catálogos estáticos)
 * 2. Insertar el catálogo de productos petrolíferos
 * 3. Ingestar los datos actuales de las 52 provincias (~11 k estaciones)
 * 4. Poblar `municipios` desde las estaciones ya ingeridas
 * 5. Ingestar el histórico diario (por defecto, los últimos 2 años)
 *
 * Opciones:
 *   --current-only     solo datos actuales (sin histórico)
 *   --historical-only  solo histórico (no toca `precios` ni `estaciones`)
 *   --from=YYYY-MM-DD  inicio del rango histórico
 *   --to=YYYY-MM-DD    fin del rango histórico
 *
 * NOTA HISTÓRICA: esta versión escribía con `better-sqlite3` sobre
 * `data/combustible.db` y traía su propio SQL de creación de tablas. Ahora el
 * esquema lo define drizzle (`src/lib/db/schema.ts`) y la ingesta se apoya en
 * las mismas funciones que usa el cron (`ingestEstaciones`, `ingestHistorico`,
 * `ingestProductos`): así no hay dos caminos de escritura que puedan divergir.
 *
 * No tiene sentido para el día a día: el cron de Vercel mantiene la BD al día.
 * Se usa para reconstruir el país entero desde cero.
 */
import { sql } from "drizzle-orm";
import { readFileSync, existsSync } from "node:fs";

// ─── Entorno ─────────────────────────────────────────────────────────────────

/** Carga .env.local (drizzle-kit y Next leen .env; los scripts no). */
function cargarEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const linea of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
cargarEnvLocal();

// ─── Lista completa de provincias de España ──────────────────────────────────

/** Provincias españolas: código → { ccaaId, nombre } */
const PROVINCIAS_ESPANIA: Record<string, { ccaaId: string; nombre: string }> = {
  "01": { ccaaId: "15", nombre: "Álava" },
  "02": { ccaaId: "08", nombre: "Albacete" },
  "03": { ccaaId: "17", nombre: "Alicante" },
  "04": { ccaaId: "01", nombre: "Almería" },
  "05": { ccaaId: "07", nombre: "Ávila" },
  "06": { ccaaId: "10", nombre: "Badajoz" },
  "07": { ccaaId: "04", nombre: "Baleares" },
  "08": { ccaaId: "09", nombre: "Barcelona" },
  "09": { ccaaId: "07", nombre: "Burgos" },
  "10": { ccaaId: "10", nombre: "Cáceres" },
  "11": { ccaaId: "01", nombre: "Cádiz" },
  "12": { ccaaId: "17", nombre: "Castellón" },
  "13": { ccaaId: "08", nombre: "Ciudad Real" },
  "14": { ccaaId: "01", nombre: "Córdoba" },
  "15": { ccaaId: "11", nombre: "A Coruña" },
  "16": { ccaaId: "08", nombre: "Cuenca" },
  "17": { ccaaId: "09", nombre: "Girona" },
  "18": { ccaaId: "01", nombre: "Granada" },
  "19": { ccaaId: "08", nombre: "Guadalajara" },
  "20": { ccaaId: "15", nombre: "Guipúzcoa" },
  "21": { ccaaId: "01", nombre: "Huelva" },
  "22": { ccaaId: "02", nombre: "Huesca" },
  "23": { ccaaId: "01", nombre: "Jaén" },
  "24": { ccaaId: "07", nombre: "León" },
  "25": { ccaaId: "09", nombre: "Lleida" },
  "26": { ccaaId: "16", nombre: "La Rioja" },
  "27": { ccaaId: "11", nombre: "Lugo" },
  "28": { ccaaId: "12", nombre: "Madrid" },
  "29": { ccaaId: "01", nombre: "Málaga" },
  "30": { ccaaId: "13", nombre: "Murcia" },
  "31": { ccaaId: "14", nombre: "Navarra" },
  "32": { ccaaId: "11", nombre: "Ourense" },
  "33": { ccaaId: "03", nombre: "Asturias" },
  "34": { ccaaId: "07", nombre: "Palencia" },
  "35": { ccaaId: "05", nombre: "Las Palmas" },
  "36": { ccaaId: "11", nombre: "Pontevedra" },
  "37": { ccaaId: "07", nombre: "Salamanca" },
  "38": { ccaaId: "05", nombre: "S/C de Tenerife" },
  "39": { ccaaId: "06", nombre: "Cantabria" },
  "40": { ccaaId: "07", nombre: "Segovia" },
  "41": { ccaaId: "01", nombre: "Sevilla" },
  "42": { ccaaId: "07", nombre: "Soria" },
  "43": { ccaaId: "09", nombre: "Tarragona" },
  "44": { ccaaId: "02", nombre: "Teruel" },
  "45": { ccaaId: "08", nombre: "Toledo" },
  "46": { ccaaId: "17", nombre: "Valencia" },
  "47": { ccaaId: "07", nombre: "Valladolid" },
  "48": { ccaaId: "15", nombre: "Vizcaya" },
  "49": { ccaaId: "07", nombre: "Zamora" },
  "50": { ccaaId: "02", nombre: "Zaragoza" },
  "51": { ccaaId: "51", nombre: "Ceuta" },
  "52": { ccaaId: "52", nombre: "Melilla" },
};

/** Nombres de CCAA */
const NOMBRE_CCAA: Record<string, string> = {
  "01": "Andalucía",
  "02": "Aragón",
  "03": "Asturias, Principado de",
  "04": "Illes Balears",
  "05": "Canarias",
  "06": "Cantabria",
  "07": "Castilla y León",
  "08": "Castilla-La Mancha",
  "09": "Cataluña",
  "10": "Extremadura",
  "11": "Galicia",
  "12": "Comunidad de Madrid",
  "13": "Región de Murcia",
  "14": "Comunidad Foral de Navarra",
  "15": "País Vasco",
  "16": "La Rioja",
  "17": "Comunitat Valenciana",
  "51": "Ciudad Autónoma de Ceuta",
  "52": "Ciudad Autónoma de Melilla",
};

// ─── Fechas ──────────────────────────────────────────────────────────────────

/** Formatea fecha Date a "dd-MM-yyyy" para la API histórica de MITECO */
function formatDateMiteco(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// ─── Opciones CLI ────────────────────────────────────────────────────────────

interface CliOptions {
  /** Solo datos actuales (sin histórico) */
  currentOnly: boolean;
  /** Solo histórico (sin datos actuales) */
  historicalOnly: boolean;
  /** Fecha inicio histórico (YYYY-MM-DD) */
  from: string | null;
  /** Fecha fin histórico (YYYY-MM-DD) */
  to: string | null;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const valor = (nombre: string): string | null => {
    const i = args.indexOf(`--${nombre}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    currentOnly: args.includes("--current-only"),
    historicalOnly: args.includes("--historical-only"),
    from: valor("from"),
    to: valor("to"),
  };
}

/** Obtiene las fechas de ingesta histórica según las opciones CLI. */
function getFechasHistoricas(opts: CliOptions): string[] {
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1); // MITECO publica con un día de retardo

  const inicio = opts.from
    ? new Date(opts.from + "T00:00:00")
    : (() => {
        const d = new Date(ayer);
        d.setFullYear(d.getFullYear() - 2);
        return d;
      })();
  const fin = opts.to ? new Date(opts.to + "T00:00:00") : ayer;

  const fechas: string[] = [];
  for (const d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
    fechas.push(formatDateMiteco(d));
  }
  return fechas;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const inicio = Date.now();
  const opts = parseCliArgs();
  const modo = opts.currentOnly ? "SOLO ACTUALES" : opts.historicalOnly ? "SOLO HISTÓRICO" : "COMPLETO";
  console.log(`=== Ingesta MASIVA de España (MITECO) — Modo: ${modo} ===`);
  if (opts.from || opts.to) console.log(`  Rango: ${opts.from || "inicio"} → ${opts.to || "hoy"}`);
  console.log("");

  // Import dinámico: `@/lib/db` lee el entorno al importarse.
  const { db, queryGet, queryRun, URL_EFECTIVA, isPostgres } = await import("@/lib/db");
  const { ingestEstaciones, ingestHistorico, ingestProductos } = await import(
    "@/lib/miteco/ingestion"
  );

  if (!isPostgres) {
    console.error(
      `ABORTADO: DATABASE_URL no apunta a Postgres/Neon (${URL_EFECTIVA}).\n` +
        "Este script ya no escribe en ficheros SQLite."
    );
    process.exit(1);
  }
  console.log(`[db] Base de datos: ${URL_EFECTIVA}`);
  if (opts.historicalOnly) {
    console.log("[db] Modo solo-histórico: NO se tocarán `estaciones` ni `precios`.");
  }

  // ─── FASE 1: CCAA y Provincias ─────────────────────────────────────────────

  console.log("\n=== FASE 1: CCAA y Provincias ===");
  for (const [id, nombre] of Object.entries(NOMBRE_CCAA)) {
    await queryRun(sql`
      INSERT INTO ccaa (id, nombre) VALUES (${id}, ${nombre})
      ON CONFLICT (id) DO NOTHING
    `);
  }
  for (const [id, info] of Object.entries(PROVINCIAS_ESPANIA)) {
    await queryRun(sql`
      INSERT INTO provincias (id, ccaa_id, nombre)
      VALUES (${id}, ${info.ccaaId}, ${info.nombre})
      ON CONFLICT (id) DO NOTHING
    `);
  }
  console.log(
    `  CCAA: ${Object.keys(NOMBRE_CCAA).length}, Provincias: ${Object.keys(PROVINCIAS_ESPANIA).length}`
  );

  // ─── FASE 2: Productos petrolíferos ────────────────────────────────────────

  console.log("\n=== FASE 2: Productos petrolíferos ===");
  const nProductos = await ingestProductos(db);
  console.log(`  Productos: ${nProductos}`);

  // ─── FASE 3: Datos actuales (52 provincias) ────────────────────────────────

  if (!opts.historicalOnly) {
    console.log("\n=== FASE 3: Datos actuales de TODA España ===");
    const provinciasIds = Object.keys(PROVINCIAS_ESPANIA);
    let totalEstaciones = 0;

    for (let i = 0; i < provinciasIds.length; i++) {
      const pid = provinciasIds[i];
      console.log(`  [${i + 1}/${provinciasIds.length}] ${PROVINCIAS_ESPANIA[pid].nombre} (${pid})`);
      try {
        const count = await ingestEstaciones(db, pid);
        totalEstaciones += count;
        console.log(`    ✓ ${count} estaciones`);
      } catch (error) {
        console.error(`    ✗ Error: ${error}`);
      }
      if (i < provinciasIds.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`\n  Total estaciones actuales: ${totalEstaciones}`);

    // ─── FASE 3.5: Municipios (poblados desde las estaciones) ────────────────
    // MITECO no publica un catálogo de municipios: se derivan de la localidad
    // de cada estación. `ON CONFLICT DO NOTHING` conserva el nombre que ya
    // hubiera (una localidad puede escribirse de varias formas).
    console.log("\n=== FASE 3.5: Municipios ===");
    await queryRun(sql`
      INSERT INTO municipios (id, provincia_id, nombre)
      SELECT DISTINCT municipio_id, provincia_id, TRIM(localidad)
      FROM estaciones
      WHERE municipio_id IS NOT NULL
        AND localidad IS NOT NULL
        AND TRIM(localidad) <> ''
      ON CONFLICT (id) DO NOTHING
    `);
    const nMunicipios = await queryGet<{ n: number }>(sql`SELECT COUNT(*) AS n FROM municipios`);
    console.log(`  Municipios en tabla: ${nMunicipios?.n ?? 0}`);
  }

  // ─── FASE 4: Histórico ─────────────────────────────────────────────────────

  if (!opts.currentOnly) {
    console.log("\n=== FASE 4: Ingesta histórica ===");
    const todasLasFechas = getFechasHistoricas(opts);

    // Saltar las fechas ya ingeridas: la fecha en BD es ISO ("yyyy-MM-dd") y
    // la de MITECO es "dd-MM-yyyy".
    const yaIngeridas = new Set(
      (
        await queryGet<{ fechas: string[] | null }>(
          sql`SELECT array_agg(DISTINCT fecha_observacion) AS fechas FROM precios`
        )
      )?.fechas ?? []
    );
    const fechasPendientes = todasLasFechas.filter((f) => {
      const [dd, mm, yyyy] = f.split("-");
      return !yaIngeridas.has(`${yyyy}-${mm}-${dd}`);
    });

    console.log(`  Fechas totales: ${todasLasFechas.length}`);
    console.log(`  Ya ingeridas: ${yaIngeridas.size}`);
    console.log(`  Pendientes: ${fechasPendientes.length}`);

    let fechasProcesadas = 0;
    let fechasConError = 0;

    for (let i = 0; i < fechasPendientes.length; i++) {
      const fecha = fechasPendientes[i];
      try {
        await ingestHistorico(db, fecha, true);
        fechasProcesadas++;
        if ((i + 1) % 25 === 0 || i === fechasPendientes.length - 1) {
          const pct = (((i + 1) / fechasPendientes.length) * 100).toFixed(1);
          console.log(`  [${i + 1}/${fechasPendientes.length}] ${pct}% — ${fecha}`);
        }
      } catch (error) {
        fechasConError++;
        if (fechasConError <= 5) console.error(`  ✗ Error ${fecha}: ${error}`);
      }
      if ((i + 1) % 10 === 0) await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`  Procesadas: ${fechasProcesadas}, Errores: ${fechasConError}`);
  }

  // ─── Resumen final ─────────────────────────────────────────────────────────

  const duracion = ((Date.now() - inicio) / 1000 / 60).toFixed(1);
  const cuenta = async (consulta: string): Promise<number> => {
    const r = await queryGet<{ n: number }>(sql.raw(consulta));
    return Number(r?.n ?? 0);
  };

  console.log("\n=== RESUMEN FINAL ===");
  console.log(`Duración: ${duracion} minutos`);
  console.log(`CCAA: ${await cuenta("SELECT COUNT(DISTINCT ccaa_id) AS n FROM estaciones")}`);
  console.log(
    `Provincias: ${await cuenta("SELECT COUNT(DISTINCT provincia_id) AS n FROM estaciones")} de ${Object.keys(PROVINCIAS_ESPANIA).length}`
  );
  console.log(`Municipios: ${await cuenta("SELECT COUNT(*) AS n FROM municipios")}`);
  console.log(`Estaciones: ${await cuenta("SELECT COUNT(*) AS n FROM estaciones")}`);
  console.log(`Productos: ${await cuenta("SELECT COUNT(*) AS n FROM productos")}`);
  console.log(`Observaciones de precio: ${await cuenta("SELECT COUNT(*) AS n FROM precios")}`);
  console.log(
    `Fechas históricas: ${await cuenta("SELECT COUNT(DISTINCT fecha_observacion) AS n FROM precios")}`
  );
  const tamano = await queryGet<{ t: string }>(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS t`);
  console.log(`Tamaño de la base de datos: ${tamano?.t ?? "?"}`);

  console.log("\n[seed] ¡Completado!");
}

main().catch((error) => {
  console.error("[seed] Error fatal:", error);
  process.exit(1);
});
