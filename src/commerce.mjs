/** Optional commerce + feedback API. Always run on a trusted, authenticated backend.
 * A redemption is NOT a payment. Realized savings require checkout confirmation. */
const SCOPE=/^[a-z][a-z0-9_-]{1,49}$/;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const CODE=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const EVENT=/^[a-z][a-z0-9_.-]{1,79}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reasons=new Set(['content','price','usability','performance','support','other']);
const has=(s,re,label)=>{if(typeof s!=='string'||!re.test(s))throw new TypeError(`Invalid ${label}`);return s;};
const scope=(p,withSubject=true)=>{
 if(!p||typeof p!=='object')throw new TypeError('Invalid request');
 const o={tenant:has(p.tenant,SCOPE,'tenant'),app:has(p.app,SCOPE,'app'),environment:p.environment};
 if(!['test','staging','prod'].includes(o.environment))throw new TypeError('Invalid environment');
 if(withSubject)o.subject=has(p.subject,ID,'subject');
 return o;
};
const minor=(n,label,max=10_000_000_000)=>{if(!Number.isSafeInteger(n)||n<0||n>max)throw new TypeError(`Invalid ${label}`);return n;};
const validDate=(d,label)=>{const v=new Date(d);if(!Number.isFinite(v.getTime()))throw new TypeError(`Invalid ${label}`);return v.toISOString();};
const method=(repo,name)=>{if(typeof repo[name]!=='function')throw new Error(`Commerce adapter missing: ${name}`);return repo[name].bind(repo);};
export function createCommerceAPI(repository,{now=()=>new Date(),emit=async()=>{}}={}){
 return Object.freeze({
  /** Publisher-only. Caller must verify prices/stock against its authoritative checkout. */
  async publishOffer(p){const s=scope(p,false);
   const offerId=has(p.offerId,CODE,'offer id'),conversionEvent=has(p.conversionEvent,EVENT,'conversion event');
   const currency=has(p.currency,/^[A-Z]{3}$/,'currency');
   const listPriceMinor=minor(p.listPriceMinor,'list price');if(listPriceMinor===0)throw new TypeError('Invalid list price');
   const discountMinor=minor(p.discountMinor,'discount');if(discountMinor===0||discountMinor>listPriceMinor)throw new TypeError('Invalid discount');
   const startsAt=validDate(p.startsAt,'startsAt'),endsAt=validDate(p.endsAt,'endsAt');
   if(new Date(endsAt)<=new Date(startsAt))throw new TypeError('Invalid offer period');
   if(new Date(endsAt).getTime()-new Date(startsAt).getTime()>366*86400000)throw new TypeError('Offer period too long');
   const maxRedemptions=minor(p.maxRedemptions,'max redemptions',1_000_000);if(maxRedemptions<1)throw new TypeError('Invalid max redemptions');
   const verificationRef=has(p.verificationRef,ID,'verified checkout reference');
   return method(repository,'publishOffer')({...s,offerId,conversionEvent,currency,listPriceMinor,discountMinor,startsAt,endsAt,maxRedemptions,verificationRef});
  },
  /** Explicit browsing is not unsolicited marketing. For personalized suggestions require in_app marketing opt-in. */
  async listOffers(p){const s=scope(p);const personalized=p.personalized===true;if(p.personalized!==undefined&&typeof p.personalized!=='boolean')throw new TypeError('Invalid personalized flag');
   return method(repository,'listOffers')({...s,personalized});
  },
  async redeemOffer(p){const s=scope(p);const offerId=has(p.offerId,CODE,'offer id'),eventId=has(p.eventId,UUID,'verified value event id');
   const result=await method(repository,'redeemOffer')({...s,offerId,eventId});
   if(result)await emit('tmnt_offer_redeemed',s,{offerId});return result;
  },
  /** Publisher/checkout-only. Checkout adapter must verify checkoutRef and applied amount before invoking. */
  async settleRedemption(p){const s=scope(p);const redemptionId=has(p.redemptionId,UUID,'redemption id'),checkoutRef=has(p.checkoutRef,ID,'verified checkout receipt');
   const appliedDiscountMinor=minor(p.appliedDiscountMinor,'applied discount');
   const result=await method(repository,'settleRedemption')({...s,redemptionId,checkoutRef,appliedDiscountMinor});
   if(result)await emit('tmnt_redemption_settled',s,{redemptionId});return result;
  },
  async getSavings(p){return method(repository,'getSavings')(scope(p));},
  /** Feedback is independent of a user's app-store review eligibility. */
  async recordFeedback(p){const s=scope(p),eventId=has(p.eventId,UUID,'completed experience event id');
   const score=minor(p.score,'score',10);const reason=p.reason===undefined?'other':p.reason;
   if(!reasons.has(reason))throw new TypeError('Invalid feedback reason');
   const result=await method(repository,'recordFeedback')({...s,eventId,score,reason});
   if(result)await emit('tmnt_feedback_recorded',s,{score,reason});return result;
  },
  /** Native OS dialog might not actually display. Claims merely apply cooldown. */
  async claimReviewPrompt(p){const s=scope(p),platform=p.platform;
   if(!['ios','android'].includes(platform)||p.sessionCompleted!==true||p.inForeground!==true||p.taskIdle!==true)return false;
   return method(repository,'claimReviewPrompt')({...s,platform});
  }
 });
}
