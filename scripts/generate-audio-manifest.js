#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const audioDir = path.resolve(__dirname, "..", "Audio");
const outputDir = path.join(audioDir, "base");
const outputFile = path.join(outputDir, "manifest.json");

const tokens = [
  { token: "month_1", text: "いちがつ" },
  { token: "month_2", text: "にがつ" },
  { token: "month_3", text: "さんがつ" },
  { token: "month_4", texts: ["よんがつ", "しがつ"] },
  { token: "month_5", text: "ごがつ" },
  { token: "month_6", text: "ろくがつ" },
  { token: "month_7", text: "しちがつ" },
  { token: "month_8", text: "はちがつ" },
  { token: "month_9", text: "くがつ" },
  { token: "month_10", text: "じゅうがつ" },
  { token: "month_11", text: "じゅういちがつ" },
  { token: "month_12", text: "じゅうにがつ" },
  { token: "weekday_1", text: "げつようび" },
  { token: "weekday_2", text: "かようび" },
  { token: "weekday_3", text: "すいようび" },
  { token: "weekday_4", text: "もくようび" },
  { token: "weekday_5", text: "きんようび" },
  { token: "weekday_6", text: "どようび" },
  { token: "weekday_7", text: "にちようび" },
  { token: "day_1", text: "ついたち" },
  { token: "day_2", text: "ふつか" },
  { token: "day_3", text: "みっか" },
  { token: "day_4", text: "よっか" },
  { token: "day_5", text: "いつか" },
  { token: "day_6", text: "むいか" },
  { token: "day_7", text: "なのか" },
  { token: "day_8", text: "ようか" },
  { token: "day_9", text: "ここのか" },
  { token: "day_10", text: "とおか" },
  { token: "day_11", text: "じゅういちにち" },
  { token: "day_12", text: "じゅうににち" },
  { token: "day_13", text: "じゅうさんにち" },
  { token: "day_14", text: "じゅうよっか" },
  { token: "day_15", text: "じゅうごにち" },
  { token: "day_16", text: "じゅうろくにち" },
  { token: "day_17", text: "じゅうしちにち" },
  { token: "day_18", text: "じゅうはちにち" },
  { token: "day_19", text: "じゅうくにち" },
  { token: "day_20", text: "はつか" },
  { token: "day_21", text: "にじゅういちにち" },
  { token: "day_22", text: "にじゅうににち" },
  { token: "day_23", text: "にじゅうさんにち" },
  { token: "day_24", text: "にじゅうよっか" },
  { token: "day_25", text: "にじゅうごにち" },
  { token: "day_26", text: "にじゅうろくにち" },
  { token: "day_27", text: "にじゅうしちにち" },
  { token: "day_28", text: "にじゅうはちにち" },
  { token: "day_29", text: "にじゅうくにち" },
  { token: "day_30", text: "さんじゅうにち" },
  { token: "day_31", text: "さんじゅういちにち" }
];

const audioFiles = fs.readdirSync(audioDir).filter((file) => file.endsWith(".wav"));
const mapping = {};
const audioLookup = new Map();

for(const file of audioFiles){
  const base = path.basename(file, ".wav");
  const text = base.split("_").pop();
  if(text){
    audioLookup.set(text, file);
  }
}

for(const entry of tokens){
  const candidates = entry.texts || [entry.text];
  const match = candidates.map((text) => audioLookup.get(text)).find(Boolean);
  if(!match){
    console.warn(`Missing audio file for ${entry.token} (${candidates.join(", ")})`);
    continue;
  }
  mapping[entry.token] = match;
}

fs.mkdirSync(outputDir, {recursive: true});
fs.writeFileSync(outputFile, JSON.stringify({version: 1, tokens: mapping}, null, 2));
console.log(`Wrote ${Object.keys(mapping).length} tokens to ${outputFile}`);
