// ============ the wingspan, from the authority that certified the wing ============
//
// Our spans come from Wikipedia. This script replaces them, where it can, with the span stated in
// the aircraft's EASA Type Certificate Data Sheet — the document the certification authority
// publishes, in which the wing of that aircraft is defined. It is the primary source, and a span
// that carries it stops being a reading of an encyclopaedia and becomes a fact with a signature.
//
// It also gives Wikidata something worth having. The spans we contributed carry `imported from
// English Wikipedia`, which is the weakest honest reference there is. A TCDS lets that become
// `stated in: EASA.A.221, issue 06` with a URL — a reference nobody has to take on trust.
//
// ---- how a glider is identified, and why it is not by its name ----
//
// EASA certifies FAMILIES. `EASA.A.047` is one document covering LS8, LS8-a, LS8-b, LS8-18, LS8-s,
// LS8-t, LS8-e; `EASA.A.241` covers the Glasflügel sailplanes. So the model is inside the PDF, not
// in its title, and matching by title would find the family and then have to guess within it.
//
// It does not have to. Every section of a TCDS states BOTH the span AND the WING AREA:
//
//        4.  Dimensions:   Span        17,0 m
//                          Wing area   17,95 m²
//
// and we independently hold the wing area, from the polar file. So the area CORROBORATES the match,
// against a number we did not get from the document.
//
// It does not MAKE the match, and the first version of this script claimed it did. That claim was
// false and it produced garbage. Reusing classify's titleMatches — which knows only about shared
// digits — offered `DG-400 (17m)` the de Havilland Dash-6 Series 400, the Airbus A400M, and the
// Sportine Aviacija LAK-17 (the 17 in our name is a SPAN; the 17 in LAK-17 is a MODEL NUMBER, the
// same trap as ASK-21, wearing a new coat). The area check then PASSED on an unrelated aircraft,
// because in a candidate pool that contains the whole of European aviation, two machines sharing a
// wing area to within 0.35 m² is not an identity — it is a coincidence, and the check had become a
// coincidence detector. We nearly wrote `Discus 2c 18m → 9.87 m` into the dataset, from a document
// about something else entirely.
//
// So the pool must be plausible BEFORE the area is asked anything. tcdsCandidate below requires a
// shared WORD — the designation, not the number — and the document must actually be a sailplane's.
//
// ---- THE TRAP, and it is the reason half this file exists ----
//
// A TCDS states the span of the aircraft AS CERTIFIED. For a glider with removable tips, that is not
// the span it flies. EASA.A.047, section B — the LS8-18 — reads:
//
//        Description:  ... optionally 18 m span with winglets or 15 m span with winglets.
//        Dimensions:   Span   15.00 m
//
// An eighteen-metre glider, whose certificate says fifteen. Reading the Dimensions field alone would
// have published `LS8-18 → 15 m` UNDER THE AUTHORITY OF THE CERTIFICATION AGENCY: a wrong number
// wearing the strongest seal available, which is worse than the same wrong number wearing none.
//
// The most authoritative source is not the safest source. It is answering a different question than
// ours, and the discipline is to notice.
//
// So a section whose prose offers a span the Dimensions field does not state is REFUSED. Its glider
// keeps whatever it had. There is no rescuing it by picking the larger number: which span a
// particular airframe flies is a fact about that airframe, and this file does not have it.
//
// Needs `pdftotext` (poppler):  brew install poppler
// Run:  just easa-tcds

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spanFromName, modelOf } from './classify-gliders';


