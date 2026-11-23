import {
  A, G, N, O, P, add, addition, equal, mod, multiples, multiply, negate,
  nonceReuse, normalize, recover, rhs, roots, show, sign, validScalar, verify,
} from "./toy-curve.mjs";
import { colors, cyclePlot, finitePlot, realPlot, ringPlot } from "./plots.mjs";

const byId = id => document.getElementById(id);
const value = id => {
  const control = byId(id);
  return control.value === "" || !control.validity.valid ? NaN : Number(control.value);
};
const watch = (ids, action) => {
  for (const id of ids) byId(id).addEventListener("input", action);
};
const plot = (id, highlights) => finitePlot(byId(id), highlights);
const highlight = (point, color, name) => ({ point, color, name });

function output(id, message, state = "") {
  const element = byId(id);
  element.textContent = Array.isArray(message) ? message.join("\n") : message;
  element.dataset.state = state;
}

function populatePoints(id, selected, allowInfinity) {
  const options = multiples.slice(0, N).flatMap((point, scalar) => {
    if (scalar === 0) return allowInfinity ? [new Option("𝒪 · Identity", 0)] : [];
    return [new Option(`${scalar === 1 ? "G" : `${scalar}G`} · ${show(point)}`, scalar)];
  });
  const control = byId(id);
  control.replaceChildren(...options);
  control.value = selected;
}

function describeAddition(left, right) {
  const result = addition(left, right);
  if (result.kind.includes("identity")) {
    return [`Identity rule: ${show(left)} + ${show(right)} = ${show(result.point)}.`];
  }
  if (result.kind === "vertical") {
    return [`Same X and Y sum ≡ 0 (mod ${P}). Vertical line ⇒ ${show(O)}.`];
  }
  const [x1, y1] = left;
  const [x2, y2] = right;
  const { numerator, denominator, reciprocal, slope, point } = result;
  const slopeFormula = result.kind === "tangent" ?
    `(3·${x1}² + ${A}) / (2·${y1})` : `(${y2} − ${y1}) / (${x2} − ${x1})`;
  return [
    `${result.kind === "tangent" ? "Tangent" : "Chord"}: λ = ${slopeFormula}`,
    `Denominator ${denominator} ≡ ${mod(denominator, P)}. Inverse = ${reciprocal} (mod ${P}).`,
    `λ ≡ ${numerator}·${reciprocal} ≡ ${slope} (mod ${P}).`,
    `x₃ ≡ ${slope}² − ${x1} − ${x2} ≡ ${point[0]} (mod ${P}).`,
    `y₃ ≡ ${slope}·(${x1} − ${point[0]}) − ${y1} ≡ ${point[1]} (mod ${P}).`,
  ];
}

function renderClock() {
  const m = value("clock-mod");
  const start = value("clock-start");
  const step = value("clock-step");
  if (!Number.isInteger(start) || !Number.isInteger(step)) {
    output("clock-result", "Enter whole numbers from −999 to 999.", "bad");
    ringPlot(byId("clock-plot"), m, new Map(), "mod " + m, "Choose a start and step");
    return;
  }
  const begin = mod(start, m);
  const end = mod(start + step, m);
  output("clock-result", [
    `Start: ${start} ≡ ${begin} (mod ${m}).`,
    `${start} + (${step}) = ${start + step} ≡ ${end} (mod ${m}).`,
  ]);
  const selected = new Map([[begin, colors.violet], [end, colors.cyan]]);
  ringPlot(byId("clock-plot"), m, selected, `${begin} → ${end}`, `mod ${m}`);
}

const geometryText = {
  chord: [
    "The horizontal chord through (−1, 1) and (0, 1) has y = 1.",
    "The cubic’s third root is x = 1. The chord reaches T = (1, 1).",
    "Reflect T across the X-axis. The sum is (1, −1).",
  ],
  tangent: [
    "The tangent through P = (0, 1) has slope −1/2 and meets P twice.",
    "At x = 1/4 the line reaches the remaining intersection T = (1/4, 7/8).",
    "Reflect T. The doubled point is (1/4, −7/8).",
  ],
  vertical: [
    "P and −P share x = 0. The chord is vertical.",
    "The third intersection is the point at infinity, 𝒪.",
    "The identity is its own inverse. P + (−P) = 𝒪.",
  ],
};

function renderGeometry() {
  const kind = byId("geometry-kind").value;
  const step = value("geometry-step");
  output("geometry-result", geometryText[kind][step - 1]);
  realPlot(byId("geometry-plot"), [-1, 1], { kind, step });
}

