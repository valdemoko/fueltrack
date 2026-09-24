/**
 * Conexión a la base de datos — PostgreSQL (Neon).
 *
 * UN SOLO DRIVER: `@neondatabase/serverless` en modo HTTP + `drizzle-orm/neon-http`.
 *
 * ── Por qué NO hay soporte de fichero SQLite aquí ─────────────────────────
 *
 * El motor anterior (libSQL/Turso) facturaba **por fila** leída y escrita, y
 * contar las entradas de índice hacía que una sola fila costase entre 4 y 7
 * escrituras facturables. Un único trasvase de 2,86 M de filas se llevó 12,55 M
 * del cupo mensual. Postgres no cobra filas, así que ese problema desaparece
 * por construcción: aquí no se optimiza para el contador, sino para el usuario.
 *
 * ── IMPORTANTE: `db` solo tiene `execute()` ───────────────────────────────
 *
 * `NeonHttpDatabase` extiende `PgDatabase`, y en drizzle 0.45 `PgDatabase` NO
 * expone `all()`, `get()` ni `run()` (eso es del dialecto SQLite). Por eso todo
 * el acceso a datos pasa por los envoltorios de este fichero:
 *
 *   queryAll / queryGet / queryRun
 *
 * No llames a `db.all(...)`: no existe y el compilador no te lo va a decir
 * hasta que cambies este fichero. Y sobre los constructores de consultas
 * (`.insert(...)`, `.select(...)`) usa `.execute()`, nunca `.run()`.
 */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema";

/**
 * URL de la base de datos. Solo `DATABASE_URL` (Neon).
 *
 * NO hay respaldo a `TURSO_DATABASE_URL`: aquella cadena es `libsql://` y el
 * driver HTTP de Postgres no sabe leerla. Si se cayera en ella, el error que
 * vería el usuario sería un fallo de red sin relación aparente con la
 * configuración; es mejor que la ausencia de `DATABASE_URL` se note como tal.
 */
const DATABASE_URL = process.env.DATABASE_URL || "";

/**
 * URI efectiva con la contraseña oculta. Los scripts la imprimen, así que
 * NUNCA debe contener credenciales.
 */
export const URL_EFECTIVA = DATABASE_URL
  ? DATABASE_URL.replace(/\/\/[^@/]*@/, "//***@")
  : "(sin DATABASE_URL)";

/**
 * Cliente HTTP de Neon.
 *
 * Si falta la URL se construye con un valor inerte: así el proyecto compila y
 * la página falla al consultar (con un error claro) en lugar de romper en
 * tiempo de build, que es donde es más difícil de diagnosticar.
 */
const cliente = neon(DATABASE_URL || "postgresql://sin-configurar@localhost/sin-configurar");

/** Instancia Drizzle del driver HTTP de Neon. */
export const db = drizzle(cliente, { schema });

/**
 * Tipo del cliente, para firmas que lo reciben como parámetro
 * (`ingestEstaciones(db, …)`). Antes era `LibSQLDatabase<typeof schema>`;
 * tenerlo en un solo sitio evita que cada módulo adivine el dialecto.
 */
export type DB = typeof db;

/** ¿Estamos configurados contra Postgres? (diagnóstico de scripts y healthcheck) */
export const isPostgres = /^postgres(ql)?:\/\//.test(DATABASE_URL);

/** ¿Hay una URL configurada? (diagnóstico: distinguir "falta config" de "la BD falla") */
export const hayUrl = DATABASE_URL.length > 0;

/*
 * NOTA: aquí vivía `export const isTurso` (el nombre del motor anterior). Se ha
 * eliminado, y no por limpieza: `cache.ts` lo usaba como guard
 * (`if (!isTurso) return fn()`) y al quedar fijo en `false` desactivó la caché
 * de datos ENTERA en producción sin lanzar ningún error. Una constante que
 * siempre vale lo mismo pero se lee como una comprobación es una trampa: es
 * mejor que el compilador avise de que el nombre ya no existe.
 */

// ─── Envolturas async unificadas ────────────────────────────────────────────

/** Ejecuta un SELECT y devuelve todas las filas como objetos planos. */
export async function queryAll<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const resultado = await db.execute(query);
  return (resultado as unknown as { rows: T[] }).rows;
}

/** Ejecuta un SELECT y devuelve la primera fila o undefined. */
export async function queryGet<T = Record<string, unknown>>(query: SQL): Promise<T | undefined> {
  const filas = await queryAll<T>(query);
  return filas[0];
}

/** Ejecuta un INSERT/UPDATE/DELETE. Devuelve el número de filas afectadas. */
export async function queryRun(query: SQL): Promise<number> {
  const resultado = await db.execute(query);
  return Number((resultado as unknown as { rowCount?: number }).rowCount ?? 0);
}

/*
 * NOTA: aquí vivía `queryDDL()`, que troceaba un bloque de DDL y le quitaba
 * las claves foráneas. Se ha eliminado junto con los `CREATE TABLE` que los
 * scripts de seed llevaban dentro: eran un SEGUNDO esquema, distinto del de
 * `schema.ts` (usaban `REAL`, que en Postgres es float4, no double precision).
 *
 * El esquema tiene una sola fuente de verdad:
 *
 *   src/lib/db/schema.ts  →  npm run db:generate  →  ./drizzle/*.sql  →  npm run db:migrate
 *
 * Las claves foráneas siguen SIN existir, pero ahora por decisión explícita en
 * `schema.ts` (MITECO publica filas que las incumplen), no por un borrado
 * silencioso de texto.
 */

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
