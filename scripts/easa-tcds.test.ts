// ============ reading a type certificate, and refusing to ============
//
// Every test below is a mistake this script actually made, on real documents, and shipped into
// polars.csv before it was caught by reading the output. They are written as the record of that.

import { test, expect } from 'bun:test';
import { tcdsCandidate, isSailplane, readSections, spanForArea } from './easa-tcds';

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
