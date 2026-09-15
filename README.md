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
- Separate live download/upload rates and combined throughput, a throughput chart, Mbps/MB/s switching, exact payload totals, and preserved averages after completion or stop.
- A blank or zero data allowance means unlimited. Negative, fractional, and nonnumeric amounts are rejected. The allowance is shared across all connections and both directions.
- Basic mode uses one connection count. Advanced mode provides independent download and upload thread pools, 1–16 each. Only pools for the selected direction run. Actual concurrency remains subject to browser/network limits.
- Each run owns its requests, so late aborts from an older run cannot alter a restarted transfer.

## Screen awake and ambient display

The optional Keep screen awake switch uses the native Screen Wake Lock API during transfers. It releases the lock on stop, completion, disable, and unmount, and requests it again when the tab becomes visible. The interface distinguishes an active lock from a denied, released, or unsupported request.

With that switch enabled during a transfer, the ambient display opens after 20 seconds without interaction, or immediately through its button. The background stays pure black while light-weight readouts change hue and drift at approximately 17 CSS pixels/second. Download, upload, and combined rates appear in Mbps; downloaded, uploaded, and total usage appear in decimal MB/GB. Rates share a rolling 1.5-second sampling window and refresh five times a second. Tap the background or Show controls to return, or use Stop transfer. Motion pauses while interacting with the readout or focusing its controls. A thin rainbow frame follows the visual viewport in this mode, and a second frame travels with the readout. Both animate their gradients; the screen frame also shifts slightly. The regular page has its own frame sized to the visible viewport. VisualViewport, safe-area insets, and ResizeObserver keep the readout within changing screen bounds; a short, wide viewport uses a two-column layout. Small or zoomed viewports can scroll if needed. The modal initially focuses the readout and draws keyboard focus inside its buttons, avoiding a clipped external focus ring in Safari. Reduce Motion disables animation. This reduces static-image exposure; it is not a guarantee against display burn-in.

Safari supports the native API from iOS 16.4. Keep the tab visible: screen wake lock does not guarantee background execution, override a manual lock, or override power-management decisions. No fake video or audio is used.

References: [WebKit Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport), [WebKit dynamic viewport units](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

## Verification

```bash
npm run lint
GITHUB_PAGES=true npm run build:pages
npx playwright install chromium
```

For browser regressions, start `npx next dev --port 3000` in one terminal and run `BASE_URL=http://localhost:3000 npm run test:browser` in another. The tests mock transfer payloads and wake locks; they do not consume real test bandwidth. An existing Chromium binary can be selected with `CHROME_PATH`. To run the same checks in WebKit, install its Playwright browser/runtime dependencies and set `BROWSER_ENGINE=webkit`. The RGB regression samples screenshot pixels on all four sides of the main frame and both ambient frames, including simulated black or disabled HDR enhancements.

Coverage includes exact download/upload totals, unit conversion, rapid stop/restart, unlimited blank/zero allowances, validation, separate thread pools, responsive layout, reduced motion, wake-lock cleanup/denial, ambient controls, split-rate accounting, viewport changes, motion bounds, and the separate screen/readout frames. Physical iPhone sleep behavior and Safari rendering still need an on-device check.

## Color and HDR

All page/panel and ambient backgrounds are pure `#000000`. Display-P3-capable screens receive a wider-gamut rainbow border and heading accent. P3 is **not** described as HDR. An additional small-highlight enhancement uses draft `color(rec2100-linear …)` only when both the CSS parser and `(dynamic-range: high)` report support. Unsupported browsers retain the P3/sRGB styling. All three frames use real edge elements and animate background position. They do not depend on border-image, masks, generated screen borders, or registered custom properties. Every edge keeps an sRGB gradient underneath a separate P3/HDR enhancement, plus an uncovered outer sRGB pixel. Even a missing or black enhancement cannot remove the base RGB outline. The ambient readout remains dim SDR text; only the thin border can use HDR highlights. No true HDR luminance has been verified on a physical iPhone; CSS HDR support is still evolving. See the [CSS Color HDR draft](https://www.w3.org/TR/css-color-hdr-1/).
