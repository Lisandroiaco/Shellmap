export type Vehicle = {
  _id?: string;
  ownerId?: string;
  name: string;
  consumptionLPer100km: number;
  consumptionCityLPer100km?: number;
  consumptionHighwayLPer100km?: number;
  createdAt?: string | Date;
};

export type FuelPrice = {
  _id?: string;
  ownerId?: string;
  label: string;
  pricePerLiter: number;
  currency: string;
  createdAt?: string | Date;
};

export type Trip = {
  _id?: string;
  ownerId?: string;
  name: string;
  origin: string;
  destination: string;
  stops: string[];
  vehicleId?: string;
  fuelPriceId?: string;
  distanceMeters: number;
  durationSeconds: number;
  fuelLiters: number | null;
  fuelCost: number | null;
  createdAt?: string | Date;
};
