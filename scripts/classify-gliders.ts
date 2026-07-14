// ============ what class is this glider? — and what we cannot honestly say ============
//
// A glider's competition class is not in its polar. It follows from the SPAN and from the wing's
// configuration, and the .plr files carry neither. So this script establishes what can be
// established, from a source that can be checked, and LEAVES EMPTY what cannot — then says out
// loud how much that was.
//
// ---- where the span comes from ----
//
//   1. THE NAME, but ONLY where the name says `m` — `Ventus B (15m)`, `Cirrus_18m`. A bare number
//      is a MODEL number: `ASK-21` is a 17 m two-seater. See spanFromName.
//
//   2. WIKIPEDIA's aircraft infobox (`span m=`), found by searching for the glider. It is the
//      only source with the coverage this needs: Wikidata knows ~394 sailplanes and records the
//      wingspan of about thirty.
//
// ---- and the safeguard, which matters more than the source ----
//
// Matching "LS-8" to the wrong article gives a WRONG span, confidently — and it did: Wikipedia's
// search answered `LS-8-18` with the Glaser-Dirks DG-600 and `SF27` with the Scheibe SF 32, and we
// wrote 15 m against an EIGHTEEN-metre LS 8. So every hit passes two checks it cannot fake:
//   · titleMatches — the article's title must carry one of our name's numbers (the 8 of LS-8, the
//     27 of SF27). An article about another aircraft is refused before it is even read.
//   · the WING AREA in our own polar file. If the article says 9.0 m² and our row says 10.5 m², we
//     matched the wrong glider, and the answer is thrown away rather than written down.
// A source we cannot check is a source we should not use.
//
// ---- the honest hole, which is the point ----
//
// THE FAI CLASS CANNOT BE DERIVED FROM SPAN ALONE. A 15 m glider is Standard class if its wing has
// no flaps and 15-Metre class if it has — and the polar files record the flaps of ten wings out of
// 155. A 20 m machine is 20-Metre Multi-seat only if it seats two, which nothing here records.
//
// So `fai_class` is filled ONLY where the span settles it, and left EMPTY otherwise. Filling it by
// guessing would be the one thing this repository exists not to do: an empty cell a human can see
// is worth more than a plausible cell nobody will re-check, and a pilot who reads "Standard" beside
// a flapped 15-metre has been told something false by a machine that had no way of knowing.
//
// Run:  just classify-gliders

import { readFile, writeFile } from 'node:fs/promises';

const CSV = new URL('../datasets/polars/polars.csv', import.meta.url).pathname;
const WP = 'https://en.wikipedia.org/w/api.php';
const UA = 'soaring-data/0.1 (https://github.com/s-celles/soaring-data)';
/** How far the article's wing area may sit from ours before we call it a different glider. */
const AREA_TOLERANCE_M2 = 0.8;

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

/** The span, READ off the name — and ONLY when the name says `m`.
 *
 *  THE UNIT IS NOT OPTIONAL, and this is the hardest-won line in the file.
 *
 *  It once was optional, on the reasoning that the gliding world appends the span to the model:
 *  `ASG29-18` is an 18-metre ASG 29, and reading the 18 is not inference, it is reading. That is
 *  true. But `ASK-21` is not a 21-metre glider — it is an ASK 21, a 17 m two-seater, and 21 is its
 *  MODEL NUMBER. The two names are structurally IDENTICAL: letters, a hyphen, two digits. No
 *  pattern can tell them apart, because the difference is not in the string.
 *
 *  While the unit was optional we stored 21 m for the ASK 21, 23 m for the ASK 23, 17 m for the
 *  ASW 17 (a 20 m glider), and then — because a span over 20.5 m settles the class on its own —
 *  we published the ASK 21 and the ASK 23 as OPEN CLASS. A trainer and a club single-seater, in the
 *  class of the 26-metre machines, on the authority of their own model numbers.
 *
 *  So a bare number is a model number, and an envergure is a number that says it is one. What this
 *  costs is real: `ASG29-18` no longer yields its 18 here, and goes to Wikipedia's infobox instead
 *  — a source that is traceable, and cross-checked below against our own wing area. What it buys is
 *  that no cell in this file is a number we merely found plausible. An empty span a human can see
 *  is worth more than a confident one nobody will re-check.
 *
 *  AND THE `m` MUST BE LOWERCASE. In these file names an uppercase M is a MOTOR: `ASH-25M` is the
 *  self-launching ASH 25. Read case-insensitively, `PIK-30M` became a THIRTY-METRE glider and was
 *  published as Open class; it is a 15 m motorglider whose model number is 30. The lowercase m is
 *  the unit, and all 23 names that carry one are genuine spans; the 5 that carry an uppercase M are
 *  ambiguous — `DG1000-20M` really IS a 20-metre DG-1000 — and ambiguous is exactly what we refuse
 *  to resolve by pattern. Those five go to the infobox, or they stay empty.
 *
 *  Bounded to 12–30 m regardless: no sailplane has an 8 m wing or a 40 m one. */
