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
// It does not have to. MOST sections of a TCDS state BOTH the span AND the WING AREA:
//
//        4.  Dimensions:   Span        17,0 m
//                          Wing area   17,95 m²
//
// and we independently hold the wing area, from the polar file. So the area CORROBORATES the match,
// against a number we did not get from the document.
//
// ---- and this paragraph used to say EVERY section, and used to name A.241 as the example ----
//
// EASA.A.241 — the Glasflügel document — states `Wing Span 18 m` and NEVER STATES A WING AREA. Nor
// does EASA.A.250 (Grob: the Astir, the Twin II, the Speed Astir). Nor EASA.A.635 (Phoenix/Phoebus).
// Not once, in any of them. The very certificate this file held up as proof of its method is one the
// method cannot read.
//
// It went unchallenged because nothing ever reached those documents: their TITLES name the firm and
// not the aircraft — `Glasfluegel Sailplanes` shares no word with `604` — so the title matcher never
// offered them, the script said `no certificate`, and the sentence in this header was never put to
// the test. A false claim in a comment and a false claim in the output, each covering for the other.
//
// The manufacturer column opened the door (makerCandidate) and the section HEADINGS get through it:
// EASA cut those documents into sections and wrote the model's name at the top of each one —
// `SECTION I: GLASFLÜGEL 604`. A name the authority printed above the span is not a coincidence of
// numbers; it is the authority saying which aircraft this is. See readHeadedSpans.
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

/** Words that name a KIND OF FIRM, not a firm. `Grob Aircraft` and `Applebay Sailplanes` and
 *  `Rolladen Schneider Flugzeugbau` share nothing but their trade, and a maker match that fired on
 *  `sailplanes` would hand every glider in Europe the whole sailplane shelf. */
const TRADE = new Set([
  'gmbh', 'co', 'kg', 'ag', 'sa', 'uab', 'ltd', 'inc', 'gesellschaft', 'company',
  'aircraft', 'aviation', 'aircrafts', 'industries', 'corporation', 'corp', 'works',
  'flugzeugbau', 'segelflugzeugbau', 'flugzeugtechnik', 'flugzeuge',
  'sailplanes', 'sailplane', 'gliders', 'aviacija', 'aviacja', 'aeronautica',
]);

/** Could this certificate be about an aircraft built by THIS MAKER?
 *
 *  This is the door the `manufacturer` column opened, and it had to be opened. EASA does not put the
 *  model in the title of a family document: `EASA.A.241` is called `Glasfluegel Sailplanes` and the
 *  604, the Standard Libelle, the Club Libelle and the Hornet are all INSIDE it. Our 604 shares not
 *  one word with that title, so tcdsCandidate never offered it, and the script reported `no
 *  certificate` — a claim about the world that was only ever a claim about a regular expression.
 *  Ten of these documents cover a third of the fleet.
 *
 *  The maker's own name is the only thing that reaches them, and we now hold it — borrowed from
 *  Wikidata's P176, on an item a human pinned. */
export function makerCandidate(maker: string, title: string): boolean {
  if (maker.trim() === '') return false;
  // Wikidata spells the firm `Glasflügel`. EASA spells it `Glasfluegel`. Stripping the diaeresis gives
  // `glasflugel` and `glasfluegel` — two strings that never meet, no prefix rule between them, and a
  // door that stayed shut on the 604, the Libelle, the Hornet and the Mosquito while I congratulated
  // myself on having opened it. Fold the German transliteration and they are one word again.
  const fold = (s: string) => tokens(s).words.map(w => w.replace(/ue/g, 'u').replace(/oe/g, 'o'));
  const ours = fold(maker).filter(w => !TRADE.has(w) && w.length >= 3);
  if (ours.length === 0) return false;
  const theirs = fold(title);
  return ours.some(w => theirs.some(t => t === w || t.startsWith(w) || w.startsWith(t)));
}

/** Is this glider's designation actually WRITTEN in this document?
 *
 *  The price of the maker door: inside `Schempp Hirth Ventus sailplanes` the title has told us
 *  nothing about WHICH aircraft, and identification would fall to the wing area alone — in a pool of
 *  every sailplane one firm ever certified. Two Schempp-Hirths sharing a wing area to within a
 *  tolerance is not an identity, it is a coincidence, and this whole file exists because that
 *  distinction was once missed.
 *
 *  So the document must NAME the aircraft: every number in the designation, and one of its words.
 *  `H-201 Std Libelle` needs a `201` and a `libelle`; `604` has no words at all and needs its `604`.
 *  And the area must then agree TO THE CENTIMETRE — see spanForArea. Two independent numbers, both
 *  exact, both from a source that did not know about the other. */
