/* =====================================================================
   NUÔI RỒNG ONLINE — server.js (V1.1 — relay extension là đường chính)
   - Sân khấu 9:16 tại / , trang quản trị tại /admin, WebSocket /ws.
   - Server GIỮ TOÀN BỘ luật chơi: EXP, cấp rồng chính, rồng riêng,
     Bảng Vàng theo ngày, giờ vàng. Sân khấu chỉ hiển thị + hiệu ứng.
   - Cấp + EXP rồng chính lưu bền ở data/state.json (KHÔNG reset khi
     tắt/mở lại server, sống qua các phiên live). Điểm người xem lưu
     data/scores-YYYY-MM-DD.json.
   - Nguồn sự kiện CHÍNH: extension Chrome relay (thư mục extension/)
     quét DOM trang phòng live TikTok đang mở và POST vào
     /api/relay/{chat,gift,follow,like,share} — KHÔNG dùng dịch vụ
     ký bên thứ ba trong bất kỳ đường nào.
   - 3 chế độ: DEMO (mặc định, tự sinh sự kiện) / RELAY (extension) /
     THỦ CÔNG (chỉ nhận lệnh mô phỏng từ admin + /test-event).
   - tiktok-live-connector chỉ là module THỬ NGHIỆM, TẮT mặc định:
     chỉ nạp + kích hoạt khi có env SIGN_SERVER_URL trỏ tới sign
     server TỰ HOST (truyền qua eulerApiInstance basePath). Không có
     env này thì tuyệt đối không gọi ra ngoài.
   - POST /test-event (chỉ localhost): nạp sự kiện giả để kiểm thử.
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.join(DIR, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* tiktok-live-connector = module THỬ NGHIỆM, tắt mặc định.
   Chỉ nạp khi có env SIGN_SERVER_URL (sign server tự host). Đường sự
   kiện chính là extension relay (POST /api/relay/*) — không phụ thuộc
   module này và không gọi dịch vụ ký bên ngoài. */
const SIGN_SERVER_URL = String(process.env.SIGN_SERVER_URL || '').trim();
let ttlc = null;
if (SIGN_SERVER_URL) {
  try {
    ttlc = await import('tiktok-live-connector');
    console.log(`[tlc-thu-nghiem] Đã nạp tiktok-live-connector, sign server tự host: ${SIGN_SERVER_URL}`);
  } catch (e) {
    console.error('[tlc-thu-nghiem] Không nạp được tiktok-live-connector:', e.message);
    console.error('[tlc-thu-nghiem] Chạy "npm install" rồi khởi động lại. Đường relay extension không bị ảnh hưởng.');
  }
}

/* --------------------------- Hằng số luật chơi --------------------------- */
const LEVELS = [
  { lv: 1, name: 'Trứng Rồng', img: 'egg.webp', need: 1000 },
  { lv: 2, name: 'Rồng Sơ Sinh', img: 'baby.webp', need: 3000 },
  { lv: 3, name: 'Rồng Thiếu Niên', img: 'juvenile.webp', need: 8000 },
  { lv: 4, name: 'Rồng Trưởng Thành', img: 'adult.webp', need: 20000 },
  { lv: 5, name: 'Thần Rồng', img: 'divine.webp', need: Infinity },
];
/* Điểm phun lửa theo cấp — đo bằng visual grounding trên ảnh gốc (tỉ lệ
   theo khung hình rồng; sân khấu hiển thị rồng trong hộp vuông nên áp
   trực tiếp). dir: -1 phun sang trái, +1 phun sang phải. */
const MOUTHS = {
  1: null, // trứng — không có miệng, quà lớn chỉ bùng sáng
  2: { x: 0.51, y: 0.42, dir: -1 },
  3: { x: 0.358, y: 0.410, dir: -1 },
  4: { x: 0.797, y: 0.385, dir: 1 },
  5: { x: 0.352, y: 0.412, dir: -1 },
};
const PET_SYSTEMS = {
  fire: { key: 'fire', name: 'Lửa', img: 'pet-fire.webp', color: '#ff6e3c' },
  water: { key: 'water', name: 'Nước', img: 'pet-water.webp', color: '#5aaaff' },
  flower: { key: 'flower', name: 'Hoa', img: 'pet-flower.webp', color: '#ff96c8' },
  ice: { key: 'ice', name: 'Băng Đêm', img: 'pet-ice.webp', color: '#aa8cff' },
};
const COMMON_SYSTEMS = ['fire', 'water', 'flower'];
const BIG_GIFT_COINS = 99;

