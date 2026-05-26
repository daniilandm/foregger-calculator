#!/usr/bin/env node
/**
 * Foregger Energy Solutions — Daily diesel price updater
 * Scrapes AAA state-average diesel prices and writes prices.json
 * Run by GitHub Actions every morning at 7am ET
 */

const https = require("https");
const fs    = require("fs");

const AAA_URL = "https://gasprices.aaa.com/state-gas-price-averages/";

// Keep electricity rates stable (from EIA 2025 baseline — update quarterly)
const KWH_RATES = {
  AL:{pub:0.431,dep:0.1896}, AK:{pub:0.517,dep:0.2275}, AZ:{pub:0.409,dep:0.18},
  AR:{pub:0.43,dep:0.1892},  CA:{pub:0.379,dep:0.1668}, CO:{pub:0.338,dep:0.1487},
  CT:{pub:0.371,dep:0.1632}, DE:{pub:0.318,dep:0.1399}, DC:{pub:0.349,dep:0.1536},
  FL:{pub:0.382,dep:0.1681}, GA:{pub:0.381,dep:0.1676}, HI:{pub:0.467,dep:0.2055},
  ID:{pub:0.421,dep:0.1852}, IL:{pub:0.377,dep:0.1659}, IN:{pub:0.386,dep:0.1698},
  IA:{pub:0.34,dep:0.1496},  KS:{pub:0.252,dep:0.1109}, KY:{pub:0.416,dep:0.183},
  LA:{pub:0.423,dep:0.1861}, ME:{pub:0.381,dep:0.1676}, MD:{pub:0.28,dep:0.1232},
  MA:{pub:0.35,dep:0.154},   MI:{pub:0.373,dep:0.1641}, MN:{pub:0.376,dep:0.1654},
  MS:{pub:0.378,dep:0.1663}, MO:{pub:0.28,dep:0.1232},  MT:{pub:0.428,dep:0.1883},
  NE:{pub:0.283,dep:0.1245}, NV:{pub:0.41,dep:0.1804},  NH:{pub:0.435,dep:0.1914},
  NJ:{pub:0.398,dep:0.1751}, NM:{pub:0.376,dep:0.1654}, NY:{pub:0.355,dep:0.1562},
  NC:{pub:0.327,dep:0.1439}, ND:{pub:0.42,dep:0.1848},  OH:{pub:0.395,dep:0.1738},
  OK:{pub:0.401,dep:0.1764}, OR:{pub:0.386,dep:0.1698}, PA:{pub:0.366,dep:0.161},
  RI:{pub:0.353,dep:0.1553}, SC:{pub:0.453,dep:0.1993}, SD:{pub:0.343,dep:0.1509},
  TN:{pub:0.435,dep:0.1914}, TX:{pub:0.356,dep:0.1566}, UT:{pub:0.289,dep:0.1272},
  VT:{pub:0.326,dep:0.1434}, VA:{pub:0.342,dep:0.1505}, WA:{pub:0.344,dep:0.1514},
  WV:{pub:0.478,dep:0.2103}, WI:{pub:0.423,dep:0.1861}, WY:{pub:0.385,dep:0.1694},
};

const STATE_NAMES = {
  Alabama:"AL", Alaska:"AK", Arizona:"AZ", Arkansas:"AR", California:"CA",
  Colorado:"CO", Connecticut:"CT", Delaware:"DE", "District of Columbia":"DC",
  Florida:"FL", Georgia:"GA", Hawaii:"HI", Idaho:"ID", Illinois:"IL",
  Indiana:"IN", Iowa:"IA", Kansas:"KS", Kentucky:"KY", Louisiana:"LA",
  Maine:"ME", Maryland:"MD", Massachusetts:"MA", Michigan:"MI", Minnesota:"MN",
  Mississippi:"MS", Missouri:"MO", Montana:"MT", Nebraska:"NE", Nevada:"NV",
  "New Hampshire":"NH", "New Jersey":"NJ", "New Mexico":"NM", "New York":"NY",
  "North Carolina":"NC", "North Dakota":"ND", Ohio:"OH", Oklahoma:"OK",
  Oregon:"OR", Pennsylvania:"PA", "Rhode Island":"RI", "South Carolina":"SC",
  "South Dakota":"SD", Tennessee:"TN", Texas:"TX", Utah:"UT", Vermont:"VT",
  Virginia:"VA", Washington:"WA", "West Virginia":"WV", Wisconsin:"WI",
  Wyoming:"WY",
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = require(url.startsWith("https") ? "https" : "http");
    mod.get(url, { headers: { "User-Agent": "FES-Price-Bot/1.0" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseDiesel(html) {
  const results = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, "").trim());
    if (cells.length < 5) continue;
    const code = STATE_NAMES[cells[0]];
    if (!code) continue;
    const price = parseFloat(cells[4].replace(/[^0-9.]/g, ""));
    if (isFinite(price) && price > 1 && price < 20) results[code] = price;
  }
  return results;
}

async function main() {
  console.log("Fetching AAA prices...");
  const html = await fetch(AAA_URL);
  const prices = parseDiesel(html);
  console.log(`Parsed ${Object.keys(prices).length} states`);

  if (Object.keys(prices).length < 40) {
    throw new Error("Too few states — AAA markup may have changed. Aborting.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const states = Object.entries(STATE_NAMES)
    .filter(([, code]) => prices[code])
    .map(([name, code]) => ({
      code, name,
      diesel: prices[code],
      publicKwh: KWH_RATES[code]?.pub ?? 0.35,
      depotKwh:  KWH_RATES[code]?.dep ?? 0.154,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const avg = (states.reduce((s, x) => s + x.diesel, 0) / states.length).toFixed(3);
  const output = { date: today, nationalAverage: parseFloat(avg), source: AAA_URL, states };

  fs.writeFileSync("prices.json", JSON.stringify(output, null, 2));
  console.log(`✓ prices.json written — ${states.length} states, national avg $${avg}`);
}

main().catch(e => { console.error("✗", e.message); process.exit(1); });
