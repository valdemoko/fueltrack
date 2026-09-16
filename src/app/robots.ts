/**
 * Robots.txt — usa SITE_URL (única fuente de verdad del dominio).
 *
 * Reglas:
 *  - /api/ bloqueado (endpoints internos, cron).
 *  - Bloqueo preventivo de query strings de estado (?orden=, ?filtro=, etc.)
 *    que la UI no genera como enlaces pero que un bot podría inventar o
 *    descubrir. Se mantienen las fichas de combustible (?producto=) porque
 *    son URLs canónicas propias incluidas en el sitemap.
 *    IMPORTANTE: como regla general se permite arrastrar parámetros y se
 *    bloquean solo los conocidos como "de estado" — bloquear `?*` a lo
 *    bruto impediría el rastreo de las fichas ?producto= canónicas.
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteConfig";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          // Query strings de estado (no canónicas): la UI nunca las emite
          // como enlaces, pero se bloquean para evitar rastreo inventado.
          "/*?*orden=",
          "/*?*filtro=",
          "/*?*page=",
          "/*?*sort=",
          "/*?*utm_",
          "/*?*fbclid=",
          "/*?*gclid=",
          "/*?*session",
          "/*?*ref=",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
