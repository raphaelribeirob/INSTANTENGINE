/** INSTANTENGINE standalone analytics retention purge. Explicitly opt in to maintenance.
 * Independent of churn scoring and without any notification provider access.
 */
import {createInstantChurnNeonRepository} from '../src/storage/churn-neon.mjs';
import {pathToFileURL} from 'node:url';
export function purgeConfiguration(env=process.env){
 const enabled=env.INSTANT_PURGE_ENABLED==='true';
 if(!enabled)return {status:'disabled'};
 const parts=(env.INSTANT_CHURN_SCOPE??env.RIVER_CHURN_SCOPE??'').split('/');
 if(parts.length!==3)throw new TypeError('INSTANT_CHURN_SCOPE requires tenant/app/environment');
 const [tenant,app,environment]=parts;
 if(environment==='prod'&&env.INSTANT_PURGE_ALLOW_PRODUCTION!=='true')return {status:'production_disabled'};
 return {status:'ready',scope:{tenant,app,environment}};
}
export async function runIndependentPurge({env=process.env,repositoryFactory=createInstantChurnNeonRepository}={}){
 const config=purgeConfiguration(env);
 if(config.status!=='ready')return {...config,deletedEvents:0,deletedScores:0};
 const {validateChurnScope}=await import('../src/churn-prediction.mjs');
 validateChurnScope(config.scope);
 const repo=await repositoryFactory(env.DATABASE_URL);
 return {status:'ok',scope:config.scope,...await repo.purgeExpired(config.scope)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const r=await runIndependentPurge();
 console.log(JSON.stringify(r));
}
