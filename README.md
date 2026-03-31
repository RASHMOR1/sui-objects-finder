# Sui Objects Finder

Sui Objects Finder helps you discover live Sui objects for a package and its versions without writing GraphQL by hand.

Available at https://sui-objects-finder.vercel.app/

## Why this project exists

Sui stores application state in objects.

If you already know an object ID, reading that object is easy: you can paste the ID into Sui Explorer and inspect it. The hard part is usually finding the right object IDs in the first place.

On Sui, discovering the live objects that belong to a package is generally not as straightforward as reading contract state in many EVM explorers. In practice, package-scoped object discovery often means writing GraphQL queries and paging through results yourself.

This app solves that problem. You give it a package ID, and it does the GraphQL querying for you.

## What the app does

- finds the package lineage, including older and newer package versions
- lets you inspect objects for a specific package version
- streams matching objects progressively as they are found
- filters results by object metadata and JSON content
- supports `Shared only` filtering per version
- lets you open an object and inspect its raw fields and metadata
- works with `mainnet` and `testnet`

## What it searches

The app is focused on live Move objects whose type belongs to the selected package version or package lineage.

That means:

- it is meant for package-defined objects
- it is not a general transaction explorer
- it does not track transfer history, balance history, or coin movement history
- it filters out the SUI system coin type `0x2::sui::SUI`

Important nuance:

- if a package defines its own token-like or coin-like objects, those can still appear if their type belongs to that package
- the app is about live object discovery, not historical transaction analytics

## How it works

1. You enter a package ID.
2. The app looks up the package lineage through Sui GraphQL.
3. It lists the package versions it finds.
4. For each version, it can query live objects whose type belongs to that package version.
5. It lets you filter those objects without forcing you to write GraphQL manually.

For large package lineages, the app may skip a full upfront scan and instead let you search version by version. When that happens, matching objects are streamed into the UI as they are found.

## Why this is useful

This project is mainly for developers, researchers, and power users who need to answer questions like:

- What live objects currently exist for this package?
- Which package version do these objects belong to?
- Which shared objects exist for this version?
- Does any live object contain a specific value or field?

## Limitations

- the app depends on Sui GraphQL availability and consistency
- some large package histories may be too expensive to scan in one pass
- testnet can occasionally return consistency errors for object queries

## Feedback and contributions

If you want to propose new features, feel free to DM me on X:

- [x.com/rashmor_eth](https://x.com/rashmor_eth)

If you want to contribute or open issues, use GitHub:

- [github.com/RASHMOR1/sui-objects-finder](https://github.com/RASHMOR1/sui-objects-finder)

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

## Tech stack

- Next.js 15
- React 18
- TypeScript
- Sui GraphQL

## Project structure

- `app/page.tsx`: main UI
- `app/api/live-objects/route.ts`: package search API
- `app/api/version-objects/route.ts`: per-version object loading API
- `app/api/object-data/route.ts`: object detail API
- `lib/sui-live-objects.ts`: GraphQL querying and live object scanning logic
- `lib/object-filter.ts`: shared filtering logic used by both client and server
- `lib/sui-object-data.ts`: object detail fetching

## Notes

- `mainnet` is the default network
- filtering matches object metadata and JSON content
- per-version searches can be limited to shared objects only
