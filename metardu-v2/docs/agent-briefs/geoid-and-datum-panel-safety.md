# Geoid and Datum Panel Safety

## Current-state finding

- The desktop datum panel previously displayed preset Helmert parameters, invented control stations, and a fixed millimetre RMSE without computing or tracing them to source data.
- The geoid panel selected model names but ignored the selection, called an approximate heuristic, displayed a hard-coded initial result, and exposed illustrative city offsets as if they were model values.
- No authoritative geoid grid file or international coordinate-operation package is currently bundled in the desktop repository.

## Safety changes in this milestone

- The renderer now presents both tools as unavailable until verified reference data is installed; it produces no transformed coordinate or orthometric-height result from this screen.
- `convertHeight` requires a metadata-bearing grid. It fails on missing coverage, malformed dimensions, invalid metadata, and nodata in the interpolation cell. It has no heuristic fallback.
- The legacy EGM2008 approximation entry point now throws, and the unsupported model catalog and Kenya city-offset table are empty.
- Country profiles identify expected height systems without claiming that a grid is installed. Offline-first documentation now treats grids as explicit, versioned data packages.

## Required work before enabling outputs

1. Package authoritative grids with licence, version, source, coverage, reference ellipsoid, vertical datum, tide system, and an accuracy statement whose scope is documented.
2. Verify the file checksum against the grid bytes in the loader; a checksum-shaped metadata string alone is not verification.
3. Validate grid axes, spacing, units, nodata conventions, and edge behavior before interpolation. Never substitute another model outside coverage.
4. Validate model-specific height outputs against independent published or surveyed control values and report the model and limitations in every export.
5. Implement coordinate operations separately with source/target CRS, area of use, epoch, operation accuracy, and required grids. Select only applicable operations; do not expose a low-accuracy regional default as survey-grade.

## Verification boundary

Synthetic interpolation fixtures validate only the bilinear calculation and fail-closed conditions. They do not validate any geoid model. No geoid output should be called survey-grade until the grid loader, authoritative data, independent checkpoints, and export provenance are complete.
