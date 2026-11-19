# Round 3 — harden the entrypoint

You are continuing work on the Token Radar entry in `/opt/harvest/makefun/token-radar`
(the current working directory). Rounds 1 and 2 built `main.ts`, `lib/model.ts`,
`lib/value.ts`, `lib/farm.ts`, the dashboard and the screenshots. Everything runs today:

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /tmp/tr-kit/token-radar-01-kit/input/snapshot.json

Your job in this round is three separate, small improvements to `main.ts` only. Apply them
**one at a time**, each as its own `edit_file` call on `main.ts`, and run the program after
each one to prove it still works.

## Rules you must follow

1. Change **only** `main.ts`. Do not touch `lib/`, `vendor/`, `dashboard/`, `screenshots/`.
2. Never write the new code into a shell command, a heredoc, a scratch file or a test file
   first. The only place the new code may appear is the `edit_file` call that puts it into
   `main.ts`. Do not paste code into your reply text either — describe the change in one
   sentence, then make the edit.
3. After each edit run the program once (see the command above) and read the real output.
   If it fails, fix it with another `edit_file` on `main.ts`.
4. The default run must keep writing exactly the same `board.json` and `data.js` bytes as
   before: the content hash printed at the end must stay the same as the one you see before
   your first edit. Record that hash before you start.
5. Comments in English, matching the file's existing voice. Keep the file's style: two-space
   indent, `const`, early `process.exit` with a message on stderr.

## Improvement 1 — refuse early when the output directory cannot be written

Right now the program scores every protocol before it creates the output directory, so a run
that cannot write anything wastes the whole scoring pass and then throws a raw fs error.
Create the output directory as soon as the `--output` value is known, and if that fails print
a one-line `token radar: ...` message naming the directory and the reason, then exit 2.
Remove the now-redundant later creation of the same directory.

## Improvement 2 — a `--verify-only` mode

Add a mode that checks a board a previous run left behind instead of building a new one.
When `--verify-only` is on the command line: read `<out>/board.json`, parse it, take its
`rows`, run the same `verifyBoard` check the normal path runs, print one line per problem to
stderr and a single summary line to stdout, and exit 1 if there was any problem, 0 if there
was none. A missing file, unreadable JSON or a document without a `rows` array is a usage
error: say so on stderr and exit 2. Put this block before the board is built, so the mode
never scores anything and never writes anything.

## Improvement 3 — a `--hash-only` mode

Add a flag that makes the run print nothing but the content hash line. After the hash is
computed, when `--hash-only` is on the command line, print the hash line and exit 0 before
the long summary. This lets a script compare two runs without parsing prose.

## Finish

When all three improvements are in and the default run still prints the same content hash as
before your first edit, call `finish` with a summary that lists the three changes and the
hash you measured at the start and at the end.