const CSV = new URL('../datasets/polars/polars.csv', import.meta.url).pathname;
/** OUTSIDE the repository, and deliberately.
 *
 *  This directory holds EASA's PDFs and a copy of its catalogue index. Both are THEIR documents, and
 *  a copy of a public body's catalogue — 590 rows of id, title and link — is precisely the thing the
 *  EU's sui generis database right (96/9/EC) protects: not the facts, but the INVESTMENT in having
 *  assembled them. It was committed to this repository for a while, because the allowlist un-ignores
 *  every *.json and a cache file is a .json. It should never have been.
 *
 *  What this repository publishes is what it is entitled to publish: the FACTS (a wingspan is a fact,
 *  and facts are not copyrightable), the certificate's IDENTIFIER, and a LINK. We index, we do not
 *  rehost — the same rule the airspace catalogue has followed from the first commit.
 *
 *  So the cache lives where a cache belongs: in the user's cache directory, re-fetched on demand,
 *  never redistributed. */
const CACHE = `${process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`}/soaring-data/easa/`;
const BASE = 'https://www.easa.europa.eu';
const LIST = `${BASE}/en/document-library/type-certificates`;
const UA = 'soaring-data/0.3 (https://github.com/s-celles/soaring-data)';
const PAGES = 13;

/** How far the TCDS's wing area may sit from our polar's before we call it a different glider.
 *  Tighter than the Wikipedia check (0.8): both numbers are supposed to be THE wing area of THE
 *  aircraft, quoted to the centimetre, and a real disagreement means a real mismatch. */
const AREA_TOLERANCE_M2 = 0.35;

/** An area this close is not a resemblance — it is the same number. Both the TCDS and our polar file
 *  quote the wing area to the centimetre, and when they agree to the centimetre they are describing
 *  one aircraft. */
const AREA_EXACT_M2 = 0.05;

const cells = (line: string): string[] => {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};
const quote = (s: string): string => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// ---- which certificates could possibly be this glider's ----

const tokens = (s: string): { words: string[]; digits: string[] } => {
  const flat = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const parts = flat.match(/[a-z]+|\d+/g) ?? [];
  return { words: parts.filter(p => /[a-z]/.test(p) && p.length >= 2), digits: parts.filter(p => /\d/.test(p)) };
};

/** Could this certificate be about this glider? Deliberately NOT classify's titleMatches.
 *
 *  That function decides whether an ENCYCLOPAEDIA ARTICLE, already returned by a search for this
 *  glider, is about the right aircraft — a pool that is plausible before it arrives. Here the pool
 *  is every type certificate EASA has ever issued, airliners included, and a rule that knows only
 *  about digits will hand `DG-400` the Airbus A400M. Two problems, two rules; sharing one was how
 *  this script first produced nonsense.
 *
 *  A designation is a WORD and a NUMBER — `DG` and `400`, `ASK` and `21`, `LS` and `8` — and both
 *  must land. The word rules out the A400M (no `dg` anywhere in it). The number rules out the ASK 21
 *  when we are looking for the ASK 13. Where either side has no number at all, the word alone
 *  decides: `Std Cirrus` against `Schempp-Hirth Standard Cirrus`. */
export function tcdsCandidate(ourName: string, title: string): boolean {
  const ours = tokens(ourName), theirs = tokens(title);
  const word = ours.words.some(w => theirs.words.some(t => t === w || t.startsWith(w) || w.startsWith(t)));
  if (!word) return false;
  if (ours.digits.length === 0 || theirs.digits.length === 0) return true;
  return ours.digits.some(d => theirs.digits.includes(d));
}

/** Is this document a SAILPLANE's type certificate at all? The certification basis says so — CS-22
 *  and its ancestor JAR-22 are the sailplane codes — and it is the cheapest possible way to keep the
 *  Airbus fleet out of a question about wings that do not have engines. */
export function isSailplane(text: string): boolean {
  return /\bCS[\s-]?22\b|\bJAR[\s-]?22\b|\bOSTIV\b/i.test(text);
}

// ---- the catalogue ----

export interface Tcds { id: string; title: string; pdf: string }

/** Every type certificate EASA publishes, from its own listing: the id (EASA.A.047), the title, and
 *  the PDF. The listing row carries all three, so the per-product pages are never visited. */
async function fetchIndex(): Promise<Tcds[]> {
  const cached = `${CACHE}index.json`;
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8')) as Tcds[];

  const out: Tcds[] = [];
  let rowsSeen = 0;
  for (let page = 0; page < PAGES; page++) {
    const r = await fetch(`${LIST}?page=${page}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40_000) });
    if (!r.ok) throw new Error(`listing page ${page}: HTTP ${r.status}`);
    const html = await r.text();

    // One row = a title link, then (in the same cell block) the PDF download link.
    const rows = html.split('<tr');
    rowsSeen += rows.length - 2;          // minus the split head and the header row
    for (const row of rows) {
      const t = /type-certificates\/[a-z0-9-]+\/[a-z0-9-]+"[^>]*>\s*(EASA\.[A-Z0-9.]+)\s*[—–-]\s*([^<]+)</.exec(row);
      const p = /href="(\/en\/downloads\/\d+\/en)"/.exec(row);
      if (t === null || p === null) continue;
      out.push({ id: t[1].trim(), title: t[2].trim(), pdf: BASE + p[1] });
    }
  }

  // NO SILENT TRUNCATION. A row we failed to parse becomes, further down, a glider reported as
  // having "no certificate" — which reads as a fact about the world when it is a fact about this
  // regular expression. So the loss is counted and said out loud, every run.
  const lost = rowsSeen - out.length;
  if (lost > 0) console.log(`  (${lost} of ${rowsSeen} listing rows carried no PDF link and were skipped)`);

  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, JSON.stringify(out, null, 2));
  return out;
}

