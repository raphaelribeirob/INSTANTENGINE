/** Operator-only detached signature. Does not set approved=true automatically. */
import {readFile} from 'node:fs/promises';
import {scoreChurnRisk} from '../src/churn-prediction.mjs';
import {signChurnModel} from '../src/integrations/churn-model-signature.mjs';

const path=process.argv[2];
if(!path)throw new Error('Usage: npm run ml:sign-churn-model -- REVIEWED_MODEL.json');
const secret=process.env.INSTANT_CHURN_MODEL_SIGNING_SECRET;
const model=JSON.parse(await readFile(path,'utf8'));
// Reuse the serving contract to reject self-asserted metrics that fail basic gates.
scoreChurnRisk({features:{
 daysSinceOpen:1,activeDays7:1,activeDaysPrev7:1,
 completed7:1,failed7:0,crashes7:0,opens7:1
},model});
console.log(signChurnModel(model,secret));
