import * as THREE from 'three';
import { BODY, PlayerBody } from './physics';
import { createWorld, type Interactable } from './world';
import { findInteraction } from './interaction';
import { createInterface } from '../ui/interface';

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
    playing = false;
    keys.clear();
    ui.hud.hidden = true;
    ui.speaker.textContent = item.name;
    ui.answers.replaceChildren();
    if (item.kind === 'npc') {
      ui.speech.textContent = 'A new face. Welcome to the courtyard. Walk a while; there is no hurry here.';
      const replies = [
        ['Where am I?', 'An old courtyard at the edge of a world still taking shape. For now, these walls are its boundaries.'],
        ['What can I explore?', 'Follow the paths, walk beneath the arch, and try the low stone platforms. There is a waystone beside the southern path.'],
        ['Who are you?', 'The caretaker. I keep this place until its next story arrives.'],
      ];
      for (const [question, answer] of replies) {
        const button = document.createElement('button');
        button.textContent = question;
        button.addEventListener('click', () => { ui.speech.textContent = answer; });
        ui.answers.append(button);
      }
    } else {
      ui.speech.textContent = 'The inscription reads: “Every world begins with a place to stand.” The path ends here, for now.';
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
    player.reset(); yaw = 0; pitch = 0; updateCamera();
  }, { signal });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === ui.canvas) {
      playing = true;
      entered = true;
      keys.clear();
      ui.menu.close();
      ui.hud.hidden = false;
      lastTime = performance.now();
    } else showMenu();
  }, { signal });
  document.addEventListener('pointerlockerror', () => {
    showMenu();
    ui.error.textContent = 'Could not capture the mouse. Click the play button to retry.';
    ui.error.hidden = false;
  }, { signal });
  document.addEventListener('mousemove', event => {
    if (!playing) return;
    const sensitivity = Number(ui.sensitivity.value) * 0.002;
    yaw -= event.movementX * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - event.movementY * sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.code === 'F3') {
      event.preventDefault();
      if (!event.repeat) ui.diagnostics.hidden = !ui.diagnostics.hidden;
    }
    if (!playing) return;
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
      ui.diagnostics.textContent = [
        `${Math.round(frameCount / elapsed)} FPS · ${(elapsed * 1000 / frameCount).toFixed(1)} ms/frame`,
        `Draw calls ${renderer.info.render.calls} · Triangles ${renderer.info.render.triangles.toLocaleString()}`,
        `Position ${player.position.toArray().map(n => n.toFixed(2)).join(', ')}`,
        `${player.grounded ? 'Grounded' : 'Airborne'} · ${playing ? 'Playing' : 'Paused'} · ${world.colliders.length} colliders`,
      ].join('\n');
      elapsed = 0; frameCount = 0;
    }
  });
  return () => {
    events.abort();
    if (document.pointerLockElement === ui.canvas) document.exitPointerLock();
    renderer.setAnimationLoop(null);
    world.dispose();
    renderer.dispose();
    ui.menu.close(); ui.conversation.close();
    root.replaceChildren();
  };
}
