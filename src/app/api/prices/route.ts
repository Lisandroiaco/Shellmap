import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import type { FuelPrice } from "@/lib/types";

function serialize(doc: FuelPrice & { _id: { toString: () => string } }) {
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
  const prices = await db
    .collection<FuelPrice>("fuelPrices")
    .find(ownerId ? { ownerId } : {})
    .sort({ createdAt: -1 })
    .toArray();

  return NextResponse.json(prices.map(serialize));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<FuelPrice>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const currency = typeof body.currency === "string" ? body.currency.trim() : "";
  const price = Number(body.pricePerLiter);

  if (!label || !currency || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: "Invalid fuel price payload" },
      { status: 400 }
    );
  }

  const fuelPrice: FuelPrice = {
    ownerId: typeof body.ownerId === "string" ? body.ownerId : undefined,
    label,
    currency,
    pricePerLiter: price,
    createdAt: new Date().toISOString(),
  };

  const db = await getDb();
  const result = await db
    .collection<FuelPrice>("fuelPrices")
    .insertOne(fuelPrice);

  return NextResponse.json({
    ...fuelPrice,
    _id: result.insertedId.toString(),
  });
}
