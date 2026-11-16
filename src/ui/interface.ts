export function createInterface(root: HTMLElement) {
  root.innerHTML = `
    <canvas id="viewport" aria-label="First-person 3D playground"></canvas>
    <div class="hud" id="hud" hidden>
      <div class="location">Apeiron <span id="world-name">The first courtyard</span></div>
      <p id="npc-status"></p>
      <p id="ai-usage-hud" class="ai-usage" aria-label="AI usage">Checking AI usage…</p>
      <p id="npc-subtitle" aria-live="polite"></p>
      <div class="crosshair" aria-hidden="true"></div>
      <p id="prompt" role="status" hidden></p>
      <div class="controls"><kbd>W A S D</kbd> Move <kbd>Space</kbd> Jump <kbd>E</kbd> Interact <kbd>T</kbd> Chat <kbd>Esc</kbd> Pause</div>
    </div>
    <pre id="diagnostics" hidden></pre>
    <section id="chat" aria-label="Caretaker chat" hidden>
      <div class="chat-heading">Caretaker chat <button id="chat-close" type="button">Return to game</button></div>
      <div id="chat-history" role="log" aria-live="polite"></div>
      <p id="chat-target"></p>
      <p id="chat-vision" role="status"></p>
      <details id="chat-preview" hidden><summary>Latest screenshot sent</summary><img id="chat-image" alt="Game view sent to the NPC, with the crosshair marked red" /></details>
      <form id="chat-form">
        <label for="chat-input">Message the caretaker <kbd>T</kbd></label>
        <input id="chat-input" maxlength="400" autocomplete="off" placeholder="What is this? Stand there…" />
        <label class="checkbox"><input id="chat-view" type="checkbox" checked /> Include game screenshot and pointed target</label>
        <button type="submit">Send message</button>
        <button id="chat-mic" type="button" aria-pressed="false" aria-describedby="mic-status" aria-keyshortcuts="V">Hold to talk</button>
      </form>
      <p id="mic-status" role="status">Hold V while exploring, or hold this button. Release to send. English speech is recognized locally.</p>
      <div id="voice-status" role="status"></div>
    </section>
    <dialog id="menu" aria-labelledby="menu-title">
      <h1 id="menu-title">Apeiron</h1>
      <p id="menu-description">Every world begins with a wish. What will yours be?</p>
      <form id="world-form">
        <label for="world-prompt">Describe your world</label>
        <textarea id="world-prompt" rows="3" maxlength="600" required placeholder="A candy world with pink ground and sweet trees" aria-describedby="generation-help"></textarea>
        <div class="examples" aria-label="World ideas">
          <button type="button" data-prompt="A pink candy world full of sweets">Candy world</button>
          <button type="button" data-prompt="A lush enchanted forest with giant mushrooms">Enchanted forest</button>
          <button type="button" data-prompt="A frozen world of blue ice crystals at night">Frozen night</button>
        </div>
        <p class="note" id="generation-help">Local procedural generator. Themes: candy, forest, desert, frozen, volcanic and cosmic. Try a color, “night”, “lush” or “sparse”. Other descriptions use a forest.</p>
        <details class="seed-options"><summary>Map seed (optional)</summary>
          <label for="world-seed">Seed</label>
          <input id="world-seed" maxlength="64" placeholder="Leave blank for a new layout" />
        </details>
        <button id="generate" class="primary" type="submit">Generate world</button>
      </form>
      <p id="generation-status" role="status" aria-live="polite" hidden></p>
      <button id="play" class="primary" hidden>Enter world</button>
      <button id="new-world" class="secondary" hidden>Create another world</button>
      <button id="playground" class="secondary">Enter original playground</button>

      <label class="checkbox"><input id="npc-ai" type="checkbox" /> Use decision model for the caretaker</label>
      <label class="checkbox"><input id="npc-llm" type="checkbox" /> NPC conversation and planning</label>
      <label class="checkbox"><input id="npc-voice" type="checkbox" /> NPC voice replies</label>
      <p class="note">Local voice runs on your CPU. Text appears before speech is ready.</p>
      <p id="npc-service" class="note" role="status">Checking decision service…</p>
      <details><summary>AI model and usage limits</summary><p id="ai-usage-menu" class="ai-usage">Checking AI usage…</p></details>
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
      <p class="note">Desktop keyboard and mouse. Worlds and progress reset on reload.</p>
      <p id="error" role="alert" hidden></p>
    </dialog>
    <dialog id="conversation" aria-labelledby="speaker">
      <h2 id="speaker"></h2><p id="speech" aria-live="polite"></p>
      <form id="npc-command" hidden>
        <label for="npc-message">Ask the caretaker to do something</label>
        <input id="npc-message" type="text" maxlength="400" placeholder="Follow me, show me the waystone…" autocomplete="off" />
        <button id="npc-send" type="submit">Ask caretaker</button>
        <p id="npc-feedback" role="status" class="note"></p>
      </form>
      <div id="answers"></div><button id="leave">Back to exploring</button>
    </dialog>`;
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  return {
    canvas: get<HTMLCanvasElement>('viewport'),
    chat:get('chat'),chatHistory:get('chat-history'),chatTarget:get('chat-target'),
    chatVision:get('chat-vision'),chatPreview:get('chat-preview'),chatImage:get<HTMLImageElement>('chat-image'),
    chatMic:get<HTMLButtonElement>('chat-mic'),micStatus:get('mic-status'),
    chatForm:get<HTMLFormElement>('chat-form'),chatInput:get<HTMLInputElement>('chat-input'),chatView:get<HTMLInputElement>('chat-view'),chatClose:get<HTMLButtonElement>('chat-close'),voiceStatus:get('voice-status'),
    hud: get('hud'), prompt: get('prompt'), diagnostics: get('diagnostics'),
    npcStatus: get('npc-status'), npcAI: get<HTMLInputElement>('npc-ai'), npcService: get('npc-service'),
    aiUsageHud:get('ai-usage-hud'),aiUsageMenu:get('ai-usage-menu'),
    npcLLM:get<HTMLInputElement>('npc-llm'),npcVoice:get<HTMLInputElement>('npc-voice'),npcSubtitle:get('npc-subtitle'),
    npcCommand: get<HTMLFormElement>('npc-command'), npcMessage: get<HTMLInputElement>('npc-message'),
    npcSend: get<HTMLButtonElement>('npc-send'), npcFeedback: get('npc-feedback'),
    menu: get<HTMLDialogElement>('menu'), title: get('menu-title'), description: get('menu-description'),
    play: get<HTMLButtonElement>('play'), error: get('error'),
    worldName: get('world-name'), worldForm: get<HTMLFormElement>('world-form'),
    worldPrompt: get<HTMLTextAreaElement>('world-prompt'), worldSeed: get<HTMLInputElement>('world-seed'),
    generate: get<HTMLButtonElement>('generate'), generationStatus: get('generation-status'),
    newWorld: get<HTMLButtonElement>('new-world'), playground: get<HTMLButtonElement>('playground'),
    sensitivity: get<HTMLInputElement>('sensitivity'), sensitivityValue: get('sensitivity-value'),
    quality: get<HTMLSelectElement>('quality'), colliders: get<HTMLInputElement>('colliders'), reset: get<HTMLButtonElement>('reset'),
    conversation: get<HTMLDialogElement>('conversation'), speaker: get('speaker'), speech: get('speech'),
    answers: get('answers'), leave: get<HTMLButtonElement>('leave'),
  };
}
