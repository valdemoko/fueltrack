/**
 * API Route: GET /api/estaciones
 *
 * Obtiene todas las estaciones de servicio de Málaga.
 * Query params opcionales:
 *   - municipio: filtrar por nombre de municipio
 *   - localidad: filtrar por localidad exacta
 *   - limite: número máximo de resultados (default: 100)
 *   - offset: paginación (default: 0)
 */
import { NextResponse } from "next/server";
import { eq, like, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { PROVINCIA_MALAGA } from "@/lib/types/miteco";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const municipio = searchParams.get("municipio");
  const localidad = searchParams.get("localidad");
  const limite = parseInt(searchParams.get("limite") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Construir condiciones de filtro
    const conditions = [
      eq(schema.estaciones.provinciaId, PROVINCIA_MALAGA),
    ];

    if (municipio) {
      conditions.push(
        like(schema.estaciones.localidad, `%${municipio}%`)
      );
    }

    if (localidad) {
      conditions.push(
        eq(schema.estaciones.localidad, localidad)
      );
    }

    // Ejecutar consulta
    const estaciones = db
      .select()
      .from(schema.estaciones)
      .where(and(...conditions))
      .limit(limite)
      .offset(offset)
      .all();

    // Contar total
    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.estaciones)
      .where(eq(schema.estaciones.provinciaId, PROVINCIA_MALAGA))
      .get()?.count ?? 0;

    return NextResponse.json({
      total,
      limite,
      offset,
      estaciones,
    });
  } catch (error) {
    console.error("Error al obtener estaciones:", error);
    return NextResponse.json(
      { error: "Error al obtener estaciones" },
      { status: 500 }
    );
  }
}
