// make.fun dashboard dossier builder. Node standard library only; this is the kit's supplied library.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';

export const DOSSIER_SCHEMA = 'makefun/dossier/v1';
export const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
export const DOSSIER_MAX_IMAGES = 8;
export const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export const TEXT_FILE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
export interface DossierCaps { text_max_bytes:number; screenshots?:{max:number;max_bytes:number}; dashboard?:{max_files:number;max_bytes:number} }
export class DossierError extends Error { constructor(message:string){super(message);this.name='DossierError';} }
const sha256Hex=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const byCodeUnit=(a:string,b:string)=>a<b?-1:a>b?1:0;
const byteLength=(s:string)=>Buffer.byteLength(s,'utf8');
const PNG_MAGIC=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], JPEG_MAGIC=[0xff,0xd8,0xff];
const opensWith=(bytes:Uint8Array,magic:readonly number[])=>bytes.length>=magic.length&&magic.every((b,i)=>bytes[i]===b);
function readCapped(path:string,cap:number,what:string):Uint8Array {
 let size:number; try{const st=lstatSync(path);if(!st.isFile())throw new DossierError(`buildDossier: ${what} is not a regular file`);size=st.size;}catch(err){if(err instanceof DossierError)throw err;throw new DossierError(`buildDossier: ${what} cannot be read`);}
 if(size>cap)throw new DossierError(`buildDossier: ${what} is ${size} bytes, over the ${cap} a dossier reads`);
 let fd:number;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch{throw new DossierError(`buildDossier: ${what} is not a regular file`);}
 try{const now=fstatSync(fd).size;if(now>cap)throw new DossierError(`buildDossier: ${what} is ${now} bytes, over the ${cap} a dossier reads`);const buf=Buffer.alloc(now);let at=0;while(at<buf.length){const n=readSync(fd,buf,at,buf.length-at,at);if(n===0)break;at+=n;}return new Uint8Array(buf.buffer,buf.byteOffset,at);}finally{closeSync(fd);}
}
function lineCount(bytes:Uint8Array){if(bytes.length===0)return 0;let n=0;for(const b of bytes)if(b===10)n++;return bytes[bytes.length-1]===10?n:n+1;}
function fenceFor(body:string){let longest=0;for(const run of body.match(/`+/g)??[])longest=Math.max(longest,run.length);return '`'.repeat(Math.max(3,longest+1));}
function languageOf(path:string){const ext=path.slice(path.lastIndexOf('.')+1);return ext==='mjs'?'js':ext;}
export function canonicalJson(value:unknown):string {
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError(`canonicalJson: ${value} is not a finite number`);return JSON.stringify(value);}
 if(Array.isArray(value))return `[${value.map(v=>canonicalJson(v)).join(',')}]`;
 if(typeof value==='object'){const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)throw new TypeError('canonicalJson: only plain objects and arrays');const o=value as Record<string,unknown>;return `{${Object.keys(o).sort(byCodeUnit).map(k=>`${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;}
 throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`);
}
interface DashFile{path:string;size:number}
function dashboardFiles(root:string,caps:{max_files:number;max_bytes:number}|null):DashFile[]{
 let st:import('node:fs').Stats;try{st=lstatSync(root);}catch{throw new DossierError('buildDossier: no dashboard/ directory: the page and its source are what the judge reads');}
 if(!st.isDirectory())throw new DossierError('buildDossier: dashboard is not a directory');const out:DashFile[]=[];let bytes=0;const stack=[''];
 while(stack.length){const rel=stack.pop()!;for(const e of readdirSync(rel===''?root:join(root,rel),{withFileTypes:true})){const p=rel===''?e.name:`${rel}/${e.name}`;if(e.isDirectory()){if(e.name.startsWith('.'))throw new DossierError(`buildDossier: dashboard/${p} is a dot-directory`);stack.push(p);}else if(e.isFile()){if(!PLAIN_NAME.test(e.name))throw new DossierError(`buildDossier: dashboard/${p}: a file's name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);const size=lstatSync(join(root,p)).size;out.push({path:p,size});bytes+=size;if(caps!==null&&out.length>caps.max_files)throw new DossierError(`buildDossier: dashboard/ holds more than the ${caps.max_files} files it may`);if(caps!==null&&bytes>caps.max_bytes)throw new DossierError(`buildDossier: dashboard/'s files come to more than the ${caps.max_bytes} bytes they may`);}else throw new DossierError(`buildDossier: dashboard/${p} is neither a file nor a directory`);}}
 return out.sort((a,b)=>byCodeUnit(a.path,b.path));
}
interface ShownFile{bytes:Uint8Array;text:string;fence:string;lang:string;block:string;blockBytes:number;lines:number}
function fileHead(heading:string,code:ShownFile,room:number,tail:(hidden:number)=>string):string|null {
 const total=code.lines,lines=code.text.split('\n'),open=`${code.fence}${code.lang}\n`,close=`${code.fence}\n\n`,note=(k:number)=>`[${total-k} of this file's ${total} lines not shown.]\n`,fixed=byteLength(heading)+byteLength(open)+byteLength(close);let best=0,shown=0,raw=0;
 for(let k=1;k<total;k++){shown+=byteLength(lines[k-1]!)+1;raw=code.bytes.indexOf(10,raw)+1;if(fixed+shown+byteLength(note(k))+byteLength(tail(code.bytes.length-raw))<=room)best=k;}
 if(best===0)return null;let rawEnd=0;for(let k=0;k<best;k++)rawEnd=code.bytes.indexOf(10,rawEnd)+1;const head=lines.slice(0,best).map(l=>`${l}\n`).join('');return `${heading}${open}${head}${close}${note(best)}${tail(code.bytes.length-rawEnd)}`;
}
export function buildDossier(dir:string,caps:DossierCaps):Uint8Array {
 const max=caps.text_max_bytes;if(!Number.isSafeInteger(max)||max<=0)throw new DossierError(`buildDossier: caps.text_max_bytes must be a positive integer, not ${String(max)}`);
 let maxImages={n:DOSSIER_MAX_IMAGES,whose:'a dossier holds'},maxImageBytes={n:DOSSIER_MAX_BYTES,whose:'a dossier holds'};
 if(caps.screenshots!==undefined){const s=caps.screenshots as {max?:unknown;max_bytes?:unknown}|null;if(typeof s!=='object'||s===null)throw new DossierError('buildDossier: caps.screenshots must be an object {max, max_bytes}');for(const k of ['max','max_bytes'] as const){const v=s[k];if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0)throw new DossierError(`buildDossier: caps.screenshots.${k} must be a positive integer, not ${String(v)}`);}if((s.max as number)<maxImages.n)maxImages={n:s.max as number,whose:'caps.screenshots.max allows'};if((s.max_bytes as number)<maxImageBytes.n)maxImageBytes={n:s.max_bytes as number,whose:'caps.screenshots.max_bytes allows'};}
 let fileCaps:{max_files:number;max_bytes:number}|null=null;if(caps.dashboard!==undefined){const d=caps.dashboard as {max_files?:unknown;max_bytes?:unknown}|null;if(typeof d!=='object'||d===null)throw new DossierError('buildDossier: caps.dashboard must be an object {max_files, max_bytes}');for(const k of ['max_files','max_bytes'] as const){const v=d[k];if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0)throw new DossierError(`buildDossier: caps.dashboard.${k} must be a positive integer, not ${String(v)}`);}fileCaps={max_files:d.max_files as number,max_bytes:d.max_bytes as number};}
 const files=dashboardFiles(join(dir,'dashboard'),fileCaps),shotsDir=join(dir,'screenshots');let shotNames:string[];try{shotNames=readdirSync(shotsDir,{withFileTypes:true}).filter(e=>e.isFile()&&!e.name.startsWith('.')).map(e=>e.name).sort(byCodeUnit);}catch(err){if((err as {code?:string}).code==='ENOENT')throw new DossierError('buildDossier: no screenshots/ directory: the first screenshot is the cover');throw new DossierError('buildDossier: screenshots/ cannot be read');}
 if(shotNames.length===0)throw new DossierError('buildDossier: screenshots/ holds no image: the first is the cover');if(shotNames.length>maxImages.n)throw new DossierError(`buildDossier: screenshots/ holds ${shotNames.length} files, over the ${maxImages.n} ${maxImages.whose}`);
 const images=shotNames.map(name=>{if(!PLAIN_NAME.test(name))throw new DossierError(`buildDossier: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);const bytes=readCapped(join(shotsDir,name),maxImageBytes.n,`screenshots/${name}`),media_type=opensWith(bytes,PNG_MAGIC)?'image/png':opensWith(bytes,JPEG_MAGIC)?'image/jpeg':null;if(media_type===null)throw new DossierError(`buildDossier: screenshots/${name} is neither a PNG nor a JPEG`);return {name,media_type,sha256:sha256Hex(bytes),base64:Buffer.from(bytes).toString('base64')};});
 const head=['## Dashboard','','Files: '+files.length+' ('+files.reduce((n,f)=>n+f.size,0)+' bytes)',...files.map(f=>`- ${f.path} (${f.size} bytes)`),'','## Source','',''].join('\n');
 const shown=files.filter(f=>TEXT_FILE.test(f.path));type Section={heading:string;code:ShownFile|null;size:number;bytes:number};
 const sections:Section[]=shown.map(f=>{const bytes=readCapped(join(dir,'dashboard',f.path),DOSSIER_MAX_BYTES,`dashboard/${f.path}`),lines=lineCount(bytes),heading=`### ${f.path}\n\n${bytes.length} bytes, ${lines} line${lines===1?'':'s'}\n\n`;if(bytes.length===0)return {heading,code:null,size:byteLength(heading),bytes:0};const text=new TextDecoder('utf-8').decode(bytes),fence=fenceFor(text),lang=languageOf(f.path),block=`${fence}${lang}\n${text}${text.endsWith('\n')?'':'\n'}${fence}\n\n`;return {heading,code:{bytes,text,fence,lang,block,blockBytes:byteLength(block),lines},size:byteLength(heading)+byteLength(block),bytes:bytes.length};});
 const restBytes=new Array<number>(sections.length+1).fill(0);for(let k=sections.length-1;k>=0;k--)restBytes[k]=restBytes[k+1]!+(k+1<sections.length?sections[k+1]!.bytes:0);
 const cutLine=(count:number,bytes:number)=>`[Cut at ${max} bytes: ${count} file${count===1?'':'s'} and ${bytes} bytes left out.]\n`;let text=head,used=byteLength(head);if(used+byteLength(cutLine(0,0))>max)throw new DossierError(`buildDossier: caps.text_max_bytes ${max} cannot hold even the Dashboard block and the cut line`);let kept=0;
 for(;kept<sections.length;kept++){const section=sections[kept]!,restCount=sections.length-kept-1,tail=restCount===0?0:byteLength(cutLine(restCount,restBytes[kept]!));if(used+section.size+tail>max)break;text+=section.code===null?section.heading:`${section.heading}${section.code.block}`;used+=section.size;}
 if(kept<sections.length){const first=sections[kept]!,restCount=sections.length-kept-1,after=restBytes[kept]!,part=first.code===null?null:fileHead(first.heading,first.code,max-used,hidden=>cutLine(restCount,after+hidden));text+=part??cutLine(restCount+1,after+first.bytes);}
 if(byteLength(text)>max)throw new DossierError(`buildDossier: caps.text_max_bytes ${max} cannot hold even the Dashboard block and the cut line`);const doc={schema:DOSSIER_SCHEMA,cover:0,text:text.replace(/\n+$/,'\n'),images},bytes=Buffer.from(canonicalJson(doc),'utf8');if(bytes.length>DOSSIER_MAX_BYTES)throw new DossierError(`buildDossier: the dossier is ${bytes.length} bytes, over the ${DOSSIER_MAX_BYTES} one holds`);return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.length);
}
