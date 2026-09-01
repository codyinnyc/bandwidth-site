# Bandwidth Lab

Bandwidth Lab is a browser-side transfer utility that uses Cloudflare's public speed-test endpoints for download and upload traffic. The site hosts only the interface and static assets; test payloads travel directly between the visitor's browser and `speed.cloudflare.com`.

- Live site: https://bandwidth.cooop.io/
- Mirror: https://codyinnyc.github.io/bandwidth-site/

Large or continuous tests can consume significant metered data. Use the tool only on connections you are authorized to test.

## Credit

Inspired by [HLETRD's original Data Waster `master` branch](https://github.com/hletrd/data-waster/tree/master), copyright © 2017 Jiyong Youn.

## Development

```bash
npm install
npm run dev
```

## Deployment

The site is a fully static Next.js export, published to two targets. Both build
from the same source; only the base path and canonical URL differ.

### Cloudflare Workers (canonical — `bandwidth.cooop.io`)

Built by `npm run build:static` and deployed by
`.github/workflows/deploy-cloudflare.yml` on every push to `main`.

Deploy manually with:

```bash
npm run deploy
```

Configuration lives in `wrangler.static.jsonc`. That filename is intentional:
`vite.config.ts` supplies its own inline Worker config for local dev, so a
default-named `wrangler.jsonc` at the repo root would be picked up by the dev
tooling as well. Wrangler is pointed at it explicitly with `-c`.

The `custom_domain` route makes Wrangler create the hostname's DNS record and
TLS certificate on the first deploy, so no manual DNS entry is required.

CI needs two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit**, **Workers Routes: Edit**, and **Zone: DNS: Edit** on the `cooop.io` zone |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID |

### GitHub Pages (mirror — `/bandwidth-site/`)

Built by `npm run build:pages` with `GITHUB_PAGES=true` and deployed by
`.github/workflows/pages.yml`. This target keeps the `/bandwidth-site` base
path so the original project-site URL stays valid.

### Build-time environment

| Variable | Effect |
| --- | --- |
| `STATIC_EXPORT` | `true` emits a static export at the origin root (Cloudflare target) |
| `GITHUB_PAGES` | `true` emits a static export under the `/bandwidth-site` base path |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin used for Open Graph and Twitter card URLs |
