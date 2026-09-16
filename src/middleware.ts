import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@libsql/client";
import { slugify } from "@/lib/slug";

/**
 * Middleware:
 * 1. Redirects 301 — consolidación de landings duplicadas.
 * 2. Gate 404 para /estacion/[id]: comprueba la existencia del IDEESS
 *    directamente en la BD y emite un 404 HTTP real para IDs inexistentes
 *    (evita soft-404 indexables por el streaming de Next 15).
 * 3. Gate 404 para /gasolineras/**: valida los slugs de CCAA/provincia/
 *    municipio contra un listado cargado UNA vez por proceso y mantenido
 *    en memoria (cero lecturas de BD en estado estable; la caché se
 *    refresca a las 6 h). Un 404 HTTP real aquí es la única vía fiable:
 *    notFound() en metadata no puede cambiar el status una vez que el
 *    shell del streaming ya se ha enviado.
 *
 * Runtime Node (libSQL no funciona en Edge). El cliente libSQL funciona
 * igual contra file: (local) y libsql:// (Turso) según DATABASE_URL.
 */

// Estrategia canónica:
// - /combustible-malaga y /precios-gasolina-malaga (misma intención:
//   "precios de combustible en Málaga") → /gasolineras/andalucia/malaga
// - /precios-gasolina-98-malaga y /precios-diesel-malaga → página de
//   provincia (el usuario puede elegir el combustible en la tabla;
//   /precios sigue existiendo para la herramienta interactiva).
// - /gasolineras-malaga → /gasolineras/andalucia/malaga
const REDIRECTS: Record<string, string> = {
  "/combustible-malaga": "/gasolineras/andalucia/malaga",
  "/precios-gasolina-malaga": "/gasolineras/andalucia/malaga",
  "/precios-gasolina-98-malaga": "/gasolineras/andalucia/malaga",
  "/precios-diesel-malaga": "/gasolineras/andalucia/malaga",
  "/gasolineras-malaga": "/gasolineras/andalucia/malaga",
};

/** Cliente libSQL reutilizado entre invocaciones (single process). */
let client: ReturnType<typeof createClient> | null = null;

