'use strict';
// Тесты игровой логики: node --test tests/
var test=require('node:test'),assert=require('node:assert/strict');
var SR=require('../game.js');

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
var MON=function(h,m){return new Date(2026,0,5,h||12,m||0);}; // 2026-01-05 понедельник
function at(day,h,m){return new Date(2026,0,day,h||12,m||0);}
function army(n){return {spear:n,cav:n,arch:n,shield:n};}

test('gameDay: 02:00 идёт в зачёт вечера, 23:30 остаётся тем же днём',function(){
  assert.equal(SR.gameDay(new Date(2026,0,6,2,0)),'2026-01-05');
  assert.equal(SR.gameDay(new Date(2026,0,6,2,59)),'2026-01-05');
  assert.equal(SR.gameDay(new Date(2026,0,6,3,0)),'2026-01-06');
  assert.equal(SR.gameDay(new Date(2026,0,5,23,30)),'2026-01-05');
  assert.equal(SR.gameDay(new Date(2026,0,1,1,30)),'2025-12-31');
});

test('миграция v1 → v2',function(){
  var v1={v:1,updatedAt:5,region:1,progress:57,gatePassed:true,provisions:3,foodDays:['2026-01-01'],trainDays:['2026-01-02'],
    unlocked:{push:2,squat:1,pull:0,core:0},startWeight:60,weight:62,weightKg:2,card:null,log:[{d:'2026-01-02',k:'x',t:'t',p:1}],total:300};
  var s=SR.migrate(v1,MON());
  assert.equal(s.v,2);
  assert.deepEqual(s.army,{spear:2,cav:1,arch:1,shield:1}); // floor(57/10)=5: по 1, остаток в копейщиков
  assert.equal(s.region,1);assert.equal(s.gatePassed,true);assert.equal(s.total,300);
  assert.equal(s.garrison.base,SR.GARRISON_N[1]);assert.equal(SR.count(s.garrison),SR.GARRISON_N[1]);
  assert.equal(s.enemy.lastDay,'2026-01-04');assert.equal(s.plan.weekStart,'2026-01-05');
  assert.deepEqual(s.unlocked,{push:2,squat:1,pull:0,core:0});
  assert.equal(s.weightKg,2);assert.deepEqual(s.settings.trainDow,[2,4,6]);assert.equal(s.gold,0);
  var again=SR.migrate(JSON.parse(JSON.stringify(s)),MON());
  assert.deepEqual(again,s);
});

test('набор войск: остаток очков переносится (frac)',function(){
  var s=SR.fresh(MON());s.provisions=1;s.frac.push=7;
  var draft=[];SR.addSet(draft,'push_classic',5,1000);
  var r=SR.finishSession(s,draft,MON());
  assert.equal(r.mult,1);assert.equal(s.army.spear,1);assert.ok(Math.abs(s.frac.push-2)<1e-9);
  assert.equal(s.total,5);assert.equal(s.provisions,0);assert.ok(SR.hasSession(s,'2026-01-05'));
  // 4 группы: приседания → конница, тяга → лучники, корпус → щитоносцы
  var s2=SR.fresh(MON());s2.provisions=1;var d2=[];
  SR.addSet(d2,'squat_bp',20,0);SR.addSet(d2,'row_bp',10,60000);SR.addSet(d2,'crunch',20,120000);
  SR.finishSession(s2,d2,MON());
  assert.equal(s2.army.cav,1);assert.equal(s2.army.arch,1);assert.equal(s2.army.shield,1);
  assert.ok(Math.abs(s2.frac.squat-4)<1e-9);assert.ok(Math.abs(s2.frac.pull-2)<1e-9);
});

test('множители: голод, второй поход, месть и зажим [0.4;1.5]',function(){
  var s=SR.fresh(MON());
  assert.equal(SR.calcMods(s,MON()).m,0.5); // голод
  s.provisions=2;s.trainDays=['2026-01-05'];
  assert.equal(SR.calcMods(s,MON()).m,0.8);
  s.enemy.revenge=true;
  assert.ok(Math.abs(SR.calcMods(s,MON()).m-1.04)<1e-9);
  var h=SR.fresh(MON());h.enemy.revenge=true;h.trainDays=['2026-01-05'];
  assert.equal(SR.calcMods(h,MON()).m,0.52); // 0.5*0.8*1.3
  h.trainDays=[];h.provisions=1;h.enemy.revenge=true;h.trainDays=['2026-01-02'];
  assert.ok(SR.calcMods(h,MON()).m<=1.5);
});

