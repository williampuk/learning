import {
  ORDER, add, compactSize, concat, commitTree, hex, mainnetAddress, makeControlBlock, multiply, outputKey,
  pointFromX, readHex, sha256, taggedHash, tapLeaf, verifyCommitment,
} from "./taproot.mjs";
import {
  bytes32, compressed, decodeXpub, decompress, derivePublic, evenScalar, integer, little, negate, parseSignature, scalar,
  serializeTx, signExample, signatureMessage, varbytes, verifySchnorr, witnessBytes,
} from "./protocol.mjs";
import { walletVectors } from "./examples.mjs";
import { keyTx, scriptTx, wpkhTx, wshTx } from "./transactions.mjs";

const get = (panel, name) => panel.querySelector(`[name="${name}"]`).value;
const H = bytes => hex(bytes);
const num = value => H(bytes32(value));
const coords = point => point ? `x = ${num(point.x)}\ny = ${num(point.y)}` : "Infinity";
const valueHex = (panel, name, length) => readHex(get(panel, name), name, length);
const ascii = value => new TextEncoder().encode(value);
const formatType = type => "0x" + type.toString(16).padStart(2, "0");
const parse = value => readHex(value, "Example hex");
const b86Xpub = "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

function node(tag, text, className) {
  const child = document.createElement(tag);
  if (text !== undefined) child.textContent = text;
  if (className) child.className = className;
  return child;
}

function rows(items) {
  const list = node("dl", undefined, "exp-rows");
  for (const [label, value, preimage] of items) {
    const row = node("div");
    const content = node("dd");
    content.append(node("code", String(value)));
    if (preimage) {
      const details = node("details");
      details.append(node("summary", "Bytes before SHA-256"), node("code", H(preimage)));
      content.append(details);
    }
    row.append(node("dt", label), content);
    list.append(row);
  }
  return list;
}

function byteLayout(entries, label) {
  const list = node("dl", undefined, "byte-layout");
  list.setAttribute("aria-label", label);
  for (const [bytes, meaning] of entries) {
    const cell = node("div");
    cell.append(node("dt", bytes), node("dd", meaning));
    list.append(cell);
  }
  return list;
}

function details(title, content) {
  const box = node("details");
  box.append(node("summary", title), content);
  return box;
}

function setup(id, render) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const out = panel.querySelector("[data-result]");
  let pending = 0;
  async function refresh() {
    const index = ++pending;
    try {
      const result = await render(panel);
      if (index === pending) out.replaceChildren(...result);
    } catch (error) {
      if (index === pending) out.replaceChildren(node("p", error.message, "exp-error"));
    }
  }
  panel.addEventListener("change", refresh);
  panel.addEventListener("click", event => {
    if (event.target.closest("button[data-run]")) refresh();
  });
  refresh();
}

setup("compare-lab", panel => {
  const type = get(panel, "type");
  const fixture = type === "wpkh" ? wpkhTx : type === "wsh" ? wshTx : keyTx;
  const { witness, prevout } = fixture.vin[0];
  const notes = {
    wpkh: ["HASH160 of the compressed key", "DER ECDSA + sighash byte; compressed public key"],
    wsh: ["SHA-256 of the complete witness script", "Dummy; two ECDSA signatures; complete 2-of-3 witness script"],
    tr: ["The x coordinate of the output key", "One BIP340 signature; witness alone cannot establish whether a tree exists"],
  };
  const layout = type === "wpkh" ? [["00", "Version 0"], ["14", "Push 20 bytes"], ["20 bytes", "HASH160(public key)"]]
    : type === "wsh" ? [["00", "Version 0"], ["20", "Push 32 bytes"], ["32 bytes", "SHA256(witness script)"]]
    : [["51", "Version 1"], ["20", "Push 32 bytes"], ["32 bytes", "Taproot output key x(Q)"]];
  return [byteLayout(layout, "Funding byte layout"), rows([
    ["Funding scriptPubKey", prevout.scriptpubkey], ["Commits to", notes[type][0]],
    ["Spender reveals", notes[type][1]], ...witness.map((item, i) => [`Witness item ${i} · ${item.length / 2} B`, item || "<empty>"]),
    ["Serialized input witness", H(witnessBytes(witness.map(parse)))],
  ])];
});

