'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// Местное время Бишкека (UTC+6) -> момент UTC в мс
function local(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h, mi || 0) - 6 * 3600 * 1000; }
const TUE = [2026, 11, 10], SUN = [2026, 11, 15]; // вторник и воскресенье

function mkUser(over, s) {
  return Object.assign({
    chatId: 1, updatedAt: 0,
    s: Object.assign({
      gameDay: '2026-11-10', trainDow: [2, 4, 6], time: '21:30', normMet: false, isTrainDay: true, truce: false,
      region: 1, regionName: 'Алматы', garrisonPct: 80, miss: 0, workout: 'A', short: true, weekSessions: 1, weekTarget: 3
    }, s || {}),
    sent: {}, snoozeUntil: {}
  }, over || {});
}
// Симуляция cron-тиков каждые 10 минут; возвращает [{t:'HH:MM', kind}]
function simulate(user, from, to) {
  const out = [];
  for (let t = from; t <= to; t += 10 * 60 * 1000) {
    const msgs = L.decide(user, t);
    if (msgs.length) {
      L.applySent(user, msgs, t);
      msgs.forEach(m => {
        const mins = L.localMinutes(t);
        out.push(String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0') + ' ' + m.kind);
      });
    }
  }
  return out;
}

test('gameDayOf: 02:00 относится к вчера, 23:30 к сегодня', () => {
  assert.strictEqual(L.gameDayOf(local(2026, 11, 11, 2, 0)), '2026-11-10');
  assert.strictEqual(L.gameDayOf(local(2026, 11, 10, 23, 30)), '2026-11-10');
  assert.strictEqual(L.gameDayOf(local(2026, 11, 11, 3, 0)), '2026-11-11');
});

test('тихие часы 23:30-07:30', () => {
  assert.ok(L.isQuiet(local(...TUE, 23, 30)));
  assert.ok(L.isQuiet(local(...TUE, 3, 0)));
  assert.ok(L.isQuiet(local(...TUE, 7, 29)));
  assert.ok(!L.isQuiet(local(...TUE, 7, 30)));
  assert.ok(!L.isQuiet(local(...TUE, 23, 29)));
  // даже последнее предупреждение не уходит в тихие часы
  assert.deepStrictEqual(L.decide(mkUser(), local(...TUE, 23, 40)), []);
});

test('день тренировки: morning 08:00, courses 20:50, last 22:30', () => {
  const u = mkUser();
  assert.deepStrictEqual(simulate(u, local(...TUE, 7, 0), local(...TUE, 23, 50)),
    ['08:00 morning', '20:50 courses', '22:30 last']);
});

test('день отдыха: morning и last, без courses', () => {
  const u = mkUser({}, { isTrainDay: false });
  assert.deepStrictEqual(simulate(u, local(...TUE, 7, 0), local(...TUE, 23, 50)),
    ['08:00 morning', '22:30 last']);
});

test('дедупликация: повторный тик в тот же день ничего не шлёт', () => {
  const u = mkUser();
  const t = local(...TUE, 8, 0);
  const m = L.decide(u, t);
  assert.strictEqual(m.length, 1);
  L.applySent(u, m, t);
  assert.deepStrictEqual(L.decide(u, t + 10 * 60 * 1000), []);
  assert.strictEqual(u.sent.morning, '2026-11-10');
});

test('normMet подавляет всё, кроме weekly', () => {
  const u = mkUser({}, { normMet: true });
  assert.deepStrictEqual(simulate(u, local(...TUE, 7, 0), local(...TUE, 23, 50)), []);
  const w = mkUser({}, { normMet: true, gameDay: '2026-11-15' });
  assert.deepStrictEqual(simulate(w, local(...SUN, 7, 0), local(...SUN, 23, 50)), ['19:00 weekly']);
});

test('перемирие подавляет всё, включая weekly', () => {
  const u = mkUser({}, { truce: true, gameDay: '2026-11-15' });
  assert.deepStrictEqual(simulate(u, local(...SUN, 7, 0), local(...SUN, 23, 50)), []);
});

test('устаревшая синхронизация (вчера): утреннее напоминание всё равно идёт', () => {
  const t = local(...TUE, 9, 0);
  const u = mkUser({ updatedAt: t - 3600 * 1000 }, { gameDay: '2026-11-09' });
  const m = L.decide(u, t);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].kind, 'morning');
});

test('nudge: после 48 ч без синка, раз в 3 дня, после 10:00', () => {
  const t = local(...TUE, 11, 0);
  const u = mkUser({ updatedAt: t - 49 * 3600 * 1000 }, { gameDay: '2026-11-07' });
  // до 10:00 nudge не шлётся (при давности 48+ ч)
  assert.ok(!L.decide(mkUser({ updatedAt: local(...TUE, 9, 0) - 49 * 3600 * 1000 }, { gameDay: '2026-11-07' }), local(...TUE, 9, 0)).some(x => x.kind === 'nudge'));
  const m = L.decide(u, t);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].kind, 'nudge');
  L.applySent(u, m, t);
  assert.deepStrictEqual(L.decide(u, t + 24 * 3600 * 1000), []);
  assert.strictEqual(L.decide(u, t + 3 * 24 * 3600 * 1000 + 1).length, 1);
});

test('без chatId ничего не шлётся', () => {
  assert.deepStrictEqual(L.decide(mkUser({ chatId: null }), local(...TUE, 8, 0)), []);
});

test('тексты: тренировка и отдых', () => {
  const tr = L.decide(mkUser(), local(...TUE, 8, 0))[0].text;
  assert.match(tr, /тренировк/i);
  assert.match(tr, /A/);
  assert.match(tr, /21:30/);
  assert.match(tr, /Алматы/);
  assert.match(tr, /80%/);
  const rest = L.decide(mkUser({}, { isTrainDay: false }), local(...TUE, 8, 0))[0].text;
  assert.match(rest, /отдых|мобильност/i);
  assert.doesNotMatch(rest, /Алматы/);
});

