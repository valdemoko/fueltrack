/**
 * Utilidades de slug puras (sin dependencia de la base de datos).
 * Separadas de geografia.ts para poder importarlas desde el middleware
 * (que no puede arrastrar el cliente libSQL por importación transitiva).
 */

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
