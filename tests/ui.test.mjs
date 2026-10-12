import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createDemoPortfolio, defaultConstraints, planExit, requiredMarginCents } from '../web/engine.mjs';

// Behavioral DOM integration tests, not browser or visual QA. The actual app
// module runs against its real HTML; network and elapsed time stay in-process.
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
let fixtureNumber = 0;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const json = (body, status = 200) => Response.json(body, { status });
const loadFixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const hlShort = await loadFixture('hl-sol-short');
const hlNoPosition = await loadFixture('hl-no-position');
const hlUnifiedPerps = await loadFixture('hl-unified-perps');
const hlUnifiedSpot = await loadFixture('hl-unified-spot');
const hlFunding = await loadFixture('hl-funding-history');
const hlFees = await loadFixture('hl-user-fees');
const hlBook = await loadFixture('hl-l2book');
const hlMeta = await loadFixture('hl-meta');
const FAKE_TX = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.from([0x80, 1, 2, 3])]).toString('base64');
const kaminoFixture = await loadFixture('kamino-obligations');
const jupiterFixture = await loadFixture('jupiter-quote');
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const HL_ADDRESS = '0x3de9a354243a94e10060a198c7179b8e5393b9a1';
const EXTERNAL_HOSTS = ['api.hyperliquid.xyz', 'solana-rpc.publicnode.com', 'api.kamino.finance', 'lite-api.jup.ag'];
const external = ({ hl = hlShort, kamino = kaminoFixture, jupiter = jupiterFixture, lamports = 3_219_600_000, fail = null, mode = 'disabled', spot = { balances: [] } } = {}) => async call => {
  const target = new URL(call.url);
  if (fail && target.host === fail) return new Response('down', { status: 404 }); // 404 is not retried, so the harness's faked timers never wait on the 300 ms retry pause
  if (target.host === 'api.hyperliquid.xyz') { const type = JSON.parse(call.body).type; return json(type === 'allMids' ? { SOL: '109.695' } : type === 'userAbstraction' ? mode : type === 'vaultDetails' ? null : type === 'spotClearinghouseState' ? spot : type === 'fundingHistory' ? hlFunding : type === 'userFees' ? hlFees : type === 'l2Book' ? { ...hlBook, time: Date.now() } : type === 'meta' ? hlMeta : hl); } // a fresh book: a stale one withholds the order on purpose
  if (target.host === 'solana-rpc.publicnode.com') return json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: lamports } });
  if (target.host === 'api.kamino.finance' && target.pathname.endsWith('/reserves/metrics')) return json([{ reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', totalSupply: '120702201.4', totalBorrow: '112626977.24', supplyApy: '0.0468228385' }]);
  if (target.host === 'api.kamino.finance') return json(kamino);
  if (target.host === 'lite-api.jup.ag' && target.pathname.startsWith('/ultra/v1/balances/')) return json({ SOL: { uiAmount: 3.2196 }, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { uiAmount: 336.4 } });
  if (target.host === 'lite-api.jup.ag') return json(jupiter);
  assert.fail('unexpected external request ' + call.url);
};

async function mount(t, { aiConfigured = false, intentResponse, marketResponse, externalResponse, kaminoResponse, hash = '' } = {}) {
  const { window } = parseHTML(html);
  const { document } = window;
  const calls = [];
  const timers = new Map();
  let clock = 0, timerId = 0;
  const originals = new Map();
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  // linkedom deliberately leaves browser-only form state and dialog methods to
  // the host. These shims implement only the behavior the application uses.
  for (const input of document.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
    Object.defineProperty(input, 'checked', { configurable: true, writable: true, value: input.hasAttribute('checked') });
  }
  for (const select of document.querySelectorAll('select')) {
    Object.defineProperty(select, 'value', { configurable: true, writable: true, value: select.querySelector('option[selected]')?.value ?? select.querySelector('option')?.value ?? '' });
  }
  for (const element of document.querySelectorAll('*')) {
    element.scrollIntoView = () => {};
    element.focus = () => {};
  }
  for (const dialog of document.querySelectorAll('dialog')) {
    Object.defineProperty(dialog, 'open', {
      configurable: true,
      get() { return this.hasAttribute('open'); },
      set(value) { this.toggleAttribute('open', Boolean(value)); }
    });
    dialog.showModal = function () { this.open = true; };
    dialog.close = function () {
      const wasOpen = this.open;
      this.open = false;
      if (wasOpen) this.dispatchEvent(new window.Event('close'));
    };
  }
  const schedule = (callback, delay = 0, ...args) => {
    const id = ++timerId;
    timers.set(id, { at: clock + Number(delay), callback: () => callback(...args) });
    return id;
  };
  const fetchMock = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://exitplan.example');
    const call = { url: url.href, host: url.host, path: url.pathname, method: init.method ?? 'GET', body: init.body, signal: init.signal };
    calls.push(call);
    if (url.origin !== 'https://exitplan.example') return externalResponse ? await externalResponse(call) : assert.fail(`Unexpected external request: ${url.href}`);
    if (url.pathname === '/api/status') return json({ aiConfigured, version: '0.1.0', portfolioEvidence: 'scenario', executionEnabled: false });
    if (url.pathname === '/api/market') return marketResponse ? await marketResponse(call) : json({ error: 'Market snapshot unavailable' }, 502);
    if (url.pathname === '/api/intent') return intentResponse ? await intentResponse(call) : json({ mode: 'unavailable', error: 'AI is not configured — compare with the conditions below instead' }, 503);
    if (url.pathname === '/api/kamino-withdraw') return kaminoResponse ? await kaminoResponse(call) : json({ error: 'Kamino simulation unavailable' }, 502);
    assert.fail(`Unexpected network request: ${call.method} ${url.href}`);
  };
  install('window', window);
  install('document', document);
  install('HTMLElement', window.HTMLElement);
  install('Event', window.Event);
  install('CustomEvent', window.CustomEvent);
  install('fetch', fetchMock);
  const RealDate = Date;
  const start = RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [start + clock])); }
    static now() { return start + clock; }
  }
  install('Date', FakeDate);
  install('setTimeout', schedule);
  install('clearTimeout', id => timers.delete(id));
  install('requestAnimationFrame', callback => schedule(() => callback(clock), 16));
  install('cancelAnimationFrame', id => timers.delete(id));
  install('location', { href: 'https://exitplan.example/' + hash, origin: 'https://exitplan.example', hash });
  const storage = new Map();
  install('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key), clear: () => storage.clear() });
  t.after(() => {
    timers.clear();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await import(`../web/app.mjs?ui-test=${++fixtureNumber}`);
  await flush();
  const get = selector => {
    const element = document.querySelector(selector);
    assert.ok(element, `Missing expected DOM element: ${selector}`);
    return element;
  };
  const event = async (selector, type) => {
    const element = typeof selector === 'string' ? get(selector) : selector;
    const result = element.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
    await flush();
    return result;
  };
  const click = async selector => {
    const element = typeof selector === 'string' ? get(selector) : selector;
    assert.equal(Boolean(element.disabled), false, `Cannot activate disabled button: ${element.id || element.textContent}`);
    await event(element, 'click');
  };
  const input = async (selector, value, type = 'input') => {
    const element = get(selector);
    if (element.type === 'checkbox' || element.type === 'radio') element.checked = Boolean(value);
    else element.value = String(value);
    await event(element, type);
  };
  const advance = async milliseconds => {
    const end = clock + milliseconds;
    for (let count = 0; count < 1000; count++) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { clock = end; await flush(); return; }
      const [id, timer] = next;
      timers.delete(id);
      clock = timer.at;
      timer.callback();
      await flush();
    }
    assert.fail('Timer queue did not settle');
  };
  return { window, document, calls, timers, get, event, click, input, advance };
}

function currentConstraints(ui) {
  return {
    target: Number(ui.get('#target').value),
    maxNewDebt: Number(ui.get('#max-debt').value),
    minHlBuffer: Number(ui.get('#min-buffer').value),
    preserveSolQuantity: ui.get('#preserve-sol').checked,
    preserveHedge: ui.get('#preserve-hedge').checked,
    deadlineHours: 24
  };
}

function assertNoExecutionCalls(ui) {
  assert.ok(ui.calls.every(call => ['/api/status', '/api/intent', '/api/market', '/api/kamino-withdraw'].includes(call.path) || EXTERNAL_HOSTS.includes(call.host)), 'Only capability, intent interpretation, read-only market, read-only simulation and public data endpoints may be contacted');
  assert.ok(ui.calls.every(call => call.path !== '/api/intent' || call.method === 'POST'));
}

test('real app initializes fixture values and reports unavailable AI honestly', async t => {
  const ui = await mount(t);
  assert.match(ui.document.title, /pre-flight check/i);
  assert.match(ui.get('h1').textContent, /pre-flight/i);
  assert.match(ui.document.querySelector('meta[name="description"]').getAttribute('content'), /Hyperliquid order/);
  assert.match(ui.document.querySelector('meta[property="og:title"]').getAttribute('content'), /pre-flight/i);
  assert.match(ui.get('#try-live').textContent, /Try on live accounts/);
  assert.match(ui.get('.sidebar-bottom').textContent, /Synthetic scenario/);
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.match(ui.get('#sol-price').textContent, /100\.00/);
  assert.equal(ui.get('#ai-status').textContent, 'AI offline');
  assert.match(ui.get('#intent-feedback').textContent, /adjust the conditions above directly/);
  assert.equal(ui.get('#rehearse').disabled, false);
  assert.equal(ui.get('.plan-card.selected').dataset.plan, planExit(createDemoPortfolio(), defaultConstraints()).best.id);
  assert.match(ui.get('#decision-content').textContent, /2,000/);
  assert.match(ui.get('.demo-label').textContent, /No real transactions/);
  assertNoExecutionCalls(ui);
});

test('guided scenarios make $5,000 infeasible with SOL retained and feasible after paired reductions', async t => {
  const ui = await mount(t);
  assert.equal(ui.get('#guide-count').textContent, '01 / 03');
  await ui.click('#guide-next');
  assert.equal(ui.get('#guide-count').textContent, '02 / 03');
  assert.equal(ui.get('#target').value, '5000');
  assert.equal(ui.get('#preserve-sol').checked, true);
  assert.equal(ui.get('#preserve-hedge').checked, true);
  assert.match(ui.get('#route-count').textContent, /Feasible 0 \//);
  assert.match(ui.get('#result-banner').textContent, /No route satisfies the current conditions/);
  assert.match(ui.get('#result-banner').textContent, /4,498\.75/);
  assert.equal(Boolean(ui.document.querySelector('.plan-card.selected')), false);
  assert.equal(ui.get('#rehearse').disabled, true);
  await ui.click('#guide-next');
  assert.equal(ui.get('#guide-count').textContent, '03 / 03');
  assert.equal(ui.get('#preserve-sol').checked, false);
  assert.equal(ui.get('#preserve-hedge').checked, true);
  const expected = planExit(createDemoPortfolio(), currentConstraints(ui));
  assert.ok(expected.best.solSold > 0);
  assert.equal(expected.best.solSold, expected.best.shortReduced);
  assert.equal(ui.get('.plan-card.selected').dataset.plan, expected.best.id);
  assert.equal(ui.get('#rehearse').disabled, false);
  assert.match(ui.get('#decision-content').textContent, /5,000/);
  assert.match(ui.get('#portfolio-caption').textContent, /Net SOL exposure 0 SOL/);
  await ui.click('#guide-next');
  assert.equal(ui.get('#guide-count').textContent, '01 / 03');
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assertNoExecutionCalls(ui);
});

test('manual target and all constraint controls recalculate from current values, then reset fully', async t => {
  const ui = await mount(t);
  await ui.click('[data-target="5000"]');
  assert.equal(ui.get('#target').value, '5000');
  await ui.input('#preserve-sol', true, 'change');
  assert.equal(ui.get('#rehearse').disabled, true);
  await ui.input('#max-debt', 1000, 'change');
  assert.equal(ui.get('#rehearse').disabled, false);
  let expected = planExit(createDemoPortfolio(), currentConstraints(ui));
  assert.ok(expected.best.newDebt > 0);
  assert.equal(ui.get('.plan-card.selected').dataset.plan, expected.best.id);
  await ui.input('#preserve-hedge', false, 'change');
  await ui.input('#min-buffer', 2000);
  await ui.input('#target', 6000);
  assert.deepEqual(currentConstraints(ui), { target: 6000, maxNewDebt: 1000, preserveHedge: false, preserveSolQuantity: true, minHlBuffer: 2000, deadlineHours: 24 });
  expected = planExit(createDemoPortfolio(), currentConstraints(ui));
  assert.equal(ui.get('#route-count').textContent, `Feasible ${expected.feasible.length} / ${expected.plans.length}`);
  assert.equal(Boolean(ui.document.querySelector('[data-target].selected')), false);
  await ui.input('#intent', 'Keep this only until reset');
  await ui.click('.reset-all');
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.equal(ui.get('#intent').value, '');
  assert.equal(ui.get('#guide-count').textContent, '01 / 03');
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'withdraw-lending');
  assertNoExecutionCalls(ui);
});

test('selection is replaced after input changes and removed when no feasible route remains', async t => {
  const ui = await mount(t);
  await ui.click('[data-plan="paired-unwind"]');
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'paired-unwind');
  assert.match(ui.get('#decision-content').textContent, /Trim spot and short together/);
  await ui.input('#target', 1000);
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'withdraw-lending');
  assert.match(ui.get('#decision-content').textContent, /1,000/);
  await ui.input('#target', 1000000);
  assert.equal(Boolean(ui.document.querySelector('.plan-card.selected')), false);
  assert.equal(ui.get('#rehearse').disabled, true);
  assert.match(ui.get('#decision-content').textContent, /No selectable route/);
  assert.ok([...ui.document.querySelectorAll('.position-after')].every(el => el.textContent.startsWith('—')));
  const rejected = ui.get('.plan-card.rejected');
  await ui.click(rejected);
  assert.equal(ui.get('#detail-dialog').open, true);
  assert.match(ui.get('#dialog-title').textContent, /Why this route was excluded/);
  assert.equal(Boolean(ui.document.querySelector('.plan-card.selected')), false);
  assert.equal(ui.get('#rehearse').disabled, true);
});