// A genuine elliptic curve of order 19 over F_17. The teaching hash is deliberately tiny.
const toyPoints = [[5,1],[6,3],[10,6],[3,1],[9,16],[16,13],[0,6],[13,7],[7,6],[7,11],[13,10],[0,11],[16,4],[9,1],[3,16],[10,11],[6,14],[5,16]];
const toyPoint = k => toyPoints[(k % 19 + 19) % 19 - 1] ?? null;
const showToy = point => point ? `(${point.join(", ")})` : "∞";
setup("schnorr-lab", panel => {
  const rawD = Number(get(panel, "secret"));
  const rawK = Number(get(panel, "nonce"));
  const M = Number(get(panel, "message"));
  if (![rawD, rawK].every(x => Number.isInteger(x) && x >= 1 && x <= 18) ||
      get(panel, "message").trim() === "" || !Number.isInteger(M) || M < 0 || M > 99) {
    throw new Error("Choose a secret and nonce from 1–18 and an integer message from 0–99.");
  }
  const d = toyPoint(rawD)[1] % 2 ? 19 - rawD : rawD;
  const k = toyPoint(rawK)[1] % 2 ? 19 - rawK : rawK;
  const [r] = toyPoint(k);
  const [x] = toyPoint(d);
  const e = (r + x + M) % 19;
  const s = (k + e * d) % 19;
  return [rows([
    ["Raw and even-Y public points", `${rawD}G = ${showToy(toyPoint(rawD))}; ${d}G = ${showToy(toyPoint(d))}`],
    ["Raw and even-Y nonce points", `${rawK}G = ${showToy(toyPoint(rawK))}; ${k}G = ${showToy(toyPoint(k))}`],
    ["Toy challenge", `(${r} + ${x} + ${M}) mod 19 = ${e}`],
    ["Toy signature (r, s)", `s = (${k} + ${e} × ${d}) mod 19 = ${s}; (${r}, ${s})`],
    ["Left side · sG", `${s}G = ${showToy(toyPoint(s))}`],
    ["Right side · R + eP", `(${k} + ${e} × ${d})G = ${showToy(toyPoint(k + e * d))}`],
    ["Verification · sG − eP", `(${s} − ${e} × ${d})G = ${showToy(toyPoint(s - e * d))}`],
  ])];
});

setup("xonly-lab", panel => {
  const d0 = BigInt(get(panel, "secret"));
  if (d0 < 1n || d0 > 20n) throw new Error("Choose a public example scalar from 1 to 20.");
  const dRaw = get(panel, "sign") === "negative" ? ORDER - d0 : d0;
  const point = multiply(dRaw);
  const x = bytes32(point.x);
  const even = pointFromX(x);
  const d = evenScalar(dRaw, point);
  return [rows([
    ["Raw d · hex", num(dRaw)], ["Raw dG", coords(point)],
    ["Even lift_x · P", coords(even)], ["Odd point · −P", coords(negate(even))],
    ["Normalized scalar d", num(d)], ["Uncompressed SEC1 · 65 bytes", "04" + H(x) + num(point.y)],
    ["Compressed SEC1 · 33 bytes", H(compressed(point))], ["BIP340 x-only · 32 bytes", H(x)],
  ])];
});

setup("vector-lab", async panel => {
  const vectors = await fetch("./schnorr-vectors.json").then(response => response.json());
  const vector = vectors[Number(get(panel, "vector"))];
  const message = parse(vector.message);
  const secret = integer(parse(vector["secret key"]));
  const aux = parse(vector.aux_rand);
  const trace = await signExample(secret, message, aux);
  const verified = await verifySchnorr(trace.key, message, trace.signature);
  const success = H(trace.signature) === vector.signature.toLowerCase() && verified.ok;
  return [node("p", success ? "Published BIP340 signature reproduced and verified." : "Vector mismatch.", success ? "exp-state" : "exp-error"),
    rows([["Encoded r || s", H(trace.signature)]]), details("Expand the signing and verification trace", rows([
      ["Public test secret · d₀", num(secret)], ["Raw d₀G", coords(trace.rawP)], ["Normalized d", num(trace.d)],
      ["Public key bytes · x(P)", H(trace.key)], ["Message bytes · M", H(message)], ["Auxiliary bytes", H(aux)],
      ["Tagged auxiliary hash", H(trace.auxHash)], ["bytes(d) XOR aux hash", H(trace.masked)],
      ["Exact nonce-hash data", H(concat(trace.masked, trace.key, message))], ["Tagged nonce hash", H(trace.nonceHash)],
      ["Scalar k₀", num(trace.k0)], ["Raw nonce point k₀G", coords(trace.rawR)], ["Normalized scalar k", num(trace.k)],
      ["Normalized nonce point R", coords(trace.R)], ["Challenge data r || x(P) || M", H(concat(trace.signature.slice(0, 32), trace.key, message))],
      ["Challenge e", num(trace.e)], ["Response s", num(trace.s)], ["Reconstructed sG − eP", coords(verified.R)],
    ]))];
});

