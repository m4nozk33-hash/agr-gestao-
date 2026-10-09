const crypto = require('node:crypto');

const OWNER = 'm4nozk33-hash';
const REPO = 'agr-gestao-';
const BRANCH = 'main';
const STORE_PATH = 'data/store.json';
const fail = (status, message) => Object.assign(new Error(message), { status });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const RADAR_CACHE = globalThis.__AGR_RADAR_CACHE__ || (globalThis.__AGR_RADAR_CACHE__ = new Map());

function token() {
  const value = process.env.GITHUB_DATA_TOKEN;
  if (!value) throw fail(503, 'Armazenamento da AGR ainda não configurado na Vercel.');
  return value;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split(/=(.*)/s)).filter(x => x[0]));
}
function secret() {
  return crypto.createHash('sha256').update('AGR_SESSION_V1:' + token()).digest();
}
function verify(value) {
  if (!value || !value.includes('.')) throw fail(401, 'Entre novamente para continuar.');
  const [part, sig] = value.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(part).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail(401, 'Sessão inválida.');
  let p;
  try { p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw fail(401, 'Sessão inválida.'); }
  if (!p.id || !p.exp || Date.now() > p.exp) throw fail(401, 'Sua sessão expirou.');
  return p;
}

async function fetchJson(url, options = {}, timeout = 12000, label = 'serviço externo') {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AGR-Radar/1.0',
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const detail = e?.cause?.code || e?.code || e?.name || 'erro de rede';
    throw fail(502, `Falha de conexão com ${label} (${detail}).`);
  }
  const text = await response.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const detail = body?.message || body?.error || body?.detail || text?.slice(0, 160) || `HTTP ${response.status}`;
    throw fail(response.status, `${label}: ${detail}`);
  }
  if (body == null) throw fail(502, `${label}: resposta inválida.`);
  return body;
}

async function fetchJsonWithRetry(url, options = {}, timeout = 12000, label = 'serviço externo', retries = 2) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchJson(url, options, timeout, label);
    } catch (e) {
      last = e;
      const retryable = e?.status === 429 || e?.status === 502 || /limite|rate.?limit|consultas por segundo|too many|falha de conexão/i.test(String(e?.message || ''));
      if (!retryable || attempt === retries) throw e;
      await sleep([1600, 3500, 6000][attempt] || 6000);
    }
  }
  throw last;
}

