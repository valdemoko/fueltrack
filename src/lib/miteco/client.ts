/**
 * Cliente para la API oficial de MITECO
 * Fuente: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/
 *
 * Licencia: CC BY 4.0 (EU 2023/138 / Ley 37/2007)
 *
 * Regla: el navegador nunca llama directamente a MITECO.
 * Toda comunicación pasa por este módulo server-side.
 */
import type {
  MitecoEstacionesResponse,
  MitecoHistoricoResponse,
  MitecoProductoRaw,
} from "@/lib/types/miteco";

/** URL base de la API MITECO */
const BASE_URL =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes";

/** Timeout para peticiones HTTP (ms) — histórico devuelve ~11k estaciones, a veces >30s */
const REQUEST_TIMEOUT = 60_000;

/** Máximo reintentos en caso de timeout/abort */
const MAX_RETRIES = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parsea un precio en formato español ("1,789") a número (1.789).
 * Devuelve null si el valor es vacío, "-", o no es parseable.
 */
export function parsePrecio(value: string): number | null {
  if (!value || value === "" || value === "-" || value === "N/A") {
    return null;
  }
  // Reemplazar coma decimal por punto
  const normalized = value.replace(",", ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parsea un porcentaje en formato español ("0,0") a número (0.0).
 */
export function parsePorcentaje(value: string): number {
  if (!value || value === "") return 0;
  const normalized = value.replace(",", ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parsea coordenadas WGS84 en formato español ("37,206167") a número (37.206167).
 * Devuelve null si el valor es vacío o inválido (datos antiguos sin coordenadas).
 */
export function parseCoordenada(value: string): number | null {
  if (!value || value.trim() === "") return null;
  const normalized = value.replace(",", ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Realiza una petición HTTP con timeout y reintentos.
 * Reintenta hasta 3 veces con backoff si la petición falla o se aborta.
 */
async function fetchWithTimeout(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json, application/xml, text/xml",
        },
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        // Backoff: 2s, 5s, 10s
        const backoff = [2_000, 5_000, 10_000][attempt];
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw new Error(`Petición falló tras ${MAX_RETRIES} intentos: ${String(lastError)}`);
}

/**
 * Parsea la respuesta JSON de productos a un array de objetos tipados.
 * La API devuelve un array JSON con strings (IDProducto es string en JSON).
 */
function parseProductosJson(data: unknown): MitecoProductoRaw[] {
  if (!Array.isArray(data)) return [];

  const productos: MitecoProductoRaw[] = [];
  for (const item of data) {
    if (
      item &&
      typeof item === "object" &&
      "IDProducto" in item &&
      "NombreProducto" in item &&
      "NombreProductoAbreviatura" in item
    ) {
      const raw = item as Record<string, string>;
      productos.push({
        IDProducto: parseInt(String(raw.IDProducto), 10),
        NombreProducto: String(raw.NombreProducto),
        NombreProductoAbreviatura: String(raw.NombreProductoAbreviatura),
      });
    }
  }
  return productos;
}

// ─── Funciones públicas ─────────────────────────────────────────────────────

/**
 * Obtiene las estaciones con precios actuales de una provincia.
 * @param provinciaId - ID de la provincia (ej: "29" para Málaga)
 */
export async function fetchEstacionesByProvincia(
  provinciaId: string
): Promise<MitecoEstacionesResponse> {
  const url = `${BASE_URL}/EstacionesTerrestres/FiltroProvincia/${provinciaId}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(
      `Error al obtener estaciones de la provincia ${provinciaId}: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as MitecoEstacionesResponse;

  if (!data.ListaEESSPrecio || !Array.isArray(data.ListaEESSPrecio)) {
    throw new Error(
      `Respuesta inválida de MITECO: formato inesperado para provincia ${provinciaId}`
    );
  }

  return data;
}

/**
 * Obtiene el histórico de estaciones para una fecha específica.
 * @param fecha - Fecha en formato "dd-MM-yyyy" (ej: "13-09-2026")
 */
export async function fetchHistorico(
  fecha: string
): Promise<MitecoHistoricoResponse> {
  const url = `${BASE_URL}/EstacionesTerrestresHist/${fecha}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(
      `Error al obtener histórico para ${fecha}: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as MitecoHistoricoResponse;

  if (!data.ListaEESSPrecio || !Array.isArray(data.ListaEESSPrecio)) {
    throw new Error(
      `Respuesta inválida de MITECO histórico: formato inesperado para fecha ${fecha}`
    );
  }

  return data;
}

/**
 * Obtiene la lista de productos petrolíferos.
 * La API devuelve un array JSON de objetos con IDProducto, NombreProducto, NombreProductoAbreviatura.
 */
export async function fetchProductos(): Promise<MitecoProductoRaw[]> {
  const url = `${BASE_URL}/Listados/ProductosPetroliferos/`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(
      `Error al obtener productos: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const productos = parseProductosJson(data);

  if (productos.length === 0) {
    throw new Error("No se pudieron parsear productos de la respuesta JSON");
  }

  return productos;
}
