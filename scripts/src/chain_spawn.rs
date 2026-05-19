use std::collections::HashMap;

use ict_rs::auth::{generate_mnemonic, KeyringAuthenticator};
use ict_rs::chain::{Chain, ChainConfig, FaucetConfig};
use ict_rs::chain::cosmos::CosmosChain;
use ict_rs::error::{IctError, Result as IctResult};
use ict_rs::interchain::{Interchain, InterchainBuildOptions, InterchainLink};
use ict_rs::relayer::{build_relayer, RelayerType};
use ict_rs::runtime::{DockerConfig, DockerImage, IctRuntime};
use ict_rs::testing::{setup_chain_with_wallets, TestChain, TestEnv};
use ict_rs::tx::WalletAmount;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// A spawned local chain with host-accessible endpoints and faucet.
pub struct SpawnedChain {
    pub tc: TestChain,
    pub grpc_url: String,
    pub rpc_url: String,
    pub chain_id: String,
    /// Mnemonic for the pre-funded deployer wallet.
    pub mnemonic: String,
}

impl SpawnedChain {
    /// Clean up Docker containers. Respects `ICT_KEEP_CONTAINERS=1`.
    pub async fn cleanup(&mut self) -> anyhow::Result<()> {
        self.tc.cleanup().await?;
        Ok(())
    }
}

/// Host-accessible endpoint URLs for a chain.
pub struct ChainEndpoints {
    pub grpc_url: String,
    pub rpc_url: String,
    pub chain_id: String,
}

/// A spawned dual-chain environment with IBC relayer.
pub struct SpawnedDualChain {
    pub ic: Interchain,
    pub chain_a: ChainEndpoints,
    pub chain_b: ChainEndpoints,
}

impl SpawnedDualChain {
    pub async fn cleanup(&mut self) -> anyhow::Result<()> {
        self.ic.close().await?;
        Ok(())
    }
}

pub const CHAIN_ID: &str = "120u-1";
pub const CHAIN_ID_B: &str = "120u-2";

/// Build a chain config for the given chain_id.
///
/// Uses `local-zk` image (superset of localterp: all features + halo2 verification).
/// Override image via `TERP_IMAGE_REPO` / `TERP_IMAGE_VERSION` env vars.
fn base_chain_config(chain_id: &str) -> ChainConfig {
    let mut cfg = TestEnv::terp_localterp_config();

    // Override image to local-zk
    cfg.images = vec![DockerImage {
        repository: env_or("TERP_IMAGE_REPO", "ghcr.io/terpnetwork/terp-core"),
        version: env_or("`TERP_IMAGE_VERSION`", "v5.2.0-zk-localterp"),
        uid_gid: None,
    }];

    cfg.chain_id = chain_id.to_string();

    // Faucet: add uthiol to the default denoms
    cfg.faucet = Some(FaucetConfig {
        env: vec![
            ("FAUCET_WALLET_NAME".to_string(), "faucet".to_string()),
            ("FAUCET_AMOUNT".to_string(), "1000000000".to_string()),
            ("DENOMS".to_string(), "uterp,uthiol".to_string()),
        ],
        ..FaucetConfig::default()
    });

    // CometBFT config: enable CORS + fast blocks
    cfg.config_file_overrides.insert(
        "config/config.toml".to_string(),
        serde_json::json!({
            "rpc": {
                "cors_allowed_origins": ["*"],
                "max_subscription_clients": 100,
                "max_subscriptions_per_client": 50
            },
            "consensus": {
                "timeout_propose": "200ms",
                "timeout_prevote": "200ms",
                "timeout_precommit": "200ms",
                "timeout_commit": "200ms"
            }
        }),
    );

    // App config: enable gRPC + CORS
    cfg.config_file_overrides.insert(
        "config/app.toml".to_string(),
        serde_json::json!({
            "api": {
                "enable": true,
                "enabled-unsafe-cors": true
            },
            "grpc": {
                "enable": true,
                "address": "0.0.0.0:9090"
            }
        }),
    );

    // Genesis modifications
    cfg.modify_genesis = Some(Box::new(modify_genesis));

    cfg
}

