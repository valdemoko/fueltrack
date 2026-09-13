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
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Props {
  productoId: number;
  periodo: string;
  ccaaId?: string;
  provinciaId?: string;
  municipioId?: string;
}

interface DatoHistorico {
  fecha: string;
  precioMedio: number;
}

export default function GraficoHistoricoPrecios({
  productoId,
  periodo,
  ccaaId,
  provinciaId,
  municipioId,
}: Props) {
  const [datos, setDatos] = useState<DatoHistorico[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      setCargando(true);
      try {
        // Calcular fecha desde en formato ISO (yyyy-MM-dd) — el API compara strings ISO
        const desde = new Date();
        desde.setDate(desde.getDate() - Number(periodo));
        const desdeStr = desde.toISOString().split("T")[0];

        const params = new URLSearchParams({
          productoId: String(productoId),
          desde: desdeStr,
          limite: "1000",
        });

        if (municipioId) params.set("municipioId", municipioId);
        else if (provinciaId) params.set("provinciaId", provinciaId);
        else if (ccaaId) params.set("ccaaId", ccaaId);

        const res = await fetch(`/api/historico?${params}`);
        const data = await res.json();

        if (data.historico) {
          // Agrupar por fecha y calcular promedio
          const porFecha = new Map<string, number[]>();
          data.historico.forEach((h: { fecha: string; precio: number }) => {
            if (!porFecha.has(h.fecha)) porFecha.set(h.fecha, []);
            porFecha.get(h.fecha)!.push(h.precio);
          });

          const datosGrafico: DatoHistorico[] = Array.from(porFecha.entries())
            .map(([fecha, precios]) => ({
              fecha,
              precioMedio:
                precios.reduce((a, b) => a + b, 0) / precios.length,
            }))
            .sort((a, b) => a.fecha.localeCompare(b.fecha));

          setDatos(datosGrafico);
        }
      } catch {
        setDatos([]);
      } finally {
        setCargando(false);
      }
    }
    cargar();
  }, [productoId, periodo, ccaaId, provinciaId, municipioId]);

  if (cargando) {
    return (
      <div className="h-full flex items-center justify-center text-stone-500 text-sm">
        Cargando datos históricos...
      </div>
    );
  }

  if (datos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-stone-500 text-sm">
        No hay datos históricos disponibles para esta selección.
      </div>
    );
  }

  // Formatear fechas para el eje X
  const labels = datos.map((d) => {
    const partes = d.fecha.split(" ")[0].split("/");
    if (partes.length === 3) {
      return `${partes[0]}/${partes[1]}/${partes[2]}`;
    }
    return d.fecha;
  });

  const chartData = {
    labels,
    datasets: [
      {
        label: "Precio medio (€/L)",
        data: datos.map((d) => d.precioMedio),
        borderColor: "#D97706",
        backgroundColor: "rgba(217, 119, 6, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: datos.length > 100 ? 0 : 2,
        pointHoverRadius: 5,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) => {
            if (ctx.parsed.y != null) {
              return `${ctx.parsed.y.toFixed(3)} €/L`;
            }
            return "";
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 8,
          font: { size: 11 },
        },
      },
      y: {
        ticks: {
          callback: (v: string | number) => `${Number(v).toFixed(2)} €`,
          font: { size: 11 },
        },
      },
    },
  };

  return <Line data={chartData} options={options} />;
}
