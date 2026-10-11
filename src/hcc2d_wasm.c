/*
 * HCC2D WebAssembly bridge
 * Copyright 2010-2026 Marco Querini
 * SPDX-License-Identifier: Apache-2.0
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define HCC2D_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define HCC2D_EXPORT
#endif

/* Keep the upstream distribution byte-for-byte intact. The bridge and the
 * CLI are compiled in one translation unit so the public single-file encoder
 * remains the sole encoding implementation. */
#define main hcc2d_upstream_cli_main
#include "../upstream/single_file_c_hcc2d_encoder_v0.9.0.c"
#undef main

static uint8_t *wasm_png = NULL;
static size_t wasm_png_len = 0;
static int wasm_width = 0;
static int wasm_height = 0;
static int wasm_version = 0;
static int wasm_mask = 0;
static char wasm_error[256] = "";

/* Keep the peak memory needed by indexed pixels, PNG scanlines, compression,
 * and the final PNG within a range that is reasonable on mobile browsers. */
#define HCC2D_WEB_MAX_OUTPUT_DIMENSION 4096

static void clear_result(void) {
    free(wasm_png);
    wasm_png = NULL;
    wasm_png_len = 0;
    wasm_width = 0;
    wasm_height = 0;
    wasm_version = 0;
    wasm_mask = 0;
    wasm_error[0] = '\0';
}

static int fail_with(const char *message) {
    snprintf(wasm_error, sizeof(wasm_error), "%s", message ? message : "Encoding failed");
    return -1;
}

static int valid_custom_palette(const uint8_t *bytes) {
    if (!bytes) return 0;
    if (bytes[0] != 0 || bytes[1] != 0 || bytes[2] != 0) return 0;
    if (bytes[9] != 255 || bytes[10] != 255 || bytes[11] != 255) return 0;

    for (int first = 0; first < 4; first++) {
        for (int second = first + 1; second < 4; second++) {
            int a = first * 3;
            int b = second * 3;
            double dr = (double)bytes[a] - bytes[b];
            double dg = (double)bytes[a + 1] - bytes[b + 1];
            double db = (double)bytes[a + 2] - bytes[b + 2];
            if (sqrt(dr * dr + dg * dg + db * db) < 128.0) return 0;
        }
    }
    return 1;
}

static int output_dimension(int mode, int version, int scale, int quiet_zone) {
    int modules = 17 + 4 * version;
    if (mode != 0) modules += 2; /* HCC2D Color Palette Pattern border. */
    return (modules + 2 * quiet_zone) * scale;
}

static int encode_for_mode(const uint8_t *payload, int payload_len,
                           int mode, const char *mode_name, char ec_level,
                           int version, int scale, int quiet_zone,
                           EncodedSymbol *symbol, char *err) {
    if (mode == 0) {
        return encode_qr(payload, payload_len, ec_level, version, scale,
                         quiet_zone, symbol, err);
    }
    return encode_hcc2d(payload, payload_len, mode_name, ec_level, version,
                        scale, quiet_zone, symbol, err);
}

/*
 * mode: 0=QR, 1=HCC2D4, 2=HCC2D8
 * palette: 0=Model 1, 1=Model 2, 2=custom HCC2D4
 * wrap_hcc2df: 0=raw bytes, 1=HCC2DF container
 */
