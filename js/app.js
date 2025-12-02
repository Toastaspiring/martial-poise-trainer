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

menu.addEventListener('mousedown', (e) => e.stopPropagation());
document.querySelector('.top-bar').addEventListener('mousedown', (e) => e.stopPropagation());

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

// Enemy Stats (Dynamic)
let enemyChaseSpeed = 340;
let enemyAD = 60;
let enemyRange = 150; // Visual range units

// Game State
let width, height;
let lastTime = 0;
let currentAS = KALISTA_CONSTANTS.BASE_AS;
let bootsTier = 2;
let currentWindupTime = 0;
let currentMoveSpeed = 0;

let score = 0;
let misses = 0;
let totalDamage = 0;
let combatStartTime = 0;
let isInCombat = false;

let isTargeting = false;
let isChaseMode = false;

const STATE = {
    IDLE: 0,
    WINDUP: 1,
    DASHING: 2,
    COOLDOWN: 3,
    WALKING: 4
};

const player = {
    x: 0, y: 0,
    radius: 20,
    color: '#34d399',
    hp: KALISTA_CONSTANTS.PLAYER_MAX_HP,
    maxHp: KALISTA_CONSTANTS.PLAYER_MAX_HP,
    state: STATE.IDLE,
    stateTimer: 0,
    queuedDash: null,
    angle: 0,
    dashVx: 0, dashVy: 0,
    destX: 0, destY: 0,
    isAttackMoving: false
};

const target = {
    x: 0, y: 0,
    radius: 30,
    color: '#f87171',
    angle: 0,
    attackTimer: 0
};

const projectiles = [];
const floatingTexts = [];

// Audio
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'throw') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'dash') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(250, now + 0.15);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'hit') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(80, now);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now); osc.stop(now + 0.05);
    } else if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.start(now); osc.stop(now + 0.03);
    } else if (type === 'lose') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    } else if (type === 'hurt') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    }
}

function calculateStats() {
    currentWindupTime = KalistaModel.calculateWindup(currentAS);
    currentMoveSpeed = KalistaModel.calculateMoveSpeed(bootsTier);

    document.getElementById('asDisplay').innerText = currentAS.toFixed(3);
    document.getElementById('windupDisplay').innerText = currentWindupTime.toFixed(3) + 's';

    const ranges = KalistaModel.getDashRanges(bootsTier);
    document.getElementById('dashRangeText').innerText = `Range (Units): ${ranges.back} (Back) / ${ranges.fwd} (Fwd)`;
}

function toggleChaseMode() {
    if (isChaseMode) {
        isChaseMode = false;
        chaseSwitch.classList.remove('active');
        target.color = '#f87171';
        resetGame(false);
    } else {
        isChaseMode = true;
        chaseSwitch.classList.add('active');
        target.color = '#fb923c';
        resetGame(false);
        spawnText("SURVIVE!", player.x, player.y - 60, "#fb923c");
    }
}

function resetGame(fullReset = true) {
    player.x = width / 2 - 200;
    player.y = height / 2;
    player.hp = KALISTA_CONSTANTS.PLAYER_MAX_HP; // Reset HP

    target.x = width / 2 + 100;
    target.y = height / 2;
    target.attackTimer = 0;

    score = 0; misses = 0; totalDamage = 0;
    isInCombat = false; combatStartTime = 0;
    player.state = STATE.IDLE;
    player.destX = player.x; player.destY = player.y;
    player.isAttackMoving = false;

    document.getElementById('dps').innerText = "0";
    updateScore();

    if (fullReset && isChaseMode) {
        isChaseMode = false;
        chaseSwitch.classList.remove('active');
        target.color = '#f87171';
    }
}

// --- Event Listeners for Settings ---
document.getElementById('asSlider').addEventListener('input', (e) => {
    currentAS = parseFloat(e.target.value);
    calculateStats();
});
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
document.getElementById('bootsSelect').addEventListener('change', (e) => {
    bootsTier = parseInt(e.target.value);
    calculateStats();
});
document.getElementById('resetBtn').addEventListener('click', () => resetGame(true));

// --- INPUTS ---
window.addEventListener('keydown', (e) => {
    if (e.repeat || document.activeElement.tagName === 'INPUT') return;
    const key = e.key.toLowerCase();
    if (key === 'f6') { e.preventDefault(); toggleChaseMode(); }
    if (key === keybinds.reset.toLowerCase()) resetGame(true);
    if (key === keybinds.attackMove.toLowerCase()) {
        isTargeting = true;
        body.classList.add('targeting');
        playSound('click');
    }
    if (key === keybinds.stop.toLowerCase()) {
        if (player.state === STATE.WALKING) {
            player.state = STATE.IDLE;
            player.isAttackMoving = false;
            player.destX = player.x; player.destY = player.y;
            spawnText("Stop", player.x, player.y - 40, "#94a3b8");
        }
    }
});

window.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('.advanced-menu') || e.target.closest('.top-bar')) return;
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
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = 0; x < width; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

    if (player.state === STATE.WALKING) {
        ctx.beginPath(); ctx.arc(player.destX, player.destY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#94a3b8'; ctx.fill();
    }

    ctx.beginPath(); ctx.arc(player.x, player.y, KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS, 0, Math.PI * 2);
    if (isTargeting) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)'; ctx.lineWidth = 4; ctx.setLineDash([10, 5]);
    } else {
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.1)'; ctx.lineWidth = 2; ctx.setLineDash([]);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // Enemy
    ctx.beginPath(); ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fillStyle = target.color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    // Enemy Range Indicator (only in chase)
    if (isChaseMode) {
        ctx.beginPath(); ctx.arc(target.x, target.y, enemyRange * SCALE_RATIO, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.3)'; ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.fillStyle = '#34d399';
    for (const p of projectiles) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Player
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = player.color; ctx.fill();

    // Health Bar
    const barWidth = 60;
    const barHeight = 6;
    const hpPct = Math.max(0, player.hp / player.maxHp);
    ctx.fillStyle = '#334155';
    ctx.fillRect(player.x - barWidth / 2, player.y - 35, barWidth, barHeight);
    ctx.fillStyle = '#22c55e'; // Green
    ctx.fillRect(player.x - barWidth / 2, player.y - 35, barWidth * hpPct, barHeight);

    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + Math.cos(player.angle) * 30, player.y + Math.sin(player.angle) * 30);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();

    if (player.state === STATE.WINDUP) {
        const pct = 1 - (player.stateTimer / currentWindupTime);
        if (player.queuedDash) {
            ctx.strokeStyle = player.queuedDash.isForward ? '#fbbf24' : '#38bdf8';
        } else {
            ctx.strokeStyle = '#fff';
        }
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius + 8, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * pct));
        ctx.stroke();
        if (player.queuedDash) {
            ctx.beginPath(); ctx.moveTo(player.x, player.y);
            ctx.lineTo(player.queuedDash.x, player.queuedDash.y);
            ctx.strokeStyle = player.queuedDash.isForward ? 'rgba(251, 191, 36, 0.5)' : 'rgba(56, 189, 248, 0.5)';
            ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
        }
    }

    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    for (const t of floatingTexts) {
        ctx.globalAlpha = t.life;
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.globalAlpha = 1.0;
    }
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    resetGame(); calculateStats();
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