/* ------------------------------ Trạng thái ------------------------------ */
const game = {
  level: 1,
  expInLevel: 0,
  totalExp: 0,
  pets: [],            // {id,user,uniqueId,system,rare,source,at}
  paused: false,
  tts: true,
  goldenUntil: 0,
  nextGoldenAt: Date.now() + 30 * 60 * 1000,
  scores: new Map(),   // uniqueId -> {user, points}
};
const serverState = {
  mode: 'demo',
  conn: { status: 'idle', username: '', roomId: '', viewers: 0, message: 'Chưa kết nối TikTok.' },
  relay: { lastAt: 0, lastKind: '', count: 0, byKind: {} },
};

/* ------------------------------ Lưu bền ------------------------------ */
const STATE_FILE = path.join(DATA_DIR, 'state.json');
function saveDragon() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      level: game.level, expInLevel: game.expInLevel, totalExp: game.totalExp,
    }, null, 2));
  } catch (e) { console.error('[save] Lỗi ghi state.json:', e.message); }
}
function loadDragon() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Number(d.level) >= 1 && Number(d.level) <= 5) game.level = Math.floor(d.level);
    game.expInLevel = Math.max(0, Number(d.expInLevel) || 0);
    game.totalExp = Math.max(0, Number(d.totalExp) || 0);
    logLine(`💾 Đã nạp rồng đã lưu: CẤP ${game.level} (${LEVELS[game.level - 1].name}), EXP trong cấp ${game.expInLevel}, tổng EXP ${game.totalExp}.`);
  } catch (e) { console.error('[save] Không đọc được state.json:', e.message); }
}
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
let scoresDate = todayYmd();
function scoresFile() { return path.join(DATA_DIR, `scores-${scoresDate}.json`); }
let saveScoresTimer = null;
function saveScores() {
  clearTimeout(saveScoresTimer);
  saveScoresTimer = setTimeout(() => {
    try {
      const players = [...game.scores.values()].sort((a, b) => b.points - a.points);
      fs.writeFileSync(scoresFile(), JSON.stringify({ date: scoresDate, players }, null, 2));
    } catch (e) { console.error('[save] Lỗi ghi scores:', e.message); }
  }, 400);
}
function loadScores() {
  scoresDate = todayYmd();
  try {
    const f = scoresFile();
    if (!fs.existsSync(f)) return;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const p of (d.players || [])) {
      if (p && p.user) game.scores.set(String(p.uniqueId || p.user), { user: String(p.user), points: Number(p.points) || 0 });
    }
    logLine(`📊 Đã nạp Bảng Vàng hôm nay: ${game.scores.size} người.`);
  } catch (e) { console.error('[save] Không đọc được scores hôm nay:', e.message); }
}
function rollDayIfNeeded() {
  const now = todayYmd();
  if (now !== scoresDate) {
    game.scores.clear();
    scoresDate = now;
    logLine('🌅 Sang ngày mới — Bảng Vàng đã làm mới.');
  }
}

/* ------------------------------ WebSocket ------------------------------ */
const server = http.createServer(handleHttp);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

function send(ws, obj) {
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* bỏ qua */ } }
}
function broadcast(obj, role) {
  for (const ws of clients) {
    if (role && ws.role !== role) continue;
    send(ws, obj);
  }
}
function logLine(msg) {
  const line = `[${new Date().toLocaleTimeString('vi-VN', { hour12: false })}] ${msg}`;
  console.log(line);
  broadcast({ kind: 'log', line }, 'admin');
}

