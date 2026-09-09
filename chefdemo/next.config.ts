import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_TEST_DIST || ".next",
};

export default nextConfig;
