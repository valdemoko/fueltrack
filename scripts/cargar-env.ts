/**
 * Carga de `.env.local` para los scripts de línea de comandos.
 *
 * POR QUÉ EXISTE
 *   Next.js carga `.env.local` por su cuenta (y sabe quitar las comillas),
 *   pero `tsx` no carga ningún fichero de entorno. Los scripts de este
 *   directorio se ejecutan con `tsx`, así que si no lo cargan ellos, ven
 *   `DATABASE_URL` como `undefined`.
 *
 * OJO CON LAS COMILLAS
 *   `.env.local` declara la URL entre comillas:
 *     DATABASE_URL="postgresql://usuario:clave@host/base?sslmode=require"
 *   Si se copia el valor tal cual, la cadena EMPIEZA por `"` y ninguna
 *   comprobación (ni `isPostgres`, ni el cliente de Neon) la reconoce: el
 *   fallo se ve como "la BD no responde", no como "hay una comilla de más".
 *   Aquí se quitan las comillas envolventes.
 *
 * Las variables ya presentes en `process.env` NUNCA se sobrescriben: así se
 * puede apuntar un script a otra base (`DATABASE_URL=… npx tsx …`).
 */
import { readFileSync, existsSync } from "node:fs";

/** Quita comillas envolventes (simples o dobles) de un valor. */
export function sinComillas(valor: string): string {
  const v = valor.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Carga `.env.local` en `process.env` (sin sobrescribir lo ya definido). */
export function cargarEnvLocal(ruta = ".env.local"): void {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, "utf-8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (!m) continue;
    const [, clave, valor] = m;
    if (!process.env[clave]) process.env[clave] = sinComillas(valor);
  }
}
