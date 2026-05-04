// src/comp/WalkingMapModal.jsx — Navegação tela cheia estilo Waze/TomTom
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Footprints, Navigation, ArrowLeft, ArrowRight,
  ArrowUp, RotateCcw, Play, Square, MapPin, Maximize2, Minimize2,
  ChevronUp, ChevronDown
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

const ManIcon = ({ type, size = 10 }) => {
  const t = (type || '').toLowerCase();
  const cls = `text-white`, w = size, h = size;
  if (t.includes('left'))  return <ArrowLeft  className={cls} width={w} height={h} strokeWidth={3}/>;
  if (t.includes('right')) return <ArrowRight className={cls} width={w} height={h} strokeWidth={3}/>;
  if (t.includes('uturn')) return <RotateCcw  className={cls} width={w} height={h} strokeWidth={3}/>;
  return <ArrowUp className={cls} width={w} height={h} strokeWidth={3}/>;
};

// ─── SDK loader ───────────────────────────────────────────────────────────────
let _sdk = null;
const loadSDK = () => {
  if (_sdk) return _sdk;
  _sdk = new Promise((res, rej) => {
    if (window.tt) { res(window.tt); return; }
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css';
    document.head.appendChild(l);
    const s = document.createElement('script');
    s.src = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js';
    s.onload = () => res(window.tt);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return _sdk;
};

// ─── API calls ────────────────────────────────────────────────────────────────
const geocode = async addr => {
  const r = await fetch(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(addr)}.json?key=${KEY}&countrySet=BR&limit=1`);
  const d = await r.json();
  const p = d.results?.[0]?.position;
  if (!p) throw new Error(`Não achei: ${addr}`);
  return { lat: p.lat, lon: p.lon };
};

const getRoute = async (o, d) => {
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${o.lat},${o.lon}:${d.lat},${d.lon}/json`
    + `?key=${KEY}&travelMode=pedestrian&routeType=shortest&instructionsType=tagged&language=pt-BR`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Erro ao calcular rota');
  const data = await r.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('Rota não encontrada');
  const pts = route.legs[0].points.map(p => [p.longitude, p.latitude]);
  const instrs = (route.guidance?.instructions || []).map(i => ({
    msg:  i.message || i.street || 'Continue em frente',
    man:  i.maneuver || 'STRAIGHT',
    off:  i.routeOffsetInMeters || 0,
    dist: i.travelTimeInSeconds || 0,
  }));
  return {
    pts, instrs,
    totalM: route.summary.lengthInMeters,
    totalS: route.summary.travelTimeInSeconds,
    geo: { type: 'Feature', geometry: { type: 'LineString', coordinates: pts } },
  };
};

// ─── Componente principal ─────────────────────────────────────────────────────
const WalkingMapModal = ({ route, userLocation, onClose }) => {
  const wrapRef     = useRef(null);   // div raiz (fullscreen target)
  const mapRef      = useRef(null);   // instância do mapa TomTom
  const mapElRef    = useRef(null);   // elemento DOM do mapa
  const markerRef   = useRef(null);   // marcador do usuário
  const watchRef    = useRef(null);   // watchPosition id
  const timerRef    = useRef(null);   // setInterval
  const t0Ref       = useRef(null);   // timestamp start
  const lastRef     = useRef(null);   // última posição GPS
  const rdRef       = useRef(null);   // routeData ref (sem re-render)
  const origRef     = useRef(null);
  const destRef     = useRef(null);

  const [sdk,      setSdk]      = useState(false);
  const [rd,       setRd]       = useState(null);
  const [err,      setErr]      = useState(null);
  const [loading,  setLoading]  = useState(true);

  // GPS / nav state
  const [nav,      setNav]      = useState(false);   // navegação ativa
  const [tracking, setTracking] = useState(false);
  const [brng,     setBrng]     = useState(0);
  const [elapsed,  setElapsed]  = useState(0);
  const [covered,  setCovered]  = useState(0);
  const [remain,   setRemain]   = useState(null);
  const [acc,      setAcc]      = useState(null);
  const [arrived,  setArrived]  = useState(false);
  const [curI,     setCurI]     = useState(null);
  const [nextI,    setNextI]    = useState(null);

  // UI state
  const [fs,       setFs]       = useState(false);   // fullscreen ativo
  const [overview, setOverview] = useState(false);   // visão de cima
  const [bottomOpen, setBottomOpen] = useState(true);

  // ── Fullscreen API ──────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await wrapRef.current?.requestFullscreen();
        setFs(true);
      } else {
        await document.exitFullscreen();
        setFs(false);
      }
    } catch (_) { setFs(false); }
  }, []);

  useEffect(() => {
    const handler = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Resolver coords ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        let o = userLocation;
        if (!o && route.origin) o = await geocode(route.origin);
        if (!o) o = { lat: -15.7934, lon: -47.8823 };

        let d;
        if (route.isWalk && route.destination) {
          d = { ...(await geocode(route.destination)), name: route.destination };
        } else if (route.lat && route.lon) {
          d = { lat: route.lat, lon: route.lon, name: route.fromStop || 'Ponto de embarque' };
        } else if (route.fromStop && route.fromStop !== 'Ponto de embarque') {
          d = { ...(await geocode(route.fromStop)), name: route.fromStop };
        } else if (route.destination) {
          d = { ...(await geocode(route.destination)), name: route.destination };
        } else {
          d = { lat: -15.7801, lon: -47.9292, name: 'Destino' };
        }
        origRef.current = o;
        destRef.current = d;
      } catch (e) { setErr(e.message); setLoading(false); }
    })();
  }, []);

  // ── SDK ─────────────────────────────────────────────────────────────────────
  useEffect(() => { loadSDK().then(() => setSdk(true)).catch(e => setErr(e.message)); }, []);

  // ── Iniciar mapa ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sdk || !mapElRef.current || mapRef.current || !origRef.current) return;
    const o = origRef.current;
    const map = window.tt.map({
      key: KEY,
      container: mapElRef.current,
      center: [o.lon, o.lat],
      zoom: 15,
      style: `https://api.tomtom.com/map/1/style/22.2.1-1/basic_main.json?key=${KEY}`,
      language: 'pt-BR',
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      if (destRef.current) addDestPin(map, destRef.current);
      addUserPin(map, o);
    });
    return () => { try { map.remove(); } catch(_){} mapRef.current = null; };
  }, [sdk]);

  // ── Buscar rota ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!origRef.current || !destRef.current) return;
    const run = async () => {
      try {
        const data = await getRoute(origRef.current, destRef.current);
        rdRef.current = data;
        setRd(data);
        setRemain(data.totalM);
        if (data.instrs.length) { setCurI(data.instrs[0]); setNextI(data.instrs[1] || null); }
        setLoading(false);
        const m = mapRef.current;
        if (m?.loaded()) { drawRoute(m, data); fitAll(m, data.pts); }
        else m?.on('load', () => { drawRoute(m, data); fitAll(m, data.pts); });
      } catch (e) { setErr(e.message); setLoading(false); }
    };
    // espera coords estarem prontas
    const wait = setInterval(() => {
      if (origRef.current && destRef.current) { clearInterval(wait); run(); }
    }, 200);
    return () => clearInterval(wait);
  }, [sdk]);

  // ── Desenhar rota (Waze: borda escura + fill azul + brilho) ─────────────────
  const drawRoute = (m, data) => {
    if (!m || !data) return;
    const safe = fn => { try { fn(); } catch(_){} };
    safe(() => {
      if (m.getSource('wr')) { m.getSource('wr').setData(data.geo); return; }
      m.addSource('wr', { type: 'geojson', data: data.geo });
      // Sombra preta
      m.addLayer({ id:'wr-shadow', type:'line', source:'wr',
        layout:{ 'line-join':'round','line-cap':'round' },
        paint:{ 'line-color':'#000000','line-width':14,'line-opacity':0.25,'line-blur':4 }});
      // Borda azul escuro
      m.addLayer({ id:'wr-border', type:'line', source:'wr',
        layout:{ 'line-join':'round','line-cap':'round' },
        paint:{ 'line-color':'#0040a8','line-width':10,'line-opacity':1 }});
      // Fill principal
      m.addLayer({ id:'wr-fill', type:'line', source:'wr',
        layout:{ 'line-join':'round','line-cap':'round' },
        paint:{ 'line-color':'#1a6eff','line-width':7,'line-opacity':1 }});
      // Destaque central
      m.addLayer({ id:'wr-glow', type:'line', source:'wr',
        layout:{ 'line-join':'round','line-cap':'round' },
        paint:{ 'line-color':'#7ab4ff','line-width':3,'line-opacity':0.7 }});
    });
  };

  const fitAll = (m, pts) => {
    if (!pts?.length) return;
    const lons = pts.map(p=>p[0]), lats = pts.map(p=>p[1]);
    m.fitBounds(
      [[Math.min(...lons),Math.min(...lats)],[Math.max(...lons),Math.max(...lats)]],
      { padding:{top:120,bottom:220,left:48,right:48}, duration:900, pitch:0, bearing:0 }
    );
  };

  // ── Marcadores ──────────────────────────────────────────────────────────────
  const addDestPin = (m, d) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="width:44px;height:44px;border-radius:50% 50% 50% 0;background:linear-gradient(135deg,#1a6eff,#0040a8);
          border:3px solid #fff;box-shadow:0 4px 18px rgba(26,110,255,0.55);
          transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
          <span style="transform:rotate(45deg);font-size:18px;">${route.isWalk ? '🏁' : '🚌'}</span>
        </div>
      </div>`;
    new window.tt.Marker({ element: el, anchor:'bottom' }).setLngLat([d.lon, d.lat]).addTo(m);
  };

  const addUserPin = (m, pos) => {
    if (markerRef.current) { markerRef.current.setLngLat([pos.lon, pos.lat]); return; }
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:36px;height:36px;';
    el.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:50%;
        background:rgba(26,110,255,0.15);animation:wpu 2.2s ease-out infinite;"></div>
      <div style="position:absolute;inset:0;border-radius:50%;
        background:rgba(26,110,255,0.08);animation:wpu 2.2s ease-out 0.7s infinite;"></div>
      <div style="position:absolute;inset:6px;border-radius:50%;
        background:#1a6eff;border:3px solid #fff;
        box-shadow:0 2px 12px rgba(26,110,255,0.8);
        display:flex;align-items:center;justify-content:center;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
          <path d="M12 2L7 21l5-3.5 5 3.5z"/>
        </svg>
      </div>
      <style>
        @keyframes wpu{0%{transform:scale(1);opacity:.7}100%{transform:scale(3.5);opacity:0}}
      </style>`;
    markerRef.current = new window.tt.Marker({ element: el, anchor:'center' })
      .setLngLat([pos.lon, pos.lat]).addTo(m);
  };

  // ── Instrução atual ─────────────────────────────────────────────────────────
  const updateInstr = useCallback((distM) => {
    const data = rdRef.current;
    if (!data?.instrs?.length) return;
    let idx = 0;
    for (let i = 0; i < data.instrs.length; i++) {
      if (data.instrs[i].off <= distM) idx = i; else break;
    }
    setCurI(data.instrs[idx]);
    setNextI(data.instrs[idx + 1] || null);
  }, []);

  // ── Atualizar posição GPS ───────────────────────────────────────────────────
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

      if (!overview) {
        m.easeTo({ center:[lo,la], zoom:18, pitch:60, bearing:b, duration:700, easing:t=>t });
      }
      const rd2 = rdRef.current;
      if (rd2 && m.getSource('wr')) drawRoute(m, rd2);
    }

    const o = origRef.current, de = destRef.current, rd2 = rdRef.current;
    if (rd2 && o) {
      const cov = Math.min(hav(o.lat, o.lon, la, lo), rd2.totalM);
      const rem = Math.max(0, rd2.totalM - cov);
      setCovered(cov);
      setRemain(rem);
      updateInstr(cov);
      if (de && hav(la, lo, de.lat, de.lon) < 25) setArrived(true);
    }
  }, [overview, updateInstr]);

  // ── Start / Stop ────────────────────────────────────────────────────────────
  const startNav = useCallback(async () => {
    if (!navigator.geolocation) { setErr('GPS não disponível'); return; }
    // Entra em tela cheia automaticamente
    if (!document.fullscreenElement && wrapRef.current) {
      try { await wrapRef.current.requestFullscreen(); setFs(true); } catch(_){}
    }
    setNav(true);
    setTracking(true);
    setOverview(false);
    setBottomOpen(false); // colapsa painel inferior no modo nav
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
    if (m) m.easeTo({ pitch: 0, bearing: 0, zoom: 15, duration: 700 });
  }, []);

  const stopNav = useCallback(() => {
    pauseNav();
    setNav(false);
    setElapsed(0); setCovered(0);
    setRemain(rdRef.current?.totalM ?? null);
    setArrived(false); setBrng(0); lastRef.current = null;
    const m = mapRef.current;
    const rd2 = rdRef.current;
    if (m && rd2) { fitAll(m, rd2.pts); m.easeTo({ pitch:0, bearing:0, duration:700 }); }
    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    setFs(false);
    setBottomOpen(true);
    if (rd2?.instrs?.length) { setCurI(rd2.instrs[0]); setNextI(rd2.instrs[1]||null); }
  }, [pauseNav]);

  const toggleOverview = useCallback(() => {
    setOverview(v => {
      const next = !v;
      const m = mapRef.current;
      if (m) {
        if (next) { fitAll(m, rdRef.current?.pts); m.easeTo({ pitch:0, bearing:0, duration:700 }); }
        else if (lastRef.current) m.easeTo({ center:[lastRef.current.lon,lastRef.current.lat], zoom:18, pitch:60, bearing:brng, duration:700 });
      }
      return next;
    });
  }, [brng]);

  useEffect(() => () => { pauseNav(); }, []);

  // ── Cálculos ────────────────────────────────────────────────────────────────
  const pct = rd ? Math.min(100, (covered / rd.totalM) * 100) : 0;
  const eta = remain != null ? Math.round((remain / 1000) / 4.8 * 3600) : rd?.totalS ?? null;
  const destName = destRef.current?.name || route.fromStop || route.destination || 'Destino';

  return (
    <div ref={wrapRef} style={{ position:'fixed',inset:0,zIndex:9999,background:'#0c0f17',display:'flex',flexDirection:'column' }}>

      {/* ═══════════════ MAPA (ocupa tudo) ═══════════════ */}
      <div ref={mapElRef} style={{ flex:1,width:'100%',position:'relative',minHeight:0 }}>

        {/* Loading */}
        {loading && (
          <div style={{ position:'absolute',inset:0,zIndex:10,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#0c0f17',gap:16 }}>
            <div style={{ position:'relative',width:56,height:56 }}>
              <div style={{ position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(26,110,255,0.25)',animation:'spin2 1.4s linear infinite' }}/>
              <div style={{ position:'absolute',inset:6,borderRadius:'50%',background:'rgba(26,110,255,0.12)',display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Footprints style={{ color:'#1a6eff',width:22,height:22 }}/>
              </div>
            </div>
            <p style={{ color:'rgba(255,255,255,0.5)',fontSize:13,fontWeight:500 }}>Calculando rota…</p>
            <style>{`@keyframes spin2{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* Erro */}
        {err && !loading && (
          <div style={{ position:'absolute',inset:0,zIndex:10,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#0c0f17',gap:12,padding:24 }}>
            <MapPin style={{ color:'#ff3b30',width:36,height:36 }}/>
            <p style={{ color:'#ff6b6b',fontSize:13,textAlign:'center' }}>{err}</p>
            <button onClick={onClose} style={{ marginTop:8,padding:'10px 24px',borderRadius:12,background:'#1a6eff',color:'#fff',fontWeight:700,fontSize:13,border:'none',cursor:'pointer' }}>Fechar</button>
          </div>
        )}

        {/* ── HUD topo: instrução ── */}
        <AnimatePresence>
          {nav && !overview && curI && !arrived && (
            <motion.div key="instr"
              initial={{ y: -100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -100, opacity: 0 }}
              transition={{ type:'spring', stiffness:200, damping:22 }}
              style={{
                position:'absolute', top:0, left:0, right:0, zIndex:20,
                paddingTop:'max(env(safe-area-inset-top,0px), 12px)',
              }}>
              <div style={{
                margin:'0 12px',
                background:'linear-gradient(135deg,#1a6eff,#0051cc)',
                borderRadius:20,
                boxShadow:'0 8px 40px rgba(26,110,255,0.5)',
                padding:'14px 16px',
              }}>
                <div style={{ display:'flex',alignItems:'center',gap:14 }}>
                  {/* Ícone manobra */}
                  <div style={{ width:56,height:56,borderRadius:14,background:'rgba(255,255,255,0.18)',
                    flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center' }}>
                    <ManIcon type={curI.man} size={28}/>
                  </div>
                  {/* Textos */}
                  <div style={{ flex:1,minWidth:0 }}>
                    <p style={{ color:'#fff',fontSize:20,fontWeight:800,lineHeight:1.2,margin:0,
                      overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                      {curI.msg}
                    </p>
                    {nextI && (
                      <p style={{ color:'rgba(255,255,255,0.65)',fontSize:12,margin:'4px 0 0',
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                        Depois: {nextI.msg}
                      </p>
                    )}
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ marginTop:10,height:3,borderRadius:99,background:'rgba(255,255,255,0.2)',overflow:'hidden' }}>
                  <motion.div animate={{ width:`${pct}%` }} transition={{ duration:0.6 }}
                    style={{ height:'100%',borderRadius:99,background:'rgba(255,255,255,0.9)' }}/>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Botão X fechar ── */}
        <motion.button whileTap={{ scale:0.88 }} onClick={nav ? stopNav : onClose}
          style={{
            position:'absolute', top:'max(env(safe-area-inset-top,0px),14px)', left:14,
            zIndex:30, width:42, height:42, borderRadius:21,
            background:'rgba(12,15,23,0.72)', backdropFilter:'blur(14px)',
            border:'1px solid rgba(255,255,255,0.14)', color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            boxShadow:'0 4px 16px rgba(0,0,0,0.4)',
          }}>
          <X style={{ width:17, height:17 }}/>
        </motion.button>

        {/* ── Botão fullscreen ── */}
        <motion.button whileTap={{ scale:0.88 }} onClick={toggleFullscreen}
          style={{
            position:'absolute', top:'max(env(safe-area-inset-top,0px),14px)', right:14,
            zIndex:30, width:42, height:42, borderRadius:21,
            background:'rgba(12,15,23,0.72)', backdropFilter:'blur(14px)',
            border:'1px solid rgba(255,255,255,0.14)', color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            boxShadow:'0 4px 16px rgba(0,0,0,0.4)',
          }}>
          {fs ? <Minimize2 style={{width:16,height:16}}/> : <Maximize2 style={{width:16,height:16}}/>}
        </motion.button>

        {/* ── Botão visão geral (só quando nav ativa) ── */}
        {nav && (
          <motion.button whileTap={{ scale:0.9 }} onClick={toggleOverview}
            style={{
              position:'absolute', top:'max(env(safe-area-inset-top,0px),14px)', right:66,
              zIndex:30, height:42, padding:'0 14px', borderRadius:21,
              background: overview ? '#1a6eff' : 'rgba(12,15,23,0.72)',
              backdropFilter:'blur(14px)',
              border:`1px solid ${overview ? '#1a6eff' : 'rgba(255,255,255,0.14)'}`,
              color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer',
              boxShadow:'0 4px 16px rgba(0,0,0,0.4)',
            }}>
            {overview ? '3D' : 'Visão geral'}
          </motion.button>
        )}

        {/* ── Badge GPS (canto inferior esquerdo do mapa) ── */}
        {tracking && acc != null && (
          <div style={{
            position:'absolute', bottom: nav ? 16 : 200, left:14, zIndex:20,
            background:'rgba(12,15,23,0.72)', backdropFilter:'blur(14px)',
            border:`1px solid ${acc<20?'rgba(52,211,153,0.4)':acc<50?'rgba(251,191,36,0.4)':'rgba(248,113,113,0.4)'}`,
            borderRadius:99, padding:'4px 10px',
            color: acc<20?'#34d399':acc<50?'#fbbf24':'#f87171',
            fontSize:11, fontWeight:700,
          }}>
            GPS ±{acc}m
          </div>
        )}

        {/* ── Chegou! ── */}
        <AnimatePresence>
          {arrived && (
            <motion.div key="arrived"
              initial={{ scale:0.7, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ opacity:0 }}
              style={{
                position:'absolute', top:'35%', left:'50%', transform:'translate(-50%,-50%)',
                zIndex:40, textAlign:'center',
                background:'rgba(12,15,23,0.92)', backdropFilter:'blur(20px)',
                border:'1px solid rgba(255,255,255,0.15)',
                borderRadius:24, padding:'28px 36px',
                boxShadow:'0 16px 60px rgba(0,0,0,0.6)',
              }}>
              <div style={{ fontSize:48, marginBottom:8 }}>🎉</div>
              <p style={{ color:'#fff', fontSize:22, fontWeight:900, margin:0 }}>
                {route.isWalk ? 'Chegou!' : 'No ponto!'}
              </p>
              <p style={{ color:'rgba(255,255,255,0.5)', fontSize:13, marginTop:6 }}>
                {dist(rd?.totalM||0)} · {mins(elapsed)}
              </p>
              <button onClick={stopNav}
                style={{ marginTop:16, padding:'10px 28px', borderRadius:12,
                  background:'#1a6eff', color:'#fff', fontWeight:700, fontSize:14,
                  border:'none', cursor:'pointer' }}>
                Encerrar
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── ETA flutuante (durante navegação, canto inferior direito) ── */}
        {nav && !overview && remain != null && (
          <motion.div
            initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }}
            style={{
              position:'absolute', bottom:16, right:14, zIndex:20,
              background:'rgba(12,15,23,0.82)', backdropFilter:'blur(14px)',
              border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:16, padding:'10px 16px', textAlign:'right',
              boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
            }}>
            <p style={{ color:'#1a6eff', fontSize:22, fontWeight:900, margin:0, lineHeight:1 }}>
              {dist(remain)}
            </p>
            <p style={{ color:'rgba(255,255,255,0.45)', fontSize:11, margin:'3px 0 0' }}>
              {eta!=null ? mins(eta) : '—'}
            </p>
          </motion.div>
        )}
      </div>

      {/* ═══════════════ PAINEL INFERIOR ═══════════════ */}
      <div style={{
        background:'#111827',
        borderTop:'1px solid rgba(255,255,255,0.08)',
        flexShrink:0,
        transition:'max-height 0.3s ease',
        maxHeight: nav && !bottomOpen ? 0 : 999,
        overflow: nav && !bottomOpen ? 'hidden' : 'visible',
      }}>
        {/* Handle para colapsar */}
        {nav && (
          <button onClick={() => setBottomOpen(v=>!v)}
            style={{ width:'100%',display:'flex',justifyContent:'center',padding:'8px 0',
              background:'transparent',border:'none',cursor:'pointer' }}>
            <div style={{ width:36,height:3,borderRadius:99,background:'rgba(255,255,255,0.2)' }}/>
          </button>
        )}

        <div style={{ padding: nav ? '0 20px 20px' : '16px 20px 24px' }}>
          {/* Destino + distância */}
          <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:16,
            paddingBottom:14, borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
            <MapPin style={{ color:'#1a6eff',width:18,height:18,flexShrink:0 }} strokeWidth={2}/>
            <div style={{ flex:1,minWidth:0 }}>
              <p style={{ color:'rgba(255,255,255,0.38)',fontSize:10,fontWeight:700,
                textTransform:'uppercase',letterSpacing:1,margin:0 }}>Destino</p>
              <p style={{ color:'#fff',fontSize:14,fontWeight:700,margin:0,
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{destName}</p>
            </div>
            {remain != null && (
              <div style={{ textAlign:'right',flexShrink:0 }}>
                <p style={{ color:'#1a6eff',fontSize:20,fontWeight:900,margin:0,lineHeight:1 }}>{dist(remain)}</p>
                <p style={{ color:'rgba(255,255,255,0.35)',fontSize:11,margin:'2px 0 0' }}>{eta!=null?mins(eta):'—'}</p>
              </div>
            )}
          </div>

          {/* Métricas */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16 }}>
            {[
              { label:'Percorrido', val: dist(covered) },
              { label:'Tempo',      val: mins(elapsed) },
              { label:'Precisão',   val: acc!=null?`±${acc}m`:'—' },
            ].map(({label,val}) => (
              <div key={label} style={{ background:'rgba(255,255,255,0.05)',borderRadius:14,
                padding:'10px 8px',textAlign:'center',border:'1px solid rgba(255,255,255,0.07)' }}>
                <p style={{ color:'#fff',fontSize:15,fontWeight:800,margin:0 }}>{val}</p>
                <p style={{ color:'rgba(255,255,255,0.35)',fontSize:10,margin:'2px 0 0' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Barra de progresso */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:'flex',justifyContent:'space-between',marginBottom:6 }}>
              <span style={{ color:'rgba(255,255,255,0.35)',fontSize:10,fontWeight:600 }}>Progresso</span>
              <span style={{ color:'#1a6eff',fontSize:10,fontWeight:800 }}>{Math.round(pct)}%</span>
            </div>
            <div style={{ height:6,borderRadius:99,background:'rgba(255,255,255,0.08)',overflow:'hidden' }}>
              <motion.div animate={{ width:`${pct}%` }} transition={{ duration:0.7 }}
                style={{ height:'100%',borderRadius:99,
                  background:'linear-gradient(90deg,#1a6eff,#5b9fff)',
                  boxShadow:'0 0 8px rgba(26,110,255,0.5)' }}/>
            </div>
            {rd && (
              <div style={{ display:'flex',justifyContent:'space-between',marginTop:4 }}>
                <span style={{ color:'rgba(255,255,255,0.25)',fontSize:9 }}>{dist(covered)} feito</span>
                <span style={{ color:'rgba(255,255,255,0.25)',fontSize:9 }}>{dist(rd.totalM)} total</span>
              </div>
            )}
          </div>

          {/* Botões de controle */}
          <div style={{ display:'flex',gap:10 }}>
            {!nav ? (
              // Botão grande "Iniciar"
              <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.96 }}
                onClick={startNav} disabled={!rd}
                style={{
                  flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                  gap:10, padding:'17px 20px', borderRadius:18,
                  background: rd ? 'linear-gradient(135deg,#1a6eff,#0040cc)' : 'rgba(26,110,255,0.3)',
                  color:'#fff', fontWeight:900, fontSize:16, border:'none', cursor: rd?'pointer':'not-allowed',
                  boxShadow: rd ? '0 6px 28px rgba(26,110,255,0.45)' : 'none',
                  letterSpacing:0.3,
                }}>
                <Navigation style={{width:20,height:20}} strokeWidth={2.5}/>
                Iniciar navegação
              </motion.button>
            ) : tracking ? (
              <motion.button whileTap={{ scale:0.96 }} onClick={pauseNav}
                style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',
                  gap:8,padding:'15px 20px',borderRadius:18,
                  background:'linear-gradient(135deg,#ff3b30,#cc2020)',
                  color:'#fff',fontWeight:800,fontSize:15,border:'none',cursor:'pointer' }}>
                <Square style={{width:17,height:17}} fill="currentColor"/>
                Pausar
              </motion.button>
            ) : (
              <motion.button whileTap={{ scale:0.96 }} onClick={startNav}
                style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',
                  gap:8,padding:'15px 20px',borderRadius:18,
                  background:'linear-gradient(135deg,#1a6eff,#0040cc)',
                  color:'#fff',fontWeight:800,fontSize:15,border:'none',cursor:'pointer' }}>
                <Play style={{width:17,height:17}} fill="currentColor"/>
                Retomar
              </motion.button>
            )}

            {nav && (
              <motion.button whileTap={{ scale:0.9 }} onClick={stopNav}
                style={{ width:52,height:52,borderRadius:16,flexShrink:0,
                  background:'rgba(255,255,255,0.06)',
                  border:'1px solid rgba(255,255,255,0.1)',
                  color:'rgba(255,255,255,0.5)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
                <RotateCcw style={{width:18,height:18}}/>
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalkingMapModal;
