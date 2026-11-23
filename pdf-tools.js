/**
 * Opti · pdf-tools.js
 * Local PDF operations built on pdf-lib (with AES-256 support) and PDF.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OptiPdfTools = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function Core() {
    return window.OptiCore;
  }
  function Lib() {
    if (!window.PDFLib) throw new Error('The PDF writer did not load. Reload the page and try again.');
    return window.PDFLib;
  }
  function PdfJs() {
    if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Reload the page and try again.');
    return window.pdfjsLib;
  }
  function Engine() {
    return window.optiEngine;
  }

  function normalizeError(err) {
    var message = err && err.message ? String(err.message) : 'Something went wrong.';
    var name = err && err.name ? String(err.name) : '';
    if (name === 'PasswordException' || name === 'EncryptedPDFError' || /encrypted|password/i.test(message)) {
      return new Error('This PDF is password-protected. Remove its password first, or enter the password in Remove password.');
    }
    if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
      return new Error('That file is not a readable PDF, or it is damaged.');
    }
    return err instanceof Error ? err : new Error(message);
  }

  function isPdf(file) {
    return Core().kindOf(file) === 'pdf';
  }

  function downloadName(original, suffix) {
    var base = Core().sanitizeBase(Core().baseName(original || 'document'));
    return base + '-' + suffix + '.pdf';
  }

  function ensurePageList(pages, total) {
    if (!pages || !pages.length) throw new Error('Select at least one page.');
    pages.forEach(function (page) {
      if (page < 1 || page > total) throw new Error('Page ' + page + ' is outside 1–' + total + '.');
    });
  }

  function hexToRgb(hex) {
    var value = String(hex || '#666666').replace('#', '');
    if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(value, 16);
    if (!isFinite(n)) return { r: 0.4, g: 0.4, b: 0.4 };
    return {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255
    };
  }

  function yieldToUi() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function renderCanvasForPage(page, dpi, maxPixels) {
    var base = page.getViewport({ scale: 1 });
    var scale = dpi / 72;
    var C = Core();
    var capped = C.capCanvasDims(base.width * scale, base.height * scale, maxPixels || 24 * 1000 * 1000, 10000);
    var viewport = page.getViewport({ scale: (capped.width / base.width) });
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
      return canvas;
    });
  }

  class OptiPdf {
    async probe(file) {
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        throw new Error('PDF tools need the app served over http(s). Open the hosted app or run a local server.');
      }
      PdfJs();
      var bytes = new Uint8Array(await file.arrayBuffer());
      var pdf;
      try {
        pdf = await PdfJs().getDocument({ data: bytes }).promise;
      } catch (err) {
        throw normalizeError(err);
      }
      var pages = pdf.numPages;
      var thumb = null;
      try {
        var page = await pdf.getPage(1);
        var canvas = await renderCanvasForPage(page, 36, 4 * 1000 * 1000);
        thumb = canvas.toDataURL('image/jpeg', 0.72);
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
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

    async load(file, password) {
      Lib();
      var bytes = new Uint8Array(await file.arrayBuffer());
      try {
        if (password !== undefined && password !== null) {
          return await window.PDFLib.PDFDocument.load(bytes, { password: String(password) });
        }
        return await window.PDFLib.PDFDocument.load(bytes);
      } catch (err) {
        throw normalizeError(err);
      }
    }

    async save(doc) {
      return doc.save({ useObjectStreams: true });
    }

    blobFrom(bytes) {
      return new Blob([bytes], { type: 'application/pdf' });
    }

    async merge(files, onProgress) {
      var self = this;
      Lib();
      var progress = onProgress || function () {};
      var out = await window.PDFLib.PDFDocument.create();
      for (var i = 0; i < files.length; i++) {
        progress(Math.round((i / files.length) * 80), 'Reading ' + files[i].name);
        var doc = await this.load(files[i]);
        var copied = await out.copyPages(doc, doc.getPageIndices());
        copied.forEach(function (page) {
          out.addPage(page);
        });
        await yieldToUi();
      }
      progress(90, 'Writing PDF');
      var bytes = await this.save(out);
      progress(100, 'Merged');
      return {
        blob: this.blobFrom(bytes),
        fileName: 'opti-merged.pdf',
        pages: out.getPageCount()
      };
    }

    async extract(file, pages, onProgress) {
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var total = doc.getPageCount();
      ensurePageList(pages, total);
      progress(30, 'Copying pages');
      var out = await window.PDFLib.PDFDocument.create();
      var copied = await out.copyPages(doc, pages.map(function (page) { return page - 1; }));
      copied.forEach(function (page) { out.addPage(page); });
      progress(75, 'Writing PDF');
      var bytes = await this.save(out);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'extracted'),
        pages: out.getPageCount()
      };
    }

    async deletePages(file, pages, onProgress) {
      var doc = await this.load(file);
      var total = doc.getPageCount();
      var remove = new Set(pages);
      var keep = [];
      for (var i = 1; i <= total; i++) if (!remove.has(i)) keep.push(i);
      if (!keep.length) throw new Error('You cannot delete every page.');
      var result = await this.extract(file, keep, onProgress);
      result.fileName = downloadName(file.name, 'trimmed');
      return result;
    }

    async reorder(file, order, onProgress) {
      var doc = await this.load(file);
      if (order.length !== doc.getPageCount()) {
        throw new Error('Include every page exactly once (' + order.length + ' of ' + doc.getPageCount() + ').');
      }
      ensurePageList(order, doc.getPageCount());
      var progress = onProgress || function () {};
      progress(30, 'Reordering');
      var out = await window.PDFLib.PDFDocument.create();
      var copied = await out.copyPages(doc, order.map(function (page) { return page - 1; }));
      copied.forEach(function (page) { out.addPage(page); });
      progress(75, 'Writing PDF');
      var bytes = await this.save(out);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'reordered'),
        pages: out.getPageCount()
      };
    }

    async rotate(file, pages, angle, onProgress) {
      var doc = await this.load(file);
      var total = doc.getPageCount();
      var selected = pages && pages.length ? new Set(pages) : null;
      var progress = onProgress || function () {};
      progress(30, 'Rotating pages');
      doc.getPages().forEach(function (page, index) {
        if (selected && !selected.has(index + 1)) return;
        var current = page.getRotation().angle || 0;
        page.setRotation(window.PDFLib.degrees(((current + angle) % 360 + 360) % 360));
      });
      progress(75, 'Writing PDF');
      var bytes = await this.save(doc);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'rotated'),
        pages: total
      };
    }

    async split(file, parts, onProgress) {
      var doc = await this.load(file);
      var progress = onProgress || function () {};
      var results = [];
      for (var i = 0; i < parts.length; i++) {
        ensurePageList(parts[i], doc.getPageCount());
        progress(Math.round((i / parts.length) * 85), 'Building part ' + (i + 1));
        var out = await window.PDFLib.PDFDocument.create();
        var copied = await out.copyPages(doc, parts[i].map(function (page) { return page - 1; }));
        copied.forEach(function (page) { out.addPage(page); });
        var bytes = await this.save(out);
        var base = Core().sanitizeBase(Core().baseName(file.name));
        results.push({
          blob: this.blobFrom(bytes),
          fileName: base + '-split-' + (i + 1) + '.pdf',
          pages: parts[i].length
        });
        await yieldToUi();
      }
      progress(100, 'Split');
      return results;
    }

    async imagesToPdf(files, options, onProgress) {
      var self = this;
      Lib();
      var opts = options || {};
      var progress = onProgress || function () {};
      var out = await window.PDFLib.PDFDocument.create();
      var pagePreset = opts.pageSize === 'letter'
        ? { width: 612, height: 792 }
        : { width: 595.28, height: 841.89 };
      var margin = Number(opts.margin) || 0;
      var orientation = opts.orientation || 'auto';

      for (var i = 0; i < files.length; i++) {
        progress(Math.round((i / files.length) * 88), 'Placing image ' + (i + 1));
        var prepared = await Engine().prepareForPdf(files[i]);
        var bytes = new Uint8Array(await prepared.blob.arrayBuffer());
        var image = prepared.mimeType === 'image/png'
          ? await out.embedPng(bytes)
          : await out.embedJpg(bytes);

        var pageWidth;
        var pageHeight;
        if (opts.pageSize === 'auto') {
          pageWidth = Math.max(72, prepared.width * 0.75);
          pageHeight = Math.max(72, prepared.height * 0.75);
        } else {
          var landscape = orientation === 'landscape' ||
            (orientation === 'auto' && prepared.width > prepared.height);
          pageWidth = landscape ? pagePreset.height : pagePreset.width;
          pageHeight = landscape ? pagePreset.width : pagePreset.height;
        }

        var boxWidth = Math.max(1, pageWidth - margin * 2);
        var boxHeight = Math.max(1, pageHeight - margin * 2);
        var scale = Math.min(boxWidth / prepared.width, boxHeight / prepared.height);
        var drawWidth = prepared.width * scale;
        var drawHeight = prepared.height * scale;
        var page = out.addPage([pageWidth, pageHeight]);
        page.drawImage(image, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight
        });
        await yieldToUi();
      }

      progress(92, 'Writing PDF');
      var pdfBytes = await this.save(out);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(pdfBytes),
        fileName: 'opti-images.pdf',
        pages: out.getPageCount()
      };
    }

    async pdfToImages(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var dpi = Number(opts.dpi) || 150;
      var format = opts.format === 'image/png' ? 'image/png' : 'image/jpeg';
      var quality = Core().clampNumber(opts.quality, 5, 100) / 100;
      var bytes = new Uint8Array(await file.arrayBuffer());
      var pdf;
      try {
        pdf = await PdfJs().getDocument({ data: bytes }).promise;
      } catch (err) {
        throw normalizeError(err);
      }

      var results = [];
      var base = Core().sanitizeBase(Core().baseName(file.name));
      var ext = Core().mimeExtension(format);

      try {
        for (var i = 1; i <= pdf.numPages; i++) {
          progress(Math.round(((i - 1) / pdf.numPages) * 90), 'Rendering page ' + i + ' of ' + pdf.numPages);
          var page = await pdf.getPage(i);
          var canvas = await renderCanvasForPage(page, dpi, 24 * 1000 * 1000);
          var blob = await Engine().canvasToBlob(canvas, format, format === 'image/png' ? undefined : quality);
          var pad = String(i).padStart(3, '0');
          results.push({
            blob: blob,
            fileName: base + '-page-' + pad + '.' + ext
          });
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
          await yieldToUi();
        }
      } finally {
        try {
          await pdf.destroy();
        } catch (err) {
          /* noop */
        }
      }

      progress(100, 'Done');
      return results;
    }

    async watermark(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var font = await doc.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
      var text = String(opts.text || 'DRAFT').slice(0, 80);
      var opacity = Core().clampNumber(opts.opacity, 2, 100) / 100;
      var color = hexToRgb(opts.color || '#7a7a7a');
      var angle = Number(opts.angle) || 45;

      progress(40, 'Stamping watermark');
      doc.getPages().forEach(function (page) {
        var width = page.getWidth();
        var height = page.getHeight();
        var size = Math.max(8, (Number(opts.size) || 9) / 100 * Math.min(width, height));
        var textWidth = font.widthOfTextAtSize(text, size);
        var textHeight = font.heightAtSize(size);
        var radians = (angle * Math.PI) / 180;
        var boxWidth = Math.abs(textWidth * Math.cos(radians)) + Math.abs(textHeight * Math.sin(radians));
        var boxHeight = Math.abs(textWidth * Math.sin(radians)) + Math.abs(textHeight * Math.cos(radians));
        page.drawText(text, {
          x: (width - boxWidth) / 2 + textHeight * Math.sin(radians) * 0.5,
          y: (height - boxHeight) / 2 + textHeight * Math.cos(radians) * 0.5,
          size: size,
          font: font,
          color: window.PDFLib.rgb(color.r, color.g, color.b),
          opacity: opacity,
          rotate: window.PDFLib.degrees(angle)
        });
      });

      progress(80, 'Writing PDF');
      var bytes = await this.save(doc);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'watermarked'),
        pages: doc.getPageCount()
      };
    }

    async pageNumbers(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var font = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);
      var start = Math.max(1, Math.round(Number(opts.start) || 1));
      var size = Core().clampNumber(opts.size, 6, 36);
      var position = opts.position || 'bottom-center';
      var total = doc.getPageCount();
      var format = opts.format || 'Page {n} of {total}';

      progress(40, 'Numbering pages');
      doc.getPages().forEach(function (page, index) {
        var number = start + index;
        var text = format.replace(/\{n\}/g, String(number)).replace(/\{total\}/g, String(total));
        var width = page.getWidth();
        var height = page.getHeight();
        var textWidth = font.widthOfTextAtSize(text, size);
        var x = (width - textWidth) / 2;
        var y = 24;
        if (position.indexOf('right') !== -1) x = width - textWidth - 32;
        if (position.indexOf('top') !== -1) y = height - size - 24;
        if (position.indexOf('bottom') !== -1) y = 24;
        page.drawText(text, {
          x: x,
          y: y,
          size: size,
          font: font,
          color: window.PDFLib.rgb(0.35, 0.35, 0.35)
        });
      });

      progress(80, 'Writing PDF');
      var bytes = await this.save(doc);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'numbered'),
        pages: total
      };
    }

    async addPassword(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var user = String(opts.userPassword || '');
      var owner = String(opts.ownerPassword || '') || user;
      if (user.length < 4) throw new Error('Use a password with at least 4 characters.');
      if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
        throw new Error('This browser cannot generate secure encryption keys.');
      }
      progress(40, 'Encrypting (AES-256)');
      doc.encrypt({
        userPassword: user,
        ownerPassword: owner,
        permissions: { printing: 'highResolution', copying: true, modifying: false }
      });
      progress(80, 'Writing PDF');
      var bytes = await this.save(doc);
      progress(100, 'Protected');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'protected'),
        pages: doc.getPageCount(),
        encrypted: true
      };
    }

    async removePassword(file, password, onProgress) {
      var progress = onProgress || function () {};
      var doc;
      try {
        doc = await this.load(file, password);
      } catch (err) {
        throw new Error('That password did not open this PDF.');
      }
      progress(35, 'Unlocking pages');
      var out = await window.PDFLib.PDFDocument.create();
      var copied = await out.copyPages(doc, doc.getPageIndices());
      copied.forEach(function (page) { out.addPage(page); });
      progress(75, 'Writing unlocked PDF');
      var bytes = await this.save(out);
      progress(100, 'Unlocked');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'unlocked'),
        pages: out.getPageCount()
      };
    }

    async ocr(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        throw new Error('OCR needs the app served over http(s).');
      }
      await this.ensureTesseract(progress);

      var sourceBytes = new Uint8Array(await file.arrayBuffer());
      var doc = await this.load(file);
      var ocrFont = await doc.embedFont(window.PDFLib.StandardFonts.Helvetica);
      var dpi = Number(opts.dpi) || 200;
      var pdf;
      try {
        pdf = await PdfJs().getDocument({ data: sourceBytes.slice(0) }).promise;
      } catch (err) {
        throw normalizeError(err);
      }

      progress(18, 'Loading English OCR model (first run downloads ~11 MB)');
      var worker = await window.Tesseract.createWorker('eng', 1, {
        logger: function (message) {
          if (message.status === 'recognizing text') {
            progress(18 + Math.round(message.progress * 60), 'Recognising text');
          }
        }
      });

      try {
        var pages = doc.getPages();
        for (var i = 1; i <= pdf.numPages; i++) {
          progress(18 + Math.round(((i - 1) / pdf.numPages) * 60), 'Scanning page ' + i + ' of ' + pdf.numPages);
          var page = await pdf.getPage(i);
          var canvas = await renderCanvasForPage(page, dpi, 16 * 1000 * 1000);
          var result = await worker.recognize(canvas);
          var words = collectWords(result && result.data);
          var pdfPage = pages[i - 1];
          if (pdfPage) {
            var scaleX = pdfPage.getWidth() / canvas.width;
            var scaleY = pdfPage.getHeight() / canvas.height;
            words.forEach(function (word) {
              var text = String(word.text || '').trim();
              if (!text) return;
              var box = word.bbox || {};
              var size = Math.max(2, (box.y1 - box.y0) * scaleY);
              pdfPage.drawText(text, {
                x: box.x0 * scaleX,
                y: pdfPage.getHeight() - box.y1 * scaleY,
                size: size,
                font: ocrFont,
                color: window.PDFLib.rgb(0, 0, 0),
                opacity: 0
              });
            });
          }
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
          await yieldToUi();
        }
      } finally {
        try {
          await worker.terminate();
        } catch (err) {
          /* noop */
        }
        try {
          await pdf.destroy();
        } catch (err) {
          /* noop */
        }
      }

      progress(94, 'Writing searchable PDF');
      var bytes = await this.save(doc);
      progress(100, 'Done');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'searchable'),
        pages: doc.getPageCount()
      };
    }

    async ensureTesseract(onProgress) {
      if (window.Tesseract) return;
      onProgress(8, 'Downloading OCR engine');
      await new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
        script.async = true;
        script.onload = function () { resolve(); };
        script.onerror = function () {
          reject(new Error('Could not download the OCR engine. Check your connection and try again.'));
        };
        document.head.appendChild(script);
      });
    }
  }

  function collectWords(data) {
    if (!data) return [];
    if (Array.isArray(data.words) && data.words.length) return data.words;
    var words = [];
    (data.blocks || []).forEach(function (block) {
      (block.paragraphs || []).forEach(function (paragraph) {
        (paragraph.lines || []).forEach(function (line) {
          (line.words || []).forEach(function (word) {
            words.push(word);
          });
        });
      });
    });
    return words;
  }

  window.OptiPdf = new OptiPdf();
  return OptiPdf;
});
