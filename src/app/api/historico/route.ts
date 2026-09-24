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
import { getHistoricoAmbito } from "@/lib/db/queries-seo";
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
      const estacion = (await db
        .select()
        .from(schema.estaciones)
        .where(eq(schema.estaciones.id, estacionId))
        .execute())[0];

      if (!estacion) {
        return NextResponse.json(
          { error: `Estación ${estacionId} no encontrada` },
          { status: 404 }
        );
      }

      const producto = (await db
        .select()
        .from(schema.productos)
        .where(eq(schema.productos.id, productoIdNum))
        .execute())[0];

      // Arquitectura de cuotas: el detalle diario vive en precios_historico
      // (ventana ~32 días). Ventanas largas → serie mensual permanente.
      const diasPedidos = Math.round(
        (new Date(fechaHasta).getTime() - new Date(fechaDesde).getTime()) / 86400000
      );
      const historico = diasPedidos <= 31
        ? await db
            .select({
              fecha: schema.preciosHistorico.fecha,
              precio: schema.preciosHistorico.precio,
            })
            .from(schema.preciosHistorico)
            .where(
              and(
                eq(schema.preciosHistorico.estacionId, estacionId),
                eq(schema.preciosHistorico.productoId, productoIdNum),
                gte(schema.preciosHistorico.fecha, fechaDesde),
                lte(schema.preciosHistorico.fecha, fechaHasta)
              )
            )
            .orderBy(desc(schema.preciosHistorico.fecha))
            .limit(limite)
            .execute()
        : await db
            .select({
              fecha: schema.histEstacionMes.mes,
              precio: schema.histEstacionMes.precioMedio,
            })
            .from(schema.histEstacionMes)
            .where(
              and(
                eq(schema.histEstacionMes.estacionId, estacionId),
                eq(schema.histEstacionMes.productoId, productoIdNum),
                gte(schema.histEstacionMes.mes, fechaDesde.slice(0, 7)),
                lte(schema.histEstacionMes.mes, fechaHasta.slice(0, 7))
              )
            )
            .orderBy(desc(schema.histEstacionMes.mes))
            .limit(limite)
            .execute();

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
    // Arquitectura de cuotas: la serie sale de las tablas agregadas
    // (hist_geo_dia / hist_*_mes), cacheada — nunca escanea `precios`.
    const diasPedidos = Math.round(
      (new Date(fechaHasta).getTime() - new Date(fechaDesde).getTime()) / 86400000
    );
    const ambito = municipioId
      ? { municipioId }
      : provinciaId
        ? { provinciaId }
        : ccaaId
          ? { ccaaId }
          : {};
    const resumen = await getHistoricoAmbito(productoIdNum, Math.max(diasPedidos, 1), ambito);
    const historico = (resumen?.serie ?? [])
      .slice(-limite)
      .map((p) => ({ fecha: p.fecha, precioMedio: p.precio }));

    const producto = (await db
      .select()
      .from(schema.productos)
      .where(eq(schema.productos.id, productoIdNum))
      .execute())[0];

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
