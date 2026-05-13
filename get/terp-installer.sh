#!/bin/sh
# terp-installer.sh — Download or build terpd and bootstrap a Terp node
#
# This script downloads the terpd Go binary for your platform (Linux)
# or builds from source (macOS), then delegates all node setup to the
# native `terpd bootstrap` command, which handles:
#   init, genesis download, state-sync, pruning, cosmovisor, systemd
#
# Usage:
#   curl -sL https://terp.network/get/terp-installer.sh | sh
#   curl -sL https://terp.network/get/terp-installer.sh | sh -s -- --network morocco-1
#   curl -sL https://terp.network/get/terp-installer.sh | sh -s -- --network 120u-1 --cosmovisor --service
#
# All flags after -- are passed through to `terpd bootstrap`.
# See: terpd bootstrap --help

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────
TERPD_VERSION="5.1.0"
GITHUB_BASE="https://github.com/terpnetwork/terp-core/releases/download"
BINARY_DEST="${TERPD_BIN:-$HOME/go/bin/terpd}"

# ── Detect platform ──────────────────────────────────────────────────
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
    armv7l)  ARCH="arm64" ;;
    *)
        echo "Error: Unsupported architecture '$ARCH'" >&2
        exit 1
        ;;
esac

case "$OS" in
    linux)  BINARY_NAME="terpd-linux-${ARCH}" ;;
    darwin) BINARY_NAME="" ;;
    *)
        echo "Error: Unsupported OS '$OS'" >&2
        exit 1
        ;;
esac

# ── Download or build terpd ──────────────────────────────────────────
if [ -n "$BINARY_NAME" ]; then
    DOWNLOAD_URL="${GITHUB_BASE}/v${TERPD_VERSION}/${BINARY_NAME}"
else
    DOWNLOAD_URL=""
fi

echo "=== Terp Network Installer ==="
echo ""
echo "  Version : v${TERPD_VERSION}"
echo "  Platform: ${OS}/${ARCH}"
echo "  Binary  : ${BINARY_DEST}"
if [ -n "$DOWNLOAD_URL" ]; then
    echo "  Source  : ${DOWNLOAD_URL}"
else
    echo "  Source  : build from source (go install)"
fi
echo ""

# Check if terpd already exists
if command -v terpd >/dev/null 2>&1; then
    EXISTING_VERSION="$(terpd version 2>/dev/null || echo 'unknown')"
    echo "terpd is already installed (version: ${EXISTING_VERSION})"
    if [ -t 0 ]; then
        printf "Overwrite? [y/N] "
        read -r OVERWRITE
        case "$OVERWRITE" in
            [yY]|[yY][eE][sS]) ;;
            *) echo "Skipping install. Running existing terpd..."; terpd bootstrap "$@"; exit $? ;;
        esac
    fi
fi

BIN_DIR="$(dirname "$BINARY_DEST")"
mkdir -p "$BIN_DIR"

if [ "$OS" = "darwin" ]; then
    # ── macOS: build from source (no pre-built darwin binaries) ───────
    if ! command -v go >/dev/null 2>&1; then
        echo "Error: Go is required to build terpd on macOS." >&2
        echo "Install Go from https://go.dev/dl/ or: brew install go" >&2
        exit 1
    fi

    echo "Building terpd v${TERPD_VERSION} from source (this may take a few minutes)..."
    go install "github.com/terpnetwork/terp-core/cmd/terpd@v${TERPD_VERSION}"

    # go install puts the binary in $(go env GOPATH)/bin — copy if different
    GO_BIN="$(go env GOPATH)/bin/terpd"
    if [ "$GO_BIN" != "$BINARY_DEST" ] && [ -f "$GO_BIN" ]; then
        cp "$GO_BIN" "$BINARY_DEST"
    fi
else
    # ── Linux: download pre-built binary ──────────────────────────────
    echo "Downloading terpd v${TERPD_VERSION}..."
    TMPFILE="$(mktemp /tmp/terpd.XXXXXX)"

    if command -v curl >/dev/null 2>&1; then
        curl -fSL "$DOWNLOAD_URL" -o "$TMPFILE"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$DOWNLOAD_URL" -O "$TMPFILE"
    else
        echo "Error: curl or wget required" >&2
        rm -f "$TMPFILE"
        exit 1
    fi

    chmod +x "$TMPFILE"

    if [ "$(id -u)" -ne 0 ]; then
        sudo mv "$TMPFILE" "$BINARY_DEST"
        sudo chown "$(id -u):$(id -g)" "$BINARY_DEST"
        sudo chmod +x "$BINARY_DEST"
    else
        mv "$TMPFILE" "$BINARY_DEST"
    fi
fi

# Ensure binary destination directory is on PATH
case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *)
        echo ""
        echo "Note: ${BIN_DIR} is not on your PATH."
        echo "Add it with:  export PATH=\"${BIN_DIR}:\$PATH\""
        echo "Or add to ~/.profile for persistence."
        ;;
esac

# Verify
echo "Verifying installation..."
export PATH="${BIN_DIR}:${PATH}"
terpd version || { echo "Error: terpd binary failed to run" >&2; exit 1; }

echo ""
echo "terpd v${TERPD_VERSION} installed successfully."
echo ""

# ── Delegate to terpd bootstrap ──────────────────────────────────────
echo "=== Running terpd bootstrap ==="
echo ""

# If interactive and no flags given, show a quick menu
if [ $# -eq 0 ] && [ -t 0 ]; then
    echo "Choose network:"
    echo "  1) morocco-1  (mainnet)"
    echo "  2) 120u-1    (testnet)"
    printf "Enter choice [1]: "
    read -r NET_CHOICE
    case "$NET_CHOICE" in
        2) BOOTSTRAP_FLAGS="--network 120u-1" ;;
        *) BOOTSTRAP_FLAGS="--network morocco-1" ;;
    esac

    printf "Install cosmovisor? [y/N]: "
    read -r COSMO_CHOICE
    case "$COSMO_CHOICE" in
        [yY]|[yY][eE][sS]) BOOTSTRAP_FLAGS="$BOOTSTRAP_FLAGS --cosmovisor" ;;
    esac

    if [ "$OS" = "linux" ]; then
        printf "Create systemd service? [y/N]: "
        read -r SVC_CHOICE
        case "$SVC_CHOICE" in
            [yY]|[yY][eE][sS]) BOOTSTRAP_FLAGS="$BOOTSTRAP_FLAGS --service" ;;
        esac
    fi

    echo ""
else
    BOOTSTRAP_FLAGS="$*"
fi

terpd bootstrap $BOOTSTRAP_FLAGS
