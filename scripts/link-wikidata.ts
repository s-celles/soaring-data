// ============ giving every polar a Wikidata identifier ============
//
// This is the quiet half of the Wikidata work, and the half that lasts.
//
// We took wingspans OUT of Wikipedia and offered them back to Wikidata. That transaction is
// finished. What it left behind is worth more than the numbers: for ~80 of these wings we now know
// WHICH ITEM IN THE WORLD they are. A QID is a stable, global, language-free identifier, and writing
// it down turns `polars.csv` from a table of names into a table that is JOINABLE — to Wikidata, and
// through it to every database that speaks the same identifiers.
//
// ---- and it reverses the direction, which is the point ----
//
// soaring-data does not push to Wikidata. It POINTS at it. The wingspans we contributed carry the
// reference `imported from English Wikipedia`, which is honest and weak, and it says so: go and
// replace me with the manufacturer's data sheet. The day somebody does — an EASA type certificate,
// a Schleicher spec sheet — that better number arrives at OUR table through this column, sourced,
// without a line of scraping. We stop being a copy of Wikipedia and start being a consumer of a
// commons that other people are also improving.
//
// Making Wikipedia read these numbers back OUT of Wikidata would close a circle instead: a span that
// came from an article would return to it wearing a second source it never had. That is citogenesis,
// and this column is the alternative to it.
//
// ---- the guards, and why they are stricter here than anywhere else ----
//
// A wrong QID is worse than no QID. A wrong SPAN is a number a human might re-check; a wrong POINTER
// is permanent, silent, and machine-readable — it will be joined against, aggregated, and believed,
// and nobody ever reopens it. So an item is written only when it survives BOTH checks:
//
//   · titleMatches — the article's title must be about this aircraft. Wikipedia's search answered
//     `LS-8-18` with the Glaser-Dirks DG-600.
//   · the WING AREA in our own polar file, within AREA_TOLERANCE_M2 of the article's.
//
// A row that fails either stays EMPTY. 60-odd empty cells are the honest result, not a gap for a
// later script to fill on a hunch.
//
// Run:  just link-wikidata      → rewrites polars.csv, adding/refreshing wikidata_qid

import { readFile, writeFile } from 'node:fs/promises';
import { titleMatches, modelOf } from './classify-gliders';

const CSV = new URL('../datasets/polars/polars.csv', import.meta.url).pathname;
const WP = 'https://en.wikipedia.org/w/api.php';
const UA = 'soaring-data/0.2 (https://github.com/s-celles/soaring-data)';
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

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

/** A TRANSIENT FAILURE IS NOT AN ANSWER, and this is the bug it hides.
 *
 *  This used to throw on the first bad response, and the caller caught it and left the cell empty —
 *  a hole indistinguishable, in the finished file, from "this glider has no Wikidata item". Four
 *  gliders lost their identifier that way (the Taurus, the Zuni, the Diana 2, the VSO-10) while
 *  KEEPING a span whose source column said `wikipedia`: we had read their article, corroborated it
 *  against our wing area, taken its number — and recorded that they had no item. The file
 *  contradicted itself and nothing noticed, because an empty cell is what an honest failure looks
 *  like too.
 *
 *  So: retry, and if it still fails, THROW rather than shrug. An empty cell must mean we looked and
 *  found nothing — not that we were unable to look. validate.ts now refuses a file where a span came
 *  from Wikipedia and no item came with it. */
