<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-20 | Updated: 2026-06-20 -->

# types

## Purpose
Contains a single hand-written ambient declaration file that gives TypeScript visibility into the Max 9 `v8`/`js` runtime globals (e.g. `post`, `outlet`, `Task`, `Dict`, `LiveAPI`) that the v8 brain in `src/*.ts` relies on. Because these globals have no npm `@types` package, this file fills the gap so `tsc` can typecheck the source without runtime stubs. It is referenced via `tsconfig.json` and is intentionally minimal — only the surface QuickSearch actually calls is declared.

## Key Files

| File | Description |
|------|-------------|
| `maxapi.d.ts` | Ambient declarations for Max 9 `v8`/`js` globals: bare functions (`post`, `error`, `outlet`, `messnamed`, `arrayfromargs`), magic variables (`jsarguments`, `autowatch`, `inlets`, `outlets`), and three classes — `Task` (cooperative scheduler for chunking the browser walk across ticks), `Dict` (named dictionary, used to pass structured data to the jweb overlay), and `LiveAPI` (bridge into the Live Object Model for reading selected-track/device state). Includes the critical note that the Live browser is NOT in the LOM and must go through the Python bridge. |

## For AI Agents

### Working In This Directory
- **Only declare what QuickSearch actually uses.** The file header says "intentionally minimal" — do not paste in the full Cycling '74 reference. Undeclared members are fine as long as nothing in `src/` calls them.
- **`autowatch` is deliberately kept `0`.** The comment explains why: setting it to `1` leaks listeners. Do not change this default or remove the comment.
- **`LiveAPI` id is a string, not a number.** `"0"` means "no object". The id must never be persisted across callbacks — Live reassigns ids dynamically. Keep this constraint visible in any updated declarations.
- **The browser is NOT in the LiveAPI LOM.** This is documented in the `LiveAPI` JSDoc and is the architectural reason the Python Remote Script exists. Do not add browser-related LOM paths here.
- **`freepeer` is optional (`freepeer?`)** on `LiveAPI` because not every constructed instance exposes it (observed-path instances do, raw-id instances may not).
- This file is pure `.d.ts` — it produces no output. Changes here affect only type-checking, not runtime behaviour.

### Testing / Verifying Changes
Run `npm run typecheck` from the repo root. A clean exit (no `tsc` errors) is the only verification needed — there is nothing to run in Max for a `.d.ts` change. If you add a new declaration, also confirm a usage site exists in `src/` that exercises it, so the declaration is not dead from day one.

### Common Patterns
- All declarations use `declare` (ambient, no implementation bodies).
- Classes are declared with `declare class`; free functions and variables with `declare function` / `declare const` / `declare let`.
- JSDoc comments are kept short and Max-specific (referencing Cycling '74 docs, Live quirks, or QuickSearch behaviour), not generic TypeScript commentary.

## Dependencies

### Internal
- **`src/*.ts`** — the v8 brain files consume every declaration in this file; `tsconfig.json` must include the `types/` directory (or a path mapping) for them to resolve.
- **`tsconfig.json`** — references this directory via its `typeRoots` or `include` glob so the ambient declarations are in scope project-wide.

### External
- **Max 9 `v8`/`js` runtime** (Cycling '74) — the runtime whose globals are described here; no npm package exists for it.
- **`tsc`** (`typescript` npm package) — the only tool that reads this file; invoked by `npm run typecheck` and implicitly by the esbuild type-strip in `npm run build`.

<!-- MANUAL: Notes added below this line are preserved on regeneration -->
