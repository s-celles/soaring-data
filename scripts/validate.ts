// ============ validate the packages, and the promises they make ============
// Two jobs, and the second is the one that earns its keep.
//
// 1. The SCHEMA: every package declares its fields, types and constraints in its
//    datapackage.json (Frictionless). This checks the CSV actually honours them — because a
//    schema nobody enforces is documentation, and documentation drifts.
//
// 2. The LINKS: the catalogue is nothing BUT links. A catalogue of dead links is worse than no
//    catalogue at all — it is a pilot on the ground, before a flight, being told that his
//    airspace file is "available" when it is not. So every uri is fetched, and a dead one fails
//    the build rather than sitting there looking helpful.
//
// Exit code is the verdict: this is meant to run in CI, on a schedule, so a source that
// disappears is noticed by us and not by a pilot.

import { readFile } from 'node:fs/promises';

interface Field { name: string; type: string; constraints?: { required?: boolean; unique?: boolean; enum?: string[]; minimum?: number; maximum?: number } }
interface Resource { name: string; path: string; profile?: string; schema?: { primaryKey?: string | string[]; fields: Field[] } }
interface Package { name: string; resources: Resource[]; licenses?: { name: string }[] }

const ROOT = new URL('../', import.meta.url).pathname;
const problems: string[] = [];
const note = (s: string): void => { problems.push(s); };

