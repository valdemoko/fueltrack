import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@libsql/client";

/**
 * Middleware:
 * 1. Redirects 301 — consolidación de landings duplicadas.
 * 2. Gate 404 para /estacion/[id]: comprueba la existencia del IDEESS
 *    directamente en la BD y emite un 404 HTTP real para IDs inexistentes
 *    (evita soft-404 indexables por el streaming de Next 15).
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
    const url =
      process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("libsql://")
        ? process.env.DATABASE_URL
        : "file:./data/combustible.db";
    client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  return client;
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
    "/combustible-malaga",
    "/precios-gasolina-malaga",
    "/precios-gasolina-98-malaga",
    "/precios-diesel-malaga",
    "/gasolineras-malaga",
  ],
};
