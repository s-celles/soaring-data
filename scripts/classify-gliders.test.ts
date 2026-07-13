// The two decisions the classifier makes without asking anyone, and the two it refuses to make.
//
// Both functions are pure and both are load-bearing: one reads a number out of a name that may not
// contain one, and the other names a competition class from a span that usually cannot settle it.
// The tests that matter most here are the NEGATIVE ones — the cases where the honest answer is
// nothing at all, and where a regular expression that tried harder would produce a confident lie.

import { test, expect } from 'bun:test';
import { spanFromName, classFromSpan, titleMatches, titleStrength, match, modelOf } from './classify-gliders';

// ---- reading the span off the name ----

test('a span is read only when the name SAYS metres', () => {
  expect(spanFromName('Ventus CM (17.6m)')).toBe(17.6);
  expect(spanFromName('Cirrus_18m')).toBe(18);
  expect(spanFromName('Apis2 15m')).toBe(15);
  expect(spanFromName('LS-10s 18m')).toBe(18);
});

test('A MODEL NUMBER IS NOT A SPAN — the four gliders this file got wrong', () => {
  // The bug, named. `ASG29-18` (model 29, span 18) and `ASK-21` (model 21) are structurally the
  // SAME string: letters, hyphen, two digits. Nothing in the text tells them apart. While the `m`
  // was optional we stored 21 m for the ASK 21, 23 m for the ASK 23 and 17 m for the ASW 17 — and
  // because a span past 20.5 m settles the class on its own, we published a two-seat TRAINER and a
  // club single-seater as OPEN CLASS, on the authority of their own model numbers.
  //
  // So the reading is refused. These four go to Wikipedia, cross-checked against our wing area, or
  // they stay empty. An empty span a human can see is worth more than a confident one nobody will
  // re-check.
  expect(spanFromName('ASK-21')).toBeNull();      // an ASK 21 spans 17 m
  expect(spanFromName('ASK-23')).toBeNull();      // an ASK 23 spans 12.9 m
  expect(spanFromName('ASW-17')).toBeNull();      // an ASW 17 spans 20 m
  expect(spanFromName('ASH-25 (PAS)')).toBeNull();// 25 IS its span — and it is still a model number

  // And the cost, stated rather than hidden: a real span convention is no longer read here.
  expect(spanFromName('ASG29-18')).toBeNull();
  expect(spanFromName('LS-8-15')).toBeNull();
});

test('an uppercase M is a MOTOR, not metres', () => {
  // `PIK-30M` is a 15-metre motorglider whose model number is 30. Read case-insensitively it became
  // a thirty-metre machine, and a span past 20.5 m settles the class on its own — so we published it
  // as OPEN. `ASH-25M` is the self-launching ASH 25, same trap.
  //
  // The lowercase m is the UNIT, and every one of the 23 names carrying one is a genuine span. The
  // uppercase group is ambiguous — `DG1000-20M` really IS a 20-metre DG-1000 — and ambiguous is what
  // this file refuses to resolve by pattern. Those go to the infobox, or they stay empty.
  expect(spanFromName('PIK-30M')).toBeNull();
  expect(spanFromName('ASH-25M 1')).toBeNull();
  expect(spanFromName('DG1000-20M (PAS)')).toBeNull();   // true, and still not ours to assert
  expect(spanFromName('Ventus CM (17.6m)')).toBe(17.6);  // the lowercase unit still reads
});

test('the class that follows is refused too — no glider is named Open from a model number', () => {
  expect(classFromSpan(spanFromName('ASK-21'))).toBe('');
  expect(classFromSpan(spanFromName('ASK-23'))).toBe('');
});

test('a parenthesised span is a span — the read that once failed silently', () => {
  // This is the regression. `Ventus B (15m)` used to read as nothing; the script fell through to
  // Wikipedia, whose Ventus article describes the CM, and 17.6 m went into the file beside a name
  // that said 15. A read that fails here does not leave a hole — it hands the question to a source
  // that will answer it wrongly and confidently.
  expect(spanFromName('Ventus B (15m)')).toBe(15);
  expect(spanFromName('Ventus A-B (16.6m)')).toBe(16.6);
  expect(spanFromName('DG-400 (17m)')).toBe(17);
});

test('a model number is not a span', () => {
  // The "-8" of LS-8 and the "-4" of AC-4 are model numbers. No sailplane has an 8 m wing, and a
  // classifier that read one would go on to name a class from it.
  expect(spanFromName('LS-8')).toBeNull();
  expect(spanFromName('AC-4 Russia')).toBeNull();
  expect(spanFromName('Discus')).toBeNull();
  expect(spanFromName('SZD-55')).toBeNull();   // 55 is a type, and 55 m is not a wing
});

// ---- naming the class, and refusing to ----

