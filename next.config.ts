import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Excel libraries and the Postgres driver run natively in Node instead of being bundled.
  serverExternalPackages: ["exceljs", "xlsx", "pg"],
  turbopack: {
    // Pin the project root (a stray lockfile higher up the disk would otherwise confuse detection).
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
