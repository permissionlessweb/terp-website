/* tslint:disable */
/* eslint-disable */

/**
 * Build PublicKeyCredentialCreationOptions for navigator.credentials.create().
 * Returns a JS object ready to pass as { publicKey: <result> }.
 */
export function build_create_options(rp_id: string, rp_name: string, user_id_b64: string, user_name: string, display_name: string, challenge_b64: string): any;

/**
 * Build PublicKeyCredentialRequestOptions for navigator.credentials.get().
 * `allowed_cred_ids_json` is a JSON array of base64 credential IDs: ["abc=", "xyz="]
 */
export function build_get_options(rp_id: string, challenge_b64: string, allowed_cred_ids_json: string): any;

/**
 * Encode raw assertion response buffers to base64 for sending to the server.
 */
export function encode_assertion(authenticator_data: Uint8Array, client_data_json: Uint8Array, signature: Uint8Array): any;

/**
 * Encode raw attestation response buffers to base64 for sending to the server.
 */
export function encode_attestation(attestation_object: Uint8Array, client_data_json: Uint8Array): any;

/**
 * Generate a 32-byte cryptographically random challenge, returned as base64.
 */
export function generate_challenge(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly build_create_options: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly build_get_options: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly encode_assertion: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly encode_attestation: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly generate_challenge: () => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
