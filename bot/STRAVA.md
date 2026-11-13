# Проверка тренировки часами (Strava) — заготовка

Цепочка: Xiaomi Watch S3 → Mi Fitness → Strava → webhook Strava → Worker (`/strava/webhook`) → сверка с сессией игры (`verifySession` в `logic.js`).
Подтверждённая тренировка: награда ×1.2 и без штрафа ×0.5 за ⚠-подходы. **Сейчас всё выключено**: без трёх секретов маршрут отвечает 404, в игре флаг «Проверка часами» по умолчанию выкл.

Условие подтверждения (`verifySession`): длительность ≥ 25 мин, есть средний пульс, время активности пересекается с окном сессии или в пределах ±3 ч.

## Что должен сделать пользователь (по порядку)

### 1. Проверить, умеет ли Mi Fitness отдавать данные в Strava
Mi Fitness → Профиль → «Сторонние приложения» (названия пунктов могут отличаться по версии). Нужна Strava (или Health Connect, а из него другое приложение, которое умеет слать в Strava). Если Strava там нет, дальше идти нельзя: напиши Claude, подберём обходной путь.

### 2. Создать приложение Strava
1. Зайди на https://www.strava.com/settings/api (нужен аккаунт Strava).
2. Создай приложение. «Authorization Callback Domain»: домен твоего Worker без `https://` (например `silk-road-bot.<аккаунт>.workers.dev`).
3. Запиши **Client ID** и **Client Secret**. Секрет никуда не пересылай и не вставляй в файлы репозитория.

### 3. Задать секреты Worker
Придумай длинную случайную строку для `STRAVA_VERIFY_TOKEN` (например `[guid]::NewGuid().ToString('N')`). В PowerShell, папка `bot`:
```powershell
cd "C:\Users\user\Личное\silk-road-fitness\bot"
npx wrangler secret put STRAVA_VERIFY_TOKEN
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler deploy
```
Значения вводятся в ответ на запрос команды.

### 4. Подписаться на webhook Strava
Подписка одна на приложение. Подставь свои значения (`WORKER_URL` без слэша в конце):
```powershell
$body = @{
  client_id     = "<CLIENT_ID>"
  client_secret = "<CLIENT_SECRET>"
  callback_url  = "https://<WORKER_URL>/strava/webhook"
  verify_token  = "<STRAVA_VERIFY_TOKEN>"
}
Invoke-RestMethod -Method Post -Uri "https://www.strava.com/api/v3/push_subscriptions" -Body $body
```
Strava сразу делает GET на `callback_url` с `hub.challenge`; Worker отвечает `{"hub.challenge": ...}`. В ответ придёт `id` подписки. Проверить/удалить:
```powershell
Invoke-RestMethod -Uri "https://www.strava.com/api/v3/push_subscriptions?client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>"
Invoke-RestMethod -Method Delete -Uri "https://www.strava.com/api/v3/push_subscriptions/<ID>?client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>"
```
(Эквивалент на curl: `curl -X POST https://www.strava.com/api/v3/push_subscriptions -F client_id=... -F client_secret=... -F callback_url=... -F verify_token=...`.)

### 5. Включить в игре
Настройки → «Проверка часами» → включить.

## Что уже сделано в коде
- `bot/logic.js`: `verifySession(activity, session)`, `stravaActivityId(event)`; тесты в `bot/test/logic.test.js`.
- `bot/worker.js`: GET/POST `/strava/webhook` (только при трёх секретах), функции `stravaExchangeCode`, `stravaRefresh`, `stravaGetActivity` (принимают `fetchFn` для моков), `processStravaEvent`. Хранится только привязка `a:<athlete_id>` и 5 полей последней активности в записи пользователя.
- `game.js`: `settings.watchCheck`, `session.verified`, `VERIFY_BONUS=1.2`, `calcSession(..., {verified:true})` / `finishSession(..., {verified:true})`; работает только при включённом флаге. Тесты в `tests/game.test.js`.

## TODO (не реализовано, нужны решения)
1. **Привязка athlete → код игры.** Нужен OAuth-маршрут (`https://www.strava.com/oauth/authorize?...&state=<код>` → callback → `stravaExchangeCode` → запись KV `a:<athlete.id>` = `{code, refresh}`). Какой `scope` нужен для чтения своих активностей и как ведёт себя callback, сверить с документацией Strava при реализации.
2. **Доставка результата в игру.** У Worker нет окон сессий игры, а у игры нет канала от Worker. Варианты: приложение при открытии запрашивает `GET /strava/last?code=` и вызывает `verifySession` у себя (нужна копия функции в `game.js`/`sync.js`), либо `sync.js` шлёт окна последних сессий. Выбрать позже.
3. **Задним числом.** Сейчас множитель применяется в момент `finishSession`; подтверждение от часов приходит позже. Нужна пересборка очков сессии (или отложенное «довыдать бонус»).
4. Проверить, что Mi Fitness шлёт в Strava средний пульс и тип активности «силовая» (поле `type`), иначе правило «есть пульс» не сработает.
