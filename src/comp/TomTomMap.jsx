// src/comp/TomTomMap.jsx
// Mapa TomTom com marcadores SVG organizados
// Corrigido: não reseta zoom, não bagunça marcadores, ônibus menor e paradas fixas

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGeolocation } from '../hooks/useGeolocation';
import { TOMTOM_CONFIG } from '../config/busConfig';

import busMarkerIcon from '../assets/bus-stop-svgrepo-com.svg';
import busStopMarkerIcon from '../assets/bus-transport-svgrepo-com.svg';

// ─── SDK singleton GLOBAL ─────────────────────────────
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

const STYLES = {
  dark: `https://api.tomtom.com/map/1/style/22.2.1-1/basic_night.json?key=${TOMTOM_CONFIG.API_KEY}`,
  light: `https://api.tomtom.com/map/1/style/22.2.1-1/basic_main.json?key=${TOMTOM_CONFIG.API_KEY}`,
};

const lerp = (a, b, t) => a + (b - a) * t;
const ALPHA = 0.15;

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getMarkerKey = (marker, index) => {
  const type = marker.type || 'marker';

  if (type === 'bus') {
    const vehicle = marker.vehicleNumber || marker.numero || marker.id || '';
    const line = marker.line || '';
    const lat = Number(marker.lat || 0).toFixed(5);
    const lon = Number(marker.lon || 0).toFixed(5);

    // Se tiver número do veículo, usa ele como chave fixa.
    // Se não tiver, usa linha + coordenada aproximada.
    return vehicle
      ? `bus_${line}_${vehicle}`
      : `bus_${line}_${lat}_${lon}_${index}`;
  }

  if (type === 'stop') {
    const lat = Number(marker.lat || 0).toFixed(6);
    const lon = Number(marker.lon || 0).toFixed(6);
    return `stop_${lat}_${lon}`;
  }

  return `${type}_${index}`;
};

const createMarkerElement = (marker) => {
  const type = marker.type || 'bus';
  const isBus = type === 'bus';
  const isStop = type === 'stop';

  const el = document.createElement('div');

  el.style.position = 'relative';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.cursor = 'pointer';
  el.style.pointerEvents = 'auto';
  el.style.transform = 'translateZ(0)';
  el.style.willChange = 'transform';

  // Ônibus menor para não virar bagunça no mapa
  el.style.width = isBus ? '28px' : '32px';
  el.style.height = isBus ? '28px' : '32px';

  const img = document.createElement('img');
  img.src = isStop ? busStopMarkerIcon : busMarkerIcon;
  img.alt = isStop ? 'Parada de ônibus' : 'Ônibus';
  img.draggable = false;

  img.style.position = 'relative';
  img.style.objectFit = 'contain';
  img.style.zIndex = '2';

  img.style.width = isBus ? '24px' : '28px';
  img.style.height = isBus ? '24px' : '28px';

  img.style.filter = isBus
    ? 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.55))'
    : 'drop-shadow(0 2px 6px rgba(34, 197, 94, 0.45))';

  if (isBus && Number.isFinite(Number(marker.bearing))) {
    img.style.transform = `rotate(${Number(marker.bearing)}deg)`;
    img.style.transition = 'transform 0.25s ease';
  }

  el.appendChild(img);

  // Badge pequeno da linha no ônibus
  if (isBus && marker.line) {
    const badge = document.createElement('div');
    badge.className = 'bus-line-badge';
    badge.textContent = marker.line;

    badge.style.position = 'absolute';
    badge.style.left = '50%';
    badge.style.bottom = '-10px';
    badge.style.transform = 'translateX(-50%)';
    badge.style.zIndex = '3';

    badge.style.padding = '1px 5px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(0, 0, 0, 0.82)';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '8px';
    badge.style.fontWeight = '800';
    badge.style.lineHeight = '1';
    badge.style.whiteSpace = 'nowrap';
    badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';

    el.appendChild(badge);
  }

  // Badge da parada
  if (isStop) {
    const badge = document.createElement('div');
    badge.textContent = 'Parada';

    badge.style.position = 'absolute';
    badge.style.left = '50%';
    badge.style.bottom = '-10px';
    badge.style.transform = 'translateX(-50%)';
    badge.style.zIndex = '3';

    badge.style.padding = '1px 5px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(22, 163, 74, 0.95)';
    badge.style.color = '#ffffff';
    badge.style.fontSize = '8px';
    badge.style.fontWeight = '800';
    badge.style.lineHeight = '1';
    badge.style.whiteSpace = 'nowrap';
    badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';

    el.appendChild(badge);
  }

  return el;
};