function publicState() {
  const lv = LEVELS[game.level - 1];
  return {
    level: game.level, levelName: lv.name, img: lv.img,
    expInLevel: Math.floor(game.expInLevel),
    expNeed: lv.need === Infinity ? null : lv.need,
    totalExp: Math.floor(game.totalExp),
    mouth: MOUTHS[game.level],
    pets: game.pets.map((p) => ({ ...p, sysName: PET_SYSTEMS[p.system].name, img: PET_SYSTEMS[p.system].img, color: PET_SYSTEMS[p.system].color })),
    top: [...game.scores.values()].sort((a, b) => b.points - a.points).slice(0, 10),
    golden: { active: Date.now() < game.goldenUntil, until: game.goldenUntil, nextAt: game.nextGoldenAt },
    paused: game.paused, tts: game.tts,
    mode: serverState.mode, conn: serverState.conn,
    relay: { ...serverState.relay },
    signServerConfigured: !!SIGN_SERVER_URL,
  };
}
function pushState() { broadcast({ kind: 'state', state: publicState() }); }
function pushStatus() { broadcast({ kind: 'status', mode: serverState.mode, conn: serverState.conn }); }
function fx(obj) { broadcast({ kind: 'fx', ...obj }); }

/* ------------------------------ Luật chơi ------------------------------ */
function addScore(user, uniqueId, pts) {
  if (!user || pts <= 0) return;
  const key = String(uniqueId || user);
  const cur = game.scores.get(key) || { user, points: 0 };
  cur.user = user; cur.points += pts;
  game.scores.set(key, cur);
  saveScores();
}

function grantPet(ev, forceSystem) {
  const key = String(ev.uniqueId || ev.user);
  const existing = game.pets.find((p) => p.key === key);
  const system = forceSystem || COMMON_SYSTEMS[Math.floor(Math.random() * COMMON_SYSTEMS.length)];
  if (existing) {
    if (forceSystem === 'ice' && existing.system !== 'ice') {
      existing.system = 'ice'; existing.rare = true;
      fx({ fx: 'pet-upgrade', user: ev.user, system: 'ice' });
      banner(`❄️ Rồng của ${ev.user} nâng cấp thành hệ BĂNG ĐÊM hiếm!`);
      return existing;
    }
    fx({ fx: 'pet-feed', user: ev.user, system: existing.system });
    return existing;
  }
  const pet = {
    id: Date.now() + '-' + Math.floor(Math.random() * 1e6),
    key, user: ev.user, uniqueId: ev.uniqueId || '',
    system, rare: system === 'ice', source: ev.type, at: Date.now(),
  };
  game.pets.push(pet);
  fx({ fx: 'pet-new', user: ev.user, system, rare: pet.rare });
  return pet;
}

let bannerTimer = null;
function banner(text, ms) {
  fx({ fx: 'banner', text, ms: ms || 4200 });
}

function applyExp(user, uniqueId, baseExp, ev) {
  let gained = baseExp;
  const golden = Date.now() < game.goldenUntil;
  if (golden) gained *= 2;
  if (gained > 0) {
    game.expInLevel += gained;
    game.totalExp += gained;
    addScore(user, uniqueId, gained);
  }
  // Lên cấp (có thể nhảy nhiều cấp với quà cực lớn)
  let guard = 0;
  while (game.level < 5 && game.expInLevel >= LEVELS[game.level - 1].need && guard++ < 5) {
    game.expInLevel -= LEVELS[game.level - 1].need;
    const from = game.level;
    game.level += 1;
    const toLv = LEVELS[game.level - 1];
    if (from === 1) {
      fx({ fx: 'hatch', toLevel: game.level });
      banner('🐣 RỒNG ĐÃ NỞ! Cả phòng cùng nuôi bé lớn nhé!');
      fx({ fx: 'tts', text: 'Rồng đã nở! Cả phòng cùng nuôi bé lớn nhé!' });
      logLine('🐣 RỒNG ĐÃ NỞ — lên CẤP 2 (Rồng Sơ Sinh)!');
    } else {
      fx({ fx: 'evolve', toLevel: game.level });
      banner(`✨ TIẾN HÓA THÀNH CÔNG! CẤP ${game.level} — ${toLv.name}!`);
      fx({ fx: 'tts', text: `Tiến hóa thành công! Rồng đã lên cấp ${game.level}, ${toLv.name}!` });
      logLine(`✨ TIẾN HÓA: CẤP ${from} → CẤP ${game.level} (${toLv.name})`);
    }
  }
  saveDragon();
  return gained;
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (!['like', 'chat', 'follow', 'share', 'gift'].includes(type)) return null;
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  const ev = { type, user: s(raw.user, 60) || 'Khán giả', uniqueId: s(raw.uniqueId || raw.user, 60) };
  if (type === 'chat') ev.text = s(raw.text, 200);
  if (type === 'like') ev.count = Math.max(1, Math.min(100000, Math.floor(Number(raw.count) || 1)));
  if (type === 'gift') {
    ev.coins = Math.max(1, Math.min(1000000, Math.floor(Number(raw.coins) || 1)));
    ev.giftName = s(raw.giftName, 80) || 'Quà tặng';
  }
  return ev;
}