test('503 intent failures do not fake AI parsing or alter constraints', async t => {
  const ui = await mount(t);
  const before = currentConstraints(ui);
  await ui.input('#intent', 'I need $5,000 without selling SOL');
  await ui.event('#intent-form', 'submit');
  assert.equal(ui.calls.filter(call => call.path === '/api/intent').length, 1);
  assert.deepEqual(JSON.parse(ui.calls.find(call => call.path === '/api/intent').body).currentConstraints, before);
  assert.equal(ui.get('#ai-status').textContent, 'AI offline');
  assert.match(ui.get('#intent-feedback').textContent, /AI offline/);
  assert.match(ui.get('#intent-feedback').textContent, /adjust the conditions above directly/);
  assert.deepEqual(currentConstraints(ui), before);
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
  assert.equal(ui.get('#intent-submit').disabled, false);
  assertNoExecutionCalls(ui);
});

function aiProposal(constraints, extra = {}) {
  return { mode: 'ai', constraints: { ...defaultConstraints(), ...constraints }, questions: [], explanation: 'Please confirm before applying', requiresConfirmation: true, ...extra };
}

test('AI suggestions stay proposals until confirmed and cancel preserves current controls', async t => {
  const ui = await mount(t, { aiConfigured: true, intentResponse: () => json(aiProposal({ target: 5000, preserveSolQuantity: true })) });
  assert.equal(ui.get('#ai-status').textContent, 'AI connected');
  await ui.input('#intent', 'Keep SOL and raise $5,000');
  await ui.event('#intent-form', 'submit');
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.match(ui.get('#intent-feedback').textContent, /Apply these changes\?/);
  assert.equal(ui.get('#apply-intent').disabled, false);
  await ui.click('#dismiss-intent');
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
  await ui.event('#intent-form', 'submit');
  await ui.click('#apply-intent');
  assert.equal(ui.get('#target').value, '5000');
  assert.equal(ui.get('#preserve-sol').checked, true);
  assert.equal(ui.get('#rehearse').disabled, true);
  assert.match(ui.get('#intent-feedback').textContent, /Applied the confirmed conditions/);
  assertNoExecutionCalls(ui);
});

test('AI clarification cannot be applied and model text is escaped', async t => {
  const ui = await mount(t, {
    aiConfigured: true,
    intentResponse: () => json(aiProposal({ target: 5000 }, { explanation: '<img src=x onerror="alert(1)">', questions: ['Allow borrowing? <script>bad()</script>'] }))
  });
  await ui.input('#intent', 'Raise whatever is needed');
  await ui.event('#intent-form', 'submit');
  assert.match(ui.get('#intent-feedback').textContent, /Needs confirmation first/);
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
  assert.equal(Boolean(ui.get('#intent-feedback').querySelector('img,script')), false);
  assert.match(ui.get('#intent-feedback').textContent, /<img/);
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
});