test('the three spans that settle the class on their own', () => {
  expect(classFromSpan(18)).toBe('18m');
  expect(classFromSpan(13.5)).toBe('13.5m');
  expect(classFromSpan(26.58)).toBe('open');   // an ASW 22: beyond 20 m, seats cannot change the answer
});

test('15 metres is LEFT EMPTY, because the class turns on flaps we do not have', () => {
  // A 15 m wing is Standard class without flaps and 15-Metre class with them. These files record the
  // flaps of ten wings out of 155. Writing "Standard" beside a flapped Ventus would tell a pilot
  // something false, from a machine that had no way of knowing it.
  expect(classFromSpan(15)).toBe('');
});

test('20 metres is LEFT EMPTY, because the class turns on seats we do not have', () => {
  // 20-Metre Multi-seat if it seats two, Open if it seats one. Nothing in a polar records seats.
  expect(classFromSpan(20)).toBe('');
});

test('an unknown span names no class at all', () => {
  expect(classFromSpan(null)).toBe('');
});

// ---- is this article even about this glider? ----

test('an article about ANOTHER aircraft is refused — the two we nearly published', () => {
  // Wikipedia's search answered `LS-8-18` with the Glaser-Dirks DG-600 and `SF27` with the Scheibe
  // SF 32. Both articles carried a plausible span and a wing area close enough to pass the area
  // check, so we wrote 15 m against an EIGHTEEN-metre LS 8 — and offered it to Wikidata.
  //
  // A glider designation is mostly its NUMBER. If ours has one, theirs must share it.
  expect(titleMatches('LS-8-18', 'Glaser-Dirks DG-600')).toBe(false);
  expect(titleMatches('SF27', 'Scheibe SF 32')).toBe(false);
  expect(titleMatches('VT-116', 'Orličan VT-16 Orlík')).toBe(false);
});

test('the article that IS about our glider passes, accents and separators notwithstanding', () => {
  expect(titleMatches('LS-8-18', 'Rolladen-Schneider LS8')).toBe(true);
  expect(titleMatches('ASK-13', 'Schleicher ASK 13')).toBe(true);
  expect(titleMatches('Blanik L13', 'LET L-13 Blaník')).toBe(true);
  expect(titleMatches('SZD-9bis 1E Bocian', 'SZD-9 Bocian')).toBe(true);
});

test('when THEIR title has no number, a word decides — the item is the aircraft, not the variant', () => {
  // `Ventus B (15m)` against `Schempp-Hirth Ventus`: the 15 in our name is a SPAN, not a model
  // number, and the item is the AIRCRAFT, which carries no number at all. Demanding a shared digit
  // would refuse the right item for the crime of not having one.
  expect(titleMatches('Ventus B (15m)', 'Schempp-Hirth Ventus')).toBe(true);
  expect(titleMatches('Discus A', 'Schempp-Hirth Discus')).toBe(true);
  expect(titleMatches('Ventus B (15m)', 'Schempp-Hirth Discus')).toBe(false);
});

test('a name with no number falls back to its words — Carat, Taurus, Dimona', () => {
  expect(titleMatches('Carat', 'AMS-Flight Carat')).toBe(true);
  expect(titleMatches('Taurus', 'Pipistrel Taurus')).toBe(true);
  expect(titleMatches('Dimona', 'Diamond HK36 Super Dimona')).toBe(true);
  expect(titleMatches('Taurus', 'Schempp-Hirth Discus')).toBe(false);
});

// ---- the two holes that nearly reached Wikidata ----

test('the model is ours and the title is the manufacturer: they share no word, and are one aircraft', () => {
  // A shared WORD was once required as well, after `LS-8-15` matched the Schleicher K 8 on their
  // common 8. It rejected ten TRUE matches to do it — every glider whose polar is named for the
  // MODEL while Wikipedia titles the article for the MANUFACTURER. `H-206_Hornet` and
  // `Glasflügel 206` share no word and are the same aircraft, to the square centimetre.
  //
  // The K 8 is refused elsewhere and better: findQid will not write an identifier it cannot
  // corroborate against our own wing area, and LS-8-15 carries no wing area. A second lock on a door
  // is not caution when the window is the thing that was open.
  expect(titleMatches('H-206_Hornet', 'Glasflügel 206')).toBe(true);
  expect(titleMatches('H-301 Libelle', 'Glasflügel H-301')).toBe(true);
  expect(titleMatches('1-26E', 'Schweizer SGS 1-26')).toBe(true);
});

test('the number still parts the siblings', () => {
  expect(titleMatches('SF27', 'Scheibe SF 32')).toBe(false);
  expect(titleMatches('ASK-13', 'L-13 Blanik')).toBe(true);   // shares 13 — the WING AREA refuses it
  expect(titleMatches('DG-400 (15m)', 'Glaser-Dirks DG-200')).toBe(false);
  expect(titleMatches('Discus_2c_18m', 'DG Flugzeugbau LS10')).toBe(false);
});

