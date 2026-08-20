// 音效引擎 —— 纯 WebAudio 程序化合成（chirp/chiptune）
(function () {
  let ctx = null, master = null, bgmGain = null, sfxGain = null, enabled = true;
  let bgmTimer = null, bgmStep = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
      bgmGain = ctx.createGain(); bgmGain.gain.value = 0.16; bgmGain.connect(master);
      return true;
    } catch (e) { return false; }
  }

  function resume() { if (ctx && ctx.state === "suspended") ctx.resume(); }

  function tone(freq, dur, type, vol, when, slideTo) {
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.03);
  }

  function noise(dur, vol, when, freq) {
    const t = ctx.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 2000; f.Q.value = 1;
    const g = ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t);
  }

  const SFX = {
    click()    { tone(880, 0.05, "square", 0.12); tone(1320, 0.04, "square", 0.08, 0.03); },
    hover()    { tone(660, 0.03, "square", 0.05); },
    open()     { tone(520, 0.06, "square", 0.12, 0, 780); tone(780, 0.06, "square", 0.1, 0.05, 1040); },
    close()    { tone(780, 0.06, "square", 0.1, 0, 520); },
    notify()   { tone(988, 0.09, "square", 0.18); tone(1319, 0.12, "square", 0.18, 0.09); },
    msg()      { tone(700, 0.05, "triangle", 0.14); tone(900, 0.05, "triangle", 0.1, 0.06); },
    coin()     { tone(988, 0.07, "square", 0.15); tone(1319, 0.09, "square", 0.15, 0.06); tone(1760, 0.14, "square", 0.12, 0.12); },
    cash()     { tone(660, 0.06, "triangle", 0.16); tone(880, 0.06, "triangle", 0.16, 0.07); tone(1100, 0.06, "triangle", 0.16, 0.14); noise(0.15, 0.12, 0, 6000); },
    complete() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, "square", 0.16, i * 0.09)); noise(0.2, 0.1, 0.1, 4000); },
    bigWin()   { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.16, "square", 0.16, i * 0.1)); [1047, 1319, 1568].forEach((f, i) => tone(f, 0.2, "square", 0.12, 0.6 + i * 0.12)); noise(0.5, 0.12, 0.2, 3000); },
    error()    { tone(220, 0.16, "sawtooth", 0.14, 0, 110); noise(0.1, 0.15, 0, 800); },
    levelup()  { [392, 523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.1, "square", 0.15, i * 0.07)); },
    step()     { noise(0.03, 0.06, 0, 3000); },
    type()     { tone(1400 + Math.random() * 600, 0.018, "square", 0.03); },
    key()      { tone(1200, 0.03, "triangle", 0.08); },
    pop()      { tone(300, 0.08, "square", 0.12, 0, 900); },
    select()   { tone(520, 0.05, "triangle", 0.1); tone(700, 0.06, "triangle", 0.1, 0.05); },
    stamp()    { noise(0.12, 0.3, 0, 2500); tone(180, 0.1, "square", 0.2); },
    openDoor() { noise(0.3, 0.12, 0, 900); tone(200, 0.2, "sine", 0.08, 0, 150); },
    fanfare()  { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.13, "square", 0.16, i * 0.09)); },
  };

  // ---- BGM: 日式轻快办公室 chiptune 循环 ----
  // 每行 8 个 16 分音符，bpm=112
  const BPM = 112, STEP = 60 / BPM / 4;
  // 旋律（C大调，简单明快）
  const MELODY = [
    523,0,659,0,784,659,784,880, 784,0,659,0,587,659,587,523,
    523,0,659,0,784,880,1047,0, 988,0,880,0,784,0,659,0,
    659,0,880,0,1047,988,1047,1175, 1047,0,880,0,784,659,784,880,
    784,0,659,587,523,0,659,0, 523,0,440,0,523,0,0,0,
    523,0,659,0,784,659,784,880, 784,0,659,0,587,659,587,523,
    523,0,659,0,784,880,1047,0, 988,880,1047,988,1175,1047,880,784,
    659,0,880,0,1047,988,1047,1175, 1047,0,880,0,784,659,784,880,
    1047,0,880,0,784,659,587,523, 440,0,523,0,392,0,523,0,
  ];
  // 贝斯（根音五度）
  const BASS = [
    131,0,131,0, 165,0,165,0, 196,0,196,0, 131,0,131,0,
    131,0,131,0, 165,0,165,0, 196,0,196,0, 131,0,131,0,
    147,0,147,0, 175,0,175,0, 196,0,196,0, 147,0,147,0,
    131,0,131,0, 165,0,165,0, 98,0,98,0, 131,0,131,0,
  ];

  function bgmTick() {
    if (!ctx || !enabled) return;
    const i = bgmStep % 128;
    const mel = MELODY[i], bass = BASS[i % 64];
    const t = 0;
    if (mel) toneBGM(mel, STEP * 0.9, "square", 0.22, t);
    if (bass) toneBGM(bass, STEP * 0.9, "triangle", 0.5, t);
    // 轻打击乐（每 4 步一个 hi-hat，每 8 步一个 snare-ish）
    if (i % 4 === 2) noiseBGM(0.03, 0.12, 0, 8000);
    if (i % 8 === 4) noiseBGM(0.05, 0.1, 0, 4000);
    bgmStep++;
  }

  function toneBGM(freq, dur, type, vol, when) {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bgmGain);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBGM(dur, vol, when, freq) {
    const t = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = freq || 6000;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(bgmGain);
    src.start(t);
  }

  function startBGM() {
    if (!ensure() || bgmTimer) return;
    resume();
    bgmTimer = setInterval(bgmTick, STEP * 1000);
    bgmTick();
  }
  function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

  window.SFX = {
    init() { ensure(); resume(); },
    setEnabled(on) { enabled = on; },
    play(name) {
      if (!enabled || !ensure()) return;
      resume();
      const fn = SFX[name];
      if (fn) try { fn(); } catch (e) {}
    },
    startBGM, stopBGM,
    isEnabled() { return enabled; },
  };
})();
