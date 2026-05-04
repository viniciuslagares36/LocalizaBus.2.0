// src/comp/TomTomMap.jsx
// Mapa TomTom com Dark Mode Synthwave, 3D Buildings, pitch 45° e marcadores SVG/PNG
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGeolocation } from '../hooks/useGeolocation';
import { TOMTOM_CONFIG } from '../config/busConfig';
import busMarkerIcon from '../assets/bus-marker.svg';
import busStopMarkerIcon from '../assets/bus-stop-marker.svg';

// ─── SDK singleton GLOBAL (compartilhado com WalkingMapModal — sem conflito) ──
const loadSDK = () => {
  if (window.__ttSdkPromise) return window.__ttSdkPromise;

  window.__ttSdkPromise = new Promise((res, rej) => {
    if (window.tt) {
      res(window.tt);
      return;
    }

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css';
    document.head.appendChild(css);

    const js = document.createElement('script');
    js.src = 'https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js';
    js.onload = () => res(window.tt);
    js.onerror = () => rej(new Error('Falha ao carregar TomTom SDK'));
    document.head.appendChild(js);
  });

  return window.__ttSdkPromise;
};

// ─── Estilos disponíveis ─────────────────────────────────────────────────────
const STYLES = {
  dark: `https://api.tomtom.com/map/1/style/22.2.1-1/basic_night.json?key=${TOMTOM_CONFIG.API_KEY}`,
  light: `https://api.tomtom.com/map/1/style/22.2.1-1/basic_main.json?key=${TOMTOM_CONFIG.API_KEY}`,
};

// ─── Interpolação de posição (suaviza o marcador do usuário) ────────────────
const lerp = (a, b, t) => a + (b - a) * t;
const ALPHA = 0.15;

const safePopupText = (value) => String(value || '')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const createMarkerElement = (marker) => {
  const isBus = marker?.type === 'bus';
  const isStop = marker?.type === 'stop';

  const el = document.createElement('div');
  el.style.position = 'relative';
  el.style.width = isBus ? '46px' : '38px';
  el.style.height = isBus ? '54px' : '44px';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.cursor = 'pointer';
  el.style.userSelect = 'none';

  const pulse = document.createElement('div');
  pulse.style.position = 'absolute';
  pulse.style.width = isBus ? '34px' : '28px';
  pulse.style.height = isBus ? '34px' : '28px';
  pulse.style.borderRadius = '999px';
  pulse.style.background = isBus ? 'rgba(0, 243, 255, 0.18)' : 'rgba(34, 197, 94, 0.18)';
  pulse.style.boxShadow = isBus
    ? '0 0 18px rgba(0, 243, 255, 0.35)'
    : '0 0 16px rgba(34, 197, 94, 0.30)';
  pulse.style.animation = 'lbMarkerPulse 1.8s infinite ease-out';
  el.appendChild(pulse);

  const img = document.createElement('img');
  img.src = isStop ? busStopMarkerIcon : busMarkerIcon;
  img.alt = isStop ? 'Parada de ônibus' : 'Ônibus ao vivo';
  img.draggable = false;
  img.style.position = 'relative';
  img.style.zIndex = '2';
  img.style.width = isBus ? '36px' : '32px';
  img.style.height = isBus ? '36px' : '32px';
  img.style.objectFit = 'contain';
  img.style.transform = isBus && marker?.bearing ? `rotate(${Number(marker.bearing) || 0}deg)` : 'none';
  img.style.transformOrigin = 'center';
  img.style.filter = isBus
    ? 'drop-shadow(0 4px 10px rgba(0, 243, 255, 0.55)) drop-shadow(0 2px 3px rgba(0,0,0,0.35))'
    : 'drop-shadow(0 4px 10px rgba(34, 197, 94, 0.45)) drop-shadow(0 2px 3px rgba(0,0,0,0.30))';
  el.appendChild(img);

  if (isBus && marker?.line) {
    const badge = document.createElement('div');
    badge.textContent = marker.line;
    badge.style.position = 'absolute';
    badge.style.left = '50%';
    badge.style.bottom = '-2px';
    badge.style.transform = 'translateX(-50%)';
    badge.style.zIndex = '3';
    badge.style.padding = '2px 7px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(0, 0, 0, 0.88)';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = '800';
    badge.style.lineHeight = '1.2';
    badge.style.whiteSpace = 'nowrap';
    badge.style.border = '1px solid rgba(255,255,255,0.22)';
    badge.style.boxShadow = '0 3px 10px rgba(0,0,0,0.35)';
    el.appendChild(badge);
  }

  if (isStop) {
    const label = document.createElement('div');
    label.textContent = 'Parada';
    label.style.position = 'absolute';
    label.style.left = '50%';
    label.style.bottom = '-1px';
    label.style.transform = 'translateX(-50%)';
    label.style.zIndex = '3';
    label.style.padding = '2px 6px';
    label.style.borderRadius = '999px';
    label.style.background = 'rgba(22, 163, 74, 0.95)';
    label.style.color = '#ffffff';
    label.style.fontSize = '9px';
    label.style.fontWeight = '800';
    label.style.whiteSpace = 'nowrap';
    label.style.boxShadow = '0 3px 10px rgba(0,0,0,0.25)';
    el.appendChild(label);
  }

  return el;
};

