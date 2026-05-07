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

const createBusWithLineBadgeIcon = (line, isSelected = false, directionType = '') => {
  const colors = getLineBadgeColors(line);
  const safeLine = escapeHtml(line || 'BUS');
  const ringColor =
    directionType === 'ida'
      ? '#38bdf8'
      : directionType === 'volta'
        ? '#84cc16'
        : '#ffffff';

  const badgeWidth = isSelected ? 58 : 50;
  const badgeHeight = isSelected ? 24 : 21;
  const busSize = isSelected ? 34 : 28;
  const iconWidth = Math.max(badgeWidth + 8, busSize + 18);
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
        <div style="
          position: relative;
          z-index: 2;
          min-width: ${badgeWidth}px;
          height: ${badgeHeight}px;
          padding: 0 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          background: ${colors.background};
          color: ${colors.color};
          border: 2px solid ${ringColor};
          box-shadow: 0 5px 12px rgba(0,0,0,.35);
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

        <div style="
          position: relative;
          z-index: 0;
          margin-top: -1px;
          width: ${busSize}px;
          height: ${busSize}px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, .82);
          border: 2px solid rgba(255,255,255,.9);
          box-shadow: 0 8px 18px rgba(0,0,0,.38);
        ">
          <img src="${BUS_ICON_URL}" alt="Ã´nibus" style="
            width: ${Math.round(busSize * 0.72)}px;
            height: ${Math.round(busSize * 0.72)}px;
            display: block;
            object-fit: contain;
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
        fromStop: route.fromStop || route.nearestStopName || 'Parada prÃ³xima',
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
            name: stop.stopName || stop.name || 'Parada prÃ³xima',
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

function MapController({ center, markers, routeLines, userPosition, boardingStop }) {
  const map = useMap();
  const didInitialFitRef = useRef(false);

  useEffect(() => {
    if (didInitialFitRef.current) return;

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

    markers.forEach((marker) => {
      if (isValidCoord(marker.lat, marker.lon)) {
        boundsPoints.push([Number(marker.lat), Number(marker.lon)]);
      }
    });

    routeLines.forEach((route) => {
      route.points.forEach((point) => boundsPoints.push(point));
    });

    if (boundsPoints.length >= 2) {
      map.fitBounds(boundsPoints, {
        padding: [35, 35],
        maxZoom: 16,
      });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 15);
    }

    didInitialFitRef.current = true;
  }, [center, markers, routeLines, userPosition, boardingStop, map]);

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
    return `Atualizado hÃ¡ ${seconds} seg`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes === 1) {
    return 'Atualizado hÃ¡ 1 min';
  }

  return `Atualizado hÃ¡ ${minutes} min`;
};
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
  }, [stops, viewport, hiddenStopKeys]);

  if (viewport.zoom < 13) return null;

  return visibleStops.map((stop) => {
    const lat = Number(stop.lat ?? stop.position?.lat);
    const lon = Number(stop.lon ?? stop.position?.lon);
    const name = stop.name || stop.stopName || 'Parada de Ã´nibus';

    return (
      <Marker
        key={`df_stop_${stop.stopId || stop.id || `${lat}_${lon}`}`}
        position={[lat, lon]}
        icon={nearbyStopIcon || fallbackStopIcon}
      >
        <Popup>
          <div style={{ minWidth: 180 }}>
            <strong>{name}</strong>
            <br />
            {stop.stopId ? `CÃ³digo: ${stop.stopId}` : 'Parada oficial do DF'}
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
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

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
        .filter((marker) => isValidCoord(marker.lat, marker.lon))
        .slice(0, 8),
    [markers]
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
      Arraste o balÃ£o ou clique em outro ponto do mapa.
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
        Caminhe atÃ© a parada destacada
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

        {routeLines.map((route) => (
          <Polyline
            key={`route_${route.id}`}
            positions={route.points}
            pathOptions={{
              weight: 5,
              opacity: 0.85,
            }}
          />
        ))}
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
            {isBoarding ? 'Parada de embarque' : 'Parada prÃ³xima'}
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
            <strong>Ã”nibus previstos:</strong>

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
      {' â€¢ '}
      {Number(route.etaMinutes) <= 1 ? 'AGORA' : `${route.etaMinutes} min`}
    </>
  ) : null}
</div>

                    <div style={{ fontSize: 11, opacity: 0.82 }}>
                      {route.fromStop} â†’ {route.toStop}
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
                Nenhum Ã´nibus previsto nesta busca.
              </div>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
})}
{visibleMarkers.map((marker, index) => {
  const gpsUpdatedText = formatGpsUpdatedAt(marker.gpsTimestamp, now);
  const isSelected = marker.routeId === selectedRouteId;
  const markerKey = marker.id || `bus_${index}`;

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
        icon={createBusWithLineBadgeIcon(marker.line, isSelected, marker.directionType)}
      >
        <Popup>
          <div style={{ minWidth: 230 }}>
            <strong>Linha {marker.line || 'Ã´nibus'}</strong>

            <br />

            {marker.itinerary ? (
              <span>{marker.itinerary}</span>
            ) : (
              <span>
                {marker.fromStop || 'Origem'} â†’ {marker.toStop || 'Destino'}
              </span>
            )}

            <div style={{ marginTop: 10 }}>
              {marker.vehicleNumber ? (
                <>
                  <strong>VeÃ­culo:</strong> {marker.vehicleNumber}
                  <br />
                </>
              ) : null}

              {marker.etaMinutes != null ? (
                <>
                  <strong>Passa na parada em:</strong>{' '}
                  {Number(marker.etaMinutes) <= 1 ? 'AGORA' : `${marker.etaMinutes} min`}
                  <br />
                </>
              ) : null}

              {marker.sentido ? (
                <>
                  <strong>Sentido:</strong> {marker.sentido}
                  <br />
                </>
              ) : null}

              <strong>Velocidade:</strong> {Math.round(marker.speed || 0)} km/h

              {gpsUpdatedText ? (
                <>
                  <br />
                  <span style={{ opacity: 0.78 }}>
                    {gpsUpdatedText}
                  </span>
                </>
              ) : null}

              {marker.isGpsOnly ? (
                <>
                  <br />
                  <span style={{ opacity: 0.72 }}>
                    PrevisÃ£o estimada por GPS
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </Popup>
      </Marker>
    </React.Fragment>
  );
})}
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
    <span>ðŸ“</span>
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
{visibleMarkers.length} Ã´nibus ao vivo â€¢ {(allStops?.length || routeStops.length)} paradas do DF
      </div>
    </div>
  );
}