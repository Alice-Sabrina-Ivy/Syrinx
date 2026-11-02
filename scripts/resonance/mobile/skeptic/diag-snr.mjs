// Aggregate-only: per phone diag snapshot, voiced vs unvoiced broadband inputRms (dBFS).
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
const dir = process.argv[2] ?? path.join(path.resolve(path.dirname(toPath(import.meta.url)), "../../../.."), "measurements/mobile-diag-runs");
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y); if(!s.length) return null; const i=(s.length-1)*p, lo=Math.floor(i); return s[lo]+(s[Math.min(lo+1,s.length-1)]-s[lo])*(i-lo);};
const out=[];
for (const f of fs.readdirSync(dir).filter(x=>x.endsWith(".json"))) {
  let j; try { j=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8")); } catch { continue; }
  const s=j.snapshot; if(!s?.frames?.length) continue;
  const db=(r)=>20*Math.log10(Math.max(r,1e-9));
  const v=s.frames.filter(x=>x.pitch!=null && x.inputRms>0).map(x=>db(x.inputRms));
  const u=s.frames.filter(x=>x.pitch==null && x.inputRms>0).map(x=>db(x.inputRms));
  const all=s.frames.filter(x=>x.inputRms>0).map(x=>db(x.inputRms));
  out.push({f:f.slice(0,19), kind:s.audio?.captureKind, frame:s.audio?.mstpFrameDurationMs, n:s.frames.length, vShare:(v.length/s.frames.length).toFixed(2),
    vP50:q(v,.5)?.toFixed(1), vP10:q(v,.1)?.toFixed(1), vSpread:(q(v,.9)-q(v,.1))?.toFixed(1), uP10:q(u,.1)?.toFixed(1), uP50:q(u,.5)?.toFixed(1), allP05:q(all,.05)?.toFixed(1),
    snrProxy: (q(v,.5)-q(all,.05)).toFixed(1)});
}
console.table(out);
