# terp.network website — development & operations
# usage: just <recipe>    or    just --list

set dotenv-load := false
set shell := ["bash", "-euo", "pipefail", "-c"]

# project paths
website_dir := justfile_directory()
lib_dir     := website_dir / "lib"
scripts_sh  := website_dir / "scripts" / "sh"
scripts_dir := website_dir / "scripts"
config      := website_dir / "public" / "config.json"

# pages that actually exist in pages/
pages := "index.html svg.html tabs.html no-rick.html"

# ─── Development ────────────────────────────────────────────────

# start the dev server on :3000
serve:
    python3 scripts/serve.py

# start dev server on a custom port
serve-on port="3000":
    WEBSITE_PORT={{port}} python3 scripts/serve.py

# ─── Config & Checksums ────────────────────────────────────────

# compute SHA-256 checksums for installers and bundles into config.json
build-config:
    {{scripts_sh}}/build-config.sh

# verify file checksums match config.json
verify-config:
    {{scripts_sh}}/build-config.sh --verify

# ─── Bundles ────────────────────────────────────────────────────

# rebuild & sync all contract TS bundles into lib/
sync-bundles:
    {{scripts_sh}}/sync-bundles.sh

# copy existing bundle builds without re-running codegen
sync-bundles-copy:
    {{scripts_sh}}/sync-bundles.sh --copy-only

# show what bundles would be synced (dry run)
sync-bundles-list:
    {{scripts_sh}}/sync-bundles.sh --list

# ─── Testing (Rust) ─────────────────────────────────────────────

# spawn local chain + deploy all suites, keep alive for testing
test-rs:
    cd {{scripts_dir}} && RUST_LOG=info cargo run -- deploy --network local --keep-alive

# spawn dual chain + Hermes IBC relayer, deploy on chain A, keep alive
test-rs-ibc:
    cd {{scripts_dir}} && RUST_LOG=info cargo run -- deploy --network local --ibc --keep-alive

# deploy to already-running chain (skip ict-rs spawn)
test-rs-attach:
    cd {{scripts_dir}} && RUST_LOG=info cargo run -- deploy --network local --skip-spawn

# full multi-collection deploy
test-rs-full:
    cd {{scripts_dir}} && RUST_LOG=info cargo run -- deploy --network local --full --keep-alive

# show deployed contract addresses from state.json
status:
    cd {{scripts_dir}} && cargo run -- status

# stop all ict-rs containers
stop:
    cd {{scripts_dir}} && cargo run -- stop

# check/build all WASM modules needed by the website (norick, oline, passkey)
wasm-build:
    cd {{scripts_dir}} && cargo run -- wasm-build

# show which WASM modules are present/missing in pkg/
wasm-status:
    cd {{scripts_dir}} && cargo run -- wasm-status

# cargo check the scripts crate
check-scripts:
    cd {{scripts_dir}} && cargo check

# start e2e with local IBC (two terp chains + relayer)
test-local-ibc:
    ENABLE_IBC=true {{scripts_sh}}/local-test-env.sh

# ─── Production ─────────────────────────────────────────────────

# inject mainnet contract addresses into config.json
configure-prod:
    {{scripts_sh}}/configure_prod.sh

# full static build → dist/
build:
    mkdir -p dist
    node build.js

# ─── Validation ─────────────────────────────────────────────────

# check all HTML pages exist and are non-empty
check-html:
	#!/usr/bin/env bash
	ok=0; fail=0
	for f in {{pages}}; do
		if [ -s "{{website_dir}}/pages/$f" ]; then
			echo "  ok  $f ($(wc -c < "{{website_dir}}/pages/$f" | tr -d ' ') bytes)"
			ok=$((ok + 1))
		else
			echo "  MISSING  $f"
			fail=$((fail + 1))
		fi
	done
	echo ""
	echo "$ok ok, $fail missing"
	[ "$fail" -eq 0 ]

# check all expected lib bundles are present
check-bundles:
    #!/usr/bin/env bash
    ok=0; fail=0
    for f in account-minter cw721-svg cw-svg-minter terp721-account \
             cw-infuser cw-infuser-factory cw-shitstrap cw-shitstrap-factory \
             whitelist-merkletree; do
        if [ -s "{{lib_dir}}/${f}.js" ]; then
            echo "  ok  ${f}.js"
            ok=$((ok + 1))
        else
            echo "  MISSING  ${f}.js"
            fail=$((fail + 1))
        fi
    done
    echo ""
    echo "$ok ok, $fail missing"
    [ "$fail" -eq 0 ]

# validate HTML syntax (requires tidy)
lint-html:
	#!/usr/bin/env bash
	if ! command -v tidy &>/dev/null; then
		echo "install html-tidy: brew install tidy-html5"
		exit 1
	fi
	for f in {{pages}}; do
		echo "── $f ──"
		tidy -q -e "{{website_dir}}/pages/$f" 2>&1 || true
	done

# run all checks
check: check-html check-bundles verify-config

# ─── Utilities ──────────────────────────────────────────────────

# remove build artifacts and editor temp files
clean:
    find {{website_dir}} -name '.DS_Store' -delete
    find {{website_dir}} -name '*.bak' -delete

# show project file tree (2 levels deep)
tree:
    find {{website_dir}} -maxdepth 2 -not -path '*/\.git/*' -not -name '.DS_Store' | sort | head -60

# show current git status
git-status:
    git status -sb

# show lines of HTML per page
loc:
	wc -l pages/index.html pages/svg.html pages/tabs.html pages/no-rick.html lib/config-loader.js lib/tx-builder.js lib/auth.js lib/ibc-client.js lib/self-relay.js lib/query-cache.js
