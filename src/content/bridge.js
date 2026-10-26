/**
 * Isolated world ↔ MAIN world (zk-driver.js) aloqasi, window.postMessage orqali.
 *
 * call(cmd, args) — javobni Promise bilan qaytaradi.
 * on(event, fn)   — driver event'lariga obuna (form-state, pay-click, dialog...).
 */
(function (root) {
  'use strict';

  const { MSG, TIMEOUTS } = root.MunisConfig;

  const pending = new Map();
  const listeners = new Map();
  let seq = 0;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== MSG.fromPage) return;

    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.ok) resolve(msg.result);
      else reject(Object.assign(new Error(msg.error), { available: msg.available }));
      return;
    }

    if (msg.event) {
      for (const fn of listeners.get(msg.event) || []) fn(msg.data);
    }
  });

  function call(cmd, args = {}, timeoutMs = TIMEOUTS.rpcMs) {
    const id = `${Date.now()}-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Нет ответа от страницы (${cmd})`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ source: MSG.toPage, id, cmd, args }, window.location.origin);
    });
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
  }

  root.MunisBridge = { call, on };
})(globalThis);
