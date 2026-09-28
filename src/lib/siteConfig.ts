/**
 * Configuración central del sitio.
 * Única fuente de verdad para URLs, nombres y entorno.
 * Nada del resto del código debe hardcodear el dominio.
 */

/** URL canónica del sitio en producción (sin barra final) */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://fueltrack.site"
).replace(/\/+$/, "");

/** Nombre corto de la marca */
export const SITE_NAME = "FuelTrack";

/** Nombre largo para SEO */
export const SITE_NAME_LONG = "FuelTrack";

/** Descripción por defecto */
export const SITE_DESCRIPTION =
  "Consulta los precios de gasolina, gasóleo y otros carburantes en estaciones de servicio de toda España. Datos oficiales del MITECO actualizados periódicamente.";

/**
 * Publisher ID de Google AdSense (sin el prefijo "ca-pub-").
 * Se configura mediante NEXT_PUBLIC_ADSENSE_PUBLISHER_ID.
 * Vacío = AdSense desactivado (no se carga ningún script ni se muestra hueco).
 */
export const ADSENSE_PUBLISHER_ID =
  process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID || "";

/** Cliente de la URL completa ca-pub-XXXX */
export const ADSENSE_CLIENT = ADSENSE_PUBLISHER_ID
  ? `ca-pub-${ADSENSE_PUBLISHER_ID}`
  : "";

/**
 * Slots de anuncios AdSense (se configuran por variable de entorno).
 * Sin slot configurado, ese emplazamiento no se renderiza (evita huecos
 * vacíos y errores de "unfilled slot" en AdSense).
 */
export const ADSENSE_SLOT_LISTADO =
  process.env.NEXT_PUBLIC_ADSENSE_SLOT_LISTADO || "";
export const ADSENSE_SLOT_ESTACION =
  process.env.NEXT_PUBLIC_ADSENSE_SLOT_ESTACION || "";
export const ADSENSE_SLOT_CONTENIDO =
  process.env.NEXT_PUBLIC_ADSENSE_SLOT_CONTENIDO || "";

/**
 * URL de la CMP oficial de Google (Privacy & Messaging), generada desde
 * AdSense → Privacidad y mensajes → Reglamentos europeos.
 * Se configura mediante NEXT_PUBLIC_GOOGLE_CMP_SRC con la etiqueta exacta.
 * Vacío = no se carga ninguna CMP (no se sirven anuncios en el EEE).
 */
export const GOOGLE_CMP_SRC =
  process.env.NEXT_PUBLIC_GOOGLE_CMP_SRC || "";

/** Indica si la CMP de Google está configurada */
export const googleCmpEnabled = GOOGLE_CMP_SRC.length > 0;

/**
 * Token de verificación de Google Search Console (contenido del meta tag
 * google-site-verification). Se configura mediante
 * NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION.
 */
export const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "";

/** Indica si AdSense está configurado (publisher ID presente) */
export const adsenseEnabled = ADSENSE_PUBLISHER_ID.length > 0;
