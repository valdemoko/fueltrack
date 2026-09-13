/**
 * API Route: GET /api/historico
 *
 * Obtiene el histórico de precios de carburantes.
 * Modos de uso:
 *   1. Por estación: estacionId + productoId → precios de esa estación
 *   2. Por área: ccaaId/provinciaId/municipioId + productoId → precio medio del área
 *
 * Query params:
 *   - productoId (requerido): ID del producto
 *   - estacionId: ID de estación (modo 1)
 *   - ccaaId/provinciaId/municipioId: filtro geográfico (modo 2)
 *   - desde: fecha inicio ISO 8601 (default: hace 30 días)
 *   - hasta: fecha fin ISO 8601 (default: hoy)
 *   - limite: máx observaciones (default: 730)
 */
import { NextResponse } from "next/server";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const estacionId = searchParams.get("estacionId");
  const productoId = searchParams.get("productoId");
  const ccaaId = searchParams.get("ccaaId");
  const provinciaId = searchParams.get("provinciaId");
  const municipioId = searchParams.get("municipioId");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const limite = parseInt(searchParams.get("limite") || "730", 10);

  if (!productoId) {
    return NextResponse.json(
      { error: "Se requiere productoId" },
      { status: 400 }
    );
  }

  const productoIdNum = parseInt(productoId, 10);
  if (Number.isNaN(productoIdNum)) {
    return NextResponse.json(
      { error: "productoId debe ser un número" },
      { status: 400 }
    );
  }

  try {
    const fechaHasta = hasta || new Date().toISOString().split("T")[0];
    const fechaDesde =
      desde ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    // ── Modo 1: por estación individual ──
    if (estacionId) {
      const estacion = await db
        .select()
        .from(schema.estaciones)
        .where(eq(schema.estaciones.id, estacionId))
        .get();

      if (!estacion) {
        return NextResponse.json(
          { error: `Estación ${estacionId} no encontrada` },
          { status: 404 }
        );
      }

      const producto = await db
        .select()
        .from(schema.productos)
        .where(eq(schema.productos.id, productoIdNum))
        .get();

      const historico = await db
        .select({
          fecha: schema.precios.fechaObservacion,
          precio: schema.precios.precio,
        })
        .from(schema.precios)
        .where(
          and(
            eq(schema.precios.estacionId, estacionId),
            eq(schema.precios.productoId, productoIdNum),
            gte(schema.precios.fechaObservacion, fechaDesde),
            lte(schema.precios.fechaObservacion, fechaHasta)
          )
        )
        .orderBy(desc(schema.precios.fechaObservacion))
        .limit(limite)
        .all();

      return NextResponse.json({
        estacion: {
          id: estacion.id,
          rotulo: estacion.rotulo,
          direccion: estacion.direccion,
          localidad: estacion.localidad,
        },
        producto: producto
          ? { id: producto.id, nombre: producto.nombre, abreviatura: producto.abreviatura }
          : null,
        periodo: { desde: fechaDesde, hasta: fechaHasta },
        observaciones: historico.length,
        historico: historico.reverse(),
      });
    }

    // ── Modo 2: por área geográfica (agregado) ──
    const condicionesArea = [
      eq(schema.precios.productoId, productoIdNum),
      gte(schema.precios.fechaObservacion, fechaDesde),
      lte(schema.precios.fechaObservacion, fechaHasta),
      sql`${schema.precios.precio} IS NOT NULL`,
    ];

    if (municipioId) {
      condicionesArea.push(eq(schema.estaciones.municipioId, municipioId));
    } else if (provinciaId) {
      condicionesArea.push(eq(schema.estaciones.provinciaId, provinciaId));
    } else if (ccaaId) {
      condicionesArea.push(eq(schema.estaciones.ccaaId, ccaaId));
    }

    const historico = await db
      .select({
        fecha: schema.precios.fechaObservacion,
        precioMedio: sql<number>`ROUND(AVG(${schema.precios.precio}), 4)`,
      })
      .from(schema.precios)
      .innerJoin(schema.estaciones, eq(schema.precios.estacionId, schema.estaciones.id))
      .where(and(...condicionesArea))
      .groupBy(schema.precios.fechaObservacion)
      .orderBy(schema.precios.fechaObservacion)
      .limit(limite)
      .all();

    const producto = await db
      .select()
      .from(schema.productos)
      .where(eq(schema.productos.id, productoIdNum))
      .get();

    return NextResponse.json({
      producto: producto
        ? { id: producto.id, nombre: producto.nombre, abreviatura: producto.abreviatura }
        : null,
      periodo: { desde: fechaDesde, hasta: fechaHasta },
      observaciones: historico.length,
      historico: historico.map((h) => ({ fecha: h.fecha, precio: h.precioMedio })),
    });
  } catch (error) {
    console.error("Error al obtener histórico:", error);
    return NextResponse.json(
      { error: "Error al obtener histórico de precios" },
      { status: 500 }
    );
  }
}
