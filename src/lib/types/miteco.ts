/**
 * Tipos TypeScript para la API oficial de MITECO (Ministerio para la Transición Ecológica)
 * Fuente: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/
 *
 * Licencia: CC BY 4.0 (EU 2023/138 / Ley 37/2007)
 */

// ─── Respuesta de estaciones (precio actual) ────────────────────────────────

/** Respuesta cruda del endpoint EstacionesTerrestres/FiltroProvincia/{id} */
export interface MitecoEstacionesResponse {
  /** Fecha de la consulta en formato "dd/MM/yyyy HH:mm:ss" */
  Fecha: string;
  /** Lista de estaciones con precios */
  ListaEESSPrecio: MitecoEstacionRaw[];
}

/** Estación individual con todos sus campos tal como llega de la API */
export interface MitecoEstacionRaw {
  /** Código postal */
  "C.P.": string;
  /** Dirección de la estación */
  Dirección: string;
  /** Horario de apertura */
  Horario: string;
  /** Latitud en formato decimal español (coma como separador) */
  Latitud: string;
  /** Localidad */
  Localidad: string;
  /** Longitud WGS84 en formato decimal español */
  "Longitud (WGS84)": string;
  /** Tipo de margen: D (dirección), I (indep.), N (no aplica) */
  Margen: string;
  /** Nombre del municipio */
  Municipio: string;
  /** Provincia */
  Provincia: string;
  /** Tipo de remisión: dm (diaria manual), etc. */
  Remisión: string;
  /** Nombre comercial / marca de la estación */
  Rótulo: string;
  /** Tipo de venta: P (público), A (auto...) */
  "Tipo Venta": string;
  /** Porcentaje de bioetanol (formato español: "0,0") */
  "% BioEtanol": string;
  /** Porcentaje de éster metílico */
  "% Éster metílico": string;
  /** ID de la estación (identificador estable IDEESS) */
  IDEESS: string;
  /** ID del municipio */
  IDMunicipio: string;
  /** ID de la provincia */
  IDProvincia: string;
  /** ID de la Comunidad Autónoma */
  IDCCAA: string;

  // ─── Precios de combustibles (vacío si no disponible) ─────────────────────
  "Precio Gasolina 95 E5": string;
  "Precio Gasolina 95 E10": string;
  "Precio Gasolina 95 E25": string;
  "Precio Gasolina 95 E85": string;
  "Precio Gasolina 95 E5 Premium": string;
  "Precio Gasolina 98 E5": string;
  "Precio Gasolina 98 E10": string;
  "Precio Gasoleo A": string;
  "Precio Gasoleo B": string;
  "Precio Gasoleo Premium": string;
  "Precio Gasolina Renovable": string;
  "Precio Diésel Renovable": string;
  "Precio Gases licuados del petróleo": string;
  "Precio Gas Natural Comprimido": string;
  "Precio Gas Natural Licuado": string;
  "Precio Hidrogeno": string;
  "Precio Adblue": string;
  "Precio Biodiesel": string;
  "Precio Bioetanol": string;
  "Precio Biogas Natural Comprimido": string;
  "Precio Biogas Natural Licuado": string;
  "Precio Fuelóleo bajo índice azufre": string;
  "Precio Fuelóleo especial": string;
  "Precio Gasóleo para uso marítimo": string;
  "Precio Gasolina de aviación": string;
  "Precio Queroseno de aviación JET_A1": string;
  "Precio Queroseno de aviación JET_A2": string;
  "Precio Metanol": string;
  "Precio Amoniaco": string;
}

// ─── Respuesta de productos petrolíferos ────────────────────────────────────

/** Respuesta del endpoint Listados/ProductosPetroliferos/ (XML parseado) */
export interface MitecoProductosResponse {
  ProductosPetroliferos: MitecoProductoRaw[];
}

/** Producto individual */
export interface MitecoProductoRaw {
  IDProducto: number;
  NombreProducto: string;
  NombreProductoAbreviatura: string;
}

// ─── Respuesta de histórico ─────────────────────────────────────────────────

/** Respuesta del endpoint EstacionesTerrestresHist/{dd-MM-yyyy} */
export interface MitecoHistoricoResponse {
  Fecha: string;
  ListaEESSPrecio: MitecoEstacionRaw[];
}

// ─── Tipos normalizados (dominio propio) ────────────────────────────────────

/** ID de Comunidad Autónoma (tipo branded) */
export type CcaaId = string & { readonly __brand: "CcaaId" };

/** ID de Provincia (tipo branded) */
export type ProvinciaId = string & { readonly __brand: "ProvinciaId" };

/** ID de Municipio (tipo branded) */
export type MunicipioId = string & { readonly __brand: "MunicipioId" };

