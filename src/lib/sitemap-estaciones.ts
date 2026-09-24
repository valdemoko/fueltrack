/**
 * Selección de las fichas de estación que entran en el sitemap.
 *
 * Está aquí (y no dentro de `app/sitemap.ts`) por una razón de testabilidad:
 * es la única parte de la generación del sitemap que tiene reglas delicadas
 * —mezcla de fechas ISO y legacy, orden, tope— y toda ella depende SOLO de las
 * filas, no de la base de datos. Así se puede validar con datos reales sin
 * levantar un Postgres.
 *
 * El filtro de frescura NO se hace en SQL a propósito. `fecha_actualizacion`
 * mezcla formatos (`2026-09-24` y `27/08/2026`) y una comparación de texto
 * daba por recientes fichas de 2025; ver `src/lib/fecha.ts`. Se filtra y se
 * ordena en memoria con timestamps reales, y el tope se aplica DESPUÉS de
 * filtrar: con el LIMIT en SQL los primeros registros eran casi todos
 * obsoletos y el sitemap podía quedarse sin ninguna ficha de estación.
 */
import { parseFechaActualizacion, esFechaFresca } from "./fecha";

/** Fila cruda de `estaciones`: la fecha viene tal cual está en la BD. */
export interface FilaEstacionCandidata {
  id: string;
  fecha_actualizacion: string;
}

/** Estación seleccionada, con la fecha ya interpretada. */
export interface EstacionSeleccionada {
  id: string;
  fecha: Date;
}

/**
 * Filtra por frescura, ordena de más reciente a más antigua (desempate por id
 * ascendente, para que el orden sea estable) y recorta al tope.
 *
 * @param candidatas - filas de `estaciones` que pasan el gate del municipio
 * @param maxDias - antigüedad máxima en días para considerar la ficha útil
 * @param tope - número máximo de fichas a incluir
 */
export function seleccionarEstacionesFrescas(
  candidatas: FilaEstacionCandidata[],
  maxDias: number,
  tope: number,
  ahora?: Date,
): EstacionSeleccionada[] {
  return candidatas
    .map((e) => ({
      id: e.id,
      fecha: parseFechaActualizacion(e.fecha_actualizacion),
    }))
    .filter((e): e is EstacionSeleccionada => esFechaFresca(e.fecha, maxDias, ahora))
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || (a.id < b.id ? -1 : 1))
    .slice(0, tope);
}