/// Single-chain config (backward compat).
fn chain_config() -> ChainConfig {
    base_chain_config(CHAIN_ID)
}

/// Genesis modifications:
/// - Set staking/gov/mint denoms to uterp
/// - Fast governance (90s voting)
/// - Set tokenfactory denom_creation_fee
/// - Enable vote extensions for hashmerchant module
fn modify_genesis(_cfg: &ChainConfig, raw: Vec<u8>) -> IctResult<Vec<u8>> {
    let mut genesis: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| IctError::Other(e.into()))?;

    let app_state = genesis
        .get_mut("app_state")
        .ok_or_else(|| IctError::Config("missing app_state in genesis".into()))?;

    // Staking
    if let Some(staking) = app_state.get_mut("staking") {
        if let Some(params) = staking.get_mut("params") {
            params["bond_denom"] = serde_json::json!("uterp");
            params["unbonding_time"] = serde_json::json!("90s");
        }
    }

    // Mint
    if let Some(mint) = app_state.get_mut("mint") {
        if let Some(params) = mint.get_mut("params") {
            params["mint_denom"] = serde_json::json!("uterp");
        }
    }

    // Governance — fast voting
    if let Some(gov) = app_state.get_mut("gov") {
        if let Some(params) = gov.get_mut("params") {
            params["voting_period"] = serde_json::json!("90s");
            params["expedited_voting_period"] = serde_json::json!("15s");
            if let Some(min_dep) = params.get_mut("min_deposit") {
                if let Some(arr) = min_dep.as_array_mut() {
                    if let Some(first) = arr.first_mut() {
                        first["denom"] = serde_json::json!("uterp");
                    }
                }
            }
            if let Some(exp_dep) = params.get_mut("expedited_min_deposit") {
                if let Some(arr) = exp_dep.as_array_mut() {
                    if let Some(first) = arr.first_mut() {
                        first["denom"] = serde_json::json!("uterp");
                    }
                }
            }
        }
        // Legacy deposit_params
        if let Some(dp) = gov.get_mut("deposit_params") {
            if let Some(min_dep) = dp.get_mut("min_deposit") {
                if let Some(arr) = min_dep.as_array_mut() {
                    if let Some(first) = arr.first_mut() {
                        first["denom"] = serde_json::json!("uterp");
                    }
                }
            }
        }
    }

    // Tokenfactory denom creation fee
    if let Some(tf) = app_state.get_mut("tokenfactory") {
        if let Some(params) = tf.get_mut("params") {
            params["denom_creation_fee"] =
                serde_json::json!([{"denom": "uterp", "amount": "1000000"}]);
        }
    }

    // Enable vote extensions for hashmerchant module (local-zk)
    // SDK v0.50+: consensus.params.abci
    if let Some(consensus) = genesis.get_mut("consensus") {
        if let Some(params) = consensus.get_mut("params") {
            if let Some(abci) = params.get_mut("abci") {
                abci["vote_extensions_enable_height"] = serde_json::json!("2");
            } else {
                params["abci"] =
                    serde_json::json!({"vote_extensions_enable_height": "2"});
            }
        }
    }
    // Older SDK: consensus_params.abci
    if let Some(cp) = genesis.get_mut("consensus_params") {
        if let Some(abci) = cp.get_mut("abci") {
            abci["vote_extensions_enable_height"] = serde_json::json!("2");
        } else {
            cp["abci"] = serde_json::json!({"vote_extensions_enable_height": "2"});
        }
    }

    serde_json::to_vec_pretty(&genesis).map_err(|e| IctError::Other(e.into()))
}

/// Generate a mnemonic and derive its bech32 address with the given prefix.
fn generate_funded_wallet(prefix: &str) -> anyhow::Result<(String, String)> {
    let mnemonic = generate_mnemonic();
    let auth = KeyringAuthenticator::new(&mnemonic, 118)?;
    let address = auth.bech32_address(prefix)?;
    Ok((mnemonic, address))
}

