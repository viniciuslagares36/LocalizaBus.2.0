/*
  LocalizaBus — src/comp/LeafletMap.jsx
  Mapa pequeno de ônibus/paradas usando Leaflet. Aqui controlamos os marcadores dos ônibus ao vivo, zoom no primeiro ônibus pesquisado, proteção de coordenadas do DF e aparência dos ícones no mapa.
  Comentários feitos em linguagem simples para você conseguir mexer depois sem se perder.
*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

const BUS_ICON_URL = '/assets/bus-marker.svg';
const BUS_STOP_ICON_URL = '/assets/bus-stop-marker.svg';

const createIcon = (url, size = 28, anchorY = 28) =>
  L.icon({
    iconUrl: url,
    iconSize: [size, size],
    iconAnchor: [size / 2, anchorY],
    popupAnchor: [0, -anchorY],
  });

const busIcon = createIcon(BUS_ICON_URL, 20, 20);
const boardingStopIcon = createIcon(BUS_STOP_ICON_URL, 20, 20);
const nearbyStopIcon = createIcon(BUS_STOP_ICON_URL, 14, 14);

const userPickIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 999px 999px 999px 0;
      background: #0a84ff;
      transform: rotate(-45deg);
      border: 3px solid #ffffff;
      box-shadow: 0 8px 18px rgba(0,0,0,.35);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: #ffffff;
      "></div>
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -34],
});

const getLineBadgeColors = (line) => {
  const value = String(line || '').trim();

  if (value.startsWith('0.')) {
    return { background: '#a3e635', color: '#111827', border: '#bef264' };
  }

  if (value.startsWith('1')) {
    return { background: '#22c55e', color: '#ffffff', border: '#86efac' };
  }

  if (value.startsWith('2')) {
    return { background: '#06b6d4', color: '#ffffff', border: '#67e8f9' };
  }

  if (value.startsWith('3')) {
    return { background: '#8b5cf6', color: '#ffffff', border: '#c4b5fd' };
  }

  if (value.startsWith('4')) {
    return { background: '#a3e635', color: '#111827', border: '#d9f99d' };
  }

  if (value.startsWith('5')) {
    return { background: '#f97316', color: '#111827', border: '#fdba74' };
  }

  if (value.startsWith('8') || value.startsWith('9')) {
    return { background: '#22d3ee', color: '#111827', border: '#a5f3fc' };
  }

  return { background: '#94a3b8', color: '#0f172a', border: '#e2e8f0' };
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// Comentário humano: aqui nasce o marcador do ônibus.
// Deixei em dois estilos para não poluir o mapa:
// 1) Todos os ônibus no mapa ficam como bolinha/ícone pequeno verde-azul e sem texto.
// 2) Quando o usuário pesquisa uma linha ou seleciona um ônibus, o marcador cresce e mostra o número da linha.
// Se quiser mudar cor/tamanho depois, mexe nas variáveis smallSize, selectedSize, background e border abaixo.
const createBusMarkerIcon = ({ line, isSelected = false, showLabel = false, directionType = '' }) => {
  const colors = getLineBadgeColors(line);
  const safeLine = escapeHtml(line || '');
  const ringColor =
    directionType === 'ida'
      ? '#38bdf8'
      : directionType === 'volta'
        ? '#84cc16'
        : '#ffffff';

  // Ícone discreto para quando estamos mostrando todos os ônibus do DF.
  // Esse é o visual que substitui aquele texto cinza "BUS".
  if (!isSelected && !showLabel) {
    const smallSize = 20;

    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: ${smallSize}px;
          height: ${smallSize}px;
          border-radius: 999px;
          background: linear-gradient(135deg, #22c55e 0%, #0ea5e9 100%);
          border: 2px solid rgba(255,255,255,.92);
          box-shadow: 0 5px 14px rgba(2,6,23,.32);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <img src="${BUS_ICON_URL}" alt="ônibus" style="
            width: 12px;
            height: 12px;
            display: block;
            object-fit: contain;
            filter: brightness(0) invert(1);
          " />
        </div>
      `,
      iconSize: [smallSize, smallSize],
      iconAnchor: [smallSize / 2, smallSize / 2],
      popupAnchor: [0, -smallSize / 2],
    });
  }

  // Marcador destacado: aparece quando o usuário pesquisou/selecionou uma linha.
  // Aqui mantemos o número visível para o usuário saber exatamente qual ônibus está vendo.
  const badgeWidth = isSelected ? 64 : 54;
  const badgeHeight = isSelected ? 26 : 22;
  const busSize = isSelected ? 36 : 30;
  const iconWidth = Math.max(badgeWidth + 10, busSize + 20);
  const iconHeight = badgeHeight + busSize + 10;

  return L.divIcon({
    className: '',
    html: `
      <div style="
        position: relative;
        width: ${iconWidth}px;
        height: ${iconHeight}px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        pointer-events: auto;
      ">
        ${safeLine ? `
          <div style="
            position: relative;
            z-index: 2;
            min-width: ${badgeWidth}px;
            height: ${badgeHeight}px;
            padding: 0 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 7px;
            background: ${colors.background};
            color: ${colors.color};
            border: 2px solid ${ringColor};
            box-shadow: 0 7px 16px rgba(0,0,0,.38);
            font-family: Arial, Helvetica, sans-serif;
            font-size: ${isSelected ? '13px' : '11px'};
            font-weight: 900;
            line-height: 1;
            letter-spacing: -0.03em;
            white-space: nowrap;
          ">${safeLine}</div>

          <div style="
            position: relative;
            z-index: 1;
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid ${colors.background};
            margin-top: -1px;
            filter: drop-shadow(0 2px 2px rgba(0,0,0,.25));
          "></div>
        ` : ''}

        <div style="
          position: relative;
          z-index: 0;
          margin-top: ${safeLine ? '-1px' : '0'};
          width: ${busSize}px;
          height: ${busSize}px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #22c55e 0%, #0ea5e9 100%);
          border: 2px solid rgba(255,255,255,.94);
          box-shadow: 0 9px 20px rgba(0,0,0,.40);
        ">
          <img src="${BUS_ICON_URL}" alt="ônibus" style="
            width: ${Math.round(busSize * 0.64)}px;
            height: ${Math.round(busSize * 0.64)}px;
            display: block;
            object-fit: contain;
            filter: brightness(0) invert(1);
          " />
        </div>
      </div>
    `,
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [iconWidth / 2, iconHeight - 2],
    popupAnchor: [0, -iconHeight + 8],
  });
};

const isValidCoord = (lat, lon) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

// Mantém o mapa focado no DF e corrige casos em que a API vem com lat/lon invertidos.
// Isso evita abrir o mapa em África/oceano quando o usuário pesquisa uma linha.
const isCoordInsideDf = (lat, lon) => {
  const la = Number(lat);
  const lo = Number(lon);
  return la >= -16.35 && la <= -15.35 && lo >= -48.35 && lo <= -47.20;
};

// Comentário humano: proteção contra latitude/longitude invertida ou fora do DF. Sem isso o mapa pode parar no oceano/África.
const normalizeDfPoint = (point) => {
  if (!point) return null;

  const lat = Number(point.lat);
  const lon = Number(point.lon);

  if (isCoordInsideDf(lat, lon)) return { ...point, lat, lon };
  if (isCoordInsideDf(lon, lat)) return { ...point, lat: lon, lon: lat, _swappedCoords: true };

  return null;
};

const getRoutePolylines = (routes = []) => {
  return routes
    .filter((route) => Array.isArray(route.routePoints) && route.routePoints.length > 1)
    .map((route) => ({
      id: route.id,
      line: route.line,
      points: route.routePoints
        .map(([lon, lat]) => [Number(lat), Number(lon)])
        .filter(([lat, lon]) => isValidCoord(lat, lon)),
    }))
    .filter((route) => route.points.length > 1);
};

const getStopsFromRoutes = (routes = []) => {
  const map = new Map();

  const addPassingRouteToStop = (key, route) => {
    const current = map.get(key);
    if (!current) return;

    const passingRoutes = current.passingRoutes || [];

    const alreadyExists = passingRoutes.some(
      (item) => item.id === route.id || item.line === route.line
    );

    if (!alreadyExists) {
      passingRoutes.push({
        id: route.id,
        line: route.line,
        vehicleNumber: route.realTimeGPS?.numero || '',
        etaMinutes: route.etaToNearestStopMinutes ?? route.time ?? null,
        fromStop: route.fromStop || route.nearestStopName || 'Parada próxima',
        toStop: route.toStop || route.destination || 'Destino',
        sentido: route.realTimeGPS?.sentido || route.sentido || null,
        isGpsOnly: route.isGpsOnly || false,
      });
    }

    map.set(key, {
      ...current,
      passingRoutes,
    });
  };

  routes.forEach((route) => {
    const nearbyStops = Array.isArray(route.nearbyStops) ? route.nearbyStops : [];

    nearbyStops.forEach((stop) => {
      if (isValidCoord(stop.lat, stop.lon)) {
        const key = `nearby_${stop.stopId || stop.id || stop.lat}_${stop.lon}`;

        if (!map.has(key)) {
          map.set(key, {
            id: key,
            name: stop.stopName || stop.name || 'Parada próxima',
            lat: Number(stop.lat),
            lon: Number(stop.lon),
            line: route.line,
            type: 'nearby',
            distanceKm: stop.distanceKm ?? null,
            passingRoutes: [],
          });
        }
      }
    });

    if (isValidCoord(route.nearestStopLat, route.nearestStopLon)) {
      const key = `boarding_${route.nearestStopLat}_${route.nearestStopLon}`;

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: route.nearestStopName || route.fromStop || 'Parada de embarque',
          lat: Number(route.nearestStopLat),
          lon: Number(route.nearestStopLon),
          line: route.line,
          type: 'boarding',
          passingRoutes: [],
        });
      }

      addPassingRouteToStop(key, route);
    }
  });

  return Array.from(map.values());
};

// Comentário humano: controla o zoom do mapa automaticamente. É aqui que focamos no primeiro ônibus quando uma linha é pesquisada.
function MapController({ center, markers, routeLines, userPosition, boardingStop, focusMode = 'auto' }) {
  const map = useMap();
  const lastSignatureRef = useRef('');

  useEffect(() => {
    const firstBus = markers.find((marker) =>
      isValidCoord(marker.lat, marker.lon) &&
      (marker.realTimeGPS || marker.type === 'bus' || marker.line || marker.linha || marker.routeId)
    );

    const signature = firstBus
      ? `bus_${firstBus.routeId || firstBus.id || firstBus.line || ''}_${Number(firstBus.lat).toFixed(6)}_${Number(firstBus.lon).toFixed(6)}`
      : `${center?.[0] || ''}_${center?.[1] || ''}_${markers.length}_${routeLines.length}_${focusMode}`;

    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    // Tela inicial: mostra vários ônibus ao vivo no DF sem abrir perdido no oceano/África.
    if (focusMode === 'all-buses') {
      const busPoints = markers
        .filter((marker) => isValidCoord(marker.lat, marker.lon))
        .slice(0, 220)
        .map((marker) => [Number(marker.lat), Number(marker.lon)]);

      if (busPoints.length >= 2) {
        map.fitBounds(busPoints, {
          padding: [28, 28],
          maxZoom: 12.8,
          animate: false,
        });
        return;
      }

      if (busPoints.length === 1) {
        map.setView(busPoints[0], 15, { animate: false });
        return;
      }
    }

    // Pesquisa por linha/ônibus ao vivo: abre direto no primeiro ônibus.
    // Sem animação pesada para não travar celular de entrada.
    if (firstBus && focusMode !== 'bounds') {
      map.setView([Number(firstBus.lat), Number(firstBus.lon)], 16.2, {
        animate: false,
      });
      return;
    }

    const boundsPoints = [];

    if (center?.length === 2) {
      boundsPoints.push([Number(center[1]), Number(center[0])]);
    }

    if (userPosition && isValidCoord(userPosition.lat, userPosition.lon)) {
      boundsPoints.push([Number(userPosition.lat), Number(userPosition.lon)]);
    }

    if (boardingStop && isValidCoord(boardingStop.lat, boardingStop.lon)) {
      boundsPoints.push([Number(boardingStop.lat), Number(boardingStop.lon)]);
    }

    markers.slice(0, 6).forEach((marker) => {
      if (isValidCoord(marker.lat, marker.lon)) {
        boundsPoints.push([Number(marker.lat), Number(marker.lon)]);
      }
    });

    // Evita processar milhares de pontos no mobile.
    routeLines.slice(0, 2).forEach((route) => {
      route.points.slice(0, 120).forEach((point) => boundsPoints.push(point));
    });

    if (boundsPoints.length >= 2) {
      map.fitBounds(boundsPoints, {
        padding: [35, 35],
        maxZoom: 15,
        animate: false,
      });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 15, { animate: false });
    }
  }, [center, markers, routeLines, userPosition, boardingStop, map, focusMode]);

  return null;
}
const formatGpsUpdatedAt = (timestamp, now = Date.now()) => {
  if (!timestamp) return null;

  const gpsTime = Number(timestamp);

  if (!Number.isFinite(gpsTime)) return null;

  const diffMs = now - gpsTime;

  if (diffMs < 0) {
    return 'Atualizado agora';
  }

  const seconds = Math.floor(diffMs / 1000);

  if (seconds <= 5) {
    return 'Atualizado agora';
  }

  if (seconds < 60) {
    return `Atualizado há ${seconds} seg`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes === 1) {
    return 'Atualizado há 1 min';
  }

  return `Atualizado há ${minutes} min`;
};
// Comentário humano: quando o usuário seleciona uma rota/ônibus, esta parte tenta centralizar o mapa no alvo certo.
function FollowSelectedTarget({ markers, routes, selectedRouteId }) {
  const map = useMap();
  const lastTargetRef = useRef(null);

  useEffect(() => {
    if (!selectedRouteId) return;

    const selectedBus = markers.find(
      (marker) => marker.routeId === selectedRouteId
    );

    if (selectedBus && isValidCoord(selectedBus.lat, selectedBus.lon)) {
      const nextPosition = [Number(selectedBus.lat), Number(selectedBus.lon)];
      const targetKey = `bus_${selectedRouteId}_${nextPosition[0]}_${nextPosition[1]}`;

      if (lastTargetRef.current === targetKey) return;

      lastTargetRef.current = targetKey;

      map.flyTo(nextPosition, Math.max(map.getZoom(), 16), {
        animate: true,
        duration: 0.7,
      });

      return;
    }

    const selectedRoute = routes.find((route) => route.id === selectedRouteId);

    if (
      selectedRoute &&
      isValidCoord(selectedRoute.nearestStopLat, selectedRoute.nearestStopLon)
    ) {
      const nextPosition = [
        Number(selectedRoute.nearestStopLat),
        Number(selectedRoute.nearestStopLon),
      ];

      const targetKey = `route_${selectedRouteId}_${nextPosition[0]}_${nextPosition[1]}`;

      if (lastTargetRef.current === targetKey) return;

      lastTargetRef.current = targetKey;

      map.flyTo(nextPosition, Math.max(map.getZoom(), 16), {
        animate: true,
        duration: 0.7,
      });
    }
  }, [markers, routes, selectedRouteId, map]);

  return null;
}

function PickLocationOnMap({ enabled, onPickLocation }) {
  useMapEvents({
    click(e) {
      if (!enabled || !onPickLocation) return;

      onPickLocation({
        lat: e.latlng.lat,
        lon: e.latlng.lng,
      });
    },
  });

  return null;
}


// Comentário humano: camada dos ônibus ao vivo.
// O Leaflet não sabe sozinho quando deve esconder/mostrar texto, então aqui escutamos o zoom.
// Zoom longe: bolinhas pequenas sem texto. Zoom perto ou ônibus selecionado: aparece o número da linha.
function BusMarkersLayer({ markers = [], selectedRouteId = null, now, onRouteSelect = null }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom());

    updateZoom();
    map.on('zoomend', updateZoom);

    return () => map.off('zoomend', updateZoom);
  }, [map]);

  const showTextByZoom = zoom >= 14.6;

  return markers.map((marker, index) => {
    const gpsUpdatedText = formatGpsUpdatedAt(marker.gpsTimestamp, now);
    const isSelected = marker.routeId === selectedRouteId;
    const markerKey = marker.id || `bus_${index}`;
    const hasLine = Boolean(String(marker.line || '').trim());
    const showLabel = isSelected || (showTextByZoom && hasLine);

    return (
      <React.Fragment key={`bus_group_${markerKey}`}>
        {isSelected ? (
          <CircleMarker
            center={[Number(marker.lat), Number(marker.lon)]}
            radius={18}
            pathOptions={{
              color: '#00e5ff',
              fillColor: '#00e5ff',
              fillOpacity: 0.16,
              weight: 3,
              opacity: 0.95,
            }}
          />
        ) : null}

        <Marker
          position={[Number(marker.lat), Number(marker.lon)]}
          icon={createBusMarkerIcon({
            line: marker.line,
            isSelected,
            showLabel,
            directionType: marker.directionType,
          })}
          eventHandlers={{
            click: () => onRouteSelect?.(marker.routeId),
          }}
        >
          <Popup>
            <div style={{ minWidth: 230 }}>
              <strong>{hasLine ? `Linha ${marker.line}` : 'Ônibus ao vivo'}</strong>

              <br />

              {marker.itinerary ? (
                <span>{marker.itinerary}</span>
              ) : (
                <span>
                  {marker.fromStop || 'Origem'} → {marker.toStop || 'Destino'}
                </span>
              )}

              <div style={{ marginTop: 10 }}>
                {marker.vehicleNumber ? (
                  <>
                    <strong>Veículo:</strong> {marker.vehicleNumber}
                    <br />
                  </>
                ) : null}

                {marker.etaMinutes != null ? (
                  <>
                    <strong>Previsão:</strong>{' '}
                    {Number(marker.etaMinutes) <= 1 ? 'AGORA' : `${marker.etaMinutes} min`}
                    <br />
                  </>
                ) : null}

                {gpsUpdatedText ? (
                  <span style={{ fontSize: 12, opacity: 0.78 }}>{gpsUpdatedText}</span>
                ) : null}
              </div>
            </div>
          </Popup>
        </Marker>
      </React.Fragment>
    );
  });
}

function VisibleDfStopsLayer({ stops = [], hiddenStopKeys = new Set() }) {
  const map = useMap();
  const [viewport, setViewport] = useState(() => ({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
  }));

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        bounds: map.getBounds(),
        zoom: map.getZoom(),
      });
    };

    updateViewport();

    map.on('moveend', updateViewport);
    map.on('zoomend', updateViewport);

    return () => {
      map.off('moveend', updateViewport);
      map.off('zoomend', updateViewport);
    };
  }, [map]);

  const visibleStops = useMemo(() => {
    if (!viewport.bounds) return [];

    return stops.filter((stop) => {
      const lat = Number(stop.lat ?? stop.position?.lat);
      const lon = Number(stop.lon ?? stop.position?.lon);

      if (!isValidCoord(lat, lon)) return false;

      const key = `${lat.toFixed(6)}_${lon.toFixed(6)}`;
      if (hiddenStopKeys.has(key)) return false;

      return viewport.bounds.contains([lat, lon]);
    });
  }, [stops, viewport, hiddenStopKeys]).slice(0, 80);

  if (viewport.zoom < 14) return null;

  return visibleStops.map((stop) => {
    const lat = Number(stop.lat ?? stop.position?.lat);
    const lon = Number(stop.lon ?? stop.position?.lon);
    const name = stop.name || stop.stopName || 'Parada de ônibus';

    return (
      <Marker
        key={`df_stop_${stop.stopId || stop.id || `${lat}_${lon}`}`}
        position={[lat, lon]}
        icon={nearbyStopIcon}
      >
        <Popup>
          <div style={{ minWidth: 180 }}>
            <strong>{name}</strong>
            <br />
            {stop.stopId ? `Código: ${stop.stopId}` : 'Parada oficial do DF'}
            {stop.address ? (
              <>
                <br />
                {stop.address}
              </>
            ) : null}
          </div>
        </Popup>
      </Marker>
    );
  });
}

// Comentário humano: componente final do mapa Leaflet usado no card de ônibus e escolha no mapa.
export default function LeafletMap({
  center,
  markers = [],
  routes = [],
  userPosition = null,
  selectedRouteId = null,
  height = 430,
  isDark = false,
  allStops = [],
  pickedLocation = null,
  onPickLocation = null,
  pickingLocation = false,
  onTogglePickingLocation = null,
  focusMode = 'auto',
  maxMarkers = 24,
  onRouteSelect = null,
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15000);

    return () => clearInterval(timer);
  }, []);

  const safeCenter = useMemo(() => {
    if (center?.length === 2 && isValidCoord(center[1], center[0])) {
      return [Number(center[1]), Number(center[0])];
    }

    const firstMarker = markers.find((marker) => isValidCoord(marker.lat, marker.lon));

    if (firstMarker) {
      return [Number(firstMarker.lat), Number(firstMarker.lon)];
    }

    return [-15.7939, -47.8828];
  }, [center, markers]);

  const routeLines = useMemo(() => getRoutePolylines(routes), [routes]);
  const routeStops = useMemo(() => getStopsFromRoutes(routes), [routes]);

  const hiddenStopKeys = useMemo(() => {
  return new Set(
    routeStops.map((stop) => `${Number(stop.lat).toFixed(6)}_${Number(stop.lon).toFixed(6)}`)
  );
}, [routeStops]);

  const boardingStop = useMemo(() => {
  const firstRouteWithStop = routes.find(
    (route) => isValidCoord(route.nearestStopLat, route.nearestStopLon)
  );

  if (!firstRouteWithStop) return null;

  return {
    lat: Number(firstRouteWithStop.nearestStopLat),
    lon: Number(firstRouteWithStop.nearestStopLon),
    name: firstRouteWithStop.nearestStopName || firstRouteWithStop.fromStop || 'Parada de embarque',
  };
}, [routes]);

  const visibleMarkers = useMemo(
    () =>
      markers
        .map(normalizeDfPoint)
        .filter(Boolean)
        .slice(0, maxMarkers),
    [markers, maxMarkers]
  );

  return (
    <div
      style={{
        height,
        width: '100%',
        borderRadius: 18,
        overflow: 'hidden',
        position: 'relative',
        background: isDark ? '#020617' : '#e5e7eb',
      }}
    >
      <MapContainer
        center={safeCenter}
        zoom={15}
        scrollWheelZoom
        style={{
          height: '100%',
          width: '100%',
        }}
      >
<TileLayer
  attribution='&copy; OpenStreetMap contributors'
  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  className={isDark ? 'leaflet-dark-tiles' : ''}
/>
<PickLocationOnMap
  enabled={pickingLocation}
  onPickLocation={onPickLocation}
/>
<MapController
  center={center}
  markers={visibleMarkers}
  routeLines={routeLines}
  userPosition={userPosition}
  boardingStop={boardingStop}
  focusMode={focusMode}
/>

<FollowSelectedTarget
  markers={visibleMarkers}
  routes={routes}
  selectedRouteId={selectedRouteId}
/>

{pickedLocation && isValidCoord(pickedLocation.lat, pickedLocation.lon) && (
  <Marker
    position={[Number(pickedLocation.lat), Number(pickedLocation.lon)]}
    icon={userPickIcon}
    draggable
    eventHandlers={{
      dragend: (event) => {
        const marker = event.target;
        const position = marker.getLatLng();

        if (onPickLocation) {
          onPickLocation({
            lat: position.lat,
            lon: position.lng,
          });
        }
      },
    }}
  >
    <Popup>
      <strong>Local escolhido</strong>
      <br />
      Arraste o balão ou clique em outro ponto do mapa.
    </Popup>
  </Marker>
)}

{userPosition && isValidCoord(userPosition.lat, userPosition.lon) && (
  <>
    <CircleMarker
      center={[Number(userPosition.lat), Number(userPosition.lon)]}
      radius={16}
      pathOptions={{
        color: '#22d3ee',
        fillColor: '#22d3ee',
        fillOpacity: 0.18,
        weight: 2,
        opacity: 0.85,
      }}
    />

    <CircleMarker
      center={[Number(userPosition.lat), Number(userPosition.lon)]}
      radius={8}
      pathOptions={{
        color: '#ffffff',
        fillColor: '#00e5ff',
        fillOpacity: 1,
        weight: 3,
        opacity: 1,
      }}
    >
      <Popup>
        <strong>Origem da busca</strong>
        <br />
        Caminhe até a parada destacada
      </Popup>
    </CircleMarker>
  </>
)}



{userPosition &&
  boardingStop &&
  isValidCoord(userPosition.lat, userPosition.lon) &&
  isValidCoord(boardingStop.lat, boardingStop.lon) && (
    <Polyline
      positions={[
        [Number(userPosition.lat), Number(userPosition.lon)],
        [Number(boardingStop.lat), Number(boardingStop.lon)],
      ]}
      pathOptions={{
        color: '#00e5ff',
        weight: 4,
        opacity: 0.95,
        dashArray: '10 8',
      }}
    />
)}

{routeLines.map((route, index) => {
  const isSelected = route.id === selectedRouteId;

  // Comentário humano: rota principal fica azul forte; as outras ficam quase transparentes.
  // Se quiser deixar mais Google Maps ainda, mexe aqui: selectedColor, alternativeColor, weight e opacity.
  const selectedColor = '#1a73e8';
  const alternativeColor = '#93c5fd';

  return (
    <Polyline
      key={`route_${route.id || index}`}
      positions={route.points}
      pathOptions={{
        color: isSelected || (!selectedRouteId && index === 0) ? selectedColor : alternativeColor,
        weight: isSelected || (!selectedRouteId && index === 0) ? 6 : 4,
        opacity: isSelected || (!selectedRouteId && index === 0) ? 0.95 : 0.28,
      }}
      eventHandlers={{
        click: () => onRouteSelect?.(route.id),
      }}
    />
  );
})}
{selectedRouteId &&
  routes
    .filter((route) => route.id === selectedRouteId)
    .filter((route) =>
      isValidCoord(route.nearestStopLat, route.nearestStopLon)
    )
    .map((route) => (
      <CircleMarker
        key={`selected_route_stop_${route.id}`}
        center={[
          Number(route.nearestStopLat),
          Number(route.nearestStopLon),
        ]}
        radius={18}
        pathOptions={{
          color: '#22c55e',
          fillColor: '#22c55e',
          fillOpacity: 0.14,
          weight: 3,
          opacity: 0.95,
        }}
      />
    ))}

<VisibleDfStopsLayer
  stops={allStops}
  hiddenStopKeys={hiddenStopKeys}
/>

{routeStops.map((stop) => {
  const isBoarding = stop.type === 'boarding';
  const passingRoutes = stop.passingRoutes || [];

  return (
    <Marker
      key={`stop_${stop.id}`}
      position={[stop.lat, stop.lon]}
      icon={isBoarding ? boardingStopIcon : nearbyStopIcon}
    >
      <Popup>
        <div style={{ minWidth: 230 }}>
          <strong>
            {isBoarding ? 'Parada de embarque' : 'Parada próxima'}
          </strong>

          <br />
          {stop.name}

          {stop.distanceKm != null ? (
            <>
              <br />
              <span>{Number(stop.distanceKm).toFixed(1)} km da origem</span>
            </>
          ) : null}

          <div style={{ marginTop: 10 }}>
            <strong>Ônibus previstos:</strong>

            {passingRoutes.length ? (
              <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                {passingRoutes.map((route) => (
                  <div
                    key={`${stop.id}_${route.id}_${route.line}`}
                    style={{
                      padding: '7px 8px',
                      borderRadius: 10,
                      background: 'rgba(15, 23, 42, 0.75)',
                      border: '1px solid rgba(34, 211, 238, 0.22)',
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
  Linha {route.line}
  {route.etaMinutes != null ? (
    <>
      {' • '}
      {Number(route.etaMinutes) <= 1 ? 'AGORA' : `${route.etaMinutes} min`}
    </>
  ) : null}
</div>

                    <div style={{ fontSize: 11, opacity: 0.82 }}>
                      {route.fromStop} → {route.toStop}
                    </div>

                    {route.sentido ? (
                      <div style={{ fontSize: 11, opacity: 0.72 }}>
                        Sentido: {route.sentido}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                Nenhum ônibus previsto nesta busca.
              </div>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
})}

<BusMarkersLayer
  markers={visibleMarkers}
  selectedRouteId={selectedRouteId}
  now={now}
  onRouteSelect={onRouteSelect}
/>
</MapContainer>

{onTogglePickingLocation && (
  <button
    onClick={onTogglePickingLocation}
    style={{
      position: 'absolute',
      top: 10,
      right: 10,
      zIndex: 600,
      border: 'none',
      borderRadius: 999,
      padding: '10px 14px',
      fontSize: 12,
      fontWeight: 800,
      cursor: 'pointer',
      background: pickingLocation
        ? '#00e5ff'
        : isDark
          ? 'rgba(15,23,42,.92)'
          : 'rgba(255,255,255,.96)',
      color: pickingLocation
        ? '#001018'
        : isDark
          ? '#e5e7eb'
          : '#111827',
      boxShadow: '0 8px 20px rgba(0,0,0,.20)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}
    title="Escolher local no mapa"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s7-4.6 7-11a7 7 0 1 0-14 0c0 6.4 7 11 7 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
    </svg>
    <span>{pickingLocation ? 'Clique no mapa' : 'Escolher no mapa'}</span>
  </button>
)}

      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: 10,
          zIndex: 500,
          background: isDark ? 'rgba(15,23,42,.88)' : 'rgba(255,255,255,.92)',
          color: isDark ? '#e5e7eb' : '#111827',
          borderRadius: 999,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 800,
          boxShadow: '0 4px 14px rgba(0,0,0,.18)',
        }}
      >
{visibleMarkers.length} ônibus ao vivo • {(allStops?.length || routeStops.length)} paradas do DF
      </div>
    </div>
  );
}