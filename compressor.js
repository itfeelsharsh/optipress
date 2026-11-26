/**
 * Opti · compressor.js
 * Client-side image / HEIC / PDF pipeline. Nothing leaves the device.
 */
(function () {
  'use strict';

  function isCancelled() {
    return !!(window.optiCancelToken && window.optiCancelToken.cancelled);
  }

  function abortError() {
    var error = new Error('Cancelled');
    error.name = 'AbortError';
    return error;
  }

  function ensureActive() {
    if (isCancelled()) throw abortError();
  }

  function isTiffSource(source) {
    var name = source && source.name ? String(source.name) : '';
    var type = source && source.type ? String(source.type) : '';
    return /\.tiff?$/i.test(name) || type === 'image/tiff';
  }

  function Core() {
    return window.OptiCore;
  }

  var HEIC_MIME = 'image/heic';

  function isPdfFile(file) {
    return Core().kindOf(file) === 'pdf';
  }

  function isHeicFile(file) {
    return Core().kindOf(file) === 'heic';
  }

  function normalizeError(err) {
    var message = err && err.message ? String(err.message) : 'Unknown error';
    var name = err && err.name ? String(err.name) : '';
    if (name === 'PasswordException' || /password/i.test(message)) {
      return new Error('This PDF is password-protected. Remove the password and try again.');
    }
    if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
      return new Error('That file is not a readable PDF, or it is damaged.');
    }
    return err instanceof Error ? err : new Error(message);
  }

  class OptiEngine {
    constructor() {
      this._caps = null;
      this._pdfReady = false;
    }

    initPdfWorker() {
      if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
      }
    }

    capabilities() {
      if (this._caps) return this._caps;
      var caps = { png: true, jpeg: true, webp: false, avif: false };
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f00';
        ctx.fillRect(0, 0, 2, 2);
        var test = function (mime) {
          try {
            return canvas.toDataURL(mime).indexOf('data:' + mime) === 0;
          } catch (err) {
            return false;
          }
        };
        caps.png = test('image/png');
        caps.jpeg = test('image/jpeg');
        caps.webp = test('image/webp');
        caps.avif = test('image/avif');
      } catch (err) {
        /* keep conservative defaults */
      }
      this._caps = caps;
      return caps;
    }

    // ------------------------------------------------------------------
    // Probing (dimensions, alpha, PDF page count, thumbnails)
    // ------------------------------------------------------------------

    async probe(file) {
      var kind = Core().kindOf(file);
      if (kind === 'pdf') return this.probePdf(file);
      if (kind === 'heic') return this.probeHeic(file);
      if (kind === 'image') return this.probeImage(file);
      throw new Error('Unsupported file type.');
    }

    async probeImage(file) {
      var drawable = await this.loadDrawable(file);
      try {
        var width = drawable.width;
        var height = drawable.height;
        var hasAlpha = await this.detectAlpha(drawable.source);
        var sample = await this.makeSample(drawable.source, width, height, 640);
        return {
          kind: 'image',
          width: width,
          height: height,
          hasAlpha: hasAlpha,
          sample: sample.bitmap,
          sampleWidth: sample.width,
          sampleHeight: sample.height,
          mimeType: file.type || 'image/jpeg',
          tiffPages: drawable.pages || 1
        };
      } finally {
        drawable.close();
      }
    }

    async probeHeic(file) {
      try {
        var direct = await this.loadDrawable(file);
        var w = direct.width;
        var h = direct.height;
        var alpha = await this.detectAlpha(direct.source);
        var sample = await this.makeSample(direct.source, w, h, 640);
        direct.close();
        return {
          kind: 'heic',
          width: w,
          height: h,
          hasAlpha: alpha,
          sample: sample.bitmap,
          sampleWidth: sample.width,
          sampleHeight: sample.height,
          mimeType: 'image/jpeg',
          prepared: file
        };
      } catch (err) {
        /* browser cannot decode HEIC natively; fall through to heic2any */
      }

      var prepared = await this.convertHeic(file);
      var info = await this.probeImage(prepared);
      info.kind = 'heic';
      info.prepared = prepared;
      info.mimeType = 'image/jpeg';
      return info;
    }

    async probePdf(file) {
      this.ensurePdfLibraries();
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        throw new Error('PDF tools need the app served over http(s). Open the hosted app or run a local server.');
      }
      var bytes = new Uint8Array(await file.arrayBuffer());
      var pdf = await this.openPdf(bytes);
      var pages = pdf.numPages;
      var thumb = null;
      try {
        thumb = await this.renderPdfThumb(pdf);
      } catch (err) {
        /* thumbnail is optional */
      }
      try {
        await pdf.destroy();
      } catch (err) {
        /* noop */
      }
      return { kind: 'pdf', pages: pages, thumb: thumb };
    }

    async renderPdfThumb(pdf) {
      var page = await pdf.getPage(1);
      try {
        var base = page.getViewport({ scale: 1 });
        var scale = 220 / Math.max(base.width, base.height);
        var viewport = page.getViewport({ scale: Math.max(0.08, scale) });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(24, Math.round(viewport.width));
        canvas.height = Math.max(24, Math.round(viewport.height));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.72);
      } finally {
        try {
          page.cleanup();
        } catch (err) {
          /* noop */
        }
      }
    }

    // ------------------------------------------------------------------
    // Estimation (real sample encodes, not guesses)
    // ------------------------------------------------------------------

    async estimateImage(sample, meta, options) {
      var C = Core();
      var caps = this.capabilities();
      var dims = C.capCanvasDims(
        C.computeTargetDims(meta.width, meta.height, options).width,
        C.computeTargetDims(meta.width, meta.height, options).height,
        C.MAX_PIXELS,
        C.MAX_EDGE
      );
      var mime = C.resolveOutputMime(options.format, meta.mimeType, {
        hasAlpha: meta.hasAlpha,
        caps: caps,
        customMime: options.customMime
      });
      if (options.targetEnabled && mime === 'image/png') {
        mime = caps.webp ? 'image/webp' : 'image/jpeg';
      }

      var edge = 640;
      var factor = Math.min(1, edge / Math.max(dims.width, dims.height));
      var sw = Math.max(1, Math.round(dims.width * factor));
      var sh = Math.max(1, Math.round(dims.height * factor));
      var canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      var background = options.background || options.letterbox || 'white';
      var fillColor = mime === 'image/jpeg'
        ? (background === 'black' ? '#000000' : '#ffffff')
        : (background === 'transparent' ? null : background === 'black' ? '#000000' : '#ffffff');
      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(0, 0, sw, sh);
      }
      ctx.drawImage(sample, 0, 0, sw, sh);

      var quality = C.clampNumber(options.quality, 5, 100) / 100;
      var blob;
      try {
        blob = await this.canvasToBlob(canvas, mime, quality);
      } catch (err) {
        return null;
      }

      var bytes = C.estimateFromSample(blob.size, sw * sh, dims.width * dims.height);
      if (options.targetEnabled) {
        var target = C.kbToBytes(options.targetKB);
        if (target > 0) {
          bytes = options.targetMode === 'exact' ? target : Math.min(bytes, Math.round(target * 0.98));
        }
      }
      return { bytes: bytes, mimeType: mime, width: dims.width, height: dims.height };
    }

    estimatePdf(file, options, meta) {
      if (options.pdfMode === 'structure') {
        return Math.max(1024, Math.round(file.size * 0.98));
      }
      var pages = meta && meta.pages ? meta.pages : 1;
      var dpi = Core().clampNumber(options.pdfDpi, 72, 300);
      var quality = Core().clampNumber(options.quality, 5, 100);
      var bytesPerPixel = 0.12 * Math.pow(quality / 78, 2.1);
      var pagePixels = 612 * 792 * Math.pow(dpi / 72, 2);
      var estimate = pages * pagePixels * bytesPerPixel;
      estimate = Math.max(pages * 9000, Math.min(estimate, file.size));
      if (options.pdfTargetBytes) estimate = Math.min(estimate, Number(options.pdfTargetBytes));
      return Math.round(estimate);
    }

    // ------------------------------------------------------------------
    // Compression dispatcher
    // ------------------------------------------------------------------

    async compress(file, options, onProgress, meta) {
      ensureActive();
      var info = meta || {};
      var kind = info.kind || Core().kindOf(file);
      var progress = typeof onProgress === 'function' ? onProgress : function () {};

      if (kind === 'pdf') {
        return this.compressPdf(file, options, progress);
      }
      if (kind === 'heic') {
        return this.compressHeic(file, options, progress, info);
      }
      return this.compressImage(file, options, progress, info);
    }

    async compressHeic(file, options, onProgress, meta) {
      ensureActive();
      onProgress(6, 'Converting HEIC');
      var prepared = meta && meta.prepared ? meta.prepared : null;
      if (!prepared) prepared = await this.convertHeic(file);
      var result = await this.compressImage(prepared, options, onProgress, {
        originalName: (meta && meta.originalName) || file.name,
        mimeType: 'image/jpeg',
        prepared: true
      });
      result.convertedFrom = 'HEIC';
      result.note = [result.note, 'Converted from HEIC.'].filter(Boolean).join(' ');
      return result;
    }

    async compressImage(file, options, onProgress, meta) {
      ensureActive();
      var C = Core();
      var caps = this.capabilities();
      var originalName = (meta && meta.originalName) || file.name;
      var notes = [];

      onProgress(4, 'Reading image');
      var drawable = await this.loadDrawable(file);
      var canvas = null;

      try {
        ensureActive();
        var srcW = drawable.width;
        var srcH = drawable.height;
        if ((meta && meta.tiffPages > 1) || drawable.pages > 1) {
          notes.push('Multi-page TIFF: only the first page was processed.');
        }
        var hasAlpha = await this.detectAlpha(drawable.source);

        var requested = C.computeTargetDims(srcW, srcH, options);
        var dims = C.capCanvasDims(requested.width, requested.height, C.MAX_PIXELS, C.MAX_EDGE);
        if (dims.scaled) notes.push('Resized to ' + dims.width + '×' + dims.height + ' to stay within browser canvas limits.');

        var inputMime = (meta && meta.mimeType) || file.type || 'image/jpeg';
        var mime = C.resolveOutputMime(options.format, inputMime, {
          hasAlpha: hasAlpha,
          caps: caps,
          customMime: options.customMime
        });

        var targetBytes = options.targetEnabled ? C.kbToBytes(options.targetKB) : 0;
        var targetMissed = false;
        if (targetBytes && mime === 'image/png') {
          mime = caps.webp ? 'image/webp' : 'image/jpeg';
          notes.push('PNG cannot meet a size target losslessly — encoded as ' + (mime === 'image/webp' ? 'WebP' : 'JPEG') + '.');
        }

        var background = options.background || options.letterbox || 'white';
        var flatten = mime === 'image/jpeg';
        var matte = flatten
          ? (background === 'black' ? '#000000' : '#ffffff')
          : (background === 'transparent' ? null : background === 'black' ? '#000000' : '#ffffff');

        ensureActive();
        if (options.cropRect) {
          var region = C.normalizeCropRect(options.cropRect);
          if (region) {
            var cropX = Math.max(0, Math.round(region.x * srcW));
            var cropY = Math.max(0, Math.round(region.y * srcH));
            var cropW = Math.max(1, Math.min(srcW - cropX, Math.round(region.w * srcW)));
            var cropH = Math.max(1, Math.min(srcH - cropY, Math.round(region.h * srcH)));
            var regionCanvas = document.createElement('canvas');
            regionCanvas.width = cropW;
            regionCanvas.height = cropH;
            var regionCtx = regionCanvas.getContext('2d');
            regionCtx.imageSmoothingEnabled = true;
            regionCtx.imageSmoothingQuality = 'high';
            regionCtx.drawImage(drawable.source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            drawable.source = regionCanvas;
            srcW = cropW;
            srcH = cropH;
            notes.push('Cropped a freeform area of ' + cropW + '×' + cropH + ' px from the original.');
          }
        }
        onProgress(16, 'Rendering pixels');
        var geom = C.computeCropRect(srcW, srcH, dims.width, dims.height, options.fitMode, options.anchor);
        canvas = this.renderCanvas(drawable.source, srcW, srcH, dims.width, dims.height, {
          fitMode: options.fitMode,
          anchor: options.anchor,
          background: matte
        });
        if (options.scanMode && options.scanMode !== 'off') {
          canvas = this.applyScanCleanup(canvas, options.scanMode);
          notes.push('Scan cleanup: ' + options.scanMode + '.');
        }

        if (options.fitMode === 'fill' && !C.ratiosClose(srcW, srcH, dims.width, dims.height, 0.005)) {
          notes.push('Cropped to fill ' + dims.width + '×' + dims.height + ' (' + (options.anchor || 'center') + ').');
        } else if (!geom.covers) {
          notes.push('Fitted inside ' + dims.width + '×' + dims.height + ' on a ' + background + ' background.');
        }
        if (flatten && hasAlpha) {
          notes.push('Transparency flattened onto ' + (background === 'black' ? 'black' : 'white') + '.');
        }
        if (file.type === 'image/gif') notes.push('Animated GIFs are flattened to a single frame.');
        if (file.type === 'image/svg+xml') notes.push('SVG artwork is rasterised to pixels.');

        ensureActive();
        onProgress(40, 'Encoding');
        var quality = C.clampNumber(options.quality, 5, 100) / 100;
        var blob;
        var finalWidth = dims.width;
        var finalHeight = dims.height;
        var qualityUsed = quality;

        if (targetBytes) {
          var match = await this.fitToTarget(canvas, mime, targetBytes, quality, onProgress);
          blob = match.blob;
          qualityUsed = match.quality;
          finalWidth = match.width;
          finalHeight = match.height;
          targetMissed = match.missed;
          if (match.resized) {
            notes.push('Downscaled to ' + match.width + '×' + match.height + ' to reach the target size.');
            canvas = match.canvas || canvas;
          }
          if (match.missed) {
            notes.push('Could not reach ' + C.formatBytes(targetBytes) + ' without destroying the image — closest match kept.');
          }
        } else {
          blob = await this.canvasToBlob(canvas, mime, quality);
        }

        // Custom MIME: browsers silently fall back to PNG for types they cannot encode.
        if (options.format === 'custom') {
          if (!blob || blob.type !== mime) {
            throw new Error('This browser cannot encode ' + mime + '. Pick WebP or JPEG instead.');
          }
        }

        ensureActive();
        var paddedBytes = 0;
        if (targetBytes && options.targetMode === 'exact' && !targetMissed && blob.size < targetBytes) {
          var original = new Uint8Array(await blob.arrayBuffer());
          var padded = window.OptiPadding.padBytes(original, mime, targetBytes);
          if (padded.bytes.length === targetBytes) {
            paddedBytes = targetBytes - original.length;
            blob = new Blob([padded.bytes], { type: mime });
            notes.push('Padded with harmless metadata to hit ' + C.formatBytes(targetBytes) + ' exactly.');
            if (!padded.supported) notes.push('Padding uses trailing bytes; strict validators may object.');
          }
        }

        var resized = finalWidth !== srcW || finalHeight !== srcH;
        var formatChosen = options.format === 'auto' || options.format === 'original';
        var usedOriginal = false;
        var outMime = mime;
        var outBlob = blob;

        if (!targetBytes && formatChosen && !resized && blob.size >= file.size && !(meta && meta.prepared)) {
          usedOriginal = true;
          outBlob = file;
          outMime = file.type || mime;
          notes.push('The original was already smaller — kept it untouched.');
        }

        onProgress(100, usedOriginal ? 'Already optimal' : 'Squeezed');
        return {
          blob: outBlob,
          fileName: C.outputFileName(originalName, usedOriginal ? (file.type || mime) : mime),
          mimeType: outMime,
          width: finalWidth,
          height: finalHeight,
          qualityUsed: qualityUsed,
          letterboxed: !geom.covers && options.fitMode !== 'fill',
          letterboxColor: !geom.covers ? background : null,
          cropped: options.fitMode === 'fill' && !C.ratiosClose(srcW, srcH, dims.width, dims.height, 0.005),
          usedOriginal: usedOriginal,
          targetBytes: targetBytes || null,
          targetMissed: targetMissed,
          targetMode: options.targetMode,
          paddedBytes: paddedBytes,
          exactSize: targetBytes ? outBlob.size === targetBytes : false,
          note: notes.join(' ')
        };
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        drawable.close();
      }
    }

    async fitToTarget(canvas, mime, targetBytes, maxQuality, onProgress) {
      var C = Core();
      var minQuality = 0.15;
      var cap = Math.max(minQuality, Math.min(1, maxQuality));
      var work = canvas;
      var width = canvas.width;
      var height = canvas.height;
      var best = null;

      for (var round = 0; round < 4; round++) {
        ensureActive();
        var search = await this.searchQuality(work, mime, targetBytes, cap, round === 0 ? 7 : 4, onProgress, round);
        if (search.ok) {
          return {
            blob: search.blob,
            quality: search.quality,
            width: width,
            height: height,
            resized: round > 0,
            missed: false,
            canvas: work
          };
        }
        var candidate = {
          blob: search.blob,
          quality: search.quality,
          width: width,
          height: height,
          canvas: work,
          missed: true
        };
        if (!best || candidate.blob.size < best.blob.size) best = candidate;

        if (width <= C.MIN_EDGE * 2 || height <= C.MIN_EDGE * 2) break;
        var factor = Math.sqrt(targetBytes / search.blob.size) * 0.9;
        if (!isFinite(factor) || factor >= 0.98) break;
        var nextW = Math.max(C.MIN_EDGE, Math.round(width * factor));
        var nextH = Math.max(C.MIN_EDGE, Math.round(height * factor));
        if (nextW >= width && nextH >= height) break;

        work = this.resizeCanvas(work, nextW, nextH);
        width = nextW;
        height = nextH;
        onProgress(62 + round * 6, 'Downscaling to fit');
      }

      return {
        blob: best.blob,
        quality: best.quality,
        width: best.width,
        height: best.height,
        resized: true,
        missed: true,
        canvas: best.canvas
      };
    }

    async searchQuality(canvas, mime, targetBytes, capQuality, iterations, onProgress, round) {
      var lo = 0.12;
      var hi = Math.max(lo, capQuality);
      var best = null;
      var bestQ = lo;
      var smallest = null;

      for (var i = 0; i < iterations; i++) {
        ensureActive();
        var quality = (lo + hi) / 2;
        var blob = await this.canvasToBlob(canvas, mime, quality);
        if (!smallest || blob.size < smallest.size) {
          smallest = { blob: blob, quality: quality };
        }
        if (typeof onProgress === 'function') {
          onProgress(48 + (round || 0) * 6 + i * 2, 'Matching target size');
        }
        if (blob.size <= targetBytes) {
          best = { blob: blob, quality: quality };
          bestQ = quality;
          lo = quality;
          if (blob.size >= targetBytes * 0.92) break;
        } else {
          hi = quality;
        }
      }

      return {
        ok: !!best,
        blob: best ? best.blob : smallest.blob,
        quality: best ? bestQ : smallest.quality
      };
    }

    // ------------------------------------------------------------------
    // PDF
    // ------------------------------------------------------------------

    async compressPdf(file, options, onProgress) {
      ensureActive();
      var C = Core();
      this.ensurePdfLibraries();
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        throw new Error('PDF tools need the app served over http(s). Open the hosted app or run a local server.');
      }

      var bytes = new Uint8Array(await file.arrayBuffer());
      onProgress(6, 'Reading PDF');

      if (options.pdfMode === 'structure') {
        return this.compressPdfStructure(file, bytes, onProgress);
      }
      return this.compressPdfRaster(file, bytes, options, onProgress);
    }

    async compressPdfStructure(file, bytes, onProgress) {
      ensureActive();
      var C = Core();
      onProgress(25, 'Rebuilding document');
      var doc;
      try {
        doc = await window.PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (err) {
        throw normalizeError(err);
      }
      onProgress(70, 'Writing compressed PDF');
      ensureActive();
      var out = await doc.save({ useObjectStreams: true, addDefaultPage: false });

      if (out.byteLength >= file.size) {
        return {
          blob: file,
          fileName: C.outputFileName(file.name, 'application/pdf'),
          mimeType: 'application/pdf',
          usedOriginal: true,
          note: 'This PDF is already tightly packed — the original was kept.'
        };
      }

      onProgress(100, 'Squeezed');
      return {
        blob: new Blob([out], { type: 'application/pdf' }),
        fileName: C.outputFileName(file.name, 'application/pdf'),
        mimeType: 'application/pdf',
        usedOriginal: false,
        note: 'Text stays selectable in this mode.'
      };
    }

    async compressPdfRaster(file, bytes, options, onProgress) {
      var C = Core();
      var pdf = await this.openPdf(bytes);
      var pages = pdf.numPages;
      var baseDpi = Number(options.pdfDpi) || 150;
      var baseQuality = C.clampNumber(options.quality, 5, 100) / 100;
      var targetBytes = Number(options.pdfTargetBytes) || 0;
      var scanMode = options.scanMode || 'off';
      var notes = [];

      if (pages > 150) {
        try {
          await pdf.destroy();
        } catch (err) {
          /* noop */
        }
        throw new Error('This PDF has ' + pages + ' pages. Split it, or switch the PDF engine to “Keep text” and retry.');
      }

      var attempts = targetBytes
        ? [
            { dpi: baseDpi, quality: baseQuality },
            { dpi: baseDpi, quality: Math.max(0.2, baseQuality * 0.72) },
            { dpi: Math.max(72, Math.round(baseDpi * 0.82)), quality: Math.max(0.18, baseQuality * 0.55) },
            { dpi: Math.max(72, Math.round(baseDpi * 0.66)), quality: Math.max(0.15, baseQuality * 0.4) },
            { dpi: 72, quality: 0.3 }
          ]
        : [{ dpi: baseDpi, quality: baseQuality }];

      var best = null;
      var bestAttempt = null;

      try {
        for (var attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
          ensureActive();
          var attempt = attempts[attemptIndex];
          var newPdf = await window.PDFLib.PDFDocument.create();

          for (var i = 1; i <= pages; i++) {
            ensureActive();
            var slice = 76 / attempts.length;
            var percent = 8 + attemptIndex * slice + ((i - 1) / pages) * slice;
            onProgress(
              Math.round(percent),
              'Rendering page ' + i + ' of ' + pages + (attempts.length > 1 ? ' · pass ' + (attemptIndex + 1) : '')
            );
            var page = await pdf.getPage(i);
            try {
              var base = page.getViewport({ scale: 1 });
              var scale = attempt.dpi / 72;
              var desiredW = base.width * scale;
              var desiredH = base.height * scale;
              var capped = C.capCanvasDims(desiredW, desiredH, 24 * 1000 * 1000, 10000);
              var viewport = page.getViewport({ scale: scale * (capped.width / desiredW) });

              var canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(viewport.width));
              canvas.height = Math.max(1, Math.round(viewport.height));
              var ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              await page.render({ canvasContext: ctx, viewport: viewport }).promise;

              if (scanMode !== 'off') this.applyScanCleanup(canvas, scanMode);

              var jpeg = await this.canvasToBlob(canvas, 'image/jpeg', attempt.quality);
              var jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
              var image = await newPdf.embedJpg(jpegBytes);
              var outPage = newPdf.addPage([base.width, base.height]);
              outPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });

              canvas.width = 0;
              canvas.height = 0;
              page.cleanup();
            } catch (err) {
              page.cleanup();
              throw err;
            }
            await new Promise(function (resolve) {
              setTimeout(resolve, 0);
            });
          }

          ensureActive();
          onProgress(86, 'Writing PDF');
          var pdfBytes = await newPdf.save({ useObjectStreams: true });
          var blob = new Blob([pdfBytes], { type: 'application/pdf' });
          if (!best || blob.size < best.blob.size) {
            best = { blob: blob, dpi: attempt.dpi, quality: attempt.quality };
            bestAttempt = attemptIndex;
          }
          if (!targetBytes || blob.size <= targetBytes) break;
          if (attemptIndex < attempts.length - 1) {
            onProgress(88, 'Still over target — trying a smaller pass');
          }
        }
      } finally {
        try {
          await pdf.destroy();
        } catch (err) {
          /* noop */
        }
      }

      if (!best) throw new Error('Could not rebuild this PDF.');

      if (targetBytes && file.size <= targetBytes && file.size <= best.blob.size) {
        onProgress(100, 'Already under target');
        return {
          blob: file,
          fileName: C.outputFileName(file.name, 'application/pdf'),
          mimeType: 'application/pdf',
          usedOriginal: true,
          note: 'Already under ' + C.formatBytes(targetBytes) + ' — original kept.'
        };
      }

      if (!targetBytes && best.blob.size >= file.size) {
        onProgress(100, 'Already optimal');
        return {
          blob: file,
          fileName: C.outputFileName(file.name, 'application/pdf'),
          mimeType: 'application/pdf',
          usedOriginal: true,
          note: 'Rasterizing made the file larger, so the original was kept.'
        };
      }

      if (targetBytes) {
        if (best.blob.size <= targetBytes) {
          notes.push('Fit under ' + C.formatBytes(targetBytes) + '.');
        } else {
          notes.push('Could not get under ' + C.formatBytes(targetBytes) + ' — closest was ' + C.formatBytes(best.blob.size) + '.');
        }
      }
      if (scanMode !== 'off') notes.push('Scan cleanup: ' + scanMode + '.');
      notes.push('Pages are flattened images — text is no longer selectable.');
      onProgress(100, targetBytes && best.blob.size <= targetBytes ? 'Under target' : 'Squeezed');
      return {
        blob: best.blob,
        fileName: C.outputFileName(file.name, 'application/pdf'),
        mimeType: 'application/pdf',
        usedOriginal: false,
        targetMissed: !!(targetBytes && best.blob.size > targetBytes),
        note: notes.join(' ')
      };
    }

    openPdf(data) {
      var self = this;
      this.initPdfWorker();
      return window.pdfjsLib.getDocument({ data: data }).promise.then(
        function (pdf) {
          return pdf;
        },
        function (err) {
          throw normalizeError(err);
        }
      );
    }

    ensurePdfLibraries() {
      if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Reload the page and try again.');
      if (!window.PDFLib) throw new Error('The PDF writer did not load. Reload the page and try again.');
    }

    // ------------------------------------------------------------------
    // Drawing helpers
    // ------------------------------------------------------------------

    loadDrawable(source) {
      var self = this;
      var tiff = isTiffSource(source);
      if (typeof createImageBitmap === 'function') {
        return createImageBitmap(source).then(
          function (bitmap) {
            return {
              source: bitmap,
              width: bitmap.width,
              height: bitmap.height,
              close: function () {
                if (bitmap.close) bitmap.close();
              }
            };
          },
          function () {
            if (tiff) return self.loadTiffDrawable(source);
            return loadViaImageElement(source);
          }
        );
      }
      if (tiff) return this.loadTiffDrawable(source);
      return loadViaImageElement(source);
    }

    loadTiffDrawable(source) {
      return source.arrayBuffer().then(function (buffer) {
        if (!window.UTIF) throw new Error('TIFF support did not load. Reload the page and try again.');
        var ifds = window.UTIF.decode(buffer);
        if (!ifds.length) throw new Error('This TIFF contains no readable image.');
        var first = ifds[0];
        window.UTIF.decodeImage(buffer, first);
        var rgba = window.UTIF.toRGBA8(first);
        var canvas = document.createElement('canvas');
        canvas.width = first.width;
        canvas.height = first.height;
        var ctx = canvas.getContext('2d');
        var imageData = ctx.createImageData(first.width, first.height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);
        return {
          source: canvas,
          width: first.width,
          height: first.height,
          pages: ifds.length,
          close: function () {
            canvas.width = 0;
            canvas.height = 0;
          }
        };
      });
    }

    applyScanCleanup(canvas, mode) {
      if (!mode || mode === 'off' || !canvas) return canvas;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var width = canvas.width;
      var height = canvas.height;
      if (!width || !height) return canvas;
      var image = ctx.getImageData(0, 0, width, height);
      var data = image.data;
      var total = width * height;
      var luma = new Uint8ClampedArray(total);
      var histogram = new Uint32Array(256);
      var i;
      var p;
      for (i = 0, p = 0; i < data.length; i += 4, p++) {
        var value = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        luma[p] = value;
        histogram[value | 0]++;
      }
      if (mode === 'bw') {
        for (i = 0, p = 0; i < data.length; i += 4, p++) {
          var bw = luma[p] > 150 ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = bw;
        }
      } else if (mode === 'contrast') {
        var lo = 0;
        var hi = 255;
        var acc = 0;
        var threshold = total * 0.02;
        for (i = 0; i < 256; i++) {
          acc += histogram[i];
          if (acc > threshold) {
            lo = i;
            break;
          }
        }
        acc = 0;
        for (i = 255; i >= 0; i--) {
          acc += histogram[i];
          if (acc > threshold) {
            hi = i;
            break;
          }
        }
        if (hi <= lo) {
          lo = 0;
          hi = 255;
        }
        var span = hi - lo || 1;
        for (i = 0, p = 0; i < data.length; i += 4, p++) {
          var stretched = ((luma[p] - lo) / span) * 255;
          stretched = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
          data[i] = data[i + 1] = data[i + 2] = stretched;
        }
      } else {
        for (i = 0, p = 0; i < data.length; i += 4, p++) {
          data[i] = data[i + 1] = data[i + 2] = luma[p];
        }
      }
      ctx.putImageData(image, 0, 0);
      return canvas;
    }

    renderCanvas(source, srcW, srcH, dstW, dstH, options) {
      var C = Core();
      var opts = options || {};
      var canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, dstW, dstH);
      }

      var geom = C.computeCropRect(srcW, srcH, dstW, dstH, opts.fitMode, opts.anchor);
      if (geom.mode === 'fill') {
        var tempW = Math.min(Math.round(geom.sWidth), Math.max(1, dstW * 2));
        var tempH = Math.min(Math.round(geom.sHeight), Math.max(1, dstH * 2));
        var scale = Math.min(tempW / geom.sWidth, tempH / geom.sHeight);
        var crop = document.createElement('canvas');
        crop.width = Math.max(1, Math.round(geom.sWidth * scale));
        crop.height = Math.max(1, Math.round(geom.sHeight * scale));
        var cropCtx = crop.getContext('2d');
        cropCtx.imageSmoothingEnabled = true;
        cropCtx.imageSmoothingQuality = 'high';
        cropCtx.drawImage(source, geom.sx, geom.sy, geom.sWidth, geom.sHeight, 0, 0, crop.width, crop.height);
        ctx.drawImage(crop, 0, 0, crop.width, crop.height, 0, 0, dstW, dstH);
        crop.width = 0;
        crop.height = 0;
        return canvas;
      }

      var prepared = this.downscaleSource(source, srcW, srcH, geom.dWidth, geom.dHeight);
      ctx.drawImage(prepared.source, 0, 0, prepared.width, prepared.height, geom.dx, geom.dy, geom.dWidth, geom.dHeight);
      if (prepared.dispose) prepared.dispose();
      return canvas;
    }

    /** Halve large sources repeatedly so 6000px → 800px stays crisp instead of aliased. */
    downscaleSource(source, width, height, targetW, targetH) {
      var current = source;
      var cw = width;
      var ch = height;
      var disposable = null;

      while (cw > targetW * 2 && ch > targetH * 2) {
        var nw = Math.max(targetW, Math.round(cw / 2));
        var nh = Math.max(targetH, Math.round(ch / 2));
        var step = document.createElement('canvas');
        step.width = nw;
        step.height = nh;
        var g = step.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(current, 0, 0, cw, ch, 0, 0, nw, nh);
        if (disposable) {
          disposable.width = 0;
          disposable.height = 0;
        }
        disposable = step;
        current = step;
        cw = nw;
        ch = nh;
      }

      var dispose = function () {
        if (disposable) {
          disposable.width = 0;
          disposable.height = 0;
        }
      };
      return { source: current, width: cw, height: ch, dispose: dispose };
    }

    resizeCanvas(sourceCanvas, width, height) {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
      return canvas;
    }

    async makeSample(source, width, height, edge) {
      var factor = Math.min(1, edge / Math.max(width, height));
      var sw = Math.max(1, Math.round(width * factor));
      var sh = Math.max(1, Math.round(height * factor));
      if (typeof createImageBitmap === 'function') {
        try {
          var bitmap = await createImageBitmap(source, {
            resizeWidth: sw,
            resizeHeight: sh,
            resizeQuality: 'medium'
          });
          return { bitmap: bitmap, width: sw, height: sh };
        } catch (err) {
          /* fall through to canvas */
        }
      }
      var canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(source, 0, 0, sw, sh);
      var fallback = await createImageBitmap(canvas);
      return { bitmap: fallback, width: sw, height: sh };
    }

    async detectAlpha(source) {
      try {
        var size = 48;
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(source, 0, 0, size, size);
        var data = ctx.getImageData(0, 0, size, size).data;
        for (var i = 3; i < data.length; i += 4) {
          if (data[i] < 250) return true;
        }
      } catch (err) {
        return true; // unknown: assume alpha so we never black-out a PNG
      }
      return false;
    }

    canvasToBlob(canvas, mimeType, quality) {
      return new Promise(function (resolve, reject) {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob(
            function (blob) {
              if (blob) resolve(blob);
              else reject(new Error('This browser could not encode ' + mimeType + '.'));
            },
            mimeType,
            quality
          );
          return;
        }
        try {
          var dataUrl = canvas.toDataURL(mimeType, quality);
          resolve(dataUrlToBlob(dataUrl));
        } catch (err) {
          reject(err);
        }
      });
    }

    supportsType(mime) {
      if (!mime || mime === 'auto' || mime === 'original') return true;
      var cache = this._typeSupport || (this._typeSupport = {});
      if (cache[mime] !== undefined) return cache[mime];
      var ok = false;
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        canvas.getContext('2d').fillRect(0, 0, 2, 2);
        ok = canvas.toDataURL(mime).indexOf('data:' + mime) === 0;
      } catch (err) {
        ok = false;
      }
      cache[mime] = ok;
      return ok;
    }

    async prepareForPdf(file, options) {
      ensureActive();
      var C = Core();
      var opts = options || {};
      var drawable = await this.loadDrawable(file);
      try {
        var dims = C.capCanvasDims(drawable.width, drawable.height, 16 * 1000 * 1000, 5000);
        var hasAlpha = await this.detectAlpha(drawable.source);
        var mime = hasAlpha ? 'image/png' : 'image/jpeg';
        var canvas = this.renderCanvas(drawable.source, drawable.width, drawable.height, dims.width, dims.height, {
          fitMode: 'fit',
          anchor: 'center',
          background: hasAlpha ? null : '#ffffff'
        });
        var blob = await this.canvasToBlob(canvas, mime, hasAlpha ? undefined : 0.9);
        canvas.width = 0;
        canvas.height = 0;
        return { blob: blob, mimeType: mime, width: dims.width, height: dims.height };
      } finally {
        drawable.close();
      }
    }

    async convertHeic(file) {
      if (!window.heic2any) {
        throw new Error('This browser cannot open HEIC files. Convert to JPEG, or try Safari.');
      }
      var converted = await window.heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.94,
        multiple: false
      });
      var blob = Array.isArray(converted) ? converted[0] : converted;
      if (!blob) throw new Error('Could not convert this HEIC image.');
      var name = file.name.replace(/\.(heic|heif)$/i, '.jpg');
      return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
    }
  }

  function loadViaImageElement(source) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(source);
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          close: function () {}
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('This image could not be decoded by your browser.'));
      };
      img.src = url;
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var binary = atob(parts[1]);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  window.OptiEngine = OptiEngine;
  window.optiEngine = new OptiEngine();
})();
