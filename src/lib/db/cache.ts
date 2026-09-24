/**
 * Caché de datos para proteger la cuota de lectura de Turso.
 *
 * Estrategia — INVALIDACIÓN POR EVENTOS (no por reloj):
 *  - Los precios son una foto diaria (cron 06:00 UTC): los datos de días
 *    anteriores NUNCA cambian. Por eso las cachés NO se revalidan cada hora:
 *    llevan un TTL largo solo como red de seguridad (si el cron fallara o no
 *    pudiera invalidar, los datos se refrescan solos al día siguiente).
 *  - Tras la ingesta diaria, el cron llama a `revalidateTag(TAG_PRECIOS)`:
 *    todas las cachés de precios se regeneran EXACTAMENTE una vez por ciclo
 *    de datos, con la primera visita posterior al cron. El resto del día,
 *    coste de lectura = 0 pase lo que pase en la web.
 *  - Los datos estructurales (geografía, cobertura) casi nunca cambian: TTL
 *    semanal + tag "estructura" (solo se invalida si algún día se ingesta
 *    el catálogo de estaciones a mano).
 *  - En desarrollo (BD local file:) no se cachea: las consultas son <50 ms.
 *
 * Todos los wrappers son no-op seguros si React no está disponible
 * (scripts CLI fuera de request): devuelven la función tal cual.
 */
import { unstable_cache } from "next/cache";
import { isTurso } from "./index";

/**
 * TTL de seguridad para datos derivados de precios (resúmenes, series,
 * comparativas…). El camino normal de refresco es el `revalidateTag` del
 * cron; este TTL solo actúa si la invalidación no puede ejecutarse.
 */
export const REVALIDATE_PRECIOS = 86400; // 24 h (red de seguridad)
/** TTL para listados estructurales (geografía, cobertura sitemap). */
export const REVALIDATE_ESTRUCTURA = 604800; // 7 días

/**
 * Caché INDEFINIDA para datos históricos.
 *
 * Los históricos son INMUTABLES: una vez escritos (una sola vez al día, y
 * una sola vez en la vida para las fechas pasadas) nunca cambian. Con
 * `revalidate: false` la entrada se conserva para siempre y no hay que
 * tocarla: ni TTL, ni invalidación por el cron.
 *
 * Para que el dato "actual" de una serie larga no se congele, la CLAVE de
 * estas cachés incluye el día (yyyy-MM-dd): cada día se genera UNA entrada
 * nueva por consulta distinta y la entrada del día anterior ya no se usa.
 * Coste en BD: ≤1 lectura por consulta y día, aunque la web reciba miles de
 * visitas.
 */
export const REVALIDATE_INFINITO = false;

/** Tag de invalidación para todo lo derivado de la tabla `precios`. */
export const TAG_PRECIOS = "precios";
/** Tag de invalidación para datos estructurales (geografía, catálogos). */
export const TAG_ESTRUCTURA = "estructura";
/**
 * Tag de los datos históricos. NADIE lo invalida a propósito (los históricos
 * son inmutables); existe solo para poder purgarlos manualmente si algún día
 * se reescribe un histórico a mano.
 */
export const TAG_HISTORICO = "historico";

/**
 * Envuelve una función async de lectura con unstable_cache.
 * `claves` participan de la clave de caché (ids, fechas de corte...).
 * `tags` permite al cron invalidar el grupo con revalidateTag(tag).
 */
export function cacheada<T>(
  fn: () => Promise<T>,
  clave: string[],
  revalidateSegundos: number | false,
  tags: string[] = []
): Promise<T> {
  if (process.env.DB_NO_CACHE === "1") return fn();
  // BD local (file:): las consultas son <50 ms y el dato cambia a diario;
  // unstable_cache solo aporta en producción con Turso remoto (y en local
  // interfiere con el driver nativo en `next start`).
  if (!isTurso) return fn();
  const memo = unstable_cache(fn, ["fueltrack", ...clave], {
    revalidate: revalidateSegundos,
    tags: ["fueltrack", ...tags],
  });
  return memo();
}
