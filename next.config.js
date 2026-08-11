/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    serverActions: {
      // Next 14 caps server action bodies at 1 MB by default, which rejected
      // any logo between 1 and 2 MB before the action ever ran — the request
      // never reached Supabase, so the user saw a framework error rather than
      // our validation message.
      //
      // Set to 4 MB so the application's own 2 MB rule stays authoritative and
      // an oversized file gets a readable rejection instead of a wall.
      bodySizeLimit: "4mb",
    },
  },
};

module.exports = nextConfig;