const TomTomMap = ({ center, markers = [], onError, isDark = true, showRoute = false, routePoints = null }) => {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const userMkrRef = useRef(null);
  const customMarkersRef = useRef([]);
  const smoothPosRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const { location, bearing, error: geoError } = useGeolocation({
    enableHighAccuracy: true,
    smoothTransition: true,
  });

  const memoMarkers = useMemo(() => markers || [], [JSON.stringify(markers || [])]);

  const drawRoute = useCallback((map, pts) => {
    const geo = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts } };
    const safe = fn => { try { fn(); } catch (_) {} };

    safe(() => {
      if (map.getSource('tt-route')) {
        map.getSource('tt-route').setData(geo);
        return;
      }

      map.addSource('tt-route', { type: 'geojson', data: geo });

      map.addLayer({
        id: 'tt-route-shadow',
        type: 'line',
        source: 'tt-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0.2, 'line-blur': 5 },
      });

      map.addLayer({
        id: 'tt-route-border',
        type: 'line',
        source: 'tt-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00f3ff', 'line-width': 8, 'line-opacity': 1 },
      });

      map.addLayer({
        id: 'tt-route-glow',
        type: 'line',
        source: 'tt-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.6 },
      });
    });
  }, []);

  // ── Inicializar mapa ───────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let map = null;

    loadSDK()
      .then(tt => {
        if (!mountedRef.current || !mapElRef.current) return;

        map = tt.map({
          key: TOMTOM_CONFIG.API_KEY,
          container: mapElRef.current,
          center: center ? [center[0], center[1]] : [TOMTOM_CONFIG.CENTRO_BRASILIA.lon, TOMTOM_CONFIG.CENTRO_BRASILIA.lat],
          zoom: 14,
          pitch: 45,
          bearing: 0,
          style: isDark ? STYLES.dark : STYLES.light,
          language: 'pt-BR',
          attributionControl: false,
        });

        mapRef.current = map;
        map.addControl(new tt.NavigationControl({ showZoom: true, showCompass: true }), 'bottom-right');

        map.on('load', () => {
          if (!mountedRef.current) return;

          try {
            map.addLayer({
              id: '3d-buildings',
              type: 'fill-extrusion',
              source: 'vectorTiles',
              'source-layer': 'Building',
              paint: {
                'fill-extrusion-color': isDark ? '#1a1f35' : '#d4d8e0',
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-opacity': 0.85,
              },
            });
          } catch (_) {}

          if (showRoute && routePoints?.length) {
            drawRoute(map, routePoints);
          }

          setMapLoaded(true);
        });
      })
      .catch(err => {
        if (mountedRef.current) {
          setLoadError(err.message);
          onError?.(err.message);
        }
      });

    return () => {
      mountedRef.current = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      customMarkersRef.current.forEach(marker => {
        try { marker.remove(); } catch (_) {}
      });
      customMarkersRef.current = [];
      if (map) {
        try { map.remove(); } catch (_) {}
      }
      mapRef.current = null;
      userMkrRef.current = null;
    };
  }, []);

  // ── Atualizar estilo quando troca tema ─────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    try {
      mapRef.current.setStyle(isDark ? STYLES.dark : STYLES.light);
    } catch (_) {}
  }, [isDark, mapLoaded]);

  // ── Marcadores passados via props: ônibus + paradas ───────────────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !window.tt) return;

    customMarkersRef.current.forEach(marker => {
      try { marker.remove(); } catch (_) {}
    });
    customMarkersRef.current = [];

    memoMarkers
      .filter(m => Number.isFinite(Number(m?.lat)) && Number.isFinite(Number(m?.lon)))
      .forEach(m => {
        const el = createMarkerElement(m);
        const popupText = safePopupText(m.popup || '');

        const marker = new window.tt.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([Number(m.lon), Number(m.lat)])
          .setPopup(
            new window.tt.Popup({ offset: 18 }).setHTML(
              `<div style="font-size:12px;font-weight:700;color:#111;line-height:1.35;max-width:220px">${popupText}</div>`
            )
          )
          .addTo(mapRef.current);

        customMarkersRef.current.push(marker);
      });

    if (memoMarkers.length > 1) {
      try {
        const bounds = new window.tt.LngLatBounds();
        memoMarkers.forEach(m => {
          if (Number.isFinite(Number(m?.lat)) && Number.isFinite(Number(m?.lon))) {
            bounds.extend([Number(m.lon), Number(m.lat)]);
          }
        });
        mapRef.current.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 650 });
      } catch (_) {}
    } else if (center) {
      try {
        mapRef.current.easeTo({ center: [center[0], center[1]], zoom: 14, duration: 650 });
      } catch (_) {}
    }
  }, [memoMarkers, mapLoaded, center]);

  // ── Atualizar rota quando routePoints mudar ────────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !routePoints?.length || !mapRef.current) return;
    drawRoute(mapRef.current, routePoints);
  }, [routePoints, mapLoaded, drawRoute]);

  // ── Marcador do usuário com interpolação RAF ───────────────────────────────
  useEffect(() => {
    if (!location || !mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    if (!userMkrRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:32px;height:32px;';
      el.innerHTML = `
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,243,255,0.15);animation:ttPulse 2s infinite;"></div>
        <div style="position:absolute;inset:5px;border-radius:50%;background:#00f3ff;border:2.5px solid #fff;
          box-shadow:0 0 16px rgba(0,243,255,0.8),0 0 4px rgba(0,243,255,0.4);
          display:flex;align-items:center;justify-content:center;">
          <svg id="tt-arrow" width="10" height="10" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L7 21l5-3.5 5 3.5z"/>
          </svg>
        </div>
        <style>
          @keyframes ttPulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(3);opacity:0}}
          @keyframes lbMarkerPulse{0%{transform:scale(.7);opacity:.8}100%{transform:scale(1.8);opacity:0}}
        </style>
      `;
      userMkrRef.current = new window.tt.Marker({ element: el, anchor: 'center' })
        .setLngLat([location.lon, location.lat])
        .addTo(map);
      smoothPosRef.current = { lat: location.lat, lon: location.lon };
    }

    const target = { lat: location.lat, lon: location.lon };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      if (!mountedRef.current || !userMkrRef.current) return;
      const s = smoothPosRef.current;
      if (!s) return;

      const newLat = lerp(s.lat, target.lat, ALPHA);
      const newLon = lerp(s.lon, target.lon, ALPHA);
      smoothPosRef.current = { lat: newLat, lon: newLon };
      userMkrRef.current.setLngLat([newLon, newLat]);

      const el = userMkrRef.current.getElement?.();
      const arrow = el?.querySelector('#tt-arrow');
      if (arrow) arrow.style.transform = `rotate(${bearing}deg)`;

      if (Math.abs(newLat - target.lat) > 0.00001 || Math.abs(newLon - target.lon) > 0.00001) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [location, bearing, mapLoaded]);

  // ── Quando a rota é selecionada, inclina o mapa em pitch 45 ───────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    mapRef.current.easeTo({ pitch: showRoute ? 45 : 0, duration: 700 });
  }, [showRoute, mapLoaded]);

  if (loadError) {
    return (
      <div className="w-full h-64 rounded-2xl bg-gray-900 flex items-center justify-center">
        <p className="text-sm text-red-400">{loadError}</p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-96 rounded-2xl overflow-hidden"
      style={{ boxShadow: isDark ? '0 0 32px rgba(0,243,255,0.12)' : '0 4px 24px rgba(0,0,0,0.1)' }}
    >
      <div ref={mapElRef} className="w-full h-full" style={{ willChange: 'transform' }} />

      {!mapLoaded && (
        <div className="absolute inset-0 bg-gray-900 animate-pulse rounded-2xl flex items-center justify-center">
          <p className="text-xs text-gray-500">Carregando mapa…</p>
        </div>
      )}

      <AnimatePresence>
        {location && mapLoaded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(0,243,255,0.3)',
              boxShadow: '0 0 12px rgba(0,243,255,0.2)',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-[#00f3ff] animate-ping opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-[#00f3ff]" />
            </span>
            <span className="text-[11px] font-bold text-[#00f3ff] tracking-wide">GPS ATIVO</span>
          </motion.div>
        )}
      </AnimatePresence>

      {geoError && (
        <div
          className="absolute top-3 left-3 px-3 py-2 rounded-xl text-xs text-red-400 max-w-xs"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,59,48,0.3)' }}
        >
          {geoError}
        </div>
      )}
    </div>
  );
};

export default React.memo(TomTomMap);
