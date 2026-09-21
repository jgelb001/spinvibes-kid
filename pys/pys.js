/* ============================================================================================
   Pick Your Shot — the renderer. One module, all 18 holes, no per-hole code.

   Everything it draws comes from pys/bank.json (built by build_play_bank.py from the reviewed
   markdown). It re-derives NOTHING: ball counts are the authored counts, card copy is the
   authored copy, the winner is the authored winner. Positions come from a seeded hash — there
   is no unseeded randomness in this file, and a grep for "Math" + ".random" is an acceptance test.

   Specs: MINIGAMES-MECHANICS-SPEC.md §1.2 (ten-ball, deterministic), §1.5 (economy),
          MINIGAMES-VISUAL-SPEC.md §§2-8 (anatomy, flight, why card, wren, a11y).
   ============================================================================================ */
(function (root) {
'use strict';

/* ---- deterministic helpers (FNV-1a; same hash the prototype and renderer.js use) ---- */
function hash32(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
var u = function(s){ return (hash32(s)%100000)/100000; };          // 0..1
var j = function(s,amp){ return (u(s)-0.5)*2*amp; };               // -amp..amp

var SVGNS='http://www.w3.org/2000/svg';
function el(t,a){var e=document.createElementNS(SVGNS,t);for(var k in a)e.setAttribute(k,a[k]);return e}
var CREAM='#F5F1E6', INK='#13291C', BRASS='#A98D5F', OX='#B0492F', SLATE='#3E5C76';

/* ---- geometry: everything is a function of the detected centreline ---- */
function Geom(g){
  this.g=g; this.cl=g.cl; this.arc=g.arc; this.total=g.arcLength||1;
  this.W=g.size[0]; this.H=g.size[1];
  this.greenT = (g.green && g.green.t) || 0.95;
  this.greenR = Math.max(34, Math.min(120, (g.green && g.green.r) || 60));
  this.ftPx = this.greenR/27;          // a green is ~18 yd ≈ 54 ft across, so r px ≈ 27 ft
  // landing grids baked from the art's own pixels by build_landing.py (one bit per 8px cell). They
  // are BAKED, never sampled from the decoded image at runtime, so every device gets the same answer.
  this.px = null;
  if(g.px){
    var n=g.px.cols*g.px.rows;
    this.px={cell:g.px.cell, cols:g.px.cols, rows:g.px.rows,
             course:unbits(g.px.course,n), water:unbits(g.px.water,n), sand:unbits(g.px.sand,n)};
  }
}
function unbits(b64,n){
  var s=atob(b64), a=new Uint8Array(n);
  for(var i=0;i<n;i++) a[i]=(s.charCodeAt(i>>3)>>(7-(i&7)))&1;
  return a;
}
Geom.prototype.cellIdx = function(x,y){
  var P=this.px, c=Math.floor(x/P.cell), r=Math.floor(y/P.cell);
  return (c<0||r<0||c>=P.cols||r>=P.rows) ? -1 : r*P.cols+c;
};
/* nearest set cell of `kind` to (x,y), optionally only inside box {x0,y0,x1,y1}; returns its centre */
Geom.prototype.nearestCell = function(kind,x,y,box){
  var P=this.px, grid=P[kind], best=-1, bd=1e18, C=P.cell;
  for(var r=0;r<P.rows;r++) for(var c=0;c<P.cols;c++){
    var i=r*P.cols+c; if(!grid[i]) continue;
    var cx=c*C+C/2, cy=r*C+C/2;
    if(box && (cx<box.x0||cx>box.x1||cy<box.y0||cy>box.y1)) continue;
    var d=(cx-x)*(cx-x)+(cy-y)*(cy-y);
    if(d<bd){bd=d;best=i;}
  }
  return best<0 ? null : {x:(best%P.cols)*C+C/2, y:Math.floor(best/P.cols)*C+C/2};
};
/* up to `n` set cells of `kind` inside box, nearest-first to (x,y) */
Geom.prototype.cellsNear = function(kind,x,y,box,n){
  var P=this.px, grid=P[kind], out=[], C=P.cell;
  for(var r=0;r<P.rows;r++) for(var c=0;c<P.cols;c++){
    if(!grid[r*P.cols+c]) continue;
    var cx=c*C+C/2, cy=r*C+C/2;
    if(cx<box.x0||cx>box.x1||cy<box.y0||cy>box.y1) continue;
    out.push({x:cx,y:cy,d:(cx-x)*(cx-x)+(cy-y)*(cy-y)});
  }
  out.sort(function(a,b){return a.d-b.d||a.y-b.y||a.x-b.x});   // total order: no engine-dependent ties
  return out.slice(0,n);
};
/* A ball is never drawn on bare parchment. If a point is not on the course (and not on a hazard
   cell), move it to the nearest cell that is. Deterministic: same point in, same point out. */
Geom.prototype.settle = function(p,k){
  if(!this.px) return p;
  var i=this.cellIdx(p.x,p.y);
  if(i>=0 && (this.px.course[i]||this.px.water[i]||this.px.sand[i])) return p;
  var c=this.nearestCell('course',p.x,p.y); if(!c) return p;
  var h=this.px.cell*0.4;
  return {x:c.x+j(k+':sx',h), y:c.y+j(k+':sy',h)};
};
/* point at arc fraction t (0 = tee, 1 = green end) offset lat px to the RIGHT of play */
Geom.prototype.at = function(t, lat){
  lat = lat||0;
  var want = Math.max(0,Math.min(1,t))*this.total, i=0;
  while(i < this.arc.length-1 && this.arc[i+1] < want) i++;
  var a=this.cl[i], b=this.cl[Math.min(i+1,this.cl.length-1)];
  var span=(this.arc[Math.min(i+1,this.arc.length-1)]-this.arc[i])||1;
  var f=Math.max(0,Math.min(1,(want-this.arc[i])/span));
  var x=a[0]+(b[0]-a[0])*f, y=a[1]+(b[1]-a[1])*f;
  var dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1;
  return {x:x + (dy/L)*lat*-1, y:y + (dx/L)*lat, i:i};
};
/* corridor half-width at t, clamped — some maps fuse corridor and rough, so cap the spread */
Geom.prototype.hw = function(t){
  var idx=Math.round(Math.max(0,Math.min(1,t))*(this.g.hw.length-1));
  return Math.max(22, Math.min(78, this.g.hw[idx]||40));
};
Geom.prototype.blob = function(kind, side, near){
  var list=this.g[kind]; if(!list || !list.length) return null;
  var pool = side ? list.filter(function(b){return b.side===side}) : list;
  if(!pool.length) pool = list;
  if(!near) return pool[0];
  return pool.reduce(function(best,b){
    return (Math.hypot(b.cx-near.x,b.cy-near.y) < Math.hypot(best.cx-near.x,best.cy-near.y)) ? b : best;
  });
};

/* base arc fraction a decision plays to — par and decision index, not a per-hole constant */
function baseT(hole, dn){
  var par=hole.par;
  if(par===3) return dn===1 ? 0.97 : (dn===2 ? 0.90 : 1.0);
  if(par===5) return dn===1 ? 0.42 : (dn===2 ? 0.78 : 1.0);
  return dn===1 ? 0.56 : 1.0;                       // par 4
}

/* ---- zone -> point. The one place a zone token becomes a pixel. ---- */
function zonePoint(G, hole, dn, putting, z, key, i, from){
  var p = clampFrame(G, zonePointRaw(G, hole, dn, putting, z, key, i, from));
  // The putting view is a zoomed green, not the map — nothing to settle there.
  return putting ? p : G.settle(p, hole.id+':D'+dn+':'+key+':b'+i);
}
/* A hazard ball lands on a REAL hazard pixel, not at the centre of its bounding box. A stream is a
   wavy diagonal strip inside a huge axis-aligned box (C2-H7's is 12% water); the box centre is dry
   grass. Take the hazard cells inside the blob's box nearest the decision's own point on the
   corridor, then pick one by the seeded hash so the ten balls spread along the hazard. */
function hazardPoint(G, kind, blob, anchor, k){
  if(!G.px || !blob) return null;
  var pad=12, box={x0:blob.cx-blob.w/2-pad, x1:blob.cx+blob.w/2+pad, y0:blob.cy-blob.h/2-pad, y1:blob.cy+blob.h/2+pad};
  var cells=G.cellsNear(kind, anchor.x, anchor.y, box, 48);
  if(!cells.length) return null;
  var c=cells[Math.floor(u(k+':pool')*cells.length)%cells.length], h=G.px.cell*0.4;
  return {x:c.x+j(k+':px',h), y:c.y+j(k+':py',h)};
}
/* A ball is never drawn outside the picture. Wide-corridor holes (C2-H2's measured half-width is
   101px because its corridor and rough fuse) pushed tree and rough balls past the frame edge —
   caught by the Playwright pass, 2026-09-20. Clamping here rather than per zone means no future
   zone can reintroduce it. */
function clampFrame(G, p){
  var m = 26;
  return {x: Math.max(m, Math.min(G.W-m, p.x)), y: Math.max(m, Math.min(G.H-m, p.y))};
}
function zonePointRaw(G, hole, dn, putting, z, key, i, from){
  var k = hole.id+':D'+dn+':'+key+':b'+i;
  var t = baseT(hole, dn), side = z.side;
  var P = G.g.pin, ft = G.ftPx;
  function near(){ return G.at(t); }
  function jit(p,a){ return {x:p.x+j(k+':x',a), y:p.y+j(k+':y',a)}; }
  function fromCup(distFt, angRad, spread){
    var d=distFt*ft + j(k+':d',(spread||0.25)*distFt*ft);
    var a=angRad + j(k+':a',0.5);
    return {x:P[0]+Math.cos(a)*d, y:P[1]+Math.sin(a)*d};
  }
  if(putting){
    // the putt runs up the hole, so "past" is toward the green end (screen-up) and the low/high
    // sides are perpendicular to it. Distances are the authored feet, scaled by the measured green.
    switch(z.zone){
      case 'holed':         return {x:P[0],y:P[1]};
      case 'in3':           return fromCup(2.2, u(k+':a')*6.283, 0.35);
      case 'in10':          return fromCup(7,   u(k+':a')*6.283, 0.3);
      case 'outside10':     return fromCup(15,  u(k+':a')*6.283, 0.3);
      case 'outside20':     return fromCup(24,  u(k+':a')*6.283, 0.2);
      case 'shortOfCircle': return fromCup(7,   Math.PI/2 + j(k+':s',0.6), 0.3);   // short = toward tee
      case 'past':          return fromCup(9,  -Math.PI/2 + j(k+':s',0.6), 0.3);
      case 'lowSide':       return fromCup(6,   0 + j(k+':s',0.5), 0.35);          // low = RIGHT of the line
      case 'highSide':      return fromCup(6,   Math.PI + j(k+':s',0.5), 0.35);
      case 'inFringe':      return fromCup(20,  Math.PI/2 + j(k+':s',0.8), 0.25);
    }
  }
  switch(z.zone){
    case 'water': { var b=G.blob('water', side, near());
      var hw_=hazardPoint(G,'water',b,near(),k); if(hw_) return hw_;
      return b ? jit({x:b.cx,y:b.cy}, Math.max(12,Math.min(b.w,b.h)*0.3)) : jit(G.at(t,-60),26); }
    case 'sand':  { var s=G.blob('sand', side, near());
      var hs_=hazardPoint(G,'sand',s,near(),k); if(hs_) return hs_;
      return s ? jit({x:s.cx,y:s.cy}, Math.max(10,Math.min(s.w,s.h)*0.28)) : jit(G.at(t, side==='LEFT'?-70:70),22); }
    case 'trees': { var lat=(side==='LEFT'?-1:1)*(G.hw(t)+110);
      var p=G.at(t,lat); return {x:Math.max(30,Math.min(G.W-30,p.x+j(k+':x',34))), y:p.y+j(k+':y',44)}; }
    case 'rough': { var lr=(side==='LEFT'?-1:(side==='RIGHT'?1:(u(k+':lr')<0.5?-1:1)))*(G.hw(t)+34);
      return jit(G.at(t,lr),18); }
    case 'green':  return jit({x:P[0],y:P[1]}, G.greenR*0.62);
    case 'collar': { var c=G.at(G.greenT-0.035, side==='LEFT'?-G.greenR*0.7:(side==='RIGHT'?G.greenR*0.7:0));
      return jit(c, G.greenR*0.30); }
    case 'short':  return jit(G.at(Math.max(0,G.greenT-0.085)), G.greenR*0.34);
    case 'long':   { var a=G.at(1.0), b2=G.at(0.93);
      var dx=a.x-b2.x, dy=a.y-b2.y, L=Math.hypot(dx,dy)||1;
      return jit({x:a.x+dx/L*G.greenR*0.95, y:a.y+dy/L*G.greenR*0.95}, G.greenR*0.34); }
    case 'fairway':
    default:       return jit(G.at(t + j(k+':t',0.025), j(k+':l',G.hw(t)*0.55)), 14);
  }
}

/* ten balls for an option: counts VERBATIM from the bank, positions seeded */
function tenBall(G, hole, dec, opt, from){
  var out=[], i=0;
  opt.zones.forEach(function(z){
    for(var c=0;c<z.n;c++){ out.push({zone:z.zone, side:z.side, holed:z.holed && c===0,
      p: zonePoint(G, hole, dec.n, dec.putting, z, opt.key, i, from)}); i++; }
  });
  if(out.length!==10) throw new Error(hole.id+' D'+dec.n+' '+opt.key+': '+out.length+' balls, not 10');
  return out;
}
var TROUBLE = {water:1, sand:1, trees:1, long:1, lowSide:1, highSide:1, outside20:1};

/* ============================ the game ============================ */
function Game(opts){
  this.bank=opts.bank; this.base=opts.assetBase||'';
  this.onHoleDone=opts.onHoleDone||function(){}; this.onNineDone=opts.onNineDone||function(){};
  this.onExit=opts.onExit||function(){};
  this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.root=opts.root; this.byId={}; this.tok=0;
  var self=this; this.bank.holes.forEach(function(h){ self.byId[h.id]=h; });
}

Game.prototype.playNine = function(courseId){
  this.order=(this.bank.playOrder[courseId]||[]).slice();
  this.courseId=courseId; this.idx=0; this.seen={}; this.played=0;
  this.playHole(this.order[0]);
};
/* Resolve when the image has loaded, reject on error or timeout. The map is fetched lazily (never in
   the SW install precache), so on a phone it CAN fail — a dropped signal between holes. Drawing the
   screen anyway shows the browser's broken-image icon blown up to fill the map, with live options
   and a ball flying over nothing. Wait for the picture first. */
function loadImage(url, ms){
  return new Promise(function(res,rej){
    var im=new Image(), t=setTimeout(function(){ im.onload=im.onerror=null; rej(new Error('timeout')); }, ms||20000);
    im.onload=function(){ clearTimeout(t); res(im); };
    im.onerror=function(){ clearTimeout(t); rej(new Error('load')); };
    im.src=url;
  });
}

Game.prototype.playHole = function(hid){
  var h=this.byId[hid]; if(!h) return;
  var self=this, tok=++this.tok;                     // a newer playHole() or destroy() voids this one
  // Only say "getting ready" if the map is not already in hand — a prefetched map resolves at once
  // and a one-frame flash of loading text would look like a glitch.
  var slow=setTimeout(function(){
    if(tok===self.tok) self.root.innerHTML='<div class="pys-load">Getting the hole ready…</div>';
  }, 200);
  loadImage(this.base+h.map).then(function(){
    clearTimeout(slow); if(tok!==self.tok) return;
    self.startHole(h);
  }, function(){
    clearTimeout(slow); if(tok!==self.tok) return;
    self.showLoadFailed(hid);
  });
};
Game.prototype.startHole = function(h){
  this.hole=h; this.G=new Geom(h.geom); this.di=0; this.state='idle';
  this.ballPos=this.G.at(0);
  this.renderShell(); this.renderDecision();
  this.prefetchNext();
};
/* Warm the NEXT hole's map while the kid is busy deciding, so it is cached by the time they get
   there. Silent by design: a failed prefetch is not the kid's problem — playHole() handles it when
   the hole actually starts. */
Game.prototype.prefetchNext = function(){
  var next=this.byId[this.order && this.order[this.idx+1]], base=this.base;
  if(next) setTimeout(function(){ loadImage(base+next.map, 30000).then(function(){}, function(){}); }, 1500);
};
Game.prototype.showLoadFailed = function(hid){
  var self=this;
  this.root.innerHTML='<div class="pys"><div class="pys-retry"><p>We couldn’t load this hole. '
    +'Check your connection and try again — the back arrow takes you home.</p>'
    +'<button class="pys-pill">Try again</button></div></div>';
  this.root.querySelector('.pys-pill').addEventListener('click',function(){ self.playHole(hid); });
};
/* Called when the kid leaves. Voids any load still in flight so it cannot draw over whatever the
   kid is looking at next. */
Game.prototype.destroy = function(){ this.tok++; this.dead=true; };

Game.prototype.renderShell = function(){
  var h=this.hole, g=h.geom;
  this.root.innerHTML =
  '<div class="pys">'
  + '<div class="pys-top"><div class="pys-eyebrow"></div><div class="pys-slot"></div></div>'
  + '<div class="pys-tile"><svg class="pys-map" viewBox="0 0 '+g.size[0]+' '+g.size[1]+'">'
  +   '<image href="'+this.base+h.map+'" x="0" y="0" width="'+g.size[0]+'" height="'+g.size[1]+'"/>'
  +   '<g class="pys-ghosts"></g><g class="pys-traces"></g><g class="pys-fan"></g>'
  +   '<g class="pys-events"></g><g class="pys-ball"></g><g class="pys-terms"></g>'
  + '</svg></div>'
  + '<div class="pys-wren"><div class="pys-head"><img alt="" src="'+this.base+'wren-headshot.png"></div>'
  +   '<div class="pys-speech"></div></div>'
  + '<div class="pys-stack"></div></div>';
  var q=this.root.querySelector.bind(this.root);
  this.$={top:q('.pys-eyebrow'),slot:q('.pys-slot'),map:q('.pys-map'),ghosts:q('.pys-ghosts'),
          traces:q('.pys-traces'),fan:q('.pys-fan'),events:q('.pys-events'),ball:q('.pys-ball'),
          terms:q('.pys-terms'),head:q('.pys-head'),speech:q('.pys-speech'),stack:q('.pys-stack')};
  this.$.top.textContent='Hole '+(this.idx+1)+' · Par '+h.par+' · '+h.yards+' yds';
  this.fullView='0 0 '+g.size[0]+' '+g.size[1];
};

Game.prototype.setView=function(vb){
  var m=this.$.map;
  if(this.reduced){ m.setAttribute('viewBox',vb); return; }
  var from=m.getAttribute('viewBox').split(' ').map(Number), to=vb.split(' ').map(Number), t0=performance.now();
  (function s(n){var t=Math.min(1,(n-t0)/650), e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
    m.setAttribute('viewBox',from.map(function(v,i){return v+(to[i]-v)*e}).join(' '));
    if(t<1)requestAnimationFrame(s)})(t0);
};

Game.prototype.drawBall=function(p,putt){
  this.$.ball.innerHTML='';
  this.$.ball.appendChild(el('circle',{cx:p.x,cy:p.y,r:putt?5:14,fill:CREAM,stroke:INK,'stroke-width':putt?1.6:5}));
};

Game.prototype.renderDecision=function(){
  var self=this, h=this.hole, d=h.decisions[this.di], G=this.G;
  this.state='idle';
  var P=h.geom.pin, R=G.greenR;
  if(d.putting){
    // zoom to the green so a 3-foot circle is legible on a phone
    var pad=R*2.6; this.setView((P[0]-pad)+' '+(P[1]-pad)+' '+(pad*2)+' '+(pad*2));
    this.$.events.innerHTML='';
    this.$.events.appendChild(el('circle',{cx:P[0],cy:P[1],r:Math.max(5,R*0.10),fill:INK}));
    this.ballPos={x:P[0]+R*0.62, y:P[1]+R*0.72};
  } else {
    this.setView(this.fullView); this.$.events.innerHTML='';
  }
  this.drawBall(this.ballPos, d.putting);
  this.$.slot.textContent = d.putting ? 'On the green' : 'Shot '+d.n;
  this.$.speech.textContent = d.setup || 'Where should we hit it?';
  this.$.terms.innerHTML=''; this.$.fan.innerHTML='';

  // one terminal per option at that option's MODAL landing point — the map is the choice UI
  // one terminal per option at its MODAL landing point. Two options often share a modal zone
  // (three layups all finishing "fairway"), which stacked their terminals on top of each other —
  // seen on C1-H9, 2026-09-20. Spread any pair that lands closer than a tap target.
  this.aim={};
  var pts = d.opts.map(function(o){
    var mz = o.zones.reduce(function(a,b){return b.n>a.n?b:a});
    return zonePoint(G,h,d.n,d.putting,{zone:o.modal,side:o.modalSide,n:mz.n},o.key,99,self.ballPos);
  });
  var minGap = d.putting ? R*0.55 : 86;
  for(var a=0;a<pts.length;a++) for(var b2=a+1;b2<pts.length;b2++){
    var dx=pts[b2].x-pts[a].x, dy=pts[b2].y-pts[a].y, dd=Math.hypot(dx,dy);
    if(dd < minGap){
      var ux = dd>1 ? dx/dd : 1, uy = dd>1 ? dy/dd : 0, push=(minGap-dd)/2+2;
      pts[a]={x:pts[a].x-ux*push, y:pts[a].y-uy*push};
      pts[b2]={x:pts[b2].x+ux*push, y:pts[b2].y+uy*push};
    }
  }
  pts = pts.map(function(p,i){ p=clampFrame(G,p); return d.putting ? p : G.settle(p, h.id+':D'+d.n+':aim'+i); });
  d.opts.forEach(function(o,i){
    var p = pts[i];
    self.aim[o.key]=p;
    var t=el('g',{class:'pys-term','data-key':o.key});
    t.appendChild(el('circle',{class:'pys-hit',cx:p.x,cy:p.y,r:d.putting?R*0.5:52,fill:'transparent'}));
    t.appendChild(el('circle',{cx:p.x,cy:p.y,r:d.putting?R*0.16:34,fill:BRASS}));
    var tx=el('text',{x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'central',
      fill:INK,'font-weight':'800','font-size':(d.putting?R*0.20:30)+'px'});
    tx.textContent=i+1; t.appendChild(tx);
    t.addEventListener('click',function(){self.choose(o.key)});
    self.$.terms.appendChild(t);
  });

  this.$.stack.className='pys-stack';
  this.$.stack.innerHTML='';
  d.opts.forEach(function(o,i){
    var c=document.createElement('div'); c.className='pys-card'; c.dataset.key=o.key;
    c.innerHTML='<div class="pys-chip">'+(i+1)+'</div><div><div class="pys-lbl"></div><div class="pys-sub"></div></div>';
    c.querySelector('.pys-lbl').textContent=o.label;
    c.querySelector('.pys-sub').textContent=o.sub;
    c.addEventListener('click',function(){self.choose(o.key)});
    self.$.stack.appendChild(c);
  });
};

Game.prototype.choose=function(key){
  if(this.state!=='idle') return;
  var self=this, h=this.hole, d=h.decisions[this.di], o=null;
  d.opts.forEach(function(x){if(x.key===key)o=x});
  if(!o) return;
  this.state='flying';
  this.$.stack.className='pys-stack pys-locked';
  [].forEach.call(this.$.stack.children,function(c){
    c.classList.toggle('pys-sel', c.dataset.key===key);
    c.classList.toggle('pys-dim', c.dataset.key!==key);
  });
  [].forEach.call(this.$.terms.children,function(t){ t.classList.toggle('pys-fade', t.dataset.key!==key) });

  var to=this.aim[key];
  this.fly(this.ballPos, to, d.putting, function(){
    var balls=tenBall(self.G,h,d,o,self.ballPos);
    self.revealFan(balls,d.putting);
    self.landingEvent(o.modal,to,d.putting);
    self.ballPos=to; self.drawBall(to,d.putting);
    setTimeout(function(){self.showWhy(d,o)}, self.reduced?0:520);
  });
};

/* §5 flight grammar: shadow stays on the path, ball lifts by sin(pi t) and scales 1->1.55->1,
   ink trace draws in behind it. This is the thing that makes it a game and not a quiz. */
Game.prototype.fly=function(from,to,isPutt,done){
  var scale=this.G.W/896;              // the spec's amplitudes are quoted for a 896-wide map
  var trace=el('path',{d:'M '+from.x+' '+from.y+' L '+to.x+' '+to.y,fill:'none',stroke:INK,
    'stroke-width':isPutt?3:7,'stroke-linecap':'round'});
  var len=Math.hypot(to.x-from.x,to.y-from.y);
  trace.setAttribute('stroke-dasharray',len); trace.setAttribute('stroke-dashoffset',len);
  this.$.traces.appendChild(trace);
  var shadow=el('ellipse',{cx:from.x,cy:from.y,rx:16,ry:8,fill:INK,opacity:.18});
  var ball=el('circle',{cx:from.x,cy:from.y,r:isPutt?5:14,fill:CREAM,stroke:INK,'stroke-width':isPutt?1.6:5});
  this.$.ball.innerHTML=''; this.$.ball.appendChild(shadow); this.$.ball.appendChild(ball);
  if(this.reduced){
    trace.setAttribute('stroke-dashoffset',0);
    ball.setAttribute('cx',to.x); ball.setAttribute('cy',to.y);
    shadow.setAttribute('cx',to.x); shadow.setAttribute('cy',to.y);
    return done();
  }
  var amp=isPutt?0:(len>500?85:42)*scale, dur=isPutt?900:1300, t0=performance.now();
  var ease=function(t){return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2};
  (function step(now){
    var t=Math.min(1,(now-t0)/dur), e=ease(t);
    var x=from.x+(to.x-from.x)*e, y=from.y+(to.y-from.y)*e;
    shadow.setAttribute('cx',x); shadow.setAttribute('cy',y);
    var lift=Math.sin(Math.PI*t)*amp, sc=1+0.55*Math.sin(Math.PI*t);
    ball.setAttribute('cx',x); ball.setAttribute('cy',y-lift); ball.setAttribute('r',(isPutt?5:14)*sc);
    trace.setAttribute('stroke-dashoffset',len*(1-e));
    if(t<1) requestAnimationFrame(step); else done();
  })(t0);
};

Game.prototype.revealFan=function(balls,isPutt){
  var self=this, R=this.G.greenR;
  this.$.fan.innerHTML='';
  balls.forEach(function(b,i){
    var wet=b.zone==='water', bad=TROUBLE[b.zone];
    var r=isPutt?Math.max(4,R*0.055):15;
    var c=el('circle',{cx:b.p.x,cy:b.p.y,r:r,fill:wet?SLATE:(bad?OX:CREAM),
      stroke:bad?OX:INK,'stroke-width':isPutt?1.5:4,opacity:0});
    self.$.fan.appendChild(c);
    setTimeout(function(){c.setAttribute('opacity',1)}, self.reduced?0:58*i);
  });
};

/* §5 landing events — four vocabularies, chosen by the modal zone. No fifth one is improvised. */
Game.prototype.landingEvent=function(zone,p,isPutt){
  var self=this, E=this.$.events, R=this.G.greenR;
  if(!isPutt) E.innerHTML='';
  function ring(r0,r1,col,delay){
    var r=el('circle',{cx:p.x,cy:p.y,r:r0,fill:'none',stroke:col,'stroke-width':4,opacity:.9});
    E.appendChild(r);
    if(self.reduced){ setTimeout(function(){r.remove()},0); return; }
    var t0=performance.now()+delay;
    (function s(n){var t=Math.min(1,Math.max(0,(n-t0)/450));
      r.setAttribute('r',r0+(r1-r0)*t); r.setAttribute('opacity',.9*(1-t));
      if(t<1)requestAnimationFrame(s); else r.remove()})(t0);
  }
  if(zone==='water'){
    var tr=this.$.traces.lastChild;
    if(tr){ var L=tr.getTotalLength();
      var dash=el('path',{d:tr.getAttribute('d'),fill:'none',stroke:OX,'stroke-width':7,'stroke-linecap':'round'});
      dash.setAttribute('stroke-dasharray','0 '+(L*0.75)+' 14 12 14 12 14 12 14 12 14 12 14 12');
      this.$.traces.appendChild(dash); }
    var b=this.$.ball.querySelector('circle:last-child');
    if(b){ b.setAttribute('r',8); b.setAttribute('opacity',.5); }
    [0,120,240].forEach(function(dl){ring(10,70,SLATE,dl)});
  } else if(zone==='trees'||zone==='sand'){
    ring(10,46,OX,0);
  } else {
    ring(isPutt?R*0.10:20, isPutt?R*0.42:65, BRASS, 0);
    this.$.head.classList.remove('pys-hop'); void this.$.head.offsetWidth; this.$.head.classList.add('pys-hop');
  }
};

/* §6 why card — per-option copy, semantic kicker, then the ghost reveal (always, every outcome) */
Game.prototype.showWhy=function(d,o){
  var self=this, h=this.hole;
  this.state='why';
  this.$.speech.textContent = d.wren;
  var last = this.di >= h.decisions.length-1;
  var pickup = /Let's play that one|let's play one of those|Play that one/i.test((h.decisions[this.di+1]||{}).setup||'');
  var w=document.createElement('div'); w.className='pys-why';
  w.innerHTML='<div class="pys-kicker"></div><p class="pys-what"></p>'
    +'<div class="pys-principle"></div><div class="pys-others"></div>'
    +'<button class="pys-pill"></button>';
  w.querySelector('.pys-kicker').textContent=o.card.kicker;
  w.querySelector('.pys-what').textContent=o.card.what;
  w.querySelector('.pys-principle').textContent=d.principleName;
  w.querySelector('.pys-others').textContent=o.card.others;
  w.querySelector('.pys-pill').textContent = last ? 'Finish the hole' : (pickup ? 'Play that one.' : 'Next shot');
  this.$.stack.className='pys-stack pys-locked pys-whyin';
  this.$.stack.appendChild(w);
  requestAnimationFrame(function(){w.classList.add('pys-in')});
  this.seen[d.principle]=d.principleName;

  setTimeout(function(){
    self.$.ghosts.innerHTML='';
    d.opts.forEach(function(x){
      if(x.key===o.key) return;
      var p=self.aim[x.key], f=self.flyFrom||self.ballPos;
      self.$.ghosts.appendChild(el('path',{d:'M '+f.x+' '+f.y+' L '+p.x+' '+p.y,fill:'none',
        stroke:INK,'stroke-width':5,'stroke-dasharray':'12 10',opacity:.22}));
      self.$.ghosts.appendChild(el('circle',{cx:p.x,cy:p.y,r:7,fill:INK,opacity:.22}));
    });
  }, this.reduced?0:450);

  w.querySelector('.pys-pill').addEventListener('click',function(){
    self.$.ghosts.innerHTML=''; self.$.fan.innerHTML=''; self.$.traces.innerHTML='';
    if(!last){ self.di++; self.flyFrom=self.ballPos; self.renderDecision(); }
    else self.finishHole();
  });
};

Game.prototype.finishHole=function(){
  var self=this;
  this.played++;
  this.onHoleDone({hole:this.hole.id, principles:Object.keys(this.seen)});
  var last = this.idx >= this.order.length-1;
  this.$.terms.innerHTML='';
  this.$.slot.textContent='Done';
  this.$.speech.textContent='That’s a hole. Nice playing.';
  var names=[]; for(var k in this.seen) names.push(this.seen[k]);
  var d=document.createElement('div'); d.className='pys-done';
  d.innerHTML='<div class="pys-big">Hole played.</div><div class="pys-small">What this hole taught: '
    +'<b></b></div><button class="pys-pill"></button>';
  d.querySelector('b').textContent=names.join(' · ');
  d.querySelector('.pys-pill').textContent = last ? 'Finish the nine' : 'Next hole';
  this.$.stack.className='pys-stack'; this.$.stack.innerHTML=''; this.$.stack.appendChild(d);
  d.querySelector('.pys-pill').addEventListener('click',function(){
    if(last){ self.onNineDone({course:self.courseId, holes:self.played}); self.onExit(); }
    else { self.idx++; self.playHole(self.order[self.idx]); }
  });
};

root.PYS = {
  Game: Game, hash32: hash32, tenBall: tenBall, zonePoint: zonePoint, Geom: Geom, baseT: baseT,
  load: function(base){ return fetch(base+'bank.json').then(function(r){return r.json()}); }
};
})(typeof window!=='undefined'?window:globalThis);
