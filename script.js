/**
 * NEON ORBIT - v3
 * Новое: бонусы (щит / замедление / x2), движущиеся орбиты,
 * зоны каждые 10 орбит, PERFECT-комбо, тряска экрана, фон со звёздами, пауза.
 */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const overlay = document.getElementById('overlay');

// --- Состояние ---
let gameActive = false, paused = false, loopStarted = false;
let score = 0, combo = 0;
let bestScore = parseInt(localStorage.getItem('orbit_best')) || 0;
let player, orbits, particles, texts, stars;
let cameraY = 0, lastTime = 0, time = 0, orbitTime = 0, shake = 0, flash = 0;
const effects = { slow: 0, double: 0 }; // таймеры в "кадрах по 60 FPS"

// --- Настройки ---
const JUMP_SPEED = 12;
const CAPTURE_RADIUS = 15;
const PERFECT_RADIUS = 6;
const ZONE_SIZE = 10; // орбит в одной зоне
const ZONE_HUES = [180, 300, 130, 45, 350, 260];
const PICKUPS = {
    shield: { color: '#00aaff', label: 'S' },
    slow:   { color: '#bb66ff', label: 'T' },
    double: { color: '#ffee00', label: 'x2' }
};

const zoneHue = (idx) => ZONE_HUES[Math.floor(idx / ZONE_SIZE) % ZONE_HUES.length];

// --- Звук ---
const sfx = {
    ctx: null,
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    play(f1, f2, dur, type, vol = 0.1) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f1, t);
        osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
        gain.gain.setValueAtTime(vol, t);
        gain.gain.linearRampToValueAtTime(0, t + dur);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(t + dur);
    },
    jump()    { this.play(150, 450, 0.1, 'triangle'); },
    capture() { this.play(400, 800, 0.1, 'sine'); },
    perfect(c){ this.play(500 + c * 80, 1000 + c * 80, 0.15, 'square', 0.06); },
    power()   { this.play(600, 1400, 0.25, 'sine', 0.12); },
    shield()  { this.play(900, 200, 0.3, 'square', 0.08); },
    zone()    { this.play(300, 1200, 0.5, 'triangle', 0.12); },
    fail()    { this.play(200, 50, 0.3, 'sawtooth', 0.15); }
};

// --- Кнопка паузы (создаётся из JS, HTML менять не нужно) ---
const pauseBtn = document.createElement('button');
pauseBtn.textContent = '❚❚';
pauseBtn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:6;padding:6px 14px;font-size:14px;letter-spacing:0;display:none;';
pauseBtn.addEventListener('click', () => { if (gameActive) paused = !paused; });
document.body.appendChild(pauseBtn);
document.addEventListener('visibilitychange', () => { if (document.hidden && gameActive) paused = true; });

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function startGame() {
    sfx.init();
    overlay.style.display = 'none';
    pauseBtn.style.display = 'block';
    score = 0; combo = 0; paused = false;
    effects.slow = 0; effects.double = 0;
    scoreEl.innerText = score;
    gameActive = true;
    cameraY = 0; shake = 0; flash = 0; orbitTime = 0;
    particles = []; texts = []; orbits = [];

    stars = [];
    for (let i = 0; i < 60; i++) {
        stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, z: 0.1 + Math.random() * 0.3 });
    }

    player = {
        orbitIdx: 0, angle: 0, x: 0, y: 0,
        isJumping: false, vx: 0, vy: 0, size: 8,
        shield: false, grace: 0,
        color: getSkinColor(bestScore)
    };

    for (let i = 0; i < 5; i++) createOrbit(i);

    if (!loopStarted) {
        loopStarted = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

function getSkinColor(s) {
    if (s >= 200) return '#ff00ff';
    if (s >= 100) return '#ffff00';
    if (s >= 40) return '#00ff00';
    return '#ffffff';
}

// --- Создание орбит: чем больше index, тем сложнее ---
function createOrbit(index) {
    const lastY = orbits.length > 0 ? orbits[orbits.length - 1].y : canvas.height - 150;
    const speedFactor = Math.min(0.022 + index * 0.0005, 0.045);
    const baseRadius = Math.max(55 - index * 0.4, 32);
    const radius = baseRadius + Math.random() * 30;

    let x = canvas.width / 2;
    if (index >= 2) {
        const wanted = Math.min(60 + index * 4, 110);
        const maxOff = Math.max(0, Math.min(wanted, canvas.width / 2 - radius - 10));
        x += (Math.random() * 2 - 1) * maxOff;
    }

    const o = {
        x, baseX: x, y: lastY - 220, radius,
        speed: (Math.random() > 0.5 ? 1 : -1) * speedFactor,
        amp: 0, phase: Math.random() * 6.28,
        pickup: null
    };

    // Движущаяся орбита (качается влево-вправо)
    if (index >= 8 && Math.random() < 0.3) {
        o.amp = Math.max(0, Math.min(45, x - radius - 10, canvas.width - x - radius - 10));
    }
    // Бонус на кольце
    if (index >= 3 && Math.random() < 0.3) {
        const types = Object.keys(PICKUPS);
        o.pickup = { type: types[Math.floor(Math.random() * types.length)], angle: Math.random() * 6.28, taken: false };
    }
    orbits.push(o);
}

// --- Эффекты ---
function createParticles(x, y, color, count, scatter = 4) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y, vx: (Math.random() - 0.5) * scatter, vy: (Math.random() - 0.5) * scatter,
            radius: Math.random() * 3 + 1, color, alpha: 1
        });
    }
}
function addText(x, y, text, color) { texts.push({ x, y, text, color, alpha: 1 }); }