function dispatchEvent(raw, source) {
  const ev = sanitizeEvent(raw);
  if (!ev) return null;
  rollDayIfNeeded();
  if (game.paused) { logLine(`⏸️ Đang tạm dừng — bỏ qua sự kiện ${ev.type} (${source}).`); return { ev, gained: 0 }; }
  let gained = 0;
  if (ev.type === 'like') {
    gained = applyExp(ev.user, ev.uniqueId, ev.count * 1, ev);
    fx({ fx: 'hearts', count: Math.min(30, ev.count), user: ev.user });
  } else if (ev.type === 'chat') {
    const isFeed = /ăn/i.test(ev.text || '');
    gained = applyExp(ev.user, ev.uniqueId, isFeed ? 10 : 5, ev);
    if (isFeed) {
      fx({ fx: 'feed', user: ev.user });
      banner(`🍖 ${ev.user} cho rồng ăn! +${Date.now() < game.goldenUntil ? 20 : 10} EXP`);
    }
  } else if (ev.type === 'share') {
    gained = applyExp(ev.user, ev.uniqueId, 20, ev);
    banner(`🔁 ${ev.user} vừa chia sẻ phòng live!`);
  } else if (ev.type === 'follow') {
    gained = applyExp(ev.user, ev.uniqueId, 50, ev);
    const pet = grantPet(ev);
    banner(`➕ ${ev.user} vừa follow — nhận rồng ${PET_SYSTEMS[pet.system].name} riêng!`);
    fx({ fx: 'tts', text: `${ev.user} vừa follow và nhận một rồng con hệ ${PET_SYSTEMS[pet.system].name}!` });
    logLine(`➕ FOLLOW: ${ev.user} → rồng riêng hệ ${PET_SYSTEMS[pet.system].name} [${source}]`);
  } else if (ev.type === 'gift') {
    gained = applyExp(ev.user, ev.uniqueId, ev.coins * 10, ev);
    const big = ev.coins >= BIG_GIFT_COINS;
    const pet = grantPet(ev, big ? 'ice' : undefined);
    if (big) {
      fx({ fx: 'fire', user: ev.user, coins: ev.coins });
      banner(`🔥 ${ev.user} tặng quà lớn ${ev.coins} xu — RỒNG PHUN LỬA ĂN MỪNG!`);
      fx({ fx: 'tts', text: `Cảm ơn ${ev.user} tặng quà lớn! Rồng phun lửa ăn mừng!` });
    } else {
      banner(`🎁 ${ev.user} tặng ${ev.giftName} (${ev.coins} xu) — rồng ${PET_SYSTEMS[pet.system].name} lớn nhanh!`);
    }
    logLine(`🎁 QUÀ: ${ev.user} tặng ${ev.giftName} — ${ev.coins} xu (+${gained} EXP) [${source}]`);
  }
  fx({ fx: 'event', event: ev, gained });
  pushState();
  return { ev, gained };
}

/* ------------------------------ Giờ vàng ------------------------------ */
function startGolden(source) {
  game.goldenUntil = Date.now() + 60 * 1000;
  game.nextGoldenAt = Date.now() + 30 * 60 * 1000;
  fx({ fx: 'golden' });
  banner('🌟 GIỜ VÀNG! Nhân đôi EXP trong 60 giây — thả tim, comment, tặng quà ngay!');
  fx({ fx: 'tts', text: 'Giờ vàng! Nhân đôi kinh nghiệm trong sáu mươi giây!' });
  logLine(`🌟 GIỜ VÀNG bắt đầu (60 giây, ×2 EXP) [${source}]`);
  pushState();
}
setInterval(() => {
  const now = Date.now();
  if (now >= game.nextGoldenAt && now >= game.goldenUntil) startGolden('tự động mỗi 30 phút');
  if (game.goldenUntil && now > game.goldenUntil) { game.goldenUntil = 0; pushState(); }
}, 1000).unref();