/** A CSV row splitter that honours quotes — a `coverage` field is a sentence, and sentences
 *  contain commas. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const TYPE_OK: Record<string, (v: string) => boolean> = {
  string: () => true,
  integer: v => v === '' || /^-?\d+$/.test(v),
  number: v => v === '' || Number.isFinite(Number(v)),
  // EMPTY IS A VALUE HERE, and it is the one this repository is built around. `camber_flaps` is
  // blank for the gliders whose wing no certificate and no polar has told us about, and a blank a
  // human can see is worth more than a `false` nobody will re-check. Every other type in this table
  // already allows it; boolean was the odd one out, and it was the odd one out by accident.
  boolean: v => v === '' || v === 'true' || v === 'false',
  date: v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v),
};

// ---- the invariants of the polars package ----
//
// These are not schema checks — the schema cannot express them. They are the three ways this dataset
// has actually been corrupted, each by a script that was individually correct:
//
//  1. A row contradicted its own NAME. `DG-400 (17m)` held 15 m, because a TYPE CERTIFICATE says 15
//     (the aircraft is certified at 15 m with optional tips) and the certificate is the strongest
//     source there is. The strongest source is not the safest source. Two adjacent cells disagreed,
//     and only a human reading the file would ever have seen it.
//
//  2. A span was labelled `easa` with NO certificate beside it. That happened when a later, stricter
//     run correctly REFUSED to make a change, and thereby preserved the wrong value an earlier run
//     had already written — laundering its own mistake. A refusal is only as good as the file it
//     lands on.
//
//  3. A certified span was silently OVERWRITTEN by an encyclopaedia's, because classify-gliders did
//     not know `easa` was a source it must not touch. All 55 of them, destroyed by running the tools
//     in a different order. A dataset must not depend on which tool touched it last.
//
// Every one of these was invisible to the schema, invisible to the tests, and invisible in the
// terminal output. They are checked here so that the next one is not.
function checkPolarInvariants(rows: Record<string, string>[]): void {
  // ---- the two airframe facts, and the promises they carry ----
  //
  // A VALUE AND ITS SOURCE STAND OR FALL TOGETHER. A seat count with no source is a number nobody
  // can go and check; a source with no number is a claim to have looked and found nothing, recorded
  // in the wrong column. Both are how a guess ends up looking like a reading.
  for (const r of rows) {
    for (const [v, src] of [['seats', 'seats_source'], ['camber_flaps', 'camber_flaps_source']]) {
      if ((r[v] !== '') !== (r[src] !== '')) {
        note(`${r.name}: ${v}='${r[v]}' and ${src}='${r[src]}' — a value and its source stand or fall together`);
      }
    }
    // `easa` means A CERTIFICATE SAID SO, and the certificate must be named in the same row. This is
    // the invariant that catches the laundering: a refusal that leaves the old value behind ends up
    // with `easa` beside an empty easa_tcds — a certified fact with no certificate.
    for (const src of ['seats_source', 'camber_flaps_source']) {
      if (r[src] === 'easa' && (r.easa_tcds ?? '') === '') {
        note(`${r.name}: ${src}=easa and NO easa_tcds — a certified fact with no certificate behind it`);
      }
    }
    // A POLAR WITH FLAP SETTINGS IS A FLAPPED WING. Somebody flew it at each setting and wrote the
    // speeds down; that is a measurement, and it may not sit beside `camber_flaps=false`.
    const settings = Number(r.flaps_count ?? '');
    if (Number.isFinite(settings) && settings >= 2 && r.camber_flaps === 'false') {
      note(`${r.name}: the polar records ${settings} flap settings and camber_flaps says false`);
    }
  }

  const spanInName = (n: string): number | null => {
    const m = /(?:^|[-\s_(])(\d{2}(?:[.,]\d)?)\s*m\b/.exec(n);
    if (m === null) return null;
    const v = Number(m[1].replace(',', '.'));
    return v >= 12 && v <= 30 ? v : null;
  };

  for (const r of rows) {
    const name = r.name ?? '';
    const span = r.span_m === '' || r.span_m === undefined ? null : Number(r.span_m);
    const src = r.span_source ?? '';
    const tcds = r.easa_tcds ?? '';

    const named = spanInName(name);
    if (span !== null && named !== null && Math.abs(span - named) > 0.05) {
      note(`polars: ${name} holds ${span} m, and its own name says ${named} m`);
    }
    if (src === 'easa' && tcds === '') {
      note(`polars: ${name} claims a certified span with no certificate beside it`);
    }
    if (tcds !== '' && src !== 'easa') {
      note(`polars: ${name} carries a certificate (${tcds}) but its span is sourced from '${src}'`);
    }
    if (span !== null && src === '') {
      note(`polars: ${name} holds a span of ${span} m from nowhere — span_source is empty`);
    }
    // A span READ OFF AN ARTICLE means the article was found, and an article has an item. A row that
    // says `wikipedia` and carries no identifier is a row that contradicts itself: we looked, we
    // corroborated, we took the number — and then recorded that the glider has no Wikidata item.
    // Four gliders were in that state and nothing noticed, because an empty cell is also what an
    // honest "not found" looks like.
    if (src === 'wikipedia' && (r.wikidata_qid ?? '') === '') {
      note(`polars: ${name} took its span from an article and has no Wikidata item — one of the two is wrong`);
    }

    // The maker's LABEL and the maker's IDENTIFIER are one fact rendered two ways. A row that has one
    // and not the other is a row where the rendering has drifted from the thing it renders — and the
    // label is the half a human reads, so that is the half that would go unnoticed.
    const maker = r.manufacturer ?? '', makerQid = r.manufacturer_qid ?? '';
    if ((maker === '') !== (makerQid === '')) {
      note(`polars: ${name} has a manufacturer '${maker}' and an identifier '${makerQid}' — one without the other`);
    }
    // A maker we borrowed requires an aircraft we identified. There is nowhere else it could have
    // come from, and if it did, it came from a provenance this column does not have.
    if (makerQid !== '' && (r.wikidata_qid ?? '') === '') {
      note(`polars: ${name} names a maker but no aircraft item — the maker is borrowed from the aircraft's item, so it cannot exist without one`);
    }
  }
}

async function checkPackage(dir: string): Promise<string[]> {
  const uris: string[] = [];
  const pkg: Package = JSON.parse(await readFile(`${ROOT}${dir}/datapackage.json`, 'utf8'));
  if (!pkg.licenses?.length) note(`${dir}: the package states no licence — a consumer must never have to guess`);

  for (const res of pkg.resources) {
    if (res.profile !== 'tabular-data-resource' || !res.schema) continue;
    const text = await readFile(`${ROOT}${dir}/${res.path}`, 'utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    const header = cells(lines[0]);
    const declared = res.schema.fields.map(f => f.name);
    if (header.join() !== declared.join()) {
      note(`${dir}/${res.path}: header ${header.join()} does not match the declared schema ${declared.join()}`);
      continue;
    }

    // The polars package carries claims the schema cannot express — see checkPolarInvariants.
    if (res.path.endsWith('polars.csv')) {
      checkPolarInvariants(lines.slice(1).map(line => {
        const row = cells(line);
        return Object.fromEntries(header.map((h, c) => [h, (row[c] ?? '').replace(/^"|"$/g, '')]));
      }));
    }

    // The key may be one column or several — a landmark's name is not an identity (two Mount
    // Olympuses, four Black Mountains), so its key is (name, lon, lat).
    const key = res.schema.primaryKey;
    const keyCols = key == null ? [] : Array.isArray(key) ? key : [key];
    const seen = new Set<string>();
    lines.slice(1).forEach((line, i) => {
      const row = cells(line);
      const where = `${dir}/${res.path}:${i + 2}`;
      const val = (c: number): string => (row[c] ?? '').replace(/^"|"$/g, '');
      res.schema!.fields.forEach((f, c) => {
        const v = val(c);
        if (f.constraints?.required && v === '') note(`${where}: ${f.name} is required and empty`);
        if (!(TYPE_OK[f.type] ?? (() => true))(v)) note(`${where}: ${f.name}='${v}' is not a ${f.type}`);
        if (f.constraints?.enum && v !== '' && !f.constraints.enum.includes(v))
          note(`${where}: ${f.name}='${v}' is not one of ${f.constraints.enum.join('|')}`);
        // The numeric bounds are not decoration. A polar's sink must be NEGATIVE — a positive one
        // is a glider that climbs in still air, and the least-squares fit downstream would return
        // a curve promising exactly that, confidently. A wing area must be POSITIVE — a zero is a
        // wing loading of infinity, and a solver handed that does not fail, it answers. Declaring
        // the bound and not checking it would be the documentation drift this file exists to stop.
        const { minimum, maximum } = f.constraints ?? {};
        if (v !== '' && (minimum != null || maximum != null)) {
          const n = Number(v);
          if (!Number.isFinite(n)) note(`${where}: ${f.name}='${v}' is bounded but not a number`);
          else if (minimum != null && n < minimum) note(`${where}: ${f.name}=${n} is below the declared minimum ${minimum}`);
          else if (maximum != null && n > maximum) note(`${where}: ${f.name}=${n} is above the declared maximum ${maximum}`);
        }
        if (f.name === 'uri' && v !== '') uris.push(v);
      });
      if (keyCols.length) {
        const k = keyCols.map(n => val(declared.indexOf(n))).join('\u0001');
        if (seen.has(k)) note(`${where}: duplicate key (${keyCols.join(', ')}) = ${k.replace(/\u0001/g, ', ')}`);
        seen.add(k);
      }
    });
  }
  return uris;
}

// ---- the packages ----
const dirs = ['catalogue', 'datasets/landmarks', 'datasets/polars', 'datasets/spots'];
const uris: string[] = [];
for (const d of dirs) uris.push(...await checkPackage(d));

// ---- the links (see the header: this is the half that matters) ----
if (!process.argv.includes('--offline')) {
  await Promise.all(uris.map(async uri => {
    try {
      // GET, not HEAD: a few of these servers answer HEAD with 405 while serving the file
      // perfectly well, and a validator that fails on THAT would be crying wolf.
      const r = await fetch(uri, { signal: AbortSignal.timeout(25_000) });
      if (!r.ok) note(`DEAD LINK ${r.status}: ${uri}`);
      else if ((await r.arrayBuffer()).byteLength === 0) note(`EMPTY FILE: ${uri}`);
    } catch (e) {
      note(`UNREACHABLE (${e instanceof Error ? e.message : String(e)}): ${uri}`);
    }
  }));
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ ${dirs.length} packages valid; ${uris.length} catalogued link(s) alive`);
