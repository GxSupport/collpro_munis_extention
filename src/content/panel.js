/**
 * Sahifadagi panel. Holat saqlamaydi — index.js bergan ma'lumotni chizadi,
 * tugma bosilganda `onAction(action, data)` chaqiradi.
 *
 * To'rt ko'rinish bor: sozlama yo'q → login yo'q → ro'yxat tanlash → ish.
 */
(function (root) {
  'use strict';

  const STATUS_LABEL = {
    pending: 'Ожидает',
    filled: 'Заполнено',
    submitting: 'Отправлено',
    paid: 'Оплачено',
    error: 'Ошибка',
    skipped: 'Пропущено',
    locked: 'У другого'
  };

  /** Outbox to'xtab qolgan sabab → operator tushunadigan matn. */
  const BLOCKED_REASON = {
    unauthenticated: 'нужно войти заново (значок расширения)',
    no_api_base: 'не указан адрес сервера',
    no_permission: 'нет разрешения на доступ к серверу',
    operator_blocked: 'учётная запись заблокирована'
  };

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  /** Yaroqsiz qiymatda `NaN` chizmaslik uchun — xom qiymat ko'rsatiladi. */
  const money = (amount) => {
    const value = Number(amount);

    return Number.isFinite(value)
      ? value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : esc(amount);
  };

  function createPanel({ onAction }) {
    const host = document.createElement('div');
    host.className = 'imz-panel';
    document.body.appendChild(host);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    host.after(fileInput);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) onAction('import', { text: await file.text(), name: file.name });
    });

    host.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || button.disabled) return;
      const { action, index, batchId } = button.dataset;
      if (action === 'pick-file') return fileInput.click();
      onAction(action, {
        index: index !== undefined ? Number(index) : undefined,
        batchId
      });
    });

    let collapsed = false;

    function render(view) {
      host.classList.toggle('imz-panel--collapsed', collapsed);
      host.innerHTML = `
        <header class="imz-head">
          <strong>MUNIS</strong>
          <span class="imz-progress">${view.queue ? progress(view.queue) : operatorName(view)}</span>
          <button class="imz-icon" data-action="toggle-collapse" title="Свернуть">${collapsed ? '▴' : '▾'}</button>
        </header>
        ${collapsed ? '' : body(view)}
      `;
    }

    function operatorName(view) {
      return view.backend.operator ? esc(view.backend.operator.name) : '';
    }

    function progress(queue) {
      const done = queue.items.filter((i) => i.status === 'paid' || i.status === 'skipped').length;

      return `${done} / ${queue.items.length}`;
    }

    /** Yuborilmagan hisobotlar — pul o'tib, CollPro bilmay qolmasligi uchun. */
    function outboxBlock(view) {
      const box = view.backend.outbox;
      if (!box) return '';

      const parts = [];

      if (box.blocked) {
        parts.push(`<div class="imz-sync imz-sync--bad">
          Не отправлено в CollPro: ${box.pending} · ${esc(BLOCKED_REASON[box.blocked] || box.blocked)}
          <button class="imz-link" data-action="flush-outbox">Повторить</button>
        </div>`);
      } else if (box.pending) {
        parts.push(`<div class="imz-sync">
          Отправка в CollPro: ${box.pending}
          <button class="imz-link" data-action="flush-outbox">Сейчас</button>
        </div>`);
      }

      if (box.failed) {
        parts.push(`<div class="imz-sync imz-sync--bad">
          CollPro не принял ${box.failed} ${box.failed === 1 ? 'статус' : 'статусов'} — сообщите администратору
          <button class="imz-link" data-action="clear-failed">Скрыть</button>
        </div>`);
      }

      return parts.join('');
    }

    function body(view) {
      const { queue, form, busy, message } = view;

      if (!queue) return chooser(view);

      const item = queue.items[queue.current];
      const payment = { ...queue.defaults, ...item };
      const remote = queue.source === 'api';

      return `
        <div class="imz-body">
          ${outboxBlock(view)}
          ${remote ? '' : '<p class="imz-warn">Офлайн-список из файла — статусы в CollPro не отправляются.</p>'}
          ${queue.invalid && queue.invalid.length
            ? `<p class="imz-warn">${queue.invalid.length} ${queue.invalid.length === 1 ? 'строка' : 'строк'} в списке с ошибками — они помечены и не заполняются.</p>`
            : ''}
          ${form.isForm ? '' : '<p class="imz-warn">Откройте форму «Оплата MUNIS» (Оплатить → форма).</p>'}
          <div class="imz-batch">${esc(queue.title || queue.batch_id)}</div>
          <div class="imz-card">
            <div class="imz-card-head">
              <button class="imz-icon" data-action="prev" title="Предыдущий">◀</button>
              <span>№ ${esc(item.id)} · ${esc(item.contract_id || '')}</span>
              <span class="imz-badge imz-badge--${item.status}">${STATUS_LABEL[item.status]}</span>
              <button class="imz-icon" data-action="next" title="Следующий">▶</button>
            </div>
            ${item.debtor_name ? `<div class="imz-muted">${esc(item.debtor_name)}</div>` : ''}
            <dl class="imz-dl">
              <dt>Лицевой счёт</dt><dd class="imz-mono">${esc(item.personal_account)}</dd>
              <dt>Сумма</dt><dd class="imz-mono">${money(item.amount)}</dd>
              <dt>Сервис</dt><dd>${esc(payment.service)}</dd>
              <dt>Район</dt><dd>${esc(payment.district)}</dd>
            </dl>
            ${item.claimed_by_name && item.status === 'locked'
              ? `<div class="imz-bank">Оператор: ${esc(item.claimed_by_name)}</div>` : ''}
            ${item.bank_message ? `<div class="imz-bank">Банк: ${esc(item.bank_message)}</div>` : ''}
          </div>
          ${actions(item, form, busy, remote)}
          ${message ? messageBlock(message) : ''}
          <details class="imz-list" ${view.listOpen ? 'open' : ''}>
            <summary data-action="toggle-list">Все платежи (${queue.items.length})</summary>
            <ol>
              ${queue.items.map((it, i) => `
                <li class="${i === queue.current ? 'imz-current' : ''}">
                  <button data-action="goto" data-index="${i}">
                    <span class="imz-dot imz-dot--${it.status}"></span>
                    <span class="imz-mono">${esc(it.personal_account)}</span>
                    <span class="imz-mono imz-right">${money(it.amount)}</span>
                  </button>
                </li>`).join('')}
            </ol>
          </details>
        </div>
        ${footer(remote, busy)}`;
    }

    /** Navbat yo'q: sozlama → login → ro'yxatlar. */
    function chooser(view) {
      const { apiBase, hasPermission, loggedIn } = view.backend;
      const message = view.message ? messageBlock(view.message) : '';

      if (!apiBase || !hasPermission) {
        return `
          <div class="imz-body">
            ${outboxBlock(view)}
            <p class="imz-warn">Расширение не настроено: ${apiBase ? 'нет доступа к серверу' : 'не указан адрес сервера CollPro'}.</p>
            ${message}
          </div>
          <footer class="imz-foot">
            <button class="imz-btn imz-btn--primary" data-action="open-options">Настройки</button>
            <button class="imz-btn" data-action="retry-backend">Проверить</button>
          </footer>`;
      }

      if (!loggedIn) {
        return `
          <div class="imz-body">
            ${outboxBlock(view)}
            <p class="imz-warn">Вы не вошли. Нажмите значок «Ipak MUNIS» на панели Chrome и войдите под своим логином.</p>
            ${message}
          </div>
          <footer class="imz-foot">
            <button class="imz-btn imz-btn--primary" data-action="retry-backend">Я вошёл — обновить</button>
            <button class="imz-btn" data-action="open-options">Настройки</button>
          </footer>`;
      }

      const batches = view.batches;

      return `
        <div class="imz-body">
          ${outboxBlock(view)}
          ${view.loadingBatches ? '<p class="imz-hint">Загружаю списки…</p>' : ''}
          ${!view.loadingBatches && batches && batches.length ? `
            <p class="imz-hint">Выберите список платежей:</p>
            <ol class="imz-batches">
              ${batches.map((batch) => `
                <li>
                  <button data-action="open-batch" data-batch-id="${esc(batch.batch_id)}">
                    <span class="imz-batch-title">${esc(batch.title || batch.batch_id)}</span>
                    <span class="imz-muted">${batch.items_total} шт · ${money(batch.amount_total)}</span>
                    <span class="imz-muted">осталось ${batch.counts.pending + batch.counts.error}</span>
                  </button>
                </li>`).join('')}
            </ol>` : ''}
          ${!view.loadingBatches && batches && !batches.length ? '<p class="imz-hint">Открытых списков нет.</p>' : ''}
          ${message}
        </div>
        <footer class="imz-foot">
          <button class="imz-btn imz-btn--primary" data-action="load-batches">Обновить</button>
          <button class="imz-btn" data-action="pick-file">Из файла</button>
        </footer>`;
    }

    function footer(remote, busy) {
      if (!remote) {
        return `
          <footer class="imz-foot">
            <button class="imz-btn" data-action="pick-file">Загрузить</button>
            <button class="imz-btn" data-action="export">Экспорт</button>
            <button class="imz-btn imz-btn--danger" data-action="clear">Очистить</button>
          </footer>`;
      }

      return `
        <footer class="imz-foot">
          <button class="imz-btn" data-action="refresh" ${busy ? 'disabled' : ''}>Обновить</button>
          <button class="imz-btn" data-action="export">Экспорт</button>
          <button class="imz-btn imz-btn--danger" data-action="clear">Закрыть список</button>
        </footer>`;
    }

    function actions(item, form, busy, remote) {
      const disabled = busy || !form.isForm ? 'disabled' : '';

      switch (item.status) {
        case 'pending':
        case 'error':
          return `
            <div class="imz-actions">
              <button class="imz-btn imz-btn--primary" data-action="fill" ${disabled}>${busy ? 'Заполняю…' : 'Заполнить'}</button>
              <button class="imz-btn" data-action="skip" ${busy ? 'disabled' : ''}>Пропустить</button>
            </div>`;
        case 'filled':
          return `
            <p class="imz-ok">Форма заполнена. Проверьте и нажмите «Оплатить» под формой, затем подпишите ключом.</p>
            <div class="imz-actions">
              <button class="imz-btn" data-action="fill" ${disabled}>Заполнить заново</button>
              <button class="imz-btn" data-action="skip" ${busy ? 'disabled' : ''}>Пропустить</button>
            </div>`;
        case 'submitting':
          return `
            <p class="imz-hint">«Оплатить» нажато. Платеж прошел?</p>
            <div class="imz-actions">
              <button class="imz-btn imz-btn--primary" data-action="mark-paid">Да, оплачено → далее</button>
              <button class="imz-btn imz-btn--danger" data-action="mark-error">Нет, ошибка</button>
            </div>`;
        case 'locked':
          return `
            <p class="imz-hint">Платёж занят другим оператором.</p>
            <div class="imz-actions">
              <button class="imz-btn imz-btn--primary" data-action="next-pending">Следующий неоплаченный</button>
            </div>`;
        default:
          // paid / skipped. `paid` — yakuniy holat, backendda qaytarib
          // bo'lmaydi, shuning uchun API rejimida "вернуть в очередь" yo'q.
          return `
            <div class="imz-actions">
              <button class="imz-btn imz-btn--primary" data-action="next-pending">Следующий неоплаченный</button>
              ${remote ? '' : '<button class="imz-btn" data-action="reset-item">Вернуть в очередь</button>'}
            </div>`;
      }
    }

    function messageBlock({ text, kind }) {
      return `<pre class="imz-msg imz-msg--${kind || 'info'}">${esc(text)}</pre>`;
    }

    return {
      render,
      toggleCollapsed() {
        collapsed = !collapsed;
      }
    };
  }

  root.MunisPanel = { createPanel };
})(globalThis);