for (const change of ['target edit', 'reset']) {
  test(`late AI response is ignored after ${change}`, async t => {
    const pending = deferred();
    const ui = await mount(t, { aiConfigured: true, intentResponse: () => pending.promise });
    await ui.input('#intent', 'I need $5,000');
    await ui.event('#intent-form', 'submit');
    assert.equal(ui.get('#intent-submit').disabled, true);
    if (change === 'reset') await ui.click('.reset-all');
    else await ui.input('#target', 1000);
    const afterChange = currentConstraints(ui);
    const feedback = ui.get('#intent-feedback').textContent;
    pending.resolve(json(aiProposal({ target: 5000 })));
    await flush();
    assert.deepEqual(currentConstraints(ui), afterChange);
    assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
    assert.equal(ui.get('#intent-feedback').textContent, feedback);
    assert.equal(ui.get('#intent-submit').disabled, false);
    assertNoExecutionCalls(ui);
  });
}

test('AI result is also ignored when controls change while the response body is decoding', async t => {
  const body = deferred();
  let decoding = false;
  const ui = await mount(t, {
    aiConfigured: true,
    intentResponse: () => ({ ok: true, status: 200, json: () => { decoding = true; return body.promise; } })
  });
  await ui.input('#intent', '$5,000');
  await ui.event('#intent-form', 'submit');
  assert.equal(decoding, true);
  await ui.input('#target', 1000);
  const feedback = ui.get('#intent-feedback').textContent;
  body.resolve(aiProposal({ target: 5000 }));
  await flush();
  assert.equal(ui.get('#target').value, '1000');
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false, 'A decoded stale body must not render a stale proposal');
  assert.equal(ui.get('#intent-feedback').textContent, feedback);
});

test('newer AI request wins even if an older response arrives last', async t => {
  const first = deferred(), second = deferred();
  let count = 0;
  const ui = await mount(t, { aiConfigured: true, intentResponse: () => (++count === 1 ? first.promise : second.promise) });
  await ui.input('#intent', 'first request 5,000');
  await ui.event('#intent-form', 'submit');
  await ui.input('#target', 1000); // Invalidates the old request and permits another.
  await ui.input('#intent', 'new request 3,000');
  await ui.event('#intent-form', 'submit');
  second.resolve(json(aiProposal({ target: 3000 })));
  await flush();
  assert.ok(ui.document.querySelector('#apply-intent'));
  const newestFeedback = ui.get('#intent-feedback').textContent;
  first.resolve(json(aiProposal({ target: 5000 })));
  await flush();
  assert.equal(ui.get('#intent-feedback').textContent, newestFeedback);
  await ui.click('#apply-intent');
  assert.equal(ui.get('#target').value, '3000');
});

test('rehearsal requires explicit steps, can be cancelled and replayed, and never executes', async t => {
  const ui = await mount(t);
  await ui.click('[data-plan="paired-unwind"]');
  const positions = ui.get('#position-cards').innerHTML;
  const decision = ui.get('#decision-content').innerHTML;
  await ui.click('#rehearse');
  assert.equal(ui.get('#detail-dialog').open, true);
  assert.equal(ui.document.querySelectorAll('.rehearsal-step').length, 2);
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0);
  assert.match(ui.get('#dialog-body').textContent, /Synthetic rehearsal/);
  assert.match(ui.get('#dialog-body').textContent, /does not change/);
  await ui.advance(60000);
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0, 'Time passing alone must not simulate completed execution');
  await ui.click('#rehearsal-next');
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 1);
  await ui.click('#rehearsal-reset');
  assert.equal(ui.get('#detail-dialog').open, false);
  assert.equal(ui.get('#position-cards').innerHTML, positions);
  await ui.click('#rehearse');
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0);
  await ui.click('#rehearsal-next');
  await ui.click('#rehearsal-next');
  assert.match(ui.get('#dialog-title').textContent, /Rehearsal complete/);
  assert.match(ui.get('#dialog-body').textContent, /Expected net cash/);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /executed|transferred|sent|filled/i);
  assert.equal(ui.get('#position-cards').innerHTML, positions);
  assert.equal(ui.get('#decision-content').innerHTML, decision);
  await ui.click('#rehearsal-reset');
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0);
  await ui.click('#close-dialog');
  assert.equal(ui.get('#detail-dialog').open, false);
  assertNoExecutionCalls(ui);
  assert.equal(ui.calls.length, 1, 'Rehearsing must not call an execution or wallet endpoint');
});

test('native cancel, edited constraints, and reset all discard in-progress rehearsals', async t => {
  const ui = await mount(t);
  await ui.click('[data-plan="paired-unwind"]');
  await ui.click('#rehearse');
  await ui.click('#rehearsal-next');
  const defaultAllowed = await ui.event('#detail-dialog', 'cancel');
  if (defaultAllowed) ui.get('#detail-dialog').close(); // Browser default Escape action.
  assert.equal(ui.get('#detail-dialog').open, false);
  await ui.click('#rehearse');
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0);
  await ui.input('#target', 5000);
  assert.equal(ui.get('#detail-dialog').open, false);
  await ui.click('#rehearse');
  assert.match(ui.get('#dialog-body').textContent, /5,000/);
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0);
  await ui.click('#rehearsal-next');
  await ui.click('.reset-all');
  assert.equal(ui.get('#detail-dialog').open, false);
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  await ui.advance(60000);
  assert.equal(ui.get('#detail-dialog').open, false);
  await ui.click('#rehearse');
  assert.match(ui.get('#dialog-body').textContent, /2,000/);
  assert.equal(ui.document.querySelectorAll('.rehearsal-step.done').length, 0);
  assertNoExecutionCalls(ui);
});

for (const [selector, value] of [['#target', ''], ['#target', -1], ['#target', 'not-a-number'], ['#min-buffer', ''], ['#min-buffer', -1]]) {
  test(`invalid input ${selector}=${JSON.stringify(value)} clears stale selection and fails closed`, async t => {
    const ui = await mount(t);
    await ui.input(selector, value);
    assert.equal(Boolean(ui.document.querySelector('.plan-card.selected')), false);
    assert.equal(ui.get('#rehearse').disabled, true);
    assert.match(ui.get('#result-banner').textContent, /Check your inputs/);
    assert.match(ui.get('#guide-title').textContent, /Comparing your adjusted conditions/);
    await ui.click('.reset-all');
    assert.deepEqual(currentConstraints(ui), defaultConstraints());
    assert.equal(ui.get('#rehearse').disabled, false);
  });
}

test('keyboard activation selects a valid route and opens rejected-route reasons', async t => {
  const ui = await mount(t);
  const activate = async element => {
    const event = new ui.window.Event('keydown', { bubbles: true, cancelable: true });
    event.key = 'Enter';
    element.dispatchEvent(event);
    await flush();
    assert.equal(event.defaultPrevented, true);
  };
  await activate(ui.get('[data-plan="paired-unwind"]'));
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'paired-unwind');
  await ui.click('#guide-next');
  await activate(ui.get('.plan-card.rejected'));
  assert.equal(ui.get('#detail-dialog').open, true);
  assert.match(ui.get('#dialog-title').textContent, /Why this route was excluded/);
  assert.equal(ui.get('#rehearse').disabled, true);
});

test('public market reference is fetched only on click and never reprices the synthetic scenario', async t => {
  const ui = await mount(t, {
    marketResponse: () => json({ evidence: 'live-market', solUsd: 177.25, observedAt: '2026-10-11T12:00:00Z', executable: false })
  });
  const decision = ui.get('#decision-content').innerHTML;
  const positions = ui.get('#position-cards').innerHTML;
  assert.equal(ui.calls.some(call => call.path === '/api/market'), false);
  await ui.click('#refresh-market');
  assert.equal(ui.calls.filter(call => call.path === '/api/market').length, 1);
  assert.match(ui.get('#market-reference-value').textContent, /177\.25/);
  assert.match(ui.get('#market-reference-value').textContent, /the synthetic scenario was not repriced/);
  assert.equal(ui.get('#sol-price').textContent, 'SOL $100.00');
  assert.equal(ui.get('#decision-content').innerHTML, decision);
  assert.equal(ui.get('#position-cards').innerHTML, positions);
  assert.equal(ui.get('#refresh-market').disabled, false);
  assertNoExecutionCalls(ui);
});

