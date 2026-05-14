// src/comp/WalkingMapModal.jsx
// ✅ FIX: Mapa visual agora usa Mapbox GL JS navigation-day/night
// ✅ CLEAN: Mapa Mapbox mais limpo, com câmera de navegação e UI menos pesada
// ✅ FIX: Strip de tags HTML nas instruções (<street>, <b>, etc.)
// ✅ FIX: Painel inferior com contraste correto dark/light
// ✅ FIX: Mapa inicia em modo navegação (pitch 60, centrado no usuário/origem)
// ✅ FIX: Carro/Moto recebem navigationMode, fromLat/fromLon, toLat/toLon corretamente
// ✅ FIX: Race condition resolvida — mapa aguarda coords via Promise
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Footprints, Navigation, ArrowLeft, ArrowRight,
  ArrowUp, RotateCcw, Play, Square, MapPin, Maximize2, Minimize2,
  Smartphone, Car, Bike, Volume2, VolumeX, ChevronDown, ChevronUp, CheckCircle2
} from 'lucide-react';
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN, TOMTOM_API_KEY } from "../config/apiKeys";

const MAPBOX_KEY = MAPBOX_TOKEN;
const TOMTOM_KEY = TOMTOM_API_KEY;


// ─── Utils ────────────────────────────────────────────────────────────────────
const hav = (a, b, c, d) => {
  const R = 6371000, dL = (c - a) * Math.PI / 180, dO = (d - b) * Math.PI / 180;
  const x = Math.sin(dL / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const bear = (a, b, c, d) => {
  const dO = (d - b) * Math.PI / 180;
  const y = Math.sin(dO) * Math.cos(c * Math.PI / 180);
  const x = Math.cos(a * Math.PI / 180) * Math.sin(c * Math.PI / 180) - Math.sin(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.cos(dO);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
};
const dist = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
const mins = s => { if (s < 60) return `${s}s`; const m = Math.floor(s / 60), r = s % 60; return r ? `${m}min ${r}s` : `${m} min`; };
const clockTime = (d = new Date()) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const isIOSDevice = () => /iPad|iPhone|iPod/i.test(navigator.userAgent);
const isAndroidDevice = () => /Android/i.test(navigator.userAgent);

const pickBestPtBrVoice = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  const voices = window.speechSynthesis.getVoices?.() || [];
  if (!voices.length) return null;

  const ptVoices = voices.filter(v => String(v.lang || '').toLowerCase().startsWith('pt'));
  const score = (voice) => {
    const name = String(voice.name || '').toLowerCase();
    const lang = String(voice.lang || '').toLowerCase();
    let points = 0;

    if (lang === 'pt-br') points += 50;
    if (/google|microsoft|natural|online|premium|neural|enhanced/i.test(name)) points += 35;
    if (/maria|francisca|luciana|heloisa|helena|female|feminina/i.test(name)) points += 15;
    if (/compact|eloquence|basic/i.test(name)) points -= 25;

    return points;
  };

  return [...ptVoices].sort((a, b) => score(b) - score(a))[0] || voices[0] || null;
};

const normalizeSpeechText = (txt = '') => String(txt)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\bDF[- ]?0?61\b/gi, 'D F zero sessenta e um')
  .replace(/\bDF\b/gi, 'D F')
  .replace(/\bEPAA\b/gi, 'E P A A')
  .replace(/\bEPCT\b/gi, 'E P C T')
  .replace(/\bBR\b/gi, 'B R')
  .replace(/\bAv\.?\b/gi, 'Avenida')
  .replace(/\bSt\.?\b/gi, 'Setor')
  .replace(/\bkm\b/gi, 'quilômetros')
  .replace(/\bm\b/gi, 'metros')
  .replace(/\s+/g, ' ')
  .trim();

const makeSpeechText = (current, next) => {
  const first = normalizeSpeechText(current);
  const second = normalizeSpeechText(next);
  if (!second) return first;
  return `${first}. Depois, ${second}.`;
};
// ─── Strip HTML tags das instruções (remove <street>, </street>, <b>, etc.) ───
const stripHtmlTags = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
};

// ─── Detecta dark mode ────────────────────────────────────────────────────────
const getIsDarkMode = (isDarkProp) => {
  // Prop explícita tem prioridade
  if (typeof isDarkProp === 'boolean') return isDarkProp;
  // Checa classe no <html> (Tailwind dark mode)
  if (document.documentElement.classList.contains('dark')) return true;
  // Checa atributo data-theme
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  // Fallback: preferência do sistema
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
};

// ─── Estilo Mapbox conforme dark/light ───────────────────────────────────────
const getMapboxStyle = (isDark) => {
  return (
    import.meta.env.VITE_MAPBOX_STYLE_URL ||
    (isDark
      ? "mapbox://styles/mapbox/navigation-night-v1"
      : "mapbox://styles/mapbox/navigation-day-v1")
  );
};

// ─── Detecta mobile ───────────────────────────────────────────────────────────
const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);

// ─── Deep Link para app nativo ────────────────────────────────────────────────
const getExternalTravelMode = (mode) => {
  if (mode === 'car' || mode === 'motorcycle') return { google: 'driving', apple: 'd' };
  return { google: 'walking', apple: 'w' };
};

const openNativeNavigation = (destLat, destLon, destName, mode = 'walk') => {
  const label = encodeURIComponent(destName || 'Destino');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const externalMode = getExternalTravelMode(mode);
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&travelmode=${externalMode.google}`;
  if (isIOS) {
    const apple = `maps://?daddr=${destLat},${destLon}&dirflg=${externalMode.apple}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none'; iframe.src = apple;
    document.body.appendChild(iframe);
    setTimeout(() => { document.body.removeChild(iframe); window.open(gmaps, '_blank', 'noopener'); }, 800);
  } else {
    const a = document.createElement('a');
    a.href = `geo:${destLat},${destLon}?q=${destLat},${destLon}(${label})`;
    a.click();
    setTimeout(() => window.open(gmaps, '_blank', 'noopener'), 800);
  }
};

// ─── Validação de coords ──────────────────────────────────────────────────────
const isValidCoord = (lat, lon) =>
  typeof lat === 'number' && typeof lon === 'number' &&
  isFinite(lat) && isFinite(lon) &&
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
  !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);

