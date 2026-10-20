(() => {
 'use strict';
 if (!window.WanWanNative) return;
 const native = window.WanWanNative;
 const originalFetch = window.fetch.bind(window);
 const jobs = new Map();
 const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
 const base64 = buffer => {
  const a = new Uint8Array(buffer); let s = '';
  for (let i=0;i<a.length;i+=8192) s += String.fromCharCode(...a.subarray(i,i+8192));
  return btoa(s);
 };
 window.__wanwanEvent = (id, kind, payload) => {
  const j = jobs.get(id); if (!j) return;
  try {
   if (kind === 'headers') {
    j.headers = true;
    const noBody = j.method === 'HEAD' || [204,205,304].includes(payload.status);
    const body = noBody ? null : new ReadableStream({start(c){j.controller=c;},cancel(){native.abort(id);j.cleanup();}});
    j.resolve(new Response(body,{status:payload.status,statusText:payload.statusText || '',headers:payload.headers}));
   } else if (kind === 'chunk') { if(j.controller) j.controller.enqueue(bytes(payload)); }
   else if (kind === 'end') {if(j.controller) j.controller.close();j.cleanup();}
   else if (kind === 'error') {const e=new TypeError(payload);if(j.headers){if(j.controller)j.controller.error(e);}else j.reject(e);j.cleanup();}
  } catch(e) {if(!j.headers)j.reject(e);else if(j.controller){try{j.controller.error(e);}catch(_){}}native.abort(id);j.cleanup();}
 };
 window.fetch = async (input, init) => {
  let req = new Request(input,init);
  const url = new URL(req.url,location.href);
  if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return originalFetch(req);
  if (req.signal.aborted) throw req.signal.reason || new DOMException('Aborted','AbortError');
  const body = ['GET','HEAD'].includes(req.method) ? null : base64(await req.arrayBuffer());
  if(req.signal.aborted)throw req.signal.reason || new DOMException('Aborted','AbortError');
  const id = crypto.randomUUID();
  return new Promise((resolve,reject) => {
   const job = {resolve,reject,method:req.method,headers:false,controller:null,cleanup(){jobs.delete(id);req.signal.removeEventListener('abort',abort);}};
   const abort = () => {const e=req.signal.reason || new DOMException('Aborted','AbortError');native.abort(id);if(job.headers){if(job.controller)job.controller.error(e);}else reject(e);job.cleanup();};
   jobs.set(id,job);req.signal.addEventListener('abort',abort,{once:true});
   try{native.request(id,JSON.stringify({url:req.url,method:req.method,headers:Object.fromEntries(req.headers),body}));}catch(e){job.cleanup();reject(e);}
  });
 };
 // Preserve the blob reference before the original code revokes its temporary URL.
 const blobs=new Map(), create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL = b => {const u=create(b);blobs.set(u,b);return u;};
 URL.revokeObjectURL = u => {blobs.delete(u);revoke(u);};
 async function download(url,name){
  let id='';const local=blobs.get(url);
  try{
   const blob=local || await (await window.fetch(url)).blob();
   id=native.beginExport();if(!id)throw new Error('无法创建临时备份文件');
   for(let offset=0;offset<blob.size;offset+=192*1024){const chunk=await blob.slice(offset,offset+192*1024).arrayBuffer();if(!native.appendExport(id,base64(chunk)))throw new Error('备份文件写入失败');}
   native.saveExport(id,name || 'WanWan-export',blob.type || 'application/octet-stream');
  }catch(e){if(id)native.cancelExport(id);alert('保存失败：'+e.message);}
 }
 window.__wanwanDownload=download;
 const click=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download')){download(this.href,this.download);return;}return click.call(this);};
 document.addEventListener('click',e=>{const a=e.target.closest?.('a[download]');if(a){e.preventDefault();download(a.href,a.download);}},true);

})();
