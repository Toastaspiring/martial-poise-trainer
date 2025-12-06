import { KALISTA_CONSTANTS, SCALE_RATIO, DASH_RANGES_BACK, DASH_RANGES_FWD, KalistaModel } from './kalista-model.js';

// --- KEYBIND STATE ---
const keybinds = {
    attackMove: 'q', // Will need to rebind this since Q is now a spell
    pierce: 'a',     // Default Q spell bound to A as per request? Wait, user said "Pierce ( bound to A by default )"
    rend: 'e',
    stop: 's',
    reset: 'r',
    chase: 'f6',
    moveBtn: 2, // 2 = RMB, 0 = LMB
    confirmBtn: 0
};

// User requested: "1st Spell - Pierce ( bound to A by default )"
// But usually A is Attack Move.
// Let's respect the user request: Pierce = A.
// Attack Move was Q in the previous lesson.
// We should probably keep Attack Move on Q for now unless it conflicts.
// Wait, user said "Pierce ( bound to A by default )".
// And "Rend ( bound to E by default )".
// Existing Attack Move was 'q'.
// If Pierce is 'a', then 'q' is free for Attack Move?
// Or maybe they want standard LoL controls where A is Attack Move and Q is Pierce?
// "1st Spell - Pierce ( bound to A by default )" -> This is unusual for LoL (usually Q).
// But I will follow instructions.
// Pierce -> A
// Rend -> E
// Attack Move -> Q (Existing)

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
    if (badgeAmKey) badgeAmKey.innerText = keybinds.attackMove.toUpperCase();
    if (badgeStopKey) badgeStopKey.innerText = keybinds.stop.toUpperCase();
    if (badgeResetKey) badgeResetKey.innerText = keybinds.reset.toUpperCase();
    const mouseText = keybinds.moveBtn === 2 ? 'RMB' : 'LMB';
    if (badgeMoveBtn) badgeMoveBtn.innerText = mouseText;
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

if (badgeAmKey) badgeAmKey.addEventListener('click', () => listenForKey(badgeAmKey, 'attackMove'));
if (badgeStopKey) badgeStopKey.addEventListener('click', () => listenForKey(badgeStopKey, 'stop'));
if (badgeResetKey) badgeResetKey.addEventListener('click', () => listenForKey(badgeResetKey, 'reset'));
if (badgeMoveBtn) badgeMoveBtn.addEventListener('click', () => {
    keybinds.moveBtn = keybinds.moveBtn === 2 ? 0 : 2;
    updateBindUI();
});

if (menuBtn) menuBtn.addEventListener('click', (e) => {
    menu.classList.toggle('open');
    e.stopPropagation();
});

if (chaseContainer) chaseContainer.addEventListener('click', (e) => {
    toggleChaseMode();
    e.stopPropagation();
});

if (lmbAmContainer) lmbAmContainer.addEventListener('click', (e) => {
    useLeftClickAttackMove = !useLeftClickAttackMove;
    if (useLeftClickAttackMove) {
        lmbAmSwitch.classList.add('active');
    } else {
        lmbAmSwitch.classList.remove('active');
    }
    e.stopPropagation();
});

if (menu) menu.addEventListener('mousedown', (e) => e.stopPropagation());

// --- MODAL LOGIC ---
const onboardingModal = document.getElementById('onboardingModal');
const startBtn = document.getElementById('startTrainingBtn');

