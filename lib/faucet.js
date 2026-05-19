// lib/faucet.js — Faucet client for terp network (dev & production)

const FAUCET_BASE = 'https://faucet.terp.network';

/**
 * Request funds from the faucet.
 * @param {string} address — bech32 address to fund (e.g. terp1...)
 * @returns {Promise<Object>} faucet response — { txhash: "..." }
 */
export async function faucetFund(address) {
    const res = await fetch(`${FAUCET_BASE}/faucet?address=${address}`);
    if (!res.ok) throw new Error(`Faucet error: ${res.status} ${res.statusText}`);
    return res.json();
}

/**
 * Check faucet health/status.
 * @returns {Promise<Object>} status response
 */
export async function faucetStatus() {
    const res = await fetch(`${FAUCET_BASE}/status`);
    if (!res.ok) throw new Error(`Faucet status error: ${res.status}`);
    return res.json();
}

/**
 * Show faucet UI modal. Call from a faucet button click handler.
 * Creates a simple modal overlay with address input + fund button.
 *
 * @param {string} [defaultAddress] — pre-fill address (e.g. connected wallet)
 */
export function showFaucetModal(defaultAddress = '') {
    // Remove existing modal if any
    const existing = document.getElementById('faucet-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'faucet-modal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(6px);
    `;
    modal.innerHTML = `
        <div style="
            background: #1a1a2e; border: 1px solid rgba(152,232,193,0.2);
            border-radius: 8px; padding: 2rem; max-width: 420px; width: 90%;
            font-family: 'Satoshi', sans-serif; color: #f8f8f2;
        ">
            <h3 style="margin: 0 0 1rem; color: #98e8c1; font-size: 1.1rem;">Terp Faucet</h3>
            <input id="faucet-addr" type="text" placeholder="terp1..."
                value="${defaultAddress}"
                style="
                    width: 100%; padding: 0.6rem 0.8rem; margin-bottom: 1rem;
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(152,232,193,0.2);
                    border-radius: 4px; color: #f8f8f2; font-family: monospace; font-size: 0.85rem;
                " />
            <div style="display:flex; gap:0.5rem;">
                <button id="faucet-send" style="
                    flex: 1; padding: 0.5rem; cursor: pointer; border-radius: 4px;
                    background: rgba(152,232,193,0.15); border: 1px solid rgba(152,232,193,0.3);
                    color: #98e8c1; font-family: 'Satoshi', sans-serif; font-size: 0.85rem;
                ">Fund</button>
                <button id="faucet-close" style="
                    padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px;
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                    color: #d2d3d8; font-family: 'Satoshi', sans-serif; font-size: 0.85rem;
                ">Close</button>
            </div>
            <div id="faucet-result" style="margin-top:0.75rem; font-size:0.8rem; color:#d2d3d8;"></div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close on backdrop click or close button
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    document.getElementById('faucet-close').addEventListener('click', () => modal.remove());

    // Fund button
    document.getElementById('faucet-send').addEventListener('click', async () => {
        const addr = document.getElementById('faucet-addr').value.trim();
        const result = document.getElementById('faucet-result');
        if (!addr) { result.textContent = 'Enter an address'; return; }
        result.textContent = 'Requesting funds...';
        result.style.color = '#d2d3d8';
        try {
            const resp = await faucetFund(addr);
            result.textContent = 'Funded! Tx: ' + (resp.txhash || JSON.stringify(resp));
            result.style.color = '#98e8c1';
        } catch (e) {
            result.textContent = 'Error: ' + e.message;
            result.style.color = '#ff5555';
        }
    });
}