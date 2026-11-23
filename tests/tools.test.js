'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const Padding = require('../padding.js');
const Presets = require('../presets.js');

test('parsePageSpec expands ranges, open ranges and parity', () => {
  assert.deepEqual(C.parsePageSpec('', 5).pages, [1, 2, 3, 4, 5]);
  assert.deepEqual(C.parsePageSpec('all', 5).pages, [1, 2, 3, 4, 5]);
  assert.deepEqual(C.parsePageSpec('1-3, 5', 5).pages, [1, 2, 3, 5]);
  assert.deepEqual(C.parsePageSpec('2-', 5).pages, [2, 3, 4, 5]);
  assert.deepEqual(C.parsePageSpec('odd', 6).pages, [1, 3, 5]);
  assert.deepEqual(C.parsePageSpec('even', 6).pages, [2, 4, 6]);
  assert.deepEqual(C.parsePageSpec('3-1', 5).pages, [1, 2, 3]);
  assert.deepEqual(C.parsePageSpec('1,1,2', 3).pages, [1, 2]);
});

test('parsePageSpec reports out-of-range and malformed input', () => {
  const outOfRange = C.parsePageSpec('1-99', 5);
  assert.ok(outOfRange.errors.length > 0);
  assert.deepEqual(outOfRange.pages, [1, 2, 3, 4, 5]);

  const malformed = C.parsePageSpec('one-two', 5);
  assert.ok(malformed.errors.length > 0);
  assert.deepEqual(malformed.pages, []);
});

test('parsePageSpec ordered mode rejects missing and duplicate pages', () => {
  assert.deepEqual(C.parsePageSpec('3,1,2', 3, { ordered: true, requireAll: true }).pages, [3, 1, 2]);

  const duplicates = C.parsePageSpec('1,1,2,3', 3, { ordered: true, requireAll: true });
  assert.ok(duplicates.errors.some((error) => /more than once/.test(error)));

  const missing = C.parsePageSpec('1,2', 3, { ordered: true, requireAll: true });
  assert.ok(missing.errors.some((error) => /every page/.test(error)));
});

test('parseSplitSpec handles every-N and semicolon ranges', () => {
  assert.deepEqual(C.parseSplitSpec('', 5, 'every', 2).parts, [[1, 2], [3, 4], [5]]);
  assert.deepEqual(C.parseSplitSpec('1-2; 3-4', 5, 'ranges').parts, [[1, 2], [3, 4]]);
  assert.deepEqual(C.parseSplitSpec('1-3; 3-5', 5, 'ranges').parts, [[1, 2, 3], [3, 4, 5]]);
  assert.ok(C.parseSplitSpec('1-3; 3-5', 5, 'ranges').errors.some((error) => /more than one part/.test(error)));
  assert.ok(C.parseSplitSpec('', 5, 'ranges').errors.length > 0);
  assert.deepEqual(C.parseSplitSpec('', 0, 'every', 1).parts, [[1]]);
});

test('computeCropRect fills from the chosen anchor without distortion', () => {
  const centre = C.computeCropRect(4000, 3000, 600, 600, 'fill', 'center');
  assert.equal(centre.sWidth, 3000);
  assert.equal(centre.sHeight, 3000);
  assert.equal(centre.sx, 500);
  assert.equal(centre.sy, 0);
  assert.equal(centre.dWidth, 600);

  const left = C.computeCropRect(4000, 3000, 600, 600, 'fill', 'left');
  assert.equal(left.sx, 0);
  const top = C.computeCropRect(3000, 4000, 600, 600, 'fill', 'top');
  assert.equal(top.sy, 0);
  const bottomRight = C.computeCropRect(3000, 4000, 600, 600, 'fill', 'bottom-right');
  assert.equal(bottomRight.sy, 1000);
});

test('computeCropRect fits inside with a letterbox', () => {
  const fit = C.computeCropRect(4000, 3000, 600, 600, 'fit', 'center');
  assert.equal(fit.dWidth, 600);
  assert.equal(fit.dHeight, 450);
  assert.equal(fit.dy, 75);
  assert.equal(fit.covers, false);
});

