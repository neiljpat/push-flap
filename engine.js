export const W=432,H=720,BIRD_X=110,RADIUS=14,PIPE_WIDTH=66;
export const LEVELS={chill:{gap:244,speed:82,spacing:254,label:'Chill'},classic:{gap:196,speed:107,spacing:248,label:'Classic'},beast:{gap:160,speed:132,spacing:244,label:'Beast'}};
export const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export function calibratedHeight(noseY,high,low){return H*(.22+.56*clamp((noseY-high)/(low-high),0,1));}
export function circleRect(cx,cy,r,x,y,w,h){const nx=clamp(cx,x,x+w),ny=clamp(cy,y,y+h);return (cx-nx)**2+(cy-ny)**2<r*r;}
export class Game{
  constructor({mode='body',difficulty='chill',random=Math.random}={}){this.random=random;this.mode=mode;this.difficulty=difficulty;this.reset();}
  reset(){this.y=H*.5;this.velocity=0;this.rotation=0;this.elapsed=0;this.score=0;this.pipes=[];this.dead=false;this.lastCenter=H*.43;this.nextHigh=true;this.newPipe(W+130);this.newPipe(W+130+LEVELS[this.difficulty].spacing);}
  newPipe(x){const l=LEVELS[this.difficulty];let center;if(this.mode==='body'){center=H*(this.nextHigh?.35:.65)+(this.random()-.5)*30;this.nextHigh=!this.nextHigh;}else{center=clamp(this.lastCenter+(this.random()-.5)*240,H*.27,H*.73);}this.lastCenter=center;this.pipes.push({x,center,passed:false});}
  flap(){if(!this.dead&&this.mode==='tap')this.velocity=-292;}
  tick(dt,targetY){if(this.dead)return {died:false,scored:0};dt=clamp(dt,0,.04);this.elapsed+=dt;const l=LEVELS[this.difficulty];const previousY=this.y;
    if(this.mode==='tap'){this.velocity+=890*dt;this.y+=this.velocity*dt;this.rotation=clamp(this.velocity/800,-.38,.78);}else{this.y+=(clamp(targetY??this.y,38,H-38)-this.y)*(1-Math.exp(-18*dt));this.velocity=(this.y-previousY)/Math.max(dt,.001);this.rotation=clamp(this.velocity/900,-.35,.5);}
    let scored=0;for(const p of this.pipes){p.x-=l.speed*dt;if(!p.passed&&p.x+PIPE_WIDTH<BIRD_X-RADIUS){p.passed=true;this.score++;scored++;}const top=p.center-l.gap/2,bottom=p.center+l.gap/2;if(circleRect(BIRD_X,this.y,RADIUS,p.x-4,0,PIPE_WIDTH+8,top)||circleRect(BIRD_X,this.y,RADIUS,p.x-4,bottom,PIPE_WIDTH+8,H-bottom))this.dead=true;}
    if(this.y<RADIUS||this.y>H-RADIUS)this.dead=true;
    this.pipes=this.pipes.filter(p=>p.x>-PIPE_WIDTH-20);const last=this.pipes.at(-1);if(last.x<W+60)this.newPipe(last.x+l.spacing);
    return {died:this.dead,scored};
  }
}
