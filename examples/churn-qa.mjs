import {scoreChurnRisk,planConsentSafeRetention} from '../src/churn-prediction.mjs';
const risk=scoreChurnRisk({features:{daysSinceOpen:4,activeDays7:1,activeDaysPrev7:4,completed7:0,failed7:2,crashes7:0,opens7:1}});
const action=planConsentSafeRetention({score:risk,context:{analyticsConsent:true,notificationsEnabled:true,notificationConsent:true,experimentArm:'treatment'}});
console.log(JSON.stringify({risk,action,liveProbabilityAvailable:false,notificationSent:false},null,2));