test('market lookup failure remains honest and does not change plans', async t => {
  const ui = await mount(t);
  const decision = ui.get('#decision-content').innerHTML;
  await ui.click('#refresh-market');
  assert.match(ui.get('#market-reference-value').textContent, /Public market price unavailable/);
  assert.match(ui.get('#market-reference-value').textContent, /still assumes SOL \$100/);
  assert.equal(ui.get('#decision-content').innerHTML, decision);
  assert.equal(ui.get('#refresh-market').disabled, false);
});

async function importPositions(ui) {
  await ui.input('#source-import', true, 'change');
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), false);
  await ui.input('#solana-address', WALLET);
  await ui.input('#hl-address', HL_ADDRESS);
  await ui.click('#load-positions');
}

test('import by address loads both venues, labels plans IMPORTED and uses the quote price', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), true);
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  assert.match(ui.get('#sol-price').textContent, /111\.88/);
  assert.ok(ui.get('.evidence-badge').textContent.startsWith('IMPORTED'));
  assert.match(ui.get('.demo-label').textContent, /Imported/);
  assert.match(ui.get('.demo-label').textContent, /No real transactions/);
  assert.equal(ui.get('#load-positions').disabled, false);
  assert.equal(ui.calls.filter(call => EXTERNAL_HOSTS.includes(call.host)).length, 13); // balance, Kamino obligations, Kamino reserve metrics, quote, wallet balances, clearinghouse, mids, account mode, vault check, spot balances, funding history, user fees, meta
  assert.match(ui.get('#import-status').textContent, /\$336\.40 in wallet/);
  assertNoExecutionCalls(ui);
});

test('import failure keeps the scenario and shows the reason', async t => {
  const ui = await mount(t, { externalResponse: external({ fail: 'solana-rpc.publicnode.com' }) });
  const plans = ui.get('#plans').innerHTML;
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /Could not load positions/);
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.equal(ui.get('#sol-price').textContent, 'SOL $100.00');
  assert.equal(ui.get('#plans').innerHTML, plans);
  assert.equal(ui.get('#load-positions').disabled, false);
});

test('import with debt shows the engine error and keeps the scenario', async t => {
  const kamino = structuredClone(kaminoFixture);
  kamino[0].state.borrows[0].borrowReserve = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
  kamino[0].refreshedStats.userTotalBorrow = '100';
  const ui = await mount(t, { externalResponse: external({ kamino }) });
  const plans = ui.get('#plans').innerHTML;
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /Existing lending debt/);
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.equal(ui.get('#plans').innerHTML, plans);
});

test('late import response is ignored after reset', async t => {
  const pending = deferred();
  const ui = await mount(t, { externalResponse: call => pending.promise.then(respond => respond(call)) });
  await importPositions(ui);
  assert.equal(ui.get('#load-positions').disabled, true);
  await ui.click('.reset-all');
  pending.resolve(external());
  await flush(); await flush();
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.doesNotMatch(ui.get('#import-status').textContent, /Loaded/);
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), true);
  assert.equal(ui.get('#load-positions').disabled, false);
});

test('switching back to the scenario restores fixture values', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  assert.match(ui.get('#sol-price').textContent, /111\.88/);
  await ui.input('#source-scenario', true, 'change');
  assert.equal(ui.get('#sol-price').textContent, 'SOL $100.00');
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), true);
});

test('imported rehearsal simulates the sell leg read-only and other steps are labelled not simulated', async t => {
  const base = external();
  const ui = await mount(t, { externalResponse: async call => {
    const target = new URL(call.url);
    if (target.pathname === '/swap/v1/swap') return json({ swapTransaction: FAKE_TX });
    if (target.host === 'solana-rpc.publicnode.com' && JSON.parse(call.body).method === 'simulateTransaction') return json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { err: null, logs: ['x', 'y'], unitsConsumed: 4242 } } });
    return base(call);
  } });
  await importPositions(ui);
  await ui.input('#target', 500); // above the $336.40 already in the wallet, so a sale leg is needed
  await ui.click('[data-plan="paired-unwind"]');
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'paired-unwind');
  await ui.click('#rehearse');
  assert.match(ui.get('#dialog-body').textContent, /Read-only rehearsal/);
  assert.match(ui.get('#dialog-body').textContent, /Nothing to simulate: USDC is already in the wallet/);
  await ui.click('#rehearsal-next'); // past the wallet step
  assert.match(ui.get('#simulate-step').textContent, /Preview fill on the Hyperliquid book/);
  await ui.click('#simulate-step');
  for (let i = 0; i < 20 && /Reading/.test(ui.get('#simulation-result').textContent); i++) await flush();
  assert.match(ui.get('#simulation-result').textContent, /Book preview/);
  assert.match(ui.get('#simulation-result').textContent, /average \$111\.09/);
  assert.match(ui.get('#simulation-result').textContent, /taker fee/);
  assert.match(ui.get('#simulation-result').textContent, /no order placed/);
  assert.match(ui.get('#simulation-result').textContent, /cost vs plan/);
  assert.match(ui.get('#simulation-result').textContent, /vs 10 bps allowance/);
  assert.match(ui.get('#simulation-result').textContent, /book age/);
  const order = ui.get('#order-preview').textContent;
  assert.match(order, /"a":5/);
  assert.match(order, /"r":true/);
  assert.match(order, /"tif":"Ioc"/);
  assert.match(order, /unsigned/i);
  assert.ok(!ui.calls.some(call => call.host === 'api.hyperliquid.xyz' && /\/exchange/.test(call.url)), 'the preview never touches the exchange endpoint');
  await ui.click('#rehearsal-next'); // past the short reduction, which now comes before the sale
  assert.ok(ui.document.querySelector('#simulate-step'), 'sell step offers a read-only simulation');
  await ui.click('#simulate-step');
  for (let i = 0; i < 60 && /Simulating/.test(ui.get('#simulation-result').textContent); i++) await flush(); // three sequential network hops
  assert.match(ui.get('#simulation-result').textContent, /Simulation succeeded/);
  assert.match(ui.get('#simulation-result').textContent, /4,242/);
  assert.match(ui.get('#simulation-result').textContent, /plan estimate \$/);
  assert.match(ui.get('#inspector-link').getAttribute('href'), /^https:\/\/explorer\.solana\.com\/tx\/inspector\?message=/);
  assert.equal(ui.get('#inspector-link').getAttribute('target'), '_blank');
  await ui.click('#copy-tx');
  assert.match(ui.get('#toast').textContent, /Unsigned transaction/);
  const rpcMethods = ui.calls.filter(call => call.host === 'solana-rpc.publicnode.com').map(call => JSON.parse(call.body).method);
  assert.ok(rpcMethods.includes('simulateTransaction'));
  assert.ok(!rpcMethods.includes('sendTransaction'));
  await ui.click('#rehearsal-next');
  assert.equal(Boolean(ui.document.querySelector('#simulate-step')), false);
  assertNoExecutionCalls(ui);
});

test('scenario rehearsal never offers a simulation', async t => {
  const ui = await mount(t);
  await ui.click('[data-plan="paired-unwind"]');
  await ui.click('#rehearse');
  assert.equal(Boolean(ui.document.querySelector('#simulate-step')), false);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /Not simulated/);
});

test('switching to the scenario mid-load discards the late import', async t => {
  const pending = deferred();
  const ui = await mount(t, { externalResponse: call => pending.promise.then(respond => respond(call)) });
  await importPositions(ui);
  await ui.input('#source-scenario', true, 'change');
  pending.resolve(external());
  await flush(); await flush();
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.equal(ui.get('#sol-price').textContent, 'SOL $100.00');
  assert.doesNotMatch(ui.get('#import-status').textContent, /Loaded/);
});

test('editing a constraint mid-load cancels the import with a clear status', async t => {
  const pending = deferred();
  const ui = await mount(t, { externalResponse: call => pending.promise.then(respond => respond(call)) });
  await importPositions(ui);
  await ui.input('#target', 1000);
  pending.resolve(external());
  await flush(); await flush();
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.match(ui.get('#import-status').textContent, /cancelled/i);
  assert.doesNotMatch(ui.get('#import-status').textContent, /Loading/);
  assert.equal(ui.get('#load-positions').disabled, false);
});

test('the guided scenario strip is hidden while imported positions are shown', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('.guide').hasAttribute('hidden'), false);
  await importPositions(ui);
  assert.equal(ui.get('.guide').hasAttribute('hidden'), true);
  await ui.input('#source-scenario', true, 'change');
  assert.equal(ui.get('.guide').hasAttribute('hidden'), false);
});

