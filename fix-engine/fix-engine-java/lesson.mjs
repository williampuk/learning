const acknowledgement = {
  direction: "VENUE → BROKER", wire: "35=8  34=2  11=C42  37=V900  150=0",
  session: "Live", next: 3, ledger: "Accepted · 100 open",
  explanation: "Sequence 2 arrives in order. The acknowledgement identifies the venue order as V900."
};

const disconnect = {
  direction: "LINK", wire: "EOF before fill 34=3",
  session: "Disconnected", next: 3, ledger: "Uncertain · last seen accepted",
  explanation: "The venue has created E2. The broker has no evidence of the fill yet."
};

const crash = {
  direction: "BROKER", wire: "E2 committed / session checkpoint still at 3",
  session: "Disconnected", next: 3, ledger: "100 filled · 0 open",
  explanation: "The broker crash loses its uncommitted session checkpoint. The durable order ledger already contains E2."
};

const reconnect = {
  direction: "VENUE → BROKER", wire: "35=A  34=4",
  session: "Recovering", next: 3,
  explanation: "The new connection carries the same session. Logon at 4 exposes a gap at 3."
};

const request = {
  direction: "BROKER → VENUE", wire: "35=2  7=3  16=3",
  session: "Recovering", next: 3,
  explanation: "The broker asks for venue sequence 3. Its own outbound sequence is independent."
};

const replay = {
  direction: "VENUE → BROKER", wire: "35=8  34=3  43=Y  122=<original time>  17=E2  32=100",
  session: "Recovering", next: 4, ledger: "100 filled · 0 open",
  explanation: "Sequence 3 fills the gap. E2 is new to the ledger, so the broker books the fill."
};

const gapFill = {
  direction: "VENUE → BROKER", wire: "35=4  34=3  43=Y  123=Y  36=4",
  session: "Recovering", next: 4, ledger: "Uncertain · reconcile C42",
  explanation: "The gap fill skips sequence 3. C42 still needs reconciliation because the gap fill carries no execution."
};

const accountForLogon = {
  direction: "BROKER", wire: "Accounts for Logon 34=4",
  session: "Live", next: 5,
  explanation: "The broker accounts for the Logon at 4. Session recovery is complete."
};

const scenarios = {
  replay: [acknowledgement, disconnect, reconnect, request, replay, accountForLogon],
  gap: [acknowledgement, disconnect, reconnect, request, gapFill, accountForLogon],
  duplicate: [acknowledgement, crash, reconnect, request, {
    ...replay,
    explanation: "Replay supplies sequence 3. E2 is already in the ledger, so filled quantity stays at 100."
  }, accountForLogon]
};

const lab = document.querySelector("#recovery-lab");
const scenario = document.querySelector("#scenario");
const rows = document.querySelector("#lab-trace");
const status = document.querySelector("#trace-status");
const advance = document.querySelector("#advance");
const state = document.querySelector("#session-state");
const sequence = document.querySelector("#next-sequence");
const ledger = document.querySelector("#ledger-state");
let step = 0;

function resetTrace() {
  step = 0;
  rows.replaceChildren();
  state.textContent = "Live";
  sequence.textContent = "2";
  ledger.textContent = "Order sent";
  status.textContent = "C42 has been sent. The broker expects venue sequence 2.";
  advance.textContent = "Next event";
  advance.disabled = false;
}

advance.addEventListener("click", () => {
  const events = scenarios[scenario.value];
  const event = events[step++];
  const row = document.createElement("li");
  const direction = document.createElement("span");
  const wire = document.createElement("code");
  direction.textContent = event.direction;
  wire.textContent = event.wire;
  row.append(direction, wire);
  rows.append(row);
  state.textContent = event.session;
  sequence.textContent = event.next;
  if (event.ledger) {
    ledger.textContent = event.ledger;
  }
  const stateSummary = document.createElement("span");
  stateSummary.className = "visually-hidden";
  stateSummary.textContent = ` ${event.session}. Next expected ${event.next}. Ledger: ${ledger.textContent}.`;
  status.replaceChildren(event.explanation, stateSummary);
  if (step === events.length) {
    advance.textContent = "Trace complete";
    advance.disabled = true;
    document.querySelector("#reset-trace").focus();
  }
});

scenario.addEventListener("change", resetTrace);
document.querySelector("#reset-trace").addEventListener("click", resetTrace);
resetTrace();
lab.hidden = false;

const arrival = document.querySelector("#arrival");
const rate = document.querySelector("#arrival-rate");
const backlog = document.querySelector("#backlog");
const drain = document.querySelector("#drain");
const integers = new Intl.NumberFormat("en");
const decimals = new Intl.NumberFormat("en", {maximumFractionDigits: 1});

function updateBurst() {
  const arrivalsPerSecond = arrival.valueAsNumber;
  const servicePerSecond = 60_000;
  const queued = Math.max(0, arrivalsPerSecond - servicePerSecond) * 0.05;
  rate.value = integers.format(arrivalsPerSecond) + " msg/s";
  arrival.setAttribute("aria-valuetext", rate.value);
  backlog.textContent = integers.format(queued);
  drain.textContent = decimals.format(queued / servicePerSecond * 1_000) + " ms";
}

arrival.addEventListener("input", updateBurst);
document.querySelector("#reset-burst").addEventListener("click", () => {
  arrival.value = arrival.defaultValue;
  updateBurst();
});
updateBurst();
document.querySelector("#burst-lab").hidden = false;
