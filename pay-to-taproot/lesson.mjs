import {
  commitTree, generatorX, hex, mainnetAddress, makeControlBlock, outputKey, proofFor,
  readHex, verifyCommitment,
} from "./taproot.mjs";
import { chainExamples, walletVectors } from "./examples.mjs";

const get = id => document.getElementById(id);
const labels = "ABCDEFGH";
const recoveryKey = "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const reference = walletVectors[5];
const leaf = (id, script, version = 0xc0) => ({ id, script, version });
const presets = {
  toy: {
    key: generatorX,
    tree: [leaf(0, "51"), [leaf(1, "52"), leaf(2, "00")]],
    note: "A is OP_1, B is OP_2, and C is OP_0. A and B push a true value. C pushes false and still has a commitment. P is G, a public demonstration key. Do not fund the resulting addresses.",
  },
  single: {
    key: generatorX,
    tree: leaf(0, "51"),
    note: "A is OP_1, hex 51. There is only one leaf, so its hash is the root and the proof has zero sibling hashes.",
  },
  empty: {
    key: generatorX,
    tree: null,
    note: "The internal key is the x coordinate of G. An empty tree omits the root entirely from TapTweak’s input. The lab still tweaks P to produce Q.",
  },
  recovery: {
    key: generatorX,
    tree: leaf(0, "029000b27520" + recoveryKey + "ac"),
    note: "Example wallet policy with illustrative public keys G and 2·G. The normal signer spends via the key path. The fallback script pushes 144 (029000), runs OP_CHECKSEQUENCEVERIFY (b2) and OP_DROP (75), then pushes the recovery key (20 + 32 bytes) for OP_CHECKSIG (ac). The recovery spend requires its signer and a 144-block relative delay.",
  },
  vector: {
    key: reference.given.internalPubkey,
    tree: fromVector(reference.given.scriptTree),
    note: "BIP 341’s sixth output vector supplies P and three leaves. Each leaf pushes a different x-only key, then uses OP_CHECKSIG. Compare the calculated address and control blocks with the published vector.",
  },
};
let built = null;
let presetRequest = 0;
let vaultPreset;
let selected = 0;
let buildRequest = 0;
let proofRequest = 0;
let proofContext = null;

function fromVector(tree) {
  if (tree === null) return null;
  if (Array.isArray(tree)) return tree.map(fromVector);
  return leaf(tree.id, tree.script, tree.leafVersion);
}

function mapLeaves(tree, transform) {
  if (tree === null) return null;
  return Array.isArray(tree) ? tree.map(child => mapLeaves(child, transform)) : transform(tree);
}

