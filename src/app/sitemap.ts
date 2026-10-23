import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE_URL = "https://divisi.6x7.gr";

// Only real public pages belong here.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["/"];
  return routes.map((route) => ({
    url: route === "/" ? SITE_URL : `${SITE_URL}${route}`,
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : 0.5,
  }));
}
