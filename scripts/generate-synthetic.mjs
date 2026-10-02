import { mkdir, writeFile } from "node:fs/promises";

let seed = 49201;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const output = new URL("../public/demo/", import.meta.url);
await mkdir(output, { recursive: true });

const mobility = ["id,longitude,latitude,timestamp,age_group,visit_type"];
for (let id = 0; id < 2000; id += 1) {
  const outlier = id >= 1970;
  const lon = outlier ? 106.91 + random() * .025 : 106.8 + (random() - .5) * .007;
  const lat = outlier ? -6.17 - random() * .02 : -6.2 + (random() - .5) * .007;
  const time = new Date(Date.UTC(2026, 5, 1, 6 + Math.floor(random() * 14), Math.floor(random() * 60), Math.floor(random() * 60))).toISOString();
  mobility.push([id, lon.toFixed(7), lat.toFixed(7), time, ["18-29", "30-44", "45-59"][Math.floor(random() * 3)], ["routine", "follow-up", "first-visit"][Math.floor(random() * 3)]].join(","));
}
await writeFile(new URL("synthetic-mobility.csv", output), `${mobility.join("\n")}\n`);

const fakeNames = ["Contoh A", "Contoh B", "Contoh C", "Contoh D"];
const identifiers = ["id,longitude,latitude,nama,email,telepon,alamat"];
for (let id = 0; id < 1000; id += 1) {
  identifiers.push([id, (106.8 + random() * .01).toFixed(6), (-6.2 + random() * .01).toFixed(6), quote(fakeNames[id % fakeNames.length]), `synthetic-${id}@example.invalid`, `0812${String(id).padStart(8, "0")}`, quote(`Alamat sintetis ${id}`)].join(","));
}
await writeFile(new URL("synthetic-identifiers.csv", output), `${identifiers.join("\n")}\n`);

const clean = ["id,longitude,latitude,category"];
for (let id = 0; id < 250; id += 1) clean.push([id, (106.7 + id * .00008).toFixed(4), (-6.4 + (id % 20) * .00008).toFixed(4), ["A", "B", "C"][id % 3]].join(","));
await writeFile(new URL("synthetic-control.csv", output), `${clean.join("\n")}\n`);