HCC2D_EXPORT int hcc2d_encode(
    const uint8_t *source,
    int source_len,
    const char *filename,
    int mode,
    int ec_level,
    int version,
    int scale,
    int quiet_zone,
    int wrap_hcc2df,
    int palette_kind,
    const uint8_t *custom_palette_bytes
) {
    clear_result();

    if (!source || source_len <= 0) return fail_with("Payload is empty.");
    if (mode < 0 || mode > 2) return fail_with("Unsupported symbol mode.");
    if (ec_level_index((char)ec_level) < 0) return fail_with("Invalid error-correction level.");
    if (version < 0 || version > 40) return fail_with("Version must be between 0 and 40.");
    if (scale < 6 || scale > 64) return fail_with("Scale must be between 6 and 64.");
    if (quiet_zone < 0 || quiet_zone > 64) return fail_with("Quiet zone must be between 0 and 64.");
    if (palette_kind < 0 || palette_kind > 2) return fail_with("Unsupported palette.");
    if (palette_kind == 2 && mode != 1) return fail_with("Custom palettes are supported only for HCC2D4.");
    if (palette_kind == 2 && !valid_custom_palette(custom_palette_bytes)) {
        return fail_with("Custom palette colours must remain distinguishable from each other, black, and white.");
    }

    const char *mode_name = mode == 0 ? "qr" : (mode == 1 ? "hcc2d4" : "hcc2d8");
    const uint8_t *payload = source;
    size_t payload_len = (size_t)source_len;
    uint8_t *wrapped = NULL;
    char err[256] = "";

    if (wrap_hcc2df) {
        const char *safe_filename = filename && filename[0] ? filename : "payload.bin";
        wrapped = build_hcc2df_payload(safe_filename, source, (size_t)source_len,
                                       &payload_len, err);
        if (!wrapped) return fail_with(err);
        payload = wrapped;
    }

    gf256_init();

    int effective_version = version;
    int largest_requested_dimension = output_dimension(
        mode, version > 0 ? version : 40, scale, quiet_zone
    );
    if (version == 0 && largest_requested_dimension > HCC2D_WEB_MAX_OUTPUT_DIMENSION) {
        EncodedSymbol probe = {0};
        int probe_result = encode_for_mode(
            payload, (int)payload_len, mode, mode_name, (char)ec_level,
            0, 1, 0, &probe, err
        );
        if (probe_result != 0) {
            free(wrapped);
            return fail_with(err);
        }
        effective_version = probe.version_number;
        free(probe.pixels);
    }

    int requested_dimension = output_dimension(
        mode, effective_version > 0 ? effective_version : 40, scale, quiet_zone
    );
    if (requested_dimension > HCC2D_WEB_MAX_OUTPUT_DIMENSION) {
        snprintf(err, sizeof(err),
                 "requested PNG would be %d x %d pixels; the browser safety limit is %d x %d pixels",
                 requested_dimension, requested_dimension,
                 HCC2D_WEB_MAX_OUTPUT_DIMENSION, HCC2D_WEB_MAX_OUTPUT_DIMENSION);
        free(wrapped);
        return fail_with(err);
    }

    EncodedSymbol symbol = {0};
    int encoded = encode_for_mode(
        payload, (int)payload_len, mode, mode_name, (char)ec_level,
        effective_version, scale, quiet_zone, &symbol, err
    );
    free(wrapped);
    if (encoded != 0) return fail_with(err);

    RGB custom_palette[4];
    const RGB *selected_palette;
    int palette_size;
    if (mode == 0) {
        selected_palette = PALETTE_QR;
        palette_size = 2;
    } else if (palette_kind == 2) {
        for (int index = 0; index < 4; index++) {
            custom_palette[index].r = custom_palette_bytes[index * 3];
            custom_palette[index].g = custom_palette_bytes[index * 3 + 1];
            custom_palette[index].b = custom_palette_bytes[index * 3 + 2];
        }
        selected_palette = custom_palette;
        palette_size = 4;
    } else if (palette_kind == 1) {
        selected_palette = mode == 1 ? PALETTE_4_MODEL2 : PALETTE_8_MODEL2;
        palette_size = mode == 1 ? 4 : 8;
    } else {
        selected_palette = mode == 1 ? PALETTE_4_MODEL1 : PALETTE_8_MODEL1;
        palette_size = mode == 1 ? 4 : 8;
    }

    wasm_png = build_png(symbol.width, symbol.height, symbol.pixels,
                         selected_palette, palette_size, &wasm_png_len);
    free(symbol.pixels);
    if (!wasm_png) return fail_with("PNG generation failed.");

    wasm_width = symbol.width;
    wasm_height = symbol.height;
    wasm_version = symbol.version_number;
    wasm_mask = symbol.mask_pattern;
    return 0;
}

HCC2D_EXPORT uintptr_t hcc2d_result_ptr(void) { return (uintptr_t)wasm_png; }
HCC2D_EXPORT int hcc2d_result_len(void) { return (int)wasm_png_len; }
HCC2D_EXPORT int hcc2d_result_width(void) { return wasm_width; }
HCC2D_EXPORT int hcc2d_result_height(void) { return wasm_height; }
HCC2D_EXPORT int hcc2d_result_version(void) { return wasm_version; }
HCC2D_EXPORT int hcc2d_result_mask(void) { return wasm_mask; }
HCC2D_EXPORT uintptr_t hcc2d_error_ptr(void) { return (uintptr_t)wasm_error; }
HCC2D_EXPORT void hcc2d_result_clear(void) { clear_result(); }
