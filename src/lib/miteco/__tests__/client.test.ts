import { describe, it, expect } from "vitest";
import { parsePrecio, parseCoordenada, parsePorcentaje } from "../client";

// ─── parsePrecio ───────────────────────────────────────────────────────────

describe("parsePrecio", () => {
  it("devuelve null para cadena vacía", () => {
    expect(parsePrecio("")).toBeNull();
  });

  it("devuelve null para guión (sin dato)", () => {
    expect(parsePrecio("-")).toBeNull();
  });

  it("devuelve null para N/A", () => {
    expect(parsePrecio("N/A")).toBeNull();
  });

  it("devuelve null para undefined-like (falsy)", () => {
    expect(parsePrecio("")).toBeNull();
  });

  it("parsea precio con coma decimal español", () => {
    expect(parsePrecio("1,789")).toBeCloseTo(1.789, 3);
  });

  it("parsea precio con punto decimal", () => {
    expect(parsePrecio("1.789")).toBeCloseTo(1.789, 3);
  });

  it("parsea precio entero", () => {
    expect(parsePrecio("2")).toBe(2);
  });

  it("parsea precio de un dígito", () => {
    expect(parsePrecio("1")).toBe(1);
  });

  it("parsea precio con muchos decimales", () => {
    expect(parsePrecio("1,567890123")).toBeCloseTo(1.567890123, 9);
  });

  it("devuelve null para texto no numérico", () => {
    expect(parsePrecio("abc")).toBeNull();
  });

  it("devuelve null para NaN resultante", () => {
    expect(parsePrecio("not-a-number")).toBeNull();
  });

  it("maneja precio típico de gasolina española", () => {
    // Precio típico de gasolina 95 en España 2024-2026
    expect(parsePrecio("1,659")).toBeCloseTo(1.659, 3);
  });

  it("maneja precio de gasóleo típico", () => {
    expect(parsePrecio("1,529")).toBeCloseTo(1.529, 3);
  });
});

// ─── parseCoordenada ───────────────────────────────────────────────────────

describe("parseCoordenada", () => {
  it("parsea coordenada WGS84 con coma decimal", () => {
    expect(parseCoordenada("37,206167")).toBeCloseTo(37.206167, 6);
  });

  it("parsea coordenada con punto decimal", () => {
    expect(parseCoordenada("-4,421400")).toBeCloseTo(-4.4214, 4);
  });

  it("devuelve null para coordenada no numérica", () => {
    expect(parseCoordenada("abc")).toBeNull();
  });

  it("devuelve null para cadena vacía", () => {
    expect(parseCoordenada("")).toBeNull();
  });

  it("devuelve null para NaN", () => {
    expect(parseCoordenada("not-a-number")).toBeNull();
  });

  it("maneja latitud negativa (hemisferio sur)", () => {
    expect(parseCoordenada("-33,8688")).toBeCloseTo(-33.8688, 4);
  });

  it("maneja longitud negativa (hemisferio oeste)", () => {
    expect(parseCoordenada("-84,3373")).toBeCloseTo(-84.3373, 4);
  });

  it("maneja coordenadas de Málaga", () => {
    // Centro de Málaga
    expect(parseCoordenada("36,7213")).toBeCloseTo(36.7213, 4);
    expect(parseCoordenada("-4,4214")).toBeCloseTo(-4.4214, 4);
  });
});

// ─── parsePorcentaje ───────────────────────────────────────────────────────

describe("parsePorcentaje", () => {
  it("devuelve 0 para cadena vacía", () => {
    expect(parsePorcentaje("")).toBe(0);
  });

  it("devuelve 0 para falsy", () => {
    expect(parsePorcentaje("")).toBe(0);
  });

  it("parsea porcentaje con coma decimal", () => {
    expect(parsePorcentaje("0,0")).toBe(0);
  });

  it("parsea porcentaje con punto decimal", () => {
    expect(parsePorcentaje("5.5")).toBeCloseTo(5.5, 1);
  });

  it("parsea porcentaje entero", () => {
    expect(parsePorcentaje("10")).toBe(10);
  });

  it("devuelve 0 para texto no numérico", () => {
    expect(parsePorcentaje("abc")).toBe(0);
  });

  it("maneja porcentaje típico de bioetanol", () => {
    expect(parsePorcentaje("4,8")).toBeCloseTo(4.8, 1);
  });
});