test('бой детерминирован при одинаковом seed',function(){
  var a=SR.fresh(MON()),b=SR.fresh(MON());
  a.army=army(12);b.army=army(12);
  var ra=SR.attack(a,mulberry32(7),MON()),rb=SR.attack(b,mulberry32(7),MON());
  assert.deepEqual(ra,rb);assert.deepEqual(a,b);
  var c=SR.fresh(MON());c.army=army(12);
  var rc=SR.attack(c,mulberry32(8),MON());
  assert.ok(ra.rounds.length>0&&rc.rounds.length>0);
});

test('контры: копейщик ×1.5 против конницы, конница ×1.5 против лучников',function(){
  var half=function(){return 0.5;};
  var r=SR.simulateBattle({spear:10,cav:0,arch:0,shield:0},{spear:0,cav:10,arch:0,shield:0},null,half);
  var melee=r.rounds[1]; // раунд 1: залп, затем рукопашная
  assert.equal(melee.foe.cav,7);   // 10*3*1.5=45 урона → 3 убито (hp12)
  assert.equal(melee.you.spear,6); // 10*4=40 урона по копейщикам без бонуса → 4 убито
  var r2=SR.simulateBattle({spear:0,cav:10,arch:0,shield:0},{spear:0,cav:0,arch:10,shield:0},null,half);
  assert.equal(r2.rounds[0].you.cav,8);  // залп 30 урона → 2 убито
  assert.equal(r2.rounds[1].foe.arch,2); // 8*4*1.5=48 → 8 лучников
});

test('щиты принимают 60% урона и кузнец усиливает атаку',function(){
  var r=SR.simulateBattle({spear:10,cav:0,arch:0,shield:10},{spear:20,cav:0,arch:0,shield:0},null,function(){return 0.5;});
  var m=r.rounds[1];
  assert.equal(m.you.shield,9);assert.equal(m.you.spear,8); // 60 урона: 36 щитам (1 убит), 24 копейщикам (2 убито)
  assert.equal(m.foe.spear,16);                              // 30+10=40 урона → 4 убито
  var smith={spear:2,cav:0,arch:0,shield:0};
  var r2=SR.simulateBattle({spear:20,cav:0,arch:0,shield:0},{spear:40,cav:0,arch:0,shield:0},smith,function(){return 0.5;});
  var r3=SR.simulateBattle({spear:20,cav:0,arch:0,shield:0},{spear:40,cav:0,arch:0,shield:0},null,function(){return 0.5;});
  assert.ok(r2.rounds[1].foe.spear<r3.rounds[1].foe.spear); // ×1.3: 78 урона против 60
});

test('лекарь возвращает 35% потерь, победа даёт золото и следующий гарнизон',function(){
  var s=SR.fresh(MON());s.army=army(8);s.upgrades.healer=1;
  var r=SR.attack(s,mulberry32(3),MON());
  SR.UNITS.forEach(function(u){
    assert.equal(r.healed[u],Math.round(0.35*r.lost[u]));
    assert.equal(s.army[u],r.you0[u]-r.lost[u]+r.healed[u]);
  });
  var w=SR.fresh(MON());w.army=army(200);
  var rw=SR.attack(w,mulberry32(1),MON());
  assert.equal(rw.outcome,'victory');assert.equal(rw.conquered,'Иссык-Куль');
  assert.equal(w.region,1);assert.equal(w.gold,20);assert.equal(w.garrison.base,SR.GARRISON_N[1]);
});

test('регион со стражем: гарнизон → страж → завоевание',function(){
  var s=SR.fresh(MON());s.region=2;s.garrison=SR.spawnGarrison(2,1);s.army=army(300);
  var r=SR.attack(s,mulberry32(2),MON());
  assert.equal(r.outcome,'victory');assert.equal(r.bossAppears,true);assert.equal(s.region,2);
  assert.equal(SR.bossReady(s),true);
  assert.equal(SR.attack(s,mulberry32(2),MON()).reason,'gate');
  assert.equal(SR.passBoss(s,10,MON()).passed,false);
  var p=SR.passBoss(s,20,MON());
  assert.equal(p.passed,true);assert.equal(s.region,3);assert.equal(s.gold,40);
});

