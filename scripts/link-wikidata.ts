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
import { titleStrength, match, modelOf } from './classify-gliders';

const CSV = new URL('../datasets/polars/polars.csv', import.meta.url).pathname;
const ALIASES = new URL('../datasets/polars/aliases.csv', import.meta.url).pathname;
const WP = 'https://en.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
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
const api = async (params: Record<string, string>, base = WP): Promise<Record<string, unknown>> => {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
    try {
      const r = await fetch(`${base}?${new URLSearchParams({ format: 'json', ...params })}`, {
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
/** Ask Wikipedia, and if it says NOTHING, ask a shorter question.
 *
 *  `Pegase 101A glider` returns ZERO results. `Pegase glider` returns `Centrair Pegase` first, whose
 *  wing area is 10.5 m² — ours, to the centimetre, and whose variants section lists the C101A by
 *  name. The article was there the whole time. The QUERY was over-specified: our model carries the
 *  VARIANT designation (`101A`, `XT`, `Lark`), and no article title carries it, so the search engine
 *  was being asked for a page that requires a word which exists nowhere.
 *
 *  A search that returns nothing has told us nothing. Asking a broader question is not guessing — it
 *  is asking better, and every guard downstream still has to be satisfied. So the trailing tokens are
 *  dropped one at a time until the search speaks. `Duo Discus XT` → `Duo Discus`. `SZD-38A Jantar 1`
 *  → `SZD-38A Jantar`. A single-token name (`Ka8b`, `LS-1C`) has nothing to shorten and stays silent,
 *  which is the honest answer for it. */
async function search(name: string): Promise<string[]> {
  const words = name.split(/\s+/).filter(w => w !== '');
  for (let n = words.length; n >= 1; n--) {
    const query = words.slice(0, n).join(' ');
    const s = await api({ action: 'query', list: 'search', srsearch: `${query} glider`, srlimit: '3' });
    const hits = ((s.query as { search?: { title: string }[] })?.search ?? []).map(h => h.title);
    if (hits.length > 0) return hits;
  }
  return [];
}

export async function findQid(name: string, ourAreaM2: number | null): Promise<string | null> {
  const hits = await search(name);

  for (const title of hits) {
    const strength = titleStrength(name, title);
    if (strength === 'none') continue;

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

    // A STRONG title match IS the identification. `ASG29-18` against `Schleicher ASG 29`: word and
    // number both land, and there is nothing a wing area could add. Demanding one anyway refused
    // gliders whose identity was never in question — some because WE hold no wing area (a fact about
    // our file, offered as though it were a fact about the aircraft), others because the article
    // states ONE area for ONE configuration while our row describes another. A failure of
    // CONFIGURATION, dressed up as a failure of IDENTITY.
    if (strength === 'strong') return qid;

    // A WEAK match is a suspicion, and every disaster this repository records was a weak match:
    // `LS-8-15` against the SCHLEICHER K 8 (a shared 8, nothing else), `Discus A` against `Discus
    // Launch Glider` (a hand-thrown radio-control MODEL, two metres of wing, no aircraft infobox and
    // therefore no area to disagree with). So a weak match must be corroborated against a number we
    // did not get from the article — and if there is no such number, there is no identifier. An
    // unverifiable suspicion is not a match.
    const theirArea = num(/\|\s*wing\s*area\s*sqm\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
    if (ourAreaM2 === null || theirArea === null) continue;
    if (Math.abs(theirArea - ourAreaM2) > AREA_TOLERANCE_M2) continue;

    return qid;
  }
  return null;
}

/** Ask WIKIDATA, when Wikipedia had nothing to say.
 *
 *  The route above goes ARTICLE → item, and it is the better one: an article carries an infobox, and
 *  an infobox carries a wing area we can check. But it can only find gliders that Wikipedia's search
 *  returns for the string in our file, and it does not return `Speed Astir` (the article is `Grob
 *  G104 Speed Astir`), nor `SZD-38 Jantar`, nor `Glasflügel 604`.
 *
 *  Wikidata's own search reads LABELS AND ALIASES, and it finds all three. It also finds, for `Apis`,
 *  the FAMILY NAME; for `Phoebus`, a MALE GIVEN NAME; for `Ka 8`, an experimental KAMOV HELICOPTER.
 *  So it needs a guard, and Wikidata hands us one that the article route never had: the item's own
 *  DESCRIPTION, written by a human, in a sentence. `German competition sailplane, 1978` is a glider.
 *  `family name` is not.
 *
 *  Two guards, and the second one is subtler than it looks:
 *
 *    · the DESCRIPTION must say this is a glider. Cheap, decisive, and human-written.
 *
 *    · the match must be STRONG, or WEAK BY THE WORD — never weak by the DIGIT ALONE. `Speed Astir`
 *      against `Grob G104 Speed Astir` shares two distinctive words and no number: weak by the letter
 *      of the rule, overwhelming in fact. `LS-8-15` against `Schleicher K 8` shares the digit 8 and
 *      nothing else — and the K 8 IS a glider, so the description guard would wave it straight
 *      through. That is the match that nearly put a wingspan on the wrong Schleicher, and here it
 *      would arrive wearing a certificate of good character.
 *
 *  A shared word is evidence. A shared small number is a coincidence waiting to be believed. */
const IS_GLIDER = /\b(glider|sailplane|segelflugzeug)\b/i;

export async function findQidOnWikidata(name: string): Promise<string | null> {
  const d = await api({ action: 'wbsearchentities', language: 'en', limit: '6', search: name }, WD);
  const hits = (d.search as { id: string; label: string; description?: string }[] | undefined) ?? [];

  for (const h of hits) {
    if (!IS_GLIDER.test(h.description ?? '')) continue;
    const m = match(name, h.label);
    if (m.strength === 'strong') return h.id;
    if (m.strength === 'weak' && m.word) return h.id;
    // weak by the digit alone: refused. See above — the K 8 is a glider too.
  }
  return null;
}

/** THE MANUFACTURER, borrowed from Wikidata — not derived, not guessed, and NOT CACHED.
 *
 *  This is the first column that flows the other way, and it is the whole point of having done the
 *  identifier work. `Antares_18S` does not contain the word "Lange", and no amount of cleverness
 *  applied to a polar file name will ever produce it. The item does: Wikidata's P176 says who MADE
 *  this aircraft, in a structured field, and we simply read it.
 *
 *  It is REFRESHED every run rather than kept, and that is deliberate. A derived value is computed
 *  once and belongs to us; a BORROWED value belongs to the commons and improves without us. The day
 *  somebody fills in the P176 of the PIK-20 — one of the fourteen our items still lack — it arrives
 *  here on the next run, with no scraping and no code change. That is what "we point at Wikidata,
 *  we do not copy it" means when it stops being a slogan.
 *
 *  ---- and why NOT the type certificate, which we already hold ----
 *
 *  Every EASA TCDS names a `Type Certificate Holder`, and it is tempting: 55 of our gliders have one,
 *  it is authoritative, and it is already on disk. It is also a DIFFERENT FACT. Rolladen-Schneider
 *  went bankrupt and DG Flugzeugbau took over its certificates — so the TCDS for the LS family names
 *  DG, while the aircraft was MADE by Rolladen-Schneider, which is what Wikidata correctly says. The
 *  certificate holder is who is answerable for the type TODAY. The manufacturer is who built the
 *  wing. Filling one column from the other would write a falsehood, and it would write it under the
 *  seal of a certification authority — the exact failure mode this repository has already been
 *  bitten by once, with the LS8-18's certified span. */
async function manufacturers(qids: string[]): Promise<Map<string, { qid: string; name: string }>> {
  const made = new Map<string, string>();          // glider QID → manufacturer QID
  for (let i = 0; i < qids.length; i += 50) {
    const d = await api({ action: 'wbgetentities', props: 'claims', ids: qids.slice(i, i + 50).join('|') }, WD);
    const ents = (d.entities as Record<string, { claims?: Record<string, unknown[]> }>) ?? {};
    for (const [q, e] of Object.entries(ents)) {
      const c = e.claims?.P176?.[0] as { mainsnak?: { datavalue?: { value?: { id?: string } } } } | undefined;
      const m = c?.mainsnak?.datavalue?.value?.id;
      if (m !== undefined) made.set(q, m);
    }
  }

  // Now the NAMES of those manufacturers — a second, small round.
  const ids = [...new Set(made.values())];
  const label = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await api({ action: 'wbgetentities', props: 'labels', languages: 'en', ids: ids.slice(i, i + 50).join('|') }, WD);
    const ents = (d.entities as Record<string, { labels?: { en?: { value: string } } }>) ?? {};
    for (const [q, e] of Object.entries(ents)) {
      if (e.labels?.en?.value !== undefined) label.set(q, e.labels.en.value);
    }
  }

  const out = new Map<string, { qid: string; name: string }>();
  for (const [glider, maker] of made) {
    const name = label.get(maker);
    if (name !== undefined) out.set(glider, { qid: maker, name });
  }
  return out;
}

/** THE IDENTIFIERS A HUMAN DECIDED, and which no rule will ever reach.
 *
 *  A declared identifier OUTRANKS every search, and it is read before any of them run.
 *
 *  Two things forced this file into existence, and both are worth writing down.
 *
 *  ONE: the tail is not a rule problem. `Mosquito` is the Glasflügel 303 — our wing area agrees with
 *  the article's to ONE SQUARE CENTIMETRE — and the two names share neither a word nor a number, so
 *  no pattern will ever connect them. `Antares 18S` IS a Lange Antares, and the article's wing area
 *  disagrees with ours because the article describes the 20E: a failure of CONFIGURATION, which no
 *  area check can tell apart from a failure of IDENTITY. These are not near-misses to be rescued by
 *  a cleverer heuristic. They are judgements, and a judgement belongs in a file a human signed.
 *
 *  TWO, and it is the harder lesson: THE SEARCHES ARE NOT DETERMINISTIC. Re-deriving every identifier
 *  from scratch — the same code, the same data, ten minutes later — GAINED four and LOST three. The
 *  LAK-19 and the LS-6 simply stopped being returned. An identifier that flickers is worse than one
 *  that is absent: it is a fact about the weather, presented as a fact about the world.
 *
 *  So `wikidata_qid` IS the pin. Once a human has read it against its label, it is never re-derived —
 *  the `already held` path exists for exactly that, and blanking the column to "start clean" is the
 *  one thing that must not be done. This file is the pin for the cases the search cannot reach at all.
 *
 *  The `evidence` column is not a comment. It is the reason, and it is what makes the row auditable
 *  by somebody who was not in the room. */
async function declaredAliases(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let text: string;
  try { text = await readFile(ALIASES, 'utf8'); } catch { return out; }

  const lines = text.trim().split(/\r?\n/);
  const head = cells(lines[0]);
  const iName = head.indexOf('name'), iQid = head.indexOf('wikidata_qid');
  if (iName < 0 || iQid < 0) return out;

  for (const line of lines.slice(1)) {
    const r = cells(line);
    const name = (r[iName] ?? '').replace(/^"|"$/g, '').trim();
    const qid = (r[iQid] ?? '').trim();
    if (name !== '' && /^Q\d+$/.test(qid)) out.set(name, qid);
  }
  return out;
}

// ---- the article we already knew the address of ----
//
// classify-gliders reads a span out of Wikipedia by SEARCHING for the glider. When the search misses,
// the cell stays empty — and it missed for twenty of our gliders, including the Blaník L23, the K 8,
// the Pégase and both Jantars.
//
// But by then we KNOW WHICH ARTICLE IT IS. A human pinned it, by hand, in aliases.csv, with the URL
// written in the evidence column. The classifier was sent out to search for a thing whose address is
// sitting in the next file along — and came back empty, and we wrote down `unknown`.
//
// So: for a glider that has an item and no span, go to the article THAT ITEM points at, and read it.
// The guards do not move an inch. The infobox's wing area must still agree with ours (no area, no
// answer — the rule that stopped `Discus A` becoming a radio-control toy), and the number is still
// `span_source=wikipedia`, because that is precisely what it is: an encyclopaedia's number, sourced
// from an encyclopaedia, and no stronger for having been easier to find.

/** The English Wikipedia article this item is attached to — Wikidata's own sitelink. */
async function articleOf(qid: string): Promise<string | null> {
  const d = await api({ action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwiki' }, WD);
  const ents = (d.entities as Record<string, { sitelinks?: { enwiki?: { title: string } } }>) ?? {};
  return ents[qid]?.sitelinks?.enwiki?.title ?? null;
}

/** The span the PINNED article states, corroborated by its wing area. Null when it cannot be. */
export async function spanFromArticle(qid: string, ourAreaM2: number | null): Promise<number | null> {
  if (ourAreaM2 === null) return null;          // no area, no answer — the guard does not bend here
  const title = await articleOf(qid);
  if (title === null) return null;

  const p = await api({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
    titles: title, redirects: '1',
  });
  const pages = (p.query as { pages?: Record<string, { revisions?: { slots: { main: { '*': string } } }[] }> })?.pages ?? {};
  const text = Object.values(pages)[0]?.revisions?.[0]?.slots?.main?.['*'];
  if (text === undefined) return null;

  const span = num(/\|\s*span\s*m\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
  const theirArea = num(/\|\s*wing\s*area\s*sqm\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
  if (span === null || theirArea === null) return null;
  if (span < 8 || span > 35) return null;
  if (Math.abs(theirArea - ourAreaM2) > AREA_TOLERANCE_M2) return null;
  return span;
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
  const cols = iQid >= 0 ? [...head] : [...head, 'wikidata_qid'];
  // `manufacturer` sits beside the model it belongs to, where a reader will look for it.
  if (!cols.includes('manufacturer')) cols.splice(cols.indexOf('model') + 1, 0, 'manufacturer');
  // The maker's IDENTIFIER, beside the label it produces. The label is a rendering of the fact; the
  // identifier IS the fact — see the column's description.
  if (!cols.includes('manufacturer_qid')) cols.splice(cols.indexOf('manufacturer') + 1, 0, 'manufacturer_qid');
  const qidAt = cols.indexOf('wikidata_qid');
  const mfgAt = cols.indexOf('manufacturer');
  const mfgQidAt = cols.indexOf('manufacturer_qid');

  const aliases = await declaredAliases();
  let held = 0, found = 0, none = 0, fromWd = 0, fromAlias = 0;
  const rows: { name: string; qid: string }[] = [];
  const resolved: { row: string[]; name: string; qid: string }[] = [];

  for (const line of lines.slice(1)) {
    const r = cells(line);
    // The polar file's name is its PROVENANCE. The question to Wikipedia is about the AIRCRAFT, and
    // `DG-500 PAS` is not an aircraft — it is a DG-500 with somebody in the back seat.
    const declared = (at(r, 'model') ?? '').replace(/^"|"$/g, '').trim();
    const name = declared !== '' ? declared : modelOf((at(r, 'name') ?? '').replace(/^"|"$/g, '').trim());

    // An identifier already established is not established again: re-running must not hammer a
    // public API for answers we already hold. Delete the column to force a fresh lookup.
    let qid = (iQid >= 0 ? r[iQid] : '') ?? '';
    // A DECLARED identifier outranks everything — including whatever a previous run wrote here.
    // A human read the article and signed for it; a search did not.
    const fileName = (at(r, 'name') ?? '').replace(/^"|"$/g, '').trim();
    const byHand = aliases.get(fileName) ?? aliases.get(name);
    if (byHand !== undefined) { qid = byHand; fromAlias++; }
    else if (qid !== '') held++;
    else {
      try {
        qid = (await findQid(name, num(at(r, 'wing_area_m2')))) ?? '';
        // Wikipedia's search did not know this glider by the name our file gives it. Wikidata's does:
        // it reads aliases, and it hands us a description to check the answer against.
        if (qid === '') { qid = (await findQidOnWikidata(name)) ?? ''; if (qid !== '') fromWd++; }
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
    resolved.push({ row, name, qid });
  }

  // The borrowed column, fetched in two batched rounds once every item is known.
  const maker = await manufacturers([...new Set(resolved.map(x => x.qid).filter(q => q !== ''))]);

  // ---- and the span from the article we already knew the address of ----
  //
  // ONE ROW, ONE ITEM, or nothing. `LS-8-15` and `LS-8-18` both point at Q2163993, the LS8 — and the
  // article states THE LS8's span. Filling both rows from it would give a 15 m glider and an 18 m
  // glider the same number, and one of them would be wrong while looking exactly as sourced as the
  // other. Where several of our rows share an item, the item is the AIRCRAFT and the rows are its
  // CONFIGURATIONS, and no single number in that article is theirs. They stay empty. That is the same
  // rule wikidata-contribute obeys in the other direction, and aliases.csv says so in plain words.
  const uses = new Map<string, number>();
  for (const { qid } of resolved) if (qid !== '') uses.set(qid, (uses.get(qid) ?? 0) + 1);

  const spanAt = cols.indexOf('span_m'), srcAt = cols.indexOf('span_source');
  const areaAt = cols.indexOf('wing_area_m2'), classAt = cols.indexOf('wing_class');
  let filled = 0, sharedItem = 0;
  const gained: string[] = [];

  for (const { row, name, qid } of resolved) {
    if (qid === '' || row[classAt] !== 'glider') continue;
    if ((row[spanAt] ?? '').trim() !== '') continue;              // it has one; this only fills gaps
    if ((uses.get(qid) ?? 0) > 1) { sharedItem++; continue; }     // a configuration, not the aircraft
    const span = await spanFromArticle(qid, num(row[areaAt]));
    if (span === null) continue;
    row[spanAt] = String(span);
    row[srcAt] = 'wikipedia';
    filled++;
    gained.push(`  ${name.padEnd(22)} ${String(span).padStart(6)} m   ${qid}`);
  }

  const out = [cols.join(',')];
  for (const { row, qid } of resolved) {
    const m = maker.get(qid);
    row[mfgAt] = quote(m?.name ?? '');
    row[mfgQidAt] = quote(m?.qid ?? '');
    out.push(row.join(','));
  }
  const named = resolved.filter(x => maker.has(x.qid)).length;
  const itemsWithoutP176 = [...new Set(resolved.map(x => x.qid))].filter(q => q !== '' && !maker.has(q)).length;

  await writeFile(CSV, out.join('\n') + '\n');

  // Several of our rows legitimately share one item — `PIK-20B`, `PIK-20D` and `PIK-20E` are
  // VARIANTS of the aircraft the item describes, and pointing all three at it is correct. That is
  // exactly the case where the wingspan may NOT be contributed (a variant's span is not the
  // aircraft's), so the two scripts disagree here on purpose, and both are right.
  const byQid = new Map<string, string[]>();
  for (const { name, qid } of rows) byQid.set(qid, [...(byQid.get(qid) ?? []), name]);
  const shared = [...byQid.entries()].filter(([, ns]) => ns.length > 1);

  console.log(`
wings: ${fromAlias + held + found + none}
  DECLARED by a human       ${fromAlias}   (aliases.csv — outranks every search, and every past run)
  identifier already held   ${held}   (kept; the API is not asked twice for the same answer)
  identifier established    ${found}   (of which ${fromWd} from Wikidata's own search, by alias)
  NO item, left empty       ${none}   ← a wrong pointer is worse than none: it is permanent

the SPAN, read from the article the ITEM points at — not from a search that missed it:
  gaps filled               ${filled}
  item shared by variants   ${sharedItem}   ← the item is the AIRCRAFT; the rows are its configurations

manufacturer, BORROWED from Wikidata (P176) — never derived, never cached:
  wings given a maker       ${named}
  items with NO P176        ${itemsWithoutP176}   ← a gap in the commons, and one we could fill

  distinct Wikidata items   ${byQid.size}
  items shared by variants  ${shared.length}`);

  if (gained.length > 0) {
    console.log(`
a span we already had the address of. classify-gliders went out and SEARCHED for these articles and
came back empty — while a human had pinned the very same article, by hand, in aliases.csv:`);
    for (const g of gained) console.log(g);
  }

  for (const [qid, names] of shared) console.log(`    ${qid}  ←  ${names.join(', ')}`);

  console.log(`
The empty cells are the honest half. A wrong SPAN is a number a human might re-check; a wrong
POINTER is silent, machine-readable, and will be joined against and believed by people who never
saw this file. So an item is written only when the article is about this aircraft AND its wing area
agrees with our own.`);
}
