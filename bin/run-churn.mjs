/** Operator-only daily batch. OFF by default. Schedule in private server cron after QA. */
import {readFile} from 'node:fs/promises';
import {createChurnDailyJob} from '../src/churn-prediction.mjs';
import {createRiverChurnNeonRepository} from '../src/storage/churn-neon.mjs';
const enabled=(process.env.INSTANT_CHURN_ENABLED??process.env.RIVER_CHURN_ENABLED)==='true';
if(!enabled){console.log(JSON.stringify({status:'disabled',processed:0}));process.exit(0);}
const scope=(process.env.INSTANT_CHURN_SCOPE??process.env.RIVER_CHURN_SCOPE)?.split('/');
if(scope?.length!==3)throw new Error('INSTANT_CHURN_SCOPE (or legacy RIVER_CHURN_SCOPE) must be tenant/app/environment');
const modelPath=(process.env.INSTANT_CHURN_VALIDATED_MODEL_PATH??process.env.RIVER_CHURN_VALIDATED_MODEL_PATH);
const model=modelPath?JSON.parse(await readFile(modelPath,'utf8')):null;
const repository=await createRiverChurnNeonRepository(process.env.DATABASE_URL);
const job=createChurnDailyJob({repository,enabled,allowProduction:(process.env.INSTANT_CHURN_ALLOW_PRODUCTION??process.env.RIVER_CHURN_ALLOW_PRODUCTION)==='true',model});
const result=await job.run({tenant:scope[0],app:scope[1],environment:scope[2],asOf:(process.env.INSTANT_CHURN_DAY??process.env.RIVER_CHURN_DAY)||undefined});
if(result.status==='ok'&&typeof repository.purgeExpired==='function')await repository.purgeExpired({tenant:scope[0],app:scope[1],environment:scope[2]});
console.log(JSON.stringify(result));
