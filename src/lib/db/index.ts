/**
 * Conexión a la base de datos.
 *
 * UN SOLO DRIVER asíncrono (@libsql/client + drizzle-orm/libsql) para
 * desarrollo y producción:
 *  - Producción: DATABASE_URL = libsql://... (Turso) + DATABASE_AUTH_TOKEN.
 *  - Desarrollo (sin env vars): file:./data/combustible.db (SQLite local,
 *    mismo formato que el better-sqlite3 anterior — cero migración).
 *
 * Todo el acceso a datos de la app usa las envolturas async de este archivo
 * (queryAll / queryGet / queryRun) o `db` con `await`.
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema";

/** URL de Turso: acepta TURSO_DATABASE_URL y el alias clásico DATABASE_URL. */
const DATABASE_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "";
/** Token de Turso: acepta TURSO_AUTH_TOKEN y el alias clásico DATABASE_AUTH_TOKEN. */
const DATABASE_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || "";
/** Modo forzado local para scripts CLI: DB_LOCAL=1 */
const FORCE_LOCAL = process.env.DB_LOCAL === "1";

const isRemote = DATABASE_URL.startsWith("libsql://") || DATABASE_URL.startsWith("https://");
/**
 * Fichero SQLite local (desarrollo y pruebas). Se puede apuntar a otro
 * fichero con LOCAL_DB=./data/otro.db — útil para validar mantenimiento
 * sobre una COPIA sin tocar la base de datos de trabajo (y sin gastar cuota).
 */
const LOCAL_FILE = process.env.LOCAL_DB || "./data/combustible.db";
const url = !FORCE_LOCAL && isRemote ? DATABASE_URL : `file:${LOCAL_FILE}`;

export const isTurso = !FORCE_LOCAL && isRemote;

// El cliente libSQL admite credenciales embebidas en la URL (file:...?authToken=...) y
// la opción authToken (para libsql://). Se resuelven ambas para máxima compatibilidad.
function parseUrlCreds(u: string): { url: string; token?: string } {
  const m = u.match(/^(.*?)(?:\?authToken=(.*))?$/);
  if (!m) return { url: u };
  return { url: m[1], token: m[2] || undefined };
}

const { url: cleanUrl, token: urlToken } = parseUrlCreds(url);

const client: Client = createClient({
  url: cleanUrl,
  authToken: isRemote
    ? DATABASE_AUTH_TOKEN || urlToken || undefined
    : urlToken || undefined,
});

/** Instancia Drizzle del driver libSQL (async). */
export const db = drizzle(client, { schema });

/** URI efectiva en uso (sin credenciales), para logs de scripts y pruebas. */
export const URL_EFECTIVA = isRemote && !FORCE_LOCAL ? DATABASE_URL : `file:${LOCAL_FILE}`;

// ─── Envolturas async unificadas ───────────────────────────────────────────

/** Ejecuta un SELECT y devuelve todas las filas como objetos planos. */
export async function queryAll<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const rows = await db.all(query);
  return rows as unknown as T[];
}

/** Ejecuta un SELECT y devuelve la primera fila o undefined. */
export async function queryGet<T = Record<string, unknown>>(query: SQL): Promise<T | undefined> {
  const row = await db.get(query);
  return row as unknown as (T | undefined);
}

/** Ejecuta un INSERT/UPDATE/DELETE. Devuelve el número de filas afectadas. */
export async function queryRun(query: SQL): Promise<number> {
  const result = await db.run(query);
  return result.rowsAffected;
}

/**
 * Ejecuta varias sentencias en lote (transaccional en Turso).
 * Usado por la ingesta para upserts atómicos.
 */
export async function queryBatch(queries: SQL[]): Promise<void> {
  if (queries.length === 0) return;
  await client.batch(
    queries.map((q) => ({ sql: q as unknown as string, args: [] })),
    "write"
  );
}

/** Comprueba que la BD responde (usado por el healthcheck). */
export async function dbPing(): Promise<boolean> {
  try {
    await queryGet(sql`SELECT 1 AS ok`);
    return true;
  } catch {
    return false;
  }
}

export { schema };