async function authenticatedRadarUser(req) {
  const session = verify(cookies(req).agr_session);
  const gh = await fetchJson(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${STORE_PATH}?ref=${BRANCH}`, {
    headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  }, 12000, 'armazenamento da AGR');
  const json = Buffer.from(String(gh.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  let store;
  try { store = JSON.parse(json); } catch { throw fail(500, 'Dados da AGR estão inválidos.'); }
  const user = store.users?.find(u => u.id === session.id);
  if (!user) throw fail(401, 'Seu acesso não existe mais.');
  const role = String(user.role || '').toLowerCase();
  if (!['admin', 'colaborador'].includes(role)) throw fail(403, 'Seu perfil não possui acesso ao Radar de Empresas.');
  return user;
}

function onlyCnpjChars(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
}
function normalizeDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
}
function normalizeCompany(d = {}) {
  const nestedAddress = d.endereco || d.address || {};
  const phone = d.ddd_telefone_1 || d.telefone || d.phone || d.ddd_telefone_2 || d.contato?.telefone || '';
  const name = d.nome_fantasia || d.nomeFantasia || d.fantasia || d.razao_social || d.razaoSocial || d.nome || d.nome_empresarial || 'Empresa';
  const addressParts = [
    d.descricao_tipo_de_logradouro, d.logradouro || nestedAddress.logradouro,
    d.numero || nestedAddress.numero, d.complemento || nestedAddress.complemento,
    d.bairro || nestedAddress.bairro
  ].filter(Boolean);
  const atividadeObj = d.atividade_principal?.[0] || d.atividade?.cnae_principal || d.cnae_principal || {};
  return {
    cnpj: onlyCnpjChars(d.cnpj || d.documento || d.cnpj_formatado || d.cnpjFormatado),
    nome: name,
    razaoSocial: d.razao_social || d.razaoSocial || d.nome_empresarial || d.nome || name,
    fantasia: d.nome_fantasia || d.nomeFantasia || d.fantasia || '',
    abertura: normalizeDate(d.data_inicio_atividade || d.dataAbertura || d.abertura || d.inicio_atividade || d.data_abertura),
    situacao: d.descricao_situacao_cadastral || d.situacao?.descricao || d.situacao || d.situacao_cadastral || '',
    cnae: String(d.cnae_fiscal || atividadeObj.code || atividadeObj.codigo || d.cnae || d.cnae_principal || ''),
    atividade: d.cnae_fiscal_descricao || atividadeObj.text || atividadeObj.descricao || d.atividade_principal_descricao || d.cnae_descricao || '',
    uf: d.uf || nestedAddress.uf || '',
    municipio: d.municipio || d.cidade || nestedAddress.municipio || nestedAddress.cidade || '',
    cep: String(d.cep || nestedAddress.cep || ''),
    endereco: addressParts.join(' ').replace(/\s+/g, ' ').trim(),
    telefone: typeof phone === 'object' ? (phone.numero || '') : phone,
    email: d.email || d.contato?.email || '',
    porte: typeof d.porte === 'object' ? (d.porte.descricao || '') : (d.porte || ''),
    mei: d.opcao_pelo_mei === true || d.mei === true,
    simples: d.opcao_pelo_simples === true || d.simples === true,
    capitalSocial: Number(d.capital_social || d.capitalSocial || 0) || 0
  };
}

async function resolveMunicipio(uf, city) {
  if (!city) return null;
  if (/^\d+$/.test(city)) return city;
  const key = String(city).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const sources = [
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`,
    `https://brasilapi.com.br/api/ibge/municipios/v1/${encodeURIComponent(uf)}`
  ];
  for (const url of sources) {
    try {
      const cities = await fetchJson(url, {}, 9000, 'lista de municípios');
      const list = Array.isArray(cities) ? cities : [];
      const found = list.find(c => String(c.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === key);
      if (found) return String(found.id || found.codigo_ibge || found.codigo || '');
    } catch {}
  }
  throw fail(400, 'Município não encontrado. Tente informar apenas a UF ou usar o código IBGE do município.');
}

async function lookupCnpj(cnpj) {
  const clean = onlyCnpjChars(cnpj);
  if (clean.length !== 14) throw fail(400, 'Informe um CNPJ com 14 caracteres.');
  const providers = [
    [`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(clean)}`, 'BrasilAPI'],
    [`https://minhareceita.org/${encodeURIComponent(clean)}`, 'Minha Receita']
  ];
  let last;
  for (const [url, label] of providers) {
    try { return normalizeCompany(await fetchJsonWithRetry(url, {}, 12000, label, label === 'Minha Receita' ? 1 : 0)); }
    catch (e) { last = e; }
  }
  throw fail(502, last?.message || 'Não foi possível consultar o CNPJ agora.');
}

async function searchMinhaReceita({ uf, municipio, cnae, cutoffIso }) {
  const p = new URLSearchParams({ uf, limit: '1024' });
  if (municipio) p.set('municipio', municipio);
  if (cnae) p.set('cnae', cnae);
  const payload = await fetchJsonWithRetry(`https://minhareceita.org/?${p.toString()}`, {}, 18000, 'Minha Receita', 1);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const collected = [];
  for (const raw of rows) {
    const company = normalizeCompany(raw);
    if (!company.cnpj || !company.abertura || company.abertura < cutoffIso) continue;
    if (company.situacao && !String(company.situacao).toUpperCase().includes('ATIVA')) continue;
    collected.push(company);
  }
  return { data: collected, scanned: rows.length, source: 'Minha Receita' };
}

async function searchSintegra({ uf, city, cnae, days, cutoffIso, maxResults }) {
  const p = new URLSearchParams({ uf });
  if (city) p.set('municipio', city);
  if (cnae) p.set('cnae', cnae);
  p.set('dias', String(days));
  p.set('limit', String(Math.min(maxResults, 60)));

  const headers = {};
  if (process.env.SINTEGRA_API_KEY) headers['X-Api-Key'] = process.env.SINTEGRA_API_KEY;

  const payload = await fetchJsonWithRetry(
    `https://www.sintegrabrasil.com.br/api/v1/radar?${p.toString()}`,
    { headers },
    15000,
    'Radar SINTEGRA Brasil',
    1
  );
  const rows = Array.isArray(payload) ? payload : (payload?.data || payload?.empresas || payload?.results || payload?.resultados || []);
  const list = Array.isArray(rows) ? rows : [];
  const data = list
    .map(normalizeCompany)
    .filter(x => x.cnpj && (!x.abertura || x.abertura >= cutoffIso));
  return { data, scanned: list.length, source: 'SINTEGRA Brasil' };
}

async function radarSearch(query) {
  const uf = String(query.uf || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw fail(400, 'Informe a UF para pesquisar novas empresas.');
  const city = String(query.municipio || '').trim();
  const cnae = String(query.cnae || '').replace(/\D/g, '').slice(0, 7);
  const days = Math.max(1, Math.min(365, Number(query.days || 30) || 30));
  const maxResults = Math.max(10, Math.min(100, Number(query.limit || 50) || 50));
  let municipio = null;
  try { municipio = await resolveMunicipio(uf, city); } catch (e) { if (city) throw e; }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const cacheKey = JSON.stringify({ uf, municipio, cnae, days, maxResults });
  const cached = RADAR_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < 120000) return cached.value;

  const errors = [];
  let found = null;

  try {
    found = await searchSintegra({ uf, city, cnae, days, cutoffIso, maxResults });
  } catch (e) {
    errors.push(e.message);
  }

  if (!found || !found.data.length) {
    try {
      const mr = await searchMinhaReceita({ uf, municipio, cnae, cutoffIso });
      if (mr.data.length || !found) found = mr;
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (!found) {
    throw fail(503, 'As fontes do Radar estão temporariamente indisponíveis. Tente novamente em alguns instantes.');
  }

  const unique = [...new Map(found.data.map(x => [x.cnpj, x])).values()]
    .sort((a, b) => String(b.abertura).localeCompare(String(a.abertura)))
    .slice(0, maxResults);

  const value = {
    data: unique,
    meta: {
      uf,
      municipio: city || null,
      municipioCodigo: municipio,
      cnae: cnae || null,
      days,
      scanned: found.scanned || unique.length,
      returned: unique.length,
      source: found.source,
      exhaustive: false,
      warning: errors.length ? errors.join(' | ') : null,
      note: 'O Radar usa fontes de terceiros baseadas em dados públicos do CNPJ. A disponibilidade e a atualização podem variar.'
    }
  };

  RADAR_CACHE.set(cacheKey, { at: Date.now(), value });
  if (RADAR_CACHE.size > 30) {
    const oldest = [...RADAR_CACHE.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, RADAR_CACHE.size - 30);
    oldest.forEach(([k]) => RADAR_CACHE.delete(k));
  }
  return value;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'GET') throw fail(405, 'Método não permitido.');
    await authenticatedRadarUser(req);
    const mode = String(req.query?.mode || 'radar');
    if (mode === 'cnpj') return res.status(200).json({ company: await lookupCnpj(req.query?.cnpj) });
    return res.status(200).json(await radarSearch(req.query || {}));
  } catch (e) {
    const status = [400, 401, 403, 404, 405, 429, 503].includes(e.status) ? e.status : 500;
    return res.status(status).json({ error: e.message || 'Erro interno.' });
  }
};