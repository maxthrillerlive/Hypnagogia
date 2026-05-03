// ═══════════════════════════════════════════════════════════
// Revision 2026 - Browser Demo
// A journey through procedural worlds
// ═══════════════════════════════════════════════════════════

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });

if (!gl) {
  document.body.innerHTML = '<p style="color:#f00;font-family:monospace;padding:2em">WebGL2 not supported</p>';
  throw new Error('No WebGL2');
}

// ── Resolution ──────────────────────────────────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// ── Shader helpers ──────────────────────────────────────
function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(vsSrc, fsSrc) {
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ── Fullscreen quad ─────────────────────────────────────
const quadVS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

function drawQuad(program) {
  gl.useProgram(program);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── Demo shader (the main visual) ───────────────────────
const demoFS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_res;
uniform float u_scene;

#define PI 3.14159265359
#define TAU 6.28318530718

// ── Hash & noise ────────────────────────────────────────
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

// ── SDF helpers ─────────────────────────────────────────
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// ── Raymarch scene ──────────────────────────────────────
float mapScene(vec3 p, float t) {
  float d = 1e10;

  // Morphing blob
  float blob = sdSphere(p, 0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec3 offset = vec3(
      sin(t * 0.7 + fi * 1.3) * 0.8,
      cos(t * 0.5 + fi * 1.7) * 0.6,
      sin(t * 0.3 + fi * 2.1) * 0.7
    );
    blob = opSmoothUnion(blob, sdSphere(p - offset, 0.3 + 0.15 * sin(t + fi)), 0.5);
  }

  // Ground plane with displacement
  float ground = p.y + 1.0 + fbm(p.xz * 2.0 + t * 0.3) * 0.3;

  d = opSmoothUnion(blob, ground, 0.8);

  // Floating boxes
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec3 bp = p - vec3(
      sin(t * 0.4 + fi * TAU / 3.0) * 2.0,
      1.0 + cos(t * 0.6 + fi) * 0.5,
      cos(t * 0.4 + fi * TAU / 3.0) * 2.0
    );
    bp.xz = mat2(cos(t + fi), sin(t + fi), -sin(t + fi), cos(t + fi)) * bp.xz;
    d = opSmoothUnion(d, sdBox(bp, vec3(0.2)), 0.3);
  }

  return d;
}

vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy, t) - mapScene(p - e.xyy, t),
    mapScene(p + e.yxy, t) - mapScene(p - e.yxy, t),
    mapScene(p + e.yyx, t) - mapScene(p - e.yyx, t)
  ));
}

// ── Raymarch ────────────────────────────────────────────
vec3 raymarch(vec3 ro, vec3 rd, float t) {
  float totalDist = 0.0;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * totalDist;
    float d = mapScene(p, t);
    if (d < 0.001) {
      vec3 n = calcNormal(p, t);
      // Lighting
      vec3 lightDir = normalize(vec3(1.0, 2.0, 1.0));
      float diff = max(dot(n, lightDir), 0.0);
      float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 32.0);
      float ao = 1.0 - smoothstep(0.0, 2.0, p.y + 1.0) * 0.3;

      // Color based on position and normal
      vec3 baseCol = 0.5 + 0.5 * cos(t * 0.2 + p.xyz * 0.5 + vec3(0.0, 2.0, 4.0));
      vec3 col = baseCol * (0.15 + diff * 0.7) + vec3(1.0) * spec * 0.5;
      col *= ao;
      // Fog
      float fog = exp(-totalDist * 0.15);
      col = mix(vec3(0.02, 0.01, 0.05), col, fog);
      return col;
    }
    totalDist += d;
    if (totalDist > 30.0) break;
  }
  // Sky
  float skyGrad = rd.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.05, 0.02, 0.1), vec3(0.0, 0.0, 0.02), skyGrad);
  // Stars
  float stars = step(0.998, hash(floor(rd.xy * 300.0)));
  sky += stars * 0.8;
  return sky;
}

// ── 2D post effects ─────────────────────────────────────
vec3 postProcess(vec3 col, vec2 uv, float t) {
  // Vignette
  float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 1.5;
  col *= vig;

  // Color grading - push to cinematic tones
  col = pow(col, vec3(0.9, 0.95, 1.1));

  // Subtle film grain
  col += (hash(uv * 1000.0 + t) - 0.5) * 0.03;

  // Letterbox for cinematic feel
  float bar = smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
  col *= bar;

  return col;
}