export function spanFromName(name: string): number | null {
  const m = /(?:^|[-\s_(])(\d{2}(?:[.,]\d)?)\s*m\b/.exec(name);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return v >= 12 && v <= 30 ? v : null;
}

/** The FAI class, and ONLY where the span ALONE settles it. Three cases do; the rest do not, and
 *  the rest are left empty.
 *
 *  18 m  → the 18-Metre class, and nothing else.
 *  13.5 m→ the 13.5-Metre class, likewise.
 *  ≥ 20.5 m → Open. (20-Metre Multi-seat is exactly 20 m, so anything comfortably beyond it is
 *            Open whether it seats one or two — the seat count, which we do not have, cannot
 *            change the answer here.)
 *
 *  15 m is DELIBERATELY EMPTY: Standard without flaps, 15-Metre with them, and these files record
 *  the flaps of ten wings out of 155.
 *  20 m is DELIBERATELY EMPTY: 20-Metre Multi-seat if it seats two, Open if it seats one, and
 *  nothing here records the seats.
 *
 *  A machine that cannot see the wing must not name its class. */
/** THE SPORTING CODE SAYS A CLASS IS A CEILING, AND THIS FUNCTION READ IT AS A TARGET.
 *
 *  FAI Sporting Code Section 3, chapter 6.5, in its own words:
 *
 *      6.5.1  Open Class        "No special rules."
 *      6.5.2  18 metre Class    "The only limitation is a maximum span of 18,000 mm."
 *      6.5.3  15 metre Class    "The only limitation is a maximum span of 15,000 mm."
 *      6.5.4  Standard Class    span ≤ 15,000 mm, and "Lift increasing devices are prohibited,
 *                                even if unusable."
 *      6.5.6  Club Class        "The only limitation on entry ... is that it is within the agreed
 *                                range of handicap factors FOR THE COMPETITION."
 *      6.5.7  20 metre Multi-seat  "multi-seat gliders having a crew of two persons."
 *
 *  Three things follow, and the first two are corrections.
 *
 *  1. A MAXIMUM IS NOT A TARGET. `Math.abs(span - 18) < 0.3` accepted the Janus B at 18.2 m and
 *     labelled it 18-Metre class — a glider that EXCEEDS the class ceiling by twenty centimetres and
 *     cannot be entered in it. The tolerance may reach DOWNWARDS, for a glider built to the limit and
 *     measured a few centimetres under it. It may never reach above.
 *
 *  2. THE 20-METRE TWO-SEAT CLASS NEEDS THE SEATS, and until the type certificates were read nothing
 *     in this table said how many people a glider carries. Now they do — see seatsIn in easa-tcds —
 *     and the Duo Discus, the DG-1000 and the Arcus, all exactly 20 m and all with two seats, stop
 *     being gliders of no class at all.
 *
 *  3. AND A CLASS IS NOT A PROPERTY OF AN AIRCRAFT. It is an ENTRY CONDITION for a competition, and
 *     the classes are NESTED: an ASW 24 (15 m, no flaps) may be entered in Standard, in 15-Metre, in
 *     18-Metre and in Open. Club Class is not even a property of the glider — it depends on the
 *     handicap range the ORGANISERS agreed for that contest. There is no authority anywhere that
 *     publishes "the class of the ASW 20", because there is no such fact.
 *
 *     So what this column holds is a GROUPING — the class a glider was built for and would normally
 *     be entered in — and it is offered as that, not as a certified attribute. Where the data cannot
 *     establish one it stays EMPTY, which is why 15-Metre and Standard are almost never given: telling
 *     them apart needs the FLAPS, and a certificate that does not mention flaps has not told us there
 *     are none. The Glasflügel document names no flaps at all, and the 604, the Kestrel and the
 *     Mosquito have them. SILENCE IS NOT ABSENCE, and Standard class is defined by an absence. */
export function classFromSpan(span: number | null, seats: number | null = null): string {
  if (span == null) return '';
  if (span >= 13.3 && span <= 13.5) return '13.5m';       // ≤ 13,500 mm
  if (seats !== null && seats >= 2 && span >= 19.7 && span <= 20.0) return '20m';
  if (span >= 17.7 && span <= 18.0) return '18m';          // ≤ 18,000 mm — a CEILING
  if (span >= 20.5) return 'open';                         // nothing else fits it
  return '';                            // 15 m needs the flaps; anything else, we have not established
}

/** The AIRCRAFT, stripped of everything that describes how it is being FLOWN rather than what it is.
 *
 *  A polar file name is not an aircraft designation. It is an aircraft designation plus whatever the
 *  person who measured the polar needed to record: `DG-500 PAS` and `DG-500 PIL` are one glider flown
 *  with and without a passenger; `ASW-27 Wnglts` is an ASW 27 with the winglets on; `Nimbus 4D PAS`,
 *  `IS-28B2 Lark with 1 person`, and — best of all — `Discus B from Cumulus Soaring GN II`, which
 *  carries the name of the website that distributed the file.
 *
 *  Those words are true and they are not the aeroplane. Asking Wikipedia for `Discus B from Cumulus
 *  Soaring GN II` finds nothing; asking it for `Discus B` finds the Discus. THIRTY-EIGHT
 *  EASA-CERTIFIED GLIDERS had no Wikidata identifier for no better reason than this, and most of them
 *  already HAD an item — the gap was never in the commons, it was in the question we were asking it.
 *
 *  The parenthesised SPAN goes too, and for the same reason: `Ventus B (15m)` and `Ventus CM (17.6m)`
 *  are configurations of the aircraft the item describes. Stripping it also removes a number that was
 *  actively lying to the matcher — the 17 of `DG-400 (17m)` is a SPAN, and it was being compared
 *  against the 17 of `LAK-17`, which is a MODEL. Only a LOWERCASE `m` is stripped: the M of
 *  `DG1000-20M` is a Motor, and the model keeps it.
 *
 *  `name` stays exactly as the polar file wrote it. It is the provenance, and provenance is not ours
 *  to tidy. This is a derived column beside it, which is what a derived thing should be. */
export function modelOf(name: string): string {
  return name
    .replace(/\bfrom\s+.*$/i, ' ')                                  // "…from Cumulus Soaring GN II"
    .replace(/\bwith\s+\d+\s+persons?\b/gi, ' ')                    // "…with 2 person"
    .replace(/[\s_(]*\b(PAS|PIL|pilot|passenger)\b\)?/gi, ' ')       // seats, not aircraft
    .replace(/[\s_]*\b(wnglts|winglets)\b/gi, ' ')                  // tips, not aircraft
    .replace(/wl\b/g, ' ')                                          // LS7wl
    .replace(/[\s_(]*\d{2}(?:[.,]\d)?\s*m\b\)?/g, ' ')              // the span: a configuration
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s(]+$/, '')
    .trim();
}