function renderAddition() {
  const left = multiples[value("add-first")];
  const right = multiples[value("add-second")];
  const result = add(left, right);
  output("add-result", [
    ...describeAddition(left, right),
    `Sum: ${show(result)}`,
  ]);
  plot("add-plot", [
    highlight(left, colors.violet), highlight(right, colors.gold), highlight(result, colors.cyan),
  ]);
}

function renderKey(d, Q) {
  if (!validScalar(d)) {
    output("key-result", "Choose an integer private scalar in 1–18.", "bad");
    plot("key-plot", [highlight(G, colors.violet)]);
    return;
  }
  const powers = [];
  const lines = [`d = ${d} = ${d.toString(2)}₂. Start the accumulator at 𝒪.`];
  let accumulator = O;
  let term = G;
  for (let remaining = d, power = 1; remaining; remaining = Math.floor(remaining / 2), power *= 2) {
    const keep = remaining % 2 === 1;
    if (keep) {
      powers.push(`${power}G`);
      accumulator = add(accumulator, term);
    }
    lines.push(`${power}G = ${show(term)} · ${keep ? `add ⇒ ${show(accumulator)}` : "skip (bit 0)"}`);
    term = add(term, term);
  }
  lines.push(`Q = ${powers.join(" + ")} = ${show(Q)}`);
  output("key-result", lines, "good");
  plot("key-plot", [highlight(G, colors.violet), highlight(Q, colors.cyan)]);
}

function renderSignature({ d, z, k, Q, signature }) {
  if (!signature.R) {
    output("sign-result", signature.error, "bad");
    plot("sign-plot", []);
    return;
  }
  const { R, r, kInv, sum, s, error } = signature;
  const lines = [
    `R = ${k}G = ${show(R)}. r = ${R[0]} mod ${N} = ${r}.`,
    `k⁻¹ = ${kInv}: ${k}·${kInv} = ${k * kInv} ≡ 1 (mod ${N}).`,
    `z + rd = ${z} + ${r}·${d} = ${sum}.`,
    `s = ${kInv}·${sum} mod ${N} = ${s}.`,
  ];
  const left = multiply(s, R);
  const right = add(multiply(z, G), multiply(r, Q));
  if (error) lines.push(`Rejected. ${error}`);
  else {
    lines.push(`Signature: (${r}, ${s}) · R parity ${R[1] % 2}`);
    lines.push(`sR = ${show(left)} and zG + rQ = ${show(right)}.`);
  }
  output("sign-result", lines, error ? "bad" : "good");
  plot("sign-plot", [highlight(R, colors.gold), highlight(error ? O : left, colors.cyan)]);
}

function renderNormalization(signature) {
  if (signature.error) {
    output("normalize-result", "Generate a valid signature in the signing lab first.", "note");
    plot("normalize-plot", []);
    return null;
  }
  const { r, s, R } = signature;
  const parity = R[1] % 2;
  const low = normalize(r, s, parity);
  const form = byId("s-form").value;
  const active = form === "low" ? low :
    form === "other" ? { r, s: N - s, parity: parity ^ 1 } : { r, s, parity };
  const effectiveR = active.parity === parity ? R : negate(R);
  output("normalize-result", [
    `Low-S boundary: floor(${N} / 2) = 9.`,
    `Original: (${r}, ${s}) · ${s > 9 ? "High-S" : "Low-S"} · parity ${parity}.`,
    `Canonical: (${r}, ${low.s}) · parity ${low.parity}.`,
    `Active: (${r}, ${active.s}) · R = ${show(effectiveR)} · parity ${active.parity}.`,
    active.parity === parity ? "The original R still applies." :
      `s changed to ${N} − ${s} = ${active.s}. Replace R with −R and flip the parity bit.`,
  ], "good");
  plot("normalize-plot", [
    highlight(negate(effectiveR), colors.violet, "other"), highlight(effectiveR, colors.gold),
  ]);
  return active;
}

