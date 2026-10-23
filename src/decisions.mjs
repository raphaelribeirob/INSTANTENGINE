/** Contextual statistical selection. Offline learning signals are associations,
 * NOT causal lift. Opt-in experiment holdout is evaluated before calling this. */
import {createHash} from 'node:crypto';
const KEY=/^[a-zA-Z0-9_.-]{1,80}$/;
export function chooseVariant({variants,stats={},recent=[],seed,exploration=0.12}={}){
 if(!Array.isArray(variants)||variants.length===0||variants.length>30)throw new TypeError('Variant catalog required');
 if(!Number.isFinite(exploration)||exploration<0||exploration>0.5)throw new TypeError('Invalid exploration');
 if(typeof seed!=='string'||seed.length<1)throw new TypeError('Seed required');
 const ids=new Set();
 for(const v of variants){if(!v||!KEY.test(v.id)||ids.has(v.id))throw new TypeError('Invalid variant');ids.add(v.id);}
 const total=variants.reduce((sum,v)=>sum+Math.max(0,Number(stats[v.id]?.views)||0),0);
 // Stable pseudo-random exploration per campaign/user, no external entropy needed.
 const uniform=s=>createHash('sha256').update(seed+'\u001f'+s).digest().readUInt32BE(0)/4294967296;
 const explore=uniform('explore')<exploration;
 const candidates=variants.map((v,i)=>{
  const n=Math.max(0,Number(stats[v.id]?.views)||0);
  const successes=Math.min(n,Math.max(0,Number(stats[v.id]?.successes)||0));
  const posterior=(successes+1)/(n+2);
  const uncertainty=Math.sqrt(Math.log(total+2)/(n+1))*0.12;
  const novelty=recent.includes(v.id)?0.35:0;
  const score=posterior+uncertainty-novelty;
  return {...v,score,index:i,noise:uniform('variant:'+v.id)};
 });
 candidates.sort((a,b)=> explore ? a.noise-b.noise : b.score-a.score||a.noise-b.noise);
 const winner=candidates[0];
 return {id:winner.id,score:Math.round(winner.score*10000)/10000,reason:explore?'exploration':'posterior_plus_novelty',exploration:explore};
}
