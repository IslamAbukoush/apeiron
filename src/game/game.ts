import * as THREE from 'three';
import { BODY, PlayerBody } from './physics';
import { createWorld, type Interactable } from './world';
import { findInteraction } from './interaction';
import { createInterface } from '../ui/interface';
import { Caretaker } from './npc';
import {pointedTarget,captureView} from './perception';
import type {ViewContext} from './npc-contract';
import {GoogleVoice} from '../ui/google-voice';

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
    return () => {};
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const world = createWorld();
  const player = new PlayerBody();
  const caretaker = new Caretaker(world.npc,world.npcCollider,world.navigationColliders,world.lamp);
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
  let chatTyping=false;
  let view:ViewContext={};
  const voice=new GoogleVoice(ui.voiceStatus);
  function logChat(who:string,text:string){
    const line=document.createElement('p');line.textContent=`${who}: ${text}`;ui.chatHistory.append(line);
    while(ui.chatHistory.children.length>60)ui.chatHistory.firstElementChild?.remove();
    ui.chatHistory.scrollTop=ui.chatHistory.scrollHeight;
  }
  function takeView(){
    updateCamera();world.scene.updateMatrixWorld(true);renderer.render(world.scene,camera);
    view={image:captureView(ui.canvas),target:pointedTarget(camera,world.scene.children)};
    ui.chatTarget.textContent=view.target?`Pointing at ${view.target.name}${view.target.ground?' · walkable ground candidate':''}`:'No pointed target';
  }
  function focusChat(){
    takeView();chatTyping=true;keys.clear();document.exitPointerLock();ui.chatInput.focus();
  }
  ui.chatInput.addEventListener('pointerdown',()=>{if(!chatTyping)focusChat();},{signal});
  ui.chatClose.addEventListener('click',()=>{chatTyping=false;ui.chatInput.blur();void resume();},{signal});
  ui.chatForm.addEventListener('submit',event=>{event.preventDefault();const text=ui.chatInput.value;ui.chatInput.value='';void askCaretaker(text,true);},{signal});
  ui.npcVoice.addEventListener('change',()=>{if(!ui.npcVoice.checked)voice.stop();},{signal});
  void fetch('/api/npc/thought/status',{signal}).then(r=>r.json()).then(status=>{
    ui.npcLLM.disabled=!status.configured;
    ui.npcLLM.checked=!!status.configured;caretaker.llmEnabled=!!status.configured;
  }).catch(()=>{ui.npcLLM.disabled=true;});
  ui.npcLLM.addEventListener('change',()=>{caretaker.llmEnabled=ui.npcLLM.checked;},{signal});
  void fetch('/api/npc/status',{signal}).then(r => r.json()).then(status => {
    serviceStatus = status.configured ? `${status.model} · ${status.remaining} requests available this server session. Off until enabled.`
      : 'No API key configured. Local behavior is active.';
    ui.npcService.textContent = serviceStatus;
    ui.npcAI.disabled = !status.configured;
  }).catch(() => { if (!signal.aborted) ui.npcService.textContent = 'Decision server unavailable. Local behavior is active.'; });

  async function askCaretaker(message: string,fromChat=false) {
    if (!message.trim()) return;
    if(!fromChat)takeView();
    logChat('You',message);
    voice.stop();
    ui.npcFeedback.textContent = caretaker.aiEnabled ? 'Waiting for the decision model…' : 'Using local behavior.';
    const response=caretaker.command(message.trim().slice(0,400),player.position,ui.chatView.checked?view:{});
    // Restore controls immediately from the submit gesture; never wait for the network.
    chatTyping=false;ui.chatInput.blur();void resume();
    await response;
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
    playing = false;
    keys.clear();
    accumulator = 0;
    ui.hud.hidden = true;
    ui.prompt.hidden = true;
    if (ui.conversation.open) return;
    if (entered) {
      ui.title.textContent = 'Paused';
      ui.play.textContent = 'Resume exploring';
      ui.description.textContent = 'Take your time. The courtyard will be here.';
    }
    if (!ui.menu.open) ui.menu.showModal();
  }
  async function resume() {
    if (contextLost) return;
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
      const replies = [
        ['Where am I?', 'An old courtyard at the edge of a world still taking shape. For now, these walls are its boundaries.'],
        ['What can I explore?', 'Follow the paths, walk beneath the arch, and try the low stone platforms. There is a waystone beside the southern path.'],
        ['Who are you?', 'The caretaker. I keep this place until its next story arrives.'],
      ];
      for (const [question, answer] of replies) {
        const button = document.createElement('button');
        button.textContent = question;
        button.addEventListener('click', () => {
          if(caretaker.llmEnabled) void askCaretaker(question);
          else {caretaker.say(answer);ui.speech.textContent=answer;}
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
        ui.speech.textContent = world.lamp.get() ? 'You light the courtyard lantern.' : 'You put out the courtyard lantern.';
      } else {
      ui.speech.textContent = 'The inscription reads: “Every world begins with a place to stand.” The path ends here, for now.';
      }
    }
    ui.conversation.showModal();
    document.exitPointerLock();
  }

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
    if(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement){
      if(event.code==='Escape' && chatTyping){event.preventDefault();chatTyping=false;ui.chatInput.blur();void resume();}return;
    }
    if(event.code==='KeyT' && playing && !event.repeat){event.preventDefault();focusChat();return;}
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
  document.addEventListener('keyup', event => { keys.delete(event.code); }, { signal });
  function suspend() {
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
      ui.prompt.textContent = target ? `E · ${target.kind === 'npc' ? 'Talk to' : 'Read'} ${target.name}` : '';
    }
    renderer.render(world.scene, camera);
    elapsed += dt; frameCount++;
    if (elapsed >= 0.4) {
      ui.npcStatus.textContent = `${caretaker.activity} · ${caretaker.source} ${caretaker.thoughtStatus}`;
      ui.npcSubtitle.textContent=caretaker.speech;
      if(speechVersion!==caretaker.speechVersion){
        speechVersion=caretaker.speechVersion;
          logChat('Caretaker',caretaker.speech);
          if(ui.npcVoice.checked)void voice.speak(caretaker.speech);
      }
      ui.npcStatus.dataset.action = caretaker.action;
      ui.npcStatus.dataset.x = world.npc.position.x.toFixed(2);
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
    caretaker.dispose();
    voice.stop();
    if('speechSynthesis' in window)speechSynthesis.cancel();
    if (document.pointerLockElement === ui.canvas) document.exitPointerLock();
    renderer.setAnimationLoop(null);
    world.dispose();
    renderer.dispose();
    ui.menu.close(); ui.conversation.close();
    root.replaceChildren();
  };
}
