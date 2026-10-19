import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Healplan",
  description: "Healing cooldown timings from guild first kills, matched to your healing comp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Wowhead's tooltips for spell links; it leaves our link text and colors alone. */}
        <Script id="wh-config" strategy="afterInteractive">
          {"window.whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };"}
        </Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
