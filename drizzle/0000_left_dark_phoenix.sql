CREATE TABLE "ccaa" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estaciones" (
	"id" text PRIMARY KEY NOT NULL,
	"municipio_id" text NOT NULL,
	"provincia_id" text NOT NULL,
	"ccaa_id" text NOT NULL,
	"rotulo" text,
	"direccion" text NOT NULL,
	"localidad" text NOT NULL,
	"codigo_postal" text NOT NULL,
	"latitud" double precision NOT NULL,
	"longitud" double precision NOT NULL,
	"horario" text NOT NULL,
	"margen" text NOT NULL,
	"tipo_venta" text NOT NULL,
	"bioetanol_pct" double precision DEFAULT 0 NOT NULL,
	"ester_metilico_pct" double precision DEFAULT 0 NOT NULL,
	"fecha_actualizacion" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hist_ccaa_mes" (
	"ccaa_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"mes" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_estaciones" integer NOT NULL,
	CONSTRAINT "hist_ccaa_mes_ccaa_id_producto_id_mes_pk" PRIMARY KEY("ccaa_id","producto_id","mes")
);
--> statement-breakpoint
CREATE TABLE "hist_estacion_mes" (
	"estacion_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"mes" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_observaciones" integer NOT NULL,
	CONSTRAINT "hist_estacion_mes_estacion_id_producto_id_mes_pk" PRIMARY KEY("estacion_id","producto_id","mes")
);
--> statement-breakpoint
CREATE TABLE "hist_geo_dia" (
	"ambito" text NOT NULL,
	"geo_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"fecha" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_estaciones" integer NOT NULL,
	CONSTRAINT "hist_geo_dia_ambito_geo_id_producto_id_fecha_pk" PRIMARY KEY("ambito","geo_id","producto_id","fecha")
);
--> statement-breakpoint
CREATE TABLE "hist_geo_semana" (
	"ambito" text NOT NULL,
	"geo_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"semana" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_estaciones" integer NOT NULL,
	CONSTRAINT "hist_geo_semana_ambito_geo_id_producto_id_semana_pk" PRIMARY KEY("ambito","geo_id","producto_id","semana")
);
--> statement-breakpoint
CREATE TABLE "hist_meses_procesados" (
	"mes" text PRIMARY KEY NOT NULL,
	"procesado_en" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hist_mun_mes" (
	"municipio_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"mes" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_estaciones" integer NOT NULL,
	CONSTRAINT "hist_mun_mes_municipio_id_producto_id_mes_pk" PRIMARY KEY("municipio_id","producto_id","mes")
);
--> statement-breakpoint
CREATE TABLE "hist_nac_dia" (
	"producto_id" integer NOT NULL,
	"fecha" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_estaciones" integer NOT NULL,
	CONSTRAINT "hist_nac_dia_producto_id_fecha_pk" PRIMARY KEY("producto_id","fecha")
);
--> statement-breakpoint
CREATE TABLE "hist_prov_mes" (
	"provincia_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"mes" text NOT NULL,
	"precio_medio" double precision NOT NULL,
	"n_estaciones" integer NOT NULL,
	CONSTRAINT "hist_prov_mes_provincia_id_producto_id_mes_pk" PRIMARY KEY("provincia_id","producto_id","mes")
);
--> statement-breakpoint
CREATE TABLE "municipios" (
	"id" text PRIMARY KEY NOT NULL,
	"provincia_id" text NOT NULL,
	"nombre" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "precios" (
	"estacion_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"precio" double precision,
	"fecha_observacion" text NOT NULL,
	CONSTRAINT "precios_estacion_id_producto_id_pk" PRIMARY KEY("estacion_id","producto_id")
);
--> statement-breakpoint
CREATE TABLE "precios_historico" (
	"estacion_id" text NOT NULL,
	"producto_id" integer NOT NULL,
	"fecha" text NOT NULL,
	"precio" double precision,
	CONSTRAINT "precios_historico_estacion_id_producto_id_fecha_pk" PRIMARY KEY("estacion_id","producto_id","fecha")
);
--> statement-breakpoint
CREATE TABLE "productos" (
	"id" integer PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"abreviatura" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provincias" (
	"id" text PRIMARY KEY NOT NULL,
	"ccaa_id" text NOT NULL,
	"nombre" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumen_nacional" (
	"producto_id" integer PRIMARY KEY NOT NULL,
	"precio_medio" double precision NOT NULL,
	"precio_min" double precision NOT NULL,
	"precio_max" double precision NOT NULL,
	"total_estaciones" integer NOT NULL,
	"fecha" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_estaciones_municipio" ON "estaciones" USING btree ("municipio_id");--> statement-breakpoint
CREATE INDEX "idx_estaciones_provincia" ON "estaciones" USING btree ("provincia_id");--> statement-breakpoint
CREATE INDEX "idx_estaciones_ccaa" ON "estaciones" USING btree ("ccaa_id");--> statement-breakpoint
CREATE INDEX "idx_municipios_provincia" ON "municipios" USING btree ("provincia_id");--> statement-breakpoint
CREATE INDEX "idx_precios_producto" ON "precios" USING btree ("producto_id");--> statement-breakpoint
CREATE INDEX "idx_precios_fecha" ON "precios" USING btree ("fecha_observacion");--> statement-breakpoint
CREATE INDEX "idx_provincias_ccaa" ON "provincias" USING btree ("ccaa_id");