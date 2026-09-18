"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import { createRoot, type Root } from "react-dom/client";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

// ─── Tipos ─────────────────────────────────────────────────────────────────
export interface EstacionMapa {
  id: string;
  rotulo: string | null;
  localidad: string;
  latitud: number;
  longitud: number;
  precio: number | null;
}

interface CapaClusterEstacionesProps {
  estaciones: EstacionMapa[];
  precioMin: number;
  precioMax: number;
}

// ─── Colores por rango de precio (igual que MarcadorEstacion) ─────────────
function getColor(precio: number | null, min: number, max: number): string {
  if (precio === null) return "#9ca3af"; // gray-400

  const rango = max - min;
  if (rango === 0) return "#22c55e"; // green-500

  const normalizado = (precio - min) / rango;

  if (normalizado <= 0.33) return "#22c55e"; // green-500 (barato)
  if (normalizado <= 0.66) return "#f59e0b"; // amber-500 (medio)
  return "#dc2626"; // red-600 (caro)
}

// ─── Icono personalizado ──────────────────────────────────────────────────
function createIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "custom-marker",
    html: `
      <div style="
        width: 24px;
        height: 24px;
        border-radius: 50% 50% 50% 0;
        background: ${color};
        transform: rotate(-45deg);
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      ">
        <div style="
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        "></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

// ─── Contenido del popup (React) ──────────────────────────────────────────
function PopupContenido({
  estacion,
  color,
}: {
  estacion: EstacionMapa;
  color: string;
}) {
  return (
    <div className="min-w-[200px]">
      <h3 className="font-bold text-gray-900">
        {estacion.rotulo || "Estación sin nombre"}
      </h3>

      <p className="text-sm text-gray-600 mt-1">{estacion.localidad}</p>

      {estacion.precio !== null ? (
        <div
          className="mt-3 p-2 rounded-lg"
          style={{ backgroundColor: `${color}20` }}
        >
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold" style={{ color }}>
              {estacion.precio.toFixed(3)}
            </span>
            <span className="text-sm text-gray-600">€/L</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 p-2 bg-gray-100 rounded-lg">
          <span className="text-sm text-gray-500">
            Precio no disponible
          </span>
        </div>
      )}

      <Link
        href={`/estacion/${estacion.id}`}
        className="mt-3 block text-center text-sm text-amber-600 hover:text-amber-700 font-medium"
      >
        Ver detalles →
      </Link>
    </div>
  );
}

// ─── Capa de clustering ───────────────────────────────────────────────────
/**
 * Renderiza las estaciones con leaflet.markercluster (agrupación por zoom).
 * Los popups se renderizan con React imperativamente (react-leaflet no
 * soporta markers dentro de un markerClusterGroup).
 */
export function CapaClusterEstaciones({
  estaciones,
  precioMin,
  precioMax,
}: CapaClusterEstacionesProps) {
  const map = useMap();
  const grupoRef = useRef<L.MarkerClusterGroup | null>(null);
  const rootsRef = useRef<Root[]>([]);

  /** Desmonta los roots de React de los popups FUERA del ciclo de render.
   *  React 18+ prohíbe llamar a root.unmount() sincrónicamente mientras
   *  React está renderizando (limpieza de effects durante un render
   *  concurrente); diferirlo con setTimeout evita el error
   *  "Attempted to synchronously unmount a root while React was already
   *  rendering". Los roots ya están fuera del DOM (la capa se elimina
   *  antes), así que desmontarlos en el siguiente tick es seguro. */
  const desmontarRoots = useCallback((roots: Root[]) => {
    if (roots.length === 0) return;
    window.setTimeout(() => {
      for (const r of roots) {
        try {
          r.unmount();
        } catch {
          // Root ya desmontado: ignorar
        }
      }
    }, 0);
  }, []);

  useEffect(() => {
    if (!map || estaciones.length === 0) return;

    // Limpiar capa anterior (los roots se desmontan diferidos, fuera del render)
    if (grupoRef.current) {
      map.removeLayer(grupoRef.current);
      grupoRef.current.clearLayers();
    }
    const rootsAnteriores = rootsRef.current;
    rootsRef.current = [];
    desmontarRoots(rootsAnteriores);

    const grupo = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 200,
      chunkDelay: 10,
      maxClusterRadius: 45,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      removeOutsideVisibleBounds: true,
    });

    for (const estacion of estaciones) {
      const color = getColor(estacion.precio, precioMin, precioMax);
      const marcador = L.marker([estacion.latitud, estacion.longitud], {
        icon: createIcon(color),
        title: estacion.rotulo || estacion.localidad,
      });

      // Renderizar popup con React
      const contenedor = document.createElement("div");
      const root = createRoot(contenedor);
      root.render(<PopupContenido estacion={estacion} color={color} />);
      rootsRef.current.push(root);

      marcador.bindPopup(contenedor, {
        maxWidth: 280,
        minWidth: 220,
        autoPanPadding: [40, 40],
      });

      grupo.addLayer(marcador);
    }

    map.addLayer(grupo);
    grupoRef.current = grupo;

    return () => {
      if (grupoRef.current) {
        map.removeLayer(grupoRef.current);
        grupoRef.current.clearLayers();
        grupoRef.current = null;
      }
      // Desmontar los roots de los popups diferidamente: la limpieza del
      // effect puede ejecutarse mientras React está renderizando (render
      // concurrente), y un unmount sincrónico ahí provoca el error
      // "Attempted to synchronously unmount a root while React was already
      // rendering". Los roots ya no están en el DOM, así que diferirlo es
      // seguro.
      const roots = rootsRef.current;
      rootsRef.current = [];
      desmontarRoots(roots);
    };
  }, [map, estaciones, precioMin, precioMax, desmontarRoots]);

  return null;
}