if (startBtn) startBtn.addEventListener('click', () => {
    onboardingModal.classList.add('hidden');
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

// Input State
let mouseX = 0;
let mouseY = 0;

// Spells State
let qCooldownTimer = 0;
let eCooldownTimer = 0;
let qLevel = 1; // Default level 1
let eLevel = 1; // Default level 1

// Entities
const player = {
    x: 0, y: 0,
    destX: 0, destY: 0,
    angle: 0,
    state: 'IDLE', // IDLE, WALKING, WINDUP, DASHING, COOLDOWN, CASTING_Q, CASTING_E
    stateTimer: 0,
    isAttackMoving: false,
    queuedDash: null, // {x, y, isForward}
    radius: 25,
    hp: 1000,
    maxHp: 1000,
    dashVx: 0, dashVy: 0,
    mana: 300, maxMana: 300,
    attackTarget: null // The unit we are currently attacking
};

const target = {
    x: 0, y: 0,
    radius: 35,
    attackTimer: 0,
    rendStacks: 0,
    rendTimer: 0,
    hp: 10000, maxHp: 10000, // Dummy HP
    type: 'CHAMPION'
};

const minions = [];

class Minion {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'MELEE' or 'CASTER'
        this.radius = 18;
        this.rendStacks = 0;
        this.rendTimer = 0;

        if (type === 'MELEE') {
            this.hp = 465; // Fixed base
            this.maxHp = 465;
            this.color = '#ef4444'; // Red
        } else {
            this.hp = 284; // Fixed base
            this.maxHp = 284;
            this.color = '#f87171'; // Lighter Red
        }
    }
}

const projectiles = []; // Basic attacks
const qProjectiles = []; // Pierce spears
const floatingTexts = [];

const STATE = {
    IDLE: 'IDLE',
    WALKING: 'WALKING',
    WINDUP: 'WINDUP',
    DASHING: 'DASHING',
    COOLDOWN: 'COOLDOWN',
    CASTING_Q: 'CASTING_Q',
    CASTING_E: 'CASTING_E'
};

// --- AUDIO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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
    } else if (type === 'pierce') {
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'rend') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.linearRampToValueAtTime(400, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
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

    const userAS = parseFloat(asSlider ? asSlider.value : 0.694);
    currentAS = userAS;

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
    target.rendStacks = 0;

    projectiles.length = 0;
    qProjectiles.length = 0;
    floatingTexts.length = 0;
    qCooldownTimer = 0;
    eCooldownTimer = 0;

    spawnMinions();
}

function spawnMinions() {
    minions.length = 0;
    // Spawn in front of target (which is at width*0.7, height*0.5)
    // 2 rows of 3
    // Row 1: Melee (Closer to player)
    // Row 2: Caster (Behind Melee)

    const startX = target.x - 200;
    const spacingY = 60;

    // Melee Row
    for (let i = 0; i < 3; i++) {
        const y = target.y - spacingY + (i * spacingY);
        minions.push(new Minion(startX, y, 'MELEE'));
    }

    // Caster Row
    for (let i = 0; i < 3; i++) {
        const y = target.y - spacingY + (i * spacingY) + 80; // Behind melee? Or further back?
        // Usually Casters are behind Melees relative to the enemy base.
        // If Player is Left, Enemy is Right.
        // Melees should be closer to Player (Left), Casters further Right.
        // So Casters should be at startX + offset?
        // Wait, "place infrom of him, minions ... 1 row are melee ... and second row are caster"
        // "In front of him" usually means between him and the player.
        // So Melees are closest to player, Casters are behind Melees, Champion is behind Casters.

        // Let's adjust X
        // Melees at startX
        // Casters at startX + 80
        minions.push(new Minion(startX + 80, y, 'CASTER'));
    }
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
const asSlider = document.getElementById('asSlider');
if (asSlider) asSlider.addEventListener('input', calculateStats);
const bootsSelect = document.getElementById('bootsSelect');
if (bootsSelect) bootsSelect.addEventListener('change', calculateStats);

const chaseSpeedSlider = document.getElementById('chaseSpeedSlider');
if (chaseSpeedSlider) chaseSpeedSlider.addEventListener('input', (e) => {
    enemyChaseSpeed = parseInt(e.target.value);
    document.getElementById('chaseSpeedDisplay').innerText = enemyChaseSpeed;
});
const enemyAdSlider = document.getElementById('enemyAdSlider');
if (enemyAdSlider) enemyAdSlider.addEventListener('input', (e) => {
    enemyAD = parseInt(e.target.value);
    document.getElementById('enemyAdDisplay').innerText = enemyAD;
});
const enemyRangeSlider = document.getElementById('enemyRangeSlider');
if (enemyRangeSlider) enemyRangeSlider.addEventListener('input', (e) => {
    enemyRange = parseInt(e.target.value);
    document.getElementById('enemyRangeDisplay').innerText = enemyRange;
});

const resetBtn = document.getElementById('resetBtn');
if (resetBtn) resetBtn.addEventListener('click', () => resetGame(true));

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === keybinds.chase) toggleChaseMode();
    if (key === keybinds.reset) resetGame(true);
    if (key === keybinds.stop) {
        player.destX = player.x; player.destY = player.y;
        player.state = STATE.IDLE;
        player.isAttackMoving = false;
        spawnText("Stop", player.x, player.y - 40, "#94a3b8");
    }
    if (key === keybinds.attackMove) {
        isTargeting = true;
        body.classList.add('targeting');
    }
    // Spell Casts
    if (key === keybinds.pierce) {
        castPierce();
    }
    if (key === keybinds.rend) {
        castRend();
    }
});

