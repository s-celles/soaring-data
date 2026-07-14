// ============ giving the wingspans back to Wikidata ============
//
// We took wingspans out of Wikipedia. Wikidata — which is the machine-readable half of the same
// commons — records the wingspan of about thirty sailplanes out of the ~394 it knows. This script
// proposes the difference back.
//
// It does NOT edit anything. It emits a QuickStatements batch for a HUMAN to read and submit under
// their own account, and that is a deliberate design, not a limitation:
//
//   • Wikidata forbids unapproved mass edits. A bot flag is a community decision, and a script
//     that reached for the API directly would be doing something the project has asked people not
//     to do. QuickStatements is the sanctioned path for a batch this size, and the person who runs
//     it takes responsibility for it — which is exactly right, because it is a claim about the
//     world and a machine cannot be responsible for one.
//
//   • The batch is small enough to READ. That is the point. Every line is a glider, a number and
//     a source, and a human who knows gliders will spot a wrong one in a way no cross-check can.
//
// ---- what is offered, and what is deliberately withheld ----
//
// Only the spans whose `span_source` is `wikipedia` are offered. The 41 spans we read off the
// polar FILE NAMES are withheld, and the reason matters:
//
//   `ASG29-18` really is an 18 m ASG 29 — but the Wikidata item "Schleicher ASG 29" is the
//   AIRCRAFT, which exists in 15 m and 18 m spans. Writing 18 m onto it as a plain statement would
//   be false about the aircraft while being true about the variant. That needs a qualifier and a
//   judgement about how the item is modelled, and neither is a thing to automate.
//
// An item that ALREADY carries P2050 is skipped: we are here to fill a gap, not to argue with
// somebody who has sourced their number better than we have.
//
// The reference offered is `imported from English Wikipedia` (S143 → Q328). It is a weak reference
// and it is the honest one: it says exactly where the number came from and invites anyone to
// replace it with the manufacturer's data sheet. A stronger reference we do not have would be a
// lie about our own work.
//
// Run:  just link-wikidata && just wikidata-contribute   → writes wikidata-spans.qs for review

import { readFile, writeFile } from 'node:fs/promises';
import { titleMatches } from './classify-gliders';

const CSV = new URL('../datasets/polars/polars.csv', import.meta.url).pathname;
/** ONE file, because QuickStatements needs one paste and a human needs one decision.
 *
 *  The two operations it holds are NOT the same act, and the printout keeps them apart:
 *    · a value the item does not have  → we fill a gap
 *    · a certificate for a value it DOES have → we source somebody else's work
 *  QuickStatements handles both with the same syntax — a line whose value already exists gets its
 *  reference attached rather than a duplicate created — so the distinction belongs in the reading,
 *  not in the file. Splitting it into two files only made it possible to paste half the work. */
