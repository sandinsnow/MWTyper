const P = (c) => { let h = c.slice(1); if (h.length === 3) h = h.split("").map((x) => x + x).join(""); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
const lum = (rgb) => { const f = (v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }; return 0.2126*f(rgb[0]) + 0.7152*f(rgb[1]) + 0.0722*f(rgb[2]); };
const ratio = (a,b) => { const x = lum(P(a)), y = lum(P(b)); const hi = Math.max(x,y), lo = Math.min(x,y); return (hi+0.05)/(lo+0.05); };
const pairs = [
  ["#d0d7de", "#ffffff", "L code-block border vs page"],
  ["#3a3f47", "#22252b", "D code-block border vs page"],
  ["#eaeef2", "#f6f8fa", "L code bar bg vs code bg"],
  ["#262b33", "#1b1e23", "D code bar bg vs code bg"],
  ["#6e7781", "#ffffff", "L contentSeparator candidate"],
  ["#8b949e", "#22252b", "D contentSeparator candidate"],
  ["#a16207", "#ffffff", "L current chip vs page"],
  ["#a16207", "#ffecb0", "L current chip vs normal chip"],
  ["#0b0d10", "#a16207", "L ring vs current chip"],
  ["#0b0d10", "#ffffff", "L ring vs page"],
  ["#0b0d10", "#ffecb0", "L ring vs normal chip (bonus)"],
  ["#ffffff", "#a16207", "L current chip text"],
  ["#4a3f1a", "#22252b", "D normal chip vs page"],
  ["#4a3f1a", "#ffd54f", "D normal chip vs current chip"],
  ["#ffd54f", "#22252b", "D current chip vs page"],
  ["#92700e", "#ffd54f", "D ring vs current chip"],
  ["#92700e", "#22252b", "D ring vs page"],
  ["#1f2328", "#ffd54f", "D current chip text"],
  ["#ffe9a8", "#4a3f1a", "D normal chip text"],
  ["#1f2937", "#cfe2ff", "L selection text"],
  ["#d6d9de", "#2f5480", "D selection text"],
  ["#5b6472", "#f0f1f3", "L gutter text"],
  ["#98a0ab", "#25282e", "D gutter text"],
  ["#5b6472", "#eaeef2", "L code lang label text"],
  ["#98a0ab", "#262b33", "D code lang label text"],
];
for (const [a,b,label] of pairs) {
  const r = ratio(a,b);
  console.log(`${r.toFixed(2).padStart(6)}:1  ${r>=4.5?"TEXT":r>=3?"UI ":"LOW"}  ${label.padEnd(38)} ${a} on ${b}`);
}