function jump() {
    if (!gameActive || paused || player.isJumping) return;
    sfx.jump();
    player.isJumping = true;
    const dir = orbits[player.orbitIdx].speed > 0 ? 1 : -1;
    const a = player.angle + (Math.PI / 2) * dir;
    player.vx = Math.cos(a) * JUMP_SPEED;
    player.vy = Math.sin(a) * JUMP_SPEED;
}

// --- Бонусы ---
function checkPickup(o) {
    const p = o.pickup;
    if (!p || p.taken) return;
    const px = o.x + Math.cos(p.angle) * o.radius;
    const py = o.y + Math.sin(p.angle) * o.radius;
    if (Math.hypot(player.x - px, player.y - py) > 22) return;

    p.taken = true;
    const info = PICKUPS[p.type];
    if (p.type === 'shield') player.shield = true;
    if (p.type === 'slow') effects.slow = 300;    // 5 секунд
    if (p.type === 'double') effects.double = 480; // 8 секунд
    sfx.power();
    createParticles(px, py, info.color, 16, 7);
    addText(px, py - 25, { shield: 'ЩИТ!', slow: 'ЗАМЕДЛЕНИЕ', double: 'ОЧКИ x2' }[p.type], info.color);
}

// --- Удар / провал: щит спасает один раз ---
function fail() {
    if (player.shield) {
        player.shield = false;
        player.grace = 90;
        player.isJumping = false; // возвращаемся на текущую орбиту
        combo = 0;
        shake = 12;
        createParticles(player.x, player.y, '#0ff', 25, 8);
        addText(player.x, player.y - 25, 'ЩИТ СПАС!', '#0ff');
        sfx.shield();
        return;
    }
    sfx.fail();
    gameOver();
}

// --- Захват орбиты ---
function captureOrbit(next, dx, dy, dist) {
    const perfect = Math.abs(dist - next.radius) < PERFECT_RADIUS;
    player.isJumping = false;
    player.orbitIdx++;
    player.angle = Math.atan2(dy, dx);

    let points = 1;
    if (perfect) {
        combo++;
        points += Math.min(combo, 5);
        sfx.perfect(Math.min(combo, 8));
        createParticles(player.x, player.y, '#ff0', 18, 8);
    } else {
        combo = 0;
        sfx.capture();
        createParticles(player.x, player.y, '#fff', 12, 6);
    }
    if (effects.double > 0) points *= 2;
    if (perfect) addText(player.x, player.y - 25, `PERFECT x${combo}  +${points}`, '#ff0');

    score += points;
    scoreEl.innerText = score;
    if (navigator.vibrate) navigator.vibrate(perfect ? 25 : 15);
    if (score > bestScore) { bestScore = score; localStorage.setItem('orbit_best', bestScore); }

    // Новая зона: сообщение и бесплатный щит
    if (player.orbitIdx % ZONE_SIZE === 0) {
        const zone = player.orbitIdx / ZONE_SIZE + 1;
        addText(canvas.width / 2, player.y - 90, `ЗОНА ${zone}`, `hsl(${zoneHue(player.orbitIdx)},100%,60%)`);
        player.shield = true;
        sfx.zone();
    }
    if (orbits.length - player.orbitIdx < 5) createOrbit(orbits.length);
}

