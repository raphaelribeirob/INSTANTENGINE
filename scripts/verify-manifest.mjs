/** Reproducible SHA-256 and inventory verification for private INSTANTENGINE QA builds. */
import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifestFile=join(root,'RELEASE_MANIFEST.json');
const ignored=new Set(['RELEASE_MANIFEST.json','.DS_Store']);
export async function inventory(directory=root){
 const records=[];
 async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
   if(['node_modules','.git','__pycache__','.pytest_cache','coverage'].includes(entry.name))continue;
   const full=join(dir,entry.name),rel=relative(directory,full).replaceAll('\\','/');
   if(ignored.has(rel))continue;
   if(entry.isSymbolicLink())throw new Error('Symlink refused in release: '+rel);
   if(entry.isDirectory()){await walk(full);continue;}
   if(!entry.isFile())throw new Error('Unsupported release entry: '+rel);
   const stat=await lstat(full),bytes=await readFile(full);
   records.push({path:rel,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:stat.size});
  }
 }
 await walk(directory);return records.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function makeManifest(){
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 const files=await inventory();
 return {product:'INSTANTENGINE',version:pkg.version,package_name:pkg.name,status:'source QA, not deployed',file_count_excluding_manifest:files.length,files};
}
export async function verifyManifest(){
 const expected=JSON.parse(await readFile(manifestFile,'utf8'));
 const actual=await makeManifest();
 if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('Release manifest verification FAILED (changed/missing/extra files or metadata)');
 return {status:'pass',version:actual.version,files:actual.files.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--write')){
  await writeFile(manifestFile,JSON.stringify(await makeManifest(),null,2)+'\n');
  console.log('WROTE SHA-256 source manifest');
 }else console.log(JSON.stringify(await verifyManifest()));
}
