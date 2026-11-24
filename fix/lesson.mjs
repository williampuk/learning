const byId = (id) => document.getElementById(id);

function initializeWire() {
  const fieldInfo = {
    8: ['BeginString', 'Identifies the FIX profile used by this message.'],
    9: ['BodyLength', 'Counts bytes from the start of tag 35 through the delimiter before tag 10.'],
    35: ['MsgType', 'D means New Order Single, a request to place an order.'],
    49: ['SenderCompID', 'The agreed identifier of the sending app on this session.'],
    56: ['TargetCompID', 'The agreed identifier of the receiving broker on this session.'],
    34: ['MsgSeqNum', 'The app’s sequence number for this message. Its Logon used number 1.'],
    52: ['SendingTime', 'When the app sent the FIX message, in UTC.'],
    11: ['ClOrdID', 'C42 is the app’s identifier for the order request.'],
    55: ['Symbol', 'ACME is the fictional equity in this lesson.'],
    54: ['Side', '1 means Buy.'],
    60: ['TransactTime', 'When the business action took place, in UTC. It can differ from SendingTime.'],
    38: ['OrderQty', 'The app wants to buy 100 shares.'],
    40: ['OrdType', '2 means Limit. Check tag 44 for the price boundary.'],
    44: ['Price', 'For this buy, the limit is the most the app will pay per share.'],
    59: ['TimeInForce', '0 means Day. The applicable trading session defines when the order expires.'],
    10: ['CheckSum', 'The sum of all preceding byte values modulo 256, rendered as three digits.'],
  };
  const example = byId('wire-example');
  const fields = example.textContent.trim().split('\n').join('').split('|').filter(Boolean);
  const lab = byId('wire-lab');
  const readout = byId('field-readout');
  const checks = byId('wire-checks');
  const showSoh = byId('show-soh');
  const priceEdit = byId('wire-edit');
  const buttons = new Map();
  const fieldRow = document.createElement('div');
  fieldRow.className = 'wire-fields';
  fieldRow.setAttribute('role', 'group');
  fieldRow.setAttribute('aria-label', 'Message fields in wire order');
  lab.querySelector('.wire-prompt').after(fieldRow);

  let selected = '35';
  let sohVisible = false;

  for (const field of fields) {
    const [tag] = field.split('=');
    const button = document.createElement('button');
    const value = document.createElement('span');
    const delimiter = document.createElement('span');
    delimiter.className = 'delimiter';
    delimiter.setAttribute('aria-hidden', 'true');
    button.type = 'button';
    button.append(value, delimiter);
    button.addEventListener('click', () => {
      selected = tag;
      render();
    });
    buttons.set(tag, { button, value, delimiter });
    fieldRow.append(button);
  }

  const encoder = new TextEncoder();
  const soh = '\x01';
  function render(updateChecks = false) {
    const displayed = fields.map((field) => field.startsWith('44=') ? `44=${priceEdit.value}` : field);
    for (const field of displayed) {
      const [tag] = field.split('=');
      const { button, value, delimiter } = buttons.get(tag);
      button.setAttribute('aria-pressed', String(tag === selected));
      button.setAttribute('aria-label', `${field} · ${fieldInfo[tag][0]}`);
      value.textContent = field;
      delimiter.textContent = sohVisible ? '␁' : '|';
    }

    const title = document.createElement('strong');
    title.textContent = `${selected} · ${fieldInfo[selected][0]}`;
    const meaning = document.createElement('p');
    meaning.textContent = fieldInfo[selected][1];
    if (readout.textContent !== title.textContent + meaning.textContent) {
      readout.replaceChildren(title, meaning);
    }

    showSoh.setAttribute('aria-pressed', String(sohVisible));
    if (!updateChecks) return;

    const body = encoder.encode(displayed.slice(2, -1).join(soh) + soh);
    const beforeChecksum = encoder.encode(displayed.slice(0, -1).join(soh) + soh);
    const checksum = String(beforeChecksum.reduce((sum, byte) => sum + byte, 0) % 256).padStart(3, '0');
    const encodedLength = Number(displayed[1].slice(2));
    const encodedChecksum = displayed.at(-1).slice(3);
    const lengthStatus = document.createElement('span');
    const lengthMatches = encodedLength === body.length;
    lengthStatus.classList.toggle('mismatch', !lengthMatches);
    lengthStatus.textContent = `Length · ${lengthMatches ? 'match' : 'mismatch'} (${body.length} counted, tag 9: ${encodedLength})`;
    const checksumStatus = document.createElement('span');
    const checksumMatches = encodedChecksum === checksum;
    checksumStatus.classList.toggle('mismatch', !checksumMatches);
    checksumStatus.textContent = `Checksum · ${checksumMatches ? 'match' : 'mismatch'} (${checksum} calculated, ${encodedChecksum} on wire)`;
    checks.replaceChildren(lengthStatus, checksumStatus);
  }

  showSoh.addEventListener('click', () => {
    sohVisible = !sohVisible;
    render();
  });
  priceEdit.addEventListener('change', () => {
    render(true);
  });
  byId('reset-wire').addEventListener('click', () => {
    selected = '35';
    sohVisible = false;
    priceEdit.value = '25.00';
    render(true);
  });

  priceEdit.value = '25.00';
  render(true);
  example.hidden = true;
  lab.hidden = false;
}

