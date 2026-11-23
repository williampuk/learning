import {
  add, addition, challengeDigest, decodeToyPoint, ed25519, encodePoint, equals, fromHex, fromLE,
  hex, identity, inverse, mod, multiply, torsionPoint, toy, toyMultiples, toyPoints, toySignature,
  traceVector, vector, verifyEquation,
} from "./arithmetic.mjs";

const byId = id => document.getElementById(id);
const write = (id, text) => { byId(id).textContent = text; };
const pointText = ([x, y]) => `(${x}, ${y})`;
const ticks = [0n, 13n, 26n, 39n, 52n];
const colors = { mint: "#8eead6", blue: "#a4caff", amber: "#f4c38b", muted: "#849da7" };

function result(id, title, text, valid) {
  const output = byId(id);
  const heading = document.createElement("strong");
  const calculation = document.createElement("p");
  heading.textContent = title;
  calculation.textContent = text;
  output.replaceChildren(heading, calculation);
  output.dataset.state = valid ? "ok" : "error";
}

function listen(id, event, handler) {
  const control = byId(id);
  control.disabled = false;
  control.addEventListener(event, handler);
}

function intInput(id) {
  const input = byId(id);
  const valid = input.value !== "" && input.validity.valid;
  input.setAttribute("aria-invalid", String(!valid));
  return valid ? BigInt(input.valueAsNumber) : null;
}

function drawCurve(canvas, highlights, fallbackWidth, fallbackHeight) {
  const bounds = canvas.getBoundingClientRect();
  // A background tab can start loading before its pane has a usable width.
  const width = bounds.width >= 120 ? bounds.width : fallbackWidth;
  const height = bounds.width >= 120 ? bounds.height : fallbackHeight;
  const density = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(density, density);
  const left = 34;
  const top = 22;
  const right = width - 26;
  const bottom = height - 29;
  const plotX = value => left + Number(value) * (right - left) / 52;
  const plotY = value => bottom - Number(value) * (bottom - top) / 52;
  const font = '11px ui-monospace, monospace';
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";

  function line(x1, y1, x2, y2, color) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.strokeStyle = color;
    context.stroke();
  }

  function dot(point, radius, color, ring = false) {
    const [x, y] = point;
    context.beginPath();
    context.arc(plotX(x), plotY(y), radius, 0, Math.PI * 2);
    if (ring) {
      context.strokeStyle = color;
      context.lineWidth = 1.7;
      context.stroke();
      context.lineWidth = 1;
    } else {
      context.fillStyle = color;
      context.fill();
    }
  }

  for (const coordinate of ticks) {
    const x = plotX(coordinate);
    const y = plotY(coordinate);
    line(x, top, x, bottom, "#294047");
    line(left, y, right, y, "#294047");
    context.fillStyle = colors.muted;
    context.fillText(coordinate.toString(), x, bottom + 15);
    context.fillText(coordinate.toString(), left - 14, y);
  }
  context.fillText("x", right + 12, bottom + 15);
  context.fillText("y", left - 14, top - 12);
  for (const point of toyPoints) dot(point, 2.4, "#68828a");
  for (const point of toyMultiples.slice(0, -1)) dot(point, 3.4, "#84b8b6");

  highlights.forEach(({ point, label, color }, i) => {
    const coincident = highlights.slice(i + 1).filter(item => equals(item.point, point)).length;
    dot(point, 6 + 3 * coincident, color, coincident > 0);
    if (coincident) return;
    const [x, y] = point;
    context.fillStyle = color;
    context.textAlign = Number(x) > 44 ? "right" : "left";
    context.font = "bold " + font;
    context.fillText(label, plotX(x) + (Number(x) > 44 ? -10 : 10), plotY(y) - 9);
  });
}

const heroHighlights = [
  { point: toyMultiples[1], label: "B", color: colors.mint },
  { point: toyMultiples[5], label: "A", color: colors.mint },
  { point: toyMultiples[3], label: "R", color: colors.mint },
];
const heroPlot = byId("hero-plot");
const pointPlot = byId("point-plot");
let additionHighlights;

for (const id of ["point-left", "point-right"]) {
  const select = byId(id);
  const points = toyMultiples.slice(0, -1).map((point, index) =>
    new Option(`[${index}]B = ${pointText(point)}${index === 0 ? " · identity" : ""}`, String(index)));
  points.push(new Option("T = (1, 23) · order 8", "torsion"));
  select.replaceChildren(...points);
  select.value = "1";
  listen(id, "change", updateAddition);
}

