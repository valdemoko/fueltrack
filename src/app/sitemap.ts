/**
 * Sitemap — estrategia de indexación por calidad.
 *
 * Incluye:
 *   - Páginas estáticas (home, mapa, precios, dashboard nacional, legales)
 *   - /gasolineras (España) + CCAA + provincias + municipios con estaciones
 *   - Variantes combustible+provincia SOLO con cobertura real (>= 50 estaciones
 *     con precio del producto en la provincia)
 *   - Estaciones (tope escalonado, se ampliará según Search Console) con
 *     datos recientes: las fichas obsoletas quedan fuera del índice.
 *
 * NO incluye variantes combustible+municipio (?producto= de municipio):
 * son casi-duplicados de la página base del municipio y con un dominio nuevo
 * y sin autoridad saturaban el crawl budget (Search Console: ~6.500 URLs
 * "Descubierta: actualmente sin indexar", feb 2026). Las páginas siguen
 * existiendo con canonical propia y enlazadas por tabs; se re-añadirán al
 * sitemap cuando las páginas base estén indexadas.
 *
 * Excluye: parámetros de orden, filtros sin datos, páginas vacías y APIs.
 * Prioridad: calidad de contenido sobre cantidad de URLs.
 *
 * NOTA CLOUDFLARE (2026-09-30): la generación usa TRES queries agregadas,
 * no un bucle de queries por CCAA/provincia. En Cloudflare Workers cada
 * round-trip a Neon es una subrequest con un límite por invocación, y el
 * bucle anidado original (19 CCAA × provincias × municipios) lo agotaba:
 * abortaba a la primera CCAA y el catch tragaba el error dejando un
 * sitemap con solo las páginas estáticas.
 */
import type { MetadataRoute } from "next";
import { sql } from "drizzle-orm";
import { db, queryAll, queryGet } from "@/lib/db";
import { SITE_URL } from "@/lib/siteConfig";
import { slugify } from "@/lib/geografia";
import { seleccionarEstacionesFrescas } from "@/lib/sitemap-estaciones";

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  // SIN unstable_cache adicional: la propia ruta /sitemap.xml es estática ISR
  // con revalidate 24 h (configurada por Next para MetadataRoute.Sitemap),
  // así que las queries solo se ejecutan ~1 vez/día. La doble capa de caché
  // además TRAGABA las URLs de municipio+producto en el prerender del build
  // (silenciosamente, sin excepción): sin ella el sitemap sale completo.
  return generarSitemap();
}

/** Municipio: mínimo de estaciones para incluir el municipio y sus estaciones. */
const MIN_ESTACIONES_MUNICIPIO = 3;
/** Combustible+municipio: mínimo de estaciones con precio del producto. */
const MIN_COBERTURA_PRODUCTO_MUNICIPIO = 3;
/** Combustible+provincia: mínimo de estaciones con precio del producto. */
const MIN_COBERTURA_PRODUCTO_PROVINCIA = 50;
/** Tope de URLs de estaciones (escalado gradual por Search Console):
 *  dominio nuevo sin autoridad → crawl budget limitado; mejor 800 URLs
 *  bien rastreadas que 5.000 "descubiertas sin indexar". Ampliar cuando
 *  Search Console muestre indexación masiva de la etapa actual. */
const MAX_ESTACIONES_SITEMAP = 800;
/** Una estación cuyos datos llevan más de X días sin actualizarse es una
 *  ficha sin mantenimiento (MITECO suele observar cada 2-7 días): baja utilidad
 *  individual y riesgo de thin content. Se excluye del sitemap; la página
 *  sigue existiendo y siendo accesible por navegación (remediación 2026-09). */
const MAX_DIAS_SIN_ACTUALIZAR_ESTACION = 30;

/** Nombres amigables para las URLs de combustible. */
const NOMBRE_PRODUCTO: Record<number, string> = {
  1: "gasolina-95",
  3: "gasolina-98",
  4: "gasoleo-a",
  5: "gasoleo-premium",
};