test('last: текст зависит от miss (набег / подкрепление / осада)', () => {
  const t = local(...TUE, 22, 30);
  const txt = (miss) => L.decide(mkUser({}, { miss }), t)[0].text;
  assert.match(txt(0), /набег/);
  assert.doesNotMatch(txt(0), /подкрепление|осада/);
  assert.match(txt(1), /подкрепление/);
  assert.match(txt(2), /осада/);
  assert.match(txt(5), /осада/);
});

test('варианты текста детерминированы по игровому дню', () => {
  const a = L.decide(mkUser(), local(...TUE, 8, 0))[0].text;
  const b = L.decide(mkUser(), local(...TUE, 8, 20))[0].text;
  assert.strictEqual(a, b);
});

test('snooze: повтор того же вида через 30 минут, один раз', () => {
  const u = mkUser();
  const t0 = local(...TUE, 8, 0);
  L.applySent(u, L.decide(u, t0), t0);
  assert.ok(L.snooze(u, 'morning', t0 + 60000));
  assert.deepStrictEqual(L.decide(u, t0 + 10 * 60 * 1000), []);
  const t1 = t0 + 60000 + 30 * 60 * 1000;
  const m = L.decide(u, t1);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].kind, 'morning');
  L.applySent(u, m, t1);
  assert.deepStrictEqual(L.decide(u, t1 + 10 * 60 * 1000), []);
  assert.ok(!L.snooze(u, 'bogus', t0));
});

test('snooze не срабатывает, если норма уже выполнена', () => {
  const u = mkUser({}, { normMet: true });
  u.sent.morning = '2026-11-10';
  L.snooze(u, 'morning', local(...TUE, 8, 0));
  assert.deepStrictEqual(L.decide(u, local(...TUE, 9, 0)), []);
});

test('просроченные виды не копятся: в 22:30 уходит только last', () => {
  const u = mkUser();
  const m = L.decide(u, local(...TUE, 22, 30));
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].kind, 'last');
  L.applySent(u, m, local(...TUE, 22, 30));
  assert.deepStrictEqual(L.decide(u, local(...TUE, 22, 40)), []);
});

test('воскресенье: weekly один раз за день, текст с итогами', () => {
  const u = mkUser({}, { gameDay: '2026-11-15', normMet: true, weekSessions: 2, weekTarget: 3 });
  assert.deepStrictEqual(L.decide(u, local(...SUN, 18, 50)), []);
  const t = local(...SUN, 19, 0);
  const m = L.decide(u, t);
  assert.strictEqual(m.length, 1);
  assert.match(m[0].text, /2\/3|2 из 3/);
  L.applySent(u, m, t);
  assert.deepStrictEqual(L.decide(u, t + 10 * 60 * 1000), []);
});

test('weekly в будний день не отправляется', () => {
  assert.deepStrictEqual(L.decide(mkUser({}, { normMet: true }), local(...TUE, 20, 0)), []);
});

test('statusText', () => {
  const t = local(...TUE, 12, 0);
  assert.match(L.statusText(mkUser().s, t), /не выполнена/);
  assert.match(L.statusText(mkUser({}, { normMet: true }).s, t), /выполнена/);
  assert.match(L.statusText(mkUser({}, { truce: true }).s, t), /Перемирие/);
  assert.match(L.statusText(mkUser({}, { gameDay: '2026-01-01' }).s, t), /устарели/);
});

// Приложение сегодня не открывали: напоминания всё равно приходят (синхронизация от вчера)
test('устаревшая синхронизация (вчера, <48ч): день тренировки по trainDow, напоминания идут', () => {
  // sync от понедельника, а сегодня вторник (тренировочный день по [2,4,6])
  const u = mkUser({}, { gameDay: '2026-11-09', isTrainDay: false, normMet: true });
  const got = simulate(u, local(...TUE, 7, 0), local(...TUE, 23, 0));
  assert.deepStrictEqual(got, ['08:00 morning', '20:50 courses', '22:30 last']);
});
test('устаревшая синхронизация: перемирие по truceUntil глушит напоминания', () => {
  const u = mkUser({}, { gameDay: '2026-11-09', truceUntil: '2026-11-12' });
  assert.deepStrictEqual(simulate(u, local(...TUE, 7, 0), local(...TUE, 23, 0)), []);
});
test('устаревшая синхронизация: в нетренировочный день (Ср) только утро и last', () => {
  const u = mkUser({}, { gameDay: '2026-11-09', trainDow: [2, 4, 6] });
  const got = simulate(u, local(2026, 11, 11, 7, 0), local(2026, 11, 11, 23, 0));
  assert.deepStrictEqual(got, ['08:00 morning', '22:30 last']);
});

test('TTL записи: без чата 7 дней, с чатом 120 дней', () => {
  assert.strictEqual(L.ttlFor({}), 7 * 86400);
  assert.strictEqual(L.ttlFor(null), 7 * 86400);
  assert.strictEqual(L.ttlFor({ chatId: 5 }), 120 * 86400);
  assert.ok(L.TTL_UNLINKED_S >= 60); // минимум KV expirationTtl
});

test('validCode: строго 16 символов [a-z0-9]', () => {
  assert.ok(L.validCode('abcdefghij012345'));
  for (const bad of ['', 'abc', 'ABCDEFGHIJ012345', 'abcdefghij01234!', 'abcdefghij0123456', 'abcdefghij012345\n', null, 5, {}, ['abcdefghij012345']]) {
    assert.ok(!L.validCode(bad), String(bad));
  }
});