const api = async (params: Record<string, string>): Promise<Record<string, unknown>> => {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
    try {
      const r = await fetch(`${WP}?${new URLSearchParams({ format: 'json', ...params })}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(25_000),
      });
      if (r.ok) return await r.json() as Record<string, unknown>;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error('Wikipedia unreachable');
};

/** The Wikidata item behind the English Wikipedia article about THIS glider — or null.
 *
 *  The article is reached first and the QID is read off its `pageprops.wikibase_item`, rather than
 *  searching Wikidata directly. That is deliberate: Wikidata's own search matches labels and aliases
 *  with no notion of what a glider IS, while the article gives us an infobox whose WING AREA we can
 *  check against our own. The identifier we write down is one we have corroborated with a number. */
export async function findQid(name: string, ourAreaM2: number | null): Promise<string | null> {
  const s = await api({ action: 'query', list: 'search', srsearch: `${name} glider`, srlimit: '3' });
  const hits = ((s.query as { search?: { title: string }[] })?.search ?? []).map(h => h.title);

  for (const title of hits) {
    if (!titleMatches(name, title)) continue;

    const p = await api({
      action: 'query', prop: 'revisions|pageprops', rvprop: 'content', rvslots: 'main',
      titles: title, redirects: '1',
    });
    const pages = (p.query as {
      pages?: Record<string, {
        revisions?: { slots: { main: { '*': string } } }[];
        pageprops?: { wikibase_item?: string };
      }>;
    })?.pages ?? {};
    const page = Object.values(pages)[0];
    const text = page?.revisions?.[0]?.slots?.main?.['*'];
    const qid = page?.pageprops?.wikibase_item;
    if (text === undefined || qid === undefined) continue;

    // THE CORROBORATION, and it must actually HAPPEN.
    //
    // This read `if (theirArea !== null && ...)` — so an article with NO wing area skipped the check
    // entirely and its identifier was written down unchecked. `Discus A` thereby matched `Discus
    // Launch Glider`: a hand-thrown radio-control model, two metres of wing, no aircraft infobox and
    // therefore no area to disagree with. We were one paste from publishing a 15-metre wingspan onto
    // a model aeroplane's Wikidata item.
    //
    // The header of this file already SAID an item is written "only when the article is about this
    // aircraft AND its wing area agrees with our own". The code did not do it. An unverifiable match
    // is not a match: no area, no identifier.
    const theirArea = num(/\|\s*wing\s*area\s*sqm\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
    if (ourAreaM2 === null || theirArea === null) continue;
    if (Math.abs(theirArea - ourAreaM2) > AREA_TOLERANCE_M2) continue;

    return qid;
  }
  return null;
}

// ---- the run ----
//
// Guarded like the classifier's: this module exports findQid, and importing one function must not
// fire 150 requests at a public API as a side effect.
if (import.meta.main) {
  const lines = (await readFile(CSV, 'utf8')).trim().split(/\r?\n/);
  const head = cells(lines[0]);
  const at = (r: string[], name: string): string | undefined => {
    const i = head.indexOf(name);
    return i < 0 ? undefined : r[i];
  };

  // A column that already exists KEEPS ITS PLACE. Appending it afresh each run made the file's shape
  // depend on the ORDER the scripts were called in — link-then-easa and easa-then-link produced two
  // different headers for the same data, and the schema could only ever match one of them. A dataset
  // must not change shape according to which tool touched it last.
  const iQid = head.indexOf('wikidata_qid');
  const cols = iQid >= 0 ? head : [...head, 'wikidata_qid'];
  const qidAt = cols.indexOf('wikidata_qid');

  let held = 0, found = 0, none = 0;
  const rows: { name: string; qid: string }[] = [];
  const out = [cols.join(',')];

  for (const line of lines.slice(1)) {
    const r = cells(line);
    // The polar file's name is its PROVENANCE. The question to Wikipedia is about the AIRCRAFT, and
    // `DG-500 PAS` is not an aircraft — it is a DG-500 with somebody in the back seat.
    const declared = (at(r, 'model') ?? '').replace(/^"|"$/g, '').trim();
    const name = declared !== '' ? declared : modelOf((at(r, 'name') ?? '').replace(/^"|"$/g, '').trim());

    // An identifier already established is not established again: re-running must not hammer a
    // public API for answers we already hold. Delete the column to force a fresh lookup.
    let qid = (iQid >= 0 ? r[iQid] : '') ?? '';
    if (qid !== '') held++;
    else {
      try {
        qid = (await findQid(name, num(at(r, 'wing_area_m2')))) ?? '';
        if (qid !== '') found++; else none++;
      } catch (e) {
        // A source that is down is not a reason to guess an identifier — and it is not a reason to
        // write an empty cell either. An empty cell says "no item exists". We do not know that.
        console.error(`\nFAILED on ${name}: ${e instanceof Error ? e.message : String(e)}`);
        console.error('Nothing written. An unreachable source is not an answer; run it again.\n');
        process.exit(1);
      }
    }

    if (qid !== '') rows.push({ name, qid });
    const row = cols.map(c => quote(r[head.indexOf(c)] ?? ''));
    row[qidAt] = quote(qid);
    out.push(row.join(','));
  }

  await writeFile(CSV, out.join('\n') + '\n');

  // Several of our rows legitimately share one item — `PIK-20B`, `PIK-20D` and `PIK-20E` are
  // VARIANTS of the aircraft the item describes, and pointing all three at it is correct. That is
  // exactly the case where the wingspan may NOT be contributed (a variant's span is not the
  // aircraft's), so the two scripts disagree here on purpose, and both are right.
  const byQid = new Map<string, string[]>();
  for (const { name, qid } of rows) byQid.set(qid, [...(byQid.get(qid) ?? []), name]);
  const shared = [...byQid.entries()].filter(([, ns]) => ns.length > 1);

  console.log(`
wings: ${held + found + none}
  identifier already held   ${held}   (kept; the API is not asked twice for the same answer)
  identifier established    ${found}
  NO item, left empty       ${none}   ← a wrong pointer is worse than none: it is permanent

  distinct Wikidata items   ${byQid.size}
  items shared by variants  ${shared.length}`);

  for (const [qid, names] of shared) console.log(`    ${qid}  ←  ${names.join(', ')}`);

  console.log(`
The empty cells are the honest half. A wrong SPAN is a number a human might re-check; a wrong
POINTER is silent, machine-readable, and will be joined against and believed by people who never
saw this file. So an item is written only when the article is about this aircraft AND its wing area
agrees with our own.`);
}
