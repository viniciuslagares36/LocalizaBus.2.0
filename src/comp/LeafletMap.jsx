// src/comp/TomTomMap.jsx
// Mapa TomTom organizado:
// - ônibus como marcador pequeno
// - paradas como camada GeoJSON fixa no mapa
// - não reseta zoom ao atualizar

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGeolocation } from '../hooks/useGeolocation';
import { TOMTOM_CONFIG } from '../config/busConfig';
import { getAllSemobStops } from '../services/semobStops';

const BUS_ICON_URL = '/assets/bus-marker.svg';
const BUS_STOP_ICON_URL = '/assets/bus-stop-marker.svg';

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

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const toStopsGeoJson = (stops = []) => ({
  type: 'FeatureCollection',
  features: stops
    .map((stop) => {
      const lat = Number(stop?.position?.lat ?? stop?.lat);
      const lon = Number(stop?.position?.lon ?? stop?.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
        properties: {
          id: stop.stopId || stop.id || '',
          code: stop.code || stop.stopCode || '',
          name: stop.name || stop.stopName || 'Parada de ônibus',
          source: stop.source || 'SEMOB',
        },
      };
    })
    .filter(Boolean),
});

const loadMapImage = (map, name, url) =>
  new Promise((resolve) => {
    if (!map || !url) {
      resolve(false);
      return;
    }

    try {
      if (map.hasImage?.(name)) {
        resolve(true);
        return;
      }
    } catch (_) { }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        if (!map.hasImage?.(name)) {
          map.addImage(name, img, { pixelRatio: 2 });
        }
        resolve(true);
      } catch (error) {
        console.warn(`[TomTomMap] Erro ao adicionar imagem ${name}:`, error);
        resolve(false);
      }
    };

    img.onerror = () => {
      console.warn(`[TomTomMap] Não carregou imagem: ${url}`);
      resolve(false);
    };

    img.src = url;
  });


const createBusMarkerElement = (marker) => {
  const el = document.createElement('div');

  el.style.position = 'relative';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.cursor = 'pointer';
  el.style.pointerEvents = 'auto';
  el.style.width = '20px';
  el.style.height = '20px';

  const img = document.createElement('img');
  img.src = BUS_ICON_URL;
  img.alt = 'Ônibus';
  img.draggable = false;
  img.style.width = '18px';
  img.style.height = '18px';
  img.style.objectFit = 'contain';
  img.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.55))';

  if (Number.isFinite(Number(marker.bearing))) {
    img.style.transform = `rotate(${Number(marker.bearing)}deg)`;
    img.style.transition = 'transform 0.25s ease';
  }

  el.appendChild(img);

  if (marker.line) {
    const badge = document.createElement('div');
    badge.className = 'bus-line-badge';
    badge.textContent = marker.line;

    badge.style.position = 'absolute';
    badge.style.left = '50%';
    badge.style.bottom = '-9px';
    badge.style.transform = 'translateX(-50%)';
    badge.style.padding = '1px 5px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(0,0,0,0.82)';
    badge.style.color = '#fff';
    badge.style.fontSize = '7px';
    badge.style.fontWeight = '800';
    badge.style.lineHeight = '1';
    badge.style.whiteSpace = 'nowrap';

    el.appendChild(badge);
  }

  return el;
};

