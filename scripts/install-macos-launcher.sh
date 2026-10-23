#!/bin/bash
# Install a Finder launcher and a private per-user login service. Build first.
set -euo pipefail
umask 077

if [[ "$(/usr/bin/uname -s)" != Darwin ]]; then
  echo "This installer requires macOS." >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
NODE="$(command -v node || true)"
if [[ ! -x "$NODE" || ! -f "$ROOT/node_modules/next/dist/bin/next" || ! -f "$ROOT/.next/BUILD_ID" ]]; then
  echo "Install Node.js, then run npm install and npm run build in $ROOT first." >&2
  exit 1
fi

"$NODE" - "$ROOT" "$NODE" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const [root, node] = process.argv.slice(2);
const label = 'com.davidfrey.api-costs';
const app = path.join(root, 'AI Usage.app', 'Contents');
const data = path.join(root, 'data');
const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const plist = body => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${body}\n</dict></plist>\n`;
fs.mkdirSync(data, {recursive: true, mode: 0o700});
fs.chmodSync(data, 0o700);
fs.mkdirSync(agents, {recursive: true});
fs.mkdirSync(path.join(app, 'MacOS'), {recursive: true, mode: 0o755});
fs.writeFileSync(path.join(app, 'Info.plist'), plist(`
<key>CFBundleExecutable</key><string>AIUsage</string>
<key>CFBundleIdentifier</key><string>com.davidfrey.api-costs.launcher</string>
<key>CFBundleName</key><string>AI Usage</string>
<key>CFBundleDisplayName</key><string>AI Usage</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`), {mode: 0o644});
fs.writeFileSync(path.join(app, 'MacOS', 'AIUsage'), `#!/bin/bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../../.." && pwd -P)"
mkdir -p "$ROOT/data"
if ! "$ROOT/scripts/launch-dashboard.sh" >>"$ROOT/data/launcher.log" 2>&1; then
  /usr/bin/open -t "$ROOT/data/launcher.log"
  exit 1
fi
`, {mode: 0o755});
fs.chmodSync(path.join(app, 'MacOS', 'AIUsage'), 0o755);
const agent = path.join(agents, `${label}.plist`);
const searchPath = `${path.dirname(node)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
fs.writeFileSync(agent, plist(`
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${[node, path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '4100'].map(v => `<string>${xml(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${xml(searchPath)}</string>
<key>NODE_ENV</key><string>production</string>
<key>NEXT_TELEMETRY_DISABLED</key><string>1</string>
<key>TZ</key><string>${xml(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone)}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(data, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(data, 'service-error.log'))}</string>`), {mode: 0o600});
fs.chmodSync(agent, 0o600);
console.log(`Installed ${path.dirname(app)}`);
console.log(`Service configuration: ${agent}`);
NODE

echo "Double-click AI Usage.app to start the dashboard and open your browser."
echo "If you moved the installation, unload the old service before clicking the app:"
echo "  launchctl bootout gui/$(/usr/bin/id -u)/com.davidfrey.api-costs"
