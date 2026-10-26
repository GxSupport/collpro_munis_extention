/**
 * Status hisobotlarining chiqish navbati (kontrakt §4).
 *
 * NEGA KERAK: "Оплатить" bosilib, pul bankdan chiqib ketgandan keyin
 * `POST /items/{id}/status` yuborilmay qolsa, CollPro'da qator "в очереди"
 * bo'lib turadi va boshqa operator uni yana to'lashi mumkin. Shuning uchun
 * hisobot tarmoqqa emas, avval **diskka** yoziladi (chrome.storage.local) va
 * yuborilgunicha o'chirilmaydi — brauzer yopilsa yoki service worker o'lsa ham
 * saqlanadi.
 *
 * `event_id` bir marta yaratiladi va qayta urinishlarda o'zgarmaydi — backend
 * uni unikal kalit sifatida ishlatadi, shuning uchun bir hisobot ikki marta
 * qo'llanmaydi (idempotentlik).
 *
 * Tartib muhim: `submitting` → `paid` ketma-ketligi buzilsa backend
 * `409 invalid_transition` beradi, shuning uchun navbat FIFO va birinchi
 * "qayta urinish kerak" xatosida to'xtaydi.
 *
 * IKKI XIL SERIALIZATSIYA, ikkisi ham kerak:
 *   `mutate()` — storage'ni o'qib-yozishni navbatga soladi. Busiz drain o'zi
 *                o'qigan eski nusxani qaytarib yozib, shu orada qo'shilgan
 *                hisobotni o'chirib tashlaydi (lost update).
 *   `drain()`  — yuborishlarni navbatga soladi, shuning uchun chaqiruvchi
 *                o'z navbatining haqiqiy natijasini oladi.
 */