const updateMarkerElement = (element, marker) => {
  if (!element) return;

  const img = element.querySelector('img');

  if (img && marker.type === 'bus' && Number.isFinite(Number(marker.bearing))) {
    img.style.transform = `rotate(${Number(marker.bearing)}deg)`;
  }

  const badge = element.querySelector('.bus-line-badge');

  if (badge && marker.line) {
    badge.textContent = marker.line;
  }
};

const TomTomMap = ({
  center,
  markers = [],
  onError,
  isDark = true,
  showRoute = false,
  routePoints = null,
}) => {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const userMkrRef = useRef(null);
  const smoothPosRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);

  // Aqui ficam os marcadores reais do TomTom.
  // Não vamos recriar todos a cada atualização.
  const markerStoreRef = useRef(new Map());

  const [mapLoaded, setMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const { location, bearing, error: geoError } = useGeolocation({
    enableHighAccuracy: true,
    smoothTransition: true,
  });

  const cleanAllMarkers = useCallback(() => {
    markerStoreRef.current.forEach((item) => {
      try {
        item.marker.remove();
      } catch (_) {}
    });

    markerStoreRef.current.clear();
  }, []);

  const memoMarkers = useMemo(() => {
    const list = (markers || [])
      .filter((marker) => marker?.lat && marker?.lon)
      .map((marker, index) => ({
        ...marker,
        lat: Number(marker.lat),
        lon: Number(marker.lon),
        __key: getMarkerKey(marker, index),
      }));

    // Remove paradas duplicadas
    const unique = new Map();

    list.forEach((marker) => {
      unique.set(marker.__key, marker);
    });

    // Organização visual:
    // Paradas primeiro, ônibus depois.
    return Array.from(unique.values()).sort((a, b) => {
      if (a.type === 'stop' && b.type !== 'stop') return -1;
      if (a.type !== 'stop' && b.type === 'stop') return 1;
      return 0;
    });
  }, [markers]);

  const drawRoute = useCallback((map, pts) => {
    const geo = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: pts,
      },
    };

    const safe = (fn) => {
      try {
        fn();
      } catch (_) {}
    };

    safe(() => {
      if (map.getSource('tt-route')) {
        map.getSource('tt-route').setData(geo);
        return;
      }

      map.addSource('tt-route', {
        type: 'geojson',
        data: geo,
      });

      map.addLayer({
        id: 'tt-route-shadow',
        type: 'line',
        source: 'tt-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#000',
          'line-width': 14,
          'line-opacity': 0.2,
          'line-blur': 5,
        },
      });

      map.addLayer({
        id: 'tt-route-border',
        type: 'line',
        source: 'tt-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#00f3ff',
          'line-width': 8,
          'line-opacity': 1,
        },
      });

      map.addLayer({
        id: 'tt-route-glow',
        type: 'line',
        source: 'tt-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 3,
          'line-opacity': 0.6,
        },
      });
    });
  }, []);

  // Inicializa o mapa só uma vez
  useEffect(() => {
    mountedRef.current = true;
    let map = null;

    loadSDK()
      .then((tt) => {
        if (!mountedRef.current || !mapElRef.current) return;

        map = tt.map({
          key: TOMTOM_CONFIG.API_KEY,
          container: mapElRef.current,
          center: center
            ? [center[0], center[1]]
            : [TOMTOM_CONFIG.CENTRO_BRASILIA.lon, TOMTOM_CONFIG.CENTRO_BRASILIA.lat],
          zoom: 14,
          pitch: 45,
          bearing: 0,
          style: isDark ? STYLES.dark : STYLES.light,
          language: 'pt-BR',
          attributionControl: false,
        });

        mapRef.current = map;

        map.addControl(
          new tt.NavigationControl({
            showZoom: true,
            showCompass: true,
          }),
          'bottom-right'
        );

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
      .catch((err) => {
        if (mountedRef.current) {
          setLoadError(err.message);
          onError?.(err.message);
        }
      });

    return () => {
      mountedRef.current = false;

      cleanAllMarkers();

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (map) {
        try {
          map.remove();
        } catch (_) {}
      }

      mapRef.current = null;
      userMkrRef.current = null;
    };
  }, []);

  // Atualiza tema sem mexer no zoom
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    try {
      mapRef.current.setStyle(isDark ? STYLES.dark : STYLES.light);
    } catch (_) {}
  }, [isDark, mapLoaded]);

  // Atualiza rota
  useEffect(() => {
    if (!mapLoaded || !routePoints?.length || !mapRef.current) return;
    drawRoute(mapRef.current, routePoints);
  }, [routePoints, mapLoaded, drawRoute]);

  // Atualiza marcadores sem resetar zoom/centro
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !window.tt) return;

    const currentKeys = new Set(memoMarkers.map((marker) => marker.__key));

    // Remove só o que sumiu
    markerStoreRef.current.forEach((item, key) => {
      if (!currentKeys.has(key)) {
        try {
          item.marker.remove();
        } catch (_) {}

        markerStoreRef.current.delete(key);
      }
    });

    // Cria ou atualiza os existentes
    memoMarkers.forEach((marker) => {
      const existing = markerStoreRef.current.get(marker.__key);

      if (existing) {
        // Atualiza posição sem recriar marcador
        existing.marker.setLngLat([marker.lon, marker.lat]);
        updateMarkerElement(existing.element, marker);

        // Atualiza popup
        try {
          const popupHtml = `
            <div style="font-size:12px;font-weight:600;color:#111;line-height:1.35;max-width:220px;">
              ${escapeHtml(marker.popup || '')}
            </div>
          `;

          existing.marker.setPopup(
            new window.tt.Popup({ offset: 16 }).setHTML(popupHtml)
          );
        } catch (_) {}

        return;
      }

      const element = createMarkerElement(marker);

      const popupHtml = `
        <div style="font-size:12px;font-weight:600;color:#111;line-height:1.35;max-width:220px;">
          ${escapeHtml(marker.popup || '')}
        </div>
      `;

      const ttMarker = new window.tt.Marker({
        element,
        anchor: marker.type === 'stop' ? 'bottom' : 'center',
      })
        .setLngLat([marker.lon, marker.lat])
        .setPopup(
          new window.tt.Popup({
            offset: marker.type === 'stop' ? 16 : 12,
          }).setHTML(popupHtml)
        )
        .addTo(mapRef.current);

      markerStoreRef.current.set(marker.__key, {
        marker: ttMarker,
        element,
        data: marker,
      });
    });

    // NÃO TEM easeTo AQUI.
    // Isso impede o mapa de ficar tirando seu zoom toda vez que atualiza.
  }, [memoMarkers, mapLoaded]);

  // Marcador do usuário
  useEffect(() => {
    if (!location || !mapLoaded || !mapRef.current || !window.tt) return;

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
          @keyframes ttPulse {
            0% { transform: scale(1); opacity: .7; }
            100% { transform: scale(3); opacity: 0; }
          }
        </style>
      `;

      userMkrRef.current = new window.tt.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat([location.lon, location.lat])
        .addTo(map);

      smoothPosRef.current = {
        lat: location.lat,
        lon: location.lon,
      };
    }

    const target = {
      lat: location.lat,
      lon: location.lon,
    };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    const tick = () => {
      if (!mountedRef.current || !userMkrRef.current) return;

      const current = smoothPosRef.current;
      if (!current) return;

      const newLat = lerp(current.lat, target.lat, ALPHA);
      const newLon = lerp(current.lon, target.lon, ALPHA);

      smoothPosRef.current = {
        lat: newLat,
        lon: newLon,
      };

      userMkrRef.current.setLngLat([newLon, newLat]);

      const el = userMkrRef.current.getElement?.();
      const arrow = el?.querySelector('#tt-arrow');

      if (arrow) {
        arrow.style.transform = `rotate(${bearing}deg)`;
      }

      if (
        Math.abs(newLat - target.lat) > 0.00001 ||
        Math.abs(newLon - target.lon) > 0.00001
      ) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [location, bearing, mapLoaded]);

  // Só muda pitch quando abrir rota, não mexe em zoom
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    try {
      mapRef.current.easeTo({
        pitch: showRoute ? 45 : 0,
        duration: 500,
      });
    } catch (_) {}
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
      style={{
        boxShadow: isDark
          ? '0 0 32px rgba(0,243,255,0.12)'
          : '0 4px 24px rgba(0,0,0,0.1)',
      }}
    >
      <div
        ref={mapElRef}
        className="w-full h-full"
        style={{
          willChange: 'transform',
        }}
      />

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

            <span className="text-[11px] font-bold text-[#00f3ff] tracking-wide">
              GPS ATIVO
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {geoError && (
        <div
          className="absolute top-3 left-3 px-3 py-2 rounded-xl text-xs text-red-400 max-w-xs"
          style={{
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,59,48,0.3)',
          }}
        >
          {geoError}
        </div>
      )}
    </div>
  );
};

export default React.memo(TomTomMap);