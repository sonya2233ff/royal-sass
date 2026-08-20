import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "playwright", "tesseract.js"],
};

export default nextConfig;