// ---- the aircraft, and the file that describes flying it ----

test('a polar file name is not an aircraft designation', () => {
  // Thirty-eight EASA-certified gliders had no Wikidata identifier for no better reason than this,
  // and most of them already HAD an item. The gap was never in the commons: it was in the question.
  expect(modelOf('DG-500 PAS')).toBe('DG-500');
  expect(modelOf('Nimbus 4D PIL')).toBe('Nimbus 4D');
  expect(modelOf('ASW-27 Wnglts')).toBe('ASW-27');
  expect(modelOf('LS7wl')).toBe('LS7');
  expect(modelOf('IS-28B2 Lark with 1 person')).toBe('IS-28B2 Lark');
  expect(modelOf('Discus B from Cumulus Soaring GN II')).toBe('Discus B');
});

test('the parenthesised span is a configuration, and its number was lying to the matcher', () => {
  // The 17 of `DG-400 (17m)` is a SPAN. It was being compared against the 17 of `LAK-17`, which is a
  // MODEL — the ASK-21 trap, one more time, from one more direction.
  expect(modelOf('Ventus B (15m)')).toBe('Ventus B');
  expect(modelOf('DG-400 (17m)')).toBe('DG-400');
  expect(modelOf('Cirrus_18m')).toBe('Cirrus');
});

test('an uppercase M is a MOTOR and stays', () => {
  expect(modelOf('DG1000-20M (PAS)')).toBe('DG1000-20M');
});

test('a name with nothing to strip is left alone', () => {
  for (const n of ['1-26E', 'Nimbus 3', 'SZD-48-2 Jantar Std 2', 'ASK-21']) {
    expect(modelOf(n)).toBe(n);
  }
});

// ---- how well, not whether ----

test('EVERY disaster this repository records had a WEAK match — not one had a strong one', () => {
  // That is the whole justification for the two tiers, and it is checkable. The wing area is now
  // demanded only where the designation leaves room for doubt; where word AND number both land, the
  // aircraft is identified and there is nothing an area could add.
  expect(titleStrength('LS-8-15', 'Schleicher K 8')).toBe('weak');        // a shared 8, nothing else
  expect(titleStrength('Discus A', 'Discus Launch Glider')).toBe('weak'); // a radio-control MODEL
  expect(titleStrength('ASK-13', 'L-13 Blanik')).toBe('weak');            // a shared 13
  expect(titleStrength('Mosquito', 'De Havilland Mosquito')).toBe('weak');// a bomber
  expect(titleStrength('Apis', 'Apis')).toBe('weak');                     // the genus of the honeybee
});

test('a designation that lands on both is an identification', () => {
  // These were refused an identifier — some because WE hold no wing area (a fact about our file,
  // offered as though it were a fact about the aircraft), others because the article states ONE area
  // for ONE configuration while our row describes another.
  expect(titleStrength('ASG29-18', 'Schleicher ASG 29')).toBe('strong');
  expect(titleStrength('ASH-26E', 'Schleicher ASH 26')).toBe('strong');
  expect(titleStrength('LS-8-15', 'Rolladen-Schneider LS8')).toBe('strong');
  expect(titleStrength('DG-400', 'Glaser-Dirks DG-400')).toBe('strong');
});

test('two numbers that contradict are two aircraft, whatever else they share', () => {
  expect(titleStrength('SF27', 'Scheibe SF 32')).toBe('none');
  expect(titleStrength('Discus 2c', 'DG Flugzeugbau LS10')).toBe('none');
  expect(titleStrength('DG-400', 'Glaser-Dirks DG-200')).toBe('none');
});

// ---- a shared word is evidence; a shared small number is a coincidence ----

test('WHY a match is weak decides whether Wikidata\'s own search may act on it', () => {
  // Wikidata's search reads ALIASES, and finds gliders Wikipedia's article search cannot: the
  // `Speed Astir` (whose article is `Grob G104 Speed Astir`), the ASW 12, the Binder EB28. It also
  // finds, for `Apis`, a FAMILY NAME, and for `Ka 8`, a KAMOV HELICOPTER — and the item's own
  // human-written DESCRIPTION throws those out.
  //
  // But the description cannot save us from `LS-8-15` matching the SCHLEICHER K 8, because the K 8
  // IS a glider: the wrong answer would arrive wearing a certificate of good character. What parts
  // them is WHY the match is weak. A shared distinctive WORD is evidence. A shared small NUMBER is a
  // coincidence waiting to be believed.
  const astir = match('Speed Astir', 'Grob G104 Speed Astir');
  expect(astir.strength).toBe('weak');
  expect(astir.word).toBe(true);          // two distinctive words, no number: acted on

  const k8 = match('LS-8-15', 'Schleicher K 8');
  expect(k8.strength).toBe('weak');
  expect(k8.word).toBe(false);            // the digit 8, and nothing else: refused
  expect(k8.digit).toBe(true);
});
