'use strict';

/**
 * End-to-end checks against a real Chromium.
 *
 *   node scripts/serve.cjs . 4173    # in another terminal
 *   npm run test:e2e
 *
 * Uses the system Chrome when available, otherwise Playwright's Chromium.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.OPTI_BASE || 'http://localhost:4173/';
const FIXTURES = '/tmp/optipress-e2e';
const SHOTS = '/tmp/optipress-shots';

function parseBytes(text) {
  const match = /([\d.]+)\s*(B|KB|MB|GB)/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  const factor = unit === 'B' ? 1 : unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
  return Math.round(value * factor);
}

async function makeFixtures(browser) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const page = await browser.newPage();

  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 2400, 1600);
    gradient.addColorStop(0, '#1f3b57');
    gradient.addColorStop(0.5, '#d9694a');
    gradient.addColorStop(1, '#f2c14e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2400, 1600);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 62%, ${35 + Math.random() * 45}%, ${0.15 + Math.random() * 0.6})`;
      const r = 6 + Math.random() * 70;
      ctx.beginPath();
      ctx.arc(Math.random() * 2400, Math.random() * 1600, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 96px Georgia';
    ctx.fillText('OptiPress fixture', 160, 260);
    return canvas.toDataURL('image/jpeg', 0.94);
  });
  fs.writeFileSync(path.join(FIXTURES, 'photo.jpg'), Buffer.from(photo.split(',')[1], 'base64'));

  const graphic = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1800;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1800, 1800);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 70%, 55%, 0.5)`;
      ctx.fillRect(Math.random() * 1800, Math.random() * 1800, 90, 90);
    }
    ctx.fillStyle = 'rgba(20,20,20,0.85)';
    ctx.fillRect(400, 400, 1000, 1000);
    return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(FIXTURES, 'graphic.png'), Buffer.from(graphic.split(',')[1], 'base64'));

  const alpha = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1200, 1200);
    ctx.fillStyle = '#e4551f';
    ctx.beginPath();
    ctx.arc(600, 600, 430, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1813';
    ctx.font = '700 150px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText('ALPHA', 600, 655);
    return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(FIXTURES, 'alpha.png'), Buffer.from(alpha.split(',')[1], 'base64'));

  const pdfPage = await browser.newPage();
  await pdfPage.setContent(
    '<html><body style="margin:0">' +
      Array.from({ length: 3 })
        .map(
          (_, i) =>
            '<section style="page-break-after:always;padding:40px;font:18px Georgia">' +
            '<h1 style="font:600 42px Georgia">OptiPress PDF ' + (i + 1) + '</h1>' +
            '<img src="' + photo + '" style="width:100%;max-height:600px;object-fit:cover"/>' +
            '<p>' + 'Selectable text '.repeat(40) + '</p>' +
            '</section>'
        )
        .join('') +
      '</body></html>'
  );
  await pdfPage.pdf({ path: path.join(FIXTURES, 'report.pdf'), format: 'A4', printBackground: true });
  await pdfPage.close();
  await page.close();
}

async function newAppPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 1000 },
    acceptDownloads: true,
    colorScheme: options.colorScheme || 'light'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded');
  return { context, page, errors };
}

async function waitForRows(page, count) {
  await page.waitForSelector('#fileList .file');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('#fileList .file').length === expected,
    count
  );
}

async function waitForProbes(page) {
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#fileList .file')];
    return (
      rows.length > 0 &&
      rows.every((row) => {
        const note = row.querySelector('.file-note');
        return !note || note.hidden || !note.textContent.includes('Reading file');
      })
    );
  });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#fileList .file')];
    return rows.every((row) => {
      const meta = row.querySelector('.file-meta');
      return meta && (meta.textContent.includes('×') || meta.textContent.includes('page'));
    });
  }, null, { timeout: 60000 });
}

async function squeeze(page) {
  await page.click('#squeezeBtn');
  await page.waitForFunction(
    () => {
      const label = document.querySelector('#squeezeLabel');
      return label && (label.textContent === 'All squeezed' || label.textContent === 'Squeeze 0 files');
    },
    null,
    { timeout: 180000 }
  );
}

async function downloadRow(page, index) {
  const button = page.locator('#fileList .file').nth(index).locator('[data-action="download"]');
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const target = path.join(FIXTURES, 'download-' + index + '-' + download.suggestedFilename());
  await download.saveAs(target);
  return target;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(FIXTURES, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    browser = await chromium.launch({ headless: true });
  }

  let failures = 0;
  async function check(name, fn) {
    try {
      await fn();
      console.log('  ok   ' + name);
    } catch (error) {
      failures++;
      console.error('  FAIL ' + name);
      const message = error && error.message ? error.message : String(error);
      console.error('       ' + message.split('\n').slice(0, 4).join('\n       '));
    }
  }

  await makeFixtures(browser);

  // ---------------------------------------------------------------- desktop --
  const { context, page, errors } = await newAppPage(browser);

  await check('fonts load', async () => {
    const ok = await page.evaluate(
      () => document.fonts.check('16px Fraunces') && document.fonts.check('15px "Instrument Sans"')
    );
    assert.ok(ok, 'local font files failed to load');
  });

  await check('empty state renders without JS errors', async () => {
    assert.equal(await page.locator('#queue').isVisible(), false);
    assert.ok(await page.locator('#dropzone').isVisible());
    await page.screenshot({ path: path.join(SHOTS, '01-empty.png'), fullPage: true });
    assert.deepEqual(errors, []);
  });

  await check('dropzone is a real button and focusable', async () => {
    assert.equal(await page.locator('#dropzone').evaluate((el) => el.tagName), 'BUTTON');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement.id);
    assert.ok(['dropzone', 'themeToggle', 'addBtn'].includes(focused) || focused === '');
  });

  await page.setInputFiles('#fileInput', [
    path.join(FIXTURES, 'photo.jpg'),
    path.join(FIXTURES, 'graphic.png'),
    path.join(FIXTURES, 'report.pdf'),
    path.join(FIXTURES, 'alpha.png')
  ]);
  await waitForRows(page, 4);
  await waitForProbes(page);

  await check('probe reads dimensions and page counts', async () => {
    const metas = await page.locator('#fileList .file-meta').allTextContents();
    assert.ok(metas.some((text) => text.includes('2400×1600')), 'JPEG dims missing: ' + metas.join(' | '));
    assert.ok(metas.some((text) => text.includes('1800×1800')), 'PNG dims missing');
    assert.ok(metas.some((text) => text.includes('3 pages')), 'PDF page count missing');
  });

  await check('live estimate is measured and shows savings', async () => {
    await page.waitForFunction(() => {
      const note = document.querySelector('#estimateNote').textContent;
      const value = document.querySelector('#estimateValue').textContent.trim();
      const pill = document.querySelector('#estimatePill').textContent.trim();
      return (
        value !== '—' &&
        /\d/.test(value) &&
        /Measured estimate|estimate for the rest/.test(note) &&
        !/measuring/i.test(note) &&
        pill !== 'Measuring' &&
        pill !== '—'
      );
    }, null, { timeout: 60000 });
    const value = await page.locator('#estimateValue').textContent();
    const pill = await page.locator('#estimatePill').textContent();
    assert.match(value, /\d/);
    const savings = Number(pill.replace(/[^0-9]/g, ''));
    assert.ok(savings > 0, 'estimate shows no savings: ' + pill);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, '02-queue.png'), fullPage: true });
  });

  await check('PDF controls appear only when a PDF is queued', async () => {
    assert.equal(await page.locator('#pdfField').isVisible(), true);
  });

  await squeeze(page);

  await check('every file produces a downloadable result', async () => {
    const rows = await page.locator('#fileList .file').count();
    const downloads = await page.locator('#fileList [data-action="download"]:visible').count();
    assert.equal(downloads, rows, 'not every row has a download action');
    const notes = await page.locator('#fileList .file-note').allTextContents();
    assert.ok(!notes.some((text) => /failed|error/i.test(text)), 'unexpected failure note: ' + notes.join(' | '));
  });

  await check('JPEG gets meaningfully smaller', async () => {
    const row = page.locator('#fileList .file').filter({ hasText: 'photo.jpg' });
    const before = parseBytes(await row.locator('.size-before').textContent());
    const after = parseBytes(await row.locator('.size-after').textContent());
    assert.ok(after < before, `expected ${after} < ${before}`);
  });

  await check('auto output keeps PNG transparency', async () => {
    const file = await downloadRow(page, 3);
    const buffer = fs.readFileSync(file);
    assert.equal(buffer.subarray(0, 4).toString('latin1'), 'RIFF', 'expected a WebP container');
    const alpha = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = 'data:image/webp;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(1, 1, 1, 1).data[3];
    }, buffer.toString('base64'));
    assert.ok(alpha < 10, 'corner alpha was ' + alpha + ' — transparency was lost');
  });

  await check('result dimensions are correct', async () => {
    await page.locator('#fileList .file').filter({ hasText: 'photo.jpg' }).locator('[data-action="compare"]').click();
    await page.waitForSelector('#compareModal:not([hidden])');
    await page.waitForTimeout(700);
    const after = await page.locator('#metaAfter').textContent();
    assert.match(after, /2400×1600/);
    await page.screenshot({ path: path.join(SHOTS, '03-compare.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#compareModal').hidden);
  });

  await check('compare slider responds to keyboard', async () => {
    await page.locator('#fileList .file').filter({ hasText: 'photo.jpg' }).locator('[data-action="compare"]').click();
    await page.waitForSelector('#compareModal:not([hidden])');
    const knob = page.locator('#compareKnob');
    await knob.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const now = Number(await knob.getAttribute('aria-valuenow'));
    assert.ok(now > 50, 'aria-valuenow did not move');
    await page.keyboard.press('Escape');
  });

  await check('transparent PNG flattened to JPEG uses a white matte, not black', async () => {
    await page.selectOption('#format', 'image/jpeg');
    await page.waitForFunction(() => document.querySelector('#squeezeLabel').textContent !== 'All squeezed');
    await squeeze(page);
    const file = await downloadRow(page, 3);
    const buffer = fs.readFileSync(file);
    const pixel = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = 'data:image/jpeg;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(1, 1, 1, 1).data;
      return [data[0], data[1], data[2]];
    }, buffer.toString('base64'));
    assert.ok(pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240, 'corner pixel was ' + pixel.join(','));
  });

  await check('target size mode actually reaches the target', async () => {
    await page.selectOption('#format', 'auto');
    if (!(await page.locator('#targetToggle').isChecked())) await page.locator('.switch').click();
    assert.equal(await page.locator('#targetToggle').isChecked(), true);
    await page.fill('#targetKB', '60');
    await page.waitForFunction(() => document.querySelector('#squeezeLabel').textContent !== 'All squeezed');
    await squeeze(page);
    const row = page.locator('#fileList .file').filter({ hasText: 'photo.jpg' });
    const after = parseBytes(await row.locator('.size-after').textContent());
    assert.ok(after <= 60 * 1024, `target missed: ${after} bytes`);
    await page.locator('.switch').click();
    assert.equal(await page.locator('#targetToggle').isChecked(), false);
  });

  await check('exact dimensions + letterbox produce the requested box', async () => {
    await page.click('[data-resize="exact"]');
    await page.click('#aspectLock');
    await page.fill('#customWidth', '900');
    await page.fill('#customHeight', '900');
    await page.click('[data-letterbox="black"]');
    await page.waitForFunction(() => document.querySelector('#squeezeLabel').textContent !== 'All squeezed');
    await squeeze(page);
    await page.locator('#fileList .file').filter({ hasText: 'photo.jpg' }).locator('[data-action="compare"]').click();
    await page.waitForSelector('#compareModal:not([hidden])');
    await page.waitForTimeout(700);
    const after = await page.locator('#metaAfter').textContent();
    assert.match(after, /900×900/, 'unexpected output dimensions: ' + after);
    await page.screenshot({ path: path.join(SHOTS, '04-letterbox.png') });
    await page.keyboard.press('Escape');
  });

  await check('changing settings marks results stale', async () => {
    await page.locator('#quality').evaluate((el) => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll('#fileList .pill-stale').length > 0);
    assert.ok((await page.locator('#fileList .pill-stale').count()) > 0);
  });

  await check('PDF structure mode keeps a valid PDF', async () => {
    await page.selectOption('#pdfMode', 'structure');
    await page.waitForFunction(() => document.querySelector('#squeezeLabel').textContent !== 'All squeezed');
    await squeeze(page);
    const file = await downloadRow(page, 2);
    const header = fs.readFileSync(file).subarray(0, 5).toString('latin1');
    assert.equal(header, '%PDF-');
  });

  await check('ZIP download contains every completed file', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#zipBtn')
    ]);
    const target = path.join(FIXTURES, 'basket.zip');
    await download.saveAs(target);
    const { execFileSync } = require('node:child_process');
    const listing = execFileSync('unzip', ['-l', target], { encoding: 'utf8' });
    const entries = listing.split('\n').filter((line) => /\.(jpg|png|webp|pdf)$/i.test(line));
    assert.ok(entries.length >= 4, 'zip did not include all files:\n' + listing);
  });

  await check('settings persist across reload', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#quality').value === '40');
    assert.equal(await page.locator('#quality').inputValue(), '40');
  });

  await check('theme toggle flips to dark and persists', async () => {
    await page.click('#themeToggle');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, '05-dark.png'), fullPage: true });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    await page.click('#themeToggle');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await page.waitForTimeout(400);
  });

  await check('axe: no serious WCAG A/AA violations', async () => {
    await page.waitForTimeout(400);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const result = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length
      }));
    });
    assert.deepEqual(violations, []);
  });

  await check('no runtime errors during the whole desktop run', async () => {
    assert.deepEqual(errors, []);
  });

  // ----------------------------------------------------------------- mobile --
  const mobile = await newAppPage(browser, { viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await mobile.page.waitForTimeout(250);
  await mobile.page.screenshot({ path: path.join(SHOTS, '06-mobile-empty.png'), fullPage: true });
  await mobile.page.setInputFiles('#fileInput', [path.join(FIXTURES, 'photo.jpg')]);
  await waitForRows(mobile.page, 1);
  await waitForProbes(mobile.page);
  await squeeze(mobile.page);
  await check('mobile layout squeezes and has no horizontal scroll', async () => {
    const scrollWidth = await mobile.page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await mobile.page.evaluate(() => document.documentElement.clientWidth);
    assert.ok(scrollWidth <= clientWidth + 1, `horizontal overflow: ${scrollWidth} > ${clientWidth}`);
    assert.equal(await mobile.page.locator('#fileList [data-action="download"]:visible').count(), 1);
    await mobile.page.waitForTimeout(350);
    await mobile.page.screenshot({ path: path.join(SHOTS, '07-mobile-queue.png'), fullPage: true });
    assert.deepEqual(mobile.errors, []);
  });

  // ------------------------------------------------------------ edge cases --
  const edge = await newAppPage(browser);
  const notesTxt = path.join(FIXTURES, 'notes.txt');
  const brokenPdf = path.join(FIXTURES, 'broken.pdf');
  fs.writeFileSync(notesTxt, 'plain text is not a supported file');
  fs.writeFileSync(brokenPdf, 'this is definitely not a PDF');

  await check('unsupported files are rejected with a message', async () => {
    await edge.page.setInputFiles('#fileInput', [notesTxt]);
    await edge.page.waitForSelector('.toast.is-error');
    const text = await edge.page.locator('.toast.is-error').first().textContent();
    assert.match(text, /Not supported/);
    assert.equal(await edge.page.locator('#fileList .file').count(), 0);
  });

  await check('duplicate files are skipped', async () => {
    await edge.page.setInputFiles('#fileInput', [
      path.join(FIXTURES, 'photo.jpg'),
      path.join(FIXTURES, 'photo.jpg')
    ]);
    await waitForRows(edge.page, 1);
    await edge.page.setInputFiles('#fileInput', [path.join(FIXTURES, 'photo.jpg')]);
    await edge.page.waitForSelector('.toast.is-error, .toast');
    await edge.page.waitForFunction(() => document.querySelectorAll('#fileList .file').length === 1);
    assert.equal(await edge.page.locator('#fileList .file').count(), 1);
    assert.equal(await edge.page.locator('#pdfField').isVisible(), false);
  });

  await check('broken PDFs surface an error with a retry action', async () => {
    await edge.page.setInputFiles('#fileInput', [brokenPdf]);
    await waitForRows(edge.page, 2);
    await edge.page.waitForSelector('#fileList .file-note.is-error');
    const note = await edge.page.locator('#fileList .file-note.is-error').textContent();
    assert.match(note, /PDF|damaged|readable/i);
    const retry = edge.page.locator('#fileList .file').filter({ hasText: 'broken.pdf' }).locator('[data-action="retry"]');
    assert.equal(await retry.isVisible(), true);
  });

  await check('edge-case context has no runtime errors', async () => {
    assert.deepEqual(edge.errors, []);
  });
  await edge.context.close();

  // -------------------------------------------------------------- teardown --
  await context.close();
  await mobile.context.close();
  await browser.close();

  console.log('\n' + failures + ' failing check' + (failures === 1 ? '' : 's'));
  console.log('Screenshots: ' + SHOTS);

  if (failures) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
