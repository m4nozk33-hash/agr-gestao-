(function(){
  function iniciarBoletos(){
    if(window.__agrBoletoPatch)return true;
    if(typeof cli!=='function'||typeof gc!=='function'||typeof modal!=='function')return false;
    window.__agrBoletoPatch=true;
    const originalCli=cli;

    function safeHttpUrl(value){
      const s=String(value||'').trim();if(!s)return'';
      try{const u=new URL(s,location.origin);return(u.protocol==='http:'||u.protocol==='https:')?u.href:''}catch(_){return''}
    }
    function boletoStatus(p){if(p.pago)return{label:'Pago',cls:'up'};if(p.d&&p.d<TODAY)return{label:'Vencido',cls:'dn'};return{label:'Pendente',cls:'dn'}}
    function hasBoleto(p){return!!(p.boletoPdf||p.boletoUrl||p.linhaDigitavel)}
    function nomeArquivo(v){return String(v||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase()||'cliente'}
    function baixarBlob(conteudo,tipo,nome){const blob=conteudo instanceof Blob?conteudo:new Blob([conteudo],{type:tipo});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
    function csvCell(v){const s=String(v??'').replace(/"/g,'""');return `"${s}"`}
    function dadosBoleto(c,p){const st=boletoStatus(p).label;return{Cliente:c.emp||'',CPF_CNPJ:c.doc||c.cpf||c.cnpj||'',Vencimento:br(p.d),Valor:R(+p.v||0),Situacao:st,Linha_digitavel:p.linhaDigitavel||'',Link:p.boletoUrl||'',Observacao:p.boletoObs||''}}
    function htmlBoleto(c,p){const d=dadosBoleto(c,p);return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Boleto - ${esc(c.emp||'Cliente')}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}h1{margin:0 0 6px}h2{font-size:16px;margin:0 0 24px;color:#555}.box{border:1px solid #ccc;border-radius:8px;padding:18px;margin-bottom:16px}.row{margin:8px 0}.lab{font-size:12px;color:#666;text-transform:uppercase}.val{font-size:15px;word-break:break-word}</style></head><body><h1>AGR Gestão</h1><h2>Dados do boleto</h2><div class="box"><div class="row"><div class="lab">Cliente</div><div class="val">${esc(d.Cliente)}</div></div><div class="row"><div class="lab">CPF/CNPJ</div><div class="val">${esc(d.CPF_CNPJ||'-')}</div></div><div class="row"><div class="lab">Vencimento</div><div class="val">${esc(d.Vencimento)}</div></div><div class="row"><div class="lab">Valor</div><div class="val">${esc(d.Valor)}</div></div><div class="row"><div class="lab">Situação</div><div class="val">${esc(d.Situacao)}</div></div></div><div class="box"><div class="row"><div class="lab">Linha digitável</div><div class="val">${esc(d.Linha_digitavel||'-')}</div></div><div class="row"><div class="lab">Link</div><div class="val">${esc(d.Link||'-')}</div></div><div class="row"><div class="lab">Observação</div><div class="val">${esc(d.Observacao||'-')}</div></div></div></body></html>`}

    function boletoActions(c,p,index){
      const url=safeHttpUrl(p.boletoUrl),line=String(p.linhaDigitavel||'').trim();let out='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
      if(p.boletoPdf)out+=`<a href="${p.boletoPdf}" target="_blank" rel="noopener" style="cursor:pointer;color:var(--ac);font-weight:600">abrir PDF</a>`;
      else if(url)out+=`<a href="${esc(url)}" target="_blank" rel="noopener" style="cursor:pointer;color:var(--ac);font-weight:600">abrir boleto</a>`;
      if(line)out+=`<a style="cursor:pointer;color:var(--ac)" onclick="copyBoleto(${c.id},${index})">copiar linha</a>`;
      out+=`<a style="cursor:pointer;color:var(--ac)" onclick="attachBoletoPdf(${c.id},${index})">${p.boletoPdf?'trocar PDF':'anexar PDF'}</a>`;
      out+=`<a style="cursor:pointer;color:var(--ac)" onclick="editBoleto(${c.id},${index})">editar</a>`;
      out+=`<select aria-label="Exportar boleto" onchange="if(this.value){exportarBoleto(${c.id},${index},this.value);this.value=''}" style="width:auto;min-width:118px;padding:6px 8px"><option value="">Exportar...</option><option value="pdf">PDF</option><option value="doc">DOC (Word)</option><option value="csv">CSV</option><option value="txt">TXT</option><option value="json">JSON</option></select>`;
      if(p.manualBoleto&&ME.role==='admin')out+=`<a style="cursor:pointer;color:var(--bad)" onclick="delBoleto(${c.id},${index})">remover</a>`;
      out+='</div>';return out;
    }
    function renderBoletoSection(c){
      if(!Array.isArray(c.pays))c.pays=[];
      const rows=[...c.pays].map((p,i)=>({p,i})).reverse().map(({p,i})=>{const st=boletoStatus(p),details=[];
        if(p.boletoPdfName)details.push(`<small style="display:block;color:var(--mu);margin-top:4px">PDF: ${esc(p.boletoPdfName)}</small>`);
        if(p.linhaDigitavel)details.push(`<small style="display:block;color:var(--mu);margin-top:4px;max-width:520px;word-break:break-all">Linha: ${esc(p.linhaDigitavel)}</small>`);
        if(p.boletoObs)details.push(`<small style="display:block;color:var(--mu);margin-top:4px">${esc(p.boletoObs)}</small>`);
        return `<tr><td>${br(p.d)}</td><td>${R(+p.v||0)}</td><td class="${st.cls}"><b>${st.label}</b></td><td>${hasBoleto(p)?'<span class="up">Boleto anexado</span>':'<span style="color:var(--mu)">Ainda não anexado</span>'}${details.join('')}</td><td>${boletoActions(c,p,i)}</td></tr>`}).join('');
      return `<div class="cd tw" style="margin-bottom:12px"><div class="top"><div><h3 style="margin:0">Boletos</h3><small style="color:var(--mu)">Adicione, consulte e exporte o boleto deste cliente em vários formatos.</small></div><button onclick="addBoleto(${c.id})">+ Adicionar boleto</button></div><table style="min-width:900px;margin-top:12px"><tr><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Boleto</th><th>Ações / Exportar</th></tr>${rows||'<tr><td colspan="5">Nenhum boleto cadastrado.</td></tr>'}</table></div>`;
    }
    window.cli=function(){
      const html=originalCli(),c=gc(V.id);if(!c)return html;
      const marcador='<div class="g2"><div class="cd"><h3>Linha do tempo</h3>';
      if(html.includes('>Boletos</h3>'))return html;
      return html.includes(marcador)?html.replace(marcador,renderBoletoSection(c)+marcador):html;
    };

    window.exportarBoleto=function(id,index,formato){
      const c=gc(id),p=c?.pays?.[index];if(!c||!p)return;
      const base=`boleto_${nomeArquivo(c.emp)}_${String(p.d||TODAY).replace(/-/g,'')}`;
      const d=dadosBoleto(c,p);
      if(formato==='pdf'){
        if(p.boletoPdf){const a=document.createElement('a');a.href=p.boletoPdf;a.download=(p.boletoPdfName||base+'.pdf');document.body.appendChild(a);a.click();a.remove();return}
        const w=window.open('','_blank');if(!w){alert('O navegador bloqueou a janela de exportação. Libere pop-ups e tente novamente.');return}w.document.open();w.document.write(htmlBoleto(c,p));w.document.close();setTimeout(()=>{w.focus();w.print()},250);return;
      }
      if(formato==='doc'){baixarBlob('\ufeff'+htmlBoleto(c,p),'application/msword;charset=utf-8',base+'.doc');return}
      if(formato==='csv'){const keys=Object.keys(d);const csv='\ufeff'+keys.map(csvCell).join(';')+'\n'+keys.map(k=>csvCell(d[k])).join(';');baixarBlob(csv,'text/csv;charset=utf-8',base+'.csv');return}
      if(formato==='txt'){const txt=Object.entries(d).map(([k,v])=>`${k.replace(/_/g,' ')}: ${v}`).join('\n');baixarBlob(txt,'text/plain;charset=utf-8',base+'.txt');return}
      if(formato==='json'){baixarBlob(JSON.stringify(d,null,2),'application/json;charset=utf-8',base+'.json')}
    };

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

    try{if(typeof render==='function')render()}catch(_){ }
    return true;
  }

  if(iniciarBoletos())return;
  let tentativas=0;
  const timer=setInterval(()=>{tentativas++;if(iniciarBoletos()||tentativas>=100)clearInterval(timer)},100);
  window.addEventListener('load',()=>{setTimeout(iniciarBoletos,0)},{once:true});
})();