function getCliente() {
  if (!client) {
    // TURSO_DATABASE_URL (preferente) o DATABASE_URL como alias.
    const remota =
      process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "";
    const url = remota.startsWith("libsql://")
      ? remota
      : "file:./data/combustible.db";
    client = createClient({
      url,
      authToken:
        process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  return client;
}

// ─── Caché en memoria de slugs geográficos válidos ─────────────────────────
// (auditoría I2: 404 real para slugs geo inválidos sin coste de BD por
// request; el coste es 3 consultas ligeras cada 6 h por proceso).

interface SlugsGeo {
  ccaa: Set<string>;
  /** clave `${ccaaSlug}/${provinciaSlug}` */
  provincia: Set<string>;
  /** clave `${ccaaSlug}/${provinciaSlug}/${municipioSlug}` */
  municipio: Set<string>;
  cargadoEn: number;
}

let slugsGeo: SlugsGeo | null = null;
let cargandoSlugs: Promise<SlugsGeo> | null = null;

/** TTL de la caché de slugs: 6 h (la geografía es prácticamente inmutable). */
const SLUGS_TTL_MS = 6 * 3600 * 1000;

async function cargarSlugsGeo(): Promise<SlugsGeo> {
  const ccaa = new Set<string>();
  const provincia = new Set<string>();
  const municipio = new Set<string>();

  // 3 consultas ligeras sobre catálogos (19 + 52 + 3.539 filas en total).
  // NOTA: municipios completos son ~3.5k filas; se leen solo id+nombre vía
  // JOIN de provincias para reconstruir la ruta completa.
  const ccaaRows = await getCliente().execute(
    "SELECT nombre FROM ccaa"
  );
  for (const r of ccaaRows.rows) {
    ccaa.add(slugify(String(r.nombre)));
  }

  const provRows = await getCliente().execute(
    `SELECT p.nombre AS prov, c.nombre AS ccaa
     FROM provincias p JOIN ccaa c ON c.id = p.ccaa_id`
  );
  for (const r of provRows.rows) {
    provincia.add(`${slugify(String(r.ccaa))}/${slugify(String(r.prov))}`);
  }

  const munRows = await getCliente().execute(
    `SELECT m.nombre AS mun, p.nombre AS prov, c.nombre AS ccaa
     FROM municipios m
     JOIN provincias p ON p.id = m.provincia_id
     JOIN ccaa c ON c.id = p.ccaa_id`
  );
  for (const r of munRows.rows) {
    municipio.add(
      `${slugify(String(r.ccaa))}/${slugify(String(r.prov))}/${slugify(String(r.mun))}`
    );
  }

  return { ccaa, provincia, municipio, cargadoEn: Date.now() };
}

async function getSlugsGeo(): Promise<SlugsGeo | null> {
  try {
    if (slugsGeo && Date.now() - slugsGeo.cargadoEn < SLUGS_TTL_MS) {
      return slugsGeo;
    }
    if (!cargandoSlugs) {
      cargandoSlugs = cargarSlugsGeo().then((s) => {
        slugsGeo = s;
        cargandoSlugs = null;
        return s;
      });
    }
    return await cargandoSlugs;
  } catch {
    // BD no disponible: no bloquear el tráfico válido; dejar decidir a la
    // página (que ya renderiza not-found con noindex como red de seguridad).
    return null;
  }
}

async function estacionExiste(id: string): Promise<boolean> {
  try {
    const result = await getCliente().execute({
      sql: "SELECT 1 FROM estaciones WHERE id = ? LIMIT 1",
      args: [id],
    });
    return result.rows.length > 0;
  } catch {
    // Si la BD no está disponible, no bloquear: dejar que la página decida.
    return true;
  }
}

/** Segmento de slug razonable: letras/números y guiones, 1-80 chars. */
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ─── Gate 404 para estaciones inexistentes ──────────────────────────────
  const match = pathname.match(/^\/estacion\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (!/^\d{1,10}$/.test(id) || !(await estacionExiste(id))) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  // ─── Gate 404 para slugs geográficos inválidos (auditoría I2) ───────────
  if (pathname.startsWith("/gasolineras/") || pathname === "/gasolineras") {
    const segmentos = pathname
      .split("/")
      .filter(Boolean)
      .slice(1); // quita "gasolineras"

    if (segmentos.length > 0 && segmentos.length <= 3) {
      const validos = segmentos.every((s) => SLUG_RE.test(decodeURIComponent(s)));
      const slugs = validos ? await getSlugsGeo() : null;

      // Sin caché disponible (BD caída): no bloquear; la página renderiza
      // not-found con noindex. Con caché: 404 real si la ruta no existe.
      if (slugs) {
        const ruta = segmentos.join("/");
        const existe =
          segmentos.length === 1
            ? slugs.ccaa.has(ruta)
            : segmentos.length === 2
              ? slugs.provincia.has(ruta)
              : slugs.municipio.has(ruta);
        if (!existe) {
          return new NextResponse(null, { status: 404 });
        }
      }
    }
    // >3 segmentos: ruta inexistente por construcción → 404 real sin BD.
    if (segmentos.length > 3) {
      return new NextResponse(null, { status: 404 });
    }
  }

  // ─── Redirects 301 ──────────────────────────────────────────────────────
  const destination = REDIRECTS[pathname];
  if (destination) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    url.search = "";
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  // Node runtime: @libsql/client no está disponible en Edge
  runtime: "nodejs",
  matcher: [
    "/estacion/:path*",
    "/gasolineras",
    "/gasolineras/:path*",
    "/combustible-malaga",
    "/precios-gasolina-malaga",
    "/precios-gasolina-98-malaga",
    "/precios-diesel-malaga",
    "/gasolineras-malaga",
  ],
};
