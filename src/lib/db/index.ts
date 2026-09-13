/**
 * Conexión a la base de datos SQLite
 * Inicializa better-sqlite3 + Drizzle ORM
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/** Ruta al archivo de base de datos */
const DB_PATH = "./data/combustible.db";

/** Instancia de better-sqlite3 */
const sqlite = new Database(DB_PATH);

// Desactivar foreign keys para ingesta (MITECO no inserta municipios primero)
sqlite.pragma("foreign_keys = OFF");

/** Base de datos Drizzle con schema tipado */
export const db = drizzle(sqlite, { schema });