/** The tokens of a name, letters and digits separated: `LS-8-18` → ['ls','8','18'].
 *  `SZD-9bis` → ['szd','9','bis']. Accents folded, because Blaník is Blanik in half the sources. */
function tokens(s: string): { words: string[]; digits: string[] } {
  const flat = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const parts = flat.match(/[a-z]+|\d+/g) ?? [];
  return { words: parts.filter(p => /[a-z]/.test(p)), digits: parts.filter(p => /\d/.test(p)) };
}

/** HOW WELL does this article's title match this glider? Not WHETHER — how well.
 *
 *  A designation is a WORD and a NUMBER — `ASG` and `29`, `LS` and `8`, `SF` and `27` — and that
 *  gives three degrees of agreement, which do not deserve the same treatment:
 *
 *    STRONG  both land. `ASG29-18` against `Schleicher ASG 29`. The aircraft is IDENTIFIED, by its
 *            designation, and there is nothing left to doubt. findQid asks for nothing further.
 *
 *    WEAK    one lands. `LS-8-15` against `Schleicher K 8` shares an 8 and NOTHING else — the match
 *            that nearly published a wingspan onto the wrong Schleicher. `Discus A` against `Discus
 *            Launch Glider` — a radio-controlled model aeroplane — shares a word and nothing else.
 *            A weak match is a SUSPICION, and findQid will not act on one unless our own wing area
 *            agrees with the article's.
 *
 *    NONE    the numbers CONTRADICT. `SF27` against `Scheibe SF 32`: 27 is not 32, and no shared
 *            word rescues it. Two designations that both carry numbers, and disagree, are two
 *            aircraft.
 *
 *  EVERY DISASTER THIS FILE RECORDS HAD A WEAK MATCH. Not one had a strong one. That is why the wing
 *  area — which used to be demanded in every case alike — is now demanded only where the designation
 *  leaves room for doubt.
 *
 *  What that rule cost, before this: `ASG29-18` IS a Schleicher ASG 29, beyond argument, and it was
 *  refused an identifier because WE hold no wing area for it — a fact about our file, offered as
 *  though it were a fact about the aircraft. Others were refused because the article states ONE wing
 *  area, for ONE configuration, while our row describes another: a failure of CONFIGURATION, dressed
 *  up as a failure of IDENTITY. */
