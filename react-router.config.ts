import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Behind a reverse proxy that handles HTTPS (Apache, Cloudflare), the server
  // sees http:// while browsers send an https:// Origin, so React Router would
  // reject every form as a possible cross-site request. List the public host
  // name here (no https://). It's read at build time, so rebuild after changing it.
  allowedActionOrigins: ["santa.justinashdown.com"],
} satisfies Config;