function updateAddition() {
  const selectPoint = id => {
    const value = byId(id).value;
    return value === "torsion" ? torsionPoint : toyMultiples[Number(value)];
  };
  const left = selectPoint("point-left");
  const right = selectPoint("point-right");
  const { t, numerators, denominators, inverses, sum } = addition(left, right, toy);
  const [x1, y1] = left;
  const [x2, y2] = right;
  const [nx, ny] = numerators;
  const [dx, dy] = denominators;
  const [ix, iy] = inverses;
  const rows = [
    `t = 3·${x1}·${x2}·${y1}·${y2} mod 53 = ${t}.`,
    `Denominators: ${dx} and ${dy}. Inverses: ${ix} and ${iy}.`,
    `x₃ = (${x1}·${y2} + ${x2}·${y1})·${ix} mod 53 = ${nx}·${ix} mod 53 = ${sum[0]}.`,
    `y₃ = (${y1}·${y2} + ${x1}·${x2})·${iy} mod 53 = ${ny}·${iy} mod 53 = ${sum[1]}.`,
  ];
  result("point-trace", `${pointText(left)} + ${pointText(right)} = ${pointText(sum)}`, rows.join("\n"), true);
  additionHighlights = [
    { point: left, label: "P", color: colors.blue },
    { point: right, label: equals(left, right) ? "P = Q" : "Q", color: colors.amber },
    { point: sum, label: "sum", color: colors.mint },
  ];
  pointPlot.setAttribute("aria-label", `P is ${pointText(left)}, Q is ${pointText(right)}, sum is ${pointText(sum)}.`);
  drawCurve(pointPlot, additionHighlights, 370, 310);
}

const resize = new ResizeObserver(entries => {
  for (const { target } of entries) {
    if (target === heroPlot) drawCurve(heroPlot, heroHighlights, 510, 390);
    else drawCurve(pointPlot, additionHighlights, 370, 310);
  }
});
resize.observe(heroPlot);
resize.observe(pointPlot);
drawCurve(heroPlot, heroHighlights, 510, 390);
updateAddition();

listen("multiple", "input", () => {
  const count = Number(byId("multiple").value);
  const residue = count % Number(toy.order);
  const cycle = byId("cycle");
  cycle.querySelector("[aria-current]")?.removeAttribute("aria-current");
  cycle.children[residue].setAttribute("aria-current", "true");
  write("cycle-result", `[${count}]B = [${residue}]B = ${pointText(toyMultiples[residue])}. ${Math.floor(count / 7)} complete cycle(s).`);
});

let signed = null;
for (const id of ["sign-a", "sign-r", "sign-c"]) listen(id, "input", updateSigning);
for (const id of ["verify-c", "verify-s"]) listen(id, "input", updateVerification);
listen("tamper", "click", () => {
  if (!signed) return;
  byId("verify-s").value = signed.S;
  byId("verify-c").value = mod(signed.c + 2n, toy.order);
  updateVerification();
});
listen("verify-reset", "click", updateSigning);

function updateSigning() {
  const a = intInput("sign-a");
  const r = intInput("sign-r");
  const c = intInput("sign-c");
  if ([a, r, c].includes(null)) {
    signed = null;
    for (const id of ["sign-key", "sign-point", "sign-scalar"]) write(id, "—");
    result("sign-trace", "Check the inputs", "Enter an integer a from 1 through 6 and integers r and c from 0 through 6.", false);
  } else {
    signed = { ...toySignature(a, r, c), c };
    const { A, R, S } = signed;
    write("sign-key", pointText(A));
    write("sign-point", pointText(R));
    write("sign-scalar", S);
    const edge = r === 0n ? " The nonce point is the identity." : "";
    result("sign-trace", `(R, S) = (${pointText(R)}, ${S})`,
      `(${r} + ${c}·${a}) mod 7 = ${r + c * a} mod 7 = ${S}.${edge}`, true);
    byId("verify-c").value = c;
    byId("verify-s").value = S;
  }
  byId("tamper").disabled = !signed;
  byId("verify-reset").disabled = !signed;
  updateVerification();
}

function updateVerification() {
  const paths = byId("verify-paths");
  paths.hidden = true;
  if (!signed) {
    result("verify-result", "Waiting for a signature", "Enter valid signing inputs to supply A and R.", false);
    return;
  }
  const c = intInput("verify-c");
  const S = intInput("verify-s");
  if (c === null || S === null) {
    result("verify-result", "Invalid input", "Enter integers from 0 through 6. A verifier rejects an out-of-range response.", false);
    return;
  }
  const { left, scaledKey, right, valid } = verifyEquation(S, signed.R, c, signed.A, toy);
  write("verify-left-formula", `[${S}]B`);
  write("verify-right-formula", `R + [${c}]A`);
  write("verify-left", pointText(left));
  write("verify-right", pointText(right));
  write("verify-match", valid ? "=" : "≠");
  byId("verify-match").dataset.state = valid ? "ok" : "error";
  paths.hidden = false;
  result("verify-result", valid ? "Valid · points match" : "Invalid · points differ",
    `[${S}]B = ${pointText(left)}. The scaled key [${c}]A is ${pointText(scaledKey)}, so the right side is ${pointText(right)}.`, valid);
}
updateSigning();

