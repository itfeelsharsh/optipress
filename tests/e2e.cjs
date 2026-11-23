'use strict';

/**
 * End-to-end checks for every OptiPress tool.
 *
 *   npm run dev
 *   npm run test:e2e
 *
 * Uses the system Chrome when available, otherwise Playwright Chromium.
 * Every check runs in a fresh browser context so persisted settings never
 * leak between scenarios.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const BASE = process.env.OPTI_BASE || 'http://localhost:4173/';
const FIXTURES = '/tmp/optipress-e2e';
const SHOTS = '/tmp/optipress-shots';
const AXE = require.resolve('axe-core/axe.min.js');

let browser;
let context;
let page;
let errors = [];
let failures = 0;

async function fresh(hash) {
  if (context) await context.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
    serviceWorkers: 'block',
    colorScheme: 'light'
  });
  page = await context.newPage();
  errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  await page.goto(BASE + '#/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  if (hash && hash !== '#/') await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.waitForTimeout(400);
}

async function check(name, fn) {
  try {
    await fn();
    if (errors.length) throw new Error('runtime errors: ' + errors.join(' | '));
    console.log('  ok   ' + name);
  } catch (error) {
    failures++;
    console.log('  FAIL ' + name + ' — ' + (error && error.message ? error.message : error));
  }
}

async function upload(files) {
  await page.setInputFiles('#files-input', files);
  await page.waitForTimeout(1600);
}

async function run(timeout) {
  await page.click('#runBtn');
  await page.waitForFunction(
    () => !document.querySelector('#runBtn').textContent.includes('working'),
    null,
    { timeout: timeout || 180000 }
  );
  await page.waitForTimeout(300);
  const failure = await page.locator('#resultZone .notice.is-warn').first().textContent().catch(() => '');
  if (failure) throw new Error(failure);
}

async function downloadResult() {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.locator('#resultZone .result .btn-primary').click()
  ]);
  const target = path.join(FIXTURES, 'out-' + Date.now() + '-' + download.suggestedFilename());
  await download.saveAs(target);
  return target;
}

async function imageInfo(file) {
  return page.evaluate(async (base64) => {
    const img = new Image();
    img.src = 'data:image/*;base64,' + base64;
    try {
      await img.decode();
      return { ok: true, width: img.naturalWidth, height: img.naturalHeight };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, fs.readFileSync(file).toString('base64'));
}

async function pdfInfo(buffer, password) {
  return page.evaluate(
    async ({ base64, password }) => {
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      try {
        const pdf = await pdfjsLib.getDocument(password ? { data: bytes, password } : { data: bytes }).promise;
        const pages = pdf.numPages;
        const text = await (await pdf.getPage(1)).getTextContent();
        pdf.destroy();
        return { ok: true, pages, text: text.items.map((item) => item.str).join(' ') };
      } catch (err) {
        return { ok: false, error: err && err.name ? err.name : String(err) };
      }
    },
    { base64: buffer.toString('base64'), password: password || '' }
  );
}

function zipEntries(file, pattern) {
  const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
  return listing.split('\n').filter((line) => pattern.test(line.trim()));
}

async function audit(label, selector) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(
    async ({ selector }) => {
      const target = selector ? document.querySelector(selector) : document;
      const result = await axe.run(target, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length
      }));
    },
    { selector: selector || null }
  );
  if (violations.length) throw new Error(label + ': ' + JSON.stringify(violations));
}

async function makeFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const temp = await browser.newContext();
  const page = await temp.newPage();

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
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 62%, ${35 + Math.random() * 45}%, ${0.15 + Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.arc(Math.random() * 2400, Math.random() * 1600, 6 + Math.random() * 70, 0, Math.PI * 2);
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

  const pdfPage = await temp.newPage();
  await pdfPage.setContent(
    '<html><body style="margin:0">' +
      Array.from({ length: 3 })
        .map(
          (_, i) =>
            '<section style="page-break-after:always;padding:40px;font:18px Georgia">' +
            '<h1 style="font:600 42px Georgia">OptiPress PDF ' + (i + 1) + '</h1>' +
            '<img src="' + photo + '" style="width:100%;max-height:600px;object-fit:cover"/>' +
            '<p>' + 'Selectable text '.repeat(36) + '</p>' +
            '</section>'
        )
        .join('') +
      '</body></html>'
  );
  await pdfPage.pdf({ path: path.join(FIXTURES, 'report.pdf'), format: 'A4', printBackground: true });
  await pdfPage.close();
  await temp.close();
  fs.copyFileSync(path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'report2.pdf'));
}

(async () => {
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    browser = await chromium.launch({ headless: true });
  }
  await makeFixtures();

  // ------------------------------------------------------------------ home --
  await check('home renders the tool catalogue without errors', async () => {
    await fresh('#/');
    const cards = await page.locator('.tool-card').count();
    if (cards !== 17) throw new Error('tool cards: ' + cards);
    if (!(await page.locator('.hero-title').innerText()).includes('your files')) throw new Error('hero missing');
    await page.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: true });
  });

  await check('every route renders a tool without errors', async () => {
    const routes = [
      'squeeze', 'crop', 'convert', 'merge', 'split', 'extract', 'delete', 'reorder', 'rotate',
      'images-to-pdf', 'pdf-to-images', 'ocr', 'compress-pdf', 'watermark', 'page-numbers', 'protect', 'unlock'
    ];
    for (const route of routes) {
      await page.goto(BASE + '#/' + route, { waitUntil: 'load' });
      await page.waitForTimeout(150);
      if (!(await page.locator('.tool-title').isVisible())) throw new Error(route + ': no title');
    }
    await page.goto(BASE + '#/about', { waitUntil: 'load' });
    if (!(await page.locator('.tool-title').isVisible())) throw new Error('about missing');
  });

  await check('home dropzone carries files into squeeze', async () => {
    await fresh('#/');
    await page.setInputFiles('#home-input', [path.join(FIXTURES, 'graphic.png')]);
    await page.waitForFunction(() => location.hash === '#/squeeze');
    await page.waitForTimeout(1200);
    if ((await page.locator('.file-row').count()) !== 1) throw new Error('file was not carried over');
  });

  // ------------------------------------------------------------------ crop --
  await check('crop preset applies dimensions, cap and preview', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#preset', 'us-passport');
    await page.waitForTimeout(600);
    if ((await page.locator('#cropW').inputValue()) !== '600') throw new Error('width preset');
    if ((await page.locator('#cropH').inputValue()) !== '600') throw new Error('height preset');
    if (!(await page.locator('#targetToggle').isChecked())) throw new Error('target not enabled');
    if ((await page.locator('#targetKB').inputValue()) !== '240') throw new Error('cap not applied');
    if ((await page.locator('#targetMode').inputValue()) !== 'atMost') throw new Error('mode not atMost');
    if (await page.locator('#previewCanvas').isHidden()) throw new Error('preview hidden');
    const canvasSize = await page.locator('#previewCanvas').evaluate((el) => [el.width, el.height]);
    if (canvasSize[0] !== canvasSize[1]) throw new Error('preview not square: ' + canvasSize);
    await page.screenshot({ path: path.join(SHOTS, '02-crop.png'), fullPage: true });
    await run();
    const out = await downloadResult();
    const info = await imageInfo(out);
    if (!info.ok || info.width !== 600 || info.height !== 600) throw new Error(JSON.stringify(info));
    await page.screenshot({ path: path.join(SHOTS, '03-crop-result.png'), fullPage: true });
  });

  await check('exact WebP target is byte-exact and decodes', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#preset', 'us-passport');
    await page.locator('#targetKB').fill('60');
    await page.selectOption('#targetMode', 'exact');
    await page.waitForTimeout(300);
    await run();
    const out = await downloadResult();
    if (fs.statSync(out).size !== 60 * 1024) throw new Error('size ' + fs.statSync(out).size);
    const info = await imageInfo(out);
    if (!info.ok || info.width !== 600) throw new Error(JSON.stringify(info));
    const note = await page.locator('.file-status').innerText();
    if (!/Padded with harmless metadata/.test(note)) throw new Error('padding note missing: ' + note);
  });

  await check('exact JPEG target is byte-exact and decodes', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#preset', 'india-passport');
    await page.selectOption('#format', 'image/jpeg');
    await page.locator('#targetKB').fill('50');
    await page.selectOption('#targetMode', 'exact');
    await page.waitForTimeout(300);
    await run();
    const out = await downloadResult();
    if (fs.statSync(out).size !== 50 * 1024) throw new Error('size ' + fs.statSync(out).size);
    if (fs.readFileSync(out).subarray(0, 2).toString('hex') !== 'ffd8') throw new Error('not a JPEG');
    const info = await imageInfo(out);
    if (!info.ok || info.width !== 350 || info.height !== 450) throw new Error(JSON.stringify(info));
  });

  await check('PNG target is coerced to WebP and still exact', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#format', 'image/png');
    await page.locator('.switch').click();
    await page.locator('#targetKB').fill('40');
    await page.selectOption('#targetMode', 'exact');
    await page.waitForTimeout(300);
    await run();
    const note = await page.locator('.file-status').innerText();
    if (!/PNG cannot meet a size target/.test(note)) throw new Error('note: ' + note);
    const out = await downloadResult();
    if (fs.statSync(out).size !== 40 * 1024) throw new Error('size ' + fs.statSync(out).size);
  });

  // --------------------------------------------------------------- convert --
  await check('custom MIME output works and reaches an exact size', async () => {
    await fresh('#/convert');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#format', 'custom');
    await page.fill('#formatCustom', 'image/webp');
    if (!/can encode/.test(await page.locator('#formatHint').innerText())) throw new Error('support hint');
    await page.locator('.switch').click();
    await page.locator('#targetKB').fill('30');
    await page.selectOption('#targetMode', 'exact');
    await page.waitForTimeout(300);
    await run();
    const out = await downloadResult();
    if (!out.endsWith('.webp')) throw new Error('extension: ' + out);
    if (fs.statSync(out).size !== 30 * 1024) throw new Error('size ' + fs.statSync(out).size);
  });

  await check('unsupported custom MIME disables the run', async () => {
    await fresh('#/convert');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#format', 'custom');
    await page.fill('#formatCustom', 'image/jxl');
    await page.waitForTimeout(300);
    if (!/cannot encode/.test(await page.locator('#formatHint').innerText())) throw new Error('hint');
    if (!(await page.locator('#runBtn').isDisabled())) throw new Error('run enabled');
  });

  // --------------------------------------------------------------- squeeze --
  await check('mixed squeeze, results, compare and ZIP', async () => {
    await fresh('#/squeeze');
    await upload([path.join(FIXTURES, 'photo.jpg'), path.join(FIXTURES, 'report.pdf')]);
    if ((await page.locator('.file-row').count()) !== 2) throw new Error('rows');
    if (!(await page.locator('#pdfPanel').isVisible())) throw new Error('pdf panel hidden');
    await run();
    const saved = await page.locator('.file-row .savings').allTextContents();
    if (!saved.some((text) => text.includes('−'))) throw new Error('no savings: ' + saved);
    await page.locator('.row-action', { hasText: 'compare' }).first().click();
    await page.waitForSelector('#compareModal:not([hidden])');
    await page.waitForTimeout(400);
    const meta = await page.locator('#compareAfterMeta').innerText();
    if (!/×/.test(meta)) throw new Error('compare meta: ' + meta);
    await page.keyboard.press('Escape');
    if (!(await page.locator('#compareModal').isHidden())) throw new Error('compare did not close');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#resultZone .result .btn-primary').click()
    ]);
    const zip = path.join(FIXTURES, 'squeeze.zip');
    await download.saveAs(zip);
    const entries = zipEntries(zip, /\.(webp|jpg|jpeg|png|pdf)$/);
    if (entries.length !== 2) throw new Error('zip entries: ' + entries.length);
    await page.screenshot({ path: path.join(SHOTS, '04-squeeze.png'), fullPage: true });
  });

  await check('PDF-only squeeze hides image controls', async () => {
    await fresh('#/squeeze');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    if (!(await page.locator('#imagePanel').isHidden())) throw new Error('image panel visible');
    if (!(await page.locator('#pdfPanel').isVisible())) throw new Error('pdf panel hidden');
  });

  // ------------------------------------------------------------------- pdf --
  await check('merge two 3-page PDFs', async () => {
    await fresh('#/merge');
    await upload([path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'report2.pdf')]);
    await run();
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok || info.pages !== 6) throw new Error('pages ' + info.pages);
  });

  await check('split every page into a ZIP', async () => {
    await fresh('#/split');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.click('#splitMode [data-mode="every"]');
    await page.fill('#splitEvery', '1');
    await run();
    const entries = zipEntries(await downloadResult(), /\.pdf$/);
    if (entries.length !== 3) throw new Error('entries ' + entries.length);
  });

  await check('split custom ranges', async () => {
    await fresh('#/split');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.click('#splitMode [data-mode="ranges"]');
    await page.fill('#splitRanges', '1-2; 3');
    await run();
    const entries = zipEntries(await downloadResult(), /\.pdf$/);
    if (entries.length !== 2) throw new Error('entries ' + entries.length);
  });

  await check('extract pages 1-2', async () => {
    await fresh('#/extract');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#pages', '1-2');
    await run();
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok || info.pages !== 2) throw new Error('pages ' + info.pages);
  });

  await check('delete page 2', async () => {
    await fresh('#/delete');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#pages', '2');
    await run();
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok || info.pages !== 2) throw new Error('pages ' + info.pages);
  });

  await check('reorder to 3,1,2', async () => {
    await fresh('#/reorder');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#order', '3, 1, 2');
    await run();
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok || info.pages !== 3) throw new Error('pages ' + info.pages);
  });

  await check('rotate every page 90°', async () => {
    await fresh('#/rotate');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await run();
    const out = await downloadResult();
    const rotation = await page.evaluate(async (base64) => {
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const doc = await PDFLib.PDFDocument.load(bytes);
      return doc.getPages().map((p) => p.getRotation().angle);
    }, fs.readFileSync(out).toString('base64'));
    if (!rotation.every((angle) => angle === 90)) throw new Error('rotation ' + rotation.join(','));
  });

  await check('images to PDF', async () => {
    await fresh('#/images-to-pdf');
    await upload([path.join(FIXTURES, 'photo.jpg'), path.join(FIXTURES, 'graphic.png')]);
    await run();
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok || info.pages !== 2) throw new Error('pages ' + info.pages);
  });

  await check('PDF to PNG images', async () => {
    await fresh('#/pdf-to-images');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.selectOption('#imageFormat', 'image/png');
    await page.selectOption('#imageDpi', '72');
    await run();
    const entries = zipEntries(await downloadResult(), /\.png$/);
    if (entries.length !== 3) throw new Error('entries ' + entries.length);
  });

  await check('watermark and page numbers add text', async () => {
    await fresh('#/watermark');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#wmText', 'DRAFT');
    await run();
    const marked = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!marked.ok || !marked.text.includes('DRAFT')) throw new Error('watermark text missing');

    await fresh('#/page-numbers');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await run();
    const numbered = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!numbered.ok || !/Page 1 of 3/.test(numbered.text)) throw new Error('page number text missing');
  });

  let protectedFile = null;
  await check('AES password add and remove', async () => {
    await fresh('#/protect');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#pw1', 'test1234');
    await page.fill('#pw2', 'test1234');
    await run();
    protectedFile = await downloadResult();
    const locked = await pdfInfo(fs.readFileSync(protectedFile));
    if (locked.ok) throw new Error('opened without password');
    const opened = await pdfInfo(fs.readFileSync(protectedFile), 'test1234');
    if (!opened.ok || opened.pages !== 3) throw new Error('password open failed');

    await fresh('#/unlock');
    await upload([protectedFile]);
    await page.fill('#pw', 'test1234');
    await run();
    const plain = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!plain.ok || plain.pages !== 3) throw new Error('still encrypted');
  });

  await check('OCR makes a PDF searchable', async () => {
    await fresh('#/ocr');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await run(300000);
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok) throw new Error(info.error);
  });

  // ------------------------------------------------------------- app-level --
  await check('theme cycles through light, dark and system', async () => {
    await fresh('#/');
    await page.click('#themeToggle');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await page.click('#themeToggle');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    await page.click('#themeToggle');
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
    await page.screenshot({ path: path.join(SHOTS, '05-dark.png'), fullPage: true });
  });

  await check('accessibility: home, crop and protect are WCAG A/AA clean', async () => {
    await fresh('#/');
    await audit('home');
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#preset', 'us-passport');
    await page.waitForTimeout(400);
    await audit('crop');
    await fresh('#/protect');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await audit('protect');
  });

  await check('mobile layout has no horizontal overflow and completes a crop', async () => {
    if (context) await context.close();
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
      serviceWorkers: 'block'
    });
    page = await context.newPage();
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(BASE + '#/crop', { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.setInputFiles('#files-input', [path.join(FIXTURES, 'photo.jpg')]);
    await page.waitForTimeout(1400);
    await page.selectOption('#preset', 'us-passport');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '06-mobile-crop.png'), fullPage: true });
    await page.click('#runBtn');
    await page.waitForFunction(() => !document.querySelector('#runBtn').textContent.includes('working'), null, {
      timeout: 120000
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error('horizontal overflow: ' + overflow);
    if (!(await page.locator('#resultZone .result').isVisible())) throw new Error('no result');
    await page.screenshot({ path: path.join(SHOTS, '07-mobile-result.png'), fullPage: true });
  });

  console.log('\n' + (failures ? failures + ' failing check(s)' : 'all checks passed'));
  console.log('Screenshots: ' + SHOTS);

  if (context) await context.close();
  await browser.close();
  if (failures) process.exit(1);
})().catch(async (error) => {
  console.error(error);
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
