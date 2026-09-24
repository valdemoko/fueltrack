/**
 * Utilidades de consultas asíncronas (re-export por compatibilidad).
 *
 * Tras la migración a Turso (libSQL), TODO el acceso a datos es asíncrono.
 * Usa queryAll/queryGet/queryRun desde @/lib/db directamente.
 */
export { queryAll, queryGet, queryRun, db, isPostgres, dbPing, schema } from "./index";
