import { NextRequest, NextResponse } from "next/server";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
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
 * Runtime Node. El driver HTTP de Neon no funciona en Edge, así que este
 * middleware se declara explícitamente como nodejs.
 *
 * ── COSTE DE CÓMPUTO (por qué NO se consulta la BD por request) ──────────
 *
 * El plan Free de Neon da 100 CU-horas al mes de cómputo y **cobra por tiempo
 * despierto**, no por consulta: una sola consulta cada pocos segundos impide
 * que el compute se duerma y lo mantiene facturando las 720 h del mes (≈182 h
 * de cómputo, el doble del plan). Por eso TODO lo que el middleware necesita
 * (los IDs de estación y los slugs geográficos) se lee UNA vez por proceso y
 * se guarda en memoria con TTL de 6 h: una vez caliente, un request no toca
 * la base de datos y el compute puede dormirse entre visitas.
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

/** Cliente Neon reutilizado entre invocaciones (un proceso por instancia). */
let sqlFn: NeonQueryFunction<false, false> | null = null;

function getSql() {
  if (!sqlFn) {
    const url = process.env.DATABASE_URL || "";
    sqlFn = neon(url || "postgresql://sin-configurar@localhost/sin-configurar");
  }
  return sqlFn;
}

/**
 * TTL de las cachés en memoria: 6 h.
 *
 * Suficiente para que una estación nueva o una ruta recién creada sean
 * visibles el mismo día, y bajo suficiente para que el compute de Neon pueda
 * dormirse (una recarga cada 6 h es ~120 lecturas al mes, no 1,5 M).
 */
const CACHE_TTL_MS = 6 * 3600 * 1000;

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

async function cargarSlugsGeo(): Promise<SlugsGeo> {
  const ccaa = new Set<string>();
  const provincia = new Set<string>();
  const municipio = new Set<string>();

  // 3 consultas ligeras sobre catálogos (19 + 52 + 3.539 filas en total).
  // NOTA: municipios completos son ~3.5k filas; se leen solo id+nombre vía
  // JOIN de provincias para reconstruir la ruta completa.
  const sql = getSql();

  const ccaaRows = await sql`SELECT nombre FROM ccaa`;
  for (const r of ccaaRows) {
    ccaa.add(slugify(String(r.nombre)));
  }

  const provRows = await sql`
    SELECT p.nombre AS prov, c.nombre AS ccaa
    FROM provincias p JOIN ccaa c ON c.id = p.ccaa_id
  `;
  for (const r of provRows) {
    provincia.add(`${slugify(String(r.ccaa))}/${slugify(String(r.prov))}`);
  }

  const munRows = await sql`
    SELECT m.nombre AS mun, p.nombre AS prov, c.nombre AS ccaa
    FROM municipios m
    JOIN provincias p ON p.id = m.provincia_id
    JOIN ccaa c ON c.id = p.ccaa_id
  `;
  for (const r of munRows) {
    municipio.add(
      `${slugify(String(r.ccaa))}/${slugify(String(r.prov))}/${slugify(String(r.mun))}`
    );
  }

  return { ccaa, provincia, municipio, cargadoEn: Date.now() };
}

async function getSlugsGeo(): Promise<SlugsGeo | null> {
  try {
    if (slugsGeo && Date.now() - slugsGeo.cargadoEn < CACHE_TTL_MS) {
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

// ─── Caché en memoria de IDs de estación ───────────────────────────────────
// El gate de /estacion/[id] cubre 13.135 fichas. Consultar la BD por request
// mantendría el compute de Neon despierto 24/7 (≈182 CU-horas contra las 100
// del plan Free), así que se carga el conjunto completo de IDs una vez por
// proceso y se responde desde memoria.

let idsEstaciones: { set: Set<string>; cargadoEn: number } | null = null;
let cargandoIds: Promise<Set<string>> | null = null;

async function cargarIdsEstaciones(): Promise<Set<string>> {
  const filas = await getSql()`SELECT id FROM estaciones`;
  return new Set(filas.map((r) => String(r.id)));
}

async function getIdsEstaciones(): Promise<Set<string> | null> {
  try {
    if (idsEstaciones && Date.now() - idsEstaciones.cargadoEn < CACHE_TTL_MS) {
      return idsEstaciones.set;
    }
    if (!cargandoIds) {
      cargandoIds = cargarIdsEstaciones().then((set) => {
        idsEstaciones = { set, cargadoEn: Date.now() };
        cargandoIds = null;
        return set;
      });
    }
    return await cargandoIds;
  } catch {
    // BD no disponible: no bloquear el tráfico válido; dejar decidir a la
    // página (que ya renderiza not-found con noindex como red de seguridad).
    return null;
  }
}

async function estacionExiste(id: string): Promise<boolean> {
  const ids = await getIdsEstaciones();
  // Sin caché (BD caída o aún cargando): no bloquear.
  return ids ? ids.has(id) : true;
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
  // Node runtime: el driver HTTP de Neon no está disponible en Edge
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
