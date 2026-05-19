use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use cw_orch::daemon::DaemonBuilder;
use cw_orch::environment::ChainKind;
use cw_orch::prelude::*;
use scripts::chain_spawn::{self, SpawnedChain, SpawnedDualChain};
use scripts::deploy_data::{preflight_check, TerpNetworkDeployData};
use scripts::frontend::{self, ChainEndpointConfig};
use scripts::suite::TerpNetworkSuite;
use scripts::{LOCAL_TERP, MOROCCO_1};

#[derive(Parser)]
#[command(
    name = "terp-scripts",
    about = "Unified deploy/test suite for terp.network"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Deploy contracts to a local or remote chain
    Deploy {
        /// Network: "local" or "mainnet"
        #[arg(short, long, default_value = "local")]
        network: String,

        /// Connect to an already-running chain (skip ict-rs spawn)
        #[arg(long)]
        skip_spawn: bool,

        /// Keep chain running after deploy (block until Ctrl+C)
        #[arg(long)]
        keep_alive: bool,

        /// Deploy only specific suites (infuser, billboards, shitstraps)
        #[arg(short, long)]
        suite: Option<Vec<String>>,

        /// Use full multi-collection deploy instead of single
        #[arg(long)]
        full: bool,

        /// Spawn second chain + Hermes IBC relayer
        #[arg(long)]
        ibc: bool,
    },

    /// Stop containers (cleanup)
    Stop,

    /// Show deployed contract addresses from state.json + WASM module status
    Status,

    /// Check and build all WASM modules needed by the website
    WasmBuild,

    /// Show which WASM modules are present/missing
    WasmStatus,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Install rustls crypto provider before any gRPC/TLS usage
    let _ = rustls::crypto::ring::default_provider().install_default();

    dotenv::dotenv().ok();
    env_logger::init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Deploy {
            network,
            skip_spawn,
            keep_alive,
            suite: _suite_filter,
            full,
            ibc,
        } => {
            deploy(&network, skip_spawn, keep_alive, full, ibc).await?;
        }
        Commands::Stop => {
            println!("Stopping localterp containers...");
            let output = std::process::Command::new("docker")
                .args(["ps", "-q", "--filter", "label=ict-rs"])
                .output();
            match output {
                Ok(o) if !o.stdout.is_empty() => {
                    let ids = String::from_utf8_lossy(&o.stdout);
                    for id in ids.trim().lines() {
                        let _ = std::process::Command::new("docker")
                            .args(["rm", "-f", id])
                            .status();
                    }
                    println!("Containers stopped.");
                }
                _ => println!("No running ict-rs containers found."),
            }
        }
        Commands::Status => {
            println!("Checking cw-orch state.json for deployed addresses...");
            let state_path: PathBuf = std::env::var("HOME")
                .map(|h| PathBuf::from(h).join(".cw-orchestrator/state.json"))
                .unwrap_or_default();
            if state_path.exists() {
                let contents = std::fs::read_to_string(&state_path)?;
                println!("{}", contents);
            } else {
                println!("No state.json found at {:?}", state_path);
            }
            println!();
            scripts::wasm_build::status();
        }
        Commands::WasmBuild => {
            println!("--- WASM Module Build ---");
            let missing = scripts::wasm_build::preflight();
            if missing.is_empty() {
                println!("All WASM modules ready.");
            } else {
                eprintln!(
                    "{} module(s) still missing after build attempt:",
                    missing.len()
                );
                for m in &missing {
                    eprintln!("  - {}", m);
                }
                std::process::exit(1);
            }
        }
        Commands::WasmStatus => {
            scripts::wasm_build::status();
        }
    }

    Ok(())
}

/// Tracks which spawn mode was used for cleanup.
enum Spawned {
    Single(SpawnedChain),
    Dual(SpawnedDualChain),
}

