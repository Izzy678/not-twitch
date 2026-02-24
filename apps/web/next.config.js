const path = require('path');

/** @type {import('next').NextConfig} */
module.exports = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  eslint: {
    dirs: ['app', 'components', 'lib'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};
