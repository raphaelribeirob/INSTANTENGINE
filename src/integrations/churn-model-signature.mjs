/** Detached HMAC attestation for operator-reviewed churn model artifacts.
 * Only backend operators control this secret; never embed it in a client.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

export function signChurnModel(model,secret){
 if(!model||typeof model!=='object'||Array.isArray(model)||
    typeof secret!=='string'||secret.length<32)
  throw new TypeError('Reviewed model and strong backend signing secret required');
 if(model.schema!=='river_churn_v1'||model.status!=='validated'||model.approved!==true)
  throw new TypeError('Only explicitly reviewed validated models can be signed');
 return createHmac('sha256',secret).update(JSON.stringify(model)).digest('hex');
}

export function verifySignedChurnModel({model,signature,secret}={}){
 if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))return false;
 try{
  const expected=signChurnModel(model,secret);
  return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'));
 }catch{return false;}
}
