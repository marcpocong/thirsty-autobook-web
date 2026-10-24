import { createHash } from 'node:crypto';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

const productName='Thirsty Pickle Bot';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const iconBytes=item=>Buffer.from(item.isRaw()?item.bin:item.generate());
// Windows stores a 256-pixel icon dimension as zero in the group directory.
const iconFrames=items=>items.map(item=>`${item.width||256}x${item.height||256}:${sha(iconBytes(item))}`).sort();
const readRuntime=bytes=>{
  // Branding changes PE resources, so an upstream signature cannot describe the customized binary.
  const exe=NtExecutable.from(bytes,{ignoreCert:true});
  return {exe,res:NtExecutableResource.from(exe)};
};

/** Verify the default executable icon itself, rather than just BrowserWindow metadata. */
export function verifyRuntimeBranding(binary,ico) {
  const {res}=readRuntime(binary),groups=Resource.IconGroupEntry.fromEntries(res.entries);
  const expected=Data.IconFile.from(ico).icons.map(item=>item.data);
  if(!expected.length||groups.length!==1||JSON.stringify(iconFrames(groups[0].getIconItemsFromEntries(res.entries)))!==JSON.stringify(iconFrames(expected)))
    throw Error('WINDOWS_RUNTIME_ICON_MISMATCH');
  const versions=Resource.VersionInfo.fromEntries(res.entries);
  if(versions.length!==1)throw Error('WINDOWS_RUNTIME_VERSION_UNRECOGNIZED');
  const languages=versions[0].getAllLanguagesForStringValues();
  if(!languages.length||languages.some(lang=>{
    const strings=versions[0].getStringValues(lang);return strings.ProductName!==productName||strings.FileDescription!==productName;
  }))throw Error('WINDOWS_RUNTIME_PRODUCT_MISMATCH');
  return {productName,iconFrames:expected.length,iconSha256:sha(ico),runtimeSha256:sha(binary)};
}

/** Pure resource customization, used only on the staged copy by the canonical updater. */
export function brandElectronRuntime(binary,ico) {
  const {exe,res}=readRuntime(binary),groups=Resource.IconGroupEntry.fromEntries(res.entries);
  const icons=Data.IconFile.from(ico).icons.map(item=>item.data);
  if(groups.length!==1||!icons.length)throw Error('WINDOWS_RUNTIME_ICON_UNRECOGNIZED');
  Resource.IconGroupEntry.replaceIconsForResource(res.entries,groups[0].id,groups[0].lang,icons);
  const versions=Resource.VersionInfo.fromEntries(res.entries);
  if(versions.length!==1||!versions[0].getAllLanguagesForStringValues().length)throw Error('WINDOWS_RUNTIME_VERSION_UNRECOGNIZED');
  for(const lang of versions[0].getAllLanguagesForStringValues())versions[0].setStringValues(lang,{ProductName:productName,FileDescription:productName});
  versions[0].outputToResourceEntries(res.entries);
  res.outputResource(exe);
  const result=Buffer.from(exe.generate());
  verifyRuntimeBranding(result,ico);
  // A resource-only change must never change any executable code section.
  const codeSections=bytes=>readRuntime(bytes).exe.getAllSections().filter(section=>(section.info.characteristics&0x20000000)!==0)
    .map(section=>[section.info.name,sha(Buffer.from(section.data??new ArrayBuffer(0)))]);
  if(JSON.stringify(codeSections(binary))!==JSON.stringify(codeSections(result)))throw Error('WINDOWS_RUNTIME_CODE_CHANGED');
  return result;
}