const updateBusMarkerElement = (element, marker) => {
  if (!element) return;

  const img = element.querySelector('img');

  if (img && Number.isFinite(Number(marker.bearing))) {
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
  const busMarkersRef = useRef(new Map());
  const stopPopupRef = useRef(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const { location, bearing, error: geoError } = useGeolocation({
    enableHighAccuracy: true,
    smoothTransition: true,
  });

  const memoBusMarkers = useMemo(() => {
    const unique = new Map();

    (markers || [])
      .filter((marker) => marker?.type === 'bus' && marker?.lat && marker?.lon)
      .forEach((marker, index) => {
        const key =
          marker.id ||
          marker.vehicleNumber ||
          `${marker.line || 'bus'}_${index}_${Number(marker.lat).toFixed(5)}_${Number(marker.lon).toFixed(5)}`;

        unique.set(key, {
          ...marker,
          __key: key,
          lat: Number(marker.lat),
          lon: Number(marker.lon),
        });
      });

    return Array.from(unique.values());
  }, [markers]);

  const cleanBusMarkers = useCallback(() => {
    busMarkersRef.current.forEach((item) => {
      try {
        item.marker.remove();
      } catch (_) { }
    });

    busMarkersRef.current.clear();
  }, []);

  const drawRoute = useCallback((map, pts) => {
    const geo = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: pts,
      },
    };

    try {
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
    } catch (_) { }
  }, []);

  const addStopsLayer = useCallback(async (map) => {
    try {
      const stops = await getAllSemobStops();
      const stopsGeoJson = toStopsGeoJson(stops);

      if (!map.getSource('semob-stops')) {
        map.addSource('semob-stops', {
          type: 'geojson',
          data: stopsGeoJson,
        });
      } else {
        map.getSource('semob-stops').setData(stopsGeoJson);
      }

      const hasStopIcon = await loadMapImage(map, 'bus-stop-icon', BUS_STOP_ICON_URL);

      if (hasStopIcon && !map.getLayer('semob-stops-icons')) {
        map.addLayer({
          id: 'semob-stops-icons',
          type: 'symbol',
          source: 'semob-stops',
          minzoom: 10,
          layout: {
            'icon-image': 'bus-stop-icon',
            'icon-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10,
              0.12,
              14,
              0.2,
              16,
              0.28,
              18,
              0.38,
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-anchor': 'bottom',
          },
        });
      }

      // Fallback visual: sempre mantém bolinhas por baixo. Se o SVG não carregar,
      // as paradas continuam aparecendo no mapa.
      if (!map.getLayer('semob-stops-circles')) {
        map.addLayer({
          id: 'semob-stops-circles',
          type: 'circle',
          source: 'semob-stops',
          minzoom: 10,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10,
              2,
              14,
              3,
              16,
              5,
              18,
              7,
            ],
            'circle-color': hasStopIcon ? 'rgba(22,163,74,0.25)' : '#16a34a',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.2,
            'circle-opacity': hasStopIcon ? 0.45 : 0.95,
          },
        });
      }

      if (!map.getLayer('semob-stops-labels')) {
        map.addLayer({
          id: 'semob-stops-labels',
          type: 'symbol',
          source: 'semob-stops',
          minzoom: 15,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': isDark ? '#e5e7eb' : '#111827',
            'text-halo-color': isDark ? '#020617' : '#ffffff',
            'text-halo-width': 1,
          },
        });
      }

      const openStopPopup = (e) => {
        const feature = e.features?.[0];
        if (!feature) return;

        const [lon, lat] = feature.geometry.coordinates;
        const name = feature.properties?.name || 'Parada de ônibus';
        const code = feature.properties?.code ? ` • ${feature.properties.code}` : '';

        if (stopPopupRef.current) {
          stopPopupRef.current.remove();
        }

        stopPopupRef.current = new window.tt.Popup({ offset: 12 })
          .setLngLat([lon, lat])
          .setHTML(
            `<div style="font-size:12px;font-weight:700;color:#111;line-height:1.35;max-width:220px;">${escapeHtml(
              name
            )}${escapeHtml(code)}</div>`
          )
          .addTo(map);
      };

      if (!map.__semobStopsClickBound) {
        map.__semobStopsClickBound = true;

        map.on('click', 'semob-stops-icons', openStopPopup);
        map.on('click', 'semob-stops-circles', openStopPopup);
      }
    } catch (error) {
      console.warn('[SEMOB stops layer] Falha ao carregar paradas:', error?.message || error);
    }
  }, [isDark]);

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
            : [
              TOMTOM_CONFIG.CENTRO_BRASILIA.lon,
              TOMTOM_CONFIG.CENTRO_BRASILIA.lat,
            ],
          zoom: 14,
          pitch: 0,
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

        map.on('load', async () => {
          if (!mountedRef.current) return;

          if (showRoute && routePoints?.length) {
            drawRoute(map, routePoints);
          }

          await addStopsLayer(map);

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

      cleanBusMarkers();

      if (stopPopupRef.current) {
        stopPopupRef.current.remove();
        stopPopupRef.current = null;
      }

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (map) {
        try {
          map.remove();
        } catch (_) { }
      }

      mapRef.current = null;
      userMkrRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    try {
      mapRef.current.setStyle(isDark ? STYLES.dark : STYLES.light);
    } catch (_) { }
  }, [isDark, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !routePoints?.length || !mapRef.current) return;
    drawRoute(mapRef.current, routePoints);
  }, [routePoints, mapLoaded, drawRoute]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !window.tt) return;

    const map = mapRef.current;
    const currentKeys = new Set(memoBusMarkers.map((marker) => marker.__key));

    busMarkersRef.current.forEach((item, key) => {
      if (!currentKeys.has(key)) {
        try {
          item.marker.remove();
        } catch (_) { }

        busMarkersRef.current.delete(key);
      }
    });

    memoBusMarkers.forEach((marker) => {
      const existing = busMarkersRef.current.get(marker.__key);

      if (existing) {
        existing.marker.setLngLat([marker.lon, marker.lat]);
        updateBusMarkerElement(existing.element, marker);

        try {
          existing.marker.setPopup(
            new window.tt.Popup({ offset: 12 }).setHTML(
              `<div style="font-size:12px;font-weight:600;color:#111;line-height:1.35;max-width:220px;">
                ${escapeHtml(marker.popup || '')}
              </div>`
            )
          );
        } catch (_) { }

        return;
      }

      const element = createBusMarkerElement(marker);

      const ttMarker = new window.tt.Marker({
        element,
        anchor: 'bottom',
      })
        .setLngLat([marker.lon, marker.lat])
        .setPopup(
          new window.tt.Popup({ offset: 12 }).setHTML(
            `<div style="font-size:12px;font-weight:600;color:#111;line-height:1.35;max-width:220px;">
              ${escapeHtml(marker.popup || '')}
            </div>`
          )
        )
        .addTo(map);

      busMarkersRef.current.set(marker.__key, {
        marker: ttMarker,
        element,
        data: marker,
      });
    });

    // Importante: não tem easeTo aqui.
    // Isso evita perder zoom quando atualiza.
  }, [memoBusMarkers, mapLoaded]);

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
      <div ref={mapElRef} className="w-full h-full" />

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