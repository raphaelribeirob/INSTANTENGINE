import test from 'node:test';
import assert from 'node:assert/strict';
import {signChurnModel,verifySignedChurnModel} from '../src/integrations/churn-model-signature.mjs';
const secret='private-super-long-signing-secret-for-tests';
const model={schema:'river_churn_v1',status:'validated',approved:true,version:'qa-model',
 weights:[0,1,0,0,0,0,0],intercept:0,
 validation:{testSize:200,returned:100,didNotReturn:100,auc:0.7,brier:0.2,baselineBrier:0.25,calibrationError:0.05}};
test('operator signature verifies without exposing secret',()=>{
 const signature=signChurnModel(model,secret);
 assert.match(signature,/^[a-f0-9]{64}$/);
 assert.equal(verifySignedChurnModel({model,signature,secret}),true);
});
test('signature fails closed for tampered weight and different scope secret',()=>{
 const signature=signChurnModel(model,secret);
 assert.equal(verifySignedChurnModel({model:{...model,weights:[1,1,1,1,1,1,1]},signature,secret}),false);
 assert.equal(verifySignedChurnModel({model,signature,secret:secret+'different'}),false);
});
test('no signature or weak secret cannot load model',()=>{
 assert.equal(verifySignedChurnModel({model,secret}),false);
 assert.equal(verifySignedChurnModel({model,signature:'bad',secret}),false);
 assert.throws(()=>signChurnModel(model,'short'),/strong/);
});
test('unapproved candidate cannot be signed or loaded',()=>{
 const candidate={...model,approved:false};
 assert.throws(()=>signChurnModel(candidate,secret),/reviewed/);
 assert.equal(verifySignedChurnModel({model:candidate,signature:'a'.repeat(64),secret}),false);
});
