# Bandwidth Lab

Bandwidth Lab is a browser-side transfer utility that uses Cloudflare's public speed-test endpoints for download and upload traffic. The GitHub Pages site hosts only the interface and static assets; test payloads travel directly between the visitor's browser and `speed.cloudflare.com`.

Live site: https://codyinnyc.github.io/bandwidth-site/

Large or continuous tests can consume significant metered data. Use the tool only on connections you are authorized to test.

## Credit

Inspired by [HLETRD's original Data Waster `master` branch](https://github.com/hletrd/data-waster/tree/master), copyright © 2017 Jiyong Youn.

## Development

```bash
npm install
npm run dev
```

The GitHub Pages deployment is generated as a static Next.js export by the workflow in `.github/workflows/pages.yml`.
