import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomPalette,
  buildVCard,
  escapeVCard,
  formatBytes,
  hexToRgb,
  rgbToHex,
  resolvePayloadFormat,
  sanitizeFilename
} from "../web/assets/core.js";

test("converts six-digit colours", () => {
  assert.deepEqual(hexToRgb("#dc0000"), [220, 0, 0]);
  assert.deepEqual(hexToRgb("00C8DC"), [0, 200, 220]);
  assert.throws(() => hexToRgb("#fff"));
  assert.equal(rgbToHex([220, 0, 0]), "#dc0000");
});

test("accepts the default custom palette", () => {
  const palette = buildCustomPalette("#dc0000", "#00c8dc");
  assert.equal(palette.valid, true);
  assert.deepEqual(palette.bytes, [0, 0, 0, 220, 0, 0, 0, 200, 220, 255, 255, 255]);
});

test("rejects colours that are too close to an anchor or each other", () => {
  assert.equal(buildCustomPalette("#010101", "#00c8dc").valid, false);
  assert.equal(buildCustomPalette("#dc0000", "#d00000").valid, false);
  assert.equal(buildCustomPalette("#dc0000", "#fefefe").valid, false);
});

test("accepts a palette at or above the minimum RGB distance", () => {
  assert.equal(buildCustomPalette("#800000", "#00ffff").valid, true);
});

test("creates safe PNG filenames", () => {
  assert.equal(sanitizeFilename("sample"), "sample.png");
  assert.equal(sanitizeFilename("report?.png"), "report-.png");
  assert.equal(sanitizeFilename(""), "hcc2d-code.png");
});

test("selects an automatic payload format appropriate to the source", () => {
  assert.equal(resolvePayloadFormat("auto", "file"), "hcc2df");
  assert.equal(resolvePayloadFormat("auto", "text"), "raw");
  assert.equal(resolvePayloadFormat("raw", "file"), "raw");
  assert.throws(() => resolvePayloadFormat("zip", "file"), /Unsupported payload format/);
});

test("builds a valid vCard and escapes reserved characters", () => {
  assert.equal(escapeVCard("One; Two, Three"), "One\\; Two\\, Three");
  const card = buildVCard({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" });
  assert.match(card, /^BEGIN:VCARD\nVERSION:3\.0/m);
  assert.match(card, /FN:Ada Lovelace/);
  assert.match(card, /EMAIL:ada@example\.test/);
  assert.match(card, /END:VCARD$/);
  assert.throws(() => buildVCard({}), /first name or last name/);
});

test("formats byte counts", () => {
  assert.equal(formatBytes(800), "800 B");
  assert.equal(formatBytes(2048), "2.0 KB");
});
