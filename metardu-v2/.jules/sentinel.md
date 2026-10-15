## 2024-08-16 - Prevent SQL injection in GeoPackage exporter
**Vulnerability:** A SQL injection vulnerability in the GeoPackage export module allowed arbitrary SQL execution due to unsanitized interpolation of `tableName` into `CREATE TABLE` statements.
**Learning:** SQLite table and column names cannot be parameterized. Unsanitized identifiers pose a severe risk if they incorporate any dynamic or external string data.
**Prevention:** When parameterization is unavailable for identifiers, explicitly escape them by wrapping in double quotes and doubling-up any internal double quotes (`tableName.replace(/"/g, '""')`).
