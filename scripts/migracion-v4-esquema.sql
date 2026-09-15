CREATE TABLE ccaa (id TEXT PRIMARY KEY, nombre TEXT NOT NULL);

CREATE TABLE estaciones (id TEXT PRIMARY KEY, municipio_id TEXT NOT NULL REFERENCES municipios(id), provincia_id TEXT NOT NULL REFERENCES provincias(id), ccaa_id TEXT NOT NULL REFERENCES ccaa(id), rotulo TEXT, direccion TEXT NOT NULL, localidad TEXT NOT NULL, codigo_postal TEXT NOT NULL, latitud REAL NOT NULL, longitud REAL NOT NULL, horario TEXT NOT NULL, margen TEXT NOT NULL, tipo_venta TEXT NOT NULL, bioetanol_pct REAL NOT NULL DEFAULT 0, ester_metilico_pct REAL NOT NULL DEFAULT 0, fecha_actualizacion TEXT NOT NULL);

CREATE TABLE hist_ccaa_mes (ccaa_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL, precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL, PRIMARY KEY (ccaa_id, producto_id, mes));

CREATE TABLE hist_estacion_mes (estacion_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL, precio_medio REAL NOT NULL, n_observaciones INTEGER NOT NULL, PRIMARY KEY (estacion_id, producto_id, mes));

CREATE TABLE hist_geo_dia (ambito TEXT NOT NULL, geo_id TEXT NOT NULL, producto_id INTEGER NOT NULL, fecha TEXT NOT NULL, precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL, PRIMARY KEY (ambito, geo_id, producto_id, fecha));

CREATE TABLE hist_meses_procesados (mes TEXT PRIMARY KEY, procesado_en TEXT NOT NULL);

CREATE TABLE hist_mun_mes (municipio_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL, precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL, PRIMARY KEY (municipio_id, producto_id, mes));

CREATE TABLE hist_nac_dia (producto_id INTEGER NOT NULL, fecha TEXT NOT NULL, precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL, PRIMARY KEY (producto_id, fecha));

CREATE TABLE hist_prov_mes (provincia_id TEXT NOT NULL, producto_id INTEGER NOT NULL, mes TEXT NOT NULL, precio_medio REAL NOT NULL, n_estaciones INTEGER NOT NULL, PRIMARY KEY (provincia_id, producto_id, mes));

CREATE TABLE municipios (id TEXT PRIMARY KEY, provincia_id TEXT NOT NULL REFERENCES provincias(id), nombre TEXT NOT NULL);

CREATE TABLE precios (estacion_id TEXT NOT NULL, producto_id INTEGER NOT NULL, precio REAL, fecha_observacion TEXT NOT NULL, PRIMARY KEY (estacion_id, producto_id));

CREATE TABLE precios_historico (estacion_id TEXT NOT NULL, producto_id INTEGER NOT NULL, fecha TEXT NOT NULL, precio REAL, PRIMARY KEY (estacion_id, producto_id, fecha));

CREATE TABLE productos (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, abreviatura TEXT NOT NULL);

CREATE TABLE provincias (id TEXT PRIMARY KEY, ccaa_id TEXT NOT NULL REFERENCES ccaa(id), nombre TEXT NOT NULL);