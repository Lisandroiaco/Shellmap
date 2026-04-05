import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import type { Vehicle } from "@/lib/types";

function serialize(doc: Vehicle & { _id: { toString: () => string } }) {
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
  const vehicles = await db
    .collection<Vehicle>("vehicles")
    .find(ownerId ? { ownerId } : {})
    .sort({ createdAt: -1 })
    .toArray();

  return NextResponse.json(vehicles.map(serialize));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<Vehicle>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const consumption = Number(body.consumptionLPer100km);
  const consumptionCity =
    body.consumptionCityLPer100km === undefined
      ? undefined
      : Number(body.consumptionCityLPer100km);
  const consumptionHighway =
    body.consumptionHighwayLPer100km === undefined
      ? undefined
      : Number(body.consumptionHighwayLPer100km);

  if (!name || !Number.isFinite(consumption) || consumption <= 0) {
    return NextResponse.json(
      { error: "Invalid vehicle payload" },
      { status: 400 }
    );
  }

  if (
    (consumptionCity !== undefined && (!Number.isFinite(consumptionCity) || consumptionCity <= 0)) ||
    (consumptionHighway !== undefined &&
      (!Number.isFinite(consumptionHighway) || consumptionHighway <= 0))
  ) {
    return NextResponse.json(
      { error: "Invalid city/highway consumption" },
      { status: 400 }
    );
  }

  const vehicle: Vehicle = {
    ownerId: typeof body.ownerId === "string" ? body.ownerId : undefined,
    name,
    consumptionLPer100km: consumption,
    consumptionCityLPer100km: consumptionCity,
    consumptionHighwayLPer100km: consumptionHighway,
    createdAt: new Date().toISOString(),
  };

  const db = await getDb();
  const result = await db.collection<Vehicle>("vehicles").insertOne(vehicle);

  return NextResponse.json({ ...vehicle, _id: result.insertedId.toString() });
}