/** ID de Estación - IDEESS (tipo branded) */
export type EstacionId = string & { readonly __brand: "EstacionId" };

/** ID de Producto (tipo branded) */
export type ProductoId = number & { readonly __brand: "ProductoId" };

/** Comunidad Autónoma normalizada */
export interface Ccaa {
  id: CcaaId;
  nombre: string;
}

/** Provincia normalizada */
export interface Provincia {
  id: ProvinciaId;
  ccaaId: CcaaId;
  nombre: string;
}

/** Municipio normalizado */
export interface Municipio {
  id: MunicipioId;
  provinciaId: ProvinciaId;
  nombre: string;
}

/** Estación de servicio normalizada */
export interface Estacion {
  id: EstacionId;
  municipioId: MunicipioId;
  provinciaId: ProvinciaId;
  ccaaId: CcaaId;
  /** Nombre comercial / marca */
  rotulo: string | null;
  /** Dirección */
  direccion: string;
  /** Localidad */
  localidad: string;
  /** Código postal */
  codigoPostal: string;
  /** Latitud WGS84 (decimal, no coma) */
  latitud: number;
  /** Longitud WGS84 (decimal, no coma) */
  longitud: number;
  /** Horario de apertura */
  horario: string;
  /** Tipo de margen */
  margen: string;
  /** Tipo de venta */
  tipoVenta: string;
  /** Porcentaje bioetanol */
  bioetanolPct: number;
  /** Porcentaje éster metílico */
  esterMetilicoPct: number;
}

/** Producto petrolífero normalizado */
export interface Producto {
  id: ProductoId;
  nombre: string;
  abreviatura: string;
}

/** Observación de precio (una lectura en un momento dado) */
export interface PrecioObservacion {
  estacionId: EstacionId;
  productoId: ProductoId;
  /** Fecha/hora de la observación (ISO 8601) */
  fechaObservacion: Date;
  /** Precio en €/litro (null si no disponible) */
  precio: number | null;
}

/** Precios actuales de una estación (agrupados por producto) */
export interface EstacionPrecios {
  estacionId: EstacionId;
  fechaConsulta: Date;
  precios: Record<string, number | null>;
}

// ─── Constantes de dominio ──────────────────────────────────────────────────

/** IDs de productos clave para el MVP */
export const PRODUCTOS_CLAVE = {
  GASOLINA_95_E5: 1,
  GASOLINA_95_E10: 23,
  GASOLINA_95_E5_PREMIUM: 20,
  GASOLINA_98_E5: 3,
  GASOLINA_98_E10: 21,
  GASOLEO_A: 4,
  GASOLEO_PREMIUM: 5,
  GASOLEO_B: 6,
  GASOLEO_C: 7,
  GLP: 17,
  GNC: 18,
  GNL: 19,
  HIDROGENO: 22,
  ADBLUE: 26,
} as const;

/** ID de provincia de Málaga */
export const PROVINCIA_MALAGA = "29" as const;

/** ID de CCAA de Andalucía */
export const CCAA_ANDALUCIA = "01" as const;

/** Mapeo de campos de precio MITECO → ID de producto */
export const MITECO_PRECIO_TO_PRODUCTO: Record<string, number> = {
  "Precio Gasolina 95 E5": 1,
  "Precio Gasolina 95 E10": 23,
  "Precio Gasolina 95 E25": 24,
  "Precio Gasolina 95 E85": 25,
  "Precio Gasolina 95 E5 Premium": 20,
  "Precio Gasolina 98 E5": 3,
  "Precio Gasolina 98 E10": 21,
  "Precio Gasoleo A": 4,
  "Precio Gasoleo B": 6,
  "Precio Gasoleo Premium": 5,
  "Precio Gasolina Renovable": 28,
  "Precio Diésel Renovable": 27,
  "Precio Gases licuados del petróleo": 17,
  "Precio Gas Natural Comprimido": 18,
  "Precio Gas Natural Licuado": 19,
  "Precio Hidrogeno": 22,
  "Precio Adblue": 26,
  "Precio Biodiesel": 8,
  "Precio Bioetanol": 16,
  "Precio Biogas Natural Comprimido": 31,
  "Precio Biogas Natural Licuado": 32,
  "Precio Fuelóleo bajo índice azufre": 9,
  "Precio Fuelóleo especial": 10,
  "Precio Gasóleo para uso marítimo": 11,
  "Precio Gasolina de aviación": 12,
  "Precio Queroseno de aviación JET_A1": 13,
  "Precio Queroseno de aviación JET_A2": 14,
  "Precio Metanol": 29,
  "Precio Amoniaco": 30,
};
