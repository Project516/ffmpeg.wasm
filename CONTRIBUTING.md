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
   It also sets `CORE_VERSION` in
   `apps/website/src/components/Playground/const.ts`.
2. On that PR, dispatch a nightly-mode CI run with `gh workflow run CI.yml
   --ref <branch> -f subset=full` and wait for it. With that run's id, run
   `node scripts/update-core-sizes.mjs <version> --run <run-id>` and
   `node scripts/baseline/update.mjs <run-id>`, then commit the changed
   `apps/website/src/data/core-sizes.json`, `baseline/` and
   `apps/website/docs/results.md` in the same PR. CI fails until
   `core-sizes.json` is for the new version.
3. After it merges, tag the merge commit and push the tag:
   `git tag v<version> <sha> && git push origin v<version>`.

The tag runs `.github/workflows/release.yml`, which runs CI, publishes every
package to npm with provenance, and creates the GitHub release. Publishing
uses npm trusted publishing, so no npm token is involved: each package on
npmjs.com trusts `release.yml` in this repository.
