/**
 * OptiPress · core.js
 * Pure, dependency-free helpers shared by the compressor, the UI and the test suite.
 * No DOM access lives in this file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OptiCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_EDGE = 16384;
  var MAX_PIXELS = 40 * 1000 * 1000; // 40 MP ceiling keeps iOS/Safari canvases alive
  var MIN_EDGE = 24;

  var PRESETS = {
    mild: {
      label: 'Mild',
      hint: 'Barely-there compression. Keeps detail for print and archives.',
      quality: 92,
      scale: 100
    },
    juicy: {
      label: 'Juicy',
      hint: 'The everyday squeeze. Big savings, no visible softness on screen.',
      quality: 78,
      scale: 100
    },
    max: {
      label: 'Max',
      hint: 'Aggressive. Great for web uploads and thumbnails.',
      quality: 55,
      scale: 75
    }
  };

  var DEFAULTS = {
    preset: 'juicy',
    quality: 78,
    resizeMode: 'scale',
    scale: 100,
    customWidth: '',
    customHeight: '',
    aspectLocked: true,
    letterbox: 'white',
    format: 'auto',
    pdfMode: 'raster',
    pdfDpi: 150,
    targetEnabled: false,
    targetKB: 500
  };

  var IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg', 'heic', 'heif'];
  var PDF_EXTENSIONS = ['pdf'];

  function clampNumber(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) n = min;
    return Math.min(max, Math.max(min, n));
  }

  function toPositiveInt(value) {
    var n = parseInt(value, 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function extOf(name) {
    var clean = String(name || '');
    var dot = clean.lastIndexOf('.');
    if (dot < 0 || dot === clean.length - 1) return '';
    return clean.slice(dot + 1).toLowerCase();
  }

  function baseName(name) {
    var clean = String(name || '');
    var slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    if (slash >= 0) clean = clean.slice(slash + 1);
    var dot = clean.lastIndexOf('.');
    if (dot > 0) clean = clean.slice(0, dot);
    return clean;
  }

  function kindOf(file) {
    if (!file) return 'unknown';
    var ext = extOf(file.name);
    var type = String(file.type || '').toLowerCase();
    if (type === 'application/pdf' || PDF_EXTENSIONS.indexOf(ext) !== -1) return 'pdf';
    if (ext === 'heic' || ext === 'heif' || type === 'image/heic' || type === 'image/heif') return 'heic';
    if (type.indexOf('image/') === 0 || IMAGE_EXTENSIONS.indexOf(ext) !== -1) return 'image';
    return 'unknown';
  }

  function isSupported(file) {
    return kindOf(file) !== 'unknown';
  }

  function formatBytes(bytes, options) {
    var b = Number(bytes);
    if (!isFinite(b) || b < 0) return '—';
    if (b === 0) return '0 B';
    var opts = options || {};
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    var value = b / Math.pow(1024, i);
    var decimals;
    if (typeof opts.decimals === 'number') decimals = opts.decimals;
    else if (i === 0) decimals = 0;
    else if (value >= 100) decimals = 0;
    else if (value >= 10) decimals = 1;
    else decimals = 2;
    var text = value.toFixed(decimals);
    text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    return text + ' ' + units[i];
  }

  function savingsPercent(before, after) {
    var b = Number(before);
    var a = Number(after);
    if (!isFinite(b) || b <= 0 || !isFinite(a)) return 0;
    return Math.round((1 - a / b) * 100);
  }

  function presetSettings(id) {
    var preset = PRESETS[id];
    if (!preset) return null;
    return { quality: preset.quality, scale: preset.scale };
  }

  /**
   * Resolve the exact pixel box an image should be encoded at.
   * Never upscales in scale mode; exact mode always lands on the requested box.
   */
  function computeTargetDims(srcWidth, srcHeight, settings) {
    var w0 = Math.max(1, Math.round(Number(srcWidth) || 1));
    var h0 = Math.max(1, Math.round(Number(srcHeight) || 1));
    var s = settings || {};

    if (s.resizeMode === 'exact') {
      var rw = toPositiveInt(s.customWidth);
      var rh = toPositiveInt(s.customHeight);
      if (rw && rh) return { width: rw, height: rh, mode: 'exact' };
      if (rw) return { width: rw, height: Math.max(1, Math.round((h0 * rw) / w0)), mode: 'width' };
      if (rh) return { width: Math.max(1, Math.round((w0 * rh) / h0)), height: rh, mode: 'height' };
      return { width: w0, height: h0, mode: 'original' };
    }

    var pct = clampNumber(s.scale === undefined ? 100 : s.scale, 1, 100);
    if (pct >= 100) return { width: w0, height: h0, mode: 'original' };
    return {
      width: Math.max(1, Math.round((w0 * pct) / 100)),
      height: Math.max(1, Math.round((h0 * pct) / 100)),
      mode: 'scale'
    };
  }

  /** Clamp a canvas into safe browser limits without changing the aspect ratio. */
  function capCanvasDims(width, height, maxPixels, maxEdge) {
    var w = Math.max(1, Math.round(Number(width) || 1));
    var h = Math.max(1, Math.round(Number(height) || 1));
    var pixelCap = maxPixels || MAX_PIXELS;
    var edgeCap = maxEdge || MAX_EDGE;
    var factor = Math.min(1, edgeCap / w, edgeCap / h, Math.sqrt(pixelCap / (w * h)));
    if (factor >= 1) return { width: w, height: h, scaled: false };
    return {
      width: Math.max(1, Math.floor(w * factor)),
      height: Math.max(1, Math.floor(h * factor)),
      scaled: true
    };
  }

  /** Letterbox geometry: fit src into dst without distortion. */
  function fitRect(srcWidth, srcHeight, dstWidth, dstHeight) {
    var sw = Math.max(1, Number(srcWidth) || 1);
    var sh = Math.max(1, Number(srcHeight) || 1);
    var dw = Math.max(1, Number(dstWidth) || 1);
    var dh = Math.max(1, Number(dstHeight) || 1);
    var scale = Math.min(dw / sw, dh / sh);
    var width = Math.max(1, Math.round(sw * scale));
    var height = Math.max(1, Math.round(sh * scale));
    return {
      x: Math.round((dw - width) / 2),
      y: Math.round((dh - height) / 2),
      width: width,
      height: height,
      scale: scale,
      covers: width >= dw - 1 && height >= dh - 1
    };
  }

  function ratiosClose(aWidth, aHeight, bWidth, bHeight, tolerance) {
    var ar = (Number(aWidth) || 1) / (Number(aHeight) || 1);
    var br = (Number(bWidth) || 1) / (Number(bHeight) || 1);
    var tol = typeof tolerance === 'number' ? tolerance : 0.01;
    return Math.abs(ar - br) / Math.max(ar, br) <= tol;
  }

  function mimeExtension(mime) {
    switch (mime) {
      case 'image/jpeg': return 'jpg';
      case 'image/png': return 'png';
      case 'image/webp': return 'webp';
      case 'image/avif': return 'avif';
      case 'application/pdf': return 'pdf';
      case 'application/zip': return 'zip';
      default: return 'bin';
    }
  }

  /**
   * Decide the real output format.
   * `caps` is { webp: bool, avif: bool, jpeg: bool, png: bool }.
   */
  function resolveOutputMime(choice, inputMime, ctx) {
    var context = ctx || {};
    var caps = context.caps || { webp: true, avif: false, jpeg: true, png: true };
    var hasAlpha = context.hasAlpha !== false;
    var input = String(inputMime || '').toLowerCase();

    function supported(mime) {
      if (mime === 'image/webp') return caps.webp !== false;
      if (mime === 'image/avif') return caps.avif === true;
      if (mime === 'image/png') return caps.png !== false;
      if (mime === 'image/jpeg') return caps.jpeg !== false;
      return false;
    }
    function bestLossy(preferAlpha) {
      if (supported('image/webp')) return 'image/webp';
      if (preferAlpha && supported('image/png')) return 'image/png';
      return 'image/jpeg';
    }

    if (choice === 'original') {
      if (input === 'image/png' && supported('image/png')) return 'image/png';
      if (input === 'image/jpeg' && supported('image/jpeg')) return 'image/jpeg';
      if (input === 'image/webp' && supported('image/webp')) return 'image/webp';
      if (input === 'image/avif' && supported('image/avif')) return 'image/avif';
      return bestLossy(hasAlpha);
    }

    if (choice && choice !== 'auto') {
      if (supported(choice)) return choice;
      return bestLossy(hasAlpha);
    }

    // auto: WebP is the best broadly-supported size/quality trade-off.
    return bestLossy(hasAlpha);
  }

  function sanitizeBase(value) {
    var text = String(value || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s-]+|[.\s-]+$/g, '')
      .slice(0, 90)
      .trim();
    return text || 'file';
  }

  function outputFileName(originalName, mime, suffix) {
    var base = sanitizeBase(baseName(originalName));
    var ext = mimeExtension(mime);
    var tag = suffix === undefined ? 'squeezed' : suffix;
    var name = tag ? base + '-' + tag : base;
    return name + '.' + ext;
  }

  /** Keep ZIP/disk names unique: photo.jpg, photo-2.jpg, photo-3.jpg … */
  function uniqueName(name, used) {
    var candidate = String(name);
    if (!used || !used.has(candidate)) return candidate;
    var dot = candidate.lastIndexOf('.');
    var stem = dot > 0 ? candidate.slice(0, dot) : candidate;
    var ext = dot > 0 ? candidate.slice(dot) : '';
    var n = 2;
    while (used.has(stem + '-' + n + ext)) n++;
    return stem + '-' + n + ext;
  }

  function estimateFromSample(sampleBytes, samplePixels, targetPixels) {
    var bytes = Math.max(0, Number(sampleBytes) || 0);
    var sp = Math.max(1, Number(samplePixels) || 1);
    var tp = Math.max(1, Number(targetPixels) || 1);
    // 0.98 accounts for header overhead not scaling with pixel count.
    return Math.max(256, Math.round((bytes / sp) * tp * 0.98));
  }

  function kbToBytes(kb) {
    var n = Number(kb);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n * 1024);
  }

  function settingsSignature(settings) {
    var s = normalizeSettings(settings);
    return [
      s.quality,
      s.resizeMode,
      s.scale,
      s.customWidth,
      s.customHeight,
      s.letterbox,
      s.format,
      s.pdfMode,
      s.pdfDpi,
      s.targetEnabled ? 1 : 0,
      s.targetKB
    ].join('|');
  }

  function normalizeSettings(raw, defaults) {
    var base = defaults || DEFAULTS;
    var input = raw && typeof raw === 'object' ? raw : {};
    var out = {
      preset: typeof input.preset === 'string' ? input.preset : base.preset,
      quality: Math.round(clampNumber(input.quality === undefined ? base.quality : input.quality, 5, 100)),
      resizeMode: input.resizeMode === 'exact' ? 'exact' : 'scale',
      scale: Math.round(clampNumber(input.scale === undefined ? base.scale : input.scale, 1, 100)),
      customWidth: toPositiveInt(input.customWidth) || '',
      customHeight: toPositiveInt(input.customHeight) || '',
      aspectLocked: input.aspectLocked === undefined ? base.aspectLocked : !!input.aspectLocked,
      letterbox: input.letterbox === 'black' ? 'black' : 'white',
      format: ['auto', 'original', 'image/webp', 'image/jpeg', 'image/png', 'image/avif'].indexOf(input.format) !== -1
        ? input.format
        : base.format,
      pdfMode: input.pdfMode === 'structure' ? 'structure' : 'raster',
      pdfDpi: [72, 150, 200, 300].indexOf(Number(input.pdfDpi)) !== -1
        ? Number(input.pdfDpi)
        : base.pdfDpi,
      targetEnabled: !!input.targetEnabled,
      targetKB: Math.round(clampNumber(input.targetKB === undefined ? base.targetKB : input.targetKB, 10, 200000))
    };
    if (!PRESETS[out.preset]) out.preset = 'custom';
    return out;
  }

  return {
    MAX_EDGE: MAX_EDGE,
    MAX_PIXELS: MAX_PIXELS,
    MIN_EDGE: MIN_EDGE,
    DEFAULTS: DEFAULTS,
    PRESETS: PRESETS,
    IMAGE_EXTENSIONS: IMAGE_EXTENSIONS,
    clampNumber: clampNumber,
    toPositiveInt: toPositiveInt,
    extOf: extOf,
    baseName: baseName,
    kindOf: kindOf,
    isSupported: isSupported,
    formatBytes: formatBytes,
    savingsPercent: savingsPercent,
    presetSettings: presetSettings,
    computeTargetDims: computeTargetDims,
    capCanvasDims: capCanvasDims,
    fitRect: fitRect,
    ratiosClose: ratiosClose,
    mimeExtension: mimeExtension,
    resolveOutputMime: resolveOutputMime,
    sanitizeBase: sanitizeBase,
    outputFileName: outputFileName,
    uniqueName: uniqueName,
    estimateFromSample: estimateFromSample,
    kbToBytes: kbToBytes,
    settingsSignature: settingsSignature,
    normalizeSettings: normalizeSettings
  };
});
