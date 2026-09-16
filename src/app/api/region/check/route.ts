import { currentBrandLabel } from "@/lib/brand-compat";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getRegionAvailabilityStatus } from "@/lib/regionCheck";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { city, postal_code, federal_state, country } = body;

        if (!city || !federal_state) {
            return NextResponse.json(
                { error: "Missing required fields: city, federal_state" },
                { status: 400 }
            );
        }

        const supabase = await supabaseServer();

        const { data, error } = await supabase
            .from("regions_live")
            .select("id, city, postal_code, federal_state, country, openplz_municipality_key, is_live, display_name, brand_prefix")
            .ilike("city", city)
            .ilike("federal_state", federal_state)
            .eq("country", country || "DE")
            .limit(1);

        if (error) {
            console.error("Supabase error:", error);
            return NextResponse.json({ status: "error" }, { status: 500 });
        }

        if (!data || data.length === 0) {
            return NextResponse.json({ status: "unknown" });
        }

        const region = data[0];
        const status = getRegionAvailabilityStatus(region);

        if (status !== "live") {
            return NextResponse.json({ status });
        }

        return NextResponse.json({ status, region: {
            ...region,
            display_name: currentBrandLabel(region.display_name || region.city),
            brand_prefix: currentBrandLabel(region.brand_prefix),
        } });
    } catch (err) {
        console.error("API error:", err);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
