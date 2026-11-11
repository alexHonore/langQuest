// Browser smoke test of the release web build, as CI serves it from the root Dockerfile's image. The widget tests run
// on the Dart VM; this catches what only the compiled web app does (a dart2js miscompile once broke recording there
// while every VM test passed). First run → the warm-up → a lesson → record yourself with Chromium's fake microphone →
// Settings › Display. Any page error fails it.
//
// Usage: node web_smoke.cjs <url>   (needs the `playwright` package and its Chromium)
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8080/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.grantPermissions(['microphone'], { origin: new URL(BASE).origin });
  // Keeps the microphone streams the app opens, to check it gives them back.
  await context.addInitScript(() => {
    window.__streams = [];
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await open(constraints);
      window.__streams.push(stream);
      return stream;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
  });
  const ok = (what) => console.log(`ok - ${what}`);
  const button = (name, exact = true) => page.getByRole('button', { name, exact }).first();
  const tap = async (name, { exact = true, wait = 900 } = {}) => {
    await button(name, exact).click({ timeout: 15000 });
    await page.waitForTimeout(wait);
  };
  const expectButton = async (name) => {
    await button(name).waitFor({ timeout: 15000 });
  };

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // Flutter builds its accessibility tree on demand: the placeholder turns it on, and the steps below use it.
  await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
  await page.waitForTimeout(800);
  ok('first frame');

  await tap('Choose a course', { exact: false });
  await tap('Spanish (Spain-Castilian)', { exact: false });
  await tap('Start this course', { exact: false, wait: 1500 });
  ok('enrolled in Spanish (Spain)');

  // The first course ends the first run with a warm-up phrase.
  await expectButton('Record yourself');
  await tap('Start learning', { wait: 1500 });
  ok('the first-run warm-up offers the first phrase, then Home');

  await tap('Next mission', { exact: false, wait: 1500 });
  await tap('Start: Learn', { exact: false, wait: 1500 });
  await expectButton('I said it');
  ok('the scene lesson opens on the learner’s line');

  await tap('Record yourself', { wait: 1800 });
  await tap('Stop recording', { wait: 1200 });
  await expectButton('Play your recording');
  await tap('Play your recording', { wait: 600 });
  const mic = await page.evaluate(() => ({
    streams: window.__streams.length,
    live: window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length,
  }));
  if (mic.streams !== 1 || mic.live !== 0) throw new Error(`the microphone was not released after the take (${JSON.stringify(mic)})`);
  ok('record yourself: a take is recorded, plays back, and the microphone is released');

  await page.evaluate(() => {
    location.hash = '#/account';
  });
  await page.waitForTimeout(2000);
  await tap('Light');
  await tap('Larger text', { wait: 1200 });
  // Flutter puts a group's texts in its aria-label.
  const size = await page.evaluate(() =>
    [...document.querySelectorAll('flt-semantics')].some((e) => /Text size 115%/.test(`${e.getAttribute('aria-label') || ''} ${e.textContent || ''}`)),
  );
  if (!size) throw new Error('the text size did not change to 115%');
  ok('Settings › Display: light theme, text size 115%');

  await browser.close();
  if (errors.length) throw new Error(`${errors.length} page error(s):\n  ${errors.join('\n  ')}`);
  ok('no page errors');
})().catch((e) => {
  console.error(`not ok - ${e.message}`);
  process.exit(1);
});