/* ------------------------------ DEMO ------------------------------ */
const DEMO_USERS = ['Tuấn Anh', 'Linh Cá', 'Hùng Dũng', 'Mai Anh', 'Bé Na', 'Khánh Ly', 'Minh Quân', 'Thảo Nguyên', 'Đức Huy', 'Phương Thảo', 'Anh Tuấn', 'Chị Hằng'];
const DEMO_CHATS = ['ăn', 'cho rồng ăn đi', 'rồng dễ thương quá', 'ăn nữa nè', 'cố lên sắp lên cấp rồi', 'xin vía rồng lớn nhanh', 'ăn ăn ăn', 'đẹp quá'];
let demoTimer = null;
function scheduleDemo() {
  clearTimeout(demoTimer);
  demoTimer = setTimeout(() => {
    if (serverState.mode === 'demo') {
      const user = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
      const r = Math.random();
      if (r < 0.34) dispatchEvent({ type: 'like', user, count: 5 + Math.floor(Math.random() * 55) }, 'DEMO');
      else if (r < 0.58) dispatchEvent({ type: 'chat', user, text: DEMO_CHATS[Math.floor(Math.random() * DEMO_CHATS.length)] }, 'DEMO');
      else if (r < 0.72) dispatchEvent({ type: 'follow', user }, 'DEMO');
      else if (r < 0.82) dispatchEvent({ type: 'share', user }, 'DEMO');
      else if (r < 0.94) dispatchEvent({ type: 'gift', user, coins: 1 + Math.floor(Math.random() * 30), giftName: 'Hoa hồng' }, 'DEMO');
      else dispatchEvent({ type: 'gift', user, coins: 199 + Math.floor(Math.random() * 300), giftName: 'Sư tử' }, 'DEMO');
    }
    scheduleDemo();
  }, 2000 + Math.random() * 3000);
}

