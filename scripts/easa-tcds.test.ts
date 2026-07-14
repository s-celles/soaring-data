// ============ reading a type certificate, and refusing to ============
//
// Every test below is a mistake this script actually made, on real documents, and shipped into
// polars.csv before it was caught by reading the output. They are written as the record of that.

import { test, expect } from 'bun:test';
import {
  headerNames, isSailplane, makerCandidate, readHeadedSpans, readSections, spanForArea, spanForHeader, tcdsCandidate,
} from './easa-tcds';

// ---- which certificates could possibly be this glider's ----

test('a shared NUMBER is not a shared aircraft — the Airbus A400M is not a DG-400', () => {
  // The first version reused the classifier's title matcher, which knows only about digits. Against
  // a catalogue holding every type certificate EASA has ever issued, it offered `DG-400 (17m)` the
  // de Havilland Dash-6 Series 400, the Airbus A400M, and an engine. One of those then passed the
  // wing-area check by coincidence, and `Discus 2c 18m → 9.87 m` went into the dataset.
  expect(tcdsCandidate('DG-400 (17m)', 'Airbus A400M')).toBe(false);
  expect(tcdsCandidate('DG-400 (17m)', 'DHC-6 Series 400')).toBe(false);
  expect(tcdsCandidate('DG-400 (17m)', 'DG single seaters')).toBe(true);
});

test('the 17 of LAK-17 is a MODEL number; the 17 of DG-400 (17m) is a SPAN', () => {
  // The ASK-21 trap in a new coat. Both names carry 17; they are not the same 17, and only a WORD
  // can tell them apart.
  expect(tcdsCandidate('DG-400 (17m)', 'Sportine Aviacija - LAK-17')).toBe(false);
  expect(tcdsCandidate('Lak17A-15', 'Sportine Aviacija - LAK-17')).toBe(true);
});

test('the number still rules out the wrong sibling', () => {
  // `ASK-13` was matched to EASA.A.024 — the L-13 Blaník — on the strength of a shared 13, and the
  // Blaník's certificate was used to "correct" a Schleicher.
  expect(tcdsCandidate('ASK-13', 'L-13 Blanik')).toBe(false);
  expect(tcdsCandidate('Blanik L13', 'L-13 Blanik')).toBe(true);
  expect(tcdsCandidate('ASK-13', 'Schleicher ASK 21')).toBe(false);
  expect(tcdsCandidate('ASK-21', 'Schleicher ASK 21')).toBe(true);
});

test('a name with no number leans on its word alone', () => {
  expect(tcdsCandidate('Std Cirrus', 'Schempp-Hirth Standard Cirrus')).toBe(true);
  expect(tcdsCandidate('Carat', 'AMS Flight Carat')).toBe(true);
});

// ---- and the document must be about a glider at all ----

test('a jet named Cirrus is not a Standard Cirrus', () => {
  // `Std Cirrus` still draws the Cirrus SF50 (a business jet) and a Bell 214 helicopter out of the
  // catalogue on the word `cirrus`. The certification basis is what settles it: CS-22 and its
  // ancestor JAR-22 are the sailplane codes, and nothing else is an answer about a wing.
  expect(isSailplane('Certification Basis: CS-22 Amendment 2')).toBe(true);
  expect(isSailplane('Certification Basis: JAR-22 Change 5')).toBe(true);
  expect(isSailplane('Certification Basis: CS-25 Amendment 12')).toBe(false);
  expect(isSailplane('Certification Basis: CS-23, CS-VLA')).toBe(false);
});

// ---- reading the Dimensions block ----

// The ASK 21's, verbatim in layout, with the German gloss lines EASA prints under each field.
const ASK21 = `
      4.  Dimensions:            Span                    17,0 m
          Abmessungen:           Spannweite
                                 Wing area               17,95 m²
                                 Length                  8,35 m
`;

// The LS8's, which puts Length and Height BETWEEN Span and Wing area — and, at ~110 characters of
// layout whitespace per line, 600 characters of nothing in between. A 400-character window read the
// ASK 21 and silently found NOTHING here: not a wrong answer, an ABSENT one, indistinguishable from
// a glider EASA never certified. That is the failure mode that matters.
const LS8 = `
      4.  Dimensions:            Span                    15.00 m
          Abmessungen            (Spannweite)
                                 Length                  6.66 m
                                 (Länge)
                                 Height                  1.33 m
                                 (Höhe)
                                 Wing Area               10.50 m²
`;

test('the Dimensions block reads whatever order the fields come in', () => {
  expect(readSections(ASK21)).toEqual([{ spanM: 17, areaM2: 17.95, variableSpan: false }]);
  expect(readSections(LS8)).toEqual([{ spanM: 15, areaM2: 10.5, variableSpan: false }]);
});

