# Silk Road v2 — spec (chunk 1: battle, enemy, program, plausibility)

UI language: **Russian** (keep current tone/style). Code comments: Russian. Identifiers: English.
Keep: single-page PWA, no build, no deps except Google Fonts, current visual style/tokens, dark mode, a11y patterns,
`window.claude` db sync (initDb/flushDb) as is, Forge, Fleet (weight), Provisions, weekly card, map, route, log.

## 0. Files
- `game.js` — **pure logic, no DOM**. UMD-ish: `(function(root){ ... ; if(typeof module!=='undefined')module.exports=SR; else root.SR=SR; })(this)`.
  All rules below live here; functions take `(state, now:Date, rng?)` and mutate/return state. `rng` injectable for tests.
- `index.html` — UI only, loads `game.js` (before inline script).
- `sw.js` — add `./game.js` to FILES, bump CACHE to `silk-road-v2`.
- `tests/game.test.js` — `node --test tests/` (node:test + assert, no deps).
- `tests/balance.js` — Monte Carlo pacing sim, prints a table (see §9).
- `PROGRAM.md` (Russian) — training program from §6 with technique cues, progression, deload. Update `README.md` mechanics list.

## 1. Game day
`gameDay(now)` = local date of `now − 3h` as `YYYY-MM-DD` (a 23:30 or 01:30 workout counts for the evening's day).
Use it everywhere instead of the old `today()`. Weekday of a game day = weekday of that date.

## 2. State v2 (migrate from v1 key `silkroad.v1`; new key `silkroad.v2`, keep reading v1 if v2 absent)
```
v:2, updatedAt, region, gatePassed, total,
army:{spear,cav,arch,shield}, frac:{push,squat,pull,core},   // frac = leftover points < 10 per group
garrison:{spear,cav,arch,shield, base:<sum at spawn>, reinf:0},
gold:0, upgrades:{walls:0, healer:0, scouts:0, smith:{spear:0,cav:0,arch:0,shield:0}},
provisions, foodDays[], trainDays[], restDays[],             // restDays = mobility check-ins (game days)
sessions:[{d, start, end, raw, pts, mult, flags:[], sets:[{ex, reps, ts, flag?}]}]  (keep last 60),
enemy:{miss:0, lastDay:<game day processed through>, revenge:false, truceUntil:null, truceUsedMonth:{}},
plan:{nextWorkout:'A', moved:{fromDay, toDay}|null, weekStart:<game day of program start>},
settings:{trainDow:[2,4,6], time:'21:30'},                   // 0=Sun..6=Sat
unlocked, startWeight, weight, weightKg, card, log
```
Migration v1→v2: copy common fields; `progress` → troops: `floor(progress/10)` split evenly over 4 types (remainder to spear);
spawn garrison for current region (gatePassed preserved); `enemy.lastDay = yesterday` (no retro punishment);
`plan.weekStart = today`.

## 3. Recruitment (session → troops)
Exercise catalog (replaces LADDERS tiers; Forge still unlocks within each ladder in this order):
| id | name (RU) | lad | k | unit |
|---|---|---|---|---|
| push_classic | Отжимания классические | push | 1 | повт |
| push_diamond | Узкие (бриллиант) | push | 1.3 | повт |
| push_feet | Ноги на возвышении | push | 1.5 | повт |
| push_pause | Пауза 2 с внизу | push | 1.8 | повт |
| push_archer | Лучник | push | 2.4 | повт |
| pike | Пайк-отжимания (плечи) | push | 1.6 | повт — always available, not in Forge |
| squat_bp | Приседания с рюкзаком | squat | 0.7 | повт |
| lunge | Выпады на месте | squat | 0.7 | повт |
| bulgarian | Болгарские сплит-приседания (на ногу) | squat | 1.1 | повт |
| pistol | Пистолет с опорой (на ногу) | squat | 1.8 | повт |
| row_bp | Тяга рюкзака в наклоне | pull | 1.2 | повт |
| row_table | Тяга под столом | pull | 2 | повт |
| pull_band | Подтягивания с резинкой | pull | 2.5 | повт |
| pull_neg | Негативные подтягивания (5 с вниз) | pull | 3 | повт — always available, not in Forge |
| pullup | Подтягивания | pull | 3.5 | повт |
| crunch | Скручивания | core | 0.5 | повт |
| legraise | Подъём ног лёжа | core | 0.8 | повт |
| plank | Планка | core | 1 | 10 с = 1 |
| plank_tap | Планка с касанием плеч | core | 1.4 | 10 с = 1 |
Forge ladders: push=[classic,diamond,feet,pause,archer], squat=[squat_bp,lunge,bulgarian,pistol] (squat_bp unlocked at 0),
pull=[row_bp,row_table,pull_band,pullup], core=[crunch,legraise,plank,plank_tap]. Tests text as before; pullup test = «5 строгих подтягиваний подряд».
Free-mode set entry allows any unlocked Forge exercise + pike + pull_neg. Program items are always allowed (program overrides locks).
Migrate `unlocked` indices: squat 0→0 (squat_bp replaces plain squats), others map 1:1.

Session finish: `raw_g = Σ reps×k` per ladder group (flagged sets ×0.5, see §8) → `pts_g = raw_g × mult` →
`frac_g += pts_g; units = floor(frac_g/10); frac_g -= units*10` → push→spear, squat→cav, pull→arch, core→shield.
`mult` = existing mods (provisions/hunger ×0.5, 2nd session same day ×0.8, 3rd consecutive day ×0.8, rested ×1.1)
× revenge ×1.3 if `enemy.revenge` (then clear it); clamp mult to [0.4, 1.5]. `total += round(Σpts)` (score only).
Show result: «+14 копейщиков, +6 лучников…». Session marks the day trained (norm met).

## 4. Battle
Unit stats: spear atk3 hp10 (×1.5 dmg vs cav) · cav atk4 hp12 (×1.5 vs arch) · arch atk3 hp6 (ranged) · shield atk1 hp20 (tank).
Smith level L on a type: atk ×(1+0.15L). Garrison has the same types, no smith bonus.
`attack(state, rng)` — uses the whole army (MVP; no partial selection). Up to 6 rounds:
1. **Volley:** each side's archers deal `n_arch×atk` (±15% rng) to the other side.
2. **Melee:** spear+cav+shield of each side deal damage simultaneously (both computed from pre-round counts).
Damage application to a side: shields absorb first — 60% of incoming goes to shields while they exist, the rest is split
proportionally by count over other types. Counter bonus: when computing a side's spear damage, the share applied to enemy cav is ×1.5; same for cav→arch.
Kill units by `floor(damage_to_type / hp)`, carry fractional damage within the battle only.
Ends when one side has 0 units or after round 6 (player retreats with survivors; garrison keeps its losses — attrition is progress).
Healer (if bought): 35% of player losses return after battle. Victory over a non-boss region → conquer, loot `gold += 20 + 10*region`,
spawn next garrison. If region has a boss: garrison destroyed → champion appears → existing boss test flow (gatePassed) → conquer.
Return a round-by-round log `[{round, phase, you:{...}, foe:{...}, text}]` for UI animation.
UI: section «Битва» near the map: two columns (your army / garrison) with counts per type and an HP-style bar (total hp),
garrison counts exact only with scouts, else «≈40, в основном конница»; «Атаковать» button (disabled with army 0);
rounds revealed one by one (~400 ms each; instant with prefers-reduced-motion); result banner.

## 5. Garrisons & gold
Garrison for region r (0..11): total `N_r` units, composition by template cycling
[balanced 30/30/25/15, cavalry-heavy 20/45/20/15, archer-heavy 25/20/40/15, shield-wall 30/15/20/35] (spear/cav/arch/shield).
`N_r` — tune via §9 so that a player training 3×/week at program volume conquers region 0 in ~1–2 sessions and
the whole campaign takes ~16–22 weeks; start from `N_r = round(10 + 7r)`, document final values.
Tribute: each processed game day `gold += 3 × region` (conquered count), stops during truce.
Weekly card reward → gold (= old points value). Weight Fleet: +1 kg → +2 cavalry +2 spear (instead of +100 pts).
Shop (section «Лагерь»): walls 60/120/200 (lvl 1–3, raid loss −25%/−45%/−60%), healer 80 (one-time),
scouts 40 (one-time), smith per type 50/100/150 (lvl 1–3). Buttons disabled when not affordable.

## 6. Training program (data in game.js, shown in a «Сегодня» card at top)
Schedule: `settings.trainDow` (default Tue/Thu/Sat), editable in a small «Настройки» block (7 checkboxes, 2–5 days, + time).
Workouts alternate A/B by `plan.nextWorkout` (flip after each finished program session).
On weekdays (Mon–Fri) show the **short** version = first 4 items; on Sat/Sun the full 5.
Deload: every 6th week since `plan.weekStart` → sets halved (ceil).
- **A:** 1) pull: `pull_neg` 4×3 (if pullup unlocked → `pullup` 4×max) · 2) push main = current Forge push tier 4×8–15 ·
  3) `bulgarian` 3×8–12/нога · 4) `row_bp` 3×10–15 · 5) `plank` 3×3–6 (30–60 с)
