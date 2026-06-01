// /public/fab.js - Unified Single FAB Button
(function () {
    'use strict';

    const LOG_PREFIX = '[TERP-FAB]';
    const LOG_LEVELS = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' };

    function log(level, ...args) {
        const ts = new Date().toISOString().substr(11, 12);
        const method = console[level] || console.log;
        method(`${LOG_PREFIX} [${ts}]`, ...args);
    }

    const NAV = [
        { path: '/svg', label: 'SVG' },
        { path: '/tabs', label: 'Account Billboard' },
        { path: '/no-rick', label: 'No Rick' },
        { path: '/ibc', label: 'IBC' },
    ];
    let state = {
        walletAddress: null,
        walletBalance: null,
        chainId: null,
        restUrl: null,   
        rpcUrl: null,     
        denom: 'uterp',  
        decimals: 6,     
        isTestnet: false,
        menuOpen: false,
    };

    function shortenAddr(addr) {
        if (!addr) return '';
        return addr.slice(0, 8) + '...' + addr.slice(-4);
    }

    function getCurrentPath() {
        return window.location.pathname.replace(/\/$/, '') || '/';
    }

    function showToast(msg, type = 'info') {
        let container = document.getElementById('terp-fab-toasts');
        if (!container) {
            container = document.createElement('div');
            container.id = 'terp-fab-toasts';
            container.style.cssText = `
            position:fixed; 
            top:8.5rem; 
            right:1.8rem; 
            z-index:99999; 
            display:flex; 
            flex-direction:column; 
            gap:0.5rem; 
            max-width:300px;
            pointer-events:none;
        `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const color = type === 'success' ? '#98e8c1' : type === 'error' ? '#fe7d7d' : '#bd93f9';

        toast.style.cssText = `
        padding:0.75rem 1rem; 
        border-radius:8px; 
        background:rgba(10,10,15,0.96); 
        border:1px solid ${color}; 
        color:white; 
        font-size:0.83rem; 
        backdrop-filter:blur(12px);
        box-shadow:0 4px 15px rgba(0,0,0,0.5);
    `;
        toast.textContent = msg;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'all 0.3s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(12px)';
            setTimeout(() => toast.remove(), 300);
        }, 3800);
    }

    function detectChainId() {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) return '120u-1';
        if (host.includes('testnet')) return '120u-1';
        return 'morocco-1';
    }

    async function loadConfig() {
        log(LOG_LEVELS.INFO, 'loadConfig() → fetching /public/config.json');

        try {
            const res = await fetch('/public/config.json');

            if (!res.ok) {
                log(LOG_LEVELS.ERROR, 'loadConfig() → non-OK response:', res.status, res.statusText);
                return applyFallback();
            }

            const site = await res.json();
            const chainId = detectChainId();
            const cfg = site.chains?.[chainId];

            if (!cfg) {
                log(LOG_LEVELS.ERROR, 'loadConfig() → chainId not found:', chainId, 'available:', Object.keys(site.chains || {}));
                return applyFallback();
            }

            state.chainId = cfg.chainId;
            state.restUrl = cfg.rest;
            state.rpcUrl = cfg.rpc;
            state.denom = cfg.denom?.stake || 'uterp';
            state.decimals = cfg.denom?.decimals || 6;
            state.explorer = cfg.explorer;
            state.isTestnet = /testnet|devnet|local|120u/i.test(state.chainId || '');

            log(LOG_LEVELS.INFO, 'loadConfig() → resolved:', {
                chainId: state.chainId,
                restUrl: state.restUrl,
                rpcUrl: state.rpcUrl,
                isTestnet: state.isTestnet,
                denom: state.denom
            });

            return cfg;

        } catch (e) {
            log(LOG_LEVELS.ERROR, 'loadConfig() → failed:', e.message);
            return applyFallback();
        }
    }

    function applyFallback() {
        const chainId = detectChainId();
        const isTestnet = /120u|testnet|local/i.test(chainId);

        state.chainId = chainId;
        state.restUrl = isTestnet ? 'http://127.0.0.1:1617' : 'https://api.terp.network';
        state.rpcUrl = isTestnet ? 'http://127.0.0.1:36657' : 'https://rpc.terp.network';
        state.denom = 'uterp';
        state.decimals = 6;
        state.isTestnet = isTestnet;

        log(LOG_LEVELS.WARN, 'loadConfig() → using hardcoded fallback:', {
            chainId: state.chainId,
            restUrl: state.restUrl,
            isTestnet: state.isTestnet
        });

        return { chainId: state.chainId, rest: state.restUrl, rpc: state.rpcUrl };
    }

    // ─── Wallet ───
    async function connectWallet() {
        log(LOG_LEVELS.INFO, 'connectWallet() → initiated');

        if (!window.keplr) {
            log(LOG_LEVELS.ERROR, 'connectWallet() → window.keplr is undefined. Keplr extension not installed or not injected.');
            showToast('Keplr not found', 'error');
            return;
        }

        log(LOG_LEVELS.DEBUG, 'connectWallet() → window.keplr detected:', typeof window.keplr);

        try {
            const config = await loadConfig();
            const chainId = state.chainId || config.chainId || config.chain_id;

            if (!chainId) {
                log(LOG_LEVELS.ERROR, 'connectWallet() → no chainId resolved. Config may be missing or malformed.', {
                    stateChainId: state.chainId,
                    configChainId: config.chainId,
                    configChain_id: config.chain_id
                });
                showToast('No chain ID found in config', 'error');
                return;
            }

            log(LOG_LEVELS.INFO, 'connectWallet() → enabling chain:', chainId);

            await window.keplr.enable(chainId);
            log(LOG_LEVELS.DEBUG, 'connectWallet() → keplr.enable() succeeded for chain:', chainId);

            const signer = window.keplr.getOfflineSigner(chainId);
            log(LOG_LEVELS.DEBUG, 'connectWallet() → got offline signer:', typeof signer);

            const accounts = await signer.getAccounts();
            log(LOG_LEVELS.DEBUG, 'connectWallet() → accounts retrieved:', accounts.length, accounts.map(a => ({ type: a.algo, address: a.address })));

            if (!accounts || accounts.length === 0) {
                log(LOG_LEVELS.ERROR, 'connectWallet() → no accounts returned from signer');
                showToast('No accounts found', 'error');
                return;
            }

            const [account] = accounts;
            state.walletAddress = account.address;
            localStorage.setItem('terp_fab_wallet', state.walletAddress);

            log(LOG_LEVELS.INFO, 'connectWallet() → wallet connected:', {
                address: state.walletAddress,
                shortened: shortenAddr(state.walletAddress),
                chainId: chainId
            });

            await fetchBalance(config);
            updateUI();
            showToast('Wallet connected', 'success');

        } catch (e) {
            log(LOG_LEVELS.ERROR, 'connectWallet() → FAILED:', {
                message: e.message,
                name: e.name,
                stack: e.stack,
                fullError: e
            });

            // Identify common failure reasons
            if (e.message?.includes('no chain data')) {
                log(LOG_LEVELS.ERROR, 'connectWallet() → Chain not registered in Keplr. Ensure the chain is added via Keplr\'s "Add Token" or experimental mode.');
            } else if (e.message?.includes('Request rejected') || e.message?.includes('user rejected')) {
                log(LOG_LEVELS.WARN, 'connectWallet() → User rejected the connection request in Keplr.');
            } else if (e.message?.includes('account')) {
                log(LOG_LEVELS.ERROR, 'connectWallet() → Account access issue. Keplr may be locked or no account selected.');
            }

            showToast('Wallet connection failed', 'error');
        }
    }

    async function fetchBalance(config) {
        if (!state.walletAddress) {
            log(LOG_LEVELS.DEBUG, 'fetchBalance() → skipped, no wallet address');
            return;
        }

        const lcd = state.restUrl || config?.restUrl || config?.rest_url;

        if (!lcd) {
            log(LOG_LEVELS.ERROR, 'fetchBalance() → no REST/LCD URL in config. Cannot fetch balance.', {
                restUrl: config.restUrl,
                rest_url: config.rest_url
            });
            state.walletBalance = '--';
            updateUI();
            return;
        }

        const url = `${lcd}/cosmos/bank/v1beta1/balances/${state.walletAddress}`;
        log(LOG_LEVELS.DEBUG, 'fetchBalance() → requesting:', url);

        try {
            const res = await fetch(url);
            log(LOG_LEVELS.DEBUG, 'fetchBalance() → response:', res.status, res.statusText);

            if (!res.ok) {
                log(LOG_LEVELS.ERROR, 'fetchBalance() → non-OK response:', res.status, await res.text().catch(() => '(unreadable)'));
                state.walletBalance = '--';
                updateUI();
                return;
            }

            const data = await res.json();
            log(LOG_LEVELS.DEBUG, 'fetchBalance() → balances:', data.balances);

            const denom = state.denom || 'uterp';
            const matchDenom = data.balances?.find(b => b.denom === denom);

            if (matchDenom) {
                const decimals = state.decimals || 6;
                state.walletBalance = (parseInt(matchDenom.amount) / Math.pow(10, decimals)).toFixed(2) + ' TERP';
                log(LOG_LEVELS.INFO, 'fetchBalance() → balance:', { raw: matchDenom.amount, display: state.walletBalance });
            } else {
                state.walletBalance = '0 TERP';
                log(LOG_LEVELS.INFO, 'fetchBalance() → no ' + denom + ' balance found, defaulting to 0 TERP');
            }
        } catch (e) {
            log(LOG_LEVELS.ERROR, 'fetchBalance() → failed:', e.message, e);
            state.walletBalance = '--';
        }

        updateUI();
    }

    function disconnectWallet() {
        log(LOG_LEVELS.INFO, 'disconnectWallet() → disconnecting:', state.walletAddress);
        state.walletAddress = null;
        state.walletBalance = null;
        localStorage.removeItem('terp_fab_wallet');
        updateUI();
        showToast('Wallet disconnected');
        closeMenu();
    }

    // ─── Faucet Integration ───
    async function openFaucet() {
        closeMenu();
        if (typeof window.showFaucetModal === 'function') {
            window.showFaucetModal(state.walletAddress || '');
        } else {
            log(LOG_LEVELS.WARN, 'openFaucet() → window.showFaucetModal is not a function:', typeof window.showFaucetModal);
            showToast('Faucet modal not available', 'error');
        }
    }

    function toggleNetwork() {
        state.isTestnet = !state.isTestnet;
        // Update chainId and endpoints to match
        if (state.isTestnet) {
            state.chainId = '120u-1';
            state.restUrl = 'http://localhost:55026'; // or your testnet API
        } else {
            state.chainId = 'morocco-1';
            state.restUrl = 'https://api.terp.network';
        }
        updateUI();
        showToast(`Switched to ${state.isTestnet ? 'TESTNET' : 'MAINNET'}`, 'info');
    }

    function updateUI() {
        // Wallet
        const walletText = document.getElementById('fab-wallet-text');
        if (walletText) {
            walletText.textContent = state.walletAddress ? shortenAddr(state.walletAddress) : 'Connect Wallet';
        }

        // Network Switch
        const switchBg = document.getElementById('fab-network-switch');
        if (switchBg) {
            switchBg.style.background = state.isTestnet ? '#ffb86c' : '#334155';
            switchBg.parentElement.querySelector('div:last-child').style.left = state.isTestnet ? '22px' : '3px';
        }

        // Network Status Text
        const statusEl = document.getElementById('fab-network-status');
        if (statusEl) {
            statusEl.textContent = state.isTestnet ? 'TESTNET ACTIVE' : 'MAINNET';
            statusEl.style.color = state.isTestnet ? '#ffb86c' : '#98e8c1';
        }

        // Faucet visibility
        const faucetEl = document.getElementById('fab-faucet-item');
        if (faucetEl) faucetEl.style.display = state.isTestnet ? 'block' : 'none';
    }

    // ─── Inject FAB ───
    function inject() {
        if (document.getElementById('terp-fab-root')) {
            log(LOG_LEVELS.DEBUG, 'inject() → FAB already injected, skipping');
            return;
        }

        log(LOG_LEVELS.INFO, 'inject() → injecting FAB into DOM');

        const root = document.createElement('div');
        root.id = 'terp-fab-root';
        root.innerHTML = `
            <div id="fab-menu" style="display:none;position:fixed;bottom:5.5rem;right:1.5rem;background:rgba(10,10,15,0.97);border:1px solid rgba(152,232,193,0.25);border-radius:14px;padding:0.6rem 0.4rem;min-width:190px;box-shadow:0 15px 50px rgba(0,0,0,0.7);backdrop-filter:blur(20px);z-index:99998;flex-direction:column;gap:4px;"></div>
            <button id="fab-main-btn" style="position:fixed;bottom:1.5rem;right:1.5rem;width:56px;height:56px;border-radius:50%;border:none;background:#98e8c1;color:#000;font-size:32px;font-weight:300;box-shadow:0 6px 25px rgba(152,232,193,0.4);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s;"> + </button>
        `;
        document.body.appendChild(root);

        const menu = document.getElementById('fab-menu');
        const mainBtn = document.getElementById('fab-main-btn');

        // Populate Navigation
        menu.innerHTML = `<div style="padding:0.4rem 0.8rem;font-size:0.65rem;letter-spacing:0.5px;color:rgba(152,232,193,0.5);text-transform:uppercase;">Navigation</div>`;
        NAV.forEach(item => {
            const a = document.createElement('a');
            a.href = item.path;
            a.style.cssText = `padding:0.65rem 1rem;color:#d2d3d8;text-decoration:none;border-radius:8px;font-size:0.9rem;`;
            a.textContent = item.label;
            if (getCurrentPath() === item.path) a.style.background = 'rgba(152,232,193,0.12)';
            menu.appendChild(a);
        });

        // Wallet Section
        const walletSection = document.createElement('div');
        walletSection.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(152,232,193,0.15);';
        walletSection.innerHTML = `
            <div style="padding:0.4rem 0.8rem 0.2rem;font-size:0.65rem;letter-spacing:0.5px;color:rgba(152,232,193,0.5);text-transform:uppercase;">Wallet</div>
            <div id="fab-wallet-status" style="padding:0.5rem 1rem;color:#98e8c1;font-size:0.85rem;cursor:pointer;border-radius:8px;" onclick="window._terpFab.walletAction()">
                <strong id="fab-wallet-text">Connect Wallet</strong>
            </div>
        `;
        menu.appendChild(walletSection);

        // Network Toggle
        const networkSection = document.createElement('div');
        networkSection.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(152,232,193,0.15);';
        networkSection.innerHTML = `
            <div style="padding:0.4rem 0.8rem 0.3rem;font-size:0.65rem;letter-spacing:0.5px;color:rgba(152,232,193,0.5);text-transform:uppercase;">Network</div>
            <div onclick="window._terpFab.toggleNetwork()" 
                 style="padding:0.5rem 1rem;display:flex;align-items:center;justify-content:space-between;cursor:pointer;border-radius:8px;">
                <span style="color:#d2d3d8;">Testnet Mode</span>
                <div style="position:relative;width:42px;height:22px;">
                    <div id="fab-network-switch" style="
                        position:absolute;
                        width:42px;height:22px;
                        background:${state.isTestnet ? '#ffb86c' : '#334155'};
                        border-radius:999px;
                        transition:all 0.3s;
                    "></div>
                    <div style="
                        position:absolute;
                        top:3px;
                        left:${state.isTestnet ? '22px' : '3px'};
                        width:16px;height:16px;
                        background:white;
                        border-radius:50%;
                        box-shadow:0 2px 4px rgba(0,0,0,0.3);
                        transition:all 0.3s;
                    "></div>
                </div>
            </div>
            <div id="fab-network-status" style="font-size:0.75rem;padding:0 1rem;color:${state.isTestnet ? '#ffb86c' : '#98e8c1'};margin-top:4px;">
                ${state.isTestnet ? 'TESTNET ACTIVE' : 'MAINNET'}
            </div>
        `;
        menu.appendChild(networkSection);

        // Faucet (Testnet only)
        const faucetDiv = document.createElement('div');
        faucetDiv.id = 'fab-faucet-item';
        faucetDiv.style.cssText = 'padding:0.65rem 1rem;color:#ffb86c;font-size:0.9rem;cursor:pointer;border-radius:8px;display:none;';
        faucetDiv.textContent = 'Faucet';
        faucetDiv.onclick = () => window._terpFab.openFaucet();
        menu.appendChild(faucetDiv);

        mainBtn.addEventListener('click', toggleMenu);

        window._terpFab = {
            walletAction: () => {
                if (state.walletAddress) openWalletInfo();
                else connectWallet();
            },
            toggleNetwork,
            openFaucet
        };

        log(LOG_LEVELS.INFO, 'inject() → FAB injected, calling init()');
        init();
    }

    function toggleMenu() {
        const menu = document.getElementById('fab-menu');
        state.menuOpen = !state.menuOpen;
        menu.style.display = state.menuOpen ? 'flex' : 'none';
        log(LOG_LEVELS.DEBUG, 'toggleMenu() → menu', state.menuOpen ? 'opened' : 'closed');
    }

    function closeMenu() {
        state.menuOpen = false;
        const menu = document.getElementById('fab-menu');
        if (menu) menu.style.display = 'none';
    }

    function openWalletInfo() {
        closeMenu();
        const msg = `Wallet Connected\n\nAddress: ${state.walletAddress}\nBalance: ${state.walletBalance || '--'}\n\nDisconnect wallet?`;
        if (confirm(msg)) disconnectWallet();
    }

    async function init() {
        log(LOG_LEVELS.INFO, 'init() → starting initialization');
        const config = await loadConfig();
        const saved = localStorage.getItem('terp_fab_wallet');
        if (saved) {
            log(LOG_LEVELS.INFO, 'init() → found saved wallet address:', saved);
            state.walletAddress = saved;
            await fetchBalance(config);
        } else {
            log(LOG_LEVELS.INFO, 'init() → no saved wallet address in localStorage');
        }

        updateUI();

        log(LOG_LEVELS.INFO, 'init() → complete. State:', {
            walletAddress: state.walletAddress ? shortenAddr(state.walletAddress) : null,
            walletBalance: state.walletBalance,
            chainId: state.chainId,
            isTestnet: state.isTestnet
        });
    }

    // Auto-init
    if (document.readyState === 'loading') {
        log(LOG_LEVELS.DEBUG, 'Waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        log(LOG_LEVELS.DEBUG, 'DOM already loaded, injecting immediately');
        inject();
    }

    log(LOG_LEVELS.INFO, 'FAB script loaded');
})();