use cosmwasm_std::{Addr, Decimal};
use cw_infuser_scripts::suite::svg::load_svg_init_msg;
use cw_infuser_scripts::suite::whitelist::load_terp_warrior_mtree;
use cw_infuser_scripts::suite::CwSvgSuiteDeployData;
use dao_testing::suite::{
    distribution::*, external::calendar::CalendarDeployData, external::*, gauges::*, proposal::*,
    staking::*, voting::*, DaoConfig, DaoDaoDeployData, ProposalModuleConfig, VotingModuleConfig,
};
use shit_scripts::{shit_deploy_data_full, shit_deploy_data_single, CwShitstrapSuiteDeployData};
use std::path::{Path, PathBuf};
use terp_account_scripts::suite::TerpAccountDeployData;
use zk_test_press::suite::TestPressDeployData;

/// Root of the cw-infuser repo (where `scripts/svgs/` and `data/` live).
fn cw_infuser_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../cw-infuser")
}

/// Root of the dao-contracts repo (where `artifacts/` should live).
fn dao_contracts_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../abstract/dao-contracts")
}

fn svg_init_path(collection: &str) -> String {
    cw_infuser_root()
        .join(format!("scripts/svgs/interchain/{collection}/init.json"))
        .to_string_lossy()
        .into_owned()
}

fn mtree_init_path() -> String {
    cw_infuser_root()
        .join("data/mtree-init.json")
        .to_string_lossy()
        .into_owned()
}

/// Check if DAO WASM artifacts are available.
fn dao_artifacts_available() -> bool {
    let dir = dao_contracts_root().join("artifacts");
    if dir.is_dir() {
        // Check at least dao_dao_core.wasm exists
        dir.join("dao_dao_core.wasm").exists() || dir.join("dao_dao_core-aarch64.wasm").exists()
    } else {
        false
    }
}

/// Preflight: verify all required data files exist before deploying.
/// Returns a list of missing paths (empty = all good).
pub fn preflight_check(full: bool) -> Vec<String> {
    let mut missing = Vec::new();

    // SVG init files
    let terp_path = svg_init_path("terp");
    if !Path::new(&terp_path).exists() {
        missing.push(terp_path);
    }

    // Merkle tree data (single mode only)
    if !full {
        let mt_path = mtree_init_path();
        if !Path::new(&mt_path).exists() {
            missing.push(mt_path);
        }
    }

    if full {
        let dao_path = svg_init_path("dao");
        if !Path::new(&dao_path).exists() {
            missing.push(dao_path);
        }
    }

    missing
}

/// Top-level deploy configuration for all website suites.
///
/// Each field is `Option` — only suites with `Some(data)` get deployed.
pub struct TerpNetworkDeployData {
    pub admin: Addr,
    pub cw_infuser: Option<CwSvgSuiteDeployData>,
    pub terp_billboards: Option<TerpAccountDeployData>,
    pub shitstraps: Option<CwShitstrapSuiteDeployData>,
    pub dao: Option<DaoDaoDeployData>,
    pub zk: Option<TestPressDeployData>,
}

impl TerpNetworkDeployData {
    /// Minimal local deployment: one SVG collection + one shitstrap exchange.
    pub fn local_default(sender: Addr, root: &[u8]) -> anyhow::Result<Self> {
        Ok(Self {
            admin: sender.clone(),
            cw_infuser: deploy_data_single(sender.clone())?,
            terp_billboards: Some(sender.clone().into()),
            shitstraps: shit_deploy_data_single(sender.clone()),
            dao: dao_deploy_data_single(sender.clone())?,
            zk: zk_deploy_data_single(sender.clone(), root),
        })
    }

    /// Full deployment: multiple SVG collections + multiple shitstrap exchanges.
    pub fn full(sender: Addr, root: &[u8]) -> anyhow::Result<Self> {
        Ok(Self {
            admin: sender.clone(),
            cw_infuser: deploy_data_full(sender.clone())?,
            terp_billboards: Some(sender.clone().into()),
            shitstraps: shit_deploy_data_full(sender.clone()),
            dao: dao_deploy_data_single(sender.clone())?,
            zk: zk_deploy_data_single(sender.clone(), root),
        })
    }
}

