// src/services/dftransGps.js
// GPS ao vivo do DF no Ponto/DFTrans.
// A rota /api/dftrans-gps evita CORS na Vercel e normaliza o retorno do endpoint operacoes.

const PROXY_URL = '/api/dftrans-gps';
const DIRECT_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';
const CACHE_KEY = 'localizabus_dftrans_gps_cache_v1';
const CACHE_MAX_AGE_MS = 20_000;

const normalizeLine = (line) => String(line || '').trim();

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const readCache = () => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.createdAt || !Array.isArray(parsed?.vehicles)) return null;
    if (Date.now() - parsed.createdAt > CACHE_MAX_AGE_MS) return null;
    return parsed.vehicles;
  } catch {
    return null;
  }
};

const writeCache = (vehicles) => {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ createdAt: Date.now(), vehicles }));
  } catch {
    // Cache é opcional.
  }
};

export const normalizeDftransVehicle = (vehicle, operator = {}) => {
  const lat = toNumber(vehicle?.localizacao?.latitude ?? vehicle?.lat ?? vehicle?.latitude);
  const lon = toNumber(vehicle?.localizacao?.longitude ?? vehicle?.lon ?? vehicle?.longitude);
  const speed = toNumber(vehicle?.velocidade?.valor ?? vehicle?.velocidade ?? vehicle?.speed) ?? 0;
  const bearing = toNumber(vehicle?.direcao ?? vehicle?.bearing) ?? 0;
  const timestamp = toNumber(vehicle?.horario ?? vehicle?.timestamp) ?? null;
  const line = normalizeLine(vehicle?.linha ?? vehicle?.line);
  const number = String(vehicle?.numero ?? vehicle?.number ?? '').trim();

  return {
    id: `${operator?.id || operator?.sigla || 'op'}-${number || Math.random().toString(36).slice(2)}`,
    numero: number,
    line,
    linha: line,
    routeId: line,
    lat,
    lon,
    speed,
    bearing,
    horario: timestamp,
    updatedAt: timestamp ? new Date(timestamp).toISOString() : null,
    valid: vehicle?.valid !== false && Number.isFinite(lat) && Number.isFinite(lon),
    sentido: vehicle?.sentido ?? null,
    codigoImei: vehicle?.codigoImei ?? null,
    operadora: {
      id: operator?.id ?? null,
      nome: operator?.nome || operator?.razaoSocial || 'Operadora DFTrans',
      sigla: operator?.sigla || '',
      razaoSocial: operator?.razaoSocial || '',
    },
    source: 'DFTrans GPS',
  };
};

const normalizeResponse = (payload) => {
  const rows = Array.isArray(payload) ? payload : payload?.operacoes || payload?.data || [];
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((group) => {
    const operator = group?.operadora || group?.operator || {};
    const vehicles = Array.isArray(group?.veiculos) ? group.veiculos : [];
    return vehicles.map((vehicle) => normalizeDftransVehicle(vehicle, operator));
  }).filter((vehicle) => vehicle.valid);
};

const fetchJson = async (url, signal) => {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`DFTrans GPS retornou ${response.status}`);
  }

  return response.json();
};

export const fetchDftransVehicles = async ({ signal, forceRefresh = false, line } = {}) => {
  if (!forceRefresh) {
    const cached = readCache();
    if (cached?.length) {
      return line ? cached.filter((v) => String(v.line).includes(String(line))) : cached;
    }
  }

  let payload = null;

  try {
    payload = await fetchJson(PROXY_URL, signal);
  } catch (proxyError) {
    console.warn('[DFTrans GPS] Proxy indisponível, tentando endpoint direto:', proxyError?.message || proxyError);
    payload = await fetchJson(DIRECT_URL, signal);
  }

  const vehicles = normalizeResponse(payload);
  writeCache(vehicles);

  if (line) {
    const safeLine = String(line).trim();
    return vehicles.filter((vehicle) => String(vehicle.line).includes(safeLine));
  }

  return vehicles;
};