// --- Обновление (dt = 1 это кадр при 60 FPS) ---
function update(dt) {
    if (paused) return;
    time += dt;
    shake *= Math.pow(0.9, dt);
    flash = Math.max(0, flash - 0.02 * dt);

    if (gameActive) {
        const gdt = effects.slow > 0 ? dt * 0.55 : dt; // замедление касается орбит
        effects.slow = Math.max(0, effects.slow - dt);
        effects.double = Math.max(0, effects.double - dt);
        player.grace = Math.max(0, player.grace - dt);
        orbitTime += gdt;

        orbits.forEach(o => {
            if (o.amp) o.x = o.baseX + Math.sin(orbitTime * 0.03 + o.phase) * o.amp;
        });

        const cur = orbits[player.orbitIdx];
        if (!player.isJumping) {
            player.angle += cur.speed * gdt;
            player.x = cur.x + Math.cos(player.angle) * cur.radius;
            player.y = cur.y + Math.sin(player.angle) * cur.radius;
            checkPickup(cur);
        } else {
            player.x += player.vx * dt;
            player.y += player.vy * dt;
            if (Math.random() < 0.5 * dt) createParticles(player.x, player.y, player.color, 1, 1);

            const next = orbits[player.orbitIdx + 1];
            checkPickup(next);
            const dx = player.x - next.x, dy = player.y - next.y;
            const dist = Math.hypot(dx, dy);

            if (Math.abs(dist - next.radius) < CAPTURE_RADIUS) {
                captureOrbit(next, dx, dy, dist);
            } else if (player.y > cur.y + 300 || player.y < next.y - 400 ||
                       player.x < -100 || player.x > canvas.width + 100) {
                fail();
            }
        }
        cameraY += (canvas.height * 0.6 - player.y - cameraY) * (1 - Math.pow(0.9, dt));
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.alpha -= 0.02 * dt;
        if (p.alpha <= 0) particles.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.y -= 0.8 * dt; t.alpha -= 0.015 * dt;
        if (t.alpha <= 0) texts.splice(i, 1);
    }
}

// --- Отрисовка ---
function draw() {
    ctx.fillStyle = 'rgba(5, 5, 5, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Звёзды с параллаксом (экранные координаты)
    ctx.fillStyle = '#556';
    stars.forEach(s => {
        const y = (((s.y + cameraY * s.z) % canvas.height) + canvas.height) % canvas.height;
        ctx.fillRect(s.x, y, 2, 2);
    });

    ctx.save();
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    ctx.translate(sx, cameraY + sy);

    const pulse = Math.sin(Date.now() / 400) * 2;
    orbits.forEach((o, i) => {
        const isNext = (i === player.orbitIdx + 1);
        const hue = zoneHue(i);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
        ctx.setLineDash(o.amp ? [8, 8] : []); // пунктир = движущаяся орбита
        ctx.strokeStyle = isNext ? `hsl(${hue},100%,55%)` : '#222';
        ctx.lineWidth = isNext ? 3 : 1;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = isNext ? '#111' : '#080808';
        ctx.beginPath();
        ctx.arc(o.x, o.y, 8 + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Бонус
        if (o.pickup && !o.pickup.taken) {
            const info = PICKUPS[o.pickup.type];
            const px = o.x + Math.cos(o.pickup.angle) * o.radius;
            const py = o.y + Math.sin(o.pickup.angle) * o.radius;
            ctx.shadowBlur = 14; ctx.shadowColor = info.color;
            ctx.strokeStyle = info.color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(px, py, 10 + pulse, 0, Math.PI * 2); ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = info.color; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(info.label, px, py + 4);
        }
    });

    particles.forEach(p => {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    });

    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    texts.forEach(t => {
        ctx.globalAlpha = Math.max(0, t.alpha);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;

    // Игрок (и щит вокруг него)
    ctx.shadowBlur = 15; ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    if (player.grace > 0 && Math.floor(time / 4) % 2 === 0) ctx.globalAlpha = 0.4; // мигание
    ctx.beginPath(); ctx.arc(player.x, player.y, player.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (player.shield) {
        ctx.strokeStyle = '#0af'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(player.x, player.y, player.size + 7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // HUD (экранные координаты)
    ctx.textAlign = 'left'; ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillStyle = '#668';
    ctx.fillText(`РЕКОРД ${bestScore}`, 14, 24);
    let y = canvas.height - 20;
    if (effects.slow > 0)   { ctx.fillStyle = PICKUPS.slow.color;   ctx.fillText(`ЗАМЕДЛЕНИЕ ${(effects.slow / 60).toFixed(1)}`, 14, y); y -= 22; }
    if (effects.double > 0) { ctx.fillStyle = PICKUPS.double.color; ctx.fillText(`ОЧКИ x2 ${(effects.double / 60).toFixed(1)}`, 14, y); }

    if (flash > 0) { ctx.fillStyle = `rgba(255,0,0,${flash})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0ff'; ctx.textAlign = 'center'; ctx.font = 'bold 32px "Segoe UI", sans-serif';
        ctx.fillText('ПАУЗА', canvas.width / 2, canvas.height / 2);
    }
}

function gameOver() {
    gameActive = false;
    shake = 20; flash = 0.4;
    createParticles(player.x, player.y, '#f00', 20, 8);
    pauseBtn.style.display = 'none';
    overlay.style.display = 'flex';
    document.querySelector('h1').innerText = 'SYSTEM FAILURE';
    document.querySelector('p').innerHTML = `Счет: ${score} <br> <b>Рекорд: ${bestScore}</b>`;
}

function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 16.667, 2);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

// --- Ввод ---
window.addEventListener('touchstart', (e) => {
    if (e.target.tagName !== 'BUTTON') { e.preventDefault(); jump(); }
}, { passive: false });
window.addEventListener('mousedown', (e) => {
    if (gameActive && e.target.tagName !== 'BUTTON') jump();
});

window.startGame = startGame;