function renderVerification({ d, z, active }) {
  const follow = byId("verify-follow").checked;
  const manual = ["verify-q", "verify-z", "verify-r", "verify-s"];
  for (const id of manual) byId(id).disabled = follow;
  if (follow) {
    const inputs = [validScalar(d) ? d : "", Number.isNaN(z) ? "" : z, active?.r ?? "", active?.s ?? ""];
    manual.forEach((id, index) => { byId(id).value = inputs[index]; });
  }
  if (follow && !active) {
    output("verify-result", "The signing lab has no valid signature to verify.", "note");
    plot("verify-plot", []);
    return;
  }
  const [key, digest, r, s] = manual.map(value);
  const result = verify(multiples[key] ?? O, digest, r, s);
  if (result.error) {
    output("verify-result", result.error, "bad");
    plot("verify-plot", []);
    return;
  }
  const { w, u1, u2, left, right, point, x, valid } = result;
  output("verify-result", [
    `w = ${w} since ${s}·${w} ≡ 1 (mod ${N}).`,
    `u₁ = ${digest}·${w} mod ${N} = ${u1}. u₂ = ${r}·${w} mod ${N} = ${u2}.`,
    `u₁G = ${show(left)}. u₂Q = ${show(right)}.`,
    ...describeAddition(left, right),
    `R′ = ${show(point)}.`,
    point === O ? "Invalid: the identity has no X coordinate." :
      `${valid ? "Valid" : "Invalid"}: ${point[0]} mod ${N} = ${x} ${valid ? "=" : "≠"} r = ${r}.`,
  ], valid ? "good" : "bad");
  plot("verify-plot", [
    highlight(left, colors.violet), highlight(right, colors.gold), highlight(point, colors.cyan),
  ]);
}

function renderRecovery({ z, Q, active }) {
  byId("recover-match").disabled = !active;
  if (!active) {
    output("recover-result", "Generate a valid signature in the signing lab first.", "note");
    plot("recover-plot", []);
    return;
  }
  const { r, s } = active;
  const parity = value("recover-parity");
  const branch = value("recover-branch");
  const result = recover(z, r, s, parity, branch);
  const lines = [`Selected X: ${r} + ${branch}·${N} = ${result.x}.`];
  if (result.x < P) {
    lines.push(`y² ≡ ${rhs(result.x)} (mod ${P}). Roots: ${roots(result.x).join(", ") || "none"}.`);
  }
  if (result.R) {
    const { R, rInv, sR, zG, difference } = result;
    lines.push(`R = ${show(R)}. sR = ${show(sR)}. zG = ${show(zG)}.`);
    lines.push(...describeAddition(sR, negate(zG)));
    lines.push(`r⁻¹ = ${rInv} since ${r}·${rInv} ≡ 1 (mod ${N}).`);
    lines.push(`Q = ${rInv}·${show(difference)} = ${show(result.Q)}.`);
  }
  const matches = !result.error && equal(result.Q, Q);
  lines.push(result.error || (matches ? "Verifies and matches the signing public point." :
    "Verifies under this candidate, which differs from the signing public point."));
  output("recover-result", lines, result.error ? "bad" : matches ? "good" : "note");
  plot("recover-plot", result.R ? [
    highlight(negate(result.R), colors.violet, "other"), highlight(result.R, colors.gold),
    highlight(result.Q, colors.cyan),
  ] : []);
}

function renderReuse({ d, z, k }) {
  const z2 = value("reuse-z");
  const low = byId("reuse-low").checked;
  const result = nonceReuse(d, k, z, z2, low);
  if (result.error) {
    output("reuse-result", result.error, "bad");
    return;
  }
  const { r, observed } = result;
  const lines = [
    `Observed pairs: (${r}, ${observed[0]}) and (${r}, ${observed[1]}).`,
    `z₁ − z₂ = ${z} − ${z2} ≡ ${mod(z - z2, N)} (mod ${N}).`,
  ];
  for (const row of result.rows) {
    const { sign1, sign2, s1, s2, difference, deltaInv, recoveredK, rInv, recoveredD, matches } = row;
    if (low) lines.push("", `Sign choices (${sign1 > 0 ? "+" : "−"}, ${sign2 > 0 ? "+" : "−"}) ⇒ s₁ = ${s1}, s₂ = ${s2}.`);
    if (difference === undefined) {
      lines.push("Equal S residues. This difference has no inverse.");
      continue;
    }
    lines.push(
      `s₁ − s₂ ≡ ${difference}. Difference inverse = ${deltaInv} (mod ${N}).`,
      `k ≡ (${z} − ${z2})·${deltaInv} ≡ ${recoveredK} (mod ${N}).`,
      `d ≡ ${rInv}·(${s1}·${recoveredK} − ${z}) ≡ ${recoveredD} (mod ${N}).`,
      matches ? `Match: ${recoveredD}G = ${show(multiples[d])} and the nonce point gives r = ${r}.` :
        "Reject this candidate: the reconstructed key or nonce point does not match.",
    );
  }
  output("reuse-result", lines, "good");
}