export function namedIn(ourName: string, text: string): boolean {
  const ours = tokens(ourName), theirs = tokens(text);
  if (ours.words.length === 0 && ours.digits.length === 0) return false;
  const words = new Set(theirs.words), digits = new Set(theirs.digits);
  const wordOk = ours.words.length === 0 || ours.words.some(w => words.has(w));
  const digitOk = ours.digits.every(d => digits.has(d));   // EVERY number, not any
  return wordOk && digitOk;
}

/** Is this document a SAILPLANE's type certificate at all? The certification basis says so, and it is
 *  the cheapest possible way to keep the Airbus fleet out of a question about wings that have no
 *  engines.
 *
 *  It knew only the MODERN codes — CS-22 and its ancestor JAR-22 — and so it threw out two documents
 *  EASA itself titles `Sailplanes`:
 *
 *      EASA.A.099   Scheibe sailplanes          certified against LFSM
 *      EASA.A.635   Phoenix / Phoebus Sailplanes   certified against BVS
 *
 *  LFSM (Lufttüchtigkeitsforderungen für Segelflugzeuge und Motorsegler) and BVS (Bauvorschriften für
 *  Segelflugzeuge) are the GERMAN sailplane codes, and they are what a glider certified before JAR-22
 *  existed was built to. The gate was not asking "is this a sailplane" — it was asking "is this a
 *  sailplane certified after 1980", and answering `no certificate exists` for the ones that are not.
 *
 *  Which is backwards: the old wooden and early-glass gliders are exactly the ones Wikipedia
 *  documents worst, and therefore exactly the ones a certificate is worth most for. The Phoebus C has
 *  had a type certificate all along. */
export function isSailplane(text: string): boolean {
  return /\bCS[\s-]?22\b|\bJAR[\s-]?22\b|\bOSTIV\b|\bLFSM\b/i.test(text)
    || /Bauvorschriften\s+f(?:ü|ue)r\s+Segelflugzeuge/i.test(text)
    || /Lufttüchtigkeitsforderungen\s+f(?:ü|ue)r\s+Segelflugzeuge/i.test(text);
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
  /** How many people the certificate says it carries — or null when it does not say. */
  seats: number | null;
  /** True when the certificate publishes a speed per FLAP POSITION: the wing has camber flaps. */
  camberFlaps: boolean;
}

/** THE SEATS, AND WHY THEY ARE HERE AND NOT GUESSED.
 *
 *  The FAI's 20-Metre Two-Seat class is the one competition class whose entry condition our table
 *  could not test, because nothing in it said how many people a glider carries. The certificate does,
 *  in the same prose that describes the wing:
 *
 *        Description:   Single-seater sailplane, T-tail, retractable ...
 *        Beschreibung:  Doppelsitziges Segelflugzeug ...
 *
 *  A count from a certification authority, not from a name. `Duo Discus (PAS)` and `Duo Discus (PIL)`
 *  are our own filenames for one glider flown with and without a passenger; they are a fact about our
 *  polar files, not about the aircraft. */
/** Does OUR OWN FILE NAME say this glider carries a passenger? `Nimbus 4D PAS`, `ASH-25 (PIL)`,
 *  `IS-28B2 Lark with 2 person` — the person who measured the polar recorded a second body in it.
 *
 *  That is not a fact about the aircraft, it is a fact about the flight. But it is enough to KNOW that
 *  the aircraft has two seats, and therefore enough to catch a certificate section that says it has
 *  one. */
export function passengerInName(fileName: string): boolean {
  return /\bPAS\b|\bPIL\b|\b\d+\s*persons?\b/i.test(fileName);
}

/** DOES THIS WING HAVE CAMBER-CHANGING FLAPS?
 *
 *  It is the one fact that separates FAI Standard class from 15-Metre — SC3 6.5.4, "Lift increasing
 *  devices are prohibited, EVEN IF UNUSABLE" — and nothing in this repository recorded it for more
 *  than nine gliders out of a hundred and forty-two.
 *
 *  ---- and the word `flap` is useless ----
 *
 *  The ASW 28 is a Standard-class glider and its certificate calls its AIRBRAKES `Schempp-Hirth
 *  brake-flaps`. The Duo Discus has a `trailing edge flap` connected to the airbrake. The Glasflügel
 *  Mosquito says `flaps combined with the air brake` — and IT has camber flaps. Three sentences, the
 *  same word, three different things. A detector built on `\bflaps?\b` reports what the typesetter
 *  chose, not what the wing does.
 *
 *  ---- what the certificate actually PROVES ----
 *
 *  A flapped glider's Air Speeds section publishes a manoeuvring speed FOR EACH FLAP POSITION:
 *
 *        Manoeuvring Speed  - with flaps at   1, 2      VA = 180 km/h
 *                             bei Wölbklappenstellung
 *
 *  You do not publish a speed per setting unless there are settings. Across every certificate we
 *  hold, `Wölbklappe` and `with flaps at` separate the two populations without a single exception:
 *  zero for the Discus, the ASW 28, the ASK 21 and the Duo Discus; eleven, thirty-seven, twenty-four
 *  and nine for the ASW 27, the Ventus, the Nimbus and the Arcus.
 *
 *  So this is not a keyword search for the word `flap`. It is a search for the ONE PLACE the
 *  certificate is obliged to be unambiguous, because a pilot has to fly by it. */
