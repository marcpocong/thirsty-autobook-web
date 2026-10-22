import { resolve, relative, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ONDA_URL } from '../src/config.js';
import { browserIdentity, verifyDedicatedChromeAsync } from '../src/browser.js';
import { prepareCheckoutRecovery, assertRecoveryJournal, openCheckoutRecovery } from '../src/api-booking/checkout-recovery.js';

// Restore only an existing, exactly revalidated reservation. There is no submit,
// retry, cancellation, journal mutation, or payment-completion code in this tool.
async function main() {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help') {
    console.log('Usage: npm run checkout:recover -- <original-journal-directory>\nReopens only an existing, unexpired, fully validated reservation. Never creates a booking or pays.');
    return;
  }
  if(args.length!==1)throw Error('CHECKOUT_RECOVERY_DIRECTORY_REQUIRED');
  const root=await realpath(resolve('.local/api-booking/api-first-journals'));
  const directory=await realpath(resolve(args[0]!)),child=relative(root,directory);
  if(!child||child.startsWith('..')||isAbsolute(child))throw Error('CHECKOUT_RECOVERY_DIRECTORY_INVALID');
  const recovery=await prepareCheckoutRecovery(directory);
  await assertRecoveryJournal(directory,recovery);
  const identity=browserIdentity(recovery.workerId);
  await verifyDedicatedChromeAsync(identity);
  const browser=await chromium.connectOverCDP(identity.cdpUrl,{timeout:10_000});
  try {
    const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>page.url()===ONDA_URL||page.url().startsWith(`${ONDA_URL}?bookingId=`));
    if(pages.length!==1)throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    const page=pages[0]!;
    await openCheckoutRecovery(page,directory);
    console.log(JSON.stringify({stage:'EXISTING_QR_RECOVERED',workerId:recovery.workerId,date:recovery.plan.targetDate,
      courts:recovery.plan.courts.map(court=>court.court),startTime:recovery.plan.startTime,endTime:recovery.plan.endTime,
      amount:recovery.plan.totalPrice,holdExpiresAt:recovery.hold.holdExpiresAt,paymentAutomated:false,journalUnchanged:true}));
  } finally {await browser.close();}
}
main().catch(error=>{
  // Never print browser errors, URLs, tokens, raw captures, or provider bodies.
  const code=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'CHECKOUT_RECOVERY_FAILED';
  console.error(code);process.exitCode=1;
});
