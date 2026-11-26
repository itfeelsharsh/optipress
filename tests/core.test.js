'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('formatBytes keeps file sizes readable', () => {
  assert.equal(C.formatBytes(0), '0 B');
  assert.equal(C.formatBytes(512), '512 B');
  assert.equal(C.formatBytes(1024), '1 KB');
  assert.equal(C.formatBytes(1536), '1.5 KB');
  assert.equal(C.formatBytes(1024 * 1024), '1 MB');
  assert.equal(C.formatBytes(1024 * 1024 * 2.5), '2.5 MB');
  assert.equal(C.formatBytes(-1), '—');
  assert.equal(C.formatBytes(NaN), '—');
});

test('savingsPercent handles growth and zero', () => {
  assert.equal(C.savingsPercent(1000, 250), 75);
  assert.equal(C.savingsPercent(1000, 1000), 0);
  assert.equal(C.savingsPercent(1000, 1200), -20);
  assert.equal(C.savingsPercent(0, 10), 0);
});

test('kindOf classifies PDF, HEIC and images', () => {
  assert.equal(C.kindOf({ name: 'a.PDF', type: '' }), 'pdf');
  assert.equal(C.kindOf({ name: 'a.heic', type: '' }), 'heic');
  assert.equal(C.kindOf({ name: 'a.jpeg', type: '' }), 'image');
  assert.equal(C.kindOf({ name: 'a.png', type: 'image/png' }), 'image');
  assert.equal(C.kindOf({ name: 'a.zip', type: 'application/zip' }), 'unknown');
  assert.equal(C.isSupported({ name: 'a.zip', type: 'application/zip' }), false);
});

test('computeTargetDims honours scale mode and never upscales', () => {
  const dims = C.computeTargetDims(4000, 3000, { resizeMode: 'scale', scale: 50 });
  assert.deepEqual(dims, { width: 2000, height: 1500, mode: 'scale' });

  const full = C.computeTargetDims(4000, 3000, { resizeMode: 'scale', scale: 100 });
  assert.deepEqual(full, { width: 4000, height: 3000, mode: 'original' });

  const clamped = C.computeTargetDims(4000, 3000, { resizeMode: 'scale', scale: 140 });
  assert.equal(clamped.width, 4000);
});

test('computeTargetDims resolves exact boxes and single-side requests', () => {
  const both = C.computeTargetDims(4000, 3000, { resizeMode: 'exact', customWidth: 1200, customHeight: 800 });
  assert.deepEqual(both, { width: 1200, height: 800, mode: 'exact' });

  const widthOnly = C.computeTargetDims(4000, 3000, { resizeMode: 'exact', customWidth: 1000 });
  assert.deepEqual(widthOnly, { width: 1000, height: 750, mode: 'width' });

  const heightOnly = C.computeTargetDims(4000, 3000, { resizeMode: 'exact', customHeight: 600 });
  assert.deepEqual(heightOnly, { width: 800, height: 600, mode: 'height' });

  const empty = C.computeTargetDims(4000, 3000, { resizeMode: 'exact' });
  assert.equal(empty.mode, 'original');
});

test('capCanvasDims preserves aspect ratio under limits', () => {
  const capped = C.capCanvasDims(20000, 10000, 40e6, 16384);
  assert.equal(capped.scaled, true);
  assert.ok(capped.width <= 16384);
  assert.ok(capped.height <= 16384);
  assert.ok(capped.width * capped.height <= 40e6);
  assert.ok(Math.abs(capped.width / capped.height - 2) < 0.01);

  const untouched = C.capCanvasDims(2000, 1000);
  assert.deepEqual(untouched, { width: 2000, height: 1000, scaled: false });
});

test('fitRect letterboxes without distortion', () => {
  const rect = C.fitRect(4000, 3000, 1000, 1000);
  assert.equal(rect.width, 1000);
  assert.equal(rect.height, 750);
  assert.equal(rect.y, 125);
  assert.equal(rect.x, 0);
  assert.equal(rect.covers, false);

  const exact = C.fitRect(1000, 500, 1000, 500);
  assert.equal(exact.covers, true);
});

test('ratiosClose tolerates rounding but catches real mismatch', () => {
  assert.equal(C.ratiosClose(1200, 800, 600, 400), true);
  assert.equal(C.ratiosClose(1201, 800, 600, 400), true);
  assert.equal(C.ratiosClose(1600, 900, 600, 400), false);
});

