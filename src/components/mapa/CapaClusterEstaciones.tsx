"use client";

import { useEffect, useCallback, useRef } from "react";
import { useMap } from "react-leaflet";
import { useRouter } from "next/navigation";
import L from "leaflet";
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

// ─── Iconos: CINCO instancias para miles de marcadores ────────────────────
/**
 * Antes se llamaba a `createIcon(color)` por CADA marcador, lo que construía
 * hasta 2.000 objetos DivIcon idénticos (mismo HTML de 12 líneas, mismos
 * tamaños) por recarga. Solo existen 5 colores posibles, así que se crean una
 * vez y se comparten: Leaflet clona el nodo por marcador internamente, así
 * que reutilizar la instancia es exactamente lo que el plugin espera y no
 * mezcla iconos entre marcadores. Se ahorra todo el trabajo de parseo de ese
 * HTML en cada refresco del viewport.
 */
const ICONOS = new Map<string, L.DivIcon>();

function getIcon(color: string): L.DivIcon {
  let icono = ICONOS.get(color);
  if (!icono) {
    icono = L.divIcon({
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
    ICONOS.set(color, icono);
  }
  return icono;
}

// ─── Contenido del popup (HTML plano, construido al abrirlo) ───────────────
/** Escapa el texto que viene de la fuente oficial antes de insertarlo como HTML. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML del popup de una estación.
 *
 * ── Por qué HTML y ya no un componente React ─────────────────────────────
 *
 * Antes cada marcador creaba su propio root de React (`createRoot` + `render`)
 * al vuelo, aunque el usuario no abriese ni un popup: con 2.000 estaciones eso
 * eran 2.000 raíces de React y 2.000 renders por cada refresco del viewport.
 * Era, con diferencia, el mayor consumidor de CPU del mapa.
 *
 * Ahora el HTML se construye SOLO cuando se abre el popup (microsegundos, una
 * vez por estación y sesión). Los enlaces siguen navegando dentro de la SPA:
 * CapaClusterEstaciones intercepta el clic en `a[data-nav]` y usa el router de
 * Next, así que no se pierde la navegación de cliente que daba <Link>.
 */
function popupHtml(estacion: EstacionMapa, color: string): string {
  const precio =
    estacion.precio !== null
      ? `
      <div class="mt-3 p-2 rounded-lg" style="background-color: ${color}20">
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-bold" style="color: ${color}">${estacion.precio.toFixed(
            3
          )}</span>
          <span class="text-sm text-gray-600">€/L</span>
        </div>
      </div>`
      : `
      <div class="mt-3 p-2 bg-gray-100 rounded-lg">
        <span class="text-sm text-gray-500">Precio no disponible</span>
      </div>`;

  return `
    <div class="min-w-[200px]">
      <h3 class="font-bold text-gray-900">${escapar(
        estacion.rotulo || "Estación sin nombre"
      )}</h3>
      <p class="text-sm text-gray-600 mt-1">${escapar(estacion.localidad)}</p>
      ${precio}
      <a href="/estacion/${encodeURIComponent(estacion.id)}" data-nav
         class="mt-3 block text-center text-sm text-amber-600 hover:text-amber-700 font-medium">
        Ver detalles →
      </a>
    </div>
  `;
}

// ─── Capa de clustering ───────────────────────────────────────────────────
/**
 * Renderiza las estaciones con leaflet.markercluster (agrupación por zoom).
 *
 * El contenido de cada popup se genera de forma perezosa al abrirlo y la
 * navegación al detalle se delega en un único listener sobre el contenedor del
 * mapa (no uno por marcador).
 */
export function CapaClusterEstaciones({
  estaciones,
  precioMin,
  precioMax,
}: CapaClusterEstacionesProps) {
  const map = useMap();
  const router = useRouter();
  const grupoRef = useRef<L.MarkerClusterGroup | null>(null);

  /**
   * Navegación delegada: un solo listener para los ~2.000 popups.
   * Respeta los modificadores (Ctrl/Cmd/Shift) para que "abrir en pestaña
   * nueva" siga funcionando como un enlace normal. Si el clic no llega aquí
   * (por ejemplo si Leaflet lo detuviera), el `<a>` hace su navegación
   * habitual: el peor caso es una recarga completa, nunca un enlace muerto.
   */
  useEffect(() => {
    const contenedor = map.getContainer();
    const alPulsar = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const enlace = (ev.target as HTMLElement | null)?.closest?.(
        "a[data-nav]"
      ) as HTMLAnchorElement | null;
      if (!enlace) return;
      const href = enlace.getAttribute("href");
      if (!href) return;
      ev.preventDefault();
      router.push(href);
    };
    contenedor.addEventListener("click", alPulsar);
    return () => contenedor.removeEventListener("click", alPulsar);
  }, [map, router]);

  const limpiar = useCallback(() => {
    if (grupoRef.current) {
      grupoRef.current.clearLayers();
      map.removeLayer(grupoRef.current);
      grupoRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    if (!map || estaciones.length === 0) return;

    limpiar();

    const grupo = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 200,
      chunkDelay: 10,
      maxClusterRadius: 45,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      removeOutsideVisibleBounds: true,
    });

    // Se crea el array de marcadores de una vez y se añade con addLayers: el
    // plugin lo trocea con `chunkedLoading`, en lugar de que el bucle bloquee
    // el hilo principal marcador a marcador.
    const marcadores: L.Marker[] = [];

    for (const estacion of estaciones) {
      const color = getColor(estacion.precio, precioMin, precioMax);
      const marcador = L.marker([estacion.latitud, estacion.longitud], {
        icon: getIcon(color),
        title: estacion.rotulo || estacion.localidad,
      });

      // Placeholder vacío: el HTML real se genera al abrir (ver popupHtml).
      marcador.bindPopup("", {
        maxWidth: 280,
        minWidth: 220,
        autoPanPadding: [40, 40],
      });
      marcador.on("popupopen", () => {
        marcador.setPopupContent(popupHtml(estacion, color));
      });

      marcadores.push(marcador);
    }

    grupo.addLayers(marcadores);
    map.addLayer(grupo);
    grupoRef.current = grupo;

    return limpiar;
  }, [map, estaciones, precioMin, precioMax, limpiar]);

  return null;
}
