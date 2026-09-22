/**
 * Normalización de `estaciones.fecha_actualizacion`.
 *
 * La columna es TEXT y contiene DOS formatos históricos mezclados:
 *   - ISO:     "2026-09-22"
 *   - legacy:  "31/03/2025 0:00:00"  (dd/mm/aaaa h:mm:ss)
 *
 * Comparar esa columna como texto es incorrecto: "31/03/2025 0:00:00" es
 * textualmente MAYOR que "2026-08-23" (porque "3" > "2"), así que una ficha
 * de marzo de 2025 se colaba como "reciente", mientras que cualquier fecha
 * legacy que empezara por "0" o "1" quedaba excluida para siempre.
 *
 * Este módulo es la ÚNICA fuente de verdad para interpretar la columna.
 * La antigüedad se calcula siempre con timestamps reales (días de calendario
 * en UTC, igual que `date('now')` de SQLite), nunca con comparaciones de
 * strings.
 */

/** Fecha interpretada, o `null` si el valor no es una fecha utilizable. */
export type FechaActualizacion = Date | null;

/** "2026-09-22", "2026-09-22 06:00:00", "2026-09-22T06:00:00.000Z". */
const FORMATO_ISO =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?Z?)?$/;

/** "31/03/2025", "31/03/2025 0:00:00". */
const FORMATO_LEGACY =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?)?$/;

/** Convierte la fracción de segundo ("123", "1") a milisegundos. */
function aMilisegundos(fraccion: string | undefined): number {
  if (!fraccion) return 0;
  return Number(fraccion.padEnd(3, "0").slice(0, 3));
}

/**
 * Construye la fecha en UTC y descarta fechas inexistentes: `Date` "desborda"
 * el 31/02 al 2 o 3 de marzo, así que se comprueba que los componentes
 * sobrevivan a la construcción.
 */
function construirFecha(
  anio: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  segundo: number,
  milisegundo = 0,
): FechaActualizacion {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (hora > 23 || minuto > 59 || segundo > 59) return null;

  const fecha = new Date(
    Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, milisegundo),
  );
  if (Number.isNaN(fecha.getTime())) return null;

  const intacta =
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia;

  return intacta ? fecha : null;
}

/**
 * Interpreta un valor de `fecha_actualizacion`.
 *
 * Devuelve `null` para nulos, vacíos, formatos desconocidos y fechas
 * imposibles: un valor no interpretable nunca puede considerarse reciente.
 */
export function parseFechaActualizacion(valor: unknown): FechaActualizacion {
  if (typeof valor !== "string") return null;

  const texto = valor.trim();
  if (texto === "") return null;

  const iso = FORMATO_ISO.exec(texto);
  if (iso) {
    return construirFecha(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
      aMilisegundos(iso[7]),
    );
  }

  // dd/mm/aaaa: el grupo 1 es el día y el 3 el año.
  const legacy = FORMATO_LEGACY.exec(texto);
  if (legacy) {
    return construirFecha(
      Number(legacy[3]),
      Number(legacy[2]),
      Number(legacy[1]),
      Number(legacy[4] ?? 0),
      Number(legacy[5] ?? 0),
      Number(legacy[6] ?? 0),
      aMilisegundos(legacy[7]),
    );
  }

  return null;
}

/**
 * Días de calendario transcurridos desde `fecha` hasta `referencia`
 * (negativos si la fecha está en el futuro). `null` si la fecha no es válida.
 *
 * Se compara por día de calendario en UTC para que el resultado no dependa de
 * la hora a la que se ejecute, igual que hacía `date('now')` en SQLite: una
 * fecha de hace exactamente 30 días sigue siendo "de los últimos 30 días".
 */
export function diasDeAntiguedad(
  fecha: FechaActualizacion,
  referencia: Date = new Date(),
): number | null {
  if (!fecha) return null;

  const diaReferencia = Date.UTC(
    referencia.getUTCFullYear(),
    referencia.getUTCMonth(),
    referencia.getUTCDate(),
  );
  const diaFecha = Date.UTC(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth(),
    fecha.getUTCDate(),
  );

  return Math.round((diaReferencia - diaFecha) / 86_400_000);
}

/** `true` solo si la fecha es válida y tiene como mucho `diasMaximos` días. */
export function esFechaFresca(
  fecha: FechaActualizacion,
  diasMaximos: number,
  referencia: Date = new Date(),
): boolean {
  const dias = diasDeAntiguedad(fecha, referencia);
  return dias !== null && dias <= diasMaximos;
}
