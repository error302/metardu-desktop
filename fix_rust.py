import sys
content = open('metardu-v2/packages/metardu-sidecar/Cargo.toml').read()
content = content.replace('tokio-serial = { version = "5.4", optional = true }', 'tokio-serial = { version = "5.4" }')
open('metardu-v2/packages/metardu-sidecar/Cargo.toml', 'w').write(content)
