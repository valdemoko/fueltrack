import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { slugify } from "@/lib/slug";

// Reexporta slugify para no romper los imports existentes (@/lib/geografia).
export { slugify };

/**
 * Convierte un nombre de municipio a formato de título para mostrar:
 * "ALHAURIN DE LA TORRE" → "Alhaurin de la Torre".
 * (La fuente MITECO guarda los municipios en mayúsculas y sin acentos;
 * aquí solo se ajusta la caja, nunca se inventan acentos.)
 */
const CONECTORES = new Set([
  "de", "del", "la", "las", "los", "el", "y", "i", "a", "en", "da", "dos", "das",
]);

export function tituloMunicipio(nombre: string): string {
  const minusculas = nombre.toLowerCase().trim();
  return minusculas
    .split(/\s+/)
    .map((palabra, i) =>
      i > 0 && CONECTORES.has(palabra)
        ? palabra
        : palabra.charAt(0).toUpperCase() + palabra.slice(1)
    )
    .join(" ");
}

/**
 * Normaliza un nombre a slug URL estable:
 * minúsculas, sin acentos, separadores con guion.
 * (Implementación canónica en @/lib/slug; reexportada aquí.)
 */

/**
 * Busca una CCAA por slug URL (coincidencia sin acentos, case-insensitive).
 * Devuelve { id, nombre } o null.
 */
export async function getCcaaBySlug(
  slug: string
): Promise<{ id: string; nombre: string } | null> {
  const candidata = slug.replace(/-/g, " ");
  const todas = (await db.all(sql`SELECT id, nombre FROM ccaa`)) as Array<{
    id: string;
    nombre: string;
  }>;
  return (
    todas.find((c) => slugify(c.nombre) === slug) ??
    todas.find((c) => c.nombre.toLowerCase() === candidata) ??
    null
  );
}

/**
 * Busca una provincia por slug dentro de una CCAA.
 */
export async function getProvinciaBySlug(
  slug: string,
  ccaaId: string
): Promise<{ id: string; nombre: string } | null> {
  const provincias = (await db.all(sql`
    SELECT id, nombre FROM provincias WHERE ccaa_id = ${ccaaId}
  `)) as Array<{ id: string; nombre: string }>;;
  const candidata = slug.replace(/-/g, " ");
  return (
    provincias.find((p) => slugify(p.nombre) === slug) ??
    provincias.find((p) => p.nombre.toLowerCase() === candidata) ??
    null
  );
}

/**
 * Busca un municipio por slug dentro de una provincia.
 */
export async function getMunicipioBySlug(
  slug: string,
  provinciaId: string
): Promise<{ id: string; nombre: string } | null> {
  const municipios = (await db.all(sql`
    SELECT id, nombre FROM municipios WHERE provincia_id = ${provinciaId}
  `)) as Array<{ id: string; nombre: string }>;;
  const candidata = slug.replace(/-/g, " ");
  return (
    municipios.find((m) => slugify(m.nombre) === slug) ??
    municipios.find((m) => m.nombre.toLowerCase() === candidata) ??
    null
  );
}