function renderCompression() {
  const x = value("compress-x");
  const parity = value("compress-parity");
  if (!Number.isInteger(x)) {
    output("compress-result", "Enter an integer X coordinate in 0–16.", "bad");
    plot("compress-plot", []);
    return;
  }
  const all = roots(x);
  const y = all.find(candidate => candidate % 2 === parity);
  const prefix = parity === 0 ? "02" : "03";
  const lines = [`At x = ${x}, y² ≡ ${rhs(x)} (mod ${P}).`,
    `Roots: ${all.length ? all.map(root => `${root} (${root % 2 ? "odd" : "even"})`).join(", ") : "none"}.`];
  if (y === undefined) {
    output("compress-result", [...lines, `No root matches prefix ${prefix}.`], "bad");
    plot("compress-plot", []);
    return;
  }
  const point = [x, y];
  output("compress-result", [...lines, `Prefix ${prefix} selects ${show(point)}.`], "good");
  const other = all.find(candidate => candidate !== y);
  plot("compress-plot", [
    highlight(other === undefined ? O : [x, other], colors.violet, "other"),
    highlight(point, colors.cyan),
  ]);
}

let current;
function selectMatchingBranch(active) {
  if (!active) return;
  byId("recover-branch").value = "0";
  byId("recover-parity").value = active.parity;
}

function renderShared() {
  const d = value("sign-d");
  const z = value("sign-z");
  const k = value("sign-k");
  const Q = validScalar(d) ? multiples[d] : O;
  const signature = sign(d, z, k);
  const active = renderNormalization(signature);
  // A changed signature starts with its actual recovery selector. A manual
  // selector stays in place when edits leave the active signature unchanged.
  if (active && (active.r !== current?.active?.r || active.s !== current?.active?.s ||
      active.parity !== current?.active?.parity || z !== current?.z || d !== current?.d)) {
    selectMatchingBranch(active);
  }
  current = { d, z, k, Q, signature, active };
  renderKey(d, Q);
  renderSignature(current);
  renderVerification(current);
  renderRecovery(current);
  renderReuse(current);
}

function filterGlossary() {
  const terms = byId("glossary-search").value.toLowerCase().trim().split(/\s+/);
  const entries = Array.from(byId("glossary").children);
  let count = 0;
  for (const entry of entries) {
    entry.hidden = !terms.every(term => entry.textContent.toLowerCase().includes(term));
    if (!entry.hidden) count++;
  }
  byId("glossary-count").textContent = `${count} of ${entries.length} terms`;
}

function setupReadingProgress() {
  const links = [...document.querySelectorAll(".outline nav a")];
  const sections = links.map(link => document.querySelector(link.getAttribute("href")));
  const bar = document.querySelector(".reading-progress");
  let frame;
  const update = () => {
    frame = undefined;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = `${height > 0 ? 100 * window.scrollY / height : 0}%`;
    let index = 0;
    for (let i = 1; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= 125) index = i;
    }
    links.forEach((link, i) => {
      if (i === index) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };
  window.addEventListener("scroll", () => { frame ??= requestAnimationFrame(update); }, { passive: true });
  window.addEventListener("resize", update);
  document.addEventListener("toggle", update, true);
  update();
}

finitePlot(byId("hero-curve"), [
  highlight(G, colors.violet, "G"), highlight(multiples[7], colors.cyan, "Q"),
  highlight(multiples[4], colors.gold, "R"),
], true);
realPlot(byId("real-plot"), [-1, 1]);
realPlot(byId("same-real-plot"), [2, 2]);
plot("finite-plot", []);
cyclePlot(byId("cycle-plot"));
populatePoints("add-first", 1, true);
populatePoints("add-second", 2, true);
populatePoints("verify-q", 7, false);
watch(["clock-mod", "clock-start", "clock-step"], renderClock);
watch(["geometry-kind", "geometry-step"], renderGeometry);
watch(["add-first", "add-second"], renderAddition);
watch(["key-d"], () => { byId("sign-d").value = byId("key-d").value; renderShared(); });
watch(["sign-d"], () => { byId("key-d").value = byId("sign-d").value; renderShared(); });
watch(["sign-z", "sign-k", "s-form"], renderShared);
watch(["verify-follow", "verify-q", "verify-z", "verify-r", "verify-s"], () => renderVerification(current));
watch(["recover-parity", "recover-branch"], () => renderRecovery(current));
watch(["reuse-z", "reuse-low"], () => renderReuse(current));
watch(["compress-x", "compress-parity"], renderCompression);
watch(["glossary-search"], filterGlossary);
byId("recover-match").addEventListener("click", () => {
  selectMatchingBranch(current.active);
  renderRecovery(current);
});
byId("reset-sign").addEventListener("click", () => {
  for (const id of ["key-d", "sign-d", "sign-z", "sign-k"]) byId(id).value = byId(id).defaultValue;
  byId("s-form").value = "original";
  current = undefined;
  renderShared();
});
renderClock();
renderGeometry();
renderAddition();
renderShared();
renderCompression();
filterGlossary();
setupReadingProgress();
