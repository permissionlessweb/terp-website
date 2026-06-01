// // config-loader.js — on-chain config via terp721-account text records
// // Queries text records from a named account NFT, maps cfg:* keys to CONFIG fields,
// // falls back to static config.json, then to hardcoded defaults.

// // Bootstrap constants — the one thing that must be known ahead of time
// const DEFAULTS = {
//     "morocco-1": {
//         rest: "https://api.terp.network",
//         accountContract: " ",
//         configAccount: "",
//     },
//     "120u-1": {
//         rest: "https://testnet-api.terp.network",
//         accountContract: "",
//         configAccount: "",
//     },
//     "240u-1": {
//         rest: "http://localhost:1317",
//         accountContract: "",
//         configAccount: "",
//     },
// };

// // Text record key → CONFIG field mapping (dot-path notation)
// const KEY_MAP = {
//     "cfg:rpc": "rpc",
//     "cfg:rest": "rest",
//     "cfg:explorer": "explorerBase",
//     "cfg:contracts.cw721Svg": "contracts.cw721Svg",
//     "cfg:contracts.accountMinter": "contracts.accountMinter",
//     "cfg:contracts.cwSvgMinter": "contracts.cwSvgMinter",
//     "cfg:contracts.shitstrapFactory": "contracts.shitstrapFactory",
//     "cfg:contracts.cwInfusionMinter": "contracts.cwInfusionMinter",
//     "cfg:contracts.terp721Account": "contracts.terp721Account",
//     "cfg:services.merkleServer": "services.merkleServer",
//     "cfg:services.indexer": "services.indexer",
//     "cfg:services.headstashServer": "services.headstashServer",
//     "cfg:contracts.headstash": "contracts.headstash",
//     "cfg:contracts.headstashManifold": "contracts.headstashManifold",
//     "cfg:contracts.ibcCallbackReceiver": "contracts.ibcCallbackReceiver",
//     "cfg:apps": "apps",
// };

// function setNestedValue(obj, dotPath, value) {
//     const parts = dotPath.split(".");
//     let cur = obj;
//     for (let i = 0; i < parts.length - 1; i++) {
//         if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") {
//             cur[parts[i]] = {};
//         }
//         cur = cur[parts[i]];
//     }
//     cur[parts[parts.length - 1]] = value;
// }

// function detectChainId() {
//     // const host = window.location.hostname;
//     // if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) return '120u-1';
//     // if (host.includes('testnet')) return '120u-1';
//     return 'morocco-1';
// }

// async function queryTextRecordsRest(restUrl, contractAddr, account) {
//     const query = { text_records: { account } };
//     const queryB64 = btoa(JSON.stringify(query));
//     const url = `${restUrl}/cosmwasm/wasm/v1/contract/${contractAddr}/smart/${queryB64}`;
//     const res = await fetch(url);
//     if (!res.ok) throw new Error(`LCD query failed: ${res.status}`);
//     const json = await res.json();
//     return json.data;
// }

// // Cache for raw text records so index.html checksum verification can reuse them
// let _cachedRecords = null;

// /**
//  * Load site config from on-chain text records + static config.json.
//  * Mutates `defaults` in-place and returns it.
//  *
//  * @param {object} defaults — the page's hardcoded CONFIG object
//  * @returns {object} the same object, merged with on-chain + static values
//  */
// export async function loadSiteConfig(defaults) {
//     const chainId = detectChainId();
//     const bootstrap = DEFAULTS[chainId] || DEFAULTS["morocco-1"];

//     // 1. Fetch static config.json (non-blocking — we merge whatever we get)
//     // Replace the broken fetch block with:
//     let staticChain = null;
//     try {
//         const res = await fetch("/public/config.json");
//         if (res.ok) {
//             const site = await res.json();
//             staticChain = site.chains?.[chainId];
//             if (site.checksums) window._siteChecksums = site.checksums;
//         }
//     } catch (e) {
//         console.warn("config-loader: static config.json fetch failed:", e.message);
//     }
// }

// // ── Attempt 2: window-level config from config-loader.js ──
// if (window._terpSiteConfig && window._terpSiteConfig.chainId) {
//     log(LOG_LEVELS.INFO, 'loadConfig() → found window._terpSiteConfig:', window._terpSiteConfig);
//     applyConfig(window._terpSiteConfig, 'window._terpSiteConfig');
//     return window._terpSiteConfig;
// }


