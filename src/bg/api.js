/**
 * CollPro API klienti — faqat service worker ichida ishlaydi.
 *
 * Nega bank sahifasidan emas: token e-bank sahifasiga tushmasligi kerak (u yerda
 * bankning o'z JS'i ishlaydi) va so'rovlar extension origin'idan ketgani uchun
 * CORS kerak emas (kontrakt §0).
 *
 * Javob shakli hamma joyda bir xil (Fail Fast, chaqiruvchi shart tekshiradi):
 *   muvaffaqiyat → { ok: true, data }
 *   xato         → { ok: false, status, error, message, retryable }
 */
(function (root) {
  'use strict';

  const { STORAGE, API, TIMEOUTS, RETRY_DELAYS_MS, normalizeApiBase } = root.MunisConfig;

  // ── Sozlama va token ────────────────────────────────────────────────

  async function getSettings() {
    const stored = await chrome.storage.local.get(STORAGE.settings);
    return stored[STORAGE.settings] || { apiBase: '' };
  }

  /** Server manzilini saqlaydi (tekshiruv — MunisConfig.normalizeApiBase). */
  async function setApiBase(rawBase) {
    const base = normalizeApiBase(rawBase);

    await chrome.storage.local.set({ [STORAGE.settings]: { apiBase: base } });

    return base;
  }

  async function getAuth() {
    const stored = await chrome.storage.local.get(STORAGE.auth);
    return stored[STORAGE.auth] || { token: null, operator: null };
  }

  async function setAuth(token, operator) {
    await chrome.storage.local.set({ [STORAGE.auth]: { token, operator } });
  }

  /**
   * Tokenni o'chiradi. `onlyIfToken` berilsa — faqat saqlangan token aynan
   * o'sha bo'lsa.
   *
   * NEGA: 401 javobi kechikib kelishi mumkin. Shu orada operator qaytadan
   * kirgan bo'lsa, shartsiz o'chirish uning YANGI tokenini o'chirib tashlaydi
   * va ish yana to'xtaydi (compare-and-clear).
   */
  async function clearAuth(onlyIfToken = null) {
    if (onlyIfToken) {
      const { token } = await getAuth();
      if (token && token !== onlyIfToken) return;
    }

    await chrome.storage.local.remove(STORAGE.auth);
  }

  /** Foydalanuvchi shu manzilga so'rov yuborishga ruxsat berganmi (MV3). */
  async function hasHostPermission(apiBase) {
    if (!apiBase) return false;
    return chrome.permissions.contains({ origins: [`${apiBase}/*`] });
  }

  // ── So'rov ──────────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fail(status, error, message, retryable = false) {
    return { ok: false, status, error, message, retryable };
  }

  /** Kontrakt §0 xato jadvali → bizning ichki shaklga. */
  function mapHttpError(status, body, retryAfter) {
    const error = (body && body.error) || null;
    const message = (body && body.message) || null;

    if (status === 401) {
      return fail(401, error || 'unauthenticated', message || 'Сессия истекла, войдите заново');
    }
    if (status === 403) {
      return fail(403, error || 'forbidden', message || 'Доступ запрещён');
    }
    if (status === 404) {
      return fail(404, error || 'not_found', message || 'Не найдено');
    }
    if (status === 409) {
      return fail(409, error || 'conflict', message || 'Статус платежа изменился');
    }
    if (status === 422) {
      const fields = body && body.errors ? Object.values(body.errors).flat().join('; ') : null;
      return fail(422, error || 'validation_failed', message || fields || 'Данные не приняты сервером');
    }
    if (status === 429) {
      const wait = Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : null;
      return { ...fail(429, error || 'too_many_requests', message || 'Слишком много запросов', true), retryAfterMs: wait };
    }

    return fail(status, error || 'server_error', message || `Сервер ответил ${status}`, status >= 500);
  }

  /**
   * Bitta urinish. `retries` — 5xx/429/tarmoq uzilishida qayta urinish soni
   * (kontrakt §0: 1, 2, 4, 8, 16 s).
   *
   * @param {{method?: string, body?: object, auth?: boolean, retries?: number}} options
   */
  async function request(path, options = {}) {
    const { method = 'GET', body = null, auth = true, retries = 0 } = options;
    const { apiBase } = await getSettings();

    if (!apiBase) return fail(0, 'no_api_base', 'Не указан адрес сервера — откройте настройки расширения');
    if (!(await hasHostPermission(apiBase))) {
      return fail(0, 'no_permission', 'Нет разрешения на доступ к серверу — откройте настройки расширения');
    }

    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json; charset=utf-8';

    let usedToken = null;
    if (auth) {
      const { token } = await getAuth();
      if (!token) return fail(401, 'unauthenticated', 'Вы не вошли — нажмите значок расширения и войдите');
      usedToken = token;
      headers.Authorization = `Bearer ${token}`;
    }

    const url = `${apiBase}${API.prefix}${path}`;
    let last = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const wait = last && last.retryAfterMs ? last.retryAfterMs : RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        await sleep(wait);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUTS.apiMs);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store'
        });

        const text = await response.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch (e) {
          parsed = null;
        }

        if (response.ok && parsed && parsed.ok) return { ok: true, data: parsed };

        if (response.ok) {
          // 200, lekin kontrakt shakli emas — proxy yoki login sahifasi qaytardi.
          last = fail(response.status, 'bad_response', 'Сервер вернул неожиданный ответ — проверьте адрес в настройках');
        } else {
          last = mapHttpError(response.status, parsed, response.headers.get('Retry-After'));
        }

        if (last.status === 401) await clearAuth(usedToken);
        if (!last.retryable) return last;
      } catch (error) {
        last = fail(
          0,
          error.name === 'AbortError' ? 'timeout' : 'network_error',
          error.name === 'AbortError' ? 'Сервер не ответил вовремя' : 'Нет связи с сервером CollPro',
          true
        );
      } finally {
        clearTimeout(timer);
      }
    }

    return last;
  }

  // ── Kontrakt endpoint'lari ──────────────────────────────────────────

  async function login(credentials) {
    const result = await request(API.login, { method: 'POST', body: credentials, auth: false, retries: 1 });
    if (!result.ok) return result;

    await setAuth(result.data.token, result.data.operator);

    return { ok: true, data: { operator: result.data.operator } };
  }

  async function me() {
    return request(API.me, { retries: 1 });
  }

  async function logout() {
    await clearAuth();
    return { ok: true, data: {} };
  }

  const listBatches = () => request(`${API.batches}?status=open`, { retries: 2 });
  const showBatch = (batchId) => request(API.batch(batchId), { retries: 2 });
  const claim = (id) => request(API.claim(id), { method: 'POST', retries: 1 });
  const release = (id) => request(API.release(id), { method: 'POST', retries: 1 });
  const reportStatus = (id, payload) => request(API.status(id), { method: 'POST', body: payload });

  root.MunisApi = {
    getSettings, setApiBase, getAuth, setAuth, clearAuth, hasHostPermission,
    request, login, me, logout, listBatches, showBatch, claim, release, reportStatus
  };
})(globalThis);
