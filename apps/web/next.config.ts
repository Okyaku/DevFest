import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@ai-closet/shared"]
};
export default nextConfig;
