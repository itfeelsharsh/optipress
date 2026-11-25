/**
 * Opti · app.js
 * Hash-routed local file tools: images and PDFs, no uploads.
 */
(function () {
  'use strict';

  var C = window.OptiCore;
  var E = window.optiEngine;
  var P = window.OptiPdf;
  var Presets = window.OptiPresets;

  var main = document.getElementById('main');
  var themeButton = document.getElementById('themeToggle');
  var toasts = document.getElementById('toasts');
  var live = document.getElementById('liveStatus');
  var dropOverlay = document.getElementById('dropOverlay');
  var pickerDialog = document.getElementById('toolPicker');
  var pickerList = document.getElementById('pickerList');
  var pickerNote = document.getElementById('pickerNote');
  var pickerFilesEl = document.getElementById('pickerFiles');
  var leaveDialog = document.getElementById('leaveDialog');

  var STORAGE = { settings: 'opti:settings:v3', theme: 'opti:theme:v2' };
  var LIMITS = { files: 80, bytes: 200 * 1024 * 1024 };

  var APP_DEFAULTS = {
    quality: 78,
    format: 'auto',
    customMime: '',
    targetEnabled: false,
    targetMode: 'exact',
    targetKB: 500,
    scale: 100,
    fitMode: 'fit',
    anchor: 'center',
    background: 'white',
    presetId: 'custom',
    cropWidth: '',
    cropHeight: '',
    pdfMode: 'raster',
    pdfDpi: 150,
    pageSize: 'a4',
    margin: 24,
    orientation: 'auto',
    imageDpi: 150,
    imageFormat: 'image/jpeg',
    watermarkText: 'DRAFT',
    watermarkSize: 9,
    watermarkOpacity: 15,
    watermarkAngle: 45,
    watermarkColor: '#666666',
    numberPosition: 'bottom-center',
    numberFormat: 'Page {n} of {total}',
    numberStart: 1,
    numberSize: 10,
    ocrDpi: 200
  };

  var app = {
    theme: null,
    settings: null,
    pendingFiles: null,
    dropHandler: null,
    busy: false,
    installPrompt: null,
    estimateCache: new Map(),
    currentFiles: null,
    allowLeave: false,
    lastHash: '#/',
    pickerFiles: [],
    leaveTarget: null
  };

  var cleanups = [];
  var saveTimer = null;

  // ------------------------------------------------------------------ boot --

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    app.settings = normalizeAppSettings(readJSON(STORAGE.settings));
    if (app.settings.format === 'custom' && (!app.settings.customMime || !E.supportsType(app.settings.customMime))) {
      app.settings.format = 'auto';
    }
    app.theme = readTheme();
    applyTheme();
    bindChrome();
    bindCompare();
    bindDialogs();
    bindGlobalDrop();
    bindPaste();
    registerServiceWorker();
    app.lastHash = location.hash || '#/';
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('beforeunload', function (event) {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    document.addEventListener('keydown', function (event) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
      var button = document.getElementById('runBtn');
      if (button && !button.disabled) {
        event.preventDefault();
        button.click();
      }
    });
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      app.installPrompt = event;
    });
    route();
  }

  function onCleanup(fn) {
    cleanups.push(fn);
  }

  function cleanupView() {
    cleanups.forEach(function (fn) {
      try {
        fn();
      } catch (err) {
        /* noop */
      }
    });
    cleanups = [];
    app.dropHandler = null;
    app.currentFiles = null;
    app.estimateCache.clear();
    closeCompare(true);
  }

  function route() {
    if (app.busy) return;
    cleanupView();
    var hash = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (hash === 'about') {
      renderAbout();
    } else if (hash && TOOLS[hash]) {
      renderTool(TOOLS[hash]);
    } else {
      renderHome();
    }
    window.scrollTo(0, 0);
    try {
      main.focus({ preventScroll: true });
    } catch (err) {
      main.focus();
    }
  }

  // ----------------------------------------------------------------- theme --

  function readTheme() {
    var value = safeGet(STORAGE.theme);
    return value === 'dark' || value === 'light' ? value : null;
  }

  function effectiveTheme() {
    if (app.theme) return app.theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    var root = document.documentElement;
    if (app.theme) root.setAttribute('data-theme', app.theme);
    else root.removeAttribute('data-theme');
    var label = app.theme || 'system';
    if (themeButton) {
      themeButton.textContent = 'theme: ' + label;
      themeButton.setAttribute('aria-label', 'Theme: ' + label + '. Click to change.');
      themeButton.setAttribute('aria-pressed', app.theme ? 'true' : 'false');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme() === 'dark' ? '#12151c' : '#f4f1ea');
  }

  function cycleTheme() {
    app.theme = app.theme === null ? 'light' : app.theme === 'light' ? 'dark' : null;
    if (app.theme) safeSet(STORAGE.theme, app.theme);
    else safelyRemove(STORAGE.theme);
    applyTheme();
  }

  function bindChrome() {
    if (themeButton) themeButton.addEventListener('click', cycleTheme);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var listener = function () {
        if (!app.theme) applyTheme();
      };
      if (mq.addEventListener) mq.addEventListener('change', listener);
      else if (mq.addListener) mq.addListener(listener);
    }
  }

  // -------------------------------------------------------------- settings --

  function normalizeAppSettings(raw) {
    var input = raw && typeof raw === 'object' ? raw : {};
    var base = C.normalizeSettings(input, C.DEFAULTS);
    var s = Object.assign({}, APP_DEFAULTS, {
      quality: base.quality,
      format: base.format,
      customMime: base.customMime,
      targetEnabled: base.targetEnabled,
      targetMode: base.targetMode,
      targetKB: base.targetKB,
      scale: base.scale,
      fitMode: base.fitMode,
      anchor: base.anchor,
      background: base.background,
      pdfMode: base.pdfMode,
      pdfDpi: base.pdfDpi
    });

    s.presetId = typeof input.presetId === 'string' ? input.presetId : 'custom';
    s.cropWidth = C.toPositiveInt(input.cropWidth) || '';
    s.cropHeight = C.toPositiveInt(input.cropHeight) || '';
    s.pageSize = ['a4', 'letter', 'auto'].indexOf(input.pageSize) !== -1 ? input.pageSize : 'a4';
    s.margin = Math.round(C.clampNumber(input.margin === undefined ? 24 : input.margin, 0, 72));
    s.orientation = ['auto', 'portrait', 'landscape'].indexOf(input.orientation) !== -1 ? input.orientation : 'auto';
    s.imageDpi = [72, 150, 200, 300].indexOf(Number(input.imageDpi)) !== -1 ? Number(input.imageDpi) : 150;
    s.imageFormat = ['image/jpeg', 'image/png'].indexOf(input.imageFormat) !== -1 ? input.imageFormat : 'image/jpeg';
    s.watermarkText = String(input.watermarkText || 'DRAFT').slice(0, 80);
    s.watermarkSize = Math.round(C.clampNumber(input.watermarkSize === undefined ? 9 : input.watermarkSize, 2, 40));
    s.watermarkOpacity = Math.round(C.clampNumber(input.watermarkOpacity === undefined ? 15 : input.watermarkOpacity, 2, 100));
    s.watermarkAngle = Number(input.watermarkAngle) === 0 ? 0 : 45;
    s.watermarkColor = /^#[0-9a-f]{6}$/i.test(String(input.watermarkColor || '')) ? input.watermarkColor : '#666666';
    s.numberPosition = ['bottom-center', 'bottom-right', 'top-center', 'top-right'].indexOf(input.numberPosition) !== -1
      ? input.numberPosition
      : 'bottom-center';
    s.numberFormat = ['Page {n} of {total}', '{n}', '{n} / {total}'].indexOf(input.numberFormat) !== -1
      ? input.numberFormat
      : 'Page {n} of {total}';
    s.numberStart = Math.max(1, Math.round(Number(input.numberStart) || 1));
    s.numberSize = Math.round(C.clampNumber(input.numberSize === undefined ? 10 : input.numberSize, 6, 36));
    s.ocrDpi = [150, 200, 300].indexOf(Number(input.ocrDpi)) !== -1 ? Number(input.ocrDpi) : 200;
    if (window.optiEngine) {
      if (s.format === 'image/avif' && !window.optiEngine.supportsType('image/avif')) s.format = 'auto';
      if (s.format === 'image/webp' && !window.optiEngine.supportsType('image/webp')) s.format = 'auto';
    }
    return s;
  }

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      safeSet(STORAGE.settings, JSON.stringify(app.settings));
    }, 200);
  }

  function updateSettings(patch) {
    app.settings = normalizeAppSettings(Object.assign({}, app.settings, patch));
    saveSettings();
  }

  function engineOptions(overrides) {
    var s = app.settings;
    return Object.assign(
      {
        quality: s.quality,
        format: s.format,
        customMime: s.customMime,
        targetEnabled: s.targetEnabled,
        targetMode: s.targetMode,
        targetKB: s.targetKB,
        scale: s.scale,
        resizeMode: 'scale',
        customWidth: '',
        customHeight: '',
        fitMode: 'fit',
        anchor: 'center',
        background: s.background,
        letterbox: s.background === 'black' ? 'black' : 'white',
        pdfMode: s.pdfMode,
        pdfDpi: s.pdfDpi
      },
      overrides || {}
    );
  }

  function storageOptions() {
    var s = app.settings;
    return {
      quality: s.quality,
      format: s.format,
      customMime: s.customMime,
      targetEnabled: s.targetEnabled,
      targetMode: s.targetMode,
      targetKB: s.targetKB,
      scale: s.scale,
      resizeMode: 'scale',
      customWidth: s.cropWidth,
      customHeight: s.cropHeight,
      fitMode: s.fitMode,
      anchor: s.anchor,
      background: s.background,
      pdfMode: s.pdfMode,
      pdfDpi: s.pdfDpi
    };
  }

  // ----------------------------------------------------------------- files --

  class Files {
    constructor(options) {
      var opts = options || {};
      this.items = [];
      this.accept = opts.accept || 'all';
      this.multiple = opts.multiple !== false;
      this.max = opts.max || LIMITS.files;
      this.probeMode = opts.probeMode || 'auto';
      this.onChange = opts.onChange || function () {};
      this.seq = 0;
    }

    notify(type, item) {
      this.onChange(type, item, this);
    }

    add(fileList) {
      var self = this;
      var incoming = Array.prototype.slice.call(fileList || []);
      if (!incoming.length) return;

      var accepted = [];
      var seen = new Set(this.items.map(function (item) { return item.name + '|' + item.size + '|' + item.file.lastModified; }));
      var duplicates = 0;
      var unsupported = 0;
      var oversized = 0;

      incoming.forEach(function (file) {
        if (self.items.length + accepted.length >= self.max) return;
        if (!file.size) return;
        if (file.size > LIMITS.bytes) {
          oversized++;
          return;
        }
        var kind = C.kindOf(file);
        var allowed = self.accept === 'all' ||
          (self.accept === 'pdf' && kind === 'pdf') ||
          (self.accept === 'images' && (kind === 'image' || kind === 'heic'));
        if (!allowed || kind === 'unknown') {
          unsupported++;
          return;
        }
        var key = file.name + '|' + file.size + '|' + file.lastModified;
        if (seen.has(key)) {
          duplicates++;
          return;
        }
        seen.add(key);
        accepted.push(file);
      });

      if (oversized) toast(oversized + ' file(s) over 200 MB skipped.', 'error');
      if (unsupported) toast(unsupported + ' unsupported file(s) skipped.', 'error');
      if (duplicates) toast(duplicates + ' duplicate(s) skipped.');

      if (!accepted.length) return;

      if (!this.multiple) {
        this.items.forEach(cleanupItem);
        this.items = [];
        accepted = accepted.slice(0, 1);
        if (incoming.length > 1) toast('This tool uses one file; the first was kept.');
      }

      var created = accepted.map(function (file) {
        return makeItem(self, file);
      });
      this.items.push.apply(this.items, created);
      this.notify('structure');
      this.probeAll(created);
    }

    async probeAll(items) {
      var self = this;
      var queue = items.slice();
      if (this.probeMode === 'none') {
        items.forEach(function (item) {
          item.probing = false;
          self.notify('probe', item);
        });
        return;
      }
      async function worker() {
        while (queue.length) {
          var item = queue.shift();
          if (!self.items.includes(item)) continue;
          await self.probeItem(item);
        }
      }
      var lanes = [];
      for (var i = 0; i < Math.min(3, queue.length); i++) lanes.push(worker());
      await Promise.all(lanes);
    }

    async probeItem(item) {
      try {
        var info = item.kind === 'pdf' ? await P.probe(item.file) : await E.probe(item.file);
        if (!this.items.includes(item)) {
          if (info && info.sample && typeof info.sample.close === 'function') info.sample.close();
          return;
        }
        item.meta = info;
        item.probing = false;
        if (info.sample) item.sample = info.sample;
        if (info.prepared) {
          item.prepared = info.prepared;
          if (item.kind === 'heic' && !item.thumbUrl) {
            item.thumbUrl = trackUrl(item, URL.createObjectURL(info.prepared));
          }
        }
        if (info.thumb) item.thumbData = info.thumb;
        if (item.error) {
          item.error = null;
          item.status = 'queued';
        }
      } catch (err) {
        item.probing = false;
        item.error = err && err.message ? err.message : 'Could not read this file.';
        item.status = 'error';
      }
      this.notify('probe', item);
    }

    remove(id) {
      var index = this.items.findIndex(function (item) { return item.id === id; });
      if (index < 0) return;
      cleanupItem(this.items[index]);
      this.items.splice(index, 1);
      this.notify('structure');
    }

    move(id, direction) {
      var index = this.items.findIndex(function (item) { return item.id === id; });
      var target = index + (direction === 'up' ? -1 : 1);
      if (index < 0 || target < 0 || target >= this.items.length) return;
      var item = this.items[index];
      this.items[index] = this.items[target];
      this.items[target] = item;
      this.notify('structure');
    }

    clear() {
      this.items.forEach(cleanupItem);
      this.items = [];
      this.notify('structure');
    }

    cleanup() {
      this.items.forEach(cleanupItem);
      this.items = [];
    }
  }

  function makeItem(files, file) {
    var item = {
      id: 'f' + ++files.seq,
      file: file,
      name: file.name,
      size: file.size,
      kind: C.kindOf(file),
      ext: C.extOf(file.name) || 'file',
      status: 'queued',
      progress: 0,
      stage: '',
      error: null,
      note: '',
      result: null,
      stale: false,
      probing: true,
      meta: null,
      sample: null,
      prepared: null,
      thumbUrl: null,
      thumbData: null,
      objectUrls: []
    };
    if (item.kind === 'image') {
      item.thumbUrl = trackUrl(item, URL.createObjectURL(file));
    }
    return item;
  }

  function trackUrl(item, url) {
    item.objectUrls.push(url);
    return url;
  }

  function cleanupItem(item) {
    if (item.sample && typeof item.sample.close === 'function') {
      try {
        item.sample.close();
      } catch (err) {
        /* noop */
      }
    }
    item.objectUrls.forEach(function (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        /* noop */
      }
    });
    item.objectUrls = [];
  }

  // ------------------------------------------------------------- rendering --

  function fileMeta(item) {
    var bits = [item.ext.toUpperCase()];
    if (item.meta && item.meta.width && item.meta.height) bits.push(item.meta.width + '×' + item.meta.height);
    if (item.meta && item.meta.pages) bits.push(item.meta.pages + ' page' + (item.meta.pages === 1 ? '' : 's'));
    if (item.probing) bits.push('reading…');
    return bits.join(' · ');
  }

  function fileRow(item, opts) {
    var row = document.createElement('li');
    row.className = 'file-row';
    row.dataset.id = item.id;
    row.innerHTML =
      '<span class="thumb"></span>' +
      '<span class="file-main">' +
        '<span class="file-name"></span>' +
        '<span class="file-meta"></span>' +
        '<span class="file-status" hidden><span class="progress"><span></span></span><span class="status-text"></span></span>' +
      '</span>' +
      '<span class="file-detail"><span class="file-size"></span><span class="row-actions"></span></span>';

    var thumb = row.querySelector('.thumb');
    var thumbSrc = item.thumbData || item.thumbUrl;
    if (thumbSrc) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = thumbSrc;
      img.addEventListener('error', function () {
        img.remove();
        thumb.textContent = item.ext.toUpperCase();
      });
      thumb.appendChild(img);
    } else {
      thumb.textContent = item.kind === 'pdf' ? 'pdf' : item.ext.toUpperCase();
    }
    if (item.kind === 'pdf') thumb.classList.add('is-pdf');

    row.querySelector('.file-name').textContent = item.name;
    row.querySelector('.file-meta').textContent = fileMeta(item);
    updateRow(item, row);
    updateRowActions(row, item, opts);
    return row;
  }

  function updateRow(item, row) {
    if (!row) return;
    row.className = 'file-row' + (item.status === 'error' ? ' is-error' : '');
    row.querySelector('.file-meta').textContent = fileMeta(item);

    var status = row.querySelector('.file-status');
    var text = row.querySelector('.status-text');
    var fill = row.querySelector('.progress > span');
    var message = '';
    var tone = '';

    if (item.status === 'error') {
      message = item.error || 'Something went wrong.';
      tone = 'is-error';
    } else if (item.status === 'processing') {
      message = (item.stage || 'working') + ' · ' + Math.round(item.progress) + '%';
      fill.style.width = Math.max(2, Math.min(100, item.progress)) + '%';
    } else if (item.result && item.stale) {
      message = 'settings changed — run again';
    } else if (item.result && item.note) {
      message = item.note;
      tone = item.result.usedOriginal ? '' : 'is-ok';
    } else if (item.probing) {
      message = 'reading file…';
    }

    if (message) {
      status.hidden = false;
      status.className = 'file-status ' + tone;
      text.textContent = message;
      row.querySelector('.progress').hidden = item.status !== 'processing';
    } else {
      status.hidden = true;
      row.querySelector('.progress').hidden = true;
    }

    var size = row.querySelector('.file-size');
    size.textContent = '';
    var before = document.createElement('span');
    before.className = 'size-before';
    before.textContent = C.formatBytes(item.size);
    size.appendChild(before);

    if (item.result) {
      var arrow = document.createElement('span');
      arrow.className = 'size-before';
      arrow.textContent = '→';
      size.appendChild(arrow);
      var after = document.createElement('span');
      after.className = 'size-after';
      after.textContent = C.formatBytes(item.result.blob.size);
      size.appendChild(after);

      var savings = document.createElement('span');
      savings.className = 'savings';
      if (item.stale) {
        savings.textContent = 'stale';
        savings.classList.add('is-warn');
      } else if (item.result.usedOriginal) {
        savings.textContent = 'original kept';
        savings.classList.add('is-warn');
      } else if (item.result.exactSize) {
        savings.textContent = 'exact';
      } else {
        var percent = C.savingsPercent(item.size, item.result.blob.size);
        if (percent < 0) {
          savings.classList.add('is-error');
          savings.textContent = '+' + Math.abs(percent) + '%';
        } else {
          savings.textContent = '−' + percent + '%';
        }
      }
      size.appendChild(savings);
    }
  }

  function updateRowActions(row, item, opts) {
    var host = row.querySelector('.row-actions');
    host.textContent = '';
    var options = opts || {};

    function action(name, label, danger) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'row-action' + (danger ? ' is-danger' : '');
      button.dataset.action = name;
      button.textContent = label;
      button.setAttribute('aria-label', label + ' ' + item.name);
      host.appendChild(button);
    }

    if (options.reorder) {
      action('up', '↑');
      action('down', '↓');
    }
    if (item.result) {
      action('save', 'save');
      if (item.kind !== 'pdf' && options.compare) action('compare', 'compare');
    }
    if (item.status === 'error' || (item.result && item.stale)) {
      action('retry', 'retry');
    }
    action('remove', '×', true);
  }

  function renderList(container, files, opts) {
    container.textContent = '';
    container.hidden = files.items.length === 0;
    files.items.forEach(function (item) {
      container.appendChild(fileRow(item, opts));
    });
  }

  function bindListActions(container, files, opts) {
    container.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (!button) return;
      var row = button.closest('.file-row');
      if (!row) return;
      var item = files.items.find(function (entry) { return entry.id === row.dataset.id; });
      if (!item) return;
      var action = button.dataset.action;
      if (action === 'remove') files.remove(item.id);
      else if (action === 'up') files.move(item.id, 'up');
      else if (action === 'down') files.move(item.id, 'down');
      else if (action === 'save' && item.result) download(item.result.blob, item.result.fileName);
      else if (action === 'compare') openCompare(item);
      else if (action === 'retry' && opts.onRetry) opts.onRetry(item);
    });
  }

  // ------------------------------------------------------------------ home --

  function renderHome() {
    document.title = 'Opti — local file tools';
    main.innerHTML =
      '<section class="home">' +
        '<p class="privacy-line"><span class="dot" aria-hidden="true"></span>Everything runs in this tab. Your files are never uploaded.</p>' +
        '<h1 class="hero-title"><span class="prompt">$</span> your files.<br><span class="prompt">$</span> your tab.<br><span class="prompt">$</span> your way.<span class="cursor" aria-hidden="true"></span></h1>' +
        uploaderHtml('home', {
          accept: 'all',
          multiple: true,
          title: 'Select files',
          sub: 'or drop them here — images, HEIC and PDFs',
          note: 'You choose the tool next. Nothing is uploaded.'
        }) +
        '<p class="section-label">or open a tool</p>' +
        toolGroupsHtml() +
      '</section>';

    bindUploader('home', function (files) {
      openToolPicker(files);
    });
    app.dropHandler = function (files) {
      openToolPicker(files);
    };
  }

  function toolGroupsHtml() {
    var groups = [
      { name: 'images', ids: ['squeeze', 'crop', 'convert'] },
      { name: 'pdf · organise', ids: ['merge', 'split', 'extract', 'delete', 'reorder', 'rotate'] },
      { name: 'pdf · convert', ids: ['images-to-pdf', 'pdf-to-images', 'ocr'] },
      { name: 'pdf · edit', ids: ['compress-pdf', 'watermark', 'page-numbers'] },
      { name: 'pdf · secure', ids: ['protect', 'unlock'] }
    ];

    return groups
      .map(function (group) {
        var cards = group.ids
          .map(function (id) {
            var tool = TOOLS[id];
            return (
              '<a class="tool-card" href="#/' + id + '">' +
                '<span class="tool-name">' + tool.card + '</span>' +
                '<span class="tool-desc">' + tool.blurb + '</span>' +
              '</a>'
            );
          })
          .join('');
        return '<section class="tool-group"><h2>' + group.name + '</h2><div class="cards">' + cards + '</div></section>';
      })
      .join('');
  }

  function renderAbout() {
    document.title = 'About & privacy — Opti';
    main.innerHTML =
      '<section class="tool">' +
        '<a class="back" href="#/">← all tools</a>' +
        '<p class="eyebrow">about</p>' +
        '<h1 class="tool-title"><span class="prompt">$</span> about &amp; privacy<span class="cursor" aria-hidden="true"></span></h1>' +
        '<p class="lede">A small, local-first file workshop. Squeeze, crop, convert, merge and edit — without sending anything to a server.</p>' +
        '<div class="tool-layout">' +
          '<div class="col-main">' +
            '<div class="panel"><h2 class="panel-title">privacy</h2>' +
              '<p class="hint">Files are decoded, re-encoded and written by this tab. There are no uploads, accounts, analytics or tracking. Every tool, including OCR, works fully offline after the first load; the English OCR model is bundled.</p>' +
            '</div>' +
            '<div class="panel"><h2 class="panel-title">quality &amp; limits</h2>' +
              '<p class="hint">Squeezing reduces quality by design; the estimator encodes a real sample so you can see the trade-off before running. Rasterising a PDF flattens its text into images — use “Keep text” when the PDF must stay selectable. Animated GIFs become a single frame. Password tools use AES-256 and require a modern browser.</p>' +
            '</div>' +
            '<div class="panel"><h2 class="panel-title">size presets</h2>' +
              '<p class="hint">Passport, visa and government-form dimensions and limits are commonly cited values, not legal advice. Requirements change; always confirm with the issuing authority before uploading.</p>' +
            '</div>' +
            '<div class="panel"><h2 class="panel-title">credits</h2>' +
              '<p class="hint">Built with PDF.js, pdf-lib, heic2any, JSZip and Tesseract.js (OCR only). Interface language inspired by <a href="https://pdf.esdy.cc/" rel="noreferrer noopener">Estudely PDF</a>. Type: IBM Plex Mono and Instrument Sans.</p>' +
              '<p class="hint mt-8">Made by <a href="https://harshbanker.com" target="_blank" rel="noreferrer noopener">Harsh Banker</a> · <a href="https://harshbanker.com" target="_blank" rel="noreferrer noopener">harshbanker.com</a>.</p>' +
            '</div>' +
          '</div>' +
          '<aside class="col-side">' +
            '<div class="panel"><h2 class="panel-title">keyboard</h2>' +
              '<p class="hint"><code>⌘/Ctrl + Enter</code> runs the current tool.<br><code>Esc</code> closes the compare view.<br>Everything is reachable with <kbd>Tab</kbd>.</p>' +
            '</div>' +
          '</aside>' +
        '</div>' +
      '</section>';
  }

  // ----------------------------------------------------------- tool picker --

  function bindDialogs() {
    if (pickerDialog) {
      document.getElementById('pickerClose').addEventListener('click', function () {
        pickerDialog.close();
      });
      document.getElementById('pickerCancel').addEventListener('click', function () {
        pickerDialog.close();
      });
      pickerDialog.addEventListener('click', function (event) {
        if (event.target === pickerDialog) pickerDialog.close();
      });
      pickerDialog.addEventListener('close', function () {
        app.pickerFiles = [];
      });
      pickerList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-tool]');
        if (!button) return;
        var tool = button.dataset.tool;
        var files = app.pickerFiles.slice();
        app.pendingFiles = files;
        pickerDialog.close();
        location.hash = '#/' + tool;
      });
    }

    if (leaveDialog) {
      document.getElementById('stayBtn').addEventListener('click', function () {
        leaveDialog.close();
        app.leaveTarget = null;
      });
      document.getElementById('leaveBtn').addEventListener('click', function () {
        var target = app.leaveTarget;
        app.leaveTarget = null;
        leaveDialog.close();
        if (!target) return;
        app.allowLeave = true;
        app.lastHash = target;
        location.hash = target;
      });
      leaveDialog.addEventListener('click', function (event) {
        if (event.target === leaveDialog) leaveDialog.close();
      });
    }
  }

  function openToolPicker(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var supported = files.filter(function (file) { return C.isSupported(file); });
    if (!supported.length) {
      toast('Nothing in this selection can be processed.', 'error');
      return;
    }
    if (supported.length !== files.length) {
      toast((files.length - supported.length) + ' unsupported file(s) ignored.', 'error');
    }

    // Merge with a picker that is already open (drop again).
    var existing = app.pickerFiles.slice();
    supported.forEach(function (file) {
      var duplicate = existing.some(function (entry) {
        return entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified;
      });
      if (!duplicate) existing.push(file);
    });
    app.pickerFiles = existing;

    var images = existing.filter(function (file) { return C.kindOf(file) !== 'pdf'; });
    var pdfs = existing.filter(function (file) { return C.kindOf(file) === 'pdf'; });
    var ids = [];
    var note = '';

    if (images.length && !pdfs.length) {
      ids = ['squeeze', 'crop', 'convert', 'images-to-pdf'];
    } else if (pdfs.length && !images.length) {
      if (pdfs.length === 1) {
        ids = ['compress-pdf', 'split', 'extract', 'delete', 'reorder', 'rotate', 'pdf-to-images', 'watermark', 'page-numbers', 'protect', 'unlock', 'ocr'];
      } else {
        ids = ['merge', 'compress-pdf'];
        note = 'Page tools work on one PDF at a time. Add a single PDF for split, extract, rotate and the rest.';
      }
    } else {
      ids = ['squeeze'];
      note = 'Mixed selection: Squeeze handles both. For crop, convert and PDF page tools, add only one kind of file.';
    }

    pickerFilesEl.textContent = [
      images.length ? images.length + (images.length === 1 ? ' image' : ' images') : '',
      pdfs.length ? pdfs.length + (pdfs.length === 1 ? ' PDF' : ' PDFs') : '',
      C.formatBytes(existing.reduce(function (sum, file) { return sum + file.size; }, 0))
    ].filter(Boolean).join(' · ');

    pickerList.textContent = '';
    ids.forEach(function (id) {
      var tool = TOOLS[id];
      if (!tool) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker-item';
      button.dataset.tool = id;
      var name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = tool.card;
      var desc = document.createElement('span');
      desc.className = 'picker-desc';
      desc.textContent = tool.blurb;
      button.appendChild(name);
      button.appendChild(desc);
      pickerList.appendChild(button);
    });

    pickerNote.hidden = !note;
    pickerNote.textContent = note;

    if (!pickerDialog.open) {
      pickerDialog.showModal();
      var first = pickerList.querySelector('.picker-item');
      if (first) first.focus();
    }
  }

  function hasUnsavedChanges() {
    return !!(app.currentFiles && app.currentFiles.items.length);
  }

  function showLeaveDialog(target) {
    if (!leaveDialog || !hasUnsavedChanges()) return;
    var count = app.currentFiles.items.length;
    var label = document.title.split(' — ')[0] || 'this tool';
    document.getElementById('leaveText').textContent =
      'You have ' + count + ' file' + (count === 1 ? '' : 's') + ' in ' + label +
      '. Leaving discards them and any results. Download anything you need first.';
    app.leaveTarget = target;
    leaveDialog.showModal();
    document.getElementById('stayBtn').focus();
  }

  function handleHashChange() {
    var next = location.hash || '#/';
    if (app.allowLeave) {
      app.allowLeave = false;
      app.lastHash = next;
      route();
      return;
    }
    if (next === app.lastHash) return;
    if (app.busy) {
      history.replaceState(null, '', app.lastHash);
      toast('Wait for the current run to finish before leaving.', 'error');
      return;
    }
    if (hasUnsavedChanges()) {
      var target = next;
      history.replaceState(null, '', app.lastHash);
      showLeaveDialog(target);
      return;
    }
    app.lastHash = next;
    route();
  }

  // ------------------------------------------------------------- utilities --

  function acceptAttr(kind) {
    var images = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,.heic,.heif,.tif,.tiff,.jxl';
    if (kind === 'pdf') return '.pdf,application/pdf';
    if (kind === 'images') return images;
    return images + ',.pdf,application/pdf';
  }

  function uploaderHtml(id, options) {
    var opts = options || {};
    return (
      '<input type="file" id="' + id + '-input" accept="' + acceptAttr(opts.accept) + '"' + (opts.multiple ? ' multiple' : '') + ' hidden>' +
      '<button type="button" class="dropzone' + (opts.compact ? ' compact' : '') + '" id="' + id + '-zone">' +
        '<span class="legend">· ' + (opts.compact ? 'add files' : 'files') + ' ·</span>' +
        '<span class="dz-title">' + (opts.title || 'Select files') + '</span>' +
        '<span class="dz-sub">' + (opts.sub || 'or drop them here') + '</span>' +
        (opts.note ? '<span class="dz-note">' + opts.note + '</span>' : '') +
      '</button>'
    );
  }

  function bindUploader(id, onFiles) {
    var input = document.getElementById(id + '-input');
    var zone = document.getElementById(id + '-zone');
    if (!input || !zone) return;
    zone.addEventListener('click', function () {
      input.click();
    });
    input.addEventListener('change', function () {
      if (input.files && input.files.length) onFiles(Array.prototype.slice.call(input.files));
      input.value = '';
    });
    zone.addEventListener('dragover', function (event) {
      event.preventDefault();
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragleave', function () {
      zone.classList.remove('is-dragover');
    });

  }

  function bindGlobalDrop() {
    var depth = 0;
    function hasFiles(event) {
      var types = event.dataTransfer && event.dataTransfer.types;
      return types && Array.prototype.indexOf.call(types, 'Files') !== -1;
    }
    function hide() {
      depth = 0;
      if (dropOverlay) dropOverlay.hidden = true;
      document.querySelectorAll('.dropzone.is-dragover').forEach(function (zone) {
        zone.classList.remove('is-dragover');
      });
    }
    window.addEventListener('dragenter', function (event) {
      if (!hasFiles(event) || !app.dropHandler) return;
      event.preventDefault();
      depth++;
      if (dropOverlay) dropOverlay.hidden = false;
    });
    window.addEventListener('dragover', function (event) {
      if (!hasFiles(event) || !app.dropHandler) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (event) {
      if (!event.relatedTarget) {
        hide();
        return;
      }
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hide();
    });
    // Capture phase: the overlay must disappear even if a child stops propagation.
    window.addEventListener('drop', function (event) {
      hide();
      if (!app.dropHandler) return;
      if (!(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length)) return;
      event.preventDefault();
      app.dropHandler(Array.prototype.slice.call(event.dataTransfer.files));
    }, true);
    window.addEventListener('dragend', hide);
    window.addEventListener('blur', hide);
  }

  function bindPaste() {
    window.addEventListener('paste', function (event) {
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      var files = event.clipboardData && event.clipboardData.files;
      if (files && files.length && app.dropHandler) {
        event.preventDefault();
        app.dropHandler(files);
      }
    });
  }

  function toast(message, tone, action) {
    if (!toasts) return;
    var el = document.createElement('div');
    el.className = 'toast' + (tone ? ' is-' + tone : '');
    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    el.appendChild(text);
    if (action && action.label) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', function () {
        action.onClick();
        el.remove();
      });
      el.appendChild(button);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', function () {
      el.remove();
    });
    el.appendChild(close);
    toasts.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, action ? 9000 : 5200);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
  }

  function announce(message) {
    if (!live) return;
    live.textContent = '';
    setTimeout(function () {
      live.textContent = message;
    }, 30);
  }

  function revealResult(zone) {
    if (!zone) return;
    requestAnimationFrame(function () {
      var button = zone.querySelector('.result .btn-primary');
      if (button) {
        try {
          button.focus({ preventScroll: true });
        } catch (err) {
          button.focus();
        }
      }
      try {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        zone.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      } catch (err) {
        zone.scrollIntoView();
      }
    });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
  }

  async function zipEntries(entries, onProgress) {
    if (!window.JSZip) throw new Error('The ZIP library did not load. Reload and try again.');
    var zip = new window.JSZip();
    var used = new Set();
    entries.forEach(function (entry) {
      var name = C.uniqueName(entry.fileName, used);
      used.add(name);
      zip.file(name, entry.blob);
    });
    return zip.generateAsync({ type: 'blob', compression: 'STORE' }, function (meta) {
      if (onProgress) onProgress(meta.percent);
    });
  }

  function readJSON(key) {
    var raw = safeGet(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* private mode */
    }
  }

  function safelyRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      /* noop */
    }
  }

  function normalizeMime(value) {
    var text = String(value || '').trim().toLowerCase();
    return /^image\/[a-z0-9.+-]+$/.test(text) ? text : '';
  }

  function setRangeFill(input) {
    var min = Number(input.min) || 0;
    var max = Number(input.max) || 100;
    var value = Number(input.value) || min;
    input.style.setProperty('--fill', ((value - min) / (max - min)) * 100 + '%');
  }

  function toolShell(tool, body) {
    return (
      '<section class="tool">' +
        '<a class="back" href="#/">← all tools</a>' +
        '<p class="eyebrow">' + tool.group + '</p>' +
        '<h1 class="tool-title"><span class="prompt">$</span> ' + tool.label + '<span class="cursor" aria-hidden="true"></span></h1>' +
        '<p class="lede">' + tool.blurb + '</p>' +
        body +
      '</section>'
    );
  }

  // --------------------------------------------------------- image controls --

  function qualityField(id) {
    return (
      '<div class="field">' +
        '<div class="field-head"><label class="field-label" for="' + id + '">quality</label><span class="value" id="' + id + 'Out">78</span></div>' +
        '<input type="range" class="range" id="' + id + '" min="5" max="100" step="1" value="78">' +
        '<div class="range-scale"><span>smaller</span><span>sharper</span></div>' +
      '</div>'
    );
  }

  function formatField(id) {
    return (
      '<div class="field">' +
        '<label class="field-label" for="' + id + '">format</label>' +
        '<select class="select" id="' + id + '">' +
          '<option value="auto">auto — webp</option>' +
          '<option value="original">keep original</option>' +
          '<option value="image/webp">webp</option>' +
          '<option value="image/jpeg">jpeg</option>' +
          '<option value="image/png">png — lossless</option>' +
          '<option value="image/avif" id="' + id + 'Avif">avif</option>' +
          '<option value="custom">custom mime…</option>' +
        '</select>' +
        '<div id="' + id + 'CustomWrap" hidden>' +
          '<input class="input mt-8" id="' + id + 'Custom" placeholder="image/jxl" aria-label="Custom output MIME type">' +
        '</div>' +
        '<p class="hint" id="' + id + 'Hint"></p>' +
      '</div>'
    );
  }

  function targetField(id) {
    return (
      '<div class="field">' +
        '<div class="field-head"><span class="field-label" id="' + id + 'Label">target size</span>' +
          '<label class="switch"><input type="checkbox" id="' + id + 'Toggle" aria-labelledby="' + id + 'Label"><span class="switch-track"></span></label>' +
        '</div>' +
        '<div id="' + id + 'Body" hidden>' +
          '<div class="input-row mt-8">' +
            '<input class="input" type="number" id="' + id + 'KB" min="0" step="10" value="500" placeholder="e.g. 300" aria-label="Target size in kilobytes">' +
            '<span class="unit-btn">KB</span>' +
          '</div>' +
          '<select class="select mt-8" id="' + id + 'Mode" aria-label="Target size behaviour">' +
            '<option value="exact">exactly — pad if needed</option>' +
            '<option value="atMost">at most — never exceed</option>' +
          '</select>' +
          '<p class="hint mt-8" id="' + id + 'Hint"></p>' +
        '</div>' +
      '</div>'
    );
  }

  function bindQuality(root, id, get, set, onChange) {
    var input = root.querySelector('#' + id);
    if (!input) return;
    var out = root.querySelector('#' + id + 'Out');
    input.value = String(get());
    if (out) out.textContent = String(get());
    setRangeFill(input);
    input.addEventListener('input', function () {
      set(Number(input.value));
      if (out) out.textContent = String(get());
      setRangeFill(input);
      saveSettings();
      if (onChange) onChange();
    });
  }

  function bindFormat(root, id, get, set, onChange) {
    var select = root.querySelector('#' + id);
    var customWrap = root.querySelector('#' + id + 'CustomWrap');
    var customInput = root.querySelector('#' + id + 'Custom');
    var hint = root.querySelector('#' + id + 'Hint');
    if (!select) return { refresh: function () {} };
    var avif = root.querySelector('#' + id + 'Avif');
    if (avif && !E.supportsType('image/avif')) avif.hidden = true;
    var webp = select.querySelector('option[value="image/webp"]');
    if (webp && !E.supportsType('image/webp')) webp.disabled = true;

    function refresh() {
      var format = get();
      select.value = format === 'custom' ? 'custom' : format;
      customWrap.hidden = format !== 'custom';
      var message;
      var tone = '';
      if (format === 'custom') {
        var mime = normalizeMime(customInput.value || get('customMime'));
        if (!mime) {
          message = 'Type an image MIME type, for example image/avif.';
          tone = 'is-error';
        } else if (!E.supportsType(mime)) {
          message = 'This browser cannot encode ' + mime + '.';
          tone = 'is-error';
        } else {
          message = 'This browser can encode ' + mime + '.';
          tone = 'is-ok';
        }
      } else if (format === 'image/png') {
        message = 'Lossless. Browser PNG output is rarely smaller than the source.';
      } else if (format === 'original') {
        message = 'Keeps the source format when possible.';
      } else if (format === 'image/jpeg') {
        message = 'Universal. Transparency is flattened to the background.';
      } else if (format === 'image/avif') {
        message = 'Smallest files, slowest encode.';
      } else {
        message = 'WebP is usually 25–35% smaller than JPEG at the same quality.';
      }
      hint.textContent = message;
      hint.className = 'hint' + (tone ? ' ' + tone : '');
      onChange();
    }

    select.addEventListener('change', function () {
      set(select.value === 'custom' ? 'custom' : select.value);
      if (select.value === 'custom' && !customInput.value) customInput.value = get('customMime') || '';
      refresh();
    });
    customInput.addEventListener('input', function () {
      set('customMime', normalizeMime(customInput.value));
      refresh();
    });
    customInput.value = get('customMime') || '';
    refresh();

    return { refresh: refresh };
  }

  function bindTarget(root, id, get, set, onChange) {
    var toggle = root.querySelector('#' + id + 'Toggle');
    var body = root.querySelector('#' + id + 'Body');
    var kb = root.querySelector('#' + id + 'KB');
    var mode = root.querySelector('#' + id + 'Mode');
    var hint = root.querySelector('#' + id + 'Hint');
    if (!toggle || !body || !kb || !mode) return { refresh: function () {} };

    function refresh() {
      var enabled = get('targetEnabled');
      toggle.checked = enabled;
      body.hidden = !enabled;
      if (document.activeElement !== kb) kb.value = String(get('targetKB'));
      mode.value = get('targetMode');
      var targetKB = Number(get('targetKB'));
      hint.className = 'hint mt-8';
      if (!(targetKB > 0)) {
        hint.textContent = 'Enter a target above 0 KB to enable the run.';
        hint.classList.add('is-error');
        return;
      }
      hint.textContent = get('targetMode') === 'exact'
        ? 'Pads with harmless metadata to land exactly on ' + C.formatBytes(C.kbToBytes(targetKB)) + '. Quality is maxed under the limit first.'
        : 'Stays at or under ' + C.formatBytes(C.kbToBytes(targetKB)) + '; never pads.';
    }

    toggle.addEventListener('change', function () {
      set('targetEnabled', toggle.checked);
      refresh();
      onChange();
    });
    kb.addEventListener('input', function () {
      var raw = kb.value;
      var value = raw === '' ? 0 : Number(raw);
      if (!isFinite(value) || value < 0) value = 0;
      set('targetKB', value);
      refresh();
      onChange();
    });
    kb.addEventListener('blur', function () {
      refresh();
    });
    mode.addEventListener('change', function () {
      set('targetMode', mode.value);
      refresh();
      onChange();
    });
    refresh();
    return { refresh: refresh };
  }

  function bindScale(root, id, get, set, onChange) {
    var input = root.querySelector('#' + id);
    if (!input) return;
    var out = root.querySelector('#' + id + 'Out');
    input.value = String(get());
    out.textContent = get() + '%';
    setRangeFill(input);
    input.addEventListener('input', function () {
      set(Number(input.value));
      out.textContent = get() + '%';
      setRangeFill(input);
      onChange();
    });
  }

  // ------------------------------------------------------------ estimation --

  class Estimator {
    constructor(files, getOptions, onUpdate) {
      this.files = files;
      this.getOptions = getOptions;
      this.onUpdate = onUpdate;
      this.token = 0;
      this.timer = null;
    }

    schedule() {
      clearTimeout(this.timer);
      var self = this;
      this.timer = setTimeout(function () {
        self.run();
      }, 260);
    }

    async run() {
      var token = ++this.token;
      var options = this.getOptions();
      var signature = C.settingsSignature(options);
      var items = this.files.items.slice();
      var map = new Map();
      if (!items.length) {
        this.onUpdate(map, false);
        return;
      }
      this.onUpdate(map, true);

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (token !== this.token) return;
        if (item.result && !item.stale) {
          map.set(item.id, item.result.blob.size);
          continue;
        }
        var key = item.id + ':' + signature;
        if (app.estimateCache.has(key)) {
          map.set(item.id, app.estimateCache.get(key));
          this.onUpdate(new Map(map), true);
          continue;
        }
        var bytes = null;
        if (item.kind === 'pdf') {
          bytes = E.estimatePdf(item.file, options, item.meta || {});
        } else if (item.sample && item.meta) {
          try {
            var est = await E.estimateImage(
              item.sample,
              { width: item.meta.width, height: item.meta.height, hasAlpha: item.hasAlpha, mimeType: item.meta.mimeType },
              options
            );
            if (est) bytes = est.bytes;
          } catch (err) {
            bytes = null;
          }
        }
        if (token !== this.token) return;
        if (bytes != null) {
          if (item.kind !== 'pdf' && item.kind !== 'heic') {
            var noResize = options.resizeMode !== 'exact' && (options.resizeMode !== 'scale' || options.scale >= 100);
            var autoFormat = options.format === 'auto' || options.format === 'original';
            if (noResize && autoFormat && !options.targetEnabled && bytes > item.size) bytes = item.size;
          }
          map.set(item.id, bytes);
          app.estimateCache.set(key, bytes);
          if (app.estimateCache.size > 400) app.estimateCache.clear();
          this.onUpdate(new Map(map), true);
        }
      }
      this.onUpdate(map, false);
    }

    destroy() {
      this.token++;
      clearTimeout(this.timer);
    }
  }

  function summaryStats(files, estimates, measuring) {
    var before = 0;
    var after = 0;
    var done = 0;
    var estimated = 0;
    var unknown = 0;
    files.items.forEach(function (item) {
      before += item.size;
      var estimate = estimates.get(item.id);
      if (item.result && !item.stale) {
        after += item.result.blob.size;
        done++;
      } else if (typeof estimate === 'number') {
        after += estimate;
        estimated++;
      } else {
        after += item.size;
        unknown++;
      }
    });
    return {
      total: files.items.length,
      before: before,
      after: after,
      done: done,
      estimated: estimated,
      unknown: unknown,
      measuring: measuring || unknown > 0,
      savings: C.savingsPercent(before, after)
    };
  }

  function updateSummary(container, files, estimates, measuring) {
    var stats = summaryStats(files, estimates, measuring);
    var hasMarkup = !!container.querySelector('[data-value]');
    if (!stats.total || !hasMarkup) {
      container.innerHTML =
        '<div class="summary-top"><span class="summary-label">estimated output</span><span class="summary-pill" data-pill>—</span></div>' +
        '<p class="summary-value" data-value>—</p>' +
        '<div class="summary-meter"><span data-meter></span></div>' +
        '<p class="summary-note" data-note>Add files to see a live, measured estimate.</p>';
      if (!stats.total) return;
    }
    var value = container.querySelector('[data-value]');
    var pill = container.querySelector('[data-pill]');
    var meter = container.querySelector('[data-meter]');
    var note = container.querySelector('[data-note]');
    var allDone = stats.done === stats.total;
    var nothingYet = !allDone && stats.done === 0 && stats.estimated === 0;

    if (nothingYet) {
      value.textContent = '—';
      pill.textContent = 'measuring';
      pill.className = 'summary-pill';
      meter.style.width = '0%';
      note.textContent = 'Measuring your files here — nothing is uploaded.';
      return;
    }

    value.textContent = (allDone ? '' : '≈ ') + C.formatBytes(stats.after);
    pill.textContent = (stats.savings >= 0 ? '−' : '+') + Math.abs(stats.savings) + '%';
    pill.className = 'summary-pill' + (stats.savings < 0 ? ' is-negative' : '');
    meter.style.width = Math.max(0, Math.min(100, stats.savings)) + '%';

    if (allDone) {
      note.textContent = stats.total + ' of ' + stats.total + ' done · saves ' + C.formatBytes(Math.max(0, stats.before - stats.after));
    } else if (stats.done) {
      note.textContent = stats.done + ' done · estimate for the rest';
    } else if (stats.measuring) {
      note.textContent = 'Measured ' + stats.estimated + ' of ' + stats.total + ' · still measuring';
    } else {
      note.textContent = 'Measured estimate · run to confirm';
    }
    if (stats.savings < 0) note.textContent += ' · output is larger';
  }

  // --------------------------------------------------------- image engines --

  function markStale(files) {
    files.items.forEach(function (item) {
      if (item.result) item.stale = true;
    });
  }

  function pendingItems(files) {
    return files.items.filter(function (item) {
      return !item.result || item.stale;
    });
  }

  function canRunImages(files, options, requireSupportedCustom) {
    if (!files.items.length) return false;
    if (options.targetEnabled && !(Number(options.targetKB) > 0)) return false;
    if (requireSupportedCustom && options.format === 'custom') {
      if (!options.customMime || !E.supportsType(options.customMime)) return false;
    }
    return true;
  }

  async function processImageItems(files, options, listEl, onItem, specific, outputSuffix) {
    var targets = specific && specific.length ? specific : pendingItems(files);
    if (!targets.length) return [];
    var cursor = 0;
    var lanes = Math.min(2, targets.length);

    async function worker() {
      while (cursor < targets.length) {
        var item = targets[cursor++];
        if (!files.items.includes(item)) continue;
        item.status = 'processing';
        item.progress = 2;
        item.stage = 'preparing';
        item.error = null;
        item.stale = false;
        item.result = null;
        item.note = '';
        onItem(item, 'start');
        try {
          var result = await E.compress(
            item.prepared || item.file,
            options,
            function (percent, label) {
              if (!files.items.includes(item)) return;
              item.progress = Math.max(item.progress, Math.min(100, Number(percent) || 0));
              item.stage = label || '';
              var row = listEl.querySelector('[data-id="' + item.id + '"]');
              if (row) updateRow(item, row);
            },
            {
              kind: item.kind,
              originalName: item.name,
              prepared: item.prepared,
              mimeType: item.meta && item.meta.mimeType
            }
          );
          if (!files.items.includes(item)) continue;
          if (outputSuffix) {
            var tag = typeof outputSuffix === 'function' ? outputSuffix(item, result) : outputSuffix;
            result.fileName = C.outputFileName(item.name, result.mimeType || (item.meta && item.meta.mimeType) || 'image/jpeg', tag);
          }
          item.status = 'done';
          item.progress = 100;
          item.result = result;
          item.note = result.note || '';
        } catch (err) {
          item.status = 'error';
          item.progress = 0;
          item.result = null;
          item.error = err && err.message ? err.message : 'Compression failed.';
        }
        onItem(item, 'end');
      }
    }

    var workers = [];
    for (var i = 0; i < lanes; i++) workers.push(worker());
    await Promise.all(workers);
    return targets;
  }

  function imageResultEntries(files) {
    return files.items
      .filter(function (item) { return item.result; })
      .map(function (item) {
        return { blob: item.result.blob, fileName: item.result.fileName, item: item };
      });
  }

  function showImageResults(zone, files, label) {
    var entries = imageResultEntries(files).filter(function (entry) { return !entry.item.stale; });
    zone.textContent = '';
    if (!entries.length) return;

    var totalBefore = entries.reduce(function (sum, entry) { return sum + entry.item.size; }, 0);
    var totalAfter = entries.reduce(function (sum, entry) { return sum + entry.blob.size; }, 0);
    var saved = Math.max(0, totalBefore - totalAfter);

    var box = document.createElement('div');
    box.className = 'result';
    var name = document.createElement('p');
    name.className = 'result-name';
    name.textContent = entries.length === 1 ? entries[0].fileName : entries.length + ' ' + label;
    var meta = document.createElement('p');
    meta.className = 'result-meta';
    meta.textContent = C.formatBytes(totalBefore) + ' → ' + C.formatBytes(totalAfter) + ' · saves ' + C.formatBytes(saved);
    var actions = document.createElement('div');
    actions.className = 'result-actions';

    if (entries.length === 1) {
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn-primary';
      save.textContent = 'download';
      save.addEventListener('click', function () {
        download(entries[0].blob, entries[0].fileName);
      });
      actions.appendChild(save);
    } else {
      var zip = document.createElement('button');
      zip.type = 'button';
      zip.className = 'btn btn-primary';
      zip.textContent = 'download zip (' + entries.length + ')';
      zip.addEventListener('click', async function () {
        zip.disabled = true;
        var original = zip.textContent;
        try {
          var blob = await zipEntries(entries, function (percent) {
            zip.textContent = 'zip ' + Math.round(percent) + '%';
          });
          download(blob, 'opti-' + Date.now() + '.zip');
          toast('ZIP downloaded.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          zip.disabled = false;
          zip.textContent = original;
        }
      });
      actions.appendChild(zip);
    }

    box.appendChild(name);
    box.appendChild(meta);
    box.appendChild(actions);
    zone.appendChild(box);
  }

  function imageRunLabel(label, files) {
    var pending = pendingItems(files).length;
    if (!files.items.length) return label;
    if (!pending) return 'all done';
    return label + ' ' + pending + (pending === 1 ? ' file' : ' files');
  }

  // ---------------------------------------------------------- image views --

  function renderSqueeze(tool) {
    var settings = app.settings;
    main.innerHTML = toolShell(
      tool,
      '<div class="tool-layout">' +
        '<div class="col-main">' +
          uploaderHtml('files', { accept: 'all', multiple: true, title: 'Select files', sub: 'images, HEIC and PDFs · up to 200 MB each' }) +
          '<ul class="queue" id="fileList" hidden></ul>' +
          '<div id="resultZone"></div>' +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="panel" id="imagePanel">' +
            '<h2 class="panel-title">image output</h2>' +
            qualityField('quality') +
            formatField('format') +
            '<div class="field"><div class="field-head"><label class="field-label" for="scale">resize</label><span class="value" id="scaleOut">100%</span></div>' +
              '<input type="range" class="range" id="scale" min="20" max="100" step="5" value="100">' +
              '<div class="range-scale"><span>20%</span><span>100%</span></div>' +
            '</div>' +
            targetField('target') +
          '</div>' +
          '<div class="panel" id="pdfPanel" hidden>' +
            '<h2 class="panel-title">pdf output</h2>' +
            '<div class="field"><label class="field-label" for="pdfMode">engine</label>' +
              '<select class="select" id="pdfMode">' +
                '<option value="raster">rasterise — smallest</option>' +
                '<option value="structure">keep text selectable</option>' +
              '</select>' +
              '<p class="hint" id="pdfHint"></p>' +
            '</div>' +
            '<div class="field" id="pdfDpiField"><label class="field-label" for="pdfDpi">page resolution</label>' +
              '<select class="select" id="pdfDpi">' +
                '<option value="72">72 dpi — email</option>' +
                '<option value="150">150 dpi — screen</option>' +
                '<option value="200">200 dpi — detail</option>' +
                '<option value="300">300 dpi — print</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<p class="hint" id="mixNote" hidden>Image settings apply to images; PDF settings apply to PDFs.</p>' +
          '<div class="summary" id="summary"></div>' +
          '<div class="run-bar">' +
            '<button type="button" class="btn btn-primary btn-wide" id="runBtn" disabled>squeeze</button>' +
            '<div class="run-status"><span class="bar"><i id="runBar"></i></span><span id="runStatus">ready</span></div>' +
          '</div>' +
        '</aside>' +
      '</div>'
    );
    mountImageTool({
      files: new Files({ accept: 'all', multiple: true, onChange: null }),
      options: function () { return engineOptions(); },
      actionLabel: 'squeeze',
      requireSupportedCustom: true,
      outputSuffix: 'squeezed'
    });
    document.title = 'Squeeze — Opti';
  }

  function renderCrop(tool) {
    var settings = app.settings;
    main.innerHTML = toolShell(
      tool,
      '<div class="tool-layout">' +
        '<div class="col-main">' +
          uploaderHtml('files', { accept: 'images', multiple: true, title: 'Select images', sub: 'or drop them here' }) +
          '<ul class="queue" id="fileList" hidden></ul>' +
          '<div class="panel" id="previewPanel">' +
            '<h2 class="panel-title">preview · first image</h2>' +
            '<div class="preview" id="preview"><div class="preview-empty" id="previewEmpty">add an image to preview</div><canvas id="previewCanvas" hidden></canvas></div>' +
            '<p class="hint mt-8" id="previewNote"></p>' +
          '</div>' +
          '<div id="resultZone"></div>' +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="panel">' +
            '<h2 class="panel-title">crop &amp; size</h2>' +
            '<div class="field"><label class="field-label" for="preset">preset</label>' +
              '<select class="select" id="preset"></select>' +
              '<p class="hint" id="presetNote"></p>' +
            '</div>' +
            '<div class="field"><span class="field-label">size</span>' +
              '<div class="input-row">' +
                '<input class="input" type="number" id="cropW" min="1" max="20000" placeholder="width" aria-label="Width in pixels">' +
                '<input class="input" type="number" id="cropH" min="1" max="20000" placeholder="height" aria-label="Height in pixels">' +
              '</div>' +
              '<p class="hint" id="sizeHint"></p>' +
            '</div>' +
            '<div class="field"><span class="field-label">framing</span>' +
              '<div class="seg" id="fitSeg"><button type="button" data-fit="fill">crop to fill</button><button type="button" data-fit="fit">fit inside</button></div>' +
              '<div class="anchors" id="anchors" role="group" aria-label="Crop anchor">' +
                ['top-left','top','top-right','left','center','right','bottom-left','bottom','bottom-right'].map(function (anchor) {
                  return '<button type="button" data-anchor="' + anchor + '" aria-label="Anchor ' + anchor.replace('-', ' ') + '"></button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<div class="field"><span class="field-label">background</span>' +
              '<div class="seg" id="bgSeg"><button type="button" data-bg="white">white</button><button type="button" data-bg="black">black</button><button type="button" data-bg="transparent">none</button></div>' +
            '</div>' +
          '</div>' +
          '<div class="panel">' +
            '<h2 class="panel-title">output</h2>' +
            qualityField('quality') +
            formatField('format') +
            targetField('target') +
          '</div>' +
          '<div class="summary" id="summary"></div>' +
          '<div class="run-bar">' +
            '<button type="button" class="btn btn-primary btn-wide" id="runBtn" disabled>crop &amp; squeeze</button>' +
            '<div class="run-status"><span class="bar"><i id="runBar"></i></span><span id="runStatus">ready</span></div>' +
          '</div>' +
        '</aside>' +
      '</div>'
    );
    fillPresetSelect();
    mountImageTool({
      files: new Files({ accept: 'images', multiple: true, onChange: null }),
      options: function () {
        return engineOptions({
          resizeMode: 'exact',
          customWidth: app.settings.cropWidth,
          customHeight: app.settings.cropHeight,
          fitMode: app.settings.fitMode,
          anchor: app.settings.anchor,
          background: app.settings.background
        });
      },
      actionLabel: 'crop & squeeze',
      requireSupportedCustom: true,
      crop: true,
      outputSuffix: function (item, result) { return 'cropped-' + result.width + 'x' + result.height; }
    });
    document.title = 'Crop & size — Opti';
  }

  function renderConvert(tool) {
    main.innerHTML = toolShell(
      tool,
      '<div class="tool-layout">' +
        '<div class="col-main">' +
          uploaderHtml('files', { accept: 'images', multiple: true, title: 'Select images', sub: 'or drop them here' }) +
          '<ul class="queue" id="fileList" hidden></ul>' +
          '<div id="resultZone"></div>' +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="panel">' +
            '<h2 class="panel-title">convert</h2>' +
            formatField('format') +
            qualityField('quality') +
            '<div class="field"><div class="field-head"><label class="field-label" for="scale">scale</label><span class="value" id="scaleOut">100%</span></div>' +
              '<input type="range" class="range" id="scale" min="20" max="100" step="5" value="100">' +
              '<div class="range-scale"><span>20%</span><span>100%</span></div></div>' +
            targetField('target') +
          '</div>' +
          '<div class="summary" id="summary"></div>' +
          '<div class="run-bar">' +
            '<button type="button" class="btn btn-primary btn-wide" id="runBtn" disabled>convert</button>' +
            '<div class="run-status"><span class="bar"><i id="runBar"></i></span><span id="runStatus">ready</span></div>' +
          '</div>' +
        '</aside>' +
      '</div>'
    );
    mountImageTool({
      files: new Files({ accept: 'images', multiple: true, onChange: null }),
      options: function () { return engineOptions(); },
      actionLabel: 'convert',
      requireSupportedCustom: true,
      outputSuffix: 'converted'
    });
    document.title = 'Convert — Opti';
  }

  function renderCompressPdf(tool) {
    main.innerHTML = toolShell(
      tool,
      '<div class="tool-layout">' +
        '<div class="col-main">' +
          uploaderHtml('files', { accept: 'pdf', multiple: true, title: 'Select PDFs', sub: 'or drop them here' }) +
          '<ul class="queue" id="fileList" hidden></ul>' +
          '<div id="resultZone"></div>' +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="panel">' +
            '<h2 class="panel-title">pdf output</h2>' +
            '<div class="field"><label class="field-label" for="pdfMode">engine</label>' +
              '<select class="select" id="pdfMode"><option value="raster">rasterise — smallest</option><option value="structure">keep text selectable</option></select>' +
              '<p class="hint" id="pdfHint"></p>' +
            '</div>' +
            '<div class="field" id="pdfDpiField"><label class="field-label" for="pdfDpi">page resolution</label>' +
              '<select class="select" id="pdfDpi"><option value="72">72 dpi</option><option value="150">150 dpi</option><option value="200">200 dpi</option><option value="300">300 dpi</option></select>' +
            '</div>' +
            qualityField('quality') +
          '</div>' +
          '<div class="summary" id="summary"></div>' +
          '<div class="run-bar">' +
            '<button type="button" class="btn btn-primary btn-wide" id="runBtn" disabled>compress</button>' +
            '<div class="run-status"><span class="bar"><i id="runBar"></i></span><span id="runStatus">ready</span></div>' +
          '</div>' +
        '</aside>' +
      '</div>'
    );
    mountImageTool({
      files: new Files({ accept: 'pdf', multiple: true, onChange: null }),
      options: function () { return engineOptions({ format: 'auto', targetEnabled: false }); },
      actionLabel: 'compress',
      outputSuffix: 'compressed'
    });
    document.title = 'Compress PDF — Opti';
  }

  // ---------------------------------------------------- image tool mounting --

  function mountImageTool(config) {
    var files = config.files;
    app.currentFiles = files;
    var list = main.querySelector('#fileList');
    var summary = main.querySelector('#summary');
    var runBtn = main.querySelector('#runBtn');
    var runBar = main.querySelector('#runBar');
    var runStatus = main.querySelector('#runStatus');
    var resultZone = main.querySelector('#resultZone');
    var root = main;
    var estimates = new Map();
    var measuring = false;

    var estimator = new Estimator(files, config.options, function (map, isMeasuring) {
      estimates = map;
      measuring = isMeasuring;
      updateSummary(summary, files, estimates, measuring);
    });

    function refresh() {
      renderList(list, files, {
        reorder: false,
        compare: true,
        onRetry: function (item) {
          runItems([item]);
        }
      });
      updateSummary(summary, files, estimates, measuring);
      showImageResults(resultZone, files, 'files');
      updateRun();
    }

    files.onChange = function (type) {
      if (type === 'structure') {
        refresh();
        estimator.schedule();
        syncPanels();
      } else if (type === 'probe') {
        refresh();
        estimator.schedule();
        updatePreview();
      }
    };

    function updateRun() {
      var pending = pendingItems(files).length;
      var options = config.options();
      var ok = canRunImages(files, options, config.requireSupportedCustom);
      runBtn.disabled = app.busy || !ok || pending === 0;
      runBtn.textContent = app.busy ? 'working…' : imageRunLabel(config.actionLabel, files);
      if (!files.items.length) runBtn.textContent = config.actionLabel;
      if (ok && files.items.length && pending === 0) runBtn.textContent = 'all done';
    }

    function syncPanels() {
      var hasPdf = files.items.some(function (item) { return item.kind === 'pdf'; });
      var hasImage = files.items.some(function (item) { return item.kind !== 'pdf'; });
      var pdfPanel = main.querySelector('#pdfPanel');
      var imagePanel = main.querySelector('#imagePanel');
      var mixNote = main.querySelector('#mixNote');
      if (pdfPanel) pdfPanel.hidden = !hasPdf;
      if (imagePanel) imagePanel.hidden = files.items.length > 0 && !hasImage;
      if (mixNote) mixNote.hidden = !(hasPdf && hasImage);
    }

    async function runItems(specific) {
      if (app.busy) return;
      var options = config.options();
      if (config.requireSupportedCustom && options.format === 'custom' && (!options.customMime || !E.supportsType(options.customMime))) {
        toast('This browser cannot encode that custom type.', 'error');
        return;
      }
      app.busy = true;
      runBtn.disabled = true;
      runBtn.textContent = 'working…';
      runBar.style.width = '0%';
      runStatus.textContent = 'starting';
      resultZone.textContent = '';
      var targets = specific ? (Array.isArray(specific) ? specific : [specific]) : pendingItems(files);
      targets.forEach(function (item) { item.stale = false; });
      renderList(list, files, { reorder: false, compare: true, onRetry: runItems });
      estimator.destroy();

      try {
        await processImageItems(files, options, list, function (item, phase) {
          if (phase === 'start') {
            runStatus.textContent = 'compressing ' + item.name;
          } else {
            runStatus.textContent = item.status === 'done' ? 'done · ' + item.name : 'failed · ' + item.name;
            renderList(list, files, { reorder: false, compare: true, onRetry: runItems });
            updateSummary(summary, files, estimates, measuring);
          }
        }, targets, config.outputSuffix);

        var done = files.items.filter(function (item) { return item.status === 'done'; });
        var failed = files.items.filter(function (item) { return item.status === 'error'; });
        runBar.style.width = '100%';
        runStatus.textContent = done.length + ' done' + (failed.length ? ' · ' + failed.length + ' failed' : '');
        renderList(list, files, { reorder: false, compare: true, onRetry: runItems });
        showImageResults(resultZone, files, 'files');
        updateSummary(summary, files, estimates, measuring);
        var completed = files.items.filter(function (item) { return item.result && !item.stale; });
        if (completed.length === 1) {
          var only = completed[0];
          toast(only.result.fileName + ' ready.', 'ok', {
            label: 'download',
            onClick: function () { download(only.result.blob, only.result.fileName); }
          });
          announce(only.result.fileName + ' ready to download.');
        } else if (completed.length) {
          var zipButton = resultZone.querySelector('.result .btn-primary');
          toast(completed.length + ' files ready.', 'ok', zipButton ? {
            label: 'zip',
            onClick: function () { zipButton.click(); }
          } : null);
          announce(completed.length + ' files ready.');
        }
        revealResult(resultZone);
        if (failed.length) toast(failed.length + ' failed — see the rows.', 'error');
      } catch (err) {
        runStatus.textContent = 'failed';
        toast(err && err.message ? err.message : 'Something went wrong.', 'error');
      } finally {
        app.busy = false;
        estimator = new Estimator(files, config.options, function (map, isMeasuring) {
          estimates = map;
          measuring = isMeasuring;
          updateSummary(summary, files, estimates, measuring);
        });
        estimator.schedule();
        updateRun();
      }
    }

    bindListActions(list, files, {
      reorder: false,
      compare: true,
      onRetry: function (item) { runItems([item]); }
    });

    runBtn.addEventListener('click', function () {
      runItems();
    });

    // settings
    bindQuality(
      root,
      'quality',
      function () { return app.settings.quality; },
      function (value) {
        updateSettings({ quality: value, presetId: 'custom' });
      },
      function () {
        markStale(files);
        refresh();
        estimator.schedule();
        updateRun();
      }
    );

    var formatBinder = bindFormat(
      root,
      'format',
      function (key) { return key ? app.settings[key] : app.settings.format; },
      function (key, value) {
        if (key === 'customMime') updateSettings({ customMime: value });
        else updateSettings({ format: key });
      },
      function () {
        markStale(files);
        refresh();
        estimator.schedule();
        updateRun();
      }
    );

    bindTarget(
      root,
      'target',
      function (key) { return app.settings[key]; },
      function (key, value) { updateSettings({ [key]: value }); },
      function () {
        markStale(files);
        refresh();
        estimator.schedule();
        updateRun();
      }
    );

    var scaleInput = root.querySelector('#scale');
    if (scaleInput) {
      bindScale(
        root,
        'scale',
        function () { return app.settings.scale; },
        function (value) {
          updateSettings({ scale: value });
        },
        function () {
          markStale(files);
          refresh();
          estimator.schedule();
          updateRun();
        }
      );
    }

    var pdfMode = root.querySelector('#pdfMode');
    if (pdfMode) {
      pdfMode.value = app.settings.pdfMode;
      var pdfDpi = root.querySelector('#pdfDpi');
      pdfDpi.value = String(app.settings.pdfDpi);
      var pdfHint = root.querySelector('#pdfHint');
      var pdfDpiField = root.querySelector('#pdfDpiField');
      function syncPdf() {
        pdfDpiField.hidden = pdfMode.value === 'structure';
        pdfHint.textContent = pdfMode.value === 'structure'
          ? 'Re-saves the document structure and keeps text selectable. Savings are modest.'
          : 'Rasterises pages to images. Text becomes non-selectable.';
      }
      pdfMode.addEventListener('change', function () {
        updateSettings({ pdfMode: pdfMode.value });
        syncPdf();
        markStale(files);
        refresh();
        estimator.schedule();
      });
      pdfDpi.addEventListener('change', function () {
        updateSettings({ pdfDpi: Number(pdfDpi.value) });
        markStale(files);
        refresh();
        estimator.schedule();
      });
      syncPdf();
    }

    var presetSelect = root.querySelector('#preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', function () {
        var preset = Presets.byId(presetSelect.value);
        if (!preset) {
          updateSettings({ presetId: 'custom' });
          syncCropControls();
          return;
        }
        applyPreset(preset);
      });
      var cropW = root.querySelector('#cropW');
      var cropH = root.querySelector('#cropH');
      cropW.addEventListener('input', function () {
        updateSettings({ presetId: 'custom', cropWidth: cropW.value });
        syncCropControls();
      });
      cropH.addEventListener('input', function () {
        updateSettings({ presetId: 'custom', cropHeight: cropH.value });
        syncCropControls();
      });
      root.querySelector('#fitSeg').addEventListener('click', function (event) {
        var button = event.target.closest('[data-fit]');
        if (!button) return;
        updateSettings({ fitMode: button.dataset.fit, presetId: 'custom' });
        syncCropControls();
      });
      root.querySelector('#anchors').addEventListener('click', function (event) {
        var button = event.target.closest('[data-anchor]');
        if (!button) return;
        updateSettings({ anchor: button.dataset.anchor });
        syncCropControls();
      });
      root.querySelector('#bgSeg').addEventListener('click', function (event) {
        var button = event.target.closest('[data-bg]');
        if (!button) return;
        updateSettings({ background: button.dataset.bg, presetId: 'custom' });
        syncCropControls();
      });
      syncCropControls();
    }

    function applyPreset(preset) {
      updateSettings({
        presetId: preset.id,
        cropWidth: preset.width,
        cropHeight: preset.height,
        fitMode: preset.fit,
        background: preset.background,
        targetEnabled: !!preset.maxKB,
        targetMode: 'atMost',
        targetKB: preset.maxKB || app.settings.targetKB
      });
      bindTargetRefresh();
      syncCropControls();
      toast(preset.label + ' preset applied.', 'ok');
    }

    function bindTargetRefresh() {
      var toggle = root.querySelector('#targetToggle');
      var body = root.querySelector('#targetBody');
      var kb = root.querySelector('#targetKB');
      var mode = root.querySelector('#targetMode');
      var hint = root.querySelector('#targetHint');
      if (!toggle) return;
      toggle.checked = app.settings.targetEnabled;
      body.hidden = !app.settings.targetEnabled;
      if (document.activeElement !== kb) kb.value = String(app.settings.targetKB);
      mode.value = app.settings.targetMode;
      hint.className = 'hint mt-8';
      if (!(Number(app.settings.targetKB) > 0)) {
        hint.textContent = 'Enter a target above 0 KB to enable the run.';
        hint.classList.add('is-error');
        return;
      }
      hint.textContent = app.settings.targetMode === 'exact'
        ? 'Pads with harmless metadata to land exactly on ' + C.formatBytes(C.kbToBytes(app.settings.targetKB)) + '.'
        : 'Stays at or under ' + C.formatBytes(C.kbToBytes(app.settings.targetKB)) + '.';
    }

    function syncCropControls() {
      var s = app.settings;
      var preset = Presets.byId(s.presetId);
      presetSelect.value = preset ? preset.id : 'custom';
      root.querySelector('#cropW').value = s.cropWidth || '';
      root.querySelector('#cropH').value = s.cropHeight || '';
      root.querySelector('#presetNote').textContent = preset
        ? (preset.detail || '') + ' — commonly cited; confirm with the authority.'
        : 'Custom size. Crop to fill removes edges; fit inside adds a border.';
      root.querySelectorAll('#fitSeg [data-fit]').forEach(function (button) {
        var active = button.dataset.fit === s.fitMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      root.querySelectorAll('#anchors [data-anchor]').forEach(function (button) {
        var active = button.dataset.anchor === s.anchor;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      root.querySelectorAll('#bgSeg [data-bg]').forEach(function (button) {
        var active = button.dataset.bg === s.background;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      var w = C.toPositiveInt(s.cropWidth);
      var h = C.toPositiveInt(s.cropHeight);
      var hint = root.querySelector('#sizeHint');
      if (w && h) {
        var ratio = (w / h).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
        hint.textContent = w + ' × ' + h + ' px · ratio ' + ratio;
      } else {
        hint.textContent = 'Leave blank to keep the original dimensions.';
      }
      markStale(files);
      refresh();
      estimator.schedule();
      updatePreview();
      updateRun();
    }

    // crop preview
    function updatePreview() {
      var canvas = root.querySelector('#previewCanvas');
      if (!canvas) return;
      var empty = root.querySelector('#previewEmpty');
      var note = root.querySelector('#previewNote');
      var item = files.items.find(function (entry) { return entry.sample && entry.meta; });
      if (!item) {
        canvas.hidden = true;
        empty.hidden = false;
        note.textContent = '';
        var resetWrap = root.querySelector('#preview');
        if (resetWrap) resetWrap.classList.remove('is-alpha');
        return;
      }
      var s = app.settings;
      var w = C.toPositiveInt(s.cropWidth) || item.meta.width;
      var h = C.toPositiveInt(s.cropHeight) || item.meta.height;
      var max = 520;
      var scale = Math.min(1, max / Math.max(w, h));
      canvas.width = Math.max(24, Math.round(w * scale));
      canvas.height = Math.max(24, Math.round(h * scale));
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var background = s.background;
      if (background !== 'transparent') {
        ctx.fillStyle = background === 'black' ? '#000000' : '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      var geom = C.computeCropRect(item.sample.width, item.sample.height, canvas.width, canvas.height, s.fitMode, s.anchor);
      if (geom.mode === 'fill') {
        ctx.drawImage(item.sample, geom.sx, geom.sy, geom.sWidth, geom.sHeight, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.drawImage(item.sample, geom.dx, geom.dy, geom.dWidth, geom.dHeight);
      }
      canvas.hidden = false;
      empty.hidden = true;
      var wrap = root.querySelector('#preview');
      if (wrap) wrap.classList.toggle('is-alpha', background === 'transparent');
      note.textContent = 'preview · first image · output ' + w + '×' + h + ' px';
    }

    // label sync for quality etc.
    function syncLabels() {
      var quality = root.querySelector('#quality');
      var out = root.querySelector('#qualityOut');
      if (quality) {
        quality.value = String(app.settings.quality);
        out.textContent = String(app.settings.quality);
        setRangeFill(quality);
      }
      var scaleEl = root.querySelector('#scale');
      if (scaleEl) {
        scaleEl.value = String(app.settings.scale);
        root.querySelector('#scaleOut').textContent = app.settings.scale + '%';
        setRangeFill(scaleEl);
      }
      formatBinder.refresh();
      bindTargetRefresh();
      syncCropControls();
    }

    // initial state
    if (config.crop) {
      syncCropControls();
      updatePreview();
    }
    bindUploader('files', function (selected) {
      files.add(selected);
      syncPanels();
      updatePreview();
    });
    app.dropHandler = function (selected) {
      files.add(selected);
      syncPanels();
      updatePreview();
    };
    files.notify('structure');
    // apply persisted values without marking stale
    if (root.querySelector('#quality')) {
      root.querySelector('#quality').value = String(app.settings.quality);
      root.querySelector('#qualityOut').textContent = String(app.settings.quality);
      setRangeFill(root.querySelector('#quality'));
    }
    if (!config.crop) {
      bindTargetRefresh();
    }
    updateRun();
    if (app.pendingFiles) {
      var pending = app.pendingFiles;
      app.pendingFiles = null;
      files.add(pending);
      syncPanels();
    }
    onCleanup(function () {
      estimator.destroy();
      files.cleanup();
      if (app.currentFiles === files) app.currentFiles = null;
    });
  }

  // ------------------------------------------------------------- pdf views --

  function pdfLayout(tool, options) {
    var opts = options || {};
    main.innerHTML = toolShell(
      tool,
      '<div class="tool-layout">' +
        '<div class="col-main">' +
          uploaderHtml('files', {
            accept: opts.accept || 'pdf',
            multiple: !!opts.multiple,
            title: opts.title || (opts.accept === 'images' ? 'Select images' : 'Select a PDF'),
            sub: opts.sub || 'or drop it here'
          }) +
          '<div class="notice" id="toolNotice" hidden></div>' +
          '<ul class="queue" id="fileList" hidden></ul>' +
          '<div id="resultZone"></div>' +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="panel" id="sidePanel">' + (opts.side || '') + '</div>' +
          '<div class="run-bar">' +
            '<button type="button" class="btn btn-primary btn-wide" id="runBtn" disabled>' + (opts.action || 'run') + '</button>' +
            '<div class="run-status"><span class="bar"><i id="runBar"></i></span><span id="runStatus">ready</span></div>' +
          '</div>' +
        '</aside>' +
      '</div>'
    );
  }

  function mountPdfTool(tool, config) {
    var files = new Files({
      accept: config.accept || 'pdf',
      multiple: !!config.multiple,
      probeMode: config.probeMode || 'auto',
      max: config.max || 40,
      onChange: null
    });
    app.currentFiles = files;
    var list = main.querySelector('#fileList');
    var resultZone = main.querySelector('#resultZone');
    var runBtn = main.querySelector('#runBtn');
    var runBar = main.querySelector('#runBar');
    var runStatus = main.querySelector('#runStatus');
    var notice = main.querySelector('#toolNotice');
    var ctx = {
      files: files,
      root: main,
      notice: notice,
      setNotice: function (message, warn) {
        if (!notice) return;
        notice.hidden = !message;
        notice.textContent = message || '';
        notice.className = 'notice' + (warn ? ' is-warn' : '');
      },
      render: function () {
        renderList(list, files, { reorder: !!config.multiple, compare: false, onRetry: null });
        updateRun();
        if (config.onChange) config.onChange(ctx);
      },
      setProgress: function (percent, label) {
        runBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
        if (label) runStatus.textContent = label;
      },
      showResult: function (entries, label) {
        showPdfResults(resultZone, entries, label);
      },
      showError: function (message) {
        resultZone.textContent = '';
        var box = document.createElement('div');
        box.className = 'notice is-warn';
        box.textContent = message;
        resultZone.appendChild(box);
        toast(message, 'error');
      },
      setBusy: function (busy) {
        app.busy = busy;
        runBtn.disabled = busy;
        runBtn.textContent = busy ? 'working…' : config.action;
        if (!busy) updateRun();
      },
      pages: function () {
        var item = files.items[0];
        return item && item.meta && item.meta.pages ? item.meta.pages : 0;
      }
    };

    function updateRun() {
      if (app.busy) return;
      runBtn.disabled = !files.items.length || (config.canRun ? !config.canRun(ctx) : false);
      runBtn.textContent = config.action;
    }

    files.onChange = function (type) {
      ctx.render();
    };

    bindListActions(list, files, { reorder: !!config.multiple, compare: false, onRetry: null });
    bindUploader('files', function (selected) {
      files.add(selected);
    });
    app.dropHandler = function (selected) {
      files.add(selected);
    };

    runBtn.addEventListener('click', async function () {
      if (app.busy) return;
      var valid = config.validate ? config.validate(ctx) : true;
      if (valid === false) return;
      if (typeof valid === 'string') {
        ctx.showError(valid);
        return;
      }
      ctx.setBusy(true);
      runBar.style.width = '0%';
      runStatus.textContent = 'starting';
      resultZone.textContent = '';
      try {
        var entries = await config.run(ctx, function (percent, label) {
          ctx.setProgress(percent, label);
        });
        if (!entries || !entries.length) throw new Error('Nothing was produced.');
        ctx.setProgress(100, 'done');
        ctx.showResult(entries, config.resultLabel || 'file');
        if (entries.length === 1) {
          var entry = entries[0];
          toast(entry.fileName + ' ready.', 'ok', {
            label: 'download',
            onClick: function () { download(entry.blob, entry.fileName); }
          });
          announce(entry.fileName + ' ready to download.');
        } else {
          var zipButton = resultZone.querySelector('.result .btn-primary');
          toast(entries.length + ' files ready.', 'ok', zipButton ? {
            label: 'zip',
            onClick: function () { zipButton.click(); }
          } : null);
          announce(entries.length + ' files ready.');
        }
        revealResult(resultZone);
      } catch (err) {
        ctx.showError(err && err.message ? err.message : 'Something went wrong.');
        runStatus.textContent = 'failed';
      } finally {
        ctx.setBusy(false);
      }
    });

    if (config.mount) config.mount(ctx);
    if (app.pendingFiles) {
      var pending = app.pendingFiles;
      app.pendingFiles = null;
      files.add(pending);
    }
    ctx.render();
    onCleanup(function () {
      files.cleanup();
      if (app.currentFiles === files) app.currentFiles = null;
    });
    return ctx;
  }

  function showPdfResults(zone, entries, label) {
    zone.textContent = '';
    var box = document.createElement('div');
    box.className = 'result';
    var name = document.createElement('p');
    name.className = 'result-name';
    name.textContent = entries.length === 1 ? entries[0].fileName : entries.length + ' ' + label;
    var meta = document.createElement('p');
    meta.className = 'result-meta';
    var total = entries.reduce(function (sum, entry) { return sum + entry.blob.size; }, 0);
    meta.textContent = C.formatBytes(total) + (entries.length > 1 ? ' total' : '');
    var actions = document.createElement('div');
    actions.className = 'result-actions';

    if (entries.length === 1) {
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn-primary';
      save.textContent = 'download';
      save.addEventListener('click', function () {
        download(entries[0].blob, entries[0].fileName);
      });
      actions.appendChild(save);
    } else {
      var zip = document.createElement('button');
      zip.type = 'button';
      zip.className = 'btn btn-primary';
      zip.textContent = 'download zip (' + entries.length + ')';
      zip.addEventListener('click', async function () {
        zip.disabled = true;
        var original = zip.textContent;
        try {
          var blob = await zipEntries(entries, function (percent) {
            zip.textContent = 'zip ' + Math.round(percent) + '%';
          });
          download(blob, 'opti-' + Date.now() + '.zip');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          zip.disabled = false;
          zip.textContent = original;
        }
      });
      actions.appendChild(zip);
    }

    box.appendChild(name);
    box.appendChild(meta);
    box.appendChild(actions);

    if (entries.length > 1) {
      var list = document.createElement('ul');
      list.className = 'result-list';
      entries.forEach(function (entry) {
        var li = document.createElement('li');
        var n = document.createElement('span');
        n.textContent = entry.fileName;
        var s = document.createElement('span');
        s.textContent = C.formatBytes(entry.blob.size);
        li.appendChild(n);
        li.appendChild(s);
        list.appendChild(li);
      });
      box.appendChild(list);
    }
    zone.appendChild(box);
  }

  function pageHint(root, id, text, warn) {
    var el = root.querySelector('#' + id);
    if (!el) return;
    el.textContent = text;
    el.className = 'hint' + (warn ? ' is-error' : '');
  }

  function pagesField(id, label, value, placeholder) {
    return (
      '<div class="field"><label class="field-label" for="' + id + '">' + label + '</label>' +
        '<input class="input pages-input" id="' + id + '" value="' + value + '" placeholder="' + (placeholder || '1-3, 5') + '" spellcheck="false">' +
        '<p class="hint" id="' + id + 'Hint">Add a PDF first.</p>' +
      '</div>'
    );
  }

  // merge

  function renderMerge(tool) {
    pdfLayout(tool, {
      multiple: true,
      title: 'Select PDFs',
      sub: 'or drop them here — order is top to bottom',
      action: 'merge pdfs',
      side: '<h2 class="panel-title">merge</h2><p class="hint">Combine PDFs into one file. Use ↑ and ↓ on each row to set the order.</p>'
    });
    mountPdfTool(tool, {
      accept: 'pdf',
      multiple: true,
      action: 'merge pdfs',
      resultLabel: 'pdf',
      canRun: function (ctx) { return ctx.files.items.length >= 2 && ctx.files.items.every(function (i) { return !i.error; }); },
      validate: function (ctx) {
        if (ctx.files.items.length < 2) return 'Add at least two PDFs.';
        if (ctx.files.items.some(function (i) { return i.error; })) return 'Remove the unreadable PDFs first.';
        return true;
      },
      run: async function (ctx, progress) {
        var result = await P.merge(ctx.files.items.map(function (item) { return item.file; }), progress);
        return [result];
      }
    });
  }

  // split

  function renderSplit(tool) {
    pdfLayout(tool, {
      action: 'split pdf',
      side:
        '<h2 class="panel-title">split</h2>' +
        '<div class="field"><span class="field-label">mode</span>' +
          '<div class="seg" id="splitMode"><button type="button" data-mode="every">every N pages</button><button type="button" data-mode="ranges">custom ranges</button></div>' +
        '</div>' +
        '<div class="field" id="splitEveryField"><label class="field-label" for="splitEvery">pages per file</label>' +
          '<input class="input" type="number" id="splitEvery" min="1" max="500" value="10">' +
        '</div>' +
        '<div class="field" id="splitRangesField">' +
          '<label class="field-label" for="splitRanges">ranges</label>' +
          '<input class="input pages-input" id="splitRanges" placeholder="1-3; 4-10; 11-" spellcheck="false">' +
          '<p class="hint">Separate parts with <code>;</code>. A trailing dash means “to the end”.</p>' +
        '</div>' +
        '<p class="hint" id="splitHint">Add a PDF first.</p>'
    });
    var ctxRef = null;
    function sync() {
      var mode = main.querySelector('#splitMode .is-active');
      var every = mode && mode.dataset.mode === 'every';
      main.querySelector('#splitEveryField').hidden = !!every ? false : true;
      main.querySelector('#splitRangesField').hidden = every ? true : false;
      if (!ctxRef) return;
      var pages = ctxRef.pages();
      var hint = main.querySelector('#splitHint');
      if (!pages) {
        hint.textContent = 'Add a PDF first.';
        return;
      }
      if (every) {
        var n = Math.max(1, Number(main.querySelector('#splitEvery').value) || 1);
        hint.textContent = 'Will produce ' + Math.ceil(pages / n) + ' PDFs from ' + pages + ' pages.';
      } else {
        var parsed = C.parseSplitSpec(main.querySelector('#splitRanges').value, pages, 'ranges');
        hint.textContent = parsed.errors.length ? parsed.errors[0] : 'Will produce ' + parsed.parts.length + ' PDF' + (parsed.parts.length === 1 ? '' : 's') + '.';
        hint.className = 'hint' + (parsed.errors.length ? ' is-error' : '');
      }
    }
    mountPdfTool(tool, {
      action: 'split pdf',
      resultLabel: 'pdf parts',
      mount: function (ctx) {
        ctxRef = ctx;
        var modeWrap = main.querySelector('#splitMode');
        modeWrap.addEventListener('click', function (event) {
          var button = event.target.closest('[data-mode]');
          if (!button) return;
          modeWrap.querySelectorAll('button').forEach(function (b) {
            var active = b === button;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-pressed', String(active));
          });
          sync();
        });
        main.querySelector('#splitEvery').addEventListener('input', sync);
        main.querySelector('#splitRanges').addEventListener('input', sync);
        modeWrap.querySelector('[data-mode="every"]').classList.add('is-active');
        modeWrap.querySelector('[data-mode="every"]').setAttribute('aria-pressed', 'true');
        modeWrap.querySelector('[data-mode="ranges"]').setAttribute('aria-pressed', 'false');
        ctx.files.onChange = function () {
          ctx.render();
          var pages = ctx.pages();
          if (pages && !main.querySelector('#splitRanges').value) {
            var half = Math.ceil(pages / 2);
            main.querySelector('#splitRanges').value = pages > 1 ? '1-' + half + '; ' + (half + 1) + '-' + pages : '1';
          }
          sync();
        };
        sync();
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        var pages = ctx.pages();
        if (!pages) return 'Add a readable PDF first.';
        var every = main.querySelector('#splitMode .is-active').dataset.mode === 'every';
        var parsed;
        if (every) {
          var n = Math.max(1, Number(main.querySelector('#splitEvery').value) || 1);
          parsed = C.parseSplitSpec('', pages, 'every', n);
        } else {
          parsed = C.parseSplitSpec(main.querySelector('#splitRanges').value, pages, 'ranges');
        }
        if (parsed.errors.length) return parsed.errors[0];
        if (!parsed.parts.length) return 'Add at least one page range.';
        return true;
      },
      run: async function (ctx, progress) {
        var pages = ctx.pages();
        var every = main.querySelector('#splitMode .is-active').dataset.mode === 'every';
        var parts;
        if (every) {
          parts = C.parseSplitSpec('', pages, 'every', Math.max(1, Number(main.querySelector('#splitEvery').value) || 1)).parts;
        } else {
          parts = C.parseSplitSpec(main.querySelector('#splitRanges').value, pages, 'ranges').parts;
        }
        return P.split(ctx.files.items[0].file, parts, progress);
      }
    });
    sync();
  }

  // extract / delete

  function renderExtract(tool) {
    pdfLayout(tool, {
      action: 'extract pages',
      side:
        '<h2 class="panel-title">extract</h2>' +
        pagesField('pages', 'pages to keep', '', '1-3, 5') +
        '<p class="hint">A new PDF containing only the pages you list.</p>'
    });
    var ctxRef = null;
    mountPdfTool(tool, {
      action: 'extract pages',
      resultLabel: 'pdf',
      mount: function (ctx) {
        ctxRef = ctx;
        var input = main.querySelector('#pages');
        function sync() {
          var pages = ctx.pages();
          if (!pages) {
            pageHint(main, 'pagesHint', 'Add a PDF first.');
            return;
          }
          var parsed = C.parsePageSpec(input.value, pages);
          if (parsed.errors.length) {
            pageHint(main, 'pagesHint', parsed.errors[0], true);
          } else {
            pageHint(main, 'pagesHint', parsed.pages.length + ' of ' + pages + ' pages selected.');
            input.value = input.value || '1-' + pages;
          }
        }
        input.addEventListener('input', sync);
        ctx.files.onChange = function () {
          ctx.render();
          if (ctx.pages() && !input.value) input.value = '1-' + ctx.pages();
          sync();
        };
        sync();
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        var pages = ctx.pages();
        if (!pages) return 'Add a readable PDF first.';
        var parsed = C.parsePageSpec(main.querySelector('#pages').value, pages);
        if (parsed.errors.length) return parsed.errors[0];
        if (!parsed.pages.length) return 'Select at least one page.';
        return true;
      },
      run: async function (ctx, progress) {
        var pages = ctx.pages();
        var parsed = C.parsePageSpec(main.querySelector('#pages').value, pages);
        return [await P.extract(ctx.files.items[0].file, parsed.pages, progress)];
      }
    });
  }

  function renderDelete(tool) {
    pdfLayout(tool, {
      action: 'delete pages',
      side:
        '<h2 class="panel-title">delete</h2>' +
        pagesField('pages', 'pages to remove', '', '1, 4-6') +
        '<p class="hint">Everything else is kept.</p>'
    });
    mountPdfTool(tool, {
      action: 'delete pages',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var input = main.querySelector('#pages');
        function sync() {
          var pages = ctx.pages();
          if (!pages) {
            pageHint(main, 'pagesHint', 'Add a PDF first.');
            return;
          }
          var parsed = C.parsePageSpec(input.value, pages);
          if (parsed.errors.length) pageHint(main, 'pagesHint', parsed.errors[0], true);
          else pageHint(main, 'pagesHint', 'Keeps ' + (pages - parsed.pages.length) + ' of ' + pages + ' pages.');
        }
        input.addEventListener('input', sync);
        ctx.files.onChange = function () {
          ctx.render();
          if (ctx.pages() && !input.value) input.value = '1';
          sync();
        };
        sync();
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        var pages = ctx.pages();
        if (!pages) return 'Add a readable PDF first.';
        var parsed = C.parsePageSpec(main.querySelector('#pages').value, pages);
        if (parsed.errors.length) return parsed.errors[0];
        if (!parsed.pages.length) return 'Select at least one page.';
        if (parsed.pages.length === pages) return 'You cannot delete every page.';
        return true;
      },
      run: async function (ctx, progress) {
        var pages = ctx.pages();
        var parsed = C.parsePageSpec(main.querySelector('#pages').value, pages);
        return [await P.deletePages(ctx.files.items[0].file, parsed.pages, progress)];
      }
    });
  }

  // reorder

  function renderReorder(tool) {
    pdfLayout(tool, {
      action: 'reorder pages',
      side:
        '<h2 class="panel-title">order</h2>' +
        pagesField('order', 'new page order', '', '3, 1, 2, 4-6') +
        '<div class="result-actions"><button type="button" class="btn btn-small" id="reverseOrder">reverse</button><button type="button" class="btn btn-small" id="resetOrder">reset</button></div>' +
        '<p class="hint">Every page must appear exactly once. Ranges expand in order.</p>'
    });
    mountPdfTool(tool, {
      action: 'reorder pages',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var input = main.querySelector('#order');
        function sync() {
          var pages = ctx.pages();
          if (!pages) {
            pageHint(main, 'orderHint', 'Add a PDF first.');
            return;
          }
          var parsed = C.parsePageSpec(input.value, pages, { ordered: true, requireAll: true });
          if (parsed.errors.length) pageHint(main, 'orderHint', parsed.errors[0], true);
          else pageHint(main, 'orderHint', 'Ready: ' + pages + ' pages in the listed order.');
        }
        input.addEventListener('input', sync);
        main.querySelector('#reverseOrder').addEventListener('click', function () {
          var pages = ctx.pages();
          if (!pages) return;
          var order = [];
          for (var i = pages; i >= 1; i--) order.push(i);
          input.value = order.join(', ');
          sync();
        });
        main.querySelector('#resetOrder').addEventListener('click', function () {
          var pages = ctx.pages();
          if (!pages) return;
          input.value = '1-' + pages;
          sync();
        });
        ctx.files.onChange = function () {
          ctx.render();
          if (ctx.pages() && !input.value) input.value = '1-' + ctx.pages();
          sync();
        };
        sync();
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        var pages = ctx.pages();
        if (!pages) return 'Add a readable PDF first.';
        var parsed = C.parsePageSpec(main.querySelector('#order').value, pages, { ordered: true, requireAll: true });
        if (parsed.errors.length) return parsed.errors[0];
        return true;
      },
      run: async function (ctx, progress) {
        var pages = ctx.pages();
        var parsed = C.parsePageSpec(main.querySelector('#order').value, pages, { ordered: true, requireAll: true });
        return [await P.reorder(ctx.files.items[0].file, parsed.pages, progress)];
      }
    });
  }

  // rotate

  function renderRotate(tool) {
    pdfLayout(tool, {
      action: 'rotate pages',
      side:
        '<h2 class="panel-title">rotate</h2>' +
        '<div class="field"><span class="field-label">angle</span>' +
          '<div class="seg" id="angleSeg"><button type="button" data-angle="90">90°</button><button type="button" data-angle="180">180°</button><button type="button" data-angle="270">270°</button></div>' +
        '</div>' +
        pagesField('pages', 'pages', 'all', 'all, or 1-3, 5') +
        '<p class="hint">Leave “all” to rotate every page.</p>'
    });
    mountPdfTool(tool, {
      action: 'rotate pages',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var seg = main.querySelector('#angleSeg');
        seg.querySelector('[data-angle="90"]').classList.add('is-active');
        seg.querySelectorAll('[data-angle]').forEach(function (button) {
          button.setAttribute('aria-pressed', String(button.dataset.angle === '90'));
        });
        seg.addEventListener('click', function (event) {
          var button = event.target.closest('[data-angle]');
          if (!button) return;
          seg.querySelectorAll('button').forEach(function (b) {
            var active = b === button;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-pressed', String(active));
          });
        });
        var input = main.querySelector('#pages');
        function sync() {
          var pages = ctx.pages();
          if (!pages) {
            pageHint(main, 'pagesHint', 'Add a PDF first.');
            return;
          }
          var value = input.value.trim();
          if (!value || value.toLowerCase() === 'all') {
            pageHint(main, 'pagesHint', 'All ' + pages + ' pages.');
            return;
          }
          var parsed = C.parsePageSpec(value, pages);
          if (parsed.errors.length) pageHint(main, 'pagesHint', parsed.errors[0], true);
          else pageHint(main, 'pagesHint', parsed.pages.length + ' of ' + pages + ' pages.');
        }
        input.addEventListener('input', sync);
        ctx.files.onChange = function () { ctx.render(); sync(); };
        sync();
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        var pages = ctx.pages();
        if (!pages) return 'Add a readable PDF first.';
        var value = main.querySelector('#pages').value.trim();
        if (!value || value.toLowerCase() === 'all') return true;
        var parsed = C.parsePageSpec(value, pages);
        if (parsed.errors.length) return parsed.errors[0];
        if (!parsed.pages.length) return 'Select at least one page.';
        return true;
      },
      run: async function (ctx, progress) {
        var pages = ctx.pages();
        var value = main.querySelector('#pages').value.trim();
        var selected = !value || value.toLowerCase() === 'all' ? [] : C.parsePageSpec(value, pages).pages;
        var angle = Number(main.querySelector('#angleSeg .is-active').dataset.angle);
        return [await P.rotate(ctx.files.items[0].file, selected, angle, progress)];
      }
    });
  }

  // images to pdf

  function renderImagesToPdf(tool) {
    pdfLayout(tool, {
      accept: 'images',
      multiple: true,
      title: 'Select images',
      sub: 'or drop them here — order is top to bottom',
      action: 'make pdf',
      side:
        '<h2 class="panel-title">page setup</h2>' +
        '<div class="field"><label class="field-label" for="pageSize">page size</label>' +
          '<select class="select" id="pageSize"><option value="a4">A4</option><option value="letter">US Letter</option><option value="auto">fit the image</option></select>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="orientation">orientation</label>' +
          '<select class="select" id="orientation"><option value="auto">auto</option><option value="portrait">portrait</option><option value="landscape">landscape</option></select>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="margin">margin</label>' +
          '<select class="select" id="margin"><option value="0">none</option><option value="24">small — 8 mm</option><option value="48">medium — 17 mm</option><option value="72">large — 25 mm</option></select>' +
        '</div>'
    });
    mountPdfTool(tool, {
      accept: 'images',
      multiple: true,
      action: 'make pdf',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var pageSize = main.querySelector('#pageSize');
        var orientation = main.querySelector('#orientation');
        var margin = main.querySelector('#margin');
        pageSize.value = app.settings.pageSize;
        orientation.value = app.settings.orientation;
        margin.value = String(app.settings.margin);
        pageSize.addEventListener('change', function () { updateSettings({ pageSize: pageSize.value }); });
        orientation.addEventListener('change', function () { updateSettings({ orientation: orientation.value }); });
        margin.addEventListener('change', function () { updateSettings({ margin: Number(margin.value) }); });
      },
      canRun: function (ctx) { return ctx.files.items.length >= 1; },
      run: async function (ctx, progress) {
        var result = await P.imagesToPdf(ctx.files.items.map(function (item) { return item.prepared || item.file; }), {
          pageSize: main.querySelector('#pageSize').value,
          orientation: main.querySelector('#orientation').value,
          margin: Number(main.querySelector('#margin').value)
        }, progress);
        return [result];
      }
    });
  }

  // pdf to images

  function renderPdfToImages(tool) {
    pdfLayout(tool, {
      action: 'render pages',
      side:
        '<h2 class="panel-title">page images</h2>' +
        '<div class="field"><label class="field-label" for="imageDpi">resolution</label>' +
          '<select class="select" id="imageDpi"><option value="72">72 dpi — preview</option><option value="150">150 dpi — screen</option><option value="200">200 dpi — detail</option><option value="300">300 dpi — print</option></select>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="imageFormat">format</label>' +
          '<select class="select" id="imageFormat"><option value="image/jpeg">jpeg — smaller</option><option value="image/png">png — lossless</option></select>' +
        '</div>' +
        qualityField('quality') +
        '<p class="hint">Each page becomes one image. Multiple pages download as a ZIP.</p>'
    });
    mountPdfTool(tool, {
      action: 'render pages',
      resultLabel: 'images',
      mount: function (ctx) {
        var dpi = main.querySelector('#imageDpi');
        var format = main.querySelector('#imageFormat');
        dpi.value = String(app.settings.imageDpi);
        format.value = app.settings.imageFormat;
        dpi.addEventListener('change', function () { updateSettings({ imageDpi: Number(dpi.value) }); });
        format.addEventListener('change', function () { updateSettings({ imageFormat: format.value }); });
        bindQuality(
          ctx.root,
          'quality',
          function () { return app.settings.quality; },
          function (value) { updateSettings({ quality: value }); },
          null
        );
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) { return ctx.pages() ? true : 'Add a readable PDF first.'; },
      run: async function (ctx, progress) {
        var entries = await P.pdfToImages(ctx.files.items[0].file, {
          dpi: Number(main.querySelector('#imageDpi').value),
          format: main.querySelector('#imageFormat').value,
          quality: app.settings.quality
        }, progress);
        return entries;
      }
    });
  }

  // watermark

  function renderWatermark(tool) {
    pdfLayout(tool, {
      action: 'add watermark',
      side:
        '<h2 class="panel-title">watermark</h2>' +
        '<div class="field"><label class="field-label" for="wmText">text</label>' +
          '<input class="input" id="wmText" maxlength="80" placeholder="DRAFT">' +
        '</div>' +
        '<div class="field"><label class="field-label" for="wmSize">size</label>' +
          '<div class="input-row"><input class="input" type="number" id="wmSize" min="2" max="40" value="9"><span class="unit-btn">%</span></div>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="wmOpacity">opacity</label>' +
          '<div class="input-row"><input class="input" type="number" id="wmOpacity" min="2" max="100" value="15"><span class="unit-btn">%</span></div>' +
        '</div>' +
        '<div class="field"><span class="field-label">angle</span>' +
          '<div class="seg" id="wmAngle"><button type="button" data-angle="45">45°</button><button type="button" data-angle="0">flat</button></div>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="wmColor">colour</label>' +
          '<input class="input" type="color" id="wmColor" value="#666666">' +
        '</div>'
    });
    mountPdfTool(tool, {
      action: 'add watermark',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var text = main.querySelector('#wmText');
        var size = main.querySelector('#wmSize');
        var opacity = main.querySelector('#wmOpacity');
        var color = main.querySelector('#wmColor');
        var angleSeg = main.querySelector('#wmAngle');
        text.value = app.settings.watermarkText;
        size.value = String(app.settings.watermarkSize);
        opacity.value = String(app.settings.watermarkOpacity);
        color.value = app.settings.watermarkColor;
        var angleButtons = angleSeg.querySelectorAll('[data-angle]');
        angleButtons.forEach(function (button) {
          var active = Number(button.dataset.angle) === app.settings.watermarkAngle;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        angleSeg.addEventListener('click', function (event) {
          var button = event.target.closest('[data-angle]');
          if (!button) return;
          angleButtons.forEach(function (b) {
            var active = b === button;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-pressed', String(active));
          });
          updateSettings({ watermarkAngle: Number(button.dataset.angle) });
        });
        text.addEventListener('input', function () { updateSettings({ watermarkText: text.value }); });
        size.addEventListener('input', function () { updateSettings({ watermarkSize: Number(size.value) }); });
        opacity.addEventListener('input', function () { updateSettings({ watermarkOpacity: Number(opacity.value) }); });
        color.addEventListener('input', function () { updateSettings({ watermarkColor: color.value }); });
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        if (!ctx.pages()) return 'Add a readable PDF first.';
        if (!main.querySelector('#wmText').value.trim()) return 'Type the watermark text.';
        return true;
      },
      run: async function (ctx, progress) {
        return [await P.watermark(ctx.files.items[0].file, {
          text: main.querySelector('#wmText').value,
          size: Number(main.querySelector('#wmSize').value),
          opacity: Number(main.querySelector('#wmOpacity').value),
          angle: Number(main.querySelector('#wmAngle .is-active').dataset.angle),
          color: main.querySelector('#wmColor').value
        }, progress)];
      }
    });
  }

  // page numbers

  function renderPageNumbers(tool) {
    pdfLayout(tool, {
      action: 'add page numbers',
      side:
        '<h2 class="panel-title">page numbers</h2>' +
        '<div class="field"><label class="field-label" for="numPosition">position</label>' +
          '<select class="select" id="numPosition"><option value="bottom-center">bottom centre</option><option value="bottom-right">bottom right</option><option value="top-center">top centre</option><option value="top-right">top right</option></select>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="numFormat">format</label>' +
          '<select class="select" id="numFormat"><option value="Page {n} of {total}">Page {n} of {total}</option><option value="{n}">n</option><option value="{n} / {total}">n / total</option></select>' +
        '</div>' +
        '<div class="field"><label class="field-label" for="numStart">start at</label>' +
          '<input class="input" type="number" id="numStart" min="1" value="1">' +
        '</div>' +
        '<div class="field"><label class="field-label" for="numSize">size</label>' +
          '<input class="input" type="number" id="numSize" min="6" max="36" value="10">' +
        '</div>'
    });
    mountPdfTool(tool, {
      action: 'add page numbers',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var position = main.querySelector('#numPosition');
        var format = main.querySelector('#numFormat');
        var start = main.querySelector('#numStart');
        var size = main.querySelector('#numSize');
        position.value = app.settings.numberPosition;
        format.value = app.settings.numberFormat;
        start.value = String(app.settings.numberStart);
        size.value = String(app.settings.numberSize);
        position.addEventListener('change', function () { updateSettings({ numberPosition: position.value }); });
        format.addEventListener('change', function () { updateSettings({ numberFormat: format.value }); });
        start.addEventListener('input', function () { updateSettings({ numberStart: Number(start.value) }); });
        size.addEventListener('input', function () { updateSettings({ numberSize: Number(size.value) }); });
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) { return ctx.pages() ? true : 'Add a readable PDF first.'; },
      run: async function (ctx, progress) {
        return [await P.pageNumbers(ctx.files.items[0].file, {
          position: main.querySelector('#numPosition').value,
          format: main.querySelector('#numFormat').value,
          start: Number(main.querySelector('#numStart').value),
          size: Number(main.querySelector('#numSize').value)
        }, progress)];
      }
    });
  }

  // protect

  function renderProtect(tool) {
    pdfLayout(tool, {
      action: 'encrypt pdf',
      side:
        '<h2 class="panel-title">password</h2>' +
        '<div class="field"><label class="field-label" for="pw1">password</label>' +
          '<input class="input" type="password" id="pw1" autocomplete="new-password" placeholder="at least 4 characters">' +
        '</div>' +
        '<div class="field"><label class="field-label" for="pw2">repeat</label>' +
          '<input class="input" type="password" id="pw2" autocomplete="new-password">' +
        '</div>' +
        '<p class="hint">AES-256. The password is never stored; if you lose it, the PDF cannot be opened.</p>'
    });
    mountPdfTool(tool, {
      action: 'encrypt pdf',
      resultLabel: 'pdf',
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) {
        if (!ctx.pages()) return 'Add a readable PDF first.';
        var one = main.querySelector('#pw1').value;
        var two = main.querySelector('#pw2').value;
        if (one.length < 4) return 'Use at least 4 characters.';
        if (one !== two) return 'The passwords do not match.';
        return true;
      },
      run: async function (ctx, progress) {
        return [await P.addPassword(ctx.files.items[0].file, {
          userPassword: main.querySelector('#pw1').value,
          ownerPassword: main.querySelector('#pw1').value
        }, progress)];
      }
    });
  }

  function renderUnlock(tool) {
    pdfLayout(tool, {
      action: 'remove password',
      side:
        '<h2 class="panel-title">unlock</h2>' +
        '<div class="field"><label class="field-label" for="pw">current password</label>' +
          '<input class="input" type="password" id="pw" autocomplete="current-password">' +
        '</div>' +
        '<p class="hint">The output is saved without encryption. You need the password that opens the file.</p>'
    });
    mountPdfTool(tool, {
      accept: 'pdf',
      probeMode: 'none',
      action: 'remove password',
      resultLabel: 'pdf',
      canRun: function (ctx) { return ctx.files.items.length === 1; },
      validate: function (ctx) {
        if (!ctx.files.items.length) return 'Add a password-protected PDF.';
        if (!main.querySelector('#pw').value) return 'Enter the current password.';
        return true;
      },
      run: async function (ctx, progress) {
        return [await P.removePassword(ctx.files.items[0].file, main.querySelector('#pw').value, progress)];
      }
    });
  }

  // ocr

  function renderOcr(tool) {
    pdfLayout(tool, {
      action: 'make searchable',
      side:
        '<h2 class="panel-title">ocr</h2>' +
        '<div class="field"><label class="field-label" for="ocrDpi">scan resolution</label>' +
          '<select class="select" id="ocrDpi"><option value="150">150 dpi — fast</option><option value="200">200 dpi — balanced</option><option value="300">300 dpi — slow</option></select>' +
        '</div>' +
        '<p class="hint">English text only. Adds an invisible, selectable text layer over each page.</p>' +
        '<div class="notice">The OCR engine and English model are bundled. This runs fully offline; your PDF never leaves the device.</div>'
    });
    mountPdfTool(tool, {
      action: 'make searchable',
      resultLabel: 'pdf',
      mount: function (ctx) {
        var dpi = main.querySelector('#ocrDpi');
        dpi.value = String(app.settings.ocrDpi);
        dpi.addEventListener('change', function () { updateSettings({ ocrDpi: Number(dpi.value) }); });
      },
      canRun: function (ctx) { return !!ctx.pages(); },
      validate: function (ctx) { return ctx.pages() ? true : 'Add a readable PDF first.'; },
      run: async function (ctx, progress) {
        return [await P.ocr(ctx.files.items[0].file, { dpi: Number(main.querySelector('#ocrDpi').value) }, progress)];
      }
    });
  }

  // -------------------------------------------------------------- compare --

  var compare = {
    urls: [],
    item: null,
    lastFocus: null,
    dragging: false,
    modal: null
  };

  function bindCompare() {
    compare.modal = document.getElementById('compareModal');
    if (!compare.modal) return;
    var close = document.getElementById('closeCompare');
    var area = document.getElementById('compareArea');
    var knob = document.getElementById('compareKnob');

    close.addEventListener('click', function () { closeCompare(); });
    compare.modal.addEventListener('mousedown', function (event) {
      if (event.target === compare.modal) closeCompare();
    });
    compare.modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCompare();
        return;
      }
      if (event.key === 'Tab') {
        var focusable = compare.modal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    function setFromEvent(event) {
      var rect = area.getBoundingClientRect();
      setPosition(((event.clientX - rect.left) / rect.width) * 100);
    }
    area.addEventListener('pointerdown', function (event) {
      compare.dragging = true;
      area.setPointerCapture(event.pointerId);
      setFromEvent(event);
    });
    area.addEventListener('pointermove', function (event) {
      if (compare.dragging) setFromEvent(event);
    });
    area.addEventListener('pointerup', function () { compare.dragging = false; });
    area.addEventListener('pointercancel', function () { compare.dragging = false; });
    knob.addEventListener('keydown', function (event) {
      var current = Number(knob.getAttribute('aria-valuenow')) || 50;
      var next = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - (event.shiftKey ? 10 : 2);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + (event.shiftKey ? 10 : 2);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 100;
      if (next === null) return;
      event.preventDefault();
      setPosition(next);
    });
  }

  function setPosition(percent) {
    var value = Math.max(0, Math.min(100, percent));
    var area = document.getElementById('compareArea');
    if (!area) return;
    area.style.setProperty('--pos', value + '%');
    document.getElementById('compareKnob').setAttribute('aria-valuenow', String(Math.round(value)));
  }

  function openCompare(item) {
    if (!item.result || item.kind === 'pdf' || !compare.modal) return;
    var before = item.prepared || item.file;
    var beforeUrl = URL.createObjectURL(before);
    var afterUrl = URL.createObjectURL(item.result.blob);
    compare.urls = [beforeUrl, afterUrl];
    document.getElementById('compareBefore').src = beforeUrl;
    document.getElementById('compareAfter').src = afterUrl;
    document.getElementById('compareFile').textContent = item.name;
    var beforeDims = item.meta && item.meta.width ? item.meta.width + '×' + item.meta.height : '—';
    var afterDims = item.result.width ? item.result.width + '×' + item.result.height : '—';
    document.getElementById('compareBeforeMeta').textContent = C.formatBytes(item.size) + ' · ' + beforeDims;
    document.getElementById('compareAfterMeta').textContent = C.formatBytes(item.result.blob.size) + ' · ' + afterDims;
    var saved = C.savingsPercent(item.size, item.result.blob.size);
    document.getElementById('compareSaved').textContent = (saved >= 0 ? '−' : '+') + Math.abs(saved) + '%';
    setPosition(50);
    compare.lastFocus = document.activeElement;
    compare.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      document.getElementById('compareKnob').focus();
    });
  }

  function closeCompare(silent) {
    if (!compare.modal || compare.modal.hidden) return;
    compare.modal.hidden = true;
    document.body.style.overflow = '';
    compare.urls.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (err) { /* noop */ }
    });
    compare.urls = [];
    var before = document.getElementById('compareBefore');
    var after = document.getElementById('compareAfter');
    if (before) before.removeAttribute('src');
    if (after) after.removeAttribute('src');
    if (!silent && compare.lastFocus && document.contains(compare.lastFocus)) compare.lastFocus.focus();
    compare.lastFocus = null;
  }

  // ------------------------------------------------------------------- pwa --

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    var updateNotified = false;

    // skipWaiting + clients.claim in the worker means a new build takes control
    // immediately. Reload only when no work can be lost.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      if (!hadController) {
        hadController = true;
        return;
      }
      if (app.busy || hasUnsavedChanges()) {
        if (!updateNotified) {
          updateNotified = true;
          toast('A new version is ready. Reload when you are done.', null, {
            label: 'reload',
            onClick: function () { location.reload(); }
          });
        }
        return;
      }
      reloading = true;
      location.reload();
    });

    function check(registration) {
      if (!registration) return;
      try {
        var pending = registration.update();
        if (pending && pending.catch) pending.catch(function () {});
      } catch (err) {
        /* offline is fine */
      }
    }

    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('./sw.js', { updateViaCache: 'none' })
        .then(function (registration) {
          setTimeout(function () { check(registration); }, 1200);
          setInterval(function () { check(registration); }, 10 * 60 * 1000);
          document.addEventListener('visibilitychange', function () {
            if (!document.hidden) check(registration);
          });
          window.addEventListener('online', function () { check(registration); });
        })
        .catch(function () {
          /* offline support is optional */
        });
    });
  }

  // --------------------------------------------------------------- presets --

  function fillPresetSelect() {
    var select = document.getElementById('preset');
    if (!select) return;
    var html = '<option value="custom">custom size</option>';
    Presets.groups().forEach(function (group) {
      html += '<optgroup label="' + group.name + '">';
      group.items.forEach(function (preset) {
        html += '<option value="' + preset.id + '">' + preset.label + ' — ' + preset.detail + '</option>';
      });
      html += '</optgroup>';
    });
    select.innerHTML = html;
    select.value = Presets.byId(app.settings.presetId) ? app.settings.presetId : 'custom';
  }

  // ----------------------------------------------------------------- tools --

  var TOOLS = {
    squeeze: {
      group: 'images',
      label: 'Squeeze',
      card: 'Squeeze',
      blurb: 'Shrink images and PDFs with measured savings, a target size, and a real quality check.',
      view: renderSqueeze
    },
    crop: {
      group: 'images',
      label: 'Crop & size',
      card: 'Crop & size',
      blurb: 'Crop to passport, visa, government-form or social sizes — or type your own pixels.',
      view: renderCrop
    },
    convert: {
      group: 'images',
      label: 'Convert',
      card: 'Convert',
      blurb: 'Move between WebP, JPEG, PNG, AVIF or a custom MIME type. Resize and cap the size.',
      view: renderConvert
    },
    merge: {
      group: 'pdf · organise',
      label: 'Merge PDFs',
      card: 'Merge PDFs',
      blurb: 'Combine several PDFs into one, in the order you choose.',
      view: renderMerge
    },
    split: {
      group: 'pdf · organise',
      label: 'Split PDF',
      card: 'Split PDF',
      blurb: 'Cut a PDF into several files by page ranges or every N pages.',
      view: renderSplit
    },
    extract: {
      group: 'pdf · organise',
      label: 'Extract pages',
      card: 'Extract pages',
      blurb: 'Make a new PDF from only the pages you pick.',
      view: renderExtract
    },
    delete: {
      group: 'pdf · organise',
      label: 'Delete pages',
      card: 'Delete pages',
      blurb: 'Remove pages you do not need, keeping the rest intact.',
      view: renderDelete
    },
    reorder: {
      group: 'pdf · organise',
      label: 'Reorder pages',
      card: 'Reorder pages',
      blurb: 'Move pages into a new order, then save a clean copy.',
      view: renderReorder
    },
    rotate: {
      group: 'pdf · organise',
      label: 'Rotate pages',
      card: 'Rotate pages',
      blurb: 'Turn some or all pages by 90°, 180° or 270°.',
      view: renderRotate
    },
    'images-to-pdf': {
      group: 'pdf · convert',
      label: 'Images to PDF',
      card: 'Images to PDF',
      blurb: 'Turn JPEG, PNG, HEIC and other images into one PDF.',
      view: renderImagesToPdf
    },
    'pdf-to-images': {
      group: 'pdf · convert',
      label: 'PDF to images',
      card: 'PDF to images',
      blurb: 'Save every page as a PNG or JPEG, one image per page.',
      view: renderPdfToImages
    },
    ocr: {
      group: 'pdf · convert',
      label: 'Make searchable',
      card: 'Make searchable',
      blurb: 'Recognise English text in scans and add an invisible, searchable layer.',
      view: renderOcr
    },
    'compress-pdf': {
      group: 'pdf · edit',
      label: 'Compress PDF',
      card: 'Compress PDF',
      blurb: 'Rebuild pages at a lower quality, or keep the text and re-save the structure.',
      view: renderCompressPdf
    },
    watermark: {
      group: 'pdf · edit',
      label: 'Add watermark',
      card: 'Add watermark',
      blurb: 'Stamp text such as DRAFT across every page.',
      view: renderWatermark
    },
    'page-numbers': {
      group: 'pdf · edit',
      label: 'Page numbers',
      card: 'Page numbers',
      blurb: 'Number pages at the top or bottom, starting where you like.',
      view: renderPageNumbers
    },
    protect: {
      group: 'pdf · secure',
      label: 'Add password',
      card: 'Add password',
      blurb: 'Require a password to open the PDF, using AES-256 encryption.',
      view: renderProtect
    },
    unlock: {
      group: 'pdf · secure',
      label: 'Remove password',
      card: 'Remove password',
      blurb: 'Remove a PDF password you know and save an unlocked copy.',
      view: renderUnlock
    }
  };

  function renderTool(tool) {
    document.title = tool.label + ' — Opti';
    tool.view(tool);
  }
})();
