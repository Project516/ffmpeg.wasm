# Contributing

- Install dependencies: `pnpm install`
- Build the JS packages: `pnpm build`
- Lint: `pnpm lint`

The `@project516/core` and `@project516/core-mt` packages are prebuilt WebAssembly
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
   `git tag v0.13.0 <sha> && git push origin v0.13.0`.

The tag runs `.github/workflows/release.yml`, which runs CI, publishes every
package to npm with provenance, and creates the GitHub release.
