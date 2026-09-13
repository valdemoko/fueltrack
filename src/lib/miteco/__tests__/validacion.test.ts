import { describe, it, expect } from "vitest";
import {
  validarPrecio,
  limitesProducto,
  LIMITES_PRECIO,
  UMBRAL_SALTO,
  validarLotePrecios,
} from "../validacion";
import type { PrecioNormalizadoIngesta } from "../validacion";

describe("limitesProducto", () => {
  it("devuelve límites para gasolina 95 (producto 1)", () => {
    const l = limitesProducto(1);
    expect(l.min).toBeGreaterThan(0);
    expect(l.max).toBeGreaterThan(2);
    expect(l.min).toBe(LIMITES_PRECIO[1].min);
  });

  it("devuelve límites por defecto para productos desconocidos", () => {
    const l = limitesProducto(9999);
    expect(l.min).toBeGreaterThan(0);
    expect(l.max).toBeGreaterThan(l.min);
  });

  it("los límites definidos son coherentes (min < max)", () => {
    for (const [producto, limite] of Object.entries(LIMITES_PRECIO)) {
      expect(Number(producto)).toBeGreaterThan(0);
      expect(limite.min).toBeLessThan(limite.max);
    }
  });
});

describe("validarPrecio", () => {
  it("acepta null (sin dato) siempre", () => {
    const r = validarPrecio(null, 1);
    expect(r.valido).toBe(true);
    expect(r.sospechoso).toBe(false);
  });

  it("rechaza valores no finitos", () => {
    const r = validarPrecio(Number.NaN, 1);
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain("no-numérico");
  });

  it("rechaza precios cero (error típico de ingestión)", () => {
    const r = validarPrecio(0, 1);
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain("mínimo");
  });

  it("rechaza precios negativos", () => {
    const r = validarPrecio(-1.5, 4);
    expect(r.valido).toBe(false);
  });

  it("rechaza precios absurdamente altos (caída/escala errónea)", () => {
    const r = validarPrecio(17.89, 1); // 17 €/L
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain("máximo");
  });

  it("acepta un precio típico de gasolina 95", () => {
    const r = validarPrecio(1.659, 1);
    expect(r.valido).toBe(true);
    expect(r.sospechoso).toBe(false);
  });

  it("marca como sospechosa una caída mayor del umbral respecto al precio anterior", () => {
    const r = validarPrecio(0.9, 1, 1.6); // -43,75 %
    expect(r.valido).toBe(true);
    expect(r.sospechoso).toBe(true);
    expect(r.motivo).toContain("salto");
  });

  it("marca como sospechosa una subida mayor del umbral", () => {
    const r = validarPrecio(2.4, 1, 1.6); // +50 %
    expect(r.valido).toBe(true);
    expect(r.sospechoso).toBe(true);
  });

  it("acepta movimientos reales del mercado por debajo del umbral", () => {
    const r = validarPrecio(1.7, 1, 1.65); // +3 %
    expect(r.valido).toBe(true);
    expect(r.sospechoso).toBe(false);
  });

  it("el salto se calcula sobre la propia estación, no sobre medias", () => {
    // Dos estaciones con niveles muy distintos: cada una se compara consigo misma
    const barata = validarPrecio(1.3, 1, 1.35);
    const cara = validarPrecio(1.9, 1, 1.85);
    expect(barata.sospechoso).toBe(false);
    expect(cara.sospechoso).toBe(false);
  });

  it("no marca saltos si no hay precio anterior", () => {
    const r = validarPrecio(0.6, 1);
    expect(r.valido).toBe(true);
    expect(r.sospechoso).toBe(false);
  });

  it("el umbral definido es 40 %", () => {
    expect(UMBRAL_SALTO).toBe(0.4);
  });
});

describe("validarLotePrecios", () => {
  const p = (
    estacionId: string,
    productoId: number,
    precio: number | null
  ): PrecioNormalizadoIngesta => ({
    estacionId,
    productoId,
    fechaObservacion: "2026-09-13",
    precio,
  });

  it("separa aceptados, descartados y sospechosos", () => {
    const lote = [p("A", 1, 1.659), p("B", 1, 0), p("C", 1, 17.8), p("D", 1, null)];
    const r = validarLotePrecios(lote);
    expect(r.aceptados).toHaveLength(1);
    expect(r.descartados).toHaveLength(2);
    expect(r.descartados.map((d) => d.estacionId).sort()).toEqual(["B", "C"]);
    expect(r.sospechosos).toHaveLength(0);
  });

  it("no guarda precios null", () => {
    const r = validarLotePrecios([p("A", 4, null)]);
    expect(r.aceptados).toHaveLength(0);
  });

  it("detecta saltos usando los precios previos de la BD", () => {
    const anterior = new Map([["A:1", 1.6]]);
    const r = validarLotePrecios([p("A", 1, 0.9)], anterior); // -43,75 %
    expect(r.aceptados).toHaveLength(1);
    expect(r.sospechosos).toHaveLength(1);
    expect(r.sospechosos[0].motivo).toContain("salto");
  });

  it("el precio aceptado pasa a ser referencia dentro del mismo lote", () => {
    // A publica 1.6 y luego 0.8 en el mismo lote: el segundo salta respecto al primero
    const r = validarLotePrecios([p("A", 1, 1.6), p("A", 1, 0.8)]);
    expect(r.aceptados).toHaveLength(2);
    expect(r.sospechosos).toHaveLength(1);
  });

  it("un lote sin precios previos solo aplica límites absolutos", () => {
    const r = validarLotePrecios([p("A", 4, 1.5), p("B", 4, 1.5), p("C", 4, 1.5)]);
    expect(r.aceptados).toHaveLength(3);
    expect(r.sospechosos).toHaveLength(0);
  });
});
