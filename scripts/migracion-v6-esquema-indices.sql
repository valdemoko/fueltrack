CREATE INDEX idx_estaciones_ccaa ON estaciones(ccaa_id);

CREATE INDEX idx_estaciones_lat_lon ON estaciones(latitud, longitud);

CREATE INDEX idx_estaciones_municipio ON estaciones(municipio_id);

CREATE INDEX idx_estaciones_provincia ON estaciones(provincia_id);

CREATE INDEX idx_hist_fecha ON precios_historico(fecha);

CREATE INDEX idx_hist_geo_fecha ON hist_geo_dia(fecha);

CREATE INDEX idx_municipios_provincia ON municipios(provincia_id);

CREATE INDEX idx_precios_fecha ON precios(fecha_observacion);

CREATE INDEX idx_precios_producto ON precios(producto_id);

CREATE INDEX idx_precios_producto_fecha ON precios(producto_id, fecha_observacion);

CREATE INDEX idx_provincias_ccaa ON provincias(ccaa_id);