window.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('.advanced-menu') || e.target.closest('.glass-widget')) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const btn = e.button;
    const hoveredUnit = getHoveredUnit(mx, my);

    if (isTargeting) {
        if (btn === keybinds.confirmBtn) {
            // Attack Move Click
            if (hoveredUnit) startAttack(hoveredUnit);
            else {
                moveTo(mx, my);
                player.isAttackMoving = true;
                spawnText("Attack Move", player.x, player.y - 40, "#94a3b8");
            }
            isTargeting = false; body.classList.remove('targeting');
        } else if (btn === keybinds.moveBtn) {
            isTargeting = false; body.classList.remove('targeting');
        }
        return;
    }

    if (useLeftClickAttackMove && btn === 0) {
        if (player.state === STATE.IDLE || player.state === STATE.COOLDOWN || player.state === STATE.WALKING) {
            if (hoveredUnit) {
                startAttack(hoveredUnit);
            } else {
                moveTo(mx, my);
                player.isAttackMoving = true;
                spawnText("Attack Move", player.x, player.y - 40, "#94a3b8");
            }
        } else if (player.state === STATE.WINDUP || player.state === STATE.CASTING_Q) {
            if (!hoveredUnit) queueDash(mx, my);
        }
        return;
    }

    if (btn === keybinds.moveBtn) {
        if (player.state === STATE.IDLE || player.state === STATE.COOLDOWN || player.state === STATE.WALKING) {
            if (hoveredUnit) startAttack(hoveredUnit);
            else moveTo(mx, my);
        } else if (player.state === STATE.WINDUP || player.state === STATE.CASTING_Q) {
            if (!hoveredUnit) queueDash(mx, my);
        }
    }
});

function getHoveredUnit(mx, my) {
    if (Math.hypot(mx - target.x, my - target.y) <= target.radius + 15) return target;
    for (const m of minions) {
        if (Math.hypot(mx - m.x, my - m.y) <= m.radius + 10) return m;
    }
    return null;
}

function moveTo(mx, my) {
    player.destX = mx; player.destY = my;
    player.state = STATE.WALKING;
    player.angle = Math.atan2(my - player.y, mx - player.x);
    player.isAttackMoving = false;
}

function startAttack(unit) {
    if (!unit) return; // Should not happen if called correctly

    // Check range
    const dist = Math.hypot(unit.x - player.x, unit.y - player.y);
    if (dist > KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS + 20) {
        moveTo(unit.x, unit.y);
        player.isAttackMoving = true; // We are moving to attack
        // We need to know WHO we are moving to attack?
        // Actually, standard Attack Move Logic in this simple trainer just moves to position.
        // But if we clicked a unit, we should chase it until in range.
        // For simplicity, let's just move to the unit's current pos.
        spawnText("Approaching...", player.x, player.y - 40, "#94a3b8");
        return;
    }

    if (!isInCombat) { isInCombat = true; combatStartTime = performance.now() / 1000; }
    player.state = STATE.WINDUP;
    player.stateTimer = currentWindupTime;
    player.queuedDash = null;
    player.attackTarget = unit;
    player.angle = Math.atan2(unit.y - player.y, unit.x - player.x);
    player.isAttackMoving = false;
}

