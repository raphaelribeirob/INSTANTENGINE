#!/usr/bin/env node
/** Operator-side signing only; no raw secret in CLI history, logs or returned output. */
import {readFileSync,writeFileSync} from 'node:fs';
import {signRiverBanditPolicy} from '../src/integrations/bandit-policy.mjs';
if(process.argv.length!==4||!process.env.RIVER_BANDIT_SIGNING_SECRET){console.error('Usage: RIVER_BANDIT_SIGNING_SECRET=... node scripts/sign-bandit-policy.mjs source.json destination.json');process.exit(2);}
const policy=JSON.parse(readFileSync(process.argv[2],'utf8'));
const signature=signRiverBanditPolicy(policy,process.env.RIVER_BANDIT_SIGNING_SECRET);
writeFileSync(process.argv[3],JSON.stringify({policy,signature},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('Policy signed for manual review; not activated');
