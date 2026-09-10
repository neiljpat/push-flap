import {Game,LEVELS,W,H,BIRD_X,PIPE_WIDTH,calibratedHeight,clamp} from './engine.js';

const $=id=>document.getElementById(id);
const canvas=$('game'),ctx=canvas.getContext('2d'),video=$('camera'),stage=$('stage'),overlay=$('overlay');
const ICONS={camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>',pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>',play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7z"/></svg>',sound:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>',muted:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4zM16 9l5 6m0-6-5 6"/></svg>'};
let state='idle',mode='body',difficulty='chill',game=new Game(),stream=null,detector=null,detectorPromise=null;
let cameraGeneration=0,lastVideoTime=-1,lastInference=0,lastFaceAt=0,noseY=.5,noseSmooth=.5;
let calibration=null,calElapsed=0,calSamples=[],highPoint=0,calDisplay=-1,calNoFaceTime=0;
let countdown=0,countdownLast=-1,countdownResume=false,trackingFrozen=false,recoveryAt=0;
let animationTime=0,lastFrame=performance.now(),particles=[],hitFlash=0,wakeLock=null;
let audio=null,soundOn=readStore('push-flap:sound','on')!=='off';
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const sprite=new Image();sprite.src='./assets/bird.png';
let spriteReady=false;sprite.onload=()=>spriteReady=true;

function readStore(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function writeStore(key,value){try{localStorage.setItem(key,String(value));}catch{}}
function bestKey(){return `push-flap:best:${mode}:${difficulty}`;}
function best(){return Math.max(0,Number(readStore(bestKey(),'0'))||0);}
function updateBest(){const n=best();$('hud-best').textContent=n;$('local-best').textContent=String(n).padStart(2,'0');$('best-context').textContent=`${mode==='body'?'Body':'Tap'} · ${LEVELS[difficulty].label} · this device`;}
function unlockAudio(){if(!soundOn)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}}
function tone(frequency=700,duration=.1,type='sine',volume=.06){if(!soundOn||!audio||audio.state!=='running')return;try{const osc=audio.createOscillator(),gain=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(frequency*.7,audio.currentTime+duration);gain.gain.setValueAtTime(volume,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+duration);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{}}
function updateSound(){const b=$('sound-button');b.innerHTML=soundOn?ICONS.sound:ICONS.muted;b.setAttribute('aria-pressed',String(soundOn));b.setAttribute('aria-label',soundOn?'Turn sound off':'Turn sound on');b.title=soundOn?'Sound on':'Sound off';}
function panel(html){overlay.innerHTML=`<div class="overlay-panel">${html}</div>`;overlay.hidden=false;$('countdown').hidden=true;$('tracking-alert').hidden=true;}
function primary(label,action,icon=''){return `<button class="button-primary" data-action="${action}">${icon}${label}</button>`;}
function secondary(label,action){return `<button class="button-secondary" data-action="${action}">${label}</button>`;}
function resetGame(){game=new Game({mode,difficulty});particles=[];hitFlash=0;$('score').textContent='0';trackingFrozen=false;recoveryAt=0;}
function showIdle(){state='idle';resetGame();updatePause();releaseWakeLock();if(mode==='body'){
  panel(`<span class="eyebrow">MOVE TO FLY</span><h2>Ready for<br>one more rep?</h2><p>Your bird follows your head.<br>Move up and down to clear the pipes.</p>${primary(stream?'Calibrate & play':'Enable camera','camera',ICONS.camera)}${secondary('Try tap / space instead','tap')}<p class="tiny">Camera access is only requested when you start.</p>`);
 }else{panel(`<span class="eyebrow">TAP TO FLY</span><h2>Find your rhythm.</h2><p>Tap the game or press <strong>Space</strong> to flap. Stay inside the gaps.</p>${primary('Let’s fly','start',ICONS.play)}${secondary('Play with your body','body')}<p class="tiny">One point for every pair of pipes.</p>`);}}
function updateModeUI(){
 $('body-mode').setAttribute('aria-checked',String(mode==='body'));$('tap-mode').setAttribute('aria-checked',String(mode==='tap'));
 $('under-label').textContent=mode==='body'?'Rise to climb. Lower to dive.':'Tap the game or press Space to flap.';
 $('play-hint').textContent=mode==='body'?'YOUR BODY IS THE CONTROLLER':'SPACE / TAP TO FLAP';
 $('instructions').innerHTML=mode==='body'?'<h2>The setup</h2><ol><li><span>01</span><p>Prop your phone near the floor, with the front camera facing you.</p></li><li><span>02</span><p>Set your high and low positions. Keep your face in view.</p></li><li><span>03</span><p>Push up to climb. Lower down to dive. Get through the gaps.</p></li></ol>':'<h2>How to play</h2><ol><li><span>01</span><p>Tap the game or press Space to flap upward.</p></li><li><span>02</span><p>Let go to fall. Find a steady rhythm through the gaps.</p></li><li><span>03</span><p>Each pair of pipes is one point. How far can you fly?</p></li></ol>';
 $('privacy').hidden=mode!=='body';$('tracker-panel').hidden=!stream||!calibration;$('camera-off').hidden=!stream;
 updateBest();
}
function changeMode(value){if(!['body','tap'].includes(value))throw new Error('Choose body or tap.');if(value===mode)return;mode=value;if(mode==='tap')stopCamera();calibration=null;updateModeUI();showIdle();}
function changeDifficulty(value){if(!LEVELS[value])throw new Error('Unknown difficulty.');if(value===difficulty)return;difficulty=value;document.querySelectorAll('[data-difficulty]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.difficulty===value)));$('difficulty-note').textContent={chill:'Wider gaps. Room to find your rhythm.',classic:'A little tighter. Keep a steady pace.',beast:'Tight gaps. Quick moves. Make them count.'}[value];updateBest();showIdle();}
function updatePause(){const b=$('pause-button');b.disabled=!['playing','paused','countdown'].includes(state);b.innerHTML=state==='paused'?ICONS.play:ICONS.pause;b.setAttribute('aria-label',state==='paused'?'Resume game':'Pause game');}
function hasFace(now=performance.now()){return !!stream&&now-lastFaceAt<350;}
function targetY(){return calibration?calibratedHeight(noseSmooth,calibration.high,calibration.low):clamp(noseSmooth*H,40,H-40);}

async function loadDetector(){
 if(detector)return detector;
 if(!detectorPromise)detectorPromise=(async()=>{const {FaceDetector,FilesetResolver}=await import('./vendor/vision_bundle.mjs');const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href);return FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/face-detector.tflite',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.55,minSuppressionThreshold:.3});})();
 try{detector=await detectorPromise;return detector;}catch(e){detectorPromise=null;throw e;}
}
async function startCamera(){
 unlockAudio();if(stream&&detector){beginCalibration();return;}
 mode='body';updateModeUI();state='loading';updatePause();const generation=++cameraGeneration;
 panel(`<span class="eyebrow">CAMERA MODE</span><h2>Let’s get you<br>in the frame.</h2><p>Allow the front camera when your browser asks. No microphone needed.</p><button class="button-primary" disabled>Opening camera…</button>${secondary('Use tap mode','tap')}<p class="tiny">Your video is processed only on this device.</p>`);
 let acquired=null;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is unavailable in this browser. Open this game in Safari or Chrome, or use tap mode.');
  acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:960},frameRate:{ideal:24,max:30}},audio:false});
  if(generation!==cameraGeneration){acquired.getTracks().forEach(t=>t.stop());return;}
  stream=acquired;video.srcObject=stream;await video.play();
  if(generation!==cameraGeneration)return;
  stage.classList.add('has-camera');$('camera-off').hidden=false;
  panel(`<span class="eyebrow">CAMERA ON</span><h2>Getting ready.</h2><p>Set your camera near the floor and keep your face in view.</p><button class="button-primary" disabled>Preparing head tracking…</button>${secondary('Use tap mode','tap')}`);
  await loadDetector();
  if(generation!==cameraGeneration)return;
  lastVideoTime=-1;lastFaceAt=0;noseSmooth=.5;
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(generation===cameraGeneration){stopCamera();showCameraError('The camera disconnected. Reconnect it and try again, or play in tap mode.');}});
  $('tracking-pill').hidden=false;beginCalibration();
 }catch(e){
  if(acquired&&acquired!==stream)acquired.getTracks().forEach(t=>t.stop());
  if(generation!==cameraGeneration)return;stopCamera();
  const message={NotAllowedError:'Camera permission was declined. Allow camera access for this site in your browser, then try again.',NotFoundError:'No camera was found. Connect a camera, or try tap mode.',NotReadableError:'The camera is busy. Close other apps using it, then try again.',OverconstrainedError:'This camera could not start. Try another browser or use tap mode.'}[e.name]||e.message||'Head tracking could not load. Try again or switch to tap mode.';
  showCameraError(message);
 }
}
function showCameraError(message){state='error';updatePause();panel(`<span class="eyebrow">CAMERA UNAVAILABLE</span><h2>A small detour.</h2><p id="camera-error"></p>${primary('Try camera again','camera')}${secondary('Play tap mode','tap')}`);$('camera-error').textContent=message;}
function stopCamera(){cameraGeneration++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;stage.classList.remove('has-camera');lastFaceAt=0;calibration=null;$('tracking-pill').hidden=true;$('tracker-panel').hidden=true;$('camera-off').hidden=true;$('tracking-alert').hidden=true;releaseWakeLock();}
function beginCalibration(){if(!stream||!detector){startCamera();return;}state='calibrate_high';calibration=null;calElapsed=0;calSamples=[];calDisplay=-1;calNoFaceTime=0;resetGame();updatePause();$('tracker-panel').hidden=true;requestWakeLock();calibrationPanel();}
function calibrationPanel(){const high=state==='calibrate_high';panel(`<span class="eyebrow">SET YOUR RANGE · ${high?'1':'2'} OF 2</span><h2>${high?'Hold at the top.':'Now lower down.'}</h2><p>${high?'Straighten your arms at the top of a push-up. Keep your face visible.':'Lower into a comfortable push-up position. Keep looking toward the camera.'}</p><div class="calibration-progress"><span id="cal-progress"></span></div><button class="button-primary" id="cal-status" disabled>Looking for your face…</button><p class="tiny">Captures automatically. No tapping needed.</p><button class="text-button" data-action="cancel">Cancel setup</button>`);}
function median(values){const a=[...values].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];}
function updateCalibration(dt,now){
 if(!hasFace(now)){calNoFaceTime+=dt;$('cal-status').textContent=calNoFaceTime>8?'Face the camera in good light':'Looking for your face…';return;}
 calNoFaceTime=0;calElapsed+=dt;const duration=state==='calibrate_high'?6:5;
 calSamples.push({y:noseY,t:calElapsed});calSamples=calSamples.filter(s=>s.t>=calElapsed-1.1);
 $('cal-progress').style.width=`${clamp(calElapsed/duration,0,1)*100}%`;
 const seconds=Math.ceil(duration-calElapsed);if(seconds!==calDisplay){calDisplay=seconds;$('cal-status').textContent=`Hold still · ${Math.max(1,seconds)}`;if(seconds<=3)tone(440,.07);}
 if(calElapsed<duration||calSamples.length<8)return;
 const point=median(calSamples.map(s=>s.y));
 if(state==='calibrate_high'){highPoint=point;state='calibrate_low';calElapsed=0;calSamples=[];calDisplay=-1;calibrationPanel();tone(760,.15);}
 else if(Math.abs(point-highPoint)<.035){state='calibration_error';panel(`<span class="eyebrow">LET’S ADJUST</span><h2>A little more range.</h2><p>Your two positions looked too similar. Tilt the camera so your face moves higher and lower in the picture.</p>${primary('Calibrate again','calibrate')}${secondary('Use tap mode','tap')}`);}
 else{calibration={high:highPoint,low:point};$('tracker-panel').hidden=false;tone(980,.2);startCountdown(false,4);}
}
function trackFace(now){
 if(!stream||!detector||video.readyState<2||now-lastInference<55||video.currentTime===lastVideoTime)return;
 lastInference=now;lastVideoTime=video.currentTime;
 try{const result=detector.detectForVideo(video,now);const face=result.detections?.reduce((big,d)=>(d.boundingBox?.width??0)>(big?.boundingBox?.width??0)?d:big,null);if(face){const value=face.keypoints?.[2]?.y??(face.boundingBox.originY+face.boundingBox.height*.55)/video.videoHeight;if(Number.isFinite(value)){noseY=clamp(value,0,1);noseSmooth=lastFaceAt===0?noseY:noseSmooth+(noseY-noseSmooth)*.55;lastFaceAt=now;}}}
 catch(e){stopCamera();showCameraError('Head tracking stopped. Restart the camera or use tap mode.');}
 const found=hasFace(now);$('tracking-pill').classList.toggle('found',found);$('tracking-label').textContent=found?'Head tracking active':'Looking for your face';
 if(calibration)$('range-marker').style.left=`${8+84*(1-clamp((noseSmooth-calibration.high)/(calibration.low-calibration.high),0,1))}%`;
}
async function requestWakeLock(){try{if(!wakeLock&&navigator.wakeLock&&document.visibilityState==='visible')wakeLock=await navigator.wakeLock.request('screen');}catch{}}
function releaseWakeLock(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
function startCountdown(resume=false,seconds=3){
 unlockAudio();if(mode==='body'&&(!stream||!calibration)){startCamera();return;}
 if(!resume)resetGame();state='countdown';countdown=seconds;countdownLast=-1;countdownResume=resume;overlay.hidden=true;$('tracking-alert').hidden=true;$('countdown').hidden=false;updatePause();canvas.focus({preventScroll:true});requestWakeLock();
}
function beginPlay(){state='playing';$('countdown').hidden=true;overlay.hidden=true;trackingFrozen=false;recoveryAt=0;if(!countdownResume){game.y=mode==='body'?targetY():H*.5;if(mode==='tap')game.flap();}updatePause();tone(1000,.12);}
function pause(){if(!['playing','countdown'].includes(state))return;state='paused';updatePause();releaseWakeLock();panel(`<span class="eyebrow">TAKE A BREATHER</span><h2>Paused.</h2><p>Your bird will be right here.</p>${primary('Keep going','resume',ICONS.play)}${secondary('Start a fresh run','start')}<button class="text-button" data-action="home">Back to setup</button>`);}
function endRun(){state='over';updatePause();releaseWakeLock();hitFlash=.32;tone(130,.3,'triangle',.08);const prior=best(),isBest=game.score>prior;if(isBest)writeStore(bestKey(),game.score);updateBest();for(let i=0;i<18;i++)particles.push({x:BIRD_X,y:game.y,vx:(Math.random()-.5)*220,vy:(Math.random()-.5)*240,t:.7,max:.7});panel(`<span class="eyebrow">${isBest?'NEW PERSONAL BEST':'THAT’S A WRAP'}</span><h2>${game.score===0?'Find your rhythm.':game.score<10?'One more?':'That was a run.'}</h2><div class="big-result">${game.score}</div><div class="result-label">GAPS CLEARED</div><div class="result-stats"><div>BEST<strong>${best()}</strong></div><div>TIME<strong>${Math.floor(game.elapsed)}s</strong></div></div>${primary('Another round','start')}${secondary(mode==='body'?'Recalibrate':'Try body mode',mode==='body'?'calibrate':'body')}<button class="text-button" data-action="home">Back to setup</button>`);}
function flap(){if(mode!=='tap')return;unlockAudio();if(state==='idle'||state==='over'){startCountdown(false,2);return;}if(state==='playing'){game.flap();tone(640,.065,'sine',.035);for(let i=0;i<3;i++)particles.push({x:BIRD_X-15,y:game.y+5,vx:-50-Math.random()*40,vy:15+Math.random()*40,t:.3,max:.3});}}

function drawPipe(x,center,gap,opacity=1){
 ctx.save();ctx.globalAlpha=opacity;const top=center-gap/2,bottom=center+gap/2;
 const gradient=ctx.createLinearGradient(x,0,x+PIPE_WIDTH,0);gradient.addColorStop(0,'#813f31');gradient.addColorStop(.12,'#df644b');gradient.addColorStop(.33,'#ffb08a');gradient.addColorStop(.53,'#fb7c55');gradient.addColorStop(1,'#be503a');
 ctx.fillStyle=gradient;ctx.strokeStyle='#452d29';ctx.lineWidth=3;
 ctx.fillRect(x,0,PIPE_WIDTH,top);ctx.strokeRect(x,-5,PIPE_WIDTH,top+5);ctx.fillRect(x,bottom,PIPE_WIDTH,H-bottom);ctx.strokeRect(x,bottom,PIPE_WIDTH,H-bottom+5);
 ctx.fillRect(x-4,top-22,PIPE_WIDTH+8,22);ctx.strokeRect(x-4,top-22,PIPE_WIDTH+8,22);ctx.fillRect(x-4,bottom,PIPE_WIDTH+8,22);ctx.strokeRect(x-4,bottom,PIPE_WIDTH+8,22);
 ctx.fillStyle='#ffdbb888';ctx.fillRect(x+8,0,3,Math.max(0,top-24));ctx.fillRect(x+8,bottom+24,3,H-bottom);ctx.restore();
}
function drawBird(x,y,rotation=0,scale=1){if(!spriteReady)return;ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(scale,scale);ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,82,185,1111,850,-28,-21,56,43);ctx.restore();}
function render(dt){
 ctx.clearRect(0,0,W,H);
 if(!stream){ctx.fillStyle='#1b292a';ctx.fillRect(0,0,W,H);const glow=ctx.createRadialGradient(150,300,10,200,320,480);glow.addColorStop(0,'#344e3c55');glow.addColorStop(1,'#14222300');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);ctx.fillStyle='#9cae9012';const offset=reducedMotion?0:(animationTime*8)%32;for(let x=-32;x<W+32;x+=32)for(let y=0;y<H;y+=32)ctx.fillRect(x-offset,y,1.5,1.5);}else{const shade=ctx.createLinearGradient(0,0,0,H);shade.addColorStop(0,'#06141499');shade.addColorStop(.25,'#10201b11');shade.addColorStop(.8,'#10201b11');shade.addColorStop(1,'#06141477');ctx.fillStyle=shade;ctx.fillRect(0,0,W,H);}
 const active=['playing','paused','countdown','over'].includes(state);
 if(active){for(const p of game.pipes)drawPipe(p.x,p.center,LEVELS[difficulty].gap);if(mode==='body'&&calibration&&hasFace()&&['playing','countdown'].includes(state)){ctx.save();ctx.setLineDash([3,6]);ctx.strokeStyle='#e5ffb725';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,game.y);ctx.lineTo(BIRD_X-32,game.y);ctx.stroke();ctx.restore();}drawBird(BIRD_X,game.y,game.rotation);}
 else if(state.startsWith('calibrate')){drawBird(BIRD_X,targetY(),0);}
 else{drawPipe(43,366,264,.65);drawPipe(337,330,280,.9);drawBird(151,179+(reducedMotion?0:Math.sin(animationTime*3)*8),-.07,1.2);}
 for(const p of particles){p.t-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.globalAlpha=Math.max(0,p.t/p.max);ctx.fillStyle='#d3fc73';ctx.fillRect(p.x,p.y,4,4);}particles=particles.filter(p=>p.t>0);ctx.globalAlpha=1;
 if(hitFlash>0){ctx.fillStyle=`rgba(255,150,110,${hitFlash*.7})`;ctx.fillRect(0,0,W,H);hitFlash=Math.max(0,hitFlash-dt);}
}
function frame(now){
 const dt=Math.min((now-lastFrame)/1000,.04);lastFrame=now;animationTime+=dt;
 if(!document.hidden){trackFace(now);
  if(state.startsWith('calibrate_')&&state!=='calibration_error')updateCalibration(dt,now);
  if(state==='countdown'){
   if(mode==='body'&&!hasFace(now)){$('countdown').textContent='';$('tracking-alert').hidden=false;$('tracking-alert').innerHTML='<strong>Find the camera</strong><span>Keep your face visible to start.</span>';}
   else{$('tracking-alert').hidden=true;countdown-=dt;const digit=Math.ceil(countdown);if(digit!==countdownLast){countdownLast=digit;$('countdown').textContent=digit>0?digit:'GO';if(digit>0)tone(400,.075);}if(countdown<=0)beginPlay();}
  }
  if(state==='playing'){
   if(mode==='body'){
    if(!hasFace(now)){trackingFrozen=true;recoveryAt=0;$('tracking-alert').hidden=false;$('tracking-alert').innerHTML='<strong>Face out of view</strong><span>Game frozen. Face the camera to continue.</span>';}
    else if(trackingFrozen){recoveryAt||=now;game.y+=(targetY()-game.y)*.15;$('tracking-alert').innerHTML='<strong>Got you.</strong><span>Resuming in a moment…</span>';if(now-recoveryAt>1200){trackingFrozen=false;$('tracking-alert').hidden=true;}}
   }
   if(!trackingFrozen){const event=game.tick(dt,targetY());if(event.scored){$('score').textContent=game.score;tone(1050,.11);for(let i=0;i<7;i++)particles.push({x:BIRD_X,y:game.y,vx:(Math.random()-.2)*100,vy:(Math.random()-.5)*100,t:.5,max:.5});}if(event.died)endRun();}
  }
  render(dt);
 }
 requestAnimationFrame(frame);
}

