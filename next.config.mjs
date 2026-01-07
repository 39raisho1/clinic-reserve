/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/reservation/:type",
        destination: "/:type",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
