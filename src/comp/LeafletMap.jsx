import React, { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
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

const busIcon = createIcon(BUS_ICON_URL, 26, 26);
const stopIcon = createIcon(BUS_STOP_ICON_URL, 22, 22);

const fallbackBusIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: #2563eb;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 900;
      border: 2px solid white;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
    ">🚌</div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const fallbackStopIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: #16a34a;
      border: 2px solid white;
      box-shadow: 0 3px 8px rgba(0,0,0,.25);
    "></div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

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

  routes.forEach((route) => {
    if (isValidCoord(route.nearestStopLat, route.nearestStopLon)) {
      const key = `${route.nearestStopLat}_${route.nearestStopLon}`;

      map.set(key, {
        id: key,
        name: route.nearestStopName || route.fromStop || 'Parada de ônibus',
        lat: Number(route.nearestStopLat),
        lon: Number(route.nearestStopLon),
        line: route.line,
      });
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

export default function LeafletMap({
  center,
  markers = [],
  routes = [],
  userPosition = null,
  height = 360,
  isDark = false,
}) {
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
/>

<MapController
  center={center}
  markers={visibleMarkers}
  routeLines={routeLines}
  userPosition={userPosition}
  boardingStop={boardingStop}
/>
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
        <strong>Você está aqui</strong>
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

        {routeStops.map((stop) => (
          <Marker
            key={`stop_${stop.id}`}
            position={[stop.lat, stop.lon]}
            icon={stopIcon || fallbackStopIcon}
          >
            <Popup>
              <strong>{stop.name}</strong>
              <br />
              Linha: {stop.line}
            </Popup>
          </Marker>
        ))}

        {visibleMarkers.map((marker, index) => (
          <Marker
            key={marker.id || `bus_${index}`}
            position={[Number(marker.lat), Number(marker.lon)]}
            icon={busIcon || fallbackBusIcon}
          >
            <Popup>
              <strong>Linha {marker.line || 'ônibus'}</strong>
              <br />
              {marker.vehicleNumber ? `Veículo ${marker.vehicleNumber}` : 'Veículo ao vivo'}
              {marker.popup ? (
                <>
                  <br />
                  {marker.popup}
                </>
              ) : null}
            </Popup>
          </Marker>
        ))}
      </MapContainer>

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
        {visibleMarkers.length} ônibus ao vivo • {routeStops.length} paradas
      </div>
    </div>
  );
}