/** The TCDS text, fetched once and cached. The PDFs are a few hundred KB each and EASA is a public
 *  body, not a CDN: we download a candidate once and never again. */
async function tcdsText(t: Tcds): Promise<string | null> {
  const safe = t.id.replace(/[^A-Za-z0-9.]/g, '_');
  const pdf = `${CACHE}${safe}.pdf`;
  const txt = `${CACHE}${safe}.txt`;
  if (existsSync(txt)) return readFile(txt, 'utf8');

  if (!existsSync(pdf)) {
    const r = await fetch(t.pdf, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    await mkdir(CACHE, { recursive: true });
    await Bun.write(pdf, await r.arrayBuffer());
  }

  // -layout keeps the two-column "Span   17,0 m" on one line, which is the whole reason the fields
  // can be read at all.
  const proc = Bun.spawn(['pdftotext', '-layout', pdf, txt]);
  if (await proc.exited !== 0) return null;
  return readFile(txt, 'utf8');
}

// ---- reading a certificate ----

const N = String.raw`(\d{1,3}(?:[.,]\d+)?)`;

export interface Section {
  /** The span the Dimensions field states, in metres. */
  spanM: number;
  /** The wing area the same field states — the number that identifies the aircraft. */
  areaM2: number;
  /** True when the prose around it offers a span the Dimensions field does not state: a glider with
   *  removable tips, whose certificate names one span and whose airframe flies another. */
  variableSpan: boolean;
}

/** Every (span, wing area) the document states, with the one flag that decides whether it may be
 *  believed.
 *
 *  The Dimensions block is machine-readable and the same in every TCDS. The trap is not: it lives in
 *  the Description prose a page earlier, and it is the difference between an 18 m glider and a wrong
 *  number with EASA's name on it. So for each Dimensions block we look BACK over the section that
 *  precedes it, and any `NN m span` / `NN m Spannweite` in there that the Dimensions field does not
 *  itself state means the aircraft has more than one span and this document does not tell us which
 *  one ours is. */
export function readSections(text: string): Section[] {
  // The window is 1500 chars, not 400, because the fields are not in a fixed order: the ASK 21 puts
  // Wing area straight after Span, the LS8 puts Length and Height in between — and at ~110 characters
  // of leading layout whitespace per line, that is 600 characters of nothing. A 400-char window read
  // the ASK 21 and silently found NOTHING in the LS8, which is the failure mode that matters: not a
  // wrong answer, an absent one, indistinguishable from a glider EASA never certified.
  // 1500 stays well inside one section — the next one is pages away.
  // The COLON is not decoration. EASA.A.095 (the whole LS family) writes `Span:   15,00 m`, and a
  // pattern demanding whitespace straight after `Span` matched none of its 32 mentions — and said
  // so by returning NOTHING, which reads exactly like a glider EASA never certified. Every gap this
  // script reports is a claim about the world; a gap that is really a claim about a regular
  // expression is the one kind of output that cannot be checked by looking at it.
  const dims = new RegExp(String.raw`Span\s*:?\s+${N}\s*m\b[\s\S]{0,1500}?Wing\s*area\s*:?\s+${N}\s*m`, 'gi');
  const out: Section[] = [];

  for (const m of text.matchAll(dims)) {
    const spanM = num(m[1]), areaM2 = num(m[2]);
    if (spanM === null || areaM2 === null) continue;
    if (spanM < 5 || spanM > 40 || areaM2 < 3 || areaM2 > 40) continue;

    // The prose belonging to this section: back to the previous Dimensions block, or 6000 chars.
    const from = Math.max(0, m.index - 6000);
    const prose = text.slice(from, m.index);
    const spoken = [...prose.matchAll(new RegExp(String.raw`${N}\s*m\s*(?:span|Spannweite)`, 'gi'))]
      .map(x => num(x[1]))
      .filter((x): x is number => x !== null && x >= 5 && x <= 40);

    const variableSpan = spoken.some(s => Math.abs(s - spanM) > 0.05);
    out.push({ spanM, areaM2, variableSpan });
  }
  return out;
}

/** The span this certificate states for the glider whose wing area is ours — or null, with a reason.
 *
 *  Identification is by AREA, not by name: the area is in the document and it is also in our polar,
 *  and the two came from different places. If several sections match the area they must AGREE on the
 *  span; if they do not, the document is describing more than one aircraft that looks like ours and
 *  we are not the ones to choose. */
export function spanForArea(
  sections: Section[], ourAreaM2: number,
): { spanM: number } | { refused: 'no-section' | 'variable-span' | 'conflict' } {
  // An EXACT area match outranks a merely close one, and the difference is not pedantry.
  //
  // The Nimbus 4's certificate holds `26.4 m @ 17.80 m²` and `26.5 m @ 17.96 m²`. Our polar says
  // 17.80 — the first, to the centimetre. But 17.96 sits 0.16 m² away, inside the 0.35 tolerance, so
  // BOTH were "hits", they disagreed about the span, and the glider was refused for a conflict that
  // existed only because the tolerance had thrown away the very discrimination it was meant to
  // protect. Same for the EB 28 (16.80 → 28 m) and the EB 28 Edition (16.50 → 28.3 m), two aircraft
  // the loose window merged into one ambiguity.
  //
  // So: if any section agrees to the centimetre, only those sections are consulted. The wide
  // tolerance is the fallback for when nothing does — it forgives a rounding, not a difference.
  const exact = sections.filter(s => Math.abs(s.areaM2 - ourAreaM2) <= AREA_EXACT_M2);
  const hits = exact.length > 0
    ? exact
    : sections.filter(s => Math.abs(s.areaM2 - ourAreaM2) <= AREA_TOLERANCE_M2);
  if (hits.length === 0) return { refused: 'no-section' };

  // THE TRAP. An aircraft certified at 15 m that flies at 18 m: its certificate says 15, and the
  // certificate is right — about a question that is not ours.
  if (hits.some(s => s.variableSpan)) return { refused: 'variable-span' };

  const spans = new Set(hits.map(s => s.spanM));
  if (spans.size > 1) return { refused: 'conflict' };
  return { spanM: hits[0].spanM };
}

// ---- the run ----

if (import.meta.main) {
  if (Bun.which('pdftotext') === null) {
    console.error('pdftotext not found. It reads the certificates.\n\n    brew install poppler\n');
    process.exit(1);
  }

  const index = await fetchIndex();
  console.log(`EASA type certificates in the catalogue: ${index.length}`);

  const lines = (await readFile(CSV, 'utf8')).trim().split(/\r?\n/);
  const head = cells(lines[0]);
  const at = (r: string[], name: string): string | undefined => {
    const i = head.indexOf(name);
    return i < 0 ? undefined : r[i];
  };

  // A column that already exists KEEPS ITS PLACE — see link-wikidata: appending afresh made the
  // file's header depend on the order the scripts ran in.
  const cols = [...head];
  for (const c of ['easa_tcds', 'easa_url']) if (!cols.includes(c)) cols.push(c);
  const out = [cols.join(',')];

  let upgraded = 0, agreed = 0, corrected = 0, noArea = 0, noCert = 0, notASailplane = 0;
  const refusals: Record<string, number> = { 'no-section': 0, 'variable-span': 0, conflict: 0 };
  const changes: string[] = [];
  const refusedVariable: string[] = [];

  for (const line of lines.slice(1)) {
    const r = cells(line);
    const fileName = (at(r, 'name') ?? '').replace(/^"|"$/g, '').trim();
    // The certificate is about the AIRCRAFT. `ASW-27 Wnglts` is an ASW 27 with its tips on.
    const declared = (at(r, 'model') ?? '').replace(/^"|"$/g, '').trim();
    const name = declared !== '' ? declared : modelOf(fileName);
    const ourArea = num(at(r, 'wing_area_m2'));
    const hadSpan = num(at(r, 'span_m'));
    let spanM: number | null = null, tcds = '', url = '';

    if (at(r, 'wing_class') !== 'glider') {
      // A paraglider has no type certificate. Not a failure — a category error, and silent.
    } else if (ourArea === null) {
      // Without OUR area there is nothing to identify the glider WITH, and identifying it by name
      // inside a family document is exactly the guess this script exists to avoid.
      noArea++;
    } else {
      const candidates = index.filter(t => tcdsCandidate(name, t.title));
      let found = false;
      // What the glider's own name says about its span, if anything. It is the last word here.
      const named = spanFromName(fileName);
      for (const c of candidates) {
        const text = await tcdsText(c);
        if (text === null) continue;
        // Not a glider's certificate: not an answer to this question, whatever numbers it holds.
        if (!isSailplane(text)) { notASailplane++; continue; }
        const verdict = spanForArea(readSections(text), ourArea);
        if ('refused' in verdict) {
          refusals[verdict.refused]++;
          if (verdict.refused === 'variable-span') refusedVariable.push(`${name} — ${c.id}`);
          continue;
        }
        // THE ROW MAY NOT CONTRADICT ITSELF. `DG-400 (17m)` is a seventeen-metre DG-400 — its own
        // name says so, in this very row — and EASA.A.239 states 15.00 m, because the aircraft is
        // CERTIFIED at 15 m with optional tips. Writing 15 there would leave `name` and `span_m`
        // disagreeing in adjacent cells, with the certificate's authority behind the wrong one.
        //
        // This is the variable-span trap again, arriving by a door the prose detector does not
        // watch: EASA.A.301's Description simply never spells "17 m span". The name check needs no
        // prose. It is the same guard the Wikipedia path already had — I had not thought to bring it
        // here, and it caught all three of the "corrections" this script first proposed, every one
        // of which was wrong.
        if (named !== null && Math.abs(named - verdict.spanM) > 0.05) {
          refusals['variable-span']++;
          refusedVariable.push(`${name} — ${c.id} says ${verdict.spanM} m, the name says ${named} m`);
          continue;
        }
        spanM = verdict.spanM; tcds = c.id; url = c.pdf; found = true;
        break;
      }
      if (!found) noCert++;
    }

    if (spanM !== null) {
      upgraded++;
      if (hadSpan !== null && Math.abs(hadSpan - spanM) > 0.05) {
        corrected++;
        changes.push(`  ${name.padEnd(24)} ${String(hadSpan).padStart(6)} m  →  ${String(spanM).padStart(6)} m   ${tcds}`);
      } else if (hadSpan !== null) agreed++;
    }

    const row = cols.map(c => quote(r[head.indexOf(c)] ?? ''));
    if (spanM !== null) {
      row[cols.indexOf('span_m')] = String(spanM);
      row[cols.indexOf('span_source')] = 'easa';
    }
    row[cols.indexOf('easa_tcds')] = quote(tcds);
    row[cols.indexOf('easa_url')] = quote(url);
    out.push(row.join(','));
  }

  // ---- the file may not contradict itself, and this is checked BEFORE it is written ----
  //
  // The bug this exists for: the first version of this script wrote `DG-400 (17m) → 15 m` (the
  // certified span, not the flown one). The next version REFUSED to make that change — correctly —
  // and so preserved the wrong value already sitting in the file, still labelled `easa`, with an
  // empty easa_tcds beside it. A refusal is only as good as the file it lands on, and a script that
  // is not idempotent against its OWN bad output will launder its own mistakes forever.
  //
  // So the whole result is inspected before a byte is written, and a row whose span disagrees with
  // the span its own NAME states aborts the run. Nothing is half-written.
  for (const line of out.slice(1)) {
    const r = cells(line);
    const name = (r[cols.indexOf('name')] ?? '').replace(/^"|"$/g, '');
    const span = num(r[cols.indexOf('span_m')]);
    const named = spanFromName(name);
    if (span !== null && named !== null && Math.abs(span - named) > 0.05) {
      console.error(`\nREFUSING TO WRITE: ${name} would hold ${span} m, and its own name says ${named} m.`);
      console.error('Nothing has been written. Restore polars.csv and run the pipeline from a clean file:');
      console.error('    git checkout -- datasets/polars/polars.csv && just classify-gliders && just link-wikidata && just easa-tcds\n');
      process.exit(1);
    }
  }

  await writeFile(CSV, out.join('\n') + '\n');

  console.log(`
gliders given a CERTIFIED span   ${upgraded}
  it agreed with what we held    ${agreed}   (Wikipedia was right, and now it is also sourced)
  it CORRECTED what we held      ${corrected}
  no certificate matched         ${noCert}
  no wing area, cannot identify  ${noArea}
  candidate was not a sailplane  ${notASailplane}   ← an airliner is not an answer about a wing

refused, and kept as they were:
  no section with our wing area  ${refusals['no-section']}
  VARIABLE SPAN                  ${refusals['variable-span']}   ← the certificate says one span, the aircraft flies another
  sections disagree              ${refusals['conflict']}
`);

  if (changes.length > 0) {
    console.log('the certificate disagreed with Wikipedia, and the certificate wins:');
    for (const c of changes) console.log(c);
    console.log('');
  }
  if (refusedVariable.length > 0) {
    console.log('variable-span aircraft — REFUSED, because the strongest source would have been wrong:');
    for (const c of refusedVariable.slice(0, 12)) console.log(`  ${c}`);
    console.log('');
  }

  console.log(`A TCDS states the span of the aircraft AS CERTIFIED. EASA.A.047 section B — the LS8-18 —
says "optionally 18 m span with winglets or 15 m span with winglets" and then states 15.00 m. An
eighteen-metre glider whose certificate says fifteen. Publishing that would have been a wrong number
wearing the strongest seal available, which is worse than the same wrong number wearing none. The
most authoritative source is not the safest source: it is answering a different question than ours.`);
}
