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

  // Custom Dimensions Elements
  const dimModeScaleBtn = document.getElementById('dimModeScaleBtn');
  const dimModeCustomBtn = document.getElementById('dimModeCustomBtn');
  const scaleModeContainer = document.getElementById('scaleModeContainer');
  const customModeContainer = document.getElementById('customModeContainer');
  const customWidth = document.getElementById('customWidth');
  const customHeight = document.getElementById('customHeight');
  const lockAspectBtn = document.getElementById('lockAspectBtn');
  const lockIcon = document.getElementById('lockIcon');
  const bgWhiteBtn = document.getElementById('bgWhiteBtn');
  const bgBlackBtn = document.getElementById('bgBlackBtn');
  const dimensionWarningBox = document.getElementById('dimensionWarningBox');
  const dimWarningIcon = document.getElementById('dimWarningIcon');
  const dimWarningText = document.getElementById('dimWarningText');

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

  // App State Queue & Dimension Settings
  let fileQueue = [];
  let isDraggingCompare = false;
  let dimensionMode = 'scale'; // 'scale' | 'custom'
  let isAspectLocked = true;
  let canvasBgColor = 'white'; // 'white' | 'black'
  let activeAspectRatio = null; // Width / Height

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

  // Dimension Mode Toggle Handlers
  dimModeScaleBtn.addEventListener('click', () => {
    dimensionMode = 'scale';
    dimModeScaleBtn.classList.add('active');
    dimModeCustomBtn.classList.remove('active');
    scaleModeContainer.style.display = 'block';
    customModeContainer.style.display = 'none';
    updateControlLabels();
    triggerEstimator();
  });

  dimModeCustomBtn.addEventListener('click', () => {
    dimensionMode = 'custom';
    dimModeCustomBtn.classList.add('active');
    dimModeScaleBtn.classList.remove('active');
    scaleModeContainer.style.display = 'none';
    customModeContainer.style.display = 'flex';

    // Auto-fill width/height from queue if empty
    if (!customWidth.value && !customHeight.value) {
      const firstImg = fileQueue.find(item => item.originalWidth && item.originalHeight);
      if (firstImg) {
        customWidth.value = firstImg.originalWidth;
        customHeight.value = firstImg.originalHeight;
        activeAspectRatio = firstImg.originalWidth / firstImg.originalHeight;
      } else {
        customWidth.value = '1200';
        customHeight.value = '800';
        activeAspectRatio = 1200 / 800;
      }
    } else if (customWidth.value && customHeight.value) {
      activeAspectRatio = parseFloat(customWidth.value) / parseFloat(customHeight.value);
    }

    updateControlLabels();
    updateDimensionWarning();
    triggerEstimator();
  });

  // Custom Dimension Inputs & Aspect Ratio Locking Handlers
  customWidth.addEventListener('input', () => {
    const w = parseFloat(customWidth.value);
    if (isAspectLocked && w > 0 && activeAspectRatio) {
      customHeight.value = Math.max(1, Math.round(w / activeAspectRatio));
    } else if (!isAspectLocked && w > 0 && parseFloat(customHeight.value) > 0) {
      activeAspectRatio = w / parseFloat(customHeight.value);
    }
    updateControlLabels();
    updateDimensionWarning();
    triggerEstimator();
  });

  customHeight.addEventListener('input', () => {
    const h = parseFloat(customHeight.value);
    if (isAspectLocked && h > 0 && activeAspectRatio) {
      customWidth.value = Math.max(1, Math.round(h * activeAspectRatio));
    } else if (!isAspectLocked && h > 0 && parseFloat(customWidth.value) > 0) {
      activeAspectRatio = parseFloat(customWidth.value) / h;
    }
    updateControlLabels();
    updateDimensionWarning();
    triggerEstimator();
  });

  lockAspectBtn.addEventListener('click', () => {
    isAspectLocked = !isAspectLocked;
    lockAspectBtn.classList.toggle('active', isAspectLocked);
    lockIcon.textContent = isAspectLocked ? '🔒' : '🔓';
    lockAspectBtn.title = isAspectLocked ? 'Aspect Ratio Locked' : 'Aspect Ratio Unlocked';

    const w = parseFloat(customWidth.value);
    const h = parseFloat(customHeight.value);
    if (isAspectLocked && w > 0 && h > 0) {
      activeAspectRatio = w / h;
    }
  });

  // Background Color Selector Handlers
  bgWhiteBtn.addEventListener('click', () => {
    canvasBgColor = 'white';
    bgWhiteBtn.classList.add('active');
    bgBlackBtn.classList.remove('active');
    updateDimensionWarning();
  });

  bgBlackBtn.addEventListener('click', () => {
    canvasBgColor = 'black';
    bgBlackBtn.classList.add('active');
    bgWhiteBtn.classList.remove('active');
    updateDimensionWarning();
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
    if (dimensionMode === 'scale') {
      scaleVal.textContent = `${scaleRange.value}%`;
    } else {
      const w = customWidth.value || '?';
      const h = customHeight.value || '?';
      scaleVal.textContent = `${w}×${h}px`;
    }
  }

  // Dynamic Aspect Ratio & Centering Warning Evaluator
  function updateDimensionWarning() {
    if (dimensionMode !== 'custom') return;

    const reqW = parseInt(customWidth.value, 10);
    const reqH = parseInt(customHeight.value, 10);

    if (!reqW || !reqH || reqW <= 0 || reqH <= 0) {
      dimensionWarningBox.className = 'dim-warning-box';
      dimWarningIcon.textContent = '💡';
      dimWarningText.textContent = 'Specify both width and height. Images with mismatched aspect ratios will be centered.';
      return;
    }

    const targetRatio = reqW / reqH;
    const imageItems = fileQueue.filter(item => item.originalWidth && item.originalHeight);

    if (imageItems.length === 0) {
      dimensionWarningBox.className = 'dim-warning-box';
      dimWarningIcon.textContent = '💡';
      dimWarningText.textContent = `Target size: ${reqW}×${reqH}px. Images matching this ratio resize directly; others will be centered with a ${canvasBgColor} background.`;
      return;
    }

    let hasMismatch = false;

    imageItems.forEach(item => {
      const imgRatio = item.originalWidth / item.originalHeight;
      const diff = Math.abs(imgRatio - targetRatio) / imgRatio;
      if (diff >= 0.008) {
        hasMismatch = true;
      }
    });

    if (hasMismatch) {
      dimensionWarningBox.className = 'dim-warning-box warning';
      dimWarningIcon.textContent = '⚠️';
      dimWarningText.textContent = `Aspect ratio differs from original image! Image will be proportionally fitted & centered on a ${canvasBgColor.toUpperCase()} background to prevent distortion.`;
    } else {
      dimensionWarningBox.className = 'dim-warning-box success';
      dimWarningIcon.textContent = '✓';
      dimWarningText.textContent = 'Proportional match: Image matches target aspect ratio perfectly (no background borders needed).';
    }
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
      dimensionMode: dimensionMode,
      customWidth: parseInt(customWidth.value, 10) || null,
      customHeight: parseInt(customHeight.value, 10) || null,
      canvasBgColor: canvasBgColor,
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
        error: null,
        originalWidth: null,
        originalHeight: null
      };

      // Probe image dimensions for instant aspect ratio awareness
      const ext = file.name.split('.').pop().toUpperCase();
      const isImg = file.type.startsWith('image/') || ['JPG', 'JPEG', 'PNG', 'WEBP'].includes(ext);
      if (isImg) {
        const probeImg = new Image();
        const probeUrl = URL.createObjectURL(file);
        probeImg.onload = () => {
          URL.revokeObjectURL(probeUrl);
          item.originalWidth = probeImg.naturalWidth;
          item.originalHeight = probeImg.naturalHeight;

          // If custom dimension inputs are currently blank, pre-fill from first image
          if (!customWidth.value && !customHeight.value) {
            customWidth.value = probeImg.naturalWidth;
            customHeight.value = probeImg.naturalHeight;
            activeAspectRatio = probeImg.naturalWidth / probeImg.naturalHeight;
            updateControlLabels();
          }
          updateDimensionWarning();
          triggerEstimator();
          renderQueue();
        };
        probeImg.onerror = () => {
          URL.revokeObjectURL(probeUrl);
        };
        probeImg.src = probeUrl;
      }

      fileQueue.push(item);
    });

    renderQueue();
    updateDimensionWarning();
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
      if (item.originalWidth && item.originalHeight) {
        metaText += ` (${item.originalWidth}×${item.originalHeight})`;
      }

      if (item.status === 'done' && item.result) {
        const savedPercent = Math.max(0, Math.round((1 - (item.result.blob.size / item.file.size)) * 100));
        metaText += ` ➔ <strong style="color: var(--text-dark);">${formatBytes(item.result.blob.size)}</strong>`;
        if (item.result.width && item.result.height) {
          metaText += ` (${item.result.width}×${item.result.height})`;
        }
        metaText += ` <span class="savings-tag">-${savedPercent}% Saved</span>`;
        if (item.result.isCentered) {
          const bgText = item.result.bgColor === 'black' ? 'Black BG' : 'White BG';
          metaText += ` <span class="tag tag-centered" style="font-size: 0.72rem; padding: 0.1rem 0.45rem; background: ${item.result.bgColor === 'black' ? '#222' : '#f0f0f0'}; color: ${item.result.bgColor === 'black' ? '#fff' : '#333'}; border: 1px solid #ccc;">🔲 Centered (${bgText})</span>`;
        }
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
        updateDimensionWarning();
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
    updateDimensionWarning();
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
