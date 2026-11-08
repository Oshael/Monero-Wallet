#!/usr/bin/env bash
set -euo pipefail
# Read-only preflight for an operator-opened LUKS2 test volume. Never mount or
# create a fallback directory here. The operator owns unlock and close.
mount_dir=${1:?Usage: check-protected-mount.sh MOUNT_DIRECTORY MAPPER_NAME}
mapper_name=${2:?Usage: check-protected-mount.sh MOUNT_DIRECTORY MAPPER_NAME}
[[ "$mapper_name" =~ ^[a-zA-Z0-9_-]+$ ]]
test -d "$mount_dir"
test ! -L "$mount_dir"
resolved=$(realpath -e -- "$mount_dir")
source_device=$(findmnt -rn -o SOURCE --mountpoint "$resolved")
test "$source_device" = "/dev/mapper/$mapper_name"
cryptsetup status "$mapper_name" | awk '/type:/ {found=($2 == "LUKS2")} END {exit !found}'
options=$(findmnt -rn -o OPTIONS --mountpoint "$resolved")
for required in rw nodev nosuid noexec; do
  [[ ",$options," == *",$required,"* ]]
done
test "$(stat -c %a "$resolved")" = 700
