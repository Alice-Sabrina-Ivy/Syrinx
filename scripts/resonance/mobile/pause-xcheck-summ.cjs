// pause-xcheck-summ.cjs: medians of the pause-xcheck.mjs variants beside the reported summary.json rows (verification 2026-10-28).
// node scripts/resonance/mobile/pause-xcheck-summ.cjs v-pf v-dp ...  (CONDS=a,b,... to choose conditions)
const fs=require("fs"),path=require("path"); process.chdir(path.join(__dirname,"../../../build/resonance-mobile/pause"));
const med=(a)=>{const s=a.filter(x=>x!=null&&Number.isFinite(x)).sort((x,y)=>x-y); if(!s.length) return null; const i=(s.length-1)/2; return (s[Math.floor(i)]+s[Math.ceil(i)])/2;};
const f=(x,d=1)=>x==null?"-":x.toFixed(d);
const variants=process.argv.slice(2);
const sum=JSON.parse(fs.readFileSync("summary.json","utf8"));
const conds=(process.env.CONDS||"clean,brown_m70,brown_m55,brown_m52,brown_m50,brown_m48,brown_m45,brown_m40,pink_m55,pink_m52,pink_m50,pink_m48,pink_m40,ac_m52,ac_m50,ac_m45").split(",");
console.log("cond | variant | noise | floor | quiet% | idle% | thumb% | idle/min | trail | clears/min | streak% | 1-5s idle inside% | cf idle | cf trail | cf streak | inten same | thr diff");
for(const c of conds){
  const theirs=sum.rows.filter(r=>r.cond===c&&!r.noiseOnly);
  console.log(`${c} | REPORTED | - | ${f(med(theirs.map(r=>r.floorMeas?.medDb)))} | ${f(med(theirs.map(r=>r.floorMeas?.quietPct)))} | ${f(med(theirs.map(r=>r.act.idlePct)))} | ${f(med(theirs.map(r=>r.act.thumbPct)))} | ${f(med(theirs.map(r=>r.act.idlePerMin)))} | ${f(med(theirs.map(r=>r.act.trailMean)),2)} | ${f(med(theirs.map(r=>r.act.clearsPerMin)))} | ${f(med(theirs.map(r=>r.act.streakPct448)))} | ${f(med(theirs.map(r=>r.pauses?.act?.mid?.fallPct)))} | ${f(med(theirs.map(r=>r.cf.idlePct)))} | ${f(med(theirs.map(r=>r.cf.trailMean)))} | ${f(med(theirs.map(r=>r.cf.streakPct448)))}`);
  for(const v of variants){
    const R=fs.readFileSync(`xcheck/${v}.jsonl`,"utf8").trim().split("\n").map(JSON.parse).filter(r=>r.cond===c);
    const sm=(g)=>f(med(R.map(g)));
    console.log(`${c} | ${v} | ${f(med(R.map(r=>r.noiseAloneMedDb)),2)} | ${sm(r=>r.pauseFloorMedDb)} | ${sm(r=>r.pauseQuietPct)} | ${sm(r=>r.act.idlePct)} | ${sm(r=>r.act.thumbPct)} | ${sm(r=>r.act.idlePerMin)} | ${f(med(R.map(r=>r.act.trailMean)),2)} | ${sm(r=>r.act.clearsPerMin)} | ${sm(r=>r.act.streakPct)} | ${sm(r=>r.mid15?.idleInsidePct)} | ${sm(r=>r.cf.idlePct)} | ${sm(r=>r.cf.trailMean)} | ${sm(r=>r.cf.streakPct)} | ${R.filter(r=>r.intenCmp&&r.intenCmp.same===r.intenCmp.n).length}/${R.length} | ${R.map(r=>r.throttleCmp?.diff??"-").join(",")}`);
  }
}
