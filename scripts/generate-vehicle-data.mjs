import { readFile, writeFile } from "node:fs/promises";

const inputs = [
  "../../vehicle-raw/my2015-2024.csv",
  "../../vehicle-raw/my2025.csv",
  "../../vehicle-raw/my2026.csv",
];

function parseLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

const grouped = new Map();
for (const relative of inputs) {
  const url = new URL(relative, import.meta.url);
  const text = (await readFile(url, "utf8")).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseLine(lines.shift());
  const column = (name) => header.indexOf(name);
  for (const line of lines) {
    const row = parseLine(line);
    const year = Number(row[column("Model year")]);
    if (year < 2020 || year > 2026) continue;
    const make = row[column("Make")]?.trim();
    const model = row[column("Model")]?.trim();
    if (!make || !model) continue;
    const key = `${year}|${make}|${model}`;
    const item = grouped.get(key) || { y: year, m: make, n: model, combined: [], city: [], highway: [], fuel: new Set(), vehicleClass: new Set() };
    const combined = Number(row[column("Combined (L/100 km)")]);
    const city = Number(row[column("City (L/100 km)")]);
    const highway = Number(row[column("Highway (L/100 km)")]);
    if (Number.isFinite(combined)) item.combined.push(combined);
    if (Number.isFinite(city)) item.city.push(city);
    if (Number.isFinite(highway)) item.highway.push(highway);
    if (row[column("Fuel type")]) item.fuel.add(row[column("Fuel type")]);
    if (row[column("Vehicle class")]) item.vehicleClass.add(row[column("Vehicle class")]);
    grouped.set(key, item);
  }
}

const average = (values) => values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
const output = [...grouped.values()].map((item) => ({
  y: item.y,
  m: item.m,
  n: item.n,
  c: average(item.combined),
  ct: average(item.city),
  h: average(item.highway),
  f: [...item.fuel].join("/"),
  cl: [...item.vehicleClass][0] || "",
})).sort((a, b) => b.y - a.y || a.m.localeCompare(b.m) || a.n.localeCompare(b.n));

await writeFile(new URL("../public/vehicle-ratings-ca-2020-2026.json", import.meta.url), JSON.stringify(output));
console.log(`Wrote ${output.length} Canadian vehicle ratings for 2020-2026.`);
