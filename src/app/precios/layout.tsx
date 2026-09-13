import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Precios de carburantes",
  description:
    "Consulta los precios actuales de gasolina, gasóleo y otros carburantes en España. Evolución histórica de precios con datos oficiales del MITECO.",
  openGraph: {
    title: "Precios de carburantes en tiempo real",
    description:
      "Consulta precios de gasolina, gasóleo y otros carburantes. Datos oficiales del MITECO con gráficos históricos.",
    type: "website",
  },
};

export default function PreciosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
