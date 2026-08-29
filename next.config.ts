import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything happens in the browser — no server, no uploads, no API routes.
  // A static export is therefore the whole app, and it will run just as happily
  // from a folder on a laptop as from a URL.
  output: "export",
  images: { unoptimized: true },

  // Deliberately no COOP/COEP. Cross-origin isolation would buy some WASM
  // threading, but it breaks embedding, Safari lacks the `credentialless`
  // escape hatch, and nothing here needs SharedArrayBuffer: signalsmith inlines
  // its own WASM and tfjs runs single-threaded.
};

export default nextConfig;