setup("tweak-lab", async panel => {
  const rootText = get(panel, "root").trim();
  const vector = walletVectors[0];
  const internal = parse(vector.given.internalPubkey);
  const root = rootText ? readHex(rootText, "Merkle root", 32) : null;
  const Q = await outputKey(internal, root);
  const header = await sha256(ascii("TapTweak"));
  return [rows([
    ["Official BIP341 vector 0 · internal x(P)", H(internal)], ["Even internal point P", coords(pointFromX(internal))],
    ["Optional root", root ? H(root) : "<omitted, zero bytes>"],
    ["Complete SHA-256 input", H(concat(header, header, Q.preimage))],
    ["TapTweak scalar t · big-endian", H(Q.tweak)], ["Point tG", coords(multiply(integer(Q.tweak)))],
    ["Output point Q", coords(Q.point)], ["scriptPubKey · version opcode, push length, x(Q)", "5120" + H(Q.key)],
    ["Address", mainnetAddress(Q.key)], ["Published vector comparison", root ? "Custom root selected" : mainnetAddress(Q.key) === vector.expected.bip350Address ? "Matches BIP341" : "Mismatch"],
  ])];
});

setup("private-tweak-lab", async panel => {
  const d0 = BigInt(get(panel, "secret"));
  if (d0 < 1n || d0 > 20n) throw new Error("Choose a public example scalar from 1 to 20.");
  const raw = multiply(d0);
  const d = evenScalar(d0, raw);
  const output = await outputKey(bytes32(raw.x), null);
  const u = scalar(d + integer(output.tweak));
  const q = evenScalar(u, output.point);
  const testMessage = await sha256(ascii("Alice's educational transaction digest"));
  const good = await signExample(q, testMessage, new Uint8Array(32));
  const wrong = await signExample(d0, testMessage, new Uint8Array(32));
  return [rows([
    ["Raw d₀G", coords(raw)], ["Internal normalized d", num(d)], ["Tweak t", H(output.tweak)],
    ["u = (d + t) modulo n", num(u)], ["Public Q from P + tG", coords(output.point)], ["Private path uG", coords(multiply(u))],
    ["Even-Y signing scalar q", num(q)], ["Signing point qG", coords(multiply(q))],
    ["Signature made with q", (await verifySchnorr(output.key, testMessage, good.signature)).ok ? "Verifies under x(Q)" : "Failed"],
    ["Signature made with the original d₀", (await verifySchnorr(output.key, testMessage, wrong.signature)).ok ? "Verifies" : "Fails under x(Q)"],
  ])];
});

