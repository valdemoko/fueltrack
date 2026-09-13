/**
 * API Route: GET /api/precios
 *
 * Obtiene los precios actuales de carburantes.
 * Query params opcionales:
 *   - municipio: filtrar por nombre de municipio
 *   - producto: filtrar por ID de producto
 *   - provinciaId: filtrar por provincia
 *   - ccaaId: filtrar por comunidad autónoma
 *   - ordenar: "precio" | "nombre" (default: "nombre")
 *   - limite: máx estaciones (default: 100)
 */
import { NextResponse } from "next/server";
import { eq, and, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const municipio = searchParams.get("municipio");
  const producto = searchParams.get("producto");
  const provinciaId = searchParams.get("provinciaId");
  const ccaaId = searchParams.get("ccaaId");
  const ordenar = searchParams.get("ordenar") || "nombre";
  const limite = parseInt(searchParams.get("limite") || "100", 10);

  try {
    // Construir filtros geográficos
    const conditions = [];
    if (municipio) {
      conditions.push(like(schema.estaciones.localidad, `%${municipio}%`));
    }
    if (provinciaId) {
      conditions.push(eq(schema.estaciones.provinciaId, provinciaId));
    } else if (ccaaId) {
      conditions.push(eq(schema.estaciones.ccaaId, ccaaId));
    }

    // Consultar estaciones
    const estaciones = await db
      .select({
        id: schema.estaciones.id,
        rotulo: schema.estaciones.rotulo,
        direccion: schema.estaciones.direccion,
        localidad: schema.estaciones.localidad,
        latitud: schema.estaciones.latitud,
        longitud: schema.estaciones.longitud,
        horario: schema.estaciones.horario,
      })
      .from(schema.estaciones)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(limite)
      .all();

    // Para cada estación, obtener sus precios
    const resultado = await Promise.all(
      estaciones.map(async (estacion) => {
      const precios = await db
        .select({
          productoId: schema.precios.productoId,
          precio: schema.precios.precio,
          nombreProducto: schema.productos.nombre,
          abreviatura: schema.productos.abreviatura,
        })
        .from(schema.precios)
        .innerJoin(
          schema.productos,
          eq(schema.precios.productoId, schema.productos.id)
        )
        .where(eq(schema.precios.estacionId, estacion.id))
        .all();

        return {
          ...estacion,
          precios,
        };
      })
    );

    // Filtrar por producto si se especifica
    let filtrado = resultado;
    if (producto) {
      const productoId = parseInt(producto, 10);
      filtrado = filtrado.map((e) => ({
        ...e,
        precios: e.precios.filter((p) => p.productoId === productoId),
      }));
    }

    // Ordenar
    if (ordenar === "precio") {
      filtrado.sort((a, b) => {
        const precioA = a.precios[0]?.precio ?? Infinity;
        const precioB = b.precios[0]?.precio ?? Infinity;
        return precioA - precioB;
      });
    } else {
      filtrado.sort((a, b) => a.localidad.localeCompare(b.localidad));
    }

    return NextResponse.json({
      fecha: new Date().toISOString(),
      total: filtrado.length,
      estaciones: filtrado,
    });
  } catch (error) {
    console.error("Error al obtener precios:", error);
    return NextResponse.json(
      { error: "Error al obtener precios de carburantes" },
      { status: 500 }
    );
  }
}
