const crypto = require('node:crypto');

const OWNER = 'm4nozk33-hash';
const REPO = 'agr-gestao-';
const BRANCH = 'main';
const STORE_PATH = 'data/store.json';

const fail = (status, message) => Object.assign(new Error(message), { status });

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
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail(401, 'Sessão inválida.');
  let p;
  try { p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw fail(401, 'Sessão inválida.'); }
  if (!p.id || !p.exp || Date.now() > p.exp) throw fail(401, 'Sua sessão expirou.');
  return p;
}

async function fetchJson(url, options = {}, timeout = 15000) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw fail(502, 'Não foi possível consultar a base empresarial agora.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw fail(response.status === 404 ? 404 : 502, body?.message || 'Falha na consulta empresarial.');
  return body;
}

async function authenticatedAdmin(req) {
  const session = verify(cookies(req).agr_session);
  const gh = await fetchJson(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${STORE_PATH}?ref=${BRANCH}`, {
    headers: {
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  const json = Buffer.from(String(gh.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  let store;
  try { store = JSON.parse(json); } catch { throw fail(500, 'Dados da AGR estão inválidos.'); }
  const user = store.users?.find(u => u.id === session.id);
  if (!user) throw fail(401, 'Seu acesso não existe mais.');
  if (user.role !== 'admin') throw fail(403, 'O Radar de Empresas está disponível para administradores.');
  return user;
}

function onlyCnpjChars(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
}

function normalizeCompany(d) {
  const phone = d.ddd_telefone_1 || d.telefone || d.ddd_telefone_2 || '';
  const name = d.nome_fantasia || d.razao_social || d.nome || d.fantasia || 'Empresa';
  const addressParts = [d.descricao_tipo_de_logradouro, d.logradouro, d.numero, d.complemento, d.bairro].filter(Boolean);
  return {
    cnpj: onlyCnpjChars(d.cnpj),
    nome: name,
    razaoSocial: d.razao_social || d.nome || name,
    fantasia: d.nome_fantasia || d.fantasia || '',
    abertura: d.data_inicio_atividade || d.abertura || '',
    situacao: d.descricao_situacao_cadastral || d.situacao || '',
    cnae: String(d.cnae_fiscal || d.atividade_principal?.[0]?.code || ''),
    atividade: d.cnae_fiscal_descricao || d.atividade_principal?.[0]?.text || '',
    uf: d.uf || '',
    municipio: d.municipio || '',
    cep: String(d.cep || ''),
    endereco: addressParts.join(' ').replace(/\s+/g, ' ').trim(),
    telefone: phone,
    email: d.email || '',
    porte: d.porte || '',
    mei: d.opcao_pelo_mei === true,
    simples: d.opcao_pelo_simples === true,
    capitalSocial: Number(d.capital_social || 0) || 0
  };
}

async function resolveMunicipio(uf, city) {
  if (!city) return null;
  if (/^\d+$/.test(city)) return city;
  const cities = await fetchJson(`https://brasilapi.com.br/api/ibge/municipios/v1/${encodeURIComponent(uf)}`);
  const key = String(city).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const found = (Array.isArray(cities) ? cities : []).find(c => String(c.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === key);
  if (!found) throw fail(400, 'Município não encontrado para a UF informada.');
  return String(found.codigo_ibge || found.codigo || '');
}

async function lookupCnpj(cnpj) {
  const clean = onlyCnpjChars(cnpj);
  if (clean.length !== 14) throw fail(400, 'Informe um CNPJ com 14 caracteres.');
  const data = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(clean)}`);
  return normalizeCompany(data);
}

async function radarSearch(query) {
  const uf = String(query.uf || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw fail(400, 'Informe a UF para pesquisar novas empresas.');
  const city = String(query.municipio || '').trim();
  const cnae = String(query.cnae || '').replace(/\D/g, '').slice(0, 7);
  const days = Math.max(1, Math.min(365, Number(query.days || 30) || 30));
  const maxResults = Math.max(10, Math.min(100, Number(query.limit || 50) || 50));
  const municipio = await resolveMunicipio(uf, city);

  const params = new URLSearchParams();
  params.set('uf', uf);
  if (municipio) params.set('municipio', municipio);
  if (cnae) params.set('cnae', cnae);
  params.set('limit', '512');

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  let cursor = null;
  let scanned = 0;
  const collected = [];
  for (let page = 0; page < 3; page++) {
    const pageParams = new URLSearchParams(params);
    if (cursor) pageParams.set('cursor', cursor);
    const payload = await fetchJson(`https://minhareceita.org/?${pageParams.toString()}`, {}, 18000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    scanned += rows.length;
    for (const raw of rows) {
      const company = normalizeCompany(raw);
      if (!company.abertura || company.abertura < cutoffIso) continue;
      if (company.situacao && company.situacao.toUpperCase() !== 'ATIVA') continue;
      collected.push(company);
    }
    cursor = payload?.cursor || null;
    if (!cursor || collected.length >= maxResults * 2) break;
  }

  const unique = [...new Map(collected.map(x => [x.cnpj, x])).values()]
    .sort((a, b) => String(b.abertura).localeCompare(String(a.abertura)))
    .slice(0, maxResults);

  let sourceUpdated = null;
  try {
    const updated = await fetchJson('https://minhareceita.org/updated', {}, 8000);
    sourceUpdated = updated?.updated || updated?.date || updated?.data || updated;
  } catch {}

  return {
    data: unique,
    meta: {
      uf,
      municipio: city || null,
      municipioCodigo: municipio,
      cnae: cnae || null,
      days,
      scanned,
      returned: unique.length,
      sourceUpdated,
      source: 'Dados do CNPJ/Receita Federal via Minha Receita',
      exhaustive: false,
      note: 'O radar usa uma consulta paginada da base pública e filtra pela data de abertura. Para cobertura integral de todo o Brasil, é necessário importar a base mensal completa da Receita para um banco dedicado.'
    }
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'GET') throw fail(405, 'Método não permitido.');
    await authenticatedAdmin(req);
    const mode = String(req.query?.mode || 'radar');
    if (mode === 'cnpj') {
      const company = await lookupCnpj(req.query?.cnpj);
      return res.status(200).json({ company });
    }
    const result = await radarSearch(req.query || {});
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Erro interno.' });
  }
};
