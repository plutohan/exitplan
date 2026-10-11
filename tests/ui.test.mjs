import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createDemoPortfolio, defaultConstraints, planExit } from '../web/engine.mjs';

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
const kaminoFixture = await loadFixture('kamino-obligations');
const jupiterFixture = await loadFixture('jupiter-quote');
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const HL_ADDRESS = '0x3de9a354243a94e10060a198c7179b8e5393b9a1';
const EXTERNAL_HOSTS = ['api.hyperliquid.xyz', 'solana-rpc.publicnode.com', 'api.kamino.finance', 'lite-api.jup.ag'];
const external = ({ hl = hlShort, kamino = kaminoFixture, jupiter = jupiterFixture, lamports = 3_219_600_000, fail = null } = {}) => async call => {
  const target = new URL(call.url);
  if (fail && target.host === fail) return new Response('down', { status: 500 });
  if (target.host === 'api.hyperliquid.xyz') return json(JSON.parse(call.body).type === 'allMids' ? { SOL: '109.695' } : hl);
  if (target.host === 'solana-rpc.publicnode.com') return json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: lamports } });
  if (target.host === 'api.kamino.finance') return json(kamino);
  if (target.host === 'lite-api.jup.ag') return json(jupiter);
  assert.fail('unexpected external request ' + call.url);
};

async function mount(t, { aiConfigured = false, intentResponse, marketResponse, externalResponse } = {}) {
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
  install('location', { href: 'https://exitplan.example/', origin: 'https://exitplan.example' });
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
  assert.ok(ui.calls.every(call => ['/api/status', '/api/intent', '/api/market'].includes(call.path) || EXTERNAL_HOSTS.includes(call.host)), 'Only capability, intent interpretation, read-only market and public data endpoints may be contacted');
  assert.ok(ui.calls.every(call => call.path !== '/api/intent' || call.method === 'POST'));
}

test('real app initializes fixture values and reports unavailable AI honestly', async t => {
  const ui = await mount(t);
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
  assert.equal(ui.calls.filter(call => EXTERNAL_HOSTS.includes(call.host)).length, 5);
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
    if (target.pathname === '/swap/v1/swap') return json({ swapTransaction: 'AQAA' });
    if (target.host === 'solana-rpc.publicnode.com' && JSON.parse(call.body).method === 'simulateTransaction') return json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { err: null, logs: ['x', 'y'], unitsConsumed: 4242 } } });
    return base(call);
  } });
  await importPositions(ui);
  await ui.input('#target', 300);
  await ui.click('[data-plan="paired-unwind"]');
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'paired-unwind');
  await ui.click('#rehearse');
  assert.match(ui.get('#dialog-body').textContent, /Read-only rehearsal/);
  assert.ok(ui.document.querySelector('#simulate-step'), 'sell step offers a read-only simulation');
  await ui.click('#simulate-step');
  for (let i = 0; i < 60 && /Simulating/.test(ui.get('#simulation-result').textContent); i++) await flush(); // three sequential network hops
  assert.match(ui.get('#simulation-result').textContent, /Simulation succeeded/);
  assert.match(ui.get('#simulation-result').textContent, /4,242/);
  const rpcMethods = ui.calls.filter(call => call.host === 'solana-rpc.publicnode.com').map(call => JSON.parse(call.body).method);
  assert.ok(rpcMethods.includes('simulateTransaction'));
  assert.ok(!rpcMethods.includes('sendTransaction'));
  await ui.click('#rehearsal-next');
  assert.equal(Boolean(ui.document.querySelector('#simulate-step')), false);
  assert.match(ui.get('#dialog-body').textContent, /Not simulated/);
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

test('an imported snapshot older than five minutes fails closed until reloaded', async t => {
  const ui = await mount(t, { externalResponse: external() });
  await importPositions(ui);
  await ui.advance(301_000);
  await ui.input('#target', 2500);
  assert.match(ui.get('#result-banner').textContent, /older than 5 minutes/);
  assert.match(ui.get('#import-status').textContent, /older than 5 minutes/);
  assert.equal(ui.get('#rehearse').disabled, true);
  await ui.click('#load-positions');
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
