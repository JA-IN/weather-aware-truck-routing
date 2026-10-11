import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Weather-Aware Truck Routing",
    template: "%s | Weather-Aware Truck Routing",
  },
  description:
    "Production-style fullstack route intelligence app with weather risk analysis, playback controls, and explainable recommendation logic.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