export type Strength = 'strong' | 'weak' | 'none';

export function titleStrength(ourName: string, title: string): Strength {
  return match(ourName, title).strength;
}

/** The same verdict, with the REASON — because a weak match by a shared WORD and a weak match by a
 *  shared DIGIT are not equally weak, and one caller needs to tell them apart.
 *
 *  `Speed Astir` against `Grob G104 Speed Astir` shares two distinctive words and no number: that is
 *  weak by the letter of the rule and overwhelming in fact. `LS-8-15` against `Schleicher K 8` shares
 *  the digit 8 and nothing else: that is weak, and it is also the match that nearly published a
 *  wingspan onto the wrong Schleicher. A shared word is EVIDENCE. A shared small number is a
 *  coincidence waiting to be believed. */
export function match(ourName: string, title: string): { strength: Strength; word: boolean; digit: boolean } {
  const ours = tokens(ourName), theirs = tokens(title);

  const word = ours.words.some(w => w.length >= 2
    && theirs.words.some(t => t === w || t.startsWith(w) || w.startsWith(t)));

  const bothNumbered = ours.digits.length > 0 && theirs.digits.length > 0;
  const digit = bothNumbered && ours.digits.some(d => theirs.digits.includes(d));

  if (bothNumbered && !digit) return { strength: 'none', word, digit };
  if (word && digit) return { strength: 'strong', word, digit };
  if (word || digit) return { strength: 'weak', word, digit };
  return { strength: 'none', word, digit };
}

/** Could this article be about this glider at all? */
export function titleMatches(ourName: string, title: string): boolean {
  return titleStrength(ourName, title) !== 'none';
}