const toBroker = 'App → Broker';
const toApp = 'Broker → App';
const sent = {
  direction: toBroker, title: 'Submit the limit buy',
  tags: '35=D|11=C42|55=ACME|54=1|38=100|40=2|44=25.00|59=0|',
  explanation: 'Request 100 shares at $25.00 or better. The app is waiting for an order response.',
  status: 'Awaiting acknowledgement', filled: 0, open: null,
};
const accepted = {
  direction: toApp, title: 'Acknowledge the order',
  tags: '35=8|11=C42|37=B510|17=E0|150=0|39=0|14=0|151=100|6=0|',
  explanation: 'B510 is the broker’s order ID. All 100 shares are open. This report records no trade.',
  status: 'New', filled: 0, open: 100,
};
const partial = {
  direction: toApp, title: 'Trade 40 shares',
  tags: '35=8|11=C42|37=B510|17=E1|150=F|39=1|32=40|31=24.90|14=40|151=60|6=24.90|',
  explanation: 'The broker reports 40 shares traded at $24.90. The remaining 60 may trade later.',
  status: 'Partially filled', filled: 40, open: 60,
};
const finalFill = {
  direction: toApp, title: 'Trade the remaining 60',
  tags: '35=8|11=C42|37=B510|17=E2|150=F|39=2|32=60|31=25.00|14=100|151=0|6=24.96|',
  explanation: 'A later seller trades the last 60 shares at $25.00. The app now has 100 shares filled at a weighted average of $24.96.',
  status: 'Filled', filled: 100, open: 0,
};
const cancel = {
  direction: toBroker, title: 'Request cancellation',
  tags: '35=F|11=C42-C1|41=C42|37=B510|',
  explanation: 'The request has its own ID and points to the working order. The broker has yet to confirm any change.',
  status: 'Partially filled · cancel sent', filled: 40, open: 60,
};
const pendingCancel = {
  direction: toApp, title: 'Acknowledge the cancel request',
  tags: '35=8|11=C42-C1|41=C42|37=B510|17=E3|150=6|39=6|14=40|151=60|6=24.90|',
  explanation: 'Pending Cancel means the broker is processing the request. The 60 shares can still trade.',
  status: 'Pending cancel', filled: 40, open: 60,
};

