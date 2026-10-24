"use client";

import { useState, useEffect, useRef } from "react";
import { Check, MapPin, Search, Loader2, X } from "lucide-react";
import {
  getResultCity,
  getResultPostcode,
  getSelectedLocationLabel,
  type LocationSearchResult,
} from "@/lib/locationSearch";
import { cn } from "@/lib/utils";

export type LocationDetails = {
  address_line1: string;
  city: string;
  postal_code: string;
  postcode?: string;
  lat: number;
  lng: number;
  lon?: number;
  public_label: string;
  state?: string;
  house_number?: string;
};

interface LocationAutocompleteProps {
  inputId?: string;
  onSelect: (location: LocationDetails) => void;
  onInputChange?: () => void;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
  cityOnly?: boolean;
  autoFocus?: boolean;
}

export function LocationAutocomplete({ inputId = "location-search", onSelect, onInputChange, defaultValue = "", className, placeholder, cityOnly = false, autoFocus = false }: LocationAutocompleteProps) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedLabelRef = useRef(defaultValue);
  const searchVersionRef = useRef(0);

  useEffect(() => {
    if (!autoFocus) return;

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 3) {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    if (selectedLabelRef.current === query) {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const searchVersion = ++searchVersionRef.current;

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const url = new URL("/api/location/search", window.location.origin);
        url.searchParams.set("q", query);
        if (cityOnly) {
          url.searchParams.set("cityOnly", "true");
        }

        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Location search failed");
        }
        const data = await response.json();
        const nextResults = Array.isArray(data) ? data : [];

        if (searchVersion !== searchVersionRef.current) return;

        setResults(nextResults);
        setIsOpen(nextResults.length > 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setIsOpen(false);
      } finally {
        if (searchVersion === searchVersionRef.current) {
          setIsLoading(false);
        }
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, cityOnly]);

  const handleSelect = (item: LocationSearchResult) => {
    const addr = item.address || {};
    const street = addr.road || addr.pedestrian || addr.footway || "";
    let houseNumber = addr.house_number ? String(addr.house_number) : "";

    if (!houseNumber && query) {
      const match = query.match(/\s(\d+[a-zA-Z]?)$/);
      if (match) {
        houseNumber = match[1];
      }
    }

    const fullStreet = street + (houseNumber ? ` ${houseNumber}` : "");
    const city = getResultCity(item);
    const zip = getResultPostcode(item);
    const localityLabel = getSelectedLocationLabel(item, query, cityOnly);
    const label = fullStreet ? `${fullStreet}, ${localityLabel}` : localityLabel;

    const details: LocationDetails = {
      address_line1: street,
      city: city,
      postal_code: zip,
      postcode: zip,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      lon: parseFloat(item.lon),
      public_label: label,
      state: addr.state,
      house_number: houseNumber
    };

    selectedLabelRef.current = label;
    searchVersionRef.current += 1;
    setQuery(label);
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    onSelect(details);
    inputRef.current?.blur();
  };

  const getResultSubtitle = (item: LocationSearchResult) => {
    const addr = item.address || {};
    const city = getResultCity(item);
    const postcode = getResultPostcode(item);
    const region = postcode
      ? addr.state || addr.country || ""
      : addr.state && addr.state !== city ? addr.state : addr.country || "";

    return [postcode, region].filter(Boolean).join(" ");
  };

  return (
    <div ref={wrapperRef} className={cn("location-search-root relative", isOpen && "is-open", className)}>
      <div className="relative flex items-center">
        <div className="location-search-icon absolute left-4 pointer-events-none z-10">
          {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          name="location"
          autoComplete="off"
          type="text"
          value={query}
          onChange={(e) => {
            const nextQuery = e.target.value;
            selectedLabelRef.current = "";
            onInputChange?.();
            setQuery(nextQuery);
            setIsOpen(false);
          }}
          onFocus={() => {
            if (query.trim().length >= 3 && selectedLabelRef.current !== query && results.length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder || (cityOnly ? "Stadt eingeben (z.B. Bonn)..." : "Adresse suchen (z.B. Hauptstraße 12)...")}
          className="location-search-control h-14 w-full rounded-2xl border pl-12 pr-12 text-base font-medium shadow-sm transition-[background-color,border-color,box-shadow,color] duration-200 ease-out focus:outline-none focus:ring-2"
        />
        {query && (
          <button
            type="button"
            aria-label="Suche leeren"
            onClick={() => {
              selectedLabelRef.current = "";
              searchVersionRef.current += 1;
              onInputChange?.();
              setQuery("");
              setResults([]);
              setIsOpen(false);
              setIsLoading(false);
            }}
            className="location-search-clear absolute right-2 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150 ease-out"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="location-search-menu absolute mt-2 w-full overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-in fade-in zoom-in-95 duration-200">
          <div className="max-h-[280px] overflow-y-auto p-2 space-y-1">
            {results.map((item, index) => (
              <button
                key={`${item.lat}-${item.lon}-${item.display_name}-${index}`}
                type="button"
                onClick={() => handleSelect(item)}
                className="location-search-result group flex w-full items-start justify-between gap-3 rounded-xl p-3 text-left transition-colors focus:outline-none"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="location-search-result-icon mt-1 rounded-full p-2 transition-[background-color,color] duration-150 ease-out">
                    <MapPin size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="location-search-result-title truncate text-sm font-bold transition-colors">
                      {cityOnly
                        ? getResultCity(item)
                        : (item.address?.road || item.display_name.split(",")[0])}
                      {!cityOnly && item.address?.house_number && <span className="location-search-result-accent"> {item.address.house_number}</span>}
                    </div>
                    <div className="location-search-result-subtitle mt-1 truncate text-xs font-medium">
                      {cityOnly
                        ? getResultSubtitle(item)
                        : `${getResultPostcode(item)} ${getResultCity(item)}, ${item.address?.country}`.trim()
                      }
                    </div>
                  </div>
                </div>
                <div className="location-search-result-check mt-2 flex h-6 w-6 shrink-0 scale-[0.96] items-center justify-center rounded-full border opacity-0 transition-[opacity,scale,background-color,border-color,color] duration-150 ease-out group-hover:scale-100 group-hover:opacity-100 group-focus:scale-100 group-focus:opacity-100">
                  <Check size={14} />
                </div>
              </button>
            ))}
          </div>
          {!cityOnly && (
            <div className="location-search-menu-footer flex items-center justify-between border-t px-4 py-2 text-[10px] font-bold uppercase tracking-wider">
              Deutschlandweit
            </div>
          )}
        </div>
      )}
    </div>
  );
}