export function camberFlapsIn(body: string): boolean {
  return /w[oö]lbklappe|camber[\s-]?changing|camberchanging|with\s+flaps?\s+at|flap\s+position/i.test(body);
}

export function seatsIn(prose: string): number | null {
  if (/\b(two|twin|double|dual)[\s-]?seat|doppelsitz|zweisitz/i.test(prose)) return 2;
  if (/\bsingle[\s-]?seat|einsitz/i.test(prose)) return 1;
  return null;
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
  /** Where the previous section demonstrably ended. The window may not reach past it. */
  let prevEnd = 0;

  for (const m of text.matchAll(dims)) {
    const spanM = num(m[1]), areaM2 = num(m[2]);
    if (spanM === null || areaM2 === null) continue;
    if (spanM < 5 || spanM > 40 || areaM2 < 3 || areaM2 > 40) continue;

    // THE PROSE BELONGING TO THIS SECTION, and this line used to LIE.
    //
    // The comment said "back to the previous Dimensions block, or 6000 chars". The code did only the
    // second half, so the window walked backwards straight through the section boundary and into the
    // aircraft before. For the variable-span flag that was merely over-cautious — a stray `18 m span`
    // from the neighbour makes us refuse, and refusing is safe.
    //
    // It stopped being safe the moment this window began ASSERTING something. EASA.A.063 covers the
    // Nimbus 4 (single-seat) and the Nimbus 4D (two-seat), and the 4D's Dimensions block read back
    // into the 4's description and came away with SINGLE-SEATER. A two-seat glider declared a
    // single-seater, on a certification authority's paper, and the 20-Metre Two-Seat class silently
    // withheld from it.
    //
    // The boundary is the previous Dimensions block, because that is where the previous aircraft's
    // section demonstrably ended. Now the code does what the comment always claimed.
    const from = Math.max(prevEnd, m.index - 6000);
    const prose = text.slice(from, m.index);
    const end = m.index + m[0].length;
    prevEnd = end;

    // AND FORWARDS, for the flaps — because the evidence is on the other side of the block.
    //
    // The seats are in the Description, which comes BEFORE the Dimensions. The flap positions are in
    // the Air Speeds table, which comes AFTER it. One section, two windows, and neither may cross
    // into the next aircraft: the boundary going forwards is the next `Description`, because that is
    // where the next aircraft's section demonstrably begins.
    const ahead = text.slice(end, end + 12_000);
    const nextDesc = ahead.search(/\bDescription\b|\bBeschreibung\b/i);
    const after = nextDesc < 0 ? ahead : ahead.slice(0, nextDesc);
    const spoken = [...prose.matchAll(new RegExp(String.raw`${N}\s*m\s*(?:span|Spannweite)`, 'gi'))]
      .map(x => num(x[1]))
      .filter((x): x is number => x !== null && x >= 5 && x <= 40);

    const variableSpan = spoken.some(s => Math.abs(s - spanM) > 0.05);
    out.push({ spanM, areaM2, variableSpan, seats: seatsIn(prose), camberFlaps: camberFlapsIn(prose + after) });
  }
  return out;
}

// ---- when the certificate states NO wing area at all ----
//
// The header of this file says EASA.A.241, the Glasflügel document, is the example of a family
// certificate the wing area lets you navigate. THAT WAS FALSE, and it went unchecked for as long as
// the area path never reached the document. A.241 states `Wing Span 18 m` and NEVER STATES A WING
// AREA. Neither does EASA.A.250 (Grob: the Astir, the Twin II, the Speed Astir), nor EASA.A.635
// (Phoenix/Phoebus). Not once, in any of them.
//
// So for a third of the pre-1980 fleet the corroboration this script is built on does not exist.
//
// But these documents identify their aircraft ANOTHER way, and it is a better way: they are cut into
// sections, and EASA wrote the model's name at the top of each one.
//
//        SECTION I:   GLASFLÜGEL 604
//        SECTION K:   GROB G 103 "TWIN II"
//        SECTION E:   STANDARD LIBELLE
//
// A name EASA itself printed above the span is not a coincidence of numbers — it is the authority
// SAYING which aircraft this is. It is stronger evidence than the area check, not weaker. What made
// name-matching dangerous everywhere else in this script was matching against a TITLE, in a pool of
// every certificate in Europe. Inside a document, against a heading, in a pool of one firm's
// sailplanes, it is simply reading.
//
// It stays the LAST resort all the same, used only where no wing area exists to be asked, because a
// number is checkable and a name is a judgement.

