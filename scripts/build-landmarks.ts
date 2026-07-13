// ============ build datasets/landmarks — the visual reference ============
// The only waypoints this repository ships, and the reason it may ship them: they do not change.
// A coastline, a border, a lake, a named summit — a pilot navigates BY these, and none of them
// will have moved by the next release. That is the entire admissibility test.
//
// What is deliberately NOT built here: aerodromes (they close, they change frequency, they go
// private) and outlanding fields (whose choice is the pilot's judgement and the pilot's
// responsibility, and must never be laundered through a library that has never seen the crop).
//
// Source: Natural Earth, public domain. We take the small scales on purpose — this is a frame
// for the eye, not a survey.
//
// The output is a Frictionless Data Package: CSV where the data is tabular (peaks), GeoJSON
// where it is geometry (lines and polygons), and a datapackage.json that states the schema, the
// licence and the provenance of every one of them. Nothing here needs our code to be read.

import { mkdir, writeFile } from 'node:fs/promises';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const OUT = new URL('../datasets/landmarks/', import.meta.url).pathname;

/** Coordinates rounded to 3 decimals — about 100 m, far finer than a 1:110m line was ever
 *  surveyed to. Keeping fifteen digits would be storing noise and calling it precision. */
const R = 1000;
const round = (v: unknown): unknown =>
  typeof v === 'number' ? Math.round(v * R) / R : Array.isArray(v) ? v.map(round) : v;

interface Feature { type: string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }

async function fetchGeo(layer: string): Promise<Feature[]> {
  const r = await fetch(`${NE}/${layer}.geojson`);
  if (!r.ok) throw new Error(`${layer}: HTTP ${r.status}`);
  const j = await r.json() as { features: Feature[] };
  return j.features;
}

/** Geometry, stripped to geometry. Natural Earth ships dozens of attribute columns per feature
 *  (scalerank, min_zoom, wikidataid, names in thirty languages); a map that draws a coastline
 *  needs the line. Dropping them is most of the size. */
async function geometryPack(layer: string, out: string, keep: string[] = []): Promise<number> {
  const features = await fetchGeo(layer);
  const slim = features.map(f => ({
    type: 'Feature' as const,
    properties: Object.fromEntries(keep.map(k => [k, f.properties[k]]).filter(([, v]) => v != null)),
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  }));
  const json = JSON.stringify({ type: 'FeatureCollection', features: slim });
  await writeFile(OUT + out, json + '\n');
  return json.length;
}

/** The peaks, as a TABLE — because they are one: a name, a place, a height. A GeoJSON of points
 *  would be a table wearing a costume, and a CSV is what every tool on earth can already open. */
async function peaksCsv(): Promise<number> {
  const features = await fetchGeo('ne_10m_geography_regions_elevation_points');
  const rows = features
    .map(f => ({
      name: String(f.properties.name ?? '').trim(),
      kind: String(f.properties.featurecla ?? '').trim(),      // 'mountain', 'depression', …
      elev_m: f.properties.elevation,
      lon: (f.geometry.coordinates as [number, number])[0],
      lat: (f.geometry.coordinates as [number, number])[1],
    }))
    // A landmark with no name is not a landmark — it is a dot nobody can refer to. And an
    // elevation we cannot read stays EMPTY in the CSV, never a zero: a summit at 0 m would be
    // a summit at sea level, which is a lie a chart would draw.
    .filter(r => r.name !== '' && Number.isFinite(r.lon) && Number.isFinite(r.lat))
    .sort((a, b) => a.name.localeCompare(b.name));

  const esc = (s: string): string => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const csv = ['name,kind,elev_m,lon,lat']
    .concat(rows.map(r => [
      esc(r.name), esc(r.kind),
      Number.isFinite(r.elev_m as number) ? String(r.elev_m) : '',   // empty, never 0
      (Math.round(r.lon * 1e5) / 1e5).toString(),
      (Math.round(r.lat * 1e5) / 1e5).toString(),
    ].join(',')))
    .join('\n') + '\n';
  await writeFile(OUT + 'peaks.csv', csv);
  return rows.length;
}

await mkdir(OUT, { recursive: true });

const coast = await geometryPack('ne_110m_coastline', 'coastline.geojson');
const borders = await geometryPack('ne_110m_admin_0_boundary_lines_land', 'borders.geojson');
const lakes = await geometryPack('ne_110m_lakes', 'lakes.geojson', ['name']);
const peaks = await peaksCsv();

const today = new Date().toISOString().slice(0, 10);

// The Data Package. Every resource states what it is, where it came from, and under what terms —
// so a consumer never has to ask us, and never has to guess.
const pkg = {
  name: 'soaring-landmarks',
  title: 'Visual landmarks for soaring navigation',
  description:
    'Coastlines, national borders, lakes and named peaks — a visual reference a pilot navigates BY. '
    + 'Deliberately contains NO aerodromes (they change) and NO outlanding fields (their choice is the '
    + "pilot's judgement and responsibility). Everything here is geographically stable.",
  profile: 'data-package',
  created: today,
  licenses: [{
    name: 'CC0-1.0',
    title: 'Public domain (Natural Earth)',
    path: 'https://www.naturalearthdata.com/about/terms-of-use/',
  }],
  sources: [{
    title: 'Natural Earth (1:110m physical & cultural; 1:10m elevation points)',
    path: 'https://www.naturalearthdata.com/',
  }],
  resources: [
    {
      name: 'peaks', path: 'peaks.csv', profile: 'tabular-data-resource',
      format: 'csv', mediatype: 'text/csv', encoding: 'utf-8',
      title: `Named peaks (${peaks})`,
      dialect: { delimiter: ',', header: true },
      schema: {
        // Composite, and it has to be: the world holds two Mount Olympuses and four Black
        // Mountains, and every one of them is a real landmark. A name is not an identity.
        primaryKey: ['name', 'lon', 'lat'],
        fields: [
          { name: 'name', type: 'string', title: 'Landmark name', description: 'Not unique on its own — see the key.' },
          { name: 'kind', type: 'string', title: 'Natural Earth feature class', description: "e.g. 'mountain', 'range/mtn', 'depression'." },
          { name: 'elev_m', type: 'integer', title: 'Elevation (m)', description: 'EMPTY when the source gives none — never zero, which would place a summit at sea level.' },
          { name: 'lon', type: 'number', title: 'Longitude (°, WGS84, east positive)' },
          { name: 'lat', type: 'number', title: 'Latitude (°, WGS84, north positive)' },
        ],
      },
    },
    { name: 'coastline', path: 'coastline.geojson', format: 'geojson', mediatype: 'application/geo+json', title: 'World coastline (1:110m)' },
    { name: 'borders', path: 'borders.geojson', format: 'geojson', mediatype: 'application/geo+json', title: 'National borders, land (1:110m)' },
    { name: 'lakes', path: 'lakes.geojson', format: 'geojson', mediatype: 'application/geo+json', title: 'Lakes (1:110m)' },
  ],
};
await writeFile(OUT + 'datapackage.json', JSON.stringify(pkg, null, 2) + '\n');

const kb = (n: number): string => (n / 1024).toFixed(0) + ' KB';
console.log(`landmarks built (Natural Earth, public domain)
  peaks.csv           ${peaks} named landmarks
  coastline.geojson   ${kb(coast)}
  borders.geojson     ${kb(borders)}
  lakes.geojson       ${kb(lakes)}`);
