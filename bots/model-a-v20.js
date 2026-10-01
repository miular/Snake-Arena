import readline from 'node:readline';
const DIR=['UP','RIGHT','DOWN','LEFT'];
const DX=[0,1,0,-1],DY=[-1,0,1,0];
// In duels retain the validated local champion. Multiplayer needs explicit sealing-risk analysis.
function decideDuel(o){
 const {width:w,height:h,apples,snakes}=o.board,n=w*h;
 const me=snakes.find(s=>s.id===o.you); if(!me?.body.length)return 'UP';
 const idx=p=>p[1]*w+p[0], step=(p,d)=>((Math.floor(p/w)+DY[d]+h)%h)*w+(p%w+DX[d]+w)%w;
 const fruit=new Set(apples.map(idx)),head=idx(me.body[0]),cur=DIR.indexOf(me.direction);
 const occupied=new Int16Array(n),release=new Int16Array(n),danger=new Float64Array(n),enemyDist=new Int16Array(n).fill(999);
 for(const s of snakes)for(let i=0;i<s.body.length;i++){let p=idx(s.body[i]);occupied[p]=1;release[p]=s.body.length-i;}
 for(const s of snakes){if(s.id===me.id||!s.body.length)continue;
  const sh=idx(s.body[0]),sd=DIR.indexOf(s.direction);let legal=[];
  for(let d=0;d<4;d++){if(d===(sd+2)%4)continue;const p=step(sh,d);if(release[p]>1)continue;legal.push(p);}
  for(const p of legal)danger[p]+=1/Math.max(1,legal.length);
  danger[sh]=Math.max(danger[sh],0.7);
  let q=[sh],dist=new Int16Array(n).fill(-1);dist[sh]=0;
  for(let i=0;i<q.length;i++){const p=q[i];enemyDist[p]=Math.min(enemyDist[p],dist[p]);for(let d=0;d<4;d++){const z=step(p,d);if(dist[z]>=0||release[z]>1)continue;dist[z]=dist[p]+1;q.push(z);}}
 }
 const threats=Array.from({length:7},()=>new Uint8Array(n));
 for(const other of snakes){if(other.id===me.id||!other.body.length)continue;
  let front=[{p:idx(other.body[0]),d:DIR.indexOf(other.direction)}];
  for(let t=1;t<=6;t++){let next=[],seen=new Set();for(const a of front)for(let k=0;k<4;k++){
   if(k===(a.d+2)%4)continue;let z=step(a.p,k);if(release[z]>t)continue;
   threats[t][z]=1;const key=z*4+k;if(!seen.has(key)){seen.add(key);next.push({p:z,d:k});}
  }front=next;}
 }
 let best=-Infinity,answer=cur;
 for(let d=0;d<4;d++){
  if(d===(cur+2)%4)continue;const p=step(head,d),grow=fruit.has(p);
  if(release[p]>(grow?0:1))continue;
  const blocked=new Uint8Array(occupied);for(const s of snakes){if(!s.body.length)continue;const tail=idx(s.body.at(-1));if(s.id===me.id&&!grow)blocked[tail]=0;else if(s.id!==me.id){const sh=idx(s.body[0]);let canEat=false;for(let k=0;k<4;k++)if(k!==(DIR.indexOf(s.direction)+2)%4&&fruit.has(step(sh,k)))canEat=true;if(!canEat)blocked[tail]=0;}}
  if(blocked[p])continue;
  blocked[head]=1;blocked[p]=0;
  let dist=new Int16Array(n).fill(-1),q=[p];dist[p]=0;
  for(let i=0;i<q.length;i++){let z=q[i];for(let k=0;k<4;k++){let v=step(z,k);if(blocked[v]||dist[v]>=0)continue;dist[v]=dist[z]+1;q.push(v);}}
  let food=-35;for(const a of fruit){if(dist[a]<0)continue;const dd=dist[a]+1;let val=24-dd-(enemyDist[a]<dd?2:0);food=Math.max(food,val);}
  let exits=0,safeExits=0;for(let k=0;k<4;k++){const z=step(p,k);if(!blocked[z]){exits++;if(danger[z]===0)safeExits++;}}
  // Simulate our moving body over a bounded horizon, retaining diverse escape paths.
  let beam=[{body:[p,...me.body.map(idx).slice(0,grow?undefined:-1)],dir:d,ate:new Set(grow?[p]:[]),cost:0}],depth=0;
  const horizon=18;
  for(let t=2;t<=horizon;t++){
   let next=[],seen=new Set();
   for(const state of beam)for(let k=0;k<4;k++){
    if(k===(state.dir+2)%4)continue;
    const z=step(state.body[0],k),eat=fruit.has(z)&&!state.ate.has(z);
    if(state.body.slice(0,eat?undefined:-1).includes(z))continue;
    let hit=false;for(const other of snakes){if(other.id===me.id)continue;for(let j=0;j<other.body.length;j++)if(idx(other.body[j])===z && other.body.length-j+2>=t){hit=true;break;}if(hit)break;}
    if(hit || (t<=6 && threats[t][z]))continue;
    const key=z+','+k;if(seen.has(key))continue;seen.add(key);
    const ate=new Set(state.ate);if(eat)ate.add(z);
    let cost=state.cost+(eat?-2:0)+danger[z]/t*5;
    next.push({body:[z,...state.body.slice(0,eat?undefined:-1)],dir:k,ate,cost});
   }
   if(!next.length)break;
   next.sort((a,b)=>a.cost-b.cost);beam=next.slice(0,28);depth=t;
  }
  let value=(depth<horizon? -1000-(horizon-depth)*40:0)+food+Math.min(q.length,me.body.length*3)*0.12+exits*0.3+safeExits*0.1-danger[p]*160;
  const tail=idx(me.body.at(-1));let tailReach=dist[tail]>=0;for(let k=0;k<4;k++)if(dist[step(tail,k)]>=0)tailReach=true;
  if(!tailReach)value-=70;
  let localSpace=0;for(const z of q)if(dist[z]<=6)localSpace++;
  value+=Math.min(localSpace,45)*0.25;
  let territory=0;for(const z of q)if(dist[z]+1<enemyDist[z])territory++;
  value+=Math.min(territory,70)*0.04;
  if(grow)value+=3;
  if(q.length<me.body.length+5)value-=(me.body.length+5-q.length)*4;
  if(exits===0)value-=300;
  if(d===cur)value+=0.6;
  if(value>best){best=value;answer=d;}
 }
 return DIR[answer];
}

