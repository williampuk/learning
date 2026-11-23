// Educational calculations for public examples. The affine implementation is variable-time.
import {
  FIELD, ORDER, add, compactSize, concat, hex, multiply, pointFromX, readHex,
  sha256, taggedHash,
} from "./taproot.mjs";

export const integer = bytes => BigInt("0x" + hex(bytes));
export const scalar = value => (value % ORDER + ORDER) % ORDER;
export const bytes32 = value => readHex(value.toString(16).padStart(64, "0"), "Integer", 32);
export const negate = point => point && { x: point.x, y: (FIELD - point.y) % FIELD };
export const evenScalar = (value, point) => point.y & 1n ? scalar(-value) : value;

const challenge = async (r, key, message) =>
  scalar(integer(await taggedHash("BIP0340/challenge", concat(r, key, message))));

export async function signExample(secret, message, aux) {
  if (secret < 1n || secret >= ORDER) throw new Error("Secret is outside [1, n − 1].");
  if (aux.length !== 32) throw new Error("Auxiliary randomness is exactly 32 bytes.");
  const rawP = multiply(secret);
  const d = evenScalar(secret, rawP);
  const key = bytes32(rawP.x);
  const auxHash = await taggedHash("BIP0340/aux", aux);
  const masked = bytes32(d).map((byte, i) => byte ^ auxHash[i]);
  const nonceHash = await taggedHash("BIP0340/nonce", concat(masked, key, message));
  const k0 = scalar(integer(nonceHash));
  if (k0 === 0n) throw new Error("Zero nonce.");
  const rawR = multiply(k0);
  const k = evenScalar(k0, rawR);
  const R = k === k0 ? rawR : negate(rawR);
  const r = bytes32(R.x);
  const e = await challenge(r, key, message);
  const s = scalar(k + e * d);
  return { rawP, key, d, auxHash, masked, nonceHash, k0, rawR, R, k, e, s, signature: concat(r, bytes32(s)) };
}

export async function verifySchnorr(key, message, signature) {
  if (key.length !== 32 || signature.length !== 64) return { ok: false, reason: "Invalid x-only key or signature length." };
  let P;
  try {
    P = pointFromX(key);
  } catch {
    return { ok: false, reason: "The public key does not lift to a curve point." };
  }
  const r = integer(signature.slice(0, 32));
  const s = integer(signature.slice(32));
  if (r >= FIELD || s >= ORDER) return { ok: false, reason: "r ≥ p or s ≥ n." };
  const e = await challenge(signature.slice(0, 32), key, message);
  const R = add(multiply(s), negate(multiply(e, P)));
  const reason = R === null ? "Reconstructed R is infinity."
    : R.y & 1n ? "Reconstructed R has odd Y."
    : R.x !== r ? "Reconstructed x(R) differs from r." : "";
  return { ok: reason === "", reason, e, R };
}

export function parseSignature(raw) {
  if (raw.length === 64) return { type: 0, signature: raw };
  if (raw.length === 65 && [1, 2, 3, 0x81, 0x82, 0x83].includes(raw[64])) {
    return { type: raw[64], signature: raw.slice(0, 64) };
  }
  throw new Error("Expected 64 bytes or 65 bytes ending in a defined nonzero sighash type.");
}

export function little(value, length) {
  let x = BigInt(value);
  return Uint8Array.from({ length }, () => {
    const byte = Number(x & 255n);
    x >>= 8n;
    return byte;
  });
}

export const varbytes = bytes => concat(compactSize(bytes.length), bytes);
const outpoint = input => concat(readHex(input.txid, "TXID", 32).reverse(), little(input.vout, 4));
const script = item => readHex(item.scriptpubkey, "scriptPubKey");
const output = item => concat(little(item.value, 8), varbytes(script(item)));
export const witnessBytes = items => concat(compactSize(items.length), ...items.map(varbytes));

export function serializeTx(tx, withWitness = false) {
  return concat(little(tx.version, 4), withWitness ? Uint8Array.of(0, 1) : new Uint8Array(),
    compactSize(tx.vin.length), ...tx.vin.map(input => concat(outpoint(input),
      varbytes(readHex(input.scriptsig, "scriptSig")), little(input.sequence, 4))),
    compactSize(tx.vout.length), ...tx.vout.map(output),
    ...(withWitness ? tx.vin.map(input => witnessBytes((input.witness ?? []).map(item => readHex(item, "Witness item")))) : []),
    little(tx.locktime, 4));
}

