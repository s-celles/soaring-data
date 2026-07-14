// The batch this script emits is READ BY A HUMAN and submitted under their name. So the tests here
// are not about formatting — they are about the statements it must REFUSE to propose.

import { test, expect } from 'bun:test';
import { familyWords } from './wikidata-contribute';

test('A FAMILY IS NOT AN AIRCRAFT, AND IT HAS NO WINGSPAN', () => {
  // Q1019853 is `Bölkow Phoebus`, and Wikidata's own description reads `1964 competition sailplane
  // FAMILY`. Our row is the Phoebus C, whose certificate states 17 m — while the A and the B, in the
  // same document, state 15. The batch was about to write SEVENTEEN METRES, with a certification
  // authority's URL behind it, onto an item standing for three aircraft of two different spans.
  //
  // This is the variant-versus-aircraft trap arriving from the other side. The name-sourced spans are
  // withheld because the VARIANT is too specific for the item; here the ITEM is too general for the
  // aircraft. Same error, opposite direction — and the guard I had built watched only one door.
  expect(familyWords('1964 competition sailplane family')).toBe(true);
  expect(familyWords('family of 15 metre and 18 metre single-seat gliders')).toBe(true);   // it says it outright
  expect(familyWords('two-seater glider family, Germany 1986')).toBe(true);
  expect(familyWords('German single-seat glider, 1970')).toBe(false);
  expect(familyWords('glider')).toBe(false);
});