setup("bip86-lab", async panel => {
  const [change, index] = get(panel, "child").split("/").map(Number);
  const parent = await decodeXpub(b86Xpub);
  const branch = await derivePublic(parent, change);
  const child = await derivePublic(branch, index);
  const key = bytes32(child.point.x);
  const tweaked = await outputKey(key, null);
  const net = get(panel, "network");
  const main = mainnetAddress(tweaked.key);
  const address = mainnetAddress(tweaked.key, net);
  const expected = {
    "0/0": "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    "0/1": "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh",
    "1/0": "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
  };
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const words = address.slice(net.length + 2, -6).split("").map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  return [rows([
    ["Child’s compressed key", H(compressed(child.point))], ["Internal key x(P)", H(key)],
    ["TapTweak · omitted root", H(tweaked.tweak)], ["Output key x(Q) · the 32 program bytes", H(tweaked.key)],
    ["scriptPubKey · 51 20 <32 bytes>", "5120" + H(tweaked.key)], ["Bech32m address", address],
    ["Decode · HRP | separator | version 1 | program words | checksum", `${net} | 1 | p | ${address.slice(net.length + 2, -6)} | ${address.slice(-6)}`],
    ["Mainnet BIP86 vector comparison", main === expected[`${change}/${index}`] ? "Matches the published address" : "Mismatch"],
  ]), details("Expand the exact BIP32 and address bytes", rows([
    ["Account xpub · m/86′/0′/0′ (mainnet fixture)", b86Xpub],
    ["Account compressed point", H(compressed(parent.point))], ["Account chain code", H(parent.chainCode)],
    ["Change CKDpub data · compressed K || ser32(change)", H(branch.preimage)], ["Change HMAC-SHA512 · I_L || I_R", H(branch.digest)],
    ["Child CKDpub data · compressed K || ser32(index)", H(child.preimage)], ["Child HMAC-SHA512 · I_L || I_R", H(child.digest)],
    ["Decode · 5-bit program words regrouped into octets, then padding", words.slice(0, 256).match(/.{8}/g).join(" ") + " | " + words.slice(256)],
  ]))];
});

const txCase = name => name === "script" ? [scriptTx, 1] : [keyTx, 0];
function witnessItems(tx, index) {
  const witness = tx.vin[index].witness.map(parse);
  const annex = witness.length >= 2 && witness.at(-1)[0] === 0x50 ? witness.pop() : undefined;
  if (witness.length === 1) return { annex, raw: witness[0] };
  return { annex, raw: witness[0], script: witness.at(-2), control: witness.at(-1) };
}

setup("sighash-lab", async panel => {
  const [tx, index] = txCase(get(panel, "tx"));
  const { raw, script, control } = witnessItems(tx, index);
  const parsed = parseSignature(raw);
  const type = Number(get(panel, "mode"));
  const annex = get(panel, "annex") === "yes" ? Uint8Array.of(0x50, 0x01) : undefined;
  const leafHash = script ? (await tapLeaf(control[0] & 0xfe, script)).hash : undefined;
  const msg = await signatureMessage(tx, index, type, { annex, leafHash });
  const publicKey = script ? script.slice(1, 33) : parse(tx.vin[index].prevout.scriptpubkey).slice(2);
  const verdict = await verifySchnorr(publicKey, msg.digest, parsed.signature);
  return [node("p", verdict.ok ? "This digest verifies the recorded signature." :
    "The recorded signature fails against these modified signing bytes.", verdict.ok ? "exp-state" : "exp-error"),
    rows([...msg.rows.map(row => [`${row.name} · ${row.bytes.length} B`, H(row.bytes), row.preimage]),
      ["Concatenated epoch || SigMsg || extension", H(msg.bytes)], ["Final TapSighash", H(msg.digest)]])];
});

