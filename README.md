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

## Interface and transfer controls

- Apple system typography (San Francisco on Apple devices), pure-black OLED backgrounds, and an animated rainbow viewport border.
- Live throughput chart, Mbps/MB/s switching, exact payload totals, and a preserved average after completion or stop.
- A blank or zero data allowance means unlimited. Negative, fractional, and nonnumeric amounts are rejected. The allowance is shared across all connections and both directions.
- Basic mode uses one connection count. Advanced mode provides independent download and upload thread pools, 1–16 each. Only pools for the selected direction run. Actual concurrency remains subject to browser/network limits.
- Each run owns its requests, so late aborts from an older run cannot alter a restarted transfer.

## Screen awake and ambient display

The optional Keep screen awake switch uses the native Screen Wake Lock API during transfers. It releases the lock on stop, completion, disable, and unmount, and requests it again when the tab becomes visible. The interface distinguishes an active lock from a denied, released, or unsupported request.

With that switch enabled during a transfer, the ambient display opens after 20 seconds without interaction, or immediately through its button. The background stays pure black while dim, light-weight readouts slowly change hue and move around the viewport. Tap to return or use Stop transfer. The static rainbow border is hidden in this mode. Reduce Motion disables animation. This reduces static-image exposure; it is not a guarantee against display burn-in.

Safari supports the native API from iOS 16.4. Keep the tab visible: screen wake lock does not guarantee background execution, override a manual lock, or override power-management decisions. No fake video or audio is used.

References: [WebKit Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

## Verification

```bash
npm run lint
GITHUB_PAGES=true npm run build:pages
npx playwright install chromium
```

For browser regressions, start `npx next dev --port 3000` in one terminal and run `BASE_URL=http://localhost:3000 npm run test:browser` in another. The tests mock transfer payloads and wake locks; they do not consume real test bandwidth. An existing Chromium binary can be selected with `CHROME_PATH`.

Coverage includes exact download/upload totals, unit conversion, rapid stop/restart, unlimited blank/zero allowances, validation, separate thread pools, responsive layout, reduced motion, wake-lock cleanup/denial, and ambient controls. Physical iPhone sleep behavior still needs an on-device check.

## Color and HDR

All page/panel and ambient backgrounds are pure `#000000`. Display-P3-capable screens receive a wider-gamut rainbow border and heading accent. P3 is **not** described as HDR. An additional small-highlight enhancement uses draft `color(rec2100-linear …)` only when both the CSS parser and `(dynamic-range: high)` report support. Unsupported browsers retain the P3/sRGB styling. HDR border colors bypass the SDR hue filter. The ambient display is intentionally limited to SDR and dim text. No true HDR luminance has been verified on a physical iPhone; CSS HDR support is still evolving. See the [CSS Color HDR draft](https://www.w3.org/TR/css-color-hdr-1/).
