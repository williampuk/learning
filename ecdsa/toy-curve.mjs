// Educational arithmetic only. Every value fits exactly in a JavaScript number.
export const P = 17;
export const N = 19;
export const A = 2;
export const B = 2;
export const G = Object.freeze([5, 1]);
export const O = null;

export const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
export const show = (point) => point === O ? "𝒪" : `(${point[0]}, ${point[1]})`;
export const equal = (left, right) => left === right ||
  (left !== O && right !== O && left[0] === right[0] && left[1] === right[1]);

export function inverse(value, modulus) {
  const reduced = mod(value, modulus);
  // Trial multiplication is visible and practical at the two toy moduli.
  for (let candidate = 1; candidate < modulus; candidate++) {
    if (mod(reduced * candidate, modulus) === 1) return candidate;
  }
  throw new RangeError("This residue has no multiplicative inverse.");
}

export function rhs(x) {
  return mod(x ** 3 + A * x + B, P);
}

export function roots(x) {
  if (!Number.isInteger(x) || x < 0 || x >= P) return [];
  const target = rhs(x);
  return Array.from({ length: P }, (_, y) => y).filter(y => mod(y ** 2, P) === target);
}

export function onCurve(point) {
  if (!Array.isArray(point) || point.length !== 2) return false;
  const [x, y] = point;
  return Number.isInteger(y) && roots(x).includes(y);
}

export function negate(point) {
  return point === O ? O : [point[0], mod(-point[1], P)];
}

// Return the intermediate values used by both addition and its walkthrough.
export function addition(left, right) {
  if (left === O) return { kind: "left identity", point: right };
  if (right === O) return { kind: "right identity", point: left };
  const [x1, y1] = left;
  const [x2, y2] = right;
  if (x1 === x2 && mod(y1 + y2, P) === 0) {
    return { kind: "vertical", point: O };
  }
  const doubling = equal(left, right);
  const numerator = doubling ? 3 * x1 ** 2 + A : y2 - y1;
  const denominator = doubling ? 2 * y1 : x2 - x1;
  const reciprocal = inverse(denominator, P);
  const slope = mod(numerator * reciprocal, P);
  const x = mod(slope ** 2 - x1 - x2, P);
  const y = mod(slope * (x1 - x) - y1, P);
  return { kind: doubling ? "tangent" : "chord", numerator, denominator, reciprocal, slope, point: [x, y] };
}

export const add = (left, right) => addition(left, right).point;

export function multiply(scalar, point) {
  if (!Number.isSafeInteger(scalar)) throw new RangeError("Use an integer scalar.");
  let remaining = Math.abs(scalar);
  let term = scalar < 0 ? negate(point) : point;
  let result = O;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = add(result, term);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) term = add(term, term);
  }
  return result;
}

export const multiples = Array.from({ length: N + 1 }, (_, scalar) => multiply(scalar, G));
export const affine = Array.from({ length: P }, (_, x) => roots(x).map(y => [x, y])).flat();

const inRange = (value, min, max) => Number.isInteger(value) && min <= value && value <= max;
export const validScalar = value => inRange(value, 1, N - 1);
export const validDigest = value => inRange(value, 0, 31);

export function sign(d, z, k) {
  if (!validScalar(d) || !validScalar(k) || !validDigest(z)) {
    return { error: "Use integer values d and k in 1–18 and z in 0–31." };
  }
  const R = multiply(k, G);
  const r = mod(R[0], N);
  const kInv = inverse(k, N);
  const sum = z + r * d;
  const s = mod(kInv * sum, N);
  const error = r === 0 ? "r = 0. Choose a different nonce." :
    s === 0 ? "s = 0. Choose a different nonce." : null;
  return { R, r, kInv, sum, s, error };
}

export function verify(Q, z, r, s) {
  if (!onCurve(Q) || multiply(N, Q) !== O) {
    return { error: "Supply a non-infinity public key on the curve in the subgroup." };
  }
  if (!validDigest(z) || !validScalar(r) || !validScalar(s)) {
    return { error: "Use integer z in 0–31 and signature components r and s in 1–18." };
  }
  const w = inverse(s, N);
  const u1 = mod(z * w, N);
  const u2 = mod(r * w, N);
  const left = multiply(u1, G);
  const right = multiply(u2, Q);
  const point = add(left, right);
  const x = point === O ? null : mod(point[0], N);
  return { w, u1, u2, left, right, point, x, valid: x === r };
}

export function recover(z, r, s, parity, branch = 0) {
  if (!validDigest(z) || !validScalar(r) || !validScalar(s) ||
      !inRange(parity, 0, 1) || !inRange(branch, 0, 1)) {
    return { error: "Supply a valid digest, signature and recovery selector." };
  }
  const x = r + branch * N;
  if (x >= P) return { x, error: `x = ${x} is outside the field (0–16).` };
  const y = roots(x).find(root => root % 2 === parity);
  if (y === undefined) return { x, error: `There is no root of parity ${parity} at x = ${x}.` };
  const R = [x, y];
  if (multiply(N, R) !== O) return { x, R, error: "R is outside the subgroup." };
  const rInv = inverse(r, N);
  const sR = multiply(s, R);
  const zG = multiply(z, G);
  const difference = add(sR, negate(zG));
  const Q = multiply(rInv, difference);
  const verification = verify(Q, z, r, s);
  return { x, R, rInv, sR, zG, difference, Q, verification,
    error: verification.valid ? null : "This branch does not produce a valid public key." };
}

export function normalize(r, s, parity) {
  return s > Math.floor(N / 2) ? { r, s: N - s, parity: parity ^ 1 } : { r, s, parity };
}

export function nonceReuse(d, k, z1, z2, lowS) {
  const first = sign(d, z1, k);
  const second = sign(d, z2, k);
  if (first.error || second.error) return { error: first.error || second.error };
  const { r } = first;
  if (mod(z1 - z2, N) === 0) {
    return { error: "The digests have the same residue modulo 19. Their equations are identical." };
  }
  const observed = [first.s, second.s].map(s => lowS ? normalize(r, s, 0).s : s);
  const signChoices = lowS ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 1]];
  const Q = multiply(d, G);
  const rows = signChoices.map(([sign1, sign2]) => {
    const s1 = mod(sign1 * observed[0], N);
    const s2 = mod(sign2 * observed[1], N);
    const difference = mod(s1 - s2, N);
    if (difference === 0) return { sign1, sign2, s1, s2 };
    const deltaInv = inverse(difference, N);
    const recoveredK = mod((z1 - z2) * deltaInv, N);
    const rInv = inverse(r, N);
    const recoveredD = mod(rInv * (s1 * recoveredK - z1), N);
    const R = multiply(recoveredK, G);
    const matches = R !== O && mod(R[0], N) === r && equal(multiply(recoveredD, G), Q);
    return { sign1, sign2, s1, s2, difference, deltaInv, recoveredK, rInv, recoveredD, matches };
  });
  return { r, observed, rows };
}