overlay.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;unlockAudio();if(action==='camera')startCamera();if(action==='tap'){changeMode('tap');startCountdown(false,2);}if(action==='body'){changeMode('body');startCamera();}if(action==='start')startCountdown(false,mode==='body'?4:2);if(action==='resume')startCountdown(true,2);if(action==='calibrate')beginCalibration();if(action==='cancel'){stopCamera();showIdle();}if(action==='home')showIdle();});
$('body-mode').addEventListener('click',()=>changeMode('body'));
$('tap-mode').addEventListener('click',()=>changeMode('tap'));
document.querySelectorAll('[data-difficulty]').forEach(b=>b.addEventListener('click',()=>changeDifficulty(b.dataset.difficulty)));
$('sound-button').addEventListener('click',()=>{soundOn=!soundOn;writeStore('push-flap:sound',soundOn?'on':'off');updateSound();if(soundOn){unlockAudio();tone();}});
$('pause-button').addEventListener('click',()=>state==='paused'?startCountdown(true,2):pause());
$('camera-off').addEventListener('click',()=>{stopCamera();showIdle();});
$('recalibrate').addEventListener('click',()=>beginCalibration());
canvas.addEventListener('pointerdown',e=>{e.preventDefault();canvas.focus({preventScroll:true});flap();});
document.addEventListener('keydown',e=>{
 if(e.repeat||e.altKey||e.metaKey||e.ctrlKey)return;
 if(e.target.closest('button,input,select,textarea,a')&&e.code==='Space')return;
 if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();if(state==='paused')startCountdown(true,2);else flap();}
 if(e.code==='KeyP'||e.code==='Escape'){if(e.code==='Escape'&&stage.classList.contains('expanded')){exitExpanded();return;}if(state==='paused')startCountdown(true,2);else pause();}
 if(e.code==='KeyR'&&!state.startsWith('calibrate')&&state!=='loading')startCountdown(false,mode==='body'?4:2);
});
document.querySelectorAll('[role="radiogroup"]').forEach(group=>group.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const buttons=[...group.querySelectorAll('[role="radio"]')],index=buttons.indexOf(document.activeElement),next=buttons[(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];next.focus();next.click();}));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&['playing','countdown'].includes(state))pause();if(document.hidden)releaseWakeLock();});
window.addEventListener('pagehide',()=>{stopCamera();try{detector?.close();}catch{}detector=null;detectorPromise=null;});
window.addEventListener('pageshow',e=>{if(e.persisted){updateModeUI();showIdle();lastFrame=performance.now();}});
function exitExpanded(){stage.classList.remove('expanded');document.body.style.overflow='';$('expanded-exit')?.remove();}
$('fullscreen-button').addEventListener('click',async()=>{
 try{if(document.fullscreenElement){await document.exitFullscreen();return;}if(stage.requestFullscreen){await stage.requestFullscreen();return;}}catch{}
 if(stage.classList.contains('expanded')){exitExpanded();return;}
 stage.classList.add('expanded');document.body.style.overflow='hidden';const b=document.createElement('button');b.id='expanded-exit';b.className='expanded-exit';b.textContent='Exit full screen';b.onclick=exitExpanded;stage.appendChild(b);
});