export interface Headed { header: string; spanM: number; variableSpan: boolean; seats: number | null; camberFlaps: boolean }

/** Every (section heading, span) this document states.
 *
 *  Three kinds of line say `SECTION`, and only one of them is a heading:
 *    - the TABLE OF CONTENTS       `SECTION I: GLASFLÜGEL 604 .......... 42`     — dotted leaders
 *    - the RUNNING PAGE HEADER     `Issue 04, 21 December 2011  SECTION K: GROB G 103`  — TRUNCATED
 *    - the heading itself          `SECTION K:   GROB G 103 "TWIN II"`
 *
 *  The running header is the trap, and it is a quiet one: it drops the distinguishing part of the
 *  name. `GROB G 103` alone matches our Twin II — and matches the Twin II ACRO, and the Twin III,
 *  every one of them, because what tells them apart is exactly what the truncation threw away. */
export function readHeadedSpans(text: string): Headed[] {
  const heads: { at: number; title: string }[] = [];
  for (const m of text.matchAll(/^[ \t]*SECTION\s+([A-Z]{1,2})\s*:[ \t]*(.+)$/gm)) {
    const line = m[0];
    if (/\.{3,}/.test(line)) continue;                       // the table of contents
    if (/\bIssue\b|\d{4}\s*$/.test(line.slice(0, line.indexOf('SECTION')))) continue;  // the running header
    const title = m[2].replace(/\bMODEL\s+\d+\b/i, ' ').replace(/["“”]/g, ' ').trim();
    if (title !== '') heads.push({ at: m.index, title });
  }
  if (heads.length === 0) return [];

  const out: Headed[] = [];
  const spans = new RegExp(String.raw`(?:Wing\s+)?Span\s*:?\s+${N}\s*m\b`, 'gi');
  for (const m of text.matchAll(spans)) {
    const spanM = num(m[1]);
    if (spanM === null || spanM < 5 || spanM > 40) continue;

    // The heading this span sits under: the last one printed before it. The table of contents comes
    // before every body heading, so it is superseded automatically.
    let head: { at: number; title: string } | null = null;
    for (const h of heads) { if (h.at < m.index) head = h; else break; }
    if (head === null) continue;                             // a span before the first heading: not a section's

    // The trap, unchanged: prose offering a span the Dimensions field does not state.
    const prose = text.slice(head.at, m.index);
    const spoken = [...prose.matchAll(new RegExp(String.raw`${N}\s*m\s*(?:span|Spannweite)`, 'gi'))]
      .map(x => num(x[1]))
      .filter((x): x is number => x !== null && x >= 5 && x <= 40);
    // Forwards for the flaps, backwards for the seats, and neither crosses into the next aircraft.
    const ahead = text.slice(m.index + m[0].length, m.index + m[0].length + 12_000);
    const nextDesc = ahead.search(/\bDescription\b|\bBeschreibung\b/i);
    const after = nextDesc < 0 ? ahead : ahead.slice(0, nextDesc);
    out.push({
      header: head.title, spanM, seats: seatsIn(prose), camberFlaps: camberFlapsIn(prose + after),
      variableSpan: spoken.some(s => Math.abs(s - spanM) > 0.05),
    });
  }
  return out;
}

/** Tokens for comparing a DESIGNATION with a DESIGNATION — not a designation with a document.
 *
 *  Three things the document-wide tokeniser gets away with and this one cannot:
 *
 *  1. `Glasfluegel` and `GLASFLÜGEL` are the same word. Stripping the diaeresis gives `glasflugel`
 *     and `glasfluegel`, which are not equal, so the folded German spelling is folded back.
 *  2. `Std` and `STANDARD` are the same word, and no prefix rule reaches it: `standard` does not
 *     begin with `std`.
 *  3. A single letter is sometimes the whole difference between two aircraft and sometimes noise,
 *     and WHICH depends on whether it is glued to a number:
 *
 *         H-206 Hornet    the `H` is part of the designation `H-206`; the number carries it
 *         Phoebus C       the `C` IS the aircraft — the A and B are 15 m and the C is 17 m
 *
 *     So a letter standing in front of a number goes (the number keeps the identity), and a letter
 *     standing alone stays. Drop them all and the Phoebus C becomes the Phoebus A. Keep them all and
 *     the Hornet, whose EASA section is titled simply `HORNET`, is never found.
 *
 *  And no prefix matching at all. `ii` is a prefix of `iii`, and the Twin II is not the Twin III. */
const designation = (s: string): { words: Set<string>; digits: Set<string> } => {
  const flat = s
    .replace(/\b([A-Za-z])[-\s]?(?=\d)/g, '')                  // the letter glued to a number
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ue/g, 'u').replace(/oe/g, 'o')                   // glasfluegel = glasflügel
    .replace(/\bstd\b/g, 'standard');
  const parts = flat.match(/[a-z]+|\d+/g) ?? [];
  return {
    words: new Set(parts.filter(p => /[a-z]/.test(p))),
    digits: new Set(parts.filter(p => /\d/.test(p))),
  };
};

/** Does this section heading name OUR aircraft?
 *
 *  Every word of our designation must be in it, and the numbers must not CONTRADICT. A heading with
 *  no number at all does not contradict ours — `HORNET` is the H-206 — but a heading with a
 *  DIFFERENT number does: `STANDARD LIBELLE 203` is not the 201.
 *
 *  And a designation that is nothing but a number — the Glasflügel `604` — has no words to be
 *  identified by, so for it the numbers must match EXACTLY. Without that clause it would match
 *  `KESTREL`, which has no words of ours to miss and no digits to contradict, and take home 17 m. */
export function headerNames(ourName: string, header: string): boolean {
  const ours = designation(ourName), theirs = designation(header);
  if (ours.words.size === 0) {
    return ours.digits.size > 0 && ours.digits.size === theirs.digits.size
      && [...ours.digits].every(d => theirs.digits.has(d));
  }
  if (![...ours.words].every(w => theirs.words.has(w))) return false;
  if (ours.digits.size === 0 || theirs.digits.size === 0) return true;
  return ours.digits.size === theirs.digits.size && [...ours.digits].every(d => theirs.digits.has(d));
}

/** The span the section EASA titled with OUR aircraft's name states. Several sections may name it —
 *  a running-header artefact, or a genuine sub-variant — and then they must AGREE. */
export function spanForHeader(
  headed: Headed[], ourName: string,
): { spanM: number; header: string; seats: number | null; camberFlaps: boolean } | { refused: 'no-section' | 'variable-span' | 'conflict' } {
  const hits = headed.filter(h => headerNames(ourName, h.header));
  if (hits.length === 0) return { refused: 'no-section' };
  if (hits.some(h => h.variableSpan)) return { refused: 'variable-span' };
  const spans = new Set(hits.map(h => h.spanM));
  if (spans.size > 1) return { refused: 'conflict' };
  const seats = new Set(hits.map(h => h.seats).filter((x): x is number => x !== null));
  return {
    spanM: hits[0].spanM, header: hits[0].header,
    seats: seats.size === 1 ? [...seats][0] : null,
    camberFlaps: hits.some(h => h.camberFlaps),
  };
}

/** The span this certificate states for the glider whose wing area is ours — or null, with a reason.
 *
 *  Identification is by AREA, not by name: the area is in the document and it is also in our polar,
 *  and the two came from different places. If several sections match the area they must AGREE on the
 *  span; if they do not, the document is describing more than one aircraft that looks like ours and
 *  we are not the ones to choose. */
export function spanForArea(
  sections: Section[], ourAreaM2: number, exactOnly = false,
): { spanM: number; seats: number | null; camberFlaps: boolean } | { refused: 'no-section' | 'variable-span' | 'conflict' } {
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
  //
  // And when the TITLE never named the aircraft — the maker path, `Glasfluegel Sailplanes` — the
  // forgiving window is not offered AT ALL. There, the area is not corroborating a match somebody
  // else made; it IS the match, inside a pool of every sailplane one firm ever built, and a
  // tolerance is exactly how you pick the wrong one. That lesson is a day old: our Apis 2 sat
  // 0.16 m² from the Pipistrel Apis-Bee, comfortably inside the Wikipedia matcher's window, and it
  // is a DIFFERENT AIRCRAFT. A tolerance that accepts a near-miss will accept the wrong aircraft on
  // the day the right one exists.
  const exact = sections.filter(s => Math.abs(s.areaM2 - ourAreaM2) <= AREA_EXACT_M2);
  const hits = exact.length > 0
    ? exact
    : exactOnly
      ? []
      : sections.filter(s => Math.abs(s.areaM2 - ourAreaM2) <= AREA_TOLERANCE_M2);
  if (hits.length === 0) return { refused: 'no-section' };

  // THE TRAP. An aircraft certified at 15 m that flies at 18 m: its certificate says 15, and the
  // certificate is right — about a question that is not ours.
  if (hits.some(s => s.variableSpan)) return { refused: 'variable-span' };

  const spans = new Set(hits.map(s => s.spanM));
  if (spans.size > 1) return { refused: 'conflict' };
  // The seats must agree too, and where they do not the document is describing more than one
  // aircraft. Silence is not disagreement: a section that says nothing about seats says nothing.
  const seats = new Set(hits.map(s => s.seats).filter((x): x is number => x !== null));
  return {
    spanM: hits[0].spanM,
    seats: seats.size === 1 ? [...seats][0] : null,
    camberFlaps: hits.some(s => s.camberFlaps),
  };
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
  // A column that already exists KEEPS ITS PLACE (see link-wikidata: appending afresh made the file's
  // header depend on the order the scripts ran in). A NEW column is born where it belongs — `seats` is
  // an aircraft fact and sits with them, not tacked on after the certificate's URL.
  for (const c of ['seats', 'seats_source', 'camber_flaps', 'camber_flaps_source']) {
    if (!cols.includes(c)) {
      const before = cols.indexOf('easa_tcds');
      cols.splice(before < 0 ? cols.length : before, 0, c);
    }
  }
  // fai_class is GONE, and it is gone from here rather than merely stopped being written: a column
  // nobody fills is a column somebody will read. The FAI's classes are ENTRY CONDITIONS, not
  // attributes — see the README — so the derivation belongs to whoever is entering a competition,
  // and the facts it needs (span, seats, camber flaps) belong here. soaring-core::faiClass does the
  // deriving now, from these three columns, where a caller can see the rule and disagree with it.
  const dropped = cols.indexOf('fai_class');
  if (dropped >= 0) cols.splice(dropped, 1);
  for (const c of ['easa_tcds', 'easa_url']) if (!cols.includes(c)) cols.push(c);
  const out = [cols.join(',')];

  let upgraded = 0, agreed = 0, corrected = 0, noArea = 0, noCert = 0, notASailplane = 0, notNamed = 0;
  let viaTitle = 0, viaMakerN = 0, seated = 0, flapped = 0;
  const flapConflict: string[] = [];
  const refusals: Record<string, number> = { 'no-section': 0, 'variable-span': 0, conflict: 0, seats: 0 };
  const refusedSeats: string[] = [];
  const revoked: string[] = [];
  const certNoArea = new Set<string>();
  const headDisagreed: string[] = [];
  let viaHeader = 0;
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
    let spanM: number | null = null, seats: number | null = null, tcds = '', url = '';
    let camber: boolean | null = null;

    if (at(r, 'wing_class') !== 'glider') {
      // A paraglider has no type certificate. Not a failure — a category error, and silent.
    } else {
      // A row with NO WING AREA used to stop here, and the reason was sound while the area was the
      // only way to identify a glider inside a family document. It is not any more: a section EASA
      // titled `SPEED ASTIR II` names the aircraft without our help. So the row goes on — it simply
      // cannot use the area path, and the heading path is all it has.
      if (ourArea === null) noArea++;
      // TWO PASSES, and the second is stricter than the first.
      //
      //   1. the TITLE names the aircraft   — `Schleicher ASW 27`. The area then CORROBORATES a
      //      match the title already made, and may forgive a rounding (0.35 m²).
      //   2. only the MAKER matches          — `Glasfluegel Sailplanes`. The title has said nothing
      //      about which aircraft, so the document must NAME it (namedIn) and the area must agree
      //      TO THE CENTIMETRE. Nothing is forgiven, because there is nothing corroborating.
      //
      // Pass 2 runs only where pass 1 found nothing, so every span already certified stays exactly
      // as it was: this can add, it cannot rewrite.
      const maker = (at(r, 'manufacturer') ?? '').replace(/^"|"$/g, '').trim();
      const byTitle = index.filter(t => tcdsCandidate(name, t.title));
      const byMaker = index.filter(t => makerCandidate(maker, t.title) && !byTitle.includes(t));
      let found = false;
      // What the glider's own name says about its span, if anything. It is the last word here.
      const named = spanFromName(fileName);
      for (const c of [...byTitle, ...byMaker]) {
        const viaMaker = !byTitle.includes(c);
        const text = await tcdsText(c);
        if (text === null) continue;
        // Not a glider's certificate: not an answer to this question, whatever numbers it holds.
        if (!isSailplane(text)) { notASailplane++; continue; }
        // The maker path's first gate: does this document mention our aircraft at all?
        if (viaMaker && !namedIn(name, text)) { notNamed++; continue; }

        const sections = readSections(text);

        // ---- the document that states NO WING AREA: read the heading instead ----
        //
        // EASA.A.250 (Grob), EASA.A.241 (Glasflügel) and EASA.A.635 (Phoenix/Phoebus) state a span
        // and NEVER STATE A WING AREA. Not once. The corroboration this whole script rests on does
        // not exist in them — and the header of this very file cites A.241 as the example of a
        // document the area lets you navigate, which was simply false and went unchecked for as long
        // as nothing reached it.
        //
        // They identify their aircraft another way, and a better one: EASA cut them into sections and
        // wrote the model's name at the top of each. `SECTION I: GLASFLÜGEL 604`. That is not a
        // coincidence of numbers — it is the authority saying which aircraft this is.
        //
        // The result must still agree with what we already hold. Two sources that arrived by
        // different roads and land on the same number is the strongest thing this repository can
        // build; two that disagree is a question for a human, not a value for a cell.
        if (sections.length === 0 && !/wing\s*area/i.test(text)) {
          const h = spanForHeader(readHeadedSpans(text), name);
          if ('refused' in h) { refusals[h.refused]++; continue; }
          if (hadSpan !== null && Math.abs(hadSpan - h.spanM) > 0.05) {
            headDisagreed.push(`${name} — ${c.id} § ${h.header} says ${h.spanM} m, we hold ${hadSpan} m`);
            continue;
          }
          if (named !== null && Math.abs(named - h.spanM) > 0.05) {
            refusals['variable-span']++;
            refusedVariable.push(`${name} — ${c.id} says ${h.spanM} m, the name says ${named} m`);
            continue;
          }
          spanM = h.spanM; seats = h.seats; camber = h.camberFlaps; tcds = c.id; url = c.pdf; found = true; viaHeader++;
          break;
        }

        // The certificate exists, it names the glider, and it can still not answer: it has a wing
        // area SOMEWHERE but none in a Dimensions block we can read. That is not `no certificate`.
        if (sections.length === 0) { certNoArea.add(`${name} — ${c.id}`); continue; }
        if (ourArea === null) continue;   // the area path, and we have no area to bring to it

        const verdict = spanForArea(sections, ourArea, viaMaker);
        // THE SEATS CAUGHT A WRONG SECTION, which is what a second independent number is FOR.
        //
        // EASA.A.063 holds the Nimbus 4 at 26.4 m / 17.80 m² (SINGLE-SEAT) and the Nimbus 4D at
        // 26.5 m / 17.96 m² (TWO-SEAT). Our `Nimbus 4D PAS` row carries a wing area of 17.80 — the
        // SINGLE-SEATER's — so the area, which is the only thing identifying it, put a two-seat
        // glider on a one-seat aircraft's section and took home its span.
        //
        // Nothing caught it, because nothing else in the row disagreed. The seats do: `PAS` means
        // our own polar was flown with a passenger in it. A row whose name says two bodies may not be
        // matched to a section that says one seat, and this is the same rule as `the row may not
        // contradict the span its own name states` — a second number, and a second door.
        if (!('refused' in verdict) && verdict.seats === 1 && passengerInName(fileName)) {
          refusals['seats']++;
          refusedSeats.push(`${fileName} — ${c.id} says SINGLE-SEAT, and our own polar was flown with a passenger`);
          continue;
        }
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
        spanM = verdict.spanM; seats = verdict.seats; camber = verdict.camberFlaps; tcds = c.id; url = c.pdf; found = true;
        if (viaMaker) viaMakerN++; else viaTitle++;
        break;
      }
      if (!found) {
        noCert++;
        // AND A REFUSAL MUST UNDO WHAT AN EARLIER RUN OF THIS SCRIPT WROTE.
        //
        // The comment further down says it plainly — "a script that is not idempotent against its OWN
        // bad output will launder its own mistakes forever" — and then this script did exactly that.
        // The four Nimbus 4D rows were given a span by a run that matched them to the SINGLE-SEAT
        // Nimbus 4's section. This run, with the seats to check against, refuses them. And they kept
        // the old span, still labelled `easa`, beside an empty easa_tcds: a certified number with no
        // certificate, laundered by the very refusal that was supposed to remove it.
        //
        // A span this script can no longer justify is a span this script must take back.
        if (at(r, 'span_source') === 'easa') {
          revoked.push(`${fileName} — held ${at(r, 'span_m')} m as CERTIFIED, and no certificate now stands behind it`);
          r[head.indexOf('span_m')] = '';
          r[head.indexOf('span_source')] = '';
        }
      }
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
    // The seats, and the class the seats unlock. A row keeps a seat count it already had: only the
    // certificate writes this column, and only a certificate can overturn it.
    if (seats !== null) {
      row[cols.indexOf('seats')] = String(seats);
      row[cols.indexOf('seats_source')] = 'easa';
      seated++;
    }
    if (camber !== null) {
      // THE POLAR MAY NOT CONTRADICT THE CERTIFICATE. A polar file carrying a table of flap settings
      // is a MEASUREMENT of a flapped wing — somebody flew it at each setting and wrote the speeds
      // down. If the certificate says that wing has no camber flaps, one of the two is about a
      // different aircraft, and neither of them is ours to overrule.
      const polarHasFlaps = (num(at(r, 'flaps_count')) ?? 0) >= 2;
      if (polarHasFlaps && !camber) {
        flapConflict.push(`${fileName} — ${tcds} publishes no speed per flap position, and our polar has ${at(r, 'flaps_count')} flap settings`);
      } else {
        row[cols.indexOf('camber_flaps')] = camber ? 'true' : 'false';
        row[cols.indexOf('camber_flaps_source')] = 'easa';
        flapped++;
      }
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
  the TITLE named the aircraft   ${viaTitle}   (area corroborates, 0.35 m² forgiven)
  only the MAKER matched         ${viaMakerN}   ← the family documents, reached by manufacturer
  SEATS, from the certificate    ${seated}   ← the 20-Metre Two-Seat class needs them, and nothing else had them
  CAMBER FLAPS, certified        ${flapped}   ← a speed published per flap position: there are flap positions
  the SECTION HEADING named it   ${viaHeader}   ← the certificate states no wing area; EASA titled the section
  it agreed with what we held    ${agreed}   (Wikipedia was right, and now it is also sourced)
  it CORRECTED what we held      ${corrected}
  no certificate matched         ${noCert}
  maker's doc, aircraft unnamed  ${notNamed}   ← it is his firm's, it is not his aircraft
  no wing area in OUR polar      ${noArea}
  the CERTIFICATE states no area ${certNoArea.size}   ← it exists, it names the glider, it cannot answer
  candidate was not a sailplane  ${notASailplane}   ← an airliner is not an answer about a wing

refused, and kept as they were:
  no section with our wing area  ${refusals['no-section']}
  VARIABLE SPAN                  ${refusals['variable-span']}   ← the certificate says one span, the aircraft flies another
  sections disagree              ${refusals['conflict']}
  SINGLE-SEAT, and ours flew two ${refusals['seats']}   ← the area matched the wrong aircraft, and the seats said so
`);

  if (changes.length > 0) {
    console.log('the certificate disagreed with Wikipedia, and the certificate wins:');
    for (const c of changes) console.log(c);
    console.log('');
  }
  if (flapConflict.length > 0) {
    console.log(`OUR POLAR AND THE CERTIFICATE DISAGREE ABOUT THE WING. A polar with a table of flap settings is
a measurement of a flapped wing — somebody flew it at each setting. Left empty, for a human:`);
    for (const c of flapConflict) console.log(`  ${c}`);
    console.log('');
  }
  if (revoked.length > 0) {
    console.log(`REVOKED — an earlier run of THIS script wrote these, and this run cannot justify them. A
refusal that leaves the old value in place launders the mistake it was meant to remove. Run
\`just classify-gliders\` to let Wikipedia answer for them again:`);
    for (const c of revoked) console.log(`  ${c}`);
    console.log('');
  }
  if (refusedSeats.length > 0) {
    console.log(`the certificate's section says SINGLE-SEAT and our own polar carried a passenger. The wing
area put us on the wrong aircraft — an independent number caught it, which is what it is for:`);
    for (const c of refusedSeats) console.log(`  ${c}`);
    console.log('');
  }
  if (headDisagreed.length > 0) {
    console.log(`THE SECTION HEADING AND WHAT WE HOLD DISAGREE. Two sources, two roads, two numbers — and
nothing here is entitled to pick. Left exactly as they were, for a human:`);
    for (const c of headDisagreed) console.log(`  ${c}`);
    console.log('');
  }
  if (certNoArea.size > 0) {
    console.log(`the certificate exists and NAMES the glider — and states no wing area, so there is nothing
to prove WHICH aircraft its Dimensions block describes. Span not taken, and this is not "no certificate":`);
    for (const c of [...certNoArea]) console.log(`  ${c}`);
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
