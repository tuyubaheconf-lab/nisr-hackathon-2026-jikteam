import { useEffect, useMemo, useState } from "react";
import type { District } from "../lib/types";

interface GeoFeature {
  type: "Feature";
  properties: { name: string };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

const W = 520;
const H = 470;

type Status = "hold" | "sell" | "none";

export default function DistrictMap({
  districts,
  statusOf,
  onPick,
  labels,
}: {
  districts: District[];
  statusOf: (d: District) => { status: Status; estimated: boolean };
  onPick?: (d: District) => void;
  labels: { hold: string; sell: string; estimated: string };
}) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);
  const [hover, setHover] = useState<District | null>(null);

  useEffect(() => {
    let alive = true;
    // lazy: the boundary file is the largest asset, only needed on this screen
    import("../assets/rwa-districts.json").then((mod) => {
      if (alive) setFeatures((mod.default as unknown as { features: GeoFeature[] }).features);
    });
    return () => {
      alive = false;
    };
  }, []);

  const byName = useMemo(() => {
    const m = new Map<string, District>();
    for (const d of districts) m.set(d.id.toLowerCase(), d);
    return m;
  }, [districts]);

  const { paths, project } = useMemo(() => {
    if (!features) return { paths: [] as { name: string; d: string }[], project: () => "" };
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const f of features) {
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) {
          for (const [lon, lat] of ring) {
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }
    }
    const pad = 8;
    const scale = Math.min((W - pad * 2) / (maxLon - minLon), (H - pad * 2) / (maxLat - minLat));
    const offX = (W - (maxLon - minLon) * scale) / 2;
    const offY = (H - (maxLat - minLat) * scale) / 2;

    const prj = (lon: number, lat: number): [number, number] => [
      offX + (lon - minLon) * scale,
      offY + (maxLat - lat) * scale,
    ];

    const paths = features.map((f) => {
      let d = "";
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) {
          ring.forEach(([lon, lat], i) => {
            const [x, y] = prj(lon, lat);
            d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          });
          d += "Z";
        }
      }
      return { name: f.properties.name, d };
    });
    return { paths, project: prj };
  }, [features]);

  if (!features) {
    return <div className="loading">Loading districts…</div>;
  }

  return (
    <div>
      <div className="map-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rwanda districts">
          {paths.map(({ name, d }) => {
            const dist = byName.get(name.toLowerCase());
            const st = dist ? statusOf(dist) : { status: "none" as Status, estimated: false };
            const fill =
              st.status === "hold" ? "#1c7a4f" : st.status === "sell" ? "#c4762a" : "#dcd8ca";
            return (
              <path
                key={name}
                d={d}
                fill={fill}
                opacity={st.estimated ? 0.45 : 1}
                onMouseEnter={() => dist && setHover(dist)}
                onMouseLeave={() => setHover(null)}
                onClick={() => dist && onPick?.(dist)}
              />
            );
          })}
          {districts.map((d) => {
            const [x, y] = project(d.lon, d.lat);
            return <circle key={`pt-${d.id}`} cx={x} cy={y} r={2.2} fill="#fff" stroke="#14231d" strokeWidth="0.8" />;
          })}
        </svg>
      </div>
      <div className="map-tip">
        {hover ? (
          <strong>
            {hover.id} · {hover.province.replace(" Province", "")}
          </strong>
        ) : (
          <span className="muted">Hover or tap a district</span>
        )}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: "#1c7a4f" }} /> {labels.hold}
        </span>
        <span>
          <i style={{ background: "#c4762a" }} /> {labels.sell}
        </span>
        <span>
          <i style={{ background: "#1c7a4f", opacity: 0.45 }} /> {labels.estimated}
        </span>
      </div>
    </div>
  );
}
