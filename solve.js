// A fast drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly
// what csv-reader's readCsv returns for {text, header} — {columns, rows, errors}.
// Written from the reference's stated policy (RULES.txt / vendor/csv-reader),
// not from its code: one left-to-right pass, a U+FEFF at the very start dropped,
// records ending at LF or CRLF, a line left with no characters no record, a CR
// outside quotes not followed by LF dropped (stray_cr), a field that opens with
// a quote running to the next quote that is not doubled ("" inside it one quote,
// each CRLF or lone CR inside it read as LF), what follows its closing quote
// appended as it stands up to the next comma or line break (quote_junk when the
// field ends), a quote that never closes read as a literal with the text after
// it read again as unquoted (unterminated_quote), a quote inside an unquoted
// field a literal, fields staying strings, columns the first record when header
// is true (else null), rows padded with "" (short_row, with fields: its count)
// or cut (long_row, with extra: the cut fields) to the first record's width,
// each error {code, line, row} in the order met, line the 1-based line its
// record starts on, row its index in rows (null for the header).
//
// Speed comes from never walking a plain field a character at a time. An
// unquoted field is cut out with one indexOf(',') against a cached next
// newline (the cache stays sound: past a field start, the next LF is the
// record's end unless a comma comes first, since any later quoted field is
// past a comma), and a quoted field jumps from quote to quote with
// indexOf('"'), converting only the rare segment that holds a line break.
// The character loop only runs for fields that actually hold a stray CR, junk
// after a closing quote, or a quote that never closes. nextCR / nextLF are
// refreshed lazily as pos moves forward, so their scans cover the text once
// between them; both are invalidated on the one backward jump (an
// unterminated quote resetting pos).

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The next CR / LF at or after pos (Infinity when none is left).
  let nextCR = text.indexOf('\r', pos);
  if (nextCR === -1) nextCR = Infinity;
  let nextLF = text.indexOf('\n', pos);
  if (nextLF === -1) nextLF = Infinity;

  // The record being read: the line it starts on, and its index in rows
  // (null while the header is still unread).
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field a character at a time, for the rare fields the
  // fast path cannot take (a stray CR inside, junk after a closing quote, a
  // quote that never closed). Returns {v, e, a}: the value, how it ended,
  // and the characters kept (a stray CR kept none, so junk of only stray CRs
  // is no quote_junk, as the reference has it).
  function unquotedSlow(v) {
    let a = 0;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) { pos += 1; return { v, e: 0, a }; } // ,
      if (c === 10) { pos += 1; line += 1; return { v, e: 1, a }; } // LF
      if (c === 13) { // CR
        if (text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return { v, e: 1, a }; } // CRLF
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        continue;
      }
      v += text[pos];
      a += 1;
      pos += 1;
    }
    return { v, e: 2, a };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = 0;

    do {
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        quoted = true;
        const open = pos;
        const openLine = line;
        pos += 1;
        let value = '';
        let endKind = 2;
        for (;;) {
          if (nextCR < pos) { nextCR = text.indexOf('\r', pos); if (nextCR === -1) nextCR = Infinity; }
          const q = text.indexOf('"', pos);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the text
            // after it is read again as unquoted (the line count rewinds to
            // where the quote opened, as the reference rewinds it).
            pos = open + 1;
            line = openLine;
            nextCR = -1; // pos moved back: both caches must be re-found
            nextLF = -1;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            const r = unquotedSlow('"');
            value = r.v;
            endKind = r.e;
            break;
          }
          // The segment [pos, q) holds no quote; take it whole unless it
          // holds a line break, which is converted (CR/CRLF each one LF).
          const nlIdx = text.indexOf('\n', pos);
          if ((nlIdx === -1 || nlIdx >= q) && nextCR >= q) {
            value += text.slice(pos, q);
          } else {
            let s = pos;
            let acc = '';
            for (let i = pos; i < q; i++) {
              const c = text.charCodeAt(i);
              if (c === 13) {
                acc += text.slice(s, i);
                acc += '\n';
                line += 1;
                if (text.charCodeAt(i + 1) === 10) i += 1;
                s = i + 1;
              } else if (c === 10) {
                acc += text.slice(s, i);
                acc += '\n';
                line += 1;
                s = i + 1;
              }
            }
            acc += text.slice(s, q);
            value += acc;
          }
          if (text.charCodeAt(q + 1) === 34) {
            value += '"'; // a doubled quote is one quote
            pos = q + 2;
            continue;
          }
          pos = q + 1; // the closing quote
          if (pos >= n) {
            endKind = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) { pos += 1; endKind = 0; }
            else if (c === 10) { pos += 1; line += 1; endKind = 1; }
            else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; endKind = 1; }
            else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break; a stray CR inside it is
              // reported before the quote_junk, as the reference reports it.
              const r = unquotedSlow(value);
              if (r.a > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = r.v;
              endKind = r.e;
            }
          }
          break;
        }
        fields.push(value);
        ended = endKind;
      } else {
        // An unquoted field: it ends at the next comma or at the cached next
        // newline (the record's end), whichever comes first, or at the text.
        quoted = false;
        if (nextLF < pos) { nextLF = text.indexOf('\n', pos); if (nextLF === -1) nextLF = Infinity; }
        if (nextCR < pos) { nextCR = text.indexOf('\r', pos); if (nextCR === -1) nextCR = Infinity; }
        const c = text.indexOf(',', pos);
        const end = c !== -1 && c < nextLF ? c : nextLF;
        if (end === Infinity) {
          if (nextCR < n) {
            const r = unquotedSlow('');
            fields.push(r.v);
            ended = r.e;
          } else {
            fields.push(text.slice(pos, n));
            pos = n;
            ended = 2;
          }
        } else if (end === nextLF) {
          if (nextCR < end) {
            if (nextCR === end - 1) {
              fields.push(text.slice(pos, end - 1)); // CRLF
              pos = end + 1;
              line += 1;
              ended = 1;
            } else {
              const r = unquotedSlow(''); // a stray CR before the break
              fields.push(r.v);
              ended = r.e;
            }
          } else {
            fields.push(text.slice(pos, end));
            pos = end + 1;
            line += 1;
            ended = 1;
          }
        } else {
          if (nextCR < end) {
            const r = unquotedSlow(''); // a stray CR before the comma
            fields.push(r.v);
            ended = r.e;
          } else {
            fields.push(text.slice(pos, end));
            pos = end + 1;
            ended = 0;
          }
        }
      }
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
