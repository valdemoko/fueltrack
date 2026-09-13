/**
 * API Route: GET /api/estaciones/[id]
 *
 * Obtiene una estación específica con todos sus precios.
 * Path params:
 *   - id: IDEESS de la estación
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Buscar estación
    const estacion = await db
      .select()
      .from(schema.estaciones)
      .where(eq(schema.estaciones.id, id))
      .get();

    if (!estacion) {
      return NextResponse.json(
        { error: `Estación ${id} no encontrada` },
        { status: 404 }
      );
    }

    // Obtener precios de la estación
    const precios = await db
      .select({
        productoId: schema.precios.productoId,
        precio: schema.precios.precio,
        fechaObservacion: schema.precios.fechaObservacion,
        nombreProducto: schema.productos.nombre,
        abreviatura: schema.productos.abreviatura,
      })
      .from(schema.precios)
      .innerJoin(
        schema.productos,
        eq(schema.precios.productoId, schema.productos.id)
      )
      .where(eq(schema.precios.estacionId, id))
      .all();

    // Agrupar precios por producto
    const preciosPorProducto: Record<
      number,
      {
        productoId: number;
        nombre: string;
        abreviatura: string;
        observaciones: Array<{
          fecha: string;
          precio: number | null;
        }>;
      }
    > = {};

    for (const precio of precios) {
      if (!preciosPorProducto[precio.productoId]) {
        preciosPorProducto[precio.productoId] = {
          productoId: precio.productoId,
          nombre: precio.nombreProducto,
          abreviatura: precio.abreviatura,
          observaciones: [],
        };
      }
      preciosPorProducto[precio.productoId].observaciones.push({
        fecha: precio.fechaObservacion,
        precio: precio.precio,
      });
    }

    return NextResponse.json({
      estacion,
      precios: Object.values(preciosPorProducto),
    });
  } catch (error) {
    console.error("Error al obtener estación:", error);
    return NextResponse.json(
      { error: "Error al obtener estación" },
      { status: 500 }
    );
  }
}
