import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import type { Trip } from "@/lib/types";

function serialize(doc: Trip & { _id: { toString: () => string } }) {
  const createdAt = doc.createdAt as string | Date | undefined;
  return {
    ...doc,
    _id: doc._id.toString(),
    createdAt:
      typeof createdAt === "string"
        ? createdAt
        : createdAt instanceof Date
          ? createdAt.toISOString()
          : undefined,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get("ownerId");
  const db = await getDb();
  const trips = await db
    .collection<Trip>("trips")
    .find(ownerId ? { ownerId } : {})
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  return NextResponse.json(trips.map(serialize));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<Trip>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const origin = typeof body.origin === "string" ? body.origin.trim() : "";
  const destination =
    typeof body.destination === "string" ? body.destination.trim() : "";
  const stops = Array.isArray(body.stops)
    ? body.stops.filter((stop) => typeof stop === "string" && stop.trim())
    : [];

  const distanceMeters = Number(body.distanceMeters);
  const durationSeconds = Number(body.durationSeconds);
  const fuelLiters =
    body.fuelLiters === null || body.fuelLiters === undefined
      ? null
      : Number(body.fuelLiters);
  const fuelCost =
    body.fuelCost === null || body.fuelCost === undefined
      ? null
      : Number(body.fuelCost);

  if (!name || !origin || !destination) {
    return NextResponse.json(
      { error: "Trip name, origin, and destination are required" },
      { status: 400 }
    );
  }

  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return NextResponse.json(
      { error: "Trip distance is required" },
      { status: 400 }
    );
  }

  const trip: Trip = {
    ownerId: typeof body.ownerId === "string" ? body.ownerId : undefined,
    name,
    origin,
    destination,
    stops,
    vehicleId: typeof body.vehicleId === "string" ? body.vehicleId : undefined,
    fuelPriceId:
      typeof body.fuelPriceId === "string" ? body.fuelPriceId : undefined,
    distanceMeters,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    fuelLiters: Number.isFinite(fuelLiters ?? NaN) ? fuelLiters : null,
    fuelCost: Number.isFinite(fuelCost ?? NaN) ? fuelCost : null,
    createdAt: new Date().toISOString(),
  };

  const db = await getDb();
  const result = await db.collection<Trip>("trips").insertOne(trip);

  return NextResponse.json({ ...trip, _id: result.insertedId.toString() });
}
