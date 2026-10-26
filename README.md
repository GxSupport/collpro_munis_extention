# Ipak MUNIS — автозаполнение

Chrome/Edge extension (MV3). `e-bank.ipakyulibank.uz`dagi «Оплата MUNIS» formasini
CollPro'dan olingan ro'yxat bo'yicha to'ldiradi. **To'lovni operator o'zi imzolaydi**
(E-IMZO kaliti) — extension "Оплатить" tugmasini hech qachon bosmaydi.

Backend: `/api/munis/*` (CollPro API). Shartnoma — `docs/02-api-contract.md`.

## O'rnatish (operator PC'si)

1. Papkani doimiy joyga chiqaring, masalan `C:\CollPro\ipak_munis` — bu papka
   o'chirilsa yoki ko'chirilsa extension ishlamaydi.
2. `chrome://extensions` (Edge: `edge://extensions`) → **Developer mode** yoqiladi.
3. **Load unpacked** → shu papka (ichida `manifest.json` bo'lgani).
4. Toolbar'dagi 🧩 → **Ipak MUNIS** yonidagi pin bosiladi.

### Sozlash (bir marta)

5. `chrome://extensions` → **Ipak MUNIS** → **Details** → **Extension options**
   (yoki popup → **Настройки**).
6. **Адрес сервера CollPro** kiritiladi: faqat server manzili, `https://` bilan,
   `/api/munis` qo'shilmaydi (extension o'zi qo'shadi). Masalan `https://api.trackcoll.uz`.
7. **Сохранить и разрешить доступ** → Chrome shu manzilga kirish ruxsatini so'raydi,
   **Разрешить** bosiladi. Ruxsat berilmasa extension serverdan ro'yxat olmaydi.
8. **Проверить связь** — «Связь с сервером CollPro есть» chiqishi kerak.

### Kirish

9. Toolbar'dagi **Ipak MUNIS** ikonkasi → **Логин (номер телефона)** va **Пароль**
   (CollPro akkaunti) → **Войти**.

Token faqat extension ichida (service worker'da) saqlanadi va bank sahifasiga
uzatilmaydi.

## Ishlatish

1. E-bank'ga kiriladi → **Оплата MUNIS** formasi ochiladi → o'ng pastda panel chiqadi.
2. Panelda ochiq ro'yxatlardan biri tanlanadi (**Обновить** — ro'yxatlarni qayta olish).
3. **Заполнить** — qator band qilinadi (`POST /claim`), forma to'ldiriladi va qayta
   o'qib tekshiriladi (~2 s, keyingilari ~0,5 s).
4. Operator formani ko'zdan kechiradi, **Оплатить** (forma ostida) bosadi, kalit bilan
   imzolaydi. Panel "Отправлено" holatiga o'tadi, bank javobi ushlanadi.
5. Operator **Да, оплачено → далее** bosadi — status CollPro'ga ketadi va keyingi qator
   avtomatik to'ldiriladi.
6. **Обновить** — CollPro'dagi haqiqiy holatni tortib oladi (boshqa operatorlar ishi ham
   ko'rinadi).

Boshqa operator band qilgan qator "У другого" deb ko'rsatiladi va to'ldirilmaydi.

### Zaxira rejimi (fayl)

Backend ishlamasa yoki sinov uchun: **Из файла** → JSON (format: `docs/02-api-contract.md` §2,
namuna `test-data/notarius-inv-10.json`). Bunday ro'yxat **офлайн** deb belgilanadi,
statuslari CollPro'ga yuborilmaydi, natija **Экспорт** bilan fayl sifatida olinadi.

## Statuslar

Panelda: `pending → filled → submitting → paid`, shuningdek `error`, `skipped`, `locked`.
CollPro'da (kontrakt §3): `pending → claimed → submitting → paid`, `error`, `skipped`.

`filled` — faqat brauzerdagi holat (forma to'ldirilgan, imzo kutilmoqda); CollPro'da bu
qator `claimed`. `paid` — yakuniy holat, undan qaytarib bo'lmaydi.

`submitting` — "Оплатить" bosilgan payt forma qiymatlari (Лицевой счёт + Сумма) bo'yicha
qator topiladi, panelda boshqa qator tanlangan bo'lsa ham.

## Tuzilma

```
manifest.json
src/bg/service-worker.js  backend bilan gaplashadigan yagona joy (RPC router)
src/bg/api.js             HTTP klient: token, retry/backoff, xato kodlari
src/bg/outbox.js          status hisobotlari navbati (diskda, yuborilmaguncha o'chmaydi)
src/page/zk-driver.js     MAIN world — ZK widget'lari bilan ishlaydi (zk/zAu)
src/content/bridge.js     isolated ↔ MAIN postMessage RPC
src/content/backend.js    content → service worker (chrome.runtime.sendMessage)
src/content/index.js      orkestrator: navbat + claim + driver + hisobot + panel
src/content/panel.js/css  sahifadagi panel
src/lib/config.js         widget id'lari, timeout'lar, API yo'llari, storage kalitlari
src/lib/queue.js          navbat: API/fayl → bir shakl, statuslar, merge
src/ui/popup.*            login/logout, holat, bank sahifasini ochish
src/ui/options.*          server manzili + Chrome host ruxsati
docs/                     sayt tadqiqoti, API shartnomasi
test-data/                sinov ro'yxati
```

## Nima uchun shunday qilingan

- **Barcha so'rovlar service worker'dan.** Token bank sahifasida turmaydi va CORS
  kerak emas (kontrakt §0).
- **Server manzili sozlamada, `optional_host_permissions` bilan.** Har o'rnatishda
  manzil boshqa bo'lishi mumkin; Chrome ruxsatini foydalanuvchi bir marta beradi.
- **Hisobotlar avval diskka (outbox), keyin tarmoqqa.** Pul chiqib ketib, status
  yuborilmay qolsa — qator CollPro'da "в очереди" bo'lib turadi va **ikkinchi marta
  to'lanishi mumkin**. Outbox brauzer yopilsa ham saqlanadi, `event_id` o'zgarmaydi
  (backend idempotentligi), tartib FIFO.
- **Claim formani to'ldirishdan oldin.** Ikki operator bitta to'lovni to'lay olmaydi;
  claim 10 daqiqada o'zi bo'shaydi.
- **Driver xatosida (timeout, ro'yxatda qiymat yo'q) backendga `error` yozilmaydi** —
  qator qayta urinish uchun ochiq qoladi. Faqat haqiqiy nomuvofiqlik `error` bo'ladi.
- **Boshqa qator to'ldirilsa, avvalgi `filled` qator bo'shatiladi** (`POST /release`):
  bank formasida bir vaqtda bitta to'lov turadi, demak avvalgisi tashlab ketilgan —
  10 daqiqa TTL kutmasin.
- **API ro'yxatidagi yaroqsiz qator chetga suriladi, butun ro'yxat rad etilmaydi.**
  1000 qatorlik ro'yxat bitta buzuq satr uchun bloklanib qolmasligi kerak (fayl
  import'i esa, aksincha, "hammasi yoki hech nima" — operator faylni tuzatadi).

## Keyingi qadamlar

- «Список» orqali tasdiqlash (`dataGrid`, Статус = «Проведено в БС») → `bank_payment_id`,
  `bank_status` (kontrakt §6, 3-bosqich).
- Operatorlar soni ko'paysa: Developer mode o'rniga `.crx` + `ExtensionInstallForcelist`
  yoki Chrome Web Store (unlisted).
