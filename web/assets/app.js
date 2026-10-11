import {
  MAX_SOURCE_BYTES,
  buildCustomPalette,
  buildVCard,
  formatBytes,
  hexToRgb,
  resolvePayloadFormat,
  sanitizeFilename,
  utf8ByteLength
} from "./core.js";
import { getLocale, setLocale, t, translateDocument } from "./i18n.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const form = $("#encoder-form");
const generateButton = $("#generate-button");
const engineStatus = $("#engine-status");
const formError = $("#form-error");
const previewState = $("#preview-state");
const previewStage = $("#preview-stage");
const previewPlaceholder = $("#preview-placeholder");
const previewImage = $("#preview-image");
const downloadButton = $("#download-button");
const outputFilename = $("#output-filename");
const paletteSection = $("#palette-section");
const customPalette = $("#custom-palette");
const fixedPaletteNote = $("#fixed-palette-note");
const paletteValidity = $("#palette-validity");
const distanceFill = $("#distance-fill");
const distanceCopy = $("#distance-copy");
const distanceValue = $("#distance-value");
const colorOne = $("#palette-color-one");
const colorTwo = $("#palette-color-two");
const hexOne = $("#palette-hex-one");
const hexTwo = $("#palette-hex-two");
const stripOne = $("#strip-color-one");
const stripTwo = $("#strip-color-two");
const textInput = $("#text-input");
const textCounter = $("#text-counter");
const fileInput = $("#file-input");
const fileDropzone = $("#file-dropzone");
const fileTitle = $("#file-title");
const fileDetail = $("#file-detail");
const autoVersion = $("#auto-version");
const versionInput = $("#version");
const languageSelect = $("#language-select");

let activeSource = "text";
let selectedFile = null;
let encoderReady = false;
let activeRequest = 0;
let currentObjectUrl = null;
let latestPngSize = 0;
let engineState = "loading";
let currentPreviewState = { state: "waiting", key: "preview.waiting" };
let hasEncodedResult = false;
let localizedDefaultText = textInput.value;

setLocale(document.documentElement.dataset.language || "en");
languageSelect.value = getLocale();
translateDocument();

const mediaTheme = matchMedia("(prefers-color-scheme: dark)");
const themeSelect = $("#theme-select");
let savedTheme = document.documentElement.dataset.themePreference || "system";
try {
  savedTheme = localStorage.getItem("hcc2d-theme") || savedTheme;
} catch {
  // Storage can be unavailable in hardened or embedded browser contexts.
}
themeSelect.value = ["system", "light", "dark"].includes(savedTheme) ? savedTheme : "system";

function applyTheme(preference) {
  const useDark = preference === "dark" || (preference === "system" && mediaTheme.matches);
  document.documentElement.dataset.theme = useDark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
  document.querySelector('meta[name="theme-color"]').content = useDark ? "#0b1420" : "#f4f7fb";
}

themeSelect.addEventListener("change", () => {
  try {
    localStorage.setItem("hcc2d-theme", themeSelect.value);
  } catch {
    // Theme switching remains functional even when persistence is blocked.
  }
  applyTheme(themeSelect.value);
});
const handleSystemThemeChange = () => {
  if (themeSelect.value === "system") applyTheme("system");
};
if (typeof mediaTheme.addEventListener === "function") {
  mediaTheme.addEventListener("change", handleSystemThemeChange);
} else {
  mediaTheme.addListener(handleSystemThemeChange);
}
applyTheme(themeSelect.value);

function selectedMode() {
  return form.elements.mode.value;
}