setup("failure-lab", async panel => {
  const failure = get(panel, "failure");
  if (failure === "early") {
    const data = await loadVault();
    return [node("p", "Stage 2 · Tapscript OP_CHECKSEQUENCEVERIFY rejected sequence 143.", "exp-error"),
      rows([["Script-engine output for a correctly signed sequence-143 spend", data.vault.badSequenceError],
        ["Commitment", "Unchanged: valid leaf and control block"], ["Required minimum sequence", "144 in block units"]])];
  }
  const { raw, script, control } = witnessItems(scriptTx, 1);
  let revealed = script;
  let proof = control;
  if (failure === "script") { revealed = script.slice(); revealed[2] ^= 1; }
  if (failure === "sibling") { proof = control.slice(); proof[33] ^= 1; }
  if (failure === "parity") { proof = control.slice(); proof[0] ^= 1; }
  if (failure === "order") {
    const tx = walletVectors[5];
    const item = tx.expected.scriptPathControlBlocks.map(parse).find(c => c.length === 97);
    const version = item[0] & 0xfe;
    const source = tx.given.scriptTree[1][0];
    const flipped = makeControlBlock(version, item[0] & 1, item.slice(1, 33), [item.slice(65), item.slice(33, 65)]);
    const result = await verifyCommitment(parse(tx.intermediary.tweakedPubkey), parse(source.script), flipped);
    return [node("p", result.keyMatches ? "Unexpected match." : "Stage 1 · Reversing the proof levels changed x(Q).", "exp-error"),
      rows([["Valid control block · nearest sibling first", H(item)], ["Modified · farthest sibling first", H(flipped)],
        ["Expected root", tx.intermediary.merkleRoot], ["Reconstructed root", H(result.root)]])];
  }
  const expected = parse(scriptTx.vin[1].prevout.scriptpubkey).slice(2);
  const result = await verifyCommitment(expected, revealed, proof);
  if (!result.keyMatches || !result.parityMatches) {
    return [node("p", "Stage 1 · " + (!result.keyMatches ? "Recomputed x(Q) differs from the previous output." : "The control header has the wrong output parity."), "exp-error"),
      rows([["Expected x(Q)", H(expected)], ["Computed x(Q)", H(result.output.key)], ["Header parity / computed parity", `${result.parity} / ${result.output.parity}`]])];
  }
  if (failure === "empty") {
    return [node("p", "Stage 2 · The empty signature leaves a false stack top.", "exp-error"),
      rows([["Membership and parity", "Verified"], ["Initial script stack", "[empty]"],
        ["After pushing the leaf key", "[empty, x(leaf key)]"], ["After CHECKSIG", "[false]"],
        ["Final check", "Tapscript requires exactly one truthy element."]])];
  }
  if (failure === "zero-type") {
    let reason;
    try {
      parseSignature(concat(raw, Uint8Array.of(0)));
    } catch (error) {
      reason = error.message;
    }
    return [node("p", "Stage 2 · Signature encoding rejected before hashing.", "exp-error"),
      rows([["Membership and parity", "Verified"], ["Invalid 65-byte signature", H(raw) + "00"], ["Parser", reason]])];
  }
  const candidate = raw.slice();
  if (failure === "sig") candidate[32] ^= 1;
  const type = 0;
  const signed = failure === "digest" ? structuredClone(scriptTx) : scriptTx;
  if (signed !== scriptTx) signed.vin[0].prevout.value += 1;
  const message = await signatureMessage(signed, 1, type, { leafHash: result.leaf.hash });
  const verdict = await verifySchnorr(revealed.slice(1, 33), message.digest, candidate);
  return [node("p", verdict.ok ? "Both stages pass for the recorded spend." : "Stage 2 · OP_CHECKSIG fails.", verdict.ok ? "exp-state" : "exp-error"),
    rows([["Membership and parity", "Verified"], ["Sighash type used", formatType(type)],
      ...(failure === "digest" ? [["Modified data", "Prevout amount of the other input + 1 satoshi"]] : []),
      ["Digest", H(message.digest)], ["BIP340 check", verdict.ok ? "Valid" : verdict.reason]])];
});

const stackSteps = {
  delayed: [
    ["Initial witness", "[sig_A]"], ["Push 144 · 02 90 00", "[sig_A, 144]"],
    ["CSV · b2", "[sig_A, 144]"], ["DROP · 75", "[sig_A]"],
    ["Push 32-byte Alice recovery key", "[sig_A, x(A)]"],
    ["CHECKSIG · ac", "[1] with a valid signature"],
  ],
  quorum: [
    ["Initial stack after the delay prefix", "[sig_C, empty, sig_A]"], ["Push x(A); CHECKSIG", "[sig_C, empty, 1]"],
    ["Push x(B); CHECKSIGADD", "[sig_C, 1]"], ["Push x(C); CHECKSIGADD", "[2]"],
    ["Push 2", "[2, 2]"], ["NUMEQUAL", "[1]"],
  ],
};
setup("stack-lab", panel => {
  const data = stackSteps[get(panel, "policy")];
  const step = Math.min(Number(get(panel, "step")), data.length - 1);
  return [rows(data.slice(0, step + 1))];
});

let vaultPromise;
function loadVault() {
  vaultPromise ??= fetch("./vault-data.json").then(response => response.json());
  return vaultPromise;
}

