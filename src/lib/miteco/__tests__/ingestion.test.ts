import { describe, it, expect } from "vitest";
import { normalizarEstacion, extraerPrecios } from "../ingestion";
import type { MitecoEstacionRaw } from "@/lib/types/miteco";

// ─── Fixture: estación raw de MITECO ───────────────────────────────────────

const createRawStation = (overrides?: Partial<MitecoEstacionRaw>): MitecoEstacionRaw => ({
  "C.P.": "29001",
  Dirección: "Calle Test 1",
  Horario: "Lun-Dom 06:00-22:00",
  Latitud: "37,206167",
  Localidad: "Málaga",
  "Longitud (WGS84)": "-4,421400",
  Margen: "D",
  Municipio: "Málaga",
  Provincia: "Málaga",
  Remisión: "dm",
  Rótulo: "Repsol Test",
  "Tipo Venta": "P",
  "% BioEtanol": "4,8",
  "% Éster metílico": "0,0",
  IDEESS: "12345",
  IDMunicipio: "123",
  IDProvincia: "29",
  IDCCAA: "01",
  "Precio Gasolina 95 E5": "1,659",
  "Precio Gasolina 95 E10": "1,729",
  "Precio Gasolina 95 E25": "",
  "Precio Gasolina 95 E85": "",
  "Precio Gasolina 95 E5 Premium": "",
  "Precio Gasolina 98 E5": "1,829",
  "Precio Gasolina 98 E10": "",
  "Precio Gasoleo A": "1,529",
  "Precio Gasoleo B": "",
  "Precio Gasoleo Premium": "1,729",
  "Precio Gasolina Renovable": "",
  "Precio Diésel Renovable": "",
  "Precio Gases licuados del petróleo": "",
  "Precio Gas Natural Comprimido": "",
  "Precio Gas Natural Licuado": "",
  "Precio Hidrogeno": "",
  "Precio Adblue": "",
  "Precio Biodiesel": "",
  "Precio Bioetanol": "",
  "Precio Biogas Natural Comprimido": "",
  "Precio Biogas Natural Licuado": "",
  "Precio Fuelóleo bajo índice azufre": "",
  "Precio Fuelóleo especial": "",
  "Precio Gasóleo para uso marítimo": "",
  "Precio Gasolina de aviación": "",
  "Precio Queroseno de aviación JET_A1": "",
  "Precio Queroseno de aviación JET_A2": "",
  "Precio Metanol": "",
  "Precio Amoniaco": "",
  ...overrides,
});

// ─── normalizarEstacion ────────────────────────────────────────────────────

describe("normalizarEstacion", () => {
  const fechaConsulta = "13/09/2026 12:00:00";

  it("normaliza correctamente una estación completa", () => {
    const raw = createRawStation();
    const result = normalizarEstacion(raw, fechaConsulta);
    expect(result).not.toBeNull();

    expect(result!.id).toBe("12345");
    expect(result!.municipioId).toBe("123");
    expect(result!.provinciaId).toBe("29");
    expect(result!.ccaaId).toBe("01");
    expect(result!.rotulo).toBe("Repsol Test");
    expect(result!.direccion).toBe("Calle Test 1");
    expect(result!.localidad).toBe("Málaga");
    expect(result!.codigoPostal).toBe("29001");
    expect(result!.latitud).toBeCloseTo(37.206167, 6);
    expect(result!.longitud).toBeCloseTo(-4.4214, 4);
    expect(result!.horario).toBe("Lun-Dom 06:00-22:00");
    expect(result!.margen).toBe("D");
    expect(result!.tipoVenta).toBe("P");
    expect(result!.bioetanolPct).toBeCloseTo(4.8, 1);
    expect(result!.esterMetilicoPct).toBe(0);
    expect(result!.fechaActualizacion).toBe(fechaConsulta);
  });

  it("maneja Rótulo ausente (null)", () => {
    const raw = createRawStation({ Rótulo: "" });
    const result = normalizarEstacion(raw, fechaConsulta);
    expect(result).not.toBeNull();
    expect(result!.rotulo).toBeNull();
  });

  it("maneja coordenadas con coma decimal", () => {
    const raw = createRawStation({
      Latitud: "37,206167",
      "Longitud (WGS84)": "-4,421400",
    });
    const result = normalizarEstacion(raw, fechaConsulta);
    expect(result).not.toBeNull();
    expect(result!.latitud).toBeCloseTo(37.206167, 6);
    expect(result!.longitud).toBeCloseTo(-4.4214, 4);
  });

  it("maneja porcentajes con coma decimal", () => {
    const raw = createRawStation({
      "% BioEtanol": "4,8",
      "% Éster metílico": "1,5",
    });
    const result = normalizarEstacion(raw, fechaConsulta);
    expect(result).not.toBeNull();
    expect(result!.bioetanolPct).toBeCloseTo(4.8, 1);
    expect(result!.esterMetilicoPct).toBeCloseTo(1.5, 1);
  });

  it("maneja porcentajes vacíos como 0", () => {
    const raw = createRawStation({
      "% BioEtanol": "",
      "% Éster metílico": "",
    });
    const result = normalizarEstacion(raw, fechaConsulta);
    expect(result).not.toBeNull();
    expect(result!.bioetanolPct).toBe(0);
    expect(result!.esterMetilicoPct).toBe(0);
  });

  it("devuelve null para coordenadas vacías (datos antiguos)", () => {
    const raw = createRawStation({
      Latitud: "",
      "Longitud (WGS84)": "",
    });
    const result = normalizarEstacion(raw, fechaConsulta);
    expect(result).toBeNull();
  });
});