// ─── API calls com AbortController ───────────────────────────────────────────
const geocode = async (addr, signal) => {
  if (!TOMTOM_KEY) throw new Error('Chave TomTom ausente para geocodificação. Configure VITE_TOMTOM_API_KEY na Vercel.');
  const r = await fetch(
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(addr)}.json?key=${TOMTOM_KEY}&countrySet=BR&limit=1`,
    { signal }
  );
  if (!r.ok) throw new Error(`Geocode HTTP ${r.status}`);
  const d = await r.json();
  const p = d.results?.[0]?.position;
  if (!p) throw new Error(`Endereço não encontrado: ${addr}`);
  if (!isValidCoord(p.lat, p.lon)) throw new Error(`Coordenadas inválidas para: ${addr}`);
  return { lat: p.lat, lon: p.lon };
};

const getRoute = async (o, d, signal, mode = 'walk') => {
  if (!TOMTOM_KEY) throw new Error('Chave TomTom ausente para calcular rota. Configure VITE_TOMTOM_API_KEY na Vercel.');
  if (!isValidCoord(o.lat, o.lon))
    throw new Error(`Origem inválida (lat=${o.lat}, lon=${o.lon}). Verifique sua localização.`);
  if (!isValidCoord(d.lat, d.lon))
    throw new Error(`Destino inválido (lat=${d.lat}, lon=${d.lon}). Verifique o endereço.`);

  const travelMode = mode === 'motorcycle' ? 'motorcycle' : mode === 'car' ? 'car' : 'pedestrian';
  const routeType = travelMode === 'pedestrian' ? 'shortest' : 'fastest';
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${o.lat},${o.lon}:${d.lat},${d.lon}/json` +
    `?key=${TOMTOM_KEY}&travelMode=${travelMode}&routeType=${routeType}&traffic=true&instructionsType=tagged&language=pt-BR`;

  const r = await fetch(url, { signal });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Erro ao calcular rota (HTTP ${r.status}): ${body.slice(0, 120)}`);
  }
  const data = await r.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('Nenhuma rota encontrada entre os pontos. Tente ajustar o destino.');

  const pts = route.legs[0].points.map(p => [p.longitude, p.latitude]);

  // ✅ FIX: Strip de tags HTML nas instruções
  const instrs = (route.guidance?.instructions || []).map(i => ({
    msg: stripHtmlTags(i.message || i.street || 'Continue em frente'),
    man: i.maneuver || 'STRAIGHT',
    off: i.routeOffsetInMeters || 0,
    dist: i.travelTimeInSeconds || 0,
  }));

  // ✅ Calcula bearing inicial da rota (primeiros 2 pontos)
  let initialBearing = 0;
  if (pts.length >= 2) {
    initialBearing = bear(pts[0][1], pts[0][0], pts[1][1], pts[1][0]);
  }

  return {
    pts, instrs,
    mode: travelMode === 'pedestrian' ? 'walk' : travelMode,
    totalM: route.summary.lengthInMeters,
    totalS: route.summary.travelTimeInSeconds,
    geo: { type: 'Feature', geometry: { type: 'LineString', coordinates: pts } },
    initialBearing,
  };
};

const ManIcon = ({ type, size = 10 }) => {
  const t = (type || '').toLowerCase();
  const cls = 'text-white';
  if (t.includes('left')) return <ArrowLeft className={cls} width={size} height={size} strokeWidth={3} />;
  if (t.includes('right')) return <ArrowRight className={cls} width={size} height={size} strokeWidth={3} />;
  if (t.includes('uturn')) return <RotateCcw className={cls} width={size} height={size} strokeWidth={3} />;
  return <ArrowUp className={cls} width={size} height={size} strokeWidth={3} />;
};

// ─── Componente ───────────────────────────────────────────────────────────────
const WalkingMapModal = ({ route, userLocation, onClose, isDark: isDarkProp }) => {
  // ✅ FIX: navigationMode correto para Carro/Moto — usa route.navigationMode antes de qualquer fallback
  const navigationMode = route?.navigationMode || (route?.isWalk ? 'walk' : 'walk');
  const isDrivingMode = navigationMode === 'car' || navigationMode === 'motorcycle';
  const modeLabel = route?.isWalk ? 'caminhada' : navigationMode === 'motorcycle' ? 'moto' : 'carro';

  // ✅ FIX: detecta dark mode uma vez ao montar
  const isDark = useRef(getIsDarkMode(isDarkProp)).current;

  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const markerRef = useRef(null);
  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const t0Ref = useRef(null);
  const lastRef = useRef(null);
  const lastSpokenRef = useRef('');
  const voiceReadyRef = useRef(false);
  const rdRef = useRef(null);
  const origRef = useRef(null);
  const destRef = useRef(null);
  const mountedRef = useRef(true);

  // ✅ Promise que desbloqueia fases 2 e 3 quando coords ficam prontas
  const coordsReady = useRef(null);
  const coordsResolve = useRef(null);
  if (!coordsReady.current) {
    coordsReady.current = new Promise(res => { coordsResolve.current = res; });
  }

  const [mapReady, setMapReady] = useState(false);
  const [rd, setRd] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState('Localizando pontos…');

  const [nav, setNav] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [brng, setBrng] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [covered, setCovered] = useState(0);
  const [remain, setRemain] = useState(null);
  const [acc, setAcc] = useState(null);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [navStartedAt, setNavStartedAt] = useState(null);
  const [arrived, setArrived] = useState(false);
  const [curI, setCurI] = useState(null);
  const [nextI, setNextI] = useState(null);
  const [fs, setFs] = useState(false);
  const [overview, setOverview] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => { setIsMobile(isMobileDevice()); }, []);
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fullscreen ────────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) { await wrapRef.current?.requestFullscreen(); setFs(true); }
      else { await document.exitFullscreen(); setFs(false); }
    } catch (_) { setFs(false); }
  }, []);
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  // ── FASE 1: resolver coords ─────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const abort = new AbortController();
    const { signal } = abort;

    (async () => {
      try {
        if (!MAPBOX_KEY) {
          throw new Error('Chave Mapbox ausente. Configure VITE_MAPBOX_TOKEN na Vercel e faça redeploy.');
        }
        setLoadMsg('Localizando pontos…');

        // ✅ FIX: Origem — prioriza fromLat/fromLon (passados por Carro/Moto)
        let o = null;
        if (route.fromLat != null && route.fromLon != null && isValidCoord(Number(route.fromLat), Number(route.fromLon))) {
          o = { lat: Number(route.fromLat), lon: Number(route.fromLon) };
        } else if (userLocation && isValidCoord(userLocation.lat, userLocation.lon)) {
          o = { lat: userLocation.lat, lon: userLocation.lon };
        } else if (route.origin) {
          o = await geocode(route.origin, signal);
        } else {
          o = { lat: -15.7934, lon: -47.8823 }; // fallback centro Brasília
        }

        // ✅ FIX: Destino — prioriza toLat/toLon (passados por Carro/Moto)
        let d = null;
        if (route.toLat != null && route.toLon != null && isValidCoord(Number(route.toLat), Number(route.toLon))) {
          d = { lat: Number(route.toLat), lon: Number(route.toLon), name: route.destination || route.toStop || 'Destino' };
        } else if (route.isNavigationRoute && route.destination) {
          d = { ...(await geocode(route.destination, signal)), name: route.destination };
        } else if (route.lat && route.lon && isValidCoord(Number(route.lat), Number(route.lon))) {
          d = { lat: Number(route.lat), lon: Number(route.lon), name: route.fromStop || 'Ponto de embarque' };
        } else if (route.isWalk && route.destination) {
          d = { ...(await geocode(route.destination, signal)), name: route.destination };
        } else if (route.destination) {
          d = { ...(await geocode(route.destination, signal)), name: route.destination };
        } else {
          d = { lat: -15.7801, lon: -47.9292, name: 'Destino' };
        }

        const straightDistance = hav(o.lat, o.lon, d.lat, d.lon);
        if (straightDistance > 180000 && (navigationMode === 'car' || navigationMode === 'motorcycle')) {
          throw new Error('A rota ficou muito distante. Confira se a origem e o destino estão corretos ou escolha uma sugestão da lista.');
        }

        if (!mountedRef.current) return;
        origRef.current = o;
        destRef.current = d;
        coordsResolve.current?.();

      } catch (e) {
        if (e.name === 'AbortError') return;
        if (mountedRef.current) { setErr(e.message); setLoading(false); }
      }
    })();

    return () => { mountedRef.current = false; abort.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── FASE 2: iniciar mapa Mapbox (aguarda coords) ───────────────────────
  useEffect(() => {
    let map = null;
    let alive = true;

    (async () => {
      try {
        await coordsReady.current;
        if (!alive || !mapElRef.current) return;

        if (!MAPBOX_KEY) {
          throw new Error('Chave Mapbox ausente. Configure VITE_MAPBOX_TOKEN na Vercel e faça redeploy.');
        }

        const o = origRef.current || { lat: -15.7934, lon: -47.8823 };
        mapboxgl.accessToken = MAPBOX_KEY;

        map = new mapboxgl.Map({
          container: mapElRef.current,
          style: getMapboxStyle(isDark),
          center: [o.lon, o.lat],
          zoom: 18.2,
          pitch: 52,
          bearing: 0,
          attributionControl: false,
          cooperativeGestures: false,
          language: 'pt-BR',
        });

        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl({ showZoom: true, showCompass: true }), 'bottom-right');

        map.on('load', () => {
          if (!alive) return;

          // Visual limpo: sem camada extra de prédios 3D para não ficar com cara de simulador.

          if (destRef.current) addDestPin(map, destRef.current);
          addUserPin(map, o);
          setMapReady(true);
        });
      } catch (e) {
        if (alive) { setErr(e.message || 'Falha ao carregar mapa Mapbox'); setLoading(false); }
      }
    })();

    return () => {
      alive = false;
      if (map) { try { map.remove(); } catch (_) { } }
      mapRef.current = null; markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── FASE 3: buscar rota (aguarda mapa pronto) ────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const abort = new AbortController();

    (async () => {
      try {
        setLoadMsg('Calculando rota…');
        await coordsReady.current;
        const o = origRef.current, d = destRef.current;
        if (!o || !d) throw new Error('Coordenadas não disponíveis.');

        const data = await getRoute(o, d, abort.signal, navigationMode);
        if (!mountedRef.current) return;

        rdRef.current = data;
        setRd(data);
        setRemain(data.totalM);
        if (data.instrs.length) { setCurI(data.instrs[0]); setNextI(data.instrs[1] || null); }
        setLoading(false);

        const m = mapRef.current;
        if (m) {
          drawRoute(m, data);
          // ✅ FIX: ao carregar, centraliza na origem com pitch 60 e bearing da rota
          const b = data.initialBearing || 0;
          setBrng(b);
          m.easeTo({
            center: [o.lon, o.lat],
            zoom: 18.75,
            pitch: 60,
            bearing: b,
            padding: { top: 90, bottom: 260, left: 0, right: 0 },
            offset: [0, 70],
            duration: 900,
          });
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (mountedRef.current) { setErr(e.message); setLoading(false); }
      }
    })();

    return () => abort.abort();
  }, [mapReady]); // eslint-disable-line

  // Rota neon synthwave ───────────────────────────────────────────────────────
  const drawRoute = useCallback((m, data) => {
    if (!m || !data) return;
    const safe = fn => { try { fn(); } catch (_) { } };
    safe(() => {
      if (m.getSource('wr')) { m.getSource('wr').setData(data.geo); return; }
      m.addSource('wr', { type: 'geojson', data: data.geo });
      // Linha limpa: sombra discreta + rota azul, sem neon pesado.
      const isWalkRoute = data.mode === 'walk' || !isDrivingMode;

      m.addLayer({
        id: 'wr-shadow', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': isWalkRoute ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.74)',
          'line-width': isWalkRoute ? 14 : 18,
          'line-opacity': 0.96,
          'line-blur': isWalkRoute ? 1.6 : 2.2
        }
      });
      m.addLayer({
        id: 'wr-fill', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': isWalkRoute ? '#2563EB' : '#18D7FF',
          'line-width': isWalkRoute ? 7 : 10.5,
          'line-opacity': 1,
          ...(isWalkRoute ? { 'line-dasharray': [1.4, 1.1] } : {})
        }
      });
      m.addLayer({
        id: 'wr-soft-highlight', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#FFFFFF',
          'line-width': isWalkRoute ? 2.4 : 3,
          'line-opacity': isWalkRoute ? 0.72 : 0.82,
          ...(isWalkRoute ? { 'line-dasharray': [1.4, 1.1] } : {})
        }
      });
    });
  }, [isDrivingMode, isDark]);

  // ✅ FIX: fitAll (visão geral) usa pitch 0 e fitBounds
  const fitAll = useCallback((m, pts) => {
    if (!pts?.length) return;
    const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
    m.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 96, bottom: 150, left: 44, right: 44 }, duration: 850, pitch: 0, bearing: 0 }
    );
  }, []);

  // Marcadores ────────────────────────────────────────────────────────────────
  const addDestPin = useCallback((m, d) => {
    if (!m) return;
    const el = document.createElement('div');
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div style="width:34px;height:34px;border-radius:18px 18px 18px 4px;
          background:${isDark ? '#0f172a' : '#ffffff'};
          border:2px solid ${isDrivingMode ? '#2563eb' : '#06b6d4'};
          box-shadow:0 6px 18px rgba(0,0,0,0.28);
          transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
          <span style="transform:rotate(45deg);font-size:14px;">🏁</span>
        </div>
      </div>`;
    new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([d.lon, d.lat]).addTo(m);
  }, [isDark, isDrivingMode]);

  const addUserPin = useCallback((m, pos) => {
    if (markerRef.current) return;

    const el = document.createElement("div");
    el.className = "navigation-arrow-marker";

    el.innerHTML = `
    <div class="nav-arrow-pulse"></div>
    <div class="nav-arrow-body">
      <svg viewBox="0 0 64 64" width="44" height="44">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="rgba(0,0,0,0.45)" />
          </filter>
        </defs>
        <path 
          d="M32 4 L52 56 L32 45 L12 56 Z"
          fill="#18D7FF"
          stroke="#FFFFFF"
          stroke-width="5"
          stroke-linejoin="round"
          filter="url(#shadow)"
        />
        <path 
          d="M32 12 L43 43 L32 37 L21 43 Z"
          fill="#007AFF"
          opacity="0.9"
        />
      </svg>
    </div>
  `;

    const style = document.createElement("style");
    style.innerHTML = `
    .navigation-arrow-marker {
      width: 58px;
      height: 58px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: center center;
      will-change: transform;
    }

    .nav-arrow-pulse {
      position: absolute;
      width: 54px;
      height: 54px;
      border-radius: 999px;
      background: rgba(24, 215, 255, 0.16);
      border: 1px solid rgba(24, 215, 255, 0.35);
      animation: navPulse 1.8s ease-out infinite;
    }

    .nav-arrow-body {
      position: relative;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    @keyframes navPulse {
      0% {
        transform: scale(0.72);
        opacity: 0.8;
      }
      100% {
        transform: scale(1.45);
        opacity: 0;
      }
    }
  `;

    if (!document.getElementById("navigation-arrow-style")) {
      style.id = "navigation-arrow-style";
      document.head.appendChild(style);
    }

    markerRef.current = new mapboxgl.Marker({
      element: el,
      anchor: "center",
      rotationAlignment: "map",
      pitchAlignment: "map",
    })
      .setLngLat([pos.lon, pos.lat])
      .addTo(m);
  }, []);

