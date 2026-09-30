const fail = (status, message) => Object.assign(new Error(message), { status });
function config() {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
  if (!url || !anon || !service) throw fail(503, 'Banco compartilhado ainda não configurado. Configure o Supabase na Vercel.');
  return { url: url.replace(/\/$/, ''), anon, service };
}
async function sb(path, options = {}, token) {
  const c = config();
  const isPublicApiKey = token === c.anon;
  const apiKey = token && !isPublicApiKey ? c.anon : (isPublicApiKey ? c.anon : c.service);
  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json',
    ...options.headers
  };
  // New Supabase sb_publishable_/sb_secret_ keys are opaque API keys, not JWTs.
  // Only send Authorization for a real user session JWT or for legacy JWT-based API keys.
  if (token && !isPublicApiKey) {
    headers.Authorization = `Bearer ${token}`;
  } else if (isPublicApiKey && !c.anon.startsWith('sb_')) {
    headers.Authorization = `Bearer ${c.anon}`;
  } else if (!token && !c.service.startsWith('sb_')) {
    headers.Authorization = `Bearer ${c.service}`;
  }
  const r = await fetch(c.url + path, { ...options, headers, signal: AbortSignal.timeout(12000) });
  const value = await r.json().catch(() => null);
  if (!r.ok) throw fail(r.status === 401 || r.status === 403 ? 401 : 502, 'Não foi possível concluir a operação no banco.');
  return value;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split(/=(.*)/s)).filter(x => x[0]));
}
function setSession(res, session) {
  const suffix = '; Path=/api; HttpOnly; Secure; SameSite=Strict';
  res.setHeader('Set-Cookie', [
    `agr_access=${session?.access_token || ''}; Max-Age=${session ? session.expires_in || 3600 : 0}${suffix}`,
    `agr_refresh=${session?.refresh_token || ''}; Max-Age=${session ? 2592000 : 0}${suffix}`
  ]);
}
async function identity(req) {
  const token = cookies(req).agr_access;
  if (!token) throw fail(401, 'Entre novamente para continuar.');
  const user = await sb('/auth/v1/user', {}, token);
  const profiles = await sb('/rest/v1/agr_profiles?id=eq.' + encodeURIComponent(user.id) + '&select=*');
  if (!profiles?.[0]) throw fail(403, 'Seu usuário ainda não recebeu acesso à AGR.');
  return profiles[0];
}
const publicProfile = u => ({ id: u.id, nome: u.nome, email: u.email, role: u.role, colabId: u.colab_id, ownerId: u.owner_id });
const workspaceOwner = p => p.role === 'admin' ? p.id : p.owner_id;
async function load(profile) {
  const ownerId = workspaceOwner(profile);
  if (!ownerId) throw fail(403, 'Seu usuário ainda não está vinculado a um administrador.');
  let rows = await sb('/rest/v1/agr_workspaces?owner_id=eq.' + encodeURIComponent(ownerId) + '&select=*');
  if (!rows?.[0] && profile.role === 'admin') {
    let data = { colabs: [], clients: [] };
    // Migração compatível: a carteira antiga fica somente com o administrador principal.
    if ((profile.email || '').toLowerCase() === 'm4nozk33@gmail.com') {
      const legacy = await sb('/rest/v1/agr_state?id=eq.1&select=data').catch(() => []);
      if (legacy?.[0]?.data?.colabs && legacy?.[0]?.data?.clients) data = legacy[0].data;
    }
    rows = await sb('/rest/v1/agr_workspaces', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: ownerId, data })
    });
  }
  if (!rows?.[0]) throw fail(503, 'A área deste administrador ainda não foi criada.');
  return rows[0];
}
function view(state, profile, profiles) {
  return {
    colabs: profile.role === 'admin' ? state.colabs : state.colabs.filter(c => c.id === profile.colab_id),
    clients: profile.role === 'admin' ? state.clients : state.clients.filter(c => c.colab === profile.colab_id),
    users: profiles.map(publicProfile)
  };
}
function validate(s) {
  if (!s || !Array.isArray(s.colabs) || !Array.isArray(s.clients) || s.clients.length > 5000 || s.colabs.length > 500) throw fail(400, 'Dados inválidos.');
  const ids = new Set();
  for (const c of s.colabs) {
    if (!Number.isSafeInteger(c.id) || ids.has(c.id) || typeof c.nome !== 'string' || c.nome.length > 200 || !Number.isFinite(c.com) || c.com < 0 || c.com > 100) throw fail(400, 'Colaborador inválido.');
    ids.add(c.id);
  }
  const clientIds = new Set();
  for (const c of s.clients) {
    if (!Number.isSafeInteger(c.id) || clientIds.has(c.id) || !ids.has(c.colab) || typeof c.emp !== 'string' || c.emp.length > 300 || !Array.isArray(c.sv) || !Array.isArray(c.pays) || !Array.isArray(c.hist) || !c.et || typeof c.et !== 'object') throw fail(400, 'Cliente inválido.');
    clientIds.add(c.id);
    const status = ['Lead','Primeiro contato','Reunião marcada','Proposta enviada','Em negociação','Fechado','Cliente ativo','Pagamento pendente','Atrasado','Cancelado','Perdido'];
    if (!status.includes(c.st)) throw fail(400, 'Status inválido.');
    for (const item of c.sv) if (!['Mensal','Trimestral','Anual','Único'].includes(item.per)) throw fail(400, 'Periodicidade inválida.');
    for (const item of c.hist) if (!['Observação','Ligação','Reunião','Mensagem','Proposta','Contrato'].includes(item.t)) throw fail(400, 'Tipo de histórico inválido.');
    const date = /^\d{4}-\d{2}-\d{2}$/;
    for (const value of [c.fech,c.fim,...Object.values(c.et),...c.sv.flatMap(x=>[x.ini,x.venc]),...c.pays.map(x=>x.d),...c.hist.map(x=>x.d)]) if (value && (typeof value !== 'string' || !date.test(value))) throw fail(400, 'Data inválida.');
    for (const s of c.sv) if (!Number.isFinite(s.v) || s.v < 0) throw fail(400, 'Valor de serviço inválido.');
    for (const p of c.pays) if (!Number.isFinite(p.v) || p.v < 0 || typeof p.pago !== 'boolean') throw fail(400, 'Pagamento inválido.');
  }
}
function merge(state, incoming, profile) {
  if (profile.role === 'admin') {
    const next = { colabs: incoming.colabs, clients: incoming.clients };
    validate(next); return next;
  }
  if (incoming.clients?.some(c => c.colab !== profile.colab_id)) throw fail(403, 'Você só pode alterar sua carteira.');
  const foreign = state.clients.filter(c => c.colab !== profile.colab_id);
  if (incoming.clients?.some(c => foreign.some(f => f.id === c.id))) throw fail(403, 'Cliente de outra carteira.');
  const next = { colabs: state.colabs, clients: [...foreign, ...(incoming.clients || [])] };
  validate(next); return next;
}
async function persist(row, next, profile) {
  const ownerId = workspaceOwner(profile);
  const rows = await sb('/rest/v1/agr_workspaces?owner_id=eq.' + encodeURIComponent(ownerId) + '&version=eq.' + row.version, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ data: next, version: row.version + 1, updated_at: new Date().toISOString() })
  });
  if (!rows?.length) throw fail(409, 'Outro usuário atualizou os dados. Recarregue antes de salvar novamente.');
  return rows[0];
}
async function profilesFor(p) {
  if (p.role === 'admin') return sb('/rest/v1/agr_profiles?select=*&owner_id=eq.' + encodeURIComponent(p.id));
  return sb('/rest/v1/agr_profiles?select=*&id=eq.' + encodeURIComponent(p.id));
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    // Every mutation is same-origin; there is deliberately no CORS access.
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      if (!origin || new URL(origin).host !== req.headers.host) throw fail(403, 'Origem não autorizada.');
    }
    const route = req.query?.route || new URL(req.url, 'https://localhost').searchParams.get('route');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (Buffer.byteLength(JSON.stringify(body)) > 2000000) throw fail(413, 'Dados excedem o limite de 2 MB.');
    if (route === 'health' && req.method === 'GET') {
      const c = config();
      const type = k => k?.startsWith('sb_publishable_') ? 'publishable' : k?.startsWith('sb_secret_') ? 'secret' : k?.startsWith('eyJ') ? 'legacy-jwt' : 'other';
      return res.status(200).json({
        ok: true,
        supabaseUrl: !!c.url,
        publicKeyType: type(c.anon),
        serverKeyType: type(c.service)
      });
    }
    if (route === 'login' && req.method === 'POST') {
      if (typeof body.email !== 'string' || typeof body.password !== 'string') throw fail(400, 'Informe e-mail e senha.');
      const c = config();
      let r;
      try {
        r = await fetch(c.url + '/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { apikey: c.anon, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: body.email, password: body.password }),
          signal: AbortSignal.timeout(12000)
        });
      } catch (e) {
        throw fail(503, 'Não foi possível conectar ao Supabase a partir da Vercel.');
      }
      const session = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = session?.msg || session?.message || session?.error_description || session?.error;
        if (r.status === 400 || r.status === 401) {
          if (/invalid.*login|invalid.*credentials|email.*password/i.test(String(msg || ''))) throw fail(401, 'E-mail ou senha incorretos.');
          throw fail(401, 'O Supabase recusou o login. Verifique a chave pública da Vercel.');
        }
        throw fail(502, 'Falha no Supabase durante o login (' + r.status + ').');
      }
      if (!session?.access_token || !session?.refresh_token) throw fail(502, 'O Supabase não retornou uma sessão válida.');
      setSession(res, session); return res.status(200).json({ ok: true });
    }
    if (route === 'refresh' && req.method === 'POST') {
      const refresh_token = cookies(req).agr_refresh;
      if (!refresh_token) throw fail(401, 'Entre novamente.');
      const session = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token }) }, config().anon);
      setSession(res, session); return res.status(200).json({ ok: true });
    }
    if (route === 'logout' && req.method === 'POST') {
      const token = cookies(req).agr_access;
      if (token) await sb('/auth/v1/logout', { method: 'POST' }, token).catch(() => {});
      setSession(res, null); return res.status(200).json({ ok: true });
    }
    if (route === 'recover-code' && req.method === 'POST') {
      if (typeof body.email !== 'string' || !body.email.trim()) throw fail(400, 'Informe seu e-mail.');
      const email = body.email.toLowerCase().trim();
      // Envia OTP somente para conta existente; não cria usuário novo.
      await sb('/auth/v1/otp', {
        method: 'POST',
        body: JSON.stringify({ email, create_user: false })
      }, config().anon);
      return res.status(200).json({ ok: true });
    }
    if (route === 'verify-recovery-code' && req.method === 'POST') {
      if (typeof body.email !== 'string' || typeof body.token !== 'string') throw fail(400, 'Informe e-mail e código.');
      const email = body.email.toLowerCase().trim();
      const token = body.token.replace(/\s/g, '');
      if (!/^\d{6}$/.test(token)) throw fail(400, 'Digite o código de 6 dígitos.');
      const session = await sb('/auth/v1/verify', {
        method: 'POST',
        body: JSON.stringify({ email, token, type: 'email' })
      }, config().anon);
      if (!session?.access_token || !session?.refresh_token) throw fail(401, 'Código inválido ou expirado.');
      setSession(res, session);
      return res.status(200).json({ ok: true });
    }
    if (route === 'recovery-session' && req.method === 'POST') {
      if (!body.access_token || !body.refresh_token) throw fail(400, 'Link de recuperação inválido.');
      await sb('/auth/v1/user', {}, body.access_token);
      setSession(res, { ...body, expires_in: 3600 });
      return res.status(200).json({ ok: true });
    }
    if (route === 'bootstrap-admin' && req.method === 'POST') {
      if (!body.nome?.trim() || typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length < 12)
        throw fail(400, 'Informe nome, e-mail e senha de pelo menos 12 caracteres.');
      const admins = await sb('/rest/v1/agr_profiles?role=eq.admin&select=id&limit=3');
      if ((admins?.length || 0) >= 2) throw fail(403, 'A criação pública de administrador já foi encerrada.');
      const email = body.email.toLowerCase().trim();
      const user = await sb('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password: body.password, email_confirm: true })
      });
      try {
        await sb('/rest/v1/agr_profiles', {
          method: 'POST',
          body: JSON.stringify({ id: user.id, nome: body.nome.trim(), email, role: 'admin', colab_id: null, owner_id: user.id })
        });
        let data = { colabs: [], clients: [] };
        if ((admins?.length || 0) === 0) {
          const legacy = await sb('/rest/v1/agr_state?id=eq.1&select=data').catch(() => []);
          if (legacy?.[0]?.data?.colabs && legacy?.[0]?.data?.clients) data = legacy[0].data;
        }
        await sb('/rest/v1/agr_workspaces', {
          method: 'POST',
          body: JSON.stringify({ owner_id: user.id, data })
        });
      } catch (e) {
        await sb('/auth/v1/admin/users/' + user.id, { method: 'DELETE' }).catch(() => {});
        throw e;
      }
      return res.status(201).json({ ok: true, remaining: Math.max(0, 1 - (admins?.length || 0)) });
    }
    const profile = await identity(req);
    if (route === 'session' && req.method === 'GET') return res.status(200).json({ user: publicProfile(profile) });
    if (route === 'password' && req.method === 'POST') {
      if (typeof body.password !== 'string' || body.password.length < 12) throw fail(400, 'Use pelo menos 12 caracteres.');
      await sb('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: body.password }) }, cookies(req).agr_access);
      return res.status(200).json({ ok: true });
    }
    if (route === 'state' && req.method === 'GET') {
      const row = await load(profile);
      return res.status(200).json({ version: row.version, state: view(row.data, profile, await profilesFor(profile)) });
    }
    if (route === 'state' && req.method === 'PUT') {
      const row = await load(profile);
      if (body.version !== row.version) throw fail(409, 'Outra pessoa alterou os dados. Recarregue e tente novamente.');
      const next = merge(row.data, body.state, profile);
      const updated = await persist(row, next, profile);
      return res.status(200).json({ version: updated.version });
    }
    if (route === 'users' && profile.role === 'admin') {
      if (req.method === 'POST') {
        if (!['admin', 'user'].includes(body.role) || !body.nome?.trim() || !body.email || (typeof body.password !== 'string' || body.password.length < 12)) throw fail(400, 'Informe nome, e-mail, perfil e senha de 12 caracteres.');
        const row = await load(profile);
        const colab = row.data.colabs.find(c => c.id === body.colabId);
        if (body.role === 'user' && !colab) throw fail(400, 'Cadastre e selecione o colaborador primeiro.');
        const user = await sb('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: body.email, password: body.password, email_confirm: true }) });
        try {
          await sb('/rest/v1/agr_profiles', { method: 'POST', body: JSON.stringify({ id: user.id, nome: body.nome.trim(), email: body.email.toLowerCase().trim(), role: body.role, colab_id: body.role === 'user' ? body.colabId : null, owner_id: body.role === 'admin' ? user.id : profile.id }) });
          if (body.role === 'admin') {
            await sb('/rest/v1/agr_workspaces', { method: 'POST', body: JSON.stringify({ owner_id: user.id, data: { colabs: [], clients: [] } }) });
          }
        } catch (e) {
          await sb('/auth/v1/admin/users/' + user.id, { method: 'DELETE' }).catch(() => {}); throw e;
        }
        return res.status(201).json({ ok: true });
      }
      if (req.method === 'DELETE') {
        if (!body.id || body.id === profile.id) throw fail(400, 'Você não pode remover seu próprio acesso.');
        const target = await sb('/rest/v1/agr_profiles?id=eq.' + encodeURIComponent(body.id) + '&owner_id=eq.' + encodeURIComponent(profile.id) + '&select=id');
        if (!target.length) throw fail(404, 'Usuário não encontrado.');
        // Remove authorization first, so active sessions lose access immediately.
        await sb('/rest/v1/agr_profiles?id=eq.' + encodeURIComponent(body.id), { method: 'DELETE' });
        await sb('/auth/v1/admin/users/' + encodeURIComponent(body.id), { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }
    }
    throw fail(404, 'Operação não encontrada ou não autorizada.');
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Não foi possível concluir. Tente novamente.' });
  }
};
module.exports._test = { merge, validate, view, workspaceOwner };
