/**
 * Robots.txt — usa SITE_URL (única fuente de verdad del dominio).
 * (Sin cambios funcionales: la configuración actual ya es correcta.
 * Este comentario solo documenta la auditoría.)
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteConfig";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
