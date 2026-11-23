import { G, N, P, affine, mod, multiply, show } from "../ecdsa/toy-curve.mjs";

const lab = document.querySelector("#lab");
const byId = (id) => document.getElementById(id);
const steps = [...lab.querySelectorAll('input[name="step"]')];
const aliceScalar = byId("alice-scalar");
const bobScalar = byId("bob-scalar");
const next = byId("next-step");
const canvas = byId("curve");
const context = canvas.getContext("2d");
const colors = getComputedStyle(document.documentElement);

const nextLabels = ["Exchange public points", "Derive the secret", "Return to key creation"];

function drawCurve(markers) {
  if (!context) return;
  const padding = 45;
  const end = canvas.width - padding;
  const spacing = (end - padding) / (P - 1);
  const xPixel = (x) => padding + x * spacing;
  const yPixel = (y) => end - y * spacing;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#322a40";
  context.fillStyle = colors.getPropertyValue("--muted");
  context.font = "19px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  context.beginPath();
  for (let i = 0; i < P; i++) {
    context.moveTo(xPixel(i), padding);
    context.lineTo(xPixel(i), end);
    context.moveTo(padding, yPixel(i));
    context.lineTo(end, yPixel(i));
    if (i % 4 === 0) {
      context.fillText(i, xPixel(i), end + 24);
      context.fillText(i, padding - 23, yPixel(i));
    }
  }
  context.stroke();
  context.fillText("x", end + 22, end + 24);
  context.fillText("y", padding - 23, padding - 24);

  context.fillStyle = "#817791";
  for (const [x, y] of affine) {
    context.beginPath();
    context.arc(xPixel(x), yPixel(y), 4.5, 0, 2 * Math.PI);
    context.fill();
  }

  // Use concentric marks when multiple roles occupy the same point.
  const seen = new Map();
  for (const { point, role } of markers) {
    const [x, y] = point;
    const key = `${x},${y}`;
    const rings = seen.get(key) ?? 0;
    const color = colors.getPropertyValue(`--${role}`);
    context.beginPath();
    context.arc(xPixel(x), yPixel(y), 7 + rings * 5, 0, 2 * Math.PI);
    if (rings === 0) {
      context.fillStyle = color;
      context.fill();
    } else {
      context.strokeStyle = color;
      context.lineWidth = 2.5;
      context.stroke();
    }
    seen.set(key, rings + 1);
  }
  context.lineWidth = 1;
}

function render() {
  const stage = Number(steps.find((step) => step.checked).value);
  const a = aliceScalar.valueAsNumber;
  const b = bobScalar.valueAsNumber;
  const A = multiply(a, G);
  const B = multiply(b, G);
  const publicAlice = `A = ${show(A)}`;
  const publicBob = `B = ${show(B)}`;
  const deriving = stage === 3;

  byId("alice-value").textContent = a;
  byId("bob-value").textContent = b;
  byId("alice-public").textContent = `A = ${a}G = ${show(A)}`;
  byId("bob-public").textContent = `B = ${b}G = ${show(B)}`;
  byId("channel-pending").hidden = stage !== 1;
  byId("channel-points").hidden = stage === 1;
  byId("wire-alice").textContent = publicAlice;
  byId("wire-bob").textContent = publicBob;
  byId("alice-coordinate").textContent = publicAlice;
  byId("bob-coordinate").textContent = publicBob;
  byId("alice-calculation").hidden = !deriving;
  byId("bob-calculation").hidden = !deriving;
  byId("shared-legend").hidden = !deriving;
  next.textContent = nextLabels[stage - 1];

  const markers = [{ point: G, role: "generator" }, { point: A, role: "alice" }, { point: B, role: "bob" }];
  let status = stage === 1
    ? "Each person multiplies the public generator G by their own private scalar."
    : `The channel carries ${publicAlice} and ${publicBob}. Each person keeps their scalar private.`;

  if (deriving) {
    const alicePoint = multiply(a, B);
    const bobPoint = multiply(b, A);
    byId("alice-shared").textContent = `${a}B = ${show(alicePoint)}`;
    byId("bob-shared").textContent = `${b}A = ${show(bobPoint)}`;
    byId("shared-coordinate").textContent = `Shared ${show(alicePoint)}`;
    markers.push({ point: alicePoint, role: "shared" });

    const product = a * b;
    const reduced = mod(product, N);
    const count = product === reduced ? `${product}G` : `${product}G = ${reduced}G`;
    status = `Both compute ${show(alicePoint)} locally. Counting copies of G gives ${a} × ${b} = ${product}, so the point is ${count}.`;
  }

  byId("lab-status").textContent = status;
  drawCurve(markers);
}

lab.querySelector(".steps").addEventListener("change", render);
aliceScalar.addEventListener("input", render);
bobScalar.addEventListener("input", render);
next.addEventListener("click", () => {
  const current = steps.findIndex((step) => step.checked);
  steps[(current + 1) % steps.length].checked = true;
  render();
});
byId("reset").addEventListener("click", () => {
  aliceScalar.value = aliceScalar.defaultValue;
  bobScalar.value = bobScalar.defaultValue;
  steps[0].checked = true;
  render();
});

render();
lab.hidden = false;

const distributionOptions = byId("distribution-options");
const distributionRows = [...byId("distribution").querySelectorAll("tbody tr")];

function renderDistribution(value) {
  const uniform = value === "uniform";
  const probabilities = uniform ? [25, 25, 25, 25] : [50, 25, 12.5, 12.5];
  let cumulative = 0;

  distributionRows.forEach((row, index) => {
    const probability = probabilities[index];
    cumulative += probability;
    row.querySelector("meter").value = probability / 100;
    row.querySelector(".probability span").textContent = `${probability}%`;
    row.cells[2].textContent = `${cumulative}%`;
  });

  byId("distribution-result").textContent = uniform
    ? "Uniform draw: four possible values, 2 bits of Shannon entropy, and 2 bits of min-entropy."
    : "Biased draw: four possible values, 1.75 bits of Shannon entropy, and 1 bit of min-entropy.";
}

distributionOptions.addEventListener("change", (event) => renderDistribution(event.target.value));
renderDistribution(distributionOptions.querySelector(":checked").value);
distributionOptions.hidden = false;

const mappingOptions = byId("mapping-options");
const keyspace = byId("keyspace-grid");
const mappingRows = [...byId("mapping").querySelectorAll("tbody tr")];
const cells = Array.from({ length: 256 }, () => document.createElement("span"));
keyspace.append(...cells);

function renderKeyspace(value) {
  const mixed = value === "mixed";
  const column = mixed ? 2 : 1;
  const reachable = new Set(mappingRows.map((row) => parseInt(row.cells[column].textContent, 16)));
  cells.forEach((cell, index) => cell.classList.toggle("reachable", reachable.has(index)));
  const label = mixed ? "Toy KDF mapping" : "Direct mapping";
  byId("mapping-result").textContent = `${label}: ${reachable.size} of 256 keys are reachable.`;
}

mappingOptions.addEventListener("change", (event) => renderKeyspace(event.target.value));
renderKeyspace(mappingOptions.querySelector(":checked").value);
mappingOptions.hidden = false;
keyspace.hidden = false;