test('the hedge switch is labelled as net exposure, not a ratio', async t => {
  const ui = await mount(t, { aiConfigured: true, intentResponse: () => json(aiProposal({ preserveHedge: false })) });
  assert.equal(ui.get('#preserve-hedge').getAttribute('aria-label'), 'Keep net SOL exposure');
  assert.equal(ui.get('#preserve-hedge').closest('.constraint-row').querySelector('strong').textContent, 'Keep net SOL exposure');
  await ui.input('#intent', 'Let the exposure change');
  await ui.event('#intent-form', 'submit');
  assert.match(ui.get('#intent-feedback').textContent, /Keep net SOL exposure: on → off/);
});

test('an imported snapshot older than five minutes reloads itself once instead of blocking', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  const loads = () => ui.calls.filter(call => call.host === 'api.hyperliquid.xyz' && JSON.parse(call.body).type === 'clearinghouseState').length;
  assert.equal(loads(), 1);
  await ui.advance(301_000);
  await ui.input('#target', 2500);
  await flush(); await flush();
  assert.equal(loads(), 2, 'a stale snapshot triggers one automatic reload');
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  assert.doesNotMatch(ui.get('#result-banner').textContent, /older than/);
  assert.equal(ui.get('#rehearse').disabled, false);
});

test('changing an address mid-load discards the stale result', async t => {
  const pending = deferred();
  const ui = await mount(t, { externalResponse: call => pending.promise.then(respond => respond(call)) });
  await importPositions(ui);
  await ui.input('#hl-address', '0x' + 'b'.repeat(40));
  pending.resolve(external());
  await flush(); await flush();
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  assert.match(ui.get('#import-status').textContent, /addresses changed/i);
  assert.equal(ui.get('#load-positions').disabled, false);
});

test('exposure caption compares the route with the imported starting exposure', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  assert.match(ui.get('#portfolio-caption').textContent, /unchanged/);
  assert.doesNotMatch(ui.get('#portfolio-caption').textContent, /exposure to price moves changes/);
});

test('a portfolio-margin Hyperliquid account is rejected with the reason and the scenario stays', async t => {
  const ui = await mount(t, { externalResponse: external({ mode: 'portfolioMargin' }) });
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /Could not load positions: .*portfolioMargin/);
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
});

test('an empty or wrong Hyperliquid address is flagged instead of importing silently as zeros', async t => {
  const hl = structuredClone(hlNoPosition);
  hl.marginSummary.accountValue = '0'; hl.withdrawable = '0';
  const ui = await mount(t, { externalResponse: external({ hl }) });
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /no SOL position and no equity/);
  assert.match(ui.get('#import-status').textContent, /Phantom/);
  assert.match(ui.get('#hl-address').getAttribute('placeholder'), /Phantom/);
});

test('importing an account under the margin floor never changes the floor; it explains and keeps Solana routes', async t => {
  const hl = structuredClone(hlShort);
  const sol = hl.assetPositions.find(a => a.position.coin === 'SOL').position;
  const locked = hl.assetPositions.filter(a => a.position.coin !== 'SOL').reduce((sum, a) => sum + Number(a.position.marginUsed), 0);
  const reserve = requiredMarginCents(-Number(sol.szi), 109.7, 0.1) / 100;
  hl.marginSummary.accountValue = String(locked + reserve + 800);
  hl.withdrawable = '0';
  const ui = await mount(t, { externalResponse: external({ hl }) });
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  assert.equal(Number(ui.get('#min-buffer').value), 1500, 'the user\'s floor must not be mutated');
  assert.match(ui.get('#import-status').textContent, /under your \$1,500 floor/);
  assert.ok(ui.document.querySelector('.plan-card.selected'), 'a Kamino-only route must stay selectable under the HL floor');
});

test('imported copy never claims a 1:1 ratio, a synthetic walkthrough or an offsetting hedge that is not there', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  assert.match(ui.get('#position-cards').textContent, /Net short [\d,.]+ SOL overall/);
  assert.match(ui.get('#import-status').textContent, /net exposure/);
  await ui.click('#open-evidence');
  const body = ui.get('#dialog-body').textContent;
  assert.doesNotMatch(body, /\b1:1\b/) // word-bounded: a timestamp like 21:10 must not trip it;
  assert.doesNotMatch(body, /walkthrough only/);
  assert.match(body, /Starting net exposure/);
});

test('a deep link pre-fills both addresses and the target and loads positions', async t => {
  const ui = await mount(t, { externalResponse: external(), hash: `#sol=${WALLET}&hl=${HL_ADDRESS}&target=500` });
  await flush(); await flush();
  assert.equal(ui.get('#solana-address').value, WALLET);
  assert.equal(ui.get('#hl-address').value, HL_ADDRESS);
  assert.equal(ui.get('#target').value, '500');
  assert.ok(ui.get('.evidence-badge').textContent.startsWith('IMPORTED'));
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), true, 'after the load the inputs fold into the summary bar');
  assert.equal(ui.get('#source-summary').hasAttribute('hidden'), false);
});

test('the example button fills the public addresses and loads; copy link builds a deep link', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await ui.click('#load-example');
  assert.match(ui.get('#solana-address').value, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.match(ui.get('#hl-address').value, /^0x[0-9a-fA-F]{40}$/);
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  await ui.click('#share-link');
  assert.match(ui.get('#toast').textContent, /#sol=/);
  assert.match(ui.get('#toast').textContent, /&target=2000/);
});

test('when no route fits, the banner offers concrete relaxations that work', async t => {
  const ui = await mount(t);
  await ui.click('#guide-next'); // $5,000 with keep-SOL: no route
  assert.match(ui.get('#result-banner').textContent, /No route/);
  const suggestion = [...ui.document.querySelectorAll('[data-suggestion]')].find(el => /Allow selling SOL/.test(el.textContent));
  assert.ok(suggestion, 'a keep-SOL relaxation must be offered');
  assert.match(suggestion.textContent, /\$5,000/);
  await ui.click(suggestion);
  assert.equal(ui.get('#preserve-sol').checked, false);
  assert.ok(ui.document.querySelector('.plan-card.selected'));
  assert.equal(ui.get('#rehearse').disabled, false);
});

test('imported positions show the exchange liquidation price and an estimate after the selected route', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  assert.match(ui.get('#position-cards').textContent, /HL · liquidation price/);
  assert.match(ui.get('#position-cards').textContent, /267/);
  await ui.input('#target', 500);
  await ui.click('[data-plan="paired-unwind"]');
  assert.match(ui.get('#position-cards').textContent, /estimate/);
  assert.match(ui.get('#position-cards').textContent, /SOL only; other positions held constant/);
});

test('wallet connect works with Phantom or OKX and says so when no wallet is present', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.match(ui.get('#connect-phantom').textContent, /Connect wallet/);
  await ui.click('#connect-phantom');
  assert.match(ui.get('#toast').textContent, /No wallet detected/);
  ui.window.okxwallet = {
    solana: { connect: async () => ({ publicKey: { toString: () => WALLET } }) },
    request: async ({ method }) => (method === 'eth_requestAccounts' ? [HL_ADDRESS] : null),
  };
  await ui.click('#connect-phantom');
  await flush(); await flush();
  assert.equal(ui.get('#solana-address').value, WALLET);
  assert.equal(ui.get('#hl-address').value, HL_ADDRESS);
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  delete ui.window.okxwallet;
  await ui.click('.reset-all');
  ui.window.phantom = {
    solana: { connect: async () => ({ publicKey: { toString: () => WALLET } }) },
    ethereum: { request: async ({ method }) => (method === 'eth_requestAccounts' ? [HL_ADDRESS] : null) },
  };
  await ui.click('#connect-phantom');
  await flush(); await flush();
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  assertNoExecutionCalls(ui);
});

test('a close-short route is named honestly and its short step is not called paired', async t => {
  const ui = await mount(t);
  await ui.click('[data-target="5000"]');
  await ui.input('#preserve-sol', true, 'change');
  await ui.input('#preserve-hedge', false, 'change');
  const card = [...ui.document.querySelectorAll('.plan-card')].find(el => /Reduce short/.test(el.textContent));
  assert.ok(card, 'a reduce-short route card is displayed');
  assert.match(card.textContent, /released margin/);
  await ui.click(card);
  await ui.click('#rehearse');
  assert.match(ui.get('#dialog-body').textContent, /Reduce SOL short/);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /same amount/);
});

