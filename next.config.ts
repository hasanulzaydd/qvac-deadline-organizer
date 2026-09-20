import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @qvac/sdk is a native Node addon: it must never be bundled by Turbopack/webpack,
  // and it must never be reachable from a client component.
  serverExternalPackages: ["@qvac/sdk"],
};

export default nextConfig;
