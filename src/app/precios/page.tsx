"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import dynamic from "next/dynamic";

const GraficoHistoricoPrecios = dynamic(
  () => import("@/components/precios/GraficoHistoricoPrecios"),
  { ssr: false }
);

interface Ccaa {
  id: string;
  nombre: string;
  numEstaciones: number;
}

interface Provincia {
  id: string;
  nombre: string;
  ccaaId: string;
}

interface Municipio {
  id: string;
  nombre: string;
  provinciaId: string;
}

interface Producto {
  id: number;
  nombre: string;
  abreviatura: string;
}

interface Estadisticas {
  precioMedio: number | null;
  precioMinimo: number | null;
  precioMaximo: number | null;
  numEstaciones: number;
}

export default function PreciosPage() {
  // Estado de selectores
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState("1");
  const [ccaaList, setCcaaList] = useState<Ccaa[]>([]);
  const [ccaaSeleccionada, setCcaaSeleccionada] = useState("");
  const [provinciasList, setProvinciasList] = useState<Provincia[]>([]);
  const [provinciaSeleccionada, setProvinciaSeleccionada] = useState("");
  const [municipiosList, setMunicipiosList] = useState<Municipio[]>([]);
  const [municipioSeleccionado, setMunicipioSeleccionado] = useState("");

  // Estado de datos
  const [estadisticas, setEstadisticas] = useState<Estadisticas | null>(null);
  const [fecha, setFecha] = useState<string>("");
  const [cargando, setCargando] = useState(false);
  const [periodoGrafico, setPeriodoGrafico] = useState("180");

  // Cargar productos al montar
  useEffect(() => {
    async function cargarProductos() {
      const res = await fetch("/api/productos?conPrecios=true");
      const data = await res.json();
      if (data.productos) {
        setProductos(data.productos);
      }
    }
    cargarProductos();
  }, []);

  // Cargar CCAA
  useEffect(() => {
    async function cargarCcaa() {
      const res = await fetch("/api/geografia");
      const data = await res.json();
      if (data.ccaa) {
        setCcaaList(data.ccaa);
      }
    }
    cargarCcaa();
  }, []);

  // Cargar provincias cuando cambia CCAA
  useEffect(() => {
    if (!ccaaSeleccionada) {
      setProvinciasList([]);
      setProvinciaSeleccionada("");
      return;
    }
    async function cargarProvincias() {
      const res = await fetch(`/api/geografia?ccaaId=${ccaaSeleccionada}`);
      const data = await res.json();
      if (data.provincias) {
        setProvinciasList(data.provincias);
      }
    }
    cargarProvincias();
  }, [ccaaSeleccionada]);

  // Cargar municipios cuando cambia provincia
  useEffect(() => {
    if (!provinciaSeleccionada) {
      setMunicipiosList([]);
      setMunicipioSeleccionado("");
      return;
    }
    async function cargarMunicipios() {
      const res = await fetch(
        `/api/geografia?provinciaId=${provinciaSeleccionada}`
      );
      const data = await res.json();
      if (data.municipios) {
        setMunicipiosList(data.municipios);
      }
    }
    cargarMunicipios();
  }, [provinciaSeleccionada]);

  // Cargar estadísticas cuando cambian los filtros
  const cargarEstadisticas = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams({
        productoId: productoSeleccionado,
      });
      if (municipioSeleccionado) params.set("municipioId", municipioSeleccionado);
      else if (provinciaSeleccionada) params.set("provinciaId", provinciaSeleccionada);
      else if (ccaaSeleccionada) params.set("ccaaId", ccaaSeleccionada);

      const res = await fetch(`/api/precios-area?${params}`);
      const data = await res.json();
      if (data.estadisticas) {
        setEstadisticas(data.estadisticas);
      }
      if (data.fecha) {
        setFecha(data.fecha);
      }
    } catch {
      setEstadisticas(null);
    } finally {
      setCargando(false);
    }
  }, [productoSeleccionado, ccaaSeleccionada, provinciaSeleccionada, municipioSeleccionado]);

  useEffect(() => {
    cargarEstadisticas();
  }, [cargarEstadisticas]);

  // Formatear precio
  const fmt = (v: number | null) =>
    v != null ? `${Number(v).toFixed(3)} €/L` : "—";

  // Formatear fecha
  const fmtFecha = (f: string) => {
    if (!f) return "";
    // Formato: "dd/MM/yyyy HH:mm:ss"
    const partes = f.split(" ")[0].split("/");
    if (partes.length === 3) {
      return `${partes[0]}/${partes[1]}/${partes[2]}`;
    }
    return f;
  };

  return (
    <div className="min-h-screen bg-surface-primary">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-2">
            Precios de carburantes
          </h1>
          <p className="text-stone-600">
            Consulta los precios actuales y la evolución histórica de
            carburantes en España.
          </p>
        </div>

        {/* Filtros */}
        <div className="card mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Combustible */}
            <div>
              <label
                htmlFor="producto"
                className="block text-sm font-medium text-stone-700 mb-1"
              >
                Combustible
              </label>
              <select
                id="producto"
                value={productoSeleccionado}
                onChange={(e) => setProductoSeleccionado(e.target.value)}
                className="w-full rounded-lg border-stone-300 bg-white text-stone-900 text-sm focus:border-amber-500 focus:ring-amber-500"
              >
                {productos.length > 0 ? (
                  productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))
                ) : (
                  <option value="1">Gasolina 95 E5</option>
                )}
              </select>
            </div>

            {/* CCAA */}
            <div>
              <label
                htmlFor="ccaa"
                className="block text-sm font-medium text-stone-700 mb-1"
              >
                Comunidad Autónoma
              </label>
              <select
                id="ccaa"
                value={ccaaSeleccionada}
                onChange={(e) => {
                  setCcaaSeleccionada(e.target.value);
                  setProvinciaSeleccionada("");
                  setMunicipioSeleccionado("");
                }}
                className="w-full rounded-lg border-stone-300 bg-white text-stone-900 text-sm focus:border-amber-500 focus:ring-amber-500"
              >
                <option value="">Todas</option>
                {ccaaList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>

            {/* Provincia */}
            <div>
              <label
                htmlFor="provincia"
                className="block text-sm font-medium text-stone-700 mb-1"
              >
                Provincia
              </label>
              <select
                id="provincia"
                value={provinciaSeleccionada}
                onChange={(e) => {
                  setProvinciaSeleccionada(e.target.value);
                  setMunicipioSeleccionado("");
                }}
                disabled={!ccaaSeleccionada || provinciasList.length === 0}
                className="w-full rounded-lg border-stone-300 bg-white text-stone-900 text-sm focus:border-amber-500 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {ccaaSeleccionada ? "Todas" : "Selecciona CCAA"}
                </option>
                {provinciasList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>

            {/* Municipio */}
            <div>
              <label
                htmlFor="municipio"
                className="block text-sm font-medium text-stone-700 mb-1"
              >
                Municipio
              </label>
              <select
                id="municipio"
                value={municipioSeleccionado}
                onChange={(e) => setMunicipioSeleccionado(e.target.value)}
                disabled={!provinciaSeleccionada || municipiosList.length === 0}
                className="w-full rounded-lg border-stone-300 bg-white text-stone-900 text-sm focus:border-amber-500 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {provinciaSeleccionada ? "Todos" : "Selecciona provincia"}
                </option>
                {municipiosList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Estadísticas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">
              Precio medio
            </p>
            <p className="font-display text-2xl font-bold text-stone-900">
              {cargando ? "..." : fmt(estadisticas?.precioMedio ?? null)}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
              <TrendingDown className="w-3 h-3 text-green-600" />
              Mínimo
            </p>
            <p className="font-display text-2xl font-bold text-green-600">
              {cargando ? "..." : fmt(estadisticas?.precioMinimo ?? null)}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
              <TrendingUp className="w-3 h-3 text-red-600" />
              Máximo
            </p>
            <p className="font-display text-2xl font-bold text-red-600">
              {cargando ? "..." : fmt(estadisticas?.precioMaximo ?? null)}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
              <BarChart3 className="w-3 h-3 text-amber-600" />
              Estaciones
            </p>
            <p className="font-display text-2xl font-bold text-amber-600">
              {cargando ? "..." : estadisticas?.numEstaciones ?? 0}
            </p>
          </div>
        </div>

        {fecha && (
          <p className="text-sm text-stone-500 mb-6">
            Datos actualizados a: {fmtFecha(fecha)}
          </p>
        )}

        {/* Gráfico histórico */}
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h2 className="font-display text-xl font-bold text-stone-900">
              Evolución histórica
            </h2>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "30", label: "1 mes" },
                { value: "90", label: "3 meses" },
                { value: "180", label: "6 meses" },
                { value: "365", label: "1 año" },
                { value: "730", label: "2 años" },
              ].map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriodoGrafico(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    periodoGrafico === p.value
                      ? "bg-amber-600 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[300px] sm:h-[400px]">
            <GraficoHistoricoPrecios
              productoId={Number(productoSeleccionado)}
              periodo={periodoGrafico}
              ccaaId={ccaaSeleccionada || undefined}
              provinciaId={provinciaSeleccionada || undefined}
              municipioId={municipioSeleccionado || undefined}
            />
          </div>
        </div>

        {/* Info */}
        <div className="mt-8 text-sm text-stone-500 space-y-2">
          <p>
            Todos los datos provienen de la API oficial del Ministerio para
            la Transición Ecológica y el Reto Demográfico (MITECO). Los
            precios se actualizan periódicamente según la frecuencia de
            publicación del ministerio.
          </p>
          <p>
            El histórico se construye con observaciones diarias reales
            registradas por el sistema desde que comenzó su ingesta: no hay
            estimaciones ni interpolaciones. El gráfico muestra la evolución
            del precio medio del área seleccionada para el combustible
            elegido, y la serie se alarga día a día.
          </p>
        </div>

        {/* Bloque descriptivo SSR (indexable): explica la herramienta sin
            depender de JavaScript y responde a la intención de búsqueda
            "precios de carburantes" (auditoría I15). Texto estático: no
            añade consultas a la base de datos. */}
        <section className="mt-12 max-w-3xl text-stone-600 leading-relaxed space-y-4">
          <h2 className="font-display text-2xl font-bold text-stone-900">
            Cómo usar esta herramienta de precios
          </h2>
          <p>
            Esta herramienta permite consultar el precio medio, mínimo y máximo
            de los carburantes en España y filtrarlo por comunidad autónoma,
            provincia y municipio. Al seleccionar un área, las tarjetas
            superiores muestran la estadística calculada sobre las estaciones
            con precio publicado en la última observación oficial disponible.
          </p>
          <p>
            Los combustibles disponibles incluyen gasolina 95 E5, gasolina 98
            E5, gasóleo A habitual y gasóleo premium, entre otros productos
            que comunican las estaciones al ministerio. El histórico permite
            comparar la evolución del precio medio del área seleccionada en
            cinco periodos: un mes, tres meses, seis meses, un año y dos años.
          </p>
          <p>
            Todos los datos provienen de la fuente oficial (MITECO, licencia
            CC BY 4.0) y se actualizan a diario mediante un proceso automático.
            Si buscas una estación concreta, puedes usar el{" "}
            <Link href="/gasolineras" className="text-amber-600 hover:text-amber-700">
              listado de gasolineras por municipio
            </Link>{" "}
            o el{" "}
            <Link href="/mapa" className="text-amber-600 hover:text-amber-700">
              mapa interactivo
            </Link>
            . Para entender cómo se calculan las medias, consulta la{" "}
            <Link href="/metodologia" className="text-amber-600 hover:text-amber-700">
              metodología de datos
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