test('both addresses are validated before any network call', async t => {
  const ui = await mount(t, { externalResponse: () => assert.fail('must not call any API with an invalid address') });
  await ui.input('#source-import', true, 'change');
  await ui.input('#solana-address', 'not-an-address');
  await ui.input('#hl-address', HL_ADDRESS);
  await ui.click('#load-positions');
  assert.match(ui.get('#import-status').textContent, /Solana wallet address/);
  await ui.input('#solana-address', WALLET);
  await ui.input('#hl-address', '0x12');
  await ui.click('#load-positions');
  assert.match(ui.get('#import-status').textContent, /Hyperliquid address/);
  assert.equal(ui.calls.filter(call => EXTERNAL_HOSTS.includes(call.host)).length, 0);
});

test('the plan link carries every constraint and a link restores them', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  await ui.input('#target', 700);
  await ui.input('#preserve-sol', true, 'change');
  await ui.click('#share-link');
  const link = ui.get('#toast').textContent.match(/https?:\S+/)[0];
  assert.match(link, /target=700/);
  assert.match(link, /preserveSolQuantity=true/);
  assert.match(link, /maxNewDebt=0/);
  const restored = await mount(t, { externalResponse: external(), hash: link.slice(link.indexOf('#')) });
  await flush(); await flush();
  assert.equal(restored.get('#target').value, '700');
  assert.equal(restored.get('#preserve-sol').checked, true);
  assert.ok(restored.get('.evidence-badge').textContent.startsWith('IMPORTED'));
});

test('a deep link pasted into an already open tab is applied on hashchange', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('.evidence-badge').textContent, 'SCENARIO');
  globalThis.location.hash = `#sol=${WALLET}&hl=${HL_ADDRESS}&target=900`;
  ui.window.dispatchEvent(new ui.window.Event('hashchange'));
  await flush(); await flush();
  assert.equal(ui.get('#target').value, '900');
  assert.ok(ui.get('.evidence-badge').textContent.startsWith('IMPORTED'));
});

test('displayed route cards never repeat the same outcome, and untouched HL buffers show no rounding drift', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  await ui.input('#target', 2000);
  const cards = [...ui.document.querySelectorAll('.plan-card')].map(card => card.querySelector('.plan-description').textContent + '|' + card.querySelector('.plan-cash').textContent);
  assert.equal(new Set(cards).size, cards.length, 'route cards must differ in outcome: ' + cards.join(' || '));
  assert.equal(ui.get('.plan-card.selected').dataset.plan.startsWith('hybrid-lending') || ui.get('.plan-card.selected').dataset.plan === 'withdraw-lending', true);
  const buffer = [...ui.document.querySelectorAll('.position-card')].find(card => /margin buffer/.test(card.textContent));
  assert.equal(buffer.querySelector('.position-before').textContent, buffer.querySelector('.position-after').textContent.replace(/[A-Z]+$/, ''));
});

test('the page ships an inline icon so browsers do not request a missing favicon', async t => {
  const ui = await mount(t);
  const icon = ui.document.querySelector('link[rel="icon"]');
  assert.ok(icon, 'link[rel=icon] present');
  assert.match(icon.getAttribute('href'), /^data:image\/svg\+xml/);
});

test('imported rehearsal simulates the Kamino withdrawal through the server function', async t => {
  const ui = await mount(t, { externalResponse: external(), kaminoResponse: call => { const body = JSON.parse(call.body); assert.equal(body.wallet, WALLET); assert.ok(body.amountUsdc > 0); return json({ ok: true, error: null, unitsConsumed: 112573, logCount: 38, instructions: ['RefreshReserve[r]', 'RefreshObligation[o]', 'withdrawV2'], amountUsdc: body.amountUsdc, deliveredUsdc: body.amountUsdc, transactionBase64: FAKE_TX }); } });
  await importPositions(ui);
  await ui.input('#target', 2000); // wallet USDC + Kamino withdrawal
  assert.equal(ui.get('.plan-card.selected').dataset.plan.includes('lending') || ui.get('.plan-card.selected').dataset.plan === 'withdraw-lending', true);
  await ui.click('#rehearse');
  await ui.click('#rehearsal-next'); // past the wallet step
  assert.match(ui.get('#dialog-body').textContent, /Withdraw deposited USDC/);
  const button = ui.get('#simulate-step');
  assert.match(button.textContent, /Kamino/);
  await ui.click(button);
  for (let i = 0; i < 60 && /Simulating/.test(ui.get('#simulation-result').textContent); i++) await flush();
  assert.match(ui.get('#simulation-result').textContent, /Simulation succeeded/);
  assert.match(ui.get('#simulation-result').textContent, /112,573/);
  assert.match(ui.get('#simulation-result').textContent, /withdrawV2/);
  assert.match(ui.get('#simulation-result').textContent, /would deliver \$1,663\.60 \(plan \$1,663\.60\)/);
  assert.match(ui.get('#inspector-link').getAttribute('href'), /explorer\.solana\.com\/tx\/inspector\?message=/);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /withdrawal transaction is not built/);
  assertNoExecutionCalls(ui);
});

test('imported copy is honest about provenance, HL delivery and large sales', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.match(ui.get('#load-example').textContent, /unrelated/);
  await importPositions(ui);
  await ui.input('#target', 2000);
  const rejected = ui.get('.plan-card.rejected');
  await ui.click(rejected);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /synthetic portfolio/);
  assert.match(ui.get('#dialog-body').textContent, /imported snapshot/);
  await ui.click('#close-dialog');
  await ui.click('#open-evidence');
  const evidence = ui.get('#dialog-body').textContent;
  assert.doesNotMatch(evidence, /Not supported: wallet connection/);
  assert.match(evidence, /not a CCTP quote/);
  assert.match(evidence, /priced from a 1 SOL Jupiter quote/);
  await ui.click('#close-dialog');
  const hlCard = [...ui.document.querySelectorAll('.plan-card')].find(card => /Withdraw free HL collateral/.test(card.textContent));
  assert.ok(hlCard, 'an HL transfer route is displayed at $2,000');
  assert.match(hlCard.textContent, /delivery fee not verified/);
});

test('a Kamino simulation that delivers less than the plan is flagged, and imported Kamino withdrawals carry no model fee', async t => {
  const ui = await mount(t, { externalResponse: external(), kaminoResponse: call => json({ ok: true, error: null, unitsConsumed: 1000, logCount: 3, instructions: ['withdrawV2'], amountUsdc: JSON.parse(call.body).amountUsdc, deliveredUsdc: 1000 }) });
  await importPositions(ui);
  await ui.input('#target', 2000);
  assert.match(ui.get('.plan-card.selected').textContent, /Fees \$0\.00/);
  await ui.click('#rehearse');
  await ui.click('#rehearsal-next');
  await ui.click('#simulate-step');
  for (let i = 0; i < 60 && /Simulating/.test(ui.get('#simulation-result').textContent); i++) await flush();
  assert.match(ui.get('#simulation-result').textContent, /short of the plan/);
  assert.ok(ui.get('#simulation-result').classList.contains('error'));
});

test('the pre-flight readout appears only for imported positions and grades each check', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('#preflight').hasAttribute('hidden'), true, 'hidden in the synthetic scenario');
  await importPositions(ui);
  assert.equal(ui.get('#preflight').hasAttribute('hidden'), true, 'the check list stays collapsed behind the summary line');
  assert.equal(ui.get('#preflight-bar').hasAttribute('hidden'), false);
  assert.match(ui.get('#preflight-summary').textContent, /\d+ ok · \d+ warning/);
  await ui.click('#preflight-toggle');
  assert.equal(ui.get('#preflight').hasAttribute('hidden'), false);
  const items = [...ui.document.querySelectorAll('#preflight-items li')];
  const text = key => items.find(li => new RegExp(key).test(li.textContent));
  assert.ok(text('Account mode').classList.contains('ok'), 'standard account passes');
  assert.match(text('Account mode').textContent, /standard/);
  assert.ok(text('Net exposure').classList.contains('warn'), 'a net short of 88 SOL is flagged, not hidden');
  assert.match(text('Net exposure').textContent, /-88\.1 SOL/);
  assert.match(text('Liquidation').textContent, /\$267/);
  assert.match(text('Liquidation').textContent, /other positions' prices hold/);
  assert.match(text('HL margin buffer').textContent, /model buffer/i);
  assert.match(text('Kamino liquidity').textContent, /pool cash/);
  assert.match(text('Kamino liquidity').textContent, /\$8,075,224/);
  assert.ok(text('Kamino liquidity').classList.contains('ok'));
  assert.match(text('Wallet USDC').textContent, /\$336\.40/);
  assert.match(text('Not simulated').textContent, /Hyperliquid/);
  await ui.input('#source-scenario', true, 'change');
  assert.equal(ui.get('#preflight').hasAttribute('hidden'), true);
});

