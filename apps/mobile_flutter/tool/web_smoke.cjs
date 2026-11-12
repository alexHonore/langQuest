// Browser smoke test of the release web build, as CI serves it from the root Dockerfile's image. The widget tests run
// on the Dart VM; this catches what only the compiled web app does (a dart2js miscompile once broke recording there
// while every VM test passed). First run → the warm-up → a lesson → record yourself with Chromium's fake microphone →
// the practice session's pairs → the Play tab → Settings › Display → reload. Any page error fails it. It also checks which course files the browser fetches: none on
// a first visit (the catalog says what each course offers), the opened course's only, then the learner's only.
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
  // The content files the page fetched (`catalog.json`, `chapters/<track>.json`…), in order: from the content bucket
  // (named by content, `chapters/<track>.<hash>.json`) or a plain copy of the repository's (CI), so the hash is dropped.
  const content = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    const at = path.indexOf('/content/');
    if (at >= 0 && path.endsWith('.json')) content.push(path.slice(at + '/content/'.length).replace(/\.[0-9a-f]{12}\.json$/, '.json'));
  });
  const courseFiles = () => content.filter((f) => f === 'chapters.json' || f.startsWith('chapters/'));
  const expectCourseFiles = (expected, when) => {
    const got = courseFiles();
    if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`${when}: course files fetched ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  };
  const ok = (what) => console.log(`ok - ${what}`);
  const button = (name, exact = true) => page.getByRole('button', { name, exact }).first();
  const tap = async (name, { exact = true, wait = 900 } = {}) => {
    await button(name, exact).click({ timeout: 15000 });
    await page.waitForTimeout(wait);
  };
  // Long lists (every course is offered) build only the rows on screen: scroll until the button exists.
  const scrollTo = async (name) => {
    for (let i = 0; i < 40 && (await button(name, false).count()) === 0; i++) {
      await page.mouse.move(195, 500);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(250);
    }
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
  if (!content.includes('catalog.json')) throw new Error(`the catalog was not fetched (${JSON.stringify(content)})`);
  expectCourseFiles([], 'first visit');
  ok('a first visit fetches the catalog and no course');

  await tap('Choose a course', { exact: false });
  await scrollTo('Spanish (Spain-Castilian)');
  expectCourseFiles([], 'the course list');
  await tap('Spanish (Spain-Castilian)', { exact: false });
  await tap('Start this course', { exact: false, wait: 1500 });
  expectCourseFiles(['chapters/spanish-spain.json'], 'opening and starting Spanish');
  ok('enrolled in Spanish (Spain), fetching that course only');

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

  // The practice session and the mini-games are built by seeded shuffles (32-bit arithmetic that only the compiled
  // app runs as JavaScript numbers): the session opens on its pairs, each card a button named by its phrase; the
  // games wait for a Learn stop to be done, and say so.
  await page.evaluate(() => {
    location.hash = '#/learn/es_greet_and_introduce/practice';
  });
  await page.waitForTimeout(2000);
  await expectButton('Hola, buenos días.');
  await expectButton('Hello, good morning.');
  await tap('Hola, buenos días.', { wait: 400 });
  await tap('Hello, good morning.', { wait: 900 });
  await expectButton('Hola, buenos días., matched');
  ok('the practice session opens on its pairs, and a pair matches');
  await page.evaluate(() => {
    location.hash = '#/play';
  });
  await page.waitForTimeout(1500);
  // The Play tab is always there; before a Learn stop it leads to the first lesson.
  await expectButton('Play');
  await expectButton('Learn my first phrases');
  ok('the Play tab waits for a first Learn stop, and leads to it');

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

  // Coming back: the learner's course is read before the first frame (no other), and Home offers its next mission.
  content.length = 0;
  await page.evaluate(() => {
    location.hash = '#/';
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
  await page.waitForTimeout(800);
  await button('Next mission', false).waitFor({ timeout: 15000 });
  expectCourseFiles(['chapters/spanish-spain.json'], 'a reload');
  ok('a reload fetches the learner\'s course only and opens on Home');

  await browser.close();
  if (errors.length) throw new Error(`${errors.length} page error(s):\n  ${errors.join('\n  ')}`);
  ok('no page errors');
})().catch((e) => {
  console.error(`not ok - ${e.message}`);
  process.exit(1);
});
