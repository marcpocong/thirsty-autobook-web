import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Reuse the canonical updater's installation identity/integrity detector, not its
 * code-replacement safety gate: existing holds/UNKNOWN must remain recoverable.
 * A source checkout or manually mixed runtime is not a substitute live installation.
 */
export async function assertCanonicalRecoveryRuntime(root:string):Promise<void>{
  try{
    const helper=await import(pathToFileURL(resolve(root,'scripts/app-installation.mjs')).href);
    const installation=await helper.detectInstallation(resolve(root,'Source'));
    if(resolve(installation.root)!==resolve(root))throw Error('RECOVERY_INSTALLATION_ROOT_MISMATCH');
  }catch(e){throw Error(e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'RECOVERY_RUNTIME_NOT_VERIFIED');}
}
