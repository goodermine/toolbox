# Vendored third-party assets

These files are bundled locally so the site stays fully self-hosted and
private (the AI model is fetched from this repo, never a third-party CDN,
and works offline after first load).

| File | Project | License |
|------|---------|---------|
| `tf.min.js` | [TensorFlow.js](https://github.com/tensorflow/tfjs) v4.11.0 | Apache-2.0 |
| `upscaler.min.js` | [UpscalerJS](https://github.com/thekevinscott/UpscalerJS) | MIT |
| `models/esrgan-slim/**` | [@upscalerjs/esrgan-slim](https://upscalerjs.com/models/available/upscaling/esrgan-slim/) (ESRGAN, trained on DIV2K) | MIT |
| `heic2any.min.js` | [heic2any](https://github.com/alexcorvi/heic2any) (bundles libheif WASM) | MIT |
| `browser-image-compression.js` | [browser-image-compression](https://github.com/Donaldcwl/browser-image-compression) | MIT |
| `exifr.umd.js` | [exifr](https://github.com/MikeKovarik/exifr) (full build) | MIT |

The ESRGAN Slim model (`x2`, `x4`) is a small super-resolution network
(~0.9 MB each) chosen so it loads quickly and runs in the browser.
