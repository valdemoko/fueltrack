import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

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
 */
export function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Busca una CCAA por slug URL (coincidencia sin acentos, case-insensitive).
 * Devuelve { id, nombre } o null.
 */
export function getCcaaBySlug(
  slug: string
): { id: string; nombre: string } | null {
  const candidata = slug.replace(/-/g, " ");
  const todas = db.all(sql`SELECT id, nombre FROM ccaa`) as Array<{
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
export function getProvinciaBySlug(
  slug: string,
  ccaaId: string
): { id: string; nombre: string } | null {
  const provincias = db.all(sql`
    SELECT id, nombre FROM provincias WHERE ccaa_id = ${ccaaId}
  `) as Array<{ id: string; nombre: string }>;
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
export function getMunicipioBySlug(
  slug: string,
  provinciaId: string
): { id: string; nombre: string } | null {
  const municipios = db.all(sql`
    SELECT id, nombre FROM municipios WHERE provincia_id = ${provinciaId}
  `) as Array<{ id: string; nombre: string }>;
  const candidata = slug.replace(/-/g, " ");
  return (
    municipios.find((m) => slugify(m.nombre) === slug) ??
    municipios.find((m) => m.nombre.toLowerCase() === candidata) ??
    null
  );
}