function updateDecoding() {
  const y = intInput("decode-y");
  if (y === null) {
    result("decode-result", "Y is outside the field", "Enter an integer from 0 through 52.", false);
    return;
  }
  const parity = BigInt(byId("decode-parity").value);
  const square = mod((y * y - 1n) * inverse(1n + toy.d * y * y, toy.p), toy.p);
  const roots = toyPoints.filter(point => point[1] === y).map(point => point[0]);
  const point = decodeToyPoint(y, parity);
  let explanation = `x² = ${square} mod 53.`;
  if (roots.length === 0) explanation += " No square root exists at this Y.";
  else if (!point) explanation += " The only root is zero, which is even.";
  else explanation += ` Root${roots.length > 1 ? "s" : ""}: ${roots.join(", ")}. The selected parity gives x = ${point[0]}.`;
  result("decode-result", point ? pointText(point) : "Invalid point encoding", explanation, Boolean(point));
}

listen("decode-y", "input", updateDecoding);
listen("decode-parity", "change", updateDecoding);
updateDecoding();

function updateCofactor() {
  const choice = byId("cofactor-offset").value;
  const offset = { none: identity, torsion: torsionPoint, prime: toy.base }[choice];
  const left = toyMultiples[6];
  const right = add(left, offset, toy);
  const scaledLeft = multiply(8n, left, toy);
  const scaledRight = multiply(8n, right, toy);
  const scaledOffset = multiply(8n, offset, toy);
  const [raw, scaled] = byId("cofactor-result").children;

  for (const [card, first, second, difference] of [
    [raw, left, right, offset], [scaled, scaledLeft, scaledRight, scaledOffset],
  ]) {
    const matches = equals(first, second);
    card.dataset.state = matches ? "ok" : "error";
    card.querySelector("p").textContent =
      `${pointText(first)} and ${pointText(second)} ${matches ? "match" : "differ"}. Offset: ${pointText(difference)}.`;
  }
}
listen("cofactor-offset", "change", updateCofactor);
updateCofactor();

function updateReuse() {
  const c2 = intInput("reuse-c");
  if (c2 === null) {
    result("reuse-result", "Invalid challenge", "Enter an integer from 0 through 6.", false);
    return;
  }
  const a = 5n;
  const r = 3n;
  const c1 = 2n;
  const s1 = toySignature(a, r, c1).S;
  const s2 = toySignature(a, r, c2).S;
  const challengeDifference = mod(c1 - c2, toy.order);
  if (challengeDifference === 0n) {
    result("reuse-result", "The equations are identical", "Both responses are 6. Subtracting gives 0 ≡ 0, so there is no inverse or new information.", false);
    return;
  }
  const responseDifference = mod(s1 - s2, toy.order);
  const reciprocal = inverse(challengeDifference, toy.order);
  const recovered = mod(responseDifference * reciprocal, toy.order);
  result("reuse-result", `Recovered a = ${recovered}`,
    `S₂ = (3 + ${c2}·5) mod 7 = ${s2}.
ΔS = (${s1} − ${s2}) mod 7 = ${responseDifference}. Δc = (2 − ${c2}) mod 7 = ${challengeDifference}.
The inverse of Δc is ${reciprocal}, so a = ${responseDifference}·${reciprocal} mod 7 = ${recovered}.`, true);
}
listen("reuse-c", "input", updateReuse);
updateReuse();

listen("glossary-search", "input", event => {
  const query = event.target.value.trim().toLowerCase();
  let visible = 0;
  for (const entry of byId("glossary").children) {
    entry.hidden = !entry.textContent.toLowerCase().includes(query);
    if (!entry.hidden) visible++;
  }
  byId("glossary-empty").hidden = visible > 0;
});

const realForm = byId("real-form");
const realMessage = byId("real-message");
const realButton = byId("run-real");
const resetButton = byId("reset-real");
const tamperButton = byId("tamper-real");
const realOutput = byId("real-output");
let realTrace;
let message;
let alterMessage = false;