const OUT = new URL('../wikidata.qs', import.meta.url).pathname;
const WP = 'https://en.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const UA = 'soaring-data/0.1 (https://github.com/s-celles/soaring-data)';
const AREA_TOLERANCE_M2 = 0.8;

/** Wikidata's units and properties, by their own ids. P2050 = wingspan; Q11573 = metre;
 *  S143 = "imported from Wikimedia project"; Q328 = English Wikipedia. */
const P_WINGSPAN = 'P2050', Q_METRE = 'Q11573', S_IMPORTED = 'S143', Q_EN_WIKI = 'Q328';
/** P176 = manufacturer. Twenty of our gliders point at an item that does not say who built it. */
const P_MAKER = 'P176';
/** S854 = reference URL; S813 = retrieved (a date). The pair that turns a claim into a checkable one. */
const S_URL = 'S854', S_RETRIEVED = 'S813';
/** The same property, as it is named in a CLAIM rather than in a QuickStatements reference line. */
const P_REF_URL = 'P854';
const TODAY = new Date().toISOString().slice(0, 10);

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

const num = (s: string | undefined): number | null => {
  if (!s || s.trim() === '') return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

const api = async (base: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
  const r = await fetch(`${base}?${new URLSearchParams({ format: 'json', ...params })}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
};

/** The English Wikipedia article this item is attached to — Wikidata's own sitelink, not a search.
 *  Going through the ITEM means we read the article that IS this item, with no matching left to get
 *  wrong. The matching itself now lives in exactly one file, link-wikidata.ts, and this script reads
 *  the identifier it established. Two copies of a fragile rule are two rules. */
async function articleOf(qid: string): Promise<string | null> {
  const d = await api(WD, { action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwiki' });
  const ents = (d.entities as Record<string, { sitelinks?: { enwiki?: { title: string } } }>) ?? {};
  return ents[qid]?.sitelinks?.enwiki?.title ?? null;
}

/** Does that article STILL say what we hold? We are about to publish a number under a human's own
 *  name; a reading that has drifted since the classifier ran is not a number to publish. */
async function articleStillSays(qid: string, ourSpan: number): Promise<boolean> {
  const title = await articleOf(qid);
  if (title === null) return false;
  const p = await api(WP, {
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
    titles: title, redirects: '1',
  });
  const pages = (p.query as { pages?: Record<string, { revisions?: { slots: { main: { '*': string } } }[] }> })?.pages ?? {};
  const text = Object.values(pages)[0]?.revisions?.[0]?.slots?.main?.['*'];
  if (text === undefined) return false;
  const span = num(/\|\s*span\s*m\s*=\s*([\d.,]+)/i.exec(text)?.[1]);
  return span !== null && Math.abs(span - ourSpan) <= 0.05;
}

interface Held {
  /** The wingspans the item already states, in metres. Empty when it states none. */
  spans: number[];
  /** The reference URLs already attached to any of them — so a certificate is never offered twice. */
  refUrls: string[];
}

/** What the item ALREADY says about its wingspan, and on whose authority.
 *
 *  This used to answer a yes/no — "does it have one?" — and that was the right question for adding a
 *  VALUE. It is the wrong question for adding a REFERENCE. Sourcing a statement somebody else made,
 *  when the certificate agrees with them to the centimetre, is not overwriting their work; it is
 *  finishing it. But it may only be done when the value we would source IS the value that is there.
 *
 *  (The definition is below `describe` and `isFamily`, which the candidate filter asks first.) */

/** An item's own description of itself, in English. */
const described = new Map<string, string>();
async function describe(qid: string): Promise<string> {
  const cached = described.get(qid);
  if (cached !== undefined) return cached;
  const d = await api(WD, { action: 'wbgetentities', ids: qid, props: 'descriptions', languages: 'en' });
  const e = (d.entities as Record<string, { descriptions?: { en?: { value?: string } } }>)[qid];
  const s = e?.descriptions?.en?.value ?? '';
  described.set(qid, s);
  return s;
}

/** Does this item stand for a FAMILY of aircraft rather than one aircraft?
 *
 *  A family has no wingspan. `Bölkow Phoebus` covers the A, the B and the C — 15 m, 15 m and 17 m —
 *  and any single number written there is a claim about one of them, dressed as a claim about all.
 *
 *  Wikidata says so itself, in the description, and the words it uses are few. This is a coarse test
 *  and it is deliberately coarse: the cost of a false positive is one statement we do not make, and
 *  the cost of a false negative is a wrong span under a certification authority's seal. */
export function familyWords(description: string): boolean {
  return /\b(famil(?:y|ies)|series|range of|line of)\b/i.test(description);
}
async function isFamily(qid: string): Promise<boolean> {
  return familyWords(await describe(qid));
}

async function heldWingspan(qid: string): Promise<Held> {
  const d = await api(WD, { action: 'wbgetclaims', entity: qid, property: P_WINGSPAN });
  const claims = ((d.claims as Record<string, unknown[]> | undefined) ?? {})[P_WINGSPAN] ?? [];

  const spans: number[] = [], refUrls: string[] = [];
  for (const raw of claims) {
    const c = raw as {
      mainsnak?: { datavalue?: { value?: { amount?: string; unit?: string } } };
      references?: { snaks?: Record<string, { datavalue?: { value?: unknown } }[]> }[];
    };
    const v = c.mainsnak?.datavalue?.value;
    // A span in anything but metres is not a span we can compare, so it is not one we may source.
    if (v?.amount !== undefined && v.unit?.endsWith(`/${Q_METRE}`) === true) spans.push(Number(v.amount));
    for (const r of c.references ?? []) {
      for (const snak of r.snaks?.[P_REF_URL] ?? []) {
        const u = snak.datavalue?.value;
        if (typeof u === 'string') refUrls.push(u);
      }
    }
  }
  return { spans, refUrls };
}

/** Who does this aircraft's own article say built it — as an ITEM, not as a string.
 *
 *  This is the reciprocal of the manufacturer column, and the direction matters. We do NOT fill our
 *  own file from a Wikipedia infobox: our `manufacturer` column has exactly ONE source, Wikidata's
 *  P176, and it will stay that way. What we do instead is fill P176 — and then our column reads it
 *  on the next run and heals itself.
 *
 *  The gap is IN THE COMMONS. Twenty of our gliders point at an item that does not name its maker:
 *  the PIK-20, the Mini-Nimbus, the Bocian, the Discus. Every one of them has an article whose
 *  infobox says so, and says so as a WIKILINK:
 *
 *      | manufacturer = [[Schempp-Hirth]]
 *
 *  A wikilink is an article, an article is an item, and an item is what P176 wants. So the value we
 *  offer is not a name we typed — it is the identifier of the company, resolved through the same
 *  chain the article itself uses.
 *
 *  Plain text that is not linked (`AB Sportinė Aviacija`) yields nothing: an unresolvable name is a
 *  string, and P176 does not take strings. It stays empty, and empty is the honest answer. */
/** Piped links the commons itself will not vouch for — reported, for a human to settle. */
const piped: { target: string; shown: string }[] = [];

/** Wikilinks whose article does not exist AND whose company Wikidata does not know either. A real gap
 *  in the commons, and one only a human writing the item can close. */
const noCompany: string[] = [];

const linkedName = (link: string): string => (link.split('|')[0] ?? '').trim();

/** An item for a COMPANY of this name — or undefined. The description is the guard and it is the
 *  item's own word: an aircraft named after its maker is not its maker. */
const IS_COMPANY = /\b(company|manufacturer|firm|enterprise|business|corporation|aircraft manufacturer)\b/i;
const IS_AIRCRAFT = /\b(aircraft|glider|sailplane|aeroplane|airplane)\b/i;

async function companyByName(name: string): Promise<string | undefined> {
  if (name === '') return undefined;
  const d = await api(WD, { action: 'wbsearchentities', language: 'en', limit: '6', search: name });
  const hits = (d.search as { id: string; label: string; description?: string }[] | undefined) ?? [];
  for (const h of hits) {
    const desc = h.description ?? '';
    // `type of aircraft` beats `company` in this order deliberately: an item that is BOTH is not a
    // thing, and an item the search calls an aircraft is an aircraft.
    if (IS_AIRCRAFT.test(desc) && !IS_COMPANY.test(desc)) continue;
    if (!IS_COMPANY.test(desc)) continue;
    return h.id;
  }
  noCompany.push(name);
  return undefined;
}

/** The item behind an article title. */
async function qidOfArticle(title: string): Promise<string | null> {
  const w = await api(WP, { action: 'query', prop: 'pageprops', titles: title, redirects: '1' });
  const pages = (w.query as { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> })?.pages ?? {};
  return Object.values(pages)[0]?.pageprops?.wikibase_item ?? null;
}

/** Every name an item answers to: its label, and all its aliases, in every language it has one. */
async function namesOf(qid: string): Promise<string[]> {
  const d = await api(WD, { action: 'wbgetentities', props: 'labels|aliases', ids: qid });
  const e = (d.entities as Record<string, {
    labels?: Record<string, { value: string }>;
    aliases?: Record<string, { value: string }[]>;
  }>)?.[qid];
  if (e === undefined) return [];
  return [
    ...Object.values(e.labels ?? {}).map(l => l.value),
    ...Object.values(e.aliases ?? {}).flat().map(a => a.value),
  ];
}

async function makerFromArticle(qid: string): Promise<{ maker: string; label: string } | null> {
  const title = await articleOf(qid);
  if (title === null) return null;

  const p = await api(WP, {
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
    titles: title, redirects: '1',
  });
  const pages = (p.query as { pages?: Record<string, { revisions?: { slots: { main: { '*': string } } }[] }> })?.pages ?? {};
  const text = Object.values(pages)[0]?.revisions?.[0]?.slots?.main?.['*'];
  if (text === undefined) return null;

  // The field, taken WHOLE — pipes included, because a pipe is the thing we must see.
  const field = /\|\s*manufacturer\s*=\s*([^\n]+)/i.exec(text)?.[1];
  if (field === undefined) return null;

  const link = /\[\[([^\]]+)\]\]/.exec(field)?.[1];
  if (link === undefined) return null;                         // unlinked text is not an item

  // A PIPED LINK SAYS ONE OF TWO THINGS, and they are not the same thing at all.
  //
  //     [[SA Centrair|Centrair]]                 a SHORTENING. Same company, tidier display.
  //     [[Industria Aeronautică Română|ICA]]     an ACRONYM. Probably the same company.
  //     [[Beneš-Mráz|Orličan]]                   TWO DIFFERENT NAMES.
  //
  // That last one is not a display convenience. Beneš-Mráz was nationalised in 1946 and became
  // Orličan; Wikipedia links the successor to its ancestor as a kindness to the reader. The VT-16 is
  // a 1959 glider. Publishing that target into P176 would state that a PRE-WAR company manufactured a
  // post-war sailplane — false about the history, and permanently machine-readable.
  //
  // So: if the DISPLAYED name is contained in the TARGET, the pipe is a shortening and the target is
  // safe. If it is not, the article is showing a name that is not its target's, and that is a
  // JUDGEMENT — which goes to a human, not into a batch. It is reported, never silently dropped and
  // never silently published.
  const [target, shown] = link.split('|').map(x => x.trim());
  if (target === undefined || target === '') return null;

  // On WORD boundaries, and that is not pedantry. A plain substring test let
  // `[[Industria Aeronautică Română|ICA]]` through — because `ica` happens to sit inside
  // `aeronautica`. The answer was right and the reason was a coincidence, which is precisely the
  // shape of every mistake this repository has made. A shortening drops WORDS; it does not slice
  // through the middle of one.
  const words = (x: string): string[] =>
    x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const t = words(target), sh = shown === undefined ? [] : words(shown);

  // EITHER DIRECTION. A pipe hides two kinds of harmless rewrite, and I only allowed one:
  //
  //   SHORTENING   [[SA Centrair|Centrair]]         — the shown name is IN the target's
  //   GLOSS        [[SZD|SZD (Experimental Glider   — the target's name is IN the shown one
  //                     Establishment)]]
  //
  // The second reads as a different name to a subset test that only looks one way, and the SZD-42
  // Jantar's maker was silently refused for it. An annotated name is not another name. What is a
  // different name is one whose words OVERLAP with the target's in neither direction — and that one
  // still goes to the item's own aliases, which is the only thing entitled to answer.
  let ok = sh.length === 0
    || sh.every(w => t.includes(w))         // shortening
    || t.every(w => sh.includes(w));        // gloss

  // AND IF THE NAMES DO NOT OVERLAP, ASK WIKIDATA — it adjudicates its own ambiguity, and I had not
  // thought to let it.
  //
  //   [[Industria Aeronautică Română|ICA]]   the item's own ALIASES include `ICA-Brasov`. The company
  //                                          was re-founded in 1968 under that name. Same firm; the
  //                                          commons says so, in its own voice.
  //   [[Beneš-Mráz|Orličan]]                 I was SURE this one was wrong. Beneš-Mráz was
  //                                          nationalised in 1946 and the VT-16 is a 1959 glider, so
  //                                          publishing the target looked like putting a pre-war
  //                                          firm's name on a post-war sailplane. The item's aliases
  //                                          include `Orličan n. p.` — národní podnik, the
  //                                          nationalised form. Wikidata models the whole lineage as
  //                                          ONE company, and it is right, and I was not.
  //
  // The right question was never "do these two strings look alike", and it was not "what do I know
  // about Czech industrial history" either. It was "DOES THE ITEM ANSWER TO THIS NAME" — and the item
  // is the only thing entitled to say. Asking it corrected me.
  if (!ok && shown !== undefined) {
    const targetQid = await qidOfArticle(target);
    if (targetQid !== null) {
      const names = await namesOf(targetQid);
      const vocab = new Set(names.flatMap(words));
      ok = sh.every(w => vocab.has(w));
    }
  }

  if (!ok) { piped.push({ target, shown }); return null; }
  const linked = target;

  // The linked article's item — the company, by identifier.
  const w = await api(WP, { action: 'query', prop: 'pageprops', titles: linked, redirects: '1' });
  const wp = (w.query as { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> })?.pages ?? {};
  let maker = Object.values(wp)[0]?.pageprops?.wikibase_item;

  // A RED LINK IS NOT A DEAD END. Wikipedia's infobox links `[[Sportinė Aviacija]]` to an article
  // that does not exist — and it is the manufacturer of three of our gliders. An item can exist
  // WITHOUT an article, and that one does: Q3547120, `UAB Sportine aviacija — company`.
  //
  // So when the link goes nowhere, ask Wikidata for the NAME. And guard it, because the search sets a
  // trap that would have been very hard to see: `Eiri-Avion` returns Q1310570 — `Eiri-Avion PIK-20,
  // type of aircraft`. The AEROPLANE, named after the firm that built it. Writing that into P176
  // would state that a glider manufactured ITSELF, and it would state it in a machine-readable field
  // nobody would ever reopen.
  //
  // The description is the guard, and it is the item's own word: `company` yes, `type of aircraft`
  // no. Nothing else this script could compute would tell them apart.
  if (maker === undefined) maker = await companyByName(linkedName(link));
  if (maker === undefined || maker === qid) return null;       // an aircraft is not its own maker

  // A MANUFACTURER IS NOT A PERSON, and the infobox will happily hand us one. Gliding is full of
  // firms named after the man who founded them, and an article that writes
  //     | manufacturer = [[Wolf Hirth]]
  // links to the AVIATOR, not the company. Writing that into P176 would say a human being
  // manufactured an aircraft — a statement that is false about the person, false about the firm, and
  // permanently machine-readable. So the item must not be an instance of human (Q5).
  const inst = await api(WD, { action: 'wbgetclaims', entity: maker, property: 'P31' });
  const claims = ((inst.claims as Record<string, unknown[]> | undefined) ?? {}).P31 ?? [];
  const kinds = claims.map(c =>
    (c as { mainsnak?: { datavalue?: { value?: { id?: string } } } }).mainsnak?.datavalue?.value?.id);
  if (kinds.includes('Q5')) return null;

  return { maker, label: linked };
}

// ---- the run ----
//
// GUARDED, and it should have been from the first line. Without this, importing anything from this
// file RAN it: `bun test` — the command whose entire job is to be safe to run — was hitting the
// Wikidata API a hundred times and REWRITING wikidata.qs, the file a human is about to sign. A test
// suite with a side effect on the artefact under review is not a test suite.
if (!import.meta.main) {
  // Imported for its functions (the tests). Nothing below runs.
} else {

const lines = (await readFile(CSV, 'utf8')).trim().split(/\r?\n/);
const head = cells(lines[0]);
const col = (n: string): number => head.indexOf(n);
const iName = col('name'), iClass = col('wing_class');
const iSpan = col('span_m'), iSrc = col('span_source'), iQid = col('wikidata_qid');
const iTcds = col('easa_tcds'), iUrl = col('easa_url');
const iMaker = col('manufacturer'), iModel = col('model');

interface Claim { name: string; qid: string; span: number; src: string; tcds: string; url: string }
const candidates: Claim[] = [];
/** Items that point at an aircraft whose maker the commons does not name. */
const makerless = new Map<string, string>();      // glider QID → the model, for the printout
/** Statements that ALREADY hold our certified number, and are missing the certificate that proves it. */
const refs: Claim[] = [];
let refAlready = 0;

/** EVERY row that holds a span and an item, INCLUDING the ones we will never offer.
 *
 *  This is the evidence the conflict check needs, and the first version did not gather it. It
 *  compared only the SURVIVORS — and `Ventus A-B (16.6m)` and `Ventus CM (17.6m)` are withheld
 *  earlier (their span comes from their name), so by the time the check ran, `Ventus B (15m)` stood
 *  alone against Q2713118 and looked unanimous. It is not: the item is the Schempp-Hirth VENTUS, the
 *  aircraft, and our own table knows it flies at 15 m, 16.6 m and 17.6 m.
 *
 *  A sibling we may not publish is still a fact about the item. Withholding a row from the batch
 *  must not withhold it from the evidence. */
const knownSpans = new Map<string, Map<number, string[]>>();
let withheldName = 0, alreadyThere = 0, noItem = 0, drifted = 0;
const familyItem: string[] = [];

for (const line of lines.slice(1)) {
  const r = cells(line);
  if (r[iClass] !== 'glider') continue;
  const name = r[iName].replace(/^"|"$/g, '');
  const model = (r[iModel] ?? '').replace(/^"|"$/g, '').trim();
  const qid = (r[iQid] ?? '').trim();
  const tcds = (r[iTcds] ?? '').trim(), url = (r[iUrl] ?? '').trim();

  // WHO BUILT IT is a separate question from HOW WIDE ITS WING IS, and it is asked of every glider
  // that has an item — including the ones whose span we will never offer. A row withheld from the
  // wingspan batch, because its span was read off a file name, still points at an aircraft whose
  // maker the commons does not name. Collecting this AFTER the span filters (where it first sat)
  // asked the question only of the gliders that happened to survive a different one.
  if (qid !== '' && (r[iMaker] ?? '').trim() === '' && !makerless.has(qid)) makerless.set(qid, model);

  const span = num(r[iSpan]);
  if (span === null) continue;

  // The evidence is gathered FIRST, from every row alike. What we may publish and what we know are
  // two different questions, and the second one decides the first.
  if (qid !== '') {
    const byItem = knownSpans.get(qid) ?? new Map<number, string[]>();
    byItem.set(span, [...(byItem.get(span) ?? []), name]);
    knownSpans.set(qid, byItem);
  }

  // A span read off a FILE NAME is our reading of a VARIANT and the item is the AIRCRAFT: withheld.
  // The other two may be offered — and they are offered with DIFFERENT references, which is the whole
  // point of keeping their provenance apart.
  const src = r[iSrc];
  if (src !== 'wikipedia' && src !== 'easa') { withheldName++; continue; }
  if (qid === '') { noItem++; continue; }

  // ---- A FAMILY IS NOT AN AIRCRAFT, AND IT HAS NO WINGSPAN ----
  //
  // Q1019853 is `Bölkow Phoebus`, and Wikidata's own description of it reads:
  //
  //        1964 competition sailplane FAMILY
  //
  // Our row is the Phoebus C, whose certificate — EASA.A.635, read from its section heading — states
  // 17 m. The A and the B, in the same document, state 15. So the batch was about to write SEVENTEEN
  // METRES, with a certification authority's URL behind it, onto an item that stands for three
  // aircraft of two different spans. Nobody reading that statement afterwards could tell it was
  // about only one of them.
  //
  // This is the variant-versus-aircraft trap, which this file already withholds name-sourced spans to
  // avoid — arriving from the other side. There the VARIANT was too specific for the item; here the
  // ITEM is too general for the aircraft. Same error, opposite direction, and the guard I had built
  // only watched one door.
  //
  // Wikidata says which items those are, in plain words, in the description field. Ask it.
  if (await isFamily(qid)) { familyItem.push(`${name} → ${qid} (${await describe(qid)})`); continue; }

  const held = await heldWingspan(qid);
  if (held.spans.length > 0) {
    alreadyThere++;
    // The item already states a span — so we add no value. But if OUR span is CERTIFIED, and the
    // span already there is the same number, then the certificate is a reference that statement is
    // missing. Offering it takes nothing away from whoever wrote it: it tells the world where to
    // check them, and it is the only way a span stops being a reading of an encyclopaedia.
    //
    // Only on an EXACT match. A certificate attached to a value it does not attest would be a lie of
    // the worst kind — a source that looks like it corroborates and does not — and a disagreement
    // between EASA and a human contributor is a question for a human, not for this script.
    if (src === 'easa' && url !== '' && held.spans.some(v => Math.abs(v - span) <= 0.005)) {
      if (held.refUrls.includes(url)) refAlready++;
      // One item, one line. `Duo Discus (PAS)` and `Duo Discus (PIL)` are the same glider with and
      // without a passenger, they point at the same item, and they were emitting the same reference
      // twice. QuickStatements would have absorbed it; that is not a reason to hand it the job of
      // tidying after us.
      else if (!refs.some(x => x.qid === qid)) refs.push({ name, qid, span, src, tcds, url });
    }
    continue;
  }
  // Only the Wikipedia-sourced spans need the article re-read: an EASA span does not come from an
  // article and cannot drift with one. Its source is a signed PDF at a stable URL.
  if (src === 'wikipedia' && !await articleStillSays(qid, span)) { drifted++; continue; }
  candidates.push({ name, qid, span, src, tcds, url });
}

// ---- several rows, one item: agreement or conflict? ----
//
// Several of our polar rows legitimately describe ONE aircraft. `PIK-20B`, `PIK-20D` and `PIK-20E`
// are variants of the PIK-20; `ASH-25M 1` and `ASH-25M 2` are the same glider at two pilot loadings.
// Pointing them all at one item is CORRECT — link-wikidata does exactly that on purpose.
//
// So a shared item is not, by itself, an error. What matters is whether the rows AGREE:
//
//   · they agree on the span → it is one aircraft seen several times, and the span is the
//     aircraft's. Offered ONCE.
//   · they disagree → at least one of them is wrong about this item, and we cannot tell which. That
//     is the `ASG29-15` / `ASG29-18` shape: two real gliders, two real spans, one item that is the
//     AIRCRAFT and is neither. Withheld ENTIRELY — the guess belongs to a human, and this script's
//     job is to hand over a batch that needs no re-checking.
//
// The blunter rule this replaces withheld the agreeing groups too. It cost three true statements to
// buy a safety it was already getting elsewhere: the wrong match that first motivated it (a 17 m
// DG-400 about to be published onto the DG-200's item) is now refused upstream by titleMatches,
// which is where a wrong MATCH should die — not here, where only a wrong VALUE should.
const byQid = new Map<string, typeof candidates>();
for (const c of candidates) byQid.set(c.qid, [...(byQid.get(c.qid) ?? []), c]);

const offered: typeof candidates = [];
const conflicted: { qid: string; spans: Map<number, string[]> }[] = [];
for (const [qid, group] of byQid) {
  // Every span OUR TABLE holds against this item — not merely the ones that reached this far.
  const all = knownSpans.get(qid) ?? new Map<number, string[]>();
  if (all.size === 1) offered.push(group[0]);          // one aircraft, one answer
  else conflicted.push({ qid, spans: all });           // one item, several: not ours to pick
}
const withheldConflict = conflicted.reduce((n, c) => n + [...c.spans.values()].flat().length, 0);

// QuickStatements v1 (tab-separated). `15U11573` is "15, in units of Q11573 (metre)".
//
// TWO KINDS OF REFERENCE, and the difference is the reason span_source exists as a column.
//
//   easa      → `reference URL` = the TCDS PDF, plus the date we read it. A claim anybody can check
//               in one click, against the document the certification authority signed. This is what
//               the EASA pass BOUGHT: it corrected not one span — it agreed with Wikipedia 43 times
//               out of 43 — and what it changed is not the number but what stands behind it.
//   wikipedia → `imported from English Wikipedia`. Weak, and honest about being weak: it says where
//               the number came from and invites anyone to replace it with exactly the above.
//
// Offering both under one reference would have thrown away the only thing that distinguishes them.
const refOf = (o: Claim): string =>
  o.src === 'easa' && o.url !== ''
    ? `${S_URL}\t"${o.url}"\t${S_RETRIEVED}\t+${TODAY}T00:00:00Z/11`
    : `${S_IMPORTED}\t${Q_EN_WIKI}`;

// ---- who built it: filling a gap that is IN THE COMMONS ----
//
// Our `manufacturer` column has exactly ONE source and will keep exactly one: Wikidata's P176. So
// when twenty of our gliders point at an item that does not name its maker, the answer is NOT to
// patch our own file from a Wikipedia infobox — it is to fill P176, and let our column read it on
// the next run and heal itself. The gap is in the commons; that is where it gets closed.
const makers: { qid: string; maker: string; model: string; label: string }[] = [];
let makerUnresolved = 0;
for (const [qid, model] of makerless) {
  const m = await makerFromArticle(qid);
  if (m === null) { makerUnresolved++; continue; }
  makers.push({ qid, maker: m.maker, model, label: m.label });
}

// The references go in the SAME file: QuickStatements matches an existing statement on
// (item, property, value) and attaches the reference to it rather than creating a duplicate.
const line = (o: Claim): string => `${o.qid}\t${P_WINGSPAN}\t${o.span}U${Q_METRE.slice(1)}\t${refOf(o)}`;
const makerLine = (m: { qid: string; maker: string }): string =>
  `${m.qid}\t${P_MAKER}\t${m.maker}\t${S_IMPORTED}\t${Q_EN_WIKI}`;
const all = [...offered.map(line), ...refs.map(line), ...makers.map(makerLine)].join('\n');
if (familyItem.length > 0) {
  console.log(`WITHHELD — the item is a FAMILY, and a family has no wingspan. It has several, and any
one number written there is a claim about one aircraft dressed as a claim about all of them.
Wikidata says so itself, in its own description, and we are taking it at its word:`);
  for (const f of familyItem) console.log(`  ${f}`);
  console.log('');
}

await writeFile(OUT, all + (all ? '\n' : ''));

console.log(`
gliders with a span:              ${candidates.length + withheldName + alreadyThere + noItem + drifted}
  withheld (span from the NAME)   ${withheldName}   ← our reading of a variant; the item is the aircraft
  already carry a wingspan        ${alreadyThere}   ← we fill gaps, we do not overwrite people
  the item is a FAMILY            ${familyItem.length}   ← a family has no wingspan: it has several
     of those, we can CERTIFY     ${refs.length}   ← same number, and we hold the type certificate
     already cite the certificate ${refAlready}
  no Wikidata item                ${noItem}   ← link-wikidata found none it could corroborate
  article no longer says this     ${drifted}   ← a stale reading is not a thing to publish
  withheld: CONFLICTING spans     ${withheldConflict}   ← one item, two answers: not ours to pick
  OFFERED for review              ${offered.length}
`);

if (conflicted.length > 0) {
  console.log('  items our own table gives SEVERAL spans — withheld, because the item is the AIRCRAFT:');
  for (const c of conflicted) {
    console.log(`    ${c.qid}`);
    for (const [span, names] of c.spans) console.log(`        ${String(span).padStart(6)} m  ${names.join(', ')}`);
  }
  console.log('');
}

for (const o of offered) {
  console.log(`  ${o.qid.padEnd(11)} ${o.name.padEnd(24)} ${String(o.span).padStart(6)} m   ${o.src === 'easa' ? o.tcds : 'en.wikipedia'}`);
}

if (refs.length > 0) {
  console.log('  and these — the SAME number, already on Wikidata, now with the certificate that proves\n  it. No value changes; only the source. This is what takes a span out of the Wikipedia loop:\n');
  for (const o of refs) {
    console.log(`  ${o.qid.padEnd(11)} ${o.name.padEnd(24)} ${String(o.span).padStart(6)} m   ${o.tcds}`);
  }
  console.log('');
}

if (makers.length > 0) {
  console.log(`  and the MAKERS — ${makers.length} items that point at an aircraft and do not say who built it.\n  Our manufacturer column reads P176 and nothing else, so this is where the gap gets closed:\n`);
  for (const m of makers) {
    console.log(`  ${m.qid.padEnd(11)} ${m.model.padEnd(24)} ${P_MAKER} → ${m.maker.padEnd(10)} ${m.label}`);
  }
  if (makerUnresolved > 0) {
    console.log(`\n  (${makerUnresolved} more state a maker in plain text, unlinked. A string is not an item, and`);
    console.log(`   P176 does not take strings. They stay empty, and empty is the honest answer.)`);
  }
  console.log('');
}

if (noCompany.length > 0) {
  console.log('  The article links these makers to an article that does NOT EXIST, and Wikidata knows no');
  console.log('  company by that name either. A red link with nothing behind it. Only a human writing');
  console.log('  the item can close this one — it is a gap in the commons, not in our file:\n');
  for (const n of [...new Set(noCompany)]) console.log(`    ${n}`);
  console.log('');
}

if (piped.length > 0) {
  console.log('  A HUMAN MUST SETTLE THESE. The article links to one company and DISPLAYS another:\n');
  for (const p of piped) console.log(`    [[${p.target}|${p.shown}]]   — is ${p.shown} the same firm as ${p.target}?`);
  console.log('\n  `[[Beneš-Mráz|Orličan]]` is the reason this check exists: the firm was nationalised in');
  console.log('  1946 and became Orličan, and the VT-16 is a 1959 glider. Publishing the target would');
  console.log('  say a PRE-WAR company built a post-war sailplane. Add the answer to aliases.csv, or');
  console.log('  put P176 on the item by hand — but do not let a script decide it.\n');
}

console.log(`
Written to wikidata.qs — ${offered.length + refs.length + makers.length} line(s): ${offered.length} new span(s), ${refs.length} certificate(s), ${makers.length} manufacturer(s).

Nothing has been edited. To contribute, READ the batch above (a human who knows gliders will spot
a wrong one in a way no cross-check can), then paste the file into QuickStatements:

    https://quickstatements.toolforge.org/#/batch

It runs under YOUR account and YOUR name. That is not a limitation of this script — it is the
point of it. A statement about the world is a claim, and a claim needs someone to answer for it.`);

}
