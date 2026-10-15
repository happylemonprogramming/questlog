import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Geometry, Position } from 'geojson';
import { Globe2, Home, Loader2, Map as MapIcon, MapPinOff, Navigation, Wifi, X } from 'lucide-react';
import { db } from '@/lib/db';
import { JobsHeader } from '@/components/JobsHeader';
import { Card, CardHeader, Empty, JobRow, STAGE_DOT, StageChips, type StageFilter } from '@/components/common';
import { Tip } from '@/components/ui/tooltip';
import { bestView, loadGazetteer, loadShapes, locateAll, type Gazetteer, type Place } from '@/lib/geo';
import { SHOWN_STAGES, STAGES, shownStage, type Job, type Stage } from '@/lib/types';
import { useIsMobile } from '@/lib/useMedia';
import { cn } from '@/lib/utils';


interface Pin {
  place: Place;
  jobs: Job[];
  weight: number;
}

type Shapes = Awaited<ReturnType<typeof loadShapes>>;

const PROJECTION_KEY = 'offerdex:map-projection';

/** Map colors per theme, picked to sit next to the app's own surfaces. */
const PALETTE = {
  light: { ocean: '#dbe4ec', land: '#fcfbf8', coast: '#b9b2a6', border: '#c9c1b4', state: '#e0dad0' },
  dark: { ocean: '#0f141d', land: '#1d222c', coast: '#414a5b', border: '#394151', state: '#2a303c' },
};

/**
 * Shapes that cross the date line (Fiji, Russia) come out of TopoJSON jumping
 * from 180 to -180, which a flat renderer draws as a line around the world.
 * Keep each ring continuous instead; MapLibre wraps longitudes past 180 itself.
 */
function unwrap<G extends Geometry>(g: G): G {
  const line = (pts: Position[]) => {
    let shift = 0;
    return pts.map((p, i) => {
      if (i) {
        const d = p[0] + shift - (pts[i - 1][0] + shift);
        if (d > 180) shift -= 360;
        else if (d < -180) shift += 360;
      }
      return [p[0] + shift, p[1]];
    });
  };
  switch (g.type) {
    case 'LineString':
      return { ...g, coordinates: line(g.coordinates) };
    case 'MultiLineString':
    case 'Polygon':
      return { ...g, coordinates: g.coordinates.map(line) };
    case 'MultiPolygon':
      return { ...g, coordinates: g.coordinates.map((poly) => poly.map(line)) };
    default:
      return g;
  }
}

const isDark = () => document.documentElement.classList.contains('dark');

function style(shapes: Shapes, globe: boolean): StyleSpecification {
  const c = PALETTE[isDark() ? 'dark' : 'light'];
  const world = shapes.countries as Topology<{ countries: GeometryCollection }>;
  const us = shapes.states as Topology<{ states: GeometryCollection }>;
  // No one is hiring in Antarctica, and its outline runs along the date line.
  const countries = { ...world.objects.countries, geometries: world.objects.countries.geometries.filter((g) => g.id !== '010') };
  const land = feature(world, countries);
  return {
    version: 8,
    projection: { type: globe ? 'globe' : 'mercator' },
    sources: {
      land: { type: 'geojson', data: { ...land, features: land.features.map((f) => ({ ...f, geometry: unwrap(f.geometry) })) }, attribution: 'Natural Earth' },
      coast: { type: 'geojson', data: unwrap(mesh(world, countries, (a, b) => a === b)) },
      borders: { type: 'geojson', data: unwrap(mesh(world, countries, (a, b) => a !== b)) },
      states: { type: 'geojson', data: mesh(us, us.objects.states, (a, b) => a !== b), attribution: 'US Census' },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': c.ocean } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': c.land } },
      { id: 'states', type: 'line', source: 'states', minzoom: 2.5, paint: { 'line-color': c.state, 'line-width': 0.7 } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': c.border, 'line-width': 0.9 } },
      { id: 'coast', type: 'line', source: 'coast', paint: { 'line-color': c.coast, 'line-width': 0.8 } },
    ],
  };
}

function recolor(map: maplibregl.Map) {
  const c = PALETTE[isDark() ? 'dark' : 'light'];
  map.setPaintProperty('ocean', 'background-color', c.ocean);
  map.setPaintProperty('land', 'fill-color', c.land);
  map.setPaintProperty('states', 'line-color', c.state);
  map.setPaintProperty('borders', 'line-color', c.border);
  map.setPaintProperty('coast', 'line-color', c.coast);
}

/** The furthest along of a place's listings decides its color. */
const topStage = (jobs: Job[]) => jobs.reduce<Stage>((s, j) => (STAGES.indexOf(j.stage) > STAGES.indexOf(s) ? j.stage : s), 'inbox');