- **B:** 1) `pull_band` 4×5–8 (if pullup unlocked → `pullup` 4×max) · 2) `pike` 3×6–12 · 3) `row_table` 3×8–12 ·
  4) `squat_bp` 4×12–20 · 5) `legraise` 3×10–15
Rest between sets: pull/push main 120 s, others 90 s, core 60 s.
«Сегодня» card: training day → workout list; each set is a row with reps input prefilled with the range top, a «✓» button
(logs the set with timestamp into the draft and starts a rest countdown); «Завершить тренировку». Rest day → «День отдыха:
10 минут мобильности» + button «Сделал» (adds to restDays). Button «Перенести на завтра» on a training day (max once per
plan-week): today becomes rest, tomorrow becomes training (`plan.moved`). Truce button (see §7).
Free-mode «Поход» card stays for extra sets (same draft/finish).

## 7. Enemy turn (moderate)
`processDays(state, now)`: for each game day d from `enemy.lastDay+1` through yesterday (cap 14 days):
- training day (by trainDow, adjusted by plan.moved) → met if a session on d; rest day → met if session or restDays has d.
- truce day → skip entirely (no miss, no tribute).
- met → `miss = 0`, tribute. missed → `miss++`, `revenge = true`, tribute, then:
  - every miss: **Raid** — lose `10% × (1 − wallsReduction) × (1 − min(0.5, shields/armyTotal))` of each type (floor, min 1 if army>0).
  - miss == 2: **Reinforcements** — garrison +15% of base (cap reinf at 50% of base), composition by template.
  - miss % 3 == 0 and region > 0: **Counter-siege** — `region--`, gatePassed=false, respawn that region's garrison at 60%.
