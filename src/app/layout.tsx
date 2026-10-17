import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Healplan",
  description: "Healing cooldown timings from guild first kills, matched to your healing comp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
