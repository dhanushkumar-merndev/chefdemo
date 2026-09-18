import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ChefFlow",
    short_name: "ChefFlow",
    description:
      "Manage chef services, attendance, menus and kitchen updates.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f4f0",
    theme_color: "#f6c82c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