setup("journey-lab", async panel => {
  const { vault } = await loadVault();
  const path = get(panel, "path");
  const tx = vault[path];
  const key = path === "cooperative";
  return [rows([
    ["Same previous scriptPubKey", vault.scriptPubKey], ["Distinct synthetic funding outpoint", tx.outpoint],
    ["Sequence", tx.sequence], ["Observed policy data", key ? "One signature" : "Alice’s recovery key and delay, internal key, and one 32-byte sibling hash"],
    ["Node checks", key ? "Verify under x(Q) using the key-path digest"
      : "Recompute x(Q) and parity; then check CSV and Alice’s leaf signature; transaction age must also pass BIP68"],
    ...tx.witness.map((item, i) => [`Witness item ${i} · ${item.length / 2} B`, item]),
    ["Serialized input witness bytes", H(witnessBytes(tx.witness.map(parse)))],
    ["Whole transaction weight / vsize", `${tx.weight} WU / ${tx.vsize} vB`],
  ])];
});

async function txDetails(tx, index) {
  const input = tx.vin[index];
  const { raw, script, control, annex } = witnessItems(tx, index);
  const sig = parseSignature(raw);
  const key = parse(input.prevout.scriptpubkey).slice(2);
  const proof = script ? await verifyCommitment(key, script, control) : null;
  const msg = await signatureMessage(tx, index, sig.type, { annex, leafHash: proof?.leaf.hash });
  const valid = await verifySchnorr(script ? script.slice(1, 33) : key, msg.digest, sig.signature);
  const txid = H((await sha256(await sha256(serializeTx(tx)))).reverse());
  const wtxid = H((await sha256(await sha256(serializeTx(tx, true)))).reverse());
  return [node("p", valid.ok && (!proof || proof.keyMatches && proof.parityMatches) && txid === tx.txid
    ? "TXID, signature, and applicable commitment checks pass." : "Verification failed.", valid.ok ? "exp-state" : "exp-error"),
    rows([
      ["TXID · double SHA-256 of stripped transaction, displayed in reverse byte order", txid],
      ["WTXID · double SHA-256 including witness, displayed reversed", wtxid],
      ["Confirmed height", tx.status.block_height], ["Version / locktime", `${tx.version} / ${tx.locktime}`],
      ...tx.vin.map((v, i) => [`Input ${i} · previous UTXO, satoshis, prevout script, scriptSig, sequence, witness`,
        `${v.txid}:${v.vout}\n${v.prevout.value} sat\n${v.prevout.scriptpubkey}\nscriptSig: ${v.scriptsig || "<empty>"}\nsequence: ${v.sequence}\nwitness:\n${v.witness.join("\n")}`]),
      ...tx.vout.map((v, i) => [`Output ${i}`, `${v.value} sat · ${v.scriptpubkey}`]),
      ["Selected input", index], ["Previous x(Q)", H(key)], ["Sighash byte (implicit if 64 bytes)", formatType(sig.type)],
      ["Signature · r || s", H(sig.signature)], ["Transaction digest", H(msg.digest)], ["Witness serialization", H(witnessBytes(input.witness.map(parse)))],
    ]), ...(proof ? [details("Expand the control block byte-by-byte", rows([
      ["Byte 0 · header (version | parity)", H(control.slice(0, 1))], ["Bytes 1–32 · internal key", H(proof.internalKey)],
      ["Bytes 33 onward · siblings, nearest first", proof.steps.map(step => H(step.sibling)).join("\n")],
      ["Masked leaf version / output parity", `${formatType(proof.version)} / ${proof.parity}`],
      ["Revealed Tapscript", H(script)], ["Script’s x-only CHECKSIG key", H(script.slice(1, 33))],
      ["Exact TapLeaf data", H(proof.leaf.preimage)], ["TapLeaf hash", H(proof.leaf.hash)],
      ...proof.steps.map((step, i) => [`Root after sibling ${i + 1}`, H(step.hash)]),
      ["TapTweak input / output", H(proof.output.preimage) + "\n" + H(proof.output.tweak)],
      ["Reconstructed x(Q) / full-point parity", H(proof.output.key) + " / " + proof.output.parity],
    ]))] : []), details("Expand the complete wire transaction", rows([
      ["Raw signed transaction", H(serializeTx(tx, true))],
      ["Version | marker + flag | input count", H(little(tx.version, 4)) + " | 0001 | " + H(compactSize(tx.vin.length))],
      ...tx.vin.map((v, i) => [`Input ${i} wire · outpoint hash | index | length-prefixed scriptSig | sequence`,
        [parse(v.txid).reverse(), little(v.vout, 4), varbytes(parse(v.scriptsig)), little(v.sequence, 4)].map(H).join(" | ")]),
      ["Output count", H(compactSize(tx.vout.length))],
      ...tx.vout.map((v, i) => [`Output ${i} wire · amount | length-prefixed scriptPubKey`,
        H(little(v.value, 8)) + " | " + H(varbytes(parse(v.scriptpubkey)))]),
      ...tx.vin.map((v, i) => [`Input ${i} witness · item count and length-prefixed items`,
        [compactSize(v.witness.length), ...v.witness.map(item => varbytes(parse(item)))].map(H).join(" | ")]),
      ["Locktime · final four bytes", H(little(tx.locktime, 4))],
      ["Raw stripped transaction", H(serializeTx(tx))],
      ["Stripped bytes / total bytes / WU / vB", `${serializeTx(tx).length} / ${serializeTx(tx, true).length} / ${tx.weight} / ${Math.ceil(tx.weight / 4)}`],
    ]))];
}

