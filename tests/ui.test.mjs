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

async function mount(t, { aiConfigured = false, intentResponse, marketResponse } = {}) {
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
  for (const input of document.querySelectorAll('input[type="checkbox"]')) {
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
    const call = { path: url.pathname, method: init.method ?? 'GET', body: init.body, signal: init.signal };
    calls.push(call);
    if (url.pathname === '/api/status') return json({ aiConfigured, version: '0.1.0', portfolioEvidence: 'scenario', executionEnabled: false });
    if (url.pathname === '/api/market') return marketResponse ? await marketResponse(call) : json({ error: 'Market snapshot unavailable' }, 502);
    if (url.pathname === '/api/intent') return intentResponse ? await intentResponse(call) : json({ mode: 'unavailable', error: 'AI 미연결 — 아래 조건으로 직접 비교할 수 있습니다' }, 503);
    assert.fail(`Unexpected network request: ${call.method} ${url.href}`);
  };
  install('window', window);
  install('document', document);
  install('HTMLElement', window.HTMLElement);
  install('Event', window.Event);
  install('CustomEvent', window.CustomEvent);
  install('fetch', fetchMock);
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
    if (element.type === 'checkbox') element.checked = Boolean(value);
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
  assert.ok(ui.calls.every(call => ['/api/status', '/api/intent', '/api/market'].includes(call.path)), 'Only capability, intent interpretation, and read-only market endpoints may be contacted');
  assert.ok(ui.calls.every(call => call.path !== '/api/intent' || call.method === 'POST'));
}

