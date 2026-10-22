async ({path,timeoutMs,maximum}) => {
  if(location.origin!=='https://app.onda.fit')return {status:0,body:'',contentType:'',failure:'AVAILABILITY_BROWSER_ORIGIN_INVALID',requestSent:false};
  const deadline=performance.now()+timeoutMs;
  // Same genuine helper already used by Onda's normal checkout integration.
  // Fail closed if the live module contract changes; never return its value.
  const acquired=await new Promise(resolve=>{
    const runtime=window.TURBOPACK;
    if(!runtime||typeof runtime.push!=='function'){resolve({failure:'AVAILABILITY_SITE_HELPER_UNAVAILABLE'});return;}
    let done=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve(result);};
    const timer=setTimeout(()=>finish({failure:'AVAILABILITY_SITE_HELPER_TIMEOUT'}),Math.min(timeoutMs,10000));
    const id=900000000+Math.floor(Math.random()*10000000),chunk=`/_next/static/immutable/chunks/availability-context-${id}.js`;
    try {
      runtime.push([chunk,id,module=>{
        try {
          const helper=module.i(139691).getPublicFingerprintId;
          if(typeof helper!=='function'){finish({failure:'AVAILABILITY_SITE_HELPER_UNAVAILABLE'});return;}
          Promise.resolve(helper()).then(value=>finish(typeof value==='string'&&/^[\x21-\x7e]{1,1024}$/.test(value)
            ?{value}:{failure:'AVAILABILITY_SITE_HELPER_FAILED'}),()=>finish({failure:'AVAILABILITY_SITE_HELPER_FAILED'}));
        }catch{finish({failure:'AVAILABILITY_SITE_HELPER_UNAVAILABLE'});}
      }]);
      runtime.push([chunk,{otherChunks:[],runtimeModuleIds:[id]}]);
    }catch{finish({failure:'AVAILABILITY_SITE_HELPER_UNAVAILABLE'});}
  });
  if(acquired.failure)return {status:0,body:'',contentType:'',failure:acquired.failure,requestSent:false};
  const remaining=deadline-performance.now();
  if(remaining<=0)return {status:0,body:'',contentType:'',failure:'AVAILABILITY_READ_TIMEOUT',requestSent:false};
  let response;
  try {response=await fetch(path,{method:'GET',credentials:'same-origin',redirect:'error',
    headers:{Accept:'application/json','X-Onda-Public-Fingerprint':acquired.value},signal:AbortSignal.timeout(Math.max(1,Math.floor(remaining)))});}
  catch(error){return {status:0,body:'',contentType:'',requestSent:true,failure:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'AVAILABILITY_READ_TIMEOUT':'AVAILABILITY_TRANSPORT_FAILED'};}
  const contentType=response.headers.get('content-type')??'';
  const metadata=Object.fromEntries(['x-vercel-cache','age','date','x-matched-path','x-vercel-id','retry-after'].flatMap(key=>{
    const value=response.headers.get(key);return value&&value.length<=240&&/^[\x20-\x7e]+$/.test(value)?[[key,value]]:[];
  }));
  if(!response.ok||!contentType.toLowerCase().includes('application/json'))return {status:response.status,contentType,body:'',metadata};
  const reader=response.body?.getReader();
  if(!reader)return {status:0,contentType:'',body:'',failure:'AVAILABILITY_BODY_FAILED',requestSent:true};
  try {
    const chunks=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>maximum){await reader.cancel();return {status:0,contentType:'',body:'',failure:'AVAILABILITY_RESPONSE_TOO_LARGE',requestSent:true};}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return {status:response.status,contentType,body:new TextDecoder().decode(bytes),metadata};
  }catch{return {status:0,contentType:'',body:'',failure:'AVAILABILITY_BODY_FAILED',requestSent:true};}
}
