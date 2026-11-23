# OptiPress

A private, on-device file squeezer for PDFs and images. Files never leave the browser tab.

- **Formats** — PDF, HEIC/HEIF, PNG, JPEG, WebP, AVIF, GIF, BMP, SVG
- **Real numbers** — the live estimate is measured by encoding a sample of your actual pixels, not a guess
- **Target size** — binary-searches quality, then falls back to downscaling, until the file fits
- **PDF modes** — rasterise for maximum savings, or keep text selectable
- **Batch queue** — parallel processing, ZIP download, per-file download, retry, and quality comparison
- **Private by architecture** — no server, no uploads, no accounts, no tracking; EXIF (including GPS) is stripped
- **PWA** — installable and fully functional offline

## Development

```bash
npm install
npm run dev          # http://localhost:4173
```

## Tests

```bash
npm test             # pure logic: resize maths, format choice, naming, budgets
npm run test:e2e     # real Chromium: compression, target size, transparency, PDFs, ZIP, a11y
```

The end-to-end suite needs a local server and Playwright's Chromium (or system Chrome):

```bash
npm run dev
npx playwright install chromium   # once, if Chrome is not installed
npm run test:e2e
```

## Build

```bash
npm run build        # minified, hashed service worker, validated asset graph → dist/
npm run preview      # serve dist/ on http://localhost:4173
```

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`: tests, build, and deploy to GitHub Pages.
Enable **Settings → Pages → Source: GitHub Actions** once in the repository.

## How it works

- Images are decoded with `createImageBitmap` (honouring EXIF orientation), rendered to a canvas at the requested size, and re-encoded. JPEG output is matted so transparency never turns black.
- PDFs are rasterised page-by-page with PDF.js at the chosen DPI and rebuilt with pdf-lib, or re-saved with object streams to keep text selectable.
- HEIC is decoded natively where supported, otherwise with the bundled `heic2any`.
- If a re-encode would be larger than the original and nothing was explicitly changed, OptiPress keeps the original file.
- Everything is static: `index.html`, `styles.css`, `core.js`, `compressor.js`, `app.js`, plus the bundled libraries in `lib/`.

## Honest limitations

- Rasterised PDFs lose selectable text and links — switch the PDF engine to “Keep text” when that matters.
- Animated GIFs are flattened to one frame.
- Browsers cap canvas size; very large images are scaled down to stay within a 40 MP budget.
- Password-protected PDFs must be unlocked first.
