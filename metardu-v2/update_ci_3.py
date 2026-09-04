import sys

content = open('.github/workflows/ci.yml').read()
content = content.replace("run: cargo build --release", "run: cargo build --release --no-default-features --features shell-out,instrument")
content = content.replace("run: cargo test", "run: cargo test --no-default-features --features shell-out,instrument")
open('.github/workflows/ci.yml', 'w').write(content)
