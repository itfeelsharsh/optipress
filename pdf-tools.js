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

  function checkCancel() {
    if (window.optiCancelToken && window.optiCancelToken.cancelled) {
      var error = new Error('Cancelled');
      error.name = 'AbortError';
      throw error;
    }
  }

  function range(total) {
    var pages = [];
    for (var i = 1; i <= total; i++) pages.push(i);
    return pages;
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
        checkCancel();
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
        checkCancel();
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
          checkCancel();
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

    async renderThumbnails(file, options, onPage) {
      var opts = options || {};
      var limit = opts.limit || 120;
      var bytes = new Uint8Array(await file.arrayBuffer());
      var pdf = await PdfJs().getDocument({ data: bytes }).promise;
      try {
        var total = pdf.numPages;
        var count = Math.min(total, limit);
        for (var i = 1; i <= count; i++) {
          if (opts.cancelled && opts.cancelled()) break;
          var page = await pdf.getPage(i);
          var base = page.getViewport({ scale: 1 });
          var scale = Math.min(2, 150 / Math.max(1, base.width));
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          var context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          page.cleanup();
          onPage(i, total, canvas);
          await yieldToUi();
        }
        return total;
      } finally {
        try { await pdf.destroy(); } catch (err) { /* noop */ }
      }
    }

    async extractText(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var bytes = new Uint8Array(await file.arrayBuffer());
      var pdf;
      try {
        pdf = await PdfJs().getDocument({ data: bytes }).promise;
      } catch (err) {
        throw normalizeError(err);
      }
      var pages = opts.pages && opts.pages.length ? opts.pages : range(pdf.numPages);
      var parts = [];
      try {
        for (var i = 0; i < pages.length; i++) {
          checkCancel();
          var pageNumber = pages[i];
          progress(Math.round((i / pages.length) * 90), 'Reading page ' + pageNumber);
          var page = await pdf.getPage(pageNumber);
          var content = await page.getTextContent();
          var text = content.items
            .map(function (item) { return item.str + (item.hasEOL ? '\n' : ' '); })
            .join('')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          parts.push('--- page ' + pageNumber + ' ---\n' + text);
          page.cleanup();
          await yieldToUi();
        }
      } finally {
        try { await pdf.destroy(); } catch (err) { /* noop */ }
      }
      progress(100, 'Done');
      var base = Core().baseName(file.name);
      return {
        blob: new Blob([parts.join('\n\n') + '\n'], { type: 'text/plain' }),
        fileName: base + '-text.txt',
        pages: pages.length,
        note: 'Digital text only. Run OCR first when the PDF is a scan.'
      };
    }

    async cleanMetadata(file, options, onProgress) {
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var Lib = window.PDFLib;
      var PDFName = Lib.PDFName;
      var removed = [];
      var info = doc.getInfoDict();
      ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'].forEach(function (key) {
        var name = PDFName.of(key);
        if (info.get(name)) {
          info.delete(name);
          removed.push(key);
        }
      });
      try {
        if (doc.catalog.get(PDFName.of('Metadata'))) {
          doc.catalog.delete(PDFName.of('Metadata'));
          removed.push('XMP');
        }
      } catch (err) {
        /* XMP is optional */
      }
      checkCancel();
      progress(70, 'Writing clean PDF');
      var bytes = await doc.save({ useObjectStreams: true, updateMetadata: false });
      progress(100, 'Clean');
      return {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        fileName: downloadName(file.name, 'clean'),
        pages: doc.getPageCount(),
        note: removed.length ? 'Removed: ' + removed.join(', ') + '.' : 'No document metadata found.',
        removed: removed
      };
    }

    async stampImage(file, imageFile, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var prepared = await Engine().prepareForPdf(imageFile);
      var imageBytes = new Uint8Array(await prepared.blob.arrayBuffer());
      var image = prepared.mimeType === 'image/png'
        ? await doc.embedPng(imageBytes)
        : await doc.embedJpg(imageBytes);
      var pages = doc.getPages();
      var selected = opts.pages && opts.pages.length ? opts.pages : pages.map(function (_, index) { return index + 1; });
      var scalePct = Core().clampNumber(opts.scale === undefined ? 20 : opts.scale, 2, 90);
      var opacity = Core().clampNumber(opts.opacity === undefined ? 100 : opts.opacity, 5, 100) / 100;
      var margin = Math.max(0, Number(opts.margin) || 24);

      selected.forEach(function (pageNumber, index) {
        checkCancel();
        progress(35 + Math.round((index / selected.length) * 45), 'Stamping page ' + pageNumber);
        var page = pages[pageNumber - 1];
        if (!page) return;
        var pageWidth = page.getWidth();
        var pageHeight = page.getHeight();
        var drawWidth = pageWidth * (scalePct / 100);
        var drawHeight = drawWidth * (prepared.height / prepared.width);
        var maxHeight = pageHeight * 0.32;
        if (drawHeight > maxHeight) {
          drawHeight = maxHeight;
          drawWidth = drawHeight * (prepared.width / prepared.height);
        }
        var x = pageWidth - drawWidth - margin;
        var y = margin;
        if (opts.position === 'bottom-left') { x = margin; y = margin; }
        else if (opts.position === 'top-left') { x = margin; y = pageHeight - drawHeight - margin; }
        else if (opts.position === 'top-right') { x = pageWidth - drawWidth - margin; y = pageHeight - drawHeight - margin; }
        else if (opts.position === 'center') { x = (pageWidth - drawWidth) / 2; y = (pageHeight - drawHeight) / 2; }
        page.drawImage(image, { x: x, y: y, width: drawWidth, height: drawHeight, opacity: opacity });
      });

      progress(86, 'Writing PDF');
      var bytes = await this.save(doc);
      progress(100, 'Stamped');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'signed'),
        pages: selected.length,
        note: 'Visual signature only — this is not a cryptographic signature.'
      };
    }

    async resizePages(file, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var source = await this.load(file);
      var out = await window.PDFLib.PDFDocument.create();
      var presets = {
        a4: [595.28, 841.89],
        letter: [612, 792]
      };
      var margin = Math.max(0, Number(opts.margin) || 0);
      var trim = Math.max(0, Number(opts.trim) || 0);
      var pages = source.getPages();

      for (var i = 0; i < pages.length; i++) {
        checkCancel();
        progress(20 + Math.round((i / pages.length) * 60), 'Rebuilding page ' + (i + 1));
        var page = pages[i];
        var srcW = page.getWidth();
        var srcH = page.getHeight();
        var effW = Math.max(1, srcW - trim * 2);
        var effH = Math.max(1, srcH - trim * 2);
        var pageSize = opts.pageSize || 'a4';
        var targetW;
        var targetH;
        if (pageSize === 'original') {
          targetW = effW;
          targetH = effH;
        } else {
          var pair = presets[pageSize] || presets.a4;
          var landscape = opts.orientation === 'landscape' || (opts.orientation !== 'portrait' && effW > effH);
          targetW = landscape ? pair[1] : pair[0];
          targetH = landscape ? pair[0] : pair[1];
        }
        var boxW = Math.max(1, targetW - margin * 2);
        var boxH = Math.max(1, targetH - margin * 2);
        var scale = Math.min(boxW / effW, boxH / effH);
        var drawW = effW * scale;
        var drawH = effH * scale;
        var x = margin + (boxW - drawW) / 2 - trim * scale;
        var y = margin + (boxH - drawH) / 2 - trim * scale;
        var embedded = await out.embedPage(page);
        var newPage = out.addPage([targetW, targetH]);
        newPage.drawPage(embedded, {
          x: x,
          y: y,
          xScale: scale,
          yScale: scale
        });
        await yieldToUi();
      }

      checkCancel();
      progress(88, 'Writing PDF');
      var bytes = await out.save({ useObjectStreams: true, updateMetadata: false });
      progress(100, 'Resized');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, pageSize === 'original' && trim > 0 ? 'trimmed' : 'resized'),
        pages: out.getPageCount(),
        note: trim > 0 ? 'Margins are hidden by the page box, not deleted from the file.' : 'Page size rebuilt; text stays selectable.'
      };
    }

    async inspectForm(file) {
      var doc = await this.load(file);
      var form = doc.getForm();
      var Lib = window.PDFLib;
      var fields = form.getFields().map(function (field) {
        var entry = { name: field.getName(), type: 'other', value: '' };
        if (field instanceof Lib.PDFTextField) {
          entry.type = 'text';
          entry.value = field.getText() || '';
        } else if (field instanceof Lib.PDFCheckBox) {
          entry.type = 'checkbox';
          entry.value = field.isChecked();
        } else if (field instanceof Lib.PDFRadioGroup) {
          entry.type = 'radio';
          entry.value = field.getSelected() || '';
          entry.options = field.getOptions();
        } else if (field instanceof Lib.PDFDropdown || field instanceof Lib.PDFOptionList) {
          entry.type = 'choice';
          var selected = field.getSelected();
          entry.value = selected && selected.length ? selected[0] : '';
          entry.options = field.getOptions();
        }
        return entry;
      });
      return { fields: fields };
    }

    async fillForm(file, values, options, onProgress) {
      var opts = options || {};
      var progress = onProgress || function () {};
      var doc = await this.load(file);
      var form = doc.getForm();
      var Lib = window.PDFLib;
      var fields = form.getFields();
      var applied = 0;

      fields.forEach(function (field) {
        checkCancel();
        var name = field.getName();
        if (!Object.prototype.hasOwnProperty.call(values, name)) return;
        var value = values[name];
        if (field instanceof Lib.PDFTextField) {
          field.setText(value === undefined || value === null ? '' : String(value));
          applied++;
        } else if (field instanceof Lib.PDFCheckBox) {
          if (value) field.check(); else field.uncheck();
          applied++;
        } else if (field instanceof Lib.PDFRadioGroup) {
          if (value) { field.select(String(value)); applied++; }
        } else if (field instanceof Lib.PDFDropdown || field instanceof Lib.PDFOptionList) {
          if (value) { field.select(String(value)); applied++; }
        }
      });

      progress(60, 'Writing filled PDF');
      var flattened = false;
      if (opts.flatten) {
        try {
          form.flatten();
          flattened = true;
        } catch (err) {
          /* some forms cannot flatten; keep them editable */
        }
      }
      checkCancel();
      var bytes = await doc.save({ useObjectStreams: true, updateMetadata: false });
      progress(100, 'Filled');
      return {
        blob: this.blobFrom(bytes),
        fileName: downloadName(file.name, 'filled'),
        pages: doc.getPageCount(),
        note: applied + ' field' + (applied === 1 ? '' : 's') + ' filled' + (flattened ? ' and flattened.' : '.')
      };
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
      var scanMode = opts.scanMode || 'off';
      var pdf;
      try {
        pdf = await PdfJs().getDocument({ data: sourceBytes.slice(0) }).promise;
      } catch (err) {
        throw normalizeError(err);
      }

      progress(18, 'Loading bundled English OCR model');
      var base = new URL('./lib/ocr/', window.location.href).href;
      var worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core/tesseract-core-simd-lstm.wasm.js',
        langPath: base + 'lang',
        workerBlobURL: false,
        gzip: true,
        logger: function (message) {
          if (message.status === 'recognizing text') {
            progress(18 + Math.round(message.progress * 60), 'Recognising text');
          }
        }
      });

      try {
        var pages = doc.getPages();
        var targetPages = opts.pages && opts.pages.length ? opts.pages : range(pdf.numPages);
        for (var i = 0; i < targetPages.length; i++) {
          checkCancel();
          var pageNumber = targetPages[i];
          progress(18 + Math.round((i / targetPages.length) * 60), 'Scanning page ' + pageNumber + ' of ' + pdf.numPages);
          var page = await pdf.getPage(pageNumber);
          var canvas = await renderCanvasForPage(page, dpi, 16 * 1000 * 1000);
          if (scanMode !== 'off') Engine().applyScanCleanup(canvas, scanMode);
          var result = await worker.recognize(canvas);
          checkCancel();
          var words = collectWords(result && result.data);
          var pdfPage = pages[pageNumber - 1];
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
        pages: doc.getPageCount(),
        note: 'OCR applied to ' + targetPages.length + ' page' + (targetPages.length === 1 ? '' : 's') + '.'
      };
    }

    async ensureTesseract(onProgress) {
      if (window.Tesseract) return;
      onProgress(8, 'Loading offline OCR engine');
      var url = new URL('./lib/ocr/tesseract.min.js', window.location.href).href;
      await new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = function () { resolve(); };
        script.onerror = function () {
          reject(new Error('Could not load the bundled OCR engine. Reload and try again.'));
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
