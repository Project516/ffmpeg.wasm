# Contributing

- Install dependencies: `pnpm install`
- Build the JS packages: `pnpm build`
- Lint: `pnpm lint`

The `@project516/ffmpeg-wasm-core` and `@project516/ffmpeg-wasm-core-mt` packages are prebuilt WebAssembly
artifacts. Building them requires Docker and runs through the Makefile:
`make prd` for the single-thread core, `make prd-mt` for the multi-thread
core. These builds are heavy; CI runs them on pushes to `master` and on pull
requests targeting `master`, and that is the recommended way to verify a core
change.

Pull requests target `master`.

## Releasing

All five packages share one version. To release:

1. Open a PR that sets `version` in every `packages/*/package.json` and
   `CORE_VERSION` in `packages/ffmpeg/src/const.ts` to the new version.
2. After it merges, tag the merge commit and push the tag:
   `git tag v<version> <sha> && git push origin v<version>`.

The tag runs `.github/workflows/release.yml`, which runs CI, publishes every
package to npm with provenance, and creates the GitHub release. Publishing
uses npm trusted publishing, so no npm token is involved: each package on
npmjs.com trusts `release.yml` in this repository.
