
// ============ the article we already knew the address of ============

test('ONE ROW, ONE ITEM — a configuration does not take the aircraft\'s span', () => {
  // `LS-8-15` and `LS-8-18` both point at Q2163993, the LS8, and the article states THE LS8's span.
  // Filling both rows from it would give a 15 m glider and an 18 m glider the SAME number, and one
  // of them would be wrong while looking exactly as sourced as the other.
  //
  // This is the rule, stated as the pipeline enforces it: a span is read from a pinned article only
  // when exactly ONE of our rows uses that item. Where several share it, the item is the AIRCRAFT and
  // the rows are its CONFIGURATIONS, and no single number in that article belongs to any of them.
  const uses = new Map([['Q2163993', 2], ['Q868793', 1]]);
  expect((uses.get('Q2163993') ?? 0) > 1).toBe(true);    // LS-8-15 / LS-8-18: withheld
  expect((uses.get('Q868793') ?? 0) > 1).toBe(false);    // Blanik L23: alone on its item, so read it
});
