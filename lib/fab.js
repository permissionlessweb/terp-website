// /public/fab.js - Unified Single FAB Button
(function () {
    'use strict';

    const NAV = [
        { path: '/svg', label: 'SVG' },
        { path: '/tabs', label: 'Account Billboard' },
        { path: '/no-rick', label: 'No Rick' },
        // { path: '/ibc', label: 'IBC' },
        // { path: '/brain', label: 'Brain' },
        // { path: '/passkey', label: 'Passkey' },
        // { path: '/tx', label: 'Tx Builder' },
        // { path: '/admin', label: 'Admin' }
    ];
    let state = {
        walletAddress: null,
        walletBalance: null,
        chainId: null,
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
    async function loadConfig() {
        try {
            const res = await fetch('/config.json');
            const cfg = await res.json();
            state.chainId = cfg.chainId || cfg.chain_id;
            state.isTestnet = /testnet|devnet|local/i.test(state.chainId || '');
            return cfg;
        } catch (e) {
            return {};
        }
    }

    // ─── Wallet ───
    async function connectWallet() {
        if (!window.keplr) return showToast('Keplr not found', 'error');
        try {
            const config = await loadConfig();
            const chainId = state.chainId || config.chainId || config.chain_id;
            await window.keplr.enable(chainId);
            const signer = window.keplr.getOfflineSigner(chainId);
            const [account] = await signer.getAccounts();

            state.walletAddress = account.address;
            localStorage.setItem('terp_fab_wallet', state.walletAddress);
            await fetchBalance(config);
            updateUI();
            showToast('Wallet connected', 'success');
        } catch (e) {
            showToast('Wallet connection failed', 'error');
        }
    }

    async function fetchBalance(config) {
        if (!state.walletAddress) return;
        try {
            const lcd = config.restUrl || config.rest_url;
            const res = await fetch(`${lcd}/cosmos/bank/v1beta1/balances/${state.walletAddress}`);
            const data = await res.json();
            const uterp = data.balances?.find(b => b.denom === 'uterp');
            state.walletBalance = uterp ? (parseInt(uterp.amount) / 1000000).toFixed(2) + ' TERP' : '0 TERP';
        } catch (e) {
            state.walletBalance = '--';
        }
        updateUI();
    }

    function disconnectWallet() {
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
            showToast('Faucet modal not available', 'error');
        }
    }
    function toggleNetwork() {
        state.isTestnet = !state.isTestnet;
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
        if (document.getElementById('terp-fab-root')) return;

        const root = document.createElement('div');
        root.id = 'terp-fab-root';
        root.innerHTML = `
            <div id="fab-menu" style="display:none;position:fixed;bottom:5.5rem;right:1.5rem;background:rgba(10,10,15,0.97);border:1px solid rgba(152,232,193,0.25);border-radius:14px;padding:0.6rem 0.4rem;min-width:190px;box-shadow:0 15px 50px rgba(0,0,0,0.7);backdrop-filter:blur(20px);z-index:99998;flex-direction:column;gap:4px;">
            </div>

            <button id="fab-main-btn" 
                    style="position:fixed;bottom:1.5rem;right:1.5rem;width:56px;height:56px;border-radius:50%;border:none;background:#98e8c1;color:#000;font-size:32px;font-weight:300;box-shadow:0 6px 25px rgba(152,232,193,0.4);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s;">
                +
            </button>
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
        // Network Toggle (Nice Switch Style)
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

        init();
    }

    function toggleMenu() {
        const menu = document.getElementById('fab-menu');
        state.menuOpen = !state.menuOpen;
        menu.style.display = state.menuOpen ? 'flex' : 'none';
    }

    function closeMenu() {
        state.menuOpen = false;
        document.getElementById('fab-menu').style.display = 'none';
    }

    function openWalletInfo() {
        closeMenu();
        const msg = `Wallet Connected\n\nAddress: ${state.walletAddress}\nBalance: ${state.walletBalance || '--'}\n\nDisconnect wallet?`;
        if (confirm(msg)) disconnectWallet();
    }

    function updateUI() {
        // Wallet
        const walletText = document.getElementById('fab-wallet-text');
        if (walletText) {
            walletText.textContent = state.walletAddress ? shortenAddr(state.walletAddress) : 'Connect Wallet';
        }

        // Network
        const networkEl = document.getElementById('fab-network-mode');
        if (networkEl) {
            networkEl.textContent = state.isTestnet ? 'TESTNET' : 'MAINNET';
            networkEl.style.background = state.isTestnet ? 'rgba(255,184,108,0.2)' : 'rgba(152,232,193,0.15)';
            networkEl.style.color = state.isTestnet ? '#ffb86c' : '#98e8c1';
        }

        // Faucet visibility
        const faucetEl = document.getElementById('fab-faucet-item');
        if (faucetEl) faucetEl.style.display = state.isTestnet ? 'block' : 'none';
    }

    async function init() {
        await loadConfig();
        const saved = localStorage.getItem('terp_fab_wallet');
        if (saved) {
            state.walletAddress = saved;
            const config = await loadConfig();
            await fetchBalance(config);
        }
        updateUI();
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();