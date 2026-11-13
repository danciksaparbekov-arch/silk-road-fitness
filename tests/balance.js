/* Монте-Карло симуляция темпа кампании (SPEC §9). Запуск: node tests/balance.js
   Игрок: программа 3 раза в неделю (вт/чт/сб), повторы = середина диапазона +5% каждые 2 недели (шум ±10%),
   питание 5 дней из 7, атака когда армия >= 1.2 x гарнизона, дни отдыха отмечаются мобильностью.
   Допущения: Кузница открывает по одному уровню в каждой лестнице раз в 3 недели; страж-тест сдаётся на
   следующий день после падения гарнизона; золото в симуляции не тратится (магазин не учитывается). */
'use strict';
var SR=require('../game.js');
var RUNS=+process.env.RUNS||200,MAXW=60;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// variant: 'perfect' | 'miss1' (пропуск субботы каждую неделю) | 'lostweek' (потеряна неделя 5)
function simulate(variant,seed){
  var rng=mulberry32(seed),start=new Date(2026,0,5,21,30); // понедельник
  var s=SR.fresh(start),seen={},regStats=[],sess=0,cur={sess:0,lossSum:0,battles:0},finishedDay=null,bossWait=false;
  for(var day=0;day<MAXW*7&&s.region<12;day++){
    var now=new Date(2026,0,5+day,21,30),wk=Math.floor(day/7),dw=day%7; // dw 0=пн
    SR.processDays(s,now);
    if(s.region>=12)break;
    var d=SR.gameDay(now);
    var lost=(variant==='lostweek'&&wk===4);
    if(dw<5&&!lost)SR.markFood(s,now,0);
    if(wk>0&&wk%3===0&&dw===0)SR.LADDERS.forEach(function(l){SR.unlockTier(s,l.id,now);});
    var train=SR.isTrainDay(s,d),skip=lost||(variant==='miss1'&&dw===5);
    if(train&&!skip){
      var prog=SR.programFor(s,now),draft=[],t=now.getTime();
      prog.items.forEach(function(it){
        var mid=(it.lo+it.hi)/2*(1+0.05*Math.floor(wk/2))*(0.9+0.2*rng());
        for(var i=0;i<it.sets;i++){
          t+=(it.rest+Math.round(mid)*3)*1000;
          SR.addSet(draft,it.ex,Math.max(1,Math.round(mid)),t);
        }
      });
      SR.finishSession(s,draft,now,{program:true});sess++;cur.sess++;
    }else if(!train&&!lost)SR.markRest(s,now);
    if(SR.bossReady(s)){
      if(bossWait){var r=SR.passBoss(s,999,now);bossWait=false;if(r.passed)closeRegion(s.region-1);}
      else bossWait=true;
    }else if(s.garrison&&SR.count(s.army)>=1.2*SR.count(s.garrison)){
      var before=SR.count(s.army),reg=s.region,res=SR.attack(s,rng,now);
      if(res.ok){cur.lossSum+=before?res.totalLost/before:0;cur.battles++;if(res.conquered)closeRegion(reg,res);}
    }
  }
  function closeRegion(reg){
    if(seen[reg]){cur={sess:0,lossSum:0,battles:0};return;}seen[reg]=1;
    regStats.push({sess:cur.sess,loss:cur.battles?cur.lossSum/cur.battles:0,gold:s.gold});
    cur={sess:0,lossSum:0,battles:0};
  }
  return {weeks:s.region>=12?(day/7):null,regStats:regStats,regions:s.region};
}

function report(variant){
  var agg=[],weeks=[],fin=0,regAvg=0;
  for(var i=0;i<RUNS;i++){
    var r=simulate(variant,1000+i);
    if(r.weeks!=null){fin++;weeks.push(r.weeks);}
    regAvg+=r.regions;
    r.regStats.forEach(function(x,k){(agg[k]=agg[k]||[]).push(x);});
  }
  function avg(a,f){return a.reduce(function(p,x){return p+f(x);},0)/a.length;}
  console.log('\n== Вариант: '+variant+' (прогонов '+RUNS+') ==');
  console.log('Регион | Гарнизон | Достигли | Тренировок | Потери армии % | Золото');
  agg.forEach(function(a,k){
    console.log(String(k+1).padStart(6)+' | '+String(SR.GARRISON_N[k]).padStart(8)+' | '+String(Math.round(100*a.length/RUNS)+'%').padStart(8)+' | '+
      avg(a,function(x){return x.sess;}).toFixed(1).padStart(10)+' | '+(100*avg(a,function(x){return x.loss;})).toFixed(0).padStart(14)+' | '+avg(a,function(x){return x.gold;}).toFixed(0).padStart(6));
  });
  weeks.sort(function(a,b){return a-b;});
  console.log('Кампания пройдена: '+fin+'/'+RUNS+'; недель: '+(fin?('медиана '+weeks[Math.floor(weeks.length/2)].toFixed(1)+', мин '+weeks[0].toFixed(1)+', макс '+weeks[weeks.length-1].toFixed(1)):'нет')+
    '; регионов в среднем '+(regAvg/RUNS).toFixed(1));
  return {fin:fin,weeks:weeks,variant:variant};
}

if(process.env.GN)SR.GARRISON_N.splice(0,12,...process.env.GN.split(',').map(Number));
var res=['perfect','miss1','lostweek'].map(report);
// Контроль: идеальный игрок укладывается в 16–22 недели (медиана)
var p=res[0],med=p.weeks[Math.floor(p.weeks.length/2)];
console.log('\nИТОГ: perfect медиана '+(med?med.toFixed(1):'-')+' нед. Цель 16–22.');
if(!(med>=16&&med<=22)){console.error('Темп вне цели'); process.exitCode=1;}
