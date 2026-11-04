/* NUÔI RỒNG ONLINE — stage.js
   Sân khấu chỉ HIỂN THỊ + HIỆU ỨNG. Mọi luật chơi nằm ở server.
   Hiệu ứng canvas thời gian thực (cùng phong cách các clip mẫu):
   thở/nhấp nhô (CSS), cho ăn, tim bay, NỞ, TIẾN HÓA, PHUN LỬA, giờ vàng. */
'use strict';

const ASSETS = {
  1: '/assets/egg.webp', 2: '/assets/baby.webp', 3: '/assets/juvenile.webp',
  4: '/assets/adult.webp', 5: '/assets/divine.webp',
};
const $ = (id) => document.getElementById(id);
const stageEl = $('stage'), dragonWrap = $('dragonWrap'), dragonImg = $('dragonImg'),
  mouthGlow = $('mouthGlow'), canvas = $('fxCanvas'), ctx = canvas.getContext('2d'),
  flashEl = $('flash'), bigBanner = $('bigBanner'), eventBanner = $('eventBanner');

let S = null;               // state mới nhất từ server
let shownLevel = 0;         // cấp đang hiển thị trên sân
let animating = false;      // đang chạy chuỗi nở/tiến hoá → hoãn đổi hình
let goldenEndsAt = 0;