function selectedPalette() {
  return form.elements.palette.value;
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearError() {
  formError.textContent = "";
  formError.hidden = true;
}

function setBusy(busy) {
  form.classList.toggle("busy", busy);
  generateButton.disabled = busy || !encoderReady;
  $$('input, textarea, select, button', form).forEach((field) => {
    if (field === versionInput && autoVersion.checked) return;
    field.disabled = busy || (field === versionInput && autoVersion.checked);
  });
  if (!busy) updateControls();
}

function setPreviewState(state, label) {
  currentPreviewState = { state, key: label };
  previewState.className = `preview-state ${state}`;
  previewState.innerHTML = `<i></i><span>${t(label)}</span>`;
}

function paletteMessage([first, second]) {
  if (first === 0) return t("palette.tooCloseBlack");
  if (second === 3) return t("palette.tooCloseWhite");
  return t("palette.tooCloseEach");
}

function readableSwatchInk(hex) {
  const luminance = hexToRgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.179
    ? { ink: "#102a43", shadow: "none" }
    : { ink: "#ffffff", shadow: "0 1px 3px rgba(0, 0, 0, .55)" };
}

function updateLocalizedInterface() {
  translateDocument();
  const nextDefaultText = t("source.defaultText");
  if (textInput.value === localizedDefaultText) textInput.value = nextDefaultText;
  localizedDefaultText = nextDefaultText;
  updateTextCounter();
  engineStatus.textContent = t(`engine.${engineState}`);
  setPreviewState(currentPreviewState.state, currentPreviewState.key);
  if (!hasEncodedResult) $("#result-version").textContent = t("preview.auto");
  if (selectedFile) {
    fileTitle.textContent = selectedFile.name;
    fileDetail.textContent = `${formatBytes(selectedFile.size)} · ${t("source.fileReplace")}`;
  } else {
    fileTitle.textContent = t("source.fileEmpty");
    fileDetail.textContent = t("source.fileLimit");
  }
  $("#specification-link").href = "https://doi.org/10.5281/zenodo.22206528";
  $("#website-link").href = `https://hcc2d.com/${getLocale()}/`;
  updatePaletteValidation();
}

languageSelect.addEventListener("change", () => {
  setLocale(languageSelect.value);
  document.documentElement.dataset.language = getLocale();
  try {
    localStorage.setItem("hcc2d-language", getLocale());
  } catch {
    // Language switching remains functional even when persistence is blocked.
  }
  clearError();
  updateLocalizedInterface();
});

function activateSource(kind) {
  activeSource = kind;
  $$('[data-source-tab]').forEach((button) => {
    const active = button.dataset.sourceTab === kind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $$('[data-source-panel]').forEach((panel) => {
    const active = panel.dataset.sourcePanel === kind;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  clearError();
}

$$('[data-source-tab]').forEach((button) => {
  button.addEventListener("click", () => activateSource(button.dataset.sourceTab));
  button.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const buttons = $$('[data-source-tab]');
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const index = (buttons.indexOf(button) + direction + buttons.length) % buttons.length;
    buttons[index].focus();
    activateSource(buttons[index].dataset.sourceTab);
  });
});

function updateTextCounter() {
  const length = utf8ByteLength(textInput.value);
  textCounter.textContent = formatBytes(length);
  textCounter.classList.toggle("over-limit", length > MAX_SOURCE_BYTES);
}
textInput.addEventListener("input", updateTextCounter);
updateTextCounter();

function useFile(file) {
  selectedFile = file || null;
  if (!selectedFile) {
    fileDropzone.classList.remove("has-file", "invalid");
    fileTitle.textContent = t("source.fileEmpty");
    fileDetail.textContent = t("source.fileLimit");
    return;
  }
  fileDropzone.classList.toggle("invalid", selectedFile.size > MAX_SOURCE_BYTES);
  fileDropzone.classList.add("has-file");
  fileTitle.textContent = selectedFile.name;
  fileDetail.textContent = `${formatBytes(selectedFile.size)} · ${t("source.fileReplace")}`;
  const base = selectedFile.name.replace(/\.[^.]+$/, "") || "hcc2d-file";
  outputFilename.value = sanitizeFilename(`${base}-hcc2d.png`);
}

fileInput.addEventListener("change", () => useFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((eventName) => {
  fileDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDropzone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  fileDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDropzone.classList.remove("dragging");
  });
});
fileDropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  useFile(file);
});

function updateMode() {
  const mode = selectedMode();
  $$('.mode-card').forEach((card) => card.classList.toggle("selected", $("input", card).checked));
  paletteSection.hidden = mode === "qr";
  const customInput = $('input[name="palette"][value="custom"]');
  customInput.closest("label").hidden = mode !== "hcc2d4";
  if (mode !== "hcc2d4" && customInput.checked) {
    $('input[name="palette"][value="model1"]').checked = true;
  }
  if (!hasEncodedResult) $("#result-format").textContent = mode === "qr" ? "QR Code" : mode.toUpperCase();
  updatePalette();
}

function updatePalette() {
  const custom = selectedMode() === "hcc2d4" && selectedPalette() === "custom";
  customPalette.hidden = !custom;
  fixedPaletteNote.hidden = custom;
  if (custom) updatePaletteValidation();
}

function normalizeHexInput(input, picker) {
  let value = input.value.trim().toUpperCase();
  if (!value.startsWith("#")) value = `#${value}`;
  if (/^#[0-9A-F]{6}$/.test(value)) {
    input.value = value;
    picker.value = value.toLowerCase();
    updatePaletteValidation();
    return true;
  }
  input.setAttribute("aria-invalid", "true");
  return false;
}

