/**
 * Endpoint de actualización de precios (Vercel Cron).
 *
 * ── Política de cuota (Turso Free: 500M lecturas / 10M escrituras al mes) ──
 *
 * UNA INGESTA AL DÍA. `vercel.json` programa un ÚNICO cron a las 08:00 UTC
 * (10:00 en España en verano, 09:00 en invierno): a esa hora MITECO lleva
 * horas sirviendo el parte del día, así que el país queda completo con una
 * sola pasada. (Antes había tres crons —06/09/12 UTC— y cada uno rehacía la
 * ingesta completa del país: triplicaba escrituras y lecturas sin añadir
 * contenido.)
 *
 * IDEMPOTENTE: el índice de provincia procesada y el DÍA al que pertenece se
 * persisten en `cron_progreso` (Turso). Si una invocación acaba al día, deja
 * el progreso marcado como COMPLETO para hoy y cualquier invocación extra
 * (manual, reintento de Vercel, prueba) sale sin escribir nada. Con
 * `?forzar=1` se ignora esa guardia y se reingesta el país (recuperación
 * manual si MITECO publicó tarde).
 *
 * REANUDABLE: si la invocación se corta por tiempo, la siguiente continúa
 * donde quedó (misma jornada).
 *
 * DATOS DE HOY: si MITECO aún no ha publicado el parte (la API devuelve la
 * fecha de ayer), la pasada se repite UNA vez más dentro del presupuesto; el
 * histórico del día ya escrito NO se reescribe (la ingesta lo detecta y salta
 * el lote), así que el reintento solo actualiza los precios actuales.
 *
 * Protegido por CRON_SECRET: Vercel Cron envía automáticamente
 * "Authorization: Bearer <CRON_SECRET>" cuando la variable existe. Sin
 * CRON_SECRET configurado, el endpoint responde 401 para no dejar la ingesta
 * abierta al público.
 */
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db, queryGet, queryRun } from "@/lib/db";
import { ingestProductos, ingestEstaciones } from "@/lib/miteco/ingestion";
import { mantenimientoDiario } from "@/lib/db/mantenimiento";
import { TAG_PRECIOS } from "@/lib/db/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Provincias procesadas en paralelo por tanda. */
const CONCURRENCIA = 8;
/**
 * Presupuesto de tiempo por invocación (ms).
 * Una pasada completa del país tarda ~30-40 s contra Turso (52 provincias ×
 * upserts por lotes), y maxDuration es 60 s, así que el corte queda en 50 s:
 * si se supera, la provincia alcanzada queda persistida y la siguiente
 * invocación (o el día siguiente) reanuda ahí.
 */
const PRESUPUESTO_MS = 50_000;
/**
 * Pasadas máximas dentro de una misma invocación. Solo se usa cuando MITECO
 * publica el parte a mitad de la pasada (provincias con fechas distintas).
 */
const MAX_PASADAS = 2;

// Las 52 provincias de España (código → id CCAA)
const PROVINCIAS: Array<{ id: string; ccaaId: string }> = [
  { id: "01", ccaaId: "15" }, { id: "02", ccaaId: "08" }, { id: "03", ccaaId: "17" },
  { id: "04", ccaaId: "01" }, { id: "05", ccaaId: "07" }, { id: "06", ccaaId: "10" },
  { id: "07", ccaaId: "04" }, { id: "08", ccaaId: "09" }, { id: "09", ccaaId: "07" },
  { id: "10", ccaaId: "10" }, { id: "11", ccaaId: "01" }, { id: "12", ccaaId: "17" },
  { id: "13", ccaaId: "08" }, { id: "14", ccaaId: "01" }, { id: "15", ccaaId: "11" },
  { id: "16", ccaaId: "08" }, { id: "17", ccaaId: "09" }, { id: "18", ccaaId: "01" },
  { id: "19", ccaaId: "08" }, { id: "20", ccaaId: "15" }, { id: "21", ccaaId: "01" },
  { id: "22", ccaaId: "02" }, { id: "23", ccaaId: "01" }, { id: "24", ccaaId: "07" },
  { id: "25", ccaaId: "09" }, { id: "26", ccaaId: "16" }, { id: "27", ccaaId: "11" },
  { id: "28", ccaaId: "12" }, { id: "29", ccaaId: "01" }, { id: "30", ccaaId: "13" },
  { id: "31", ccaaId: "14" }, { id: "32", ccaaId: "11" }, { id: "33", ccaaId: "03" },
  { id: "34", ccaaId: "07" }, { id: "35", ccaaId: "05" }, { id: "36", ccaaId: "11" },
  { id: "37", ccaaId: "07" }, { id: "38", ccaaId: "05" }, { id: "39", ccaaId: "06" },
  { id: "40", ccaaId: "07" }, { id: "41", ccaaId: "01" }, { id: "42", ccaaId: "07" },
  { id: "43", ccaaId: "09" }, { id: "44", ccaaId: "02" }, { id: "45", ccaaId: "08" },
  { id: "46", ccaaId: "17" }, { id: "47", ccaaId: "07" }, { id: "48", ccaaId: "15" },
  { id: "49", ccaaId: "07" }, { id: "50", ccaaId: "02" }, { id: "51", ccaaId: "18" },
  { id: "52", ccaaId: "19" },
];

/** Provincias con precios de hoy para dar el día por cerrado (90 % → 47/52). */
const UMBRAL_FRESCAS = Math.ceil(PROVINCIAS.length * 0.9);

/** Crea la tabla de progreso si no existe (idempotente, primera ejecución). */
async function asegurarTablaProgreso(): Promise<void> {
  await queryRun(sql`
    CREATE TABLE IF NOT EXISTS cron_progreso (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provincia_idx INTEGER NOT NULL DEFAULT 0,
      fecha TEXT,
      actualizado_en TEXT NOT NULL
    )
  `);
  // Tablas creadas por versiones anteriores: añadir `fecha` (idempotente).
  try {
    await queryRun(sql`ALTER TABLE cron_progreso ADD COLUMN fecha TEXT`);
  } catch {
    // La columna ya existe: nada que hacer.
  }
  // Fila inicial
  await queryRun(sql`
    INSERT INTO cron_progreso (id, provincia_idx, fecha, actualizado_en)
    VALUES (1, 0, NULL, ${new Date().toISOString()})
    ON CONFLICT (id) DO NOTHING
  `);
}

/** Lee el progreso persistido: provincia por la que va y jornada a la que pertenece. */
async function leerProgreso(): Promise<{ idx: number; fecha: string | null }> {
  const row = (await queryGet(sql`
    SELECT provincia_idx, fecha FROM cron_progreso WHERE id = 1
  `)) as { provincia_idx: number; fecha: string | null } | undefined;
  return {
    idx: Math.min(row?.provincia_idx ?? 0, PROVINCIAS.length),
    fecha: row?.fecha ?? null,
  };
}

/** Guarda el índice de provincia para la siguiente invocación. */
async function guardarProgreso(idx: number, fecha: string): Promise<void> {
  await queryRun(sql`
    UPDATE cron_progreso
    SET provincia_idx = ${idx}, fecha = ${fecha}, actualizado_en = ${new Date().toISOString()}
    WHERE id = 1
  `);
}

/**
 * Cuenta las provincias cuyos precios en `precios` ya son de `hoy`.
 *
 * Una provincia cuya ingesta recibió la fecha de MITECO de ayer queda fuera:
 * así se detecta que el parte diario aún no estaba publicado. Cuenta como
 * fresca si ≥ la mitad de sus filas están fechadas hoy (el resto pueden ser
 * estaciones retiradas que conservan su última observación).
 */