function collectLeaves(tree) {
  const leaves = [];
  mapLeaves(tree, item => leaves.push(item));
  return leaves;
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function field(label, id, value, maxLength) {
  const wrapper = element("div");
  const caption = element("label", "", label);
  caption.htmlFor = id;
  const input = element("input", "hex");
  input.id = id;
  input.value = value;
  input.maxLength = maxLength;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  wrapper.append(caption, input);
  return wrapper;
}

function status(id, message, state = "") {
  get(id).textContent = message;
  get(id).dataset.state = state;
}

function readouts(items) {
  return items.map(([label, value]) => {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    return row;
  });
}

function appendLeaf(item) {
  const group = element("fieldset", "leaf-fields");
  group.dataset.leafField = item.id;
  const inputs = element("div", "leaf-inputs");
  inputs.append(
    field("Script hex", "script-" + item.id, item.script, 200000),
    field("Version", "version-" + item.id, item.version.toString(16).padStart(2, "0"), 2),
  );
  const remove = element("button", "quiet", "Remove leaf " + labels[item.id]);
  remove.type = "button";
  remove.addEventListener("click", () => {
    group.remove();
    updateGrouping();
    recalculate();
    get("add-leaf").focus();
  });
  group.append(element("legend", "", "Leaf " + labels[item.id]), inputs, remove);
  get("leaf-fields").append(group);
}

function leafIds() {
  return Array.from(get("leaf-fields").children, field => Number(field.dataset.leafField));
}

function updateGrouping() {
  const ids = leafIds();
  const select = get("grouping");
  const previous = Number(select.value);
  get("grouping-field").hidden = ids.length < 3;
  select.replaceChildren(...ids.map(id => {
    const option = element("option", "", "Leaf " + labels[id] + " at depth 1");
    option.value = id;
    return option;
  }));
  select.value = ids.includes(previous) ? previous : ids[0];
  get("add-leaf").disabled = ids.length >= labels.length;
  if (!ids.includes(selected)) selected = ids[0];
}

async function loadPreset() {
  const request = ++presetRequest;
  let preset = presets[get("preset").value];
  if (!preset) {
    buildRequest++;
    clearBuild();
    status("build-status", "Loading the vault example…");
    try {
      vaultPreset ??= await fetch("./vault-data.json").then(response => {
        if (!response.ok) throw new Error("Could not load the vault example.");
        return response.json();
      }).then(({ vault }) => ({
        key: vault.internalKey,
        tree: vault.scripts.map((script, i) => leaf(i, script)),
        note: "Alice and Bob jointly control P. A is Alice’s 144-block recovery, B is the delayed trustee quorum, and C is the arbiter’s height-locked leaf. These are public demonstration keys.",
      }));
      preset = vaultPreset;
    } catch (error) {
      if (request === presetRequest) status("build-status", error.message, "bad");
      return;
    }
  }
  if (request !== presetRequest) return;
  get("preset-note").textContent = preset.note;
  get("internal-key").value = preset.key;
  get("leaf-fields").replaceChildren();
  collectLeaves(preset.tree).forEach(appendLeaf);
  get("grouping").replaceChildren();
  selected = 0;
  updateGrouping();
  recalculate();
}

function balanced(leaves) {
  if (leaves.length <= 1) return leaves[0] ?? null;
  const mid = Math.floor(leaves.length / 2);
  return [balanced(leaves.slice(0, mid)), balanced(leaves.slice(mid))];
}

function clearBuild() {
  built = null;
  get("tree").replaceChildren();
  get("tree-values").replaceChildren();
  get("branch-details").hidden = true;
  get("tree-hint").textContent = "Recalculate to show the current commitment.";
  get("send-proof").disabled = true;
}

async function recalculate() {
  const request = ++buildRequest;
  clearBuild();
  status("build-status", "Calculating commitment…");
  try {
    const internalKey = readHex(get("internal-key").value, "Internal key", 32);
    const leaves = leafIds().map(id => {
      const name = "Leaf " + labels[id];
      const [version] = readHex(get("version-" + id).value, name + " version", 1);
      if ((version & 1) || version === 0x50) {
        throw new Error(name + " needs an even version other than 50.");
      }
      return { id, version, script: readHex(get("script-" + id).value, name + " script") };
    });
    const shallow = Number(get("grouping").value);
    const inputs = leaves.length < 3 ? balanced(leaves)
      : [leaves.find(item => item.id === shallow), balanced(leaves.filter(item => item.id !== shallow))];
    const tree = await commitTree(inputs);
    const output = await outputKey(internalKey, tree?.hash ?? null);
    if (request !== buildRequest) return;
    built = { tree, internalKey, output };
    renderTree();
    status("build-status", "Commitment calculated.", "good");
  } catch (error) {
    if (request === buildRequest) status("build-status", error.message, "bad");
  }
}

function nodeView(node, proof, root = false) {
  const item = element("div", "node");
  const name = node.children ? (root ? "Merkle root" : "Branch") : "Leaf " + labels[node.id];
  const caption = element(node.children ? "div" : "button", "node-label");
  const sibling = proof.siblings.includes(node);
  const onPath = root || node === proof.leaf || (!sibling && proofFor(node, proof.leaf.id) !== null);
  if (onPath) caption.classList.add("path");
  if (sibling) caption.classList.add("sibling");
  caption.append(element("strong", "", name), element("code", "", hex(node.hash).slice(0, 8) + "…"));
  caption.setAttribute("title", hex(node.hash));
  if (!node.children) {
    caption.type = "button";
    caption.dataset.leaf = node.id;
    caption.setAttribute("aria-pressed", String(node === proof.leaf));
    caption.setAttribute("aria-label", name + (sibling ? ", included as a sibling hash" : ""));
  }
  item.append(caption);
  if (node.children) {
    const children = element("div", "children");
    children.append(...node.children.map(child => nodeView(child, proof)));
    item.append(children);
  }
  return item;
}

function renderTree() {
  const { tree, output } = built;
  const proof = tree && proofFor(tree, selected);
  const values = [];
  if (proof) {
    const depth = proof.siblings.length;
    get("tree-hint").textContent = "Leaf " + labels[selected] + " is at depth " + depth +
      ". Its control block is " + (33 + 32 * depth) + " bytes.";
    get("tree").replaceChildren(nodeView(tree, proof, true));
    values.push(
      ["Selected TapLeaf preimage", hex(proof.leaf.preimage)],
      ["Selected TapLeaf hash", hex(proof.leaf.hash)],
      ["Sibling hashes, nearest first", proof.siblings.map(node => hex(node.hash)).join("\n") || "None"],
    );
  } else {
    get("tree-hint").textContent = "The tweaked key provides the only spending path.";
    get("tree").replaceChildren(element("p", "hint", "No script leaves"));
  }
  values.push(
    ["Merkle root · m", tree ? hex(tree.hash) : "Empty byte string"],
    ["TapTweak preimage · x(P) ‖ m", hex(output.preimage)],
    ["Tweak · t (hex)", hex(output.tweak)],
    ["Output key · x(Q)", hex(output.key)],
    ["Output parity · y(Q) mod 2", String(output.parity)],
    ["scriptPubKey", "5120" + hex(output.key)],
    ["Mainnet Bech32m address", mainnetAddress(output.key)],
  );
  get("tree-values").replaceChildren(...readouts(values));
  const branches = [];
  const recordBranch = (node) => {
    if (!node.children) return;
    const [left, right] = node.children;
    const inputs = [hex(left.hash), hex(right.hash)].sort();
    branches.push(["TapBranch · sorted child hashes", inputs.join("\n")],
      ["Parent hash", hex(node.hash)]);
    node.children.forEach(recordBranch);
  };
  if (tree) recordBranch(tree);
  get("branch-bytes").replaceChildren(...readouts(branches));
  get("branch-details").hidden = branches.length === 0;
  get("send-proof").disabled = !proof;
}

function blankProof() {
  proofRequest++;
  get("proof-results").replaceChildren();
}

function showProof({ key, script, control, context }) {
  get("expected-key").value = key;
  get("revealed-script").value = script;
  get("control-block").value = control;
  get("proof-source").textContent = context.label;
  proofContext = context;
  verify();
  location.hash = "verifier";
  get("verify-title").focus({ preventScroll: true });
}

async function verify() {
  blankProof();
  const request = proofRequest;
  status("proof-status", "Reconstructing the commitment…");
  try {
    const key = readHex(get("expected-key").value, "Expected output key", 32);
    const script = readHex(get("revealed-script").value, "Revealed script");
    const control = readHex(get("control-block").value, "Control block");
    if (control[0] === 0x50) throw new Error("A final witness item starting with 50 is treated as an annex.");
    const result = await verifyCommitment(key, script, control);
    if (request !== proofRequest) return;
    renderVerification(result, control);
  } catch (error) {
    if (request === proofRequest) status("proof-status", error.message, "bad");
  }
}

function renderVerification(result, control) {
  const { leaf: item, version, parity, internalKey, root, steps, output, keyMatches, parityMatches } = result;
  const matches = keyMatches && parityMatches;
  const keyStatus = "x(Q) " + (keyMatches ? "matches" : "differs");
  const parityStatus = "parity " + (parityMatches ? "matches" : "differs");
  status("proof-status", (matches ? "Commitment verified" : "Commitment failed") + " · " + keyStatus + ", " + parityStatus + ".", matches ? "good" : "bad");
  const trace = element("ol", "trace");
  const leafStep = element("li", "", "TapLeaf · hash the version, length and script");
  leafStep.append(element("code", "", hex(item.hash)));
  trace.append(leafStep);
  let previous = hex(item.hash);
  steps.forEach(({ sibling, hash }, index) => {
    const step = element("li", "", "TapBranch · combine with sibling " + (index + 1));
    const other = hex(sibling);
    const sorted = previous <= other ? [previous, other] : [other, previous];
    step.append(element("code", "", "Sibling: " + other),
      element("code", "", "Hash input: " + sorted.join(" | ")),
      element("code", "", "Result: " + hex(hash)));
    previous = hex(hash);
    trace.append(step);
  });

  const values = element("dl", "readouts");
  const rows = [
    ["Control header · version | parity", hex(control.slice(0, 1)) + " → " + version.toString(16).padStart(2, "0") + " | " + parity],
    ["Internal key · x(P)", hex(internalKey)],
    ["TapLeaf preimage", hex(item.preimage)],
    ["Reconstructed root · m", hex(root)],
    ["Reconstructed tweak · t (hex)", hex(output.tweak)],
    ["Calculated x(Q)", hex(output.key)],
    ["Calculated parity", String(output.parity)],
    ["Calculated mainnet address", mainnetAddress(output.key)],
  ];
  if (proofContext?.fixture) {
    rows.push(
      ["Mainnet previous outpoint · txid:vout", proofContext.fixture.outpoint],
      ["Mainnet previous scriptPubKey", proofContext.fixture.scriptPubKey],
      ["Mainnet previous address", proofContext.fixture.address],
    );
  }
  values.append(...readouts(rows));
  const results = get("proof-results");
  if (proofContext?.fixture) {
    const { witness } = proofContext.fixture;
    const raw = element("details", "math-note");
    const stack = element("dl", "readouts");
    stack.append(...readouts(witness.map((bytes, index) => {
      const role = index === witness.length - 1 ? "Control block" : index === witness.length - 2 ? "Script" : "Stack argument";
      return [role + " · witness item " + index + " · " + bytes.length / 2 + " bytes", bytes];
    })));
    raw.append(element("summary", "", "Original mainnet witness"), stack);
    results.append(trace, values, raw);
  } else {
    results.append(trace, values);
  }
}

const toBytes = item => ({
  ...item, script: readHex(item.script, "Vector script"),
});

async function checkVector(vector) {
  const fail = label => { throw new Error(label + " differs from the published vector."); };
  const internalKey = readHex(vector.given.internalPubkey, "Internal key", 32);
  const tree = await commitTree(mapLeaves(fromVector(vector.given.scriptTree), toBytes));
  const root = tree?.hash ?? null;
  const output = await outputKey(internalKey, root);
  const { expected, intermediary } = vector;
  if ((root === null ? null : hex(root)) !== intermediary.merkleRoot) fail("Merkle root");
  if (hex(output.tweak) !== intermediary.tweak) fail("Tweak");
  if (hex(output.key) !== intermediary.tweakedPubkey) fail("Tweaked key");
  if ("5120" + hex(output.key) !== expected.scriptPubKey) fail("scriptPubKey");
  if (mainnetAddress(output.key) !== expected.bip350Address) fail("Bech32m address");
  const leaves = collectLeaves(fromVector(vector.given.scriptTree));
  for (const item of leaves) {
    const proof = proofFor(tree, item.id);
    if (hex(proof.leaf.hash) !== intermediary.leafHashes[item.id]) fail("Leaf hash");
    const control = makeControlBlock(item.version, output.parity, internalKey, proof.siblings.map(node => node.hash));
    if (hex(control) !== expected.scriptPathControlBlocks[item.id]) fail("Control block");
    const result = await verifyCommitment(output.key, proof.leaf.script, control);
    if (!result.keyMatches || !result.parityMatches) fail("Reconstructed commitment");
  }
}

get("preset").addEventListener("change", loadPreset);
get("add-leaf").addEventListener("click", () => {
  const used = leafIds();
  const id = Array.from(labels, (_, index) => index).find(index => !used.includes(index));
  if (id === undefined) return;
  appendLeaf(leaf(id, "51"));
  updateGrouping();
  recalculate();
  get("script-" + id).focus();
});
get("grouping").addEventListener("change", recalculate);
get("builder").addEventListener("submit", event => {
  event.preventDefault();
  recalculate();
});
get("builder").addEventListener("input", event => {
  if (event.target === get("preset") || event.target === get("grouping")) return;
  buildRequest++;
  clearBuild();
  status("build-status", "Inputs changed. Recalculate the tree.");
});
get("tree").addEventListener("click", event => {
  const button = event.target.closest("[data-leaf]");
  if (!button || !built) return;
  selected = Number(button.dataset.leaf);
  renderTree();
  get("tree").querySelector('[data-leaf="' + selected + '"]').focus({ preventScroll: true });
});
get("send-proof").addEventListener("click", () => {
  const proof = proofFor(built.tree, selected);
  const { output, internalKey } = built;
  showProof({
    key: hex(output.key),
    script: hex(proof.leaf.script),
    control: hex(makeControlBlock(proof.leaf.version, output.parity, internalKey, proof.siblings.map(node => node.hash))),
    context: { label: "Tree lab · Leaf " + labels[selected] },
  });
});
get("proof-form").addEventListener("submit", event => {
  event.preventDefault();
  verify();
});
get("proof-form").addEventListener("input", () => {
  blankProof();
  get("proof-source").textContent = proofContext
    ? proofContext.label + " · edited proof inputs"
    : "Custom proof inputs";
  status("proof-status", "Inputs changed. Verify the commitment again.");
});
get("flip-parity").addEventListener("click", () => {
  try {
    const control = readHex(get("control-block").value, "Control block");
    if (!control.length) throw new Error("Load a proof before flipping its parity.");
    control[0] ^= 1;
    get("control-block").value = hex(control);
    get("control-block").dispatchEvent(new Event("input", { bubbles: true }));
    verify();
  } catch (error) {
    blankProof();
    status("proof-status", error.message, "bad");
  }
});
document.querySelectorAll(".chain-load").forEach(button => {
  button.addEventListener("click", () => {
    const fixture = chainExamples[Number(button.dataset.example)];
    showProof({
      key: fixture.scriptPubKey.slice(4),
      script: fixture.witness.at(-2),
      control: fixture.witness.at(-1),
      context: { label: "Mainnet · block " + fixture.height.toLocaleString("en-US") + " · input " + fixture.input, fixture },
    });
  });
});
get("vector-check").addEventListener("click", async () => {
  const button = get("vector-check");
  button.disabled = true;
  status("vector-status", "Checking published vectors…");
  let passed = 0;
  try {
    for (const vector of walletVectors) {
      await checkVector(vector);
      passed++;
    }
    status("vector-status", "Passed " + passed + " of " + walletVectors.length + " published output vectors.", "good");
  } catch (error) {
    status("vector-status", "Vector " + (passed + 1) + " failed. " + error.message, "bad");
  } finally {
    button.disabled = false;
  }
});

loadPreset();
