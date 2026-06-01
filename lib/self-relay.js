// lib/self-relay.js — Self-relay logic for IBC packets
// Inspired by DAO DAO's SelfRelayExecuteModal pattern.
// Uses cosmes wallet adapter for signing/broadcasting.

/**
 * @typedef {Object} RelayStep
 * @property {string} step    — 'send' | 'commitment' | 'recv' | 'ack' | 'done' | 'error'
 * @property {string} message — Human-readable description
 * @property {*}      [data]  — Optional payload (tx hash, proof, etc.)
 */

/**
 * @typedef {Object} ChainInfo
 * @property {string} chainId
 * @property {string} rpc   — RPC endpoint URL
 * @property {string} rest  — REST/LCD endpoint URL
 * @property {string} prefix — bech32 prefix
 */

// ── RPC/REST helpers ────────────────────────────────────────────

/**
 * Query ABCI via RPC.
 * @param {string} rpc
 * @param {string} path
 * @param {string} data — hex-encoded query data
 * @param {number} [height]
 * @returns {Promise<Object>}
 */
async function abciQuery(rpc, path, data = '', height = 0) {
    const url = `${rpc}/abci_query?path="${encodeURIComponent(path)}"&data=0x${data}&height=${height}&prove=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ABCI query failed: ${res.status}`);
    const json = await res.json();
    return json.result?.response || json.response || {};
}

/**
 * Get a transaction by hash from RPC.
 * @param {string} rpc
 * @param {string} txHash — hex tx hash (no 0x prefix)
 * @returns {Promise<Object>}
 */
async function getTx(rpc, txHash) {
    const res = await fetch(`${rpc}/tx?hash=0x${txHash}&prove=true`);
    if (!res.ok) throw new Error(`Tx query failed: ${res.status}`);
    const json = await res.json();
    return json.result || {};
}

/**
 * Get the latest block header.
 * @param {string} rpc
 * @returns {Promise<Object>}
 */
async function getLatestHeader(rpc) {
    const res = await fetch(`${rpc}/commit`);
    if (!res.ok) throw new Error(`Commit query failed: ${res.status}`);
    const json = await res.json();
    return json.result?.signed_header || {};
}

/**
 * Get a block header at a specific height.
 * @param {string} rpc
 * @param {number} height
 * @returns {Promise<Object>}
 */
async function getHeaderAtHeight(rpc, height) {
    const res = await fetch(`${rpc}/commit?height=${height}`);
    if (!res.ok) throw new Error(`Commit query at ${height} failed: ${res.status}`);
    const json = await res.json();
    return json.result?.signed_header || {};
}

/**
 * Query the client state for an IBC connection via REST.
 * @param {string} rest
 * @param {string} clientId
 * @returns {Promise<Object>}
 */
async function getClientState(rest, clientId) {
    const res = await fetch(`${rest}/ibc/core/client/v1/client_states/${clientId}`);
    if (!res.ok) throw new Error(`Client state query failed: ${res.status}`);
    return res.json();
}

/**
 * Query the connection details for an IBC channel.
 * @param {string} rest
 * @param {string} port
 * @param {string} channel
 * @returns {Promise<Object>}
 */
async function getChannelInfo(rest, port, channel) {
    const res = await fetch(`${rest}/ibc/core/channel/v1/channels/${channel}/ports/${port}`);
    if (!res.ok) throw new Error(`Channel query failed: ${res.status}`);
    return res.json();
}

/**
 * Query packet commitment proof from the source chain.
 * @param {string} rest
 * @param {string} port
 * @param {string} channel
 * @param {number} sequence
 * @returns {Promise<{commitment: string, proof: string, proofHeight: Object}>}
 */
async function getPacketCommitment(rest, port, channel, sequence) {
    const url = `${rest}/ibc/core/channel/v1/channels/${channel}/ports/${port}/packet_commitments/${sequence}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Packet commitment query failed: ${res.status}`);
    const data = await res.json();
    return {
        commitment: data.commitment,
        proof: data.proof,
        proofHeight: data.proof_height,
    };
}

/**
 * Query packet acknowledgement proof from the destination chain.
 * @param {string} rest
 * @param {string} port
 * @param {string} channel
 * @param {number} sequence
 * @returns {Promise<{acknowledgement: string, proof: string, proofHeight: Object}>}
 */
async function getPacketAcknowledgement(rest, port, channel, sequence) {
    const url = `${rest}/ibc/core/channel/v1/channels/${channel}/ports/${port}/packet_acks/${sequence}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Packet ack query failed: ${res.status}`);
    const data = await res.json();
    return {
        acknowledgement: data.acknowledgement,
        proof: data.proof,
        proofHeight: data.proof_height,
    };
}

// ── Packet parsing ──────────────────────────────────────────────

