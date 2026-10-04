// Saloon stage 2: Derive's action signing (EIP-712 over the Action struct, Derive docs "Action
// signing"). The action data encoders come from Derive's own SDK (@derivexyz/derive-ts/codecs);
// hashing and keys use ethers. Loaded only in builds with VITE_SALOON_TRADE on.
import { AbiCoder, SigningKey, TypedDataEncoder, Wallet, concat, formatUnits, getAddress, keccak256, parseUnits, toUtf8Bytes, verifyMessage } from "ethers";
import { encodeRfqExecute, encodeSetSessionKeyActionData, sortRfqLegs } from "@derivexyz/derive-ts/codecs";
import { PROTOCOL, RFQ_OPTION_SCOPE, RFQ_OPTION_SCOPE_CODE } from "./config.js";

const abi = AbiCoder.defaultAbiCoder();

export function domainSeparator(chainId) {
  return keccak256(abi.encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
    [keccak256(toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
      keccak256(toUtf8Bytes(PROTOCOL.domainName)), keccak256(toUtf8Bytes(PROTOCOL.domainVersion)), chainId, PROTOCOL.verifyingContract],
  ));
}

export function actionHash(f) {
  return keccak256(abi.encode(
    ["bytes32", "uint256", "uint256", "address", "bytes32", "uint256", "address", "address"],
    [PROTOCOL.actionTypehash, f.subaccountId, f.nonce, getAddress(f.module), keccak256(f.data), f.expirySec, getAddress(f.owner), getAddress(f.signer)],
  ));
}

export const actionDigest = (f, chainId) => keccak256(concat(["0x1901", domainSeparator(chainId), actionHash(f)]));

/** The same action as EIP-712 typed data, for a browser wallet's eth_signTypedData_v4. */
export function actionTypedData(f, chainId) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      Action: [
        { name: "subaccountId", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "module", type: "address" },
        { name: "data", type: "bytes" }, { name: "expiry", type: "uint256" }, { name: "owner", type: "address" }, { name: "signer", type: "address" },
      ],
    },
    primaryType: "Action",
    domain: { name: PROTOCOL.domainName, version: PROTOCOL.domainVersion, chainId, verifyingContract: PROTOCOL.verifyingContract },
    message: {
      subaccountId: String(f.subaccountId), nonce: String(f.nonce), module: getAddress(f.module), data: f.data,
      expiry: String(f.expirySec), owner: getAddress(f.owner), signer: getAddress(f.signer),
    },
  };
}

/** The typed-data digest a wallet signs (equals actionDigest). */
export function typedDataDigest(td) {
  const { EIP712Domain, ...types } = td.types;
  return TypedDataEncoder.hash(td.domain, types, td.message);
}

/** Nonce: UTC milliseconds x 1e6 plus a random 6-digit suffix, as a decimal string. */
export function randomNonce(now = Date.now(), rand = Math.random) {
  return (BigInt(Math.floor(now)) * 1000000n + BigInt(Math.floor(rand() * 1e6))).toString();
}

/** A new session key, made in this browser. */
export const makeKey = () => Wallet.createRandom();
export const keyFromSecret = (secret) => new Wallet(secret);
export const signDigest = (digest, wallet) => wallet.signingKey.sign(digest).serialized;
export const recoverLogin = (message, signature) => verifyMessage(message, signature);

const e18 = (v) => parseUnits(String(v), 18);
const wire = (v) => formatUnits(e18(v), 18);

/** The Derive wire shape of a quote leg, normalised (no trailing ".0"). */
const legWire = (l) => ({ instrument_name: l.instrument_name, direction: l.direction, amount: wire(l.amount), price: wire(l.price) });

/**
 * The signed execution of a maker quote (design 2.2: execute_quote; in the dry run it goes only to
 * public/execute_quote_debug). The taker trades opposite the quote's direction and signs the quote's
 * own legs and prices. `instruments` maps each leg's name to Derive's base_asset_address and
 * base_asset_sub_id (public/get_instrument). Returns the payload and the local hashes.
 */
export function buildExecute({ quote, subaccountId, owner, key, instruments, maxFee, chainId, nonce, expirySec, referral, label }) {
  const direction = quote.direction === "buy" ? "sell" : "buy";
  const legs = sortRfqLegs(quote.legs.map((l) => {
    const ins = instruments[l.instrument_name];
    if (!ins) throw new Error(`unknown instrument ${l.instrument_name}`);
    return { instrumentName: l.instrument_name, assetAddress: ins.base_asset_address, subId: ins.base_asset_sub_id, price: String(l.price), amount: String(l.amount), direction: l.direction };
  }));
  const data = encodeRfqExecute({ maxFee: wire(maxFee), direction, legs });
  const fields = { subaccountId, nonce, module: PROTOCOL.rfqModule, data, expirySec, owner, signer: key.address };
  const digest = actionDigest(fields, chainId);
  const payload = {
    subaccount_id: subaccountId, rfq_id: quote.rfq_id, quote_id: quote.quote_id, direction,
    legs: sortRfqLegs(quote.legs.map((l) => ({ ...l, instrumentName: l.instrument_name }))).map(legWire),
    max_fee: wire(maxFee), nonce, signer: key.address, signature: signDigest(digest, key), signature_expiry_sec: expirySec,
  };
  const extra = { enable_taker_protection: true, ...(referral ? { referral_code: referral } : {}), ...(label ? { label } : {}) };
  return { payload, extra, local: { encoded_data: data, encoded_data_hashed: keccak256(data), action_hash: actionHash(fields), typed_data_hash: digest } };
}

/** Does Derive's execute_quote_debug answer match what this browser signed, byte for byte? */
export function debugMatches(local, remote) {
  const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase().replace(/^0x/, "") === b.toLowerCase().replace(/^0x/, "");
  const fields = ["encoded_data", "encoded_data_hashed", "action_hash", "typed_data_hash"];
  const mismatched = fields.filter((k) => remote?.[k] != null && !same(local[k], remote[k]));
  const compared = fields.filter((k) => remote?.[k] != null);
  return { ok: compared.length > 0 && mismatched.length === 0, mismatched, compared };
}

/**
 * The session-key grant as a signed action the owner's wallet signs (module: set session key,
 * subaccount 0). Scope codes are signed; the wire carries the scope strings.
 */
export function buildSetSessionKey({ owner, sessionKey, grant, nonce, signatureExpirySec, chainId }) {
  const codes = grant.protocol_scopes.map((s) => {
    if (s !== RFQ_OPTION_SCOPE) throw new Error(`scope not allowed: ${s}`);
    return RFQ_OPTION_SCOPE_CODE;
  });
  const data = encodeSetSessionKeyActionData({ sessionKey: getAddress(sessionKey), expirySec: grant.expiry_sec, scopes: codes, subaccountIds: grant.subaccount_ids });
  const fields = { subaccountId: 0, nonce, module: PROTOCOL.setSessionKeyModule, data, expirySec: signatureExpirySec, owner, signer: owner };
  const typedData = actionTypedData(fields, chainId);
  const params = (signature) => ({
    wallet: getAddress(owner), public_session_key: getAddress(sessionKey), expiry_sec: grant.expiry_sec,
    subaccount_ids: grant.subaccount_ids, protocol_scopes: grant.protocol_scopes, offchain_scopes: grant.offchain_scopes,
    label: grant.label, nonce, signer: getAddress(owner), signature, signature_expiry_sec: signatureExpirySec,
  });
  return { fields, typedData, digest: actionDigest(fields, chainId), params };
}