function decideMulti(o){
 const {width:w,height:h,apples,snakes}=o.board,n=w*h;
 const me=snakes.find(s=>s.id===o.you); if(!me?.body.length)return 'UP';
 const idx=p=>p[1]*w+p[0], step=(p,d)=>((Math.floor(p/w)+DY[d]+h)%h)*w+(p%w+DX[d]+w)%w;
 const fruit=new Set(apples.map(idx)),head=idx(me.body[0]),cur=DIR.indexOf(me.direction);
 const occupied=new Int16Array(n),release=new Int16Array(n),danger=new Float64Array(n),enemyDist=new Int16Array(n).fill(999);
 for(const s of snakes)for(let i=0;i<s.body.length;i++){let p=idx(s.body[i]);occupied[p]=1;release[p]=s.body.length-i;}
 for(const s of snakes){if(s.id===me.id||!s.body.length)continue;
  const sh=idx(s.body[0]),sd=DIR.indexOf(s.direction);let legal=[];
  for(let d=0;d<4;d++){if(d===(sd+2)%4)continue;const p=step(sh,d);if(release[p]>1)continue;legal.push(p);}
  for(const p of legal)danger[p]+=1/Math.max(1,legal.length);
  danger[sh]=Math.max(danger[sh],0.7);
  let q=[sh],dist=new Int16Array(n).fill(-1);dist[sh]=0;
  for(let i=0;i<q.length;i++){const p=q[i];enemyDist[p]=Math.min(enemyDist[p],dist[p]);for(let d=0;d<4;d++){const z=step(p,d);if(dist[z]>=0||release[z]>1)continue;dist[z]=dist[p]+1;q.push(z);}}
 }
 const threats=Array.from({length:7},()=>new Uint8Array(n));
 for(const other of snakes){if(other.id===me.id||!other.body.length)continue;
  let front=[{p:idx(other.body[0]),d:DIR.indexOf(other.direction)}];
  for(let t=1;t<=6;t++){let next=[],seen=new Set();for(const a of front)for(let k=0;k<4;k++){
   if(k===(a.d+2)%4)continue;let z=step(a.p,k);if(release[z]>t)continue;
   threats[t][z]=1;const key=z*4+k;if(!seen.has(key)){seen.add(key);next.push({p:z,d:k});}
  }front=next;}
 }
 // Newly occupied enemy head cells remain dangerous as body segments in later turns.
 for(let t=2;t<=6;t++)for(let z=0;z<n;z++)threats[t][z]|=threats[t-1][z];
 let best=-Infinity,answer=cur;
 for(let d=0;d<4;d++){
  if(d===(cur+2)%4)continue;const p=step(head,d),grow=fruit.has(p);
  if(release[p]>(grow?0:1))continue;
  const blocked=new Uint8Array(occupied);for(const s of snakes){if(!s.body.length)continue;const tail=idx(s.body.at(-1));if(s.id===me.id&&!grow)blocked[tail]=0;else if(s.id!==me.id){const sh=idx(s.body[0]);let canEat=false;for(let k=0;k<4;k++)if(k!==(DIR.indexOf(s.direction)+2)%4&&fruit.has(step(sh,k)))canEat=true;if(!canEat)blocked[tail]=0;}}
  if(blocked[p])continue;
  blocked[head]=1;blocked[p]=0;
  let dist=new Int16Array(n).fill(-1),q=[p];dist[p]=0;
  for(let i=0;i<q.length;i++){let z=q[i];for(let k=0;k<4;k++){let v=step(z,k);if(blocked[v]||dist[v]>=0)continue;dist[v]=dist[z]+1;q.push(v);}}
  let food=-35;for(const a of fruit){if(dist[a]<0)continue;const dd=dist[a]+1;let val=24-dd-(enemyDist[a]<dd?2:0);food=Math.max(food,val);}
  let exits=0,safeExits=0;for(let k=0;k<4;k++){const z=step(p,k);if(!blocked[z]){exits++;if(danger[z]===0)safeExits++;}}
  // Simulate our moving body over a bounded horizon, retaining diverse escape paths.
  let beam=[{body:[p,...me.body.map(idx).slice(0,grow?undefined:-1)],dir:d,ate:new Set(grow?[p]:[]),cost:0}],depth=0;
  const horizon=18;
  for(let t=2;t<=horizon;t++){
   let next=[],seen=new Set();
   for(const state of beam)for(let k=0;k<4;k++){
    if(k===(state.dir+2)%4)continue;
    const z=step(state.body[0],k),eat=fruit.has(z)&&!state.ate.has(z);
    if(state.body.slice(0,eat?undefined:-1).includes(z))continue;
    let hit=false;for(const other of snakes){if(other.id===me.id)continue;for(let j=0;j<other.body.length;j++)if(idx(other.body[j])===z && other.body.length-j+2>=t){hit=true;break;}if(hit)break;}
    if(hit || (t<=6 && threats[t][z]))continue;
    const key=z+','+k;if(seen.has(key))continue;seen.add(key);
    const ate=new Set(state.ate);if(eat)ate.add(z);
    let cost=state.cost+(eat?-2:0)+danger[z]/t*5;
    next.push({body:[z,...state.body.slice(0,eat?undefined:-1)],dir:k,ate,cost});
   }
   if(!next.length)break;
   next.sort((a,b)=>a.cost-b.cost);beam=next.slice(0,28);depth=t;
  }
  let value=(depth<horizon? -1000-(horizon-depth)*40:0)+food+Math.min(q.length,me.body.length*3)*0.06+exits*0.3+safeExits*0.1-danger[p]*10000;
  const tail=idx(me.body.at(-1));let tailReach=dist[tail]>=0;for(let k=0;k<4;k++)if(dist[step(tail,k)]>=0)tailReach=true;
  if(!tailReach)value-=35;
  let localSpace=0;for(const z of q)if(dist[z]<=6)localSpace++;
  value+=Math.min(localSpace,45)*0.12;
  let territory=0;for(const z of q)if(dist[z]+1<enemyDist[z])territory++;
  value+=Math.min(territory,70)*0.04;
  // Evaluate individual enemy routes rather than treating mutually exclusive routes as simultaneous walls.
  let robustRoom=q.length;
  if(snakes.filter(enemy=>enemy.id!==me.id&&enemy.body.length).length>2){
   const rq=[p],seen=new Uint8Array(n);seen[p]=1;
   for(let i=0;i<rq.length;i++)for(let k=0;k<4;k++){
    const z=step(rq[i],k);if(seen[z]||blocked[z]||threats[3][z])continue;
    seen[z]=1;rq.push(z);
   }
   robustRoom=rq.length;
  }else for(const enemy of snakes){
   if(enemy.id===me.id||!enemy.body.length)continue;
   const eh=idx(enemy.body[0]),ed=DIR.indexOf(enemy.direction);
   for(let e=0;e<4;e++){
    if(e===(ed+2)%4)continue;const e1=step(eh,e);if(release[e1]>1||e1===p)continue;
    for(let eNext=0;eNext<4;eNext++){
     if(eNext===(e+2)%4)continue;const e2=step(e1,eNext);if(release[e2]>2||e2===p)continue;
     // Only a potential separator can change our currently reachable component.
     if(dist[e1]<0&&dist[e2]<0)continue;
     let rq=[p],seen=new Uint8Array(n);seen[p]=1;
     for(let i=0;i<rq.length;i++)for(let k=0;k<4;k++){
      const z=step(rq[i],k);if(seen[z]||blocked[z]||z===e1||z===e2)continue;
      seen[z]=1;rq.push(z);
     }
     robustRoom=Math.min(robustRoom,rq.length);
    }
   }
  }
  value+=Math.min(robustRoom,me.body.length*2)*0.15;
  if(robustRoom<me.body.length+5)value-=(me.body.length+5-robustRoom)*3;
  if(grow)value+=3;
  if(q.length<me.body.length+5)value-=(me.body.length+5-q.length)*4;
  if(exits===0)value-=300;
  if(d===cur)value+=0.15;
  if(value>best){best=value;answer=d;}
 }
 return DIR[answer];
}

function decide(o){return o.board.snakes.length<=2?decideDuel(o):decideMulti(o);}
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{const o=JSON.parse(line);process.stdout.write(JSON.stringify({direction:decide(o)})+'\n');});
