import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Installation

:::note
ffmpeg.wasm supports running in the browser and in Node.js, see
[Usage](/docs/getting-started/usage#nodejs) and [FAQ](/docs/faq) for more
details
:::

## Package managers

Install ffmpeg.wasm using a package manager:

<Tabs>
<TabItem value="pnpm" label="pnpm" default>

```bash
pnpm add @project516/ffmpeg-wasm @project516/ffmpeg-wasm-util
```

</TabItem>
<TabItem value="npm" label="npm">

```bash
npm install @project516/ffmpeg-wasm @project516/ffmpeg-wasm-util
```

</TabItem>
<TabItem value="yarn" label="yarn">

```bash
yarn add @project516/ffmpeg-wasm @project516/ffmpeg-wasm-util
```

</TabItem>
</Tabs>

:::info
As `@project516/ffmpeg-wasm` spawns a web worker, you cannot import `@project516/ffmpeg-wasm` from CDN like
jsdelivr. It is recommended to download it and host it on your server most of the time.
:::
