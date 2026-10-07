(function(){
  if(typeof window.cli!=='function'||window.__agrBoletoPatch)return;
  window.__agrBoletoPatch=true;
  const originalCli=window.cli;

  function safeHttpUrl(value){
    const s=String(value||'').trim();if(!s)return'';
    try{const u=new URL(s,location.origin);return(u.protocol==='http:'||u.protocol==='https:')?u.href:''}catch(_){return''}
  }
  function boletoStatus(p){if(p.pago)return{label:'Pago',cls:'up'};if(p.d&&p.d<TODAY)return{label:'Vencido',cls:'dn'};return{label:'Pendente',cls:'dn'}}
  function hasBoleto(p){return!!(p.boletoPdf||p.boletoUrl||p.linhaDigitavel)}
  function boletoActions(c,p,index){
    const url=safeHttpUrl(p.boletoUrl),line=String(p.linhaDigitavel||'').trim();let out='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
    if(p.boletoPdf)out+=`<a href="${p.boletoPdf}" target="_blank" rel="noopener" style="cursor:pointer;color:var(--ac);font-weight:600">abrir PDF</a>`;
    else if(url)out+=`<a href="${esc(url)}" target="_blank" rel="noopener" style="cursor:pointer;color:var(--ac);font-weight:600">abrir boleto</a>`;
    if(line)out+=`<a style="cursor:pointer;color:var(--ac)" onclick="copyBoleto(${c.id},${index})">copiar linha</a>`;
    out+=`<a style="cursor:pointer;color:var(--ac)" onclick="attachBoletoPdf(${c.id},${index})">${p.boletoPdf?'trocar PDF':'anexar PDF'}</a>`;
    out+=`<a style="cursor:pointer;color:var(--ac)" onclick="editBoleto(${c.id},${index})">editar</a>`;
    out+=`<a style="cursor:pointer;color:var(--ac)" onclick="togP(${c.id},${index})">${p.pago?'desfazer pago':'marcar pago'}</a>`;
    if(p.manualBoleto&&ME.role==='admin')out+=`<a style="cursor:pointer;color:var(--bad)" onclick="delBoleto(${c.id},${index})">remover</a>`;
    out+='</div>';return out;
  }
  function renderBoletoSection(c){
    if(!Array.isArray(c.pays))c.pays=[];
    const rows=[...c.pays].map((p,i)=>({p,i})).reverse().map(({p,i})=>{const st=boletoStatus(p),details=[];
      if(p.boletoPdfName)details.push(`<small style="display:block;color:var(--mu);margin-top:4px">PDF: ${esc(p.boletoPdfName)}</small>`);
      if(p.linhaDigitavel)details.push(`<small style="display:block;color:var(--mu);margin-top:4px;max-width:520px;word-break:break-all">Linha: ${esc(p.linhaDigitavel)}</small>`);
      if(p.boletoObs)details.push(`<small style="display:block;color:var(--mu);margin-top:4px">${esc(p.boletoObs)}</small>`);
      return `<tr><td>${br(p.d)}</td><td>${R(+p.v||0)}</td><td class="${st.cls}"><b>${st.label}</b></td><td>${hasBoleto(p)?'<span class="up">Boleto anexado</span>':'<span style="color:var(--mu)">Sem boleto</span>'}${details.join('')}</td><td>${boletoActions(c,p,i)}</td></tr>`}).join('');
    return `<div class="cd tw"><div class="top"><div><h3 style="margin:0">Pagamentos e boletos</h3><small style="color:var(--mu)">Anexe o PDF do boleto ou informe o link/linha digitável de cada cobrança.</small></div><button onclick="addBoleto(${c.id})">+ Adicionar boleto</button></div><table style="min-width:820px;margin-top:12px"><tr><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Boleto</th><th>Ações</th></tr>${rows||'<tr><td colspan="5">Sem pagamentos ou boletos.</td></tr>'}</table></div>`;
  }
  window.cli=function(){const html=originalCli(),c=gc(V.id);if(!c)return html;return html.replace(/<div class="cd tw"><h3>Pagamentos<\/h3><table[\s\S]*?<\/table><\/div>/,renderBoletoSection(c))};

  window.addBoleto=function(id){
    const c=gc(id);if(!c)return;
    modal('Adicionar boleto',[{k:'d',l:'Vencimento',t:'date'},{k:'v',l:'Valor (R$)',t:'number'},{k:'boletoUrl',l:'Link do boleto',t:'url'},{k:'linhaDigitavel',l:'Linha digitável / código de barras'},{k:'boletoObs',l:'Observação',t:'textarea'}],{d:(typeof prox==='function'&&prox(c))||TODAY,v:mens(c)||0,boletoUrl:'',linhaDigitavel:'',boletoObs:''},o=>{
      const value=+o.v||0,url=String(o.boletoUrl||'').trim();if(!o.d){alert('Informe o vencimento do boleto.');return}if(value<=0){alert('Informe um valor válido para o boleto.');return}if(url&&!safeHttpUrl(url)){alert('Informe um link válido começando com http:// ou https://.');return}
      c.pays.push({d:o.d,v:value,pago:false,boletoUrl:url,linhaDigitavel:String(o.linhaDigitavel||'').trim(),boletoObs:String(o.boletoObs||'').trim(),boletoPdf:'',boletoPdfName:'',manualBoleto:true});
      c.hist=c.hist||[];c.hist.push({d:TODAY,t:'Observação',x:'Boleto cadastrado com vencimento em '+br(o.d)+' no valor de '+R(value)+'.'});done();
      const idx=c.pays.length-1;if(confirm('Deseja anexar o PDF do boleto agora?'))setTimeout(()=>attachBoletoPdf(id,idx),100);
    },'Cadastrar boleto');
  };

  window.attachBoletoPdf=function(id,index){
    const c=gc(id),p=c?.pays?.[index];if(!p)return;
    const input=document.createElement('input');input.type='file';input.accept='application/pdf,.pdf';input.style.display='none';document.body.appendChild(input);
    input.onchange=()=>{const file=input.files&&input.files[0];if(!file){input.remove();return}if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){alert('Selecione um arquivo PDF.');input.remove();return}if(file.size>1.5*1024*1024){alert('O PDF deve ter no máximo 1,5 MB para ser salvo dentro da AGR Gestão. Se for maior, use o campo Link do boleto.');input.remove();return}
      const reader=new FileReader();reader.onload=()=>{p.boletoPdf=reader.result;p.boletoPdfName=file.name;c.hist=c.hist||[];c.hist.push({d:TODAY,t:'Observação',x:'PDF do boleto anexado: '+file.name+'.'});done();input.remove()};reader.onerror=()=>{alert('Não foi possível ler o PDF.');input.remove()};reader.readAsDataURL(file)};
    input.click();
  };

  window.editBoleto=function(id,index){const c=gc(id),p=c&&c.pays&&c.pays[index];if(!p)return;modal('Editar boleto',[{k:'d',l:'Vencimento',t:'date'},{k:'v',l:'Valor (R$)',t:'number'},{k:'boletoUrl',l:'Link do boleto',t:'url'},{k:'linhaDigitavel',l:'Linha digitável / código de barras'},{k:'boletoObs',l:'Observação',t:'textarea'}],p,o=>{const value=+o.v||0,url=String(o.boletoUrl||'').trim();if(!o.d||value<=0){alert('Informe vencimento e valor válidos.');return}if(url&&!safeHttpUrl(url)){alert('Informe um link válido começando com http:// ou https://.');return}Object.assign(p,{d:o.d,v:value,boletoUrl:url,linhaDigitavel:String(o.linhaDigitavel||'').trim(),boletoObs:String(o.boletoObs||'').trim()});done()},'Salvar boleto')};
  window.copyBoleto=async function(id,index){const p=gc(id)?.pays?.[index],txt=String(p?.linhaDigitavel||'').trim();if(!txt)return;try{await navigator.clipboard.writeText(txt);alert('Linha digitável copiada.')}catch(_){prompt('Copie a linha digitável:',txt)}};
  window.delBoleto=function(id,index){const c=gc(id),p=c?.pays?.[index];if(!p||ME.role!=='admin')return;if(!confirm('Remover este boleto do cliente?'))return;c.pays.splice(index,1);done()};
})();
