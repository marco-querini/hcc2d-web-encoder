import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const pageUrl = process.argv[2] || "http://127.0.0.1:8080/";
const chromeBinary = process.env.CHROME_BIN || "google-chrome";
const port = Number(process.env.CHROME_DEBUG_PORT || 9333);
const profile = await mkdtemp(join(tmpdir(), "hcc2d-browser-smoke-"));
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeErrors = "";
chrome.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function retry(operation, attempts = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) { lastError = error; await sleep(100); }
  }
  throw lastError;
}

try {
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error("Chrome is not ready");
  });

  const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, { method: "PUT" });
  const target = await targetResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      runtimeErrors.push(message.params.args.map((argument) => argument.value || argument.description).join(" "));
    }
  });

  function command(method, params = {}) {
    commandId += 1;
    return new Promise((resolve, reject) => {
      pending.set(commandId, { resolve, reject });
      socket.send(JSON.stringify({ id: commandId, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  await command("Runtime.enable");
  await command("Page.enable");
  await retry(async () => {
    const status = await evaluate("document.querySelector('#engine-status')?.textContent");
    if (status !== "Encoder ready") throw new Error(`Encoder status: ${status}`);
  }, 100);
  const offlineReady = await evaluate(`(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  })()`);
  if (!offlineReady) throw new Error("The offline service worker did not activate.");
  await retry(async () => {
    const controlled = await evaluate("Boolean(navigator.serviceWorker.controller)");
    if (!controlled) throw new Error("The page is not controlled by the service worker.");
  }, 50);
  await command("Network.enable");
  await command("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0
  });
  try {
    const cachedOffline = await evaluate(`fetch('./assets/core.js', { cache: 'reload' })
      .then((response) => response.ok && response.headers.get('content-type').includes('text/javascript'))
      .catch(() => false)`);
    if (!cachedOffline) throw new Error("A core application asset was unavailable offline.");
  } finally {
    await command("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
  }

  await evaluate("document.querySelector('#encoder-form').requestSubmit()");
  await retry(async () => {
    const state = await evaluate("document.querySelector('#preview-state')?.textContent.trim()");
    if (state !== "Ready to download") throw new Error(`Preview status: ${state}`);
  }, 100);

  const result = await evaluate(`(async () => {
    const image = document.querySelector('#preview-image').src;
    const bytes = await (await fetch(image)).arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return {
      error: document.querySelector('#form-error').hidden ? '' : document.querySelector('#form-error').textContent,
      image,
      download: document.querySelector('#download-button').href,
      version: document.querySelector('#result-version').textContent,
      width: document.querySelector('#result-dimensions').textContent,
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    };
  })()`);
  if (result.error) throw new Error(result.error);
  if (!result.image.startsWith("blob:") || !result.download.startsWith("blob:")) {
    throw new Error("Generated PNG was not connected to the preview and download controls.");
  }
  if (!/^\d+$/.test(result.version) || result.width === "—") {
    throw new Error("Generated symbol metadata is missing.");
  }
  const expectedSha256 = "5b900950b13db61114c588a56f31ec47230ebee97e41b062270a126bc57a6c14";
  if (result.sha256 !== expectedSha256) {
    throw new Error(`WebAssembly output mismatch: expected ${expectedSha256}, received ${result.sha256}.`);
  }

  await evaluate(`(() => {
    const first = document.querySelector('#palette-hex-one');
    const second = document.querySelector('#palette-hex-two');
    first.value = '#C81414';
    second.value = '#14B4D2';
    first.dispatchEvent(new Event('change', { bubbles: true }));
    second.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#encoder-form').requestSubmit();
  })()`);
  await retry(async () => {
    const state = await evaluate(`(() => ({
      status: document.querySelector('#preview-state')?.textContent.trim(),
      image: document.querySelector('#preview-image').src
    }))()`);
    if (state.status !== "Ready to download" || state.image === result.image) {
      throw new Error(`Custom palette status: ${state.status}`);
    }
  }, 100);
  const customPalette = await evaluate(`(async () => {
    const image = document.querySelector('#preview-image').src;
    const bytes = new Uint8Array(await (await fetch(image)).arrayBuffer());
    for (let index = 8; index < bytes.length - 16; index += 1) {
      if (bytes[index] === 80 && bytes[index + 1] === 76 && bytes[index + 2] === 84 && bytes[index + 3] === 69) {
        return [...bytes.slice(index + 4, index + 16)];
      }
    }
    return [];
  })()`);
  const expectedPalette = [0, 0, 0, 200, 20, 20, 20, 180, 210, 255, 255, 255];
  if (JSON.stringify(customPalette) !== JSON.stringify(expectedPalette)) {
    throw new Error(`Custom PNG palette mismatch: ${JSON.stringify(customPalette)}`);
  }

  const customImage = await evaluate("document.querySelector('#preview-image').src");
  await evaluate(`(() => {
    const mode = document.querySelector('input[name="mode"][value="hcc2d8"]');
    mode.checked = true;
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const palette = document.querySelector('input[name="palette"][value="model2"]');
    palette.checked = true;
    palette.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#encoder-form').requestSubmit();
  })()`);
  await retry(async () => {
    const state = await evaluate(`(() => ({
      status: document.querySelector('#preview-state')?.textContent.trim(),
      image: document.querySelector('#preview-image').src,
      format: document.querySelector('#result-format').textContent
    }))()`);
    if (state.status !== "Ready to download" || state.image === customImage || state.format !== "HCC2D8") {
      throw new Error(`HCC2D8 status: ${state.status}`);
    }
  }, 100);

  const hcc2d8Image = await evaluate("document.querySelector('#preview-image').src");
  await evaluate(`(() => {
    const mode = document.querySelector('input[name="mode"][value="qr"]');
    mode.checked = true;
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#encoder-form').requestSubmit();
  })()`);
  await retry(async () => {
    const state = await evaluate(`(() => ({
      status: document.querySelector('#preview-state')?.textContent.trim(),
      image: document.querySelector('#preview-image').src,
      format: document.querySelector('#result-format').textContent
    }))()`);
    if (state.status !== "Ready to download" || state.image === hcc2d8Image || state.format !== "QR Code") {
      throw new Error(`QR status: ${state.status}`);
    }
  }, 100);

  const qrImage = await evaluate("document.querySelector('#preview-image').src");
  await evaluate(`(() => {
    const mode = document.querySelector('input[name="mode"][value="hcc2d4"]');
    mode.checked = true;
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const automatic = document.querySelector('#auto-version');
    automatic.checked = false;
    automatic.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#version').value = '40';
    document.querySelector('#scale').value = '6';
    document.querySelector('#quiet-zone').value = '4';
    document.querySelector('#encoder-form').requestSubmit();
  })()`);
  await retry(async () => {
    const state = await evaluate(`(() => ({
      status: document.querySelector('#preview-state')?.textContent.trim(),
      image: document.querySelector('#preview-image').src,
      version: document.querySelector('#result-version').textContent,
      naturalWidth: document.querySelector('#preview-image').naturalWidth
    }))()`);
    if (state.status !== "Ready to download" || state.image === qrImage
        || state.version !== "40" || state.naturalWidth !== 1122) {
      throw new Error(`Version 40 preview status: ${JSON.stringify(state)}`);
    }
  }, 100);

  const themeResult = await evaluate(`(() => {
    const select = document.querySelector('#theme-select');
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const dark = document.documentElement.dataset.theme;
    const darkBackground = getComputedStyle(document.body).backgroundColor;
    select.value = 'light';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      dark,
      light: document.documentElement.dataset.theme,
      darkBackground,
      lightBackground: getComputedStyle(document.body).backgroundColor
    };
  })()`);
  if (themeResult.dark !== "dark" || themeResult.light !== "light"
      || themeResult.darkBackground === themeResult.lightBackground) {
    throw new Error("Light and dark theme switching did not produce distinct themes.");
  }

  const locales = [
    { code: "en", htmlLang: "en", heading: "Create HCC2D and QR codes", defaultText: "Welcome to the HCC2D Web Encoder!" },
    { code: "es", htmlLang: "es", heading: "Crea códigos HCC2D y QR", defaultText: "¡Bienvenido a HCC2D Web Encoder!" },
    { code: "it", htmlLang: "it", heading: "Crea codici HCC2D e QR", defaultText: "Benvenuto in HCC2D Web Encoder!" },
    { code: "ja", htmlLang: "ja", heading: "HCC2D・QRコードを作成", defaultText: "HCC2D Web Encoder へようこそ！" },
    { code: "zh-hans", htmlLang: "zh-Hans", heading: "创建 HCC2D 和 QR 码", defaultText: "欢迎使用 HCC2D Web Encoder！" }
  ];
  for (const locale of locales) {
    const localized = await evaluate(`(() => {
      const select = document.querySelector('#language-select');
      select.value = ${JSON.stringify(locale.code)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        lang: document.documentElement.lang,
        heading: document.querySelector('[data-i18n="hero.line1"]').textContent,
        saved: localStorage.getItem('hcc2d-language'),
        title: document.title,
        defaultText: document.querySelector('#text-input').value
      };
    })()`);
    if (localized.lang !== locale.htmlLang || localized.heading !== locale.heading
        || localized.saved !== locale.code || localized.title !== "HCC2D Web Encoder"
        || localized.defaultText !== locale.defaultText) {
      throw new Error(`Localization failed for ${locale.code}: ${JSON.stringify(localized)}`);
    }
  }
  await evaluate(`(() => {
    const select = document.querySelector('#language-select');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  const unicodeImage = await evaluate(`(() => {
    const text = '日本語 中文';
    const expected = [230,151,165,230,156,172,232,170,158,32,228,184,173,230,150,135];
    const encoded = [...new TextEncoder().encode(text)];
    if (JSON.stringify(encoded) !== JSON.stringify(expected)) {
      throw new Error('UTF-8 conversion mismatch: ' + JSON.stringify(encoded));
    }
    const previousImage = document.querySelector('#preview-image').src;
    const input = document.querySelector('#text-input');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#encoder-form').requestSubmit();
    return previousImage;
  })()`);
  await retry(async () => {
    const state = await evaluate(`(() => ({
      status: document.querySelector('#preview-state')?.textContent.trim(),
      image: document.querySelector('#preview-image').src,
      bytes: document.querySelector('#text-counter').textContent
    }))()`);
    if (state.status !== "Ready to download" || state.image === unicodeImage || state.bytes !== "16 B") {
      throw new Error(`Unicode encoding status: ${JSON.stringify(state)}`);
    }
  }, 100);

  await evaluate(`(() => {
    const mode = document.querySelector('input[name="mode"][value="hcc2d4"]');
    mode.checked = true;
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#scale').value = '64';
    document.querySelector('#quiet-zone').value = '64';
    document.querySelector('#encoder-form').requestSubmit();
  })()`);
  await retry(async () => {
    const error = await evaluate("document.querySelector('#form-error').hidden ? '' : document.querySelector('#form-error').textContent");
    if (!error.includes("browser safety limit")) throw new Error(`Safety-limit status: ${error}`);
  }, 100);

  const viewports = [
    { name: "phone portrait", width: 390, height: 844, mobile: true },
    { name: "phone landscape", width: 844, height: 390, mobile: true },
    { name: "tablet portrait", width: 768, height: 1024, mobile: true },
    { name: "tablet landscape", width: 1024, height: 768, mobile: true },
    { name: "desktop", width: 1366, height: 768, mobile: false },
    { name: "large desktop", width: 1920, height: 1080, mobile: false }
  ];
  for (const locale of locales) {
    await evaluate(`(() => {
      const select = document.querySelector('#language-select');
      select.value = ${JSON.stringify(locale.code)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    for (const viewport of viewports) {
      await command("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.mobile ? 2 : 1,
        mobile: viewport.mobile
      });
      const layout = await evaluate(`(() => ({
        responsive: document.documentElement.scrollWidth <= window.innerWidth,
        previewVisible: !document.querySelector('#preview-image').hidden,
        symmetricColumns: Math.abs(document.querySelector('.control-panel').getBoundingClientRect().width
          - document.querySelector('.preview-column').getBoundingClientRect().width) <= 2,
        previewWidth: document.querySelector('.preview-stage').getBoundingClientRect().width,
        offenders: [...document.body.querySelectorAll('*')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 1 && (rect.left < -1 || rect.right > window.innerWidth + 1);
          })
          .slice(0, 5)
          .map((element) => element.id || element.className || element.tagName)
      }))()`);
      if (!layout.responsive || !layout.symmetricColumns || layout.offenders.length) {
        throw new Error(`The ${locale.code} ${viewport.name} layout has horizontal overflow: ${layout.offenders.join(", ")}`);
      }
      if (viewport.width >= 768 && layout.previewWidth < 560) {
        throw new Error(`The ${locale.code} ${viewport.name} preview is too narrow: ${layout.previewWidth}px`);
      }
      if (!layout.previewVisible) throw new Error(`The generated preview disappeared in ${locale.code} ${viewport.name}.`);
    }
  }
  if (runtimeErrors.length) throw new Error(`Browser errors: ${runtimeErrors.join(" | ")}`);

  console.log(`Browser smoke test passed: QR/HCC2D4/HCC2D8, UTF-8 Japanese and Chinese text, version 40 preview, custom palette, symmetric panels, safety limit, offline worker, themes, five languages, and 30 responsive layout combinations verified`);
  socket.close();
} catch (error) {
  console.error(error.message);
  if (chromeErrors) console.error(chromeErrors.trim());
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill("SIGTERM");
  await Promise.race([exited, sleep(3000)]);
  await retry(() => rm(profile, { recursive: true, force: true }), 20).catch(() => {});
}
