// Generate an app image via Gemini (Nano Banana) and save it. The API key is read from
// the gitignored ../../gemini.txt (repo root) or the GEMINI_KEY env var — never printed.
// Usage: node tools/gen-image.mjs "<prompt>" "assets/gen/<name>.png"
import fs from "node:fs";
import path from "node:path";

const KEYFILE = path.resolve(process.cwd(), "../../gemini.txt");
const [, , prompt, outPath] = process.argv;
if (!prompt || !outPath) { console.error('usage: node tools/gen-image.mjs "<prompt>" "<outPath>"'); process.exit(2); }

let key = (process.env.GEMINI_KEY || "").trim();
if (!key) {
  try {
    const txt = fs.readFileSync(KEYFILE, "utf8");
    const m = txt.match(/A(Iza|Q\.)[0-9A-Za-z_\-.]{20,60}/);
    key = m ? m[0] : txt.trim();
  } catch { console.error("NO_KEY (set GEMINI_KEY or add gemini.txt at repo root)"); process.exit(3); }
}

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-image";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
if (!res.ok) { console.error("HTTP", res.status, (await res.text()).slice(0, 300).replace(/A(Iza|Q\.)[0-9A-Za-z_\-.]+/g, "<key>")); process.exit(4); }
const data = await res.json();
const img = (data?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
if (!img) { console.error("NO_IMAGE", JSON.stringify(data).slice(0, 300)); process.exit(5); }
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(img.inlineData.data, "base64"));
console.log("OK", outPath, fs.statSync(outPath).size, "bytes");