/// Spawn a single-validator local chain via ict-rs Docker runtime.
///
/// Uses `local-zk` image with in-container faucet (port 5000).
/// A deployer wallet is generated, funded at genesis, and its mnemonic returned.
pub async fn spawn_local_chain() -> anyhow::Result<SpawnedChain> {
    let cfg = chain_config();

    // Generate a deployer wallet and fund it at genesis
    let (mnemonic, address) = generate_funded_wallet("terp")?;
    tracing::info!(deployer = %address, "Generated deployer wallet");

    let genesis_wallets = vec![
        WalletAmount { address: address.clone(), denom: "uterp".into(), amount: 10_000_000_000_000 },
        WalletAmount { address, denom: "uthiol".into(), amount: 10_000_000_000_000 },
    ];

    let tc = setup_chain_with_wallets("localterp", cfg, genesis_wallets).await?;

    let grpc_url = tc.host_grpc_address();
    let rpc_url = tc.host_rpc_address();

    tracing::info!(
        chain_id = CHAIN_ID,
        grpc = %grpc_url,
        rpc = %rpc_url,
        "Local chain spawned with faucet"
    );

    Ok(SpawnedChain {
        tc,
        grpc_url,
        rpc_url,
        chain_id: CHAIN_ID.to_string(),
        mnemonic,
    })
}

/// Spawn two local chains with a Hermes IBC relayer between them.
///
/// Chain A: `120u-1`, Chain B: `120u-2`. Both use `local-zk` image.
/// An IBC transfer channel is created automatically.
pub async fn spawn_dual_chain() -> anyhow::Result<SpawnedDualChain> {
    let test_name = "localterp-ibc";
    let network_id = format!("ict-{test_name}");

    let runtime = IctRuntime::Docker(DockerConfig::default())
        .into_backend()
        .await?;
    runtime.create_network(&network_id).await?;

    let config_a = base_chain_config(CHAIN_ID);
    let config_b = base_chain_config(CHAIN_ID_B);

    let chain_a = CosmosChain::new(config_a, 1, 0, runtime.clone());
    let chain_b = CosmosChain::new(config_b, 1, 0, runtime.clone());

    let relayer = build_relayer(
        RelayerType::Hermes,
        runtime.clone(),
        test_name,
        &network_id,
    )
    .await?;

    let mut ic = Interchain::new(runtime)
        .add_chain(Box::new(chain_a))
        .add_chain(Box::new(chain_b))
        .add_relayer("hermes", relayer)
        .add_link(InterchainLink {
            chain1: CHAIN_ID.to_string(),
            chain2: CHAIN_ID_B.to_string(),
            relayer: "hermes".to_string(),
            path: "ibc-path".to_string(),
        });

    ic.build(InterchainBuildOptions {
        test_name: test_name.to_string(),
        skip_path_creation: false,
        genesis_wallets: HashMap::new(),
    })
    .await?;

    // Read host-accessible endpoints from running chains
    let a = ic.get_chain(CHAIN_ID).expect("chain A not found after build");
    let b = ic
        .get_chain(CHAIN_ID_B)
        .expect("chain B not found after build");

    let chain_a_ep = ChainEndpoints {
        grpc_url: a.host_grpc_address(),
        rpc_url: a.host_rpc_address(),
        chain_id: CHAIN_ID.to_string(),
    };

    let chain_b_ep = ChainEndpoints {
        grpc_url: b.host_grpc_address(),
        rpc_url: b.host_rpc_address(),
        chain_id: CHAIN_ID_B.to_string(),
    };

    tracing::info!(
        chain_a = CHAIN_ID,
        chain_b = CHAIN_ID_B,
        grpc_a = %chain_a_ep.grpc_url,
        grpc_b = %chain_b_ep.grpc_url,
        "Dual chain spawned with Hermes relayer"
    );

    Ok(SpawnedDualChain {
        ic,
        chain_a: chain_a_ep,
        chain_b: chain_b_ep,
    })
}
