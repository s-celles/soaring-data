# soaring-data — task runner. `just` lists the recipes.
default:
    @just --list

# Rebuild the landmarks package from Natural Earth (public domain)
build:
    bun run scripts/build-landmarks.ts

# Schema check + EVERY catalogued link fetched. A catalogue of dead links is worse than none.
validate:
    bun run scripts/validate.ts

# The schema half only — no network (for a plane, or a bad hotel)
validate-offline:
    bun run scripts/validate.ts --offline

check: validate

# Re-verify every spot's code against the OGN FlightBook and stamp the check date
check-spots:
    bun run scripts/check-spots.ts

# Establish each glider's wingspan (name, then Wikipedia — cross-checked against our own wing
# area) and its FAI class where the span alone settles it. Idempotent: a span already held is
# not looked up again.
classify-gliders:
    bun run scripts/classify-gliders.ts

# Propose our wingspans back to Wikidata (writes wikidata.qs; edits NOTHING)
wikidata-contribute:
    bun run scripts/wikidata-contribute.ts

# The whole chain, in the one order that is correct: name -> Wikipedia -> Wikidata item -> certificate
wikidata: classify-gliders link-wikidata easa-tcds wikidata-contribute

# Resolve each polar's Wikidata item and write it into polars.csv (wikidata_qid)
link-wikidata:
    bun run scripts/link-wikidata.ts

# Replace Wikipedia spans with the span EASA certified (needs: brew install poppler)
easa-tcds:
    bun run scripts/easa-tcds.ts