function castPierce() {
    if (qCooldownTimer > 0) {
        spawnText("Q Cooldown", player.x, player.y - 40, "#94a3b8");
        return;
    }
    // Q Cast
    player.state = STATE.CASTING_Q;
    player.stateTimer = KalistaModel.getQCastTime(currentAS);
    // Aim at mouse cursor (Skillshot)
    player.angle = Math.atan2(mouseY - player.y, mouseX - player.x);
    spawnText("Pierce!", player.x, player.y - 50, "#fbbf24");
}

function checkRendKill(unit, damage) {
    // Helper to check if E would kill
    // Not strictly needed for logic but good for UI?
    return false;
}

function castRend() {
    if (eCooldownTimer > 0) {
        spawnText("E Cooldown", player.x, player.y - 40, "#94a3b8");
        return;
    }
    if (target.rendStacks === 0) {
        spawnText("No Stacks", player.x, player.y - 40, "#94a3b8");
        return;
    }

    // Check range
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > KALISTA_CONSTANTS.E_RANGE * SCALE_RATIO) {
        spawnText("Out of Range", player.x, player.y - 40, "#ef4444");
        return;
    }

    // Execute Rend
    playSound('rend');
    eCooldownTimer = KALISTA_CONSTANTS.E_CD[eLevel - 1]; // Level 1 CD

    let hitCount = 0;

    // Helper to apply rend
    const applyRendToUnit = (unit) => {
        if (unit.rendStacks > 0) {
            const baseDmg = KALISTA_CONSTANTS.E_DAMAGE_BASE[eLevel - 1] + (KALISTA_CONSTANTS.BASE_AD * KALISTA_CONSTANTS.E_AD_RATIO);
            const stackDmg = KALISTA_CONSTANTS.BASE_AD * 0.3;
            const totalRendDmg = baseDmg + ((unit.rendStacks - 1) * stackDmg);

            unit.hp -= totalRendDmg; // Minions have HP
            if (unit === target) totalDamage += totalRendDmg; // Only track dmg to dummy for score? Or all?
            // Let's track all damage
            if (unit !== target) totalDamage += totalRendDmg;

            spawnText(`${Math.floor(totalRendDmg)}!`, unit.x, unit.y - 50, "#ef4444");
            unit.rendStacks = 0;
            hitCount++;

            if (unit.hp <= 0 && unit !== target) {
                // Minion kill
                // Reset Cooldown? "If Rend kills at least one target, its cooldown is reset."
                eCooldownTimer = 0;
                spawnText("Reset!", player.x, player.y - 60, "#34d399");
            }
        }
    };

    applyRendToUnit(target);
    minions.forEach(m => applyRendToUnit(m));

    // E-Buffer Logic: Mark active Q projectiles
    qProjectiles.forEach(p => {
        p.rendPending = true;
    });

    if (hitCount === 0 && qProjectiles.length === 0) {
        spawnText("Miss", player.x, player.y - 40, "#94a3b8");
    }
}

