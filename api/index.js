const crypto = require('node:crypto');

const OWNER = 'm4nozk33-hash';
const REPO = 'agr-gestao-';
const BRANCH = 'main';
const STORE_PATH = 'data/store.json';
const fail = (status, message) => Object.assign(new Error(message), { status });

function token() {
  const value = process.env.GITHUB_DATA_TOKEN;
  if (!value) throw fail(503, 'Armazenamento do GitHub ainda não configurado na Vercel.');
  return value;
}
function ghHeaders() {
  return {
    Authorization: 'Bearer ' + token(),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}
async function gh(url, options = {}) {
  let r;
  try {
    r = await fetch('https://api.github.com' + url, {
      ...options,
      headers: { ...ghHeaders(), ...(options.headers || {}) },
      signal: AbortSignal.timeout(12000)
    });
  } catch (e) {
    const detail = [e?.name, e?.code, e?.cause?.code, e?.message].filter(Boolean).join(' / ').slice(0, 220);
    throw fail(503, 'Não foi possível conectar ao GitHub' + (detail ? ': ' + detail : '.'));
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw fail(503, 'O token do GitHub na Vercel não tem permissão para ler e gravar os dados.');
    if (r.status === 409 || r.status === 422) throw fail(409, 'Os dados foram alterados por outra pessoa. Recarregue e tente novamente.');
    throw fail(502, 'Falha ao acessar o armazenamento do GitHub.');
  }
  return body;
}
async function readStore() {
  const x = await gh('/repos/' + OWNER + '/' + REPO + '/contents/' + STORE_PATH + '?ref=' + BRANCH);
  const json = Buffer.from(String(x.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  let data;
  try { data = JSON.parse(json); } catch { throw fail(500, 'Arquivo de dados da AGR está inválido.'); }
  if (!data || !Array.isArray(data.users) || typeof data.workspaces !== 'object') throw fail(500, 'Estrutura de dados da AGR está inválida.');
  return { data, sha: x.sha };
}
async function writeStore(store, sha, message = 'chore: update AGR data') {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(store, null, 2)).toString('base64'),
    sha,
    branch: BRANCH
  };
  return gh('/repos/' + OWNER + '/' + REPO + '/contents/' + STORE_PATH, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split(/=(.*)/s)).filter(x => x[0]));
}
function secret() {
  return crypto.createHash('sha256').update('AGR_SESSION_V1:' + token()).digest();
}
function sign(payload) {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(part).digest('base64url');
  return part + '.' + sig;
}
function verify(value) {
  if (!value || !value.includes('.')) throw fail(401, 'Entre novamente para continuar.');
  const [part, sig] = value.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(part).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail(401, 'Sessão inválida.');
  let p;
  try { p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw fail(401, 'Sessão inválida.'); }
  if (!p.id || !p.exp || Date.now() > p.exp) throw fail(401, 'Sua sessão expirou.');
  return p;
}
function setSession(res, user) {
  const suffix = '; Path=/; HttpOnly; Secure; SameSite=Strict';
  if (!user) {
    res.setHeader('Set-Cookie', 'agr_session=; Max-Age=0' + suffix);
    return;
  }
  const maxAge = 60 * 60 * 24 * 7;
  const value = sign({ id: user.id, exp: Date.now() + maxAge * 1000 });
  res.setHeader('Set-Cookie', 'agr_session=' + value + '; Max-Age=' + maxAge + suffix);
}
function newId() { return crypto.randomUUID(); }
function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { passwordSalt: salt, passwordHash: hash };
}
function passwordOk(user, password) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const got = crypto.scryptSync(password, user.passwordSalt, 64);
  const want = Buffer.from(user.passwordHash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const publicProfile = u => ({
  id: u.id, nome: u.nome, email: u.email, role: u.role,
  colabId: u.colabId ?? null, ownerId: u.ownerId
});
function identityFrom(store, req) {
  const session = verify(cookies(req).agr_session);
  const user = store.users.find(u => u.id === session.id);
  if (!user) throw fail(401, 'Seu acesso não existe mais.');
  return user;
}
const workspaceOwner = p => p.role === 'admin' ? p.id : p.ownerId;
function workspace(store, profile) {
  const ownerId = workspaceOwner(profile);
  if (!ownerId) throw fail(403, 'Seu usuário ainda não está vinculado a um administrador.');
  const row = store.workspaces[ownerId];
  if (!row) throw fail(503, 'A área deste administrador ainda não foi criada.');
  return row;
}
function profilesFor(store, p) {
  if (p.role === 'admin') return store.users;
  return store.users.filter(u => u.id === p.id);
}
function view(state, profile, profiles) {
  return {
    colabs: profile.role === 'admin' ? state.colabs : state.colabs.filter(c => c.id === profile.colabId),
    clients: profile.role === 'admin' ? state.clients : state.clients.filter(c => c.colab === profile.colabId),
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
  if (incoming.clients?.some(c => c.colab !== profile.colabId && c.colab !== profile.colab_id)) throw fail(403, 'Você só pode alterar sua carteira.');
  const cid = profile.colabId ?? profile.colab_id;
  const foreign = state.clients.filter(c => c.colab !== cid);
  if (incoming.clients?.some(c => foreign.some(f => f.id === c.id))) throw fail(403, 'Cliente de outra carteira.');
  const next = { colabs: state.colabs, clients: [...foreign, ...(incoming.clients || [])] };
  validate(next); return next;
}
function emailKey(email) { return String(email || '').trim().toLowerCase(); }
function assertUserInput(body) {
  if (!body.nome?.trim() || !emailKey(body.email).includes('@') || typeof body.password !== 'string' || body.password.length < 12)
    throw fail(400, 'Informe nome, e-mail e senha de pelo menos 12 caracteres.');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      if (!origin || new URL(origin).host !== req.headers.host) throw fail(403, 'Origem não autorizada.');
    }
    const route = req.query?.route || new URL(req.url, 'https://localhost').searchParams.get('route');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (Buffer.byteLength(JSON.stringify(body)) > 2000000) throw fail(413, 'Dados excedem o limite de 2 MB.');

    if (route === 'health' && req.method === 'GET') {
      return res.status(200).json({ ok: true, storage: 'github', configured: !!process.env.GITHUB_DATA_TOKEN });
    }

    if (route === 'login' && req.method === 'POST') {
      if (typeof body.email !== 'string' || typeof body.password !== 'string') throw fail(400, 'Informe e-mail e senha.');
      const { data: store } = await readStore();
      const user = store.users.find(u => emailKey(u.email) === emailKey(body.email));
      if (!user || !passwordOk(user, body.password)) throw fail(401, 'E-mail ou senha incorretos.');
      setSession(res, user);
      return res.status(200).json({ ok: true });
    }

    if (route === 'refresh' && req.method === 'POST') {
      const { data: store } = await readStore();
      const user = identityFrom(store, req);
      setSession(res, user);
      return res.status(200).json({ ok: true });
    }

    if (route === 'logout' && req.method === 'POST') {
      setSession(res, null);
      return res.status(200).json({ ok: true });
    }

    if (route === 'bootstrap-admin' && req.method === 'POST') {
      assertUserInput(body);
      const { data: store, sha } = await readStore();
      const admins = store.users.filter(u => u.role === 'admin');
      if (admins.length >= 2) throw fail(403, 'A criação pública de administrador já foi encerrada.');
      const email = emailKey(body.email);
      if (store.users.some(u => emailKey(u.email) === email)) throw fail(409, 'Este e-mail já possui uma conta.');
      const id = newId();
      const user = {
        id, nome: body.nome.trim(), email, role: 'admin',
        colabId: null, ownerId: id, ...passwordRecord(body.password)
      };
      store.users.push(user);
      let data = { colabs: [], clients: [] };
      if (!store.legacyClaimed && store.legacySeed) {
        data = structuredClone(store.legacySeed);
        store.legacyClaimed = true;
      }
      store.workspaces[id] = { version: 0, data };
      await writeStore(store, sha, 'data: create initial AGR admin');
      setSession(res, user);
      return res.status(201).json({ ok: true, remaining: Math.max(0, 1 - admins.length) });
    }

    if (route === 'recover-code' || route === 'verify-recovery-code' || route === 'recovery-session') {
      throw fail(501, 'Recuperação por e-mail foi desativada. Peça a um administrador para redefinir seu acesso.');
    }

    const loaded = await readStore();
    const store = loaded.data;
    const profile = identityFrom(store, req);

    if (route === 'session' && req.method === 'GET') {
      return res.status(200).json({ user: publicProfile(profile) });
    }

    if (route === 'password' && req.method === 'POST') {
      if (typeof body.password !== 'string' || body.password.length < 12) throw fail(400, 'Use pelo menos 12 caracteres.');
      Object.assign(profile, passwordRecord(body.password));
      await writeStore(store, loaded.sha, 'data: update AGR password');
      setSession(res, profile);
      return res.status(200).json({ ok: true });
    }

    if (route === 'state' && req.method === 'GET') {
      const row = workspace(store, profile);
      return res.status(200).json({ version: row.version, state: view(row.data, profile, profilesFor(store, profile)) });
    }

    if (route === 'state' && req.method === 'PUT') {
      const row = workspace(store, profile);
      if (body.version !== row.version) throw fail(409, 'Outra pessoa alterou os dados. Recarregue e tente novamente.');
      const next = merge(row.data, body.state, profile);
      row.data = next;
      row.version += 1;
      row.updatedAt = new Date().toISOString();
      await writeStore(store, loaded.sha, 'data: update AGR workspace');
      return res.status(200).json({ version: row.version });
    }

    if (route === 'users' && profile.role === 'admin') {
      if (req.method === 'POST') {
        assertUserInput(body);
        if (!['admin', 'user'].includes(body.role)) throw fail(400, 'Perfil inválido.');
        const email = emailKey(body.email);
        if (store.users.some(u => emailKey(u.email) === email)) throw fail(409, 'Este e-mail já possui uma conta.');
        const row = workspace(store, profile);
        const colabId = Number(body.colabId);
        if (body.role === 'user' && !row.data.colabs.some(c => c.id === colabId)) throw fail(400, 'Cadastre e selecione o colaborador primeiro.');
        const id = newId();
        const user = {
          id, nome: body.nome.trim(), email, role: body.role,
          colabId: body.role === 'user' ? colabId : null,
          ownerId: body.role === 'admin' ? id : profile.id,
          ...passwordRecord(body.password)
        };
        store.users.push(user);
        if (body.role === 'admin') store.workspaces[id] = { version: 0, data: { colabs: [], clients: [] } };
        await writeStore(store, loaded.sha, 'data: create AGR user');
        return res.status(201).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        if (!body.id || body.id === profile.id) throw fail(400, 'Você não pode remover seu próprio acesso.');
        const i = store.users.findIndex(u => u.id === body.id && u.ownerId === profile.id && u.role !== 'admin');
        if (i < 0) throw fail(404, 'Usuário não encontrado.');
        store.users.splice(i, 1);
        await writeStore(store, loaded.sha, 'data: remove AGR user');
        return res.status(200).json({ ok: true });
      }
    }

    if (route === 'reset-user-password' && profile.role === 'admin' && req.method === 'POST') {
      if (!body.id || typeof body.password !== 'string' || body.password.length < 12) throw fail(400, 'Informe o usuário e uma senha de pelo menos 12 caracteres.');
      const target = store.users.find(u => u.id === body.id && u.ownerId === profile.id && u.id !== profile.id);
      if (!target) throw fail(404, 'Usuário não encontrado.');
      Object.assign(target, passwordRecord(body.password));
      await writeStore(store, loaded.sha, 'data: admin reset AGR password');
      return res.status(200).json({ ok: true });
    }

    throw fail(404, 'Operação não encontrada ou não autorizada.');
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Não foi possível concluir. Tente novamente.' });
  }
};

module.exports._test = { merge, validate, view, workspaceOwner, profilesFor, passwordRecord, passwordOk };