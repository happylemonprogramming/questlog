// Builds the map's offline data in public/geo. Run with `npm run geo` when
// you want fresher data; the output is committed, so builds don't need it.
//
//   places.tsv.gz      place names to coordinates, from GeoNames (CC BY 4.0)
//   countries.json.gz  country shapes, from Natural Earth via world-atlas
//   states.json.gz     US state shapes, from the Census via us-atlas
//
// Gzipped here and unzipped in the app, because static hosts like Blossom
// serve files as-is.
// Everything is looked up on the device, so listing locations never leave it.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync, strFromU8, strToU8, unzipSync } from 'fflate';

const OUT = new URL('../public/geo/', import.meta.url);
const DUMP = 'https://download.geonames.org/export/dump/';

/** US towns down to 1,000 people (lots of plants and labs sit in small towns); elsewhere 15,000. */
const keep = (cc, pop, code) => code === 'PPLC' || code === 'PPLA' || pop >= (cc === 'US' ? 1000 : 15000);

const get = async (f) => {
  const res = await fetch(DUMP + f);
  if (!res.ok) throw new Error(`${f}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
const rows = (text) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
const round = (n) => Math.round(Number(n) * 100) / 100;

const cities = rows(strFromU8(unzipSync(await get('cities1000.zip'))['cities1000.txt']));
const admin1 = rows(strFromU8(await get('admin1CodesASCII.txt')));
const countries = rows(strFromU8(await get('countryInfo.txt')));

const places = cities
  .map((c) => ({ name: c[2], lat: round(c[4]), lon: round(c[5]), code: c[7], cc: c[8], a1: c[10], pop: Number(c[14]) }))
  .filter((p) => p.name && keep(p.cc, p.pop, p.code))
  .sort((a, b) => b.pop - a.pop);

// Region centers: population-weighted for states and provinces, the capital
// for countries (a weighted mean puts France in the Atlantic).
const weight = new Map();
for (const p of places) {
  const k = `${p.cc}.${p.a1}`;
  const w = weight.get(k) ?? { lat: 0, lon: 0, pop: 0 };
  const pop = Math.max(p.pop, 1);
  w.lat += p.lat * pop;
  w.lon += p.lon * pop;
  w.pop += pop;
  weight.set(k, w);
}
const capital = new Map(places.filter((p) => p.code === 'PPLC').map((p) => [p.cc, p]));
const biggest = new Map();
for (const p of places) if (!biggest.has(p.cc)) biggest.set(p.cc, p);

const lines = [];
for (const c of countries) {
  const at = capital.get(c[0]) ?? biggest.get(c[0]);
  if (at) lines.push(['#c', c[0], c[4], at.lat, at.lon].join('\t'));
}
for (const a of admin1) {
  const w = weight.get(a[0]);
  if (w) lines.push(['#a', a[0], a[2], round(w.lat / w.pop), round(w.lon / w.pop)].join('\t'));
}
for (const p of places) lines.push([p.name, p.lat, p.lon, `${p.cc}.${p.a1}`].join('\t'));

const atlas = (f) => readFileSync(new URL(`../node_modules/${f}`, import.meta.url));
const write = (name, data) => writeFileSync(new URL(`${name}.gz`, OUT), gzipSync(data, { level: 9, mtime: 0 }));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
write('places.tsv', strToU8(lines.join('\n') + '\n'));
write('countries.json', atlas('world-atlas/countries-50m.json'));
write('states.json', atlas('us-atlas/states-10m.json'));
console.log(`${places.length} places, ${countries.length} countries, ${admin1.length} regions`);
