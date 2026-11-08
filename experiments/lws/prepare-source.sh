#!/usr/bin/env bash
set -euo pipefail
# Source preparation only. No service installation, database migration or launch.
source_dir=${1:?Usage: prepare-source.sh CHECKOUT}
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
expected=e70630140be66ac80b990df8221063ae7f28499c
test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected"
test -z "$(git -C "$source_dir" status --porcelain --untracked-files=no)"
test ! -e "$source_dir/tests/unit/db/deletion.test.cpp"
test ! -e "$source_dir/tests/unit/storage-probe.cpp"
git -C "$source_dir" submodule status --recursive | python3 -c 'import sys; rows=sys.stdin.read().splitlines(); sys.exit(not rows or any(row[0] != " " for row in rows))'
git -C "$source_dir" apply --check "$project_dir/authenticated-deletion.patch"
git -C "$source_dir" apply "$project_dir/authenticated-deletion.patch"
install -m 644 "$project_dir/deletion.test.cpp" "$source_dir/tests/unit/db/deletion.test.cpp"
install -m 644 "$project_dir/storage-probe.cpp" "$source_dir/tests/unit/storage-probe.cpp"