- each event → log entry with an «enemy» kind and a toast summary on open («Пока тебя не было: набег −6 воинов…»).
Truce: «Перемирие» (болезнь/поездка) up to 7 days, max once per calendar month; sets truceUntil.
Threat indicator in stats: 0 спокойно / 1 набег / 2 подкрепление / 3+ осада.

## 8. Plausibility checks (honest-mode, never blocking)
Per logged set (ts = Date.now() at ✓): min time since previous set ≥ `reps × 1.0 s` (plank units: ×10 s) and ≥ 15 s.
Violations flag the set (`flag:'fast'`). If ≥3 consecutive sets are logged < 20 s apart → those sets `flag:'bulk'`
(«записано пачкой»). Reps > 2× the boss/forge test target for that exercise → `flag:'high'`.
Flagged sets count ×0.5 in recruitment and show ⚠ with tooltip; session shows «проверено ✓» or «есть сомнения ⚠».
Session duration (first→last set) recorded for later watch-matching (chunk 3).

## 9. Balance sim (`tests/balance.js`)
Simulate a player doing the program 3×/week with typical reps (midpoint of ranges, +5%/2 weeks progression),
food 5/7 days, attacking whenever army ≥ 1.2× garrison units. Variants: perfect, 1 miss/week, 1 lost week.
Print per region: sessions to conquer, avg losses %, gold at conquest. Tune `N_r` to §5 targets. Commit final numbers.

## 10. Backup
«Экспорт» → download `silk-road-YYYY-MM-DD.json`; «Импорт» → file input, validate `v`, migrate, confirm before overwrite.

## Out of scope (chunk 2/3)
Telegram bot + Cloudflare Worker reminders (chunk 2), watch/Strava verification (chunk 3). Do not add network calls.

---
# CHUNK 2 — Telegram reminders (Cloudflare Worker + cron)

Language: Russian messages (enemy voice, short, 1–3 lines). Comments Russian, identifiers English. No deps (plain Worker JS).
Timezone fixed Asia/Bishkek (UTC+6, no DST); keep as constant TZ_OFFSET_H=6.

