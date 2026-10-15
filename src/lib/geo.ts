import { gunzipSync, strFromU8 } from 'fflate';

/**
 * Turns the free-text locations on listings ("Emeryville or Santa Clara, CA
 * (on-site)", "Greater Houston", "Remote - US Only") into map points.
 *
 * The lookup runs against a gazetteer shipped with the app (public/geo,
 * built by scripts/geo.mjs), so where you're looking never leaves the device.
 */

export interface Place {
  /** Stable key for grouping: rounded coordinates. */
  key: string;
  label: string;
  lat: number;
  lon: number;
  /** Country code, used to name places that are off screen. */
  cc: string;
  /** A state or country rather than a city, so the pin is only roughly right. */
  approx?: boolean;
}

export interface Located {
  places: Place[];
  remote: boolean;
}

interface Row {
  name: string;
  lat: number;
  lon: number;
  /** `US.CA` */
  admin: string;
}
interface Region {
  key: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Gazetteer {
  places: Map<string, Row[]>;
  regions: Map<string, Region[]>;
  regionByKey: Map<string, Region>;
  countries: Map<string, Region>;
  countryByCode: Map<string, Region>;
}

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function gz(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Some servers send .gz files with Content-Encoding: gzip, so the browser has already unzipped them.
  return buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
}

/** Map shapes for the basemap: TopoJSON of countries and US states. */
export async function loadShapes() {
  const [countries, states] = await Promise.all([gz('/geo/countries.json.gz'), gz('/geo/states.json.gz')]);
  return { countries: JSON.parse(strFromU8(countries)), states: JSON.parse(strFromU8(states)) };
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', us: 'US', 'united states of america': 'US', america: 'US', 'continental us': 'US',
  uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'great britain': 'GB',
  uae: 'AE', 'south korea': 'KR', korea: 'KR', czechia: 'CZ', 'the netherlands': 'NL', holland: 'NL',
};

const CA_PROVINCES: Record<string, string> = { ab: '01', bc: '02', mb: '03', nb: '04', nl: '05', ns: '07', on: '08', pe: '09', qc: '10', sk: '11' };

let loading: Promise<Gazetteer> | undefined;

export function loadGazetteer() {
  return (loading ??= gz('/geo/places.tsv.gz').then((buf) => {
    const g: Gazetteer = { places: new Map(), regions: new Map(), regionByKey: new Map(), countries: new Map(), countryByCode: new Map() };
    for (const line of strFromU8(buf).split('\n')) {
      if (!line) continue;
      const f = line.split('\t');
      if (f[0] === '#c') {
        const r = { key: f[1], name: f[2], lat: +f[3], lon: +f[4] };
        g.countries.set(norm(f[2]), r);
        g.countryByCode.set(f[1], r);
      } else if (f[0] === '#a') {
        const r = { key: f[1], name: f[2], lat: +f[3], lon: +f[4] };
        g.regionByKey.set(f[1], r);
        const n = norm(f[2]);
        g.regions.set(n, [...(g.regions.get(n) ?? []), r]);
        // US states go by their postal code too: "CA", "TX".
        if (f[1].startsWith('US.')) g.regions.set(f[1].slice(3).toLowerCase(), [r]);
      } else {
        const n = norm(f[0]);
        const rows = g.places.get(n);
        const row = { name: f[0], lat: +f[1], lon: +f[2], admin: f[3] };
        if (rows) rows.push(row);
        else g.places.set(n, [row]);
      }
    }
    for (const [abbr, code] of Object.entries(CA_PROVINCES)) {
      const r = g.regionByKey.get(`CA.${code}`);
      if (r && !g.regions.has(abbr)) g.regions.set(abbr, [r]);
    }
    return g;
  }));
}

/** Phrases that name a metro rather than a city. Checked before anything is stripped. */
const METROS: [RegExp, string][] = [
  [/\btampa bay\b/g, 'tampa, fl'],
  [/\b(sf |san francisco )?bay area\b|\bsilicon valley\b/g, 'san francisco, ca'],
  [/\bdallas[- ]+(ft|fort) worth\b|\bdfw\b/g, 'dallas, tx'],
  [/\bnyc\b|\bnew york city\b/g, 'new york city'],
  [/\btwin cities\b/g, 'minneapolis, mn'],
  [/\bresearch triangle\b|\brtp\b/g, 'raleigh, nc'],
  [/\binland empire\b/g, 'riverside, ca'],
  [/\borange county\b(, ca)?/g, 'irvine, ca'],
  [/\bwashington,? dc\b|\bdistrict of columbia\b/g, 'washington, dc'],
];

const REMOTE = /\b(remote|work from home|wfh|home office|anywhere|telecommute|distributed|virtual)\b/;

const NOISE =
  /\b(greater|metropolitan area|metro area|metroplex|metro|area|region|hq|headquarters|on-?site|in-?office|hybrid|remote|work from home|wfh|home office|job|only|nationwide|business-hours overlap|time ?zones?|\d+ days?( a week)?|days?|travel|(us|usa) (west|east|central)|west|east|central|anywhere|telecommute|distributed|virtual|eligible|based)\b/g;

const CITY_ALIASES: Record<string, string> = { 'new york': 'new york city', ny: 'new york city', sf: 'san francisco', la: 'los angeles' };

interface Qualifier {
  admin?: string;
  cc?: string;
}

function qualifier(g: Gazetteer, token: string): Qualifier | undefined {
  const cc = COUNTRY_ALIASES[token] ?? g.countries.get(token)?.key ?? (token.length === 2 && g.countryByCode.has(token.toUpperCase()) && !g.regions.has(token) ? token.toUpperCase() : undefined);
  if (cc) return { cc };
  const r = g.regions.get(token)?.[0];
  if (r) return { admin: r.key, cc: r.key.split('.')[0] };
  return undefined;
}

const fits = (row: Row, qs: Qualifier[]) => qs.every((q) => (q.admin ? row.admin === q.admin : !q.cc || row.admin.startsWith(`${q.cc}.`)));

function label(g: Gazetteer, name: string, admin: string) {
  const [cc] = admin.split('.');
  if (cc === 'US') return `${name}, ${admin.slice(3)}`;
  return `${name}, ${g.countryByCode.get(cc)?.name ?? cc}`;
}

const place = (lat: number, lon: number, label: string, cc: string, approx?: boolean): Place => ({
  key: `${lat.toFixed(1)},${lon.toFixed(1)}`,
  label,
  lat,
  lon,
  cc,
  approx,
});

function findCity(g: Gazetteer, city: string, qs: Qualifier[], prefer?: string): Row | undefined {
  const words = city.split(' ');
  // Drop trailing words until something matches: "San Antonio Home Office I".
  for (let n = words.length; n > 0; n--) {
    let name = words.slice(0, n).join(' ');
    name = CITY_ALIASES[name] ?? name;
    const variants = [name, name.replace(/^st /, 'saint '), name.replace(/^saint /, 'st '), name.replace(/^ft /, 'fort ')];
    for (const v of variants) {
      const rows = g.places.get(v);
      if (!rows) continue;
      const hit = qs.length
        ? // Strictly where it says, else anywhere in the same country.
          rows.find((r) => fits(r, qs)) ?? rows.find((r) => fits(r, qs.map((q) => ({ cc: q.cc }))))
        : (prefer && rows.find((r) => r.admin.startsWith(`${prefer}.`))) || rows[0];
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Where one segment ("Santa Clara, CA") points, or nothing. */
function resolve(g: Gazetteer, tokens: string[], inherited: Qualifier[], prefer?: string): Place | 'nationwide' | undefined {
  const [first, ...rest] = tokens;
  const own = rest.map((t) => qualifier(g, t)).filter((q): q is Qualifier => !!q);
  const qs = own.length ? own : inherited;

  // A country or US state on its own ("Brazil", "Texas, United States") is
  // the region, not the town of the same name. Elsewhere, a city named for its
  // province ("Tokyo, Japan") is the city. Anything qualified by a state is a city.
  const asRegion = CITY_ALIASES[first] || own.some((q) => q.admin) || (rest.length && !own.length) ? undefined : qualifier(g, first);
  const row = findCity(g, first, qs, prefer);
  if (asRegion && (!asRegion.admin || asRegion.cc === 'US' || !row)) {
    if (asRegion.admin) {
      const r = g.regionByKey.get(asRegion.admin)!;
      return place(r.lat, r.lon, asRegion.cc === 'US' ? r.name : `${r.name}, ${g.countryByCode.get(asRegion.cc!)?.name}`, asRegion.cc!, true);
    }
    if (asRegion.cc === 'US') return 'nationwide';
    const c = g.countryByCode.get(asRegion.cc!);
    if (c) return place(c.lat, c.lon, c.name, c.key, true);
  }

  if (row) return place(row.lat, row.lon, label(g, row.name, row.admin), row.admin.split('.')[0]);

  // No such town: fall back to the most specific qualifier we understood.
  const q = own.find((x) => x.admin) ?? own[0];
  if (q?.admin) {
    const r = g.regionByKey.get(q.admin)!;
    return place(r.lat, r.lon, r.name, q.cc!, true);
  }
  if (q?.cc === 'US') return 'nationwide';
  if (q?.cc) {
    const c = g.countryByCode.get(q.cc);
    if (c) return place(c.lat, c.lon, c.name, c.key, true);
  }
  return undefined;
}

export function locate(g: Gazetteer, text: string, prefer?: string): Located {
  // "CT-Windsor" and "NV-Remote" put the state first. Capitals only, so "(on-site)" isn't Ontario.
  let s = norm(text.replace(/(^|[;|(])\s*([A-Z]{2})-\s*([A-Za-z][A-Za-z ]*)/g, (_, pre, st, rest) => `${pre}${rest}, ${st}`));
  const remote = REMOTE.test(s);
  for (const [re, to] of METROS) s = s.replace(re, to);

  const segments = s
    .replace(/\(([^)]*)\)/g, ';$1;')
    .split(/;|\||\/|\bor\b|&|\band\b|·|•|\n/)
    .map((seg) =>
      seg
        .replace(NOISE, ' ')
        .split(',')
        .map((t) => t.replace(/[^a-z0-9 -]/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    )
    .filter((t) => t.length);

  // "Emeryville or Santa Clara, CA": the state on one applies to the others.
  let inherited: Qualifier[] = [];
  for (const t of segments) {
    const qs = t.slice(1).map((x) => qualifier(g, x)).filter((q): q is Qualifier => !!q);
    if (qs.length) inherited = qs;
  }

  const places = new Map<string, Place>();
  for (const t of segments) {
    const r = resolve(g, t, inherited, prefer);
    if (r && r !== 'nationwide') places.set(r.key, r);
  }
  return { places: [...places.values()], remote };
}

/**
 * Locate many listings at once. Unqualified names lean toward the country most
 * of your listings are in, so a bare "Santa Clara" is California, not Cuba.
 */
export function locateAll(g: Gazetteer, texts: string[]): Located[] {
  const first = texts.map((t) => locate(g, t));
  const tally = new Map<string, number>();
  for (const l of first) for (const p of l.places) tally.set(p.cc, (tally.get(p.cc) ?? 0) + 1);
  const prefer = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  return prefer ? texts.map((t) => locate(g, t, prefer)) : first;
}

export interface Pin {
  place: Place;
  weight: number;
}

const wrap = (d: number) => ((d % 360) + 360) % 360;

/**
 * The view that shows the most listings without zooming out to the whole
 * planet. Slides a window around the globe and keeps the busiest stretch;
 * whatever falls outside it is returned so the page can point to it.
 */
export function bestView<T extends Pin>(pins: T[], maxLon = 100, maxLat = 50) {
  if (!pins.length) return undefined;
  let best: { members: T[]; weight: number; span: number; west: number } | undefined;
  for (const anchor of pins) {
    const west = anchor.place.lon;
    const inLon = pins.filter((p) => wrap(p.place.lon - west) <= maxLon);
    // Within that stretch, the busiest band of latitude.
    for (const top of inLon) {
      const members = inLon.filter((p) => p.place.lat <= top.place.lat && top.place.lat - p.place.lat <= maxLat);
      const weight = members.reduce((n, p) => n + p.weight, 0);
      const span = Math.max(...members.map((p) => wrap(p.place.lon - west)));
      if (!best || weight > best.weight || (weight === best.weight && span < best.span)) best = { members, weight, span, west };
    }
  }
  const { members, west, span } = best!;
  const lats = members.map((p) => p.place.lat);
  const inside = new Set(members);
  return {
    // East may pass 180 so a view across the Pacific stays one rectangle.
    bounds: [west, Math.min(...lats), west + span, Math.max(...lats)] as [number, number, number, number],
    inside: members,
    outside: pins.filter((p) => !inside.has(p)),
  };
}