const PIN_TEXT: Record<Stage, string> = {
  inbox: 'text-foreground',
  saved: 'text-background',
  next: 'text-lemon-foreground',
  applied: 'text-background',
  interviewing: 'text-background',
  offer: 'text-background',
  closed: 'text-background',
};

const bubble = (count: number) => Math.round(24 + 7 * Math.log2(count));
const countOf = (group: Pin[]) => new Set(group.flatMap((p) => p.jobs)).size;

/**
 * Merge pins whose bubbles would overlap at the current zoom. A merged bubble
 * sits on its busiest place and grows, so keep merging until nothing touches.
 */
function cluster(map: maplibregl.Map, pins: Pin[]): Pin[][] {
  const groups = pins.map((pin) => ({ pins: [pin], xy: map.project([pin.place.lon, pin.place.lat]), size: bubble(pin.jobs.length) }));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if (Math.hypot(a.xy.x - b.xy.x, a.xy.y - b.xy.y) < (a.size + b.size) / 2 + 4) {
          a.pins.push(...b.pins);
          a.size = bubble(countOf(a.pins));
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return groups.map((g) => g.pins);
}

function pinElement(group: Pin[], selected: boolean, onClick: () => void) {
  const [pin] = group;
  const jobs = [...new Set(group.flatMap((p) => p.jobs))];
  const size = bubble(jobs.length);
  const label = group.length > 1 ? `${pin.place.label} +${group.length - 1} nearby` : pin.place.label;
  const approx = group.every((p) => p.place.approx);
  const stage = topStage(jobs);
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', `${label}: ${jobs.length} listing${jobs.length === 1 ? '' : 's'}`);
  el.title = approx ? `${label} (approximate)` : label;
  el.className = 'group relative block';
  el.innerHTML = `
    <span class="${cn(
      'grid place-items-center rounded-full font-mono text-[11px] font-semibold shadow-lift ring-2 ring-surface transition-transform group-hover:scale-110',
      STAGE_DOT[stage],
      PIN_TEXT[stage],
      approx && 'opacity-80 outline-dashed outline-2 outline-offset-2 outline-foreground/40',
      group.length > 1 && 'outline outline-2 outline-offset-2 outline-surface/70',
      selected && 'scale-110 ring-foreground',
    )}" style="width:${size}px;height:${size}px">${jobs.length}</span>
    <span class="${cn(
      'pointer-events-none absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface/95 px-1.5 py-0.5 text-[11.5px] font-medium text-foreground shadow-soft ring-1 ring-border',
      selected ? 'block' : 'hidden group-hover:block',
    )}"></span>`;
  (el.lastElementChild as HTMLElement).textContent = label;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

function fit(map: maplibregl.Map, places: Place[], mobile: boolean, animate = true) {
  if (!places.length) return;
  const pad = mobile ? 44 : 72;
  const opts = { padding: { top: pad, bottom: pad, left: pad, right: pad + 40 }, maxZoom: 6.5, duration: animate ? 900 : 0 };
  if (places.length === 1) {
    // A state or country needs room around it; a city can come in close.
    map.easeTo({ center: [places[0].lon, places[0].lat], zoom: places[0].approx ? 3.6 : 5.5, duration: opts.duration });
    return;
  }
  const v = bestView(places.map((place) => ({ place, weight: 1 })), 360, 180)!;
  map.fitBounds(v.bounds, opts);
}

export default function MapView() {
  const jobs = useLiveQuery(() => db.jobs.toArray(), []);
  const mobile = useIsMobile();
  const [stage, setStage] = useState<StageFilter>('all');
  const [data, setData] = useState<{ g: Gazetteer; shapes: Shapes }>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>();
  const [globe, setGlobe] = useState(() => localStorage.getItem(PROJECTION_KEY) !== 'mercator');
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    Promise.all([loadGazetteer(), loadShapes()])
      .then(([g, shapes]) => setData({ g, shapes }))
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const counts = useMemo(() => Object.fromEntries(SHOWN_STAGES.map((s) => [s, (jobs ?? []).filter((j) => shownStage(j.stage) === s).length])), [jobs]);
  const shown = useMemo(() => (jobs ?? []).filter((j) => (stage === 'all' ? j.stage !== 'closed' : shownStage(j.stage) === stage)), [jobs, stage]);

  const { pins, remote, unplaced, placed } = useMemo(() => {
    const pins = new Map<string, Pin>();
    const remote: Job[] = [];
    const unplaced: Job[] = [];
    let placed = 0;
    if (!data) return { pins: [] as Pin[], remote, unplaced, placed };
    const located = locateAll(data.g, shown.map((j) => j.location ?? ''));
    shown.forEach((job, i) => {
      const { places, remote: isRemote } = located[i];
      if (isRemote || job.remote) remote.push(job);
      if (!places.length && !isRemote && !job.remote) unplaced.push(job);
      if (places.length) placed += 1;
      for (const place of places) {
        const pin = pins.get(place.key) ?? { place, jobs: [], weight: 0 };
        pin.jobs.push(job);
        pin.weight += 1;
        pins.set(place.key, pin);
      }
    });
    return { pins: [...pins.values()].sort((a, b) => b.jobs.length - a.jobs.length), remote, unplaced, placed };
  }, [data, shown]);

  const view = useMemo(() => bestView(pins), [pins]);

  // Off-screen places, named by country: "Taiwan · 2".
  const elsewhere = useMemo(() => {
    const groups = new Map<string, { name: string; places: Place[]; count: number }>();
    for (const p of view?.outside ?? []) {
      const name = p.place.cc === 'US' ? p.place.label : (data?.g.countryByCode.get(p.place.cc)?.name ?? p.place.cc);
      const g = groups.get(name) ?? { name, places: [], count: 0 };
      g.places.push(p.place);
      g.count += p.jobs.length;
      groups.set(name, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }, [view, data]);

  const home = () => {
    const map = mapRef.current;
    if (map && view) fit(map, view.inside.map((p) => p.place), mobile);
  };

  // Create the map once the shapes are in.
  useEffect(() => {
    if (!data || !box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: style(data.shapes, globe),
      center: [-40, 30],
      zoom: 1.2,
      attributionControl: { compact: true, customAttribution: 'GeoNames' },
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: !globe,
    });
    map.touchZoomRotate.disableRotation();
    map.on('click', () => setSelected(undefined));
    map.once('load', () => setReady(true));
    map.on('moveend', () => setMoved((n) => n + 1));
    mapRef.current = map;
    const watch = new MutationObserver(() => map.isStyleLoaded() && recolor(map));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(box.current);
    return () => {
      watch.disconnect();
      resize.disconnect();
      map.remove();
      mapRef.current = undefined;
      setReady(false);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem(PROJECTION_KEY, globe ? 'globe' : 'mercator');
    const map = mapRef.current;
    if (map && ready) {
      map.setProjection({ type: globe ? 'globe' : 'mercator' });
      map.setRenderWorldCopies(!globe);
    }
  }, [globe, ready]);

  // Frame the busiest stretch whenever what's shown changes.
  const framed = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !view) return;
    const sig = view.inside.map((p) => p.place.key).join('|');
    if (framed.current === sig) return;
    fit(map, view.inside.map((p) => p.place), mobile, framed.current !== '');
    framed.current = sig;
  }, [view, ready, mobile]);

  // Pins, merged where they'd overlap. A merged bubble zooms in to split apart.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = cluster(map, pins).map((group) => {
      const [pin] = group;
      const onClick =
        group.length === 1
          ? () => setSelected((s) => (s === pin.place.key ? undefined : pin.place.key))
          : () => {
              const places = group.map((p) => p.place);
              const lons = places.map((p) => p.lon);
              const lats = places.map((p) => p.lat);
              map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
                padding: 80,
                maxZoom: Math.max(map.getZoom() + 2.5, 7),
                duration: 800,
              });
            };
      // Hidden, not faded, when they're round the back of the globe.
      return new maplibregl.Marker({ element: pinElement(group, group.some((p) => p.place.key === selected), onClick), opacityWhenCovered: '0' })
        .setLngLat([pin.place.lon, pin.place.lat])
        .addTo(map);
    });
    return () => markers.forEach((m) => m.remove());
  }, [pins, selected, ready, moved]);

  const pick = pins.find((p) => p.place.key === selected);
  useEffect(() => {
    if (selected && !pick) setSelected(undefined);
  }, [selected, pick]);


  return (
    <>
      <JobsHeader sub={jobs ? `${placed} on the map in ${pins.length} place${pins.length === 1 ? '' : 's'}, ${remote.length} remote` : undefined} />

      <StageChips value={stage} onChange={setStage} counts={counts} open={(jobs?.length ?? 0) - (counts.closed ?? 0)} />

      <Card className="relative mb-5 overflow-hidden bg-sunken p-0">
        <div ref={box} className={cn('w-full', mobile ? 'h-[58dvh] min-h-[340px]' : 'h-[min(66dvh,660px)] min-h-[420px]')} />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {error ? (
              <p className="max-w-xs text-center">Couldn't load the map data. {navigator.onLine ? error : 'Open the map once while online and it will work offline after that.'}</p>
            ) : (
              <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading the map…</span>
            )}
          </div>
        )}

        {ready && (
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <Tip label="Show the most listings">
              <button onClick={home} disabled={!view} className="grid size-9 place-items-center rounded-lg bg-surface/95 text-foreground shadow-soft ring-1 ring-border backdrop-blur hover:bg-accent disabled:opacity-40 [&_svg]:size-4" aria-label="Show the most listings">
                <Home />
              </button>
            </Tip>
            <Tip label={globe ? 'Flat map' : 'Globe'}>
              <button onClick={() => setGlobe((g) => !g)} className="grid size-9 place-items-center rounded-lg bg-surface/95 text-foreground shadow-soft ring-1 ring-border backdrop-blur hover:bg-accent [&_svg]:size-4" aria-label={globe ? 'Flat map' : 'Globe'}>
                {globe ? <MapIcon /> : <Globe2 />}
              </button>
            </Tip>
          </div>
        )}

        {ready && elsewhere.length > 0 && !pick && (
          <div className="scroll-none absolute left-0 right-14 top-3 flex items-center gap-1.5 overflow-x-auto px-3">
            <span className="shrink-0 rounded-full bg-surface/90 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground shadow-soft backdrop-blur">Also</span>
            {elsewhere.map((g) => (
              <button
                key={g.name}
                onClick={() => mapRef.current && fit(mapRef.current, g.places, mobile)}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-surface/95 px-2.5 text-[12.5px] font-medium shadow-soft ring-1 ring-border backdrop-blur transition hover:bg-accent [&_svg]:size-3"
              >
                <Navigation className="text-muted-foreground" />
                {g.name}
                <span className="font-mono text-[11px] text-muted-foreground">{g.count}</span>
              </button>
            ))}
          </div>
        )}

        {pick && (
          <div className="absolute inset-x-2 bottom-2 max-h-[48%] overflow-hidden rounded-xl bg-surface/95 shadow-lift ring-1 ring-border backdrop-blur sm:inset-x-auto sm:left-3 sm:w-[400px]">
            <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
              <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                {pick.place.label}
                {pick.place.approx && <span className="ml-1.5 font-normal text-muted-foreground">(roughly)</span>}
              </p>
              <span className="font-mono text-xs text-muted-foreground">{pick.jobs.length}</span>
              <button onClick={() => setSelected(undefined)} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="scroll-thin max-h-[calc(48dvh-60px)] overflow-y-auto p-1">
              {pick.jobs.map((j) => <JobRow key={j.id} job={j} compact />)}
            </div>
          </div>
        )}
      </Card>

      {jobs && !shown.length ? (
        <Empty icon={<Globe2 />} title={jobs.length ? 'Nothing in this stage' : 'No listings yet'}>
          {jobs.length ? 'Pick another stage above.' : 'Listings you add show up here by where they are.'}
        </Empty>
      ) : (
        <div className="grid gap-5 @[760px]:grid-cols-2">
          {pins.length > 0 && (
            <Card className="pb-3 lg:col-span-2">
              <CardHeader title="Places" count={pins.length} />
              <div className="flex flex-wrap gap-1.5 px-5">
                {pins.map((p) => (
                  <button
                    key={p.place.key}
                    onClick={() => {
                      setSelected(p.place.key);
                      mapRef.current?.easeTo({ center: [p.place.lon, p.place.lat], zoom: Math.max(mapRef.current.getZoom(), 4.5), duration: 800 });
                      if (mobile) box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    className={cn(
                      'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition',
                      selected === p.place.key ? 'bg-primary text-primary-foreground ring-primary' : 'ring-border hover:bg-accent',
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', STAGE_DOT[topStage(p.jobs)])} />
                    {p.place.label}
                    {p.place.approx && <span className="opacity-60">~</span>}
                    <span className="font-mono text-[11px] opacity-60">{p.jobs.length}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
          {remote.length > 0 && (
            <Card className="pb-2">
              <CardHeader title="Remote" icon={<Wifi />} count={remote.length} />
              <div className="px-2">{remote.map((j) => <JobRow key={j.id} job={j} compact />)}</div>
            </Card>
          )}
          {unplaced.length > 0 && (
            <Card className="pb-2">
              <CardHeader title="Couldn't place" icon={<MapPinOff />} count={unplaced.length} />
              <p className="px-5 pb-1 text-[12.5px] text-muted-foreground">Edit a listing's location to a city and state or country to put it on the map.</p>
              <div className="px-2">{unplaced.map((j) => <JobRow key={j.id} job={j} compact />)}</div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