/* ---------------- WebSocket ---------------- */
let ws = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=stage`);
  ws.onopen = () => $('connDot').classList.add('on');
  ws.onclose = () => { $('connDot').classList.remove('on'); setTimeout(connect, 2000); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
  ws.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.kind === 'state') { S = msg.state; render(); }
    else if (msg.kind === 'fx') handleFx(msg);
  };
}
connect();

/* ---------------- Render state ---------------- */
function fmt(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function render() {
  if (!S) return;
  $('levelBadge').textContent = 'CẤP ' + S.level;
  dragonWrap.className = 'lv' + S.level + (dragonWrap.classList.contains('shake') ? ' shake' : '');
  if (!animating && shownLevel !== S.level) {
    shownLevel = S.level;
    dragonImg.src = ASSETS[S.level];
  }
  const pct = S.expNeed ? Math.min(100, (S.expInLevel / S.expNeed) * 100) : 100;
  $('expFill').style.width = pct + '%';
  $('expText').textContent = S.expNeed
    ? `EXP ${fmt(S.expInLevel)} / ${fmt(S.expNeed)} — ${S.levelName}`
    : `EXP ${fmt(S.totalExp)} — THẦN RỒNG cấp tối đa!`;
  const golden = S.golden && S.golden.active;
  $('expBar').classList.toggle('golden', !!golden);
  $('goldenTag').classList.toggle('hidden', !golden);
  goldenEndsAt = golden ? S.golden.until : 0;
  // Bảng vàng top 3
  const rows = (S.top || []).slice(0, 3);
  $('lbRows').innerHTML = rows.length
    ? rows.map((p, i) => `<div class="lbRow ${i === 0 ? 'top1' : ''}"><span class="nm">${i + 1}. ${esc(p.user)}</span><span class="pts">${fmt(p.points)}</span></div>`).join('')
    : '<div class="lbEmpty">Chưa có ai — thả tim để lên bảng!</div>';
  renderPets();
}
function renderPets() {
  const pets = S.pets || [];
  const row = $('petsRow');
  if (!pets.length) {
    const html = '<div class="lbEmpty" style="font-size:2.7cqw;color:#c6cfef">Chưa ai có rồng riêng — follow là có ngay!</div>';
    if (row.dataset.sig !== html) { row.innerHTML = html; row.dataset.sig = html; }
    return;
  }
  // Tối đa 10 vòng: 10 rồng mới nhất; thừa thì 9 rồng + 1 vòng "+N"
  let list = pets.slice(-10);
  let extra = 0;
  if (pets.length > 10) { extra = pets.length - 9; list = pets.slice(-9); }
  const total = list.length + (extra ? 1 : 0);
  const wPct = total <= 5 ? 17.6 : (100 - 2.2 * (total - 1)) / total;
  let html = '';
  if (extra > 0) {
    html += `<div class="pet more" style="--c:#ffd94d;width:${wPct}%"><div class="ring">+${extra}</div><span class="tag">rồng khác</span></div>`;
  }
  for (const p of list) {
    html += `<div class="pet" style="--c:${p.color};width:${wPct}%"><div class="ring"><img src="/assets/${p.img}" alt=""></div>` +
      `<span class="tag">${esc(p.user)} • ${esc(p.sysName)}${p.rare ? ' ❄' : ''}</span></div>`;
  }
  if (row.dataset.sig !== html) { row.innerHTML = html; row.dataset.sig = html; }
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Banner ---------------- */
let bannerTimer = null;
function showBanner(text, ms) {
  eventBanner.textContent = text;
  eventBanner.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => eventBanner.classList.add('hidden'), ms || 4200);
}
function showBig(html, ms) {
  bigBanner.innerHTML = html;
  bigBanner.classList.remove('hidden');
  setTimeout(() => bigBanner.classList.add('hidden'), ms || 3600);
}

/* ---------------- Canvas hạt ---------------- */
const parts = [];
let fire = null; // {until, mouth:{x,y,dir}, chargeUntil}
function stageRect() { return stageEl.getBoundingClientRect(); }
function dragonRect() { return dragonWrap.getBoundingClientRect(); }
function toCanvas(x, y) {
  const r = stageRect();
  return { x: (x - r.left) / r.width * canvas.width, y: (y - r.top) / r.height * canvas.height };
}
function mouthPoint() {
  if (!S || !S.mouth) return null;
  const r = dragonRect();
  return toCanvas(r.left + S.mouth.x * r.width, r.top + S.mouth.y * r.height);
}
function dragonCenter() {
  const r = dragonRect();
  return toCanvas(r.left + r.width / 2, r.top + r.height / 2);
}
function spawn(o) { parts.push(Object.assign({ age: 0, life: 1, vx: 0, vy: 0, size: 6, color: '#ffd75e', grav: 0, drag: 0, glow: false, shape: 'circle' }, o)); }

function burst(cx, cy, n, colors, speed, life, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (0.3 + Math.random() * 0.7) * (speed || 620);
    spawn({
      x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
      life: (life || 1) * (0.6 + Math.random() * 0.7), size: (size || 7) * (0.6 + Math.random() * 0.9),
      color: colors[Math.floor(Math.random() * colors.length)], grav: 480, drag: 0.6, glow: true,
    });
  }
}
function gather(cx, cy, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 380 + Math.random() * 420;
    spawn({
      x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
      vx: -Math.cos(a) * r / 1.15, vy: -Math.sin(a) * r / 1.15,
      life: 1.15, size: 4 + Math.random() * 6, color: ['#ffe97a', '#fff3c4', '#9dffc4'][i % 3], glow: true,
    });
  }
}
function hearts(n, user) {
  const c = dragonCenter();
  for (let i = 0; i < Math.min(n, 24); i++) {
    spawn({
      x: c.x + (Math.random() - 0.5) * 620, y: c.y + 430 + Math.random() * 120,
      vx: (Math.random() - 0.5) * 60, vy: -(190 + Math.random() * 160),
      life: 1.5 + Math.random(), size: 15 + Math.random() * 13, color: '#ff5f8f', shape: 'heart',
    });
  }
}
function feedFx(user) {
  const c = dragonCenter();
  for (let i = 0; i < 10; i++) {
    spawn({
      x: c.x + (Math.random() - 0.5) * 420, y: c.y - 560 - Math.random() * 160,
      vx: (Math.random() - 0.5) * 40, vy: 300 + Math.random() * 160,
      life: 1.15, size: 21 + Math.random() * 9, color: '#ffb52e', shape: 'food',
    });
  }
  floatText(`${user} cho ăn +EXP`, c.x, c.y - 620, '#ffd94d');
}
const floaters = [];
function floatText(text, x, y, color) { floaters.push({ text, x, y, age: 0, life: 1.8, color: color || '#fff' }); }

function drawHeart(x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 30, s / 30);
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-17, -6, -8, -20, 0, -9);
  ctx.bezierCurveTo(8, -20, 17, -6, 0, 10);
  ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
let lastTs = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016); lastTs = ts;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Lửa: nạp + phun
  if (fire) {
    const now = performance.now();
    const mp = mouthPoint();
    if (now > fire.until || !mp) { fire = null; mouthGlow.style.opacity = 0; dragonWrap.classList.remove('shake'); }
    else {
      const charging = now < fire.chargeUntil;
      mouthGlow.style.left = (mp.x / canvas.width * 100) + '%';
      mouthGlow.style.top = (mp.y / canvas.height * 100) + '%';
      mouthGlow.style.opacity = charging ? (0.45 + 0.4 * Math.sin(now / 60)) : 0.95;
      if (!charging) {
        dragonWrap.classList.add('shake');
        const dir = (S.mouth && S.mouth.dir) || -1;
        const power = Math.min(1, (fire.until - now) / 600 + 0.3);
        for (let i = 0; i < 15; i++) {
          const sp = (950 + Math.random() * 800) * power;
          const ang = (Math.random() - 0.5) * 0.24 + 0.15;
          spawn({
            x: mp.x, y: mp.y, vx: dir * sp * Math.cos(ang), vy: sp * Math.sin(ang) + sp * 0.14,
            life: 0.5 + Math.random() * 0.4, size: 9 + Math.random() * 8,
            color: ['#fff4c8', '#ffb03a', '#f35c16', '#ffd75e'][Math.floor(Math.random() * 4)],
            drag: 0.55, grav: 150, glow: true, fire: true,
          });
        }
        // thân cột lửa liền: chuỗi vòng sáng dọc trục
        const L = 470 * power;
        for (let k = 0; k < 13; k++) {
          const f = k / 12;
          spawn({
            x: mp.x + dir * L * f, y: mp.y + L * f * 0.16 + Math.sin(f * 9 - now / 45) * 8 * f,
            vx: 0, vy: 0, life: 0.09, size: (44 * (1 - f * 0.7) + 8), glow: true,
            color: f < 0.3 ? '#fff0be' : (f < 0.65 ? '#ffaa37' : '#f55f19'),
          });
        }
      }
    }
  }
  // Hạt
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age > p.life) { parts.splice(i, 1); continue; }
    const fr = p.age / p.life;
    if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
    p.vy += (p.grav || 0) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const a = p.fire ? (1 - fr * 0.5) : (fr < 0.75 ? 1 : 1 - (fr - 0.75) / 0.25);
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 18; }
    if (p.shape === 'heart') drawHeart(p.x, p.y, p.size * 2, p.color);
    else if (p.shape === 'food') { ctx.font = `${p.size * 2.4}px serif`; ctx.textAlign = 'center'; ctx.fillText('🍖', p.x, p.y); }
    else {
      const r = p.fire ? p.size * (0.7 + fr * 2.1) : p.size * (1 - fr * 0.3);
      ctx.beginPath(); ctx.fillStyle = p.color;
      ctx.ellipse(p.x, p.y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // Chữ bay
  ctx.save(); ctx.textAlign = 'center';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.age += dt;
    if (f.age > f.life) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, (f.life - f.age) / 0.5);
    ctx.font = '800 40px "Noto Sans", Arial';
    ctx.fillStyle = f.color; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8;
    ctx.fillText(f.text, f.x, f.y - f.age * 90);
  }
  ctx.restore();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- Chuỗi hiệu ứng lớn ---------------- */
function doFlash(cb) {
  flashEl.style.transition = 'none'; flashEl.style.opacity = 1;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity .55s ease'; flashEl.style.opacity = 0;
    if (cb) setTimeout(cb, 90);
  }));
}
function hatchSeq(toLevel) {
  animating = true;
  dragonImg.src = ASSETS[1];
  dragonWrap.classList.add('shake');
  let amp = 0;
  const iv = setInterval(() => { amp += 1; dragonWrap.style.setProperty('--x', amp); }, 300);
  setTimeout(() => {
    clearInterval(iv);
    dragonWrap.classList.remove('shake');
    const c = dragonCenter();
    doFlash(() => {
      shownLevel = toLevel; dragonImg.src = ASSETS[toLevel];
      dragonWrap.classList.add('pop');
      setTimeout(() => dragonWrap.classList.remove('pop'), 600);
      burst(c.x, c.y, 130, ['#ffd75e', '#fff0be', '#7dffb0', '#ff96c8'], 760, 1.2, 8);
      showBig('<div class="bb1">🐣 RỒNG ĐÃ NỞ!</div><div class="bb2">Cả phòng cùng nuôi bé lớn nhé</div>', 3800);
      animating = false; render();
    });
  }, 2100);
}
function evolveSeq(toLevel) {
  animating = true;
  const c = dragonCenter();
  gather(c.x, c.y, 90);
  setTimeout(() => {
    doFlash(() => {
      shownLevel = toLevel; dragonImg.src = ASSETS[toLevel];
      dragonWrap.classList.add('pop');
      setTimeout(() => dragonWrap.classList.remove('pop'), 600);
      burst(c.x, c.y, 110, ['#ffe97a', '#fff3c4', '#9dffc4'], 700, 1.1, 8);
      const names = { 3: 'Rồng Thiếu Niên', 4: 'Rồng Trưởng Thành', 5: 'THẦN RỒNG' };
      showBig(`<div class="bb1">✨ TIẾN HÓA THÀNH CÔNG!</div><div class="bb2">CẤP ${toLevel} — ${names[toLevel] || ''}</div>`, 4000);
      animating = false; render();
    });
  }, 1250);
}
function fireSeq(user, coins) {
  const mp = mouthPoint();
  if (!mp) { // trứng: bùng sáng thay phun lửa
    const c = dragonCenter();
    burst(c.x, c.y, 90, ['#ffd75e', '#ffb03a', '#fff0be'], 640, 1, 8);
    showBanner(`🔥 ${user} tặng quà lớn — trứng phát sáng ăn mừng!`);
    return;
  }
  fire = { chargeUntil: performance.now() + 850, until: performance.now() + 850 + 2500 };
  showBanner(`🔥 ${user} tặng quà lớn${coins ? ` (${Number(coins).toLocaleString('vi-VN')} xu)` : ''} — RỒNG PHUN LỬA!`);
}

/* ---------------- Xử lý fx từ server ---------------- */
let bannerQ = [];
function handleFx(m) {
  switch (m.fx) {
    case 'banner': showBanner(m.text, m.ms); break;
    case 'hearts': hearts(m.count || 5, m.user); break;
    case 'feed': feedFx(m.user || 'Khán giả'); break;
    case 'hatch': hatchSeq(m.toLevel || 2); break;
    case 'evolve': evolveSeq(m.toLevel || 3); break;
    case 'fire': fireSeq(m.user || 'Khán giả', m.coins); break;
    case 'pet-new': {
      const c = dragonCenter();
      burst(c.x, c.y + 560, 36, ['#ffd75e', '#9dffc4', '#ff96c8'], 380, 0.9, 6);
      break;
    }
    case 'golden': {
      const c = dragonCenter();
      burst(c.x, c.y - 300, 80, ['#ffd94d', '#ffe97a', '#fff3c4'], 560, 1.2, 7);
      showBig('<div class="bb1">🌟 GIỜ VÀNG!</div><div class="bb2">Nhân đôi EXP trong 60 giây!</div>', 3200);
      break;
    }
    case 'tts': speak(m.text); break;
  }
}

/* ---------------- TTS (hàng đợi, 1 câu / 4s, lọc từ cấm) ---------------- */
const BANNED = ['địt', 'đụ', 'lồn', 'cặc', 'buồi', 'chịch', 'đéo', 'vãi', 'khốn nạn', 'chó chết', 'mẹ mày', 'bố mày', 'suicide', 'tự tử'];
function cleanForSpeech(text) {
  let t = String(text || '');
  for (const b of BANNED) {
    if (t.toLowerCase().includes(b)) t = t.replace(new RegExp(b, 'gi'), '***');
  }
  return t.slice(0, 160);
}
const ttsQ = [];
let ttsBusy = false, audioEnabled = false;
function speak(text) {
  if (!S || !S.tts) return;
  const t = cleanForSpeech(text);
  if (!t) return;
  if (ttsQ.length >= 3) ttsQ.shift();
  ttsQ.push(t);
  pumpTts();
}
function pumpTts() {
  if (ttsBusy || !ttsQ.length) return;
  if (!audioEnabled || !('speechSynthesis' in window)) { ttsQ.length = 0; return; }
  const t = ttsQ.shift();
  ttsBusy = true;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'vi-VN'; u.rate = 1.02;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('vi'));
  if (v) u.voice = v;
  const done = () => { setTimeout(() => { ttsBusy = false; pumpTts(); }, 4000 - Math.min(4000, t.length * 55)); };
  u.onend = done; u.onerror = done;
  try { speechSynthesis.speak(u); } catch (e) { done(); }
  setTimeout(() => { if (ttsBusy) { ttsBusy = false; pumpTts(); } }, 12000); // an toàn
}
$('audioChip').addEventListener('click', () => {
  audioEnabled = true;
  $('audioChip').textContent = '🔊 Đã bật tiếng';
  try { speechSynthesis.cancel(); } catch (e) {}
  speak('Đã bật tiếng. Chào mừng đến với Nuôi Rồng Online!');
  setTimeout(() => $('audioChip').classList.add('hidden'), 2500);
});
if ('speechSynthesis' in window) speechSynthesis.getVoices();