const orderScenarios = {
  fill: [sent, accepted, partial, finalFill],
  cancel: [sent, accepted, partial, cancel, pendingCancel, {
    direction: toApp, title: 'Confirm cancellation',
    tags: '35=8|11=C42-C1|41=C42|37=B510|17=E4|150=4|39=4|14=40|151=0|6=24.90|',
    explanation: 'The first trade still stands. The broker closes the remaining 60 shares, leaving zero open.',
    status: 'Canceled', filled: 40, open: 0,
  }],
  race: [sent, accepted, partial, cancel, pendingCancel, {
    ...finalFill,
    tags: finalFill.tags.replace('39=2', '39=6'),
    explanation: 'The final fill arrives before the cancel has taken effect. The trade is real even though Pending Cancel remains the reported status.',
    status: 'Pending cancel', filled: 100, open: 0,
  }, {
    direction: toApp, title: 'Reject the cancel as too late',
    tags: '35=9|11=C42-C1|41=C42|37=B510|39=2|434=1|102=0|',
    explanation: 'Tag 434 identifies the cancel request. The order was already filled. The quantities shown below carry forward from the trade report.',
    status: 'Filled', filled: 100, open: 0,
  }],
  replace: [sent, accepted, partial, {
    direction: toBroker, title: 'Ask to reduce the order to 80',
    tags: '35=G|11=C42-R1|41=C42|37=B510|38=80|40=2|44=25.00|',
    explanation: 'The app requests a new total of 80. The currently working total is still 100.',
    status: 'Partially filled · replace sent', filled: 40, open: 60,
  }, {
    direction: toApp, title: 'Confirm the replacement',
    tags: '35=8|11=C42-R1|41=C42|37=B510|17=E5|150=5|39=1|38=80|14=40|151=40|6=24.90|',
    explanation: 'The broker accepts C42-R1 as the working version. The first 40 shares still count toward the new total of 80.',
    status: 'Partially filled · replaced', filled: 40, open: 40, total: 80,
  }],
  reject: [sent, {
    direction: toApp, title: 'Reject the new order',
    tags: '35=8|11=C42|150=8|39=8|14=0|151=0|6=0|58=Size exceeds test limit|',
    explanation: 'In this branch the broker’s pre-trade limit blocks C42 before it can work or trade.',
    status: 'Rejected', filled: 0, open: 0,
  }],
};

function setStats(container, entries) {
  container.replaceChildren(...entries.map(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.textContent = label;
    definition.textContent = value;
    item.append(term, definition);
    return item;
  }));
}

function showTags(container, tags) {
  const fields = tags.split('|');
  const tail = fields.pop();
  const parts = fields.flatMap((field) => [field + '|', document.createElement('wbr')]);
  container.replaceChildren(...parts, tail);
}

function stepControls(prefix, length, render) {
  const next = byId(`${prefix}-next`);
  const previous = byId(`${prefix}-prev`);
  let current = 0;

  function update(announce) {
    // Keep focus on the step control when it reaches an endpoint.
    next.setAttribute('aria-disabled', String(current === length() - 1));
    previous.setAttribute('aria-disabled', String(current === 0));
    render(current, announce);
  }
  function reset() {
    current = 0;
    update(true);
  }

  next.addEventListener('click', () => {
    if (current < length() - 1) {
      current += 1;
      update(true);
    }
  });
  previous.addEventListener('click', () => {
    if (current > 0) {
      current -= 1;
      update(true);
    }
  });
  byId(`${prefix}-reset`).addEventListener('click', reset);
  update(false);
  return reset;
}

