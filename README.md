# 🧼 Image Toolbox

A collection of **free, 100% client-side** image tools. Everything runs in your
browser — your images are **never uploaded**, there are no limits, no sign-up,
and nothing for anyone to leak. Installable as an app and works offline.

**Live:** https://goodermine.github.io/toolbox/

## Tools

| Tool | Page | What it does |
|------|------|--------------|
| 🧼 **Clean metadata** | `/` (Clean tab) | Strip EXIF, GPS, XMP, IPTC, C2PA, and the text chunks where AI tools hide generation data — losslessly. |
| 🔍 **Upscale** | `/` (Upsize tab) | Enlarge 2×/4× with an ESRGAN AI super-resolution model, or instant Fast mode. Before/after compare slider. |
| ✂️ **Remove background** | `/background/` | Cut out the subject with a U²-Net model, output a transparent PNG. |
| 🖼️ **HEIC → JPG** | `/heic/` | Convert iPhone HEIC/HEIF photos to JPG or PNG. |
| 🗜️ **Compress & convert** | `/compress/` | Shrink file size and convert between JPG/PNG/WebP, with optional resize. |
| 🔎 **Metadata viewer** | `/metadata/` | See hidden EXIF/GPS/text data and detect AI-provenance signals (C2PA, tool names, IPTC tags). |
| 🔳 **QR code generator** | `/qr/` | Make QR codes for a URL, text, or contact (vCard). Download as PNG. |
| 📄 **Merge PDF** | `/merge-pdf/` | Combine multiple PDFs into one (reorderable, lossless). |

All tools support **drag-and-drop, batch processing, and ZIP download**, and are
private by design — open your browser's Network tab and you'll see nothing
uploaded.

## Project structure

```
index.html            Home: Clean + Upsize tabs, tools grid
app.js                Metadata cleaner
upscale.js            AI/Fast upscaler (+ tab switching)
shared.js             Shared helpers (window.ImgUtil) + service-worker registration
styles.css            All styling
sw.js                 Service worker (offline / installable PWA)
manifest.webmanifest  PWA manifest
sitemap.xml, robots.txt, og-image.png, icon-*.png

heic/       compress/   metadata/   background/   → each: index.html + its <tool>.js
vendor/     Third-party libraries + AI models (vendored, see vendor/README.md)
.github/workflows/deploy-pages.yml   Auto-deploy to GitHub Pages
```

Each tool page is standalone (its own SEO metadata) and reuses `styles.css` and
`shared.js`.

## Third-party libraries (all vendored, permissively licensed)

| Library | Used by | License |
|---------|---------|---------|
| [TensorFlow.js](https://www.tensorflow.org/js) + [UpscalerJS](https://upscalerjs.com/) + ESRGAN model | Upscaler | Apache-2.0 / MIT |
| [ONNX Runtime Web](https://onnxruntime.ai/) + U²-Net model | Background remover | MIT / Apache-2.0 |
| [heic2any](https://github.com/alexcorvi/heic2any) | HEIC converter | MIT |
| [browser-image-compression](https://github.com/Donaldcwl/browser-image-compression) | Compress | MIT |
| [exifr](https://github.com/MikeKovarik/exifr) | Metadata viewer | MIT |
| [node-qrcode](https://github.com/soldair/node-qrcode) | QR generator | MIT |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Merge PDF | MIT |

Everything is loaded from `/vendor` (never a CDN), so the tools stay private and
work offline after first use. See [`vendor/README.md`](vendor/README.md).

## Run it locally

Static files — any web server works:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
# or: npx serve .
```

> A local server (rather than opening `index.html` via `file://`) avoids browser
> security quirks with workers and the service worker.

## Deploy

No backend, so any static host works. This repo auto-deploys to **GitHub Pages**
via `.github/workflows/deploy-pages.yml` on every push to the default branch
(set Settings → Pages → Source: GitHub Actions once). Netlify / Vercel /
Cloudflare Pages also work with default settings (no build, publish the root).

## License

[MIT](LICENSE) © goodermine. Vendored libraries and models retain their own
licenses (see the table above and `vendor/README.md`).