test('the pre-flight readout warns when the HL buffer is under the floor and when the account mode is only reported as default', async t => {
  const hl = structuredClone(hlShort);
  const sol = hl.assetPositions.find(a => a.position.coin === 'SOL').position;
  const locked = hl.assetPositions.filter(a => a.position.coin !== 'SOL').reduce((sum, a) => sum + Number(a.position.marginUsed), 0);
  const reserve = requiredMarginCents(-Number(sol.szi), Math.round((Number(sol.positionValue) / Math.abs(Number(sol.szi))) * 100) / 100, 0.1) / 100;
  hl.marginSummary.accountValue = String(locked + reserve + 800);
  hl.withdrawable = '0';
  const ui = await mount(t, { externalResponse: external({ hl, mode: 'default' }) });
  await importPositions(ui);
  const items = [...ui.document.querySelectorAll('#preflight-items li')];
  const text = key => items.find(li => new RegExp(key).test(li.textContent));
  assert.ok(text('HL margin buffer').classList.contains('warn'));
  assert.match(text('HL margin buffer').textContent, /under your \$1,500 floor/);
  assert.match(text('HL margin buffer').textContent, /non-HL routes are evaluated separately/);
  assert.ok(text('Account mode').classList.contains('warn'), 'an inferred mode is never graded as a pass');
  assert.match(text('Account mode').textContent, /default/);
  assert.match(text('Account mode').textContent, /standard layout/);
  assert.match(text('Account mode').textContent, /confirm/i);
});

test('a unified Hyperliquid account imports and the pre-flight readout says so', async t => {
  const ui = await mount(t, { externalResponse: external({ hl: hlUnifiedPerps, mode: 'unifiedAccount', spot: hlUnifiedSpot }) });
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  const item = [...ui.document.querySelectorAll('#preflight-items li')].find(li => /Account mode/.test(li.textContent));
  assert.ok(item.classList.contains('ok'));
  assert.match(item.textContent, /unified/i);
  assert.match(item.textContent, /spot USDC/);
});

test('the pre-flight readout flags a mark at or past the liquidation price and a short that cannot be withdrawn from without reducing it', async t => {
  const hl = structuredClone(hlShort);
  const sol = hl.assetPositions.find(a => a.position.coin === 'SOL').position;
  sol.liquidationPx = '100';
  const ui = await mount(t, { externalResponse: external({ hl }) });
  await importPositions(ui);
  const items = [...ui.document.querySelectorAll('#preflight-items li')];
  const liq = items.find(li => /Liquidation/.test(li.textContent));
  assert.ok(liq.classList.contains('warn'));
  assert.match(liq.textContent, /at or past liquidation/);
  assert.doesNotMatch(liq.textContent, /\+-/);
});

test('a unified account with USDC but no SOL short gets the empty-position hint, and SOL held on HyperCore spot is called out', async t => {
  const spot = { balances: [{ coin: 'USDC', token: 0, total: '500', hold: '0', entryNtl: '0' }, { coin: 'USOL', token: 200, total: '4', hold: '0', entryNtl: '400' }], tokenToAvailableAfterMaintenance: [[0, '500']] };
  const ui = await mount(t, { externalResponse: external({ hl: hlNoPosition, mode: 'unifiedAccount', spot }) });
  await importPositions(ui);
  assert.match(ui.get('#import-status').textContent, /no SOL position/);
  const exposure = [...ui.document.querySelectorAll('#preflight-items li')].find(li => /Net exposure/.test(li.textContent));
  assert.match(exposure.textContent, /4 USOL/);
});

test('plan cards show the yearly carry each route gives up, in the scenario and after an import', async t => {
  const ui = await mount(t, { externalResponse: external() });
  const best = ui.get('.plan-card');
  assert.match(best.textContent, /Carry given up/);
  assert.match(best.textContent, /\$100\.01\/yr/);
  await importPositions(ui);
  const cards = [...ui.document.querySelectorAll('.plan-card')];
  assert.ok(cards.some(card => /Carry given up/.test(card.textContent) && /\/yr/.test(card.textContent)), 'imported routes carry a figure');
  const carry = [...ui.document.querySelectorAll('#preflight-items li')].find(li => /^Carry/.test(li.textContent.trim()));
  assert.ok(carry, 'readout has a carry item');
  assert.match(carry.textContent, /funding/);
  assert.match(carry.textContent, /4\.68% APY/);
  assert.match(carry.textContent, /7-day average/);
});

test('the pre-flight readout follows constraint edits instead of going stale', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  const item = () => [...ui.document.querySelectorAll('#preflight-items li')].find(li => /HL margin buffer/.test(li.textContent));
  assert.ok(item().classList.contains('ok'));
  await ui.input('#min-buffer', 100000);
  assert.ok(item().classList.contains('warn'), 'raising the floor above the buffer flips the item');
  assert.match(item().textContent, /under your \$100,000 floor/);
  await ui.input('#min-buffer', 1500);
  assert.ok(item().classList.contains('ok'));
});

test('a failed unified cross-check marks the account-mode item as a warning', async t => {
  const spot = structuredClone(hlUnifiedSpot);
  spot.tokenToAvailableAfterMaintenance = [[0, '50000']];
  const ui = await mount(t, { externalResponse: external({ hl: hlUnifiedPerps, mode: 'unifiedAccount', spot }) });
  await importPositions(ui);
  const item = [...ui.document.querySelectorAll('#preflight-items li')].find(li => /Account mode/.test(li.textContent));
  assert.ok(item.classList.contains('warn'));
  assert.match(item.textContent, /other perp DEXs/);
});

test('the readout names the reserve rate actually applied to the short', async t => {
  const hl = structuredClone(hlShort);
  const sol = hl.assetPositions.find(a => a.position.coin === 'SOL').position;
  sol.leverage.value = 5; sol.marginUsed = String(Number(sol.positionValue) / 5);
  const ui = await mount(t, { externalResponse: external({ hl }) });
  await importPositions(ui);
  const item = [...ui.document.querySelectorAll('#preflight-items li')].find(li => /HL margin buffer/.test(li.textContent));
  assert.match(item.textContent, /20% reserve/);
});

test('imported routes use the account taker rate for the short-reduction fee and the evidence dialog says so', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  await ui.click('#open-evidence');
  assert.match(ui.get('#dialog-body').textContent, /short reduction 0\.04%/);
  assert.match(ui.get('#dialog-body').textContent, /your Hyperliquid taker rate/);
  assert.match(ui.get('#dialog-body').textContent, /0\.01 SOL lots/);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /assumed 10% reserve/);
});

test('the pre-flight report is a plain-text document with checks, routes, the selected route and the deep link', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('#copy-report').hasAttribute('hidden') || ui.get('#preflight').hasAttribute('hidden'), true, 'no report before an import');
  await importPositions(ui);
  await ui.input('#target', 500);
  await ui.click('[data-plan="paired-unwind"]');
  await ui.click('#copy-report');
  const text = ui.get('#report-text').value;
  assert.match(text, /^# ExitPlan pre-flight report/);
  assert.match(text, /Read-only\. Nothing was signed or sent/);
  assert.match(text, /Solana wallet .*DrED/);
  assert.match(text, /Account mode: ok/);
  assert.match(text, /Net exposure: warn/);
  assert.match(text, /## Routes/);
  assert.match(text, /\[selected\] .*Trim spot and short together — net \$50\d\.\d\d/); // lot-sized sale nets at or just above the target
  assert.match(text, /carry given up/);
  assert.match(text, /## Rejected routes/);
  assert.match(text, /#sol=DrED/);
  assert.match(text, /target=500/);
  assert.match(text, /Not financial advice/);
  assert.match(ui.get('#toast').textContent, /Report (copied|ready)/);
});

test('the hero button loads the public example without touching the source radio first, and the chrome stops calling it a demo', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await ui.click('#try-live');
  for (let i = 0; i < 40 && !/Loaded|Could not/.test(ui.get('#import-status').textContent); i++) await flush();
  assert.equal(ui.get('#source-import').checked, true);
  assert.match(ui.get('#import-status').textContent, /Loaded/);
  assert.match(ui.get('.sidebar-bottom').textContent, /Imported positions/);
  assert.doesNotMatch(ui.get('.sidebar-bottom').textContent, /Demo workspace/);
  assert.match(ui.get('#market-reference-value').textContent, /reference only/);
  assert.doesNotMatch(ui.get('#market-reference-value').textContent, /synthetic scenario/);
  if (ui.window.history?.replaceState) assert.match(String(ui.window.location.hash), /sol=/);
});

test('while a simulation is pending the rehearsal cannot advance, so a late answer cannot land on another step', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const base = external();
  const ui = await mount(t, { externalResponse: async call => {
    if (call.host === 'api.hyperliquid.xyz' && JSON.parse(call.body).type === 'l2Book') { await pending; return json({ ...hlBook, time: Date.now() }); }
    return base(call);
  } });
  await importPositions(ui);
  await ui.input('#target', 500);
  await ui.click('[data-plan="paired-unwind"]');
  await ui.click('#rehearse');
  await ui.click('#rehearsal-next'); // wallet step reviewed → short reduction is current
  await ui.click('#simulate-step');
  await flush();
  assert.match(ui.get('#simulation-result').textContent, /Reading the Hyperliquid book/);
  assert.equal(ui.get('#rehearsal-next').disabled, true, 'Next is locked while a simulation is pending');
  assert.equal(ui.get('#simulate-step').disabled, true);
  release();
  for (let i = 0; i < 20 && /Reading/.test(ui.get('#simulation-result').textContent); i++) await flush();
  assert.match(ui.get('#simulation-result').textContent, /Book preview/);
  assert.equal(ui.get('#rehearsal-next').disabled, false);
  assert.match(ui.get('.rehearsal-step.current').textContent, /Reduce SOL short/);
});

