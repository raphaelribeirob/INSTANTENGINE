/** Offline demo of Duolingo habit mechanisms + iFood-style verified commerce.
 * Does not process payments or send real push. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTMNT} from '../src/index.mjs';
import {createMemoryRepository} from '../src/storage/memory.mjs';
const at=new Date('2026-10-20T12:00:00Z'),now=()=>at,repo=createMemoryRepository({now}),sdk=createTMNT({repository:repo,now});
const base={tenant:'lab',environment:'test'},register=(app,events,modules,cadence='daily')=>sdk.registerApp({...base,app,keyHash:'f'.repeat(64),events,modules,cadence});
assert.equal(await register('finance_app',[{name:'lesson_completed',value:true}],{habits:true,notifications:true}),true);
assert.equal(await register('shop_app',[{name:'purchase_completed',value:true},{name:'app_opened',value:false}],{offers:true,feedback:true},'episodic'),true);
const lesson=async(at)=>sdk.track({...base,app:'finance_app',subject:'learner',event:'lesson_completed',eventId:randomUUID(),occurredAt:at,timezone:'UTC'});
await lesson('2026-10-19T10:00:00Z');await lesson('2026-10-20T10:00:00Z');
const habit=await sdk.getHabit({...base,app:'finance_app',subject:'learner'});assert.equal(habit.streak,2);
const purchaseId=randomUUID();await sdk.track({...base,app:'shop_app',subject:'customer',event:'purchase_completed',eventId:purchaseId,occurredAt:at,timezone:'UTC'});
assert.equal(await sdk.publishOffer({...base,app:'shop_app',offerId:'welcome',currency:'BRL',listPriceMinor:10000,discountMinor:1000,startsAt:'2026-10-19',endsAt:'2026-10-22',maxRedemptions:10,conversionEvent:'purchase_completed',verificationRef:'trusted_checkout_sku_snapshot'}),true);
const offer=await sdk.listOffers({...base,app:'shop_app',subject:'customer'});assert.equal(offer[0].discountMinor,1000);
const redemption=await sdk.redeemOffer({...base,app:'shop_app',subject:'customer',eventId:purchaseId,offerId:'welcome'});assert.equal(redemption.status,'pending');
assert.equal(await sdk.settleRedemption({...base,app:'shop_app',subject:'customer',redemptionId:redemption.redemptionId,checkoutRef:'trusted_checkout_receipt',appliedDiscountMinor:900}),true);
assert.equal(await sdk.recordFeedback({...base,app:'shop_app',subject:'customer',eventId:purchaseId,score:0,reason:'price'}),true);
const savings=await sdk.getSavings({...base,app:'shop_app',subject:'customer'});assert.equal(savings.totals[0].totalMinor,900);
console.log(JSON.stringify({status:'PASS',apps:['finance_app','shop_app'],habitStreak:habit.streak,verifiedSavingsMinor:savings.totals[0].totalMinor,feedbackScoreZeroAccepted:true,pushSent:false,paymentProcessed:false}));
