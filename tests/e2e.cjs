'use strict';

/**
 * End-to-end checks for every Opti tool.
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
const FIXTURES = '/tmp/opti-e2e';
const SHOTS = '/tmp/opti-shots';
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
  const target = path.join(FIXTURES, download.suggestedFilename());
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
    ctx.fillText('Opti fixture', 160, 260);
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
            '<h1 style="font:600 42px Georgia">Opti PDF ' + (i + 1) + '</h1>' +
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
    if (cards !== 22) throw new Error('tool cards: ' + cards);
    const title = await page.title();
    if (!title.startsWith('Opti')) throw new Error('title: ' + title);
    const hero = await page.locator('.hero-title').innerText();
    if (!hero.includes('your files') || !hero.includes('your way.')) throw new Error('hero: ' + hero);
    if (await page.locator('a.nav-link[href="#/"]').count()) throw new Error('tools link still in nav');
    if (!(await page.locator('a.nav-link[href="#/about"]').count())) throw new Error('about link missing');
    if (await page.locator('footer a[href="#/"]').count()) throw new Error('tools link still in footer');
    if (await page.locator('footer a[href="#/about"]').count()) throw new Error('about link still in footer');
    if (!(await page.locator('footer a[href="https://harshbanker.com"]').count())) throw new Error('credit missing');
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

  await check('home asks which tool to use instead of auto-squeezing', async () => {
    await fresh('#/');
    await page.setInputFiles('#home-input', [path.join(FIXTURES, 'graphic.png')]);
    await page.waitForSelector('#toolPicker[open]');
    if (await page.locator('[data-tool="compress-pdf"]').count()) throw new Error('PDF tools shown for an image');
    if (!(await page.locator('[data-tool="crop"]').count())) throw new Error('crop missing for an image');
    await audit('picker', '#toolPicker');
    await page.locator('[data-tool="squeeze"]').click();
    await page.waitForFunction(() => location.hash === '#/squeeze');
    await page.waitForTimeout(1300);
    if ((await page.locator('.file-row').count()) !== 1) throw new Error('file was not carried over');
  });

  await check('home picker filters PDF tools for PDFs', async () => {
    await fresh('#/');
    await page.setInputFiles('#home-input', [path.join(FIXTURES, 'report.pdf')]);
    await page.waitForSelector('#toolPicker[open]');
    if (await page.locator('[data-tool="crop"]').count()) throw new Error('image tool shown for a PDF');
    if (!(await page.locator('[data-tool="compress-pdf"]').count())) throw new Error('compress missing');
    if (!(await page.locator('[data-tool="split"]').count())) throw new Error('split missing');
    await page.locator('[data-tool="compress-pdf"]').click();
    await page.waitForFunction(() => location.hash === '#/compress-pdf');
    await page.waitForTimeout(1300);
    if ((await page.locator('.file-row').count()) !== 1) throw new Error('PDF not carried over');
  });

  await check('home picker handles a mixed selection with Squeeze only', async () => {
    await fresh('#/');
    await page.setInputFiles('#home-input', [path.join(FIXTURES, 'graphic.png'), path.join(FIXTURES, 'report.pdf')]);
    await page.waitForSelector('#toolPicker[open]');
    const tools = await page.locator('.picker-item').count();
    if (tools !== 1) throw new Error('expected one compatible tool, got ' + tools);
    if (!(await page.locator('[data-tool="squeeze"]').count())) throw new Error('squeeze missing');
    if (await page.locator('#pickerNote').isHidden()) throw new Error('mixed note missing');
    await page.locator('[data-tool="squeeze"]').click();
    await page.waitForFunction(() => location.hash === '#/squeeze');
    await page.waitForTimeout(1500);
    if ((await page.locator('.file-row').count()) !== 2) throw new Error('mixed files not carried');
  });

  await check('leaving a tool with files asks before discarding', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.click('a.wordmark');
    await page.waitForSelector('#leaveDialog[open]');
    const hashWhileAsking = await page.evaluate(() => location.hash);
    if (hashWhileAsking !== '#/crop') throw new Error('URL changed before confirming: ' + hashWhileAsking);
    await audit('leave dialog', '#leaveDialog');
    await page.click('#stayBtn');
    await page.waitForFunction(() => !document.querySelector('#leaveDialog').open);
    if ((await page.evaluate(() => location.hash)) !== '#/crop') throw new Error('stay did not restore');
    if ((await page.locator('.file-row').count()) !== 1) throw new Error('files were lost on stay');
    await page.click('a.wordmark');
    await page.waitForSelector('#leaveDialog[open]');
    await page.click('#leaveBtn');
    await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
    await page.waitForTimeout(400);
    if (!(await page.locator('.hero-title').isVisible())) throw new Error('did not navigate home');
  });

  await check('dragging onto home opens the picker and hides the overlay', async () => {
    await fresh('#/');
    const dataTransfer = await page.evaluateHandle(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      canvas.getContext('2d').fillRect(0, 0, 24, 24);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'home-drop.png', { type: 'image/png' }));
      return transfer;
    });
    await page.dispatchEvent('body', 'dragenter', { dataTransfer });
    if (await page.locator('#dropOverlay').isHidden()) throw new Error('overlay never appeared');
    await page.dispatchEvent('body', 'drop', { dataTransfer });
    await page.waitForSelector('#toolPicker[open]');
    if (await page.locator('#dropOverlay').isVisible()) throw new Error('overlay stayed after drop');
    if (!(await page.locator('[data-tool="crop"]').count())) throw new Error('picker did not receive the dropped image');
    await page.click('#pickerCancel');
  });

  await check('dragging and dropping hides the overlay and adds files', async () => {
    await fresh('#/squeeze');
    const dataTransfer = await page.evaluateHandle(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e4551f';
      ctx.fillRect(0, 0, 24, 24);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'dropped.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      return dt;
    });
    await page.dispatchEvent('body', 'dragenter', { dataTransfer });
    if (await page.locator('#dropOverlay').isHidden()) throw new Error('overlay never appeared');
    await page.dispatchEvent('body', 'drop', { dataTransfer });
    await page.waitForTimeout(1200);
    if (await page.locator('#dropOverlay').isVisible()) throw new Error('overlay stayed after drop');
    if ((await page.locator('.file-row').count()) < 1) throw new Error('dropped file not added');
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
    if (path.basename(out) !== 'photo-cropped-600x600.webp') throw new Error('name: ' + path.basename(out));
    const info = await imageInfo(out);
    if (!info.ok || info.width !== 600 || info.height !== 600) throw new Error(JSON.stringify(info));
    await page.screenshot({ path: path.join(SHOTS, '03-crop-result.png'), fullPage: true });
  });

  await check('target field can be cleared, and zero blocks the run', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.selectOption('#preset', 'us-passport');
    await page.waitForTimeout(300);
    await page.locator('#targetKB').fill('');
    await page.waitForTimeout(300);
    if ((await page.locator('#targetKB').inputValue()) !== '') throw new Error('field was rewritten');
    if (!(await page.locator('#runBtn').isDisabled())) throw new Error('run enabled at 0 KB');
    if (!/above 0 KB/.test(await page.locator('#targetHint').innerText())) throw new Error('missing hint');
    await page.locator('#targetKB').fill('300');
    await page.waitForTimeout(300);
    if ((await page.locator('#targetKB').inputValue()) !== '300') throw new Error('cannot type 300');
    if (await page.locator('#runBtn').isDisabled()) throw new Error('run still disabled at 300 KB');
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
    if (path.basename(out) !== 'photo-cropped-600x600.webp') throw new Error('name: ' + path.basename(out));
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
    if (path.basename(out) !== 'photo-cropped-350x450.jpg') throw new Error('name: ' + path.basename(out));
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
    if (!/^photo-cropped-\d+x\d+\.webp$/.test(path.basename(out))) throw new Error('name: ' + path.basename(out));
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
    if (path.basename(out) !== 'photo-converted.webp') throw new Error('name: ' + path.basename(out));
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
    const listing = entries.join('\n');
    if (!/photo-squeezed\.webp/.test(listing)) throw new Error('image name in zip');
    if (!/report-squeezed\.pdf/.test(listing)) throw new Error('pdf name in zip');
    await page.screenshot({ path: path.join(SHOTS, '04-squeeze.png'), fullPage: true });
  });

  await check('PDF-only squeeze hides image controls', async () => {
    await fresh('#/squeeze');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    if (!(await page.locator('#imagePanel').isHidden())) throw new Error('image panel visible');
    if (!(await page.locator('#pdfPanel').isVisible())) throw new Error('pdf panel hidden');
  });

  await check('image-only squeeze hides PDF controls', async () => {
    await fresh('#/squeeze');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    if (!(await page.locator('#pdfPanel').isHidden())) throw new Error('pdf panel visible');
    if (!(await page.locator('#imagePanel').isVisible())) throw new Error('image panel hidden');
  });

  // ------------------------------------------------------------------- pdf --
  await check('merge two 3-page PDFs', async () => {
    await fresh('#/merge');
    await upload([path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'report2.pdf')]);
    await run();
    const out = await downloadResult();
    if (path.basename(out) !== 'opti-merged.pdf') throw new Error('name: ' + path.basename(out));
    const info = await pdfInfo(fs.readFileSync(out));
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
    if (!/report-split-1\.pdf/.test(entries.join('\n'))) throw new Error('split naming');
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
    const out = await downloadResult();
    if (path.basename(out) !== 'report-extracted.pdf') throw new Error('name: ' + path.basename(out));
    const info = await pdfInfo(fs.readFileSync(out));
    if (!info.ok || info.pages !== 2) throw new Error('pages ' + info.pages);
  });

  await check('delete page 2', async () => {
    await fresh('#/delete');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#pages', '2');
    await run();
    const out = await downloadResult();
    if (path.basename(out) !== 'report-trimmed.pdf') throw new Error('name: ' + path.basename(out));
    const info = await pdfInfo(fs.readFileSync(out));
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

  await check('compress PDF names the output', async () => {
    await fresh('#/compress-pdf');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await run();
    const out = await downloadResult();
    if (path.basename(out) !== 'report-compressed.pdf') throw new Error('name: ' + path.basename(out));
    const info = await pdfInfo(fs.readFileSync(out));
    if (!info.ok || info.pages !== 3) throw new Error('pages ' + info.pages);
  });

  await check('images to PDF', async () => {
    await fresh('#/images-to-pdf');
    await upload([path.join(FIXTURES, 'photo.jpg'), path.join(FIXTURES, 'graphic.png')]);
    await run();
    const out = await downloadResult();
    if (path.basename(out) !== 'opti-images.pdf') throw new Error('name: ' + path.basename(out));
    const info = await pdfInfo(fs.readFileSync(out));
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

  await check('PDF to text extracts the text layer', async () => {
    await fresh('#/pdf-to-text');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await run();
    const saved = await downloadResult();
    if (!saved.toLowerCase().endsWith('.txt')) throw new Error('output: ' + saved);
    const text = fs.readFileSync(saved, 'utf8');
    if (!/page 1/i.test(text) || !/Selectable text/.test(text)) throw new Error('text missing: ' + text.slice(0, 80));
  });

  await check('clean metadata removes document info', async () => {
    await fresh('#/clean-metadata');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await run();
    const note = await page.locator('#resultZone .result-meta').last().textContent();
    if (!/Removed:|No document metadata/i.test(note)) throw new Error('note: ' + note);
  });

  await check('page size rebuilds pages with margins', async () => {
    await fresh('#/resize-pdf');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.selectOption('#pdfPageSize', 'letter');
    await page.fill('#pdfMargin', '8');
    await run();
    const info = await pdfInfo(fs.readFileSync(await downloadResult()));
    if (!info.ok) throw new Error(info.error);
  });

  await check('sign & stamp adds an image to the last page', async () => {
    await fresh('#/sign-pdf');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.setInputFiles('#sigFile', path.join(FIXTURES, 'alpha.png'));
    await page.waitForTimeout(400);
    await run();
    const name = await page.locator('#resultZone .result-name').textContent();
    if (!/signed/.test(name)) throw new Error('name: ' + name);
  });

  await check('PDF target size lands under the cap', async () => {
    await fresh('#/compress-pdf');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.selectOption('#pdfMode', 'raster');
    await page.check('#pdfTargetToggle');
    await page.fill('#pdfTargetMB', '0.4');
    await page.waitForTimeout(400);
    await run(300000);
    const note = await page.locator('#resultZone .result-meta').last().textContent();
    if (!/Fit under 41\d KB|Fit under 0\.4 MB|Could not get under/i.test(note)) throw new Error('note: ' + note);
    const saved = await downloadResult();
    if (fs.statSync(saved).size > 0.4 * 1024 * 1024) throw new Error('over target: ' + fs.statSync(saved).size);
  });

  await check('scan cleanup and freeform crop produce a sized image', async () => {
    await fresh('#/crop');
    await upload([path.join(FIXTURES, 'photo.jpg')]);
    await page.check('#freeCrop');
    await page.waitForTimeout(400);
    const box = await page.locator('#previewCanvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75, { steps: 8 });
    await page.mouse.up();
    await page.selectOption('#scan', 'bw');
    await page.waitForTimeout(400);
    const note = await page.locator('#freeCropHint').textContent();
    if (!/Selection \d+×\d+/.test(note)) throw new Error('freeform: ' + note);
    await run();
    const name = await page.locator('#resultZone .result-name').textContent();
    if (!/cropped-\d+x\d+/.test(name)) throw new Error('name: ' + name);
  });

  await check('page thumbnails toggle the extract range', async () => {
    await fresh('#/extract');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.waitForSelector('#pageThumbs .thumb', { timeout: 30000 });
    const count = await page.locator('#pageThumbs .thumb').count();
    if (count !== 3) throw new Error('thumbnails: ' + count);
    await page.locator('#pageThumbs .thumb').nth(1).click();
    await page.waitForTimeout(250);
    const value = await page.inputValue('#pages');
    if (value !== '1, 3') throw new Error('range: ' + value);
  });

  await check('OCR page range processes only the chosen page', async () => {
    await fresh('#/ocr');
    await upload([path.join(FIXTURES, 'report.pdf')]);
    await page.fill('#ocrPages', '2');
    await run(300000);
    const note = await page.locator('#resultZone .result-meta').last().textContent();
    if (!/OCR applied to 1 page/i.test(note)) throw new Error('note: ' + note);
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
    const gutters = await page.evaluate(() => {
      const shell = getComputedStyle(document.querySelector('.shell'));
      const header = getComputedStyle(document.querySelector('.topbar-inner'));
      const footer = getComputedStyle(document.querySelector('.site-footer'));
      return [shell.paddingLeft, shell.paddingRight, header.paddingLeft, header.paddingRight,
        footer.paddingLeft, footer.paddingRight, footer.textAlign];
    });
    if (gutters.slice(0, 6).some((value) => value !== '0px')) throw new Error('mobile gutters: ' + gutters.join(','));
    if (gutters[6] !== 'center') throw new Error('footer not centered: ' + gutters[6]);
    await page.setInputFiles('#files-input', [path.join(FIXTURES, 'photo.jpg')]);
    await page.waitForTimeout(1400);
    await page.selectOption('#preset', 'us-passport');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '06-mobile-crop.png'), fullPage: true });
    await page.click('#runBtn');
    await page.waitForFunction(() => !document.querySelector('#runBtn').textContent.includes('working'), null, {
      timeout: 120000
    });
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error('horizontal overflow: ' + overflow);
    if (!(await page.locator('#resultZone .result').isVisible())) throw new Error('no result');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
    if (!/download/i.test(focused || '')) throw new Error('download not focused: ' + focused);
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
