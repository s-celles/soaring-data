# soaring-data

Data for soaring, published as **open, self-describing packages** — and, more importantly, a
**discipline about which data may be shipped at all**.

Everything here is a [Frictionless **Data Package**](https://specs.frictionlessdata.io/): a
`datapackage.json` that states the schema, the licence, the provenance and the update date of
every resource beside it. Nothing is a bare file you have to guess the meaning of, and nothing
is a format you need our code to read: CSV and GeoJSON, described in a standard anyone can
validate.

## Two kinds of thing, and the difference is the whole design

- **`catalogue/`** — **pointers**, and nothing else. Not one byte of airspace.
- **`datasets/`** — the only data we ship: things that **do not change**.

## Why there is no airspace in this repository

Because **an airspace file goes wrong faster than a repository can be updated**, and a wrong
airspace file is worse than none: it is a TMA the pilot believes he is clear of.

Airspace is maintained by the people who are close to it — national authorities, federations,
volunteer teams — and they republish it as it changes. The French files, for instance, live at
[`planeur-net/airspace`](https://github.com/planeur-net/airspace) and are regenerated and served
continuously. If we mirrored them here, we would sooner or later hand a pilot a stale copy of a
file whose maintainers had already corrected it — and he would have no way of knowing which one
he was holding.

So the catalogue **points**, and the app downloads from the source, shows the date, and says how
old it is. Three fields carry that honesty, and each exists because its absence misleads:

| Field | Why |
|---|---|
| `licence` + `redistributable` | may an app that caches this file also **share** it? Unknown is `null` — which is **not** the same as "yes". |
| `updated` | an airspace file is dangerous when stale. The app must be able to say how old it is — **including "age unknown"**. |
| `coverage` | what the file holds **and what it does not**. |

## The waypoints we ship are landmarks — not airfields, not fields to land in

This is a safety rule, not a scoping one.

- **No aerodromes.** A runway closes, a frequency changes, a field goes private. An AD database
  frozen in a repository is a database that is quietly wrong — and wrong about the one thing a
  pilot would act on. Aerodromes belong in the pilot's own current file, or behind a catalogue
  entry that carries a date.
- **No outlanding fields.** Choosing where to put a glider down is the **pilot's** judgement and
  the pilot's responsibility. A list shipped by a library would launder that responsibility into
  a machine that has never seen the crop, the wires, or the slope.
- **What remains is what a pilot navigates _by_, and it is stable for centuries:** coastlines,
  borders, lakes, named peaks. A summit does not move. That is exactly why it is here.

`datasets/landmarks/` is a **visual reference** — so a pilot can see where in the world he is.
It is never a database of places to go.

> **Source:** [Natural Earth](https://www.naturalearthdata.com/) — **public domain**.
> Coastlines, national borders and lakes at 1:110m; 711 named peaks with elevation at 1:10m.

## `datasets/spots/` — 58 gliding sites, CC-BY-4.0

A curated, editorial list of *notable soaring places* — meant for **discovery**, so that someone
new to the sport can go and look at where it happens.

It is **not a navigation database and must never be used as one.**

## Layout

```
catalogue/        datapackage.json + catalogue.csv    — pointers to files we do NOT host
datasets/
  landmarks/      datapackage.json + peaks.csv + *.geojson   (public domain)
  spots/          datapackage.json + spots.csv               (CC-BY-4.0)
scripts/          build the packages; validate them; check every link is alive
```

## Licences

- **Scripts and schemas**: AGPL-3.0, like the rest of the family.
- **`datasets/landmarks/`**: public domain (Natural Earth).
- **`datasets/spots/`**: CC-BY-4.0.
- **Everything the catalogue points at**: belongs to whoever publishes it. Read the entry.

_Assisted by AI._

## The wingspans, and what stands behind them

`span_source` says where each one came from, because the three sources are not worth the same and
must not be pooled:

| source | what it is |
|---|---|
| `easa` | the Dimensions field of the aircraft's EASA Type Certificate Data Sheet. The certification authority's own document, linked in `easa_url` |
| `name` | read off the polar's own file name (`Ventus B (15m)`) — and only when the name says `m`, in lowercase |
| `wikipedia` | the English Wikipedia aircraft infobox, cross-checked against our own wing area |

The EASA pass corrected **nothing**: it agreed with Wikipedia 43 times out of 43. What it changed is
not the number but what stands behind it — a claim anyone can check in one click, against a signed
document, instead of a claim you have to take on trust.

And it is refused wherever it would be confidently wrong. A TCDS states the span of the aircraft **as
certified**, and a glider with removable tips flies a span its certificate does not name: EASA.A.047
says *"optionally 18 m span with winglets or 15 m span with winglets"* and then states 15.00 m. The
most authoritative source is not the safest source — it is answering a different question than ours.

Regenerating them needs `pdftotext`:

    brew install poppler
    just classify-gliders && just link-wikidata && just easa-tcds
