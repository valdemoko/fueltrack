"use client";

import { useState, useEffect } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

// ─── Registrar componentes de Chart.js ────────────────────────────────────
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface ObservacionHistorica {
  fecha: string;
  precio: number | null;
}

interface ProductoHistorico {
  id: number;
  nombre: string;
  abreviatura: string;
}

interface GraficoHistoricoProps {
  estacionId: string;
  productoInicial?: number;
}

// ─── Colores por producto ──────────────────────────────────────────────────
const COLORES_PRODUCTO: Record<string, string> = {
  G95E5: "#22c55e",
  G95E10: "#16a34a",
  "G95 Premium": "#4ade80",
  G98E5: "#3b82f6",
  G98E10: "#2563eb",
  "Gasóleo A": "#f59e0b",
  "Gasóleo Premium": "#ef4444",
  "Gasóleo B": "#f97316",
  "Gasóleo C": "#fb923c",
  GLP: "#8b5cf6",
  GNC: "#06b6d4",
  AdBlue: "#6366f1",
};

function getColorProducto(abreviatura: string): string {
  return COLORES_PRODUCTO[abreviatura] || "#6b7280";
}

// ─── Componente ────────────────────────────────────────────────────────────
export function GraficoHistorico({
  estacionId,
  productoInicial = 1,
}: GraficoHistoricoProps) {
  const [productoSeleccionado, setProductoSeleccionado] = useState(
    productoInicial
  );
  const [periodo, setPeriodo] = useState("30");
  const [datos, setDatos] = useState<ObservacionHistorica[]>([]);
  const [producto, setProducto] = useState<ProductoHistorico | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Cargar datos históricos ─────────────────────────────────────────────
  useEffect(() => {
    async function cargarHistorico() {
      setCargando(true);
      setError(null);

      const dias = parseInt(periodo, 10);
      const desde = new Date(
        Date.now() - dias * 24 * 60 * 60 * 1000
      ).toISOString().split("T")[0];

      try {
        const url = `/api/historico?estacionId=${estacionId}&productoId=${productoSeleccionado}&desde=${desde}&limite=365`;
        const res = await fetch(url);

        if (!res.ok) {
          throw new Error("Error al cargar datos históricos");
        }

        const data = await res.json();
        setDatos(data.historico || []);
        setProducto(data.producto || null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al cargar datos"
        );
      } finally {
        setCargando(false);
      }
    }

    cargarHistorico();
  }, [estacionId, productoSeleccionado, periodo]);

  // ─── Preparar datos para Chart.js ────────────────────────────────────────
  const chartData = {
    labels: datos.map((d) => {
      const fecha = new Date(d.fecha);
      return fecha.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "short",
      });
    }),
    datasets: [
      {
        label: producto?.nombre || "Precio",
        data: datos.map((d) => d.precio),
        borderColor: producto
          ? getColorProducto(producto.abreviatura)
          : "#22c55e",
        backgroundColor: producto
          ? `${getColorProducto(producto.abreviatura)}20`
          : "#22c55e20",
        fill: true,
        tension: 0.3,
        pointRadius: datos.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: { parsed: { y: number | null } }) => {
            const value = context.parsed.y;
            return value !== null ? `${value.toFixed(3)} €/L` : "Sin dato";
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          maxTicksLimit: 10,
          font: {
            size: 11,
          },
        },
      },
      y: {
        grid: {
          color: "#f3f4f6",
        },
        ticks: {
          callback: (value: number | string) => `${value} €`,
          font: {
            size: 11,
          },
        },
      },
    },
  };

  // ─── Producto disponibles para selector ───────────────────────────────────
  const productosDisponibles = [
    { id: 1, nombre: "Gasolina 95 E5", abreviatura: "G95E5" },
    { id: 23, nombre: "Gasolina 95 E10", abreviatura: "G95E10" },
    { id: 3, nombre: "Gasolina 98 E5", abreviatura: "G98E5" },
    { id: 4, nombre: "Gasóleo A", abreviatura: "Gasóleo A" },
    { id: 5, nombre: "Gasóleo Premium", abreviatura: "Gasóleo Premium" },
    { id: 6, nombre: "Gasóleo B", abreviatura: "Gasóleo B" },
    { id: 17, nombre: "GLP", abreviatura: "GLP" },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Histórico de precios
      </h3>

      {/* Controles */}
      <div className="flex flex-wrap gap-4 mb-4">
        {/* Selector de producto */}
        <div>
          <label
            htmlFor="producto-select"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Combustible
          </label>
          <select
            id="producto-select"
            value={productoSeleccionado}
            onChange={(e) => setProductoSeleccionado(parseInt(e.target.value, 10))}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          >
            {productosDisponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Selector de período */}
        <div>
          <label
            htmlFor="periodo-select"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Período
          </label>
          <select
            id="periodo-select"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          >
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 3 meses</option>
            <option value="180">Últimos 6 meses</option>
            <option value="365">Último año</option>
            <option value="730">Últimos 2 años</option>
          </select>
        </div>
      </div>

      {/* Gráfico */}
      <div className="h-[300px]">
        {cargando ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Cargando datos...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-500">{error}</div>
          </div>
        ) : datos.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">
              No hay datos históricos para este período
            </div>
          </div>
        ) : (
          <Line data={chartData} options={chartOptions} />
        )}
      </div>

      {/* Información adicional */}
      {datos.length > 0 && (
        <div className="mt-4 text-sm text-gray-500">
          <p>
            {datos.length} observaciones desde{" "}
            {new Date(datos[0].fecha).toLocaleDateString("es-ES")} hasta{" "}
            {new Date(datos[datos.length - 1].fecha).toLocaleDateString("es-ES")}
          </p>
        </div>
      )}
    </div>
  );
}