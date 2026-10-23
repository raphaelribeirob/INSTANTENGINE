/** Optional game mechanics; only run on approved app value events. */
import {localParts} from './policy.mjs';
// Compare local calendar *dates*, not instants interpreted as UTC. This also
// avoids false streak increments on midnight UTC and DST transitions.
function dayOrdinal(isoDay){
 if(typeof isoDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(isoDay))throw new TypeError('Invalid local day');
 const timestamp=Date.parse(isoDay+'T00:00:00Z');
 if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==isoDay)throw new TypeError('Invalid local day');
 return Math.floor(timestamp/86400000);
}
export function advanceHabit(previous={},eventAt,{timezone='UTC',goal=1,xpPerValue=10,freezeBalance=previous.freezeBalance??0}={}){
 if(!Number.isInteger(goal)||goal<1||goal>10||!Number.isInteger(xpPerValue)||xpPerValue<0||xpPerValue>1000||!Number.isInteger(freezeBalance)||freezeBalance<0||freezeBalance>7)throw new TypeError('Invalid habit policy');
 const day=localParts(eventAt,timezone).day;
 const prev=previous.lastDay||null;
 // An explicitly saved goal is authoritative across subsequent activities.
 const dailyGoal=previous.dailyGoal??goal;
 if(!Number.isInteger(dailyGoal)||dailyGoal<1||dailyGoal>10)throw new TypeError('Invalid saved daily goal');
 const oldStreak=previous.streak||0;
 const delta=prev?dayOrdinal(day)-dayOrdinal(prev):null;
 // Match the SQL trigger: stale uploads neither add XP nor rewind the clock.
 if(delta!==null&&delta<0)return {...previous,ignoredStale:true};
 const sameDay=delta===0;
 const missed=delta===null?0:Math.max(0,delta-1);
 const protectedDays=missed>0&&missed<=freezeBalance;
 const streak=sameDay?oldStreak:(delta===null||delta===1||protectedDays)?oldStreak+1:1;
 const count=(sameDay?previous.todayCount||0:0)+1;
 const xp=(previous.xp||0)+xpPerValue;
 const reachedGoal=count>=dailyGoal;
 const milestone=!sameDay&&[7,30,100].includes(streak)?streak:null;
 const next={lastDay:day,streak,longestStreak:Math.max(previous.longestStreak||0,streak),todayCount:count,dailyGoal,xp,freezeBalance:Math.min(2,freezeBalance-(protectedDays?missed:0)+(milestone?1:0)),goalMet:reachedGoal};
 return {...next,milestone};
}

/** Rebuild the optional habit state after offline uploads, using the backend's
 * deduplicated, registered VALUE events only. This is a trusted repair action,
 * not an endpoint for arbitrary client claims. Replays the full event history. */
export function reconcileHabitHistory({events=[],timezone='UTC',dailyGoal=1,missionXp=0}={}){
 if(!Array.isArray(events)||events.length>100000||!Number.isInteger(dailyGoal)||dailyGoal<1||dailyGoal>10||!Number.isSafeInteger(missionXp)||missionXp<0)throw new TypeError('Invalid reconciliation');
 let lastDay=null,streak=0,longestStreak=0,todayCount=0,xp=0,freezeBalance=1;
 const earned=new Set(),ids=new Set();
 const ordered=events.filter(x=>x&&x.isValue===true).sort((a,b)=>new Date(a.occurredAt)-new Date(b.occurredAt)||String(a.eventId).localeCompare(String(b.eventId)));
 for(const ev of ordered){
  if(typeof ev.eventId!=='string'||ids.has(ev.eventId))continue;
  ids.add(ev.eventId);
  const day=localParts(ev.occurredAt,timezone).day;
  if(day===lastDay){todayCount++;xp+=10;continue;}
  const gap=lastDay===null?null:Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(lastDay+'T00:00:00Z'))/86400000);
  if(gap!==null&&gap<0)throw new Error('Unordered habit history');
  const missed=gap===null?0:Math.max(0,gap-1);
  if(gap===null||gap===1){streak+=1;}
  else if(missed<=freezeBalance){freezeBalance-=missed;streak+=1;}
  else {streak=1;}
  longestStreak=Math.max(longestStreak,streak);todayCount=1;lastDay=day;xp+=10;
  if([7,30,100].includes(streak)&&!earned.has(streak)){earned.add(streak);freezeBalance=Math.min(2,freezeBalance+1);}
 }
 xp+=missionXp;
 if(!Number.isSafeInteger(xp))throw new RangeError('XP overflow');
 return {lastDay,streak,longestStreak,todayCount,dailyGoal,xp,freezeBalance,goalMet:todayCount>=dailyGoal,earnedMilestones:[...earned]};
}