// // Merge static config into defaults
// if (staticChain) {
//     if (staticChain.chainId) defaults.chainId = staticChain.chainId;
//     if (staticChain.chainName) defaults.chainName = staticChain.chainName;
//     if (staticChain.rpc) defaults.rpc = staticChain.rpc;
//     if (staticChain.rest) defaults.rest = staticChain.rest;
//     if (staticChain.explorer) defaults.explorerBase = staticChain.explorer;
//     if (staticChain.bech32Prefix) defaults.bech32Prefix = staticChain.bech32Prefix;
//     if (staticChain.denom) {
//         defaults.denom = staticChain.denom.fee;
//         defaults.denomDisplay = staticChain.denom.feeDisplay;
//         defaults.denomDecimals = staticChain.denom.decimals;
//     }
//     // Contract addresses
//     if (staticChain.contracts) {
//         for (const [k, v] of Object.entries(staticChain.contracts)) {
//             if (v) setNestedValue(defaults, `contracts.${k}`, v);
//         }
//     }
//     // Services
//     if (staticChain.services) {
//         for (const [k, v] of Object.entries(staticChain.services)) {
//             if (v) setNestedValue(defaults, `services.${k}`, v);
//         }
//     }
//     // Page-specific convenience aliases used by existing pages
//     if (staticChain.contracts?.cwSvgMinter) defaults.minterContract = staticChain.contracts.cwSvgMinter;
//     if (staticChain.contracts?.cw721Svg) defaults.staticCollections = [staticChain.contracts.cw721Svg];
//     if (staticChain.contracts?.shitstrapFactory) defaults.shitstrapFactory = staticChain.contracts.shitstrapFactory;
//     if (staticChain.contracts?.accountMinter) defaults.accountMinterContract = staticChain.contracts.accountMinter;
//     if (staticChain.contracts?.terp721Account) defaults.accountContract = staticChain.contracts.terp721Account;
//     if (staticChain.services?.merkleServer) defaults.merkleServerUrl = staticChain.services.merkleServer;
//     if (staticChain.services?.indexer) defaults.indexerBase = staticChain.services.indexer;
//     if (staticChain.services?.headstashServer) defaults.headstashServerUrl = staticChain.services.headstashServer;
//     if (staticChain.contracts?.headstash) defaults.headstashContract = staticChain.contracts.headstash;
//     if (staticChain.contracts?.headstashManifold) defaults.headstashManifoldContract = staticChain.contracts.headstashManifold;
//     if (staticChain.contracts?.ibcCallbackReceiver) defaults.ibcCallbackContract = staticChain.contracts.ibcCallbackReceiver;
//     // }

//     // Determine contract address + account name for text record query
//     const contractAddr = staticChain?.contracts?.terp721Account || bootstrap.accountContract;
//     const configAccount = staticChain?.configAccount || bootstrap.configAccount;

//     // 2. Query on-chain text records (highest priority)
//     if (contractAddr && configAccount) {
//         const restUrl = defaults.rest || staticChain?.rest || bootstrap.rest;
//         try {
//             const records = await queryTextRecordsRest(restUrl, contractAddr, configAccount);
//             _cachedRecords = records;
//             if (Array.isArray(records)) {
//                 for (const rec of records) {
//                     const field = KEY_MAP[rec.account];
//                     if (field) {
//                         if (field === "apps") {
//                             try { setNestedValue(defaults, field, JSON.parse(rec.value)); } catch { }
//                             continue;
//                         }
//                         setNestedValue(defaults, field, rec.value);
//                         // Also set convenience aliases
//                         if (field === "contracts.cwSvgMinter") defaults.minterContract = rec.value;
//                         if (field === "contracts.cw721Svg" && rec.value) defaults.staticCollections = [rec.value];
//                         if (field === "contracts.shitstrapFactory") defaults.shitstrapFactory = rec.value;
//                         if (field === "contracts.accountMinter") defaults.accountMinterContract = rec.value;
//                         if (field === "contracts.terp721Account") defaults.accountContract = rec.value;
//                         if (field === "services.merkleServer") defaults.merkleServerUrl = rec.value;
//                         if (field === "services.indexer") defaults.indexerBase = rec.value;
//                         if (field === "services.headstashServer") defaults.headstashServerUrl = rec.value;
//                         if (field === "contracts.headstash") defaults.headstashContract = rec.value;
//                         if (field === "contracts.headstashManifold") defaults.headstashManifoldContract = rec.value;
//                         if (field === "contracts.ibcCallbackReceiver") defaults.ibcCallbackContract = rec.value;
//                     }
//                 }
//             }
//         } catch (err) {
//             console.warn("config-loader: on-chain text records unavailable:", err.message);
//         }
//     }

//     return defaults;
// }

// /**
//  * Get the bootstrap info for the config contract.
//  * Useful for admin pages that need to know which contract/account holds config.
//  */
// export function getConfigContract() {
//     const chainId = detectChainId();
//     const bootstrap = DEFAULTS[chainId] || DEFAULTS["morocco-1"];
//     return {
//         rest: bootstrap.rest,
//         contractAddress: bootstrap.accountContract,
//         configAccount: bootstrap.configAccount,
//         chainId,
//     };
// }

// /**
//  * Get cached raw text records (available after loadSiteConfig resolves).
//  * Used by index.html for checksum verification without double-fetching.
//  */
// export function getCachedTextRecords() {
//     return _cachedRecords;
// }

// /**
//  * Look up a single text record by key from cached records.
//  */
// export function getTextRecord(name) {
//     if (!_cachedRecords) return null;
//     const rec = _cachedRecords.find(r => r.account === name);
//     return rec ? rec.value : null;
// }

// const DEFAULT_APPS = [
//     { id: "svg", title: "SVG", url: "/svg.html" },
//     { id: "no-rick", title: "No Rick", url: "/no-rick.html" },
//     { id: "tabs", title: "Names", url: "/tabs.html", disabled: true },
//     { id: "ibc", title: "IBC", url: "/ibc.html", disabled: true },
//     // { id: "oline",   title: "O-Line",  url: "/oline.html",   disabled: true },
//     // { id: "admin",   title: "Admin",   url: "/admin.html",   disabled: true },
//     // { id: "tx",      title: "Tx",      url: "/tx.html",      disabled: true },
//     // { id: "passkey", title: "Passkey", url: "/passkey.html",  disabled: true },
//     // { id: "shell",      title: "Shell",      url: "/shell.html",      disabled: true },
//     // { id: "headstash",  title: "Headstash",  url: "/headstash.html",  disabled: true },
// ];

// export function getAppsRegistry(config) {
//     return config?.apps || DEFAULT_APPS;
// }