/* ------------------------------ Connector TikTok ------------------------------ */
let conn = null;
let wantConnected = false;
function avatarOf(d) {
  const u = (d && d.user) || {};
  return u.profilePictureUrl || u.avatarUrl || (d && d.profilePictureUrl) || undefined;
}
function userOf(d) {
  return (d && d.user && (d.user.nickname || d.user.uniqueId)) || 'Khán giả';
}
function wireConnector(c) {
  const E = ttlc.WebcastEvent;
  c.on(E.CHAT, (d) => dispatchEvent({ type: 'chat', user: userOf(d), uniqueId: d.user && d.user.uniqueId, text: d.comment || d.content || '' }, 'TikTok'));
  c.on(E.LIKE, (d) => dispatchEvent({ type: 'like', user: userOf(d), uniqueId: d.user && d.user.uniqueId, count: d.likeCount ?? d.count ?? 1 }, 'TikTok'));
  c.on(E.GIFT, (d) => {
    if (d.gift && d.gift.type === 1 && d.repeatEnd !== 1 && d.repeatEnd !== true) return; // quà chuỗi: chỉ tính khi kết thúc
    const count = Math.max(1, Math.floor(Number(d.repeatCount || d.comboCount || 1)));
    const per = Number((d.extendedGiftInfo && d.extendedGiftInfo.diamondCount) ?? (d.gift && d.gift.diamondCount) ?? d.diamondCount);
    const coins = per > 0 ? per * count : count;
    dispatchEvent({ type: 'gift', user: userOf(d), uniqueId: d.user && d.user.uniqueId, coins, giftName: (d.extendedGiftInfo && d.extendedGiftInfo.name) || (d.gift && d.gift.name) || 'Quà tặng' }, 'TikTok');
  });
  c.on(E.FOLLOW, (d) => dispatchEvent({ type: 'follow', user: userOf(d), uniqueId: d.user && d.user.uniqueId }, 'TikTok'));
  c.on(E.SHARE, (d) => dispatchEvent({ type: 'share', user: userOf(d), uniqueId: d.user && d.user.uniqueId }, 'TikTok'));
  c.on(E.ROOM_USER, (d) => { serverState.conn.viewers = Number(d.viewerCount) || 0; pushStatus(); });
  c.on(ttlc.ControlEvent.DISCONNECTED, () => {
    serverState.conn.status = 'disconnected';
    serverState.conn.message = 'Mất kết nối TikTok.';
    logLine('🔌 Connector: mất kết nối.');
    pushStatus();
  });
  c.on(ttlc.ControlEvent.ERROR, (e) => {
    logLine(`❌ Connector lỗi: ${(e && e.message) || e}`);
  });
}
async function connectTikTok(username) {
  username = String(username || '').replace(/^@/, '').trim();
  if (!username) { logLine('⚠️ Chưa nhập username TikTok.'); return; }
  if (!SIGN_SERVER_URL) {
    serverState.conn = { status: 'error', username, roomId: '', viewers: 0, message: 'Mục thử nghiệm TLC đang TẮT: server không có env SIGN_SERVER_URL. Đường chính là extension relay.' };
    logLine('ℹ️ TLC là mục THỬ NGHIỆM, đang tắt vì chưa có env SIGN_SERVER_URL (sign server tự host). Muốn thử: dừng server, chạy SIGN_SERVER_URL=http://localhost:<cổng-sign> npm start. Đường chính vẫn là extension relay.');
    pushStatus();
    return;
  }
  if (!ttlc) { logLine('❌ Không kết nối được: thư viện tiktok-live-connector chưa nạp (chạy npm install rồi khởi động lại với SIGN_SERVER_URL).'); return; }
  await disconnectTikTok(true);
  wantConnected = true;
  serverState.conn = { status: 'connecting', username, roomId: '', viewers: 0, message: `Đang kết nối @${username}…` };
  pushStatus();
  logLine(`🔗 Đang kết nối phòng live @${username}…`);
  try {
    /* Trỏ toàn bộ yêu cầu ký về sign server TỰ HOST qua basePath của
       SDK client (tham số eulerApiInstance là tên API của thư viện) —
       không dùng endpoint mặc định của bên thứ ba. */
    const sdk = await import('tiktok-live-api-sdk');
    const SignClient = sdk.default;
    const signInstance = new SignClient({ basePath: SIGN_SERVER_URL });
    conn = new ttlc.TikTokLiveConnection(username, { enableExtendedGiftInfo: true, eulerApiInstance: signInstance });
    wireConnector(conn);
    const st = await conn.connect();
    serverState.conn.status = 'connected';
    serverState.conn.roomId = String((st && st.roomId) || '');
    serverState.conn.message = `Đã bám phòng @${username}.`;
    logLine(`✅ ĐÃ BÁM PHÒNG @${username} (roomId ${serverState.conn.roomId || '?'}). Sự kiện thật sẽ chảy vào game.`);
  } catch (e) {
    serverState.conn.status = 'error';
    serverState.conn.message = `Kết nối thất bại: ${(e && e.message) || e}`;
    logLine(`❌ KẾT NỐI THẤT BẠI @${username}: ${(e && e.message) || e}`);
    logLine('ℹ️ Kiểm tra: username đúng chưa, phòng có đang LIVE không, sign server tự host (SIGN_SERVER_URL) có đang chạy không. Server vẫn chạy DEMO/RELAY/THỦ CÔNG bình thường.');
    conn = null;
  }
  pushStatus();
}
async function disconnectTikTok(silent) {
  wantConnected = false;
  if (conn) {
    try { conn.disconnect(); } catch (e) { /* bỏ qua */ }
    conn = null;
  }
  if (!silent) {
    serverState.conn = { status: 'idle', username: '', roomId: '', viewers: 0, message: 'Đã ngắt kết nối.' };
    logLine('🔌 Đã ngắt kết nối TikTok.');
    pushStatus();
  }
}

/* ------------------------------ HTTP ------------------------------ */
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html',
  '/stage.js': 'stage.js', '/style.css': 'style.css',
  '/admin': 'admin.html', '/admin.html': 'admin.html', '/admin.js': 'admin.js',
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json',
};
function isLocalHost(req) {
  const host = String((req.headers && req.headers.host) || '').toLowerCase();
  if (!host) return true;
  const hn = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return hn === 'localhost' || hn === '127.0.0.1' || hn === '::1';
}
const LOCAL_ONLY = new Set(['/admin', '/admin.html', '/admin.js', '/test-event', '/api/status']);

function readJsonBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    try { cb(null, JSON.parse(body || '{}')); } catch (e) { cb(e); }
  });
  req.on('error', () => cb(new Error('Lỗi đọc body')));
}
function jsonRes(res, code, obj, extraHeaders) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) });
  res.end(JSON.stringify(obj));
}
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/* Chuẩn hoá payload của extension relay → sự kiện nội bộ (cùng shape
   với /test-event để dùng chung dispatchEvent). */
