import type { NextConfig } from "next";

/**
 * "Ask the data" is served by a Python function (api/ask.py). On Vercel that function
 * answers /api/ask directly. Locally it runs under uvicorn on port 8140 (`pnpm dev:api`)
 * and the dev server forwards to it. Set ASK_API_ORIGIN to forward from a production
 * build as well, for example to try the live path against `next start`.
 */
const askOrigin =
  process.env.ASK_API_ORIGIN ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8140" : undefined);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return askOrigin ? [{ source: "/api/ask", destination: `${askOrigin}/api/ask` }] : [];
  },
  async headers() {
    return [
      {
        // The engine files are versioned by the package; let browsers keep them.
        source: "/duckdb/:file*",
        headers: [{ key: "cache-control", value: "public, max-age=604800, immutable" }],
      },
    ];
  },
};

export default nextConfig;
