/**
 * OptiPress Ultra - Main UI Application Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const queueSection = document.getElementById('queueSection');
  const fileList = document.getElementById('fileList');
  const queueBadge = document.getElementById('queueBadge');
  const clearBtn = document.getElementById('clearBtn');
  const compressAllBtn = document.getElementById('compressAllBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');

  // Controls Elements
  const presetBtns = document.querySelectorAll('.preset-btn');
  const qualityRange = document.getElementById('qualityRange');
  const qualityVal = document.getElementById('qualityVal');
  const scaleRange = document.getElementById('scaleRange');
  const scaleVal = document.getElementById('scaleVal');
  const pdfDpiSelect = document.getElementById('pdfDpiSelect');
  const formatSelect = document.getElementById('formatSelect');
  const targetSizeToggle = document.getElementById('targetSizeToggle');
  const targetSizeInputRow = document.getElementById('targetSizeInputRow');
  const targetSizeKB = document.getElementById('targetSizeKB');

  // Estimator Elements
  const estSize = document.getElementById('estSize');
  const estSavings = document.getElementById('estSavings');

  // Modal Elements
  const compareModal = document.getElementById('compareModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const compareWrapper = document.getElementById('compareWrapper');
  const originalImgPreview = document.getElementById('originalImgPreview');
  const compressedImgPreview = document.getElementById('compressedImgPreview');
  const compareHandle = document.getElementById('compareHandle');

  // App State Queue
  let fileQueue = [];
  let isDraggingCompare = false;

  // Preset Handlers
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mode = btn.dataset.preset;
      if (mode === 'lossless') {
        qualityRange.value = 90;
        scaleRange.value = 100;
      } else if (mode === 'balanced') {
        qualityRange.value = 75;
        scaleRange.value = 100;
      } else if (mode === 'maximum') {
        qualityRange.value = 50;
        scaleRange.value = 80;
      }

      updateControlLabels();
      triggerEstimator();
    });
  });

  // Range Slider & Select Events
  qualityRange.addEventListener('input', () => {
    updateControlLabels();
    triggerEstimator();
  });

  scaleRange.addEventListener('input', () => {
    updateControlLabels();
    triggerEstimator();
  });

  pdfDpiSelect.addEventListener('change', triggerEstimator);
  formatSelect.addEventListener('change', triggerEstimator);

  targetSizeToggle.addEventListener('change', (e) => {
    targetSizeInputRow.style.display = e.target.checked ? 'block' : 'none';
    triggerEstimator();
  });

  targetSizeKB.addEventListener('input', triggerEstimator);

  function updateControlLabels() {
    qualityVal.textContent = `${qualityRange.value}%`;
    scaleVal.textContent = `${scaleRange.value}%`;
  }

  // Real-Time Estimator Updates
  async function triggerEstimator() {
    if (fileQueue.length === 0) {
      estSize.textContent = '~0 KB';
      estSavings.textContent = '0% Savings';
      return;
    }

    const options = getCompressionOptions();
    let totalOriginal = 0;
    let totalEstimated = 0;

    for (const item of fileQueue) {
      totalOriginal += item.file.size;
      const est = await window.optiPressEngine.estimateCompressedSize(item.file, options);
      totalEstimated += est.estimatedSize;
    }

    const overallSavings = Math.max(0, Math.round((1 - (totalEstimated / totalOriginal)) * 100));
    estSize.textContent = `~${formatBytes(totalEstimated)}`;
    estSavings.textContent = `-${overallSavings}% Savings`;
  }

  function getCompressionOptions() {
    return {
      quality: parseInt(qualityRange.value, 10),
      scale: parseInt(scaleRange.value, 10),
      pdfDpi: parseInt(pdfDpiSelect.value, 10),
      outputFormat: formatSelect.value,
      enableTargetSize: targetSizeToggle.checked,
      targetSizeKB: parseFloat(targetSizeKB.value) || 500
    };
  }

  // Dropzone & Mobile Upload Events
  const mobileUploadBtn = document.getElementById('mobileUploadBtn');
  if (mobileUploadBtn) {
    mobileUploadBtn.addEventListener('click', () => fileInput.click());
  }

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      addFilesToQueue(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });

  // Queue Management
  function addFilesToQueue(files) {
    files.forEach(file => {
      const id = 'f_' + Math.random().toString(36).substr(2, 9);
      const item = {
        id,
        file,
        status: 'idle', // idle, processing, done, error
        progress: 0,
        result: null,
        error: null
      };
      fileQueue.push(item);
    });

    renderQueue();
    triggerEstimator();
  }

  function renderQueue() {
    if (fileQueue.length === 0) {
      queueSection.style.display = 'none';
      return;
    }

    queueSection.style.display = 'flex';
    queueBadge.textContent = `${fileQueue.length} ${fileQueue.length === 1 ? 'File' : 'Files'}`;

    fileList.innerHTML = '';
    let hasCompletedFiles = false;

    fileQueue.forEach(item => {
      if (item.status === 'done') hasCompletedFiles = true;

      const card = document.createElement('div');
      card.className = 'file-card';
      card.id = `card-${item.id}`;

      const ext = item.file.name.split('.').pop().toUpperCase();
      const isImage = item.file.type.startsWith('image/') || ['HEIC', 'HEIF', 'JPG', 'JPEG', 'PNG', 'WEBP'].includes(ext);

      let fruitIcon = '📄';
      if (['JPG', 'JPEG'].includes(ext)) fruitIcon = '🌄';
      else if (['PNG'].includes(ext)) fruitIcon = '🖼️';
      else if (['WEBP'].includes(ext)) fruitIcon = '⚡';
      else if (['HEIC', 'HEIF'].includes(ext)) fruitIcon = '📸';
      else if (['PDF'].includes(ext)) fruitIcon = '📄';

      let actionButtons = '';
      if (item.status === 'idle') {
        actionButtons = `
          <button class="icon-btn remove-btn" data-id="${item.id}" title="Remove file">
            &times;
          </button>
        `;
      } else if (item.status === 'processing') {
        actionButtons = `
          <div class="spinner" style="width: 24px; height: 24px; border: 3px solid var(--fruit-orange-bg); border-top-color: var(--fruit-orange); border-radius: 50%; animation: spin 1s linear infinite;"></div>
        `;
      } else if (item.status === 'done') {
        actionButtons = `
          ${isImage ? `<button class="icon-btn compare-btn" data-id="${item.id}" title="Inspect Quality">🔍</button>` : ''}
          <button class="icon-btn download-btn" data-id="${item.id}" title="Download Fresh File">
            ⬇️
          </button>
        `;
      } else if (item.status === 'error') {
        actionButtons = `<span style="color: var(--fruit-strawberry); font-size: 0.85rem; font-weight: bold;">Error</span>`;
      }

      let metaText = `${formatBytes(item.file.size)}`;
      if (item.status === 'done' && item.result) {
        const savedPercent = Math.max(0, Math.round((1 - (item.result.blob.size / item.file.size)) * 100));
        metaText += ` ➔ <strong style="color: var(--text-dark);">${formatBytes(item.result.blob.size)}</strong> <span class="savings-tag">-${savedPercent}% Saved</span>`;
      }

      card.innerHTML = `
        <div class="file-preview-thumb">
          <span>${fruitIcon}</span>
        </div>
        <div class="file-info">
          <div class="file-name" title="${item.file.name}">${item.file.name}</div>
          <div class="file-meta">${metaText}</div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${item.progress}%"></div>
          </div>
        </div>
        <div class="file-actions">
          ${actionButtons}
        </div>
      `;

      fileList.appendChild(card);
    });

    downloadZipBtn.style.display = hasCompletedFiles ? 'inline-flex' : 'none';
    attachQueueItemEvents();
  }

  function attachQueueItemEvents() {
    document.querySelectorAll('.remove-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        fileQueue = fileQueue.filter(item => item.id !== id);
        renderQueue();
        triggerEstimator();
      };
    });

    document.querySelectorAll('.download-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const item = fileQueue.find(i => i.id === id);
        if (item && item.result) {
          downloadBlob(item.result.blob, item.result.fileName);
        }
      };
    });

    document.querySelectorAll('.compare-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const item = fileQueue.find(i => i.id === id);
        if (item && item.result) {
          openComparisonModal(item);
        }
      };
    });
  }

  // Clear & Compress Batch Handlers
  clearBtn.onclick = () => {
    fileQueue = [];
    renderQueue();
    triggerEstimator();
  };

  compressAllBtn.onclick = async () => {
    const options = getCompressionOptions();

    for (const item of fileQueue) {
      if (item.status === 'done') continue;

      item.status = 'processing';
      item.progress = 10;
      renderQueue();

      try {
        const result = await window.optiPressEngine.compressFile(item.file, options, (prog, text) => {
          item.progress = prog;
          renderQueue();
        });

        item.status = 'done';
        item.progress = 100;
        item.result = result;
      } catch (err) {
        console.error('Compression Failed:', err);
        item.status = 'error';
        item.error = err.message;
      }
      renderQueue();
    }
  };

  // JSZip Batch Downloader
  downloadZipBtn.onclick = async () => {
    if (!window.JSZip) {
      alert('ZIP archive generator missing. Check network connectivity.');
      return;
    }

    const zip = new window.JSZip();
    const completedItems = fileQueue.filter(i => i.status === 'done' && i.result);

    completedItems.forEach(item => {
      zip.file(item.result.fileName, item.result.blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, 'OptiPress_Compressed_Files.zip');
  };

  // Split-Slider Comparison Modal
  function openComparisonModal(item) {
    const origUrl = URL.createObjectURL(item.file);
    const compUrl = URL.createObjectURL(item.result.blob);

    originalImgPreview.src = origUrl;
    compressedImgPreview.src = compUrl;

    compareModal.classList.add('active');
    setSplitSliderPosition(50);
  }

  closeModalBtn.onclick = () => {
    compareModal.classList.remove('active');
  };

  compareModal.onclick = (e) => {
    if (e.target === compareModal) compareModal.classList.remove('active');
  };

  // Split slider mouse & touch drag events
  compareHandle.addEventListener('mousedown', () => isDraggingCompare = true);
  window.addEventListener('mouseup', () => isDraggingCompare = false);
  window.addEventListener('mousemove', (e) => {
    if (!isDraggingCompare) return;
    const rect = compareWrapper.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let percentage = (x / rect.width) * 100;
    percentage = Math.max(0, Math.min(100, percentage));
    setSplitSliderPosition(percentage);
  });

  function setSplitSliderPosition(percentage) {
    compareHandle.style.left = `${percentage}%`;
    originalImgPreview.style.clipPath = `polygon(0 0, ${percentage}% 0, ${percentage}% 100%, 0 100%)`;
  }

  // Utility
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==========================================================================
  // PWA Service Worker Registration & Mobile Installation Prompt Handler
  // ==========================================================================
  const pwaInstallBtn = document.getElementById('pwaInstallBtn');
  let deferredPrompt = null;

  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 768);
  }

  function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone || document.referrer.includes('android-app://');
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered successfully:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show Install App button ONLY if user is on mobile AND app is not already installed
    if (pwaInstallBtn && isMobileDevice() && !isAppInstalled()) {
      pwaInstallBtn.style.display = 'inline-flex';
    } else if (pwaInstallBtn) {
      pwaInstallBtn.style.display = 'none';
    }
  });

  if (pwaInstallBtn) {
    if (!isMobileDevice() || isAppInstalled()) {
      pwaInstallBtn.style.display = 'none';
    }

    pwaInstallBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] User choice:', outcome);
      deferredPrompt = null;
      pwaInstallBtn.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] OptiPress Fruity app installed!');
    if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
  });
});
