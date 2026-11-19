# Task: add a self-verification pass to main.ts

The token radar already builds and writes its board. This task adds one thing: the program
checks its own output before it claims success, and prints a content hash so two runs can be
compared byte for byte.

Work in this repository. Read `main.ts` and `lib/model.ts` first.

## What to add

1. A new exported function in `lib/model.ts` named `verifyBoard` that takes the rows and the
   snapshot and returns a list of human-readable problems (strings). It must check, without
   throwing:
   - every row's `rank` is a positive whole number and the ranks are exactly 1..N once each;
   - `implied_value_usd` never rises as rank ascends;
   - every slug in `snapshot.watchlist` appears among the rows;
   - every row's `farm_steps` holds 3 to 12 strings, each 20 to 600 characters after trimming;
   - every row's `slug` is one of `snapshot.protocols`.
   Return `[]` when the board is clean.

2. In `main.ts`, after the board is written and before the dossier is written, call
   `verifyBoard`. If it returns any problem, print each one to stderr prefixed with
   `token radar: board check:` and exit 1. If it returns none, print one line to stdout:
   `token radar: board check: N rows, ranks 1..N, watchlist covered, farm steps in range`.

3. In `main.ts`, after the dossier is written, compute a sha256 over the exact bytes of
   `<out>/board.json` and `<out>/data.js` (concatenated in that order, using
   `node:crypto`'s `createHash`) and print it as
   `token radar: content sha256 <hex>`.
   This is what makes "two runs write the same bytes" checkable by a reader.

## Rules

- Node 22 runs the TypeScript directly: no `enum`, no `namespace`, no parameter properties,
  no decorators. Type-only syntax that Node strips is fine.
- Use only the standard library.
- Do not change the output format of `board.json`, `data.js`, `dashboard/`, `screenshots/`
  or `dossier.json`: the gate compares those bytes. Only add the checks and the two new
  stdout/stderr lines.
- After editing, run it for real and show the output:
  `MAKEFUN_OUTPUT_DIR=out node main.ts --input /tmp/tr-kit/token-radar-01-kit/input/snapshot.json`
- Then run it twice into two different output directories and compare the sha256 lines: they
  must be identical. Show both lines.
- Then run `node --check` on nothing (it is TypeScript); instead re-run the program to prove
  it still exits 0.

When the two runs print the same sha256 and the board check line appears, call finish with a
short factual summary of what you changed and the two hashes you observed.
