/** Optional dispatcher for atomic database value-event outbox. No push is sent.
 * At-least-once delivery; 20-attempt dead-letter status; fail closed for consent.
 */
import {createHmac} from 'node:crypto';
function secretValid(v){if(typeof v!=='string'||v.length<32)throw new TypeError('Long signing secret required');}
export function createRiverValueOutboxPump({repository,deliver,secret,enabled=false,allowProduction=false}={}){
 if(!repository||['claimValueOutbox','completeValueOutbox','getVerifiedOutboxEvent','isABEligible'].some(x=>typeof repository[x]!=='function'))throw new TypeError('Outbox repository contract missing');
 if(typeof deliver!=='function')throw new TypeError('Analytics delivery required');secretValid(secret);
 if(typeof enabled!=='boolean'||typeof allowProduction!=='boolean')throw new TypeError('Invalid flags');
 return Object.freeze({
  async drainOnce(){
   if(!enabled)return {status:'disabled'};
   const job=await repository.claimValueOutbox({allowProduction});if(!job)return {status:'empty'};
   const ref={tenant:job.tenant,app:job.app,environment:job.environment,eventId:job.eventId};
   if(job.environment==='prod'&&!allowProduction)return {status:'prod_disabled'}; // keep lease for privileged worker; never discard production data
   let event;
   try{
    event=await repository.getVerifiedOutboxEvent(ref);
    if(!event||event.verifiedValue!==true||event.eventId!==job.eventId){await repository.completeValueOutbox({...ref,leaseToken:job.leaseToken,status:'discarded'});return {status:'missing_erased_or_invalid'};}
    if(!await repository.isABEligible({...ref,subject:event.subject})){
     await repository.completeValueOutbox({...ref,leaseToken:job.leaseToken,status:'discarded'});return {status:'no_analytics_consent'};
    }
    const insertId=createHmac('sha256',secret).update([ref.tenant,ref.app,ref.environment,ref.eventId].join('\x1f')).digest('hex');
    const result=await deliver({event,insertId});
    if(result?.acknowledged!==true)throw new Error('Provider did not acknowledge event');
    const persisted=await repository.completeValueOutbox({...ref,leaseToken:job.leaseToken,status:'acknowledged'});
    if(persisted!==true)throw new Error('Lease expired before acknowledgement');
    return {status:'accepted_by_provider'};
   }catch{
    await repository.completeValueOutbox({...ref,leaseToken:job.leaseToken,status:'retry'});
    return {status:'retry_scheduled'};
   }
  }
 });
}
