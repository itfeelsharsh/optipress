/**
 * OptiPress Ultra - Core Client-Side Compression & File Pipeline Engine
 * 100% Local Browser Execution - Zero Server Uploads
 */

class OptiPressEngine {
  constructor() {
    this.initPdfWorker();
  }

  initPdfWorker() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
    }
  }

  /**
   * Fast pre-estimation of compressed output file size
   * @param {File} file 
   * @param {Object} options 
   * @returns {Promise<{estimatedSize: number, savingPercent: number}>}
   */
  async estimateCompressedSize(file, options) {
    const originalSize = file.size;
    let quality = (options.quality || 75) / 100;
    let scale = (options.scale || 100) / 100;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

    if (options.enableTargetSize && options.targetSizeKB > 0) {
      const targetBytes = options.targetSizeKB * 1024;
      const estimated = Math.min(originalSize * 0.9, targetBytes);
      const saving = Math.max(0, Math.round((1 - (estimated / originalSize)) * 100));
      return { estimatedSize: estimated, savingPercent: saving };
    }

    let reductionFactor = 1.0;

    if (isPdf) {
      // PDF DPI scaling factor heuristic
      const dpiScale = (options.pdfDpi || 150) / 300;
      reductionFactor = Math.pow(dpiScale, 1.8) * Math.pow(quality, 0.7) * 0.85;
    } else if (isHeic) {
      // HEIC converts to compressed WebP/JPEG
      reductionFactor = Math.pow(scale, 1.8) * Math.pow(quality, 0.95) * 0.6;
    } else if (file.type === 'image/png') {
      // PNG conversion to WebP or compressed JPEG yields high compression
      if (options.outputFormat === 'image/webp' || options.outputFormat === 'image/jpeg') {
        reductionFactor = Math.pow(scale, 1.9) * Math.pow(quality, 1.1) * 0.45;
      } else {
        reductionFactor = Math.pow(scale, 1.9) * (0.6 + quality * 0.35);
      }
    } else {
      // JPEG / WebP / standard images
      reductionFactor = Math.pow(scale, 1.9) * Math.pow(quality, 1.0);
    }

    // Clamp estimation boundaries
    reductionFactor = Math.min(0.98, Math.max(0.08, reductionFactor));
    const estimatedSize = Math.round(originalSize * reductionFactor);
    const savingPercent = Math.max(0, Math.round((1 - reductionFactor) * 100));

    return { estimatedSize, savingPercent };
  }

  /**
   * Main Compression Processor Dispatcher
   */
  async compressFile(file, options, onProgress = () => {}) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

    if (isPdf) {
      return await this.compressPdf(file, options, onProgress);
    } else if (isHeic) {
      return await this.compressHeic(file, options, onProgress);
    } else {
      return await this.compressImage(file, options, onProgress);
    }
  }

  /**
   * HEIC to Compressed Blob Engine using heic2any
   */
  async compressHeic(file, options, onProgress) {
    onProgress(15, 'Converting HEIC format...');
    if (!window.heic2any) {
      throw new Error('HEIC converter library loading. Please ensure CDN script is active.');
    }

    try {
      const convertedBlob = await window.heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.95
      });
      const singleBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      const convertedFile = new File([singleBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
      
      onProgress(50, 'Compressing converted image...');
      return await this.compressImage(convertedFile, options, onProgress);
    } catch (err) {
      console.error('HEIC Conversion Error:', err);
      throw new Error('Failed to process HEIC image: ' + err.message);
    }
  }

  /**
   * Standard Image Compression via HTML5 Canvas
   */
  async compressImage(file, options, onProgress) {
    onProgress(10, 'Loading image...');
    const imageBitmap = await this.loadImageBitmap(file);

    let scale = (options.scale || 100) / 100;
    let targetWidth = Math.max(1, Math.round(imageBitmap.width * scale));
    let targetHeight = Math.max(1, Math.round(imageBitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: true });
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

    let mimeType = options.outputFormat || file.type || 'image/jpeg';
    if (mimeType === 'original') mimeType = file.type || 'image/jpeg';
    if (mimeType === 'image/png' && options.quality < 100) {
      // Convert PNG to WebP or JPEG when user requests quality reduction
      mimeType = 'image/webp';
    }

    onProgress(50, 'Optimizing quality & re-encoding...');

    if (options.enableTargetSize && options.targetSizeKB > 0) {
      return await this.adaptiveBinarySearchCompress(canvas, mimeType, options.targetSizeKB * 1024, file.name, onProgress);
    }

    const quality = (options.quality || 75) / 100;
    const compressedBlob = await this.canvasToBlob(canvas, mimeType, quality);
    
    onProgress(100, 'Complete');
    return {
      blob: compressedBlob,
      fileName: this.getOutputFileName(file.name, mimeType),
      width: targetWidth,
      height: targetHeight,
      mimeType
    };
  }

  /**
   * PDF Compression Engine: Renders PDF pages to offscreen canvas and re-assembles into a compact PDF via pdf-lib
   */
  async compressPdf(file, options, onProgress) {
    onProgress(10, 'Parsing PDF pages...');
    if (!window.pdfjsLib || !window.PDFLib) {
      throw new Error('PDF processing libraries missing. Check CDN connections.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdfDoc.numPages;

    const newPdf = await window.PDFLib.PDFDocument.create();
    const quality = (options.quality || 75) / 100;
    const targetDpi = options.pdfDpi || 150;
    const dpiScale = targetDpi / 72.0; // 72 is standard PDF point resolution

    for (let i = 1; i <= numPages; i++) {
      const stepPercent = 10 + Math.round((i / numPages) * 75);
      onProgress(stepPercent, `Processing PDF page ${i} of ${numPages}...`);

      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: dpiScale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Encode page image as JPEG
      const pageJpegBlob = await this.canvasToBlob(canvas, 'image/jpeg', quality);
      const pageJpegBytes = await pageJpegBlob.arrayBuffer();

      const embeddedImage = await newPdf.embedJpg(pageJpegBytes);
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      const newPage = newPdf.addPage([unscaledViewport.width, unscaledViewport.height]);
      newPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: unscaledViewport.width,
        height: unscaledViewport.height
      });
    }

    onProgress(90, 'Finalizing compressed PDF structure...');
    const pdfBytes = await newPdf.save();
    const compressedBlob = new Blob([pdfBytes], { type: 'application/pdf' });

    onProgress(100, 'Complete');
    return {
      blob: compressedBlob,
      fileName: file.name.replace(/\.pdf$/i, '_compressed.pdf'),
      mimeType: 'application/pdf'
    };
  }

  /**
   * Adaptive Binary Search for matching user target file size
   */
  async adaptiveBinarySearchCompress(canvas, mimeType, targetBytes, originalName, onProgress) {
    let minQ = 0.05;
    let maxQ = 0.98;
    let bestBlob = null;
    let iterations = 0;

    while (minQ <= maxQ && iterations < 6) {
      iterations++;
      let midQ = (minQ + maxQ) / 2;
      onProgress(50 + iterations * 7, `Adaptive matching target size (Pass ${iterations})...`);

      let blob = await this.canvasToBlob(canvas, mimeType, midQ);
      bestBlob = blob;

      if (Math.abs(blob.size - targetBytes) / targetBytes < 0.05) {
        break; // Within 5% threshold
      }

      if (blob.size > targetBytes) {
        maxQ = midQ - 0.05;
      } else {
        minQ = midQ + 0.05;
      }
    }

    return {
      blob: bestBlob,
      fileName: this.getOutputFileName(originalName, mimeType),
      mimeType
    };
  }

  // Helpers
  loadImageBitmap(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
  }

  getOutputFileName(originalName, mimeType) {
    const extMap = {
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/png': '.png',
      'application/pdf': '.pdf'
    };
    const newExt = extMap[mimeType] || '.jpg';
    const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
    return `${baseName}_min${newExt}`;
  }
}

window.optiPressEngine = new OptiPressEngine();
