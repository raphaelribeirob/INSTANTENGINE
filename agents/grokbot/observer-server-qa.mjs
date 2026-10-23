/** Local-only demo host. Production deploy requires trusted HTTPS termination and secure runtime. */
import {createServer} from 'node:http';
import {createRiverObserverNeonRepository} from '../../src/storage/observer-neon.mjs';
import {createNeonRepository} from '../../src/storage/neon.mjs';
import {createGrokbotObserver} from '../../src/integrations/grokbot-observer.mjs';
const baseUrl=process.env.RIVER_OBSERVER_PUBLIC_URL;
if(!baseUrl||new URL(baseUrl).hostname!=='127.0.0.1'||process.env.RIVER_OBSERVER_SCOPE?.endsWith('/prod'))throw new Error('QA demo binds to localhost; production requires a dedicated HTTPS adapter');
const repository=await createRiverObserverNeonRepository(process.env.DATABASE_URL);
const nonceStore=await createNeonRepository(process.env.DATABASE_URL);
const scope=process.env.RIVER_OBSERVER_SCOPE,secret=process.env.RIVER_OBSERVER_SIGNING_SECRET;
const observer=createGrokbotObserver({repository,nonceStore,credentials:{[scope]:{secret,operations:['catalog','overview','retention','diagnose','experiment','pipeline'],experiments:(process.env.RIVER_OBSERVER_EXPERIMENT_FLAGS||'').split(',').filter(Boolean)}}});
const port=Number(process.env.PORT||8791);
const host=createServer(async(req,res)=>{
 const url=new URL(req.url,baseUrl);const body=req.method==='POST'?req:undefined;
 const request=new Request(url,{method:req.method,headers:req.headers,body,duplex:body?'half':undefined});
 const response=await observer.handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
host.listen(port,'127.0.0.1',()=>console.log(`Observer QA listening on 127.0.0.1:${port}`));
