import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The hosted/preview proxy reaches the dev server from <port>-<sandboxId>.e2b.app.
  // Without this, Next 16 blocks /_next/* dev resources cross-origin (no HMR, stale UI).
  // Dev-only: Next ignores allowedDevOrigins in production builds.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
