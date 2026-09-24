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
