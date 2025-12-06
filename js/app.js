import { KALISTA_CONSTANTS, SCALE_RATIO, DASH_RANGES_BACK, DASH_RANGES_FWD, KalistaModel } from './kalista-model.js';

// --- KEYBIND STATE ---
const keybinds = {
    attackMove: 'q',
    stop: 's',
    reset: 'r',
    chase: 'f6',
    moveBtn: 2, // 2 = RMB, 0 = LMB
    confirmBtn: 0
};

// --- UI Logic & Binders ---
const menuBtn = document.getElementById('toggleMenuBtn');
const chaseSwitch = document.getElementById('chaseToggleSwitch');
const chaseContainer = document.getElementById('chaseToggleContainer');
const menu = document.getElementById('advancedMenu');

const lmbAmSwitch = document.getElementById('lmbAmSwitch');
const lmbAmContainer = document.getElementById('lmbAmToggleContainer');
let useLeftClickAttackMove = false;

// Badges
const badgeAmKey = document.getElementById('badgeAmKey');
const badgeStopKey = document.getElementById('badgeStopKey');
const badgeResetKey = document.getElementById('badgeResetKey');
const badgeMoveBtn = document.getElementById('badgeMoveBtn');

function updateBindUI() {
    badgeAmKey.innerText = keybinds.attackMove.toUpperCase();
    badgeStopKey.innerText = keybinds.stop.toUpperCase();
    badgeResetKey.innerText = keybinds.reset.toUpperCase();
    const mouseText = keybinds.moveBtn === 2 ? 'RMB' : 'LMB';
    badgeMoveBtn.innerText = mouseText;
}

function listenForKey(element, bindKey) {
    if (element.classList.contains('listening')) return;
    const originalText = element.innerText;
    element.innerText = '?';
    element.classList.add('listening');
    const handler = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { cleanup(); element.innerText = originalText; return; }
        keybinds[bindKey] = e.key.toLowerCase();
        cleanup(); updateBindUI();
    };
    const cleanup = () => {
        window.removeEventListener('keydown', handler, true);
        element.classList.remove('listening');
    };
    window.addEventListener('keydown', handler, true);
}

badgeAmKey.addEventListener('click', () => listenForKey(badgeAmKey, 'attackMove'));
badgeStopKey.addEventListener('click', () => listenForKey(badgeStopKey, 'stop'));
badgeResetKey.addEventListener('click', () => listenForKey(badgeResetKey, 'reset'));
badgeMoveBtn.addEventListener('click', () => {
    keybinds.moveBtn = keybinds.moveBtn === 2 ? 0 : 2;
    updateBindUI();
});

menuBtn.addEventListener('click', (e) => {
    menu.classList.toggle('open');
    e.stopPropagation();
});

chaseContainer.addEventListener('click', (e) => {
    toggleChaseMode();
    e.stopPropagation();
});

lmbAmContainer.addEventListener('click', (e) => {
    useLeftClickAttackMove = !useLeftClickAttackMove;
    if (useLeftClickAttackMove) {
        lmbAmSwitch.classList.add('active');
    } else {
        lmbAmSwitch.classList.remove('active');
    }
    e.stopPropagation();
});

menu.addEventListener('mousedown', (e) => e.stopPropagation());
// Removed .top-bar listener as it caused a crash and is no longer needed with pointer-events-none container

// --- MODAL LOGIC ---
const onboardingModal = document.getElementById('onboardingModal');
const startBtn = document.getElementById('startTrainingBtn');

startBtn.addEventListener('click', () => {
    onboardingModal.classList.add('hidden');
    // Optional: Start audio context if needed on user interaction
    if (audioCtx.state === 'suspended') audioCtx.resume();
});

// --- GAME LOGIC ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const body = document.body;

// --- GLOBAL STATE ---
let width = window.innerWidth;
let height = window.innerHeight;
let lastTime = 0;