void main() {
  vec2 uv = v_uv;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;

  float t = u_time;
  float scene = u_scene;

  // ── Camera ──────────────────────────────────────────────
  float camAngle = t * 0.2;
  vec3 ro = vec3(sin(camAngle) * 5.0, 2.0 + sin(t * 0.3) * 1.0, cos(camAngle) * 5.0);
  vec3 ta = vec3(0.0, 0.5, 0.0);
  vec3 fwd = normalize(ta - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd + p.x * right + p.y * up);

  // ── Render 3D scene ──────────────────────────────────────
  vec3 col = raymarch(ro, rd, t);

  // ── 2D overlay effects per scene ──────────────────────────
  if (scene < 1.0) {
    // Scene 0: Title / intro - scan lines
    float scanline = sin(uv.y * u_res.y * 0.5) * 0.04;
    col -= scanline;

    // Fade in from black
    float fadeIn = smoothstep(0.0, 2.0, t);
    col *= fadeIn;
  } else if (scene < 2.0) {
    // Scene 1: Main journey - subtle chromatic feel
    col.r += 0.02 * sin(t * 2.0 + uv.x * 10.0);
    col.b += 0.02 * cos(t * 2.0 + uv.y * 10.0);
  } else if (scene >= 2.0) {
    // Scene 2: Outro / credits - no fade, just keep rendering
    // Subtle warm tint for credits feel
    col.rgb += vec3(0.01, 0.005, 0.0);
  }

  col = postProcess(col, uv, t);

  fragColor = vec4(col, 1.0);
}`;

const demoProgram = createProgram(quadVS, demoFS);
const uTime = gl.getUniformLocation(demoProgram, 'u_time');
const uRes = gl.getUniformLocation(demoProgram, 'u_res');
const uScene = gl.getUniformLocation(demoProgram, 'u_scene');

// ── Audio Engine (procedural synth) ─────────────────────
class Synth {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.3;
    this.master.connect(this.ctx.destination);

    // Delay for echo
    this.delay = this.ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.375;
    this.delayFb = this.ctx.createGain();
    this.delayFb.gain.value = 0.4;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.master);
  }

  note(freq, start, dur, type = 'sawtooth', vol = 0.12) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain);
    gain.connect(this.master);
    gain.connect(this.delay);
    osc.start(start);
    osc.stop(start + dur + 0.1);
  }

  kick(start) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, start);
    osc.frequency.exponentialRampToValueAtTime(30, start + 0.15);
    gain.gain.setValueAtTime(0.5, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + 0.35);
  }

  hat(start) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.05);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.master);
    src.start(start);
  }

  scheduleSong() {
    const now = this.ctx.currentTime + 0.1;
    const bpm = 128;
    const beat = 60 / bpm;
    const barLen = beat * 4;

    // Full demo = 60 seconds = ~32 bars at 128 BPM
    const totalBars = 32;

    // ── Musical patterns (A minor journey) ───────────────
    // Bass: Am → F → C → G progression, repeating
    const bassPattern = [
      [55, 55, 55, 55, 55, 55, 65.41, 65.41],    // Am (8 beats)
      [43.65, 43.65, 43.65, 43.65, 43.65, 43.65, 49.0, 49.0], // F
      [65.41, 65.41, 65.41, 65.41, 65.41, 65.41, 73.42, 73.42], // C
      [49.0, 49.0, 49.0, 49.0, 49.0, 49.0, 55.0, 55.0]   // G
    ];

    // Melody evolves over the demo
    const melodySections = [
      // Intro (bars 0-3): sparse, high
      [440, 0, 0, 523.25, 0, 0, 587.33, 0],
      // Build (bars 4-11): fuller
      [440, 523.25, 587.33, 523.25, 440, 392, 349.23, 392],
      // Peak (bars 12-23): energetic
      [440, 587.33, 659.25, 587.33, 523.25, 440, 392, 349.23],
      // Outro (bars 24-31): resolve
      [440, 392, 349.23, 329.63, 293.66, 261.63, 220, 0],
    ];

    // Pad chords per section
    const padChords = [
      [220, 261.63, 329.63],     // Am
      [174.61, 220, 261.63],     // F
      [261.63, 329.63, 392],    // C
      [196, 246.94, 293.66],    // G
    ];

    // Arpeggio notes for variety in later sections
    const arpNotes = [220, 261.63, 329.63, 392, 440, 523.25, 587.33, 659.25];

    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = now + bar * barLen;
      const section = bar < 4 ? 0 : bar < 12 ? 1 : bar < 24 ? 2 : 3;
      const chordIdx = Math.floor(bar / 2) % 4;

      for (let b = 0; b < 4; b++) {
        const t = barStart + b * beat;
        const beatInSong = bar * 4 + b;

        // ── Kick ────────────────────────────────────
        // Intro: kick only on beat 1 of each bar
        // Build: kick on 1 and 3
        // Peak: four-on-the-floor
        // Outro: fade out kicks
        if (section === 0 && b === 0) this.kick(t);
        else if (section === 1 && (b === 0 || b === 2)) this.kick(t);
        else if (section === 2) this.kick(t);
        else if (section === 3 && b === 0 && bar < 28) this.kick(t);

        // ── Hi-hat ───────────────────────────────────
        // Intro: no hat
        // Build: offbeat only
        // Peak: every 8th note
        // Outro: every beat only, fading
        if (section === 1) this.hat(t + beat * 0.5);
        else if (section === 2) {
          this.hat(t);
          this.hat(t + beat * 0.5);
        } else if (section === 3 && bar < 28) {
          this.hat(t);
        }

        // ── Snare on 2 & 4 (build + peak only) ──────
        if ((section === 1 || section === 2) && (b === 1 || b === 3)) {
          const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * (i < 1000 ? 1 : 0.3);
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          const snGain = this.ctx.createGain();
          snGain.gain.setValueAtTime(0.1, t);
          snGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 1;
          src.connect(bp);
          bp.connect(snGain);
          snGain.connect(this.master);
          src.start(t);
        }

        // ── Bass ────────────────────────────────────
        if (section > 0 || bar >= 2) {
          const bassArr = bassPattern[chordIdx];
          const bassNote = bassArr[(bar * 4 + b) % bassArr.length];
          const bassVol = section === 3 ? 0.08 * (1 - (bar - 24) / 8) : 0.1;
          this.note(bassNote, t, beat * 0.8, 'sawtooth', bassVol);
        }
      }

      // ── Melody ────────────────────────────────────
      const melArr = melodySections[section];
      const melNote = melArr[bar % melArr.length];
      if (melNote > 0) {
        const melVol = section === 0 ? 0.04 : section === 3 ? 0.04 * (1 - (bar - 24) / 8) : 0.06;
        const melType = section === 2 ? 'square' : 'triangle';
        this.note(melNote, barStart + beat * 0.5, beat * (section === 2 ? 2 : 1.5), melType, melVol);
      }

      // ── Arpeggio (peak section only) ──────────────
      if (section === 2) {
        for (let a = 0; a < 4; a++) {
          const arpNote = arpNotes[(bar * 4 + a) % arpNotes.length];
          this.note(arpNote, barStart + a * beat, beat * 0.4, 'sine', 0.03);
        }
      }

      // ── Pad - sustained chord ─────────────────────
      const pad = padChords[chordIdx];
      const padVol = section === 0 ? 0.02 : section === 3 ? 0.02 * (1 - (bar - 24) / 8) : 0.03;
      for (const f of pad) {
        this.note(f, barStart, barLen, 'sine', padVol);
      }
    }

    return totalBars * barLen;
  }
}

// ── Timeline / Scene management ────────────────────────
let startTime = null;
let synth = null;
let songDuration = 0;
const DEMO_DURATION = 64; // seconds total (60 visuals + 4 credits)

function getScene(t) {
  if (t < 4) return 0;   // intro
  if (t < 50) return 1;  // main
  return 2;              // outro
}

// ── Wavy scroller (greets to demoscene groups) ────────
const SCROLL_TEXT = '   *** GREETS FROM COREDUMP FLY OUT TO ***   *** HYPNAGOGIA ***   Farbrausch // Conspiracy // RGBA // TBC // Loonies // ASD // Kewlers // MFX // Still // Mercury // Fairlight // Alcatraz // Ctrl-Alt-Test // Logicoma // Osmosys // Popsy Team // Incognito // Poo-Brain // TPOLM // Unique // Excess // Conspiracy // Ctrl-Alt-Test // Alcatraz // Still // ASD   *** COREDUMP ***   ';
const SCROLL_SPEED = 250; // pixels per second
const SCROLL_Y_FROM_BOTTOM = 60; // px from bottom
const SCROLL_AMPLITUDE = 16; // wave height
const SCROLL_FREQ = 0.03; // wave frequency per pixel

function renderScroller(t) {
  const w = creditsCanvas.width;
  const h = creditsCanvas.height;
  const fontSize = 20;
  const y = h - SCROLL_Y_FROM_BOTTOM;

  // Scroll offset based on time
  const scrollX = t * SCROLL_SPEED;

  creditsCtx.save();
  creditsCtx.font = `bold ${fontSize}px monospace`;
  creditsCtx.textBaseline = 'middle';

  // Measure total text width for seamless looping
  const fullText = SCROLL_TEXT + SCROLL_TEXT;
  const textWidth = creditsCtx.measureText(fullText).width / 2;

  // Only show scroller during main scene (scene 1: t 4-50)
  let alpha = 0;
  if (t >= 4 && t < 50) {
    alpha = 1;
    if (t < 6) alpha = (t - 4) / 2; // fade in
    if (t > 48) alpha = (50 - t) / 2; // fade out
  }
  if (alpha <= 0) { creditsCtx.restore(); return; }

  // Draw each character with sine wave offset
  const repeatWidth = textWidth;
  const offset = ((scrollX % repeatWidth) + repeatWidth) % repeatWidth;

  for (let i = 0; i < fullText.length; i++) {
    const charX = creditsCtx.measureText(fullText.substring(0, i)).width - offset;
    // Wrap: only draw visible chars
    if (charX < -fontSize || charX > w + fontSize) continue;

    const waveY = y + Math.sin((charX + t * 200) * SCROLL_FREQ) * SCROLL_AMPLITUDE;

    // Color cycling per char
    const hue = ((charX * 0.5 + t * 60) % 360 + 360) % 360;

    creditsCtx.globalAlpha = alpha;
    creditsCtx.fillStyle = `hsl(${hue}, 100%, 70%)`;
    // Add glow
    creditsCtx.shadowColor = `hsl(${hue}, 100%, 50%)`;
    creditsCtx.shadowBlur = 8;
    creditsCtx.fillText(fullText[i], charX, waveY);
  }

  creditsCtx.restore();
}

// ── Credits overlay ──────────────────────────────────────
const creditsCanvas = document.getElementById('credits');
const creditsCtx = creditsCanvas.getContext('2d');
const CREDITS_START = 50; // scene 2 starts at 50s
const CREDITS_ITEMS = [
  { time: 50, text: 'HYPNAGOGIA', size: 72 },
  { time: 53, text: 'a demo by COREDUMP', size: 22 },
  { time: 56, text: 'vision: maxthriller', size: 20 },
  { time: 59, text: 'code \u2022 graphics \u2022 music: max2d2', size: 20 },
  { time: 62, text: 'WebGL + Web Audio', size: 16 },
];

function renderCredits(t) {
  creditsCanvas.width = window.innerWidth;
  creditsCanvas.height = window.innerHeight;
  creditsCtx.clearRect(0, 0, creditsCanvas.width, creditsCanvas.height);

  if (t < CREDITS_START) return;

  for (const item of CREDITS_ITEMS) {
    const age = t - item.time;
    if (age < 0) continue;
    // Fade in over 1s, hold, then fade out over 1.5s after 2.5s
    let alpha = 1;
    if (age < 1) alpha = age;
    else if (age > 2.5) alpha = Math.max(0, 1 - (age - 2.5) / 1.5);
    if (alpha <= 0) continue;

    creditsCtx.save();
    creditsCtx.globalAlpha = alpha;
    creditsCtx.fillStyle = '#ffffff';
    creditsCtx.font = `${item.size}px monospace`;
    creditsCtx.textAlign = 'center';
    creditsCtx.textBaseline = 'middle';
    creditsCtx.fillText(item.text, creditsCanvas.width / 2, creditsCanvas.height / 2);
    creditsCtx.restore();
  }
}

// ── Start ───────────────────────────────────────────────
const overlay = document.getElementById('overlay');

function startDemo() {
  overlay.style.display = 'none';
  startTime = performance.now() / 1000;

  // Init audio
  synth = new Synth();
  songDuration = synth.scheduleSong();
}

overlay.addEventListener('click', startDemo);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Exit demo
    if (synth) synth.ctx.close();
    document.body.innerHTML = '';
  }
  if (!startTime) startDemo();
});

// ── Render loop ─────────────────────────────────────────
function render() {
  requestAnimationFrame(render);

  if (!startTime) {
    // Pre-start: dark screen
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return;
  }

  const now = performance.now() / 1000;
  const t = now - startTime;

  if (t > DEMO_DURATION) {
    // Demo ended - restart loop
    startTime = now;
    if (synth) {
      synth.ctx.close();
      synth = new Synth();
      synth.scheduleSong();
    }
    return;
  }

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(demoProgram);
  gl.uniform1f(uTime, t);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uScene, getScene(t));

  drawQuad(demoProgram);

  // Credits overlay
  renderCredits(t);
  // Wavy scroller
  renderScroller(t);
}

render();