/**
 * Panel ↔ service worker aloqasi. Content script backendga o'zi murojaat
 * qilmaydi: hamma so'rov service worker orqali ketadi, token bank sahifasiga
 * tushmaydi (Separation of Concerns + xavfsizlik).
 *
 * Har bir metod `{ ok: true, data }` yoki `{ ok: false, error, message }`
 * qaytaradi — service worker bilan bir xil shakl.
 */
(function (root) {
  'use strict';

  const { RPC } = root.MunisConfig;

  async function send(type, payload = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ type, ...payload });

      return response || { ok: false, error: 'no_response', message: 'Расширение не ответило' };
    } catch (error) {
      // Extension qayta yuklangan / yangilangan bo'lsa shu yerga tushadi.
      return {
        ok: false,
        error: 'extension_unavailable',
        message: 'Расширение перезагружено — обновите страницу банка (F5)'
      };
    }
  }

  root.MunisBackend = {
    state: () => send(RPC.state),
    listBatches: () => send(RPC.listBatches),
    openBatch: (batchId) => send(RPC.openBatch, { batch_id: batchId }),
    claim: (id) => send(RPC.claim, { id }),
    release: (id) => send(RPC.release, { id }),
    report: (id, batchId, payload) => send(RPC.report, { id, batch_id: batchId, payload }),
    flushOutbox: () => send(RPC.flushOutbox),
    clearFailedReports: () => send(RPC.clearFailedReports),
    openOptions: () => send(RPC.openOptions)
  };
})(globalThis);