function relayToEvent(kind, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pl = (raw.player && typeof raw.player === 'object') ? raw.player : {};
  const user = String(pl.nickname || 'Khán giả').slice(0, 60);
  const uniqueId = String(pl.uniqueId || pl.nickname || 'viewer').slice(0, 60);
  if (kind === 'chat') return { type: 'chat', user, uniqueId, text: String(raw.comment == null ? '' : raw.comment) };
  if (kind === 'gift') return { type: 'gift', user, uniqueId, coins: Math.max(1, Math.floor(Number(raw.diamonds) || 10)), giftName: String(raw.giftName || 'Món Quà').slice(0, 80) };
  if (kind === 'follow') return { type: 'follow', user, uniqueId };
  if (kind === 'like') return { type: 'like', user: 'Phòng live', uniqueId: 'room', count: Math.max(1, Math.floor(Number(raw.count) || 1)) };
  if (kind === 'share') return { type: 'share', user, uniqueId };
  return null;
}
const RELAY_KINDS = new Set(['chat', 'gift', 'follow', 'like', 'share']);
function handleRelay(req, res, kind) {
  if (!RELAY_KINDS.has(kind)) return jsonRes(res, 404, { ok: false, error: 'Relay kind không tồn tại' }, CORS_HEADERS);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); return res.end(); }
  if (req.method !== 'POST') return jsonRes(res, 405, { ok: false, error: 'Chỉ nhận POST' }, CORS_HEADERS);
  readJsonBody(req, (err, raw) => {
    if (err) return jsonRes(res, 400, { ok: false, error: 'JSON không hợp lệ' }, CORS_HEADERS);
    const ev = relayToEvent(kind, raw);
    if (!ev) return jsonRes(res, 400, { ok: false, error: 'Payload relay không hợp lệ' }, CORS_HEADERS);
    const before = { level: game.level, totalExp: game.totalExp, pets: game.pets.length };
    const out = dispatchEvent(ev, `relay-${kind}`);
    if (!out) return jsonRes(res, 400, { ok: false, error: 'Sự kiện không hợp lệ' }, CORS_HEADERS);
    const R = serverState.relay;
    R.lastAt = Date.now(); R.lastKind = kind; R.count += 1; R.byKind[kind] = (R.byKind[kind] || 0) + 1;
    if (kind !== 'like' || R.byKind.like === 1) {
      logLine(`📡 RELAY ${kind.toUpperCase()} ← ${ev.user}${kind === 'gift' ? ` (${ev.coins} xu)` : ''} [tổng relay: ${R.count}]`);
    }
    pushState();
    jsonRes(res, 200, {
      ok: true, gained: out.gained, before,
      after: { level: game.level, totalExp: game.totalExp, pets: game.pets.length },
      fireTriggered: kind === 'gift' && ev.coins >= BIG_GIFT_COINS && !!MOUTHS[game.level],
    }, CORS_HEADERS);
  });
}