/**
 * Extract IBC packet info from a transaction's events.
 * Looks for 'send_packet' event with sequence, source port/channel, etc.
 *
 * @param {Object} txResult — tx result from RPC query
 * @returns {Object|null} — { sequence, srcPort, srcChannel, dstPort, dstChannel, data, timeoutHeight, timeoutTimestamp }
 */
function extractPacketFromTx(txResult) {
    // Events can be in tx_result.events or tx_result.log[].events
    let events = txResult.tx_result?.events || [];
    if (events.length === 0 && txResult.tx_result?.log) {
        try {
            const logs = JSON.parse(txResult.tx_result.log);
            events = logs.flatMap(l => l.events || []);
        } catch { /* ignore */ }
    }

    for (const ev of events) {
        if (ev.type !== 'send_packet') continue;
        const attrs = {};
        for (const a of (ev.attributes || [])) {
            // Attributes may be base64-encoded or plain
            const key = a.key.length > 20 ? atob(a.key) : a.key;
            const val = a.value && a.value.length > 40 ? atob(a.value) : a.value;
            attrs[key] = val;
        }
        return {
            sequence: parseInt(attrs.packet_sequence || '0'),
            srcPort: attrs.packet_src_port || 'transfer',
            srcChannel: attrs.packet_src_channel || '',
            dstPort: attrs.packet_dst_port || 'transfer',
            dstChannel: attrs.packet_dst_channel || '',
            data: attrs.packet_data || '',
            timeoutHeight: attrs.packet_timeout_height || '0-0',
            timeoutTimestamp: attrs.packet_timeout_timestamp || '0',
        };
    }
    return null;
}

// ── Polling helper ──────────────────────────────────────────────

/**
 * Poll until a condition is met.
 * @param {() => Promise<*>} fn — returns truthy when done
 * @param {number} interval — ms between polls
 * @param {number} maxAttempts
 * @returns {Promise<*>}
 */
async function poll(fn, interval = 3000, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
        const result = await fn().catch(() => null);
        if (result) return result;
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Polling timed out');
}

// ── Main self-relay function ────────────────────────────────────

/**
 * Self-relay an IBC packet: receive it on the destination chain and
 * acknowledge it on the source chain.
 *
 * This is the "poor man's relayer" — the user signs relay messages
 * themselves instead of relying on an external relayer.
 *
 * Flow:
 *   1. Fetch the original IBC send tx and extract packet info
 *   2. Wait for the packet commitment to appear on the source chain
 *   3. Build and broadcast MsgRecvPacket on the destination chain
 *   4. Wait for the acknowledgement to appear on the destination chain
 *   5. Build and broadcast MsgAcknowledgement on the source chain
 *
 * @param {Object} params
 * @param {Object} params.srcWallet   — cosmes wallet for the source chain
 * @param {Object} params.dstWallet   — cosmes wallet for the destination chain
 * @param {ChainInfo} params.srcChain
 * @param {ChainInfo} params.dstChain
 * @param {string} params.txHash      — hex tx hash of the IBC send on source
 * @param {string} params.srcPort     — source port (default: 'transfer')
 * @param {string} params.srcChannel  — source channel (e.g. 'channel-0')
 * @param {string} params.dstPort     — destination port
 * @param {string} params.dstChannel  — destination channel
 * @param {(step: RelayStep) => void} [params.onStep] — progress callback
 * @returns {Promise<{ recvTxHash: string, ackTxHash: string }>}
 */