function missState(region){
  var s=SR.fresh(MON());s.army=army(100);s.region=region;
  s.garrison=SR.spawnGarrison(region,1);s.enemy.lastDay='2026-01-05';return s;
}
test('processDays: пропуск 1 → набег',function(){
  var s=missState(0),ev=SR.processDays(s,at(7)); // обрабатывается вт 6 янв (тренировка)
  assert.equal(s.enemy.miss,1);assert.equal(s.enemy.revenge,true);
  assert.equal(ev.length,1);assert.equal(ev[0].kind,'raid');
  assert.equal(ev[0].lost,28); // 10%·(1−0.25 щитов) = 7.5% → floor(7.5)=7 с каждого из 4 типов
  assert.equal(SR.count(s.army),372);assert.equal(s.enemy.lastDay,'2026-01-06');
  assert.equal(SR.processDays(s,at(7)).length,0); // повторно тот же день не обрабатывается
});
test('processDays: пропуск 2 → набег и подкрепление (кап 50%)',function(){
  var s=missState(0),base=SR.count(s.garrison);
  var ev=SR.processDays(s,at(8)); // вт, ср (день отдыха без отметки)
  assert.equal(s.enemy.miss,2);
  assert.deepEqual(ev.map(function(e){return e.kind;}),['raid','raid','reinf']);
  assert.equal(SR.count(s.garrison),base+3);assert.equal(s.garrison.reinf,3);
  s.garrison.reinf=9; // кап = 50% от 18
  assert.equal(SR.count(s.garrison)>base,true);
});
test('processDays: пропуск 3 → осада (регион −1, гарнизон 60%)',function(){
  var s=missState(2);s.gatePassed=true;
  var ev=SR.processDays(s,at(9)); // вт, ср, чт
  assert.equal(s.enemy.miss,3);assert.equal(ev[ev.length-1].kind,'siege');
  assert.equal(s.region,1);assert.equal(s.gatePassed,false);
  assert.equal(SR.count(s.garrison),Math.round(SR.GARRISON_N[1]*0.6));
  assert.equal(s.gold,18); // дань 3×2 за каждый из 3 дней (в день осады дань начисляется до неё)
});
test('processDays: выполненные дни сбрасывают счётчик, дань начисляется',function(){
  var s=missState(1);s.enemy.miss=2;s.trainDays=['2026-01-06'];s.restDays=['2026-01-07'];
  var ev=SR.processDays(s,at(8)); // вт — тренировка есть; ср — отметка мобильности
  assert.equal(ev.length,0);assert.equal(s.enemy.miss,0);assert.equal(s.gold,6);
});
test('processDays: не больше 14 дней',function(){
  var s=missState(0);s.army=army(1000);
  var ev=SR.processDays(s,at(5+60));
  assert.ok(ev.length<=14*3);assert.equal(s.enemy.lastDay,SR.addDays(SR.gameDay(at(65)),-1));
});

test('перемирие: дни пропускаются, раз в месяц, до 7 дней',function(){
  var s=missState(1);
  var t=SR.startTruce(s,at(6),20); // зажимается до 7 дней
  assert.equal(t.ok,true);assert.equal(s.enemy.truceUntil,'2026-01-12');
  assert.equal(SR.startTruce(s,at(6),3).ok,false);
  s.enemy.lastDay='2026-01-05';
  var ev=SR.processDays(s,at(13)); // обрабатываются 6..12 — все в перемирии
  assert.equal(ev.length,0);assert.equal(s.enemy.miss,0);assert.equal(s.gold,0);
  assert.equal(SR.startTruce(s,at(20),2).ok,false); // тот же месяц
  assert.equal(SR.startTruce(s,new Date(2026,1,3,12),2).ok,true);
});

test('месть: после пропуска следующая тренировка ×1.3 и флаг снимается',function(){
  var s=missState(0);SR.processDays(s,at(7));
  assert.equal(s.enemy.revenge,true);s.provisions=1;
  var d=[];SR.addSet(d,'push_classic',10,0);
  var r=SR.finishSession(s,d,at(7,12));
  assert.ok(Math.abs(r.mult-1.3)<1e-9);assert.equal(s.enemy.revenge,false);
  assert.ok(r.tags.some(function(t){return /Месть/.test(t.t);}));
});

