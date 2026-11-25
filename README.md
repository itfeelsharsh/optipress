# Opti

**Live:** https://opti.harshbanker.com · **v2.3**

A local-first image and PDF workshop. Nothing is uploaded, nothing is tracked, and every tool runs in the browser tab.

## Images

- **Squeeze** — WebP/JPEG/PNG/AVIF output with a live estimate measured from real sample encodes.
- **Crop & size** — crop-to-fill or fit-inside, with passport, visa, government-form, social and print presets. A live preview shows exactly what will be written.
- **Exact file sizes** — request 400 KB and get 400 KB. Opti searches the highest quality under the cap, downsizes only when necessary, then pads with harmless metadata (JPEG comments, PNG `tEXt`, WebP `JUNK`, AVIF `free`, PDF comments) to land **byte-exact** on the limit.
- **Custom MIME output** — type any `image/*` type the browser can encode. Unsupported types are detected and blocked before the run.
- Transparency-aware output: WebP/PNG keep alpha; JPEG is matted white or black instead of turning black.

## PDF

Organise: **merge**, **split** (every N pages or custom ranges), **extract**, **delete**, **reorder**, **rotate**.
Convert: **images → PDF**, **PDF → images** (JPEG/PNG ZIP), **make searchable** (OCR).
Edit: **compress** (rasterise or keep text), **watermark**, **page numbers**.
Secure: **add password** (AES-256), **remove password**.

## Privacy

Files are decoded, re-encoded and written in the tab. There are no uploads, accounts, analytics or tracking. Every tool works fully offline after the first load, including OCR — the English model is bundled with the app.

## Development

```bash
npm install
npm run dev          # http://localhost:4173
```

## Tests

```bash
npm test             # 30 unit tests: resize/crop maths, page ranges, padding, presets, MIME choice
npm run test:e2e     # 26 real-browser checks across every tool, exact sizes, PDFs, OCR, axe, mobile
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

Built with PDF.js, pdf-lib (AES fork), heic2any, JSZip and Tesseract.js (OCR only). Type: IBM Plex Mono and Instrument Sans. Interface language inspired by [Estudely PDF](https://pdf.esdy.cc/).
