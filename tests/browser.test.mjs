import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

// Run against the Pages export: GITHUB_PAGES=true npm run build:pages.
// Serve out/ at /bandwidth-site/ or pass BASE_URL for a dev server.
const baseURL = process.env.BASE_URL || 'http://localhost:3000/bandwidth-site/';
let browser;
before(async () => {
  browser = process.env.BROWSER_ENGINE === 'webkit'
    ? await webkit.launch({ executablePath: process.env.WEBKIT_PATH || undefined })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });

async function pageWithTransfers({ fail = false, delay = 150 } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Deterministic in-browser transports exercise accounting and delayed aborts without using metered data.
  await page.addInitScript(({ fail, delay }) => {
    const nativeFetch = window.fetch.bind(window);
    window.__transfers = [];
    window.fetch = async (url, options) => {
      if (!String(url).startsWith('https://speed.cloudflare.com/__down')) return nativeFetch(url, options);
      const bytes = Number(new URL(url).searchParams.get('bytes'));
      window.__transfers.push({ direction: 'download', bytes });
      await new Promise(resolve => setTimeout(resolve, delay));
      while (window.__stallDownload && !options.signal.aborted) await new Promise(resolve => setTimeout(resolve, 50));
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (fail) return new Response('', { status: 503 });
      return new Response(new Uint8Array(bytes), { headers: { 'cf-meta-colo': 'TEST' } });
    };
    window.XMLHttpRequest = class {
      upload = {};
      status = 200;
      open() {}
      getResponseHeader(name) { return name === 'cf-meta-colo' ? 'TEST' : null; }
      send(body) {
        window.__transfers.push({ direction: 'upload', bytes: body.size });
        // No final progress event: a successful response must account for all bytes.
        this.timer = setTimeout(() => this.onload?.(), delay);
      }
      abort() { clearTimeout(this.timer); setTimeout(() => this.onabort?.(), delay); }
    };
  }, { fail, delay });
  await page.goto(baseURL);
  await page.getByRole('button', { name: '100 MB', exact: true }).waitFor();
  return { page, errors };
}

async function complete(page) {
  await page.waitForFunction(() => document.querySelector('.status-chip')?.textContent === 'Complete');
}
function total(page) { return page.locator('.stats > div').nth(2).locator('dd').innerText(); }

test('bounded download completes exactly and units switch without a new transfer', async () => {
  const { page, errors } = await pageWithTransfers();
  assert.equal(await page.evaluate(() => window.__transfers.length), 0);
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await complete(page);
  assert.equal(await total(page), '100.0 MB');
  const mbps = Number(await page.locator('.reading-value').innerText());
  const count = await page.evaluate(() => window.__transfers.length);
  await page.getByRole('button', { name: 'MB/s', exact: true }).click();
  const mbs = Number(await page.locator('.reading-value').innerText());
  assert.ok(Math.abs(mbps / 8 - mbs) < .1);
  assert.equal(await page.evaluate(() => window.__transfers.length), count);
  assert.deepEqual(errors, []);
  await page.close();
});

test('successful uploads count bytes without upload progress events', async () => {
  const { page } = await pageWithTransfers();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await complete(page);
  assert.equal(await page.locator('.stats > div').nth(1).locator('dd').innerText(), '100.0 MB');
  assert.equal(await total(page), '100.0 MB');
  await page.close();
});

