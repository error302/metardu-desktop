# Vendored GeoRust GDAL bindings

This directory is based on the published `gdal` crate 0.19.0 (MIT). It carries the GDAL 3.13 compatibility changes merged upstream in [GeoRust PR #714](https://github.com/georust/gdal/pull/714), at upstream commit `c555171`, because those changes are not yet available in a published crate release.

The local patch is limited to version-gated handling of the `GDT_Byte` to `GDT_UInt8` rename, the GDAL 3.13 `GDALRasterIOExtraArg` field, its matching upstream crate tests, and the `minor_ge_13` cfg declaration. The published `gdal-sys` 0.12.0 dependency remains unchanged.

Replace this vendor copy with a published GeoRust release once it includes GDAL 3.13 support and the CI matrix passes against that release.
