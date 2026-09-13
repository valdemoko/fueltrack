"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  MapContainer,
  TileLayer,
  useMap,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CapaClusterEstaciones, type EstacionMapa } from "./CapaClusterEstaciones";
import { FiltrosMapa, type FiltroState } from "./FiltrosMapa";
import { LeyendaPrecios } from "./LeyendaPrecios";
import { PRODUCTOS_CLAVE } from "@/lib/types/miteco";

// ─── Centro de España y límites ───────────────────────────────────────────
const CENTRO_ESPANA: [number, number] = [40.0, -3.7];
const ZOOM_DEFAULT = 6;
const ZOOM_MIN = 5;
const ZOOM_MAX = 18;
// Límites del mapa: solo España (península + Baleares + Canarias)
const LIMITES_ESPANA: L.LatLngBoundsExpression = [
  [27.5, -18.5], // suroeste (Canarias)
  [44.5, 4.5], // noreste
];

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface MapaData {
  fecha: string;
  producto: number;
  total: number;
  estadisticas: {
    min: number;
    max: number;
    promedio: number;
    conPrecio: number;
    sinPrecio: number;
  };
  estaciones: EstacionMapa[];
}

// ─── Componente para ajustar vista ────────────────────────────────────────
function AjustarVista({
  estaciones,
  activo,
}: {
  estaciones: EstacionMapa[];
  activo: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!activo || estaciones.length === 0) return;

    // Si hay filtro de municipio, centrar en las estaciones filtradas
    const bounds = L.latLngBounds(
      estaciones.map((e) => [e.latitud, e.longitud] as [number, number])
    );
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }, [estaciones, map, activo]);

  return null;
}

// ─── Formatear fecha ISO → es-ES ──────────────────────────────────────────
function formatearFecha(iso: string): string {
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ─── Componente principal del mapa ─────────────────────────────────────────
export function MapaEstaciones() {
  const searchParams = useSearchParams();
  const municipioIdParam = searchParams.get("municipioId");
  const productoParam = Number(searchParams.get("producto"));

  const [data, setData] = useState<MapaData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroState>({
    productoId: Number.isInteger(productoParam) && productoParam > 0
      ? productoParam
      : PRODUCTOS_CLAVE.GASOLINA_95_E5,
    municipio: municipioIdParam ?? "",
    municipioId: municipioIdParam ?? undefined,
  });

  // Fetch de datos del mapa
  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        producto: String(filtro.productoId),
      });
      if (filtro.municipioId) {
        params.set("municipioId", filtro.municipioId);
      } else if (filtro.municipio) {
        params.set("municipio", filtro.municipio);
      }

      const res = await fetch(`/api/mapa?${params.toString()}`);
      if (!res.ok) throw new Error("Error al cargar datos");

      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, [filtro]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Rango de precios para colores
  const rangoPrecios = useMemo(() => {
    if (!data) return { min: 0, max: 2, promedio: 1 };
    return data.estadisticas;
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      {/* Filtros */}
      <FiltrosMapa filtro={filtro} onChange={setFiltro} />

      {/* Mapa */}
      <div className="flex-1 relative">
        {cargando && (
          <div
            className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/80"
            role="status"
            aria-label="Cargando estaciones"
          >
            <div className="flex items-center gap-3">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
                aria-hidden="true"
              />
              <span className="text-sm text-stone-600">
                Cargando estaciones...
              </span>
            </div>
          </div>
        )}

        {error && (
          <div
            className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/80"
            role="alert"
          >
            <div className="text-center">
              <p className="text-red-600 font-medium">Error: {error}</p>
              <button
                onClick={() => void cargarDatos()}
                className="mt-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        <MapContainer
          center={CENTRO_ESPANA}
          zoom={ZOOM_DEFAULT}
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
          maxBounds={LIMITES_ESPANA}
          maxBoundsViscosity={1}
          className="h-full w-full"
          zoomControl={false}
        >
          <ZoomControl position="topright" />
          {/* Ajustar vista solo cuando hay filtro de municipio */}
          <AjustarVista
            estaciones={data?.estaciones ?? []}
            activo={!!(filtro.municipioId || filtro.municipio)}
          />

          {/* Capa de teselas - OpenStreetMap */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Estaciones con clustering (agrupación por zoom) */}
          {data && (
            <CapaClusterEstaciones
              estaciones={data.estaciones}
              precioMin={rangoPrecios.min}
              precioMax={rangoPrecios.max}
            />
          )}
        </MapContainer>

        {/* Leyenda */}
        {data && (
          <LeyendaPrecios
            min={rangoPrecios.min}
            max={rangoPrecios.max}
            promedio={rangoPrecios.promedio}
          />
        )}
      </div>

      {/* Barra de estado */}
      {data && (
        <div className="bg-stone-50 border-t border-stone-200 px-4 py-2 text-sm text-stone-600 flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{data.total} estaciones</span>
          <span>·</span>
          <span>{data.estadisticas.conPrecio} con precio</span>
          <span>·</span>
          <span>{data.estadisticas.sinPrecio} sin precio</span>
          {data.estadisticas.conPrecio > 0 && (
            <>
              <span>·</span>
              <span>
                Rango: {data.estadisticas.min.toFixed(3)}€ -{" "}
                {data.estadisticas.max.toFixed(3)}€
              </span>
            </>
          )}
          {data.fecha && (
            <>
              <span>·</span>
              <span className="text-amber-700 font-medium">
                Datos del {formatearFecha(data.fecha)}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