async fn deploy(
    network: &str,
    skip_spawn: bool,
    keep_alive: bool,
    full: bool,
    ibc: bool,
) -> Result<()> {
    // Preflight: check required data files exist before spawning
    let missing = preflight_check(full);
    if !missing.is_empty() {
        eprintln!("ERROR: Missing required files:");
        for p in &missing {
            eprintln!("  - {}", p);
        }
        return Err(anyhow!(
            "Preflight check failed: {} file(s) missing",
            missing.len()
        ));
    }

    // Optionally spawn chain(s) via ict-rs
    let mut spawned: Option<Spawned> = if !skip_spawn && network == "local" {
        if ibc {
            println!("Spawning dual chain with IBC relayer...");
            Some(Spawned::Dual(chain_spawn::spawn_dual_chain().await?))
        } else {
            println!("Spawning local chain via ict-rs...");
            Some(Spawned::Single(chain_spawn::spawn_local_chain().await?))
        }
    } else {
        None
    };

    // Extract mnemonic + endpoints from spawned chain
    let deployer_mnemonic: Option<String> = match &spawned {
        Some(Spawned::Single(s)) => Some(s.mnemonic.clone()),
        _ => None,
    };

    let chain_info: ChainInfoOwned = match network {
        "local" => {
            let (chain_id, grpc) = match &spawned {
                Some(Spawned::Single(ref s)) => (s.chain_id.clone(), s.grpc_url.clone()),
                Some(Spawned::Dual(ref d)) => {
                    (d.chain_a.chain_id.clone(), d.chain_a.grpc_url.clone())
                }
                None => ("120u-1".into(), "http://localhost:9090".into()),
            };
            ChainInfoOwned {
                chain_id,
                gas_denom: "uterp".into(),
                gas_price: 0.25,
                grpc_urls: vec![grpc],
                kind: ChainKind::Local,
                network_info: LOCAL_TERP.network_info.into(),
                lcd_url: None,
                fcd_url: None,
            }
        }
        "mainnet" => MOROCCO_1.into(),
        other => return Err(anyhow!("Unknown network: {}", other)),
    };

    // Run cw-orch on a blocking thread — DaemonBuilder::build() calls block_on()
    // internally, which panics if called from within a tokio runtime.
    let rt_handle = tokio::runtime::Handle::current();
    let addresses: HashMap<String, String> =
        tokio::task::spawn_blocking(move || -> Result<HashMap<String, String>> {
            let mut builder = DaemonBuilder::new(chain_info);
            builder.handle(&rt_handle);
            if let Some(ref m) = deployer_mnemonic {
                builder.mnemonic(m);
            }
            let chain = builder.build()?;

            let sender = chain.sender_addr();
            println!("Deploying as: {}", sender);

            let data = if full {
                TerpNetworkDeployData::full(sender, &[])?
            } else {
                TerpNetworkDeployData::local_default(sender, &[])?
            };

            let suite = TerpNetworkSuite::deploy_on(chain, data)?;

            println!("\n--- Deployed Contracts ---");
            let addrs = suite.collect_addresses();
            suite.print_addresses();
            Ok(addrs)
        })
        .await??;

    // Resolve RPC URL for the proxy (serve.py needs the actual chain RPC)
    let (chain_id, rpc_url, grpc_url) = match &spawned {
        Some(Spawned::Single(ref s)) => (s.chain_id.clone(), s.rpc_url.clone(), s.grpc_url.clone()),
        Some(Spawned::Dual(ref d)) => (
            d.chain_a.chain_id.clone(),
            d.chain_a.rpc_url.clone(),
            d.chain_a.grpc_url.clone(),
        ),
        None => (
            "120u-1".into(),
            "http://localhost:26657".into(),
            "http://localhost:9090".into(),
        ),
    };

    // Patch public/config.json with deployed addresses and endpoints
    frontend::patch_config(
        &ChainEndpointConfig {
            chain_id,
            rpc_url: rpc_url.clone(),
            grpc_url,
        },
        &addresses,
    )?;

    // Print chain B info if dual-chain mode
    if let Some(Spawned::Dual(ref d)) = spawned {
        println!("\n--- Chain B (IBC) ---");
        println!("chain_id: {}", d.chain_b.chain_id);
        println!("grpc:     {}", d.chain_b.grpc_url);
        println!("rpc:      {}", d.chain_b.rpc_url);
    }

    // WASM preflight: check/build client-side WASM modules needed by pages
    println!("\n--- WASM Modules ---");
    let wasm_missing = scripts::wasm_build::preflight();
    if !wasm_missing.is_empty() {
        eprintln!(
            "WARN: {} WASM module(s) missing — some pages will have degraded functionality",
            wasm_missing.len()
        );
    }

    // Start frontend dev servers
    let mut servers: Vec<Child> = Vec::new();

    if keep_alive && network == "local" {
        // Start website dev server (serve.py on :3000, proxies /rpc to chain)
        match frontend::start_website_server(&rpc_url) {
            Ok(child) => servers.push(child),
            Err(e) => eprintln!("WARN: Failed to start website server: {}", e),
        }

        // Start terp-docs (Next.js on :3001, optional)
        match frontend::start_docs_server(&addresses) {
            Ok(Some(child)) => servers.push(child),
            Ok(None) => {} // gracefully skipped
            Err(e) => eprintln!("WARN: Failed to start terp-docs: {}", e),
        }
    }

    // Optionally keep alive
    if keep_alive {
        println!("\nChain running. Press Ctrl+C to stop...");
        println!("  Website:   http://localhost:3000");
        println!("  Docs:      http://localhost:3001 (if available)");
        println!("  RPC proxy: http://localhost:3000/rpc -> {}", rpc_url);
        tokio::signal::ctrl_c().await?;
        println!("Shutting down...");
    }

    // Cleanup: kill dev servers, then stop containers
    frontend::stop_servers(&mut servers);

    match &mut spawned {
        Some(Spawned::Single(ref mut s)) => s.cleanup().await?,
        Some(Spawned::Dual(ref mut d)) => d.cleanup().await?,
        None => {}
    }

    Ok(())
}