function syncPicker(picker, input) {
  input.value = picker.value.toUpperCase();
  input.removeAttribute("aria-invalid");
  updatePaletteValidation();
}

colorOne.addEventListener("input", () => syncPicker(colorOne, hexOne));
colorTwo.addEventListener("input", () => syncPicker(colorTwo, hexTwo));
hexOne.addEventListener("change", () => normalizeHexInput(hexOne, colorOne));
hexTwo.addEventListener("change", () => normalizeHexInput(hexTwo, colorTwo));

function updatePaletteValidation() {
  let validation;
  try {
    validation = buildCustomPalette(hexOne.value, hexTwo.value);
    hexOne.removeAttribute("aria-invalid");
    hexTwo.removeAttribute("aria-invalid");
  } catch {
    paletteValidity.className = "validity-badge invalid";
    paletteValidity.textContent = t("palette.invalid");
    return null;
  }

  stripOne.style.setProperty("--swatch", hexOne.value);
  stripTwo.style.setProperty("--swatch", hexTwo.value);
  for (const [strip, hex] of [[stripOne, hexOne.value], [stripTwo, hexTwo.value]]) {
    const { ink, shadow } = readableSwatchInk(hex);
    strip.style.setProperty("--swatch-ink", ink);
    strip.style.setProperty("--swatch-shadow", shadow);
  }
  $("strong", stripOne).textContent = hexOne.value.toUpperCase();
  $("strong", stripTwo).textContent = hexTwo.value.toUpperCase();

  const rounded = Math.round(validation.closestDistance);
  const percentage = Math.min(100, Math.max(4, (validation.closestDistance / 260) * 100));
  distanceFill.style.width = `${percentage}%`;
  distanceValue.textContent = String(rounded);
  paletteValidity.className = `validity-badge ${validation.valid ? "valid" : "invalid"}`;
  paletteValidity.innerHTML = validation.valid
    ? `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg><span>${t("palette.valid")}</span>`
    : t("palette.review");
  distanceCopy.textContent = validation.valid
    ? t("palette.safe")
    : paletteMessage(validation.closestPair);
  $("#palette-distance").classList.toggle("invalid", !validation.valid);
  return validation;
}

$$('input[name="mode"]').forEach((input) => input.addEventListener("change", updateMode));
$$('input[name="palette"]').forEach((input) => input.addEventListener("change", updatePalette));

autoVersion.addEventListener("change", updateControls);

function updateControls() {
  versionInput.disabled = autoVersion.checked || form.classList.contains("busy");
  generateButton.disabled = !encoderReady || form.classList.contains("busy");
}

async function readSource() {
  if (activeSource === "text") {
    const value = textInput.value;
    if (!value) throw new Error(t("error.textRequired"));
    return { bytes: new TextEncoder().encode(value), filename: "text.txt", kind: "text" };
  }
  if (activeSource === "file") {
    if (!selectedFile) throw new Error(t("error.fileRequired"));
    return { bytes: new Uint8Array(await selectedFile.arrayBuffer()), filename: selectedFile.name, kind: "file" };
  }
  if (activeSource === "url") {
    const value = $("#url-input").value.trim();
    if (!value) throw new Error(t("error.urlRequired"));
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(t("error.urlInvalid")); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(t("error.urlProtocol"));
    return { bytes: new TextEncoder().encode(parsed.href), filename: "url.txt", kind: "url" };
  }

  const firstName = $("#vcard-first-name").value;
  const lastName = $("#vcard-last-name").value;
  if (!firstName.trim() && !lastName.trim()) throw new Error(t("error.vcardName"));
  const vcard = buildVCard({
    firstName,
    lastName,
    phone: $("#vcard-phone").value,
    email: $("#vcard-email").value,
    organization: $("#vcard-organization").value,
    url: $("#vcard-url").value
  });
  return { bytes: new TextEncoder().encode(vcard), filename: "contact.vcf", kind: "vcard" };
}

function numberInRange(input, minimum, maximum, labelKey) {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(t("error.range", { label: t(labelKey), minimum, maximum }));
  }
  return value;
}

function paletteConfiguration() {
  if (selectedMode() === "qr") return { kind: 0, custom: [] };
  if (selectedPalette() === "model1") return { kind: 0, custom: [] };
  if (selectedPalette() === "model2") return { kind: 1, custom: [] };
  const validation = updatePaletteValidation();
  if (!validation?.valid) {
    throw new Error(validation ? paletteMessage(validation.closestPair) : t("palette.hexError"));
  }
  return { kind: 2, custom: validation.bytes };
}

