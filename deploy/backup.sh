#!/bin/sh
# Copies the Secret Santa database into BACKUP_DIR as secret-santa-YYYY-MM-DD.db,
# owned by BACKUP_OWNER and readable by everyone. Run as root, nightly, by
# patton-secret-santa-backup.timer.
#
# A new file is only saved when something changed since the newest backup, so
# the folder doesn't fill up with identical copies. Nothing is ever deleted.
set -eu

state=/var/lib/patton-secret-santa
db="$state/secret-santa.db"
snapshot="$state/nightly-backup.db"

if [ ! -f "$db" ]; then
  echo "No database at $db yet, nothing to back up."
  exit 0
fi

# SQLite's backup includes recent changes still in the -wal file. It runs as
# the app's user so any files SQLite creates stay usable by the app.
rm -f "$snapshot"
trap 'rm -f "$snapshot"' EXIT
runuser -u santa -- sqlite3 "$db" ".backup '$snapshot'"

latest=$(ls -1 "$BACKUP_DIR"/secret-santa-*.db 2>/dev/null | tail -n 1)
if [ -n "$latest" ] && cmp -s "$snapshot" "$latest"; then
  echo "No changes since $(basename "$latest"), nothing to save."
  exit 0
fi

dest="$BACKUP_DIR/secret-santa-$(date +%F).db"
install -o "$BACKUP_OWNER" -g "$BACKUP_OWNER" -m 644 "$snapshot" "$dest"
echo "Saved $dest"
