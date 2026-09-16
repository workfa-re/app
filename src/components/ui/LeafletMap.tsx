"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";

const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const MAP_TILES = {
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
} as const;

interface LeafletMapProps {
    center: [number, number];
    zoom?: number;
    className?: string;
}

function MapUpdater({ center }: { center: [number, number] }) {
    const map = useMap();
    useEffect(() => {
        map.setView(center);
        map.invalidateSize();
    }, [map, center]);
    return null;
}

export default function LeafletMap({ center, zoom = 13, className }: LeafletMapProps) {
    const [isMounted, setIsMounted] = useState(false);
    const { resolvedTheme } = useTheme();
    const isLight = resolvedTheme === "light";
    const mapThemeClass = isLight ? "is-light" : "is-dark";

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return (
            <div className={`workfare-map-loading flex items-center justify-center ${className ?? ""}`}>
                <div className="flex flex-col items-center animate-pulse">
                    <MapPin size={24} className="mb-2 opacity-50" />
                    <span className="text-xs uppercase tracking-widest">Karte wird geladen...</span>
                </div>
            </div>
        );
    }

    return (
        <MapContainer
            center={center}
            zoom={zoom}
            minZoom={zoom - 3}
            maxZoom={18}
            scrollWheelZoom={true}
            className={`workfare-leaflet-map ${mapThemeClass} z-0 ${className ?? ""}`}
            style={{ height: "100%", width: "100%" }}
            dragging={true}
            zoomControl={false}
            doubleClickZoom={true}
            preferCanvas={true}
        >
            <TileLayer
                attribution={TILE_ATTRIBUTION}
                url={isLight ? MAP_TILES.light : MAP_TILES.dark}
            />
            <Circle
                center={center}
                pathOptions={{
                    fillColor: isLight ? "#2457d6" : "#6366f1",
                    fillOpacity: isLight ? 0.13 : 0.2,
                    color: isLight ? "#2457d6" : "#818cf8",
                    weight: isLight ? 1.5 : 1,
                    opacity: isLight ? 0.42 : 0.5,
                }}
                radius={800}
            />
            <CircleMarker
                center={center}
                pathOptions={{
                    fillColor: isLight ? "#2457d6" : "#818cf8",
                    fillOpacity: 1,
                    color: isLight ? "#ffffff" : "#f8fafc",
                    weight: 3,
                    opacity: 1,
                }}
                radius={8}
            />
            <MapUpdater center={center} />
        </MapContainer>
    );
}
