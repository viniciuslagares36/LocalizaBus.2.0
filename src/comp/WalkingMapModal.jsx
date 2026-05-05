// src/comp/WalkingMapModal.jsx
// ✅ FIX CRÍTICO: Race condition resolvida — mapa aguarda coords via Promise
// ✅ FIX: Mapa abre em pitch:45 3D com buildings Brasília (neon night style)
// ✅ FIX: Deep link mobile (geo:/maps://) + desktop 3D no modal
// ✅ FIX: AbortController em todas as fetch calls
// ✅ FIX: Validação de coords ANTES de chamar API de rota
// ✅ Estética Synthwave neon #00f3ff preservada
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Footprints, Navigation, ArrowLeft, ArrowRight,
  ArrowUp, RotateCcw, Play, Square, MapPin, Maximize2, Minimize2,
  Smartphone
} from 'lucide-react';

const KEY = 'kVt12B5jgJTHfcvXLLDSPgcX6bz4f7R1';

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

// ─── Detecta mobile ───────────────────────────────────────────────────────────
const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);

// ─── Deep Link para app nativo ────────────────────────────────────────────────
const openNativeNavigation = (destLat, destLon, destName) => {
  const label = encodeURIComponent(destName || 'Destino');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&travelmode=walking`;
  if (isIOS) {
    const apple = `maps://?daddr=${destLat},${destLon}&dirflg=w`;
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

// ─── SDK singleton GLOBAL (evita conflito com TomTomMap.jsx) ─────────────────
const loadSDK = () => {
  if (window.__ttSdkPromise) return window.__ttSdkPromise;
  window.__ttSdkPromise = new Promise((res, rej) => {
    if (window.tt) { res(window.tt); return; }
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css';
    document.head.appendChild(l);
    const s = document.createElement('script');
    s.src = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js';
    s.onload = () => res(window.tt);
    s.onerror = () => rej(new Error('Falha ao carregar TomTom SDK'));
    document.head.appendChild(s);
  });
  return window.__ttSdkPromise;
};

// ─── Validação de coords ──────────────────────────────────────────────────────
const isValidCoord = (lat, lon) =>
  typeof lat === 'number' && typeof lon === 'number' &&
  isFinite(lat) && isFinite(lon) &&
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
  !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);

