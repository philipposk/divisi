/** Site-wide structured data (WebSite, Organization, SoftwareApplication) for search engines. */
const SITE_URL = "https://divisi.6x7.gr";
/** The one description used by meta, Open Graph, Twitter and JSON-LD. */
export const SITE_DESCRIPTION =
  "Split a choir recording into soprano, alto, tenor and bass practice tracks. Slow it down without changing the pitch, loop the hard bar, hear your own line.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Divisi",
      description: SITE_DESCRIPTION,
      publisher: { "@id": "https://6x7.gr/#organization" },
      inLanguage: "en",
    },
    {
      "@type": "Organization",
      "@id": "https://6x7.gr/#organization",
      name: "6x7",
      url: "https://6x7.gr",
    },
    {
      "@type": ["SoftwareApplication", "WebApplication"],
      "@id": `${SITE_URL}/#app`,
      name: "Divisi",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      image: `${SITE_URL}/og-image.png`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      featureList: [
        "Soprano, alto, tenor and bass practice tracks from a choir recording",
        "Slow down to 40% without changing the pitch",
        "Transpose, A–B loop and named rehearsal marks",
        "Per-voice mixer and split-ears preset",
        "Runs in the browser; nothing is uploaded",
      ],
      publisher: { "@id": "https://6x7.gr/#organization" },
    },
  ],
};

export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      // Escape "<" so the JSON can never close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}
