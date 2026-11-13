/* Шёлковый путь v2: чистая игровая логика (без DOM). Все функции принимают (state, now:Date, rng?) и мутируют state. */
(function(root){
'use strict';
var SR={};

/* ---------- Время ---------- */
function pad(n){return (n<10?'0':'')+n;}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
// День берём на полдень, чтобы переход на летнее время не сдвигал дату
function parseDay(s){var a=s.split('-');return new Date(+a[0],+a[1]-1,+a[2],12,0,0);}
function addDays(s,n){var d=parseDay(s);d.setDate(d.getDate()+n);return ymd(d);}
function diffDays(a,b){return Math.round((parseDay(b)-parseDay(a))/864e5);} // b - a
function dow(s){return parseDay(s).getDay();} // 0=вс..6=сб
// Игровой день: локальная дата (now − 3 ч), чтобы тренировка в 23:30 или 01:30 шла в зачёт вечера
function gameDay(now){return ymd(new Date(now.getTime()-3*3600*1000));}
function weekKey(day){return addDays(day,-((dow(day)+6)%7));} // понедельник недели

/* ---------- Каталог ---------- */
var UNITS=['spear','cav','arch','shield'];
var LADS=['push','squat','pull','core'];
var LAD_UNIT={push:'spear',squat:'cav',pull:'arch',core:'shield'};
var UNIT_NAMES={spear:'Копейщики',cav:'Конница',arch:'Лучники',shield:'Щитоносцы'};
var UNIT_GEN={spear:'копейщиков',cav:'всадников',arch:'лучников',shield:'щитоносцев'};
var UNIT_DOM={spear:'копейщики',cav:'конница',arch:'лучники',shield:'щитоносцы'};
var STATS={spear:{atk:3,hp:10},cav:{atk:4,hp:12},arch:{atk:3,hp:6},shield:{atk:1,hp:20}};
var SMITH_STEP=0.15;
var FOE_DMG=0.95; // множитель урона врага в бою (баланс, SPEC §9)
var PROV_MAX=7;
var NO_RETRO_DAYS=14;

// t = целевой результат теста (для проверки «слишком много повторов», флаг при reps > 2t)
var EXERCISES=[
 {id:'push_classic',n:'Отжимания классические',lad:'push',k:1,t:30},
 {id:'push_diamond',n:'Узкие (бриллиант)',lad:'push',k:1.3,t:12},
 {id:'push_feet',n:'Ноги на возвышении',lad:'push',k:1.5,t:10},
 {id:'push_pause',n:'Пауза 2 с внизу',lad:'push',k:1.8,t:8},
 {id:'push_archer',n:'Лучник',lad:'push',k:2.4,t:8},
 {id:'pike',n:'Пайк-отжимания (плечи)',lad:'push',k:1.6,t:12},
 {id:'squat_bp',n:'Приседания с рюкзаком',lad:'squat',k:0.7,t:20},
 {id:'lunge',n:'Выпады на месте',lad:'squat',k:0.7,t:15},
 {id:'bulgarian',n:'Болгарские сплит-приседания (на ногу)',lad:'squat',k:1.1,t:12},
 {id:'pistol',n:'Пистолет с опорой (на ногу)',lad:'squat',k:1.8,t:10},
 {id:'row_bp',n:'Тяга рюкзака в наклоне',lad:'pull',k:1.2,t:15},
 {id:'row_table',n:'Тяга под столом',lad:'pull',k:2,t:12},
 {id:'pull_band',n:'Подтягивания с резинкой',lad:'pull',k:2.5,t:10},
 {id:'pull_neg',n:'Негативные подтягивания (5 с вниз)',lad:'pull',k:3,t:5},
 {id:'pullup',n:'Подтягивания',lad:'pull',k:3.5,t:8},
 {id:'crunch',n:'Скручивания',lad:'core',k:0.5,t:25},
 {id:'legraise',n:'Подъём ног лёжа',lad:'core',k:0.8,t:15},
 {id:'plank',n:'Планка (10 с = 1)',lad:'core',k:1,t:15,unit:'10s'},
 {id:'plank_tap',n:'Планка с касанием плеч (10 с = 1)',lad:'core',k:1.4,t:9,unit:'10s'}
];
var EX={};EXERCISES.forEach(function(e){EX[e.id]=e;});
// Кузница: порядок открытия; r = «3×r в предыдущем» для теста
var LADDERS=[
 {id:'push',name:'Отжимания',tiers:[{ex:'push_classic'},{ex:'push_diamond',r:12},{ex:'push_feet',r:10},{ex:'push_pause',r:8},{ex:'push_archer',r:8}]},
 {id:'squat',name:'Ноги',tiers:[{ex:'squat_bp'},{ex:'lunge',r:15},{ex:'bulgarian',r:12},{ex:'pistol',r:10}]},
 {id:'pull',name:'Тяга и спина',tiers:[{ex:'row_bp'},{ex:'row_table',r:12},{ex:'pull_band',r:10},{ex:'pullup',req:'5 строгих подтягиваний подряд'}]},
 {id:'core',name:'Корпус',tiers:[{ex:'crunch'},{ex:'legraise',r:15},{ex:'plank',r:15},{ex:'plank_tap',req:'планка 3×60 с'}]}
];
// Всегда доступны в свободном режиме, но не входят в Кузницу
var EXTRA_FREE=['pike','pull_neg'];

var REGIONS=[
 {n:'Иссык-Куль',note:'Тёплое озеро в горах. Отсюда всё начинается.'},
 {n:'Алматы',note:'Город под склонами Заилийского Алатау.'},
 {n:'Ташкент',note:'Ворота Ферганы. Перевал держит страж.',boss:{what:'Отжимания подряд без остановки',unit:'повт.',target:20}},
 {n:'Самарканд',note:'Регистан и синие купола.'},
 {n:'Бухара',note:'Старые караван-сараи и торговые купола.'},
 {n:'Мерв',note:'Руины посреди Каракума. Перевал держит страж.',boss:{what:'Планка без перерыва',unit:'с',target:90}},
 {n:'Исфахан',note:'Площадь Накше-Джахан.'},
 {n:'Тебриз',note:'Самый большой в мире крытый базар.'},
 {n:'Стамбул',note:'Мост между Азией и Европой. Перевал держит страж.',boss:{what:'Отжимания подряд без остановки',unit:'повт.',target:30}},
 {n:'Рим',note:'Конец Великой дороги на суше.'},
 {n:'Париж',note:'Почти у океана.'},
 {n:'Лиссабон',note:'Край света. Последний страж.',boss:{what:'Отжимания подряд без остановки',unit:'повт.',target:40}}
];
var CARDS=[
 {t:'Засада',x:'3 подхода отжиманий до отказа.',p:50},
 {t:'Союзник',x:'Проведи тренировку до 12:00.',p:40},
 {t:'Осадная башня',x:'Планка: 3 подхода на максимум.',p:45},
 {t:'Разведка',x:'15 минут растяжки или мобильности.',p:30},
 {t:'Караван',x:'30 г белка в течение часа после тренировки.',p:35},
 {t:'Кузница',x:'Сделай один подход в варианте следующего уровня.',p:60},
 {t:'Лагерь',x:'Сон 8 часов подряд.',p:30},
 {t:'Переход',x:'Прогулка 6000 шагов в день без тренировки.',p:30}
];

/* ---------- Гарнизоны ---------- */
// Размер гарнизона по регионам (units). Подобран tests/balance.js, см. итоговую таблицу там же
var GARRISON_N=[18,34,52,72,94,118,144,172,204,238,274,312];
// Шаблоны состава: [копейщики, конница, лучники, щитоносцы] в %
var TEMPLATES=[[30,30,25,15],[20,45,20,15],[25,20,40,15],[30,15,20,35]];

function splitPct(total,pct){ // метод наибольших остатков: сумма всегда = total
  var raw=pct.map(function(p){return total*p/100;}),out=raw.map(Math.floor);
  var rem=total-out.reduce(function(a,b){return a+b;},0);
  var ord=raw.map(function(v,i){return {i:i,f:v-Math.floor(v)};}).sort(function(a,b){return b.f-a.f||a.i-b.i;});
  for(var j=0;j<rem;j++)out[ord[j%4].i]++;
  return out;
}
function spawnGarrison(r,scale){
  var total=Math.round(GARRISON_N[Math.min(r,GARRISON_N.length-1)]*(scale==null?1:scale));
  var c=splitPct(total,TEMPLATES[r%4]);
  return {spear:c[0],cav:c[1],arch:c[2],shield:c[3],base:total,reinf:0};
}
function count(side){return UNITS.reduce(function(a,u){return a+(side[u]||0);},0);}
function hpOf(side){return UNITS.reduce(function(a,u){return a+(side[u]||0)*STATS[u].hp;},0);}
function pick(side){return {spear:side.spear,cav:side.cav,arch:side.arch,shield:side.shield};}

/* ---------- Состояние ---------- */
function fresh(now){
  var t=gameDay(now||new Date());
  var s={v:2,updatedAt:0,region:0,gatePassed:false,total:0,
    army:{spear:0,cav:0,arch:0,shield:0},frac:{push:0,squat:0,pull:0,core:0},
    garrison:null,gold:0,
    upgrades:{walls:0,healer:0,scouts:0,smith:{spear:0,cav:0,arch:0,shield:0}},
    provisions:0,foodDays:[],trainDays:[],restDays:[],sessions:[],
    enemy:{miss:0,lastDay:addDays(t,-1),revenge:false,truceUntil:null,truceUsedMonth:{}},
    plan:{nextWorkout:'A',moved:null,weekStart:t},
    settings:{trainDow:[2,4,6],time:'21:30'},
    unlocked:{push:0,squat:0,pull:0,core:0},
    startWeight:null,weight:null,weightKg:0,card:null,log:[]};
  s.garrison=spawnGarrison(0,1);
  return s;
}
function isObj(x){return x&&typeof x==='object'&&!Array.isArray(x);}
function merge(dst,src){
  for(var k in src){
    if(isObj(dst[k])&&isObj(src[k]))merge(dst[k],src[k]);
    else if(src[k]!==undefined)dst[k]=src[k];
  }
}
function migrate(o,now){
  var f=fresh(now);
  if(!isObj(o))return f;
  if(o.v===2){
    merge(f,o);
  }else{
    // v1 → v2: общие поля копируем, очки переводим в войска, наказание за прошлое не применяем
    ['updatedAt','region','gatePassed','total','provisions','foodDays','trainDays','startWeight','weight','weightKg','card','log'].forEach(function(k){
      if(o[k]!==undefined)f[k]=o[k];
    });
    f.unlocked=Object.assign({push:0,squat:0,pull:0,core:0},o.unlocked||{});
    var n=Math.floor((o.progress||0)/10),each=Math.floor(n/4);
    f.army={spear:each+(n-each*4),cav:each,arch:each,shield:each};
    f.garrison=null;
  }
  if(f.region>=REGIONS.length)f.garrison=null;
  else if(!f.garrison)f.garrison=spawnGarrison(f.region,1);
  return f;
}

function addLog(s,day,k,t,p){s.log.unshift({d:day,k:k,t:t,p:p||0});if(s.log.length>100)s.log.length=100;}
function capPush(arr,v,n){arr.push(v);if(arr.length>n)arr.splice(0,arr.length-n);}

/* ---------- Расписание ---------- */
function isTrainDay(s,d){
  var m=s.plan.moved;
  if(m){if(d===m.fromDay)return false;if(d===m.toDay)return true;}
  return s.settings.trainDow.indexOf(dow(d))>=0;
}
function hasSession(s,d){return s.trainDays.indexOf(d)>=0;}
function planWeek(s,d){return Math.floor(diffDays(s.plan.weekStart,d)/7);}
function weekSessions(s,now){
  var d=gameDay(now),wk=weekKey(d),n=0;
  s.trainDays.forEach(function(x){if(x>=wk&&x<=d)n++;});
  return n;
}
function setSettings(s,trainDow,time){
  var seen={},ok=Array.isArray(trainDow)&&trainDow.every(function(x){
    if(!(x>=0&&x<=6)||x%1!==0||seen[x])return false;seen[x]=1;return true;});
  if(!ok||trainDow.length<2||trainDow.length>5)return {ok:false,text:'Выбери от 2 до 5 дней тренировок.'};
  if(!/^\d\d:\d\d$/.test(time||''))return {ok:false,text:'Время в формате ЧЧ:ММ.'};
  s.settings.trainDow=trainDow.slice().sort(function(a,b){return a-b;});s.settings.time=time;
  return {ok:true,text:'Настройки сохранены.'};
}

/* ---------- Программа ---------- */
function ex(id,sets,lo,hi,extra){var o={ex:id,sets:sets,lo:lo,hi:hi};if(extra)for(var k in extra)o[k]=extra[k];return o;}
function buildWorkout(s,w){
  var pullupOn=s.unlocked.pull>=3,pushEx=LADDERS[0].tiers[Math.min(s.unlocked.push,4)].ex,items;
  if(w==='A'){
    items=[pullupOn?ex('pullup',4,1,8,{max:true}):ex('pull_neg',4,3,3),
      ex(pushEx,4,8,15),ex('bulgarian',3,8,12),ex('row_bp',3,10,15),ex('plank',3,3,6)];
    items[0].rest=120;items[1].rest=120;items[2].rest=90;items[3].rest=90;items[4].rest=60;
  }else{
    items=[pullupOn?ex('pullup',4,1,8,{max:true}):ex('pull_band',4,5,8),
      ex('pike',3,6,12),ex('row_table',3,8,12),ex('squat_bp',4,12,20),ex('legraise',3,10,15)];
    items[0].rest=120;items[1].rest=120;items[2].rest=90;items[3].rest=90;items[4].rest=60;
  }
  return items;
}
// Программа дня: тренировка (A/B, короткая в будни, deload каждую 6-ю неделю) или день отдыха
function programFor(s,now){
  var d=gameDay(now),train=isTrainDay(s,d);
  if(!train)return {day:d,type:'rest',done:s.restDays.indexOf(d)>=0||hasSession(s,d)};
  var wk=planWeek(s,d),deload=wk>=0&&wk%6===5,wd=dow(d),full=(wd===0||wd===6);
  var items=buildWorkout(s,s.plan.nextWorkout);
  if(!full)items=items.slice(0,4);
  items=items.map(function(it){
    var o=Object.assign({},it);o.name=EX[it.ex].n;
    if(deload)o.sets=Math.ceil(it.sets/2);
    return o;
  });
  return {day:d,type:'train',workout:s.plan.nextWorkout,short:!full,deload:deload,items:items,done:hasSession(s,d),move:canMove(s,now)};
}
function canMove(s,now){
  var d=gameDay(now),t=addDays(d,1);
  if(!isTrainDay(s,d))return {ok:false,text:'Сегодня и так день отдыха.'};
  if(hasSession(s,d))return {ok:false,text:'Тренировка уже сделана.'};
  if(isTrainDay(s,t))return {ok:false,text:'Завтра тоже тренировка.'};
  if(s.plan.moved&&planWeek(s,s.plan.moved.fromDay)===planWeek(s,d))return {ok:false,text:'Перенос уже использован на этой неделе плана.'};
  return {ok:true};
}
function moveToTomorrow(s,now){
  var c=canMove(s,now);if(!c.ok)return c;
  var d=gameDay(now);s.plan.moved={fromDay:d,toDay:addDays(d,1)};
  addLog(s,d,'plan','Тренировка перенесена на завтра',0);
  return {ok:true,text:'Тренировка перенесена на завтра.'};
}
function markRest(s,now){
  var d=gameDay(now);if(s.restDays.indexOf(d)>=0)return {ok:false,text:'День отдыха уже засчитан.'};
  capPush(s.restDays,d,60);addLog(s,d,'rest','День отдыха: мобильность',0);
  return {ok:true,text:'Мобильность засчитана.'};
}
function availableEx(s){
  var out=[];
  LADDERS.forEach(function(l){
    l.tiers.forEach(function(t,i){if(i<=s.unlocked[l.id])out.push(t.ex);});
  });
  return out.concat(EXTRA_FREE);
}

/* ---------- Достоверность подходов ---------- */
// Правила честного режима: никогда не блокируют, только помечают подход (×0.5 в наборе войск)
var FLAG_TEXT={fast:'Слишком быстро после предыдущего подхода',bulk:'Записано пачкой',high:'Слишком много повторов для этого уровня'};
function flagSets(sets){
  var n=sets.length,i,fl=[];
  for(i=0;i<n;i++){
    var st=sets[i],e=EX[st.ex],f=null;
    if(e&&st.reps>2*e.t)f='high';
    if(i>0&&typeof st.ts==='number'&&typeof sets[i-1].ts==='number'){
      var gap=(st.ts-sets[i-1].ts)/1000,need=Math.max(15,st.reps*(e&&e.unit==='10s'?10:1));
      if(gap<need)f='fast';
    }
    fl.push(f);
  }
  // пачка: ≥3 подряд подхода, каждый зафиксирован < 20 с после предыдущего
  i=1;
  while(i<n){
    if((sets[i].ts-sets[i-1].ts)/1000<20){
      var a=i-1,b=i;
      while(b+1<n&&(sets[b+1].ts-sets[b].ts)/1000<20)b++;
      if(b-a+1>=3)for(var j=a;j<=b;j++)fl[j]='bulk';
      i=b+1;
    }else i++;
  }
  sets.forEach(function(st,k){if(fl[k])st.flag=fl[k];else delete st.flag;});
  return sets;
}
// Добавляет подход в черновик (ts = время нажатия ✓) и пересчитывает флаги
function addSet(draft,exId,reps,ts,pk){
  var st={ex:exId,reps:reps,ts:ts};if(pk)st.pk=pk;
  draft.push(st);flagSets(draft);return st;
}

/* ---------- Набор войск ---------- */
function calcMods(s,now){
  var t=gameDay(now),y=addDays(t,-1),y2=addDays(t,-2),y3=addDays(t,-3);
  function has(d){return s.trainDays.indexOf(d)>=0;}
  var m=1,tags=[],spend=false;
  if(s.provisions>0){spend=true;tags.push({t:'Провиант −1',c:'good'});}
  else{m*=0.5;tags.push({t:'Голод ×0.5',c:'bad'});}
  if(has(t)){m*=0.8;tags.push({t:'Второй поход за день ×0.8',c:'bad'});}
  else if(has(y)&&has(y2)){m*=0.8;tags.push({t:'Третий день подряд ×0.8',c:'bad'});}
  else if(!has(y)&&(has(y2)||has(y3))){m*=1.1;tags.push({t:'Отдохнувшая армия ×1.1',c:'good'});}
  if(s.enemy.revenge){m*=1.3;tags.push({t:'Месть ×1.3',c:'good'});}
  m=Math.max(0.4,Math.min(1.5,m));
  return {m:m,tags:tags,spend:spend};
}
function unitsText(u){
  var a=[];UNITS.forEach(function(k){if(u[k]>0)a.push('+'+u[k]+' '+UNIT_GEN[k]);});
  return a.length?a.join(', '):'';
}
// Чистый расчёт (без мутации): прогноз для превью и основа finishSession
function calcSession(s,draft,now){
  var raw={push:0,squat:0,pull:0,core:0},flagsSet={};
  draft.forEach(function(st){
    var e=EX[st.ex];if(!e)return;
    raw[e.lad]+=st.reps*e.k*(st.flag?0.5:1);
    if(st.flag)flagsSet[st.flag]=1;
  });
  var md=calcMods(s,now),pts={},units={},frac={},sumPts=0,sumRaw=0;
  LADS.forEach(function(g){
    pts[g]=raw[g]*md.m;
    var f=s.frac[g]+pts[g],u=Math.floor(f/10+1e-9);
    frac[g]=Math.round((f-u*10)*1e6)/1e6;if(frac[g]<0)frac[g]=0;
    units[LAD_UNIT[g]]=u;sumPts+=pts[g];sumRaw+=raw[g];
  });
  var flags=Object.keys(flagsSet);
  return {raw:raw,rawTotal:sumRaw,mult:md.m,tags:md.tags,spend:md.spend,pts:pts,total:Math.round(sumPts),
    units:units,frac:frac,flags:flags,ok:flags.length===0};
}
function finishSession(s,draft,now,opts){
  if(!draft||!draft.length)return null;
  flagSets(draft);
  var c=calcSession(s,draft,now),d=gameDay(now);
  if(c.rawTotal<=0)return null;
  UNITS.forEach(function(u){s.army[u]+=c.units[u];});
  s.frac=c.frac;s.total+=c.total;
  if(c.spend)s.provisions--;
  if(s.enemy.revenge)s.enemy.revenge=false;
  if(!hasSession(s,d))capPush(s.trainDays,d,60);
  var ts=draft.map(function(x){return x.ts;}).filter(function(x){return typeof x==='number';});
  capPush(s.sessions,{d:d,start:ts.length?Math.min.apply(null,ts):null,end:ts.length?Math.max.apply(null,ts):null,
    raw:Math.round(c.rawTotal),pts:c.total,mult:Math.round(c.mult*100)/100,flags:c.flags,
    sets:draft.map(function(x){var o={ex:x.ex,reps:x.reps,ts:x.ts};if(x.flag)o.flag=x.flag;return o;})},60);
  if(opts&&opts.program)s.plan.nextWorkout=s.plan.nextWorkout==='A'?'B':'A';
  var ut=unitsText(c.units);
  var text=(ut||'Новых воинов пока нет, очки копятся')+(c.ok?'. Проверено ✓':'. Есть сомнения ⚠');
  addLog(s,d,'session','Тренировка: '+(ut||'очки копятся')+(c.ok?'':' ⚠'),c.total);
  c.text=text;
  return c;
}
function saveWeight(s,v,now){
  var d=gameDay(now);
  if(!(v>=30&&v<=200))return {ok:false,text:'Введи вес в кг, например 62.5.'};
  s.weight=v;if(s.startWeight==null)s.startWeight=v;
  var kg=Math.floor(v-s.startWeight+1e-9),gain=0;
  while(s.weightKg<kg){s.weightKg++;gain++;s.army.cav+=2;s.army.spear+=2;}
  addLog(s,d,'weight','Вес: '+v.toFixed(1)+' кг'+(gain?' (+'+gain+' кг от старта)':''),0);
  return {ok:true,gain:gain,text:gain?'Флот прибыл: +'+(gain*2)+' всадников и +'+(gain*2)+' копейщиков.':'Вес записан.'};
}
function markFood(s,now,offset){
  var d=addDays(gameDay(now),offset);
  if(s.foodDays.indexOf(d)>=0)return {ok:false,text:'Этот день уже засчитан.'};
  if(s.provisions>=PROV_MAX)return {ok:false,text:'Мешок полон: '+PROV_MAX+' из '+PROV_MAX+'. Сначала сходи в поход.'};
  capPush(s.foodDays,d,60);s.provisions++;
  addLog(s,gameDay(now),'food','Провиант: '+(offset?'вчера':'сегодня'),0);
  return {ok:true,text:'Провиант +1.'};
}
function unlockTier(s,id,now){
  var l=LADDERS.filter(function(x){return x.id===id;})[0];
  if(!l||s.unlocked[id]>=l.tiers.length-1)return {ok:false};
  s.unlocked[id]++;var n=EX[l.tiers[s.unlocked[id]].ex].n;
  addLog(s,gameDay(now),'forge','Открыто: '+n,0);
  return {ok:true,text:'Новый уровень: '+n+'.'};
}
function drawCard(s,now,rng){
  var d=gameDay(now),id=Math.floor((rng||Math.random)()*CARDS.length);
  s.card={wk:weekKey(d),id:id,done:false};
}
function claimCard(s,now){
  if(!s.card||s.card.done)return {ok:false};
  var c=CARDS[s.card.id];s.card.done=true;s.gold+=c.p;
  addLog(s,gameDay(now),'card','Карта: '+c.t+' (+'+c.p+' золота)',0);
  return {ok:true,gold:c.p,text:'Задание выполнено: +'+c.p+' золота.'};
}

/* ---------- Магазин ---------- */
var SHOP={walls:[60,120,200],healer:[80],scouts:[40],smith:[50,100,150]};
var WALLS_CUT=[0,0.25,0.45,0.6];
function shopInfo(s,item,type){
  var lvl=item==='smith'?s.upgrades.smith[type]:s.upgrades[item],costs=SHOP[item],max=costs.length;
  return {lvl:lvl,max:max,cost:lvl<max?costs[lvl]:null,can:lvl<max&&s.gold>=costs[lvl]};
}
function buy(s,item,type,now){
  var i=shopInfo(s,item,type);
  if(i.lvl>=i.max)return {ok:false,text:'Уже куплено.'};
  if(s.gold<i.cost)return {ok:false,text:'Не хватает золота.'};
  s.gold-=i.cost;
  if(item==='smith')s.upgrades.smith[type]++;else s.upgrades[item]++;
  addLog(s,gameDay(now),'shop','Куплено: '+(item==='smith'?'кузнец, '+UNIT_DOM[type]:item)+' (−'+i.cost+' золота)',0);
  return {ok:true,text:'Куплено.'};
}

/* ---------- Битва ---------- */
// Урон стороне: щиты принимают 60% пока живы, остальное делится по числу юнитов; bonusType получает ×1.5 (контр-бонус)
function applyDamage(side,acc,dmg,bonusType){
  if(dmg<=0)return;
  var alive=UNITS.filter(function(u){return side[u]>0;});if(!alive.length)return;
  var others=alive.filter(function(u){return u!=='shield';}),sh={};
  if(side.shield>0&&others.length){
    sh.shield=0.6;var oc=others.reduce(function(a,u){return a+side[u];},0);
    others.forEach(function(u){sh[u]=0.4*side[u]/oc;});
  }else if(side.shield>0)sh.shield=1;
  else{var tc=count(side);alive.forEach(function(u){sh[u]=side[u]/tc;});}
  alive.forEach(function(u){
    var d=dmg*(sh[u]||0);if(u===bonusType)d*=1.5;
    acc[u]+=d;
    var k=Math.min(side[u],Math.floor(acc[u]/STATS[u].hp+1e-9));
    side[u]-=k;acc[u]-=k*STATS[u].hp;if(side[u]===0)acc[u]=0;
  });
}
function lostText(before,after){
  var a=[];UNITS.forEach(function(u){if(before[u]>after[u])a.push(before[u]-after[u]);});
  return a.length?a.reduce(function(x,y){return x+y;},0):0;
}
function simulateBattle(you,foe,smith,rng){
  var A=pick(you),B=pick(foe),accA={spear:0,cav:0,arch:0,shield:0},accB={spear:0,cav:0,arch:0,shield:0},rounds=[];
  function sm(u){return 1+SMITH_STEP*((smith&&smith[u])||0);}
  for(var r=1;r<=6&&count(A)>0&&count(B)>0;r++){
    // залп: оба урона считаем от состояния до залпа
    var pa0=pick(A),pb0=pick(B);
    var ra=1+(rng()*2-1)*0.15,rb=1+(rng()*2-1)*0.15;
    var dA=A.arch*STATS.arch.atk*sm('arch')*ra,dB=B.arch*STATS.arch.atk*FOE_DMG*rb;
    applyDamage(B,accB,dA,null);applyDamage(A,accA,dB,null);
    rounds.push({round:r,phase:'volley',you:pick(A),foe:pick(B),
      text:'Залп: враг теряет '+lostText(pb0,B)+', ты теряешь '+lostText(pa0,A)});
    if(!count(A)||!count(B))break;
    // ближний бой: одновременно, от состояния до боя
    pa0=pick(A);pb0=pick(B);
    var mA={spear:A.spear*STATS.spear.atk*sm('spear'),cav:A.cav*STATS.cav.atk*sm('cav'),shield:A.shield*STATS.shield.atk*sm('shield')};
    var mB={spear:B.spear*STATS.spear.atk*FOE_DMG,cav:B.cav*STATS.cav.atk*FOE_DMG,shield:B.shield*STATS.shield.atk*FOE_DMG};
    applyDamage(B,accB,mA.spear,'cav');applyDamage(B,accB,mA.cav,'arch');applyDamage(B,accB,mA.shield,null);
    applyDamage(A,accA,mB.spear,'cav');applyDamage(A,accA,mB.cav,'arch');applyDamage(A,accA,mB.shield,null);
    rounds.push({round:r,phase:'melee',you:pick(A),foe:pick(B),
      text:'Рукопашная: враг теряет '+lostText(pb0,B)+', ты теряешь '+lostText(pa0,A)});
  }
  return {you:A,foe:B,rounds:rounds};
}
function bossReady(s){
  var r=REGIONS[s.region];
  return !!(r&&r.boss&&s.garrison&&count(s.garrison)===0&&!s.gatePassed);
}
function conquer(s,day){
  var r=REGIONS[s.region],loot=20+10*s.region;
  s.gold+=loot;addLog(s,day,'region','Завоёван регион: '+r.n+' (+'+loot+' золота)',0);
  s.region++;s.gatePassed=false;
  s.garrison=s.region<REGIONS.length?spawnGarrison(s.region,1):null;
  return loot;
}
function attack(s,rng,now){
  rng=rng||Math.random;now=now||new Date();
  var d=gameDay(now);
  if(s.region>=REGIONS.length)return {ok:false,reason:'done',text:'Кампания пройдена.'};
  if(bossReady(s))return {ok:false,reason:'gate',text:'Гарнизон разбит. Брось вызов стражу.'};
  if(count(s.army)===0)return {ok:false,reason:'noarmy',text:'В армии никого нет.'};
  var you0=pick(s.army),foe0=pick(s.garrison);
  var res=simulateBattle(you0,foe0,s.upgrades.smith,rng);
  var lost={},healed={},you=res.you;
  UNITS.forEach(function(u){
    lost[u]=you0[u]-you[u];healed[u]=0;
    if(s.upgrades.healer&&lost[u]>0){healed[u]=Math.round(lost[u]*0.35);you[u]+=healed[u];}
  });
  UNITS.forEach(function(u){s.army[u]=you[u];s.garrison[u]=res.foe[u];});
  var victory=count(res.foe)===0,outcome=victory?'victory':(count(you)===0?'defeat':'retreat');
  var totalLost=UNITS.reduce(function(a,u){return a+lost[u]-healed[u];},0);
  var out={ok:true,outcome:outcome,rounds:res.rounds,you0:you0,foe0:foe0,you:pick(s.army),foe:pick(res.foe),
    lost:lost,healed:healed,totalLost:totalLost,loot:0,conquered:null,bossAppears:false};
  var region=REGIONS[s.region];
  if(victory){
    if(region.boss&&!s.gatePassed){out.bossAppears=true;addLog(s,d,'battle','Гарнизон '+region.n+' разбит, появился страж',0);}
    else{out.conquered=region.n;out.loot=conquer(s,d);}
  }else addLog(s,d,'battle','Бой за '+region.n+': потери '+totalLost+', гарнизон ослаблен',0);
  return out;
}
function passBoss(s,v,now){
  var r=REGIONS[s.region];
  if(!r||!r.boss||!bossReady(s))return {ok:false,text:'Сначала сломи гарнизон.'};
  if(!(v>=0))return {ok:false,text:'Введи результат попытки.'};
  var d=gameDay(now||new Date());
  if(v>=r.boss.target){
    s.gatePassed=true;addLog(s,d,'boss','Страж побеждён: '+r.n+' ('+v+' '+r.boss.unit+')',0);
    var name=r.n,loot=conquer(s,d);
    return {ok:true,passed:true,conquered:name,loot:loot,text:'Страж побеждён! Завоёван регион: '+name+' (+'+loot+' золота).'};
  }
  return {ok:true,passed:false,text:'Не хватило: '+v+' из '+r.boss.target+' '+r.boss.unit+'. Потренируйся и попробуй снова.'};
}
// Что видит игрок о гарнизоне: точные числа только со скаутами
function garrisonView(s){
  var g=s.garrison;if(!g)return null;
  var tot=count(g),best=UNITS.slice().sort(function(a,b){return g[b]-g[a];})[0];
  var approx=Math.round(tot/5)*5;
  return {exact:!!s.upgrades.scouts,counts:pick(g),total:tot,
    approx:'≈'+(tot>0?Math.max(5,approx):0)+(tot>0?', в основном '+UNIT_DOM[best]:'')};
}

/* ---------- Ход врага ---------- */
function threat(s){
  var m=s.enemy.miss,lv=Math.min(3,m);
  return {level:lv,text:['спокойно','набег','подкрепление','осада'][lv]};
}
function raid(s){
  var tot=count(s.army);if(tot===0)return 0;
  var f=0.10*(1-WALLS_CUT[s.upgrades.walls])*(1-Math.min(0.5,s.army.shield/tot)),lost=0;
  UNITS.forEach(function(u){
    var n=s.army[u];if(n<=0)return;
    var l=Math.min(n,Math.max(1,Math.floor(n*f)));s.army[u]-=l;lost+=l;
  });
  return lost;
}
function reinforce(s){
  var g=s.garrison;if(!g)return 0;
  var add=Math.min(Math.round(0.15*g.base),Math.floor(0.5*g.base)-g.reinf);
  if(add<=0)return 0;
  var c=splitPct(add,TEMPLATES[s.region%4]);
  g.spear+=c[0];g.cav+=c[1];g.arch+=c[2];g.shield+=c[3];g.reinf+=add;
  return add;
}
function processDays(s,now){
  var y=addDays(gameDay(now),-1),events=[];
  if(s.enemy.lastDay>=y)return events;
  if(s.region>=REGIONS.length){s.enemy.lastDay=y;return events;}
  var start=addDays(s.enemy.lastDay,1);
  if(diffDays(start,y)>=NO_RETRO_DAYS)start=addDays(y,-(NO_RETRO_DAYS-1));
  for(var d=start;d<=y;d=addDays(d,1)){
    if(s.enemy.truceUntil&&d<=s.enemy.truceUntil)continue; // перемирие: без штрафов и без дани
    var met=isTrainDay(s,d)?hasSession(s,d):(hasSession(s,d)||s.restDays.indexOf(d)>=0);
    s.gold+=3*s.region;
    if(met){s.enemy.miss=0;continue;}
    s.enemy.miss++;s.enemy.revenge=true;
    var m=s.enemy.miss,lost=raid(s),text;
    text='Набег: '+(lost?'−'+lost+' воинов':'терять нечего');
    events.push({day:d,kind:'raid',lost:lost,text:text});addLog(s,d,'enemy',text,0);
    if(m===2){
      var add=reinforce(s);
      if(add){text='Подкрепление: гарнизон +'+add;events.push({day:d,kind:'reinf',add:add,text:text});addLog(s,d,'enemy',text,0);}
    }
    if(m%3===0&&s.region>0){
      s.region--;s.gatePassed=false;s.garrison=spawnGarrison(s.region,0.6);
      text='Осада: потерян регион '+REGIONS[s.region].n;
      events.push({day:d,kind:'siege',region:s.region,text:text});addLog(s,d,'enemy',text,0);
    }
  }
  s.enemy.lastDay=y;
  return events;
}
function startTruce(s,now,days){
  var d=gameDay(now),month=d.slice(0,7);
  days=Math.max(1,Math.min(7,days|0));
  if(s.enemy.truceUntil&&s.enemy.truceUntil>=d)return {ok:false,text:'Перемирие уже идёт.'};
  if(s.enemy.truceUsedMonth[month])return {ok:false,text:'В этом месяце перемирие уже использовано.'};
  s.enemy.truceUsedMonth[month]=true;s.enemy.truceUntil=addDays(d,days-1);
  addLog(s,d,'truce','Перемирие на '+days+' дн.',0);
  return {ok:true,text:'Перемирие до '+s.enemy.truceUntil+'.'};
}

/* ---------- Экспорт ---------- */
Object.assign(SR,{
  gameDay:gameDay,addDays:addDays,diffDays:diffDays,dow:dow,weekKey:weekKey,ymd:ymd,
  UNITS:UNITS,LADS:LADS,LAD_UNIT:LAD_UNIT,UNIT_NAMES:UNIT_NAMES,UNIT_GEN:UNIT_GEN,STATS:STATS,PROV_MAX:PROV_MAX,
  EXERCISES:EXERCISES,EX:EX,LADDERS:LADDERS,REGIONS:REGIONS,CARDS:CARDS,SHOP:SHOP,WALLS_CUT:WALLS_CUT,
  GARRISON_N:GARRISON_N,TEMPLATES:TEMPLATES,FLAG_TEXT:FLAG_TEXT,
  fresh:fresh,migrate:migrate,spawnGarrison:spawnGarrison,count:count,hpOf:hpOf,
  isTrainDay:isTrainDay,hasSession:hasSession,planWeek:planWeek,weekSessions:weekSessions,setSettings:setSettings,
  programFor:programFor,canMove:canMove,moveToTomorrow:moveToTomorrow,markRest:markRest,availableEx:availableEx,
  flagSets:flagSets,addSet:addSet,calcMods:calcMods,calcSession:calcSession,finishSession:finishSession,unitsText:unitsText,
  saveWeight:saveWeight,markFood:markFood,unlockTier:unlockTier,drawCard:drawCard,claimCard:claimCard,
  shopInfo:shopInfo,buy:buy,simulateBattle:simulateBattle,attack:attack,bossReady:bossReady,passBoss:passBoss,conquer:conquer,
  garrisonView:garrisonView,threat:threat,processDays:processDays,startTruce:startTruce,addLog:addLog
});
if(typeof module!=='undefined'&&module.exports)module.exports=SR;else root.SR=SR;
})(this);
