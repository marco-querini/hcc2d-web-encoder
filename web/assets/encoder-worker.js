import createHcc2dModule from "./hcc2d-wasm.js";

let moduleInstance;

function readCString(pointer) {
  const bytes = [];
  for (let cursor = pointer; moduleInstance.HEAPU8[cursor] !== 0; cursor += 1) {
    bytes.push(moduleInstance.HEAPU8[cursor]);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function allocate(bytes, nulTerminate = false) {
  const length = bytes.byteLength + (nulTerminate ? 1 : 0);
  const pointer = moduleInstance._malloc(Math.max(length, 1));
  if (!pointer) throw new Error("The browser could not allocate enough memory for this operation.");
  moduleInstance.HEAPU8.set(bytes, pointer);
  if (nulTerminate) moduleInstance.HEAPU8[pointer + bytes.byteLength] = 0;
  return pointer;
}

async function initialize() {
  moduleInstance = await createHcc2dModule({
    locateFile: (path) => new URL(path, import.meta.url).href
  });
  postMessage({ type: "ready" });
}

initialize().catch((error) => {
  postMessage({ type: "fatal", message: error?.message || "Unable to initialize WebAssembly." });
});

self.addEventListener("message", ({ data }) => {
  if (data?.type !== "encode" || !moduleInstance) return;

  const source = new Uint8Array(data.payload);
  const filenameBytes = new TextEncoder().encode(data.filename || "payload.bin");
  const paletteBytes = new Uint8Array(data.customPalette || []);
  let sourcePointer = 0;
  let filenamePointer = 0;
  let palettePointer = 0;

  try {
    sourcePointer = allocate(source);
    filenamePointer = allocate(filenameBytes, true);
    palettePointer = paletteBytes.byteLength ? allocate(paletteBytes) : 0;
    const result = moduleInstance._hcc2d_encode(
      sourcePointer,
      source.byteLength,
      filenamePointer,
      data.mode,
      data.ec.charCodeAt(0),
      data.version,
      data.scale,
      data.quietZone,
      data.wrapHcc2df ? 1 : 0,
      data.palette,
      palettePointer
    );

    if (result !== 0) {
      throw new Error(readCString(moduleInstance._hcc2d_error_ptr()));
    }

    const pointer = moduleInstance._hcc2d_result_ptr();
    const length = moduleInstance._hcc2d_result_len();
    const png = moduleInstance.HEAPU8.slice(pointer, pointer + length);
    const response = {
      type: "result",
      requestId: data.requestId,
      png: png.buffer,
      width: moduleInstance._hcc2d_result_width(),
      height: moduleInstance._hcc2d_result_height(),
      version: moduleInstance._hcc2d_result_version(),
      mask: moduleInstance._hcc2d_result_mask()
    };
    moduleInstance._hcc2d_result_clear();
    postMessage(response, [response.png]);
  } catch (error) {
    postMessage({
      type: "error",
      requestId: data.requestId,
      message: error?.message || "Encoding failed."
    });
  } finally {
    if (sourcePointer) moduleInstance._free(sourcePointer);
    if (filenamePointer) moduleInstance._free(filenamePointer);
    if (palettePointer) moduleInstance._free(palettePointer);
  }
});
