import * as THREE from 'three';
import { BODY, PlayerBody } from './physics';
import { createWorld, type Interactable } from './world';
import { findInteraction } from './interaction';
import { createInterface } from '../ui/interface';
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
    if (entered && ready) {
      ui.title.textContent = 'Paused';
      ui.play.textContent = 'Resume exploring';
      ui.description.textContent = `Take your time. ${definition?.name ?? 'The courtyard'} will be here.`;
    }
    if (!ui.menu.open) ui.menu.showModal();
  }
  async function resume() {
    if (contextLost || !ready) return;
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
      ui.speech.textContent = definition
        ? `Welcome to ${definition.name}. ${definition.summary}`
        : 'A new face. Welcome to the courtyard. Walk a while; there is no hurry here.';
      const replies = [
        ['Where am I?', definition ? `${definition.name}. Your wish was: “${definition.prompt}”` : 'An old courtyard at the edge of a world still taking shape. For now, these walls are its boundaries.'],
        ['What can I explore?', definition ? `${definition.summary} Follow the path past me to the landmark, or wander through the groves. The waystone beside the path records your seed.` : 'Follow the paths, walk beneath the arch, and try the low stone platforms. There is a waystone beside the southern path.'],
        ['Who are you?', 'The caretaker. I keep this place until its next story arrives.'],
      ];
      for (const [question, answer] of replies) {
        const button = document.createElement('button');
        button.textContent = question;
        button.addEventListener('click', () => { ui.speech.textContent = answer; });
        ui.answers.append(button);
      }
    } else {
      ui.speech.textContent = definition
        ? `${definition.name}\n${definition.summary}\nWorld seed: ${definition.seed}\nYour wish: ${definition.prompt}`
        : 'The inscription reads: “Every world begins with a place to stand.” The path ends here, for now.';
    }
    ui.conversation.showModal();
    document.exitPointerLock();
  }

  function activateWorld(next: ReturnType<typeof createWorld>, nextDefinition: WorldDefinition | null) {
    const previous = world;
    world = next;
    definition = nextDefinition;
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
