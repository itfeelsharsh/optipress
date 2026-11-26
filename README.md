# Opti

**Live:** https://opti.harshbanker.com · **v2.4**

A local-first image and PDF workshop. Nothing is uploaded, nothing is tracked, and every tool runs in the browser tab.

## Images

- **Squeeze** — WebP/JPEG/PNG/AVIF output with a live estimate measured from real sample encodes.
- **Crop & size** — crop-to-fill, fit-inside or a freeform drag selection, with passport, visa, government-form, social and print presets. A live preview shows exactly what will be written, and preset results carry a compliance badge (dimensions + size cap).
- **Scan cleanup** — grayscale, auto-contrast or black & white for photographed documents.
- **TIFF input** — single and multi-page TIFFs decode locally; the first page is processed.
- **Folder & ZIP input** — drop a folder or ZIP (including nested folders) and Opti expands the supported files inside.
- **Exact file sizes** — request 400 KB and get 400 KB. Opti searches the highest quality under the cap, downsizes only when necessary, then pads with harmless metadata (JPEG comments, PNG `tEXt`, WebP `JUNK`, AVIF `free`, PDF comments) to land **byte-exact** on the limit.
- **Custom MIME output** — type any `image/*` type the browser can encode. Unsupported types are detected and blocked before the run.
- Transparency-aware output: WebP/PNG keep alpha; JPEG is matted white or black instead of turning black.

## PDF

Organise: **merge**, **split** (every N pages or custom ranges), **extract**, **delete**, **reorder**, **rotate** — page pickers show visual thumbnails, and clicking a page toggles its range.
Convert: **images → PDF**, **PDF → images** (JPEG/PNG ZIP), **PDF → text** (local text-layer extraction), **make searchable** (OCR, with a page range and scan cleanup).
Edit: **compress** (rasterise or keep text, with a target MB ceiling), **watermark**, **page numbers**, **sign & stamp** (image signature on chosen pages), **page size** (A4/Letter/original, margins and trim), **fill form** (AcroForm, optional flatten).
Secure: **add password** (AES-256), **remove password**, **clean metadata** (title, author, producer, dates, XMP).

## Privacy

Files are decoded, re-encoded and written in the tab. There are no uploads, accounts, analytics or tracking. Every tool works fully offline after the first load, including OCR — the English model is bundled with the app.

## Development

```bash
npm install
npm run dev          # http://localhost:4173
```

## Tests

```bash
npm test             # 32 unit tests: resize/crop maths, freeform regions, page ranges, padding, presets, MIME choice
npm run test:e2e     # 40+ real-browser checks across every tool, exact sizes, PDFs, OCR, thumbnails, axe, mobile
```

The E2E suite needs a local server and Playwright Chromium (or system Chrome):

```bash
npm run dev
npx playwright install chromium   # once, if Chrome is not installed
npm run test:e2e
```

## Build

```bash
npm run build        # minified JS/CSS, hashed service worker, validated asset graph → dist/
npm run preview      # serve dist/ on http://localhost:4173
```

## Deploy

- **Vercel** — `vercel.json` builds `npm run build` and publishes `dist/` to `opti.harshbanker.com`.
- The service worker checks for updates and refreshes the app automatically when it is idle.

## Notes & limits

- Rasterising a PDF flattens text and links. Switch the engine to “keep text selectable” when that matters.
- Animated GIFs become a single frame; SVG is rasterised.
- Browsers cap canvas size; images above 40 MP are scaled to stay safe.
- Password-protected PDFs must be unlocked before page tools can read them (the Remove password tool is there for that).
- Passport/visa/government dimensions and caps are commonly cited values, not legal advice. Confirm with the issuing authority before uploading.
- OCR is English-only in this build.
- Long jobs can be cancelled with the cancel button or Escape; completed files are kept.
- A “signature” is a visual image stamp, not a cryptographic signature.
- Multi-page TIFFs process only their first page.

Built with PDF.js, pdf-lib (AES fork), heic2any, UTIF, JSZip and Tesseract.js (OCR only). Type: IBM Plex Mono and Instrument Sans. Interface language inspired by [Estudely PDF](https://pdf.esdy.cc/).