test('padding hits exact byte sizes and preserves magic bytes', () => {
  const fixtures = [
    ['image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), [0xff, 0xd8]],
    ['image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0]), [0x89, 0x50]],
    ['image/webp', new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, ...'WEBPVP8 '.split('').map((c) => c.charCodeAt(0))])), [0x52, 0x49]],
    ['image/avif', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), [0, 0, 0, 0x18]],
    ['image/gif', new Uint8Array([...'GIF89a'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0x3b]), [...'GIF8'].map((c) => c.charCodeAt(0))],
    ['application/pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF\n'), [0x25, 0x50]],
    ['image/svg+xml', new TextEncoder().encode('<svg></svg>'), [0x3c, 0x73]]
  ];

  fixtures.forEach(([mime, input, magic]) => {
    const padded = Padding.padBytes(input, mime, 1000);
    assert.equal(padded.bytes.length, 1000, mime + ' length');
    magic.forEach((value, index) => assert.equal(padded.bytes[index], value, mime + ' magic at ' + index));
  });
});

test('padding handles large byte budgets with multiple segments', () => {
  const jpeg = Padding.padBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg', 200000);
  assert.equal(jpeg.bytes.length, 200000);
  const png = Padding.padBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0]), 'image/png', 200000);
  assert.equal(png.bytes.length, 200000);
});

test('padding never truncates an oversized file', () => {
  const input = new Uint8Array(100);
  const result = Padding.padBytes(input, 'image/jpeg', 50);
  assert.equal(result.added, 0);
  assert.equal(result.bytes.length, 100);
});

test('padding keeps PDF EOF at the end', () => {
  const input = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
  const padded = Padding.padBytes(input, 'application/pdf', 300);
  const text = new TextDecoder().decode(padded.bytes);
  assert.ok(text.trim().endsWith('%%EOF'));
});

test('presets cover passport, government and social sizes', () => {
  assert.ok(Presets.IMAGE_PRESETS.length >= 15);
  assert.equal(Presets.byId('us-passport').width, 600);
  assert.equal(Presets.byId('us-passport').maxKB, 240);
  assert.equal(Presets.byId('india-pan').maxKB, 50);
  assert.equal(Presets.byId('upsc-signature').width, 140);
  assert.equal(Presets.byId('linkedin').height, 400);
  assert.equal(Presets.byId('nope'), null);
  assert.ok(Presets.groups().some((group) => group.name === 'Passport & visa'));
});

test('normalizeSettings understands crop, target and custom MIME fields', () => {
  const settings = C.normalizeSettings({
    background: 'transparent',
    fitMode: 'fill',
    anchor: 'bottom-right',
    targetMode: 'atMost',
    customMime: 'image/JXL',
    format: 'custom'
  });
  assert.equal(settings.background, 'transparent');
  assert.equal(settings.fitMode, 'fill');
  assert.equal(settings.anchor, 'bottom-right');
  assert.equal(settings.targetMode, 'atMost');
  assert.equal(settings.customMime, 'image/jxl');
  assert.equal(settings.format, 'custom');
});

test('resolveOutputMime returns valid custom types', () => {
  const caps = { webp: true, avif: false, jpeg: true, png: true };
  assert.equal(C.resolveOutputMime('custom', 'image/png', { caps, customMime: 'image/jxl' }), 'image/jxl');
  assert.equal(C.resolveOutputMime('custom', 'image/png', { caps, customMime: 'not a mime' }), 'image/webp');
  assert.equal(C.mimeExtension('image/jxl'), 'jxl');
  assert.equal(C.mimeExtension('image/x-custom'), 'x-custom');
});

test('any image MIME is accepted as an image, unknown types are not', () => {
  assert.equal(C.kindOf({ name: 'scan.tiff', type: 'image/tiff' }), 'image');
  assert.equal(C.kindOf({ name: 'weird.bin', type: 'image/x-weird' }), 'image');
  assert.equal(C.kindOf({ name: 'archive.zip', type: 'application/zip' }), 'unknown');
});
