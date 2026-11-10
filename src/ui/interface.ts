export function createInterface(root: HTMLElement) {
  root.innerHTML = `
    <canvas id="viewport" aria-label="First-person 3D playground"></canvas>
    <div class="hud" id="hud" hidden>
      <div class="location">Apeiron <span>The first courtyard</span></div>
      <div class="crosshair" aria-hidden="true"></div>
      <p id="prompt" role="status" hidden></p>
      <div class="controls"><kbd>W A S D</kbd> Move <kbd>Space</kbd> Jump <kbd>E</kbd> Interact <kbd>Esc</kbd> Pause</div>
    </div>
    <pre id="diagnostics" hidden></pre>
    <dialog id="menu" aria-labelledby="menu-title">
      <h1 id="menu-title">Apeiron</h1>
      <p id="menu-description">Explore the first courtyard. Find the caretaker beneath the stone arch.</p>
      <button id="play" class="primary">Enter playground</button>
      <div class="bindings"><p><kbd>W A S D</kbd> Move · <kbd>Mouse</kbd> Look</p>
      <p><kbd>Shift</kbd> Run · <kbd>Space</kbd> Jump · <kbd>E</kbd> Interact</p>
      <p><kbd>Esc</kbd> Pause · <kbd>F3</kbd> Diagnostics</p></div>
      <details><summary>Settings</summary>
        <label for="sensitivity">Mouse sensitivity <output id="sensitivity-value">1.0</output></label>
        <input id="sensitivity" type="range" min="0.3" max="2" step="0.1" value="1" />
        <label for="quality">Rendering quality</label>
        <select id="quality"><option value="low">Low — no shadows</option><option value="medium" selected>Medium</option><option value="high">High</option></select>
        <label class="checkbox"><input id="colliders" type="checkbox" /> Show collision bounds</label>
        <button id="reset">Return to spawn</button>
      </details>
      <p class="note">Playground prototype · Desktop keyboard and mouse.<br>Progress is not saved in this milestone.</p>
      <p id="error" role="alert" hidden></p>
    </dialog>
    <dialog id="conversation" aria-labelledby="speaker">
      <h2 id="speaker"></h2><p id="speech" aria-live="polite"></p>
      <div id="answers"></div><button id="leave">Back to exploring</button>
    </dialog>`;
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  return {
    canvas: get<HTMLCanvasElement>('viewport'),
    hud: get('hud'), prompt: get('prompt'), diagnostics: get('diagnostics'),
    menu: get<HTMLDialogElement>('menu'), title: get('menu-title'), description: get('menu-description'),
    play: get<HTMLButtonElement>('play'), error: get('error'),
    sensitivity: get<HTMLInputElement>('sensitivity'), sensitivityValue: get('sensitivity-value'),
    quality: get<HTMLSelectElement>('quality'), colliders: get<HTMLInputElement>('colliders'), reset: get<HTMLButtonElement>('reset'),
    conversation: get<HTMLDialogElement>('conversation'), speaker: get('speaker'), speech: get('speech'),
    answers: get('answers'), leave: get<HTMLButtonElement>('leave'),
  };
}