// Game State
let score = 0;
let misses = 0;
let totalDamage = 0;
let isInCombat = false;
let combatStartTime = 0;
let isTargeting = false;

// Config
let isChaseMode = false;
let enemyChaseSpeed = 340;
let enemyRange = 150;
let enemyAD = 60;

// Player Stats (Calculated)
let currentWindupTime = 0;
let currentMoveSpeed = 0;
let currentAS = 0;
let bootsTier = 2;

// Entities
const player = {
    x: 0, y: 0,
    destX: 0, destY: 0,
    angle: 0,
    state: 'IDLE', // IDLE, WALKING, WINDUP, DASHING, COOLDOWN
    stateTimer: 0,
    isAttackMoving: false,
    queuedDash: null, // {x, y, isForward}
    radius: 25,
    hp: 1000,
    maxHp: 1000,
    dashVx: 0, dashVy: 0
};

const target = {
    x: 0, y: 0,
    radius: 35,
    attackTimer: 0
};

const projectiles = [];
const floatingTexts = [];

const STATE = {
    IDLE: 'IDLE',
    WALKING: 'WALKING',
    WINDUP: 'WINDUP',
    DASHING: 'DASHING',
    COOLDOWN: 'COOLDOWN'
};

// --- AUDIO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};

function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'throw') {
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'dash') {
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(300, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'hit') {
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'hurt') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'lose') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(100, now + 1.0);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 1.0);
        osc.start(now);
        osc.stop(now + 1.0);
    }
}

// --- HELPER FUNCTIONS ---
function calculateStats() {
    const asSlider = document.getElementById('asSlider');
    const bootsSelect = document.getElementById('bootsSelect');

    const baseAS = 0.694;
    const userAS = parseFloat(asSlider ? asSlider.value : 0.694);
    currentAS = userAS;

    // Kalista Windup Formula (approx): 0.25 * (1 / AS) ?? 
    // Actually it's usually a percentage of the attack frame.
    // Let's use a simplified model: Windup = 0.36 / AS (roughly)
    currentWindupTime = KalistaModel.getWindupTime(currentAS);

    bootsTier = parseInt(bootsSelect ? bootsSelect.value : 2);
    currentMoveSpeed = 325 + (bootsTier * 25); // Base + Tier bonus

    // Update UI
    const windupDisplay = document.getElementById('windupDisplay');
    if (windupDisplay) windupDisplay.innerText = `${currentWindupTime.toFixed(3)}s Windup`;

    const asDisplay = document.getElementById('asDisplay');
    if (asDisplay) asDisplay.innerText = currentAS.toFixed(3);

    const dashRangeText = document.getElementById('dashRangeText');
    if (dashRangeText) {
        dashRangeText.innerText = `Range: ${DASH_RANGES_BACK[bootsTier]} (Back) / ${DASH_RANGES_FWD[bootsTier]} (Fwd)`;
    }
}

function resetGame(fullReset = false) {
    if (fullReset) {
        score = 0;
        misses = 0;
        totalDamage = 0;
        isInCombat = false;
        player.hp = player.maxHp;
        updateScore();
    }

    // Center Player
    player.x = width * 0.3;
    player.y = height * 0.5;
    player.destX = player.x;
    player.destY = player.y;
    player.state = STATE.IDLE;
    player.isAttackMoving = false;
    player.queuedDash = null;

    // Position Target
    target.x = width * 0.7;
    target.y = height * 0.5;
    target.attackTimer = 1.0;

    projectiles.length = 0;
    floatingTexts.length = 0;
}

