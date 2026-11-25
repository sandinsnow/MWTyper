// 求解器 v5：两套主题的最终可行解（含「当前命中块 vs 页面底 ≥3」这条关键约束）
const P=(c)=>{let h=c.slice(1);if(h.length===3)h=h.split("").map(x=>x+x).join("");return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
const lum=(rgb)=>{const f=v=>{const c=v/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]);};
const L=c=>lum(P(c));
const ratio=(a,b)=>{const x=L(a),y=L(b);const hi=Math.max(x,y),lo=Math.min(x,y);return(hi+0.05)/(lo+0.05);};
const hex=n=>n.toString(16).padStart(2,"0");
const hsv2hex=(h,s,v)=>{const c=v*s,x=c*(1-Math.abs(((h/60)%2)-1)),m=v-c;let r=0,g=0,b=0;
 if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
 return "#"+hex(Math.round((r+m)*255))+hex(Math.round((g+m)*255))+hex(Math.round((b+m)*255));};

function solveTheme(name, page, opt) {
  const { normalCands, normalTexts, curCands, curTexts, ringCands } = opt;
  const out=[];
  for(const N of normalCands) for(const Nt of normalTexts){
    if(ratio(Nt,N)<4.5) continue;
    for(const C of curCands) for(const Ct of curTexts){
      if(ratio(Ct,C)<4.5) continue;
      if(ratio(C,N)<3) continue;      // C3 状态可区分
      if(ratio(C,page)<3) continue;   // C7 当前块本身要能从页面底里被认出来
      for(const R of ringCands){
        if(ratio(R,C)<3) continue;    // C4 描边 vs 当前底
        if(ratio(R,page)<3) continue; // C5 描边 vs 页面底
        out.push({N,Nt,C,Ct,R,c6:ratio(R,N),w:Math.min(ratio(Nt,N),ratio(Ct,C),ratio(C,N),ratio(R,C),ratio(R,page))});
      }
    }
  }
  out.sort((a,b)=>(b.c6>=3?1:0)-(a.c6>=3?1:0)||b.w-a.w);
  console.log(`\n===== ${name}（页面底 ${page}）—— 解数 ${out.length} =====`);
  for(const o of out.slice(0,6)){
    console.log(`普通 ${o.N}/${o.Nt}(${ratio(o.Nt,o.N).toFixed(2)}) | 当前 ${o.C}/${o.Ct}(${ratio(o.Ct,o.C).toFixed(2)}) | 当前vs普通 ${ratio(o.C,o.N).toFixed(2)} 当前vs页面 ${ratio(o.C,page).toFixed(2)} | 描边 ${o.R} vs当前 ${ratio(o.R,o.C).toFixed(2)} vs页面 ${ratio(o.R,page).toFixed(2)} | C6描边vs普通 ${o.c6.toFixed(2)}${o.c6>=3?" ✓":" ✗"}`);
  }
  return out[0];
}

// ---- 亮色 ----
const lNormals=["#ffecb0","#ffe9a3","#fff3c4","#fde68a","#fef3c7"];
const lNormalTexts=["#1f2328","#2b2f36"];
const lCands=[];
for(let h=28;h<=46;h+=3)for(let s=0.6;s<=1.0;s+=0.05)for(let v=0.28;v<=0.62;v+=0.02)lCands.push(hsv2hex(h,s,v));
const lTexts=["#ffffff","#fff8e7","#fef3c7","#1f2328"];
const lRings=["#0b0d10","#1f2328","#292524","#3f3f46","#44403c","#7c3a00"];
solveTheme("亮色","#ffffff",{normalCands:lNormals,normalTexts:lNormalTexts,curCands:lCands,curTexts:lTexts,ringCands:lRings});

// ---- 暗色 ----
const dNormals=["#4a3f1a","#5c4a12","#6b5418","#54450f","#4d3f0d"];
const dNormalTexts=["#ffe9a8","#fff8e7","#fef3c7","#fde68a"];
const dCands=[];
for(let h=40;h<=56;h+=2)for(let s=0.7;s<=1.0;s+=0.05)for(let v=0.72;v<=1.0;v+=0.02)dCands.push(hsv2hex(h,s,v));
const dTexts=["#1f2328","#0b0d10","#1a1a1a"];
const dRings=[];
for(let h=30;h<=55;h+=2)for(let s=0.45;s<=1.0;s+=0.05)for(let v=0.30;v<=0.66;v+=0.02)dRings.push(hsv2hex(h,s,v));
solveTheme("暗色","#22252b",{normalCands:dNormals,normalTexts:dNormalTexts,curCands:dCands,curTexts:dTexts,ringCands:dRings});
