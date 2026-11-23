// The affine formulas follow the lesson. These routines are for public examples.
export const identity = [0n, 1n];
export const toy = { p: 53n, d: 3n, order: 7n, base: [4n, 43n] };
export const torsionPoint = [1n, 23n];
const prime = (1n << 255n) - 19n;
export const ed25519 = {
  p: prime,
  d: mod(-121665n * inverse(121666n, prime), prime),
  order: (1n << 252n) + 27742317777372353535851937790883648493n,
  base: [
    15112221349535400772501151409588531511454012693041857206046113283949847762202n,
    46316835694926478169428394003475163141307993866256225615783033603165251855960n,
  ],
};

export function mod(value, modulus) {
  const residue = value % modulus;
  return residue < 0n ? residue + modulus : residue;
}

export function inverse(value, modulus) {
  let current = mod(value, modulus);
  let next = modulus;
  let coefficient = 1n;
  let nextCoefficient = 0n;
  while (next !== 0n) {
    const quotient = current / next;
    [current, next] = [next, current - quotient * next];
    [coefficient, nextCoefficient] = [nextCoefficient, coefficient - quotient * nextCoefficient];
  }
  if (current !== 1n) throw new RangeError("The denominator has no inverse.");
  return mod(coefficient, modulus);
}

export function equals(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

export function onCurve([x, y], { p, d }) {
  const xx = x * x;
  const yy = y * y;
  return mod(-xx + yy - 1n - d * xx * yy, p) === 0n;
}

export function addition([x1, y1], [x2, y2], { p, d }) {
  const t = mod(d * x1 * x2 * y1 * y2, p);
  const numerators = [mod(x1 * y2 + x2 * y1, p), mod(y1 * y2 + x1 * x2, p)];
  const denominators = [mod(1n + t, p), mod(1n - t, p)];
  const inverses = denominators.map(value => inverse(value, p));
  const sum = numerators.map((value, index) => mod(value * inverses[index], p));
  return { t, numerators, denominators, inverses, sum };
}

export function add(left, right, curve) {
  return addition(left, right, curve).sum;
}

// Keep the full scalar here. Reducing it by the base order would be wrong
// for points that have a component outside the prime-order subgroup.
export function multiply(scalar, point, curve) {
  let result = identity;
  while (scalar > 0n) {
    if (scalar & 1n) result = add(result, point, curve);
    scalar >>= 1n;
    if (scalar > 0n) point = add(point, point, curve);
  }
  return result;
}

export function verifyEquation(S, R, c, A, curve) {
  const left = multiply(S, curve.base, curve);
  const scaledKey = multiply(c, A, curve);
  const right = add(R, scaledKey, curve);
  return { left, scaledKey, right, valid: equals(left, right) };
}

export const toyMultiples = Array.from({ length: 8 }, (_, i) => multiply(BigInt(i), toy.base, toy));
export const toyPoints = [];
for (let y = 0n; y < toy.p; y++) {
  for (let x = 0n; x < toy.p; x++) {
    if (onCurve([x, y], toy)) toyPoints.push([x, y]);
  }
}

export function decodeToyPoint(y, parity) {
  return toyPoints.find(([x, candidateY]) => candidateY === y && (x & 1n) === parity);
}

export function toySignature(a, r, c) {
  const A = multiply(a, toy.base, toy);
  const R = multiply(r, toy.base, toy);
  const S = mod(r + c * a, toy.order);
  return { A, R, S };
}

export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export const fromHex = value => Uint8Array.from(value.match(/../g) ?? [], pair => parseInt(pair, 16));

export function fromLE(bytes) {
  return bytes.reduceRight((scalar, byte) => (scalar << 8n) + BigInt(byte), 0n);
}

export function toLE(value, length = 32) {
  return Uint8Array.from({ length }, (_, i) => Number((value >> (8n * BigInt(i))) & 255n));
}

export function encodePoint([x, y]) {
  return toLE(y | ((x & 1n) << 255n));
}

function concatenate(...arrays) {
  const joined = new Uint8Array(arrays.reduce((length, array) => length + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    joined.set(array, offset);
    offset += array.length;
  }
  return joined;
}

const sha512 = async bytes => new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
export const vector = {
  seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
};

export async function challengeDigest(encodedR, encodedA, message) {
  return sha512(concatenate(encodedR, encodedA, message));
}

export async function traceVector(message) {
  const expanded = await sha512(fromHex(vector.seed));
  const pruned = expanded.slice(0, 32);
  pruned[0] &= 248;
  pruned[31] = (pruned[31] & 127) | 64;
  const a = fromLE(pruned);
  const prefix = expanded.slice(32);
  const A = multiply(a, ed25519.base, ed25519);
  const encodedA = encodePoint(A);
  const nonceDigest = await sha512(concatenate(prefix, message));
  const r = mod(fromLE(nonceDigest), ed25519.order);
  const R = multiply(r, ed25519.base, ed25519);
  const encodedR = encodePoint(R);
  const challenge = await challengeDigest(encodedR, encodedA, message);
  const c = mod(fromLE(challenge), ed25519.order);
  const S = mod(r + c * a, ed25519.order);
  const encodedS = toLE(S);
  return {
    expanded, pruned, a, prefix, A, encodedA, nonceDigest, r, R, encodedR, challenge, c, S,
    encodedS, signature: concatenate(encodedR, encodedS),
  };
}
