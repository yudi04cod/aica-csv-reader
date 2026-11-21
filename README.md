# aica-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/yudi04cod/aica-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/yudi04cod/aica-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0: `run(input)` returns exactly
what csv-reader returns for `{text, header}` — `{columns, rows, errors}` — on
every case, and does it in about half the CPU time.

Entered in the make.fun bounty [Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
(`csv-reader-speed-01-run-20261121`). Referral code: `38m33ybw`.

## How it works

One left-to-right pass over the text, following csv-reader's broken-row policy:
BOM dropped, records ending at LF or CRLF, empty lines no records, stray CRs
dropped (`stray_cr`), quoted fields with `""` escapes and LF-normalised breaks,
junk after a closing quote (`quote_junk`), a never-closing quote re-read as
unquoted (`unterminated_quote`), short/long rows padded/cut to the first
record's width, errors `{code, line, row}` in the order met.

Speed comes from never walking a plain field a character at a time: an
unquoted field is cut out with one `indexOf(',')` against a cached next
newline, a quoted field jumps from quote to quote with `indexOf('"')`, and
only the rare field holding a stray CR, junk after a quote, or an
unterminated quote falls back to a character loop. No dependencies.

## Run it

```sh
node main.ts   # reads /input/cases.json, writes /output/answers.json
```

Node 22+. Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`
stand in for `/input` and `/output`.

## Layout

- `solve.js` — the parser: `run(input)` → `{columns, rows, errors}`
- `main.ts` — the harness driver (reads cases, writes answers)
