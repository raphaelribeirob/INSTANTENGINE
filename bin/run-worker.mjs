#!/usr/bin/env node
// Can be invoked by cron, Kubernetes CronJob, ECS task, systemd timer, plain Node or CI.
// Server-only. Real sending is always OFF unless explicitly configured.
import {validateSettings,neonAdapter,runCycle} from '../src/worker.mjs';
async function main(){
 const settings=validateSettings();
 if(!settings.enabled){console.log(JSON.stringify({status:'disabled',claimed:0,accepted:0,failed:0}));return;}
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required for enabled worker');
 const db=await neonAdapter(process.env.DATABASE_URL);
 const result=await runCycle({db,settings,maxJobs:Number(process.env.TMNT_BATCH_SIZE||3)});
 console.log(JSON.stringify(result));
}
main().catch(err=>{console.error('TMNT worker failed:',String(err.message||err));process.exitCode=1;});