fn zk_deploy_data_single(sender: Addr, root: &[u8]) -> Option<TestPressDeployData> {
    // Check for headstash circuit keys
    let keys_dir = PathBuf::from(
        std::env::var("HEADSTASH_KEYS_DIR").unwrap_or_else(|_| "./circuit_keys/headstash".into()),
    );
    let vk_combined = keys_dir.join("vk_combined.bin");
    if vk_combined.exists() {
        Some(TestPressDeployData::local_default(sender, &root, keys_dir))
    } else {
        eprintln!(
            "INFO: No headstash circuit keys at {:?} — skipping ZK deploy",
            vk_combined
        );
        eprintln!("      Generate with: cd headstash && cargo run --bin gen_headstash_keys");
        None
    }
}

/// Single DAO with dao-calendar module & single proposal as voting modules
fn dao_deploy_data_single(sender: Addr) -> anyhow::Result<Option<DaoDaoDeployData>> {
    let mut terp = load_svg_init_msg(&svg_init_path("terp"))?;
    let mut mt = load_terp_warrior_mtree(&mtree_init_path())?;
    terp.owner = Some(sender.to_string());
    mt.admins = vec![sender.to_string()];

    // Calendar deploy data — minimal config for local testing
    let calendar_data = CalendarDeployData {
        initial_groups: None,
    };

    // DAO config with calendar as a proposal module
    let dao_config = DaoConfig {
        key: "terp_dao".to_string(),
        admin: Some(sender.to_string()),
        name: "Terp DAO".to_string(),
        description: "Terp Network DAO with calendar governance module".to_string(),
        voting: VotingModuleConfig::Cw4 {
            cw4_group_code_id: 0, // Resolved from suite code IDs during deploy
            initial_members: vec![cw4::Member {
                addr: sender.to_string(),
                weight: 1,
            }],
        },
        proposal_modules: vec![ProposalModuleConfig::Calendar(calendar_data.clone())],
    };

    Ok(Some(DaoDaoDeployData {
        proposal: DaoProposalDeployData::default(),
        voting: DaoVotingDeployData::default(),
        staking: DaoStakingDeployData::default(),
        distribution: DaoDistributionDeployData::default(),
        external: DaoExternalDeployData {
            calendar: Some(calendar_data),
            ..Default::default()
        },
        gauges: DaoGaugeDeployData::default(),
        daos: vec![dao_config],
    }))
}
// ---------------------------------------------------------------------------
// cw-infuser deploy data builders
// ---------------------------------------------------------------------------

/// Single SVG collection (terp warrior) with merkle-tree whitelist.
fn deploy_data_single(sender: Addr) -> anyhow::Result<Option<CwSvgSuiteDeployData>> {
    let mut terp = load_svg_init_msg(&svg_init_path("terp"))?;
    let mut mt = load_terp_warrior_mtree(&mtree_init_path())?;
    terp.owner = Some(sender.to_string());
    mt.admins = vec![sender.to_string()];

    Ok(Some(CwSvgSuiteDeployData {
        svg: vec![(terp, Some(mt))],
        infuse: None,
        admin: Some(sender),
        infuse_coins: vec![],
        shit: None,
    }))
}

/// Multiple SVG collections (terp + dao).
fn deploy_data_full(sender: Addr) -> anyhow::Result<Option<CwSvgSuiteDeployData>> {
    let mut terp = load_svg_init_msg(&svg_init_path("terp"))?;
    let mut dao = load_svg_init_msg(&svg_init_path("dao"))?;
    terp.owner = Some(sender.to_string());
    dao.owner = Some(sender.to_string());

    Ok(Some(CwSvgSuiteDeployData {
        svg: vec![(terp, None), (dao, None)],
        infuse: None,
        admin: Some(sender),
        infuse_coins: vec![],
        shit: None,
    }))
}