export async function signatureMessage(tx, index, type, { annex, leafHash, codeSeparator = 0xffffffff } = {}) {
  if (![0, 1, 2, 3, 0x81, 0x82, 0x83].includes(type)) throw new Error("Undefined Taproot sighash type.");
  const anyone = (type & 0x80) !== 0;
  const mode = type & 3;
  const input = tx.vin[index];
  if (!input) throw new Error("Input index out of range.");
  if (mode === 3 && !tx.vout[index]) throw new Error("SIGHASH_SINGLE requires an output at the input’s index.");
  if (annex && annex[0] !== 0x50) throw new Error("Annex must begin with 50.");
  const rows = [];
  const put = (name, bytes, preimage) => rows.push({ name, bytes, preimage });
  const hashed = async (name, preimage) => put(name, await sha256(preimage), preimage);
  put("Epoch", Uint8Array.of(0));
  put("hash_type", Uint8Array.of(type));
  put("nVersion", little(tx.version, 4));
  put("nLockTime", little(tx.locktime, 4));
  if (!anyone) {
    await hashed("sha_prevouts", concat(...tx.vin.map(outpoint)));
    await hashed("sha_amounts", concat(...tx.vin.map(v => little(v.prevout.value, 8))));
    await hashed("sha_scriptpubkeys", concat(...tx.vin.map(v => varbytes(script(v.prevout)))));
    await hashed("sha_sequences", concat(...tx.vin.map(v => little(v.sequence, 4))));
  }
  if (mode === 0 || mode === 1) await hashed("sha_outputs", concat(...tx.vout.map(output)));
  put("spend_type", Uint8Array.of((leafHash ? 2 : 0) + (annex ? 1 : 0)));
  if (anyone) {
    put("This input’s outpoint", outpoint(input));
    put("This input’s amount", little(input.prevout.value, 8));
    put("This input’s scriptPubKey", varbytes(script(input.prevout)));
    put("This input’s nSequence", little(input.sequence, 4));
  } else {
    put("Input index", little(index, 4));
  }
  if (annex) await hashed("sha_annex", varbytes(annex));
  if (mode === 3) await hashed("sha_single_output", output(tx.vout[index]));
  if (leafHash) {
    put("Tapleaf hash", leafHash);
    put("Key version", Uint8Array.of(0));
    put("Last CODESEPARATOR opcode position", little(codeSeparator, 4));
  }
  const bytes = concat(...rows.map(row => row.bytes));
  return { rows, bytes, digest: await taggedHash("TapSighash", bytes) };
}

// BIP32 public derivation for the published BIP86 account xpub.
const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export async function decodeXpub(value) {
  let x = 0n;
  for (const char of value) {
    const digit = base58.indexOf(char);
    if (digit < 0) throw new Error("Invalid Base58 character.");
    x = x * 58n + BigInt(digit);
  }
  const bytes = readHex(x.toString(16).padStart(164, "0"), "Extended key", 82);
  const data = bytes.slice(0, 78);
  if (hex(data.slice(0, 4)) !== "0488b21e" ||
      hex(bytes.slice(78)) !== hex((await sha256(await sha256(data))).slice(0, 4))) {
    throw new Error("Invalid mainnet xpub version or checksum.");
  }
  return { point: decompress(data.slice(45)), chainCode: data.slice(13, 45) };
}

export const compressed = point => concat(Uint8Array.of(2 + Number(point.y & 1n)), bytes32(point.x));

export function decompress(key) {
  if (key.length !== 33 || (key[0] !== 2 && key[0] !== 3)) throw new Error("Invalid compressed key.");
  const even = pointFromX(key.slice(1));
  return key[0] === 2 ? even : negate(even);
}

export async function derivePublic(parent, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error("Child index must be in [0, 2³¹−1].");
  const hmacKey = await crypto.subtle.importKey("raw", parent.chainCode, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const preimage = concat(compressed(parent.point), little(index, 4).reverse());
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, preimage));
  const left = integer(digest.slice(0, 32));
  if (left >= ORDER) throw new Error("Invalid BIP32 child. Try the next index.");
  const point = add(parent.point, multiply(left));
  if (!point) throw new Error("Child is infinity. Try the next index.");
  return { point, chainCode: digest.slice(32), preimage, digest };
}
