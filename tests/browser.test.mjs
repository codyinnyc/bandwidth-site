import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against the Pages export: GITHUB_PAGES=true npm run build:pages.
// Serve out/ at /bandwidth-site/ or pass BASE_URL for a dev server.
const baseURL = process.env.BASE_URL || 'http://localhost:3000/bandwidth-site/';
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] }); });
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
  assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::before').animationName), 'none');
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