// ─── API calls com AbortController ───────────────────────────────────────────
const geocode = async (addr, signal) => {
  const r = await fetch(
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(addr)}.json?key=${KEY}&countrySet=BR&limit=1`,
    { signal }
  );
  if (!r.ok) throw new Error(`Geocode HTTP ${r.status}`);
  const d = await r.json();
  const p = d.results?.[0]?.position;
  if (!p) throw new Error(`Endereço não encontrado: ${addr}`);
  if (!isValidCoord(p.lat, p.lon)) throw new Error(`Coordenadas inválidas para: ${addr}`);
  return { lat: p.lat, lon: p.lon };
};

const getRoute = async (o, d, signal) => {
  // ✅ FIX CRÍTICO: Valida coords ANTES de chamar a API
  if (!isValidCoord(o.lat, o.lon))
    throw new Error(`Origem inválida (lat=${o.lat}, lon=${o.lon}). Verifique sua localização.`);
  if (!isValidCoord(d.lat, d.lon))
    throw new Error(`Destino inválido (lat=${d.lat}, lon=${d.lon}). Verifique o endereço.`);

  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${o.lat},${o.lon}:${d.lat},${d.lon}/json` +
    `?key=${KEY}&travelMode=pedestrian&routeType=shortest&instructionsType=tagged&language=pt-BR`;

  const r = await fetch(url, { signal });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Erro ao calcular rota (HTTP ${r.status}): ${body.slice(0, 120)}`);
  }
  const data = await r.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('Nenhuma rota encontrada entre os pontos. Tente ajustar o destino.');

  const pts = route.legs[0].points.map(p => [p.longitude, p.latitude]);
  const instrs = (route.guidance?.instructions || []).map(i => ({
    msg: i.message || i.street || 'Continue em frente',
    man: i.maneuver || 'STRAIGHT',
    off: i.routeOffsetInMeters || 0,
    dist: i.travelTimeInSeconds || 0,
  }));
  return {
    pts, instrs,
    totalM: route.summary.lengthInMeters,
    totalS: route.summary.travelTimeInSeconds,
    geo: { type: 'Feature', geometry: { type: 'LineString', coordinates: pts } },
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
const WalkingMapModal = ({ route, userLocation, onClose }) => {
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

  // ✅ FIX CRÍTICO: Promise que desbloqueia fases 2 e 3 quando coords ficam prontas
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
        setLoadMsg('Localizando pontos…');

        // Origem
        let o = null;
        if (userLocation && isValidCoord(userLocation.lat, userLocation.lon)) {
          o = { lat: userLocation.lat, lon: userLocation.lon };
        } else if (route.origin) {
          o = await geocode(route.origin, signal);
        } else {
          o = { lat: -15.7934, lon: -47.8823 }; // fallback centro Brasília
        }

        // Destino
        let d = null;
        if (route.isWalk && route.destination) {
          d = { ...(await geocode(route.destination, signal)), name: route.destination };
        } else if (route.lat && route.lon && isValidCoord(route.lat, route.lon)) {
          d = { lat: route.lat, lon: route.lon, name: route.fromStop || 'Ponto de embarque' };
        } else if (route.fromStop && route.fromStop !== 'Ponto de embarque') {
          d = { ...(await geocode(route.fromStop, signal)), name: route.fromStop };
        } else if (route.destination) {
          d = { ...(await geocode(route.destination, signal)), name: route.destination };
        } else {
          d = { lat: -15.7801, lon: -47.9292, name: 'Destino' };
        }

        if (!mountedRef.current) return;
        origRef.current = o;
        destRef.current = d;
        // ✅ Desbloqueia fases 2 e 3 simultaneamente
        coordsResolve.current?.();

      } catch (e) {
        if (e.name === 'AbortError') return;
        if (mountedRef.current) { setErr(e.message); setLoading(false); }
      }
    })();

    return () => { mountedRef.current = false; abort.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── FASE 2: iniciar mapa (aguarda SDK + coords) ─────────────────────────
  useEffect(() => {
    let map = null;
    let alive = true;

    (async () => {
      try {
        // Aguarda SDK e coords em paralelo
        const [tt] = await Promise.all([loadSDK(), coordsReady.current]);
        if (!alive || !mapElRef.current) return;

        const o = origRef.current || { lat: -15.7934, lon: -47.8823 };

        map = tt.map({
          key: KEY,
          container: mapElRef.current,
          center: [o.lon, o.lat],
          zoom: 15,
          pitch: 45,   // ✅ 3D perspectiva estilo Waze
          bearing: 0,
          style: `https://api.tomtom.com/map/1/style/22.2.1-1/basic_night.json?key=${KEY}`,
          language: 'pt-BR',
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(new tt.NavigationControl({ showZoom: true, showCompass: true }), 'bottom-right');

        map.on('load', () => {
          if (!alive) return;
          // ✅ 3D Buildings Brasília
          try {
            map.addLayer({
              id: '3d-buildings', type: 'fill-extrusion',
              source: 'vectorTiles', 'source-layer': 'Building',
              paint: {
                'fill-extrusion-color': [
                  'interpolate', ['linear'], ['get', 'height'],
                  0, '#0d1117', 20, '#0f1923', 50, '#0e2040', 100, '#0a1535',
                ],
                'fill-extrusion-height': ['coalesce', ['get', 'height'], 10],
                'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.85,
              },
            });
          } catch (_) { }

          if (destRef.current) addDestPin(map, destRef.current);
          addUserPin(map, o);
          setMapReady(true);
        });
      } catch (e) {
        if (alive) { setErr(e.message || 'Falha ao carregar mapa'); setLoading(false); }
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
        // Garante coords
        await coordsReady.current;
        const o = origRef.current, d = destRef.current;
        if (!o || !d) throw new Error('Coordenadas não disponíveis.');

        const data = await getRoute(o, d, abort.signal);
        if (!mountedRef.current) return;

        rdRef.current = data;
        setRd(data);
        setRemain(data.totalM);
        if (data.instrs.length) { setCurI(data.instrs[0]); setNextI(data.instrs[1] || null); }
        setLoading(false);

        const m = mapRef.current;
        if (m) { drawRoute(m, data); fitAll(m, data.pts); }
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
      m.addLayer({
        id: 'wr-shadow', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0.3, 'line-blur': 8 }
      });
      m.addLayer({
        id: 'wr-border', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00f3ff', 'line-width': 12, 'line-opacity': 0.9 }
      });
      m.addLayer({
        id: 'wr-fill', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0051cc', 'line-width': 8, 'line-opacity': 1 }
      });
      m.addLayer({
        id: 'wr-glow', type: 'line', source: 'wr',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#fff', 'line-width': 2, 'line-opacity': 0.55 }
      });
    });
  }, []);

  const fitAll = useCallback((m, pts) => {
    if (!pts?.length) return;
    const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
    m.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 120, bottom: 220, left: 48, right: 48 }, duration: 900, pitch: 45, bearing: 0 }
    );
  }, []);

  // Marcadores ────────────────────────────────────────────────────────────────
  const addDestPin = useCallback((m, d) => {
    if (!window.tt) return;
    const el = document.createElement('div');
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="width:44px;height:44px;border-radius:50% 50% 50% 0;
          background:linear-gradient(135deg,#00f3ff,#0051cc);
          border:3px solid #fff;box-shadow:0 4px 18px rgba(0,243,255,0.65);
          transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
          <span style="transform:rotate(45deg);font-size:18px;">${route.isWalk ? '🏁' : '🚌'}</span>
        </div>
      </div>`;
    new window.tt.Marker({ element: el, anchor: 'bottom' }).setLngLat([d.lon, d.lat]).addTo(m);
  }, [route.isWalk]);

  const addUserPin = useCallback((m, pos) => {
    if (!window.tt || markerRef.current) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:36px;height:36px;';
    el.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,243,255,0.15);animation:wpu 2.2s ease-out infinite;"></div>
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,243,255,0.08);animation:wpu 2.2s ease-out 0.7s infinite;"></div>
      <div style="position:absolute;inset:6px;border-radius:50%;background:#00f3ff;border:3px solid #fff;
        box-shadow:0 2px 12px rgba(0,243,255,0.9),0 0 24px rgba(0,243,255,0.4);
        display:flex;align-items:center;justify-content:center;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M12 2L7 21l5-3.5 5 3.5z"/></svg>
      </div>
      <style>@keyframes wpu{0%{transform:scale(1);opacity:.7}100%{transform:scale(3.5);opacity:0}}</style>`;
    markerRef.current = new window.tt.Marker({ element: el, anchor: 'center' }).setLngLat([pos.lon, pos.lat]).addTo(m);
  }, []);

  // Instrução ─────────────────────────────────────────────────────────────────
  const updateInstr = useCallback((distM) => {
    const data = rdRef.current;
    if (!data?.instrs?.length) return;
    let idx = 0;
    for (let i = 0; i < data.instrs.length; i++) {
      if (data.instrs[i].off <= distM) idx = i; else break;
    }
    setCurI(data.instrs[idx]); setNextI(data.instrs[idx + 1] || null);
  }, []);

  // GPS ───────────────────────────────────────────────────────────────────────
  const onGPS = useCallback(pos => {
    const { latitude: la, longitude: lo, accuracy: ac } = pos.coords;
    setAcc(Math.round(ac));
    let b = 0;
    if (lastRef.current) b = bear(lastRef.current.lat, lastRef.current.lon, la, lo);
    lastRef.current = { lat: la, lon: lo };
    setBrng(b);
    const m = mapRef.current;
    if (m) {
      if (markerRef.current) markerRef.current.setLngLat([lo, la]);
      else addUserPin(m, { lat: la, lon: lo });
      if (!overview) m.easeTo({ center: [lo, la], zoom: 18, pitch: 60, bearing: b, duration: 700, easing: t => t });
      const rd2 = rdRef.current;
      if (rd2 && m.getSource('wr')) drawRoute(m, rd2);
    }
    const o = origRef.current, de = destRef.current, rd2 = rdRef.current;
    if (rd2 && o) {
      const cov = Math.min(hav(o.lat, o.lon, la, lo), rd2.totalM);
      const rem = Math.max(0, rd2.totalM - cov);
      setCovered(cov); setRemain(rem); updateInstr(cov);
      if (de && hav(la, lo, de.lat, de.lon) < 25) setArrived(true);
    }
  }, [overview, updateInstr, addUserPin, drawRoute]);

  // Start/Stop ────────────────────────────────────────────────────────────────
  const startNav = useCallback(async () => {
    if (!navigator.geolocation) { setErr('GPS não disponível'); return; }
    if (!document.fullscreenElement && wrapRef.current) {
      try { await wrapRef.current.requestFullscreen(); setFs(true); } catch (_) { }
    }
    setNav(true); setTracking(true); setOverview(false); setBottomOpen(false);
    t0Ref.current = Date.now() - elapsed * 1000;
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0Ref.current) / 1000)), 1000);
    watchRef.current = navigator.geolocation.watchPosition(onGPS, e => console.warn(e),
      { enableHighAccuracy: true, maximumAge: 800, timeout: 12000 });
  }, [elapsed, onGPS]);

  const pauseNav = useCallback(() => {
    setTracking(false);
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    clearInterval(timerRef.current);
    const m = mapRef.current;
    if (m) m.easeTo({ pitch: 45, bearing: 0, zoom: 15, duration: 700 });
  }, []);

  const stopNav = useCallback(() => {
    pauseNav();
    setNav(false); setElapsed(0); setCovered(0);
    setRemain(rdRef.current?.totalM ?? null);
    setArrived(false); setBrng(0); lastRef.current = null;
    const m = mapRef.current, rd2 = rdRef.current;
    if (m && rd2) { fitAll(m, rd2.pts); m.easeTo({ pitch: 45, bearing: 0, duration: 700 }); }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    setFs(false); setBottomOpen(true);
    if (rd2?.instrs?.length) { setCurI(rd2.instrs[0]); setNextI(rd2.instrs[1] || null); }
  }, [pauseNav, fitAll]);

  const toggleOverview = useCallback(() => {
    setOverview(v => {
      const next = !v;
      const m = mapRef.current;
      if (m) {
        if (next) { fitAll(m, rdRef.current?.pts); m.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
        else if (lastRef.current) m.easeTo({ center: [lastRef.current.lon, lastRef.current.lat], zoom: 18, pitch: 60, bearing: brng, duration: 700 });
      }
      return next;
    });
  }, [brng, fitAll]);

  useEffect(() => () => { pauseNav(); }, []);

  // Cálculos ──────────────────────────────────────────────────────────────────
  const pct = rd ? Math.min(100, (covered / rd.totalM) * 100) : 0;
  const eta = remain != null ? Math.round((remain / 1000) / 4.8 * 3600) : rd?.totalS ?? null;
  const destName = destRef.current?.name || route.fromStop || route.destination || 'Destino';
  const destCoords = destRef.current;

  // ─── Design tokens Synthwave ──────────────────────────────────────────────
  const C = '#00f3ff';
  const neon = {
    border: `1.5px solid rgba(0,243,255,0.5)`,
    background: 'linear-gradient(135deg,rgba(0,243,255,0.12),rgba(0,60,160,0.4))',
    boxShadow: `0 0 20px rgba(0,243,255,0.22),0 6px 20px rgba(0,0,0,0.3)`,
    color: C, fontWeight: 800, borderRadius: 18,
  };

  return (
    <div ref={wrapRef} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#050810', display: 'flex', flexDirection: 'column' }}>

      {/* ─── MAPA ─────────────────────────────────────────────────────── */}
      <div ref={mapElRef} style={{ flex: 1, width: '100%', position: 'relative', minHeight: 0 }}>

        {/* Loading spinner neon */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: '#050810', gap: 16
          }}>
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '2px solid transparent', borderTopColor: C,
                borderRightColor: 'rgba(0,243,255,0.3)',
                animation: 'spinNeon 1.2s linear infinite',
                boxShadow: `0 0 18px rgba(0,243,255,0.4)`
              }} />
              <div style={{
                position: 'absolute', inset: 8, borderRadius: '50%',
                background: 'rgba(0,243,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Footprints style={{ color: C, width: 22, height: 22 }} />
              </div>
            </div>
            <p style={{
              color: C, fontSize: 13, fontWeight: 700, letterSpacing: 1,
              textShadow: `0 0 12px rgba(0,243,255,0.6)`
            }}>{loadMsg}</p>
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>TomTom SDK · Brasília 3D</p>
            <style>{`@keyframes spinNeon{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* Erro */}
        {err && !loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', background: '#050810', gap: 12, padding: 24
          }}>
            <MapPin style={{ color: '#ff453a', width: 40, height: 40 }} />
            <p style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', maxWidth: 300 }}>{err}</p>
            <button onClick={onClose}
              style={{ marginTop: 8, padding: '12px 28px', cursor: 'pointer', border: 'none', ...neon, fontSize: 14 }}>
              Fechar
            </button>
          </div>
        )}

        {/* HUD instrução */}
        <AnimatePresence>
          {nav && !overview && curI && !arrived && (
            <motion.div key="instr"
              initial={{ y: -100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 22 }}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
                paddingTop: 'max(env(safe-area-inset-top,0px),12px)'
              }}>
              <div style={{
                margin: '0 12px',
                background: 'linear-gradient(135deg,rgba(0,243,255,0.15),rgba(0,60,150,0.6))',
                borderRadius: 20, border: '1px solid rgba(0,243,255,0.45)',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 8px 40px rgba(0,243,255,0.3)', padding: '14px 16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 14,
                    background: 'rgba(0,243,255,0.15)', border: '1px solid rgba(0,243,255,0.3)',
                    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <ManIcon type={curI.man} size={28} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      color: '#fff', fontSize: 20, fontWeight: 800, lineHeight: 1.2, margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>{curI.msg}</p>
                    {nextI && <p style={{
                      color: 'rgba(0,243,255,0.6)', fontSize: 12, margin: '4px 0 0',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      Depois: {nextI.msg}</p>}
                  </div>
                </div>
                <div style={{ marginTop: 10, height: 3, borderRadius: 99, background: 'rgba(0,243,255,0.15)', overflow: 'hidden' }}>
                  <motion.div animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }}
                    style={{ height: '100%', borderRadius: 99, background: C, boxShadow: `0 0 8px rgba(0,243,255,0.8)` }} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fechar */}
        <motion.button whileTap={{ scale: 0.88 }} onClick={nav ? stopNav : onClose}
          style={{
            position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', left: 14,
            zIndex: 30, width: 42, height: 42, borderRadius: 21,
            background: 'rgba(5,8,16,0.8)', backdropFilter: 'blur(14px)',
            border: '1px solid rgba(0,243,255,0.25)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
          }}>
          <X style={{ width: 17, height: 17 }} />
        </motion.button>

        {/* Fullscreen */}
        <motion.button whileTap={{ scale: 0.88 }} onClick={toggleFullscreen}
          style={{
            position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', right: 14,
            zIndex: 30, width: 42, height: 42, borderRadius: 21,
            background: 'rgba(5,8,16,0.8)', backdropFilter: 'blur(14px)',
            border: '1px solid rgba(0,243,255,0.25)', color: C,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
          }}>
          {fs ? <Minimize2 style={{ width: 16, height: 16 }} /> : <Maximize2 style={{ width: 16, height: 16 }} />}
        </motion.button>

        {/* Overview */}
        {nav && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={toggleOverview}
            style={{
              position: 'absolute', top: 'max(env(safe-area-inset-top,0px),14px)', right: 66,
              zIndex: 30, height: 42, padding: '0 14px', borderRadius: 21,
              background: overview ? 'rgba(0,243,255,0.18)' : 'rgba(5,8,16,0.8)',
              backdropFilter: 'blur(14px)',
              border: `1px solid ${overview ? 'rgba(0,243,255,0.6)' : 'rgba(0,243,255,0.25)'}`,
              color: overview ? C : 'rgba(255,255,255,0.7)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              boxShadow: overview ? `0 0 16px rgba(0,243,255,0.3)` : 'none'
            }}>
            {overview ? '3D ▲' : 'Visão geral'}
          </motion.button>
        )}

        {/* Badge GPS */}
        {tracking && acc != null && (
          <div style={{
            position: 'absolute', bottom: nav ? 16 : 200, left: 14, zIndex: 20,
            background: 'rgba(5,8,16,0.8)', backdropFilter: 'blur(14px)',
            border: `1px solid ${acc < 20 ? 'rgba(0,243,255,0.5)' : acc < 50 ? 'rgba(251,191,36,0.4)' : 'rgba(248,113,113,0.4)'}`,
            borderRadius: 99, padding: '4px 10px',
            color: acc < 20 ? C : acc < 50 ? '#fbbf24' : '#f87171',
            fontSize: 11, fontWeight: 700
          }}>
            GPS ±{acc}m
          </div>
        )}

        {/* Chegou */}
        <AnimatePresence>
          {arrived && (
            <motion.div key="arrived"
              initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              style={{
                position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%,-50%)',
                zIndex: 40, textAlign: 'center',
                background: 'rgba(5,8,16,0.95)', backdropFilter: 'blur(24px)',
                border: '1.5px solid rgba(0,243,255,0.45)',
                borderRadius: 24, padding: '28px 36px',
                boxShadow: '0 16px 60px rgba(0,0,0,0.7),0 0 40px rgba(0,243,255,0.15)'
              }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
              <p style={{
                color: C, fontSize: 22, fontWeight: 900, margin: 0,
                textShadow: `0 0 16px rgba(0,243,255,0.7)`
              }}>
                {route.isWalk ? 'Chegou!' : 'No ponto!'}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 6 }}>
                {dist(rd?.totalM || 0)} · {mins(elapsed)}
              </p>
              <button onClick={stopNav}
                style={{ marginTop: 16, padding: '12px 28px', cursor: 'pointer', border: 'none', ...neon, fontSize: 14 }}>
                Encerrar
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ETA flutuante */}
        {nav && !overview && remain != null && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            style={{
              position: 'absolute', bottom: 16, right: 14, zIndex: 20,
              background: 'rgba(5,8,16,0.85)', backdropFilter: 'blur(14px)',
              border: '1px solid rgba(0,243,255,0.3)',
              borderRadius: 16, padding: '10px 16px', textAlign: 'right',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5),0 0 16px rgba(0,243,255,0.1)'
            }}>
            <p style={{
              color: C, fontSize: 22, fontWeight: 900, margin: 0, lineHeight: 1,
              textShadow: `0 0 12px rgba(0,243,255,0.6)`
            }}>{dist(remain)}</p>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '3px 0 0' }}>
              {eta != null ? mins(eta) : '—'}
            </p>
          </motion.div>
        )}
      </div>

      {/* ─── PAINEL INFERIOR ──────────────────────────────────────────── */}
      <div style={{
        background: '#0a0d16', borderTop: '1px solid rgba(0,243,255,0.1)',
        flexShrink: 0, transition: 'max-height 0.3s ease',
        maxHeight: nav && !bottomOpen ? 0 : 999, overflow: nav && !bottomOpen ? 'hidden' : 'visible'
      }}>

        {nav && (
          <button onClick={() => setBottomOpen(v => !v)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'center', padding: '8px 0',
              background: 'transparent', border: 'none', cursor: 'pointer'
            }}>
            <div style={{ width: 36, height: 3, borderRadius: 99, background: 'rgba(0,243,255,0.2)' }} />
          </button>
        )}

        <div style={{ padding: nav ? '0 20px 20px' : '16px 20px 24px' }}>

          {/* Destino + distância */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
            paddingBottom: 14, borderBottom: '1px solid rgba(0,243,255,0.07)'
          }}>
            <MapPin style={{
              color: C, width: 18, height: 18, flexShrink: 0,
              filter: 'drop-shadow(0 0 6px rgba(0,243,255,0.6))'
            }} strokeWidth={2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                color: 'rgba(0,243,255,0.4)', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 1, margin: 0
              }}>Destino</p>
              <p style={{
                color: '#fff', fontSize: 14, fontWeight: 700, margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{destName}</p>
            </div>
            {remain != null && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{
                  color: C, fontSize: 20, fontWeight: 900, margin: 0, lineHeight: 1,
                  textShadow: `0 0 10px rgba(0,243,255,0.5)`
                }}>{dist(remain)}</p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: '2px 0 0' }}>
                  {eta != null ? mins(eta) : '—'}
                </p>
              </div>
            )}
          </div>

          {/* Métricas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Percorrido', val: dist(covered) },
              { label: 'Tempo', val: mins(elapsed) },
              { label: 'Precisão', val: acc != null ? `±${acc}m` : '—' },
            ].map(({ label, val }) => (
              <div key={label} style={{
                background: 'rgba(0,243,255,0.04)', borderRadius: 14,
                padding: '10px 8px', textAlign: 'center', border: '1px solid rgba(0,243,255,0.09)'
              }}>
                <p style={{ color: '#fff', fontSize: 15, fontWeight: 800, margin: 0 }}>{val}</p>
                <p style={{ color: 'rgba(0,243,255,0.4)', fontSize: 10, margin: '2px 0 0' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 600 }}>Progresso</span>
              <span style={{
                color: C, fontSize: 10, fontWeight: 800,
                textShadow: `0 0 8px rgba(0,243,255,0.5)`
              }}>{Math.round(pct)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'rgba(0,243,255,0.07)', overflow: 'hidden' }}>
              <motion.div animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }}
                style={{
                  height: '100%', borderRadius: 99,
                  background: `linear-gradient(90deg,${C},#0051cc)`,
                  boxShadow: `0 0 10px rgba(0,243,255,0.6)`
                }} />
            </div>
            {rd && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>{dist(covered)} feito</span>
                <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>{dist(rd.totalM)} total</span>
              </div>
            )}
          </div>

          {/* Botões */}
          <div style={{ display: 'flex', gap: 10 }}>
            {!nav ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* ✅ Mobile: Deep Link nativo */}
                {isMobile && destCoords && (
                  <motion.button whileTap={{ scale: 0.96 }}
                    onClick={() => openNativeNavigation(destCoords.lat, destCoords.lon, destName)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 10, padding: '14px 20px', cursor: 'pointer', border: 'none',
                      ...neon, fontSize: 14
                    }}>
                    <Smartphone style={{ width: 18, height: 18 }} />
                    Abrir no Maps (nativo)
                  </motion.button>
                )}
                {/* Desktop / Mapa 3D interno */}
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                  onClick={startNav} disabled={!rd}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 10, padding: '17px 20px', cursor: rd ? 'pointer' : 'not-allowed', border: 'none',
                    ...neon,
                    opacity: rd ? 1 : 0.35, fontSize: 16,
                    boxShadow: rd ? `0 0 28px rgba(0,243,255,0.4),0 6px 20px rgba(0,0,0,0.3)` : 'none'
                  }}>
                  <Navigation style={{ width: 20, height: 20 }} strokeWidth={2.5} />
                  {isMobile ? 'Navegar no mapa' : 'Iniciar navegação 3D'}
                </motion.button>
              </div>
            ) : tracking ? (
              <motion.button whileTap={{ scale: 0.96 }} onClick={pauseNav}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: '15px 20px', borderRadius: 18,
                  background: 'linear-gradient(135deg,rgba(255,59,48,0.25),rgba(200,20,10,0.45))',
                  color: '#ff453a', fontWeight: 800, fontSize: 15,
                  border: '1px solid rgba(255,59,48,0.4)', cursor: 'pointer',
                  boxShadow: '0 0 16px rgba(255,59,48,0.15)'
                }}>
                <Square style={{ width: 17, height: 17 }} fill="currentColor" />
                Pausar
              </motion.button>
            ) : (
              <motion.button whileTap={{ scale: 0.96 }} onClick={startNav}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: '15px 20px', cursor: 'pointer', border: 'none',
                  ...neon, fontSize: 15
                }}>
                <Play style={{ width: 17, height: 17 }} fill="currentColor" />
                Retomar
              </motion.button>
            )}

            {nav && (
              <motion.button whileTap={{ scale: 0.9 }} onClick={stopNav}
                style={{
                  width: 52, height: 52, borderRadius: 16, flexShrink: 0,
                  background: 'rgba(0,243,255,0.04)',
                  border: '1px solid rgba(0,243,255,0.13)',
                  color: 'rgba(0,243,255,0.5)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer'
                }}>
                <RotateCcw style={{ width: 18, height: 18 }} />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalkingMapModal;
