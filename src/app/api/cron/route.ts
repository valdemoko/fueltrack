/**
 * Endpoint de actualización de precios (Vercel Cron).
 *
 * Vercel Hobby: maxDuration máx. 60 s por invocación y Cron solo 1×/día
 * (vercel.json → "0 6 * * *"). Una pasada secuencial de las 52 provincias
 * puede superar los 60 s, así que las provincias se procesan con
 * concurrencia limitada (varios fetch a MITECO + escrituras por lotes en
 * paralelo) para completar todo el país en una sola invocación.
 *
 * Reanudable: el índice de provincia procesado se persiste en la tabla
 * `cron_progreso` (Turso). Si la invocación se corta por tiempo, la
 * siguiente ejecución (manual o del día siguiente) continúa donde quedó.
 *
 * Protegido por CRON_SECRET: Vercel Cron envía automáticamente
 * "Authorization: Bearer <CRON_SECRET>" cuando la variable existe (también
 * en Hobby). Sin CRON_SECRET configurado, el endpoint responde 401 para no
 * dejar la ingesta abierta al público.
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
/** Presupuesto de tiempo por invocación (ms): margen para responder a tiempo. */
const PRESUPUESTO_MS = 40_000;

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

/** Crea la tabla de progreso si no existe (idempotente, primera ejecución). */
async function asegurarTablaProgreso(): Promise<void> {
  await queryRun(sql`
    CREATE TABLE IF NOT EXISTS cron_progreso (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provincia_idx INTEGER NOT NULL DEFAULT 0,
      actualizado_en TEXT NOT NULL
    )
  `);
  // Fila inicial
  await queryRun(sql`
    INSERT INTO cron_progreso (id, provincia_idx, actualizado_en)
    VALUES (1, 0, ${new Date().toISOString()})
    ON CONFLICT (id) DO NOTHING
  `);
}

/** Lee el índice de provincia donde quedó la última ejecución. */
async function leerProgreso(): Promise<number> {
  const row = (await queryGet(sql`
    SELECT provincia_idx FROM cron_progreso WHERE id = 1
  `)) as { provincia_idx: number } | undefined;
  return Math.min(row?.provincia_idx ?? 0, PROVINCIAS.length);
}

/** Guarda el índice de provincia para la siguiente invocación. */
async function guardarProgreso(idx: number): Promise<void> {
  await queryRun(sql`
    UPDATE cron_progreso
    SET provincia_idx = ${idx}, actualizado_en = ${new Date().toISOString()}
    WHERE id = 1
  `);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Vercel Cron (incluido Hobby) envía "Authorization: Bearer <CRON_SECRET>"
  // automáticamente si la variable está configurada. Si no lo está, el
  // endpoint queda bloqueado para evitar ejecuciones no autorizadas.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "No autorizado: falta CRON_SECRET o el Bearer token no coincide" },
      { status: 401 }
    );
  }

  const startTime = Date.now();
  const resultado: {
    timestamp: string;
    duracionMs: number;
    productos?: number;
    desdeProvinciaIdx?: number;
    hastaProvinciaIdx?: number;
    estaciones?: number;
    completado?: boolean;
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
    console.log(`[cron] Inicio: ${resultado.timestamp}`);

    await asegurarTablaProgreso();
    const desde = await leerProgreso();
    resultado.desdeProvinciaIdx = desde;

    // Primera partición del día: actualizar también el catálogo de productos
    if (desde === 0) {
      resultado.productos = await ingestProductos(db);
    }

    let totalEstaciones = 0;
    let idx = desde;
    let reanudable = false;

    // Tandas de CONCURRENCIA provincias en paralelo, con control de tiempo.
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
      await guardarProgreso(idx);
    }

    const completado = idx >= PROVINCIAS.length && !reanudable;
    if (completado) {
      await guardarProgreso(0); // día completado: reiniciar para mañana
    }
    resultado.hastaProvinciaIdx = idx;
    resultado.completado = completado;
    resultado.estaciones = totalEstaciones;

    // ── Mantenimiento diario (agregados + retención + cierre mensual) ──
    // Solo cuando la ingesta del día está completa; si quedó a medias,
    // el mantenimiento se ejecutará al terminar el día siguiente.
    if (completado) {
      const quedanMs = PRESUPUESTO_MS - (Date.now() - startTime);
      if (quedanMs > 5_000) {
        // Con tiempo: mantenimiento completo (agregados + retención + mes)
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
    // Las cachés de precios NO expiran por reloj (el TTL de 24 h es solo
    // red de seguridad): el refresco normal ocurre aquí, UNA vez por ciclo
    // de datos. La primera visita tras el cron regenera cada caché una vez;
    // el resto del día, coste de lectura de BD = 0.
    if (completado) {
      revalidateTag(TAG_PRECIOS);
      console.log(`[cron] Caché invalidada por evento: tag "${TAG_PRECIOS}"`);
    }

    resultado.duracionMs = Date.now() - startTime;
    console.log(
      `[cron] OK: provincias ${desde}..${idx - 1}, ${totalEstaciones} estaciones en ${resultado.duracionMs}ms (completado=${completado})`
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
