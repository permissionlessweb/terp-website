// auth.js — Shared authentication utilities for Terp Network pages
// Exports: loadWasm, isWasmReady, registerPasskey, authenticatePasskey, connectKeplr, signTx

let _wasm = null;
let _wasmReady = false;

const wasmStub = () => { console.warn('WASM module not loaded'); return null; };
const _stubs = {
  generate_entropy: wasmStub,
  derive_keypair: wasmStub,
  derive_keypair_from_mnemonic: wasmStub,
  create_credential_options: wasmStub,
  parse_attestation: wasmStub,
  sign_challenge: wasmStub,
  build_register_authenticator_msg: wasmStub,
  verify_signature: wasmStub,
};

/** Load the passkey WASM module. Returns true if successful. */
export async function loadWasm() {
  if (_wasmReady) return true;
  try {
    const mod = await import('/lib/passkey-wasm/passkey_wasm.js');
    await mod.default();
    _wasm = mod;
    _wasmReady = true;
    return true;
  } catch {
    console.warn('passkey-wasm not available, using stubs');
    _wasm = _stubs;
    return false;
  }
}

/** Check if WASM module is loaded. */
export function isWasmReady() {
  return _wasmReady;
}

/** Get the raw wasm module (for advanced use). */
export function getWasm() {
  return _wasm || _stubs;
}

/** Register a new passkey on the device. Returns { publicKey, credentialId } or null. */
export async function registerPasskey(rpName, userName, displayName) {
  const w = _wasm || _stubs;
  const entropy = w.generate_entropy();
  if (!entropy) return null;

  const keypair = w.derive_keypair(entropy);
  if (!keypair) return null;

  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challengeHex = Array.from(challengeBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const options = w.create_credential_options(
    rpName || 'terp.network',
    userName || 'user',
    displayName || 'Terp User',
    challengeHex,
  );
  if (!options) return null;

  try {
    const credential = await navigator.credentials.create({ publicKey: options });
    const attestB64 = btoa(String.fromCharCode(...new Uint8Array(credential.response.attestationObject)));
    const clientB64 = btoa(String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON)));
    const parsed = w.parse_attestation(attestB64, clientB64);
    if (!parsed) return null;
    return { publicKey: keypair.public_key, credentialId: parsed.credential_id };
  } catch (err) {
    if (err.name === 'NotAllowedError') return null;
    throw err;
  }
}

/** Authenticate with an existing passkey. Returns { credential_id, signature_b64 } or null. */
export async function authenticatePasskey(challenge) {
  const w = _wasm || _stubs;
  if (!challenge) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    challenge = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const result = w.sign_challenge(challenge);
  if (!result) return null;
  return result;
}

/** Connect Keplr wallet. Returns { wallet, address, controller } or throws. */
export async function connectKeplr(chainConfig, cosmesChainInfo) {
  if (!window.keplr) throw new Error('Keplr wallet extension not installed');

  const { KeplrController, WalletType } = await import('https://esm.sh/@goblinhunt/cosmes@0.0.71-ghunt.21/wallet');

  await window.keplr.experimentalSuggestChain(chainConfig);
  const controller = new KeplrController('');
  const wallets = await controller.connect(WalletType.EXTENSION, cosmesChainInfo);
  const wallet = wallets.get(chainConfig.chainId);
  if (!wallet) throw new Error('Failed to connect to ' + chainConfig.chainName);

  return { wallet, address: wallet.address, controller };
}

/**
 * Sign a transaction body. For passkey: wraps with webauthn extension.
 * For keplr: returns txBody unchanged (signing handled by cosmes wallet).
 */
export async function signTx(txBody, signerType = 'keplr') {
  if (signerType === 'passkey') {
    const assertion = await authenticatePasskey();
    if (!assertion) throw new Error('Passkey authentication failed');
    return {
      ...txBody,
      extension: {
        authenticators: [{
          label: 'passkey',
          params: {
            type_value: 'webauthn',
            credential_id: assertion.credential_id,
            signature: assertion.signature_b64,
          },
        }],
      },
    };
  }
  // keplr: passthrough — signing is done by the cosmes wallet adapter
  return txBody;
}