// Instrução ─────────────────────────────────────────────────────────────────
const updateInstr = useCallback((distM) => {
  const data = rdRef.current;

  if (!data?.instrs?.length) return;

  let idx = 0;

  for (let i = 0; i < data.instrs.length; i++) {
    if (data.instrs[i].off <= distM) {
      idx = i;
    } else {
      break;
    }
  }

  setCurI(data.instrs[idx]);
  setNextI(data.instrs[idx + 1] || null);
}, []);
  // GPS ───────────────────────────────────────────────────────────────────────
const onGPS = useCallback(pos => {
  const { latitude: la, longitude: lo, accuracy: ac, speed } = pos.coords;

  setAcc(Math.round(ac));

  let b = brng;
  let computedSpeedKmh = 0;

  if (lastRef.current) {
    b = bear(lastRef.current.lat, lastRef.current.lon, la, lo);

    // Se o navegador não entregar velocidade, calcula pela distância/tempo entre leituras do GPS.
    const deltaMeters = hav(lastRef.current.lat, lastRef.current.lon, la, lo);
    const deltaSeconds = Math.max(0.3, (Date.now() - (lastRef.current.ts || Date.now())) / 1000);
    computedSpeedKmh = (deltaMeters / deltaSeconds) * 3.6;
  }

  if (typeof speed === 'number' && speed >= 0) {
    computedSpeedKmh = speed * 3.6;
  }

  // Evita número maluco quando o GPS dá salto.
  if (!Number.isFinite(computedSpeedKmh) || computedSpeedKmh < 1) computedSpeedKmh = 0;
  if (computedSpeedKmh > 180) computedSpeedKmh = 180;

  setSpeedKmh(Math.round(computedSpeedKmh));

  lastRef.current = { lat: la, lon: lo, ts: Date.now() };
  setBrng(b);

  const m = mapRef.current;

  if (m) {
    if (markerRef.current) {
      markerRef.current.setLngLat([lo, la]);

      const markerEl = markerRef.current.getElement();
      const arrowBody = markerEl.querySelector(".nav-arrow-body");

      if (arrowBody) {
        arrowBody.style.transform = `rotate(${b}deg)`;
      }
    } else {
      addUserPin(m, { lat: la, lon: lo });
    }

    // Modo navegação tipo Waze: zoom mais próximo, câmera inclinada e seta mais baixa na tela.
    if (!overview) {
      m.easeTo({
        center: [lo, la],
        zoom: 19.05,
        pitch: 64,
        bearing: b,
        padding: { top: 120, bottom: 320, left: 0, right: 0 },
        offset: [0, 90],
        duration: 650,
        easing: t => t
      });
    }

    const rd2 = rdRef.current;
    if (rd2 && m.getSource('wr')) {
      drawRoute(m, rd2);
    }
  }

  const o = origRef.current;
  const de = destRef.current;
  const rd2 = rdRef.current;

  if (rd2 && o) {
    const cov = Math.min(hav(o.lat, o.lon, la, lo), rd2.totalM);
    const rem = Math.max(0, rd2.totalM - cov);

    setCovered(cov);
    setRemain(rem);
    updateInstr(cov);

    if (de && hav(la, lo, de.lat, de.lon) < 25) {
      setArrived(true);
    }
  }
}, [overview, updateInstr, addUserPin, drawRoute, brng]);


  const unlockVoice = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.getVoices?.();

      // iOS/Android só liberam áudio após interação do usuário.
      const silent = new window.SpeechSynthesisUtterance(' ');
      silent.lang = 'pt-BR';
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      voiceReadyRef.current = true;
    } catch (error) {
      console.warn('[Voz] Não foi possível liberar a voz:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => window.speechSynthesis.getVoices?.();
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Voz da navegação ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nav || !tracking || voiceMuted || !curI?.msg) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const text = makeSpeechText(curI.msg, nextI?.msg);
    if (!text || lastSpokenRef.current === text) return;

    try {
      lastSpokenRef.current = text;
      window.speechSynthesis.cancel();

      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      const selectedVoice = pickBestPtBrVoice();
      if (selectedVoice) utterance.voice = selectedVoice;

      // Ajuste fino: mais calmo no iOS, um pouco mais vivo no Android.
      utterance.rate = isIOSDevice() ? 0.84 : isAndroidDevice() ? 0.92 : 0.88;
      utterance.pitch = isAndroidDevice() ? 1.02 : 0.94;
      utterance.volume = 1;

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('[Voz] Erro ao falar instrução:', error);
    }
  }, [nav, tracking, voiceMuted, curI, nextI]);

  const toggleVoice = useCallback(() => {
    setVoiceMuted(v => {
      const next = !v;
      if (!next) lastSpokenRef.current = '';
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }, []);

  // Start/Stop ────────────────────────────────────────────────────────────────
  const startNav = useCallback(async () => {
    if (!navigator.geolocation) {
      setErr('GPS não disponível neste navegador.');
      return;
    }

    setErr(null);
    unlockVoice();

    setNavStartedAt(new Date());
    lastSpokenRef.current = '';
    setNav(true);
    setTracking(true);
    setOverview(false);
    setBottomOpen(false);
    t0Ref.current = Date.now() - elapsed * 1000;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0Ref.current) / 1000)), 1000);

    const handleGpsError = (e) => {
      const message = e?.code === 1
        ? 'Permissão de localização negada. Libere o GPS do navegador para iniciar a navegação.'
        : e?.code === 2
          ? 'Não consegui obter sua localização agora. Ative o GPS e tente novamente.'
          : 'Tempo esgotado ao buscar sua localização. Tente novamente em alguns segundos.';
      setErr(message);
      setTracking(false);
      clearInterval(timerRef.current);
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };

    navigator.geolocation.getCurrentPosition(onGPS, handleGpsError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    });

    watchRef.current = navigator.geolocation.watchPosition(onGPS, handleGpsError,
      { enableHighAccuracy: true, maximumAge: 800, timeout: 12000 });
  }, [elapsed, onGPS, unlockVoice]);

  const pauseNav = useCallback(() => {
    setTracking(false);
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    clearInterval(timerRef.current);
    const m = mapRef.current;
    if (m) m.easeTo({ pitch: 38, bearing: 0, zoom: 16, duration: 650 });
  }, []);

  const stopNav = useCallback(() => {
    pauseNav();
    setNav(false); setElapsed(0); setCovered(0);
    setRemain(rdRef.current?.totalM ?? null);
    setArrived(false); setBrng(0); setSpeedKmh(0); setNavStartedAt(null); lastRef.current = null; lastSpokenRef.current = '';
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    const m = mapRef.current, rd2 = rdRef.current;
    if (m && rd2) {
      // Volta para modo navegação centrado na origem com pitch 60
      const o = origRef.current;
      if (o) {
        m.easeTo({ center: [o.lon, o.lat], zoom: 18.2, pitch: 52, bearing: rd2.initialBearing || 0, duration: 650 });
      }
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    setFs(false); setBottomOpen(true);
    if (rd2?.instrs?.length) { setCurI(rd2.instrs[0]); setNextI(rd2.instrs[1] || null); }
  }, [pauseNav]);

  // ✅ FIX: visão geral usa fitBounds com pitch 0; retorno usa pitch 60
  const toggleOverview = useCallback(() => {
    setOverview(v => {
      const next = !v;
      const m = mapRef.current;
      if (m) {
        if (next) {
          // Visão geral: fitBounds, pitch 0
          fitAll(m, rdRef.current?.pts);
        } else if (lastRef.current) {
          // Retorno à navegação: pitch 60, bearing do GPS
          m.easeTo({ center: [lastRef.current.lon, lastRef.current.lat], zoom: 19.05, pitch: 64, bearing: brng, padding: { top: 120, bottom: 320, left: 0, right: 0 }, offset: [0, 90], duration: 650 });
        } else if (origRef.current) {
          const o = origRef.current;
          m.easeTo({ center: [o.lon, o.lat], zoom: 18.2, pitch: 52, bearing: rdRef.current?.initialBearing || 0, duration: 650 });
        }
      }
      return next;
    });
  }, [brng, fitAll]);


  const focusUserLocation = useCallback(() => {
    const m = mapRef.current;
    const pos = lastRef.current || origRef.current;
    if (!m || !pos) return;

    setOverview(false);
    m.easeTo({
      center: [pos.lon, pos.lat],
      zoom: lastRef.current ? 19.05 : 18.7,
      pitch: lastRef.current ? 64 : 58,
      bearing: lastRef.current ? brng : rdRef.current?.initialBearing || 0,
      padding: { top: 120, bottom: 320, left: 0, right: 0 },
      offset: [0, 90],
      duration: 750,
      easing: t => t,
    });
  }, [brng]);

  useEffect(() => () => { pauseNav(); }, []);

  // Cálculos ──────────────────────────────────────────────────────────────────
  const pct = rd ? Math.min(100, (covered / rd.totalM) * 100) : 0;
  const averageKmh = navigationMode === 'motorcycle' ? 38 : navigationMode === 'car' ? 32 : 4.8;
  const eta = remain != null ? Math.round((remain / 1000) / averageKmh * 3600) : rd?.totalS ?? null;
  const destName = destRef.current?.name || route.fromStop || route.destination || 'Destino';
  const destCoords = destRef.current;

  // ─── Design tokens: adapta dark/light ────────────────────────────────────
  const C = '#00d5ff';
  const routeBlue = isDrivingMode ? '#2563eb' : '#06b6d4';

  // ✅ FIX: cores do painel inferior com contraste correto dark vs light
  const panelBg = isDark ? 'rgba(5,8,16,0.96)' : 'rgba(255,255,255,0.96)';
  const panelBorder = isDark ? '1px solid rgba(0,213,255,0.12)' : '1px solid rgba(0,0,0,0.08)';
  const panelText = isDark ? '#ffffff' : '#111827';
  const panelSubText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(17,24,39,0.55)';
  const panelAccent = isDark ? 'rgba(0,243,255,0.04)' : 'rgba(0,0,0,0.04)';
  const panelAccentBorder = isDark ? '1px solid rgba(0,243,255,0.09)' : '1px solid rgba(0,0,0,0.08)';
  const panelLabelColor = isDark ? 'rgba(0,213,255,0.65)' : 'rgba(37,99,235,0.75)';

  const neon = {
    border: isDark ? '1px solid rgba(0,213,255,0.28)' : '1px solid rgba(37,99,235,0.18)',
    background: isDark ? 'linear-gradient(135deg,rgba(0,213,255,0.10),rgba(37,99,235,0.22))' : 'linear-gradient(135deg,#eff6ff,#dbeafe)',
    boxShadow: isDark ? '0 10px 26px rgba(0,0,0,0.28)' : '0 10px 22px rgba(37,99,235,0.12)',
    color: isDark ? '#dffcff' : '#1d4ed8', fontWeight: 800, borderRadius: 18,
  };

  // Fundo do wrapper: dark=escuro, light=claro neutro
  const wrapperBg = isDark ? '#050810' : '#f1f5f9';

  return (
    <div ref={wrapRef} style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: wrapperBg, display: 'flex', flexDirection: 'column' }}>

      
      <div
        ref={mapElRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      >

        
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: isDark ? '#050810' : '#f1f5f9', gap: 16
          }}>
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '2px solid transparent', borderTopColor: C,
                borderRightColor: isDark ? 'rgba(0,243,255,0.3)' : 'rgba(0,80,200,0.2)',
                animation: 'spinNeon 1.2s linear infinite',
                boxShadow: `0 0 18px rgba(0,243,255,0.4)`
              }} />
              <div style={{
                position: 'absolute', inset: 8, borderRadius: '50%',
                background: isDark ? 'rgba(0,243,255,0.06)' : 'rgba(0,80,200,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {navigationMode === 'car' ? (
                  <Car style={{ color: C, width: 22, height: 22 }} />
                ) : navigationMode === 'motorcycle' ? (
                  <Bike style={{ color: C, width: 22, height: 22 }} />
                ) : (
                  <Footprints style={{ color: C, width: 22, height: 22 }} />
                )}
              </div>
            </div>
            <p style={{
              color: C, fontSize: 13, fontWeight: 700, letterSpacing: 1,
              textShadow: isDark ? `0 0 12px rgba(0,243,255,0.6)` : 'none'
            }}>{loadMsg}</p>
            <p style={{ color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.4)', fontSize: 11 }}>Mapbox GL · Navegação {modeLabel} 3D</p>
            <style>{`@keyframes spinNeon{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        
        {err && !loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: isDark ? '#050810' : '#f1f5f9', gap: 12, padding: 24
          }}>
            <MapPin style={{ color: '#ff453a', width: 40, height: 40 }} />
            <p style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', maxWidth: 300 }}>{err}</p>
            <button onClick={onClose}
              style={{ marginTop: 8, padding: '12px 28px', cursor: 'pointer', border: 'none', ...neon, fontSize: 14 }}>
              Fechar
            </button>
          </div>
        )}

        <AnimatePresence>
          {nav && !overview && curI && !arrived && (
            <motion.div
              key="instr"
              initial={{ y: -80, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -80, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 32,
                padding: 'max(env(safe-area-inset-top,0px),12px) 58px 0 58px',
                pointerEvents: 'none'
              }}
            >
              <div
                style={{
                  maxWidth: 760,
                  margin: '0 auto',
                  borderRadius: 26,
                  overflow: 'hidden',
                  background: isDark
                    ? 'linear-gradient(180deg, rgba(13,18,30,0.76), rgba(8,12,22,0.66))'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.84), rgba(248,250,252,0.74))',
                  border: isDark
                    ? '1px solid rgba(255,255,255,0.10)'
                    : '1px solid rgba(15,23,42,0.08)',
                  boxShadow: isDark
                    ? '0 18px 50px rgba(0,0,0,0.44), inset 0 1px 0 rgba(255,255,255,0.07)'
                    : '0 18px 42px rgba(15,23,42,0.13), inset 0 1px 0 rgba(255,255,255,0.78)',
                  backdropFilter: 'blur(26px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(26px) saturate(180%)',
                  pointerEvents: 'auto'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px 12px' }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 17,
                      background: 'linear-gradient(180deg, #3B82F6 0%, #2563EB 100%)',
                      boxShadow: '0 12px 26px rgba(37,99,235,0.34)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <ManIcon type={curI.man} size={28} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0,
                        color: isDark ? '#F8FAFC' : '#0F172A',
                        fontSize: 22,
                        lineHeight: 1.08,
                        fontWeight: 850,
                        letterSpacing: '-0.45px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {curI.msg}
                    </p>
                    {nextI && (
                      <p
                        style={{
                          margin: '6px 0 0',
                          color: isDark ? 'rgba(248,250,252,0.56)' : 'rgba(15,23,42,0.56)',
                          fontSize: 12,
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Depois: {nextI.msg}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={toggleOverview}
                    style={{
                      height: 38,
                      padding: '0 14px',
                      borderRadius: 999,
                      border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.08)',
                      background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.045)',
                      color: isDark ? 'rgba(255,255,255,0.80)' : '#334155',
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      backdropFilter: 'blur(14px)'
                    }}
                  >
                    {overview ? 'Voltar 3D' : 'Visão geral'}
                  </button>
                </div>

                <div style={{ height: 3, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}>
                  <motion.div
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.55 }}
                    style={{
                      height: '100%',
                      background: 'linear-gradient(90deg, #67E8F9, #2563EB)',
                      boxShadow: '0 0 14px rgba(0,213,255,0.34)'
                    }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        
        <motion.button whileTap={{ scale: 0.88 }} onClick={nav ? stopNav : onClose}
          style={{
            position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', left: 14,
            zIndex: 30, width: 42, height: 42, borderRadius: 21,
            background: isDark ? 'rgba(5,8,16,0.8)' : 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(14px)',
            border: isDark ? '1px solid rgba(0,243,255,0.25)' : '1px solid rgba(0,0,0,0.12)',
            color: isDark ? '#fff' : '#111827',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
          }}>
          <X style={{ width: 17, height: 17 }} />
        </motion.button>

        <motion.button whileTap={{ scale: 0.88 }} onClick={toggleFullscreen}
          style={{
            position: 'absolute',
            top: 'max(env(safe-area-inset-top,0px),14px)',
            right: 14,
            zIndex: 34,
            width: 42,
            height: 42,
            borderRadius: 21,
            background: isDark ? 'rgba(12,17,27,0.62)' : 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(22px) saturate(170%)',
            WebkitBackdropFilter: 'blur(22px) saturate(170%)',
            border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.08)',
            boxShadow: '0 10px 26px rgba(0,0,0,0.18)',
            color: isDark ? '#E0FBFF' : '#2563EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}>
          {fs ? <Minimize2 style={{ width: 16, height: 16 }} /> : <Maximize2 style={{ width: 16, height: 16 }} />}
        </motion.button>

        
        {overview && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={focusUserLocation}
            style={{
              position: 'absolute',
              top: 'max(env(safe-area-inset-top,0px),66px)',
              right: 14,
              zIndex: 36,
              height: 42,
              padding: '0 14px',
              borderRadius: 999,
              background: isDark ? 'rgba(12,17,27,0.72)' : 'rgba(255,255,255,0.80)',
              backdropFilter: 'blur(22px) saturate(170%)',
              WebkitBackdropFilter: 'blur(22px) saturate(170%)',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(15,23,42,0.08)',
              color: isDark ? '#E0FBFF' : '#2563EB',
              fontSize: 12,
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: '0 10px 26px rgba(0,0,0,0.18)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Navigation style={{ width: 15, height: 15 }} strokeWidth={2.8} />
            Minha localização
          </motion.button>
        )}

        {nav && tracking && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            style={{
              position: 'absolute',
              left: 18,
              bottom: 176,
              zIndex: 45,
              width: 60,
              height: 60,
              borderRadius: 20,
              background: isDark ? 'rgba(6,10,18,0.78)' : 'rgba(255,255,255,0.88)',
              border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.10)',
              boxShadow: isDark
                ? '0 18px 42px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)'
                : '0 14px 34px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.75)',
              backdropFilter: 'blur(22px) saturate(170%)',
              WebkitBackdropFilter: 'blur(22px) saturate(170%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}
          >
            <div style={{
              color: isDark ? '#F8FAFC' : '#0F172A',
              fontSize: 22,
              fontWeight: 950,
              lineHeight: 1,
              letterSpacing: -0.7
            }}>
              {speedKmh}
            </div>
            <div style={{
              color: isDark ? 'rgba(248,250,252,0.58)' : 'rgba(15,23,42,0.56)',
              fontSize: 9,
              fontWeight: 850,
              marginTop: 3,
              textTransform: 'uppercase',
              letterSpacing: 0.3
            }}>
              km/h
            </div>
          </motion.div>
        )}

        {tracking && acc != null && (
          <div style={{
            position: 'absolute',
            bottom: nav ? 158 : 188,
            left: 28,
            zIndex: 45,
            color: acc < 30 ? '#67E8F9' : acc < 60 ? '#FBBF24' : '#F87171',
            fontSize: 8,
            fontWeight: 800,
            textShadow: '0 2px 10px rgba(0,0,0,0.55)',
            pointerEvents: 'none'
          }}>
            ±{acc}m
          </div>
        )}

        
        <AnimatePresence>
          {arrived && (
            <motion.div key="arrived"
              initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              style={{
                position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%,-50%)',
                zIndex: 40, textAlign: 'center',
                background: isDark ? 'rgba(5,8,16,0.95)' : 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                border: '1.5px solid rgba(0,243,255,0.45)',
                borderRadius: 24, padding: '28px 36px',
                boxShadow: '0 16px 60px rgba(0,0,0,0.4),0 0 40px rgba(0,243,255,0.15)'
              }}>
              <CheckCircle2 style={{ width: 46, height: 46, color: C, marginBottom: 8 }} />
              <p style={{
                color: C, fontSize: 22, fontWeight: 900, margin: 0,
                textShadow: isDark ? `0 0 16px rgba(0,243,255,0.7)` : 'none'
              }}>
                {route.isWalk ? 'Chegou!' : 'Destino alcançado!'}
              </p>
              <p style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)', fontSize: 13, marginTop: 6 }}>
                {dist(rd?.totalM || 0)} · {mins(elapsed)}
              </p>
              <button onClick={stopNav}
                style={{ marginTop: 16, padding: '12px 28px', cursor: 'pointer', border: 'none', ...neon, fontSize: 14 }}>
                Encerrar
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 44,
          padding: '0 14px max(14px, env(safe-area-inset-bottom))',
          pointerEvents: 'none',
          background: 'transparent'
        }}
      >
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            borderRadius: 28,
            overflow: 'hidden',
            pointerEvents: 'auto',
            background: isDark
              ? 'linear-gradient(180deg, rgba(12,17,29,0.82), rgba(7,12,22,0.94))'
              : 'rgba(255,255,255,0.86)',
            border: isDark ? '1px solid rgba(255,255,255,0.09)' : '1px solid rgba(15,23,42,0.08)',
            boxShadow: isDark
              ? '0 18px 48px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.055)'
              : '0 16px 36px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.70)',
            backdropFilter: 'blur(26px) saturate(170%)',
            WebkitBackdropFilter: 'blur(26px) saturate(170%)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px 13px' }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 16,
                background: isDark ? 'rgba(0,213,255,0.08)' : '#EFF6FF',
                border: isDark ? '1px solid rgba(0,213,255,0.18)' : '1px solid rgba(37,99,235,0.14)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <MapPin style={{ color: routeBlue, width: 19, height: 19 }} strokeWidth={2.5} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  color: isDark ? '#00D5FF' : '#2563EB',
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: 1.3,
                  margin: 0
                }}
              >
                Destino
              </p>
              <p
                style={{
                  color: isDark ? '#F8FAFC' : '#0F172A',
                  fontSize: 15,
                  fontWeight: 850,
                  margin: '3px 0 0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {destName}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
              <span
                style={{
                  color: routeBlue,
                  fontSize: 24,
                  fontWeight: 950,
                  lineHeight: 1,
                  letterSpacing: -0.6,
                  textShadow: isDark ? '0 0 14px rgba(37,99,235,0.25)' : 'none'
                }}
              >
                {remain != null ? dist(remain) : '—'}
              </span>
              <span style={{ color: isDark ? 'rgba(248,250,252,0.46)' : 'rgba(15,23,42,0.55)', fontSize: 12, fontWeight: 800 }}>
                {eta != null ? mins(eta) : '—'}
              </span>
            </div>
          </div>

          <div style={{ height: 1, background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)' }} />

          <div style={{ padding: '12px 16px 15px' }}>
            {nav && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  padding: '2px 0 13px',
                  textAlign: 'center'
                }}
              >
                <div style={{ flex: 1 }} />
                <div style={{ minWidth: 170 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span
                      style={{
                        color: isDark ? '#F8FAFC' : '#0F172A',
                        fontSize: 34,
                        lineHeight: 1,
                        fontWeight: 900,
                        letterSpacing: '-1.2px'
                      }}
                    >
                      {clockTime(clock)}
                    </span>
                    <button
                      onClick={toggleVoice}
                      title={voiceMuted ? 'Ativar voz' : 'Silenciar voz'}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.08)',
                        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)',
                        color: isDark ? '#E5E7EB' : '#334155',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: 15
                      }}
                    >
                      {voiceMuted ? <VolumeX style={{ width: 17, height: 17 }} strokeWidth={2.4} /> : <Volume2 style={{ width: 17, height: 17 }} strokeWidth={2.4} />}
                    </button>
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      color: isDark ? 'rgba(248,250,252,0.62)' : 'rgba(15,23,42,0.58)',
                      fontSize: 14,
                      fontWeight: 800
                    }}
                  >
                    {eta != null ? mins(eta) : '—'} <ChevronDown style={{ width: 13, height: 13, color: C, verticalAlign: '-2px', margin: '0 5px' }} /> {remain != null ? dist(remain) : '—'}
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setBottomOpen(v => !v)}
                    title={bottomOpen ? 'Recolher painel' : 'Expandir painel'}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      border: 'none',
                      background: 'transparent',
                      color: isDark ? 'rgba(248,250,252,0.72)' : '#334155',
                      cursor: 'pointer',
                      fontSize: 22,
                      lineHeight: 1
                    }}
                  >
                    {bottomOpen ? <ChevronDown style={{ width: 18, height: 18 }} strokeWidth={2.4} /> : <ChevronUp style={{ width: 18, height: 18 }} strokeWidth={2.4} />}
                  </button>
                </div>
              </div>
            )}

            {bottomOpen && (
              <div style={{ height: 4, borderRadius: 999, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)', overflow: 'hidden', marginBottom: 12 }}>
                <motion.div
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.55 }}
                  style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #67E8F9, #2563EB)' }}
                />
              </div>
            )}

            {bottomOpen && (!nav ? (
              <div style={{ display: 'flex', gap: 10 }}>
                {isMobile && destCoords && (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => openNativeNavigation(destCoords.lat, destCoords.lon, destName, navigationMode)}
                    style={{
                      width: 56,
                      height: 54,
                      borderRadius: 18,
                      flexShrink: 0,
                      background: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                      border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.08)',
                      color: routeBlue,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer'
                    }}
                    title="Abrir no Maps"
                  >
                    <Smartphone style={{ width: 20, height: 20 }} />
                  </motion.button>
                )}

                <motion.button
                  whileHover={{ scale: 1.005 }}
                  whileTap={{ scale: 0.975 }}
                  onClick={startNav}
                  disabled={!rd}
                  style={{
                    width: '100%',
                    height: 54,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    borderRadius: 18,
                    border: isDark ? '1px solid rgba(0,213,255,0.24)' : '1px solid rgba(37,99,235,0.16)',
                    background: isDark
                      ? 'linear-gradient(135deg, rgba(0,213,255,0.10), rgba(37,99,235,0.24))'
                      : 'linear-gradient(135deg, #F8FAFC, #DBEAFE)',
                    color: isDark ? '#E0FBFF' : '#1D4ED8',
                    fontSize: 15,
                    fontWeight: 900,
                    cursor: rd ? 'pointer' : 'not-allowed',
                    opacity: rd ? 1 : 0.45,
                    boxShadow: isDark ? 'inset 0 1px 0 rgba(255,255,255,0.05)' : '0 10px 22px rgba(37,99,235,0.10)'
                  }}
                >
                  <Navigation style={{ width: 19, height: 19 }} strokeWidth={2.7} />
                  Iniciar navegação
                </motion.button>
              </div>
            ) : tracking ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <motion.button
                  whileTap={{ scale: 0.975 }}
                  onClick={pauseNav}
                  style={{
                    flex: 1,
                    height: 54,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    borderRadius: 18,
                    background: isDark ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
                    color: '#EF4444',
                    fontWeight: 900,
                    fontSize: 15,
                    border: isDark ? '1px solid rgba(239,68,68,0.24)' : '1px solid rgba(239,68,68,0.16)',
                    cursor: 'pointer'
                  }}
                >
                  <Square style={{ width: 16, height: 16 }} fill="currentColor" />
                  Pausar
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={stopNav}
                  style={{
                    width: 56,
                    height: 54,
                    borderRadius: 18,
                    background: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC',
                    border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.08)',
                    color: isDark ? 'rgba(255,255,255,0.78)' : '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                  title="Encerrar navegação"
                >
                  <RotateCcw style={{ width: 18, height: 18 }} />
                </motion.button>
              </div>
            ) : (
              <motion.button
                whileTap={{ scale: 0.975 }}
                onClick={startNav}
                style={{
                  width: '100%',
                  height: 54,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 18,
                  border: isDark ? '1px solid rgba(0,213,255,0.24)' : '1px solid rgba(37,99,235,0.16)',
                  background: isDark
                    ? 'linear-gradient(135deg, rgba(0,213,255,0.10), rgba(37,99,235,0.24))'
                    : 'linear-gradient(135deg, #F8FAFC, #DBEAFE)',
                  color: isDark ? '#E0FBFF' : '#1D4ED8',
                  fontSize: 15,
                  fontWeight: 900,
                  cursor: 'pointer'
                }}
              >
                <Play style={{ width: 16, height: 16 }} fill="currentColor" />
                Continuar rota
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalkingMapModal;