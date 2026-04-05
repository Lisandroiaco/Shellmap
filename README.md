# Shellmap

Planificador de rutas con Google Maps que calcula consumo de gasolina y costo total usando precios guardados en MongoDB.

## Funcionalidades

- Calculo de ruta con paradas y optimizacion de orden.
- Estimacion de litros y costo de gasolina por viaje.
- Autocomplete de direcciones, pin en mapa y uso de ubicacion actual.
- Favoritos, gasolineras cercanas con filtros, y calculo automatico al editar la ruta.
- Defaults automaticos de vehiculo y precio si no existen.
- Guardado de vehiculos, precios y viajes en MongoDB.

## Requisitos

- Node.js 20+
- MongoDB (local o remoto)
- Google Maps API key con Maps JavaScript API, Directions API y Places API habilitadas.

## Configuracion

1. Copia `.env.example` a `.env.local`.
2. Completa `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. Completa `MONGODB_URI` y opcionalmente `MONGODB_DB`.

## Ejecutar en desarrollo

```bash
npm install
npm run dev
```

Abre la app en tu navegador en el puerto 3000.

## Endpoints

- `GET /api/vehicles` y `POST /api/vehicles`
- `GET /api/prices` y `POST /api/prices`
- `GET /api/trips` y `POST /api/trips`
