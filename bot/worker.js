// Cloudflare Worker: вебхук Telegram, приём состояния из приложения (/sync) и cron-напоминания.
// Секреты: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET (wrangler secret put). KV-привязка: STATE.
// Коды привязки не логируем: код = ключ доступа.
import L from './logic.js';

const MAX_BODY = 2048;
const TTL = L.TTL_LINKED_S; // чат привязан: запись живёт 120 дней с последнего обновления (для KV-ключа c:<chat>)

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, origin ? corsHeaders(origin) : {})
  });
}

// Проверка и очистка состояния из приложения: только известные поля, строгие типы
function cleanState(s) {
  if (!s || typeof s !== "object") return null;
  const num = (v, lo, hi) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi;
  const str = (v) => typeof v === "string" && v.length <= 40;
  const bool = (v) => typeof v === "boolean";
  if (!str(s.gameDay) || !/^\d{4}-\d\d-\d\d$/.test(s.gameDay)) return null;
  if (!Array.isArray(s.trainDow) || s.trainDow.length > 7 || !s.trainDow.every(x => num(x, 0, 6))) return null;
  if (!str(s.time) || !/^\d\d:\d\d$/.test(s.time)) return null;
  if (!bool(s.normMet) || !bool(s.isTrainDay) || !bool(s.truce) || !bool(s.short)) return null;
  if (!num(s.region, 0, 99) || !str(s.regionName) || !num(s.garrisonPct, 0, 100) || !num(s.miss, 0, 999)) return null;
  if (s.truceUntil !== undefined && s.truceUntil !== "" && !/^\d{4}-\d\d-\d\d$/.test(s.truceUntil)) return null;
  if (s.workout !== "A" && s.workout !== "B") return null;
  if (!num(s.weekSessions, 0, 99) || !num(s.weekTarget, 0, 99)) return null;
  return {
    gameDay: s.gameDay, trainDow: s.trainDow, time: s.time, normMet: s.normMet, isTrainDay: s.isTrainDay,
    truce: s.truce, truceUntil: s.truceUntil || "", region: s.region, regionName: s.regionName, garrisonPct: s.garrisonPct, miss: s.miss,
    workout: s.workout, short: s.short, weekSessions: s.weekSessions, weekTarget: s.weekTarget
  };
}

async function getUser(env, code) {
  const raw = await env.STATE.get("u:" + code);
  return raw ? JSON.parse(raw) : null;
}
async function putUser(env, code, u) {
  // Без привязанного чата TTL короткий (7 дней), при привязке (/start) продлевается до 120 дней
  await env.STATE.put("u:" + code, JSON.stringify(u), { expirationTtl: L.ttlFor(u) });
}

async function tg(env, method, body) {
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.ok;
}
// Кнопки: «+30 мин» (кроме nudge) и ссылка на игру. Кнопки «Сделал» нет: состояние живёт только в приложении.
function keyboard(env, kind) {
  const row = [];
  if (kind !== "nudge") row.push({ text: "⏰ +30 мин", callback_data: "snooze:" + kind });
  if (env.GAME_URL) row.push({ text: "Открыть игру", url: env.GAME_URL });
  return { inline_keyboard: [row] };
}
const say = (env, chatId, text) => tg(env, "sendMessage", { chat_id: chatId, text });

async function handleSync(request, env, origin) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, 413, origin);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: "bad json" }, 400, origin); }
  if (!body || !L.validCode(body.code)) return json({ error: "bad code" }, 400, origin);
  const s = cleanState(body.s);
  if (!s) return json({ error: "bad state" }, 400, origin);
  const u = (await getUser(env, body.code)) || {};
  u.s = s;
  u.updatedAt = Date.now();
  await putUser(env, body.code, u);
  return json({ ok: true }, 200, origin);
}

async function handleWebhook(request, env) {
  if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  let upd;
  try { upd = await request.json(); } catch (e) { return new Response("ok"); }

  if (upd.callback_query) {
    const cq = upd.callback_query;
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const data = String(cq.data || "");
    const code = chatId ? await env.STATE.get("c:" + chatId) : null;
    let note = "Не получилось";
    if (code && data.indexOf("snooze:") === 0) {
      const u = await getUser(env, code);
      if (u && L.snooze(u, data.slice(7), Date.now())) { await putUser(env, code, u); note = "Напомню через 30 минут"; }
    }
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: note });
    return new Response("ok");
  }

  const m = upd.message;
  if (!m || !m.chat || typeof m.text !== "string") return new Response("ok");
  const chatId = m.chat.id, text = m.text.trim();
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (cmd === "/start") {
    const code = (text.split(/\s+/)[1] || "").toLowerCase();
    if (!L.validCode(code)) {
      await say(env, chatId, "Открой игру, в Настройках нажми «Подключить Telegram» и вернись сюда по ссылке.");
      return new Response("ok");
    }
    // Если этот чат был привязан к другому коду, отвязываем старый
    const old = await env.STATE.get("c:" + chatId);
    if (old && old !== code) {
      const ou = await getUser(env, old);
      if (ou) { delete ou.chatId; await putUser(env, old, ou); }
    }
    const u = (await getUser(env, code)) || {};
    u.chatId = chatId;
    await putUser(env, code, u);
    await env.STATE.put("c:" + chatId, code, { expirationTtl: TTL });
    await say(env, chatId, "Связь установлена. Я буду напоминать о тренировках. /status показывает норму, /stop отключает напоминания.");
  } else if (cmd === "/stop") {
    const code = await env.STATE.get("c:" + chatId);
    if (code) {
      const u = await getUser(env, code);
      if (u) { delete u.chatId; await putUser(env, code, u); }
      await env.STATE.delete("c:" + chatId);
    }
    await say(env, chatId, "Напоминания отключены. Чтобы вернуть их, подключи Telegram в игре заново.");
  } else if (cmd === "/status") {
    const code = await env.STATE.get("c:" + chatId);
    const u = code ? await getUser(env, code) : null;
    await say(env, chatId, u ? L.statusText(u.s, Date.now()) : "Чат не подключён к игре.");
  }
  return new Response("ok");
}

async function runCron(env) {
  const now = Date.now();
  let cursor;
  do {
    const page = await env.STATE.list({ prefix: "u:", cursor });
    for (const k of page.keys) {
      const raw = await env.STATE.get(k.name);
      if (!raw) continue;
      const u = JSON.parse(raw);
      const msgs = L.decide(u, now);
      if (!msgs.length) continue;
      const sentOk = [];
      for (const msg of msgs) {
        const ok = await tg(env, "sendMessage", { chat_id: u.chatId, text: msg.text, reply_markup: keyboard(env, msg.kind) });
        if (ok) sentOk.push(msg);
      }
      if (sentOk.length) {
        // Перечитываем запись: за время отправки могли прийти /sync или snooze
        const code = k.name.slice(2);
        const fresh = (await getUser(env, code)) || u;
        L.applySent(fresh, sentOk, now);
        await putUser(env, code, fresh);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook" && request.method === "POST") return handleWebhook(request, env);

    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    if (url.pathname === "/sync") {
      if (request.method === "OPTIONS") {
        return originOk ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
      }
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, originOk ? origin : "");
      if (!originOk) return json({ error: "forbidden origin" }, 403, "");
      return handleSync(request, env, origin);
    }
    return new Response("silk-road-bot", { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  }
};