function toggleChaseMode() {
    isChaseMode = !isChaseMode;
    const knob = document.getElementById('chaseToggleKnob');
    const sw = document.getElementById('chaseToggleSwitch');

    if (isChaseMode) {
        sw.classList.add('bg-emerald-500/50');
        sw.classList.remove('bg-slate-700/50');
        knob.classList.add('translate-x-5');
        knob.classList.add('bg-white');
        knob.classList.remove('bg-slate-400');
        spawnText("Chase Mode ON", player.x, player.y - 60, "#ef4444");
    } else {
        sw.classList.remove('bg-emerald-500/50');
        sw.classList.add('bg-slate-700/50');
        knob.classList.remove('translate-x-5');
        knob.classList.remove('bg-white');
        knob.classList.add('bg-slate-400');
        spawnText("Chase Mode OFF", player.x, player.y - 60, "#94a3b8");
        // Reset target pos
        target.x = width * 0.7;
        target.y = height * 0.5;
    }
}

// --- INPUT LISTENERS ---
// Stats Config
document.getElementById('asSlider').addEventListener('input', calculateStats);
document.getElementById('bootsSelect').addEventListener('change', calculateStats);

// Enemy Config
document.getElementById('chaseSpeedSlider').addEventListener('input', (e) => {
    enemyChaseSpeed = parseInt(e.target.value);
    document.getElementById('chaseSpeedDisplay').innerText = enemyChaseSpeed;
});
document.getElementById('enemyAdSlider').addEventListener('input', (e) => {
    enemyAD = parseInt(e.target.value);
    document.getElementById('enemyAdDisplay').innerText = enemyAD;
});
document.getElementById('enemyRangeSlider').addEventListener('input', (e) => {
    enemyRange = parseInt(e.target.value);
    document.getElementById('enemyRangeDisplay').innerText = enemyRange;
});

document.getElementById('resetBtn').addEventListener('click', () => resetGame(true));

window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === keybinds.chase) toggleChaseMode();
    if (e.key.toLowerCase() === keybinds.reset) resetGame(true);
    if (e.key.toLowerCase() === keybinds.stop) {
        player.destX = player.x; player.destY = player.y;
        player.state = STATE.IDLE;
        player.isAttackMoving = false;
        spawnText("Stop", player.x, player.y - 40, "#94a3b8");
    }
    if (e.key.toLowerCase() === keybinds.attackMove) {
        // Attack Move Key (A-click style)
        isTargeting = true;
        body.classList.add('targeting');
    }
});

window.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('.advanced-menu') || e.target.closest('.glass-widget')) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const btn = e.button;
    const distToTarget = Math.hypot(mx - target.x, my - target.y);
    const isTargetHover = distToTarget <= target.radius + 15;

    if (isTargeting) {
        if (btn === keybinds.confirmBtn) {
            startAttack(true);
            isTargeting = false; body.classList.remove('targeting');
        } else if (btn === keybinds.moveBtn) {
            isTargeting = false; body.classList.remove('targeting');
        }
        return;
    }

    if (useLeftClickAttackMove && btn === 0) {
        if (player.state === STATE.IDLE || player.state === STATE.COOLDOWN || player.state === STATE.WALKING) {
            if (isTargetHover) {
                startAttack(false);
            } else {
                moveTo(mx, my);
                player.isAttackMoving = true;
                spawnText("Attack Move", player.x, player.y - 40, "#94a3b8");
            }
        } else if (player.state === STATE.WINDUP) {
            if (!isTargetHover) queueDash(mx, my);
        }
        return;
    }

    if (btn === keybinds.moveBtn) {
        if (player.state === STATE.IDLE || player.state === STATE.COOLDOWN || player.state === STATE.WALKING) {
            if (isTargetHover) startAttack(false);
            else moveTo(mx, my);
        } else if (player.state === STATE.WINDUP) {
            if (!isTargetHover) queueDash(mx, my);
        }
    }
});

function moveTo(mx, my) {
    player.destX = mx; player.destY = my;
    player.state = STATE.WALKING;
    player.angle = Math.atan2(my - player.y, mx - player.x);
    player.isAttackMoving = false;
}

