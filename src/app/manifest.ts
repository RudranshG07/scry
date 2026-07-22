import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scry",
    short_name: "Scry",
    description: "Live forecasts for measurable physical-world events.",
    start_url: "/",
    display: "standalone",
    background_color: "#080911",
    theme_color: "#080911",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
