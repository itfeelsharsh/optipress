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
    background: 'white',
    fitMode: 'fit',
    anchor: 'center',
    format: 'auto',
    customMime: '',
    pdfMode: 'raster',
    pdfDpi: 150,
    targetEnabled: false,
    targetMode: 'exact',
    targetKB: 500
  };

  var IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'jxl', 'ico'];
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

  var ANCHOR_POINTS = {
    'top-left': [0, 0],
    top: [0.5, 0],
    'top-right': [1, 0],
    left: [0, 0.5],
    center: [0.5, 0.5],
    right: [1, 0.5],
    'bottom-left': [0, 1],
    bottom: [0.5, 1],
    'bottom-right': [1, 1]
  };

  function anchorPoint(anchor) {
    return ANCHOR_POINTS[anchor] || ANCHOR_POINTS.center;
  }

  /**
   * Crop (fill) or letterbox (fit) geometry. All values are in source/output
   * pixels and can be passed straight to drawImage.
   */
  function computeCropRect(srcWidth, srcHeight, dstWidth, dstHeight, fitMode, anchor) {
    var sw = Math.max(1, Number(srcWidth) || 1);
    var sh = Math.max(1, Number(srcHeight) || 1);
    var dw = Math.max(1, Number(dstWidth) || 1);
    var dh = Math.max(1, Number(dstHeight) || 1);

    if (fitMode === 'fill') {
      var scale = Math.max(dw / sw, dh / sh);
      var cropW = Math.min(sw, dw / scale);
      var cropH = Math.min(sh, dh / scale);
      var point = anchorPoint(anchor);
      return {
        sx: (sw - cropW) * point[0],
        sy: (sh - cropH) * point[1],
        sWidth: cropW,
        sHeight: cropH,
        dx: 0,
        dy: 0,
        dWidth: dw,
        dHeight: dh,
        mode: 'fill',
        covers: true
      };
    }

    var rect = fitRect(sw, sh, dw, dh);
    return {
      sx: 0,
      sy: 0,
      sWidth: sw,
      sHeight: sh,
      dx: rect.x,
      dy: rect.y,
      dWidth: rect.width,
      dHeight: rect.height,
      mode: 'fit',
      covers: rect.covers
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
      case 'image/gif': return 'gif';
      case 'image/bmp': return 'bmp';
      case 'image/svg+xml': return 'svg';
      case 'image/heic': return 'heic';
      case 'image/heif': return 'heif';
      case 'image/jxl': return 'jxl';
      case 'image/tiff': return 'tiff';
      case 'image/x-icon': return 'ico';
      case 'application/pdf': return 'pdf';
      case 'application/zip': return 'zip';
      default: {
        if (mime && mime.indexOf('image/') === 0) return mime.slice(6).replace(/[^a-z0-9-]/g, '') || 'img';
        return 'bin';
      }
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

    if (choice === 'custom') {
      var custom = String(context.customMime || '').toLowerCase();
      if (/^image\/[a-z0-9.+-]+$/.test(custom)) return custom;
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
      s.background,
      s.fitMode,
      s.anchor,
      s.format,
      s.customMime,
      s.pdfMode,
      s.pdfDpi,
      s.targetEnabled ? 1 : 0,
      s.targetMode,
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
      background: ['white', 'black', 'transparent'].indexOf(input.background) !== -1
        ? input.background
        : (input.letterbox === 'black' ? 'black' : base.background),
      fitMode: input.fitMode === 'fill' ? 'fill' : 'fit',
      anchor: ANCHOR_POINTS[input.anchor] ? input.anchor : 'center',
      format: ['auto', 'original', 'custom', 'image/webp', 'image/jpeg', 'image/png', 'image/avif'].indexOf(input.format) !== -1
        ? input.format
        : base.format,
      customMime: /^image\/[a-z0-9.+-]+$/i.test(String(input.customMime || ''))
        ? String(input.customMime).toLowerCase()
        : '' ,
      pdfMode: input.pdfMode === 'structure' ? 'structure' : 'raster',
      pdfDpi: [72, 150, 200, 300].indexOf(Number(input.pdfDpi)) !== -1
        ? Number(input.pdfDpi)
        : base.pdfDpi,
      targetEnabled: !!input.targetEnabled,
      targetMode: input.targetMode === 'atMost' ? 'atMost' : 'exact',
      targetKB: Math.round(clampNumber(input.targetKB === undefined ? base.targetKB : input.targetKB, 10, 200000))
    };
    if (!PRESETS[out.preset]) out.preset = 'custom';
    return out;
  }

  function parsePageSpec(input, pageCount, options) {
    var opts = options || {};
    var total = Math.max(0, Math.round(Number(pageCount) || 0));
    var text = String(input === undefined || input === null ? '' : input).trim().toLowerCase();
    var pages = [];
    var seen = new Set();
    var errors = [];

    if (!text || text === 'all' || text === '*') {
      for (var p = 1; p <= total; p++) pages.push(p);
      return { pages: pages, errors: errors };
    }

    var tokens = text.split(/[,\s]+/).filter(Boolean);
    tokens.forEach(function (token) {
      if (token === 'odd' || token === 'even') {
        var parity = token === 'odd' ? 1 : 0;
        for (var n = 1; n <= total; n++) {
          if (n % 2 === parity) {
            if (!opts.ordered && seen.has(n)) continue;
            if (opts.ordered && seen.has(n)) {
              errors.push('Page ' + n + ' appears more than once.');
              continue;
            }
            seen.add(n);
            pages.push(n);
          }
        }
        return;
      }

      var match = /^(\d+)(?:\s*-\s*(\d+)?)?$/.exec(token);
      if (!match) {
        errors.push('“' + token + '” is not a page or range.');
        return;
      }
      var start = parseInt(match[1], 10);
      var hasDash = token.indexOf('-') !== -1;
      var end = !hasDash ? start : match[2] === undefined ? total : parseInt(match[2], 10);
      if (!start || start < 1) {
        errors.push('Page numbers start at 1.');
        start = 1;
      }
      if (!end || end < 1) end = total;
      if (start > end) {
        var swap = start;
        start = end;
        end = swap;
      }
      if (end > total) {
        errors.push('Pages ' + start + '–' + end + ' are outside 1–' + total + '.');
        end = total;
      }
      for (var i = start; i <= end; i++) {
        if (seen.has(i)) {
          if (opts.ordered) errors.push('Page ' + i + ' appears more than once.');
          continue;
        }
        seen.add(i);
        pages.push(i);
      }
    });

    if (opts.requireAll && pages.length !== total) {
      errors.push('Include every page exactly once (' + pages.length + ' of ' + total + ').');
    }
    if (!pages.length && !errors.length) errors.push('No pages selected.');
    return { pages: pages, errors: errors };
  }

  function parseSplitSpec(input, pageCount, mode, everyN) {
    var total = Math.max(1, Math.round(Number(pageCount) || 1));
    if (mode === 'every') {
      var size = Math.max(1, Math.round(Number(everyN) || 1));
      var parts = [];
      for (var start = 1; start <= total; start += size) {
        var pages = [];
        for (var p = start; p < start + size && p <= total; p++) pages.push(p);
        parts.push(pages);
      }
      return { parts: parts, errors: [] };
    }

    var groups = String(input || '').split(';');
    var partsOut = [];
    var errors = [];
    var used = new Set();
    groups.forEach(function (group, index) {
      if (!group.trim()) return;
      var parsed = parsePageSpec(group, total);
      if (!parsed.pages.length) return;
      parsed.errors.forEach(function (error) {
        errors.push('Part ' + (index + 1) + ': ' + error);
      });
      parsed.pages.forEach(function (page) {
        if (used.has(page)) errors.push('Page ' + page + ' is in more than one part.');
        used.add(page);
      });
      partsOut.push(parsed.pages);
    });
    if (!partsOut.length) errors.push('Add at least one page range.');
    return { parts: partsOut, errors: errors };
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
    computeCropRect: computeCropRect,
    anchorPoint: anchorPoint,
    ratiosClose: ratiosClose,
    parsePageSpec: parsePageSpec,
    parseSplitSpec: parseSplitSpec,
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
