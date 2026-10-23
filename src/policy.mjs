/** Shared, deterministic safety policy for retention reminders. No provider I/O. */
function validTime(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new TypeError('Invalid clock');return d;}
export function localParts(instant,timezone){
 const d=validTime(instant);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(d);
 const data=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {day:`${data.year}-${data.month}-${data.day}`,hour:Number(data.hour)};
}
export function calendarGap(now,previous,timezone){
 const a=localParts(now,timezone).day,b=localParts(previous,timezone).day;
 const integer=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
 return integer(a)-integer(b);
}
export function evaluateEligibility({app,subject,consent,arm,now=new Date(),existingCampaign=false,deliveries=[]}={}){
 const deny=(reason)=>({eligible:false,reason});
 if(!app?.enabled || app.modules?.notifications!==true)return deny('app_disabled');
 if(app.cadence==='none'||app.cadence==='episodic')return deny('cadence_not_recurring');
 if(!subject)return deny('unknown_subject');
 if(!consent?.granted||!consent?.verified)return deny('no_verified_consent');
 if(arm!=='treatment')return deny('experiment_holdout');
 if(!subject.lastValueAt)return deny('no_value_event');
 const clock=validTime(now);
 if(subject.pausedUntil && validTime(subject.pausedUntil)>clock)return deny('paused');
 const {hour}=localParts(clock,subject.timezone||'UTC');
 if(hour<app.quietStart||hour>=app.quietEnd)return deny('quiet_hours');
 if(subject.reminderHour!==null&&subject.reminderHour!==undefined&&hour!==subject.reminderHour)return deny('reminder_hour');
 const gap=calendarGap(clock,subject.lastValueAt,subject.timezone||'UTC');
 if(gap<1)return deny('already_completed_today');
 if(app.cadence==='daily'&&gap>7)return deny('inactive_over_7d');
 if(app.cadence==='weekly'&&gap<7)return deny('weekly_not_due');
 if(existingCampaign)return deny('duplicate_campaign');
 const previous=deliveries.filter(d=>['provider_accepted','sending'].includes(d.status));
 const sevenDays=clock.getTime()-7*86400000;
 if(previous.some(d=>d.status==='sending'&&d.leaseUntil && new Date(d.leaseUntil)>clock))return deny('already_sending');
 if(previous.some(d=>d.status==='provider_accepted'&&new Date(d.sentAt).getTime()>clock.getTime()-86400000))return deny('cooldown_24h');
 const count=previous.filter(d=>d.status==='provider_accepted'&&new Date(d.sentAt).getTime()>sevenDays).length;
 if(count>=app.weeklyLimit)return deny('weekly_cap');
 const matured=previous.filter(d=>d.status==='provider_accepted' && d.sentAt && new Date(d.sentAt).getTime()<=clock.getTime()-86400000 && new Date(d.sentAt).getTime()>=clock.getTime()-14*86400000);
 if(matured.length>=4&&!matured.some(d=>d.verifiedValue===true))return deny('notification_fatigue_no_verified_value');
 return {eligible:true,reason:'eligible',localHour:hour,daysSinceValue:gap};
}
