import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "playwright", "tesseract.js"],
  // Phone/demo via `cloudflared tunnel` (hostname changes each quick tunnel).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
