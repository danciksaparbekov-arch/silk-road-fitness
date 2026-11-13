/* Шёлковый путь: отправка минимального состояния боту напоминаний (Cloudflare Worker).
   Если WORKER_URL пуст, ничего не отправляется и блок «Напоминания» показывает, что бот не настроен. */
(function(root){
'use strict';
// Заполнить после деплоя бота (см. bot/README.md)
var WORKER_URL='';   // например https://silk-road-bot.<аккаунт>.workers.dev
var BOT_USERNAME=''; // имя бота без @, например silk_road_fit_bot

var timer=null;

function configured(){return !!(WORKER_URL&&BOT_USERNAME);}
function genCode(){
  var a=new Uint8Array(16),out='',al='abcdefghijklmnopqrstuvwxyz0123456789';
  root.crypto.getRandomValues(a);
  for(var i=0;i<a.length;i++)out+=al.charAt(a[i]%36);
  return out;
}
function ensureCode(S){
  if(!/^[a-z0-9]{16}$/.test(S.settings.linkCode||''))S.settings.linkCode=genCode();
  return S.settings.linkCode;
}
function linkUrl(S){return 'https://t.me/'+BOT_USERNAME+'?start='+(S.settings.linkCode||'');}

// Минимальный набор полей: ничего лишнего (вес, журнал, золото и т.д. не уходят)
function buildPayload(S,now){
  var SR=root.SR,p=SR.programFor(S,now),day=SR.gameDay(now),g=S.garrison,pct=0;
  if(g){var cap=(g.base||0)+(g.reinf||0);pct=cap>0?Math.max(0,Math.min(100,Math.round(SR.count(g)/cap*100))):0;}
  var reg=SR.REGIONS[S.region];
  return {
    gameDay:day,
    trainDow:S.settings.trainDow.slice(),
    time:S.settings.time,
    normMet:!!p.done,
    isTrainDay:p.type==='train',
    truce:!!(S.enemy.truceUntil&&S.enemy.truceUntil>=day),
    truceUntil:S.enemy.truceUntil?String(S.enemy.truceUntil).slice(0,10):'',
    region:S.region,
    regionName:String(reg?reg.n:'Лиссабон').slice(0,40),
    garrisonPct:pct,
    miss:S.enemy.miss||0,
    workout:S.plan.nextWorkout==='B'?'B':'A',
    short:!!p.short,
    weekSessions:SR.weekSessions(S,now),
    weekTarget:S.settings.trainDow.length
  };
}

function send(S){
  if(!configured()||!/^[a-z0-9]{16}$/.test(S.settings.linkCode||''))return;
  try{
    fetch(WORKER_URL.replace(/\/+$/,'')+'/sync',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:S.settings.linkCode,s:buildPayload(S,new Date())}),keepalive:true
    }).catch(function(){});
  }catch(e){}
}
// Отправка с задержкой 2 с (несколько сохранений подряд = один запрос)
function schedule(S){
  if(!configured())return;
  clearTimeout(timer);
  timer=setTimeout(function(){send(S);},2000);
}

root.SRSync={configured:configured,ensureCode:ensureCode,linkUrl:linkUrl,buildPayload:buildPayload,schedule:schedule,send:send};
})(typeof window!=='undefined'?window:this);