export async function selfRelay({
    srcWallet,
    dstWallet,
    srcChain,
    dstChain,
    txHash,
    srcPort = 'transfer',
    srcChannel,
    dstPort = 'transfer',
    dstChannel,
    onStep = () => {},
}) {
    // ── Step 1: Fetch tx and extract packet ─────────────────────
    onStep({ step: 'send', message: 'Fetching original IBC send transaction...' });

    const tx = await getTx(srcChain.rpc, txHash);
    if (!tx.tx_result) throw new Error('Transaction not found or not yet indexed');
    if (tx.tx_result.code !== 0) throw new Error(`Original tx failed with code ${tx.tx_result.code}`);

    const packet = extractPacketFromTx(tx);
    if (!packet) throw new Error('No IBC send_packet event found in transaction');

    onStep({ step: 'send', message: `Packet found: sequence ${packet.sequence} on ${packet.srcChannel}`, data: packet });

    // Use extracted values, but allow overrides
    const port = srcPort || packet.srcPort;
    const channel = srcChannel || packet.srcChannel;
    const destPort = dstPort || packet.dstPort;
    const destChannel = dstChannel || packet.dstChannel;
    const sequence = packet.sequence;

    // ── Step 2: Wait for packet commitment proof ────────────────
    onStep({ step: 'commitment', message: `Waiting for packet commitment proof (seq ${sequence})...` });

    const commitment = await poll(async () => {
        try {
            const result = await getPacketCommitment(srcChain.rest, port, channel, sequence);
            if (result.commitment && result.proof) return result;
        } catch { /* not ready yet */ }
        return null;
    }, 3000, 40);

    onStep({ step: 'commitment', message: 'Packet commitment proof obtained', data: commitment });

    // ── Step 3: Build and broadcast MsgRecvPacket on dest ───────
    onStep({ step: 'recv', message: 'Building MsgRecvPacket for destination chain...' });

    const recvMsg = {
        typeUrl: '/ibc.core.channel.v1.MsgRecvPacket',
        value: {
            packet: {
                sequence: String(sequence),
                source_port: port,
                source_channel: channel,
                destination_port: destPort,
                destination_channel: destChannel,
                data: btoa(packet.data),
                timeout_height: parseTimeoutHeight(packet.timeoutHeight),
                timeout_timestamp: packet.timeoutTimestamp,
            },
            proof_commitment: commitment.proof,
            proof_height: commitment.proofHeight,
            signer: dstWallet.address,
        },
    };

    onStep({ step: 'recv', message: 'Broadcasting MsgRecvPacket on destination chain...' });

    let recvTxHash;
    try {
        const recvResult = await dstWallet.broadcastTxSync(
            { msgs: [recvMsg], memo: 'self-relay: recv' },
            1.6
        );
        recvTxHash = recvResult?.hash || recvResult?.tx_response?.txhash || 'unknown';
        onStep({ step: 'recv', message: `MsgRecvPacket broadcast: ${recvTxHash}`, data: { txHash: recvTxHash } });
    } catch (err) {
        onStep({ step: 'error', message: `MsgRecvPacket failed: ${err.message}` });
        throw err;
    }

    // ── Step 4: Wait for acknowledgement on dest chain ──────────
    onStep({ step: 'ack', message: 'Waiting for packet acknowledgement on destination chain...' });

    const ackData = await poll(async () => {
        try {
            const result = await getPacketAcknowledgement(dstChain.rest, destPort, destChannel, sequence);
            if (result.acknowledgement && result.proof) return result;
        } catch { /* not ready yet */ }
        return null;
    }, 3000, 40);

    onStep({ step: 'ack', message: 'Acknowledgement proof obtained', data: ackData });

    // ── Step 5: Build and broadcast MsgAcknowledgement on src ───
    onStep({ step: 'ack', message: 'Building MsgAcknowledgement for source chain...' });

    const ackMsg = {
        typeUrl: '/ibc.core.channel.v1.MsgAcknowledgement',
        value: {
            packet: {
                sequence: String(sequence),
                source_port: port,
                source_channel: channel,
                destination_port: destPort,
                destination_channel: destChannel,
                data: btoa(packet.data),
                timeout_height: parseTimeoutHeight(packet.timeoutHeight),
                timeout_timestamp: packet.timeoutTimestamp,
            },
            acknowledgement: ackData.acknowledgement,
            proof_acked: ackData.proof,
            proof_height: ackData.proofHeight,
            signer: srcWallet.address,
        },
    };

    onStep({ step: 'ack', message: 'Broadcasting MsgAcknowledgement on source chain...' });

    let ackTxHash;
    try {
        const ackResult = await srcWallet.broadcastTxSync(
            { msgs: [ackMsg], memo: 'self-relay: ack' },
            1.6
        );
        ackTxHash = ackResult?.hash || ackResult?.tx_response?.txhash || 'unknown';
        onStep({ step: 'done', message: `Self-relay complete. Ack tx: ${ackTxHash}`, data: { recvTxHash, ackTxHash } });
    } catch (err) {
        onStep({ step: 'error', message: `MsgAcknowledgement failed: ${err.message}` });
        throw err;
    }

    return { recvTxHash, ackTxHash };
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Parse a timeout height string like "1-1234" into { revision_number, revision_height }.
 * @param {string} h
 * @returns {{ revision_number: string, revision_height: string }}
 */
function parseTimeoutHeight(h) {
    const parts = (h || '0-0').split('-');
    return {
        revision_number: parts[0] || '0',
        revision_height: parts[1] || '0',
    };
}

/**
 * Check if an IBC packet has been received (i.e., the ack exists on dest).
 * Useful for status polling in the UI.
 *
 * @param {string} rest — destination chain REST endpoint
 * @param {string} port
 * @param {string} channel
 * @param {number} sequence
 * @returns {Promise<boolean>}
 */
export async function isPacketReceived(rest, port, channel, sequence) {
    try {
        const result = await getPacketAcknowledgement(rest, port, channel, sequence);
        return !!result.acknowledgement;
    } catch {
        return false;
    }
}

/**
 * Check if an IBC packet commitment still exists on source (not yet acked).
 * @param {string} rest — source chain REST endpoint
 * @param {string} port
 * @param {string} channel
 * @param {number} sequence
 * @returns {Promise<boolean>}
 */
export async function isPacketPending(rest, port, channel, sequence) {
    try {
        const result = await getPacketCommitment(rest, port, channel, sequence);
        return !!result.commitment;
    } catch {
        return false;
    }
}
