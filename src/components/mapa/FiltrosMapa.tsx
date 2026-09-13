"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X } from "lucide-react";
import { PRODUCTOS_CLAVE } from "@/lib/types/miteco";

// ─── Tipos ─────────────────────────────────────────────────────────────────
export interface FiltroState {
  productoId: number;
  /** Nombre de municipio mostrado en el buscador */
  municipio: string;
  /** ID de municipio seleccionado (preferente sobre el nombre) */
  municipioId?: string;
}

interface FiltrosMapaProps {
  filtro: FiltroState;
  onChange: (filtro: FiltroState) => void;
}

interface MunicipioSuggestion {
  id: string;
  nombre: string;
  provinciaId: string;
  numEstaciones?: number;
}

// ─── Productos disponibles para filtro ─────────────────────────────────────
const PRODUCTOS_FILTRO = [
  { id: PRODUCTOS_CLAVE.GASOLINA_95_E5, nombre: "Gasolina 95 E5" },
  { id: PRODUCTOS_CLAVE.GASOLINA_95_E10, nombre: "Gasolina 95 E10" },
  { id: PRODUCTOS_CLAVE.GASOLINA_95_E5_PREMIUM, nombre: "Gasolina 95 Premium" },
  { id: PRODUCTOS_CLAVE.GASOLINA_98_E5, nombre: "Gasolina 98 E5" },
  { id: PRODUCTOS_CLAVE.GASOLINA_98_E10, nombre: "Gasolina 98 E10" },
  { id: PRODUCTOS_CLAVE.GASOLEO_A, nombre: "Gasóleo A" },
  { id: PRODUCTOS_CLAVE.GASOLEO_PREMIUM, nombre: "Gasóleo Premium" },
  { id: PRODUCTOS_CLAVE.GASOLEO_B, nombre: "Gasóleo B" },
  { id: PRODUCTOS_CLAVE.GASOLEO_C, nombre: "Gasóleo C" },
  { id: PRODUCTOS_CLAVE.GLP, nombre: "GLP" },
  { id: PRODUCTOS_CLAVE.GNC, nombre: "GNC" },
  { id: PRODUCTOS_CLAVE.ADBLUE, nombre: "AdBlue" },
];

// Normalizar texto: quitar acentos y mayúsculas (MITECO guarda sin acentos)
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ─── Componente ────────────────────────────────────────────────────────────
export function FiltrosMapa({ filtro, onChange }: FiltrosMapaProps) {
  const [busqueda, setBusqueda] = useState(filtro.municipio);
  const [sugerencias, setSugerencias] = useState<MunicipioSuggestion[]>([]);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync external state → local input
  useEffect(() => {
    setBusqueda(filtro.municipio);
  }, [filtro.municipio]);

  // Fetch sugerencias con debounce
  const buscarSugerencias = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSugerencias([]);
      return;
    }

    setCargando(true);
    try {
      // Normalizar acentos: MITECO almacena nombres sin acentos
      const queryNormalizada = normalizarTexto(query);
      const res = await fetch(
        `/api/geografia?q=${encodeURIComponent(queryNormalizada)}`
      );
      const data = await res.json();

      // La API devuelve municipios de toda España con estaciones
      const municipios = (data.municipios || [])
        .filter((m: MunicipioSuggestion) => (m.numEstaciones ?? 0) > 0)
        .filter((m: MunicipioSuggestion) =>
          normalizarTexto(m.nombre).includes(queryNormalizada)
        )
        .map((m: MunicipioSuggestion) => ({
          id: m.id,
          nombre: m.nombre,
          provinciaId: m.provinciaId,
        }));
      setSugerencias(municipios.slice(0, 8));
    } catch {
      setSugerencias([]);
    } finally {
      setCargando(false);
    }
  }, []);

  // Manejar cambio en input con debounce
  const handleInputChange = (value: string) => {
    setBusqueda(value);
    setMostrarSugerencias(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void buscarSugerencias(value);
    }, 300);
  };

  // Seleccionar sugerencia
  const seleccionarSugerencia = (sugerencia: MunicipioSuggestion) => {
    setBusqueda(sugerencia.nombre);
    setMostrarSugerencias(false);
    setSugerencias([]);
    onChange({
      ...filtro,
      municipio: sugerencia.nombre,
      municipioId: sugerencia.id,
    });
  };

  // Limpiar filtro
  const limpiarFiltro = () => {
    setBusqueda("");
    setSugerencias([]);
    setMostrarSugerencias(false);
    onChange({ ...filtro, municipio: "", municipioId: undefined });
    inputRef.current?.focus();
  };

  // Cerrar sugerencias al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-autocomplete]")) {
        setMostrarSugerencias(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="bg-white border-b border-stone-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        {/* Selector de producto */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="producto"
            className="text-sm font-medium text-stone-700"
          >
            Combustible:
          </label>
          <select
            id="producto"
            value={filtro.productoId}
            onChange={(e) =>
              onChange({ ...filtro, productoId: Number(e.target.value) })
            }
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:border-amber-500 focus:ring-amber-500"
          >
            {PRODUCTOS_FILTRO.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Buscador de municipio con autocompletado */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px] relative" data-autocomplete>
          <label
            htmlFor="municipio"
            className="text-sm font-medium text-stone-700"
          >
            Municipio:
          </label>
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-stone-400" />
            </div>
            <input
              ref={inputRef}
              id="municipio"
              type="text"
              value={busqueda}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => {
                if (sugerencias.length > 0) setMostrarSugerencias(true);
              }}
              placeholder="Buscar municipio..."
              className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-9 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-amber-500"
              role="combobox"
              aria-expanded={mostrarSugerencias}
              aria-controls="sugerencias-municipio"
              aria-autocomplete="list"
            />
            {busqueda && (
              <button
                onClick={limpiarFiltro}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600"
                aria-label="Limpiar búsqueda"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Dropdown de sugerencias */}
          {mostrarSugerencias && sugerencias.length > 0 && (
            <ul
              id="sugerencias-municipio"
              role="listbox"
              className="absolute top-full left-[72px] right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 max-h-60 overflow-auto"
            >
              {sugerencias.map((s) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={busqueda === s.nombre}
                  onClick={() => seleccionarSugerencia(s)}
                  className="px-4 py-2 text-sm text-stone-700 hover:bg-amber-50 cursor-pointer flex items-center gap-2"
                >
                  <Search className="w-3.5 h-3.5 text-stone-400" />
                  {s.nombre}
                </li>
              ))}
            </ul>
          )}

          {mostrarSugerencias && busqueda.length >= 2 && !cargando && sugerencias.length === 0 && (
            <ul
              id="sugerencias-municipio"
              className="absolute top-full left-[72px] right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50"
            >
              <li className="px-4 py-2 text-sm text-stone-500">
                No se encontraron municipios
              </li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
