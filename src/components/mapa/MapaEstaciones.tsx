"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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

/**
 * Registra la instancia del mapa en el padre y recarga los datos cuando
 * el usuario termina de mover/zoom (para pedir solo el viewport visible).
 */
function ViewportBridge({
  onMapa,
  onViewport,
}: {
  onMapa: (map: L.Map) => void;
  onViewport: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    onMapa(map);
    map.on("moveend", onViewport);
    return () => {
      map.off("moveend", onViewport);
    };
  }, [map, onMapa, onViewport]);
  return null;
}

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
/**
 * Centra el mapa en las estaciones filtradas. CLAVE: solo ajusta la vista
 * UNA VEZ por filtro (clave). Si se llamara en cada render/cambio de datos,
 * fitBounds dispararía `moveend` → recarga de datos → nuevos datos →
 * fitBounds… un bucle infinito de peticiones que deja el mapa cargando
 * para siempre.
 */
function AjustarVista({
  estaciones,
  activo,
  clave,
}: {
  estaciones: EstacionMapa[];
  activo: boolean;
  clave: string;
}) {
  const map = useMap();
  const ultimaClaveRef = useRef("");

  useEffect(() => {
    if (!activo || estaciones.length === 0) return;
    if (ultimaClaveRef.current === clave) return; // ya ajustado para este filtro
    ultimaClaveRef.current = clave;

    // Si hay filtro de municipio, centrar en las estaciones filtradas
    const bounds = L.latLngBounds(
      estaciones.map((e) => [e.latitud, e.longitud] as [number, number])
    );
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }, [estaciones, map, activo, clave]);

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
  const mapRef = useRef<L.Map | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroState>({
    productoId: Number.isInteger(productoParam) && productoParam > 0
      ? productoParam
      : PRODUCTOS_CLAVE.GASOLINA_95_E5,
    municipio: municipioIdParam ?? "",
    municipioId: municipioIdParam ?? undefined,
  });
  /** Ref al filtro actual: permite a handleViewport consultarlo sin
   *  recrear el callback (y sin re-suscribir eventos) en cada render. */
  const filtroRef = useRef(filtro);
  filtroRef.current = filtro;
  /** AbortController de la petición en curso: al cambiar filtros/viewport,
   *  la respuesta antigua se descarta en vez de machacar el estado. */
  const abortRef = useRef<AbortController | null>(null);

  /** Recarga por movimiento del mapa SOLO en modo viewport (sin filtro de
   *  municipio: con filtro los datos no dependen del viewport y recargar
   *  sería otro camino hacia el bucle infinito). */
  const handleViewport = useCallback(() => {
    const f = filtroRef.current;
    if (!f.municipioId && !f.municipio) {
      setViewportVersion((v) => v + 1);
    }
  }, []);

  // Fetch de datos del mapa
  const cargarDatos = useCallback(async () => {
    // Cancelar la petición anterior si sigue en vuelo (evita respuestas
    // obsoletas pisando a las nuevas y estados de carga eternos)
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

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
      } else if (mapRef.current) {
        // Sin filtro: pedir solo el viewport visible (bounding box) para no
        // descargar las ~13k estaciones de España de una vez.
        const b = mapRef.current.getBounds();
        if (b) {
          params.set(
            "bbox",
            [
              b.getSouth().toFixed(4),
              b.getWest().toFixed(4),
              b.getNorth().toFixed(4),
              b.getEast().toFixed(4),
            ].join(",")
          );
        }
        params.set("limite", "2000");
      }

      const res = await fetch(`/api/mapa?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Error al cargar datos");

      const json = await res.json();
      if (controller.signal.aborted) return;
      setData(json);
    } catch (err) {
      // Aborto esperado (nueva petición o desmontaje): no es un error real
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (!controller.signal.aborted) setCargando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- viewportVersion fuerza la recarga al mover el mapa
  }, [filtro, viewportVersion]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Al desmontar: cancelar cualquier petición en vuelo
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

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
          <ViewportBridge
            onMapa={(m) => {
              mapRef.current = m;
            }}
            onViewport={handleViewport}
          />
          {/* Ajustar vista solo cuando hay filtro de municipio (una vez por filtro) */}
          <AjustarVista
            estaciones={data?.estaciones ?? []}
            activo={!!(filtro.municipioId || filtro.municipio)}
            clave={filtro.municipioId ?? filtro.municipio ?? ""}
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
