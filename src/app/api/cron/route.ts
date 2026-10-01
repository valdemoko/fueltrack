/**
 * Endpoint de actualización manual de precios (HTTP).
 *
 * En Vercel este endpoint lo invocaba el cron diario de `vercel.json`
 * ("Authorization: Bearer $CRON_SECRET"). Desde la migración a Cloudflare la
 * ejecución AUTOMÁTICA corre en el handler `scheduled` del worker (Cron
 * Trigger semanal); este endpoint queda como vía MANUAL segura de disparar el
 * mismo proceso (pruebas, recuperación) sin duplicar lógica: ambos llaman a
 * `ejecutarActualizacion()` de `@/lib/actualizacion`.
 *
 * IDEMPOTENTE y REANUDABLE: el progreso se persiste en `cron_progreso`; ver
 * la documentación de ese módulo. Con `?forzar=1` se reingesta el país entero.
 *
 * Protegido por CRON_SECRET: sin la cabecera
 * "Authorization: Bearer <CRON_SECRET>" responde 401 para no dejar la ingesta
 * abierta al público.
 */
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  ejecutarActualizacion,
  type ResultadoActualizacion,
} from "@/lib/actualizacion";
import { TAG_PRECIOS } from "@/lib/db/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Sin CRON_SECRET configurado el endpoint queda bloqueado (401): igual que
  // en Vercel, no se permite una ingesta pública por falta de configuración.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "No autorizado: falta CRON_SECRET o el Bearer token no coincide" },
      { status: 401 }
    );
  }

  const forzar = new URL(request.url).searchParams.get("forzar") === "1";
  const resultado: ResultadoActualizacion = await ejecutarActualizacion({ forzar });

  // ── Invalidación de caché por evento ─────────────────────────────────
  // Solo los datos de PRECIOS ACTUALES: las cachés de históricos son
  // indefinidas y nadie las invalida (los históricos no cambian).
  if (resultado.completado) {
    revalidateTag(TAG_PRECIOS);
    console.log(`[cron] Caché invalidada por evento: tag "${TAG_PRECIOS}"`);
  }

  return NextResponse.json(
    { success: resultado.errores.length === 0, ...resultado },
    { status: resultado.errores.length > 0 && !resultado.completado ? 500 : 200 }
  );
}
