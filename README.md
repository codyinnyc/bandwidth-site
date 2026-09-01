# Bandwidth Lab

Bandwidth Lab is a browser-side transfer utility that uses Cloudflare's public speed-test endpoints for download and upload traffic. The site hosts only the interface and static assets; test payloads travel directly between the visitor's browser and `speed.cloudflare.com`.

- Live site: https://cooop.io/speed
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

### Cloudflare Workers (canonical — `cooop.io/speed`)

Built by `npm run build:speed` and deployed by
`.github/workflows/deploy-cloudflare.yml` on every push to `main`.

Deploy manually with:

```bash
npm run deploy
```

Configuration lives in `wrangler.static.jsonc`. That filename is intentional:
`vite.config.ts` supplies its own inline Worker config for local dev, so a
default-named `wrangler.jsonc` at the repo root would be picked up by the dev
tooling as well. Wrangler is pointed at it explicitly with `-c`.

#### How `/speed` coexists with the rest of cooop.io

The separate `cooop-io-site` Worker answers every path on `cooop.io` (the
landing page, `/fire`, `/api/hits`). This Worker does not replace it. Cloudflare
matches a *route* ahead of another Worker's Custom Domain, so the two patterns
in `wrangler.static.jsonc` peel off just `/speed` and leave every other path
with the existing Worker.

The patterns are listed separately (`cooop.io/speed` and `cooop.io/speed/*`)
rather than as a single `cooop.io/speed*`, so a path such as `/speedtest` still
falls through to the existing Worker instead of 404ing here.

`build:speed` nests the export under `dist/speed/` because the Workers asset
router resolves request paths against the assets directory as-is: a request for
`/speed/_next/...` has to find that exact path on disk.

CI needs two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit** and **Workers Routes: Edit** on the `cooop.io` zone |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID |

### GitHub Pages (mirror — `/bandwidth-site/`)

Built by `npm run build:pages` and deployed by `.github/workflows/pages.yml`.
This target keeps the `/bandwidth-site` base path so the original project-site
URL stays valid.

### Build-time environment

| Variable | Effect |
| --- | --- |
| `STATIC_EXPORT` | `true` emits a static export |
| `SITE_BASE_PATH` | Base path the export is served under (`/speed`, `/bandwidth-site`) |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin used for Open Graph and Twitter card URLs |

Both build scripts set these themselves, so neither workflow needs an `env` block.
