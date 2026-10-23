#!/bin/bash
# Start the installed login service if needed, then open the local dashboard.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LABEL="com.davidfrey.api-costs"
DOMAIN="gui/$(/usr/bin/id -u)"
JOB="$DOMAIN/$LABEL"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="http://127.0.0.1:4100"
OPEN_BROWSER=true

case "${1:-}" in
  "") ;;
  --no-open) OPEN_BROWSER=false ;;
  *) echo "Usage: $0 [--no-open]" >&2; exit 2 ;;
esac

ready() {
  /bin/launchctl print "$JOB" 2>/dev/null | /usr/bin/grep -q 'state = running' &&
    /usr/bin/curl --fail --silent --max-time 2 "$URL/api/plans" >/dev/null
}

if ! /bin/launchctl print "$JOB" >/dev/null 2>&1; then
  if [[ ! -f "$PLIST" ]]; then
    echo "The dashboard service is not installed. Run $ROOT/scripts/install-macos-launcher.sh first." >&2
    exit 1
  fi
  # A simultaneous click may have loaded the service already.
  /bin/launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null ||
    /bin/launchctl print "$JOB" >/dev/null
elif ! ready; then
  /bin/launchctl kickstart "$JOB"
fi

for ((attempt=0; attempt<30; attempt++)); do
  if ready; then
    if "$OPEN_BROWSER"; then /usr/bin/open "$URL"; fi
    echo "AI Usage is ready at $URL"
    exit 0
  fi
  /bin/sleep 1
done

echo "AI Usage did not become ready. See $ROOT/data/service-error.log for details." >&2
exit 1
