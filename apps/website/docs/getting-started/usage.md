# Usage

Learn the basics of using ffmpeg.wasm.

:::note
It is recommended to read [Overview](/docs/overview) first.
:::

## Transcode webm to mp4 video

:::caution
If you are a [vite](https://vitejs.dev/) user, use `esm` in **baseURL** instead of `umd`:

~~https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd~~ => https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/esm
:::

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile, toBlobURL } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            messageRef.current.innerHTML = message;
            console.log(message);
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        await ffmpeg.exec(['-i', 'input.webm', 'output.mp4']);
        const data = await ffmpeg.readFile('output.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Transcode webm to mp4</button>
                <p ref={messageRef}></p>
                <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Transcode webm to mp4 video (multi-thread)

:::caution
The multithread core needs `SharedArrayBuffer`, which needs the page to be
cross-origin isolated. Serve the page with the headers
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). See MDN's
[SharedArrayBuffer security requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)
for details.
:::

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile, toBlobURL } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core-mt@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            messageRef.current.innerHTML = message;
            console.log(message);
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        await ffmpeg.exec(['-i', 'input.webm', 'output.mp4']);
        const data = await ffmpeg.readFile('output.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Transcode webm to mp4</button>
                <p ref={messageRef}></p>
                <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Transcode video with timeout

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            messageRef.current.innerHTML = message;
            console.log(message);
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        // The exec should stop after 1 second.
        await ffmpeg.exec(['-i', 'input.webm', 'output.mp4'], 1000);
        const data = await ffmpeg.readFile('output.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Transcode webm to mp4</button>
                <p ref={messageRef}></p>
                <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Transcode video with progress (experimental)

:::danger
`progress` is an experimental feature and might not work for many cases
(ex. concat video files, convert image files, ...). Please use with caution.
:::

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        // Listen to progress event instead of log.
        ffmpeg.on('progress', ({ progress, time }) => {
            messageRef.current.innerHTML = `${progress * 100} % (transcoded time: ${time / 1000000} s)`;
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        await ffmpeg.exec(['-i', 'input.webm', 'output.mp4']);
        const data = await ffmpeg.readFile('output.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Transcode webm to mp4</button>
                <p ref={messageRef}></p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Split video into segments of equal duration

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            messageRef.current.innerHTML = message;
            console.log(message);
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        await ffmpeg.exec([
            '-i',
            'input.webm',
            '-f',
            'segment',
            '-segment_time',
            '3',
            '-g',
            '9',
            '-sc_threshold',
            '0',
            '-force_key_frames',
            'expr:gte(t,n_forced*9)',
            '-reset_timestamps',
            '1',
            '-map',
            '0',
            'output_%d.mp4'
        ]);
        const data = await ffmpeg.readFile('output_1.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Split video to segments of 3 sec. and plays 2nd segment</button>
                <p ref={messageRef}></p>
                <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Display Text on the video

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            messageRef.current.innerHTML = message;
            console.log(message);
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        await ffmpeg.writeFile('arial.ttf', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/arial.ttf'));
        await ffmpeg.exec([
            '-i',
            'input.webm',
            '-vf',
            'drawtext=fontfile=/arial.ttf:text=\'ffmpeg.wasm\':x=10:y=10:fontsize=24:fontcolor=white',
            'output.mp4',
        ]);
        const data = await ffmpeg.readFile('output.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Transcode webm to mp4 with text</button>
                <p ref={messageRef}></p>
                <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Interlace 2 Videos

```jsx live
// import { FFmpeg } from '@project516/ffmpeg-wasm';
// import { fetchFile } from '@project516/ffmpeg-wasm-util';
function() {
    const [loaded, setLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const videoRef = useRef(null);
    const messageRef = useRef(null);

    const load = async () => {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/ffmpeg-wasm-core@0.16.0/dist/umd'
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            messageRef.current.innerHTML = message;
            console.log(message);
        });
        // toBlobURL is used to bypass CORS issue, urls with the same
        // domain can be used directly.
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
    }

    const transcode = async () => {
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.writeFile('input.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm'));
        await ffmpeg.writeFile('reversed.webm', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s_reversed.webm'));
        await ffmpeg.exec([
            '-i',
            'input.webm',
            '-i',
            'reversed.webm',
            '-filter_complex',
            '[0:v][1:v]blend=all_expr=\'A*(if(eq(0,N/2),1,T))+B*(if(eq(0,N/2),T,1))\'',
            'output.mp4',
        ]);
        const data = await ffmpeg.readFile('output.mp4');
        videoRef.current.src =
            URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    }

    return (loaded
        ? (
            <>
                <video ref={videoRef} controls></video><br/>
                <button onClick={transcode}>Interlace two webm video to mp4</button>
                <p ref={messageRef}></p>
                <p>Open Developer Tools (Ctrl+Shift+I) to View Logs</p>
            </>
        )
        : (
            <button onClick={load}>Load ffmpeg-core (~31 MB)</button>
        )
    );
}
```

## Use WORKERFS

:::note
Required:

- @project516/ffmpeg-wasm@0.12.10+
- @project516/ffmpeg-wasm-core@0.12.4+
  :::

Please Check this PR: [Add WORKERFS support](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/581)

## Abort exec() with signal

:::note
Required:

- @project516/ffmpeg-wasm@0.12.10+
- @project516/ffmpeg-wasm-core@0.12.4+
  :::

Please check this PR: [abort signal](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/573)

## Read and write files in chunks

`open()`, `read()`, `write()` and `close()` work on a file descriptor, so a
large file can be written as it arrives instead of held in one array.

```ts
const fd = await ffmpeg.open("input.mp4", "w");
for await (const chunk of response.body) await ffmpeg.write(fd, chunk);
await ffmpeg.close(fd);
await ffmpeg.exec(["-i", "input.mp4", "output.mp4"]);
```

- `open(path, flags)` takes Node.js-style flags (`"r"`, `"r+"`, `"w"`, `"w+"`,
  `"a"`, `"a+"`) and resolves to the file descriptor.
- `read(fd, length, position?)` resolves to up to `length` bytes, empty at the
  end of the file. Without `position` it continues from the last read or write.
- `write(fd, data, position?)` resolves to the number of bytes written. Like
  `writeFile()`, it transfers `data` and leaves it empty unless you pass
  `{ transfer: false }` as the last argument.
- `close(fd)` releases the descriptor. Using it afterwards rejects.

The data still lives in the in-memory file system, and `exec()` reads its
input from there. This does not stream input into ffmpeg.

## Helpers: probe, transcode and extract frames

`probe()`, `transcode()` and `extractFrames()` cover common jobs without the
`writeFile()`, `exec()` and `readFile()` steps. Each takes a loaded `FFmpeg`
and a `File`, `Blob`, `URL` or `Uint8Array`. It writes the input into a
private directory of the virtual file system, runs ffmpeg, and removes
everything it wrote, including when ffmpeg fails. They work with both cores
and under Node.js. The existing `exec()` and file system calls are unchanged.

```js
import { FFmpeg, probe, transcode, extractFrames } from '@project516/ffmpeg-wasm';

const ffmpeg = new FFmpeg();
await ffmpeg.load();

// ffprobe's -show_format -show_streams JSON.
const info = await probe(ffmpeg, file);
const video = info.streams.find((s) => s.codec_type === 'video');
console.log(info.format.duration, video.width, video.height);

// The converted file's bytes. `format` is the output file extension.
const webm = await transcode(ffmpeg, file, {
  format: 'webm',
  videoCodec: 'libvpx-vp9',
  width: 640, // height follows the aspect ratio
  onProgress: ({ progress }) => console.log(progress),
});

// Encoded images, in order. They are held in memory, so limit long videos.
const frames = await extractFrames(ffmpeg, file, { fps: 1, width: 320 });
const url = URL.createObjectURL(new Blob([frames[0]], { type: 'image/png' }));
```

A helper rejects with ffmpeg's last log lines when the command fails.
Options beyond the ones shown go in `args` for `transcode()`, and every
helper accepts `timeout` and `signal` like `exec()`. A `Uint8Array` input is
copied, because `writeFile()` hands its buffer to the worker. To keep your own
`Uint8Array` intact, call `writeFile(path, data, { transfer: false })`, which
copies it instead.

Calling `load()` on an already loaded `FFmpeg` keeps the loaded core and
resolves `false`. Call `terminate()` first to load a different core.

`extractFrames()` writes `png`, `jpg` or `webp` images. `webp` needs a core
built with libwebp, which the default core has.

## Node.js

`@project516/ffmpeg-wasm` runs the same code in Node.js, using a
`worker_threads` Worker instead of a browser Worker. In the browser,
`load()` fetches the core from a CDN by default; in Node.js there is no
CDN default, so install `@project516/ffmpeg-wasm-core` yourself:

```bash
pnpm add @project516/ffmpeg-wasm-core
```

With that installed, `load()` resolves it from `node_modules`
automatically, so `coreURL` is only needed to pick a custom build.

```js
import { FFmpeg } from '@project516/ffmpeg-wasm';
import { fetchFile } from '@project516/ffmpeg-wasm-util';

const ffmpeg = new FFmpeg();
await ffmpeg.load();

await ffmpeg.writeFile('input.webm', await fetchFile('./input.webm'));
await ffmpeg.exec(['-i', 'input.webm', 'output.mp4']);
const data = await ffmpeg.readFile('output.mp4');

await ffmpeg.terminate();
```

`fetchFile` reads a local path or a `file:` URL directly in Node.js instead
of going through `fetch()`. Under Node.js, `coreURL` and `wasmURL` also accept
a filesystem path, including a Windows path, or a `file:` URL.

### Multithread core

`@project516/ffmpeg-wasm-core-mt` has no default resolution; install it and
pass its `ffmpeg-core.js` path as `coreURL`:

```js
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const coreURL = require.resolve('@project516/ffmpeg-wasm-core-mt');

const ffmpeg = new FFmpeg();
await ffmpeg.load({ coreURL });
```

### Known gaps

- `@project516/ffmpeg-wasm`'s Node.js entry is ESM. `import` always works.
  `require()` only works on a Node.js version with synchronous
  `require(esm)` support; on an older one it fails with `ERR_REQUIRE_ESM`.
- `load()`'s default core resolution uses `import.meta.resolve()`, which
  needs Node.js 20.6.0 or later (the package's `engines.node` requires
  this). On 20.0-20.5, an unflagged `import.meta.resolve()` does not
  exist and `load()` without a `coreURL` throws.
- `classWorkerURL` is a browser-only option. `load()` always runs the
  bundled `worker_threads` entry under Node.js and ignores it.
- The default `coreURL` resolution relies on Node's ordinary
  `node_modules` directory walk, so it works under npm's hoisted layout
  and pnpm. It does not work under Yarn PnP, which only resolves a
  package's own declared dependencies; pass `coreURL` explicitly there.
- `coreURL` is caller-supplied configuration, the same as it is in the
  browser. Node's `import()` has no browser-style CORS/CSP restriction on
  what it loads, so treat `coreURL` like any other application-controlled
  path passed to `import()`, not like untrusted user input.
- `coreURL` cannot be a `blob:` URL under Node.js (Node's ESM loader
  cannot `import()` one, unlike `fetch()`); pass a `file://` path or
  package specifier instead. `toBlobURL()` still works for `wasmURL`.
- `fetchFile()` reads any path it is given, including one that resolves
  outside the current working directory (e.g. `../secret.txt`), the same
  as `fs.readFile()` does. It does not sandbox to the working directory;
  do not pass it a path built from untrusted input.