test('real app initializes fixture values and reports unavailable AI honestly', async t => {
  const ui = await mount(t);
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.match(ui.get('#sol-price').textContent, /100\.00/);
  assert.equal(ui.get('#ai-status').textContent, 'AI 미연결');
  assert.match(ui.get('#intent-feedback').textContent, /직접 비교/);
  assert.equal(ui.get('#rehearse').disabled, false);
  assert.equal(ui.get('.plan-card.selected').dataset.plan, planExit(createDemoPortfolio(), defaultConstraints()).best.id);
  assert.match(ui.get('#decision-content').textContent, /2,000/);
  assert.match(ui.get('.demo-label').textContent, /실제 거래 없음/);
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
  assert.match(ui.get('#route-count').textContent, /조건 충족 0 \//);
  assert.match(ui.get('#result-banner').textContent, /경로가 없어요/);
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
  assert.match(ui.get('#portfolio-caption').textContent, /순 SOL 노출 0 SOL/);
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
  assert.equal(ui.get('#route-count').textContent, `조건 충족 ${expected.feasible.length} / ${expected.plans.length}`);
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
  assert.match(ui.get('#decision-content').textContent, /현물·숏 함께 축소/);
  await ui.input('#target', 1000);
  assert.equal(ui.get('.plan-card.selected').dataset.plan, 'withdraw-lending');
  assert.match(ui.get('#decision-content').textContent, /1,000/);
  await ui.input('#target', 1000000);
  assert.equal(Boolean(ui.document.querySelector('.plan-card.selected')), false);
  assert.equal(ui.get('#rehearse').disabled, true);
  assert.match(ui.get('#decision-content').textContent, /선택 가능한 경로 없음/);
  assert.ok([...ui.document.querySelectorAll('.position-after')].every(el => el.textContent.startsWith('—')));
  const rejected = ui.get('.plan-card.rejected');
  await ui.click(rejected);
  assert.equal(ui.get('#detail-dialog').open, true);
  assert.match(ui.get('#dialog-title').textContent, /제외된 이유/);
  assert.equal(Boolean(ui.document.querySelector('.plan-card.selected')), false);
  assert.equal(ui.get('#rehearse').disabled, true);
});

test('503 intent failures do not fake AI parsing or alter constraints', async t => {
  const ui = await mount(t);
  const before = currentConstraints(ui);
  await ui.input('#intent', 'SOL은 팔지 않고 5,000달러가 필요해');
  await ui.event('#intent-form', 'submit');
  assert.equal(ui.calls.filter(call => call.path === '/api/intent').length, 1);
  assert.deepEqual(JSON.parse(ui.calls.find(call => call.path === '/api/intent').body).currentConstraints, before);
  assert.equal(ui.get('#ai-status').textContent, 'AI 미연결');
  assert.match(ui.get('#intent-feedback').textContent, /AI 미연결/);
  assert.match(ui.get('#intent-feedback').textContent, /직접 비교/);
  assert.deepEqual(currentConstraints(ui), before);
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
  assert.equal(ui.get('#intent-submit').disabled, false);
  assertNoExecutionCalls(ui);
});

function aiProposal(constraints, extra = {}) {
  return { mode: 'ai', constraints: { ...defaultConstraints(), ...constraints }, questions: [], explanation: '요청한 조건을 적용하기 전에 확인해 주세요', requiresConfirmation: true, ...extra };
}

test('AI suggestions stay proposals until confirmed and cancel preserves current controls', async t => {
  const ui = await mount(t, { aiConfigured: true, intentResponse: () => json(aiProposal({ target: 5000, preserveSolQuantity: true })) });
  assert.equal(ui.get('#ai-status').textContent, 'AI 연결됨');
  await ui.input('#intent', 'SOL을 유지하면서 5,000달러');
  await ui.event('#intent-form', 'submit');
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.match(ui.get('#intent-feedback').textContent, /이렇게 변경할까요/);
  assert.equal(ui.get('#apply-intent').disabled, false);
  await ui.click('#dismiss-intent');
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
  await ui.event('#intent-form', 'submit');
  await ui.click('#apply-intent');
  assert.equal(ui.get('#target').value, '5000');
  assert.equal(ui.get('#preserve-sol').checked, true);
  assert.equal(ui.get('#rehearse').disabled, true);
  assert.match(ui.get('#intent-feedback').textContent, /확인한 조건을 적용/);
  assertNoExecutionCalls(ui);
});

test('AI clarification cannot be applied and model text is escaped', async t => {
  const ui = await mount(t, {
    aiConfigured: true,
    intentResponse: () => json(aiProposal({ target: 5000 }, { explanation: '<img src=x onerror="alert(1)">', questions: ['대출을 허용할까요? <script>bad()</script>'] }))
  });
  await ui.input('#intent', '필요한 만큼 확보해 줘');
  await ui.event('#intent-form', 'submit');
  assert.match(ui.get('#intent-feedback').textContent, /먼저 확인이 필요/);
  assert.equal(Boolean(ui.document.querySelector('#apply-intent')), false);
  assert.equal(Boolean(ui.get('#intent-feedback').querySelector('img,script')), false);
  assert.match(ui.get('#intent-feedback').textContent, /<img/);
  assert.deepEqual(currentConstraints(ui), defaultConstraints());
});

for (const change of ['target edit', 'reset']) {
  test(`late AI response is ignored after ${change}`, async t => {
    const pending = deferred();
    const ui = await mount(t, { aiConfigured: true, intentResponse: () => pending.promise });
    await ui.input('#intent', '5,000달러가 필요해');
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
  await ui.input('#intent', '5,000달러');
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
  await ui.input('#intent', '첫 요청 5,000');
  await ui.event('#intent-form', 'submit');
  await ui.input('#target', 1000); // Invalidates the old request and permits another.
  await ui.input('#intent', '새 요청 3,000');
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
  assert.match(ui.get('#dialog-body').textContent, /가상 리허설/);
  assert.match(ui.get('#dialog-body').textContent, /변경하지 않아요/);
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
  assert.match(ui.get('#dialog-title').textContent, /리허설을 마쳤어요/);
  assert.match(ui.get('#dialog-body').textContent, /예상 순현금/);
  assert.doesNotMatch(ui.get('#dialog-body').textContent, /거래 완료|송금 완료|체결 완료|전송 완료/);
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
    assert.match(ui.get('#result-banner').textContent, /입력값을 확인/);
    assert.match(ui.get('#guide-title').textContent, /직접 조정/);
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
  assert.match(ui.get('#dialog-title').textContent, /제외된 이유/);
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
  assert.match(ui.get('#market-reference-value').textContent, /가상 계산에는 반영하지 않았어요/);
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
  assert.match(ui.get('#market-reference-value').textContent, /불러오지 못했어요/);
  assert.match(ui.get('#market-reference-value').textContent, /\$100 가정으로 유지/);
  assert.equal(ui.get('#decision-content').innerHTML, decision);
  assert.equal(ui.get('#refresh-market').disabled, false);
});
