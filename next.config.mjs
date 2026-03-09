/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  experimental: {
    useWasmBinary: true,
  },
};

export default nextConfig;
