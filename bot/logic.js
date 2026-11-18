/* Шёлковый путь: чистая логика напоминаний (без сети и KV). UMD: Worker импортирует, node --test проверяет. */
(function(root){
'use strict';
var TZ_OFFSET_H=6; // Asia/Bishkek, без перехода на летнее время
var HOUR=3600*1000;
var DAY_SHIFT_H=3; // игровой день = местное время − 3 ч (как в game.js)
var KINDS=['morning','courses','last','alarm','weekly','nudge'];
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
// Дополнительные фразы (bot/phrases.json), подключаются через setExtra. Виды: morning, rest, courses, last, alarm, nudge.
// Плейсхолдеры в фразах: {reg} регион, {cons} последствие (для last), {w} {len} {t} {pct} (для morning).
var EXTRA={}, EXTRA_KINDS=['morning','rest','courses','last','alarm','nudge'];
function setExtra(obj){
  EXTRA={};
  if(!obj||typeof obj!=='object')return;
  EXTRA_KINDS.forEach(function(k){
    var a=obj[k];if(!Array.isArray(a))return;
    EXTRA[k]=a.filter(function(x){return typeof x==='string'&&x.length>=5&&x.length<=300;}).slice(0,60);
  });
}
function fill(t,vars){return t.replace(/\{(\w+)\}/g,function(m,k){return vars&&Object.prototype.hasOwnProperty.call(vars,k)?String(vars[k]):m;});}
var FORCE=null, LAST_PICK={i:0,n:1}; // FORCE — номер варианта для команды /test
function pickText(kind,variants,day,vars){
  var all=variants.concat(EXTRA[kind]||[]);
  var i=FORCE!=null?((FORCE%all.length)+all.length)%all.length:variantIdx(day,all.length);
  LAST_PICK={i:i,n:all.length};
  return fill(all[i],vars);
}

function morningText(s,day){
  if(s.isTrainDay){
    var w=s.workout||'A',len=s.short?'короткая':'полная',t=s.time||'21:30',reg=s.regionName||'врага',pct=Math.round(s.garrisonPct||0);
    return pickText('morning',[
      'Сегодня тренировка '+w+' ('+len+') в '+t+'. Гарнизон '+reg+': '+pct+'%.',
      'Шурпа сама себя не сварит. Тренировка '+w+' ('+len+') в '+t+' тоже. Гарнизон '+reg+': '+pct+'%.',
      'Шурпичи, подъём! Тренировка '+w+' ('+len+') в '+t+'. Гарнизон '+reg+' держится на '+pct+'%, а крипер уже шипит.',
      'Копейщики надели сандалии. А ты надел носки и лёг обратно? Тренировка '+w+' ('+len+') в '+t+', гарнизон '+reg+': '+pct+'%.',
      'Враг не спит. Тренировка '+w+' ('+len+') ждёт тебя в '+t+'. Гарнизон '+reg+': '+pct+'%. Не заставляй его ждать.',
      'Доброе утро. Хорошая новость: сегодня тренировка '+w+' ('+len+') в '+t+'. Плохая: гарнизон '+reg+' на '+pct+'%.'
    ],day,{reg:reg,w:w,len:len,t:t,pct:pct});
  }
  return pickText('rest',[
    'День отдыха: 10 минут мобильности и еда в норме.',
    'Сегодня отдых. Шурпа сама себя не сварит, так что поешь нормально и разомнись 10 минут (мобильность).',
    'Разведчики докладывают: тихо. Отдыхай, но 10 минут мобильности и еда по плану. Шурпичи следят.',
    'День отдыха. Даже крипер сегодня выходной. Сделай 10 минут мобильности и поешь по плану.'
  ],day);
}
function coursesText(s,day){
  var reg=s.regionName||'врага';
  return pickText('courses',[
    'Курсы закончились? Враг у ворот '+reg+'. Тренировка сама себя не сделает.',
    'Курсы закончились. Отмазки тоже. Врага не волнует твой дедлайн, он у ворот '+reg+'.',
    'Шурпичи, на построение! Враг у ворот '+reg+', а крипер уже шипит.',
    'Вечер. Ты ещё не в строю, а ворота '+reg+' ждут. Шурпа сама себя не сварит, тренировка тоже.',
    'Курсы позади, впереди бой. Ворота '+reg+' ждут твоих воинов.',
    'Слышишь шипение? Это не шурпа. Это враг у ворот '+reg+'. Пора на тренировку.'
  ],day,{reg:reg});
}
// Текст зависит от последствия СЛЕДУЮЩЕГО пропуска: miss 0 → набег, 1 → подкрепление, 2+ → осада
// Во всех вариантах обязательно присутствует cons (его проверяют тесты).
function lastText(s,day){
  var m=s.miss||0,cons;
  if(m<=0)cons='ночной набег: потеряешь часть воинов';
  else if(m===1)cons='ночной набег и подкрепление гарнизона';
  else cons='ночной набег и осада: можешь потерять регион';
  var what=s.isTrainDay?'Тренировку':'Отдых и еду';
  var v=[
    'Последний шанс. Если не засчитать день, ночью будет '+cons+'. '+what+' ещё можно успеть.',
    'Ты знаешь, что с тобой будет… Ночью тебя освитифоксят: '+cons+'. '+what+' ещё можно успеть.',
    'Скоро полночь. Пропуск дня означает '+cons+'. '+what+' ещё можно успеть.',
    'Это последнее напоминание. Нет, правда. (Нет, неправда: будет ещё одно.) Иначе ночью '+cons+'.',
    'Враг уже собирается у стен. Не отметишь день до полуночи, получишь '+cons+'.',
    'Шурпу уже сварили. Тебя ещё можно спасти: отметь день, иначе ночью '+cons+'.'
  ];
  if(m>=2)v.push('Тебя уже освитифоксили не раз. Шурпа это видит и молча осуждает. Ночью снова: '+cons+'.');
  if(m>=3)v.push('Ещё один пропуск, и тебя депортируют из региона. Вещи не собирай, всё равно отберут. Ночью: '+cons+'.');
  return pickText('last',v,day,{reg:s.regionName||'врага',cons:cons});
}
// Вечерняя тревога перед тихими часами (шутка про воздушную тревогу)
function alarmText(s,day){
  var reg=s.regionName||'врага';
  return pickText('alarm',[
    '🚨 ВОЗДУШНАЯ ТРЕВОГА! Слышно шипение. Это не шурпа. Отожмись, пока не поздно.',
    '🚨 Внимание! Гражданам '+reg+' пройти в укрытие. Или отметить день. Выбор за тобой.',
    '🚨 Тревога! Враг уже на подлёте к '+reg+'. До полуночи ещё можно всё исправить.',
    '🚨 Воздушная тревога. Это не учебная. Отметь день, пока крипер не дошёл до ворот '+reg+'.',
    '🚨 Миграционная служба врага выехала по твоему адресу. Спасёт только тренировка.',
    '🚨 ВНИМАНИЕ! Шурпичи уже в укрытии, а ты ещё нет. Отметь день.'
  ],day,{reg:reg});
}
function weeklyText(s,day){
  var a=s.weekSessions||0,b=s.weekTarget||0,ok=b>0&&a>=b;
  return pickText('weekly',[
    'Итоги недели: '+a+'/'+b+' тренировок. '+(ok?'План выполнен, армия растёт.':'Можно лучше: враг это запомнил.'),
    'Неделя закончилась. Тренировок: '+a+' из '+b+'. '+(ok?'Так держать. Шурпа гордилась бы тобой, если бы ты её не сварил.':'На следующей неделе добирай.'),
    'Сводка с границы: '+a+'/'+b+'. '+(ok?'Враг отступает.':'Враг осмелел, пора его проучить.'),
    'Шурпичи отчитываются: '+a+'/'+b+' тренировок. '+(ok?'Армия довольна.':'Крипер это запомнил.')
  ],day);
}
function nudgeText(day){
  return pickText('nudge',[
    'Давно не заходил в игру. Враг осмелел и копит силы. Загляни в лагерь.',
    'Тихо слишком долго. Разведчики не получали вестей уже несколько дней. Открой игру.',
    'Армия скучает по командиру. Загляни, отметь тренировку.',
    'Тебя нет несколько дней. Шурпичи в строю, а командир где-то освитифоксился?',
    'Это Шёлковый путь. Мы давно не виделись. Мы волнуемся. Враг тоже, но по другой причине.',
    'Тебя объявили в розыск. Враг ищет, шурпа остыла. Загляни в игру.'
  ],day);
}
function textFor(kind,s,day){
  if(kind==='morning')return morningText(s,day);
  if(kind==='courses')return coursesText(s,day);
  if(kind==='last')return lastText(s,day);
  if(kind==='alarm')return alarmText(s,day);
  if(kind==='weekly')return weeklyText(s,day);
  return nudgeText(day);
}

// Для команды /test: текст вида kind, вариант idx (0..n-1; null = как в обычной отправке). Возвращает {text,idx,n}
function textForVariant(kind,s,day,idx){
  FORCE=(typeof idx==='number'&&isFinite(idx))?idx:null;
  try{var text=textFor(kind,s,day);return {text:text,idx:LAST_PICK.i,n:LAST_PICK.n};}
  finally{FORCE=null;}
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
    if(mins>=23*60+10&&sent.alarm!==today)due.push('alarm');
    if(due.length){var k=due[due.length-1];out.push({kind:k,text:textFor(k,s,today),covers:due});}
  }
  if(dowOfDay(today)===0&&mins>=19*60&&sent.weekly!==today)out.push({kind:'weekly',text:weeklyText(s,today),covers:['weekly']});
  // Отложенные («+30 мин»)
  Object.keys(snooze).forEach(function(k){
    if(!(snooze[k]<=nowMs)||KINDS.indexOf(k)<0||k==='nudge'||k==='alarm')return;
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
  if(KINDS.indexOf(kind)<0||kind==='nudge'||kind==='alarm')return false;
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
  gameDayOf:gameDayOf,localMinutes:localMinutes,isQuiet:isQuiet,decide:decide,rollForward:rollForward,applySent:applySent,snooze:snooze,statusText:statusText,textFor:textFor,textForVariant:textForVariant,setExtra:setExtra};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.SRBot=API;
})(typeof globalThis!=='undefined'?globalThis:this);