test('rapid stop and restart isolates delayed aborted workers', async () => {
  const { page } = await pageWithTransfers({ delay: 350 });
  await page.getByRole('button', { name: 'Continuous', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Stop transfer', exact: true }).click();
  await page.getByRole('button', { name: '100 MB', exact: true }).click();
  await page.getByRole('button', { name: /Start transfer|Run again/, exact: true }).click();
  await complete(page);
  assert.equal(await total(page), '100.0 MB');
  const requested = await page.evaluate(() => window.__transfers.reduce((sum, item) => sum + item.bytes, 0));
  assert.ok(requested <= 140_000_000, 'Old workers must not reserve bytes in the new run');
  assert.equal(await page.locator('.run-details > div').nth(1).locator('dd').innerText(), '10');
  await page.close();
});

test('negative allowance is rejected and errors recover', async () => {
  const { page } = await pageWithTransfers({ fail: true });
  await page.getByRole('spinbutton').fill('-1');
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  assert.match(await page.locator('.status-message').innerText(), /whole number/);
  assert.equal(await page.evaluate(() => window.__transfers.length), 0);
  await page.getByRole('button', { name: '100 MB', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status-chip')?.textContent === 'Connection issue');
  assert.equal(await page.getByRole('button', { name: 'Download', exact: true }).isEnabled(), true);
  assert.match(await page.locator('.status-message').innerText(), /503/);
  await page.close();
});

test('mobile layout stays within viewport and reduced motion stops the border', async () => {
  const { page, errors } = await pageWithTransfers();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
  }
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.rainbow-frame-page .rainbow-edge')).animationName), 'none');
  assert.match(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily), /-apple-system/);
  for (const selector of ['body', '.console', '.telemetry', '.controls']) {
    assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
  }
  assert.deepEqual(errors, []);
  await page.close();
});


test('blank and zero allowances run continuously until stopped', async () => {
  for (const value of ['', '0']) {
    const { page } = await pageWithTransfers({ delay: 100 });
    await page.getByRole('spinbutton').fill(value);
    await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
    await page.waitForFunction(() => window.__transfers.length > 4);
    assert.match(await page.locator('.status-message').innerText(), /Continuous/);
    await page.getByRole('button', { name: 'Stop transfer', exact: true }).click();
    assert.equal(await page.locator('.status-chip').innerText(), 'Stopped');
    await page.close();
  }
});

test('advanced mode starts independent download and upload thread pools', async () => {
  const { page } = await pageWithTransfers({ delay: 350 });
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('switch', { name: 'Advanced options', exact: true }).click();
  await page.getByRole('slider', { name: 'Download threads', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.getByRole('slider', { name: 'Upload threads', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  const initial = await page.evaluate(() => window.__transfers.slice(0, 4));
  assert.equal(initial.filter(item => item.direction === 'download').length, 1);
  assert.equal(initial.filter(item => item.direction === 'upload').length, 3);
  assert.equal(await page.getByRole('switch', { name: 'Advanced options', exact: true }).isDisabled(), true);
  await complete(page);
  assert.equal(await total(page), '100.0 MB');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  assert.equal(await page.getByRole('slider', { name: 'Download threads', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('slider', { name: 'Upload threads', exact: true }).isEnabled(), true);
  await page.getByRole('switch', { name: 'Advanced options', exact: true }).click();
  assert.equal(await page.getByRole('slider', { name: 'Parallel connections', exact: true }).count(), 1);
  await page.close();
});

test('wake lock releases on stop and ambient controls remain usable', async () => {
  const { page } = await pageWithTransfers({ delay: 200 });
  await page.evaluate(() => {
    window.__wake = { requests: 0, releases: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__wake.requests++;
      const sentinel = new EventTarget();
      sentinel.released = false;
      sentinel.release = async () => { if (!sentinel.released) { sentinel.released = true; window.__wake.releases++; sentinel.dispatchEvent(new Event('release')); } };
      return sentinel;
    } } });
  });
  await page.getByRole('button', { name: 'Continuous', exact: true }).click();
  await page.getByRole('switch', { name: 'Keep screen awake', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#wake-help')?.textContent.includes('Screen awake.'));
  await page.getByRole('button', { name: 'Enter ambient display' }).click();
  await page.getByRole('dialog', { name: 'Ambient transfer display' }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('dialog').matches(':modal')), true);
  assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
  // Moving ambient controls are operated by keyboard here; pointer automation waits for a stationary target.
  await page.getByRole('button', { name: 'Show controls', exact: true }).press('Enter');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: 'Enter ambient display' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Stop transfer', exact: true }).press('Enter');
  await page.waitForFunction(() => window.__wake.releases === 1);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.status-chip').innerText(), 'Stopped');
  await page.close();
});

test('wake denial is shown truthfully and does not interrupt a transfer', async () => {
  const { page } = await pageWithTransfers({ delay: 300 });
  await page.evaluate(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } }));
  await page.getByRole('switch', { name: 'Keep screen awake', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#wake-help')?.textContent.includes('blocked'));
  await complete(page);
  assert.equal(await total(page), '100.0 MB');
  await page.close();
});


async function enterContinuousAmbient(page, both = false) {
  if (both) await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('button', { name: 'Continuous', exact: true }).click();
  await page.getByRole('switch', { name: 'Keep screen awake', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Enter ambient display' }).click();
  await page.getByRole('dialog').waitFor();
}

function ambientMeasurements(page) {
  return page.evaluate(() => ({
    rates: [...document.querySelectorAll('.ambient-rate, .ambient-combined dd > span')].map(el => Number(el.textContent)),
    usage: [...document.querySelectorAll('.ambient-usage dd')].map(el => el.textContent),
    mainUsage: [...document.querySelectorAll('.stats dd')].map(el => el.textContent),
    mainRates: [...document.querySelectorAll('.direction-rates dd > span')].map(el => Number(el.textContent)),
    combined: Number(document.querySelector('.reading-value').textContent),
  }));
}

test('ambient shows actual directional rates, their sum, and separate cumulative usage', async () => {
  const { page, errors } = await pageWithTransfers({ delay: 300 });
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('switch', { name: 'Advanced options', exact: true }).click();
  await page.getByRole('slider', { name: 'Download threads', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.getByRole('slider', { name: 'Upload threads', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await enterContinuousAmbient(page, true);
  await page.waitForFunction(() => Number(document.querySelector('.ambient-rate')?.textContent) > 0);
  let metrics = await ambientMeasurements(page);
  assert.ok(metrics.rates[0] > 0 && metrics.rates[1] > metrics.rates[0] * 2, 'Actual unequal thread pools must produce unequal rates');
  assert.ok(Math.abs(metrics.rates[0] + metrics.rates[1] - metrics.rates[2]) <= .11);
  assert.deepEqual(metrics.rates.slice(0, 2), metrics.mainRates);
  assert.equal(metrics.rates[2], metrics.combined);
  assert.deepEqual(metrics.usage, metrics.mainUsage);
  assert.ok(Math.abs(parseFloat(metrics.usage[0]) + parseFloat(metrics.usage[1]) - parseFloat(metrics.usage[2])) < .11);
  // A stalled download must decay to zero while upload and cumulative totals continue.
  await page.evaluate(() => { window.__stallDownload = true; });
  await page.waitForFunction(() => Number(document.querySelector('.ambient-rate').textContent) === 0);
  metrics = await ambientMeasurements(page);
  assert.ok(metrics.rates[1] > 0);
  assert.equal(metrics.rates[1], metrics.rates[2]);
  assert.ok(parseFloat(metrics.usage[0]) > 0);
  await page.getByRole('button', { name: 'Show controls', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'MB/s', exact: true }).click();
  await page.getByRole('button', { name: 'Enter ambient display' }).click();
  metrics = await ambientMeasurements(page);
  assert.ok(Math.abs(metrics.rates[1] / 8 - metrics.mainRates[1]) < .11);
  assert.deepEqual(await page.locator('.ambient-unit').allTextContents(), ['Mbps', 'Mbps']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('ambient adapts to rotation, unfolding, and the visual viewport without restarting', async () => {
  const { page, errors } = await pageWithTransfers({ delay: 500 });
  await page.setViewportSize({ width: 390, height: 740 });
  await enterContinuousAmbient(page, true);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'ambient-readout');
  assert.equal(await page.locator('.ambient-screen .rainbow-frame').count(), 2);
  assert.equal(await page.locator('.ambient-readout > .rainbow-frame-readout').count(), 1);
  const frame = await page.locator('.rainbow-frame-screen .rainbow-edge-top').evaluate(el => {
    const style = getComputedStyle(el);
    return { gradient: style.backgroundImage, thickness: style.height, filter: style.filter, pointer: style.pointerEvents };
  });
  assert.match(frame.gradient, /linear-gradient/);
  assert.equal(frame.thickness, '2px');
  assert.equal(frame.filter, 'none');
  assert.equal(frame.pointer, 'none');
  const first = await page.locator('.ambient-readout').boundingBox();
  await page.waitForTimeout(1100);
  const moved = await page.locator('.ambient-readout').boundingBox();
  assert.ok(Math.hypot(moved.x - first.x, moved.y - first.y) > 10, 'Drift should be noticeable within a second');
  const before = await page.evaluate(() => window.__transfers.length);
  for (const size of [{ width: 844, height: 300 }, { width: 768, height: 920 }, { width: 320, height: 568 }, { width: 390, height: 740 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(100);
    const bounds = await page.evaluate(() => {
      const card = document.querySelector('.ambient-readout').getBoundingClientRect();
      const stage = document.querySelector('.ambient-stage').getBoundingClientRect();
      return { contained: card.left >= stage.left - 1 && card.top >= stage.top - 1 && card.right <= stage.right + 1 && card.bottom <= stage.bottom + 1, columns: getComputedStyle(document.querySelector('.ambient-readout')).display, overflow: document.querySelector('.ambient-readout').scrollWidth > card.width + 1 };
    });
    assert.ok(bounds.contained, `Readout and buttons should fit ${size.width} × ${size.height}`);
    assert.equal(bounds.overflow, false);
    if (size.width === 844) assert.equal(bounds.columns, 'grid');
  }
  // Simulate browser chrome/zoom changing the visible area without layout resize.
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperties(vv, { width: { configurable: true, value: 350 }, height: { configurable: true, value: 540 }, offsetLeft: { configurable: true, value: 12 }, offsetTop: { configurable: true, value: 40 } });
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  const visibleBounds = await page.locator('.ambient-readout').boundingBox();
  assert.ok(visibleBounds.x >= 36 && visibleBounds.x + visibleBounds.width <= 338);
  assert.ok(visibleBounds.y >= 64 && visibleBounds.y + visibleBounds.height <= 556);
  assert.ok(await page.evaluate(() => window.__transfers.length) > before);
  assert.equal(await page.locator('.status-chip').textContent(), 'Transferring');
  // Keyboard focus pins the moving target and stays inside its rounded border.
  await page.keyboard.press('Tab');
  const focusStyle = await page.getByRole('button', { name: 'Show controls', exact: true }).evaluate(el => ({ active: el === document.activeElement, outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
  assert.ok(focusStyle.active);
  assert.equal(focusStyle.outline, 'none');
  assert.match(focusStyle.shadow, /inset/);
  const pinned = await page.locator('.ambient-readout').boundingBox();
  await page.waitForTimeout(150);
  assert.deepEqual(await page.locator('.ambient-readout').boundingBox(), pinned);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Enter ambient display' }).evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('ambient respects reduced motion and pointer actions work on a moving readout', async () => {
  const { page } = await pageWithTransfers({ delay: 500 });
  await page.setViewportSize({ width: 390, height: 740 });
  await enterContinuousAmbient(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const still = await page.locator('.ambient-readout').boundingBox();
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('.ambient-readout').boundingBox(), still);
  assert.equal(await page.locator('.ambient-readout').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.ambient-viewport').evaluate(el => getComputedStyle(el.querySelector('.rainbow-edge')).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const button = await page.getByRole('button', { name: 'Show controls', exact: true }).boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  const pressed = await page.locator('.ambient-readout').boundingBox();
  await page.waitForTimeout(200);
  assert.deepEqual(await page.locator('.ambient-readout').boundingBox(), pressed);
  await page.mouse.up();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.close();
});

async function assertColoredFramePixels(page, selectors) {
  const frames = await page.evaluate(selectors => selectors.map(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }), selectors);
  const png = (await page.screenshot()).toString('base64');
  const results = await page.evaluate(async ({ png, frames }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const scale = image.width / innerWidth;
    const colored = (x, y) => {
      const [r, g, b] = context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
      return Math.max(r, g, b) > 70 && Math.max(r, g, b) - Math.min(r, g, b) > 25;
    };
    return frames.map(frame => {
      const sides = [0, 0, 0, 0];
      for (let index = 0; index < 20; index++) {
        const fraction = .1 + index / 20 * .8;
        sides[0] += Number(colored(frame.x + frame.width * fraction, frame.y + .5));
        sides[1] += Number(colored(frame.x + frame.width - .5, frame.y + frame.height * fraction));
        sides[2] += Number(colored(frame.x + frame.width * fraction, frame.y + frame.height - .5));
        sides[3] += Number(colored(frame.x + .5, frame.y + frame.height * fraction));
      }
      return { selector: frame.selector, sides };
    });
  }, { png, frames });
  for (const result of results) for (const [side, colored] of result.sides.entries()) {
    assert.ok(colored >= 16, `${result.selector}, side ${side}: expected visible RGB pixels, got ${colored}/20`);
  }
}

test('all RGB frames visibly paint, including with disabled or black HDR enhancements', async () => {
  const { page } = await pageWithTransfers({ delay: 500 });
  await page.setViewportSize({ width: 390, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assertColoredFramePixels(page, ['.rainbow-frame-page']);
  // Emulate a failed enhancement renderer: the uncovered RGB edge must survive.
  const failedEnhancement = await page.addStyleTag({ content: '.rainbow-edge::after { background: #000 !important; }' });
  await assertColoredFramePixels(page, ['.rainbow-frame-page']);
  await enterContinuousAmbient(page, true);
  await assertColoredFramePixels(page, ['.rainbow-frame-screen', '.rainbow-frame-readout']);
  await page.setViewportSize({ width: 844, height: 300 });
  await page.waitForTimeout(100);
  await assertColoredFramePixels(page, ['.rainbow-frame-screen', '.rainbow-frame-readout']);
  await failedEnhancement.evaluate(element => element.remove());
  await page.addStyleTag({ content: '.rainbow-edge::after { display: none !important; }' });
  await assertColoredFramePixels(page, ['.rainbow-frame-screen', '.rainbow-frame-readout']);
  await page.getByRole('button', { name: 'Show controls', exact: true }).press('Enter');
  await assertColoredFramePixels(page, ['.rainbow-frame-page']);
  await page.close();
});