const api = async (params: Record<string, string>): Promise<Record<string, unknown>> => {
  const q = new URLSearchParams({ format: 'json', ...params });
  const r = await fetch(`${WP}?${q}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
};

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(v) ? v : null;
};

/** Search Wikipedia, read the aircraft infobox of the best hit, and CHECK it against the wing area
 *  we already hold. Returns the span only when the two gliders are the same glider. */
async function wikipediaSpan(name: string, ourAreaM2: number | null): Promise<number | null> {
  const s = await api({ action: 'query', list: 'search', srsearch: `${name} glider`, srlimit: '3' });
  const hits = ((s.query as { search?: { title: string }[] })?.search ?? []).map(h => h.title);
  for (const title of hits) {
    // A SPAN is a number we will publish. An IDENTIFIER points at an item somebody else can inspect.
    // The first is the graver claim, so this stays strict where link-wikidata now relaxes: a weak
    // title match may earn an identifier if the wing area corroborates it, but a NUMBER is only ever
    // taken from an article whose wing area agrees with ours — see below, and note that we do not
    // shortcut a strong match here.
    if (titleStrength(name, title) === 'none') continue;
    const p = await api({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
      titles: title, redirects: '1',
    });
    const pages = (p.query as { pages?: Record<string, { revisions?: { slots: { main: { '*': string } } }[] }> })?.pages ?? {};
    const page = Object.values(pages)[0];
    const text = page?.revisions?.[0]?.slots?.main?.['*'];
    if (!text) continue;

    const span = num(/\|\s*span\s*m\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
    if (span == null || span < 8 || span > 35) continue;

    // THE SAFEGUARD, and it must actually RUN. An article whose wing area disagrees with ours is a
    // DIFFERENT glider, and its span is a wrong number wearing a right one's authority — but an
    // article with NO wing area used to skip the check ALTOGETHER, which is the same thing with the
    // evidence removed. `Discus A` matched a radio-control model that way.
    //
    // No area, no answer. A source we cannot check is a source we should not use, and that sentence
    // was already written at the top of this file while the code below quietly disagreed with it.
    const theirArea = num(/\|\s*wing\s*area\s*sqm\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
    if (ourAreaM2 == null || theirArea == null) continue;
    if (Math.abs(theirArea - ourAreaM2) > AREA_TOLERANCE_M2) continue;

    return span;
  }
  return null;
}

// ---- the run ----
//
// Guarded by import.meta.main because this module EXPORTS its two decisions (spanFromName,
// titleMatches) and the tests and the Wikidata script import them. Without the guard, importing
// one pure function would silently re-run the whole classifier — 120 calls to a public API, and a
// rewrite of the CSV — as a side effect of asking what an ASK 21 spans.
if (import.meta.main) {

  const lines = (await readFile(CSV, 'utf8')).trim().split(/\r?\n/);
  const head = cells(lines[0]);
  const iName = head.indexOf('name'), iClass = head.indexOf('wing_class'), iArea = head.indexOf('wing_area_m2');
  // A span already established is not re-established: re-running must not hammer a public API for
  // answers we already hold. Delete the column to force a fresh lookup.
  const iSpan = head.indexOf('span_m');
  // The provenance of what is already there — the only thing that decides whether we may keep it.
  const iSrc = head.indexOf('span_source');
  // A column that already exists KEEPS ITS PLACE. Rewriting them at the end made the file's header
  // depend on which script ran last, so the same data had two possible shapes and the declared schema
  // could only match one of them. A dataset must not change shape according to the order it was built.
  const cols = [...head];
  // `model` belongs beside the name it is derived from, not at the far end of the row: a reader who
  // sees `name` must see, in the next cell, what we actually asked the world about.
  if (!cols.includes('model')) cols.splice(cols.indexOf('name') + 1, 0, 'model');
  for (const c of ['span_m', 'span_source', 'fai_class']) if (!cols.includes(c)) cols.push(c);

  let fromName = 0, fromWp = 0, cached = 0, unknown = 0, classed = 0;
  const out = [cols.join(',')];

  for (const line of lines.slice(1)) {
    const r = cells(line);
    const name = r[iName].replace(/^"|"$/g, '');
    // The AIRCRAFT, not the polar file. Every question to the outside world is asked about this.
    const model = modelOf(name);
    const isGlider = r[iClass] === 'glider';
    const area = num(r[iArea]);

    let span: number | null = null;
    // WHERE the number came from. Without it, this row's span cannot be given back to anyone:
    // a span READ off the name is our own reading of a file name, and a span read off an infobox
    // is traceable to a page. They are not the same kind of thing and must not be pooled.
    let source = '';
    if (isGlider) {
      // The NAME is asked FIRST, and it OVERRULES anything already in the column. That order is the
      // fix for a real corruption: while `Ventus B (15m)` was unreadable, the fallback to Wikipedia
      // wrote 17.6 m into this file, and a re-run that trusted its own cache would have preserved it
      // forever. A name that states its span is the strongest source we have and the only free one;
      // it does not defer to a cached guess.
      // ---- the hierarchy of sources, stated once and obeyed everywhere ----
      //
      //   easa  >  name  >  wikipedia  >  nothing
      //
      // A TYPE CERTIFICATE outranks everything, and this script must not touch one. `easa` was absent
      // from the list of sources it trusted, so a classify run following an easa-tcds run judged all
      // 55 certified spans untraceable and OVERWROTE them with Wikipedia's — one tool in the pipeline
      // silently destroying another's work, depending on nothing but the order they were called in.
      // A dataset must not depend on that, and the test for it now runs before this file is written.
      const held = iSrc >= 0 ? (r[iSrc] ?? '') : '';
      const heldSpan = iSpan >= 0 ? num(r[iSpan]) : null;

      if (held === 'easa' && heldSpan != null) { span = heldSpan; cached++; source = 'easa'; }
      else {
        span = spanFromName(name);
        if (span != null) { fromName++; source = 'name'; }
        else if (held === 'wikipedia' && heldSpan != null) {
          // A cached span whose recorded source was the NAME, and whose name no longer yields one,
          // was read under the rule that mistook the ASK 21's model number for a 21-metre wing. It is
          // DISCARDED, not kept: a re-run that preserved it would carry the error forever, and
          // relabelling it `wikipedia` would then have offered it to Wikidata under an authority it
          // never had. Only `wikipedia` and `easa` are re-readable, and only they are believed.
          span = heldSpan; cached++; source = 'wikipedia';
        }
        else {
          try {
            span = await wikipediaSpan(model, area);
            if (span != null) { fromWp++; source = 'wikipedia'; }
            else unknown++;
          } catch {
            // A source that is down is not a reason to guess. The cell stays empty, and the count
            // below says how many times that happened.
            unknown++;
          }
        }
      }
    }
    const cls = isGlider ? classFromSpan(span) : '';
    if (cls) classed++;

    const row = cols.map(c => quote(r[head.indexOf(c)] ?? ''));
    row[cols.indexOf('model')] = quote(model);
    row[cols.indexOf('span_m')] = span == null ? '' : String(span);
    row[cols.indexOf('span_source')] = source;
    row[cols.indexOf('fai_class')] = cls;
    out.push(row.join(','));
  }

  await writeFile(CSV, out.join('\n') + '\n');

  const gliders = fromName + fromWp + cached + unknown;
  console.log(`
  gliders: ${gliders}
    span already established   ${cached}   (kept; the API is not asked twice for the same answer)
    span read off the NAME     ${fromName}
    span from Wikipedia        ${fromWp}   (cross-checked against our own wing area)
    span UNKNOWN, left empty   ${unknown}

    fai_class established      ${classed}
    fai_class LEFT EMPTY       ${gliders - classed}

  The empty class column is the honest half of this result, not a gap for a regular expression to
  fill. A 15 m wing is Standard class without flaps and 15-Metre class with them, and these files
  record the flaps of ten wings out of a hundred and fifty-five. A machine that cannot see the wing
  must not name its class.`);

}