test('resolveOutputMime picks WebP for auto and respects support', () => {
  const all = { webp: true, avif: true, jpeg: true, png: true };
  const noWebp = { webp: false, avif: false, jpeg: true, png: true };

  assert.equal(C.resolveOutputMime('auto', 'image/png', { hasAlpha: true, caps: all }), 'image/webp');
  assert.equal(C.resolveOutputMime('auto', 'image/jpeg', { hasAlpha: false, caps: all }), 'image/webp');
  assert.equal(C.resolveOutputMime('original', 'image/jpeg', { hasAlpha: false, caps: all }), 'image/jpeg');
  assert.equal(C.resolveOutputMime('original', 'image/png', { hasAlpha: true, caps: all }), 'image/png');
  assert.equal(C.resolveOutputMime('image/avif', 'image/jpeg', { hasAlpha: false, caps: noWebp }), 'image/jpeg');
  assert.equal(C.resolveOutputMime('image/webp', 'image/jpeg', { hasAlpha: false, caps: noWebp }), 'image/jpeg');
  assert.equal(C.resolveOutputMime('auto', 'image/png', { hasAlpha: true, caps: noWebp }), 'image/png');
  assert.equal(C.resolveOutputMime('image/avif', 'image/png', { hasAlpha: true, caps: noWebp }), 'image/png');
});

test('outputFileName sanitises names and matches the mime', () => {
  assert.equal(C.outputFileName('holiday photo.PNG', 'image/webp'), 'holiday photo-squeezed.webp');
  assert.equal(C.outputFileName('a/b:c*?.jpg', 'image/jpeg'), 'b-c-squeezed.jpg');
  assert.equal(C.outputFileName('report.pdf', 'application/pdf'), 'report-squeezed.pdf');
  assert.equal(C.outputFileName('noext', 'image/png'), 'noext-squeezed.png');
});

test('uniqueName avoids collisions inside a ZIP', () => {
  const used = new Set(['photo.jpg']);
  const second = C.uniqueName('photo.jpg', used);
  assert.equal(second, 'photo-2.jpg');
  used.add(second);
  assert.equal(C.uniqueName('photo.jpg', used), 'photo-3.jpg');
});

test('estimateFromSample scales by pixel count', () => {
  const estimate = C.estimateFromSample(10000, 480 * 320, 1920 * 1280);
  const expected = Math.round((10000 / (480 * 320)) * (1920 * 1280) * 0.98);
  assert.equal(estimate, expected);
  assert.ok(C.estimateFromSample(0, 100, 10000) >= 256);
});

test('normalizeSettings repairs bad values', () => {
  const settings = C.normalizeSettings({
    quality: 999,
    scale: -5,
    resizeMode: 'nonsense',
    format: 'image/tiff',
    pdfDpi: 123,
    targetKB: -2,
    preset: 'ghost'
  });
  assert.equal(settings.quality, 100);
  assert.equal(settings.scale, 1);
  assert.equal(settings.resizeMode, 'scale');
  assert.equal(settings.format, 'auto');
  assert.equal(settings.pdfDpi, 150);
  assert.equal(settings.targetKB, 0);
  assert.equal(settings.preset, 'custom');
});

test('settingsSignature changes when the output would change', () => {
  const a = C.normalizeSettings({ quality: 78, scale: 100 });
  const b = C.normalizeSettings({ quality: 79, scale: 100 });
  assert.notEqual(C.settingsSignature(a), C.settingsSignature(b));
  assert.equal(C.settingsSignature(a), C.settingsSignature(C.normalizeSettings(a)));
});

test('kbToBytes converts and rejects nonsense', () => {
  assert.equal(C.kbToBytes(500), 512000);
  assert.equal(C.kbToBytes(0), 0);
  assert.equal(C.kbToBytes('abc'), 0);
});

test('presetSettings exposes the three named presets', () => {
  assert.equal(C.presetSettings('mild').quality, 92);
  assert.equal(C.presetSettings('juicy').quality, 78);
  assert.equal(C.presetSettings('max').scale, 75);
  assert.equal(C.presetSettings('nope'), null);
});

test('formatPageSpec compresses sorted page lists into ranges', () => {
  assert.equal(C.formatPageSpec([1, 2, 3, 5]), '1-3, 5');
  assert.equal(C.formatPageSpec([6, 5, 4]), '4-6');
  assert.equal(C.formatPageSpec([2, 2, 4]), '2, 4');
  assert.equal(C.formatPageSpec([]), '');
});

test('normalizeCropRect clamps a freeform region inside the image', () => {
  const region = C.normalizeCropRect({ x: 0.8, y: -0.2, w: 0.5, h: 0.4 });
  assert.ok(region.x <= 0.5);
  assert.equal(region.y, 0);
  assert.equal(region.w, 0.5);
  assert.equal(C.normalizeCropRect({ w: 0, h: 0.4 }), null);
  assert.equal(C.normalizeCropRect(null), null);
});
