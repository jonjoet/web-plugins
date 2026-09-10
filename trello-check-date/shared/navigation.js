import { cardUrl } from './overdue.js';

const channelPrefix = 'trello-card-navigation-';
const failureMessage = 'Could not open the card. Reopen the Power-Up and use Open in new tab.';

// The connector survives closing the modal; the modal's JavaScript does not.
// A random, modal-specific channel carries only the validated card URL, never tokens.
export async function openResultsModal(t, options) {
  if (typeof BroadcastChannel !== 'function') return t.modal(options);
  const name = channelPrefix + crypto.randomUUID();
  const channel = new BroadcastChannel(name);
  let disposed = false;
  let busy = false;
  const dispose = () => {
    if (!disposed) { disposed = true; channel.close(); }
  };
  const reply = (requestId, type) => {
    if (!disposed) channel.postMessage({ requestId, type });
  };
  channel.onmessage = async ({ data }) => {
    if (disposed || data?.type !== 'open' || typeof data.requestId !== 'string') return;
    if (busy) { reply(data.requestId, 'error'); return; }
    let url;
    try { url = cardUrl(data.url); }
    catch { reply(data.requestId, 'error'); return; }
    busy = true;
    try {
      await t.closeModal();
    } catch {
      busy = false;
      reply(data.requestId, 'error');
      return;
    }
    reply(data.requestId, 'closed');
    dispose();
    try { await t.navigate({ url }); }
    catch {
      // The modal is gone. Report recovery through Trello's own UI instead.
      try { await t.alert({ message: failureMessage, display: 'error', duration: 8 }); }
      catch { /* Trello may itself be unloading after navigation. */ }
    }
  };
  try {
    return await t.modal({ ...options,
      args: { ...options.args, navigationChannel: name },
      callback: dispose });
  } catch (error) { dispose(); throw error; }
}

export function openCardHere(t, destination) {
  const url = cardUrl(destination);
  const name = t.arg('navigationChannel');
  if (typeof name !== 'string' || !name.startsWith(channelPrefix)) {
    return Promise.reject(new Error('Navigation connector unavailable'));
  }
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(name);
    const requestId = crypto.randomUUID();
    const finish = error => {
      clearTimeout(timer);
      channel.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Navigation connector unavailable')), 10000);
    channel.onmessage = ({ data }) => {
      if (data?.requestId !== requestId) return;
      if (data.type === 'closed') finish();
      else if (data.type === 'error') finish(new Error('Navigation failed'));
    };
    channel.postMessage({ type: 'open', requestId, url });
  });
}
