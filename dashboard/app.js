(() => {
'use strict';
const $=id=>document.getElementById(id),app=$('app'),wl=$('swl'),D=window.RADAR_DATA,WD='<span class="wd"></span>';
const h=(t,c,b='')=>`<${t}${c?` class="${c}"`:''}>${b}</${t}>`;
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=n=>typeof n==='number'&&Number.isFinite(n);
const usd=n=>{if(!N(n))return '--';const s=n<0?'-':'',v=Math.abs(n),f=(x,u)=>`${s}$${x>=100?x.toFixed(0):x>=10?x.toFixed(1):x.toFixed(2)}${u}`;return v>=1e9?f(v/1e9,'B'):v>=1e6?f(v/1e6,'M'):v>=1e3?f(v/1e3,'K'):`${s}$${Math.round(v)}`;};
const usdX=n=>N(n)?`$${Math.round(n).toLocaleString('en-US')}`:'--';
const pct=n=>N(n)?`${n>0?'+':''}${n.toFixed(1)}%`:'\u2014';
const pri=n=>N(n)?`${n.toFixed(1)}%`:'--';
const rat=(i,t)=>N(i)&&N(t)&&t>0?`$${(i/t).toFixed(2)}`:'--';
const mx=(m,s)=>N(m)?`${m>=10?m.toFixed(s?1:2):m>=1?m.toFixed(s?2:3):m.toFixed(s?3:4)}\u00d7`:'--';
const dlt=m=>{if(!N(m))return '';const p=(m-1)*100;return Math.abs(p)<.05?'0.0%':`${p>0?'+':''}${p.toFixed(1)}%`;};
const days=(a,b)=>{if(!a||!b)return null;const t1=Date.parse(`${a}T00:00:00Z`),t2=Date.parse(`${b}T00:00:00Z`);return Number.isFinite(t1)&&Number.isFinite(t2)?Math.max(0,Math.round((t2-t1)/864e5)):null;};
const hrs=m=>{const hr=Math.floor(m/60),rm=m%60;return !hr?`~${rm}m`:!rm?`~${hr}h`:`~${hr}h ${rm}m`;};
const planOf=r=>{const m=(r.steps[0]||'').match(/^Budget:\s*(\$[0-9,]+)\s+over\s+~?(\d+)\s+weeks?,\s*~?(\d+)\s*min\/week/i);if(m)return{cap:m[1],time:`${hrs(+m[2]*+m[3])} (${m[2]}w \u00b7 ~${m[3]}m/wk)`};const[cap,w]=r.tvl<1e7?['$250',8]:r.tvl<5e7?['$500',10]:r.tvl<2.5e8?['$1,000',12]:['$2,500',16];return{cap,time:`${hrs(w*15)} (${w}w \u00b7 ~15m/wk)`};};
if(!D||!Array.isArray(D.rows)){app.innerHTML='<section class="nc"><h2>No data</h2><p>Run <code>node main.ts</code>.</p></section>';return;}

const MS=D.model_stats||{},B=N(MS.tvl_elasticity_beta)?MS.tvl_elasticity_beta:1,PV=N(MS.tvl_pivot_usd)&&MS.tvl_pivot_usd>0?MS.tvl_pivot_usd:1;
const tEff=t=>t>0&&PV>0?PV*Math.pow(t/PV,B):t||0;
const catArr=Array.isArray(D.cats)?D.cats:[],cats={};
for(const c of catArr)cats[c[0]]={peers:c[1],med:c[2],p25:c[3],p75:c[4],prior:c[5]};
const sm=D.farm_steps||{},mm=D.row_meta||{};
const rows=D.rows.map(r=>{
 if(!Array.isArray(r))return{rank:r.rank,slug:r.slug,name:r.name,cat:r.category,chs:r.chains||[],tvl:r.tvl_usd,te:r.effective_tvl_usd||Math.round(tEff(r.tvl_usd)),d7:r.change_7d,at:r.listed_at,w:!!r.watchlist,val:r.implied_value_usd,lo:r.implied_low_usd,hi:r.implied_high_usd,m:r.multiple_used,mom:r.momentum_mult,mat:r.maturity_mult,brd:r.breadth_mult,pr:r.launch_prior,fs:r.farm_score,steps:r.farm_steps||[]};
 const s=r[1],ci=catArr[r[3]],cat=ci?ci[0]:'Uncategorized',mt=mm[s],tvl=mt?mt[2]:Math.round(r[4]*1e6);
 return{rank:r[0],slug:s,name:r[2],cat,chs:mt?mt[1]:['Ethereum'],tvl,te:mt?mt[3]:Math.round(tEff(tvl)),d7:mt?mt[11]:null,at:mt?mt[0]:null,w:!!r[9],val:mt?mt[4]:Math.round(r[5]*1e6),lo:mt?mt[5]:Math.round(r[6]*1e6),hi:mt?mt[6]:Math.round(r[7]*1e6),m:mt?mt[7]:(ci?ci[2]:.24),mom:mt?mt[8]:1,mat:mt?mt[9]:1,brd:mt?mt[10]:1,pr:ci?ci[5]:0,fs:r[8],steps:sm[s]||[]};
}).sort((a,b)=>a.rank-b.rank);
const peers=(D.live_peers||[]).map((p,i)=>Array.isArray(p)?{rank:i+1,slug:p[0],name:p[1],sym:p[2],cat:p[3],chs:p[4],tvl:p[5],mcap:p[6],raw:p[7],norm:p[8],d7:p[9]}:{rank:i+1,slug:p.slug,name:p.name,sym:p.symbol,cat:p.category,chs:p.chains||[],tvl:p.tvl_usd,mcap:p.mcap_usd,raw:p.raw_multiple,norm:p.norm_multiple,d7:p.change_7d});

const bySlug=new Map(),peerMap=new Map(),pByCat=new Map(),preC={},preCh={},pC={},pCh={};
let wCt=0;
for(const r of rows){bySlug.set(r.slug,r);if(r.w)wCt++;preC[r.cat]=(preC[r.cat]||0)+1;for(const c of r.chs)preCh[c]=(preCh[c]||0)+1;}
for(const p of peers){peerMap.set(p.slug,p);pC[p.cat]=(pC[p.cat]||0)+1;(pByCat.get(p.cat)||pByCat.set(p.cat,[]).get(p.cat)).push(p);for(const c of p.chs)pCh[c]=(pCh[c]||0)+1;}
$('md').textContent=D.as_of||'--';$('st').innerHTML=`${rows.length} <span class="ks">/ ${peers.length}</span>`;$('sw').textContent=String(wCt);
$('s10').textContent=usd(rows.slice(0,10).reduce((a,r)=>a+r.val,0));
if(N(D.floor_usd))$('ff').textContent=`TVL FLOOR ${usd(D.floor_usd)}`;

const st={view:'board',tab:'pre',slug:null,q:'',cat:'',chain:'',watch:false,minTvl:0,sk:'rank',sd:'asc',psk:'mcap',psd:'desc'};
let mnt=false,dom={};
const parseHash=()=>{
 const raw=(location.hash||'').replace(/^#/,''),pm=raw.match(/^\/protocol\/(.+?)\/?$/);
 if(pm){let s=pm[1];try{s=decodeURIComponent(s);}catch(_){}return{view:'detail',slug:s};}
 const qi=raw.indexOf('?'),p=qi!==-1?new URLSearchParams(raw.slice(qi+1)):null;
 return{view:'board',tab:p&&p.get('tab')==='peers'?'peers':'pre',cat:(p&&p.get('cat'))||'',chain:(p&&p.get('chain'))||'',watch:!!(p&&p.get('watch')==='1')};
};
const syncHash=()=>{
 const p=new URLSearchParams();
 if(st.tab==='peers')p.set('tab','peers');if(st.cat)p.set('cat',st.cat);if(st.chain)p.set('chain',st.chain);if(st.watch&&st.tab==='pre')p.set('watch','1');
 const hs=p.toString()?`#/?${p}`:'#/' ;if(location.hash!==hs)try{history.replaceState(null,'',hs);}catch(_){}
};

function modelCard(){
 const v=MS.validation||{},gm=mx(MS.global_median_multiple,1);
 const hl=v.count?`LOO (${v.count} peers): median pred/actual <strong>\u00d7${v.median_ratio.toFixed(2)}</strong> &middot; within 2&times; <strong>${v.within_2x_pct.toFixed(1)}%</strong> &middot; within 3&times; <strong>${v.within_3x_pct.toFixed(1)}%</strong> &middot; p25&ndash;p75 coverage <strong>${(v.iqr_coverage_pct||0).toFixed(1)}%</strong>`:'TVL power-law model';
 const more=`OLS &beta;=${B.toFixed(4)}, pivot ${usd(PV)} (T<sub>eff</sub>=T<sub>0</sub>&middot;(TVL/T<sub>0</sub>)<sup>&beta;</sup>). Peer ratios mcap/T<sub>eff</sub> pre-Winsorized at p90 (${mx(MS.multiple_cap_p90,1)}), log-shrunk (k=${MS.shrinkage_weight||8}) toward med ${gm} (IQR ${mx(MS.global_p25_multiple,1)}&ndash;${mx(MS.global_p75_multiple,1)}). Recentered factors: mom (&times;0.15), mat (0.90&ndash;1.08), breadth (0.98/1.00/1.02). LOO RMSLE <strong>${N(v.rmsle_log10)?v.rmsle_log10.toFixed(3):'--'}</strong>, MAE <strong>${N(v.mae_log10)?v.mae_log10.toFixed(3):'--'}</strong>.`;
 return h('section','mc',h('div','sb mct',h('div','row mcl',h('h2','mch m u','Model Card')+h('span','mp m',`<span>&beta;=<strong>${B.toFixed(3)}</strong> (TVL<sup>&beta;</sup>)</span>`)+h('span','mp m',`Global med <strong>${gm}</strong>`)+h('span','mp m',`Log-shrink <strong>k=${MS.shrinkage_weight||8}</strong> &middot; p90 ${mx(MS.multiple_cap_p90,1)}`))+h('div','mf m','<strong>Implied</strong> = T<sub>eff</sub>(TVL<sup>&beta;</sup>) &times; Cat Mult &times; Mom &times; Mat &times; Breadth'))+h('div','mr2',h('p','mh',hl)+`<details class="mm m"><summary>Calibration details</summary><p class="mmb">${more}</p></details>`));
}

function scatterSvg(matched,filt){
 const isP=st.tab==='peers',src=isP?peers:rows,yOf=r=>isP?r.mcap:r.val;
 const W=1280,H=134,pL=52,pR=16,pT=9,pB=26,pw=W-pL-pR,ph=H-pT-pB;
 const ok=src.filter(r=>r.tvl>0&&yOf(r)>0);if(!ok.length)return '';
 let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
 for(const r of ok){const lx=Math.log10(r.tvl),ly=Math.log10(yOf(r));x0=Math.min(x0,lx);x1=Math.max(x1,lx);y0=Math.min(y0,ly);y1=Math.max(y1,ly);}
 const xLo=Math.min(Math.floor(x0*2)/2,x0-.1),xHi=x1+.14,yLo=Math.min(Math.floor(y0*2)/2,y0-.14),yHi=y1+.2;
 const sx=v=>pL+((v-xLo)/(xHi-xLo||1))*pw,sy=v=>pT+(1-(v-yLo)/(yHi-yLo||1))*ph,f=n=>n.toFixed(1);
 const ln=(a,b,c,d,s,x='')=>`<line x1="${f(a)}" y1="${f(b)}" x2="${f(c)}" y2="${f(d)}" stroke="${s}"${x}/>`;
 const p=[`<rect x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="#050a07b8" stroke="#58e09029"/>`];
 for(let e=Math.ceil(xLo);e<=Math.floor(xHi);e++){const x=sx(e);p.push(ln(x,pT,x,pT+ph,'#58e0901a')+`<text class="stk m" x="${f(x)}" y="${H-13}" text-anchor="middle">${esc(usd(10**e))}</text>`);}
 for(let e=Math.ceil(yLo);e<=Math.floor(yHi);e++){const y=sy(e);p.push(ln(pL,y,pL+pw,y,'#58e0901a')+`<text class="stk m" x="${pL-6}" y="${f(y+3)}" text-anchor="end">${esc(usd(10**e))}</text>`);}
 p.push(`<text class="sax m" x="${f(pL+pw/2)}" y="${H-2}" text-anchor="middle">TVL (LOG SCALE)</text><text class="sax m" x="11" y="${f(pT+ph/2)}" text-anchor="middle" transform="rotate(-90 11 ${f(pT+ph/2)})">${isP?'MCAP (LOG)':'IMPLIED (LOG)'}</text>`);
 let ml=null;
 if(N(MS.global_median_multiple)&&MS.global_median_multiple>0){
  const ly=lx=>Math.log10(PV*MS.global_median_multiple)+B*(lx-Math.log10(PV)),a=ly(xLo),b=ly(xHi);
  const c1=a<yLo?xLo+(yLo-a)/B:a>yHi?xLo+(yHi-a)/B:xLo,c2=b>yHi?xHi-(b-yHi)/B:b<yLo?xHi-(b-yLo)/B:xHi;
  if(c2>c1){ml={x1:sx(c1),y1:sy(ly(c1)),x2:sx(c2),y2:sy(ly(c2))};p.push(ln(ml.x1,ml.y1,ml.x2,ml.y2,'#7ff7b266',' stroke-dasharray="4 4"'));}
 }
 const dot=r=>{
  const x=sx(Math.log10(r.tvl)),y=sy(Math.log10(yOf(r))),top=r.rank<=5,op=!filt||matched.has(r.slug)?(top?1:r.w?.92:.65):.14,sl=esc(r.slug);
  if(!isP&&top)p.push(`<circle cx="${f(x)}" cy="${f(y)}" r="6.2" fill="none" stroke="${r.w?'#f5b03894':'#3bf28aa3'}" stroke-width="1.1" opacity="${op}"/>`);
  if(!isP&&r.w){const s=top?4:3.1;p.push(`<polygon class="pt" data-slug="${sl}" points="${f(x)},${f(y-s)} ${f(x+s)},${f(y)} ${f(x)},${f(y+s)} ${f(x-s)},${f(y)}" fill="#f5b038" stroke="#050a07" stroke-width=".6" opacity="${op}"/>`);}
  else p.push(`<circle class="pt" data-${isP?'peer':'slug'}="${sl}" cx="${f(x)}" cy="${f(y)}" r="${top?3.8:2.6}" fill="${isP?(top?'#5fd3f3':'#4ab5d4'):(top?'#3bf28a':'#58e090')}" stroke="#050a07" stroke-width=".6" opacity="${op}"/>`);
 };
 for(const r of ok)if(!r.w)dot(r);for(const r of ok)if(r.w)dot(r);
 const pl=[],hits=b=>pl.some(q=>!(b.x2+4<q.x1||b.x1-4>q.x2||b.y2+2<q.y1||b.y1-2>q.y2));
 for(const r of(filt?ok.filter(x=>matched.has(x.slug)):ok).slice(0,5)){
  const px=sx(Math.log10(r.tvl)),py=sy(Math.log10(yOf(r))),nm=r.name.length>22?`${r.name.slice(0,20)}\u2026`:r.name;
  const txt=isP?`${nm} (${r.sym})`:`#${r.rank} ${nm}`,bw=txt.length*5.7+9,bh=13.5;
  let bx=null;
  for(const[cx,cy]of[[px-9-bw,py-bh/2],[px+9,py-bh/2],[px-9-bw,py-bh-4],[px-9-bw,py+6],[px+9,py-bh-4],[px+9,py+6]]){
   const a=Math.max(pL+3,Math.min(W-pR-3-bw,cx)),b=Math.max(pT+2,Math.min(pT+ph-2-bh,cy)),q={x1:a,y1:b,x2:a+bw,y2:b+bh};
   if(!hits(q)){bx=q;break;}
  }
  if(!bx){const a=Math.max(pL+3,Math.min(W-pR-3-bw,px-9-bw)),b=Math.max(pT+2,Math.min(pT+ph-2-bh,pT+2+pl.length*15));bx={x1:a,y1:b,x2:a+bw,y2:b+bh};}
  pl.push(bx);
  const lx=px<bx.x1?bx.x1:px>bx.x2?bx.x2:bx.x1+bw/2,ly=py<bx.y1?bx.y1:py>bx.y2?bx.y2:bx.y1+bh/2;
  const col=isP?'#5fd3f399':r.w?'#f5b0389e':'#7ff7b28a',tc=isP?'#5fd3f3':r.w?'#f5b038':'#e8f5ed';
  p.push(`<g>${ln(px,py,lx,ly,col,' stroke-width=".8"')}<rect x="${f(bx.x1)}" y="${f(bx.y1)}" width="${f(bw)}" height="${bh}" rx="3" fill="#050a07e6" stroke="${col}" stroke-width=".7"/><text class="pt slb m" data-${isP?'peer':'slug'}="${esc(r.slug)}" x="${f(bx.x1+4.5)}" y="${f(bx.y1+10)}" fill="${tc}">${esc(txt)}</text></g>`);
 }
 if(ml){
  const lbl=`TVL^${B.toFixed(2)} \u00d7 ${mx(MS.global_median_multiple,1)}`,lw=lbl.length*5.7,mxp=ml.x2-5;
  let my=Math.min(pT+ph-4,Math.max(pT+22,ml.y2+16));while(my<pT+ph-4&&hits({x1:mxp-lw,y1:my-10,x2:mxp,y2:my+2}))my+=12;
  p.push(`<rect x="${f(mxp-lw-4)}" y="${f(my-10)}" width="${f(lw+6)}" height="12" rx="2" fill="#050a07d9"/><text class="stk m" x="${f(mxp)}" y="${f(my)}" text-anchor="end" fill="#7ff7b2cc">${esc(lbl)}</text>`);
 }
 return `<svg class="svg" viewBox="0 0 ${W} ${H}">${p.join('')}</svg>`;
}

function fillSelects(){
 const cm=st.tab==='peers'?pC:preC,chm=st.tab==='peers'?pCh:preCh;
 const opt=(m,all)=>`<option value="">${all} (${Object.keys(m).length})</option>`+Object.keys(m).sort((a,b)=>a.localeCompare(b)).map(k=>`<option value="${esc(k)}">${esc(k)} (${m[k]})</option>`).join('');
 dom.cat.innerHTML=opt(cm,'All categories');dom.ch.innerHTML=opt(chm,'All chains');
 dom.cat.value=cm[st.cat]?st.cat:'';dom.ch.value=chm[st.chain]?st.chain:'';
}

function mountBoard(){
 const fld=(id,l,inner,c='')=>h('div',`col fld${c}`,`<label class="fl m u" for="${id}">${l}</label>${inner}`);
 app.innerHTML=modelCard()+
  h('section','sc bx','<div class="sb sch"><h2 class="sct m u" id="sct"></h2><div class="row scl m" id="scl"></div></div><div class="scw" id="scw"></div><div class="tip m" id="tip" hidden></div>')+
  h('section','ctl bx',fld('fq','Search','<input id="fq" class="in" type="search" placeholder="Filter protocol, ticker, slug..." autocomplete="off">',' fsw')+fld('fc','Category','<select id="fc" class="sel"></select>')+fld('fch','Chain','<select id="fch" class="sel"></select>')+fld('ft','Min TVL','<select id="ft" class="sel"><option value="0">Any TVL</option><option value="10000000">$10M+</option><option value="50000000">$50M+</option><option value="250000000">$250M+</option></select>')+`<label class="wt" id="fww"><input id="fw" type="checkbox">${WD}<span>Watchlist only</span></label>`)+
  h('div','sb sbar',`<div class="row tabs" role="tablist"><button type="button" role="tab" class="tab m" id="tp0" data-tab="pre">Pre-Token Radar <span class="tct">${rows.length}</span></button><button type="button" role="tab" class="tab tp m" id="tp1" data-tab="peers">Live Token Peers <span class="tct">${peers.length}</span></button></div><div class="msum m" id="msum"></div><div class="row sact"><span class="lchip m" id="wlg">${WD}Amber bar = watchlist</span><button type="button" class="rst m u" id="brst" hidden>Reset</button></div>`)+
  '<section class="tf bx" id="tf"></section>';
 dom={sct:$('sct'),scl:$('scl'),scw:$('scw'),tip:$('tip'),q:$('fq'),cat:$('fc'),ch:$('fch'),tvl:$('ft'),w:$('fw'),ww:$('fww'),wl:$('wlg'),t0:$('tp0'),t1:$('tp1'),ms:$('msum'),rst:$('brst'),tf:$('tf')};
 dom.q.oninput=()=>{st.q=dom.q.value;renderBoard();};
 dom.cat.onchange=()=>{st.cat=dom.cat.value;syncHash();renderBoard();};
 dom.ch.onchange=()=>{st.chain=dom.ch.value;syncHash();renderBoard();};
 dom.tvl.onchange=()=>{st.minTvl=+dom.tvl.value||0;renderBoard();};
 dom.w.onchange=()=>{st.watch=dom.w.checked;syncHash();renderBoard();};
 dom.rst.onclick=()=>{st.q=st.cat=st.chain='';st.watch=false;st.minTvl=0;syncCtrl();syncHash();renderBoard();};
 for(const b of[dom.t0,dom.t1])b.onclick=()=>{if(st.tab===b.dataset.tab)return;st.tab=b.dataset.tab;st.cat=st.chain='';if(st.tab==='peers')st.watch=false;syncCtrl();syncHash();renderBoard();};
 dom.scw.onmousemove=ev=>{
  const t=ev.target.closest('.pt');if(!t){dom.tip.hidden=true;return;}
  const r=t.dataset.slug?bySlug.get(t.dataset.slug):peerMap.get(t.dataset.peer);if(!r)return;
  dom.tip.innerHTML=t.dataset.slug?`<strong>#${r.rank} ${esc(r.name)}</strong> (${esc(r.cat)})<br>TVL ${usd(r.tvl)} &middot; Implied ${usd(r.val)} (${usd(r.lo)}\u2013${usd(r.hi)})<br>Prior ${pri(r.pr)} &middot; Farm ${r.fs}/100`:`<strong>${esc(r.name)} (${esc(r.sym)})</strong> &middot; ${esc(r.cat)}<br>TVL ${usd(r.tvl)} &middot; MCap ${usd(r.mcap)} &middot; ${mx(r.raw,1)}`;
  const rc=dom.scw.parentElement.getBoundingClientRect();let lf=ev.clientX-rc.left+12,tp=Math.max(4,ev.clientY-rc.top-8);
  dom.tip.hidden=false;const tw=dom.tip.offsetWidth||220;if(lf+tw>rc.width-8)lf=Math.max(8,ev.clientX-rc.left-tw-12);
  dom.tip.style.left=`${lf}px`;dom.tip.style.top=`${tp}px`;
 };
 dom.scw.onmouseleave=()=>{dom.tip.hidden=true;};
 dom.scw.onclick=ev=>{const t=ev.target.closest('.pt[data-slug]');if(t)location.hash=`#/protocol/${encodeURIComponent(t.dataset.slug)}`;};
 dom.tf.onclick=ev=>{
  const sb=ev.target.closest('.sbb');
  if(sb){const k=sb.dataset.sort;if(st.tab==='peers'){st.psd=st.psk===k?(st.psd==='asc'?'desc':'asc'):(k==='rank'?'asc':'desc');st.psk=k;}else{st.sd=st.sk===k?(st.sd==='asc'?'desc':'asc'):(k==='rank'?'asc':'desc');st.sk=k;}renderBoard();return;}
  const tr=ev.target.closest('tr[data-slug]');if(tr&&!ev.target.closest('a'))location.hash=`#/protocol/${encodeURIComponent(tr.dataset.slug)}`;
 };
 dom.tf.onkeydown=ev=>{const tr=ev.target.closest('tr[data-slug]');if((ev.key==='Enter'||ev.key===' ')&&tr&&!ev.target.closest('a')){ev.preventDefault();location.hash=`#/protocol/${encodeURIComponent(tr.dataset.slug)}`;}};
 mnt=true;
}

function syncCtrl(){
 if(!mnt)return;fillSelects();
 if(dom.q.value!==st.q)dom.q.value=st.q;dom.tvl.value=String(st.minTvl);
 dom.w.checked=st.watch;dom.ww.classList.toggle('act',st.watch);
 dom.ww.hidden=dom.wl.hidden=st.tab==='peers';
 dom.t0.classList.toggle('act',st.tab==='pre');dom.t1.classList.toggle('act',st.tab==='peers');
}

function filterSort(list,isP){
 const q=st.q.trim().toLowerCase(),k=isP?st.psk:st.sk,dir=(isP?st.psd:st.sd)==='asc'?1:-1;
 const fm={tvl:'tvl',implied:'val',prior:'pr',farm:'fs',mcap:'mcap',raw:'raw',norm:'norm'};
 return list.filter(r=>(!st.cat||r.cat===st.cat)&&(!st.chain||r.chs.includes(st.chain))&&(!st.minTvl||r.tvl>=st.minTvl)&&(isP||!st.watch||r.w)&&(!q||`${r.name} ${r.sym||''} ${r.slug}`.toLowerCase().includes(q)))
  .sort((a,b)=>k==='rank'?(a.rank-b.rank)*dir:fm[k]?((a[fm[k]]||0)-(b[fm[k]]||0))*dir||a.rank-b.rank:k==='change'?(!N(a.d7)&&!N(b.d7)?a.rank-b.rank:!N(a.d7)?1:!N(b.d7)?-1:(a.d7-b.d7)*dir||a.rank-b.rank):a.rank-b.rank);
}

function renderBoard(){
 if(!mnt)return;
 const isP=st.tab==='peers',src=isP?peers:rows,flt=filterSort(src,isP);
 const hasF=!!(st.q.trim()||st.cat||st.chain||(!isP&&st.watch)||st.minTvl>0);
 dom.ww.classList.toggle('act',st.watch&&!isP);wl.classList.toggle('act',st.watch&&!isP);dom.rst.hidden=!hasF;
 dom.sct.innerHTML=isP?`Live Token Peers: TVL vs Market Cap <span class="scs">${peers.length} tokenised benchmarks &middot; log-log</span>`:`TVL vs Implied Value <span class="scs">${rows.length} pre-token protocols &middot; log-log &middot; click any point</span>`;
 dom.scl.innerHTML=isP?`<span class="li"><span class="lp"></span>Live Peer</span><span class="li"><span class="ll"></span>Power-law (&beta;=${B.toFixed(2)})</span>`:`<span class="li"><span class="ld"></span>Pre-Token</span><span class="li">${WD}Watchlist</span><span class="li"><span class="lt"></span>Top 5</span><span class="li"><span class="ll"></span><span>TVL<sup>${B.toFixed(2)}</sup> med</span></span>`;
 dom.scw.innerHTML=scatterSvg(new Set(flt.map(r=>r.slug)),hasF);dom.tip.hidden=true;
 const pts=[`Showing <strong>${flt.length}</strong> of ${src.length} ${isP?'live peers':'pre-token'}`];
 if(st.cat)pts.push(`Cat: ${esc(st.cat)}`);if(st.chain)pts.push(`Chain: ${esc(st.chain)}`);if(st.minTvl>0)pts.push(`TVL ${usd(st.minTvl)}+`);if(!isP&&st.watch)pts.push('Watchlist');
 dom.ms.innerHTML=pts.join(' &middot; ');
 const sk=isP?st.psk:st.sk,sd=isP?st.psd:st.sd;
 const th=(l,k,n)=>`<th class="m u${n?' cn':''}">${k?`<button type="button" class="sbb${sk===k?' srt':''}" data-sort="${k}">${l} <span class="sa">${sk===k?(sd==='asc'?'\u25b2':'\u25bc'):'\u21c5'}</span></button>`:h('span','ths',l)}</th>`;
 const td=(v,c='')=>h('td',`tdn num${c}`,v),cc=c=>!N(c)?' flt':c>0?' pos':c<0?' neg':' flt';
 const chm=ch=>`${esc(ch[0]||'Multi')}${ch.length>1?h('span','px',`+${ch.length-1}`):''}`;
 const cols=Array.from({length:9},(_,i)=>`<col class="${isP?'p':'c'}${i}">`).join('');
 const head=(isP?[['#','rank'],['Tokenised Protocol'],['Ticker'],['Category'],['TVL','tvl',1],['7d Chg','change',1],['Market Cap','mcap',1],['MCap/TVL','raw',1],['MCap/T_eff','norm',1]]
  :[['Rank','rank'],['Protocol'],['Category'],['TVL','tvl',1],['7d Chg','change',1],['Implied (Range)','implied',1],['Per $1 TVL',0,1],['Launch %','prior',1],['Farm Score','farm',1]]).map(a=>th(...a)).join('');
 const body=!flt.length?'<tr><td colspan="9"><div class="emp"><p>No matching protocols.</p></div></td></tr>':isP
  ?flt.map(p=>`<tr>${h('td','rk num',`#${p.rank}`)}${h('td','',h('div','col pc',h('div','row pnr',h('span','plk-n ell',esc(p.name)))+h('div','pch m ell',chm(p.chs))))}${h('td','',h('span','syb m',esc(p.sym)))}${h('td','',h('span','ctag ell',esc(p.cat)))}${td(usd(p.tvl))}${td(pct(p.d7),cc(p.d7))}${td(usd(p.mcap),' mcc')}${td(mx(p.raw,1),' sub')}${td(mx(p.norm,1),' sub')}</tr>`).join('')
  :flt.map(r=>{const rng=`${usd(r.lo)}\u2013${usd(r.hi)}`,sc=Math.max(0,Math.min(100,Math.round(r.fs||0)));return `<tr class="${r.w?'iw':''}" data-slug="${esc(r.slug)}" tabindex="0">${h('td','rk num',`#${r.rank}`)}${h('td','',h('div','col pc',h('div','row pnr',`<a class="plk-n ell" href="#/protocol/${encodeURIComponent(r.slug)}">${esc(r.name)}</a>${r.w?h('span','wb m u',`${WD}Watch`):''}`)+h('div','pch m ell',chm(r.chs))))}${h('td','',`<span class="ctag ell" title="${esc(r.cat)}">${esc(r.cat)}</span>`)}${td(usd(r.tvl))}${td(pct(r.d7),cc(r.d7))}${td(h('span','vm',usd(r.val))+h('span','vr',esc(rng)),' imp')}${td(rat(r.val,r.tvl),' sub')}${td(pri(r.pr),' sub')}${td(h('div','fc',`<span class="fb"><span class="ff" style="width:${sc}%"></span></span>${h('span','fnm',sc)}`))}</tr>`;}).join('');
 dom.tf.innerHTML=`<table class="tbl"><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function catPeersHtml(cat){
 const all=pByCat.get(cat)||[],list=all.slice(0,5);
 if(!list.length)return h('div','pbox',h('div','sb phd',h('h4','ptit m u','Category Live Peers (0)')+`<a class="plk m" href="#/?tab=peers">All ${peers.length} peers &rarr;</a>`)+h('p','pnote',`No direct peers in ${esc(cat)}; shrunk 100% to ${peers.length}-peer global med (${mx(MS.global_median_multiple,1)}).`));
 const tr=list.map(p=>`<tr><td><strong>${esc(p.name)}</strong> ${h('span','syb m',esc(p.sym))}</td>${h('td','num',usd(p.tvl))}${h('td','num cyn',usd(p.mcap))}${h('td','num',mx(p.raw,1))}</tr>`).join('');
 const nt=all.length<5?h('p','pnote',`${all.length} direct ${all.length===1?'peer':'peers'} in ${esc(cat)} &middot; pre-Winsorized p90 (${mx(MS.multiple_cap_p90,1)}) &amp; log-shrunk (k=${MS.shrinkage_weight||8}) toward ${peers.length}-peer med (${mx(MS.global_median_multiple,1)}).`):'';
 return h('div','pbox',h('div','sb phd',h('h4','ptit m u',`Live Token Peers in ${esc(cat)} (${all.length})`)+`<a class="plk m" href="#/?tab=peers&amp;cat=${encodeURIComponent(cat)}">View all ${all.length} &rarr;</a>`)+`<table class="ptbl"><thead><tr><th class="m u">Protocol</th><th class="m u num">TVL</th><th class="m u num">Actual MCap</th><th class="m u num">Actual Mult</th></tr></thead><tbody>${tr}</tbody></table>${nt}`);
}

function renderDetail(slug){
 mnt=false;wl.classList.remove('act');
 const r=bySlug.get(slug);
 if(!r){app.innerHTML=h('section','hero','<a class="bk m" href="#/">&larr; Board</a>')+h('section','nc',`<h2>Not found</h2><p>Unknown slug <code>${esc(slug)}</code>.</p>`);return;}
 const i=r.rank-1,prev=i>0?rows[i-1]:null,next=i<rows.length-1?rows[i+1]:null;
 const age=days(r.at,D.as_of),cc=!N(r.d7)?'flt':r.d7>0?'pos':r.d7<0?'neg':'flt',base=r.te*r.m;
 const cs=cats[r.cat],sc=Math.max(0,Math.min(100,Math.round(r.fs||0))),pl=planOf(r);
 const lo=Math.max(1,r.lo),hi=Math.max(lo*1.01,r.hi),mid=Math.max(lo,Math.min(hi,r.val));
 const sp=Math.log10(hi)-Math.log10(lo),rp=Math.max(3,Math.min(97,sp>0?((Math.log10(mid)-Math.log10(lo))/sp)*100:50));
 const bar=m=>{const d=N(m)?m-1:0,w=Math.min(50,Math.max(2.5,(Math.abs(d)/.1)*50)),c=d>5e-4?'bfp':d<-5e-4?'bfn':'bff',s=d>5e-4?`left:50%;width:${w.toFixed(1)}%`:d<-5e-4?`left:${(50-w).toFixed(1)}%;width:${w.toFixed(1)}%`:'left:49%;width:2%';return `<div class="btk"><span class="bz"></span><span class="bf ${c}" style="${s}"></span></div>`;};
 const mRows=[['Momentum',N(r.d7)?`7d TVL ${pct(r.d7)} (\u00d70.15)`:'7d TVL N/A',r.mom],['Maturity',age!==null?`${age.toLocaleString('en-US')}d since ${r.at}`:'Unlisted',r.mat],['Chain Breadth',`${r.chs.length} ${r.chs.length===1?'chain':'chains'} (${r.chs.length>=3?'3+ uplift':r.chs.length===2?'neutral':'1-chain'})`,r.brd]]
  .map(([n,d,m])=>h('div','bdr',h('div','',h('div','bdn',esc(n))+h('div','bdd m',esc(d)))+bar(m)+h('div','bdv num',`${m.toFixed(3)}\u00d7${h('span',`bdx ${m>1.0005?'pos':m<.9995?'neg':'flt'}`,dlt(m))}`))).join('');
 const tot=String(r.steps.length).padStart(2,'0');
 const steps=r.steps.map((s,k)=>{const n=String(k+1).padStart(2,'0');return h('li','tli',h('div','tln m',n)+h('div','tlc',h('div','tll m u',`Step ${n} of ${tot}`)+h('p','tlt',esc(s))));}).join('');
 const stat=(l,m,s,c='',mc='')=>h('div',`col sbk bx${c}`,h('span','sl m u',l)+h('span',`sm num${mc}`,m)+h('span','ss m',s));
 const sig=(l,s,body,d)=>h('div','col sig bx',h('div','sb',h('span','sl m u',l)+h('span','ss m',s))+body+h('p','sd',d));
 const pg=(t,nx)=>{const dir=nx?'Next by rank &rarr;':'&larr; Previous by rank',c=`col pga bx${nx?' pgn':''}`;return !t?h('div',`${c} pgd`,h('span','pgdr m u',dir)+h('span','pgnm',nx?'End of board':'Top of board')):`<a class="${c}" href="#/protocol/${encodeURIComponent(t.slug)}">${h('span','pgdr m u',dir)}${h('span','pgnm',`#${t.rank} &middot; ${esc(t.name)}`)}${h('span','pgm m',`${usd(t.val)} &middot; ${esc(t.cat)}`)}</a>`;};
 const chs=r.chs.slice(0,10).map((c,k)=>h('span',`chp m${k===0?' chp1':''}`,esc(c))).join('')+(r.chs.length>10?h('span','chp m',`+${r.chs.length-10}`):'');

 app.innerHTML=
  h('section','hero',h('div','sb htop',h('div','row htr',`<a class="bk m" href="#/">&larr; Board</a>${h('h2','dt',esc(r.name))}${r.w?h('span','wb m u',`${WD}Watchlist`):''}${h('span','dsl m',esc(r.slug))}`)+h('span','rkp m',`RANK <strong>#${r.rank}</strong> / ${rows.length}`))+h('div','row htax',`<a class="clnk m" href="#/?cat=${encodeURIComponent(r.cat)}">${esc(r.cat)}</a>${chs}`))+
  h('section','sg',stat('Total Value Locked',usd(r.tvl),`Effective TVL (TVL^${B.toFixed(2)}): ${usd(r.te)}`)+stat('7-Day TVL Change',pct(r.d7),`Snapshot ${esc(D.as_of)}`,'',` ${cc}`)+stat('Listed Date &amp; Age',esc(r.at||'Unlisted'),age!==null?`${age.toLocaleString('en-US')} days tracked`:'Default factor')+stat('Implied Value',usd(r.val),`Range ${usd(lo)}&ndash;${usd(hi)} &middot; ${rat(r.val,r.tvl)}/$1 TVL`,' sbk-hl',' grn'))+
  h('section','sigg',sig('Implied Range (Log Scale)',`${(hi/lo).toFixed(1)}&times; band &middot; ${cs?cs.peers:0} live ${cs&&cs.peers===1?'peer':'peers'}`,h('div','col rbox',`<div class="rtk"><span class="rfl" style="width:${rp.toFixed(1)}%"></span><span class="rmid" style="left:50%"></span><span class="rmk" style="left:${rp.toFixed(1)}%"></span></div>${h('div','sb re m',`<span>LOW (p25) <strong>${usd(lo)}</strong></span><span class="rhl">HEADLINE ${usd(mid)}</span><span>HIGH (p75) <strong>${usd(hi)}</strong></span>`)}`),`Log-shrunk (k=${MS.shrinkage_weight||8}) category p25&ndash;p75 multiples on T<sub>eff</sub>.`)+sig('Launch Prior',esc(r.cat),h('div','row svr',`${h('span','sv num',pri(r.pr))}<span class="sbt"><span class="sbf" style="width:${Math.max(0,Math.min(100,r.pr||0)).toFixed(1)}%"></span></span>`),`Share of &ge;$5M TVL peers in ${esc(r.cat)} with a live token.`)+sig('Farm Score','1&ndash;100 board scale',h('div','row svr',`<span class="sv num grn">${sc}<span class="ss"> / 100</span></span><span class="sbt"><span class="sbf" style="width:${sc}%"></span></span>`),'Log-scaled upside per farming dollar (implied &times; prior &divide; tier cap).'))+
  h('div','dcols',`<section class="pnl bx" id="why-panel">${h('div','sb ph',h('h3','ptl m u','Why this value')+h('p','psb','Effective TVL (TVL<sup>&beta;</sup>) &times; Multiple &times; Factors'))}${h('div','col bdl',h('div','bdr bd1 bdb',h('div','',h('div','bdn','Effective TVL (TVL<sup>&beta;</sup>) &times; Multiple')+h('div','bdd m',`${usd(r.te)} T<sub>eff</sub> (${usd(r.tvl)} TVL, &beta;=${B.toFixed(3)}, pivot ${usd(PV)}) &times; ${mx(r.m)}`))+h('div','bdv num',usd(base)))+mRows+`<div class="bdr bd1 bdt" id="why-total">${h('div','',h('div','bdn','Implied Launch Value')+h('div','bdd m',`${rat(r.val,r.tvl)}/$1 TVL &middot; ${usdX(r.val)}`))}${h('div','bdv num',usd(r.val))}</div>`)}${h('p','bfnt m','Bars compare recentered factors vs 1.000&times; (&minus;10% to +10% scale).')}${catPeersHtml(r.cat)}</section><section class="pnl bx" id="farm-panel">${h('div','sb ph',h('h3','ptl m u','Farm plan')+h('p','psb',`Tailored 5-step plan for ${esc(r.name)}`))}${h('div','sb ps m',`<span>CAPITAL <strong>${esc(pl.cap)}</strong></span><span>TIME <strong>${esc(pl.time)}</strong></span><span>CHAIN <strong>${esc(r.chs[0]||'Ethereum')}</strong></span>`)}<ol class="tl" id="farm-timeline">${steps}</ol></section>`)+
  h('nav','pgr',pg(prev,0)+pg(next,1));
 scrollTo(0,0);
}

function route(){
 const r=parseHash();st.view=r.view;
 if(r.view==='detail'){st.slug=r.slug;renderDetail(r.slug);return;}
 st.slug=null;st.tab=r.tab;st.cat=r.cat;st.chain=r.chain;st.watch=r.watch;st.q='';st.minTvl=0;
 if(!mnt)mountBoard();syncCtrl();renderBoard();
}
addEventListener('hashchange',route);
route();
})();
