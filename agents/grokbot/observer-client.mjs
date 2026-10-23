/** Grokbot/OpenClaw tool process. Exposes only read-only, scoped retention reports to the agent.
 * Configuration is supplied by operator-managed secrets, never as arguments written by an LLM.
 */
import {pathToFileURL} from 'node:url';
import {makeSignedGrokbotObservation} from '../../src/integrations/grokbot-observer.mjs';
const VALID=new Set(['catalog','overview','retention','experiment','diagnose','pipeline','churn']);
export async function callRiverObserver({operation,params={},fetchImpl=fetch,environment=process.env}={}){
 if(!VALID.has(operation))throw new TypeError('Read-only observer tool only');
 const scope=environment.RIVER_OBSERVER_SCOPE,secret=environment.RIVER_OBSERVER_SIGNING_SECRET,baseUrl=environment.RIVER_OBSERVER_BASE_URL;
 if(!scope||!secret||!baseUrl)throw new Error('Observer backend not configured');
 const request=makeSignedGrokbotObservation({baseUrl,scope,secret,operation,params});
 const response=await fetchImpl(request,{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error(`Observer request failed: ${response.status}`);
 const payload=await response.json();
 if(!payload||typeof payload!=='object'||!('result' in payload))throw new Error('Invalid observer response');
 return payload.result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [op,argument]=process.argv.slice(2);const args={};
 if(!VALID.has(op)){console.error('Usage: node observer-client.mjs catalog|overview|retention|experiment|diagnose|pipeline|churn [days | allowlisted_flag]');process.exitCode=2;}
 else{
  if(op==='overview'&&argument!==undefined){const days=Number(argument);if(!Number.isInteger(days)||days<7||days>30)throw new TypeError('Days must be 7-30');args.days=days;}
  if(op==='experiment'){if(!/^[a-z][a-z0-9_-]{1,79}$/.test(argument??''))throw new TypeError('Invalid experiment flag');args.flagKey=argument;}
  try{console.log(JSON.stringify(await callRiverObserver({operation:op,params:args}),null,2));}
  catch{console.error('Observer is unavailable or not authorized');process.exitCode=1;}
 }
}
