"use client";

import { useEffect, useMemo } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import { Minus, Plus } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";
import "leaflet/dist/leaflet.css";
import styles from "./JobLocationMap.module.css";

const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function MapControls({ center }: { center: [number, number] }) {
    const map = useMap();
    useEffect(() => {
        map.attributionControl.setPrefix(false);
        map.setView(center);
        const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [center, map]);

    return <div className={styles.controls}>
        <button type="button" onClick={() => map.zoomIn()} aria-label="Karte vergrößern"><Plus size={19} aria-hidden="true" /></button>
        <button type="button" onClick={() => map.zoomOut()} aria-label="Karte verkleinern"><Minus size={19} aria-hidden="true" /></button>
    </div>;
}

export default function JobLocationMap({ latitude, longitude }: { latitude: number; longitude: number }) {
    const { resolvedTheme } = useTheme();
    const light = resolvedTheme === "light";
    const center = useMemo<[number, number]>(() => [latitude, longitude], [latitude, longitude]);
    const color = light ? "#365c4e" : "#adc9be";

    return <MapContainer center={center} zoom={13} minZoom={10} maxZoom={16}
        scrollWheelZoom={false} zoomControl={false} doubleClickZoom={false}
        className={`${styles.canvas} ${light ? "is-light" : "is-dark"}`}>
        <TileLayer attribution={attribution} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Circle center={center} radius={800} pathOptions={{ color, weight: 1, opacity: .45, fillColor: color, fillOpacity: light ? .09 : .12 }} />
        <CircleMarker center={center} radius={7} pathOptions={{ color: light ? "#ffffff" : "#101814", weight: 3, fillColor: color, fillOpacity: 1 }} />
        <MapControls center={center} />
    </MapContainer>;
}
