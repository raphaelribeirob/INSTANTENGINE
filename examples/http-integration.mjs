/**
 * Example ONLY. An actual application backend must first verify its user's
 * session and put a persistent Neon repository behind createTMNTGateway.
 * No secrets belong in a browser. Here both sides run locally in one process.
 */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
import {createTMNTGateway,makeSignedTMNTRequest} from '../src/integrations/http-gateway.mjs';
const scope='demo/instantstudy/test';
const secret='DEMO-ONLY-DO-NOT-USE-'+randomUUID()+randomUUID();
const repo=createMemoryRepository();const engine=createTMNT({repository:repo});
await engine.registerApp({tenant:'demo',app:'instantstudy',environment:'test',keyHash:'a'.repeat(64),modules:{notifications:false,habits:true},events:[{name:'flashcard_reviewed',value:true}]});
const gateway=createTMNTGateway({engine,nonceStore:repo,credentials:{[scope]:{secret}}});
const server=createServer(async (req,res)=>{
 try{
  const body=[];for await(const chunk of req)body.push(chunk);
  const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(body)});
  const answer=await gateway(request);
  res.writeHead(answer.status,Object.fromEntries(answer.headers));res.end(await answer.text());
 }catch{res.writeHead(500);res.end('Server error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const url=`http://127.0.0.1:${server.address().port}`;
 const request=makeSignedTMNTRequest({baseUrl:url,scope,subject:'learner1',secret,operation:'track',params:{eventId:randomUUID(),event:'flashcard_reviewed'}});
 const first=await fetch(request);console.log(JSON.stringify({scenario:'local HTTP backend-to-backend',status:first.status,response:await first.json(),secretsExposed:false}));
}finally{await new Promise(resolve=>server.close(resolve));}