function startAttack(isAttackMove = false) {
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS + 20) {
        moveTo(target.x, target.y);
        player.isAttackMoving = true;
        spawnText("Approaching...", player.x, player.y - 40, "#94a3b8");
        return;
    }
    if (!isInCombat) { isInCombat = true; combatStartTime = performance.now() / 1000; }
    player.state = STATE.WINDUP;
    player.stateTimer = currentWindupTime;
    player.queuedDash = null;
    player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    player.isAttackMoving = false;
}

function queueDash(mx, my) {
    const toTargetX = target.x - player.x;
    const toTargetY = target.y - player.y;
    const toClickX = mx - player.x;
    const toClickY = my - player.y;
    const lenT = Math.hypot(toTargetX, toTargetY);
    const lenC = Math.hypot(toClickX, toClickY);
    const dot = (toTargetX / lenT) * (toClickX / lenC) + (toTargetY / lenT) * (toClickY / lenC);
    const isForward = dot > 0.3;
    player.queuedDash = { x: mx, y: my, isForward: isForward };
    const color = isForward ? "#fbbf24" : "#38bdf8";
    spawnText(isForward ? "Short" : "Long", player.x, player.y - 45, color);
}

function recordDamage() {
    const dmg = KalistaModel.calculateDamage();
    totalDamage += dmg;
    updateScore();
    return dmg;
}

function updateScore() {
    document.getElementById('score').innerText = score;
    document.getElementById('misses').innerText = misses;
    document.getElementById('totalDamage').innerText = Math.floor(totalDamage);
    if (isInCombat && totalDamage > 0) {
        const now = performance.now() / 1000;
        let duration = now - combatStartTime;
        if (duration < 1) duration = 1;
        const dps = totalDamage / duration;
        document.getElementById('dps').innerText = dps.toFixed(0);
    }
}

function spawnText(text, x, y, color) {
    floatingTexts.push({
        text: text, x: x, y: y, color: color, life: 0.8, vy: -30
    });
}

// --- ENEMY ATTACK LOGIC ---
function dealDamageToPlayer() {
    const dmgTaken = KalistaModel.calculateDamageTaken(enemyAD);

    player.hp -= dmgTaken;
    playSound('hurt');
    spawnText(`-${Math.floor(dmgTaken)}`, player.x, player.y - 30, "#ef4444");

    if (player.hp <= 0) {
        playSound('lose');
        spawnText("DIED!", player.x, player.y - 60, "#ef4444");
        resetGame(true);
    }
}