## Files
- `bot/logic.js` — PURE: `decide(user, nowUtcMs)` → `[{kind, text}]` messages to send now (empty if none); `gameDayOf(ms)`; templates. UMD like game.js.
- `bot/worker.js` — fetch + scheduled handlers using logic.js. `bot/wrangler.toml` (name silk-road-bot, cron `*/10 * * * *`, KV binding `STATE`, id placeholder `REPLACE_WITH_KV_ID`).
- `bot/test/logic.test.js` — `node --test` (run as `node --test` inside bot/ or `node --test bot/test/logic.test.js`).
- `bot/README.md` — Russian deploy steps for a beginner (BotFather → wrangler login → kv create → secrets → deploy → setWebhook), exact commands for PowerShell.
- App side: new `sync.js` (loaded by index.html, added to sw.js FILES, cache → silk-road-v3) + «Напоминания» block in Settings.

## Linking (no accounts)
App generates `linkCode` (16 chars [a-z0-9], crypto.getRandomValues) stored in state.settings.linkCode. Settings shows «Подключить Telegram» link
`https://t.me/<BOT_USERNAME>?start=<code>` (constants BOT_USERNAME, WORKER_URL at top of sync.js; if WORKER_URL is empty → block shows
«Напоминания пока не настроены» and nothing is sent). Bot on `/start <code>` stores `chatId` into KV key `u:<code>` (create if absent) and replies
confirmation. `/stop` → delete chatId (no messages), `/status` → current norm status text. Webhook verified via header
`X-Telegram-Bot-Api-Secret-Token` == env.WEBHOOK_SECRET (else 401).

## Sync API
`POST /sync` JSON `{code, s:{gameDay, trainDow:[..], time:'HH:MM', normMet:bool, isTrainDay:bool, truce:bool, region:int, regionName, garrisonPct:0-100, miss:int, workout:'A'|'B', short:bool, weekSessions:int, weekTarget:int}}`.
Validate: code /^[a-z0-9]{16}$/, body ≤ 2 KB, numeric/bool types, strings ≤ 40 chars; store `u:<code>.s` + `updatedAt` (merge, keep chatId, keep `sent`). CORS: only ALLOWED_ORIGINS
(`https://danciksaparbekov-arch.github.io,http://localhost:8000`, same pattern as ../english-grammar-site/worker/worker.js). Rate limit by KV counter or skip; response `{ok:true}`.
App sends after each save (debounce 2 s) and on load; failures silent; only the minimal fields above, nothing else.
No sync for a user without chatId is needed but harmless.

## Schedule (decide)
Local time = UTC+6. Quiet hours 23:30–07:30 (no sends). A message kind is sent at most once per game day (`sent[kind]=gameDay`). Only if `chatId`, `!truce`, `!normMet`,
and the synced `gameDay` equals today's game day (stale sync → send nothing, except a once-per-3-days «давно не заходил» nudge if no sync for >48 h).
- `morning` ≥ 08:00 (first cron tick after): train day → «Сегодня тренировка {A/B} ({короткая|полная}) в {time}. Гарнизон {regionName}: {pct}%.»; rest day → «День отдыха: 10 минут мобильности и еда в норме.»
- `courses` ≥ 20:50 only on train days: «Курсы закончились? Враг у ворот {regionName}…»
- `last` ≥ 22:30 (train days and rest days): last warning that missing → «ночной набег» (text by `miss`: 0 набег / 1 подкрепление / 2 осада — i.e. the consequence of the NEXT miss).
- `weekly` Sunday ≥ 19:00 once per week: «Итоги недели: {weekSessions}/{weekTarget}…» — sent even if normMet.
Snooze: inline button «⏰ +30 мин» (callback `snooze:<kind>`) → store `snoozeUntil`, bot re-sends the same kind after it; button «Открыть игру» (url button to the Pages URL). NO «Сделал» button — game state lives in the app only.
Texts: 3 variants per kind chosen deterministically (hash of gameDay) to avoid repetition. Escape nothing exotic: use plain text (no parse_mode).

## Security
Token only in secret TELEGRAM_BOT_TOKEN (never in repo/app). Webhook secret check. Link code = capability (16 random chars); don't log codes. KV values small. Document in README.

## Tests (logic.test.js)
gameDayOf at 02:00/23:30 local; quiet hours; once-per-day dedupe; normMet suppresses everything except weekly; truce suppresses; stale sync; train vs rest texts;
correct kind order across a simulated day of cron ticks every 10 min (assert exactly the expected sends); snooze; Sunday weekly once.
