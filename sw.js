const CACHE='agr-app-v3';
const SHELL=['/','/index.html','/manifest.webmanifest','/app-icon.svg','/boleto.js'];
const BOLETO_SCRIPT='<script src="/boleto.js"></script>';

function withBoletoScript(html){
  if(html.includes('/boleto.js'))return html;
  return html.includes('</body>')?html.replace('</body>',BOLETO_SCRIPT+'</body>'):html+BOLETO_SCRIPT;
}

async function appResponse(res){
  if(!res||!res.ok)return res;
  const type=res.headers.get('content-type')||'';
  if(!type.includes('text/html'))return res;
  const html=withBoletoScript(await res.text());
  const headers=new Headers(res.headers);
  headers.delete('content-length');
  return new Response(html,{status:res.status,statusText:res.statusText,headers});
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const network=await fetch(req);
        const modified=await appResponse(network);
        if(modified&&modified.ok){const copy=modified.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy))}
        return modified;
      }catch(_){const cached=await caches.match('/index.html');return cached?appResponse(cached):cached}
    })());
    return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res})));
});
