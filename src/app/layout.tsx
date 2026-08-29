import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Divisi — practice tracks for choirs",
  description:
    "Split a choir recording into soprano, alto, tenor and bass practice tracks. Slow it down without changing the pitch, loop the hard bar, hear your own line.",
  openGraph: {
    title: "Divisi",
    description: "SATB practice tracks from your own choir recordings.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
