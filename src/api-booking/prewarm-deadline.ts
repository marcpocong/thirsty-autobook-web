/** A read may inform freeze only before preparation must start. Late answers cannot change the frozen plan.
 * Stop releases the waiter immediately even when the underlying read cannot be interrupted. */
export function readBeforePreparation<T>(read:()=>Promise<T>,deadlineMs:number,signal:AbortSignal,now:()=>number=Date.now):Promise<T|undefined>{
  return new Promise((resolve,reject)=>{
    let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const finish=(value:T|undefined,error?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',onAbort);
      if(error!==undefined)reject(error);else resolve(value);
    };
    const onAbort=()=>finish(undefined,Error('USER_ABORT'));
    if(signal.aborted){onAbort();return;}
    if(now()>=deadlineMs){finish(undefined);return;}
    signal.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>finish(undefined),Math.max(0,deadlineMs-now()));
    void Promise.resolve().then(()=>{if(settled||now()>=deadlineMs)return undefined;return read();})
      .then(value=>finish(now()<deadlineMs?value:undefined),error=>finish(undefined,error));
  });
}
