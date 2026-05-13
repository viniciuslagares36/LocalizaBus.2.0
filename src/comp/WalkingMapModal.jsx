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
  Smartphone, Car, Bike
} from 'lucide-react';
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN, TOMTOM_API_KEY, ORS_API_KEY } from "../config/apiKeys";

const MAPBOX_KEY = MAPBOX_TOKEN;
const TOMTOM_KEY = TOMTOM_API_KEY;
const ORS_KEY = ORS_API_KEY;


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
  const [arrived, setArrived] = useState(false);
  const [curI, setCurI] = useState(null);
  const [nextI, setNextI] = useState(null);
  const [fs, setFs] = useState(false);
  const [overview, setOverview] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => { setIsMobile(isMobileDevice()); }, []);

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
            zoom: 18.2,
            pitch: 52,
            bearing: b,
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
      m.addLayer({
        id: 'wr-shadow', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': isDark ? '#020617' : '#ffffff', 'line-width': 14, 'line-opacity': 0.88 }
      });
      m.addLayer({
        id: 'wr-fill', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': isDrivingMode ? '#2563eb' : '#06b6d4', 'line-width': 8, 'line-opacity': 1 }
      });
      m.addLayer({
        id: 'wr-soft-highlight', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#dbeafe', 'line-width': 2, 'line-opacity': 0.65 }
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
  const { latitude: la, longitude: lo, accuracy: ac } = pos.coords;

  setAcc(Math.round(ac));

  let b = brng;
  if (lastRef.current) {
    b = bear(lastRef.current.lat, lastRef.current.lon, la, lo);
  }

  lastRef.current = { lat: la, lon: lo };
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

    if (!overview) {
      m.easeTo({
        center: [lo, la],
        zoom: 18.4,
        pitch: 56,
        bearing: b,
        padding: { top: 80, bottom: 260, left: 0, right: 0 },
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

  // Start/Stop ────────────────────────────────────────────────────────────────
  const startNav = useCallback(async () => {
    if (!navigator.geolocation) {
      setErr('GPS não disponível neste navegador.');
      return;
    }

    setErr(null);


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
  }, [elapsed, onGPS]);

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
    setArrived(false); setBrng(0); lastRef.current = null;
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
          m.easeTo({ center: [lastRef.current.lon, lastRef.current.lat], zoom: 18.4, pitch: 56, bearing: brng, padding: { top: 80, bottom: 260, left: 0, right: 0 }, duration: 650 });
        } else if (origRef.current) {
          const o = origRef.current;
          m.easeTo({ center: [o.lon, o.lat], zoom: 18.2, pitch: 52, bearing: rdRef.current?.initialBearing || 0, duration: 650 });
        }
      }
      return next;
    });
  }, [brng, fitAll]);

  useEffect(() => () => { pauseNav(); }, []);

  // Cálculos ──────────────────────────────────────────────────────────────────
  const pct = rd ? Math.min(100, (covered / rd.totalM) * 100) : 0;
  const averageKmh = navigationMode === 'motorcycle' ? 38 : navigationMode === 'car' ? 32 : 4.8;
  const eta = remain != null ? Math.round((remain / 1000) / averageKmh * 3600) : rd?.totalS ?? null;
  const destName = destRef.current?.name || route.fromStop || route.destination || 'Destino';
  const destCoords = destRef.current;

  // ─── Design tokens premium ────────────────────────────────────────────────
  const accent = isDrivingMode ? '#0A84FF' : '#30D158';
  const accentSoft = isDrivingMode ? 'rgba(10,132,255,0.14)' : 'rgba(48,209,88,0.14)';
  const accentBorder = isDrivingMode ? 'rgba(10,132,255,0.28)' : 'rgba(48,209,88,0.28)';

  const glass = isDark
    ? 'rgba(28,28,30,0.82)'
    : 'rgba(255,255,255,0.88)';
  const glassBorder = isDark
    ? '1px solid rgba(255,255,255,0.09)'
    : '1px solid rgba(0,0,0,0.07)';
  const glassShadow = isDark
    ? '0 20px 56px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)'
    : '0 20px 48px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.8)';
  const textPrimary = isDark ? '#F5F5F7' : '#1D1D1F';
  const textSecondary = isDark ? 'rgba(245,245,247,0.55)' : 'rgba(29,29,31,0.50)';
  const wrapperBg = isDark ? '#000000' : '#F2F2F7';

  const pillBtn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 44, height: 44, borderRadius: 22,
    background: glass,
    border: glassBorder,
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    boxShadow: isDark ? '0 6px 20px rgba(0,0,0,0.45)' : '0 4px 14px rgba(0,0,0,0.10)',
    color: textPrimary, cursor: 'pointer',
  };

  const primaryBtn = {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '16px 20px',
    borderRadius: 16,
    background: accent,
    border: 'none',
    boxShadow: `0 8px 24px ${accentBorder.replace('0.28)', '0.42)')}`,
    color: '#fff', fontWeight: 700, fontSize: 16,
    letterSpacing: '-0.2px',
    cursor: 'pointer',
    fontFamily: '-apple-system, "SF Pro Display", BlinkMacSystemFont, sans-serif',
  };

  return (
    <div ref={wrapRef} style={{
      position: 'fixed', inset: 0, zIndex: 2147483647,
      background: wrapperBg, display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, "SF Pro Display", BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    }}>
      <style>{`
        @keyframes spinClean { to { transform: rotate(360deg); } }
        @keyframes pulseRing {
          0% { transform: scale(0.85); opacity: 0.6; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ─── MAPA ──────────────────────────────────────────────────────── */}
      <div ref={mapElRef} style={{ flex: 1, width: '100%', position: 'relative', minHeight: 0 }}>

        {/* Loading */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: wrapperBg, gap: 18,
          }}>
            <div style={{ position: 'relative', width: 72, height: 72 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: `2px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
              }} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '2px solid transparent',
                borderTopColor: accent,
                animation: 'spinClean 0.9s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 10, borderRadius: '50%',
                background: accentSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {navigationMode === 'car' ? (
                  <Car style={{ color: accent, width: 22, height: 22 }} />
                ) : navigationMode === 'motorcycle' ? (
                  <Bike style={{ color: accent, width: 22, height: 22 }} />
                ) : (
                  <Footprints style={{ color: accent, width: 22, height: 22 }} />
                )}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{
                color: textPrimary, fontSize: 15, fontWeight: 600,
                letterSpacing: '-0.3px', margin: 0,
              }}>{loadMsg}</p>
              <p style={{ color: textSecondary, fontSize: 12, margin: '5px 0 0' }}>
                Navegação {modeLabel}
              </p>
            </div>
          </div>
        )}

        {/* Erro */}
        {err && !loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: wrapperBg, gap: 14, padding: 28,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 32,
              background: isDark ? 'rgba(255,69,58,0.12)' : '#FFF2F1',
              border: '1px solid rgba(255,69,58,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MapPin style={{ color: '#FF453A', width: 28, height: 28 }} />
            </div>
            <p style={{
              color: textPrimary, fontSize: 15, fontWeight: 600,
              textAlign: 'center', maxWidth: 280, margin: 0, lineHeight: 1.45,
            }}>{err}</p>
            <motion.button whileTap={{ scale: 0.96 }} onClick={onClose}
              style={{
                marginTop: 4, padding: '13px 28px',
                borderRadius: 14, border: 'none',
                background: accent, color: '#fff',
                fontWeight: 600, fontSize: 15, cursor: 'pointer',
                boxShadow: `0 6px 18px ${accentBorder.replace('0.28)', '0.38)')}`,
                fontFamily: 'inherit',
              }}>
              Fechar
            </motion.button>
          </div>
        )}

        {/* HUD instrução */}
        <AnimatePresence>
          {nav && !overview && curI && !arrived && (
            <motion.div
              key="instr"
              initial={{ y: -80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
                padding: 'max(env(safe-area-inset-top,0px),14px) 14px 0',
                pointerEvents: 'none',
              }}
            >
              <div style={{
                maxWidth: 860, margin: '0 auto',
                background: glass,
                border: glassBorder,
                borderRadius: 22,
                backdropFilter: 'blur(28px) saturate(180%)',
                WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                boxShadow: glassShadow,
                overflow: 'hidden',
                pointerEvents: 'auto',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px 14px' }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 16,
                    background: accent,
                    boxShadow: `0 8px 20px ${accentBorder.replace('0.28)', '0.40)')}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <ManIcon type={curI.man} size={26} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      color: textPrimary, fontSize: 21, fontWeight: 700,
                      lineHeight: 1.1, letterSpacing: '-0.5px', margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {curI.msg}
                    </p>
                    {nextI && (
                      <p style={{
                        color: textSecondary, fontSize: 13, fontWeight: 500,
                        margin: '5px 0 0',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        Em seguida: {nextI.msg}
                      </p>
                    )}
                  </div>
                  <button onClick={toggleOverview} style={{
                    height: 34, padding: '0 13px', borderRadius: 999,
                    border: glassBorder,
                    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                    backdropFilter: 'blur(12px)',
                    color: textSecondary, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}>
                    Visão geral
                  </button>
                </div>
                {/* Progress bar */}
                <div style={{ height: 2, background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                  <motion.div
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6 }}
                    style={{ height: '100%', background: accent }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Botão fechar */}
        <motion.button whileTap={{ scale: 0.88 }} onClick={nav ? stopNav : onClose}
          style={{
            ...pillBtn,
            position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', left: 14, zIndex: 30,
          }}>
          <X style={{ width: 16, height: 16 }} strokeWidth={2.5} />
        </motion.button>

        {/* Botão fullscreen */}
        <motion.button whileTap={{ scale: 0.88 }} onClick={toggleFullscreen}
          style={{
            ...pillBtn,
            position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', right: 14, zIndex: 30,
            color: accent,
          }}>
          {fs ? <Minimize2 style={{ width: 16, height: 16 }} /> : <Maximize2 style={{ width: 16, height: 16 }} />}
        </motion.button>

        {/* Badge GPS */}
        {tracking && acc != null && (
          <div style={{
            position: 'absolute', bottom: nav ? 16 : 200, left: 14, zIndex: 20,
            background: glass,
            backdropFilter: 'blur(16px)',
            border: `1px solid ${acc < 20 ? accentBorder : acc < 50 ? 'rgba(255,159,10,0.32)' : 'rgba(255,69,58,0.32)'}`,
            borderRadius: 20, padding: '5px 12px',
            color: acc < 20 ? accent : acc < 50 ? '#FF9F0A' : '#FF453A',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.1px',
          }}>
            GPS ±{acc}m
          </div>
        )}

        {/* Chegou */}
        <AnimatePresence>
          {arrived && (
            <motion.div key="arrived"
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              style={{
                position: 'absolute', top: '35%', left: '50%',
                transform: 'translate(-50%,-50%)',
                zIndex: 40, textAlign: 'center',
                background: glass,
                backdropFilter: 'blur(32px) saturate(180%)',
                WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                border: glassBorder,
                borderRadius: 28, padding: '32px 40px',
                boxShadow: glassShadow,
                minWidth: 220,
              }}>
              <div style={{
                width: 64, height: 64, borderRadius: 32,
                background: isDark ? 'rgba(48,209,88,0.12)' : '#F0FBF2',
                border: '1px solid rgba(48,209,88,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
                fontSize: 32,
              }}>🏁</div>
              <p style={{
                color: textPrimary, fontSize: 20, fontWeight: 700,
                letterSpacing: '-0.4px', margin: 0,
              }}>
                {route.isWalk ? 'Chegou!' : 'Destino alcançado!'}
              </p>
              <p style={{ color: textSecondary, fontSize: 13, marginTop: 6, marginBottom: 0 }}>
                {dist(rd?.totalM || 0)} · {mins(elapsed)}
              </p>
              <motion.button whileTap={{ scale: 0.96 }} onClick={stopNav}
                style={{
                  marginTop: 18, padding: '12px 28px',
                  borderRadius: 14, border: 'none',
                  background: accent, color: '#fff',
                  fontWeight: 600, fontSize: 15, cursor: 'pointer',
                  boxShadow: `0 6px 18px ${accentBorder.replace('0.28)', '0.38)')}`,
                  fontFamily: 'inherit',
                }}>
                Encerrar
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ETA flutuante */}
        {nav && !overview && remain != null && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            style={{
              position: 'absolute', bottom: 16, right: 14, zIndex: 20,
              background: glass,
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: glassBorder,
              borderRadius: 18, padding: '11px 17px', textAlign: 'right',
              boxShadow: isDark ? '0 8px 28px rgba(0,0,0,0.4)' : '0 6px 22px rgba(0,0,0,0.09)',
            }}>
            <p style={{
              color: accent, fontSize: 22, fontWeight: 700,
              letterSpacing: '-0.5px', margin: 0, lineHeight: 1,
            }}>{dist(remain)}</p>
            <p style={{ color: textSecondary, fontSize: 11, fontWeight: 500, margin: '4px 0 0' }}>
              {eta != null ? mins(eta) : '—'}
            </p>
          </motion.div>
        )}
      </div>

      {/* ─── PAINEL INFERIOR ─────────────────────────────────────────── */}
      <div style={{
        background: glass,
        borderTop: glassBorder,
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        flexShrink: 0,
        transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
        maxHeight: nav && !bottomOpen ? 0 : 300,
        opacity: nav && !bottomOpen ? 0 : 1,
        overflow: 'hidden',
        boxShadow: isDark
          ? 'inset 0 1px 0 rgba(255,255,255,0.07)'
          : 'inset 0 1px 0 rgba(255,255,255,0.9)',
      }}>
        {/* Sheet handle */}
        {nav && (
          <button onClick={() => setBottomOpen(v => !v)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'center',
              padding: '10px 0 6px', background: 'transparent', border: 'none', cursor: 'pointer',
            }}>
            <div style={{
              width: 36, height: 4, borderRadius: 99,
              background: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.12)',
            }} />
          </button>
        )}

        <div style={{ padding: nav ? '4px 18px 28px' : '18px 18px 28px' }}>
          {/* Linha destino + distância */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 14,
              background: accentSoft,
              border: `1px solid ${accentBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <MapPin style={{ color: accent, width: 18, height: 18 }} strokeWidth={2.2} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                color: textSecondary, fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 1.2, margin: 0,
              }}>Destino</p>
              <p style={{
                color: textPrimary, fontSize: 15, fontWeight: 600,
                letterSpacing: '-0.3px', margin: '3px 0 0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{destName}</p>
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{
                color: accent, fontSize: 24, fontWeight: 700,
                letterSpacing: '-0.8px', margin: 0, lineHeight: 1,
              }}>
                {remain != null ? dist(remain) : '—'}
              </p>
              <p style={{ color: textSecondary, fontSize: 12, margin: '3px 0 0', fontWeight: 500 }}>
                {eta != null ? mins(eta) : '—'}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            height: 4, borderRadius: 99,
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            overflow: 'hidden', marginBottom: 16,
          }}>
            <motion.div animate={{ width: `${pct}%` }} transition={{ duration: 0.55 }}
              style={{ height: '100%', borderRadius: 99, background: accent }} />
          </div>

          {/* Botões */}
          <div style={{ display: 'flex', gap: 10 }}>
            {!nav ? (
              <>
                {isMobile && destCoords && (
                  <motion.button whileTap={{ scale: 0.94 }}
                    onClick={() => openNativeNavigation(destCoords.lat, destCoords.lon, destName, navigationMode)}
                    style={{
                      width: 56, height: 54, borderRadius: 16, flexShrink: 0,
                      background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      border: glassBorder,
                      color: accent,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }} title="Abrir no Maps">
                    <Smartphone style={{ width: 20, height: 20 }} />
                  </motion.button>
                )}
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={startNav} disabled={!rd}
                  style={{ ...primaryBtn, opacity: rd ? 1 : 0.4, cursor: rd ? 'pointer' : 'not-allowed' }}>
                  <Navigation style={{ width: 18, height: 18 }} strokeWidth={2.5} />
                  Iniciar navegação
                </motion.button>
              </>
            ) : tracking ? (
              <motion.button whileTap={{ scale: 0.97 }} onClick={pauseNav}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: '15px 20px', borderRadius: 16,
                  background: isDark ? 'rgba(255,69,58,0.12)' : '#FFF2F1',
                  color: '#FF453A', fontWeight: 600, fontSize: 15,
                  border: '1px solid rgba(255,69,58,0.20)', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                <Square style={{ width: 15, height: 15 }} fill="currentColor" />
                Pausar
              </motion.button>
            ) : (
              <motion.button whileTap={{ scale: 0.97 }} onClick={startNav}
                style={{ ...primaryBtn }}>
                <Play style={{ width: 16, height: 16 }} fill="currentColor" />
                Retomar
              </motion.button>
            )}

            {nav && (
              <motion.button whileTap={{ scale: 0.92 }} onClick={stopNav}
                style={{
                  width: 54, height: 54, borderRadius: 16, flexShrink: 0,
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  border: glassBorder,
                  color: textSecondary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }} title="Encerrar navegação">
                <RotateCcw style={{ width: 17, height: 17 }} />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalkingMapModal;