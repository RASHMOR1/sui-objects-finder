# Sui Objects Finder

Find live Sui objects from a package and its versions.

## What this project does

Sui Objects Finder is a Next.js app for searching a Sui package on `mainnet` or `testnet`, listing its package versions, and loading live objects created by those versions.

It is built for cases where you want to:

- inspect the versions in a package lineage
- load live objects for a specific package version
- filter objects by object data as results stream in
- focus on shared objects for a specific version
- open an object and inspect its raw fields and metadata

## How it works

The app uses Sui GraphQL endpoints to:

- look up package versions
- scan live objects for a package or version
- fetch object details for expanded rows

For large result sets, version object loading is streamed progressively so matching objects appear as they are found.

## Tech stack

- Next.js 15
- React 18
- TypeScript

## Local development

Install dependencies:

```bash
pnpm install
```

Start the dev server:

```bash
pnpm dev
```

Build for production:

```bash
pnpm build
pnpm start
```

## Project structure

- `app/page.tsx`: main UI
- `app/api/live-objects/route.ts`: package search API
- `app/api/version-objects/route.ts`: per-version object loading API
- `app/api/object-data/route.ts`: object detail API
- `lib/sui-live-objects.ts`: GraphQL querying and live object scanning logic
- `lib/object-filter.ts`: shared object filter logic
- `lib/sui-object-data.ts`: object detail fetching

## Notes

- `mainnet` is the default network.
- Some testnet package queries can fail when the Sui GraphQL service cannot provide a consistent snapshot. The app surfaces that as a clearer user-facing error.
