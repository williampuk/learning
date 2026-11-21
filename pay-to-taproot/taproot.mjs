// Public-data calculations for the lesson. Affine arithmetic here is variable-time.
const FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};
export const generatorX = G.x.toString(16);
const hexPattern = /^[\da-f]*$/i;
const encoder = new TextEncoder();
const tagPrefixes = new Map();

export function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function readHex(input, label, length) {
  const value = input.trim().replace(/\s+/g, "");
  if (value.length % 2 || !hexPattern.test(value)) {
    throw new Error(`${label} must contain whole hexadecimal bytes.`);
  }
  if (length !== undefined && value.length !== length * 2) {
    throw new Error(`${label} must be ${length} bytes.`);
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function compactSize(length) {
  if (length < 253) return Uint8Array.of(length);
  if (length <= 0xffff) return Uint8Array.of(253, length, length >> 8);
  return Uint8Array.of(254, length, length >> 8, length >> 16, length >> 24);
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 requires HTTPS or a local server at localhost.");
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

async function taggedHash(tag, message) {
  if (!tagPrefixes.has(tag)) tagPrefixes.set(tag, sha256(encoder.encode(tag)));
  const prefix = await tagPrefixes.get(tag);
  return sha256(concat(prefix, prefix, message));
}

function mod(number) {
  return (number % FIELD + FIELD) % FIELD;
}

function pow(base, exponent) {
  let result = 1n;
  while (exponent) {
    if (exponent & 1n) result = mod(result * base);
    base = mod(base * base);
    exponent >>= 1n;
  }
  return result;
}

function inverse(number) {
  let a = mod(number);
  let b = FIELD;
  let x = 1n;
  let y = 0n;
  while (b) {
    const quotient = a / b;
    [a, b] = [b, a % b];
    [x, y] = [y, x - quotient * y];
  }
  return mod(x);
}

function pointFromX(bytes) {
  const x = BigInt("0x" + hex(bytes));
  if (x >= FIELD) throw new Error("The internal key’s x coordinate is outside the secp256k1 field.");
  const square = mod(x ** 3n + 7n);
  const y = pow(square, (FIELD + 1n) / 4n);
  if (mod(y * y) !== square) throw new Error("The internal key does not lift to a secp256k1 point.");
  return { x, y: y & 1n ? FIELD - y : y };
}

function add(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (a.x === b.x && mod(a.y + b.y) === 0n) return null;
  const slope = a.x === b.x
    ? mod(3n * a.x * a.x * inverse(2n * a.y))
    : mod((b.y - a.y) * inverse(b.x - a.x));
  const x = mod(slope * slope - a.x - b.x);
  return { x, y: mod(slope * (a.x - x) - a.y) };
}

function multiplyGenerator(scalar) {
  let result = null;
  let point = G;
  while (scalar) {
    if (scalar & 1n) result = add(result, point);
    point = add(point, point);
    scalar >>= 1n;
  }
  return result;
}

export async function outputKey(internalKey, root) {
  const point = pointFromX(internalKey);
  const preimage = root === null ? internalKey : concat(internalKey, root);
  const tweak = await taggedHash("TapTweak", preimage);
  const scalar = BigInt("0x" + hex(tweak));
  if (scalar >= ORDER) throw new Error("TapTweak is at least the curve order.");
  const output = add(point, multiplyGenerator(scalar));
  if (output === null) throw new Error("The output point is the point at infinity.");
  return {
    tweak, preimage,
    key: readHex(output.x.toString(16).padStart(64, "0"), "Output key", 32),
    parity: Number(output.y & 1n),
  };
}

export async function tapLeaf(version, script) {
  const length = compactSize(script.length);
  const preimage = concat(Uint8Array.of(version), length, script);
  return { hash: await taggedHash("TapLeaf", preimage), preimage, length };
}

export function tapBranch(a, b) {
  // Comparing equal-length, lowercase hex strings gives the same ordering as comparing bytes.
  return taggedHash("TapBranch", hex(a) <= hex(b) ? concat(a, b) : concat(b, a));
}

export async function commitTree(tree) {
  if (tree === null) return null;
  if (!Array.isArray(tree)) return { ...tree, ...await tapLeaf(tree.version, tree.script) };
  const children = await Promise.all(tree.map(commitTree));
  return { children, hash: await tapBranch(children[0].hash, children[1].hash) };
}

export function proofFor(node, id) {
  if (!node.children) return node.id === id ? { leaf: node, siblings: [] } : null;
  const [left, right] = node.children;
  const fromLeft = proofFor(left, id);
  const proof = fromLeft ?? proofFor(right, id);
  if (proof) proof.siblings.push(fromLeft ? right : left);
  return proof;
}

export function makeControlBlock(version, parity, internalKey, siblings) {
  return concat(Uint8Array.of(version | parity), internalKey, ...siblings);
}

export async function verifyCommitment(expectedKey, script, control) {
  const depth = (control.length - 33) / 32;
  if (!Number.isInteger(depth) || depth < 0 || depth > 128) {
    throw new Error("Control block length must be 33 + 32 × depth bytes, with depth from 0 to 128.");
  }
  const version = control[0] & 0xfe;
  const parity = control[0] & 1;
  const internalKey = control.slice(1, 33);
  const leaf = await tapLeaf(version, script);
  let root = leaf.hash;
  const steps = [];
  for (let i = 0; i < depth; i++) {
    const start = 33 + 32 * i;
    const sibling = control.slice(start, start + 32);
    root = await tapBranch(root, sibling);
    steps.push({ sibling, hash: root });
  }
  const output = await outputKey(internalKey, root);
  const keyMatches = hex(output.key) === hex(expectedKey);
  const parityMatches = output.parity === parity;
  return { leaf, version, parity, internalKey, root, steps, output, keyMatches, parityMatches };
}

export function mainnetAddress(key) {
  const hrp = "bc";
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const data = [1];
  let buffer = 0;
  let bits = 0;
  for (const byte of key) {
    buffer = ((buffer << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((buffer >> bits) & 31);
    }
  }
  if (bits) data.push((buffer << (5 - bits)) & 31);
  const hrpBytes = encoder.encode(hrp);
  const prefix = [...hrpBytes.map(byte => byte >> 5), 0, ...hrpBytes.map(byte => byte & 31)];
  let checksum = 1;
  for (const value of [...prefix, ...data, 0, 0, 0, 0, 0, 0]) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    generators.forEach((generator, i) => {
      if ((top >>> i) & 1) checksum ^= generator;
    });
  }
  checksum ^= 0x2bc830a3;
  for (let i = 5; i >= 0; i--) data.push((checksum >>> (5 * i)) & 31);
  return hrp + "1" + data.map(value => alphabet[value]).join("");
}