test('a default account with no equity is flagged as not establishable, and the evidence dialog lists the slippage allowance', async t => {
  const empty = structuredClone(hlNoPosition); empty.marginSummary.accountValue = '0.0'; empty.withdrawable = '0.0';
  const ui = await mount(t, { externalResponse: external({ hl: empty, mode: 'default' }) });
  await importPositions(ui);
  const item = [...ui.document.querySelectorAll('#preflight-items li')].find(li => /Account mode/.test(li.textContent));
  assert.ok(item.classList.contains('warn'));
  assert.match(item.textContent, /could not be established/);
  await ui.click('#open-evidence');
  assert.match(ui.get('#dialog-body').textContent, /slippage allowance 0\.10%/);
});

test('the hero button lands on a $500 target with the paired route selected, one click from the Hyperliquid rehearsal', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await ui.click('#try-live');
  for (let i = 0; i < 40 && !/Loaded|Could not/.test(ui.get('#import-status').textContent); i++) await flush();
  await flush();
  assert.equal(ui.get('#target').value, '500');
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'paired-unwind');
  assert.match(ui.get('#decision-content').textContent, /Trim spot and short together/);
});

test('the floor suggestion never proposes a floor the buffer cannot meet', async t => {
  const hl = structuredClone(hlShort);
  const sol = hl.assetPositions.find(a => a.position.coin === 'SOL').position;
  const locked = hl.assetPositions.filter(a => a.position.coin !== 'SOL').reduce((sum, a) => sum + Math.max(Number(a.position.marginUsed), 0.1 * Number(a.position.positionValue)), 0);
  const reserve = requiredMarginCents(-Number(sol.szi), Math.round((Number(sol.positionValue) / Math.abs(Number(sol.szi))) * 100) / 100, 0.1) / 100;
  hl.marginSummary.accountValue = String(locked + reserve + 800);
  hl.withdrawable = '0';
  const ui = await mount(t, { externalResponse: external({ hl }) });
  await importPositions(ui);
  await ui.input('#min-buffer', 2000);
  await ui.input('#target', 50000); // nothing fits, so the banner offers relaxations
  const labels = [...ui.document.querySelectorAll('[data-suggestion]')].map(b => b.textContent);
  const floor = labels.find(l => /Lower the margin floor/.test(l));
  if (floor) assert.match(floor, /Lower the margin floor to \$(7\d\d|800)\b/, `half the floor would be $1,000, above the $800 buffer: ${floor}`);
});

test('a deep link that changes the address while a rehearsal is open closes it before the new import starts', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  await ui.input('#target', 500);
  await ui.click('[data-plan="paired-unwind"]');
  await ui.click('#rehearse');
  assert.match(ui.get('#dialog-body').textContent, /Read-only rehearsal/);
  ui.window.location.hash = '#sol=8mgVs81Psuz72TAPjjz1KAjLbefUPxh73Qo4JkfcVu4x&hl=0x3796bF467561B61a21e0B523894E44B8Ae5c6516&target=500';
  ui.window.dispatchEvent(new ui.window.Event('hashchange'));
  assert.equal(ui.document.querySelector('.rehearsal-step'), null, 'the rehearsal of the old account is gone before the new import starts');
  assert.equal(ui.get('#solana-address').value, '8mgVs81Psuz72TAPjjz1KAjLbefUPxh73Qo4JkfcVu4x');
});

test('the position summary strip shows the numbers that matter at a glance, with meters and the check summary', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('#summary').hasAttribute('hidden'), false, 'the scenario has a summary too');
  assert.match(ui.get('[data-kpi="sol"]').textContent, /100 SOL/);
  assert.equal(ui.get('#preflight-bar').hasAttribute('hidden'), true, 'no checks for a synthetic scenario');
  await importPositions(ui);
  const kpi = key => ui.get(`[data-kpi="${key}"]`);
  assert.match(kpi('sol').textContent, /3\.22 SOL/);
  assert.match(kpi('short').textContent, /91\.32 SOL/);
  assert.match(kpi('net').textContent, /-88\.1 SOL/);
  assert.ok(kpi('net').classList.contains('warn'));
  assert.match(kpi('buffer').textContent, /\$5,4\d\d/);
  assert.match(kpi('buffer').textContent, /floor \$1,500/);
  const meter = kpi('buffer').querySelector('.meter > span');
  assert.ok(meter && /width:\s*\d+(\.\d+)?%/.test(meter.getAttribute('style')), 'buffer meter has a width');
  assert.match(kpi('liquidation').textContent, /\$267/);
  assert.match(kpi('liquidation').textContent, /1\d\d% away/);
  assert.match(kpi('kamino').textContent, /\$9,607/);
  assert.match(kpi('wallet').textContent, /\$336\.40/);
  assert.match(ui.get('#preflight-summary').textContent, /ok · 1 warning/);
  assert.match(ui.get('#preflight-warnings').textContent, /Net exposure/);
  await ui.input('#min-buffer', 100000);
  assert.match(ui.get('#preflight-summary').textContent, /2 warnings/);
  assert.ok(kpi('buffer').classList.contains('warn'), 'the buffer tile turns to a warning when it sits under the floor');
});

test('after a load the address panel collapses to a one-line summary with a Change button, and the step headers read 1·2·3', async t => {
  const ui = await mount(t, { externalResponse: external() });
  assert.equal(ui.get('#source-summary').hasAttribute('hidden'), true, 'nothing to summarise before a load');
  await importPositions(ui);
  assert.equal(ui.get('#source-summary').hasAttribute('hidden'), false);
  assert.match(ui.get('#source-summary').textContent, /DrED…tZsK/);
  assert.match(ui.get('#source-summary').textContent, /0x3de9…b9a1/);
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), true, 'the inputs fold away once positions are loaded');
  await ui.click('#source-change');
  assert.equal(ui.get('#import-row').hasAttribute('hidden'), false);
  assert.match(ui.get('.goal-panel .step-number').textContent, /^1$/);
  assert.match(ui.get('.results-panel .step-number').textContent, /^2$/);
  assert.match(ui.get('.decision-panel .step-number').textContent, /^3$/);
  assert.ok(ui.document.querySelector('.decision-panel').compareDocumentPosition(ui.document.querySelector('#portfolio')) & 4, 'the selected-route step comes before the before/after cards');
});

test('route cards show the steps as chips and the numbers as pills', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  await ui.input('#target', 500);
  const card = ui.document.querySelector('[data-plan="paired-unwind"]');
  const chips = [...card.querySelectorAll('.step-chip')];
  assert.equal(chips.length, 3, 'wallet, reduce short, sell SOL');
  assert.match(chips[1].textContent, /Hyperliquid/);
  assert.match(chips[1].textContent, /SOL/);
  assert.ok(card.querySelector('.pill[data-stat="fees"]'));
  assert.ok(card.querySelector('.pill[data-stat="carry"]'));
  assert.match(card.querySelector('.plan-cash').textContent, /\$50\d/);
});
