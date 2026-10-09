(() => {
  let RADAR_RESULTS = [];
  let RADAR_LOADING = false;

  const radarEsc = value => String(value ?? '').replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
  const fmtCnpj = value => {
    const s = String(value || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
    return s.length === 14 ? `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}` : s;
  };
  const cleanCnpj = value => String(value || '').replace(/[^0-9A-Z]/gi, '').toUpperCase().slice(0, 14);
  const fmtPhone = value => String(value || '').trim();
  const daysSince = date => date ? Math.max(0, Math.floor((new Date(TODAY + 'T12:00') - new Date(date + 'T12:00')) / 864e5)) : 9999;
  const leadScore = x => Math.min(100, 35 + (x.telefone ? 20 : 0) + (x.email ? 15 : 0) + (daysSince(x.abertura) <= 7 ? 20 : daysSince(x.abertura) <= 30 ? 10 : 0) + (x.mei ? 5 : 0) + (x.fantasia ? 5 : 0));

  async function apiRadar(params) {
    const qs = new URLSearchParams(params);
    const r = await fetch('/api/radar?' + qs.toString(), { credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Não foi possível consultar o Radar de Empresas.');
    return data;
  }

  function radarCard(x, i) {
    const score = leadScore(x);
    const duplicate = S.clients.some(c => cleanCnpj(c.doc) === cleanCnpj(x.cnpj));
    const phoneUrl = whatsappUrl(x.telefone);
    return `<div class="cd" style="margin-bottom:10px">
      <div class="top" style="margin-bottom:8px">
        <div style="min-width:0"><h3 style="margin:0 0 3px;overflow-wrap:anywhere">${radarEsc(x.fantasia || x.razaoSocial || x.nome)}</h3><small style="color:var(--mu)">${radarEsc(x.razaoSocial || '')}</small></div>
        <span class="b" style="--c:${score >= 80 ? '#16a34a' : score >= 60 ? '#f59e0b' : '#64748b'}">Lead ${score} pts</span>
      </div>
      <div class="ig" style="margin-bottom:10px">
        <div><small>CNPJ</small><b>${radarEsc(fmtCnpj(x.cnpj))}</b></div>
        <div><small>Abertura</small>${radarEsc(br(x.abertura))} · ${daysSince(x.abertura)} dia(s)</div>
        <div><small>Atividade</small>${radarEsc(x.atividade || '—')}</div>
        <div><small>CNAE</small>${radarEsc(x.cnae || '—')}</div>
        <div><small>Local</small>${radarEsc([x.municipio, x.uf].filter(Boolean).join(' / ') || '—')}</div>
        <div><small>Porte</small>${radarEsc(x.porte || '—')}${x.mei ? ' · MEI' : ''}${x.simples ? ' · Simples' : ''}</div>
        <div><small>Telefone</small>${radarEsc(x.telefone || '—')}</div>
        <div><small>E-mail</small>${radarEsc(x.email || '—')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${phoneUrl ? `<a class="wa-link" href="${radarEsc(phoneUrl)}" target="_blank" rel="noopener noreferrer"><span>WhatsApp</span><span class="contact-icon whatsapp" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.5 3.5A10 10 0 0 0 4.8 15.7L3 21l5.4-1.7A10 10 0 1 0 20.5 3.5Zm-8.4 16.1a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.2 1 1-3.1-.2-.3A8.2 8.2 0 1 1 12.1 19.6Zm4.5-6.1c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1-1.4-.7-2.4-1.3-3.3-2.9-.2-.3.2-.3.6-1 .1-.2.1-.4 0-.6l-.8-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.4-.6 1.6-1.2.2-.6.2-1.1.1-1.2-.1-.1-.2-.2-.5-.3Z"></path></svg></span></a>` : ''}
        <button ${duplicate ? 'disabled' : ''} onclick="radarAddLead(${i})">${duplicate ? '✓ Já está na AGR' : '+ Adicionar como lead'}</button>
      </div>
    </div>`;
  }

  window.radarView = function radarView() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('agr_radar_filters') || '{}'); } catch {}
    const uf = saved.uf || 'PR', city = saved.municipio || '', cnae = saved.cnae || '', days = saved.days || '30';
    return `<div class="top"><div><h2 style="margin:0">🔎 Radar de Novas Empresas</h2><small style="color:var(--mu)">Encontre CNPJs recém-abertos e transforme-os em leads da AGR.</small></div><button onclick="radarRun()">Atualizar radar</button></div>
      <div class="cd" style="margin-bottom:12px">
        <div class="g2" style="margin:0">
          <label>UF<select id="radar_uf">${['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(x => `<option ${x===uf?'selected':''}>${x}</option>`).join('')}</select></label>
          <label>Município<input id="radar_municipio" value="${radarEsc(city)}" placeholder="Ex.: Maringá"></label>
          <label>CNAE (opcional)<input id="radar_cnae" value="${radarEsc(cnae)}" inputmode="numeric" placeholder="Ex.: 5611201"></label>
          <label>Empresas abertas<select id="radar_days">${[['7','Últimos 7 dias'],['15','Últimos 15 dias'],['30','Últimos 30 dias'],['60','Últimos 60 dias'],['90','Últimos 90 dias'],['365','Último ano']].map(([v,l])=>`<option value="${v}" ${String(days)===v?'selected':''}>${l}</option>`).join('')}</select></label>
        </div>
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:10px">
          <label style="min-width:220px;margin:0">Adicionar lead para<select id="radar_colab">${S.colabs.map(c=>`<option value="${c.id}">${radarEsc(c.nome)}</option>`).join('')}</select></label>
          <button onclick="radarRun()">Pesquisar novas empresas</button>
        </div>
        <p style="color:var(--mu);font-size:12px;margin:10px 0 0">Fonte: dados públicos do CNPJ. O radar consulta uma amostra paginada e filtra pela data de abertura; não representa uma varredura integral de todos os CNPJs do Brasil.</p>
      </div>
      <div id="radar_status" class="cd" style="margin-bottom:12px">Informe os filtros e clique em pesquisar.</div>
      <div id="radar_results"></div>`;
  };

  window.radarRun = async function radarRun() {
    if (RADAR_LOADING) return;
    const status = $('#radar_status'), results = $('#radar_results');
    if (!status || !results) return;
    const filters = {
      uf: $('#radar_uf').value,
      municipio: $('#radar_municipio').value.trim(),
      cnae: $('#radar_cnae').value.trim(),
      days: $('#radar_days').value,
      limit: 60
    };
    try { localStorage.setItem('agr_radar_filters', JSON.stringify(filters)); } catch {}
    RADAR_LOADING = true;
    status.innerHTML = 'Consultando a base empresarial…';
    results.innerHTML = '';
    try {
      const response = await apiRadar({ mode: 'radar', ...filters });
      RADAR_RESULTS = response.data || [];
      const meta = response.meta || {};
      status.innerHTML = `<b>${RADAR_RESULTS.length} empresa(s) recente(s) localizada(s)</b><br><small style="color:var(--mu)">${meta.scanned || 0} registros analisados nesta consulta${meta.sourceUpdated ? ' · base: ' + radarEsc(String(meta.sourceUpdated)) : ''}</small>`;
      results.innerHTML = RADAR_RESULTS.length ? RADAR_RESULTS.map(radarCard).join('') : `<div class="cd"><b>Nenhuma empresa recente encontrada com estes filtros.</b><p style="color:var(--mu);margin-bottom:0">Tente aumentar o período, retirar o CNAE ou pesquisar outro município.</p></div>`;
    } catch (e) {
      status.innerHTML = `<span class="dn">${radarEsc(e.message)}</span>`;
    } finally { RADAR_LOADING = false; }
  };

  window.radarAddLead = function radarAddLead(index) {
    const x = RADAR_RESULTS[index];
    if (!x) return;
    const cid = Number($('#radar_colab')?.value || S.colabs[0]?.id);
    if (!cid) { alert('Cadastre um colaborador antes de adicionar leads.'); return; }
    if (S.clients.some(c => cleanCnpj(c.doc) === cleanCnpj(x.cnpj))) { alert('Este CNPJ já está cadastrado na AGR.'); return; }
    const c = {
      id: Date.now(), emp: x.fantasia || x.razaoSocial || x.nome, resp: '', doc: fmtCnpj(x.cnpj), tel: fmtPhone(x.telefone), wa: fmtPhone(x.telefone),
      ig: '', email: x.email || '', cep: formatCep(x.cep || ''), end: x.endereco || '', cid: x.municipio || '', uf: x.uf || '', obs: '', photo: '',
      colab: cid, st: 'Lead', fech: '', fim: '', sv: [], et: { 0: TODAY }, pays: [],
      hist: [{ d: TODAY, t: 'Observação', x: `Lead localizado pelo Radar de Novas Empresas. Abertura: ${br(x.abertura)}. CNAE: ${x.cnae || 'não informado'} — ${x.atividade || 'atividade não informada'}.` }]
    };
    S.clients.push(c); save(); radarRun();
  };

  async function fillCompanyFromCnpj(input) {
    const cnpj = cleanCnpj(input?.value);
    if (!cnpj) return;
    input.value = fmtCnpj(cnpj);
    if (cnpj.length !== 14) { alert('Informe um CNPJ com 14 caracteres.'); return; }
    let hint = $('#cnpj_lookup_hint');
    if (!hint) { hint = document.createElement('small'); hint.id = 'cnpj_lookup_hint'; hint.style.cssText = 'display:block;color:var(--mu);margin-top:4px'; input.parentElement.append(hint); }
    hint.textContent = 'Consultando CNPJ…';
    try {
      const { company: x } = await apiRadar({ mode: 'cnpj', cnpj });
      if ($('#f_emp')) $('#f_emp').value = x.fantasia || x.razaoSocial || x.nome || '';
      if ($('#f_tel')) $('#f_tel').value = x.telefone || '';
      if ($('#f_wa')) $('#f_wa').value = x.telefone || '';
      if ($('#f_email')) $('#f_email').value = x.email || '';
      if ($('#f_cep')) $('#f_cep').value = formatCep(x.cep || '');
      if ($('#f_end')) $('#f_end').value = x.endereco || '';
      if ($('#f_cid')) $('#f_cid').value = x.municipio || '';
      if ($('#f_uf')) $('#f_uf').value = x.uf || '';
      hint.textContent = '✓ Dados empresariais preenchidos automaticamente.';
      hint.style.color = 'var(--ok)';
    } catch (e) { hint.textContent = e.message; hint.style.color = 'var(--bad)'; }
  }

  const originalAddCli = window.addCli || addCli;
  window.addCli = addCli = function addCliWithCnpj(cid) {
    modal('Novo cliente',[
      {k:'emp',l:'Empresa'},{k:'doc',l:'CNPJ'},{k:'resp',l:'Responsável'},{k:'tel',l:'Telefone'},{k:'wa',l:'WhatsApp'},
      {k:'ig',l:'Instagram'},{k:'email',l:'E-mail',t:'email'},{k:'cep',l:'CEP'},{k:'end',l:'Endereço'},{k:'cid',l:'Cidade'},{k:'uf',l:'Estado'},
      {k:'st',l:'Status',t:'select',o:ST},{k:'sv',l:'Serviços',t:'multiselect',o:SRV},{k:'v',l:'Valor mensal total (R$)',t:'number'}
    ],{st:'Lead',sv:[],doc:''},o=>{
      if(!o.emp.trim()){alert('Informe o nome da empresa para criar o cliente.');return;}
      const a=ACT.includes(o.st),hasService=o.sv.length>0,serviceValue=+o.v||0,c={id:Date.now(),emp:o.emp.trim(),resp:o.resp,doc:fmtCnpj(cleanCnpj(o.doc)),tel:o.tel,wa:o.wa,ig:instagramValue(o.ig),email:o.email,cep:formatCep(o.cep),end:o.end||'',cid:o.cid||'',uf:o.uf||'',obs:o.sv_obs||'',photo:'',colab:cid,st:o.st,fech:a?TODAY:'',fim:'',sv:hasService?[{n:o.sv.join(', '),v:serviceValue,ini:TODAY,per:'Mensal',venc:addM(CUR,1)+'-10'}]:[],et:{0:TODAY},pays:a&&hasService?[{d:CUR+'-10',v:serviceValue,pago:false}]:[],hist:[{d:TODAY,t:'Observação',x:o.sv_obs?'Cliente cadastrado. Observação do serviço: '+o.sv_obs:'Cliente cadastrado.'}]};
      if (c.doc && S.clients.some(x => cleanCnpj(x.doc) === cleanCnpj(c.doc))) { alert('Este CNPJ já está cadastrado.'); return; }
      S.clients.push(c);save();go('cli',c.id)
    });
    const input = $('#f_doc');
    if (input) {
      input.placeholder = 'Digite o CNPJ para preencher automaticamente';
      input.autocomplete = 'off';
      input.addEventListener('blur', () => fillCompanyFromCnpj(input));
      input.addEventListener('input', () => { input.value = cleanCnpj(input.value); });
    }
  };

  const originalNav = nav;
  nav = function navWithRadar() {
    originalNav();
    if (ME?.role !== 'admin') return;
    const nv = $('#nv');
    if (!nv || nv.querySelector('[data-radar-link]')) return;
    const link = document.createElement('a');
    link.dataset.radarLink = '1';
    link.textContent = '🔎 Radar de Empresas';
    link.className = V.v === 'radar' ? 'on' : '';
    link.onclick = () => go('radar', 0);
    const sections = [...nv.querySelectorAll('.s')];
    const appSection = sections.find(x => x.textContent.trim() === 'Aplicativo');
    nv.insertBefore(link, appSection || null);
  };

  const originalRender = render;
  render = function renderWithRadar() {
    if (ME?.role === 'admin' && V.v === 'radar') {
      $('#nv').style.display='';$('#mn').style.padding='';$('#mn').style.maxWidth='';
      document.body.classList.add('signed-in');renderAppbar();nav();$('#mn').innerHTML=radarView();
      let saved = null; try { saved = JSON.parse(localStorage.getItem('agr_radar_filters') || 'null'); } catch {}
      if (saved?.municipio || saved?.cnae) setTimeout(() => radarRun(), 0);
      return;
    }
    originalRender();
  };
})();
