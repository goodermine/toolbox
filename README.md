# 🧼 Image Metadata Cleaner

A free, private, **100% client-side** tool for stripping metadata from images —
EXIF, XMP, IPTC, color profiles, C2PA "Content Credentials", and the text chunks
where AI tools (Stable Diffusion, DALL·E, Midjourney) hide generation parameters
and "Made with AI" labels.

It's an open alternative to sites like aimetadatacleaner.com — but because **all
the work happens in your browser**, there are no uploads, no daily limits, no
sign-up, and nothing for anyone to leak.

## Why this is better than the site you were using

| | Typical online cleaner | This tool |
|---|---|---|
| Where images go | Uploaded to their server | Never leave your device |
| Daily limit | ~3 images (free tier) | Unlimited |
| Cost | Paywalled | Free |
| Quality | Often re-compressed | Lossless by default |
| Privacy | Trust required | Verifiable (watch the Network tab) |

## Features

- **Drag & drop** any number of images at once.
- **Lossless mode** (default): deletes only metadata segments and keeps your
  pixel data byte-for-byte — no quality loss.
  - **JPEG** — removes EXIF, XMP, IPTC/Photoshop, JPEG comments, and C2PA/JUMBF.
    Keeps the JFIF header and (optionally) the ICC color profile.
  - **PNG** — removes `tEXt`/`zTXt`/`iTXt` (AI parameters), `eXIf`, `tIME`, etc.
  - **WebP** — removes `EXIF`/`XMP` chunks and clears the matching `VP8X` flags.
- **Deep clean mode**: re-encodes the image via `<canvas>` to guarantee removal
  of anything unusual (also handles GIF/BMP/other formats).
- **Download all** as a `.zip` (built in plain JS — no dependencies).
- Shows you exactly **what was removed** from each file.

## Run it locally

It's three static files, so any web server works:

```bash
# Python
python3 -m http.server 8000
# then open http://localhost:8000

# …or Node
npx serve .
```

> Opening `index.html` directly via `file://` mostly works, but a local server
> avoids browser security quirks with some APIs.

## Host it for free

Pick any static host — there's no backend:

- **GitHub Pages:** push this repo, then enable Pages (Settings → Pages →
  deploy from branch). Your site goes live at `https://<user>.github.io/<repo>/`.
- **Netlify / Vercel / Cloudflare Pages:** "import repository" and deploy with
  the default settings (no build command, publish the repo root).

## How metadata removal works

Image files are containers made of segments/chunks. Metadata lives in specific,
labeled segments. This tool parses the container, copies the structural and
pixel data through unchanged, and drops the segments known to carry metadata.
Because we never touch the compressed image data, the result is visually
identical to the original — just without the hidden information.

For formats we don't parse natively, or when you tick **Deep clean**, the image
is drawn onto an HTML canvas and re-exported; the canvas API does not carry
metadata across, so the output is clean by construction.

## License

Use it however you like.
