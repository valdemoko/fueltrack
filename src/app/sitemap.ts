/**
 * Sitemap — estrategia de indexación por calidad.
 *
 * Incluye:
 *   - Páginas estáticas (home, mapa, precios, dashboard nacional, legales)
 *   - /gasolineras (España) + CCAA + provincias + municipios con estaciones
 *   - Variantes combustible+provincia SOLO con cobertura real (>= 50 estaciones
 *     con precio del producto en la provincia)
 *   - Variantes combustible+municipio SOLO con cobertura real (>= 3 estaciones)
 *     usando la URL canónica ?producto=<id>
 *   - Estaciones con precio (tope de seguridad, escalonado)
 *
 * Excluye: parámetros de orden, filtros sin datos, páginas vacías y APIs.
 * Prioridad: calidad de contenido sobre cantidad de URLs.
 */
import type { MetadataRoute } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { SITE_URL } from "@/lib/siteConfig";
import { slugify } from "@/lib/geografia";

export const dynamic = "force-dynamic";

/** Municipio: mínimo de estaciones para incluir el municipio y sus estaciones. */
const MIN_ESTACIONES_MUNICIPIO = 3;
/** Combustible+municipio: mínimo de estaciones con precio del producto. */
const MIN_COBERTURA_PRODUCTO_MUNICIPIO = 3;
/** Combustible+provincia: mínimo de estaciones con precio del producto. */
const MIN_COBERTURA_PRODUCTO_PROVINCIA = 50;
/** Tope de URLs de estaciones (escalado gradual por Search Console). */
const MAX_ESTACIONES_SITEMAP = 5000;

/** Nombres amigables para las URLs de combustible. */
const NOMBRE_PRODUCTO: Record<number, string> = {
  1: "gasolina-95",
  3: "gasolina-98",
  4: "gasoleo-a",
  5: "gasoleo-premium",
};

