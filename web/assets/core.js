export const MIN_CUSTOM_PALETTE_RGB_DISTANCE = 128;
export const MAX_SOURCE_BYTES = 64 * 1024;

export const PALETTES = Object.freeze({
  model1: Object.freeze({
    hcc2d4: Object.freeze([0, 0, 0, 220, 0, 0, 0, 200, 220, 255, 255, 255]),
    hcc2d8: Object.freeze([0, 0, 0, 200, 0, 0, 0, 130, 0, 0, 60, 180, 0, 215, 235, 255, 220, 50, 255, 130, 230, 255, 255, 255])
  }),
  model2: Object.freeze({
    hcc2d4: Object.freeze([0, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]),
    hcc2d8: Object.freeze([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255])
  })
});

export function hexToRgb(hex) {
  const match = /^#?([\da-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) throw new Error("Enter a six-digit hexadecimal colour.");
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

export function rgbToHex(rgb) {
  return `#${rgb.map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbDistance(first, second) {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2]
  );
}

export function buildCustomPalette(firstHex, secondHex) {
  const colors = [
    [0, 0, 0],
    hexToRgb(firstHex),
    hexToRgb(secondHex),
    [255, 255, 255]
  ];
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestPair = [0, 1];

  for (let first = 0; first < colors.length; first += 1) {
    for (let second = first + 1; second < colors.length; second += 1) {
      const distance = rgbDistance(colors[first], colors[second]);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPair = [first, second];
      }
    }
  }

  return {
    bytes: colors.flat(),
    colors,
    closestDistance,
    closestPair,
    valid: closestDistance >= MIN_CUSTOM_PALETTE_RGB_DISTANCE
  };
}

export function paletteErrorMessage([first, second]) {
  if (first === 0) return "The first selected colour is too close to fixed black.";
  if (second === 3) return "A selected colour is too close to fixed white.";
  return "The two selected colours are too close to each other.";
}

export function sanitizeFilename(filename, fallback = "hcc2d-code.png") {
  const cleaned = String(filename || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const selected = cleaned || fallback;
  return selected.toLowerCase().endsWith(".png") ? selected : `${selected}.png`;
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function escapeVCard(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function buildVCard(fields) {
  const firstName = String(fields.firstName || "").trim();
  const lastName = String(fields.lastName || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (!fullName) throw new Error("Enter at least a first name or last name.");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
    `FN:${escapeVCard(fullName)}`
  ];
  if (fields.phone?.trim()) lines.push(`TEL:${escapeVCard(fields.phone.trim())}`);
  if (fields.email?.trim()) lines.push(`EMAIL:${escapeVCard(fields.email.trim())}`);
  if (fields.organization?.trim()) lines.push(`ORG:${escapeVCard(fields.organization.trim())}`);
  if (fields.url?.trim()) lines.push(`URL:${escapeVCard(fields.url.trim())}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

export function resolvePayloadFormat(requested, sourceKind) {
  if (requested === "raw") return "raw";
  if (requested === "hcc2df") return "hcc2df";
  if (requested !== "auto") throw new Error("Unsupported payload format.");
  return sourceKind === "file" ? "hcc2df" : "raw";
}
