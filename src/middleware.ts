import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";

/**
 * Middleware:
 * 1. Redirects 301 — consolidación de landings duplicadas.
 * 2. Gate 404 para /estacion/[id]: comprueba la existencia del IDEESS
 *    directamente en la BD y emite un 404 HTTP real para IDs inexistentes
 *    (evita soft-404 indexables por el streaming de Next 15).
 *
 * Runtime Node: better-sqlite3 no funciona en el runtime Edge.
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

/** Conexión SQLite reutilizada entre invocaciones (single process). */
let sqlite: Database.Database | null = null;

function estacionExiste(id: string): boolean {
  try {
    if (!sqlite) {
      sqlite = new Database("./data/combustible.db", { readonly: true });
    }
    const row = sqlite
      .prepare("SELECT 1 FROM estaciones WHERE id = ? LIMIT 1")
      .get(id);
    return row !== undefined;
  } catch {
    // Si la BD no está disponible, no bloquear: dejar que la página decida.
    return true;
  }
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ─── Gate 404 para estaciones inexistentes ──────────────────────────────
  const match = pathname.match(/^\/estacion\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (!/^\d{1,10}$/.test(id) || !estacionExiste(id)) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
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
  // Node runtime: better-sqlite3 no está disponible en Edge
  runtime: "nodejs",
  matcher: [
    "/estacion/:path*",
    "/combustible-malaga",
    "/precios-gasolina-malaga",
    "/precios-gasolina-98-malaga",
    "/precios-diesel-malaga",
    "/gasolineras-malaga",
  ],
};