async function generarSitemap(): Promise<MetadataRoute.Sitemap> {
  const fechaDatos = await (async () => {
    try {
      const row = (await db
        .select({ fecha: sql<string>`MAX(fecha_observacion)` })
        .from(sql`precios`)
        .execute())[0] as { fecha: string } | undefined;
      if (!row?.fecha) return new Date();
      const d = new Date(`${row.fecha}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? new Date() : d;
    } catch {
      return new Date();
    }
  })();

  const estaticas: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: fechaDatos, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/gasolineras`, lastModified: fechaDatos, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/precios-espana`, lastModified: fechaDatos, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/precios`, lastModified: fechaDatos, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/mapa`, lastModified: fechaDatos, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/metodologia`, lastModified: fechaDatos, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/autor`, lastModified: fechaDatos, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/aviso-legal`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/politica-privacidad`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/politica-cookies`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/contacto`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.3 },
  ];

  // ─── Geografía: 3 queries agregadas, ensamblado en memoria ─────────────
  let geo: MetadataRoute.Sitemap = [];
  let productoURLs: MetadataRoute.Sitemap = [];
  try {
    const [ccaaRows, provinciaRows, municipioRows] = await Promise.all([
      queryAll<{ id: string; nombre: string }>(sql`
        SELECT c.id, c.nombre FROM ccaa c
        JOIN estaciones e ON e.ccaa_id = c.id
        GROUP BY c.id, c.nombre
        ORDER BY c.nombre
      `),
      queryAll<{ id: string; nombre: string; ccaa_id: string }>(sql`
        SELECT p.id, p.nombre, p.ccaa_id FROM provincias p
        JOIN estaciones e ON e.provincia_id = p.id
        GROUP BY p.id, p.nombre, p.ccaa_id
        ORDER BY p.nombre
      `),
      queryAll<{ id: string; nombre: string; provincia_id: string; n: number }>(sql`
        SELECT m.id, m.nombre, m.provincia_id, COUNT(e.id)::int AS n
        FROM municipios m
        JOIN estaciones e ON e.municipio_id = m.id
        GROUP BY m.id, m.nombre, m.provincia_id
        HAVING COUNT(e.id) >= ${MIN_ESTACIONES_MUNICIPIO}
      `),
    ]);

    const ccaaUrls: MetadataRoute.Sitemap = [];
    const provinciaUrls: MetadataRoute.Sitemap = [];
    const municipioUrls: MetadataRoute.Sitemap = [];

    for (const ccaa of ccaaRows) {
      ccaaUrls.push({
        url: `${SITE_URL}/gasolineras/${slugify(ccaa.nombre)}`,
        lastModified: fechaDatos,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }

    const nombreCcaa = new Map(ccaaRows.map((c) => [c.id, c.nombre]));

    for (const provincia of provinciaRows) {
      const ccaaNombre = nombreCcaa.get(provincia.ccaa_id);
      if (!ccaaNombre) continue;
      provinciaUrls.push({
        url: `${SITE_URL}/gasolineras/${slugify(ccaaNombre)}/${slugify(provincia.nombre)}`,
        lastModified: fechaDatos,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }

    const provinciaPorId = new Map(provinciaRows.map((p) => [p.id, p]));

    for (const municipio of municipioRows) {
      const provincia = provinciaPorId.get(municipio.provincia_id);
      const ccaaNombre = provincia ? nombreCcaa.get(provincia.ccaa_id) : undefined;
      if (!provincia || !ccaaNombre) continue;
      municipioUrls.push({
        url: `${SITE_URL}/gasolineras/${slugify(ccaaNombre)}/${slugify(provincia.nombre)}/${slugify(municipio.nombre)}`,
        lastModified: fechaDatos,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }

    geo = [...ccaaUrls, ...provinciaUrls, ...municipioUrls];

    // ─── Variantes combustible + provincia (cobertura real) ────────────────
    // (per-producto seeks; sin escaneos de 30M filas)
    productoURLs = [];

    // Fechas máximas por producto con datos (1 seek por producto)
    const productosConDatos = (await queryAll(sql`
      SELECT DISTINCT producto_id AS id FROM precios
    `)) as unknown as Array<{ id: number }>;

    const coberturas: Array<{ productoId: number; fecha: string }> = [];
    for (const producto of productosConDatos) {
      const f = (await queryGet(
        sql`SELECT MAX(fecha_observacion) AS fecha FROM precios WHERE producto_id = ${producto.id}`
      )) as unknown as { fecha: string } | undefined;
      if (f?.fecha) coberturas.push({ productoId: producto.id, fecha: f.fecha });
    }

    // Combustible + provincia: UNA query para todos los productos
    const coberturaProvincia: Array<{ provincia_id: string; producto_id: number }> = [];
    for (const { productoId, fecha } of coberturas) {
      const filas = (await queryAll(sql`
        SELECT e.provincia_id
        FROM precios pr JOIN estaciones e ON e.id = pr.estacion_id
        WHERE pr.producto_id = ${productoId}
          AND pr.fecha_observacion = ${fecha}
          AND pr.precio IS NOT NULL
        GROUP BY e.provincia_id
        HAVING COUNT(DISTINCT pr.estacion_id) >= ${MIN_COBERTURA_PRODUCTO_PROVINCIA}
      `)) as unknown as Array<{ provincia_id: string }>;
      for (const fila of filas) {
        coberturaProvincia.push({ provincia_id: fila.provincia_id, producto_id: productoId });
      }
    }

    const nombresProvincias = (await queryAll(sql`
      SELECT p.id, p.nombre, c.nombre AS ccaa_nombre
      FROM provincias p JOIN ccaa c ON c.id = p.ccaa_id
    `)) as unknown as Array<{ id: string; nombre: string; ccaa_nombre: string }>;
    const nombreProv = new Map(
      nombresProvincias.map((p) => [p.id, { nombre: p.nombre, ccaa: p.ccaa_nombre }])
    );

    for (const fila of coberturaProvincia) {
      if (!NOMBRE_PRODUCTO[fila.producto_id]) continue;
      const p = nombreProv.get(fila.provincia_id);
      if (!p) continue;
      productoURLs.push({
        url: `${SITE_URL}/gasolineras/${slugify(p.ccaa)}/${slugify(p.nombre)}?producto=${fila.producto_id}`,
        lastModified: fechaDatos,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }

    // Combustible + municipio — DESACTIVADO (feb 2026): 3.181 URLs de
    // casi-duplicados saturaban el crawl budget de un dominio nuevo.
    // Se re-activará cuando las páginas base estén indexadas (ver git log).
  } catch (error) {
    // DB no disponible en build time — solo páginas estáticas.
    // Log de diagnóstico (auditoría I3): un error silencioso aquí descartaba
    // TODAS las productoURLs sin dejar rastro.
    console.error(
      "[sitemap] Error generando URLs de producto:",
      error instanceof Error ? error.message : error
    );
    if (process.env.SITEMAP_DEBUG === "1") throw error; // diagnóstico
  }

  // ─── Estaciones: top por municipio (staged) ─────────────────────────────
  let estaciones: MetadataRoute.Sitemap = [];
  try {
    // Barato: sin subqueries sobre precios (la página de estación hace su
    // propio gate 404 en middleware). Criterio: municipio indexable.
    const candidatas = (await queryAll(sql`
      SELECT e.id, e.fecha_actualizacion
      FROM estaciones e
      WHERE (
        SELECT COUNT(*) FROM estaciones e2
        WHERE e2.municipio_id = e.municipio_id
      ) >= ${MIN_ESTACIONES_MUNICIPIO}
    `)) as Array<{ id: string; fecha_actualizacion: string }>;

    // Filtro, orden y tope: en memoria y con timestamps reales (ver
    // src/lib/sitemap-estaciones.ts para el porqué de cada regla).
    estaciones = seleccionarEstacionesFrescas(
      candidatas,
      MAX_DIAS_SIN_ACTUALIZAR_ESTACION,
      MAX_ESTACIONES_SITEMAP,
    ).map((e) => ({
      url: `${SITE_URL}/estacion/${e.id}`,
      lastModified: e.fecha,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    }));
  } catch (error) {
    // El sitemap se genera igualmente, sin las fichas de estación.
    console.error(
      "[sitemap] Falló la consulta de estaciones; se continúa sin ellas:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  }

  return [...estaticas, ...geo, ...productoURLs, ...estaciones];
}