test('THE TRAP: prose that offers a span the Dimensions field does not state', () => {
  // EASA.A.047 section B — the LS8-18:
  //   Description:  ... optionally 18 m span with winglets or 15 m span with winglets.
  //   Dimensions:   Span   15.00 m
  // An eighteen-metre glider whose certificate says fifteen. Reading the Dimensions field alone
  // publishes a WRONG number wearing the strongest seal available, which is worse than the same
  // wrong number wearing none.
  const ls8_18 = `
      2.  Description:  Single-seat sailplane, water ballast tanks, optionally 18 m span with
                        winglets or 15 m span with winglets.
      4.  Dimensions:   Span         15.00 m
                        Wing Area    10.50 m²
  `;
  const [s] = readSections(ls8_18);
  expect(s.variableSpan).toBe(true);
  expect(spanForArea([s], 10.5)).toEqual({ refused: 'variable-span' });
});

// ---- the verdict ----

test('the wing area picks our aircraft out of a family document', () => {
  const sections = [
    { spanM: 15, areaM2: 10.5, variableSpan: false },
    { spanM: 18, areaM2: 11.45, variableSpan: false },
  ];
  expect(spanForArea(sections, 11.45)).toEqual({ spanM: 18 });
  expect(spanForArea(sections, 10.5)).toEqual({ spanM: 15 });
});

test('an area the document never states is not our aircraft', () => {
  expect(spanForArea([{ spanM: 15, areaM2: 10.5, variableSpan: false }], 16.4))
    .toEqual({ refused: 'no-section' });
});

test('two sections with our area and different spans: not ours to choose', () => {
  const sections = [
    { spanM: 15, areaM2: 10.5, variableSpan: false },
    { spanM: 18, areaM2: 10.5, variableSpan: false },
  ];
  expect(spanForArea(sections, 10.5)).toEqual({ refused: 'conflict' });
});

test('nonsense numbers are not dimensions', () => {
  // A 90 m span or a 0.4 m² wing is a page number, a paragraph reference, or a misread — not a
  // sailplane.
  expect(readSections('Span 90 m ... Wing area 0.4 m²')).toEqual([]);
});

// ============ the maker door, and the three locks on it ============
//
// Everything below exists because the script reported `no certificate` for a third of the fleet, and
// that sentence was not a fact about the world. It was a fact about a regular expression.

test('the maker reaches the FAMILY documents, whose titles never name the aircraft', () => {
  // EASA.A.241 is called `Glasfluegel Sailplanes`. Our 604 shares not one word with that, so the
  // title matcher never offered it, and the certificate sat there unread.
  expect(makerCandidate('Glasflügel', 'Glasfluegel Sailplanes')).toBe(true);
  expect(makerCandidate('Grob Aircraft', 'Grob Sailplanes')).toBe(true);
  expect(tcdsCandidate('604', 'Glasfluegel Sailplanes')).toBe(false);   // the door that was shut
});

test('WIKIDATA SPELLS IT Glasflügel AND EASA SPELLS IT Glasfluegel', () => {
  // Strip the diaeresis and you get `glasflugel`; EASA writes `glasfluegel`. Two strings that never
  // meet, no prefix between them — and the door I had just congratulated myself on opening stayed
  // shut on the 604, the Libelle, the Hornet and the Mosquito.
  expect(makerCandidate('Glasflügel', 'Glasfluegel Sailplanes')).toBe(true);
});

test('a maker match is his FIRM, not his aircraft: `sailplanes` is a trade, not a name', () => {
  // Fire on the word `sailplanes` and every glider in Europe is handed the whole sailplane shelf.
  expect(makerCandidate('Applebay Sailplanes', 'Grob Sailplanes')).toBe(false);
  expect(makerCandidate('Grob Aircraft', 'Diamond Aircraft')).toBe(false);
});

test('the OLD codes are sailplane codes too — BVS and LFSM predate JAR-22', () => {
  // The gate knew CS-22 and JAR-22 and threw out two documents EASA itself titles `Sailplanes`:
  // A.099 (Scheibe, LFSM) and A.635 (Phoenix/Phoebus, BVS). It was not asking `is this a sailplane`
  // but `is this a sailplane certified after 1980`, and answering `no certificate exists` for the
  // rest — which are exactly the aircraft Wikipedia documents worst.
  expect(isSailplane('Airworthiness Requirements: Bauvorschriften für Segelflugzeuge (BVS)')).toBe(true);
  expect(isSailplane('Certification Basis: LFSM, Issue 1975')).toBe(true);
  expect(isSailplane('Certification Basis: CS-25 Large Aeroplanes')).toBe(false);
});

// ---- the certificate that states no wing area at all ----

const A250 = `
SECTION A: MODEL 1 ASTIR CS ....................................... 5
SECTION P: SPEED ASTIR II ......................................... 90
Issue 04, 21 December 2011                SECTION A: ASTIR CS
SECTION A:                      MODEL 1       ASTIR CS
4. Dimensions:                         Span:                   15,00 m
Issue 04, 21 December 2011                SECTION I: TWIN ASTIR
SECTION I:                           MODEL 2             TWIN ASTIR
4. Dimensions:                         Span:                   17,50 m
Issue 04, 21 December 2011              SECTION P: SPEED ASTIR II
SECTION P:                      MODEL 4            SPEED ASTIR II
4. Dimensions:                         Span:                   15,00 m
`;