function initializeOrders() {
  const scenario = byId('order-scenario');
  const steps = () => orderScenarios[scenario.value];
  const reset = stepControls('order', () => steps().length, (current, announce) => {
    const event = steps()[current];
    const step = `Event ${current + 1} of ${steps().length}`;
    byId('order-step').textContent = step;
    byId('order-direction').textContent = event.direction;
    byId('order-event').textContent = event.title;
    showTags(byId('order-tags'), event.tags);
    byId('order-explanation').textContent = event.explanation;
    byId('order-state').textContent = event.status;

    const total = event.total ?? 100;
    const open = event.open === null ? 'Pending' : event.open;
    const closed = event.open === null ? 0 : total - event.filled - event.open;
    setStats(byId('order-quantities'), [
      ['Filled', event.filled], ['Open', open], [closed ? 'Closed unfilled' : 'Order total', closed || total],
    ]);
    const bar = byId('order-bar');
    bar.replaceChildren(...[event.filled, event.open ?? 0, closed].map((quantity) => {
      const segment = document.createElement('span');
      segment.style.setProperty('--share', `${quantity / total * 100}%`);
      segment.hidden = quantity === 0;
      return segment;
    }));

    if (announce) {
      byId('order-announcement').textContent = `${step}. ${event.title}. ${event.status}. Filled ${event.filled}. Open ${open}. ${event.explanation}`;
    }
  });
  scenario.addEventListener('change', reset);
  byId('order-lab').hidden = false;
}

const recoverySteps = [
  {
    title: 'Connection drops before the app processes 4 and 5',
    explanation: 'The app has recorded only E1. The broker had sent E2 at 4 and a heartbeat at 5.',
    connection: 'Down', expected: 4, filled: 40,
  },
  {
    title: 'Log on again and spot the gap',
    tags: 'App: 35=A|34=3|  Broker: 35=A|34=6|',
    explanation: 'The session continues its earlier numbering. The broker is at 6, while the app is still waiting for 4.',
    connection: 'Gap detected', expected: 4, filled: 40,
  },
  {
    title: 'Request the missing range',
    tags: 'App: 35=2|34=4|7=4|16=0|',
    explanation: '7 sets the starting sequence and 16=0 leaves the range open-ended. Tag 34 is the app’s independent outgoing sequence.',
    connection: 'Recovering', expected: 4, filled: 40,
  },
  {
    title: 'Apply the retransmitted fill',
    tags: 'Broker: 35=8|34=4|43=Y|122=20261124-14:30:04.000|17=E2|150=F|32=60|14=100|',
    explanation: 'The app has never applied E2, so it records the 60 shares once. The broker uses the original sequence and includes the original sending time.',
    connection: 'Recovering', expected: 5, filled: 100,
  },
  {
    title: 'Skip the heartbeat and the already received Logon',
    tags: 'Broker: 35=4|34=5|43=Y|123=Y|36=7|',
    explanation: 'The Gap Fill starts at 5 and skips both admin slots. The app expects 7 next.',
    connection: 'In sync', expected: 7, filled: 100,
  },
];

function initializeRecovery() {
  const list = byId('recovery-events');
  const rows = recoverySteps.map((event) => {
    const row = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = event.title;
    row.append(title);
    if (event.tags) {
      const tags = document.createElement('code');
      showTags(tags, event.tags);
      row.append(tags);
    }
    const explanation = document.createElement('p');
    explanation.textContent = event.explanation;
    row.append(explanation);
    return row;
  });
  list.append(...rows);

  stepControls('recovery', () => recoverySteps.length, (current, announce) => {
    const event = recoverySteps[current];
    const step = `Event ${current + 1} of ${recoverySteps.length}`;
    byId('recovery-step').textContent = step;
    setStats(byId('recovery-state'), [
      ['Session', event.connection], ['Expect broker seq.', event.expected], ['Recorded filled', `${event.filled} shares`],
    ]);
    rows.forEach((row, index) => {
      row.hidden = index > current;
      if (index === current) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
    });

    if (announce) {
      byId('recovery-announcement').textContent = `${step}. ${event.title}. Expect broker sequence ${event.expected}. Recorded filled ${event.filled}. ${event.explanation}`;
    }
  });
  byId('recovery-lab').hidden = false;
  const walkthrough = document.querySelector('.recovery-static');
  const summary = document.createElement('summary');
  summary.textContent = 'Read the complete recovery trace';
  const details = document.createElement('details');
  walkthrough.replaceWith(details);
  details.append(summary, walkthrough);
}

initializeWire();
initializeOrders();
initializeRecovery();
