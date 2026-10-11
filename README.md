# HCC2D Web Encoder 0.9.0

Written by Marco Querini.

Client-side browser encoder for standard QR Code, HCC2D4, and HCC2D8. The
public HCC2D C reference encoder 0.9.0 is compiled to WebAssembly and runs in a
dedicated Web Worker. Encoding does not require a server-side API.

## Official links

- HCC2D website: <https://hcc2d.com/en/>
- HCC2D Code Specification 0.9.0: <https://doi.org/10.5281/zenodo.22206528>
- HCC2D API: <https://hcc2d.com/en/api>
- HCC2D Decoder on Google Play: <https://play.google.com/store/apps/details?id=com.hcc2d.decoder>
- HCC2D Decoder on Huawei AppGallery:
  <https://appgallery.cloud.huawei.com/marketshare/app/C117478101>
- HCC2D Decoder on the App Store: <https://apps.apple.com/app/id6762202762>
- HCC2D Encoder on the Mac App Store: <https://apps.apple.com/app/id6767833986>

## Supported features

- standard black/white QR Code
- HCC2D4 with 4 colours and 2 bits per data module
- HCC2D8 with 8 colours and 3 bits per data module
- EC levels `L`, `M`, `Q`, and `H`
- versions `1..40`, or automatic selection
- screen-oriented Model 1 and print-oriented Model 2 palettes
- custom HCC2D4 palettes with fixed black/white anchors and validated colour
  separation
- raw payloads and optional HCC2DF wrapping
- text, binary-file, URL, and vCard input
- indexed PNG preview and download
- light, dark, and system themes
- complete interface localization in English, Spanish, Italian, Japanese, and
  Simplified Chinese
- responsive layouts for desktop, tablet, and phone viewports
- service-worker caching for use after the first successful online load

## Use from a clone

Requirements for a local build:

- Node.js 24.11 LTS or later
- Emscripten SDK 6.0.12

The project has no npm runtime dependencies. With `emcc` available in the
current shell:

```bash
npm run build
npm test
npm run serve
```

Open <http://127.0.0.1:8080/>. Do not open `dist/index.html` directly through
a `file:` URL: WebAssembly workers and offline caching require an HTTP or HTTPS
origin.

The build recreates `dist/`, copies the static application, compiles the
WebAssembly bridge, and writes a content-derived service-worker cache version.

## Input and output behaviour

`Automatic` payload format uses raw UTF-8 bytes for text, URLs, and vCards. It
uses an HCC2DF container for files so that the filename can be retained and
eligible content can be compressed by the reference encoder. Selecting `Raw
bytes` or `HCC2DF container` overrides that choice.

Custom palettes are available for HCC2D4. Colour index 0 remains black and
index 3 remains white; the two intermediate RGB colours are editable. Every
pair in the four-colour palette must have a Euclidean RGB distance of at least
128, matching the validation in the reference encoder.

Browser-facing safety limits are:

- source input: 64 KiB before optional HCC2DF compression
- pixel scale: `6..64`
- quiet zone: `0..64` modules
- generated raster: at most 4096 x 4096 pixels

Format capacity still depends on mode, version, and error-correction level. An
input within the 64 KiB browser limit can therefore still be too large for a
single symbol. Such failures are reported in the interface.

## Architecture and provenance

```text
Browser interface
  -> transferable ArrayBuffer
  -> Web Worker
  -> C bridge
  -> HCC2D C encoder 0.9.0 compiled to WebAssembly
  -> in-memory indexed PNG
  -> local preview and download
```

[`upstream/single_file_c_hcc2d_encoder_v0.9.0.c`](upstream/single_file_c_hcc2d_encoder_v0.9.0.c)
is a byte-for-byte copy of the public
[single-file C reference encoder](https://github.com/marco-querini/hcc2d-cli-c-encoder).
[`src/hcc2d_wasm.c`](src/hcc2d_wasm.c) provides the memory-oriented browser
bridge; it does not reimplement the encoding algorithm.

Pinned upstream SHA-256:

```text
8566a5f9c1c0521257ea9aa52b6a4eb50d711cdb4c56a087447d97dfda7e9ff1
```

## Validation

Run the source and structural tests with:

```bash
npm test
```

With the built site running on port 8080, run the Chromium browser test in a
second terminal:

```bash
npm run smoke
```

The automated browser test checks:

- a known HCC2D4 PNG against its exact SHA-256 output
- the PNG palette produced by a custom HCC2D4 palette
- successful QR Code, HCC2D4, and HCC2D8 generation
- a forced HCC2D4 version 40 rendered as a 1122 x 1122 PNG
- Model 2 selection and the maximum-raster safety error
- service-worker activation and light/dark theme switching
- switching among all five interface languages
- absence of horizontal overflow at 390x844, 844x390, 768x1024,
  1024x768, 1366x768, and 1920x1080 CSS-pixel viewports
- equal-width editor and preview panels, with a wide single-column preview on
  tablet and phone layouts
- uncaught JavaScript exceptions and browser console errors

This is an automated Chromium check, not a claim of testing every browser,
operating system, input method, or physical device.

## Deployment

All application asset URLs are relative, so the built site can be served from
an origin root or a project subpath. It is a static application: any HTTPS
static host that serves `.wasm` as `application/wasm` can host the contents of
`dist/`.

Apache License 2.0 already permits recipients to use, reproduce, modify, and
distribute the work, including building it and hosting it on their own
servers, subject to the complete license terms. No additional self-hosting
clause is needed. Redistributors must follow the applicable conditions in
section 4 of [LICENSE](LICENSE), including preserving required notices and
marking modified files when the license requires it.

See [PUBLISHING.md](PUBLISHING.md) for the validation and deployment checklist.

## Security and privacy

The application has no analytics, advertising, external fonts, upload code,
or application API calls. Source content and generated PNG data stay in the
browser's memory. The host still serves the application files and may keep
ordinary access logs according to its own configuration.

After a successful initial load, the service worker caches the application
shell, JavaScript, and WebAssembly files. Offline availability depends on
browser service-worker support and on that cache not having been cleared.

The project includes a restrictive Content Security Policy in the HTML. A
self-host can also send equivalent or stricter HTTP security headers after
testing them with the application.

## License and warranty

Copyright 2010-2026 Marco Querini.

SPDX-License-Identifier: Apache-2.0. See [LICENSE](LICENSE) for the complete
license text.

This software is provided "as is", without warranties or conditions of any
kind, express or implied. Use is entirely at your own risk. The author assumes
no responsibility or liability for damages, losses, unreadable or
non-decodable codes, failed scans, data loss, or other consequences arising
from its use. The complete governing terms are in [LICENSE](LICENSE).

## Notice

The views expressed in connection with the HCC2D Code Specification, HCC2D
applications distributed through app stores, and HCC2D source code released
as open source are solely those of the author and do not necessarily reflect
the official position of any institution, organization, or employer with
which the author is or has been affiliated.
