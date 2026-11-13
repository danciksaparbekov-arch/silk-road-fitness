/* Шёлковый путь: чистая логика напоминаний (без сети и KV). UMD: Worker импортирует, node --test проверяет. */
(function(root){
'use strict';
var TZ_OFFSET_H=6; // Asia/Bishkek, без перехода на летнее время
var HOUR=3600*1000;
var DAY_SHIFT_H=3; // игровой день = местное время − 3 ч (как в game.js)
var KINDS=['morning','courses','last','weekly','nudge'];
var SNOOZE_MS=30*60*1000;
var NUDGE_AFTER_MS=48*HOUR, NUDGE_EVERY_MS=3*24*HOUR;

// Игровой день (ГГГГ-ММ-ДД) для момента UTC: (utc + 6 ч) − 3 ч
function gameDayOf(ms){return new Date(ms+(TZ_OFFSET_H-DAY_SHIFT_H)*HOUR).toISOString().slice(0,10);}
// Минуты от начала местных суток (0..1439)
function localMinutes(ms){var d=new Date(ms+TZ_OFFSET_H*HOUR);return d.getUTCHours()*60+d.getUTCMinutes();}
function dowOfDay(day){var a=day.split('-');return new Date(Date.UTC(+a[0],+a[1]-1,+a[2],12)).getUTCDay();} // 0=вс
// Тихие часы 23:30–07:30
function isQuiet(ms){var m=localMinutes(ms);return m>=23*60+30||m<7*60+30;}

// Детерминированный выбор варианта текста по игровому дню
function variantIdx(day,n){var h=0;for(var i=0;i<day.length;i++)h=(h*31+day.charCodeAt(i))>>>0;return h%n;}
function pickText(variants,day){return variants[variantIdx(day,variants.length)];}

function morningText(s,day){
  if(s.isTrainDay){
    var w=s.workout||'A',len=s.short?'короткая':'полная',t=s.time||'21:30',reg=s.regionName||'врага',pct=Math.round(s.garrisonPct||0);
    return pickText([
      'Сегодня тренировка '+w+' ('+len+') в '+t+'. Гарнизон '+reg+': '+pct+'%.',
      'Враг не спит. Тренировка '+w+' ('+len+') ждёт тебя в '+t+'. Гарнизон '+reg+' держится на '+pct+'%.',
      'Новый день, новая тренировка '+w+' ('+len+'), в '+t+'. Гарнизон '+reg+': '+pct+'%. Не заставляй его ждать.'
    ],day);
  }
  return pickText([
    'День отдыха: 10 минут мобильности и еда в норме.',
    'Сегодня отдых. Десять минут мобильности и нормальная еда, и армия в порядке.',
    'Разведчики докладывают: тихо. Отдыхай, но разомнись 10 минут и поешь по плану.'
  ],day);
}
function coursesText(s,day){
  var reg=s.regionName||'врага';
  return pickText([
    'Курсы закончились? Враг у ворот '+reg+'. Тренировка сама себя не сделает.',
    'Вечер. Враг у ворот '+reg+', а ты ещё не в строю. Пора на тренировку.',
    'Курсы позади, впереди бой. Ворота '+reg+' ждут твоих воинов.'
  ],day);
}
// Текст зависит от последствия СЛЕДУЮЩЕГО пропуска: miss 0 → набег, 1 → подкрепление, 2+ → осада
function lastText(s,day){
  var m=s.miss||0,cons;
  if(m<=0)cons='ночной набег: потеряешь часть воинов';
  else if(m===1)cons='ночной набег и подкрепление гарнизона';
  else cons='ночной набег и осада: можешь потерять регион';
  var what=s.isTrainDay?'Тренировку':'Отдых и еду';
  return pickText([
    'Последний шанс. Если не засчитать день, ночью будет '+cons+'. '+what+' ещё можно успеть.',
    'Скоро полночь. Пропуск дня означает '+cons+'. '+what+' ещё можно успеть.',
    'Враг уже собирается у стен. Не отметишь день до полуночи, получишь '+cons+'.'
  ],day);
}
function weeklyText(s,day){
  var a=s.weekSessions||0,b=s.weekTarget||0,ok=b>0&&a>=b;
  return pickText([
    'Итоги недели: '+a+'/'+b+' тренировок. '+(ok?'План выполнен, армия растёт.':'Можно лучше: враг это запомнил.'),
    'Неделя закончилась. Тренировок: '+a+' из '+b+'. '+(ok?'Так держать.':'На следующей неделе добирай.'),
    'Сводка с границы: '+a+'/'+b+'. '+(ok?'Враг отступает.':'Враг осмелел, пора его проучить.')
  ],day);
}
function nudgeText(day){
  return pickText([
    'Давно не заходил в игру. Враг осмелел и копит силы. Загляни в лагерь.',
    'Тихо слишком долго. Разведчики не получали вестей уже несколько дней. Открой игру.',
    'Армия скучает по командиру. Загляни, отметь тренировку.'
  ],day);
}
function textFor(kind,s,day){
  if(kind==='morning')return morningText(s,day);
  if(kind==='courses')return coursesText(s,day);
  if(kind==='last')return lastText(s,day);
  if(kind==='weekly')return weeklyText(s,day);
  return nudgeText(day);
}

// Текст для команды /status
function statusText(s,nowMs){
  if(!s)return 'Данных из игры ещё нет. Открой приложение, чтобы оно отправило состояние.';
  if(s.gameDay!==gameDayOf(nowMs))return 'Данные устарели: открой игру, чтобы обновить статус.';
  if(s.truce)return 'Перемирие: набегов нет.';
  if(s.normMet)return 'Норма на сегодня выполнена. Враг отступил.';
  return (s.isTrainDay?'Сегодня тренировка '+(s.workout||'A')+' в '+(s.time||'')+', норма ещё не выполнена.':'Сегодня день отдыха, нужно отметить мобильность и еду.')+
    ' Гарнизон '+(s.regionName||'')+': '+Math.round(s.garrisonPct||0)+'%.';
}

// Синхронизация от прошлого дня (приложение сегодня не открывали): считаем, что норма не выполнена
// (после тренировки приложение синхронизируется само). День тренировки берём из trainDow, перемирие — из truceUntil.
function rollForward(s,today){
  if(s.gameDay===today)return s;
  var dow=dowOfDay(today),r=Object.assign({},s);
  r.gameDay=today;r.normMet=false;
  r.isTrainDay=(s.trainDow||[]).indexOf(dow)>=0;
  r.short=dow>=1&&dow<=5;
  r.truce=!!(s.truceUntil&&s.truceUntil>=today);
  return r;
}

// Что отправить сейчас. user = {chatId, s, updatedAt, sent, snoozeUntil, lastNudge}. Возвращает [{kind,text,covers}]
function decide(user,nowMs){
  if(!user||!user.chatId||!user.s||isQuiet(nowMs))return [];
  var s=user.s,sent=user.sent||{},today=gameDayOf(nowMs),mins=localMinutes(nowMs),out=[];
  // Давно нет синхронизации: только редкое напоминание
  if(user.updatedAt>0&&nowMs-user.updatedAt>NUDGE_AFTER_MS){
    if(mins>=10*60&&nowMs-(user.lastNudge||0)>=NUDGE_EVERY_MS)out.push({kind:'nudge',text:nudgeText(today),covers:['nudge']});
    return out;
  }
  s=rollForward(s,today);
  if(s.truce)return [];
  var snooze=user.snoozeUntil||{};
  if(!s.normMet){
    // Просроченные виды не копятся: уходит самый поздний, остальные считаются отправленными (covers)
    var due=[];
    if(mins>=8*60&&sent.morning!==today)due.push('morning');
    if(s.isTrainDay&&mins>=20*60+50&&sent.courses!==today)due.push('courses');
    if(mins>=22*60+30&&sent.last!==today)due.push('last');
    if(due.length){var k=due[due.length-1];out.push({kind:k,text:textFor(k,s,today),covers:due});}
  }
  if(dowOfDay(today)===0&&mins>=19*60&&sent.weekly!==today)out.push({kind:'weekly',text:weeklyText(s,today),covers:['weekly']});
  // Отложенные («+30 мин»)
  Object.keys(snooze).forEach(function(k){
    if(!(snooze[k]<=nowMs)||KINDS.indexOf(k)<0||k==='nudge')return;
    if(out.some(function(m){return m.kind===k;}))return;
    if(k!=='weekly'&&s.normMet)return;
    if(k==='courses'&&!s.isTrainDay)return;
    out.push({kind:k,text:textFor(k,s,today),covers:[],snoozed:true});
  });
  return out;
}

// Отмечает отправленное в user (мутирует): sent, snoozeUntil, lastNudge
function applySent(user,msgs,nowMs){
  var today=gameDayOf(nowMs);
  user.sent=user.sent||{};user.snoozeUntil=user.snoozeUntil||{};
  msgs.forEach(function(m){
    (m.covers||[]).forEach(function(k){
      if(k==='nudge')user.lastNudge=nowMs;else user.sent[k]=today;
    });
    delete user.snoozeUntil[m.kind];
  });
  return user;
}
function snooze(user,kind,nowMs){
  if(KINDS.indexOf(kind)<0||kind==='nudge')return false;
  user.snoozeUntil=user.snoozeUntil||{};user.snoozeUntil[kind]=nowMs+SNOOZE_MS;
  return true;
}

// Хранение записей в KV: пока нет привязанного чата, запись живёт мало (защита от засорения мусорными кодами)
var CODE_RE=/^[a-z0-9]{16}$/;
var TTL_LINKED_S=120*24*3600, TTL_UNLINKED_S=7*24*3600;
function validCode(c){return typeof c==='string'&&c.length===16&&CODE_RE.test(c);} // длина отдельно: $ в JS пропускает завершающий перевод строки

function ttlFor(user){return user&&user.chatId?TTL_LINKED_S:TTL_UNLINKED_S;}

/* ---------- Проверка тренировки часами (Strava, chunk 3; инертно, пока не подключено) ---------- */
var VERIFY_MIN_S=25*60, VERIFY_NEAR_MS=3*HOUR;
// Окно сессии игры в мс UTC: session.start/end (мс) или, если их нет, игровой день session.d (03:00–03:00 по Бишкеку)
function sessionWindow(session){
  if(!session||typeof session!=='object')return null;
  var a=session.start,b=session.end;
  if(typeof a==='number'&&isFinite(a)&&typeof b==='number'&&isFinite(b)&&b>=a)return [a,b];
  if(typeof session.d==='string'&&/^\d{4}-\d\d-\d\d$/.test(session.d)){
    var p=session.d.split('-'),from=Date.UTC(+p[0],+p[1]-1,+p[2],DAY_SHIFT_H-TZ_OFFSET_H);
    return [from,from+24*HOUR];
  }
  return null;
}
function num(v){return typeof v==='number'&&isFinite(v)?v:null;}
// activity — объект активности Strava (start_date ISO UTC, elapsed_time/moving_time в сек, average_heartrate).
// Подтверждено: ≥25 мин, есть пульс, активность пересекается с окном сессии или в пределах ±3 ч.
function verifySession(activity,session){
  if(!activity||typeof activity!=='object')return {verified:false,reason:'no_activity'};
  var dur=num(activity.moving_time);if(dur==null)dur=num(activity.elapsed_time);
  if(dur==null||dur<VERIFY_MIN_S)return {verified:false,reason:'too_short'};
  var hr=num(activity.average_heartrate);
  if(hr==null||hr<=30||hr>=250)return {verified:false,reason:'no_heartrate'};
  var st=typeof activity.start_date==='string'?Date.parse(activity.start_date):NaN;
  if(!isFinite(st))return {verified:false,reason:'bad_time'};
  var win=sessionWindow(session);
  if(!win)return {verified:false,reason:'no_session'};
  var el=num(activity.elapsed_time);if(el==null||el<dur)el=dur;
  var aEnd=st+el*1000;
  if(st>win[1]+VERIFY_NEAR_MS||aEnd<win[0]-VERIFY_NEAR_MS)return {verified:false,reason:'other_time'};
  return {verified:true,reason:'ok'};
}
// Событие webhook Strava → id новой активности или null (интересует только object_type=activity, aspect_type=create)
function stravaActivityId(ev){
  if(!ev||typeof ev!=='object'||ev.object_type!=='activity'||ev.aspect_type!=='create')return null;
  var id=num(ev.object_id);return id!=null&&id>0&&id%1===0?id:null;
}

var API={verifySession:verifySession,stravaActivityId:stravaActivityId,validCode:validCode,ttlFor:ttlFor,TTL_LINKED_S:TTL_LINKED_S,TTL_UNLINKED_S:TTL_UNLINKED_S,TZ_OFFSET_H:TZ_OFFSET_H,KINDS:KINDS,SNOOZE_MS:SNOOZE_MS,
  gameDayOf:gameDayOf,localMinutes:localMinutes,isQuiet:isQuiet,decide:decide,rollForward:rollForward,applySent:applySent,snooze:snooze,statusText:statusText,textFor:textFor};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.SRBot=API;
})(typeof globalThis!=='undefined'?globalThis:this);
