use std::collections::HashMap;

use cw_headstash::interface::HeadstashContract;
use cw_headstash_manifold::{interface::CwHeadstashManifold, msg::ExecuteMsgFns};
use cw_infuser_scripts::suite::CwSvgSuite;
use cw_orch::prelude::*;
use dao_testing::DaoDaoSuite;
use shit_scripts::CwShitstrapSuite;
use terp_account_scripts::TerpAccountSuite;
use zk_test_press::{suites::headstash::HeadstashSuite, TestPressSuite};

use crate::deploy_data::TerpNetworkDeployData;

/// Unified deployment suite composing all website contract suites.
pub struct TerpNetworkSuite<Chain: ZkCwEnv> {
    pub chain: Chain,
    pub infuser: Option<CwSvgSuite<Chain>>,
    pub billboards: Option<TerpAccountSuite<Chain>>,
    pub dao: Option<DaoDaoSuite<Chain>>,
    pub zk: Option<TestPressSuite<Chain>>,
}

impl<Chain: ZkCwEnv> TerpNetworkSuite<Chain>
where
    cw_orch::prelude::CwOrchError: From<<Chain as cw_orch::prelude::TxHandler>::Error>,
{
    /// Deploy suites conditionally based on which deploy data fields are `Some`.
    pub fn deploy_on(chain: Chain, data: TerpNetworkDeployData) -> Result<Self, CwOrchError> {
        // 1. CwSvgSuite (cw-infuser + SVG collections + shitstraps)
        let infuser = if let Some(svg_data) = data.cw_infuser {
            let mut suite = CwSvgSuite::deploy_on(chain.clone(), Some(svg_data))?;
            if let Some(shit_data) = data.shitstraps {
                suite.shit = CwShitstrapSuite::deploy_on(chain.clone(), Some(shit_data))?;
            }
            Some(suite)
        } else {
            None
        };

        let billboards = if let Some(admin) = data.terp_billboards {
            Some(TerpAccountSuite::deploy_on(chain.clone(), admin)?)
        } else {
            None
        };

        // 3. DaoDaoSuite (DAO contracts including calendar)
        let dao = if let Some(data) = data.dao {
            Some(DaoDaoSuite::deploy_on(chain.clone(), data)?)
        } else {
            None
        };

        // 4. ZkHeadstashSuite (cw-headstash + cw-headstash-manifold + circuits)
        let zk = if let Some(zk_data) = data.zk {
            match TestPressSuite::deploy_on(chain.clone(), zk_data) {
                Ok(suite) => Some(suite),
                Err(e) => {
                    tracing::warn!("ZK headstash deploy failed (non-fatal): {}", e);
                    None
                }
            }
        } else {
            None
        };

        Ok(Self {
            chain,
            infuser,
            billboards,
            dao,
            zk,
        })
    }

    /// Collect deployed contract addresses as a map (config key -> address).
    pub fn collect_addresses(&self) -> HashMap<String, String> {
        let mut addrs = HashMap::new();

        if let Some(ref suite) = self.infuser {
            if let Ok(addr) = suite.minter.addr_str() {
                addrs.insert("cwSvgMinter".into(), addr);
            }
            if let Ok(addr) = suite.cwsvg.addr_str() {
                addrs.insert("cw721Svg".into(), addr);
            }
            if let Ok(addr) = suite.infuser.addr_str() {
                addrs.insert("cwInfusionMinter".into(), addr);
            }
            if let Ok(addr) = suite.shit.factory.addr_str() {
                addrs.insert("shitstrapFactory".into(), addr);
            }
        }

        if let Some(ref suite) = self.billboards {
            if let Ok(addr) = suite.manifold.addr_str() {
                addrs.insert("accountMinter".into(), addr);
            }
            if let Ok(addr) = suite.nft.addr_str() {
                addrs.insert("terp721Account".into(), addr);
            }
        }

        // #[cfg(feature = "dao")]
        // if let Some(ref suite) = self.dao {
        //     if let Ok(addr) = suite.dao_core.addr_str() { addrs.insert("daoCore".into(), addr); }
        //     if let Ok(addr) = suite.external.calendar.addr_str() { addrs.insert("daoCalendar".into(), addr); }
        // }

        if let Some(ref suite) = self.zk {
            if let Ok(addr) = suite.headstash.headstash.addr_str() {
                addrs.insert("cwHeadstash".into(), addr);
            }
            if let Ok(addr) = suite.headstash.manifold.addr_str() {
                addrs.insert("cwHeadstashManifold".into(), addr);
            }
        }

        addrs
    }

    /// Print deployed contract addresses in `CONTRACT_ADDR:name=addr` format.
    pub fn print_addresses(&self) {
        for (key, addr) in self.collect_addresses() {
            println!("CONTRACT_ADDR:{}={}", key, addr);
        }
    }
}