test('a document with a span and NO WING AREA is read by its section HEADINGS', () => {
  // A.250 (Grob), A.241 (Glasflügel) and A.635 (Phoenix/Phoebus) state a span and never once state a
  // wing area. The header of easa-tcds.ts cites A.241 as the very example of a document the area lets
  // you navigate. That was false, and it went unchecked for as long as nothing reached the document.
  const h = readHeadedSpans(A250);
  expect(h.map(x => [x.header, x.spanM])).toEqual([
    ['ASTIR CS', 15], ['TWIN ASTIR', 17.5], ['SPEED ASTIR II', 15],
  ]);
});

test('the TABLE OF CONTENTS and the RUNNING PAGE HEADER are not headings', () => {
  // The running header is the quiet one. It TRUNCATES: `SECTION K: GROB G 103` drops the `TWIN II`
  // that is the only thing telling it from the Twin II Acro, the Twin III and the Twin III Acro.
  expect(readHeadedSpans(A250).map(x => x.header)).not.toContain('ASTIR CS ....................................... 5');
  expect(readHeadedSpans(A250).length).toBe(3);      // 3 headings, not 3 + 2 contents + 3 running
});

test('`Astir CS` must not walk off with the TWIN ASTIR', () => {
  // Match on ANY shared word and `astir` hands it the Twin Astir, at 17.5 m. Every word must land.
  expect(spanForHeader(readHeadedSpans(A250), 'Astir CS')).toEqual({ spanM: 15, header: 'ASTIR CS' });
});

test('THE PHOEBUS C IS 17 m AND THE PHOEBUS A AND B ARE 15 — the single letter IS the aircraft', () => {
  const a635 = `
SECTION D: PHOEBUS A1
               Span: 15 m
SECTION F: PHOEBUS B1
               Span: 15 m
SECTION G: PHOEBUS C
               Span: 17 m
`;
  expect(spanForHeader(readHeadedSpans(a635), 'Phoebus C')).toEqual({ spanM: 17, header: 'PHOEBUS C' });
});

test('and yet the `H` of `H-206 Hornet` is NOISE, because EASA titles that section simply `HORNET`', () => {
  // So a letter cannot simply be kept, and cannot simply be dropped. A letter GLUED TO A NUMBER is
  // part of the designation and the number carries it; a letter STANDING ALONE is the aircraft.
  // Drop them all and the Phoebus C becomes the Phoebus A. Keep them all and the Hornet is never
  // found. This is the whole rule, and both halves of it are load-bearing.
  expect(headerNames('H-206 Hornet', 'HORNET')).toBe(true);
  expect(headerNames('Phoebus C', 'PHOEBUS A1')).toBe(false);
});

test('`Std` is `STANDARD`, and 201 is not 203', () => {
  expect(headerNames('H-201 Std Libelle', 'STANDARD LIBELLE 201 B')).toBe(true);
  expect(headerNames('H-201 Std Libelle', 'STANDARD LIBELLE 203')).toBe(false);
});

test('TWIN II IS NOT TWIN III, and no prefix rule may pretend otherwise', () => {
  expect(headerNames('Grob G-103 Twin II', 'GROB G 103  TWIN II')).toBe(true);
  expect(headerNames('Grob G-103 Twin II', 'GROB G 103 C  TWIN III')).toBe(false);
});

test('a designation that is ONLY a number must match the number EXACTLY, or it takes the KESTREL', () => {
  // `604` has no words, so `every word of ours is in the heading` is vacuously true — of EVERY
  // heading. Without the exact-digit clause it matches `KESTREL`, which has no word of ours to miss
  // and no digit to contradict, and walks home with 17 m.
  expect(headerNames('604', 'GLASFLÜGEL 604')).toBe(true);
  expect(headerNames('604', 'KESTREL')).toBe(false);
});

test('when only the AREA identifies, it must be the SAME NUMBER — a near-miss is another aircraft', () => {
  // The maker path has no title naming the aircraft, so the area is not corroborating a match: it IS
  // the match, inside a pool of every sailplane one firm ever built. The forgiving window is not
  // offered there. Our Apis 2 sat 0.16 m² from the Pipistrel Apis-Bee — inside every tolerance we
  // own, and a different aircraft.
  const s = [{ spanM: 18, areaM2: 11.2, variableSpan: false }];
  expect(spanForArea(s, 11.0, false)).toEqual({ spanM: 18 });          // title path: 0.2 m² forgiven
  expect(spanForArea(s, 11.0, true)).toEqual({ refused: 'no-section' });  // maker path: it is not the same number
});
