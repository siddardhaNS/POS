import type { NextConfig } from "next";

// On Vercel the browser talks only to this site: /api/* is proxied to the API project, so there is a single
// public URL and no CORS. Set API_PROXY_URL (the API deployment) and NEXT_PUBLIC_API_URL=/api to enable it.
// Locally neither is set and the app calls the API directly on NEXT_PUBLIC_API_URL (http://localhost:8010).
const apiProxy = process.env.API_PROXY_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return apiProxy ? [{ source: "/api/:path*", destination: `${apiProxy}/:path*` }] : [];
  },
};

export default nextConfig;