(function (root) {
  'use strict';

  const { STORAGE, RETRY_DELAYS_MS, OUTBOX_ALARM } = root.MunisConfig;
  const api = root.MunisApi;

  /** Shundan keyin qayta urinmaymiz — hisobot "не принято"ga o'tadi. */
  const MAX_ATTEMPTS = 20;

  /** Bu xatolarda navbat to'xtaydi: sabab yo'qolmaguncha urinish behuda. */
  const BLOCKING = ['unauthenticated', 'no_api_base', 'no_permission', 'operator_blocked'];

  const EMPTY = { entries: [], failed: [], blocked: null };

  async function read() {
    const stored = await chrome.storage.local.get(STORAGE.outbox);

    return { ...EMPTY, ...(stored[STORAGE.outbox] || {}) };
  }

  // ── Storage mutex ───────────────────────────────────────────────────

  let mutations = Promise.resolve();

  /**
   * Holatni o'qiydi, `change(state)`ni qo'llaydi va qaytarib yozadi — hammasi
   * navbat bilan, tarmoq kutmasdan (ichida fetch chaqirilmaydi).
   *
   * @param {(state: object) => *} change
   * @return {Promise<*>} `change` qaytargan qiymat
   */
  function mutate(change) {
    const run = mutations.then(async () => {
      const state = await read();
      const value = change(state);
      await chrome.storage.local.set({ [STORAGE.outbox]: state });

      return value;
    });

    mutations = run.then(() => {}, () => {});

    return run;
  }

  // ── Navbatga qo'yish ────────────────────────────────────────────────

  /**
   * Hisobotni navbatga qo'yadi va yuborishga urinadi.
   * Chaqiruvchi tarmoqni kutib turmaydi — status mahalliy allaqachon yozilgan.
   */
  async function enqueue(itemId, batchId, payload) {
    const pending = await mutate((state) => {
      state.entries.push({
        event_id: crypto.randomUUID(),
        item_id: Number(itemId),
        batch_id: batchId,
        payload,
        attempts: 0,
        next_attempt_at: 0,
        last_error: null,
        created_at: new Date().toISOString()
      });

      return state.entries.length;
    });

    await chrome.alarms.create(OUTBOX_ALARM.name, OUTBOX_ALARM.info);

    // Yuborishni kutmaymiz: panel bloklanmasligi kerak.
    drain();

    return { queued: pending };
  }

  // ── Yuborish ────────────────────────────────────────────────────────

  /** Navbatning boshidagi yuborishga tayyor hisobot (FIFO) yoki null. */
  function takeNext(state) {
    const first = state.entries[0];
    state.blocked = null;

    if (!first) return null;
    if (first.next_attempt_at && Date.now() < first.next_attempt_at) return null;

    return { ...first };
  }

  /**
   * Yuborish natijasini holatga qo'llaydi.
   *
   * @return {boolean} navbatni to'xtatish kerakmi
   */
  function applyResult(state, entry, result) {
    const index = state.entries.findIndex((item) => item.event_id === entry.event_id);
    if (index === -1) return false;

    if (result.ok) {
      state.entries.splice(index, 1);

      return false;
    }

    const current = state.entries[index];
    current.attempts++;
    current.last_error = result.message;

    if (BLOCKING.includes(result.error)) {
      // Login kutiladi yoki sozlama yo'q — navbat joyida qoladi.
      state.blocked = result.error;

      return true;
    }

    if (result.retryable && current.attempts < MAX_ATTEMPTS) {
      const wait = result.retryAfterMs
        || RETRY_DELAYS_MS[Math.min(current.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      current.next_attempt_at = Date.now() + wait;

      return true;
    }

    // Backend bu hisobotni qabul qilmaydi (409/422/404) yoki urinishlar tugadi —
    // operator ko'rishi uchun ajratib qo'yamiz, navbat to'xtamaydi.
    state.failed.push({ ...current, failed_at: new Date().toISOString() });
    state.entries.splice(index, 1);

    return false;
  }

  async function runDrain() {
    let sent = 0;

    try {
      for (;;) {
        const entry = await mutate(takeNext);
        if (!entry) break;

        const result = await api.reportStatus(entry.item_id, { ...entry.payload, event_id: entry.event_id });
        const stop = await mutate((state) => applyResult(state, entry, result));

        if (result.ok) sent++;
        if (stop) break;
      }

      const state = await read();
      if (!state.entries.length) await chrome.alarms.clear(OUTBOX_ALARM.name);

      return { sent, pending: state.entries.length, blocked: state.blocked };
    } catch (error) {
      console.error('[munis] outbox drain', error);

      return { sent, pending: null, blocked: null, error: error.message };
    }
  }

  let drains = Promise.resolve();

  /**
   * Navbatni ketma-ket yuboradi. Bir vaqtda bitta drain ishlaydi, qolganlari
   * navbatda turadi — shuning uchun `await drain()` o'z urinishining natijasini
   * qaytaradi, boshqasining emas.
   */
  function drain() {
    const run = drains.then(runDrain, runDrain);
    drains = run.then(() => {}, () => {});

    return run;
  }

  // ── Holat ───────────────────────────────────────────────────────────

  /** Panel uchun: yuborilmagan qatorlar id'lari ("Обновить" ularga tegmaydi). */
  async function pendingItemIds() {
    const state = await read();

    return [...new Set(state.entries.map((entry) => entry.item_id))];
  }

  async function summary() {
    const state = await read();

    return {
      pending: state.entries.length,
      pending_ids: [...new Set(state.entries.map((entry) => entry.item_id))],
      failed: state.failed.length,
      blocked: state.blocked,
      last_error: state.entries.length ? state.entries[0].last_error : null
    };
  }

  /** "Не принято" ro'yxatini tozalash (operator ko'rib chiqqandan keyin). */
  function clearFailed() {
    return mutate((state) => {
      state.failed = [];
    });
  }

  root.MunisOutbox = { enqueue, drain, pendingItemIds, summary, clearFailed };
})(globalThis);
