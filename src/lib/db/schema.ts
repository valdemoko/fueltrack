/**
 * Esquema de base de datos para FuelTrack
 * Drizzle ORM + SQLite
 *
 * Modelo: CCAA → Provincia → Municipio → Estación → Producto → Precio
 * Fuente: MITECO (CC BY 4.0)
 */
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

// ─── Tabla: CCAA (Comunidades Autónomas) ────────────────────────────────────

export const ccaa = sqliteTable("ccaa", {
  /** ID de la CCAA (ej: "01" para Andalucía) */
  id: text("id").primaryKey(),
  /** Nombre de la comunidad autónoma */
  nombre: text("nombre").notNull(),
});

// ─── Tabla: Provincias ─────────────────────────────────────────────────────

export const provincias = sqliteTable("provincias", {
  /** ID de la provincia (ej: "29" para Málaga) */
  id: text("id").primaryKey(),
  /** ID de la CCAA a la que pertenece */
  ccaaId: text("ccaa_id")
    .notNull()
    .references(() => ccaa.id),
  /** Nombre de la provincia */
  nombre: text("nombre").notNull(),
});

// ─── Tabla: Municipios ─────────────────────────────────────────────────────

export const municipios = sqliteTable("municipios", {
  /** ID del municipio (ej: "4455") */
  id: text("id").primaryKey(),
  /** ID de la provincia */
  provinciaId: text("provincia_id")
    .notNull()
    .references(() => provincias.id),
  /** Nombre del municipio */
  nombre: text("nombre").notNull(),
});

// ─── Tabla: Estaciones de servicio ──────────────────────────────────────────

export const estaciones = sqliteTable("estaciones", {
  /** IDEESS - identificador estable de la estación */
  id: text("id").primaryKey(),
  /** ID del municipio */
  municipioId: text("municipio_id")
    .notNull()
    .references(() => municipios.id),
  /** ID de la provincia */
  provinciaId: text("provincia_id")
    .notNull()
    .references(() => provincias.id),
  /** ID de la CCAA */
  ccaaId: text("ccaa_id")
    .notNull()
    .references(() => ccaa.id),
  /** Nombre comercial / marca (Rótulo) */
  rotulo: text("rotulo"),
  /** Dirección postal */
  direccion: text("direccion").notNull(),
  /** Localidad */
  localidad: text("localidad").notNull(),
  /** Código postal */
  codigoPostal: text("codigo_postal").notNull(),
  /** Latitud WGS84 (decimal) */
  latitud: real("latitud").notNull(),
  /** Longitud WGS84 (decimal) */
  longitud: real("longitud").notNull(),
  /** Horario de apertura */
  horario: text("horario").notNull(),
  /** Tipo de margen (D=dir, I=indep, N=no aplica) */
  margen: text("margen").notNull(),
  /** Tipo de venta (P=público, A=auto, etc.) */
  tipoVenta: text("tipo_venta").notNull(),
  /** Porcentaje de bioetanol */
  bioetanolPct: real("bioetanol_pct").notNull().default(0),
  /** Porcentaje de éster metílico */
  esterMetilicoPct: real("ester_metilico_pct").notNull().default(0),
  /** Fecha de última actualización (ISO 8601) */
  fechaActualizacion: text("fecha_actualizacion").notNull(),
});

// ─── Tabla: Productos petrolíferos ─────────────────────────────────────────

export const productos = sqliteTable("productos", {
  /** ID del producto (ej: 1 = Gasolina 95 E5) */
  id: integer("id").primaryKey(),
  /** Nombre completo del producto */
  nombre: text("nombre").notNull(),
  /** Abreviatura (ej: G95E5) */
  abreviatura: text("abreviatura").notNull(),
});

// ─── Tabla: Observaciones de precio ─────────────────────────────────────────

export const precios = sqliteTable(
  "precios",
  {
    /** IDEESS de la estación */
    estacionId: text("estacion_id")
      .notNull()
      .references(() => estaciones.id),
    /** ID del producto */
    productoId: integer("producto_id")
      .notNull()
      .references(() => productos.id),
    /** Fecha/hora de la observación (ISO 8601, formato "yyyy-MM-dd HH:mm:ss") */
    fechaObservacion: text("fecha_observacion").notNull(),
    /** Precio en €/litro (null si no disponible) */
    precio: real("precio"),
  },
  (table) => ({
    /** Clave compuesta: estación + producto + fecha */
    pk: primaryKey({
      columns: [table.estacionId, table.productoId, table.fechaObservacion],
    }),
  })
);
