import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Installation

:::note
ffmpeg.wasm only supports running in browser, see [FAQ](/docs/faq) for more
details
:::

## Package Managers

Install ffmpeg.wasm using package managers like npm and yarn:

<Tabs>
<TabItem value="npm" label="npm" default>

```bash
npm install @project516/ffmpeg @project516/util
```

</TabItem>
<TabItem value="yarn" label="yarn">

```bash
yarn add @project516/ffmpeg @project516/util
```

</TabItem>
</Tabs>

:::info
As `@project516/ffmpeg` spawns a web worker, you cannot import `@project516/ffmpeg` from CDN like
jsdelivr. It is recommended to download it and host it on your server most of the time.
:::
