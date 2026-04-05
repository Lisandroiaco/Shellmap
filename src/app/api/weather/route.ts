import { NextResponse } from "next/server";

const WEATHER_BASE_URL =
  process.env.WEATHER_API_BASE_URL ?? "https://api.open-meteo.com/v1/forecast";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Missing lat/lng" }, { status: 400 });
  }

  const url = `${WEATHER_BASE_URL}?latitude=${lat}&longitude=${lng}&current_weather=true&windspeed_unit=kmh`;
  const response = await fetch(url, { next: { revalidate: 300 } });

  if (!response.ok) {
    return NextResponse.json({ error: "Weather fetch failed" }, { status: 502 });
  }

  const data = await response.json();
  return NextResponse.json({
    current: data.current_weather ?? null,
  });
}
