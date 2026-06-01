# Terp Network Website

Official website for Terp Network, featuring the terp-core installer integration.

## TODO
- svg minting and viewing page
- smart-account registration
- view-text-records | manage text records (update,remove,add)
- html script libraries:
    - load chain config:
        - load static record with ipfs/blossom cid
        - fetch content from indexer 
        - update local storage for caching 
    - sound and verifiable wallet lifecycle workflow
        - smart account middleware
        - pfpk indexer libary 
    - dao community widgets (websites tuned with iframe support)
        - calendar widget 
        - forum widget 
        - dashboard widget (staking,swapping)
- hardnen soundess of ibc support
    - integrate (or create) argus formulas/actions for various common ibc actions:
        - multichain wallet balance
        - multichain swap support (self defined skip-api workflow)
        - ibc tx explorer modal
        - self relay modal
        - 


## Features
- wallet connecting && chain client via cosmes: <https://www.npmjs.com/package/@goblinhunt/cosmes>
- zero-config installer for terp-core
- svg collection mint, browse and view
- terp-account-billboard (TAB) nft mints
- local testing suite for development sessions

## Installation Scripts

### Quick Install (Interactive)

**One-line install:**

```bash
curl -fsSL https://terp.network/get | bash
```

The installer will automatically:

1. Check/install Python 3.6+
2. Guide you through selecting installation type (node/client/localterp)
3. Help you choose network (mainnet/testnet)
4. Configure your node settings
5. Optionally install cosmovisor and systemd service

### Command-Line Options

You can also use flags to skip certain prompts:

```bash
curl -fsSL https://terp.network/get | bash -s -- --install node --network morocco-1 --moniker "my-node"
```

**Available flags:**

- `--install <node|client|localterp>` - Installation type
- `--network <morocco-1|90u-4>` - Network to join
- `--home <path>` - Installation directory (default: ~/.terp)
- `--moniker <name>` - Node moniker (default: terp)
- `--pruning <default|nothing|everything>` - Pruning settings
- `--cosmovisor` - Install with cosmovisor
- `--service` - Setup systemd service (Linux only)
- `--overwrite` - Overwrite existing installation

### Alternative: UV Tool

```bash
uvx --from terp-core terpd
```

⚠️ **Security Note:** Always verify checksums from multiple trusted sources (GitHub releases, official documentation, etc.) to ensure the checksums themselves haven't been tampered with.

## Running Locally
  
## Deployment
  
## Installation Script Endpoints

- `/get` - Shell wrapper script (downloads and runs Python installer)
- `/run` - Python installer script (main installation logic)
- `/get/` - Directory access for individual files and checksum verification

## Development

The website uses:

- Pure HTML/CSS/JavaScript (no build tools required)
- Satoshi font from CDN Fonts
- SVG graphics for icons and logos
- Canvas API for animated background effects

## Links

- Documentation: <https://docs.terp.network>
- GitHub: <https://github.com/terpnetwork>
- Twitter: <https://x.com/terpnetofficial>
- Discord: <https://discord.gg/W3QnHe77S6>

## License

See the main Terp Network repository for licensing information.
