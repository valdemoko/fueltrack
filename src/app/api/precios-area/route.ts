import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { precios, estaciones, productos, municipios, provincias, ccaa } from "@/lib/db/schema";
import { eq, and, avg, min, max, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productoId = searchParams.get("productoId") || "1";
    const ccaaId = searchParams.get("ccaaId");
    const provinciaId = searchParams.get("provinciaId");
    const municipioId = searchParams.get("municipioId");

    // Obtener la fecha más reciente con datos
    const ultimaFecha = await db
      .select({ fecha: precios.fechaObservacion })
      .from(precios)
      .orderBy(sql`${precios.fechaObservacion} DESC`)
      .limit(1);

    if (ultimaFecha.length === 0) {
      return NextResponse.json({
        estadisticas: null,
        precioMedio: null,
        fecha: null,
      });
    }

    const fecha = ultimaFecha[0].fecha;

    // Construir condiciones de filtro geográfico
    const condiciones = [
      eq(precios.productoId, Number(productoId)),
      eq(precios.fechaObservacion, fecha),
    ];

    if (municipioId) {
      condiciones.push(eq(estaciones.municipioId, municipioId));
    } else if (provinciaId) {
      condiciones.push(eq(estaciones.provinciaId, provinciaId));
    } else if (ccaaId) {
      condiciones.push(eq(estaciones.ccaaId, ccaaId));
    }

    // Consultar estadísticas de precios
    const stats = await db
      .select({
        precioMedio: avg(precios.precio),
        precioMinimo: min(precios.precio),
        precioMaximo: max(precios.precio),
        numEstaciones: sql<number>`count(distinct ${precios.estacionId})`,
      })
      .from(precios)
      .innerJoin(estaciones, eq(precios.estacionId, estaciones.id))
      .where(and(...condiciones));

    // Obtener el producto seleccionado
    const producto = await db
      .select()
      .from(productos)
      .where(eq(productos.id, Number(productoId)))
      .limit(1);

    return NextResponse.json({
      estadisticas: stats[0] || null,
      producto: producto[0] || null,
      fecha,
    });
  } catch (error) {
    console.error("Error en API precios-area:", error);
    return NextResponse.json(
      { error: "Error al obtener precios del área" },
      { status: 500 }
    );
  }
}