setup("chain-lab", async panel => txDetails(...txCase(get(panel, "tx"))));

async function vaultCommitment(vault) {
  const alice = parse(vault.alice);
  const bob = parse(vault.bob);
  const keyList = await taggedHash("KeyAgg list", concat(alice, bob));
  const aAlice = scalar(integer(await taggedHash("KeyAgg coefficient", concat(keyList, alice))));
  const aggregate = add(multiply(aAlice, decompress(alice)), decompress(bob));
  const x = bytes32(aggregate.x);
  const [A, B, C] = vault.scripts.map((script, id) => ({ id, version: 0xc0, script: parse(script) }));
  const tree = await commitTree([A, [B, C]]);
  const Q = await outputKey(x, tree.hash);
  return { keyList, aAlice, aggregate, x, tree, Q };
}

async function verifyVaultRounds(vault, policy, message, signature) {
  const round = vault.signingRounds;
  const nonces = [round.alicePublicNonce, round.bobPublicNonce].map(nonce => {
    const bytes = parse(nonce);
    return [decompress(bytes.slice(0, 33)), decompress(bytes.slice(33))];
  });
  const R1 = add(nonces[0][0], nonces[1][0]);
  const R2 = add(nonces[0][1], nonces[1][1]);
  const b = scalar(integer(await taggedHash("MuSig/noncecoef", concat(compressed(R1), compressed(R2), policy.Q.key, message))));
  const rawR = add(R1, multiply(b, R2));
  const gamma = rawR.y & 1n ? -1n : 1n;
  const alpha = policy.aggregate.y & 1n ? -1n : 1n;
  const beta = policy.Q.parity ? -1n : 1n;
  const r = bytes32(rawR.x);
  const e = scalar(integer(await taggedHash("BIP0340/challenge", concat(r, policy.Q.key, message))));
  const partials = [integer(parse(round.alicePartial)), integer(parse(round.bobPartial))];
  const points = [decompress(parse(vault.alice)), decompress(parse(vault.bob))];
  const coefficients = [policy.aAlice, 1n];
  const check = partials.every((s, i) => {
    const ri = add(nonces[i][0], multiply(b, nonces[i][1]));
    const predicted = add(gamma === 1n ? ri : negate(ri), multiply(scalar(e * beta * alpha * coefficients[i]), points[i]));
    const observed = multiply(s);
    return predicted?.x === observed?.x && predicted?.y === observed?.y;
  });
  const correction = scalar(e * beta * integer(policy.Q.tweak));
  const s = scalar(partials[0] + partials[1] + correction);
  return { ok: check && H(concat(r, bytes32(s))) === H(signature), round, R1, R2, b, gamma, e, correction };
}

