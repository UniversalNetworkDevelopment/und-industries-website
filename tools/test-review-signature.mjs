// Does the signature actually stop the attack? Test the attack, not the happy path.
import { reviewSig, reviewSigValid, sign } from '../functions/util/sign.js';

const env = { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-abc123' };
const T = 'UND-2606-01005';
let pass = 0, fail = 0;
const t = async (name, fn, want) => {
  const got = await fn();
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : '**FAIL**'}  ${name}${ok ? '' : `   (got ${got}, want ${want})`}`);
};

const good5 = await reviewSig(env, T, 5);
const good1 = await reviewSig(env, T, 1);
console.log(`\n  signature for ${T} rating 5 = ${good5}\n`);

await t('genuine 5-star link is accepted', () => reviewSigValid(env, T, 5, good5), true);
await t('genuine 1-star link is accepted', () => reviewSigValid(env, T, 1, good1), true);

// THE ATTACK: no signature at all — this is what the forger had before.
await t('ATTACK unsigned link is REJECTED', () => reviewSigValid(env, T, 1, ''), false);
await t('ATTACK guessed signature is REJECTED', () => reviewSigValid(env, T, 1, 'aaaaaaaaaaaaaaaaaaaaaa'), false);

// THE ATTACK: take a real 5-star link and edit the rating down to 1 in the URL bar.
await t('ATTACK 5-star sig replayed as 1-star is REJECTED', () => reviewSigValid(env, T, 1, good5), false);

// THE ATTACK: take your own valid link and use it on a NEIGHBOURING sequential ticket.
await t('ATTACK sig reused on another ticket is REJECTED',
  () => reviewSigValid(env, 'UND-2606-01006', 5, good5), false);

// Fails CLOSED when unconfigured, rather than accepting everything.
await t('no signing key => REJECTS (fails closed)', () => reviewSigValid({}, T, 5, good5), false);
await t('no signing key => mints empty, not a valid sig', async () => (await reviewSig({}, T, 5)) === '', true);

// Domain separation: a signature minted for another purpose must not validate here.
const otherLabel = await sign(env, 'some-other-purpose', T + ':5');
await t('sig from a different domain label is REJECTED', () => reviewSigValid(env, T, 5, otherLabel), false);

// Determinism — the link in the email must still validate days later.
await t('signing is deterministic across calls', async () => (await reviewSig(env, T, 5)) === good5, true);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