const worker = new Worker(new URL("./encoder-worker.js", import.meta.url), { type: "module" });

worker.addEventListener("message", ({ data }) => {
  if (data.type === "ready") {
    encoderReady = true;
    engineState = "ready";
    engineStatus.textContent = t("engine.ready");
    document.body.classList.add("engine-ready");
    updateControls();
    return;
  }
  if (data.type === "fatal") {
    engineState = "unavailable";
    engineStatus.textContent = t("engine.unavailable");
    showError(getLocale() === "en" ? data.message : t("error.technical", { message: data.message }));
    return;
  }
  if (data.requestId !== activeRequest) return;
  setBusy(false);
  if (data.type === "error") {
    setPreviewState("error", "preview.couldNotEncode");
    showError(getLocale() === "en" ? data.message : t("error.technical", { message: data.message }));
    return;
  }
  if (data.type !== "result") return;

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  const blob = new Blob([data.png], { type: "image/png" });
  currentObjectUrl = URL.createObjectURL(blob);
  latestPngSize = blob.size;
  hasEncodedResult = true;
  previewImage.src = currentObjectUrl;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;
  previewStage.classList.remove("empty");
  const generatedMode = selectedMode();
  $("#result-format").textContent = generatedMode === "qr" ? "QR Code" : generatedMode.toUpperCase();
  $("#result-version").textContent = String(data.version);
  $("#result-dimensions").textContent = `${data.width} × ${data.height} px`;
  $("#result-size").textContent = formatBytes(blob.size);
  downloadButton.href = currentObjectUrl;
  downloadButton.download = sanitizeFilename(outputFilename.value);
  downloadButton.classList.remove("disabled");
  downloadButton.removeAttribute("aria-disabled");
  setPreviewState("ready", "preview.ready");
  if (matchMedia("(max-width: 860px)").matches) {
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $(".preview-panel").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }
});

worker.addEventListener("error", () => {
  encoderReady = false;
  engineState = "unavailable";
  setBusy(false);
  engineStatus.textContent = t("engine.unavailable");
  setPreviewState("error", "engine.unavailable");
  showError(t("error.wasm"));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  if (!encoderReady) {
    showError(t("error.loading"));
    return;
  }

  try {
    const source = await readSource();
    if (source.bytes.byteLength === 0) throw new Error(t("error.empty"));
    if (source.bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new Error(t("error.sourceLimit", {
        size: formatBytes(source.bytes.byteLength),
        limit: formatBytes(MAX_SOURCE_BYTES)
      }));
    }
    const requestedFormat = $("#payload-format").value;
    const resolvedFormat = resolvePayloadFormat(requestedFormat, source.kind);
    if (resolvedFormat === "hcc2df" && utf8ByteLength(source.filename) > 127) {
      throw new Error(t("error.filenameLimit"));
    }
    const palette = paletteConfiguration();
    const mode = selectedMode();
    const modeCode = { qr: 0, hcc2d4: 1, hcc2d8: 2 }[mode];
    const scale = numberInRange($("#scale"), 6, 64, "label.scale");
    const quietZone = numberInRange($("#quiet-zone"), 0, 64, "label.quiet");
    const version = autoVersion.checked ? 0 : numberInRange(versionInput, 1, 40, "label.version");

    setBusy(true);
    setPreviewState("working", "preview.encoding");
    activeRequest += 1;
    worker.postMessage({
      type: "encode",
      requestId: activeRequest,
      payload: source.bytes.buffer,
      filename: source.filename,
      mode: modeCode,
      ec: $("#ec-level").value,
      version,
      scale,
      quietZone,
      wrapHcc2df: resolvedFormat === "hcc2df",
      palette: palette.kind,
      customPalette: palette.custom
    }, [source.bytes.buffer]);
  } catch (error) {
    setBusy(false);
    showError(error.message || t("error.generic"));
  }
});

outputFilename.addEventListener("change", () => {
  outputFilename.value = sanitizeFilename(outputFilename.value);
  if (currentObjectUrl) downloadButton.download = outputFilename.value;
});

downloadButton.addEventListener("click", (event) => {
  if (!currentObjectUrl || latestPngSize === 0) event.preventDefault();
});

updateMode();
updatePaletteValidation();
updateControls();
updateLocalizedInterface();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