function update(dt) {
    if (target.x === 0) { target.x = width / 2 + 100; target.y = height / 2; }

    // --- CHASE & ATTACK LOGIC ---
    if (isChaseMode) {
        const distToPlayer = Math.hypot(player.x - target.x, player.y - target.y);
        const enemyAttackRangePixels = enemyRange * SCALE_RATIO;
        // Range includes radii
        const effectiveRange = enemyAttackRangePixels + player.radius + target.radius;

        if (distToPlayer > effectiveRange) {
            // Chase
            const angleToPlayer = Math.atan2(player.y - target.y, player.x - target.x);
            target.x += Math.cos(angleToPlayer) * (enemyChaseSpeed * SCALE_RATIO) * dt;
            target.y += Math.sin(angleToPlayer) * (enemyChaseSpeed * SCALE_RATIO) * dt;
        } else {
            // Attack
            target.attackTimer -= dt;
            if (target.attackTimer <= 0) {
                dealDamageToPlayer();
                target.attackTimer = 1.0; // Fixed 1.0s Attack Speed for enemy
            }
        }
    }

    // --- PLAYER LOGIC ---
    if (player.state === STATE.WALKING) {
        if (player.isAttackMoving) {
            const distToTarget = Math.hypot(target.x - player.x, target.y - player.y);
            if (distToTarget <= KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS) {
                startAttack(false);
                return;
            }
        }
        const dx = player.destX - player.x;
        const dy = player.destY - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) {
            player.state = STATE.IDLE;
            player.isAttackMoving = false;
        } else {
            const moveStep = currentMoveSpeed * dt;
            if (dist <= moveStep) {
                player.x = player.destX; player.y = player.destY;
                player.state = STATE.IDLE; player.isAttackMoving = false;
            } else {
                const angle = Math.atan2(dy, dx);
                player.x += Math.cos(angle) * moveStep;
                player.y += Math.sin(angle) * moveStep;
                player.angle = angle;
            }
        }
    }
    else if (player.state === STATE.WINDUP) {
        player.stateTimer -= dt;
        player.angle = Math.atan2(target.y - player.y, target.x - player.x);
        if (player.stateTimer <= 0) {
            playSound('throw');
            projectiles.push({ x: player.x, y: player.y, speed: 1400, life: 2.0 });
            if (player.queuedDash) {
                player.state = STATE.DASHING;
                const dashDuration = 0.25;
                player.stateTimer = dashDuration;
                const dist = player.queuedDash.isForward ? DASH_RANGES_FWD[bootsTier] : DASH_RANGES_BACK[bootsTier];
                const dashAngle = Math.atan2(player.queuedDash.y - player.y, player.queuedDash.x - player.x);
                player.dashVx = Math.cos(dashAngle) * (dist / dashDuration);
                player.dashVy = Math.sin(dashAngle) * (dist / dashDuration);
                score++; playSound('dash');
            } else {
                player.state = STATE.COOLDOWN;
                const totalTime = 1.0 / currentAS;
                player.stateTimer = totalTime - currentWindupTime;
                misses++; spawnText("No Hop", player.x, player.y - 40, "#f87171");
            }
        }
    } else if (player.state === STATE.DASHING) {
        player.stateTimer -= dt;
        player.x += player.dashVx * dt;
        player.y += player.dashVy * dt;
        if (player.x < 25) player.x = 25; if (player.x > width - 25) player.x = width - 25;
        if (player.y < 25) player.y = 25; if (player.y > height - 25) player.y = height - 25;
        if (player.stateTimer <= 0) player.state = STATE.IDLE;
    } else if (player.state === STATE.COOLDOWN) {
        player.stateTimer -= dt;
        if (player.stateTimer <= 0) player.state = STATE.IDLE;
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const angle = Math.atan2(target.y - p.y, target.x - p.x);
        p.x += Math.cos(angle) * p.speed * dt;
        p.y += Math.sin(angle) * p.speed * dt;
        p.life -= dt;
        if (Math.hypot(p.x - target.x, p.y - target.y) < target.radius) {
            playSound('hit');
            projectiles.splice(i, 1);
            const dmg = recordDamage();
            spawnText(Math.floor(dmg), target.x, target.y - 30, "#fbbf24"); // Orange Dmg
            continue;
        }
        if (p.life <= 0) projectiles.splice(i, 1);
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const t = floatingTexts[i];
        t.y += t.vy * dt;
        t.life -= dt;
        if (t.life <= 0) floatingTexts.splice(i, 1);
    }
    if (isInCombat && totalDamage > 0) updateScore();
}