async function contarProvinciasFrescas(hoy: string): Promise<number> {
  const row = await queryGet<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM (
      SELECT e.provincia_id
      FROM precios p
      JOIN estaciones e ON e.id = p.estacion_id
      GROUP BY e.provincia_id
      HAVING SUM(CASE WHEN p.fecha_observacion = ${hoy} THEN 1 ELSE 0 END) * 2 >= COUNT(*)
    ) frescas
  `);
  return Number(row?.n ?? 0);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Vercel Cron envía "Authorization: Bearer <CRON_SECRET>" automáticamente
  // si la variable está configurada. Sin ella, el endpoint queda bloqueado
  // para evitar ejecuciones no autorizadas.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "No autorizado: falta CRON_SECRET o el Bearer token no coincide" },
      { status: 401 }
    );
  }

  const startTime = Date.now();
  // Fecha de hoy (UTC). El cron se dispara a las 08:00 UTC, tramo en el que la
  // fecha de España y la UTC coinciden, así que sirve para comparar con la
  // fecha que devuelve MITECO (hora española).
  const hoy = new Date().toISOString().slice(0, 10);
  const forzar = new URL(request.url).searchParams.get("forzar") === "1";
  const resultado: {
    timestamp: string;
    duracionMs: number;
    productos?: number;
    desdeProvinciaIdx?: number;
    hastaProvinciaIdx?: number;
    estaciones?: number;
    completado?: boolean;
    alDia?: boolean;
    provinciasFrescas?: number;
    pasadas?: number;
    yaHecho?: boolean;
    aviso?: string;
    agregados?: number;
    borrados?: number;
    mesCerrado?: string | null;
    errores: string[];
  } = {
    timestamp: new Date().toISOString(),
    duracionMs: 0,
    errores: [],
  };

  try {
    console.log(`[cron] Inicio: ${resultado.timestamp}${forzar ? " (forzado)" : ""}`);

    await asegurarTablaProgreso();
    const progreso = await leerProgreso();

    // ── Guardia de idempotencia ──────────────────────────────────────────
    // Si la jornada de hoy ya se completó (una pasada íntegra), no se vuelve
    // a ingestar: cualquier invocación extra sale sin escribir en la BD. Solo
    // se comprueba la frescura (1 consulta) para poder informar.
    if (!forzar && progreso.fecha === hoy && progreso.idx >= PROVINCIAS.length) {
      const frescas = await contarProvinciasFrescas(hoy);
      resultado.yaHecho = true;
      resultado.completado = true;
      resultado.pasadas = 0;
      resultado.provinciasFrescas = frescas;
      resultado.alDia = frescas >= UMBRAL_FRESCAS;
      resultado.duracionMs = Date.now() - startTime;
      console.log(
        `[cron] Ya completado hoy (frescas=${frescas}/${PROVINCIAS.length}): sin ingesta`
      );
      return NextResponse.json({ success: true, ...resultado });
    }

    // Si la jornada persistida es de otro día, se empieza de cero.
    const desde = progreso.fecha === hoy ? progreso.idx : 0;
    resultado.desdeProvinciaIdx = desde;

    // Primera partición del día: actualizar también el catálogo de productos
    if (desde === 0) {
      resultado.productos = await ingestProductos(db);
    }

    let totalEstaciones = 0;
    let idx = desde;
    let reanudable = false;
    let pasadas = 1;
    let frescas = 0;

    // Tandas de CONCURRENCIA provincias en paralelo, con control de tiempo.
    // Si una pasada completa termina sin precios de hoy en casi todas las
    // provincias porque MITECO publicó a medias durante la pasada, se repite
    // UNA vez más dentro del mismo presupuesto: el upsert es idempotente y el
    // histórico del día ya escrito se salta, así que el reintento es barato.
    for (;;) {
      while (idx < PROVINCIAS.length) {
        if (Date.now() - startTime > PRESUPUESTO_MS) {
          reanudable = true;
          break;
        }
        const tanda = PROVINCIAS.slice(idx, idx + CONCURRENCIA);
        const resultados = await Promise.allSettled(
          tanda.map((p) => ingestEstaciones(db, p.id))
        );
        resultados.forEach((r, i) => {
          if (r.status === "fulfilled") {
            totalEstaciones += r.value;
          } else {
            const msg =
              r.reason instanceof Error ? r.reason.message : "Error desconocido";
            console.error(`[cron] Error provincia ${tanda[i].id}: ${msg}`);
            resultado.errores.push(`Provincia ${tanda[i].id}: ${msg}`);
          }
        });
        idx += tanda.length;
        // Persistir progreso tras cada tanda (reanudable si se corta)
        await guardarProgreso(idx, hoy);
      }
      if (reanudable) break;

      // Pasada completa: ¿está el país al día con fechas de hoy?
      frescas = await contarProvinciasFrescas(hoy);
      if (frescas >= UMBRAL_FRESCAS) break; // todo al día: día cerrado
      if (frescas === 0) {
        // MITECO no ha publicado nada de hoy: no se insiste (la API no
        // devolverá otra cosa). Queda reanudable para la próxima invocación.
        console.warn("[cron] MITECO sin precios de hoy: se reintentará en la próxima invocación");
        break;
      }
      if (pasadas >= MAX_PASADAS) break;
      if (Date.now() - startTime > PRESUPUESTO_MS) break; // sin presupuesto
      console.warn(
        `[cron] Solo ${frescas}/${PROVINCIAS.length} provincias con precios de hoy: nueva pasada completa`
      );
      pasadas++;
      idx = 0;
      await guardarProgreso(idx, hoy);
    }

    const completado = idx >= PROVINCIAS.length && !reanudable;
    const alDia = completado && frescas >= UMBRAL_FRESCAS;
    // Estado que se persiste para la próxima invocación:
    //  · al día            → PROVINCIAS.length (guardia: hoy ya está hecho)
    //  · pasada completa sin datos frescos → 0 (reintentar el país entero)
    //  · cortada por tiempo → el índice alcanzado (se reanuda donde quedó)
    const progresoSiguiente = alDia
      ? PROVINCIAS.length
      : completado
        ? 0
        : idx;
    await guardarProgreso(progresoSiguiente, hoy);
    resultado.hastaProvinciaIdx = idx;
    resultado.completado = completado;
    resultado.alDia = alDia;
    resultado.provinciasFrescas = frescas;
    resultado.pasadas = pasadas;
    resultado.estaciones = totalEstaciones;
    if (completado && !alDia) {
      resultado.aviso = `MITECO sin precios de hoy en ${PROVINCIAS.length - frescas}/${PROVINCIAS.length} provincias: se reintentará en la próxima invocación del cron (o con ?forzar=1)`;
      console.warn(`[cron] ${resultado.aviso}`);
    }

    // ── Mantenimiento diario (agregados + retención + cierre mensual) ──
    // Con una sola ingesta al día esto corre exactamente una vez. Se hace
    // cuando el día está al día, para no consolidar fechas obsoletas.
    if (alDia) {
      const quedanMs = PRESUPUESTO_MS - (Date.now() - startTime);
      if (quedanMs > 5_000) {
        const mant = await mantenimientoDiario(false);
        resultado.agregados = mant.agregados;
        resultado.borrados = mant.borrados;
        resultado.mesCerrado = mant.mesCerrado;
      } else {
        // Sin tiempo: solo agregados del día (baratos); retención mañana
        const mant = await mantenimientoDiario(true);
        resultado.agregados = mant.agregados;
      }
    }

    // ── Invalidación de caché por evento ─────────────────────────────────
    // Solo los datos de PRECIOS ACTUALES: las cachés de históricos son
    // indefinidas y nadie las invalida (los históricos no cambian).
    if (completado) {
      revalidateTag(TAG_PRECIOS);
      console.log(`[cron] Caché invalidada por evento: tag "${TAG_PRECIOS}"`);
    }

    resultado.duracionMs = Date.now() - startTime;
    console.log(
      `[cron] OK: provincias ${desde}..${idx - 1}, ${totalEstaciones} estaciones en ${resultado.duracionMs}ms (completado=${completado}, alDia=${alDia}, frescas=${frescas}/${PROVINCIAS.length}, pasadas=${pasadas})`
    );

    return NextResponse.json({ success: true, ...resultado });
  } catch (error) {
    resultado.duracionMs = Date.now() - startTime;
    resultado.errores.push(
      error instanceof Error ? error.message : "Error desconocido"
    );
    console.error("[cron] Error:", error);

    return NextResponse.json({ success: false, ...resultado }, { status: 500 });
  }
}
