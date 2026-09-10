import test from 'node:test';
import assert from 'node:assert/strict';
import { openResultsModal, openCardHere } from '../shared/navigation.js';

const url = 'https://trello.com/c/fixture';
function connector() {
  const calls = [];
  let options;
  return {
    calls,
    get options() { return options; },
    modal: async value => { options = value; },
    closeModal: async () => { calls.push('close'); },
    navigate: async value => { calls.push(value); },
    alert: async value => { calls.push(value); },
  };
}
const client = t => ({ arg: name => t.options.args[name] });

test('connector waits for modal closure before navigating and disposes its channel', async () => {
  const t = connector();
  let entered;
  const closing = new Promise(resolve => { entered = resolve; });
  let release;
  t.closeModal = () => {
    t.calls.push('close'); entered();
    return new Promise(resolve => { release = resolve; });
  };
  await openResultsModal(t, { url: 'view.html' });
  const request = openCardHere(client(t), url);
  await closing;
  assert.deepEqual(t.calls, ['close']);
  release();
  await request;
  assert.deepEqual(t.calls, ['close', { url }]);
});

test('connector independently rejects unsafe destinations before closing any UI', async () => {
  const t = connector();
  await openResultsModal(t, { url: 'view.html' });
  const channel = new BroadcastChannel(t.options.args.navigationChannel);
  try {
    const response = new Promise(resolve => { channel.onmessage = event => resolve(event.data); });
    channel.postMessage({ type: 'open', requestId: 'test', url: 'https://evil.test/c/fixture' });
    assert.deepEqual(await response, { requestId: 'test', type: 'error' });
    assert.deepEqual(t.calls, []);
    assert.throws(() => openCardHere(client(t), 'javascript:alert(1)'), { code: 'shape' });
  } finally { channel.close(); t.options.callback(); }
});

test('modal-specific channels isolate simultaneous connectors; manual dismissal does not navigate', async () => {
  const first = connector(); const second = connector();
  await openResultsModal(first, { url: 'view.html' });
  await openResultsModal(second, { url: 'view.html' });
  try {
    assert.notEqual(first.options.args.navigationChannel, second.options.args.navigationChannel);
    await openCardHere(client(first), url);
    assert.deepEqual(first.calls, ['close', { url }]);
    assert.deepEqual(second.calls, []);
    second.options.callback();
    assert.deepEqual(second.calls, []);
  } finally { first.options.callback(); second.options.callback(); }
});
