/**
 * OptiPress · app.js
 * UI controller. Keeps DOM updates incremental so progress never flickers.
 */
(function () {
  'use strict';

  var C = window.OptiCore;
  var engine = window.optiPressEngine;

  var LIMITS = {
    maxFiles: 80,
    maxFileBytes: 200 * 1024 * 1024
  };

  var STORAGE = {
    settings: 'optipress:settings:v2',
    theme: 'optipress:theme'
  };

  var state = {
    items: [],
    settings: null,
    estimates: new Map(),
    estimateToken: 0,
    estimateCache: new Map(),
    estimateTimer: null,
    busy: false,
    estimating: false,
    idSeq: 0,
    lockRatio: null,
    dragDepth: 0,
    theme: null,
    compare: { item: null, urls: [], lastFocus: null, dragging: false },
    installPrompt: null
  };

  var els = {};

  // ------------------------------------------------------------------ boot --

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    if (!C || !engine) {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<p class="noscript">OptiPress could not start: a script failed to load. Reload the page.</p>'
      );
      return;
    }

    state.settings = C.normalizeSettings(readStoredSettings());
    state.theme = readTheme();
    state.lockRatio = null;

    applyTheme();
    syncFormatSupport();
    applySettingsToUi();
    bindEvents();
    syncFieldVisibility();
    syncActions();
    updateSummary();
    updateProtocolHint();
    registerServiceWorker();

    if (typeof window.matchMedia === 'function') {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (!state.theme) applyTheme();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  function cacheElements() {
    var ids = [
      'dropzone', 'fileInput', 'queue', 'fileList', 'queueCount', 'queueSummary',
      'addBtn', 'clearBtn', 'squeezeBtn', 'squeezeLabel', 'zipBtn', 'zipLabel',
      'presetGroup', 'presetHint', 'quality', 'qualityOut', 'qualityField',
      'resizeGroup', 'resizeOut', 'resizeField', 'scale', 'scaleControls', 'exactControls',
      'customWidth', 'customHeight', 'aspectLock', 'letterboxGroup', 'exactHint',
      'format', 'formatHint', 'formatField', 'avifOption',
      'pdfField', 'pdfMode', 'pdfDpi', 'pdfDpiRow', 'pdfHint',
      'targetField', 'targetToggle', 'targetControls', 'targetKB', 'targetHint',
      'resetBtn', 'summary', 'estimatePill', 'estimateValue', 'estimateMeter', 'estimateNote',
      'themeToggle', 'installBtn', 'workspace', 'valueStrip',
      'compareModal', 'compareArea', 'compareBeforeLayer', 'compareBefore', 'compareAfter',
      'compareDivider', 'compareKnob', 'compareFile', 'metaBefore', 'metaAfter', 'metaSaved',
      'closeModalBtn', 'dropOverlay', 'toasts', 'liveStatus', 'protocolHint',
      'settingsForm'
    ];
    ids.forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  // --------------------------------------------------------------- storage --

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
      /* private mode: settings simply won't persist */
    }
  }

  function readStoredSettings() {
    var raw = safeGet(STORAGE.settings);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  var saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      safeSet(STORAGE.settings, JSON.stringify(state.settings));
    }, 220);
  }

  function readTheme() {
    var value = safeGet(STORAGE.theme);
    return value === 'dark' || value === 'light' ? value : null;
  }

  function effectiveTheme() {
    if (state.theme) return state.theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    var root = document.documentElement;
    if (state.theme) root.setAttribute('data-theme', state.theme);
    else root.removeAttribute('data-theme');

    var dark = effectiveTheme() === 'dark';
    if (els.themeToggle) {
      els.themeToggle.setAttribute('aria-pressed', String(dark));
      els.themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', dark ? '#14120d' : '#faf7f0');
  }

  // ---------------------------------------------------------------- events --

  function bindEvents() {
    els.dropzone.addEventListener('click', openPicker);
    els.addBtn.addEventListener('click', openPicker);
    els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files && els.fileInput.files.length) {
        addFiles(els.fileInput.files, 'picked');
        els.fileInput.value = '';
      }
    });

    els.clearBtn.addEventListener('click', clearQueue);
    els.squeezeBtn.addEventListener('click', function () {
      squeezeAll();
    });
    els.zipBtn.addEventListener('click', downloadZip);
    els.resetBtn.addEventListener('click', resetSettings);
    els.themeToggle.addEventListener('click', toggleTheme);

    initRadioGroup(els.presetGroup, selectPreset);
    initRadioGroup(els.resizeGroup, selectResizeMode);
    initRadioGroup(els.letterboxGroup, function (btn) {
      commitSettings({ letterbox: btn.dataset.letterbox });
    });

    els.quality.addEventListener('input', function () {
      commitSettings({ quality: Number(els.quality.value), preset: 'custom' });
    });

    els.scale.addEventListener('input', function () {
      commitSettings({ scale: Number(els.scale.value), preset: 'custom' });
    });

    els.customWidth.addEventListener('input', function () {
      var width = C.toPositiveInt(els.customWidth.value);
      var patch = { customWidth: els.customWidth.value, preset: 'custom' };
      if (state.settings.aspectLocked && width && state.lockRatio) {
        var height = Math.max(1, Math.round(width / state.lockRatio));
        patch.customHeight = height;
        els.customHeight.value = String(height);
      }
      commitSettings(patch, { syncInputs: false });
    });

    els.customHeight.addEventListener('input', function () {
      var height = C.toPositiveInt(els.customHeight.value);
      var patch = { customHeight: els.customHeight.value, preset: 'custom' };
      if (state.settings.aspectLocked && height && state.lockRatio) {
        var width = Math.max(1, Math.round(height * state.lockRatio));
        patch.customWidth = width;
        els.customWidth.value = String(width);
      }
      commitSettings(patch, { syncInputs: false });
    });

    els.aspectLock.addEventListener('click', function () {
      var next = !state.settings.aspectLocked;
      if (next) {
        var w = C.toPositiveInt(els.customWidth.value);
        var h = C.toPositiveInt(els.customHeight.value);
        if (w && h) state.lockRatio = w / h;
        else if (!state.lockRatio) state.lockRatio = firstImageRatio() || 1;
      }
      commitSettings({ aspectLocked: next });
      if (next) {
        var width = C.toPositiveInt(els.customWidth.value);
        if (width && state.lockRatio) {
          var height = Math.max(1, Math.round(width / state.lockRatio));
          els.customHeight.value = String(height);
          commitSettings({ customHeight: height }, { syncInputs: false });
        }
      }
    });

    els.format.addEventListener('change', function () {
      commitSettings({ format: els.format.value });
    });

    els.pdfMode.addEventListener('change', function () {
      commitSettings({ pdfMode: els.pdfMode.value });
    });

    els.pdfDpi.addEventListener('change', function () {
      commitSettings({ pdfDpi: Number(els.pdfDpi.value) });
    });

    els.targetToggle.addEventListener('change', function () {
      commitSettings({ targetEnabled: els.targetToggle.checked });
    });

    els.targetKB.addEventListener('input', function () {
      commitSettings({ targetKB: els.targetKB.value });
    });

    els.fileList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (!button) return;
      var row = button.closest('.file');
      if (!row) return;
      handleRowAction(button.dataset.action, row.dataset.id);
    });

    bindDragAndDrop();
    bindPaste();
    bindCompareModal();

    // A stray Enter inside the settings form must never reload and drop the queue.
    els.settingsForm.addEventListener('submit', function (event) {
      event.preventDefault();
    });

    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (!els.compareModal.hidden) return;
        event.preventDefault();
        squeezeAll();
      }
    });

    els.installBtn.addEventListener('click', promptInstall);
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      state.installPrompt = event;
      els.installBtn.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      state.installPrompt = null;
      els.installBtn.hidden = true;
      toast('OptiPress installed.', 'ok');
    });
  }

  function openPicker() {
    els.fileInput.click();
  }

  function selectPreset(btn) {
    var values = C.presetSettings(btn.dataset.preset);
    if (!values) return;
    commitSettings({
      preset: btn.dataset.preset,
      quality: values.quality,
      scale: values.scale,
      resizeMode: 'scale'
    });
  }

  function selectResizeMode(btn) {
    var mode = btn.dataset.resize;
    commitSettings({ resizeMode: mode });
    if (mode === 'exact') seedExactDims();
  }

  function initRadioGroup(container, onSelect) {
    var buttons = Array.prototype.slice.call(container.querySelectorAll('[role="radio"]'));
    container.addEventListener('click', function (event) {
      var button = event.target.closest('[role="radio"]');
      if (!button || !container.contains(button)) return;
      onSelect(button);
    });
    container.addEventListener('keydown', function (event) {
      var current = event.target.closest('[role="radio"]');
      if (!current) return;
      var index = buttons.indexOf(current);
      var next = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      if (next < 0) return;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
  }

  function setRadio(container, key, value) {
    container.querySelectorAll('[role="radio"]').forEach(function (button) {
      var active = button.dataset[key] === value;
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  // -------------------------------------------------------------- settings --

  function commitSettings(patch, options) {
    var opts = options || {};
    state.settings = C.normalizeSettings(Object.assign({}, state.settings, patch));
    applySettingsToUi({ syncInputs: opts.syncInputs !== false });
    saveSettings();
    markResultsStale();
    syncFieldVisibility();
    updateExactHint();
    scheduleEstimate();
    syncActions();
  }

  function applySettingsToUi(options) {
    var opts = options || {};
    var s = state.settings;

    els.quality.value = String(s.quality);
    els.qualityOut.textContent = String(s.quality);
    els.scale.value = String(s.scale);

    setRadio(els.presetGroup, 'preset', s.preset);
    els.presetHint.textContent = s.preset === 'custom'
      ? 'Custom mix. Presets are just shortcuts — every control stays editable.'
      : C.PRESETS[s.preset].hint;

    setRadio(els.resizeGroup, 'resize', s.resizeMode);
    els.scaleControls.hidden = s.resizeMode !== 'scale';
    els.exactControls.hidden = s.resizeMode !== 'exact';
    setRadio(els.letterboxGroup, 'letterbox', s.letterbox);

    if (opts.syncInputs !== false) {
      if (document.activeElement !== els.customWidth) els.customWidth.value = s.customWidth ? String(s.customWidth) : '';
      if (document.activeElement !== els.customHeight) els.customHeight.value = s.customHeight ? String(s.customHeight) : '';
    }

    els.aspectLock.classList.toggle('is-active', s.aspectLocked);
    els.aspectLock.setAttribute('aria-pressed', String(s.aspectLocked));
    els.aspectLock.setAttribute('aria-label', s.aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked');
    els.aspectLock.title = s.aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked';

    els.resizeOut.textContent = s.resizeMode === 'scale'
      ? s.scale + '%'
      : s.customWidth && s.customHeight
        ? s.customWidth + '×' + s.customHeight
        : 'auto';

    els.format.value = s.format;
    els.pdfMode.value = s.pdfMode;
    els.pdfDpi.value = String(s.pdfDpi);
    els.pdfDpiRow.hidden = s.pdfMode === 'structure';
    els.pdfHint.textContent = s.pdfMode === 'structure'
      ? 'Re-saves the PDF structure and keeps text selectable. Savings are modest but safe.'
      : 'Rasterizing flattens text into images. Switch to “Keep text” when the PDF must stay selectable.';

    els.targetToggle.checked = s.targetEnabled;
    els.targetControls.hidden = !s.targetEnabled;
    if (document.activeElement !== els.targetKB) els.targetKB.value = String(s.targetKB);

    updateFormatHint();
    updateRangeFill(els.quality);
    updateRangeFill(els.scale);
  }

  function updateRangeFill(input) {
    var min = Number(input.min) || 0;
    var max = Number(input.max) || 100;
    var value = Number(input.value) || min;
    var percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty('--fill', percent + '%');
  }

  function updateFormatHint() {
    var hints = {
      auto: 'WebP is 25–35% smaller than JPEG at the same quality. Transparency is preserved.',
      original: 'Keeps the source format. Canvas PNG output is rarely smaller than the original.',
      'image/webp': 'Broad support, strong savings, keeps transparency.',
      'image/jpeg': 'Universally compatible. Transparency is flattened onto the letterbox colour.',
      'image/png': 'Lossless with transparency — often much larger than the source.',
      'image/avif': 'Smallest output, slowest encode. Great for archives.'
    };
    els.formatHint.textContent = hints[state.settings.format] || hints.auto;
    els.formatHint.classList.remove('is-warn');
    if (state.settings.format === 'image/png') els.formatHint.classList.add('is-warn');
  }

  function syncFormatSupport() {
    if (!engine || !engine.capabilities) return;
    var caps = engine.capabilities();
    if (els.avifOption) els.avifOption.hidden = !caps.avif;
    var webpOption = els.format.querySelector('option[value="image/webp"]');
    if (webpOption) webpOption.disabled = !caps.webp;
    var autoOption = els.format.querySelector('option[value="auto"]');
    if (autoOption) {
      autoOption.textContent = caps.webp
        ? 'Auto — best ratio (WebP)'
        : 'Auto — best ratio (JPEG)';
    }
    if (!caps.avif && state.settings.format === 'image/avif') state.settings.format = 'auto';
  }

  function syncFieldVisibility() {
    var hasItems = state.items.length > 0;
    var hasImages = state.items.some(function (item) {
      return item.kind !== 'pdf';
    });
    var hasPdf = state.items.some(function (item) {
      return item.kind === 'pdf';
    });

    els.formatField.hidden = hasItems && !hasImages;
    els.resizeField.hidden = hasItems && !hasImages;
    els.targetField.hidden = hasItems && !hasImages;
    els.pdfField.hidden = !hasPdf;
    updateExactHint();
  }

  function updateExactHint() {
    var s = state.settings;
    var width = C.toPositiveInt(s.customWidth);
    var height = C.toPositiveInt(s.customHeight);
    var hint = els.exactHint;

    if (!width || !height) {
      hint.textContent = 'Type one side to keep proportions, or both for an exact box.';
      hint.classList.remove('is-warn');
      return;
    }

    var images = state.items.filter(function (item) {
      return item.meta && item.meta.width && item.kind !== 'pdf';
    });
    if (!images.length) {
      hint.textContent = 'Images fit inside ' + width + '×' + height + '. Mismatched ratios get a ' + s.letterbox + ' border.';
      hint.classList.remove('is-warn');
      return;
    }

    var mismatched = images.filter(function (item) {
      return !C.ratiosClose(item.meta.width, item.meta.height, width, height, 0.01);
    }).length;

    if (mismatched) {
      hint.textContent = mismatched + ' of ' + images.length + ' image' + (images.length === 1 ? '' : 's') +
        ' will be letterboxed on ' + s.letterbox + '.';
      hint.classList.add('is-warn');
    } else {
      hint.textContent = 'All ' + images.length + ' image' + (images.length === 1 ? '' : 's') + ' match this ratio — no letterboxing.';
      hint.classList.remove('is-warn');
    }
  }

  function seedExactDims() {
    if (state.settings.customWidth || state.settings.customHeight) return;
    var first = state.items.find(function (item) {
      return item.meta && item.meta.width && item.kind !== 'pdf';
    });
    if (!first) return;
    state.lockRatio = first.meta.width / first.meta.height;
    commitSettings({
      customWidth: first.meta.width,
      customHeight: first.meta.height,
      aspectLocked: true
    });
  }

  function firstImageRatio() {
    var first = state.items.find(function (item) {
      return item.meta && item.meta.width && item.kind !== 'pdf';
    });
    if (!first) return null;
    return first.meta.width / first.meta.height;
  }

  function resetSettings() {
    state.settings = C.normalizeSettings(C.DEFAULTS);
    state.lockRatio = firstImageRatio();
    applySettingsToUi();
    saveSettings();
    markResultsStale();
    syncFieldVisibility();
    scheduleEstimate();
    syncActions();
    toast('Settings reset to Juicy.', 'ok');
  }

  function markResultsStale() {
    var changed = false;
    state.items.forEach(function (item) {
      if (item.status === 'done') {
        item.stale = true;
        changed = true;
      }
    });
    if (changed) {
      state.items.forEach(updateRow);
      updateSummary();
    }
  }

  // --------------------------------------------------------------- toasts ---

  function toast(message, tone, action) {
    if (!els.toasts) return;
    var el = document.createElement('div');
    el.className = 'toast' + (tone ? ' is-' + tone : '');
    var iconId = tone === 'ok' ? 'i-check' : tone === 'error' ? 'i-alert' : 'i-lock';
    el.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#' + iconId + '"></use></svg>' +
      '<span class="toast-text"></span>' +
      '<button type="button" class="toast-close" aria-label="Dismiss"><svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg></button>';
    el.querySelector('.toast-text').textContent = message;

    var timer = null;
    function remove() {
      clearTimeout(timer);
      if (el.parentNode) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(6px)';
        el.style.transition = 'opacity 160ms ease, transform 160ms ease';
        setTimeout(function () {
          el.remove();
        }, 170);
      }
    }

    if (action && action.label && typeof action.onClick === 'function') {
      var actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action';
      actionBtn.textContent = action.label;
      actionBtn.addEventListener('click', function () {
        action.onClick();
        remove();
      });
      el.insertBefore(actionBtn, el.querySelector('.toast-close'));
    }

    el.querySelector('.toast-close').addEventListener('click', remove);
    els.toasts.appendChild(el);
    timer = setTimeout(remove, action ? 9000 : 5200);

    while (els.toasts.children.length > 3) {
      els.toasts.removeChild(els.toasts.firstElementChild);
    }
  }

  function announce(message) {
    if (!els.liveStatus) return;
    els.liveStatus.textContent = '';
    setTimeout(function () {
      els.liveStatus.textContent = message;
    }, 40);
  }

  // ------------------------------------------------------------- file queue --

  function addFiles(fileList, source) {
    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;

    var accepted = [];
    var duplicates = 0;
    var unsupported = [];
    var oversized = [];
    var empty = 0;
    var overflow = 0;

    var existing = new Set(state.items.map(function (item) {
      return item.name + '|' + item.size + '|' + item.file.lastModified;
    }));

    incoming.forEach(function (file) {
      if (state.items.length + accepted.length >= LIMITS.maxFiles) {
        overflow++;
        return;
      }
      if (!file.size) {
        empty++;
        return;
      }
      if (file.size > LIMITS.maxFileBytes) {
        oversized.push(file.name);
        return;
      }
      if (!C.isSupported(file)) {
        unsupported.push(file.name);
        return;
      }
      var key = file.name + '|' + file.size + '|' + file.lastModified;
      if (existing.has(key)) {
        duplicates++;
        return;
      }
      existing.add(key);
      accepted.push(file);
    });

    if (duplicates) toast(duplicates + ' duplicate' + (duplicates === 1 ? '' : 's') + ' skipped.', 'info');
    if (unsupported.length) {
      toast('Not supported: ' + unsupported.slice(0, 2).join(', ') + (unsupported.length > 2 ? '…' : ''), 'error');
    }
    if (oversized.length) {
      toast('Over 200 MB: ' + oversized.slice(0, 2).join(', '), 'error');
    }
    if (empty) toast('Empty file' + (empty === 1 ? '' : 's') + ' skipped.', 'error');
    if (overflow) toast('Basket limit is ' + LIMITS.maxFiles + ' files.', 'error');
    if (!accepted.length) return;

    var created = accepted.map(createItem);
    created.forEach(function (item) {
      state.items.push(item);
    });

    if (source === 'pasted') toast(created.length + ' pasted file' + (created.length === 1 ? '' : 's') + ' added.', 'ok');
    if (!state.lockRatio) state.lockRatio = null;

    renderQueue();
    syncFieldVisibility();
    syncActions();
    updateSummary();
    scheduleEstimate();
    probeItems(created);
  }

  function createItem(file) {
    var kind = C.kindOf(file);
    var item = {
      id: 'f' + ++state.idSeq,
      file: file,
      name: file.name,
      size: file.size,
      kind: kind,
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

    if (kind === 'image') {
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

  async function probeItems(items) {
    var queue = items.slice();
    var workers = Math.min(3, queue.length);

    async function worker() {
      while (queue.length) {
        var item = queue.shift();
        if (!state.items.includes(item)) continue;
        await probeItem(item);
      }
    }

    var lanes = [];
    for (var i = 0; i < workers; i++) lanes.push(worker());
    await Promise.all(lanes);
  }

  async function probeItem(item) {
    try {
      var info = await engine.probe(item.file);
      if (!state.items.includes(item)) {
        if (info && info.sample && typeof info.sample.close === 'function') {
          try { info.sample.close(); } catch (err) { /* noop */ }
        }
        return;
      }

      item.meta = info;
      item.probing = false;
      item.sample = info.sample || null;
      item.hasAlpha = info.hasAlpha;
      if (info.prepared) {
        item.prepared = info.prepared;
        if (item.kind === 'heic' && !item.thumbUrl) {
          item.thumbUrl = trackUrl(item, URL.createObjectURL(info.prepared));
        }
      }
      if (info.thumb) item.thumbData = info.thumb;
      if (!state.lockRatio && info.width) state.lockRatio = info.width / info.height;

      if (item.status === 'error') {
        item.status = 'queued';
        item.error = null;
      }
    } catch (err) {
      if (!state.items.includes(item)) return;
      item.probing = false;
      item.status = 'error';
      item.error = err && err.message ? err.message : 'Could not read this file.';
    }

    updateRow(item);
    updateExactHint();
    updateSummary();
    syncActions();
    scheduleEstimate();
    if (state.settings.resizeMode === 'exact') maybeSeedExactFromItem(item);
  }

  function maybeSeedExactFromItem(item) {
    if (!item.meta || !item.meta.width) return;
    if (state.settings.customWidth || state.settings.customHeight) return;
    state.lockRatio = item.meta.width / item.meta.height;
    commitSettings({ customWidth: item.meta.width, customHeight: item.meta.height });
  }

  function removeItem(id) {
    var index = state.items.findIndex(function (item) {
      return item.id === id;
    });
    if (index < 0) return;
    var item = state.items[index];
    cleanupItem(item);
    state.items.splice(index, 1);
    state.estimates.delete(id);
    invalidateEstimateCache();
    renderQueue();
    syncFieldVisibility();
    syncActions();
    scheduleEstimate();
  }

  function clearQueue() {
    if (!state.items.length) return;
    state.items.forEach(cleanupItem);
    state.items = [];
    state.estimates.clear();
    state.estimateCache.clear();
    state.compare.item = null;
    renderQueue();
    syncFieldVisibility();
    syncActions();
    updateSummary();
    announce('Basket cleared.');
  }

  function invalidateEstimateCache() {
    if (state.estimateCache.size > 240) state.estimateCache.clear();
  }

  // --------------------------------------------------------------- render ---

  function renderQueue() {
    var hasItems = state.items.length > 0;
    els.queue.hidden = !hasItems;
    els.valueStrip.hidden = hasItems;
    els.workspace.classList.toggle('has-queue', hasItems);

    if (!hasItems) {
      els.fileList.innerHTML = '';
      els.queueCount.textContent = '0';
      els.queueSummary.textContent = 'No files yet';
      updateSummary();
      return;
    }

    var existing = new Map();
    Array.prototype.slice.call(els.fileList.children).forEach(function (row) {
      existing.set(row.dataset.id, row);
    });

    state.items.forEach(function (item, index) {
      var row = existing.get(item.id);
      if (!row) {
        row = createRow(item);
      } else {
        existing.delete(item.id);
      }
      if (els.fileList.children[index] !== row) {
        els.fileList.insertBefore(row, els.fileList.children[index] || null);
      }
      updateRow(item);
    });

    existing.forEach(function (row) {
      row.remove();
    });

    updateSummary();
  }

  function createRow(item) {
    var row = document.createElement('li');
    row.className = 'file';
    row.dataset.id = item.id;
    row.innerHTML =
      '<div class="file-thumb">' +
        '<svg class="icon" aria-hidden="true"><use href="#i-image"></use></svg>' +
        '<img alt="" hidden>' +
      '</div>' +
      '<div class="file-main">' +
        '<p class="file-name"></p>' +
        '<p class="file-meta"></p>' +
        '<div class="file-progress" hidden>' +
          '<span class="progress" aria-hidden="true"><span></span></span>' +
          '<span class="progress-label"></span>' +
        '</div>' +
        '<p class="file-note" hidden>' +
          '<svg class="icon" aria-hidden="true"><use href="#i-check"></use></svg>' +
          '<span class="note-text"></span>' +
        '</p>' +
      '</div>' +
      '<div class="file-detail">' +
        '<div class="file-size">' +
          '<span class="size-line"><span class="size-before"></span><span class="size-arrow" aria-hidden="true">→</span><span class="size-after"></span></span>' +
          '<span class="pill pill-save" hidden></span>' +
        '</div>' +
        '<div class="file-actions">' +
          '<button type="button" class="icon-btn" data-action="compare" hidden aria-label="Compare original and squeezed">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-compare"></use></svg>' +
          '</button>' +
          '<button type="button" class="icon-btn" data-action="download" hidden aria-label="Download squeezed file">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-download"></use></svg>' +
          '</button>' +
          '<button type="button" class="icon-btn" data-action="retry" hidden aria-label="Try again">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-refresh"></use></svg>' +
          '</button>' +
          '<button type="button" class="icon-btn" data-action="remove" aria-label="Remove file">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    var img = row.querySelector('.file-thumb img');
    img.addEventListener('error', function () {
      img.hidden = true;
    });

    row.addEventListener('animationend', function () {
      row.classList.remove('is-new');
    });
    return row;
  }

  function updateRow(item) {
    var row = els.fileList.querySelector('[data-id="' + item.id + '"]');
    if (!row) return;

    row.className = 'file is-' + item.status + (item.stale ? ' is-stale' : '');

    var nameEl = row.querySelector('.file-name');
    nameEl.textContent = item.name;
    nameEl.title = item.name;

    var metaEl = row.querySelector('.file-meta');
    metaEl.textContent = metaLine(item);

    var thumb = row.querySelector('.file-thumb');
    var img = thumb.querySelector('img');
    var thumbSource = item.thumbData || item.thumbUrl;
    if (thumbSource) {
      if (img.getAttribute('src') !== thumbSource) img.src = thumbSource;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
    thumb.classList.toggle('is-pdf', item.kind === 'pdf');
    thumb.classList.toggle('is-heic', item.kind === 'heic' && !thumbSource);
    var thumbIcon = thumb.querySelector('use');
    if (thumbIcon) {
      thumbIcon.setAttribute('href', item.kind === 'pdf' ? '#i-file' : item.kind === 'heic' ? '#i-image' : '#i-image');
    }

    // progress row
    var progressWrap = row.querySelector('.file-progress');
    var progressBar = progressWrap.querySelector('.progress > span');
    var progressLabel = progressWrap.querySelector('.progress-label');
    if (item.status === 'processing') {
      progressWrap.hidden = false;
      progressBar.style.width = Math.max(2, Math.min(100, item.progress)) + '%';
      progressLabel.textContent = (item.stage ? item.stage + ' · ' : '') + Math.round(item.progress) + '%';
    } else {
      progressWrap.hidden = true;
    }

    // note row
    var noteEl = row.querySelector('.file-note');
    var noteText = row.querySelector('.note-text');
    var noteIcon = noteEl.querySelector('use');
    var note = null;
    var noteTone = '';
    var noteIconId = 'i-check';

    if (item.status === 'error') {
      note = item.error || 'Something went wrong.';
      noteTone = 'is-error';
      noteIconId = 'i-alert';
    } else if (item.status === 'done' && item.stale) {
      note = 'Settings changed — squeeze again to apply them.';
      noteTone = 'is-warn';
      noteIconId = 'i-refresh';
    } else if (item.status === 'done' && item.note) {
      note = item.note;
      noteTone = item.result && item.result.usedOriginal ? 'is-warn' : 'is-ok';
      noteIconId = item.result && item.result.usedOriginal ? 'i-alert' : 'i-check';
    } else if (item.probing) {
      note = 'Reading file…';
      noteTone = '';
      noteIconId = 'i-refresh';
    }

    if (note) {
      noteEl.hidden = false;
      noteEl.className = 'file-note ' + noteTone;
      noteIcon.setAttribute('href', '#' + noteIconId);
      noteText.textContent = note;
    } else {
      noteEl.hidden = true;
    }

    // size block
    var before = row.querySelector('.size-before');
    var arrow = row.querySelector('.size-arrow');
    var after = row.querySelector('.size-after');
    var pill = row.querySelector('.pill-save');
    before.textContent = C.formatBytes(item.size);

    if (item.result) {
      arrow.hidden = false;
      after.hidden = false;
      after.textContent = C.formatBytes(item.result.blob.size);
      pill.hidden = false;
      var saved = C.savingsPercent(item.size, item.result.blob.size);
      pill.className = 'pill';
      if (item.result.usedOriginal) {
        pill.classList.add('pill-even');
        pill.textContent = 'Original kept';
      } else if (saved < 0) {
        pill.classList.add('pill-warn');
        pill.textContent = '+' + Math.abs(saved) + '% larger';
      } else {
        pill.classList.add('pill-save');
        pill.textContent = '−' + saved + '%';
      }
      if (item.stale) {
        pill.classList.add('pill-stale');
        pill.textContent = 'Stale';
      }
    } else {
      arrow.hidden = true;
      after.hidden = true;
      pill.hidden = true;
    }

    // actions
    var compareBtn = row.querySelector('[data-action="compare"]');
    var downloadBtn = row.querySelector('[data-action="download"]');
    var retryBtn = row.querySelector('[data-action="retry"]');
    var removeBtn = row.querySelector('[data-action="remove"]');

    var canCompare = !!item.result && item.kind !== 'pdf' && !!item.thumbUrl;
    compareBtn.hidden = !canCompare;
    downloadBtn.hidden = !item.result;
    retryBtn.hidden = !(item.status === 'error' || (item.status === 'done' && item.stale));
    removeBtn.hidden = false;

    downloadBtn.setAttribute('aria-label', 'Download squeezed ' + item.name);
    retryBtn.setAttribute('aria-label', (item.status === 'error' ? 'Retry ' : 'Squeeze again ') + item.name);
    removeBtn.setAttribute('aria-label', 'Remove ' + item.name);
    removeBtn.disabled = state.busy && item.status === 'processing';
    retryBtn.disabled = state.busy;
    compareBtn.disabled = state.busy && item.status === 'processing';
  }

  function metaLine(item) {
    var bits = [item.ext ? item.ext.toUpperCase() : 'FILE'];
    if (item.meta && item.meta.width && item.meta.height) {
      bits.push(item.meta.width + '×' + item.meta.height);
    }
    if (item.meta && item.meta.pages) {
      bits.push(item.meta.pages + (item.meta.pages === 1 ? ' page' : ' pages'));
    }
    if (item.result && item.result.qualityUsed && item.result.mimeType !== 'application/pdf') {
      bits.push('q' + Math.round(item.result.qualityUsed * 100));
    }
    return bits.join(' · ');
  }

  function handleRowAction(action, id) {
    var item = state.items.find(function (entry) {
      return entry.id === id;
    });
    if (!item) return;

    if (action === 'remove') {
      if (item.status === 'processing') return;
      removeItem(id);
      return;
    }
    if (action === 'download') {
      if (!item.result) return;
      downloadBlob(item.result.blob, item.result.fileName);
      toast('Downloaded ' + item.result.fileName, 'ok');
      return;
    }
    if (action === 'compare') {
      openCompare(item);
      return;
    }
    if (action === 'retry') {
      if (state.busy) return;
      if (!item.meta) {
        item.status = 'queued';
        item.error = null;
        item.probing = true;
        updateRow(item);
        probeItems([item]);
      } else {
        runItems([item]);
      }
    }
  }

  // ------------------------------------------------------------- estimates ---

  function scheduleEstimate() {
    clearTimeout(state.estimateTimer);
    state.estimateTimer = setTimeout(recalculateEstimates, 260);
  }

  async function recalculateEstimates() {
    var token = ++state.estimateToken;
    var items = state.items.slice();
    if (!items.length) {
      state.estimates.clear();
      state.estimating = false;
      updateSummary();
      return;
    }

    state.estimating = true;
    updateSummary();
    var signature = C.settingsSignature(state.settings);
    var result = new Map();

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (token !== state.estimateToken) return;

      if (item.status === 'done' && item.result && !item.stale) {
        result.set(item.id, item.result.blob.size);
        continue;
      }

      var cacheKey = item.id + ':' + signature;
      if (state.estimateCache.has(cacheKey)) {
        result.set(item.id, state.estimateCache.get(cacheKey));
        continue;
      }

      var bytes = null;
      if (item.kind === 'pdf') {
        bytes = engine.estimatePdf(item.file, state.settings, item.meta || {});
      } else if (item.sample && item.meta) {
        try {
          var estimate = await engine.estimateImage(
            item.sample,
            {
              width: item.meta.width,
              height: item.meta.height,
              hasAlpha: item.hasAlpha,
              mimeType: item.meta.mimeType
            },
            state.settings
          );
          if (estimate) bytes = estimate.bytes;
        } catch (err) {
          bytes = null;
        }
      }

      // The compressor keeps the original when a re-encode would be larger and
      // nothing was explicitly changed. Mirror that so estimates stay honest.
      if (bytes != null && item.kind !== 'pdf' && item.kind !== 'heic') {
        var noResize = state.settings.resizeMode !== 'exact' &&
          (state.settings.resizeMode !== 'scale' || state.settings.scale >= 100);
        var autoFormat = state.settings.format === 'auto' || state.settings.format === 'original';
        if (noResize && autoFormat && !state.settings.targetEnabled && bytes > item.size) {
          bytes = item.size;
        }
      }

      if (token !== state.estimateToken) return;
      if (bytes != null) {
        result.set(item.id, bytes);
        state.estimateCache.set(cacheKey, bytes);
        invalidateEstimateCache();
        state.estimates = result;
        updateSummary();
      }
    }

    state.estimates = result;
    state.estimating = false;
    updateSummary();
  }

  // --------------------------------------------------------------- summary ---

  function summarise() {
    var total = state.items.length;
    var before = 0;
    var after = 0;
    var done = 0;
    var estimated = 0;
    var unknown = 0;

    state.items.forEach(function (item) {
      before += item.size;
      var estimate = state.estimates.get(item.id);
      if (item.status === 'done' && item.result && !item.stale) {
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
      total: total,
      before: before,
      after: after,
      done: done,
      estimated: estimated,
      unknown: unknown,
      savings: C.savingsPercent(before, after)
    };
  }

  function updateSummary() {
    var stats = summarise();

    if (!state.items.length) {
      els.estimateValue.textContent = '—';
      els.estimatePill.textContent = '—';
      els.estimatePill.className = 'pill';
      els.estimateMeter.style.width = '0%';
      els.estimateNote.textContent = 'Add files to see a live estimate.';
      els.queueSummary.textContent = 'No files yet';
      return;
    }

    var allDone = stats.done === stats.total;
    var measuring = !allDone && (stats.unknown > 0 || state.estimating);
    var nothingYet = !allDone && stats.done === 0 && stats.estimated === 0;

    if (nothingYet) {
      els.estimateValue.textContent = '—';
      els.estimatePill.textContent = 'Measuring';
      els.estimatePill.className = 'pill';
      els.estimateMeter.style.width = '0%';
      els.estimateNote.textContent = 'Measuring your files — no uploads, this happens here.';
      els.queueSummary.textContent =
        stats.total + (stats.total === 1 ? ' file' : ' files') +
        ' · ' + C.formatBytes(stats.before) + ' · measuring…';
      els.queueCount.textContent = String(stats.total);
      return;
    }

    var prefix = allDone ? '' : '≈ ';
    els.estimateValue.textContent = prefix + C.formatBytes(stats.after);
    els.estimatePill.textContent = (stats.savings >= 0 ? '−' : '+') + Math.abs(stats.savings) + '%';
    els.estimatePill.className = 'pill' + (stats.savings < 0 ? ' is-negative' : '');
    els.estimateMeter.style.width = Math.max(0, Math.min(100, stats.savings)) + '%';

    var note;
    if (allDone) {
      note = stats.total + ' of ' + stats.total + ' squeezed · saves ' + C.formatBytes(Math.max(0, stats.before - stats.after));
    } else if (stats.done) {
      note = stats.done + ' of ' + stats.total + ' squeezed' + (measuring ? ' · measuring the rest' : ' · estimate for the rest');
    } else if (measuring) {
      note = 'Measured ' + stats.estimated + ' of ' + stats.total + ' · still measuring';
    } else {
      note = 'Measured estimate · squeeze to confirm';
    }
    if (!allDone && stats.savings < 0) note += ' · output is larger, consider a lower quality';
    els.estimateNote.textContent = note;

    els.queueCount.textContent = String(stats.total);
    els.queueSummary.textContent =
      stats.total + (stats.total === 1 ? ' file' : ' files') +
      ' · ' + C.formatBytes(stats.before) +
      ' → ' + (allDone ? '' : '≈ ') + C.formatBytes(stats.after);
  }

  function syncActions() {
    var pending = state.items.filter(function (item) {
      return item.status !== 'done' || item.stale;
    }).length;
    var done = state.items.filter(function (item) {
      return item.status === 'done' && item.result;
    }).length;

    els.squeezeBtn.disabled = state.busy || pending === 0 || !state.items.length;
    els.squeezeLabel.textContent = state.busy
      ? 'Squeezing…'
      : pending === 0 && state.items.length
        ? 'All squeezed'
        : 'Squeeze ' + (pending || state.items.length) + (pending === 1 ? ' file' : ' files');

    els.zipBtn.hidden = done === 0;
    if (done) els.zipLabel.textContent = 'ZIP (' + done + ')';
    els.clearBtn.disabled = state.busy;
    els.zipBtn.disabled = state.busy;
  }

  // ------------------------------------------------------------- processing ---

  function squeezeAll() {
    var targets = state.items.filter(function (item) {
      return item.status !== 'done' || item.stale;
    });
    if (!targets.length || state.busy) return;
    runItems(targets);
  }

  async function runItems(targets) {
    if (state.busy) return;
    var valid = targets.filter(function (item) {
      return state.items.includes(item);
    });
    if (!valid.length) return;

    state.busy = true;
    syncActions();
    state.items.forEach(updateRow);

    var options = Object.assign({}, state.settings);
    var runSignature = C.settingsSignature(state.settings);
    var cursor = 0;
    var concurrency = Math.min(2, valid.length);

    async function worker() {
      while (cursor < valid.length) {
        var item = valid[cursor++];
        await processItem(item, options);
      }
    }

    var lanes = [];
    for (var i = 0; i < concurrency; i++) lanes.push(worker());
    await Promise.all(lanes);

    state.busy = false;

    // If the controls moved while this batch was running, those results are stale.
    if (C.settingsSignature(state.settings) !== runSignature) {
      valid.forEach(function (item) {
        if (item.status === 'done') item.stale = true;
      });
      toast('Settings changed mid-batch — squeeze again to apply them.', 'info');
    }

    state.items.forEach(updateRow);
    syncActions();
    updateSummary();

    var ok = valid.filter(function (item) {
      return item.status === 'done';
    }).length;
    var failed = valid.filter(function (item) {
      return item.status === 'error';
    }).length;
    var totalSaved = valid.reduce(function (sum, item) {
      return item.result ? sum + Math.max(0, item.size - item.result.blob.size) : sum;
    }, 0);

    if (failed) {
      toast(ok + ' squeezed, ' + failed + ' failed — see the rows for details.', 'error');
      announce(ok + ' files squeezed. ' + failed + ' failed.');
    } else if (ok) {
      toast('Squeezed ' + ok + ' file' + (ok === 1 ? '' : 's') + ' · saved ' + C.formatBytes(totalSaved) + '.', 'ok');
      announce(ok + ' files squeezed. Saved ' + C.formatBytes(totalSaved) + '.');
    }
  }

  async function processItem(item, options) {
    if (!state.items.includes(item)) return;

    item.status = 'processing';
    item.progress = 2;
    item.stage = 'Preparing';
    item.error = null;
    item.stale = false;
    updateRow(item);

    try {
      var result = await engine.compress(
        item.prepared || item.file,
        options,
        function (percent, label) {
          if (!state.items.includes(item)) return;
          item.progress = Math.max(item.progress, Math.min(100, Number(percent) || 0));
          item.stage = label || '';
          updateRow(item);
        },
        {
          kind: item.kind,
          originalName: item.name,
          prepared: item.prepared,
          mimeType: item.meta && item.meta.mimeType
        }
      );

      if (!state.items.includes(item)) return;
      item.status = 'done';
      item.progress = 100;
      item.stage = 'Done';
      item.result = result;
      item.note = result.note || '';
    } catch (err) {
      if (!state.items.includes(item)) return;
      item.status = 'error';
      item.progress = 0;
      item.error = err && err.message ? err.message : 'Compression failed.';
      item.result = null;
    }

    updateRow(item);
    updateSummary();
    syncActions();
  }

  function downloadZip() {
    var completed = state.items.filter(function (item) {
      return item.status === 'done' && item.result;
    });
    if (!completed.length) return;

    if (!window.JSZip) {
      toast('The ZIP library did not load. Reload and try again.', 'error');
      return;
    }

    var zip = new window.JSZip();
    var used = new Set();
    completed.forEach(function (item) {
      var name = C.uniqueName(item.result.fileName, used);
      used.add(name);
      zip.file(name, item.result.blob);
    });

    els.zipBtn.disabled = true;
    var originalLabel = els.zipLabel.textContent;
    els.zipLabel.textContent = '0%';

    zip.generateAsync({ type: 'blob', compression: 'STORE' }, function (meta) {
      els.zipLabel.textContent = Math.round(meta.percent) + '%';
    }).then(function (blob) {
      downloadBlob(blob, 'optipress-basket.zip');
      toast('ZIP with ' + completed.length + ' files downloaded.', 'ok');
    }).catch(function () {
      toast('Could not build the ZIP.', 'error');
    }).finally(function () {
      els.zipBtn.disabled = false;
      els.zipLabel.textContent = originalLabel;
    });
  }

  // ---------------------------------------------------------------- compare ---

  function bindCompareModal() {
    els.closeModalBtn.addEventListener('click', closeCompare);
    els.compareModal.addEventListener('mousedown', function (event) {
      if (event.target === els.compareModal) closeCompare();
    });
    els.compareModal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCompare();
        return;
      }
      if (event.key === 'Tab') trapFocus(event);
    });

    els.compareArea.addEventListener('pointerdown', function (event) {
      state.compare.dragging = true;
      els.compareArea.setPointerCapture(event.pointerId);
      setFromPointer(event);
    });
    els.compareArea.addEventListener('pointermove', function (event) {
      if (!state.compare.dragging) return;
      setFromPointer(event);
    });
    els.compareArea.addEventListener('pointerup', function () {
      state.compare.dragging = false;
    });
    els.compareArea.addEventListener('pointercancel', function () {
      state.compare.dragging = false;
    });

    els.compareKnob.addEventListener('keydown', function (event) {
      var current = Number(els.compareKnob.getAttribute('aria-valuenow')) || 50;
      var next = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - (event.shiftKey ? 10 : 2);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + (event.shiftKey ? 10 : 2);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 100;
      if (next === null) return;
      event.preventDefault();
      setComparePosition(next);
    });
  }

  function trapFocus(event) {
    var focusable = els.compareModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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

  function setFromPointer(event) {
    var rect = els.compareArea.getBoundingClientRect();
    var percent = ((event.clientX - rect.left) / rect.width) * 100;
    setComparePosition(percent);
  }

  function setComparePosition(percent) {
    var value = Math.max(0, Math.min(100, percent));
    els.compareArea.style.setProperty('--pos', value + '%');
    els.compareKnob.setAttribute('aria-valuenow', String(Math.round(value)));
  }

  function openCompare(item) {
    if (!item.result) return;

    closeCompare(true);
    state.compare.item = item;
    state.compare.lastFocus = document.activeElement;

    var beforeBlob = item.prepared || item.file;
    var beforeUrl = URL.createObjectURL(beforeBlob);
    var afterUrl = URL.createObjectURL(item.result.blob);
    state.compare.urls = [beforeUrl, afterUrl];

    els.compareBefore.src = beforeUrl;
    els.compareAfter.src = afterUrl;
    els.compareFile.textContent = item.name;

    var beforeDims = item.meta && item.meta.width ? item.meta.width + '×' + item.meta.height : '—';
    var afterDims = item.result.width && item.result.height ? item.result.width + '×' + item.result.height : '—';
    els.metaBefore.textContent = C.formatBytes(item.size) + ' · ' + beforeDims;
    els.metaAfter.textContent = C.formatBytes(item.result.blob.size) + ' · ' + afterDims;
    var saved = C.savingsPercent(item.size, item.result.blob.size);
    els.metaSaved.textContent = (saved >= 0 ? '−' : '+') + Math.abs(saved) + '%';

    setComparePosition(50);
    els.compareModal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      els.compareKnob.focus();
    });
  }

  function closeCompare(silent) {
    if (els.compareModal.hidden) return;
    els.compareModal.hidden = true;
    document.body.style.overflow = '';
    state.compare.urls.forEach(function (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        /* noop */
      }
    });
    state.compare.urls = [];
    els.compareBefore.removeAttribute('src');
    els.compareAfter.removeAttribute('src');
    state.compare.item = null;
    if (!silent && state.compare.lastFocus && document.contains(state.compare.lastFocus)) {
      state.compare.lastFocus.focus();
    }
    state.compare.lastFocus = null;
  }

  // ------------------------------------------------------------ drag & paste --

  function bindDragAndDrop() {
    var hasFiles = function (event) {
      var types = event.dataTransfer && event.dataTransfer.types;
      if (!types) return false;
      return Array.prototype.indexOf.call(types, 'Files') !== -1;
    };

    window.addEventListener('dragenter', function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      state.dragDepth++;
      showDropOverlay(true);
    });

    window.addEventListener('dragover', function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', function (event) {
      if (!hasFiles(event)) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) showDropOverlay(false);
    });

    window.addEventListener('drop', function (event) {
      if (!hasFiles(event) && !(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length)) return;
      event.preventDefault();
      state.dragDepth = 0;
      showDropOverlay(false);
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        addFiles(event.dataTransfer.files, 'dropped');
      }
    });

    window.addEventListener('dragend', function () {
      state.dragDepth = 0;
      showDropOverlay(false);
    });
  }

  function showDropOverlay(visible) {
    els.dropOverlay.hidden = !visible;
    els.dropzone.classList.toggle('is-dragover', visible);
  }

  function bindPaste() {
    window.addEventListener('paste', function (event) {
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      var list = event.clipboardData ? event.clipboardData.files : null;
      if (list && list.length) {
        event.preventDefault();
        addFiles(list, 'pasted');
      }
    });
  }

  // ------------------------------------------------------------- utilities ---

  function downloadBlob(blob, filename) {
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

  function toggleTheme() {
    state.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    safeSet(STORAGE.theme, state.theme);
    applyTheme();
  }

  function promptInstall() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    state.installPrompt.userChoice.then(function (choice) {
      if (choice.outcome === 'accepted') {
        state.installPrompt = null;
        els.installBtn.hidden = true;
      }
    });
  }

  function updateProtocolHint() {
    if (typeof location === 'undefined') return;
    if (location.protocol === 'file:' && els.protocolHint) {
      els.protocolHint.hidden = false;
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (registration) {
        registration.addEventListener('updatefound', function () {
          var installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', function () {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new build is ready.', 'info', {
                label: 'Reload',
                onClick: function () {
                  window.location.reload();
                }
              });
            }
          });
        });
      }).catch(function () {
        /* offline support is a bonus, not a requirement */
      });
    });
  }
})();
