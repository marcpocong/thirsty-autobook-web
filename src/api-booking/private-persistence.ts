import {link,mkdir,open,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Publish complete private bytes once, never a truncated canonical file. No overwrite/recycle. */
export async function publishPrivateJson(path:string,value:unknown):Promise<void>{
  const directory=dirname(path);await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=join(directory,`.pending-${randomUUID()}.tmp`);
  try{
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
    await link(temporary,path);
    const published=await open(path,'r+');try{await published.sync();}finally{await published.close();}
    // Directory fsync is available on POSIX. Windows does not expose it through Node;
    // the complete file and published hard link are flushed, as in the durable armer.
    if(process.platform!=='win32'){const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
  }finally{await unlink(temporary).catch(()=>undefined);}
}
