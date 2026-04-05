"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { FuelPrice, Trip, Vehicle } from "@/lib/types";

type TripSummary = {
  distanceMeters: number;
  durationSeconds: number;
  fuelLiters: number | null;
  fuelCost: number | null;
};

const DEFAULT_CENTER = { lat: 19.4326, lng: -99.1332 };
const DEFAULT_VEHICLE = { name: "Auto", consumptionLPer100km: 8.5 };
const DEFAULT_PRICE = { label: "Gasolina regular", pricePerLiter: 23.5, currency: "MXN" };
const MAP_STYLES: Record<string, google.maps.MapTypeStyle[] | null> = {
  standard: null,
  silver: [
    { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
  ],
  dark: [
    { elementType: "geometry", stylers: [{ color: "#212121" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#373737" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  ],
  retro: [
    { elementType: "geometry", stylers: [{ color: "#ebe3cd" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#523735" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#f5f1e6" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#b9d3c2" }] },
  ],
};

const STORAGE_KEYS = {
  origin: "shellmap.origin",
  destination: "shellmap.destination",
  stops: "shellmap.stops",
  optimize: "shellmap.optimizeStops",
  vehicleId: "shellmap.vehicleId",
  priceId: "shellmap.priceId",
  tripName: "shellmap.tripName",
  favorites: "shellmap.favorites",
  autoCalc: "shellmap.autoCalc",
  favoriteRoutes: "shellmap.favoriteRoutes",
  mapStyle: "shellmap.mapStyle",
  panelOpen: "shellmap.panelOpen",
};

function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.google?.maps) {
    return Promise.resolve();
  }

  const existing = document.getElementById("google-maps") as HTMLScriptElement | null;
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Maps failed")));
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "google-maps";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Maps failed"));
    document.head.appendChild(script);
  });
}

function currencyForCountry(countryCode: string) {
  const map: Record<string, string> = {
    MX: "MXN",
    AR: "ARS",
    CL: "CLP",
    CO: "COP",
    PE: "PEN",
    UY: "UYU",
    BO: "BOB",
    PY: "PYG",
    DO: "DOP",
  };

  return map[countryCode] ?? null;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function weatherLabel(code: number) {
  const map: Record<number, string> = {
    0: "Despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla helada",
    51: "Llovizna ligera",
    53: "Llovizna",
    55: "Llovizna intensa",
    61: "Lluvia ligera",
    63: "Lluvia",
    65: "Lluvia intensa",
    71: "Nieve ligera",
    73: "Nieve",
    75: "Nieve intensa",
    80: "Chubascos",
    81: "Chubascos fuertes",
    95: "Tormenta",
  };

  return map[code] ?? "Clima";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export default function MapPlanner() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const hasApiKey = Boolean(apiKey);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const directionsService = useRef<google.maps.DirectionsService | null>(null);
  const directionsRenderer = useRef<google.maps.DirectionsRenderer | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const pinMarker = useRef<google.maps.Marker | null>(null);
  const stationMarkers = useRef<google.maps.Marker[]>([]);
  const originInputRef = useRef<HTMLInputElement | null>(null);
  const destinationInputRef = useRef<HTMLInputElement | null>(null);
  const stopInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const autocompleteRefs = useRef<google.maps.places.Autocomplete[]>([]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fuelPrices, setFuelPrices] = useState<FuelPrice[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  const [vehicleName, setVehicleName] = useState("");
  const [vehicleConsumption, setVehicleConsumption] = useState("");
  const [vehicleCity, setVehicleCity] = useState("");
  const [vehicleHighway, setVehicleHighway] = useState("");
  const [priceLabel, setPriceLabel] = useState("");
  const [priceValue, setPriceValue] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("MXN");

  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedPriceId, setSelectedPriceId] = useState("");

  const [tripName, setTripName] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [stops, setStops] = useState<string[]>([]);
  const [optimizeStops, setOptimizeStops] = useState(true);
  const [driveMode, setDriveMode] = useState<"mixed" | "city" | "highway">("mixed");
  const [cityRatio, setCityRatio] = useState(0.6);

  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pinAddress, setPinAddress] = useState<string | null>(null);
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [autoCalculate, setAutoCalculate] = useState(true);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isRouting, setIsRouting] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [autoCurrency, setAutoCurrency] = useState<string | null>(null);
  const [autoCountry, setAutoCountry] = useState<string | null>(null);
  const [mapStyleKey, setMapStyleKey] = useState("standard");
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [stationRadiusKm, setStationRadiusKm] = useState(5);
  const [stationLimit, setStationLimit] = useState(8);
  const [isFetchingStations, setIsFetchingStations] = useState(false);
  const [stations, setStations] = useState<
    Array<{ id: string; name: string; address: string; lat: number; lng: number }>
  >([]);
  const [routeSteps, setRouteSteps] = useState<string[]>([]);
  const [routeTrafficSeconds, setRouteTrafficSeconds] = useState<number | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [routeCount, setRouteCount] = useState(1);
  const [lastDirections, setLastDirections] =
    useState<google.maps.DirectionsResult | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [tripQuery, setTripQuery] = useState("");
  const [favoriteRoutes, setFavoriteRoutes] = useState<
    Array<{ name: string; origin: string; destination: string; stops: string[] }>
  >([]);
  const [pinDistanceMeters, setPinDistanceMeters] = useState<number | null>(null);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [isMinimal, setIsMinimal] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechIndex, setSpeechIndex] = useState(0);
  const [weather, setWeather] = useState<
    | { tempC: number; windKph: number; code: number; label: string }
    | null
  >(null);
  const [is3D, setIs3D] = useState(false);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle._id === selectedVehicleId) || null,
    [vehicles, selectedVehicleId]
  );
  const selectedPrice = useMemo(
    () => fuelPrices.find((price) => price._id === selectedPriceId) || null,
    [fuelPrices, selectedPriceId]
  );

  useEffect(() => {
    let active = true;

    async function setupMap() {
      if (!hasApiKey || !mapRef.current) {
        return;
      }

      try {
        await loadGoogleMaps(apiKey);
        if (!active || !mapRef.current) {
          return;
        }

        if (!mapInstance.current) {
          mapInstance.current = new google.maps.Map(mapRef.current, {
            center: DEFAULT_CENTER,
            zoom: 6,
            draggable: true,
            gestureHandling: "greedy",
          });
          setIsMapReady(true);
          directionsService.current = new google.maps.DirectionsService();
          directionsRenderer.current = new google.maps.DirectionsRenderer({
            suppressMarkers: false,
            preserveViewport: false,
          });
          directionsRenderer.current.setMap(mapInstance.current);
          placesService.current = new google.maps.places.PlacesService(
            mapInstance.current
          );

          mapInstance.current.addListener("click", (event) => {
            if (!event.latLng) {
              return;
            }

            const lat = event.latLng.lat();
            const lng = event.latLng.lng();
            void updatePinFromLatLng(lat, lng);
          });

          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                mapInstance.current?.setCenter({ lat, lng });
                mapInstance.current?.setZoom(13);

                if (!origin.trim()) {
                  const geocoder = new google.maps.Geocoder();
                  const result = await geocoder.geocode({ location: { lat, lng } });
                  const place = result.results?.[0]?.formatted_address;
                  if (place) {
                    setOrigin(place);
                  }
                }
              },
              () => {
                // ignore location errors
              },
              { enableHighAccuracy: true, timeout: 8000 }
            );
          }
        }
      } catch (error) {
        setStatus("No se pudo cargar Google Maps.");
      }
    }

    setupMap();

    return () => {
      active = false;
    };
  }, [apiKey, hasApiKey]);

  useEffect(() => {
    let stored = localStorage.getItem("shellmap.ownerId");
    if (!stored) {
      stored = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem("shellmap.ownerId", stored);
    }
    setOwnerId(stored);
  }, []);

  useEffect(() => {
    const savedOrigin = localStorage.getItem(STORAGE_KEYS.origin);
    const savedDestination = localStorage.getItem(STORAGE_KEYS.destination);
    const savedStops = localStorage.getItem(STORAGE_KEYS.stops);
    const savedOptimize = localStorage.getItem(STORAGE_KEYS.optimize);
    const savedVehicle = localStorage.getItem(STORAGE_KEYS.vehicleId);
    const savedPrice = localStorage.getItem(STORAGE_KEYS.priceId);
    const savedTripName = localStorage.getItem(STORAGE_KEYS.tripName);
    const savedFavorites = localStorage.getItem(STORAGE_KEYS.favorites);
    const savedAutoCalc = localStorage.getItem(STORAGE_KEYS.autoCalc);
    const savedRoutes = localStorage.getItem(STORAGE_KEYS.favoriteRoutes);
    const savedStyle = localStorage.getItem(STORAGE_KEYS.mapStyle);
    const savedPanel = localStorage.getItem(STORAGE_KEYS.panelOpen);
    const savedTheme = localStorage.getItem("shellmap.theme");

    if (savedOrigin) setOrigin(savedOrigin);
    if (savedDestination) setDestination(savedDestination);
    if (savedStops) {
      try {
        const parsed = JSON.parse(savedStops);
        if (Array.isArray(parsed)) {
          setStops(parsed.filter((item) => typeof item === "string"));
        }
      } catch {
        // ignore
      }
    }
    if (savedOptimize) setOptimizeStops(savedOptimize === "true");
    if (savedVehicle) setSelectedVehicleId(savedVehicle);
    if (savedPrice) setSelectedPriceId(savedPrice);
    if (savedTripName) setTripName(savedTripName);
    if (savedFavorites) {
      try {
        const parsed = JSON.parse(savedFavorites);
        if (Array.isArray(parsed)) {
          setFavorites(parsed.filter((item) => typeof item === "string"));
        }
      } catch {
        // ignore
      }
    }
    if (savedAutoCalc) setAutoCalculate(savedAutoCalc === "true");
    if (savedStyle) setMapStyleKey(savedStyle);
    if (savedPanel) setIsPanelOpen(savedPanel === "true");
    if (savedTheme === "dark" || savedTheme === "light") setThemeMode(savedTheme);
    if (savedRoutes) {
      try {
        const parsed = JSON.parse(savedRoutes);
        if (Array.isArray(parsed)) {
          setFavoriteRoutes(
            parsed.filter(
              (item) =>
                item &&
                typeof item.name === "string" &&
                typeof item.origin === "string" &&
                typeof item.destination === "string" &&
                Array.isArray(item.stops)
            )
          );
        }
      } catch {
        // ignore
      }
    }

    const params = new URLSearchParams(window.location.search);
    const paramOrigin = params.get("origin");
    const paramDestination = params.get("destination");
    const paramStops = params.get("stops");
    const paramMinimal = params.get("minimal");
    if (paramOrigin) setOrigin(paramOrigin);
    if (paramDestination) setDestination(paramDestination);
    if (paramStops) {
      const split = paramStops
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
      if (split.length > 0) setStops(split);
    }
    if (paramMinimal === "1") setIsMinimal(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.origin, origin);
    localStorage.setItem(STORAGE_KEYS.destination, destination);
    localStorage.setItem(STORAGE_KEYS.stops, JSON.stringify(stops));
    localStorage.setItem(STORAGE_KEYS.optimize, String(optimizeStops));
    localStorage.setItem(STORAGE_KEYS.vehicleId, selectedVehicleId);
    localStorage.setItem(STORAGE_KEYS.priceId, selectedPriceId);
    localStorage.setItem(STORAGE_KEYS.tripName, tripName);
  }, [origin, destination, stops, optimizeStops, selectedVehicleId, selectedPriceId, tripName]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(favorites));
    localStorage.setItem(STORAGE_KEYS.autoCalc, String(autoCalculate));
  }, [favorites, autoCalculate]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.favoriteRoutes, JSON.stringify(favoriteRoutes));
    localStorage.setItem(STORAGE_KEYS.mapStyle, mapStyleKey);
    localStorage.setItem(STORAGE_KEYS.panelOpen, String(isPanelOpen));
  }, [favoriteRoutes, mapStyleKey, isPanelOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("shellmap.theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!ownerId) {
      return;
    }
    async function loadData() {
      const [vehiclesRes, pricesRes, tripsRes] = await Promise.all([
        fetch(`/api/vehicles?ownerId=${encodeURIComponent(ownerId)}`),
        fetch(`/api/prices?ownerId=${encodeURIComponent(ownerId)}`),
        fetch(`/api/trips?ownerId=${encodeURIComponent(ownerId)}`),
      ]);

      const vehiclesData = vehiclesRes.ok ? ((await vehiclesRes.json()) as Vehicle[]) : [];
      const pricesData = pricesRes.ok ? ((await pricesRes.json()) as FuelPrice[]) : [];
      const tripsData = tripsRes.ok ? ((await tripsRes.json()) as Trip[]) : [];

      setVehicles(vehiclesData);
      setFuelPrices(pricesData);
      setTrips(tripsData);

      if (vehiclesData.length === 0) {
        const created = await createDefaultVehicle();
        if (created?._id) {
          setVehicles([created]);
          setSelectedVehicleId(created._id);
        }
      }

      if (pricesData.length === 0) {
        const created = await createDefaultPrice();
        if (created?._id) {
          setFuelPrices([created]);
          setSelectedPriceId(created._id);
        }
      }
    }

    loadData();
  }, [ownerId]);

  useEffect(() => {
    if (!hasApiKey || !window.google?.maps?.places) {
      return;
    }

    autocompleteRefs.current.forEach((instance) => instance.unbindAll());
    autocompleteRefs.current = [];

    const attach = (
      input: HTMLInputElement | null,
      onUpdate: (value: string) => void
    ) => {
      if (!input) return;
      const autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ["formatted_address", "name"],
      });
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        const value = place?.formatted_address || place?.name || input.value;
        if (value) {
          onUpdate(value);
        }
      });
      autocompleteRefs.current.push(autocomplete);
    };

    attach(originInputRef.current, setOrigin);
    attach(destinationInputRef.current, setDestination);
    stopInputRefs.current.forEach((input, index) => {
      attach(input, (value) => handleStopChange(index, value));
    });
  }, [hasApiKey, stops.length]);

  useEffect(() => {
    if (!autoCalculate) {
      return;
    }

    if (!origin.trim() || !destination.trim()) {
      return;
    }

    if (!directionsService.current || !directionsRenderer.current) {
      return;
    }

    if (isRouting) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void handleRoute();
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [origin, destination, stops, optimizeStops, autoCalculate, isRouting]);

  useEffect(() => {
    if (!mapInstance.current) {
      return;
    }

    mapInstance.current.setOptions({ styles: MAP_STYLES[mapStyleKey] ?? null });
  }, [mapStyleKey]);

  useEffect(() => {
    if (!lastDirections) {
      return;
    }
    applyRouteResult(lastDirections, routeIndex);
  }, [lastDirections, routeIndex]);

  useEffect(() => {
    if (!mapInstance.current) {
      return;
    }
    if (is3D) {
      mapInstance.current.setTilt(45);
      mapInstance.current.setHeading(45);
    } else {
      mapInstance.current.setTilt(0);
      mapInstance.current.setHeading(0);
    }
  }, [is3D]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (isTyping) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") {
        event.preventDefault();
        void handleRoute();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveTrip();
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
        event.preventDefault();
        setIsPanelOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRoute, handleSaveTrip]);

  useEffect(() => {
    if (!showStations) {
      clearStations();
      setStations([]);
      setIsFetchingStations(false);
      return;
    }

    if (pinCoords) {
      void fetchStations(pinCoords.lat, pinCoords.lng, stationRadiusKm, stationLimit);
    }
  }, [showStations, pinCoords, stationRadiusKm, stationLimit]);

  useEffect(() => {
    if (!pinCoords) {
      setWeather(null);
      return;
    }

    const fetchWeather = async () => {
      try {
        const response = await fetch(
          `/api/weather?lat=${pinCoords.lat}&lng=${pinCoords.lng}`
        );
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const current = data.current;
        if (!current) {
          setWeather(null);
          return;
        }
        setWeather({
          tempC: current.temperature,
          windKph: current.windspeed,
          code: current.weathercode,
          label: weatherLabel(current.weathercode),
        });
      } catch {
        // ignore
      }
    };

    fetchWeather();
  }, [pinCoords]);

  async function updatePinFromLatLng(lat: number, lng: number) {
    if (!window.google?.maps) {
      return;
    }

    const geocoder = new google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({ location: { lat, lng } });
      const first = result.results?.[0];
      const address =
        first?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setPinAddress(address);
      setPinCoords({ lat, lng });
      setDestination(address);

      const countryComponent = first?.address_components?.find((component) =>
        component.types.includes("country")
      );
      const countryCode = countryComponent?.short_name ?? null;
      const currency = countryCode ? currencyForCountry(countryCode) : null;
      if (countryCode) {
        setAutoCountry(countryCode);
      }
      if (currency) {
        setAutoCurrency(currency);
        if (!selectedPriceId && priceCurrency === DEFAULT_PRICE.currency) {
          setPriceCurrency(currency);
        }
      }

      if (!pinMarker.current) {
        pinMarker.current = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstance.current ?? undefined,
          draggable: true,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#111111",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
        pinMarker.current.addListener("dragend", (event) => {
          const nextLat = event.latLng?.lat();
          const nextLng = event.latLng?.lng();
          if (nextLat !== undefined && nextLng !== undefined) {
            void updatePinFromLatLng(nextLat, nextLng);
          }
        });
      } else {
        pinMarker.current.setPosition({ lat, lng });
      }

      if (showStations) {
        void fetchStations(lat, lng, stationRadiusKm, stationLimit);
      }
    } catch {
      setStatus("No se pudo obtener la direccion del punto.");
    }
  }

  function clearStations() {
    stationMarkers.current.forEach((marker) => marker.setMap(null));
    stationMarkers.current = [];
  }

  async function fetchStations(
    lat: number,
    lng: number,
    radiusKm: number,
    limit: number
  ) {
    if (!placesService.current || !mapInstance.current) {
      setIsFetchingStations(false);
      return;
    }

    setIsFetchingStations(true);
    clearStations();
    setStations([]);

    const request: google.maps.places.PlaceSearchRequest = {
      location: new google.maps.LatLng(lat, lng),
      radius: radiusKm * 1000,
      type: "gas_station",
    };

    placesService.current.nearbySearch(request, (results, status) => {
      setIsFetchingStations(false);
      if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
        return;
      }

      const nextStations = results
        .map((place) => {
          const location = place.geometry?.location;
          const latValue = location?.lat();
          const lngValue = location?.lng();
          if (latValue === undefined || lngValue === undefined) {
            return null;
          }
          return {
            id: place.place_id ?? `${latValue}-${lngValue}`,
            name: place.name ?? "Gasolinera",
            address: place.vicinity ?? place.name ?? "",
            lat: latValue,
            lng: lngValue,
          };
        })
        .filter((item): item is {
          id: string;
          name: string;
          address: string;
          lat: number;
          lng: number;
        } => Boolean(item))
        .slice(0, limit);

      setStations(nextStations);

      if (!infoWindowRef.current) {
        infoWindowRef.current = new google.maps.InfoWindow();
      }

      stationMarkers.current = nextStations.map((station) => {
        const marker = new google.maps.Marker({
          position: { lat: station.lat, lng: station.lng },
          map: mapInstance.current ?? undefined,
          label: {
            text: "G",
            color: "white",
            fontSize: "12px",
          },
        });

        marker.addListener("click", () => {
          infoWindowRef.current?.setContent(
            `<div style="font-family: sans-serif;"><strong>${station.name}</strong><br/>${station.address}</div>`
          );
          infoWindowRef.current?.open({ anchor: marker, map: mapInstance.current ?? undefined });
        });

        return marker;
      });
    });
  }

  async function createDefaultVehicle() {
    const response = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DEFAULT_VEHICLE, ownerId }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as Vehicle;
  }

  async function createDefaultPrice() {
    const currency = autoCurrency ?? DEFAULT_PRICE.currency;
    const response = await fetch("/api/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DEFAULT_PRICE, currency, ownerId }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as FuelPrice;
  }

  function resolveConsumption(vehicle: Vehicle | null) {
    if (!vehicle) return null;
    const city = vehicle.consumptionCityLPer100km;
    const highway = vehicle.consumptionHighwayLPer100km;
    if (driveMode === "city" && city) return city;
    if (driveMode === "highway" && highway) return highway;
    if (driveMode === "mixed" && city && highway) {
      return cityRatio * city + (1 - cityRatio) * highway;
    }
    return vehicle.consumptionLPer100km;
  }

  async function handleAddVehicle() {
    setStatus(null);
    const consumption = Number(vehicleConsumption);
    const consumptionCity = vehicleCity ? Number(vehicleCity) : undefined;
    const consumptionHighway = vehicleHighway ? Number(vehicleHighway) : undefined;

    if (!vehicleName.trim() || !Number.isFinite(consumption) || consumption <= 0) {
      setStatus("Completa el nombre y el consumo del vehiculo.");
      return;
    }

    const response = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: vehicleName.trim(),
        consumptionLPer100km: consumption,
        consumptionCityLPer100km: consumptionCity,
        consumptionHighwayLPer100km: consumptionHighway,
        ownerId,
      }),
    });

    if (!response.ok) {
      setStatus("No se pudo guardar el vehiculo.");
      return;
    }

    const created = (await response.json()) as Vehicle;
    setVehicles((prev) => [created, ...prev]);
    setSelectedVehicleId(created._id ?? "");
    setVehicleName("");
    setVehicleConsumption("");
    setVehicleCity("");
    setVehicleHighway("");
  }

  async function handleAddPrice() {
    setStatus(null);
    const price = Number(priceValue);

    if (!priceLabel.trim() || !priceCurrency.trim() || !Number.isFinite(price) || price <= 0) {
      setStatus("Completa la etiqueta y el precio de gasolina.");
      return;
    }

    const response = await fetch("/api/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: priceLabel.trim(),
        pricePerLiter: price,
        currency: priceCurrency.trim().toUpperCase(),
        ownerId,
      }),
    });

    if (!response.ok) {
      setStatus("No se pudo guardar el precio.");
      return;
    }

    const created = (await response.json()) as FuelPrice;
    setFuelPrices((prev) => [created, ...prev]);
    setSelectedPriceId(created._id ?? "");
    setPriceLabel("");
    setPriceValue("");
  }

  function handleStopChange(index: number, value: string) {
    setStops((prev) => prev.map((stop, i) => (i === index ? value : stop)));
  }

  function handleAddStop() {
    setStops((prev) => [...prev, ""]);
  }

  function handleRemoveStop(index: number) {
    setStops((prev) => prev.filter((_, i) => i !== index));
  }

  function applyRouteResult(result: google.maps.DirectionsResult, index: number) {
    const route = result.routes[index];
    if (!route) {
      return;
    }
    directionsRenderer.current?.setDirections(result);
    directionsRenderer.current?.setRouteIndex(index);

    const legs = route.legs ?? [];
    const distanceMeters = legs.reduce(
      (sum, leg) => sum + (leg.distance?.value ?? 0),
      0
    );
    const durationSeconds = legs.reduce(
      (sum, leg) => sum + (leg.duration?.value ?? 0),
      0
    );
    const trafficSeconds = legs.reduce(
      (sum, leg) => sum + (leg.duration_in_traffic?.value ?? 0),
      0
    );

    const steps = legs
      .flatMap((leg) => leg.steps ?? [])
      .map((step) => stripHtml(step.instructions ?? ""))
      .filter((step) => step.trim());

    const consumption = resolveConsumption(selectedVehicle);
    const liters = consumption
      ? (distanceMeters / 1000 / 100) * consumption
      : null;
    const cost =
      liters !== null && selectedPrice
        ? liters * selectedPrice.pricePerLiter
        : null;

    setSummary({
      distanceMeters,
      durationSeconds,
      fuelLiters: liters,
      fuelCost: cost,
    });
    setRouteSteps(steps);
    setRouteTrafficSeconds(trafficSeconds || null);
  }

  async function handleRoute() {
    setStatus(null);
    setSummary(null);
    setIsRouting(true);

    if (!hasApiKey) {
      setStatus("Configura la API key de Google Maps.");
      setIsRouting(false);
      return;
    }

    if (!origin.trim() || !destination.trim()) {
      setStatus("Ingresa origen y destino.");
      setIsRouting(false);
      return;
    }

    if (!directionsService.current || !directionsRenderer.current) {
      setStatus("El mapa no esta listo.");
      setIsRouting(false);
      return;
    }

    const waypoints = stops
      .filter((stop) => stop.trim())
      .map((stop) => ({ location: stop.trim(), stopover: true }));

    const request: google.maps.DirectionsRequest = {
      origin: origin.trim(),
      destination: destination.trim(),
      waypoints,
      optimizeWaypoints: optimizeStops,
      travelMode: google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: google.maps.TrafficModel.BEST_GUESS,
      },
      provideRouteAlternatives: true,
    };

    directionsService.current.route(request, (result, status) => {
      if (status !== "OK" || !result) {
        setStatus("No se encontro ruta.");
        setIsRouting(false);
        return;
      }
      setLastDirections(result);
      setRouteCount(result.routes.length || 1);
      setRouteIndex(0);
      applyRouteResult(result, 0);
      setIsRouting(false);
    });
  }

  async function handleSaveTrip() {
    if (!summary) {
      setStatus("Primero calcula la ruta.");
      return;
    }

    const fallbackName = `${origin.trim()} to ${destination.trim()}`.trim();
    const finalName = tripName.trim() || fallbackName;
    if (!finalName) {
      setStatus("Agrega origen y destino para guardar el viaje.");
      return;
    }

    const response = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: finalName,
        origin: origin.trim(),
        destination: destination.trim(),
        stops: stops.filter((stop) => stop.trim()),
        vehicleId: selectedVehicleId || undefined,
        fuelPriceId: selectedPriceId || undefined,
        distanceMeters: summary.distanceMeters,
        durationSeconds: summary.durationSeconds,
        fuelLiters: summary.fuelLiters,
        fuelCost: summary.fuelCost,
        ownerId,
      }),
    });

    if (!response.ok) {
      setStatus("No se pudo guardar el viaje.");
      return;
    }

    const created = (await response.json()) as Trip;
    setTrips((prev) => [created, ...prev].slice(0, 10));
  }

  function handleSaveFavoriteRoute() {
    const name = tripName.trim() || `${origin.trim()} to ${destination.trim()}`.trim();
    if (!name || !origin.trim() || !destination.trim()) {
      setStatus("Completa origen y destino para guardar la ruta.");
      return;
    }

    setFavoriteRoutes((prev) => {
      const next = prev.filter((route) => route.name !== name);
      return [{ name, origin: origin.trim(), destination: destination.trim(), stops }, ...next].slice(
        0,
        6
      );
    });
  }

  async function handleShareRoute() {
    const params = new URLSearchParams();
    if (origin.trim()) params.set("origin", origin.trim());
    if (destination.trim()) params.set("destination", destination.trim());
    if (stops.length > 0) params.set("stops", stops.filter(Boolean).join("|"));
    const url = `${window.location.origin}?${params.toString()}`;

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("Link copiado.");
      window.setTimeout(() => setShareStatus(null), 3000);
    } catch {
      setShareStatus("No se pudo copiar el link.");
    }
  }

  function handleExportPdf() {
    window.print();
  }

  function handleMeasurePinDistance() {
    if (!pinCoords) {
      return;
    }
    if (!navigator.geolocation) {
      setStatus("No se pudo acceder a la ubicacion.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const distance = haversineMeters(
          position.coords.latitude,
          position.coords.longitude,
          pinCoords.lat,
          pinCoords.lng
        );
        setPinDistanceMeters(distance);
      },
      () => setStatus("No se pudo acceder a la ubicacion."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function handleClearRoute() {
    directionsRenderer.current?.setDirections({ routes: [] } as google.maps.DirectionsResult);
    setSummary(null);
    setRouteSteps([]);
    setRouteTrafficSeconds(null);
    setLastDirections(null);
    setRouteIndex(0);
    setRouteCount(1);
  }

  function downloadTextFile(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportKml() {
    if (!lastDirections) return;
    const path = lastDirections.routes[routeIndex]?.overview_path ?? [];
    const coords = path.map((point) => `${point.lng()},${point.lat()},0`).join(" ");
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<Placemark>\n<name>Ruta Shellmap</name>\n<LineString><coordinates>${coords}</coordinates></LineString>\n</Placemark>\n</Document>\n</kml>`;
    downloadTextFile("ruta.kml", content);
  }

  function handleExportGpx() {
    if (!lastDirections) return;
    const path = lastDirections.routes[routeIndex]?.overview_path ?? [];
    const points = path
      .map((point) => `<trkpt lat="${point.lat()}" lon="${point.lng()}"></trkpt>`)
      .join("\n");
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shellmap" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>Ruta Shellmap</name><trkseg>\n${points}\n</trkseg></trk>\n</gpx>`;
    downloadTextFile("ruta.gpx", content);
  }

  function stopVoice() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }

  function speakStep(index: number) {
    if (!("speechSynthesis" in window)) {
      return;
    }
    if (index >= routeSteps.length) {
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(routeSteps[index]);
    utterance.lang = "es-MX";
    utterance.rate = 1;
    utterance.onend = () => {
      setSpeechIndex(index + 1);
      speakStep(index + 1);
    };
    window.speechSynthesis.speak(utterance);
  }

  function startVoice() {
    if (!routeSteps.length) {
      setStatus("Calcula una ruta primero.");
      return;
    }
    stopVoice();
    setIsSpeaking(true);
    setSpeechIndex(0);
    speakStep(0);
  }

  function handleZoom(delta: number) {
    if (!mapInstance.current) return;
    const current = mapInstance.current.getZoom() ?? 6;
    mapInstance.current.setZoom(current + delta);
  }

  function handleCenterOnPin() {
    if (!mapInstance.current || !pinCoords) return;
    mapInstance.current.setCenter(pinCoords);
    mapInstance.current.setZoom(14);
  }

  function handleCenterOnRoute() {
    if (!mapInstance.current || !lastDirections) return;
    const bounds = new google.maps.LatLngBounds();
    lastDirections.routes[routeIndex]?.overview_path?.forEach((point) => bounds.extend(point));
    if (!bounds.isEmpty()) {
      mapInstance.current.fitBounds(bounds);
    }
  }

  function handleCenterOnMe() {
    if (!navigator.geolocation || !mapInstance.current) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        mapInstance.current?.setCenter({ lat, lng });
        mapInstance.current?.setZoom(14);
      },
      () => setStatus("No se pudo acceder a la ubicacion."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function formatDistance(distanceMeters: number) {
    const km = distanceMeters / 1000;
    return `${km.toFixed(1)} km`;
  }

  function formatDuration(durationSeconds: number) {
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.round((durationSeconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  const currencyLabel = selectedPrice?.currency || autoCurrency || DEFAULT_PRICE.currency;
  const trafficDelaySeconds =
    routeTrafficSeconds && summary ? routeTrafficSeconds - summary.durationSeconds : null;
  const filteredTrips = trips.filter((trip) => {
    if (!tripQuery.trim()) return true;
    const q = tripQuery.toLowerCase();
    return (
      trip.name.toLowerCase().includes(q) ||
      trip.origin.toLowerCase().includes(q) ||
      trip.destination.toLowerCase().includes(q)
    );
  });
  const primaryButton =
    "w-full rounded-xl bg-[color:var(--panel-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--panel-strong-text)] shadow-sm transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--panel-strong)] disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryButton =
    "w-full rounded-xl border border-[color:var(--panel-border)] bg-[color:var(--panel-elev)] px-4 py-2 text-sm font-semibold text-[color:var(--panel-text)] shadow-sm transition hover:bg-[color:var(--panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--panel-strong)]";
  const miniButton =
    "rounded-xl border border-[color:var(--panel-border)] bg-[color:var(--panel-elev)] px-3 py-2 text-xs font-semibold text-[color:var(--panel-text)] transition hover:bg-[color:var(--panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--panel-strong)]";
  const pillNeutral =
    "rounded-full border border-white/30 bg-white/90 px-4 py-2 text-xs font-semibold text-neutral-900 shadow-lg backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60";
  const pillPrimary =
    "rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60";
  const cardBase =
    "rounded-3xl border border-[color:var(--panel-border)] bg-[color:var(--panel-elev)] p-5 shadow-sm";
  const cardMuted = "rounded-2xl bg-[color:var(--panel-elev-muted)] p-4";
  const inputBase =
    "w-full rounded-xl border border-[color:var(--panel-border)] bg-[color:var(--panel-elev)] px-4 py-2 text-sm text-[color:var(--panel-text)] placeholder:text-[color:var(--panel-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--panel-strong)]";
  const selectBase =
    "w-full rounded-xl border border-[color:var(--panel-border)] bg-[color:var(--panel-elev)] px-4 py-2 text-sm text-[color:var(--panel-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--panel-strong)]";
  const subtleText = "text-[color:var(--panel-text-muted)]";

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div
        ref={mapRef}
        className="absolute inset-0"
        role="application"
        aria-label="Mapa de ruta"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/35 via-transparent to-black/70" />

      {!isMapReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm font-semibold text-white">
          Cargando mapa...
        </div>
      )}

      {!isMinimal && (
        <div className="absolute right-4 top-4 z-20 flex flex-col gap-2">
          <button
            className={pillNeutral}
            type="button"
            onClick={() => setIsPanelOpen((prev) => !prev)}
          >
            {isPanelOpen ? "Ocultar panel" : "Mostrar panel"}
          </button>
          <button
            className={pillPrimary}
            type="button"
            onClick={handleRoute}
            disabled={isRouting}
          >
            {isRouting ? "Calculando..." : "Ir ahora"}
          </button>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2">
        <button className={pillNeutral} type="button" onClick={() => handleZoom(1)}>
          +
        </button>
        <button className={pillNeutral} type="button" onClick={() => handleZoom(-1)}>
          -
        </button>
        <button className={pillNeutral} type="button" onClick={handleCenterOnMe}>
          Mi ubicacion
        </button>
        <button
          className={pillNeutral}
          type="button"
          onClick={handleCenterOnPin}
          disabled={!pinCoords}
        >
          Ver pin
        </button>
        <button
          className={pillNeutral}
          type="button"
          onClick={handleCenterOnRoute}
          disabled={!lastDirections}
        >
          Ver ruta
        </button>
        <button
          className={pillNeutral}
          type="button"
          onClick={handleClearRoute}
          disabled={!lastDirections}
        >
          Limpiar ruta
        </button>
      </div>

      {summary && (isMinimal || !isPanelOpen) && (
        <div className="absolute bottom-4 right-4 z-20 rounded-2xl border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-4 py-3 text-sm text-[color:var(--panel-text)] shadow-xl backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--panel-text-muted)]">
            Resumen rapido
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold">
            <span>{formatDistance(summary.distanceMeters)}</span>
            <span>{formatDuration(summary.durationSeconds)}</span>
            {summary.fuelCost !== null && (
              <span>{formatMoney(summary.fuelCost, currencyLabel)}</span>
            )}
          </div>
        </div>
      )}

      {!isMinimal && (
        <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-3 rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-900 shadow-lg">
          <span>Shellmap</span>
          <span className="text-neutral-500">|</span>
          <span>Ruta + Gasolina</span>
          {autoCountry && (
            <span className="rounded-full bg-neutral-900 px-3 py-1 text-[10px] text-white">
              {autoCountry} {currencyLabel}
            </span>
          )}
        </div>
      )}

      {!hasApiKey && (
        <div className="absolute left-4 top-16 z-20 rounded-2xl bg-red-600 px-4 py-2 text-xs text-white">
          Agrega NEXT_PUBLIC_GOOGLE_MAPS_API_KEY en tu .env.local
        </div>
      )}

      {!isMinimal && (
        <aside
          className={`absolute bottom-0 right-0 z-20 flex h-[70vh] w-full flex-col gap-6 overflow-y-auto border-t border-[color:var(--panel-border)] bg-[color:var(--panel)] px-6 py-6 text-[color:var(--panel-text)] shadow-2xl backdrop-blur-md transition-transform duration-300 md:top-0 md:h-full md:max-w-md md:border-l md:border-t-0 ${
            isPanelOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
        <div>
          <h1 className="text-2xl font-semibold">Planifica tu ruta</h1>
          <p className={`mt-1 text-sm ${subtleText}`}>
            Estilo Google Maps con calculo de gasolina en {currencyLabel}.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`flex flex-col gap-1 text-xs ${subtleText}`}>
            Estilo del mapa
            <select
              className={selectBase}
              value={mapStyleKey}
              onChange={(event) => setMapStyleKey(event.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="silver">Silver</option>
              <option value="dark">Dark</option>
              <option value="retro">Retro</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-xs">
            <button
              className={secondaryButton}
              type="button"
              onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
            >
              {themeMode === "dark" ? "Tema claro" : "Tema oscuro"}
            </button>
            <button
              className={secondaryButton}
              type="button"
              onClick={() => setIsMinimal((prev) => !prev)}
            >
              {isMinimal ? "Salir minimal" : "Modo minimal"}
            </button>
            <button
              className={secondaryButton}
              type="button"
              onClick={() => setIs3D((prev) => !prev)}
            >
              {is3D ? "2D" : "3D"}
            </button>
            <button
              className={secondaryButton}
              type="button"
              onClick={handleShareRoute}
            >
              Compartir ruta
            </button>
            <button
              className={secondaryButton}
              type="button"
              onClick={handleExportPdf}
            >
              Exportar PDF
            </button>
            <button className={secondaryButton} type="button" onClick={handleExportKml}>
              Exportar KML
            </button>
            <button className={secondaryButton} type="button" onClick={handleExportGpx}>
              Exportar GPX
            </button>
          </div>
        </div>
        {shareStatus && <p className="text-xs text-emerald-600">{shareStatus}</p>}

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Ruta</h2>
          <div className="mt-4 space-y-3">
            <input
              className={inputBase}
              placeholder="Nombre del viaje"
              value={tripName}
              onChange={(event) => setTripName(event.target.value)}
            />
            <input
              ref={originInputRef}
              className={inputBase}
              placeholder="Origen"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
            <button
              className={secondaryButton}
              type="button"
              onClick={() => {
                if (!navigator.geolocation || !window.google?.maps) {
                  setStatus("No se pudo acceder a la ubicacion.");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  async (position) => {
                    const geocoder = new google.maps.Geocoder();
                    const location = {
                      lat: position.coords.latitude,
                      lng: position.coords.longitude,
                    };
                    const result = await geocoder.geocode({ location });
                    const place = result.results?.[0]?.formatted_address;
                    if (place) {
                      setOrigin(place);
                    }
                  },
                  () => setStatus("No se pudo acceder a la ubicacion."),
                  { enableHighAccuracy: true, timeout: 8000 }
                );
              }}
            >
              Usar mi ubicacion
            </button>
            <input
              ref={destinationInputRef}
              className={inputBase}
              placeholder="Destino"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />

            <div className="space-y-2">
              {stops.map((stop, index) => (
                <div key={`${index}-${stop}`} className="flex gap-2">
                  <input
                    ref={(element) => {
                      stopInputRefs.current[index] = element;
                    }}
                    className={`${inputBase} flex-1`}
                    placeholder={`Parada ${index + 1}`}
                    value={stop}
                    onChange={(event) => handleStopChange(index, event.target.value)}
                  />
                  <button
                    className={miniButton}
                    type="button"
                    onClick={() => handleRemoveStop(index)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <button
                className="w-full rounded-xl border border-dashed border-[color:var(--panel-border)] px-4 py-2 text-sm"
                type="button"
                onClick={handleAddStop}
              >
                Agregar parada
              </button>
            </div>

            <label className={`flex items-center gap-2 text-sm ${subtleText}`}>
              <input
                type="checkbox"
                checked={optimizeStops}
                onChange={(event) => setOptimizeStops(event.target.checked)}
              />
              Optimizar orden de paradas
            </label>
            <label className={`flex items-center gap-2 text-sm ${subtleText}`}>
              <input
                type="checkbox"
                checked={autoCalculate}
                onChange={(event) => setAutoCalculate(event.target.checked)}
              />
              Calcular automaticamente
            </label>

            <button
              className={primaryButton}
              onClick={handleRoute}
              type="button"
              disabled={isRouting}
            >
              {isRouting ? "Calculando..." : "Calcular ruta"}
            </button>
            <button
              className={secondaryButton}
              onClick={handleSaveFavoriteRoute}
              type="button"
            >
              Guardar ruta frecuente
            </button>
          </div>
        </div>

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Resumen</h2>
          {routeCount > 1 && (
            <label className={`mt-3 flex flex-col gap-1 text-xs ${subtleText}`}>
              Ruta alternativa
              <select
                className={selectBase}
                value={routeIndex}
                onChange={(event) => setRouteIndex(Number(event.target.value))}
              >
                {Array.from({ length: routeCount }).map((_, index) => (
                  <option key={index} value={index}>
                    Ruta {index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          {summary ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Distancia</p>
                <p className="text-xl font-semibold">
                  {formatDistance(summary.distanceMeters)}
                </p>
              </div>
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Duracion</p>
                <p className="text-xl font-semibold">
                  {formatDuration(summary.durationSeconds)}
                </p>
                {routeTrafficSeconds && (
                  <p className={`mt-1 text-xs ${subtleText}`}>
                    Con trafico: {formatDuration(routeTrafficSeconds)}
                  </p>
                )}
                {trafficDelaySeconds && trafficDelaySeconds > 600 && (
                  <p className="mt-2 inline-flex rounded-full bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-700">
                    Trafico alto
                  </p>
                )}
              </div>
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Gasolina</p>
                <p className="text-xl font-semibold">
                  {summary.fuelLiters !== null
                    ? `${summary.fuelLiters.toFixed(2)} L`
                    : "-"}
                </p>
              </div>
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Costo</p>
                <p className="text-xl font-semibold">
                  {summary.fuelCost !== null
                    ? formatMoney(summary.fuelCost, currencyLabel)
                    : "-"}
                </p>
              </div>
            </div>
          ) : (
            <p className={`mt-4 text-sm ${subtleText}`}>
              Calcula una ruta para ver el resumen.
            </p>
          )}
          <button
            className={`mt-4 ${secondaryButton}`}
            onClick={handleSaveTrip}
            type="button"
          >
            Guardar viaje
          </button>
          {status && (
            <p className="mt-3 text-sm text-red-600" role="status">
              {status}
            </p>
          )}
        </div>

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Clima</h2>
          {weather ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Estado</p>
                <p className="text-lg font-semibold">{weather.label}</p>
              </div>
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Temperatura</p>
                <p className="text-lg font-semibold">{weather.tempC.toFixed(1)} C</p>
              </div>
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Viento</p>
                <p className="text-lg font-semibold">{weather.windKph.toFixed(0)} km/h</p>
              </div>
              <div className={cardMuted}>
                <p className={`text-sm ${subtleText}`}>Codigo</p>
                <p className="text-lg font-semibold">{weather.code}</p>
              </div>
            </div>
          ) : (
            <p className={`mt-4 text-sm ${subtleText}`}>
              Selecciona un punto en el mapa para ver el clima.
            </p>
          )}
        </div>

        {routeSteps.length > 0 && (
          <div className={cardBase}>
            <h2 className="text-lg font-semibold">Pasos de la ruta</h2>
            <div className="mt-3 flex gap-2">
              <button className={secondaryButton} type="button" onClick={startVoice}>
                {isSpeaking ? "Reiniciar voz" : "Iniciar voz"}
              </button>
              <button className={secondaryButton} type="button" onClick={stopVoice}>
                Detener
              </button>
            </div>
            <ol className="mt-4 space-y-2 text-sm text-[color:var(--panel-text-muted)]">
              {routeSteps.slice(0, 12).map((step, index) => (
                <li key={`${index}-${step}`} className="rounded-xl bg-[color:var(--panel-elev-muted)] px-3 py-2 text-[color:var(--panel-text)]">
                  {index + 1}. {step}
                </li>
              ))}
            </ol>
            {routeSteps.length > 12 && (
              <p className={`mt-2 text-xs ${subtleText}`}>
                {routeSteps.length - 12} pasos mas...
              </p>
            )}
          </div>
        )}

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Precio y vehiculo</h2>
          <div className="mt-4 space-y-3">
            <select
              className={selectBase}
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
            >
              <option value="">Selecciona un vehiculo</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle._id} value={vehicle._id}>
                  {vehicle.name} - {vehicle.consumptionLPer100km} L/100km
                </option>
              ))}
            </select>
            <button
              className={secondaryButton}
              onClick={async () => {
                const created = await createDefaultVehicle();
                if (created?._id) {
                  setVehicles((prev) => [created, ...prev]);
                  setSelectedVehicleId(created._id ?? "");
                }
              }}
              type="button"
            >
              Usar vehiculo por defecto
            </button>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputBase}
                placeholder="Nombre del vehiculo"
                value={vehicleName}
                onChange={(event) => setVehicleName(event.target.value)}
              />
              <input
                className={inputBase}
                placeholder="Consumo (L/100km)"
                value={vehicleConsumption}
                onChange={(event) => setVehicleConsumption(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputBase}
                placeholder="Consumo ciudad (opcional)"
                value={vehicleCity}
                onChange={(event) => setVehicleCity(event.target.value)}
              />
              <input
                className={inputBase}
                placeholder="Consumo carretera (opcional)"
                value={vehicleHighway}
                onChange={(event) => setVehicleHighway(event.target.value)}
              />
            </div>
            <label className={`flex flex-col gap-1 text-xs ${subtleText}`}>
              Modo de conduccion
              <select
                className={selectBase}
                value={driveMode}
                onChange={(event) =>
                  setDriveMode(event.target.value as "mixed" | "city" | "highway")
                }
              >
                <option value="mixed">Mixto</option>
                <option value="city">Ciudad</option>
                <option value="highway">Carretera</option>
              </select>
            </label>
            {driveMode === "mixed" && (
              <label className={`flex flex-col gap-1 text-xs ${subtleText}`}>
                Proporcion ciudad ({Math.round(cityRatio * 100)}%)
                <input
                  type="range"
                  min={0.2}
                  max={0.8}
                  step={0.1}
                  value={cityRatio}
                  onChange={(event) => setCityRatio(Number(event.target.value))}
                />
              </label>
            )}
            <button
              className={primaryButton}
              onClick={handleAddVehicle}
              type="button"
            >
              Guardar vehiculo
            </button>
            <select
              className={selectBase}
              value={selectedPriceId}
              onChange={(event) => setSelectedPriceId(event.target.value)}
            >
              <option value="">Selecciona precio</option>
              {fuelPrices.map((price) => (
                <option key={price._id} value={price._id}>
                  {price.label} - {price.currency} {price.pricePerLiter}
                </option>
              ))}
            </select>
            <button
              className={secondaryButton}
              onClick={async () => {
                const created = await createDefaultPrice();
                if (created?._id) {
                  setFuelPrices((prev) => [created, ...prev]);
                  setSelectedPriceId(created._id ?? "");
                }
              }}
              type="button"
            >
              Usar precio por defecto
            </button>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className={inputBase}
                placeholder="Etiqueta"
                value={priceLabel}
                onChange={(event) => setPriceLabel(event.target.value)}
              />
              <input
                className={inputBase}
                placeholder="Precio/L"
                value={priceValue}
                onChange={(event) => setPriceValue(event.target.value)}
              />
              <input
                className={inputBase}
                placeholder="Moneda"
                value={priceCurrency}
                onChange={(event) => setPriceCurrency(event.target.value)}
              />
            </div>
            <button
              className={primaryButton}
              onClick={handleAddPrice}
              type="button"
            >
              Guardar precio
            </button>
          </div>
        </div>

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Rutas frecuentes</h2>
          <div className="mt-4 space-y-3 text-sm">
            {favoriteRoutes.length === 0 && (
              <p className={subtleText}>Guarda rutas para reutilizarlas.</p>
            )}
            {favoriteRoutes.map((route) => (
              <div
                key={route.name}
                className="rounded-2xl border border-[color:var(--panel-border)] px-3 py-3"
              >
                <p className="font-semibold">{route.name}</p>
                <p className={subtleText}>
                  {route.origin} -&gt; {route.destination}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className={miniButton}
                    type="button"
                    onClick={() => {
                      setOrigin(route.origin);
                      setDestination(route.destination);
                      setStops(route.stops);
                    }}
                  >
                    Usar ruta
                  </button>
                  <button
                    className={miniButton}
                    type="button"
                    onClick={() =>
                      setFavoriteRoutes((prev) =>
                        prev.filter((item) => item.name !== route.name)
                      )
                    }
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {pinAddress && (
          <div className={cardBase}>
            <h2 className="text-lg font-semibold">Punto seleccionado</h2>
            <p className={`mt-2 text-sm ${subtleText}`}>{pinAddress}</p>
            <label className={`mt-3 flex items-center gap-2 text-xs ${subtleText}`}>
              <input
                type="checkbox"
                checked={showStations}
                onChange={(event) => setShowStations(event.target.checked)}
              />
              Mostrar gasolineras cercanas
            </label>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                Radio
                <select
                  className={selectBase}
                  value={stationRadiusKm}
                  onChange={(event) => setStationRadiusKm(Number(event.target.value))}
                >
                  <option value={1}>1 km</option>
                  <option value={3}>3 km</option>
                  <option value={5}>5 km</option>
                  <option value={10}>10 km</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                Limite
                <select
                  className={selectBase}
                  value={stationLimit}
                  onChange={(event) => setStationLimit(Number(event.target.value))}
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={8}>8</option>
                  <option value={12}>12</option>
                </select>
              </label>
            </div>
            <button
              className={`mt-3 ${secondaryButton}`}
              type="button"
              onClick={() => {
                if (!navigator.geolocation || !window.google?.maps) {
                  setStatus("No se pudo acceder a la ubicacion.");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (position) => {
                    void updatePinFromLatLng(
                      position.coords.latitude,
                      position.coords.longitude
                    );
                  },
                  () => setStatus("No se pudo acceder a la ubicacion."),
                  { enableHighAccuracy: true, timeout: 8000 }
                );
              }}
            >
              Buscar gasolineras desde mi ubicacion
            </button>
            <button
              className={`mt-2 ${secondaryButton}`}
              type="button"
              onClick={handleMeasurePinDistance}
            >
              Medir distancia al pin
            </button>
            {pinDistanceMeters !== null && (
              <p className={`mt-2 text-xs ${subtleText}`}>
                Distancia directa: {(pinDistanceMeters / 1000).toFixed(2)} km
              </p>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                className={miniButton}
                type="button"
                onClick={() => setOrigin(pinAddress)}
              >
                Usar como origen
              </button>
              <button
                className={miniButton}
                type="button"
                onClick={() => setDestination(pinAddress)}
              >
                Usar como destino
              </button>
              <button
                className={miniButton}
                type="button"
                onClick={() => setStops((prev) => [...prev, pinAddress])}
              >
                Agregar parada
              </button>
            </div>
            <button
              className={`mt-3 ${secondaryButton}`}
              type="button"
              onClick={() =>
                setFavorites((prev) =>
                  prev.includes(pinAddress) ? prev : [pinAddress, ...prev].slice(0, 8)
                )
              }
            >
              Guardar en favoritos
            </button>
            {pinCoords && (
              <p className={`mt-2 text-xs ${subtleText}`}>
                Coordenadas: {pinCoords.lat.toFixed(5)}, {pinCoords.lng.toFixed(5)}
              </p>
            )}
          </div>
        )}

        {stations.length > 0 && (
          <div className={cardBase}>
            <h2 className="text-lg font-semibold">Gasolineras cercanas</h2>
            {isFetchingStations && (
              <p className={`mt-2 text-xs ${subtleText}`}>Buscando gasolineras...</p>
            )}
            <div className="mt-4 space-y-3 text-sm">
              {stations.map((station) => (
                <div
                  key={station.id}
                  className="rounded-2xl border border-[color:var(--panel-border)] px-3 py-3"
                >
                  <p className="font-semibold">{station.name}</p>
                  <p className={subtleText}>{station.address}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <button
                      className={miniButton}
                      type="button"
                      onClick={() => setOrigin(station.address)}
                    >
                      Origen
                    </button>
                    <button
                      className={miniButton}
                      type="button"
                      onClick={() => setDestination(station.address)}
                    >
                      Destino
                    </button>
                    <button
                      className={miniButton}
                      type="button"
                      onClick={() => setStops((prev) => [...prev, station.address])}
                    >
                      Parada
                    </button>
                  </div>
                  <button
                    className={`mt-2 ${secondaryButton}`}
                    type="button"
                    onClick={() =>
                      setFavorites((prev) =>
                        prev.includes(station.address)
                          ? prev
                          : [station.address, ...prev].slice(0, 8)
                      )
                    }
                  >
                    Guardar en favoritos
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Favoritos</h2>
          <div className="mt-4 space-y-2 text-sm">
            {favorites.length === 0 && (
              <p className={subtleText}>Guarda puntos del mapa para reutilizarlos.</p>
            )}
            {favorites.map((favorite) => (
              <div
                key={favorite}
                className="flex flex-col gap-2 rounded-2xl border border-[color:var(--panel-border)] px-3 py-3"
              >
                <p className={subtleText}>{favorite}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    className={miniButton}
                    type="button"
                    onClick={() => setOrigin(favorite)}
                  >
                    Origen
                  </button>
                  <button
                    className={miniButton}
                    type="button"
                    onClick={() => setDestination(favorite)}
                  >
                    Destino
                  </button>
                  <button
                    className={miniButton}
                    type="button"
                    onClick={() => setStops((prev) => [...prev, favorite])}
                  >
                    Parada
                  </button>
                </div>
                <button
                  className={miniButton}
                  type="button"
                  onClick={() => setFavorites((prev) => prev.filter((item) => item !== favorite))}
                >
                  Quitar favorito
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className={cardBase}>
          <h2 className="text-lg font-semibold">Ultimos viajes</h2>
          <input
            className={`mt-3 ${inputBase}`}
            placeholder="Buscar en historial"
            value={tripQuery}
            onChange={(event) => setTripQuery(event.target.value)}
          />
          <div className="mt-4 space-y-3 text-sm">
            {filteredTrips.length === 0 && (
              <p className={subtleText}>Aun no hay viajes guardados.</p>
            )}
            {filteredTrips.map((trip) => (
              <div
                key={trip._id}
                className="rounded-2xl border border-[color:var(--panel-border)] px-4 py-3"
              >
                <p className="font-semibold">{trip.name}</p>
                <p className={subtleText}>
                  {trip.origin} -&gt; {trip.destination}
                </p>
                <p className={subtleText}>
                  {formatDistance(trip.distanceMeters)} - {formatDuration(trip.durationSeconds)}
                </p>
              </div>
            ))}
          </div>
        </div>
        </aside>
      )}
    </div>
  );
}