setup("capstone-lab", async panel => {
  const { vault } = await loadVault();
  const chosen = get(panel, "path");
  const tx = vault[chosen];
  const policy = await vaultCommitment(vault);
  const V = policy.Q.key;
  const [txid, outindex] = tx.outpoint.split(":");
  const model = { version: tx.version, locktime: tx.locktime, vin: [{
    txid, vout: Number(outindex), sequence: tx.sequence, scriptsig: "", prevout: { value: tx.amount, scriptpubkey: vault.scriptPubKey },
    witness: tx.witness,
  }], vout: [{ value: tx.outputAmount, scriptpubkey: tx.outputScript }] };
  const witness = tx.witness.map(parse);
  const proof = witness.length > 1 ? await verifyCommitment(V, witness.at(-2), witness.at(-1)) : null;
  const digest = await signatureMessage(model, 0, 0, { leafHash: proof?.leaf.hash });
  const scriptCheck = async (i, key) => (await verifySchnorr(key, digest.digest, witness[i])).ok;
  const valid = chosen === "cooperative" ? await scriptCheck(0, V)
    : chosen === "quorum" ? await scriptCheck(2, witness[3].slice(6, 38)) && await scriptCheck(0, witness[3].slice(74, 106))
    : await scriptCheck(0, witness[1].slice(-33, -1));
  const rounds = chosen === "cooperative" ? await verifyVaultRounds(vault, policy, digest.digest, witness[0]) : null;
  const funding = parse(tx.syntheticFunding);
  const fundingId = H((await sha256(await sha256(funding))).reverse());
  const pass = fundingId === txid && H(policy.x) === vault.internalKey && H(policy.tree.hash) === vault.root &&
    H(V) === vault.outputKey && H(digest.digest) === tx.digest && H(serializeTx(model, true)) === tx.raw &&
    valid && (!proof || proof.keyMatches && proof.parityMatches) && (!rounds || rounds.ok);
  return [node("p", pass ? "Fixture bytes, digest, signatures, and applicable proof verified." : "Verification failed.", pass ? "exp-state" : "exp-error"),
    rows([
      ["Alice / Bob cooperative compressed keys", vault.alice + "\n" + vault.bob],
      ["Aggregate internal key x(P)", vault.internalKey],
      ...vault.scripts.map((script, i) => [`Leaf ${"ABC"[i]} · raw script / TapLeaf hash`, script + "\n" + vault.leafHashes[i]]),
      ["Sibling subtree B+C", vault.branch], ["Root m", vault.root], ["TapTweak scalar t", vault.tweak],
      ["Output x(Q) / y(Q) parity", vault.outputKey + " / " + vault.outputParity],
      ["Locking script", vault.scriptPubKey], ["Mainnet-encoded example address (public test keys)", vault.address],
    ]),
    details("Inspect MuSig2 key aggregation", rows([
      ["KeyAgg list hash (Alice || Bob)", H(policy.keyList)],
      ["Alice’s coefficient", num(policy.aAlice)], ["Bob’s coefficient (second distinct key)", "1"],
      ["Unnormalized aggregate point", coords(policy.aggregate)],
      ["Even x-only internal point", coords(pointFromX(policy.x))],
    ])),
    ...(rounds ? [details("Inspect public MuSig2 rounds and verify the partial signatures", rows([
      ["Alice’s two public nonce points (compressed)", rounds.round.alicePublicNonce],
      ["Bob’s two public nonce points (compressed)", rounds.round.bobPublicNonce],
      ["Aggregate R₁ || R₂ (compressed)", H(concat(compressed(rounds.R1), compressed(rounds.R2)))],
      ["Nonce coefficient b", num(rounds.b)], ["Aggregate nonce parity sign γ", rounds.gamma],
      ["BIP340 challenge e", num(rounds.e)], ["Alice’s partial response", rounds.round.alicePartial],
      ["Bob’s partial response", rounds.round.bobPartial], ["Public correction e·β·t mod n", num(rounds.correction)],
      ["Partial equations and combined signature", rounds.ok ? "Verified" : "Mismatch"],
    ]))] : []),
    details("Inspect signed transaction, witness, and digest", rows([
      ["Synthetic funding transaction", tx.syntheticFunding],
      ["Synthetic outpoint and amount", `${tx.outpoint} · ${tx.amount} sat`], ["nVersion / nSequence / nLockTime", `${tx.version} / ${tx.sequence} / ${tx.locktime}`],
      ["Payment", `${tx.outputAmount} sat to ${tx.outputScript}`],
      ...tx.witness.map((item, i) => [`Witness item ${i} · ${item.length / 2} bytes`, item || "<empty signature>"]),
      ...(proof ? [["Reconstructed root", H(proof.root)], ["Computed output parity", proof.output.parity]] : []),
      ["TapSighash preimage", H(digest.bytes)], ["TapSighash digest", H(digest.digest)],
      ["Signed wire transaction", tx.raw], ["Weight and vsize", `${tx.weight} WU / ${tx.vsize} vB`],
    ]))];
});