function setRealBusy(busy) {
  realMessage.disabled = busy;
  realButton.disabled = busy;
  resetButton.disabled = busy;
  tamperButton.disabled = busy || !realTrace;
  realForm.setAttribute("aria-busy", String(busy));
}

async function platformCheck(trace, received) {
  try {
    const key = await crypto.subtle.importKey("raw", trace.encodedA, "Ed25519", false, ["verify"]);
    const valid = await crypto.subtle.verify("Ed25519", key, trace.signature, received);
    return `Browser’s Ed25519 verifier: ${valid ? "valid" : "invalid"}.`;
  } catch {
    return "This browser cannot run the separate Ed25519 verification API.";
  }
}

async function verifyReal() {
  const received = alterMessage ? Uint8Array.from([...message, 0]) : message;
  const digest = await challengeDigest(realTrace.encodedR, realTrace.encodedA, received);
  const c = mod(fromLE(digest), ed25519.order);
  const { valid, left, right } = verifyEquation(fromLE(realTrace.encodedS), realTrace.R, c, realTrace.A, ed25519);
  const matchesVector = !message.length && hex(realTrace.encodedA) === vector.publicKey &&
    hex(realTrace.signature) === vector.signature;
  write("real-message-check", alterMessage
    ? `Verifying ${received.length} byte(s) after appending 00. The signature still covers the original ${message.length} byte(s).`
    : `Verifying the original ${message.length} message byte(s).`);
  write("real-check-c", c);
  write("real-check-left", hex(encodePoint(left)));
  write("real-check-right", hex(encodePoint(right)));
  write("real-platform", await platformCheck(realTrace, received));
  tamperButton.setAttribute("aria-pressed", String(alterMessage));
  tamperButton.textContent = alterMessage ? "Verify original message" : "Append 00 for verification";
  const vectorMessage = !message.length
    ? (matchesVector ? " Public key and signature match RFC 8032 Test 1." : " The generated bytes differ from Test 1.")
    : "";
  result("real-status", valid ? "Valid · points match" : "Invalid · points differ",
    `The two public verification paths ${valid ? "reach the same point" : "reach different points"}.${vectorMessage}`, valid && (!!message.length || matchesVector));
  byId("real-verify").hidden = false;
}

async function runReal() {
  const input = realMessage.value.replace(/\s/g, "");
  realTrace = null;
  alterMessage = false;
  tamperButton.setAttribute("aria-pressed", "false");
  tamperButton.textContent = "Append 00 for verification";
  realOutput.hidden = true;
  const validHex = /^(?:[\da-fA-F]{2})*$/.test(input);
  realMessage.setAttribute("aria-invalid", String(!validHex));
  if (!validHex) {
    setRealBusy(false);
    result("real-status", "Invalid hexadecimal", "Use two hex digits per message byte. Spaces are allowed.", false);
    return;
  }
  setRealBusy(true);
  write("real-status", "Deriving the key, signature, and verification points…");
  delete byId("real-status").dataset.state;
  try {
    message = fromHex(input);
    realTrace = await traceVector(message);
    for (const [id, bytes] of [
      ["real-key", realTrace.encodedA], ["real-R", realTrace.encodedR], ["real-S", realTrace.encodedS],
      ["expanded", realTrace.expanded], ["pruned", realTrace.pruned], ["prefix", realTrace.prefix],
      ["nonce-digest", realTrace.nonceDigest], ["challenge", realTrace.challenge],
    ]) write(id, hex(bytes));
    write("real-r", realTrace.r);
    write("real-c", realTrace.c);
    write("response", realTrace.S);
    await verifyReal();
    byId("real-steps").hidden = false;
    realOutput.hidden = false;
  } catch {
    realTrace = null;
    result("real-status", "Could not calculate the trace", "The byte trace needs Web Crypto SHA-512 on HTTPS or localhost.", false);
  } finally {
    setRealBusy(false);
  }
}

if (globalThis.crypto?.subtle) {
  realForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!realButton.disabled) void runReal();
  });
  listen("reset-real", "click", () => {
    realMessage.value = "";
    void runReal();
  });
  listen("real-message", "input", () => {
    realMessage.removeAttribute("aria-invalid");
    realTrace = null;
    tamperButton.disabled = true;
    realOutput.hidden = true;
    delete byId("real-status").dataset.state;
    write("real-status", "Select Derive and verify to sign the new message bytes.");
  });
  listen("tamper-real", "click", async () => {
    if (!realTrace) return;
    setRealBusy(true);
    try {
      alterMessage = !alterMessage;
      await verifyReal();
    } catch {
      result("real-status", "Could not verify the trace", "Try deriving the signature again.", false);
    } finally {
      setRealBusy(false);
    }
  });
  void runReal();
}