function getState(){return {state,mode,difficulty,score:game.score,best:best(),cameraActive:!!stream,calibrated:!!calibration,faceVisible:hasFace(),pausedForTracking:trackingFrozen};}
const modelContext=document.modelContext;
if(modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});const tools=[
 {name:'get_game_state',description:'Read the current Push Flap game state and score. Does not expose camera frames or face coordinates.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(input&&Object.keys(input).length)throw new Error('No arguments are accepted.');return getState();}},
 {name:'configure_game',description:'Choose body or tap controls and a difficulty. Changing a setting resets the current run; does not request camera access.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['body','tap']},difficulty:{type:'string',enum:['chill','classic','beast']}},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['mode','difficulty'].includes(k)))throw new Error('Provide mode and/or difficulty.');if('mode' in input&&!['body','tap'].includes(input.mode))throw new Error('Invalid mode.');if('difficulty' in input&&!Object.hasOwn(LEVELS,input.difficulty))throw new Error('Invalid difficulty.');if(input.mode)changeMode(input.mode);if(input.difficulty)changeDifficulty(input.difficulty);return getState();}},
 {name:'start_tap_game',description:'Switch to tap controls and start a fresh run after the countdown. Turns off an active camera.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(input&&Object.keys(input).length)throw new Error('No arguments are accepted.');changeMode('tap');startCountdown(false,2);return getState();}},
 {name:'pause_game',description:'Pause an active run or countdown.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(input&&Object.keys(input).length)throw new Error('No arguments are accepted.');if(!['playing','countdown'].includes(state))throw new Error('No active run to pause.');pause();return getState();}}
 ];for(const t of tools){try{Promise.resolve(modelContext.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{}}}
updateSound();updateModeUI();showIdle();requestAnimationFrame(frame);
