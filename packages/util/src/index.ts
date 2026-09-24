import {
  ERROR_RESPONSE_BODY_READER,
  ERROR_INCOMPLETED_DOWNLOAD,
} from "./errors.js";
import { HeaderContentLength, HeaderContentEncoding } from "./const.js";
import { ProgressCallback } from "./types.js";

const isNode = (): boolean =>
  typeof process !== "undefined" && process.versions?.node != null;

// Built from a variable rather than a string literal so bundlers (webpack,
// Vite/Rollup, esbuild) cannot statically resolve or bundle this for the
// browser build; it is only ever reached when `isNode()` is true.
const NODE_FS_SPECIFIER = "node:fs/promises";

const importNodeFS = (): Promise<typeof import("node:fs/promises")> =>
  import(NODE_FS_SPECIFIER) as Promise<typeof import("node:fs/promises")>;

const readLocalFile = async (path: string | URL): Promise<Uint8Array> => {
  let fs;
  try {
    fs = await importNodeFS();
  } catch (e) {
    // isNode() is true (process.versions.node is set) in some restricted
    // environments that still can't load node:fs/promises, notably an
    // Electron renderer without nodeIntegration. Fail with something more
    // useful than the raw import error.
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      "fetchFile() detected Node.js but could not load node:fs/promises " +
        "to read a local path; if you're in an Electron renderer, enable " +
        `nodeIntegration or fetch the file yourself and pass the bytes ` +
        `directly. (${reason})`,
      { cause: e }
    );
  }
  return fs.readFile(path);
};

const isRemoteURL = (file: string): boolean =>
  /^(https?|data|blob):/i.test(file);

const readFromBlobOrFile = (blob: Blob | File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = () => {
      const { result } = fileReader;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else {
        resolve(new Uint8Array(0));
      }
    };
    fileReader.onerror = (event) => {
      reject(
        Error(
          `File could not be read! Code=${event?.target?.error?.code || -1}`
        )
      );
    };
    fileReader.readAsArrayBuffer(blob);
  });

/**
 * An util function to fetch data from url string, base64, URL, File or Blob format.
 *
 * Examples:
 * ```ts
 * // URL
 * await fetchFile("http://localhost:3000/video.mp4");
 * // base64
 * await fetchFile("data:<type>;base64,wL2dvYWwgbW9yZ...");
 * // URL
 * await fetchFile(new URL("video.mp4", import.meta.url));
 * // File
 * fileInput.addEventListener('change', (e) => {
 *   await fetchFile(e.target.files[0]);
 * });
 * // Blob
 * const blob = new Blob(...);
 * await fetchFile(blob);
 * // Node.js: local file path or file: URL
 * await fetchFile("./video.mp4");
 * await fetchFile(new URL("video.mp4", import.meta.url));
 * ```
 */
export const fetchFile = async (
  file?: string | File | Blob | URL
): Promise<Uint8Array> => {
  let data: ArrayBuffer | number[] | Uint8Array;

  if (typeof file === "string") {
    if (isNode() && file.startsWith("file://")) {
      data = await readLocalFile(new URL(file));
    } else if (isNode() && !isRemoteURL(file)) {
      // In Node.js, a bare path is read from disk; fetch() does not
      // support the file: scheme there.
      data = await readLocalFile(file);
    } else {
      /* From base64 data URL or remote server/URL, fetch() handles both */
      data = await (await fetch(file)).arrayBuffer();
    }
  } else if (file instanceof URL) {
    data = isNode() && file.protocol === "file:" ?
      await readLocalFile(file) :
      await (await fetch(file)).arrayBuffer();
  } else if (file instanceof File || file instanceof Blob) {
    data = await readFromBlobOrFile(file);
  } else {
    return new Uint8Array(0);
  }

  return data instanceof Uint8Array ? data : new Uint8Array(data);
};

/**
 * importScript dynamically import a script, useful when you
 * want to use different versions of ffmpeg.wasm based on environment.
 *
 * Example:
 *
 * ```ts
 * await importScript("http://localhost:3000/ffmpeg.js");
 * ```
 */
export const importScript = async (url: string): Promise<void> =>
  new Promise((resolve) => {
    const script = document.createElement("script");
    const eventHandler = () => {
      script.removeEventListener("load", eventHandler);
      resolve();
    };
    script.src = url;
    script.type = "text/javascript";
    script.addEventListener("load", eventHandler);
    document.getElementsByTagName("head")[0].appendChild(script);
  });

/**
 * Download content of a URL with progress.
 *
 * Progress only works when Content-Length is provided by the server.
 *
 */
export const downloadWithProgress = async (
  url: string | URL,
  cb?: ProgressCallback
): Promise<ArrayBuffer> => {
  const resp = await fetch(url);
  const fallback = resp.clone();
  let buf;

  try {
    // A response is compressed when Content-Encoding is present and not
    // "identity". Content-Length then reflects the compressed transfer size
    // while the body reader yields decompressed bytes, so it cannot be used
    // to track progress: treat the total as unknown (-1) in that case.
    // Otherwise total is -1 when there is no Content-Length header.
    const compressed = (resp.headers.get(HeaderContentEncoding) || "")
      .split(",")
      .map((encoding) => encoding.trim().toLowerCase())
      .some((encoding) => encoding !== "" && encoding !== "identity");
    const total = compressed
      ? -1
      : parseInt(resp.headers.get(HeaderContentLength) || "-1");

    const reader = resp.body?.getReader();
    if (!reader) throw ERROR_RESPONSE_BODY_READER;

    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      const delta = value ? value.length : 0;

      if (done) {
        if (total != -1 && total !== received) throw ERROR_INCOMPLETED_DOWNLOAD;
        cb?.({ url, total, received, delta, done });
        break;
      }

      chunks.push(value);
      received += delta;
      cb?.({ url, total, received, delta, done });
    }

    const data = new Uint8Array(received);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.length;
    }

    buf = data.buffer;
  } catch (e) {
    console.log(`failed to send download progress event: `, e);
    // Fetch arrayBuffer directly when it is not possible to get progress.
    buf = await fallback.arrayBuffer();
    cb?.({
      url,
      total: buf.byteLength,
      received: buf.byteLength,
      delta: 0,
      done: true,
    });
  }

  return buf;
};

/**
 * toBlobURL fetches data from an URL and return a blob URL.
 *
 * Example:
 *
 * ```ts
 * await toBlobURL("http://localhost:3000/ffmpeg.js", "text/javascript");
 * ```
 */
export const toBlobURL = async (
  url: string,
  mimeType: string,
  progress = false,
  cb?: ProgressCallback
): Promise<string> => {
  if (typeof URL.createObjectURL !== "function") {
    throw new Error(
      "URL.createObjectURL() is not available in this environment; " +
        "pass coreURL/wasmURL directly instead of going through toBlobURL()."
    );
  }
  const buf = progress
    ? await downloadWithProgress(url, cb)
    : await (await fetch(url)).arrayBuffer();
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
};
