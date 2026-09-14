/**
 * Caché de datos para proteger la cuota de lectura de Turso.
 *
 * Estrategia (compatible con Vercel Hobby):
 *  - Las páginas SSR consultan la BD en cada request → con unstable_cache
 *    el mismo dato se sirve de la caché de Next hasta que expire o se
 *    revalide. Mil visitas → 1 lectura a Turso en vez de mil.
 *  - La ventana de caché es corta (15 min por defecto): los precios
 *    siguen percibiéndose "de hoy" sin machacar la BD.
 *  - En desarrollo (sin TURSO_DATABASE_URL) unstable_cache también
 *    aplica; se limpia en cada recarga de dev.
 *
 * Todos los wrappers son no-op seguros si React no está disponible
 * (scripts CLI fuera de request): devuelven la función tal cual.
 */
import { unstable_cache } from "next/cache";
import { isTurso } from "./index";

/** Minutos que vive el caché de agregados "actuales" (medias, cobertura). */
export const REVALIDATE_PRECIOS = 900; // 15 min
/** Minutos para series históricas/agregados mensuales (muy estables). */
export const REVALIDATE_HISTORICO = 21600; // 6 h
/** Minutos para listados estructurales (geo, cobertura sitemap). */
export const REVALIDATE_ESTRUCTURA = 86400; // 24 h

/**
 * Envuelve una función async de lectura con unstable_cache.
 * `claves` participan de la clave de caché (ids, fechas de corte...).
 */
export function cacheada<T>(
  fn: () => Promise<T>,
  clave: string[],
  revalidateSegundos: number
): Promise<T> {
  if (process.env.DB_NO_CACHE === "1") return fn();
  // BD local (file:): las consultas son <50 ms y el dato cambia a diario;
  // unstable_cache solo aporta en producción con Turso remoto (y en local
  // interfiere con el driver nativo en `next start`).
  if (!isTurso) return fn();
  const memo = unstable_cache(fn, ["fueltrack", ...clave], {
    revalidate: revalidateSegundos,
  });
  return memo();
}
