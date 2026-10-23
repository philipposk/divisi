import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteJsonLd } from "@/components/SiteJsonLd";

export const metadata: Metadata = {
  metadataBase: new URL("https://divisi.6x7.gr"),
  alternates: { canonical: "./" },
  robots: { index: true, follow: true },
  title: "Divisi — practice tracks for choirs",
  description:
    "Split a choir recording into soprano, alto, tenor and bass practice tracks. Slow it down without changing the pitch, loop the hard bar, hear your own line.",
  openGraph: {
    title: "Divisi",
    description: "SATB practice tracks from your own choir recordings.",
    type: "website",
    url: "https://divisi.6x7.gr",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Divisi" }],
  },
  twitter: { card: "summary_large_image", title: "Divisi", images: ["/og-image.png"] },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <SiteJsonLd />{children}</body>
    </html>
  );
}
