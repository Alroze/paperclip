#!/usr/bin/env bash
# Alroze fork: build a local install payload from this checkout. Never publishes.
#
# Usage: scripts/alroze/build-payload.sh <version> [--skip-build]
#   <version>  e.g. 2026.1115.0-alroze.1
#
# Output:
#   ~/paperclip-fork-builds/<version>/tarballs/*.tgz   one per public package
#   ~/paperclip-fork-builds/<version>/payload/         ready-to-run payload
#     (same layout as ~/.paperclip/cli/installs/npm/<ver>; going live = point
#      ~/.paperclip/cli/current at it)
#
# Mirrors scripts/release.sh steps 2-4 without npm publish, git tags, or
# hosted multi-platform runner artifacts (we build linux-x64 only).
# Tracked files touched by versioning are restored on exit.
set -euo pipefail
umask 022

VERSION="${1:?usage: build-payload.sh <version> [--skip-build]}"
SKIP_BUILD=false
case "${2:-}" in
  --skip-build) SKIP_BUILD=true ;;
  --install-only) SKIP_BUILD=install-only ;;  # redo step 6 from existing tarballs
esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${PAPERCLIP_FORK_BUILDS:-$HOME/paperclip-fork-builds}/$VERSION"
export PATH="$HOME/.cargo/bin:$PATH"
cd "$REPO_ROOT"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "error: tracked files are modified; commit or stash first" >&2
  exit 1
fi
if [ "$SKIP_BUILD" = install-only ]; then
  rm -rf "$OUT/payload"
elif [ -e "$OUT" ]; then
  echo "error: $OUT already exists; pick a new version" >&2
  exit 1
fi

restore_tree() {
  cd "$REPO_ROOT"
  [ -f cli/package.dev.json ] && mv cli/package.dev.json cli/package.json
  git checkout -q -- .
}
trap restore_tree EXIT

# Like the managed installer: depend on paperclipai only, and pin every
# @paperclipai/* package (direct or transitive) to our tarballs via overrides.
install_payload() {
  mkdir -p "$OUT/payload"
  cd "$OUT/payload"
  node - "$OUT/tarballs" > package.json <<'EOF'
const { readdirSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const dir = process.argv[2];
const deps = {}, overrides = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".tgz"))) {
  const pkg = JSON.parse(execFileSync("tar", ["-xzOf", `${dir}/${f}`, "package/package.json"]));
  const spec = `file:${dir}/${f}`;
  if (pkg.name === "paperclipai") deps[pkg.name] = spec; else overrides[pkg.name] = spec;
}
console.log(JSON.stringify({ dependencies: deps, overrides }, null, 2));
EOF
  npm install --no-audit --no-fund --omit=dev
  # npm 11 skips install scripts by default. These two are required:
  # embedded Postgres restores its lib symlinks, server installs Copilot assets.
  npm install-scripts approve @embedded-postgres/linux-x64 @paperclipai/server
  npm rebuild @embedded-postgres/linux-x64 @paperclipai/server
}

verify_payload() {
  local installed
  installed="$(node -e "console.log(require('$OUT/payload/node_modules/paperclipai/package.json').version)")"
  [ "$installed" = "$VERSION" ] || { echo "error: payload has paperclipai $installed, expected $VERSION" >&2; exit 1; }
  # every @paperclipai package in the tree must be ours, never pulled from npm
  local foreign
  foreign="$(cd "$OUT/payload" && V="$VERSION" find node_modules -path '*/@paperclipai/*/package.json' -maxdepth 4 \
    -exec node -e 'for (const f of process.argv.slice(1)) { const p = require(require("path").resolve(f)); if (p.version !== process.env.V) console.log(p.name + "@" + p.version) }' {} + 2>/dev/null | sort -u)"
  [ -z "$foreign" ] || { echo "error: non-fork @paperclipai packages in payload:" >&2; echo "$foreign" >&2; exit 1; }
  echo
  echo "Payload ready: $OUT/payload  (paperclipai $installed, source $(cat "$OUT/SOURCE_COMMIT" 2>/dev/null || echo unknown))"
}

if [ "$SKIP_BUILD" = install-only ]; then
  install_payload
  verify_payload
  exit 0
fi

echo "==> [1/6] Workspace build"
[ "$SKIP_BUILD" = true ] || corepack pnpm build

echo "==> [2/6] Vendor runner daemon into server"
runnerd="packages/paperclip-runner/dist/bin/paperclip-runnerd"
[ -x "$runnerd" ] || { echo "error: $runnerd missing (cargo build failed?)" >&2; exit 1; }
target="$(node -e 'console.log(process.platform + "-" + process.arch)')"
mkdir -p "server/dist/vendor/paperclip-runner/bin/$target"
cp "$runnerd" "server/dist/vendor/paperclip-runner/bin/paperclip-runnerd"
cp "$runnerd" "server/dist/vendor/paperclip-runner/bin/$target/paperclip-runnerd"
if [ -d packages/paperclip-runner/dist/remote-provider-packs ]; then
  cp -R packages/paperclip-runner/dist/remote-provider-packs server/dist/vendor/paperclip-runner/
fi

echo "==> [3/6] Standalone packages, UI dist, skills"
node scripts/build-standalone-public-packages.mjs
bash scripts/prepare-server-ui-dist.sh
for pkg_dir in server packages/adapters/claude-local packages/adapters/codex-local; do
  rm -rf "$pkg_dir/skills"
  cp -r skills "$pkg_dir/skills"
done

echo "==> [4/6] Version $VERSION + CLI bundle"
node scripts/release-package-map.mjs set-version "$VERSION"
./scripts/build-npm.sh --skip-checks --skip-typecheck

echo "==> [5/6] Pack public packages"
mkdir -p "$OUT/tarballs"
while IFS=$'\t' read -r pkg_dir pkg_name _ver; do
  [ -z "$pkg_dir" ] && continue
  (
    cd "$REPO_ROOT/$pkg_dir"
    bundled="$(node -e 'const p=require(process.cwd()+"/package.json");process.stdout.write(String((p.bundleDependencies??p.bundledDependencies??[]).length))')"
    if [ "$bundled" != "0" ]; then
      stage="$(mktemp -d)"
      node "$REPO_ROOT/scripts/prepare-bundled-package.mjs" "$REPO_ROOT/$pkg_dir" "$stage"
      (cd "$stage" && npx --yes npm@10.9.7 pack --ignore-scripts --pack-destination "$OUT/tarballs" >/dev/null)
      rm -rf "$stage"
    else
      corepack pnpm pack --pack-destination "$OUT/tarballs" >/dev/null
    fi
  )
  echo "  packed $pkg_name"
done < <(node scripts/release-package-map.mjs list)

echo "==> [6/6] Install payload"
install_payload
git -C "$REPO_ROOT" rev-parse HEAD > "$OUT/SOURCE_COMMIT"
verify_payload
