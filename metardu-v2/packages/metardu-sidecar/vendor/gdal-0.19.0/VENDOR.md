# Vendored GeoRust GDAL bindings

This directory is based on the published gdal crate 0.19.0 (MIT). It carries the GDAL 3.13 compatibility changes merged upstream in GeoRust PR #714, at upstream commit c555171, because those changes are not yet available in a published crate release.

The local patch is limited to version-gated handling of the GDT_Byte to GDT_UInt8 rename, the GDAL 3.13 GDALRasterIOExtraArg field, its matching upstream crate tests, and the minor_ge_13 cfg declaration. Unix targets use this patched source with bindgen against their installed GDAL headers.

Windows uses the published gdal 0.19.0 crate through the adjacent platform shim and its upstream GDAL 3.12 prebuilt bindings, linked to the OSGeo4W runtime. This avoids the MSVC bindgen enum signedness mismatch in the published crate. Cargo builds on Windows must set GDAL_VERSION=3.12.0 so gdal-sys selects those bindings; the native link paths continue to point at the installed OSGeo4W runtime.

Replace this vendor copy with a published GeoRust release once it includes GDAL 3.13 support and the CI matrix passes against that release.
