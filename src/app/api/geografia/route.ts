import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ccaa, provincias, municipios, estaciones } from "@/lib/db/schema";
import { eq, count, and, like } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ccaaId = searchParams.get("ccaaId");
    const provinciaId = searchParams.get("provinciaId");
    const q = searchParams.get("q");

    // Búsqueda global de municipios por texto (España completa)
    if (q) {
      const municipiosList = await db
        .select({
          id: municipios.id,
          nombre: municipios.nombre,
          provinciaId: municipios.provinciaId,
          numEstaciones: count(estaciones.id),
        })
        .from(municipios)
        .leftJoin(estaciones, eq(municipios.id, estaciones.municipioId))
        .where(like(municipios.nombre, `%${q}%`))
        .groupBy(municipios.id, municipios.nombre, municipios.provinciaId)
        .orderBy(municipios.nombre)
        .limit(10);

      return NextResponse.json({ municipios: municipiosList });
    }

    // Si se pide una CCAA concreta, devolver sus provincias
    if (ccaaId) {
      const provinciasList = await db
        .select({
          id: provincias.id,
          nombre: provincias.nombre,
          ccaaId: provincias.ccaaId,
        })
        .from(provincias)
        .where(eq(provincias.ccaaId, ccaaId));

      return NextResponse.json({ provincias: provinciasList });
    }

    // Si se pide una provincia concreta, devolver sus municipios
    if (provinciaId) {
      const municipiosList = await db
        .select({
          id: municipios.id,
          nombre: municipios.nombre,
          provinciaId: municipios.provinciaId,
        })
        .from(municipios)
        .where(eq(municipios.provinciaId, provinciaId));

      return NextResponse.json({ municipios: municipiosList });
    }

    // Por defecto: devolver CCAA con conteo de estaciones
    const ccaaConEstaciones = await db
      .select({
        id: ccaa.id,
        nombre: ccaa.nombre,
        numEstaciones: count(estaciones.id),
      })
      .from(ccaa)
      .leftJoin(estaciones, eq(ccaa.id, estaciones.ccaaId))
      .groupBy(ccaa.id, ccaa.nombre)
      .orderBy(ccaa.nombre);

    return NextResponse.json({ ccaa: ccaaConEstaciones });
  } catch (error) {
    console.error("Error en API geografía:", error);
    return NextResponse.json(
      { error: "Error al obtener datos geográficos" },
      { status: 500 }
    );
  }
}