function draw() {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // --- Background ---
    ctx.save();
    // Radial Gradient for depth
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width);
    gradient.addColorStop(0, '#1e293b'); // Slate-800
    gradient.addColorStop(1, '#0f172a'); // Slate-900
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Subtle Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 60;
    for (let x = 0; x < width; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.restore();

    // --- Player (Spectral Spirit) ---
    ctx.save();
    // Glow Effect
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(52, 211, 153, 0.4)'; // Emerald Glow

    // Movement Target Indicator
    if (player.state === STATE.WALKING) {
        ctx.beginPath(); ctx.arc(player.destX, player.destY, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52, 211, 153, 0.5)'; ctx.fill();
    }

    // Attack Range Indicator
    ctx.shadowBlur = 0; // Reset for range circle
    ctx.beginPath(); ctx.arc(player.x, player.y, KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS, 0, Math.PI * 2);
    if (isTargeting) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    } else {
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.08)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // Player Body
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(52, 211, 153, 0.6)';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981'; // Emerald-500
    ctx.fill();

    // Inner Core
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#6ee7b7'; // Emerald-300
    ctx.fill();

    // Direction Indicator
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + Math.cos(player.angle) * (player.radius + 10), player.y + Math.sin(player.angle) * (player.radius + 10));
    ctx.strokeStyle = '#d1fae5'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    // --- Enemy (Void/Spiked) ---
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = isChaseMode ? 'rgba(248, 113, 113, 0.5)' : 'rgba(248, 113, 113, 0.2)';

    // Spikes / Shape
    const spikes = 8;
    const outerRadius = target.radius;
    const innerRadius = target.radius * 0.7;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
        const r = (i % 2 === 0) ? outerRadius : innerRadius;
        const a = (Math.PI * i / spikes) + (performance.now() / 1000); // Rotate slowly
        const tx = target.x + Math.cos(a) * r;
        const ty = target.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
    }
    ctx.closePath();
    ctx.fillStyle = isChaseMode ? '#ef4444' : '#991b1b'; // Red-500 vs Red-800
    ctx.fill();

    // Enemy Core
    ctx.beginPath(); ctx.arc(target.x, target.y, innerRadius * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fca5a5'; // Red-300
    ctx.fill();

    // Enemy Range (Chase Mode)
    if (isChaseMode) {
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(target.x, target.y, enemyRange * SCALE_RATIO, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();

    // --- Projectiles (Spears) ---
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#34d399';
    for (const p of projectiles) {
        ctx.beginPath();
        const tailLen = 15;
        const pAngle = Math.atan2(target.y - p.y, target.x - p.x);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(pAngle) * tailLen, p.y - Math.sin(pAngle) * tailLen);
        ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 3; ctx.stroke();

        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#d1fae5'; ctx.fill();
    }
    ctx.restore();

    // --- UI Elements (Health Bar, Windup) ---
    ctx.save();
    ctx.shadowBlur = 0;

    // Player Health Bar
    const barWidth = 50;
    const barHeight = 4;
    const hpPct = Math.max(0, player.hp / player.maxHp);
    const barX = player.x - barWidth / 2;
    const barY = player.y - 32;

    // Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    // Fill
    ctx.fillStyle = '#10b981';
    ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);

    // Windup Indicator (Arc)
    if (player.state === STATE.WINDUP) {
        const pct = 1 - (player.stateTimer / currentWindupTime);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (Math.PI * 2 * pct);

        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius + 6, startAngle, endAngle);
        ctx.strokeStyle = player.queuedDash ? (player.queuedDash.isForward ? '#fbbf24' : '#38bdf8') : '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Dash Line
        if (player.queuedDash) {
            ctx.beginPath(); ctx.moveTo(player.x, player.y);
            ctx.lineTo(player.queuedDash.x, player.queuedDash.y);
            ctx.strokeStyle = player.queuedDash.isForward ? 'rgba(251, 191, 36, 0.4)' : 'rgba(56, 189, 248, 0.4)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        }
    }
    ctx.restore();

    // --- Floating Text ---
    ctx.save();
    ctx.font = "bold 14px 'Inter', sans-serif";
    ctx.textAlign = "center";
    for (const t of floatingTexts) {
        ctx.globalAlpha = t.life;
        ctx.fillStyle = t.color;
        // Add shadow for readability
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
}

function resize() {
    // Resize based on the container, not the window
    const container = canvas.parentElement;
    width = container.clientWidth;
    height = container.clientHeight;

    console.log(`[Resize] Container: ${width}x${height}`);

    // Update canvas internal resolution to match display size
    canvas.width = width;
    canvas.height = height;

    resetGame(); calculateStats();

    console.log(`[Reset] Player: (${player.x}, ${player.y}), Target: (${target.x}, ${target.y})`);
}
window.addEventListener('resize', resize);
resize();

function loop(timestamp) {
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
