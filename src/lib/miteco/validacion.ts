/**
 * Validación de precios anómalos durante la ingestión.
 *
 * Detecta errores evidentes de ingestión (valores imposibles, saltos
 * súbitos inexplicables respecto a la evolución reciente de la propia
 * estación) sin impedir cambios reales del mercado.
 *
 * Filosofía:
 *  - Límites absolutos por producto (rango físico razonable en €/L).
 *  - Límite relativo: un salto grande respecto al último precio válido de
 *    ESA estación se registra y se marca como sospechoso, pero NO se
 *    descarta por defecto (los mercados pueden moverse rápido; el pipeline
 *    solo descarta lo físicamente imposible).
 *  - Precios nulos o no parseables ya se normalizan como null aguas arriba
 *    (parsePrecio) y aquí no se re-validan.
 */

/** Límites absolutos razonables por producto (€/L). Fuera de este rango el
 *  valor se considera un error de ingestión y NO se guarda. */
export const LIMITES_PRECIO: Record<number, { min: number; max: number }> = {
  1: { min: 0.5, max: 3.0 }, // Gasolina 95 E5
  23: { min: 0.5, max: 3.0 }, // Gasolina 95 E10
  20: { min: 0.5, max: 3.2 }, // Gasolina 95 Premium
  3: { min: 0.5, max: 3.2 }, // Gasolina 98 E5
  21: { min: 0.5, max: 3.2 }, // Gasolina 98 E10
  4: { min: 0.5, max: 3.0 }, // Gasóleo A
  5: { min: 0.5, max: 3.5 }, // Gasóleo Premium
  6: { min: 0.3, max: 2.5 }, // Gasóleo B
  7: { min: 0.3, max: 2.0 }, // Gasóleo C
  17: { min: 0.3, max: 2.5 }, // GLP
  18: { min: 0.3, max: 3.5 }, // GNC (€/kg aprox)
  19: { min: 0.3, max: 3.5 }, // GNL
  26: { min: 0.1, max: 2.0 }, // AdBlue (€/L)
  8: { min: 0.5, max: 3.0 }, // Biodiésel
  16: { min: 0.5, max: 3.0 }, // Bioetanol
};

/** Límites por defecto para productos sin configuración específica. */
const LIMITE_DEFECTO = { min: 0.05, max: 5.0 };

/** Salto relativo máximo respecto al último precio válido de la estación
 *  antes de marcar la observación como sospechosa (0.4 = ±40 %). */
export const UMBRAL_SALTO = 0.4;

export interface LimiteProducto {
  min: number;
  max: number;
}

/** Límites aplicables a un producto. */
export function limitesProducto(productoId: number): LimiteProducto {
  return LIMITES_PRECIO[productoId] ?? LIMITE_DEFECTO;
}

export interface ResultadoValidacion {
  valido: boolean;
  /** true si el valor es numéricamente válido pero sospechoso (salto grande) */
  sospechoso: boolean;
  motivo: string | null;
}

/**
 * Valida un precio individual.
 * @param precio Precio parseado en €/L (null = sin dato; siempre válido)
 * @param productoId ID del producto (para límites absolutos)
 * @param precioAnterior Último precio válido previo de la misma estación y
 *        producto (opcional; activa la detección de saltos)
 */
export function validarPrecio(
  precio: number | null,
  productoId: number,
  precioAnterior?: number | null
): ResultadoValidacion {
  if (precio === null) {
    return { valido: true, sospechoso: false, motivo: null };
  }
  if (!Number.isFinite(precio)) {
    return { valido: false, sospechoso: false, motivo: "no-numérico" };
  }

  const { min, max } = limitesProducto(productoId);
  if (precio < min) {
    return {
      valido: false,
      sospechoso: false,
      motivo: `precio ${precio} por debajo del mínimo físico (${min})`,
    };
  }
  if (precio > max) {
    return {
      valido: false,
      sospechoso: false,
      motivo: `precio ${precio} por encima del máximo físico (${max})`,
    };
  }

  if (
    precioAnterior != null &&
    precioAnterior > 0 &&
    Number.isFinite(precioAnterior)
  ) {
    const salto = Math.abs(precio - precioAnterior) / precioAnterior;
    if (salto > UMBRAL_SALTO) {
      return {
        valido: true,
        sospechoso: true,
        motivo: `salto de ${(salto * 100).toFixed(1)} % respecto al precio anterior (${precioAnterior})`,
      };
    }
  }

  return { valido: true, sospechoso: false, motivo: null };
}

// ─── Validación de lotes con memoria por estación ──────────────────────────

/** Precio normalizado que produce extraerPrecios. */
export interface PrecioNormalizadoIngesta {
  estacionId: string;
  productoId: number;
  fechaObservacion: string;
  precio: number | null;
}

export interface ResumenValidacionLote {
  aceptados: PrecioNormalizadoIngesta[];
  descartados: Array<PrecioNormalizadoIngesta & { motivo: string }>;
  sospechosos: Array<PrecioNormalizadoIngesta & { motivo: string }>;
}

/**
 * Valida un lote de precios de una misma ingesta (misma fecha, muchas
 * estaciones). Mantiene el último precio válido por (estación, producto)
 * para detectar saltos respecto a la propia estación.
 *
 * @param precios Lote de precios normalizados (mismo día de observación)
 * @param anterior Último precio válido previo por (estacionId, productoId)
 *        tal como está en la BD antes de la ingesta. Si no se proporciona,
 *        no se detectan saltos (solo límites absolutos).
 */
export function validarLotePrecios(
  precios: PrecioNormalizadoIngesta[],
  anterior?: Map<string, number>
): ResumenValidacionLote {
  const aceptados: PrecioNormalizadoIngesta[] = [];
  const descartados: Array<PrecioNormalizadoIngesta & { motivo: string }> = [];
  const sospechosos: Array<PrecioNormalizadoIngesta & { motivo: string }> = [];

  const previos = new Map<string, number>(anterior ?? []);

  for (const p of precios) {
    if (p.precio === null) continue; // sin dato: no se valida ni se guarda

    const clave = `${p.estacionId}:${p.productoId}`;
    const previo = previos.get(clave) ?? null;
    const resultado = validarPrecio(p.precio, p.productoId, previo);

    if (!resultado.valido) {
      descartados.push({ ...p, motivo: resultado.motivo ?? "inválido" });
      continue;
    }
    if (resultado.sospechoso) {
      sospechosos.push({ ...p, motivo: resultado.motivo ?? "sospechoso" });
    }

    aceptados.push(p);
    // El precio aceptado pasa a ser la referencia para la siguiente observación
    previos.set(clave, p.precio);
  }

  return { aceptados, descartados, sospechosos };
}