test('достоверность: быстро, пачкой, слишком много повторов',function(){
  var d=[],t=1e6;
  SR.addSet(d,'push_classic',10,t);
  SR.addSet(d,'push_classic',10,t+5000);       // 5 с < max(15, 10)
  assert.equal(d[1].flag,'fast');
  SR.addSet(d,'push_classic',10,t+60000);      // 55 с — нормально
  assert.equal(d[2].flag,undefined);
  var p=[];SR.addSet(p,'plank',6,t);SR.addSet(p,'plank',6,t+40000); // 40 с < 60 с (10 с на единицу)
  assert.equal(p[1].flag,'fast');
  var b=[];SR.addSet(b,'push_classic',1,t);SR.addSet(b,'push_classic',1,t+10000);SR.addSet(b,'push_classic',1,t+20000);
  assert.deepEqual(b.map(function(x){return x.flag;}),['bulk','bulk','bulk']);
  var h=[];SR.addSet(h,'push_classic',61,t);
  assert.equal(h[0].flag,'high');
  // помеченные подходы считаются ×0.5, сессия «с сомнениями»
  var s=SR.fresh(MON());s.provisions=1;
  var r=SR.finishSession(s,[{ex:'push_classic',reps:40,ts:t},{ex:'push_classic',reps:40,ts:t+5000}],MON());
  assert.equal(r.ok,false);assert.deepEqual(r.flags,['fast']);
  assert.equal(r.rawTotal,60); // 40 + 40×0.5
  assert.ok(s.sessions[0].end-s.sessions[0].start===5000);
  var ok=SR.finishSession(SR.fresh(MON()),[{ex:'push_classic',reps:10,ts:t}],MON());
  assert.equal(ok.ok,true);
});

test('программа: короткая в будни, полная в выходные, deload, перенос',function(){
  var s=SR.fresh(MON());
  var tue=SR.programFor(s,at(6,12)); // вторник
  assert.equal(tue.type,'train');assert.equal(tue.workout,'A');assert.equal(tue.items.length,4);assert.equal(tue.short,true);
  assert.equal(tue.items[0].ex,'pull_neg');
  var sat=SR.programFor(s,at(10,12));assert.equal(sat.items.length,5);assert.equal(sat.items[4].ex,'plank');
  assert.equal(SR.programFor(s,at(5,12)).type,'rest');
  s.unlocked.pull=3;s.unlocked.push=2;assert.equal(SR.programFor(s,at(6,12)).items[0].ex,'pullup');
  assert.equal(SR.programFor(s,at(6,12)).items[1].ex,'push_feet');
  var late=SR.programFor(s,new Date(2026,1,10,12)); // 36 дней = неделя 5 → deload
  assert.equal(late.deload,true);assert.equal(late.items[0].sets,2);
  var d=[];SR.addSet(d,'push_classic',10,0);SR.finishSession(s,d,at(6,12),{program:true});
  assert.equal(s.plan.nextWorkout,'B');
});
test('перенос на завтра: сегодня отдых, завтра тренировка, раз в неделю плана',function(){
  var s=SR.fresh(MON());
  var m=SR.moveToTomorrow(s,at(6,12));
  assert.equal(m.ok,true);assert.equal(SR.isTrainDay(s,'2026-01-06'),false);assert.equal(SR.isTrainDay(s,'2026-01-07'),true);
  assert.equal(SR.moveToTomorrow(s,at(8,12)).ok,false); // в той же неделе плана
});

test('магазин, вес, настройки',function(){
  var s=SR.fresh(MON());s.gold=100;
  assert.equal(SR.buy(s,'walls',null,MON()).ok,true);assert.equal(s.gold,40);assert.equal(s.upgrades.walls,1);
  assert.equal(SR.buy(s,'healer',null,MON()).ok,false);
  s.gold=500;SR.buy(s,'smith','spear',MON());SR.buy(s,'smith','spear',MON());assert.equal(s.upgrades.smith.spear,2);
  assert.equal(SR.shopInfo(s,'smith','spear').cost,150);
  var w=SR.fresh(MON());SR.saveWeight(w,60,MON());var r=SR.saveWeight(w,61.2,MON());
  assert.equal(r.gain,1);assert.equal(w.army.cav,2);assert.equal(w.army.spear,2);
  assert.equal(SR.setSettings(w,[1],'20:00').ok,false);
  assert.equal(SR.setSettings(w,[1,3,5],'20:00').ok,true);assert.deepEqual(w.settings.trainDow,[1,3,5]);
});
