import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PATURA Stallplan Assistant",
  description: "Hybridanalyse für Stallpläne: PDF, KI-Vorschläge und nachvollziehbare Fachlogik.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
