import { describe,it,expect } from 'vitest';
import { Data,NtExecutable,NtExecutableResource,Resource } from 'resedit';
// @ts-expect-error plain ESM packaging helper
import { brandElectronRuntime,verifyRuntimeBranding } from '../scripts/brand-electron-runtime.mjs';

// A complete tiny PNG; resource tests run on Linux CI as well as Windows.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function fixture(){
  const exe=NtExecutable.createEmpty(false,false),res=NtExecutableResource.from(exe),ico=new Data.IconFile();
  ico.icons.push({data:Data.RawIconItem.from(png,1,1,32)});
  ico.icons.push({data:Data.RawIconItem.from(png,256,256,32)});
  Resource.IconGroupEntry.replaceIconsForResource(res.entries,1,1033,[Data.RawIconItem.from(png,1,1,32)]);
  Resource.VersionInfo.create({lang:1033,fixedInfo:{fileVersionMS:44<<16,fileVersionLS:3<<16},strings:[{lang:1033,codepage:1200,values:{ProductName:'Electron',FileDescription:'Electron',FileVersion:'44.3.0'}}]}).outputToResourceEntries(res.entries);
  res.entries.push({type:24,id:1,lang:1033,codepage:1200,bin:new TextEncoder().encode('<manifest>asInvoker</manifest>').buffer});
  res.outputResource(exe);
  return {original:Buffer.from(exe.generate()),ico:Buffer.from(ico.generate())};
}
describe('Windows running-executable branding',()=>{
  it('rejects stock Electron resources, brands the PE itself, and preserves the original and unrelated resources',()=>{
    const {original,ico}=fixture(),before=Buffer.from(original);
    expect(()=>verifyRuntimeBranding(original,ico)).toThrow('WINDOWS_RUNTIME_ICON_MISMATCH');
    const branded=brandElectronRuntime(original,ico);
    expect(verifyRuntimeBranding(branded,ico)).toMatchObject({productName:'Thirsty Pickle Bot',iconFrames:2});
    expect(original).toEqual(before);
    const res=NtExecutableResource.from(NtExecutable.from(branded));
    expect(Buffer.from(res.entries.find(e=>e.type===24)!.bin).toString()).toBe('<manifest>asInvoker</manifest>');
    expect(Resource.VersionInfo.fromEntries(res.entries)[0]!.getStringValues({lang:1033,codepage:1200}).FileVersion).toBe('44.3.0');
  });
  it('refuses a missing or changed default icon instead of accepting a branded product name alone',()=>{
    const {original,ico}=fixture(),branded=brandElectronRuntime(original,ico),exe=NtExecutable.from(branded),res=NtExecutableResource.from(exe);
    res.entries=res.entries.filter(e=>e.type!==3);res.outputResource(exe);
    expect(()=>verifyRuntimeBranding(Buffer.from(exe.generate()),ico)).toThrow('WINDOWS_RUNTIME_ICON_MISMATCH');
  });
});