// ─── extraerPrecios ────────────────────────────────────────────────────────

describe("extraerPrecios", () => {
  const fechaObservacion = "13/09/2026";

  it("extrae precios disponibles", () => {
    const raw = createRawStation();
    const precios = extraerPrecios(raw, fechaObservacion);

    // Debe tener 29 entradas (una por cada campo de precio en MITECO_PRECIO_TO_PRODUCTO)
    expect(precios.length).toBeGreaterThan(0);

    // Gasolina 95 E5 (producto 1) debe tener precio
    const g95 = precios.find((p) => p.productoId === 1);
    expect(g95).toBeDefined();
    expect(g95?.precio).toBeCloseTo(1.659, 3);
    expect(g95?.estacionId).toBe("12345");
    expect(g95?.fechaObservacion).toBe(fechaObservacion);

    // Gasóleo A (producto 4) debe tener precio
    const gasoleoA = precios.find((p) => p.productoId === 4);
    expect(gasoleoA).toBeDefined();
    expect(gasoleoA?.precio).toBeCloseTo(1.529, 3);
  });

  it("extrae null para precios no disponibles", () => {
    const raw = createRawStation();
    const precios = extraerPrecios(raw, fechaObservacion);

    // Gasolina 95 E25 (producto 24) está vacía
    const g95e25 = precios.find((p) => p.productoId === 24);
    expect(g95e25).toBeDefined();
    expect(g95e25?.precio).toBeNull();
  });

  it("asigna estacionId correctamente a todos los precios", () => {
    const raw = createRawStation({ IDEESS: "99999" });
    const precios = extraerPrecios(raw, fechaObservacion);

    for (const precio of precios) {
      expect(precio.estacionId).toBe("99999");
    }
  });

  it("asigna fechaObservacion correctamente", () => {
    const raw = createRawStation();
    const precios = extraerPrecios(raw, "2026-01-15");

    for (const precio of precios) {
      expect(precio.fechaObservacion).toBe("2026-01-15");
    }
  });

  it("maneja estación sin ningún precio", () => {
    const raw = createRawStation({
      "Precio Gasolina 95 E5": "",
      "Precio Gasolina 95 E10": "",
      "Precio Gasolina 98 E5": "",
      "Precio Gasoleo A": "",
      "Precio Gasoleo B": "",
      "Precio Gasoleo Premium": "",
    });
    const precios = extraerPrecios(raw, fechaObservacion);

    // Todos los precios deben ser null
    const preciosConValor = precios.filter((p) => p.precio !== null);
    expect(preciosConValor.length).toBe(0);
  });
});
