import * as THREE from 'three';
import { BODY, PlayerBody } from './physics';
import { createWorld, type Interactable } from './world';
import { findInteraction } from './interaction';
import { createInterface } from '../ui/interface';
import { Caretaker } from './npc';
import {pointedTarget,captureView} from './perception';
import type {ViewContext} from './npc-contract';
import {GoogleVoice} from '../ui/google-voice';
import {MicrophoneInput} from '../ui/microphone';
import {formatAiUsage,type AiStatus} from '../ui/ai-usage';
import { generateWorld, type WorldDefinition } from './generation';
import { createGeneratedWorld } from './generated-world';

export function startGame(root: HTMLElement) {
  const ui = createInterface(root);
  ui.menu.showModal();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true });
  } catch {
    ui.error.textContent = 'Unable to start WebGL 2. Try a browser with hardware acceleration enabled.';
    ui.error.hidden = false;
    ui.play.disabled = true;
    ui.generate.disabled = true;
    ui.playground.disabled = true;
    return () => {};
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  let world = createWorld();
  let definition: WorldDefinition | null = null;
  let ready = false;
  const player = new PlayerBody();
  let caretaker = new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,undefined,world.registry);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  camera.rotation.order = 'YXZ';
  const keys = new Set<string>();
  const events = new AbortController();
  const { signal } = events;
  let playing = false;
  let entered = false;
  let yaw = 0;
  let pitch = 0;
  let accumulator = 0;
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let target: Interactable | null = null;
  let contextLost = false;
  const fixedStep = 1 / 120;
  let serviceStatus = 'Local behavior available';
  let speechVersion=0;
  let streamingChatLine:HTMLParagraphElement|undefined;
  let chatTyping=false;
  let view:ViewContext={};
  const voice=new GoogleVoice(ui.voiceStatus);
  let activityAudio:AudioContext|undefined;
  function playActivitySound(kind:'bell'|'water'|'chest'){
    activityAudio??=new AudioContext();void activityAudio.resume();
    const now=activityAudio.currentTime;
    for(let index=0;index<(kind==='bell'?3:1);index++){
      const oscillator=activityAudio.createOscillator(),gain=activityAudio.createGain();oscillator.type=kind==='chest'?'triangle':'sine';oscillator.frequency.setValueAtTime(kind==='bell'?880*(index+1):kind==='water'?1100:180,now);
      if(kind==='water')oscillator.frequency.exponentialRampToValueAtTime(450,now+.35);
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12/(index+1),now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+(kind==='bell'?1.5:.4));
      oscillator.connect(gain);gain.connect(activityAudio.destination);oscillator.start(now);oscillator.stop(now+1.6);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }
  }
  const microphone=new MicrophoneInput(ui.chatMic,ui.micStatus,text=>{ui.chatInput.value='';void askCaretaker(text,true);});
  let pushToTalk=false;
  let talkKey:string|undefined;
  let talkPointer:number|undefined;
  caretaker.onAudioChunk=pcm=>{if(ui.npcVoice.checked&&!microphone.recording)voice.chunk(pcm);};
  caretaker.onSpeechChunk=showStreamingSpeech;
  caretaker.onLookReady=captureCaretakerView;
  function captureCaretakerView(focus:THREE.Vector3):ViewContext{
    const eye=new THREE.PerspectiveCamera(70,camera.aspect,.05,100);eye.position.copy(world.npc.position);eye.position.y+=1.55;eye.lookAt(focus);eye.updateMatrixWorld(true);
    world.scene.updateMatrixWorld(true);
    // Hide the observer's own mesh while taking its eye-level screenshot.
    let image:string;
    world.npc.visible=false;try{renderer.render(world.scene,eye);image=captureView(ui.canvas);}finally{world.npc.visible=true;renderer.render(world.scene,camera);}
    ui.chatImage.src=image;ui.chatPreview.hidden=false;
    ui.chatImage.alt='View from the caretaker’s eyes after approaching the inspected place';
    return {image,perspective:'npc'};
  }
  function logChat(who:string,text:string){
    const line=document.createElement('p');line.textContent=`${who}: ${text}`;ui.chatHistory.append(line);
    while(ui.chatHistory.children.length>60)ui.chatHistory.firstElementChild?.remove();
    ui.chatHistory.scrollTop=ui.chatHistory.scrollHeight;
    return line;
  }
  function showStreamingSpeech(text:string){
    if(!streamingChatLine)streamingChatLine=logChat('Caretaker',text);
    else streamingChatLine.textContent=`Caretaker: ${text}`;
    ui.chatHistory.scrollTop=ui.chatHistory.scrollHeight;
    ui.npcSubtitle.textContent=text;
    if(ui.conversation.open && ui.speaker.textContent==='The caretaker')ui.speech.textContent=text;
  }
  function takeView(){
    updateCamera();world.scene.updateMatrixWorld(true);renderer.render(world.scene,camera);
    const direction=camera.getWorldDirection(new THREE.Vector3());
    view={image:captureView(ui.canvas),observer:{x:camera.position.x,y:camera.position.y,z:camera.position.z,dx:direction.x,dy:direction.y,dz:direction.z},target:pointedTarget(camera,world.scene.children,world.registry.limit)};
    ui.chatTarget.textContent=view.target?`Pointing at ${view.target.name}${view.target.ground?' · walkable ground candidate':''}`:'No pointed target';
  }
  function focusChat(){
    takeView();chatTyping=true;keys.clear();document.exitPointerLock();ui.chatInput.focus();
  }
  ui.chatInput.addEventListener('pointerdown',()=>{if(!chatTyping)focusChat();},{signal});
  ui.chatClose.addEventListener('click',()=>{microphone.cancel();chatTyping=false;ui.chatInput.blur();void resume();},{signal});
  function startMicrophone(){voice.stop();void microphone.start();}
  ui.chatMic.addEventListener('pointerdown',event=>{
    if(event.button!==0||ui.chatMic.disabled||microphone.recording)return;
    event.preventDefault();talkPointer=event.pointerId;ui.chatMic.setPointerCapture(event.pointerId);startMicrophone();
  },{signal});
  ui.chatMic.addEventListener('pointerup',event=>{if(talkPointer===event.pointerId){talkPointer=undefined;void microphone.finish();}},{signal});
  const cancelPointer=()=>{if(talkPointer!==undefined){talkPointer=undefined;if(microphone.recording)microphone.cancel();}};
  ui.chatMic.addEventListener('pointercancel',cancelPointer,{signal});
  ui.chatMic.addEventListener('lostpointercapture',cancelPointer,{signal});
  void fetch('/api/npc/transcribe/status',{signal}).then(r=>r.json()).then(status=>{
    if(!status.configured){ui.chatMic.disabled=true;ui.micStatus.textContent='Local microphone recognition is not installed.';}
  }).catch(()=>{ui.micStatus.textContent='Local microphone recognition is unavailable.';});
  ui.chatForm.addEventListener('submit',event=>{event.preventDefault();const text=ui.chatInput.value;ui.chatInput.value='';void askCaretaker(text,true);},{signal});
  ui.npcVoice.addEventListener('change',()=>{if(!ui.npcVoice.checked)voice.stop();},{signal});
  let aiStatus:AiStatus={},thoughtInitialized=false,checkingUsage=false;
  try{const saved=localStorage.getItem('apeiron-npc-provider');if(saved==='local'||saved==='hybrid')ui.npcProvider.value=saved;}catch{/* Storage may be unavailable. */}
  caretaker.llmProvider=ui.npcProvider.value as 'local'|'hybrid';
  let providerRevision=0;
  async function refreshThoughtStatus(){
    if(checkingUsage||signal.aborted)return;checkingUsage=true;
    const revision=providerRevision;
    try{
      const r=await fetch('/api/npc/thought/status',{signal,headers:{'X-NPC-Provider':ui.npcProvider.value}});if(!r.ok)throw Error();const status=await r.json();if(revision!==providerRevision)return;aiStatus=status;
      ui.npcLLM.disabled=!aiStatus.configured;
      if(!thoughtInitialized){ui.npcLLM.checked=!!aiStatus.configured;caretaker.llmEnabled=!!aiStatus.configured;thoughtInitialized=true;}
      caretaker.autonomyInterval=aiStatus.provider==='groq'?45:12;
    }catch{if(!thoughtInitialized)ui.npcLLM.disabled=true;}
    finally{if(revision===providerRevision)checkingUsage=false;}
  }
  void refreshThoughtStatus();const usageTimer=setInterval(()=>void refreshThoughtStatus(),5000);
  ui.npcProvider.addEventListener('change',()=>{
    providerRevision++;checkingUsage=false;voice.stop();microphone.cancel();streamingChatLine=undefined;
    caretaker.setLlmProvider(ui.npcProvider.value as 'local'|'hybrid');
    try{localStorage.setItem('apeiron-npc-provider',ui.npcProvider.value);}catch{/* Keep the current selection without persistence. */}
    aiStatus={provider:ui.npcProvider.value==='local'?'local':'groq',configured:true};void refreshThoughtStatus();
  },{signal});
  ui.npcLLM.addEventListener('change',()=>{caretaker.llmEnabled=ui.npcLLM.checked;},{signal});
  void fetch('/api/npc/status',{signal}).then(r => r.json()).then(status => {
    serviceStatus = status.configured ? `${status.model} · ${status.remaining} requests available this server session. Off until enabled.`
      : 'No API key configured. Local behavior is active.';
    ui.npcService.textContent = serviceStatus;
    ui.npcAI.disabled = !status.configured;
  }).catch(() => { if (!signal.aborted) ui.npcService.textContent = 'Decision server unavailable. Local behavior is active.'; });

  async function askCaretaker(message: string,_fromChat=false) {
    if (!message.trim()) return;
    microphone.cancel();pushToTalk=false;
    streamingChatLine=undefined;
    takeView();
    logChat('You',message);
    if(ui.npcVoice.checked)voice.beginStream();else voice.stop();
    caretaker.voiceEnabled=ui.npcVoice.checked;
    ui.npcFeedback.textContent = caretaker.aiEnabled ? 'Waiting for the decision model…' : 'Using local behavior.';
    const context:ViewContext=ui.chatView.checked?view:{};
    ui.chatPreview.hidden=!context.image;
    if(context.image)ui.chatImage.src=context.image;
    const response=caretaker.command(message.trim().slice(0,400),player.position,context);
    // Restore controls immediately from the submit gesture; never wait for the network.
    chatTyping=false;ui.chatInput.blur();if(document.pointerLockElement!==ui.canvas)void resume();
    await response;
    void refreshThoughtStatus();
    if (signal.aborted) return;
    if (ui.conversation.open && ui.speaker.textContent === 'The caretaker') {
      ui.speech.textContent = caretaker.speech;
      ui.npcFeedback.textContent = `${caretaker.source}. Resume exploring to see the action.`;
    }
    ui.npcSend.disabled = false;
  }
  ui.npcAI.addEventListener('change',() => caretaker.setAI(ui.npcAI.checked),{signal});
  ui.npcCommand.addEventListener('submit',event => { event.preventDefault(); void askCaretaker(ui.npcMessage.value); },{signal});

  function updateCamera() {
    camera.position.copy(player.position);
    camera.position.y += BODY.eyeHeight;
    camera.rotation.set(pitch, yaw, 0);
    camera.updateMatrixWorld();
  }
  function resize() {
    const ratio = ui.quality.value === 'high' ? 2 : ui.quality.value === 'medium' ? 1.5 : 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, ratio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  function showMenu() {
    if(chatTyping)return;
    microphone.suspend();pushToTalk=false;
    playing = false;
    keys.clear();
    accumulator = 0;
    ui.hud.hidden = true;
    ui.prompt.hidden = true;
    if (ui.conversation.open) return;
    if (entered && ready) {
      ui.title.textContent = 'Paused';
      ui.play.textContent = 'Resume exploring';
      ui.description.textContent = `Take your time. ${definition?.name ?? 'The courtyard'} will be here.`;
    }
    if (!ui.menu.open) ui.menu.showModal();
  }
  async function resume() {
    if (contextLost || !ready) return;
    if(!ui.chatMic.disabled)void microphone.prepare().catch(()=>{});
    ui.conversation.close();
    ui.menu.close();
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    ui.error.hidden = true;
    try {
      await ui.canvas.requestPointerLock();
    } catch {
      showMenu();
      ui.error.textContent = 'Mouse capture was denied. Click Resume to try again, or open the game in a regular browser tab.';
      ui.error.hidden = false;
    }
  }
  function openConversation(item: Interactable) {
    chatTyping=false;
    playing = false;
    keys.clear();
    ui.hud.hidden = true;
    ui.speaker.textContent = item.name;
    ui.answers.replaceChildren();
    ui.npcCommand.hidden = item.kind !== 'npc';
    ui.npcFeedback.textContent = caretaker.source;
    if (item.kind === 'npc') {
      ui.speech.textContent = caretaker.speech;
      for (const question of ['Where am I?','What can I explore?','Who are you?']) {
        const button = document.createElement('button');
        button.textContent = question;
        button.addEventListener('click', () => {
          void askCaretaker(question);
        });
        ui.answers.append(button);
      }
      for (const command of ['Follow me','Show me the waystone','Tend the lantern','Wait here']) {
        const button = document.createElement('button'); button.textContent = command;
        button.addEventListener('click',() => { void askCaretaker(command); }); ui.answers.append(button);
      }
    } else {
      if (item.id === 'lantern') {
        world.lamp.toggle();
        ui.speech.textContent = `Lantern: ${world.lamp.get()?'on':'off'}`;
      } else {
      const object=world.registry.get(item.id);ui.speech.textContent=object?`${object.description}${object.state?` Current state: ${object.state}.`:''}`:'There is nothing to inspect here.';
      if(object)for(const action of object.actions){
        if(action==='read')continue;
        const button=document.createElement('button');button.textContent=action==='open'?'Open / close chest':action==='water'?'Water flowers':action==='ring'?'Ring bell':action==='sit'?'Ask the caretaker to sit':action;
        button.addEventListener('click',()=>{
          if(action==='sit'){void askCaretaker(`Sit on the ${object.name}`);return;}
          const result=world.registry.interact(object.id,action);ui.speech.textContent=`${result.message} State: ${world.registry.get(object.id)?.state||''}`;
        });ui.answers.append(button);
      }
      }
    }
    ui.conversation.showModal();
    document.exitPointerLock();
  }

  function activateWorld(next: ReturnType<typeof createWorld>, nextDefinition: WorldDefinition | null) {
    const previous = world;
    world = next;
    definition = nextDefinition;
    const ai=caretaker.aiEnabled,llm=caretaker.llmEnabled;
    caretaker.dispose();voice.stop();microphone.cancel();pushToTalk=false;
    caretaker=new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp,undefined,world.registry);
    caretaker.aiEnabled=ai;caretaker.llmEnabled=llm;
    caretaker.llmProvider=ui.npcProvider.value as 'local'|'hybrid';
    caretaker.autonomyInterval=aiStatus.provider==='groq'?45:12;
    caretaker.onAudioChunk=pcm=>{if(ui.npcVoice.checked&&!microphone.recording)voice.chunk(pcm);};
    caretaker.onSpeechChunk=showStreamingSpeech;
    caretaker.onLookReady=captureCaretakerView;
    view={};streamingChatLine=undefined;ui.chatHistory.replaceChildren();
    previous.dispose();
    player.reset(); yaw = 0; pitch = 0; accumulator = 0; target = null;
    entered = false; ready = true;
    world.debug.visible = ui.colliders.checked;
    updateCamera();
    ui.worldName.textContent = definition?.name ?? 'The first courtyard';
    ui.title.textContent = definition?.name ?? 'Apeiron';
    ui.description.textContent = definition ? 'Your world is ready. Enter and find the caretaker along the path.' : 'Explore the first courtyard. Find the caretaker beneath the stone arch.';
    ui.worldForm.hidden = true;
    ui.play.hidden = false;
    ui.play.textContent = definition ? 'Enter world' : 'Enter playground';
    ui.newWorld.hidden = false;
    ui.playground.hidden = true;
  }
  ui.worldForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (contextLost || ui.generate.disabled) return;
    ui.error.hidden = true;
    ui.generate.disabled = true;
    ui.playground.disabled = true;
    ui.generate.textContent = 'Generating…';
    ui.worldForm.setAttribute('aria-busy', 'true');
    ui.generationStatus.hidden = false;
    ui.generationStatus.textContent = 'Planning the scenery and building your map…';
    // Yield a frame so feedback appears before geometry construction.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      if (signal.aborted || contextLost) return;
      const seed = ui.worldSeed.value.trim() || crypto.randomUUID().slice(0, 8);
      const nextDefinition = generateWorld(ui.worldPrompt.value, seed);
      const next = createGeneratedWorld(nextDefinition);
      activateWorld(next, nextDefinition);
      ui.generationStatus.textContent = `${nextDefinition.summary}\nSeed: ${nextDefinition.seed}${nextDefinition.fallback ? '\nNo supported theme found; this map uses the forest theme.' : ''}`;
      ui.play.focus();
    } catch (error) {
      ui.error.textContent = error instanceof Error ? error.message : 'Could not build your world. Try another description.';
      ui.error.hidden = false;
      ui.generationStatus.hidden = true;
    } finally {
      ui.generate.disabled = contextLost;
      ui.playground.disabled = contextLost;
      ui.generate.textContent = 'Generate world';
      ui.worldForm.removeAttribute('aria-busy');
    }
  }, { signal });
  ui.worldForm.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      ui.worldPrompt.value = button.dataset.prompt!;
      ui.worldPrompt.focus();
    }, { signal });
  });
  ui.newWorld.addEventListener('click', () => {
    ready = false; entered = false;
    ui.worldForm.hidden = false;
    ui.play.hidden = true;
    ui.newWorld.hidden = true;
    ui.playground.hidden = false;
    ui.generationStatus.hidden = true;
    ui.error.hidden = true;
    ui.title.textContent = 'Apeiron';
    ui.description.textContent = 'Every world begins with a wish. What will yours be?';
    ui.worldPrompt.focus();
  }, { signal });
  ui.playground.addEventListener('click', () => {
    if (contextLost) return;
    activateWorld(createWorld(), null);
    ui.generationStatus.hidden = true;
    void resume();
  }, { signal });
  ui.play.addEventListener('click', resume, { signal });
  ui.leave.addEventListener('click', resume, { signal });
  ui.menu.addEventListener('cancel', event => { event.preventDefault(); }, { signal });
  ui.conversation.addEventListener('cancel', event => {
    event.preventDefault();
    ui.conversation.close();
    showMenu();
  }, { signal });
  ui.sensitivity.addEventListener('input', () => {
    ui.sensitivityValue.textContent = Number(ui.sensitivity.value).toFixed(1);
  }, { signal });
  ui.quality.addEventListener('change', () => {
    renderer.shadowMap.enabled = ui.quality.value !== 'low';
    world.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
      }
    });
    resize();
  }, { signal });
  ui.colliders.addEventListener('change', () => { world.debug.visible = ui.colliders.checked; }, { signal });
  ui.reset.addEventListener('click', () => {
    voice.stop();microphone.cancel();pushToTalk=false;
    player.reset(); caretaker.reset(); yaw = 0; pitch = 0; updateCamera();
  }, { signal });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === ui.canvas) {
      playing = true;
      entered = true;
      keys.clear();
      ui.menu.close();
      ui.hud.hidden = false;
      ui.chat.hidden=false;
      lastTime = performance.now();
    } else showMenu();
  }, { signal });
  document.addEventListener('pointerlockerror', () => {
    showMenu();
    ui.error.textContent = 'Could not capture the mouse. Click the play button to retry.';
    ui.error.hidden = false;
  }, { signal });
  document.addEventListener('mousemove', event => {
    if (!playing || chatTyping) return;
    const sensitivity = Number(ui.sensitivity.value) * 0.002;
    yaw -= event.movementX * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }, { signal });
  document.addEventListener('keydown', event => {
    if(event.code==='Escape'){microphone.suspend();pushToTalk=false;}
    if(pushToTalk&&event.code===talkKey){event.preventDefault();return;}
    if(event.target===ui.chatMic && ['Space','Enter'].includes(event.code)){
      event.preventDefault();if(!event.repeat&&!ui.chatMic.disabled){pushToTalk=true;talkKey=event.code;startMicrophone();}return;
    }
    if(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement){
      if(event.code==='Escape' && chatTyping){event.preventDefault();chatTyping=false;ui.chatInput.blur();void resume();}return;
    }
    if(event.code==='KeyT' && playing && !event.repeat){event.preventDefault();focusChat();return;}
    if(event.code==='KeyV' && playing){event.preventDefault();if(!event.repeat&&!ui.chatMic.disabled){pushToTalk=true;talkKey=event.code;startMicrophone();}return;}
    if (event.code === 'F3') {
      event.preventDefault();
      if (!event.repeat) ui.diagnostics.hidden = !ui.diagnostics.hidden;
    }
    if (!playing || chatTyping) return;
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Tab'].includes(event.code)) event.preventDefault();
    if (event.code !== 'Space' || !event.repeat) keys.add(event.code);
    if (event.code === 'KeyE' && !event.repeat) {
      updateCamera();
      target = findInteraction(camera, world.scene.children);
      if (target) openConversation(target);
    }
  }, { signal });
  document.addEventListener('keyup', event => { keys.delete(event.code);if(event.code===talkKey&&pushToTalk){pushToTalk=false;talkKey=undefined;void microphone.finish();} }, { signal });
  function suspend() {
    microphone.suspend();pushToTalk=false;
      chatTyping=false;
    keys.clear();
    if (document.pointerLockElement === ui.canvas) document.exitPointerLock();
    showMenu();
  }
  window.addEventListener('blur', suspend, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); }, { signal });
  window.addEventListener('resize', resize, { signal });
  ui.canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; suspend();
    ui.conversation.close(); showMenu();
    ui.error.textContent = 'Graphics context lost. Reload the page to restart the playground.';
    ui.error.hidden = false; ui.play.disabled = true;
    ui.generate.disabled = true; ui.playground.disabled = true; ui.newWorld.disabled = true;
  }, { signal });

  resize();
  updateCamera();
  renderer.setAnimationLoop((time: number) => {
    if (contextLost) return;
    const dt = Math.min(Math.max((time - lastTime) / 1000, 0), 0.1);
    lastTime = time;
    if (playing) {
      accumulator += dt;
      while (accumulator >= fixedStep) {
        caretaker.step(fixedStep,player.position);
        world.activities.update(fixedStep);
        player.step(fixedStep, {
          forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
          right: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
          sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
          jump: keys.has('Space'),
        }, yaw, world.colliders);
        keys.delete('Space');
        accumulator -= fixedStep;
      }
      updateCamera();
      target = findInteraction(camera, world.scene.children);
      ui.prompt.hidden = !target;
      const actions=target?world.registry.get(target.id)?.actions:undefined;
      ui.prompt.textContent = target ? `E · ${target.kind === 'npc' ? 'Talk to' : actions?.some(action=>action!=='read')?'Use':actions?.includes('read')?'Read':'Inspect'} ${target.name}` : '';
    }
    renderer.render(world.scene, camera);
    if(!playing&&ui.conversation.open)world.activities.update(dt);
    for(const event of world.activities.events.splice(0))playActivitySound(event);
    elapsed += dt; frameCount++;
    if (elapsed >= 0.4) {
      ui.npcStatus.textContent = `${caretaker.activity} · ${caretaker.source} ${caretaker.thoughtStatus}`;
      ui.npcSubtitle.textContent=caretaker.speech;
      ui.chatVision.textContent=caretaker.visionStatus;
      ui.aiUsageHud.textContent=ui.aiUsageMenu.textContent=formatAiUsage(aiStatus);
      if(speechVersion!==caretaker.speechVersion){
        speechVersion=caretaker.speechVersion;
        if(caretaker.speech.trim()){
          if(streamingChatLine){streamingChatLine.textContent=`Caretaker: ${caretaker.speech}`;streamingChatLine=undefined;}
          else logChat('Caretaker',caretaker.speech);
          if(ui.npcVoice.checked && !microphone.recording && !caretaker.replyStreamed)void voice.speak(caretaker.speech,caretaker.replyAudio);
        }
      }
      ui.npcStatus.dataset.action = caretaker.action;
      ui.npcStatus.dataset.avatar=String(world.npc.userData.avatarState||'');
      ui.npcStatus.dataset.animation=String(world.npc.userData.avatarAnimation||'');
      ui.npcStatus.dataset.target = caretaker.targetId;
      ui.npcStatus.dataset.x = world.npc.position.x.toFixed(2);
      ui.npcStatus.dataset.y = world.npc.position.y.toFixed(2);
      ui.npcStatus.dataset.z = world.npc.position.z.toFixed(2);
      ui.npcStatus.dataset.lantern = String(world.lamp.get());
      ui.npcStatus.dataset.visited = [...caretaker.visited].join(',');
      ui.npcAI.checked = caretaker.aiEnabled;
      ui.npcSend.disabled = false;
      ui.npcService.textContent = caretaker.source === 'Local behavior' ? serviceStatus : caretaker.source;
      ui.diagnostics.textContent = [
        `${Math.round(frameCount / elapsed)} FPS · ${(elapsed * 1000 / frameCount).toFixed(1)} ms/frame`,
        `Draw calls ${renderer.info.render.calls} · Triangles ${renderer.info.render.triangles.toLocaleString()}`,
        `Position ${player.position.toArray().map(n => n.toFixed(2)).join(', ')}`,
        `Caretaker ${world.npc.position.x.toFixed(2)}, ${world.npc.position.z.toFixed(2)} · ${caretaker.action}`,
        `${player.grounded ? 'Grounded' : 'Airborne'} · ${playing ? 'Playing' : 'Paused'} · ${world.colliders.length} colliders`,
      ].join('\n');
      elapsed = 0; frameCount = 0;
    }
  });
  return () => {
    events.abort();
    clearInterval(usageTimer);
    caretaker.dispose();
    voice.stop();
    void activityAudio?.close();
    microphone.suspend();
    if('speechSynthesis' in window)speechSynthesis.cancel();
    if (document.pointerLockElement === ui.canvas) document.exitPointerLock();
    renderer.setAnimationLoop(null);
    world.dispose();
    renderer.dispose();
    ui.menu.close(); ui.conversation.close();
    root.replaceChildren();
  };
}