export default function sitemap(): MetadataRoute.Sitemap {
  const fechaDatos = (() => {
    try {
      const row = db
        .select({ fecha: sql<string>`MAX(fecha_observacion)` })
        .from(sql`precios`)
        .get() as { fecha: string } | undefined;
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
    { url: `${SITE_URL}/aviso-legal`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/politica-privacidad`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/politica-cookies`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/contacto`, lastModified: fechaDatos, changeFrequency: "yearly", priority: 0.3 },
  ];

  // ─── Geografía: CCAA → provincias → municipios con estaciones ──────────
  let geo: MetadataRoute.Sitemap = [];
  let productoURLs: MetadataRoute.Sitemap = [];
  try {
    const ccaaRows = db
      .all(
        sql`SELECT c.id, c.nombre FROM ccaa c
            JOIN estaciones e ON e.ccaa_id = c.id
            GROUP BY c.id, c.nombre`
      )
      .map((r: unknown) => r as { id: string; nombre: string });

    const ccaaUrls: MetadataRoute.Sitemap = [];
    const provinciaUrls: MetadataRoute.Sitemap = [];
    const municipioUrls: MetadataRoute.Sitemap = [];

    for (const ccaa of ccaaRows) {
      const ccaaSlug = slugify(ccaa.nombre);
      ccaaUrls.push({
        url: `${SITE_URL}/gasolineras/${ccaaSlug}`,
        lastModified: fechaDatos,
        changeFrequency: "daily",
        priority: 0.8,
      });

      const provincias = db
        .all(
          sql`SELECT p.id, p.nombre FROM provincias p
              JOIN estaciones e ON e.provincia_id = p.id
              WHERE p.ccaa_id = ${ccaa.id}
              GROUP BY p.id, p.nombre`
        )
        .map((r: unknown) => r as { id: string; nombre: string });

      for (const provincia of provincias) {
        const provinciaSlug = slugify(provincia.nombre);
        provinciaUrls.push({
          url: `${SITE_URL}/gasolineras/${ccaaSlug}/${provinciaSlug}`,
          lastModified: fechaDatos,
          changeFrequency: "daily",
          priority: 0.8,
        });

        // Municipios con suficientes estaciones (calidad > cantidad)
        const municipios = db
          .all(sql`
            SELECT m.id, m.nombre, COUNT(e.id) AS n
            FROM municipios m
            JOIN estaciones e ON e.municipio_id = m.id
            WHERE m.provincia_id = ${provincia.id}
            GROUP BY m.id, m.nombre
            HAVING n >= ${MIN_ESTACIONES_MUNICIPIO}
          `) as Array<{ id: string; nombre: string; n: number }>;

        for (const municipio of municipios) {
          municipioUrls.push({
            url: `${SITE_URL}/gasolineras/${ccaaSlug}/${provinciaSlug}/${slugify(municipio.nombre)}`,
            lastModified: fechaDatos,
            changeFrequency: "daily",
            priority: 0.7,
          });
        }
      }
    }

    geo = [...ccaaUrls, ...provinciaUrls, ...municipioUrls];

    // ─── Variantes combustible + provincia / municipio (cobertura real) ───
    // (per-producto seeks; sin escaneos de 30M filas)
    productoURLs = [];

    // Fechas máximas por producto con datos (1 seek por producto)
    const productosConDatos = db.all(sql`
      SELECT id FROM productos WHERE EXISTS (
        SELECT 1 FROM precios WHERE precios.producto_id = productos.id
      )
    `) as unknown as Array<{ id: number }>;

    const coberturas: Array<{ productoId: number; fecha: string }> = [];
    for (const producto of productosConDatos) {
      const f = db.get(
        sql`SELECT MAX(fecha_observacion) AS fecha FROM precios WHERE producto_id = ${producto.id}`
      ) as unknown as { fecha: string } | undefined;
      if (f?.fecha) coberturas.push({ productoId: producto.id, fecha: f.fecha });
    }

    // Combustible + provincia
    const coberturaProvincia: Array<{ provincia_id: string; producto_id: number }> = [];
    for (const { productoId, fecha } of coberturas) {
      const filas = db.all(sql`
        SELECT e.provincia_id
        FROM precios pr JOIN estaciones e ON e.id = pr.estacion_id
        WHERE pr.producto_id = ${productoId}
          AND pr.fecha_observacion = ${fecha}
          AND pr.precio IS NOT NULL
        GROUP BY e.provincia_id
        HAVING COUNT(DISTINCT pr.estacion_id) >= ${MIN_COBERTURA_PRODUCTO_PROVINCIA}
      `) as unknown as Array<{ provincia_id: string }>;
      for (const fila of filas) {
        coberturaProvincia.push({ provincia_id: fila.provincia_id, producto_id: productoId });
      }
    }

    const nombresProvincias = db.all(sql`
      SELECT p.id, p.nombre, c.nombre AS ccaa_nombre
      FROM provincias p JOIN ccaa c ON c.id = p.ccaa_id
    `) as unknown as Array<{ id: string; nombre: string; ccaa_nombre: string }>;
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

    // Combustible + municipio (solo municipios ya indexables y con cobertura)
    const coberturaMunicipio: Array<{ municipio_id: string; producto_id: number }> = [];
    for (const { productoId, fecha } of coberturas) {
      const filas = db.all(sql`
        SELECT e.municipio_id
        FROM precios pr JOIN estaciones e ON e.id = pr.estacion_id
        WHERE pr.producto_id = ${productoId}
          AND pr.fecha_observacion = ${fecha}
          AND pr.precio IS NOT NULL
        GROUP BY e.municipio_id
        HAVING COUNT(DISTINCT pr.estacion_id) >= ${MIN_COBERTURA_PRODUCTO_MUNICIPIO}
      `) as unknown as Array<{ municipio_id: string }>;
      for (const fila of filas) {
        coberturaMunicipio.push({ municipio_id: fila.municipio_id, producto_id: productoId });
      }
    }

    // Slugs de municipios indexables (mismo umbral que el listado general)
    const municipiosIndexables = db.all(sql`
      SELECT m.id, m.nombre, p.nombre AS provincia_nombre, c.nombre AS ccaa_nombre,
             (SELECT COUNT(*) FROM estaciones e2 WHERE e2.municipio_id = m.id) AS n_estaciones
      FROM municipios m
      JOIN provincias p ON p.id = m.provincia_id
      JOIN ccaa c ON c.id = p.ccaa_id
      HAVING n_estaciones >= ${MIN_ESTACIONES_MUNICIPIO}
    `) as Array<{
      id: string;
      nombre: string;
      provincia_nombre: string;
      ccaa_nombre: string;
      n_estaciones: number;
    }>;
    const municipioIndexable = new Map(
      municipiosIndexables.map((m) => [
        m.id,
        { ccaa: slugify(m.ccaa_nombre), prov: slugify(m.provincia_nombre), mun: slugify(m.nombre) },
      ])
    );

    for (const fila of coberturaMunicipio) {
      if (!NOMBRE_PRODUCTO[fila.producto_id]) continue;
      const m = municipioIndexable.get(fila.municipio_id);
      if (!m) continue;
      productoURLs.push({
        url: `${SITE_URL}/gasolineras/${m.ccaa}/${m.prov}/${m.mun}?producto=${fila.producto_id}`,
        lastModified: fechaDatos,
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  } catch {
    // DB no disponible en build time — solo páginas estáticas
  }

  // ─── Estaciones: top por municipio (staged) ─────────────────────────────
  let estaciones: MetadataRoute.Sitemap = [];
  try {
    const filas = db
      .all(sql`
        SELECT e.id, e.fecha_actualizacion
        FROM estaciones e
        WHERE EXISTS (
          SELECT 1 FROM precios pr
          WHERE pr.estacion_id = e.id AND pr.precio IS NOT NULL
        )
        AND (
          SELECT COUNT(*) FROM estaciones e2
          WHERE e2.municipio_id = e.municipio_id
        ) >= ${MIN_ESTACIONES_MUNICIPIO}
        ORDER BY e.fecha_actualizacion DESC
        LIMIT ${MAX_ESTACIONES_SITEMAP}
      `) as Array<{ id: string; fecha_actualizacion: string }>;

    estaciones = filas.map((e) => {
      const d = new Date(`${e.fecha_actualizacion}T00:00:00Z`);
      return {
        url: `${SITE_URL}/estacion/${e.id}`,
        lastModified: Number.isNaN(d.getTime()) ? fechaDatos : d,
        changeFrequency: "weekly" as const,
        priority: 0.4,
      };
    });
  } catch {
    // sin datos de estaciones
  }

  return [...estaticas, ...geo, ...productoURLs, ...estaciones];
}