function queueDash(mx, my) {
    // Dash relative to player position, not target
    // If we have a target, we can calculate "Forward" vs "Backward" relative to it
    // If no target (or just skillshotting), "Forward" is towards mouse?
    // But Kalista mechanics usually define "Forward" as towards the target she is attacking.
    // If she just cast Q into emptiness, does she have a "target"?
    // Let's assume "Forward" is towards the location of the Q cast (player.angle) if no target lock?
    // Or just keep it relative to the dummy target for this trainer since there is always a dummy.

    const toTargetX = target.x - player.x;
    const toTargetY = target.y - player.y;
    const toClickX = mx - player.x;
    const toClickY = my - player.y;
    const lenT = Math.hypot(toTargetX, toTargetY);
    const lenC = Math.hypot(toClickX, toClickY);

    // If lenT is very small (on top of target), direction is ambiguous, default to forward?
    // Just use the dot product logic, it works fine even if not attacking.
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

    // Cooldowns
    if (qCooldownTimer > 0) qCooldownTimer -= dt;
    if (eCooldownTimer > 0) eCooldownTimer -= dt;

    // Rend Stacks Decay
    if (target.rendStacks > 0) {
        target.rendTimer -= dt;
        if (target.rendTimer <= 0) target.rendStacks = 0;
    }
    minions.forEach(m => {
        if (m.rendStacks > 0) {
            m.rendTimer -= dt;
            if (m.rendTimer <= 0) m.rendStacks = 0;
        }
    });

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
            // Find closest target in range
            // Candidates: target + minions
            let closest = null;
            let closestDist = KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS;

            const candidates = [target, ...minions];
            for (const c of candidates) {
                const d = Math.hypot(c.x - player.x, c.y - player.y);
                if (d <= closestDist) {
                    closest = c;
                    closestDist = d;
                }
            }

            if (closest) {
                startAttack(closest);
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
        // Keep facing target if it exists
        if (player.attackTarget) {
            player.angle = Math.atan2(player.attackTarget.y - player.y, player.attackTarget.x - player.x);
        }

        if (player.stateTimer <= 0) {
            playSound('throw');
            if (player.attackTarget) {
                projectiles.push({
                    x: player.x, y: player.y,
                    speed: 1400, life: 2.0,
                    target: player.attackTarget
                });
            } else {
                // Fallback if target died or something? Just shoot forward
                projectiles.push({
                    x: player.x, y: player.y,
                    speed: 1400, life: 2.0,
                    target: target // Default to dummy
                });
            }

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
    } else if (player.state === STATE.CASTING_Q) {
        player.stateTimer -= dt;
        if (player.stateTimer <= 0) {
            // Fire Q
            playSound('pierce');
            qProjectiles.push({
                x: player.x, y: player.y,
                vx: Math.cos(player.angle) * (KALISTA_CONSTANTS.Q_SPEED * SCALE_RATIO),
                vy: Math.sin(player.angle) * (KALISTA_CONSTANTS.Q_SPEED * SCALE_RATIO),
                life: KALISTA_CONSTANTS.Q_RANGE / KALISTA_CONSTANTS.Q_SPEED,
                transferredStacks: 0,
                rendPending: false
            });
            qCooldownTimer = KALISTA_CONSTANTS.Q_CD;

            // Dash after Q if queued
            if (player.queuedDash) {
                player.state = STATE.DASHING;
                const dashDuration = 0.25;
                player.stateTimer = dashDuration;
                // Q Dash is always long distance
                const dist = DASH_RANGES_BACK[bootsTier];
                const dashAngle = Math.atan2(player.queuedDash.y - player.y, player.queuedDash.x - player.x);
                player.dashVx = Math.cos(dashAngle) * (dist / dashDuration);
                player.dashVy = Math.sin(dashAngle) * (dist / dashDuration);
                score++; playSound('dash');
            } else {
                player.state = STATE.IDLE;
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

    // Basic Attacks
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        // Check if target still exists (if minion died)
        // If target is minion and not in minions array, it's dead.
        // But we have reference to object.
        // If it's dead, hp <= 0.
        if (p.target && p.target.hp <= 0 && p.target !== target) {
            // Target dead, destroy projectile or let it fly?
            // Usually it fizzles or flies to last pos.
            // Let's just destroy it.
            projectiles.splice(i, 1);
            continue;
        }

        const t = p.target || target;
        const angle = Math.atan2(t.y - p.y, t.x - p.x);
        p.x += Math.cos(angle) * p.speed * dt;
        p.y += Math.sin(angle) * p.speed * dt;
        p.life -= dt;

        if (Math.hypot(p.x - t.x, p.y - t.y) < t.radius) {
            playSound('hit');
            projectiles.splice(i, 1);

            // Damage Logic
            const dmg = recordDamage(); // This adds to total score
            // Apply to unit
            t.hp -= dmg;
            spawnText(Math.floor(dmg), t.x, t.y - 30, "#fbbf24");

            // Apply Rend Stack
            if (t.rendStacks < KALISTA_CONSTANTS.E_MAX_STACKS) {
                t.rendStacks++;
                t.rendTimer = KALISTA_CONSTANTS.E_STACK_DURATION;
            }

            // Check death
            if (t.hp <= 0 && t !== target) {
                // Minion died
                spawnText("Kill", t.x, t.y - 30, "#ef4444");
                const idx = minions.indexOf(t);
                if (idx !== -1) minions.splice(idx, 1);
            }

            continue;
        }
        if (p.life <= 0) projectiles.splice(i, 1);
    }

    // Q Projectiles
    for (let i = qProjectiles.length - 1; i >= 0; i--) {
        const p = qProjectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        // Check Collisions with Minions first (closest first?)
        // Simple iteration
        let hit = false;

        // Minions
        for (let mIndex = minions.length - 1; mIndex >= 0; mIndex--) {
            const m = minions[mIndex];
            if (Math.hypot(p.x - m.x, p.y - m.y) < m.radius + 10) {
                // Hit Minion
                const dmg = KALISTA_CONSTANTS.Q_DAMAGE_BASE[qLevel - 1] + (KALISTA_CONSTANTS.BASE_AD * KALISTA_CONSTANTS.Q_AD_RATIO);

                if (dmg >= m.hp) {
                    // KILL -> Pass through
                    playSound('hit');
                    m.hp -= dmg; // It dies
                    p.transferredStacks += (m.rendStacks + 1); // Add minion's stacks + 1 for the Q itself
                    spawnText("Kill!", m.x, m.y - 30, "#ef4444");
                    minions.splice(mIndex, 1);
                    // Projectile continues!
                } else {
                    // NO KILL -> Stop
                    playSound('hit');
                    m.hp -= dmg;
                    m.rendStacks++;
                    m.rendTimer = KALISTA_CONSTANTS.E_STACK_DURATION;
                    spawnText(Math.floor(dmg), m.x, m.y - 30, "#fbbf24");

                    // Trigger E if pending
                    if (p.rendPending) {
                        // Apply Rend immediately
                        const baseDmg = KALISTA_CONSTANTS.E_DAMAGE_BASE[eLevel - 1] + (KALISTA_CONSTANTS.BASE_AD * KALISTA_CONSTANTS.E_AD_RATIO);
                        const stackDmg = KALISTA_CONSTANTS.BASE_AD * 0.3;
                        const totalRendDmg = baseDmg + ((m.rendStacks - 1) * stackDmg);
                        m.hp -= totalRendDmg;
                        spawnText(`${Math.floor(totalRendDmg)}!`, m.x, m.y - 50, "#ef4444");
                        m.rendStacks = 0;
                        if (m.hp <= 0) {
                            minions.splice(mIndex, 1);
                            eCooldownTimer = 0; // Reset on kill
                        }
                    }

                    qProjectiles.splice(i, 1);
                    hit = true;
                }
                break; // Handle one collision per frame per projectile to avoid weirdness?
            }
        }
        if (hit) continue;

        // Collision with Target
        if (Math.hypot(p.x - target.x, p.y - target.y) < target.radius + 20) { // +20 for width approx
            playSound('hit');
            qProjectiles.splice(i, 1);

            // Q Damage
            const dmg = KALISTA_CONSTANTS.Q_DAMAGE_BASE[qLevel - 1] + (KALISTA_CONSTANTS.BASE_AD * KALISTA_CONSTANTS.Q_AD_RATIO);
            totalDamage += dmg;
            spawnText(`${Math.floor(dmg)}`, target.x, target.y - 50, "#fbbf24");

            // Apply Rend Stack
            if (target.rendStacks < KALISTA_CONSTANTS.E_MAX_STACKS) {
                target.rendStacks += (1 + p.transferredStacks); // Apply Q stack + transferred
                target.rendTimer = KALISTA_CONSTANTS.E_STACK_DURATION;
            }

            // Trigger E if pending
            if (p.rendPending) {
                const baseDmg = KALISTA_CONSTANTS.E_DAMAGE_BASE[eLevel - 1] + (KALISTA_CONSTANTS.BASE_AD * KALISTA_CONSTANTS.E_AD_RATIO);
                const stackDmg = KALISTA_CONSTANTS.BASE_AD * 0.3;
                const totalRendDmg = baseDmg + ((target.rendStacks - 1) * stackDmg);
                totalDamage += totalRendDmg;
                spawnText(`${Math.floor(totalRendDmg)}!`, target.x, target.y - 50, "#ef4444");
                target.rendStacks = 0;
            }

            continue;
        }

        if (p.life <= 0) qProjectiles.splice(i, 1);
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

    // Minions
    minions.forEach(m => {
        ctx.beginPath(); ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
        ctx.fillStyle = m.color; ctx.fill();
        // HP Bar
        const hpPct = m.hp / m.maxHp;
        ctx.fillStyle = '#334155'; ctx.fillRect(m.x - 15, m.y - 30, 30, 4);
        ctx.fillStyle = '#ef4444'; ctx.fillRect(m.x - 15, m.y - 30, 30 * hpPct, 4);

        // Rend Stacks
        if (m.rendStacks > 0) {
            ctx.fillStyle = '#fff'; ctx.font = '10px monospace';
            ctx.fillText(m.rendStacks, m.x - 3, m.y - 35);
            // Spears visual
            for (let i = 0; i < Math.min(m.rendStacks, 10); i++) {
                const angle = (Math.PI * 2 / 10) * i;
                const sx = m.x + Math.cos(angle) * 10;
                const sy = m.y + Math.sin(angle) * 10;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(angle) * 10, sy + Math.sin(angle) * 10);
                ctx.strokeStyle = '#94a3b8'; ctx.stroke();
            }
        }
    });

    // Attack Range Indicator
    ctx.shadowBlur = 0; // Reset for range circle
    ctx.beginPath(); ctx.arc(player.x, player.y, KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS, 0, Math.PI * 2);
    if (isTargeting) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    } else {
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.08)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // Q Range Indicator (if casting or hovering?)
    // Not implemented for now to keep UI clean

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

    // Rend Stacks Visuals (Spears stuck in enemy)
    if (target.rendStacks > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${target.rendStacks}`, target.x, target.y - target.radius - 10);

        // Draw spears sticking out?
        for (let i = 0; i < Math.min(target.rendStacks, 10); i++) {
            const angle = (Math.PI * 2 * i) / Math.min(target.rendStacks, 10);
            const sx = target.x + Math.cos(angle) * (target.radius - 5);
            const sy = target.y + Math.sin(angle) * (target.radius - 5);
            const ex = target.x + Math.cos(angle) * (target.radius + 15);
            const ey = target.y + Math.sin(angle) * (target.radius + 15);

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

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

    // Q Projectiles
    for (const p of qProjectiles) {
        ctx.beginPath();
        const tailLen = 30; // Longer tail for Q
        const pAngle = Math.atan2(p.vy, p.vx);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(pAngle) * tailLen, p.y - Math.sin(pAngle) * tailLen);
        ctx.strokeStyle = '#fbbf24'; // Gold/Yellow for Pierce
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fef3c7'; ctx.fill();
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
    if (player.state === STATE.WINDUP || player.state === STATE.CASTING_Q) {
        const totalTime = player.state === STATE.CASTING_Q ? KalistaModel.getQCastTime(currentAS) : currentWindupTime;
        const pct = 1 - (player.stateTimer / totalTime);
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

    // Spell Cooldowns Indicators (Simple)
    // Draw near player?
    const cdY = player.y + 40;

    // Q
    ctx.fillStyle = qCooldownTimer > 0 ? 'rgba(0,0,0,0.5)' : 'rgba(251, 191, 36, 0.8)';
    ctx.fillRect(player.x - 25, cdY, 20, 20);
    ctx.strokeStyle = '#fff'; ctx.strokeRect(player.x - 25, cdY, 20, 20);
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.fillText("A", player.x - 15, cdY + 14);
    if (qCooldownTimer > 0) {
        ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(qCooldownTimer), player.x - 15, cdY + 14);
    }

    // E
    ctx.fillStyle = eCooldownTimer > 0 ? 'rgba(0,0,0,0.5)' : 'rgba(52, 211, 153, 0.8)';
    ctx.fillRect(player.x + 5, cdY, 20, 20);
    ctx.strokeStyle = '#fff'; ctx.strokeRect(player.x + 5, cdY, 20, 20);
    ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.fillText("E", player.x + 15, cdY + 14);
    if (eCooldownTimer > 0) {
        ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(eCooldownTimer), player.x + 15, cdY + 14);
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