function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p.startsWith('/api/relay/')) return handleRelay(req, res, p.slice('/api/relay/'.length));
  if (!isLocalHost(req) && LOCAL_ONLY.has(p)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Chỉ mở được trên máy của host (localhost).');
  }
  if (p === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...publicState(), connectorLoaded: !!ttlc }));
  }
  if (p === '/test-event') {
    if (req.method !== 'POST') { res.writeHead(405, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'Chỉ nhận POST' })); }
    readJsonBody(req, (err, raw) => {
      if (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'JSON không hợp lệ' })); }
      const before = { level: game.level, totalExp: game.totalExp, pets: game.pets.length };
      const out = dispatchEvent(raw, 'test-event');
      if (!out) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'Sự kiện không hợp lệ (type phải là like/chat/follow/share/gift)' })); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true, gained: out.gained,
        before, after: { level: game.level, totalExp: game.totalExp, pets: game.pets.length },
        fireTriggered: raw.type === 'gift' && Number(raw.coins) >= BIG_GIFT_COINS && !!MOUTHS[game.level],
        state: publicState(),
      }));
    });
    return;
  }
  let file = STATIC[p];
  if (!file && p.startsWith('/assets/')) {
    const name = path.basename(p);
    if (/^[a-z0-9-]+\.webp$/i.test(name)) file = path.join('assets', name);
  }
  if (!file || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Không tìm thấy.');
  }
  fs.readFile(path.join(DIR, file), (err, data) => {
    if (err) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Lỗi đọc file.'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/* ------------------------------ WS commands ------------------------------ */
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  ws.role = url.searchParams.get('role') === 'admin' ? 'admin' : 'stage';
  if (ws.role === 'admin' && !isLocalHost(req)) { ws.close(); return; }
  clients.add(ws);
  send(ws, { kind: 'state', state: publicState() });
  send(ws, { kind: 'status', mode: serverState.mode, conn: serverState.conn });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }
    if (ws.role !== 'admin' || !m || m.kind !== 'cmd') return;
    handleAdminCmd(m);
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

const SIM_USERS = ['Khách Test', 'Bạn Mới', 'Fan Cứng', 'Người Qua Đường'];
function simUser() { return SIM_USERS[Math.floor(Math.random() * SIM_USERS.length)]; }
function handleAdminCmd(m) {
  switch (m.cmd) {
    case 'connect': connectTikTok(m.username); break;
    case 'disconnect': disconnectTikTok(false); break;
    case 'setMode': {
      const mode = m.mode === 'live' ? 'relay' : m.mode; // 'live' là tên cũ → RELAY
      if (['demo', 'relay', 'manual'].includes(mode)) {
        serverState.mode = mode;
        logLine(`🎛️ Chế độ → ${mode.toUpperCase()}${mode === 'relay' ? ' (extension)' : ''}`);
        pushStatus(); pushState();
      }
      break;
    }
    case 'sim': {
      const u = simUser();
      if (m.sim === 'like100') dispatchEvent({ type: 'like', user: u, count: 100 }, 'admin');
      else if (m.sim === 'feed') dispatchEvent({ type: 'chat', user: u, text: 'ăn' }, 'admin');
      else if (m.sim === 'follow') dispatchEvent({ type: 'follow', user: u + ' ' + Math.floor(Math.random() * 999) }, 'admin');
      else if (m.sim === 'giftSmall') dispatchEvent({ type: 'gift', user: u, coins: 10, giftName: 'Hoa hồng' }, 'admin');
      else if (m.sim === 'giftBig') dispatchEvent({ type: 'gift', user: u, coins: 299, giftName: 'Sư tử' }, 'admin');
      else if (m.sim === 'golden') startGolden('admin');
      else if (m.sim === 'fire') { fx({ fx: 'fire', user: 'Host (nút admin)', coins: 0 }); banner('🔥 Host kích hoạt RỒNG PHUN LỬA!'); }
      else if (m.sim === 'pause') { game.paused = true; logLine('⏸️ Đã TẠM DỪNG nhận EXP.'); pushState(); }
      else if (m.sim === 'resume') { game.paused = false; logLine('▶️ Đã TIẾP TỤC nhận EXP.'); pushState(); }
      break;
    }
    case 'tts': game.tts = !!m.on; logLine(`🔊 TTS sân khấu: ${game.tts ? 'BẬT' : 'TẮT'}`); pushState(); break;
    case 'resetSession':
      game.scores.clear(); game.pets = []; saveScores();
      logLine('🧹 Reset phiên: đã xoá điểm ngày + rồng riêng. Cấp rồng chính GIỮ NGUYÊN.');
      banner('🧹 Phiên mới bắt đầu!');
      pushState();
      break;
    case 'resetDragon':
      game.level = 1; game.expInLevel = 0; game.totalExp = 0; saveDragon();
      logLine('🥚 Đã RESET CẤP RỒNG về cấp 1 (trứng) theo lệnh admin.');
      banner('🥚 Rồng quay lại làm trứng — nuôi lại từ đầu!');
      pushState();
      break;
  }
}

/* ------------------------------ Khởi động ------------------------------ */
loadDragon();
loadScores();
server.listen(PORT, () => {
  logLine(`🐉 NUÔI RỒNG ONLINE chạy tại http://localhost:${PORT} — sân khấu / , quản trị /admin`);
  logLine(`🎛️ Chế độ mặc định: DEMO (tự sinh sự kiện). Rồng hiện CẤP ${game.level}.`);
  scheduleDemo();
});
server.on('error', (e) => { console.error('Lỗi server:', e.message); });
