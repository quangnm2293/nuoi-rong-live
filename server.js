/* =====================================================================
   NUÔI RỒNG ONLINE — server.js (V2 — MỖI NGƯỜI 1 CON RỒNG RIÊNG)
   - Sân khấu 9:16 tại / , trang quản trị tại /admin, WebSocket /ws.
   - LUẬT MỚI (anh Quang chốt 04/11): BỎ mô hình "cả phòng nuôi chung
     1 rồng chính". Mỗi người xem sở hữu 1 dragon riêng, được tạo ngay
     ở TƯƠNG TÁC ĐẦU TIÊN bất kỳ (chat/like/follow/gift/share). EXP của
     hành động nào cộng cho dragon của CHÍNH người đó; ai cũng tiến hóa
     được qua 5 cấp theo TỔNG EXP tích lũy của dragon mình:
       cấp 2 ≥ 1.000 • cấp 3 ≥ 4.000 • cấp 4 ≥ 12.000 • cấp 5 ≥ 32.000.
   - "featured" = dragon của người vừa tương tác gần nhất (rồng lớn
     giữa sân khấu hiển thị dragon này, theo đúng cấp của nó).
   - Đàn rồng lưu bền ở data/state.json (qua phiên không mất). Điểm
     theo ngày vẫn lưu data/scores-YYYY-MM-DD.json (việc phụ trợ cũ);
     Bảng Vàng lấy từ EXP của đàn rồng.
   - Nguồn sự kiện CHÍNH: extension Chrome relay (thư mục extension/)
     quét DOM trang phòng live TikTok đang mở và POST vào
     /api/relay/{chat,gift,follow,like,share} — KHÔNG dùng dịch vụ
     ký bên thứ ba trong bất kỳ đường nào.
   - 3 chế độ: DEMO (mặc định, tự sinh sự kiện) / RELAY (extension) /
     THỦ CÔNG (chỉ nhận lệnh mô phỏng từ admin + /test-event).
   - tiktok-live-connector chỉ là module THỬ NGHIỆM, TẮT mặc định:
     chỉ nạp + kích hoạt khi có env SIGN_SERVER_URL trỏ tới sign
     server TỰ HOST. Không có env này thì tuyệt đối không gọi ra ngoài.
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
  { lv: 1, name: 'Trứng Rồng', img: 'egg.webp' },
  { lv: 2, name: 'Rồng Sơ Sinh', img: 'baby.webp' },
  { lv: 3, name: 'Rồng Thiếu Niên', img: 'juvenile.webp' },
  { lv: 4, name: 'Rồng Trưởng Thành', img: 'adult.webp' },
  { lv: 5, name: 'Thần Rồng', img: 'divine.webp' },
];
/* Tổng EXP tích lũy TỐI THIỂU để ĐẠT cấp (index = cấp - 1). */
const LEVEL_MIN_EXP = [0, 1000, 4000, 12000, 32000];
function levelOf(exp) {
  let lv = 1;
  for (let i = 1; i < LEVEL_MIN_EXP.length; i++) if (exp >= LEVEL_MIN_EXP[i]) lv = i + 1;
  return lv;
}
function levelProgress(exp) {
  const lv = levelOf(exp);
  if (lv >= 5) return { lv, into: exp - LEVEL_MIN_EXP[4], span: null, pct: 100 };
  const base = LEVEL_MIN_EXP[lv - 1];
  const next = LEVEL_MIN_EXP[lv];
  return { lv, into: exp - base, span: next - base, pct: Math.min(100, ((exp - base) / (next - base)) * 100) };
}
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
/* Hệ của dragon (viền màu + tên gọi). Băng Đêm = hiếm, chỉ từ quà lớn. */
const SYSTEMS = {
  fire: { key: 'fire', name: 'Lửa', color: '#ff6e3c' },
  water: { key: 'water', name: 'Nước', color: '#5aaaff' },
  flower: { key: 'flower', name: 'Hoa', color: '#ff96c8' },
  ice: { key: 'ice', name: 'Băng Đêm', color: '#aa8cff' },
};
const COMMON_SYSTEMS = ['fire', 'water', 'flower'];
const BIG_GIFT_COINS = 99;

/* ------------------------------ Trạng thái ------------------------------ */
/* dragon: {uniqueId, nickname, avatarUrl, element, exp,
            createdAt, lastActionAt} — cấp SUY RA từ exp. */
const game = {
  dragons: new Map(),  // uniqueId -> dragon
  featuredId: '',      // dragon của người vừa tương tác gần nhất
  paused: false,
  tts: true,
  goldenUntil: 0,
  nextGoldenAt: Date.now() + 30 * 60 * 1000,
  scores: new Map(),   // uniqueId -> {user, points} — điểm theo NGÀY (phụ trợ)
};
const serverState = {
  mode: 'demo',
  conn: { status: 'idle', username: '', roomId: '', viewers: 0, message: 'Chưa kết nối TikTok.' },
  relay: { lastAt: 0, lastKind: '', count: 0, byKind: {} },
};

/* ------------------------------ Lưu bền ------------------------------ */
const STATE_FILE = path.join(DATA_DIR, 'state.json');
let saveDragonsTimer = null;
function flushDragons() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      version: 2, featuredId: game.featuredId, dragons: [...game.dragons.values()],
    }, null, 2));
  } catch (e) { console.error('[save] Lỗi ghi state.json:', e.message); }
}
function saveDragons() {
  clearTimeout(saveDragonsTimer);
  saveDragonsTimer = setTimeout(flushDragons, 300);
}
process.on('SIGTERM', () => { flushDragons(); process.exit(0); });
process.on('SIGINT', () => { flushDragons(); process.exit(0); });

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
    logLine(`📊 Đã nạp điểm ngày hôm nay: ${game.scores.size} người.`);
  } catch (e) { console.error('[save] Không đọc được scores hôm nay:', e.message); }
}
function rollDayIfNeeded() {
  const now = todayYmd();
  if (now !== scoresDate) {
    game.scores.clear();
    scoresDate = now;
    logLine('🌅 Sang ngày mới — điểm ngày đã làm mới (đàn rồng giữ nguyên).');
  }
}
/* Điểm ngày của 1 người (dùng cho migration từ luật cũ). */
function scoreExpOf(key, user) {
  const s = game.scores.get(String(key));
  if (s) return s.points;
  for (const v of game.scores.values()) if (v.user === user) return v.points;
  return 0;
}
/* Migration luật cũ → luật mới: mỗi pet cũ thành 1 dragon (exp lấy từ
   điểm ngày của chủ, không có thì 0); điểm ngày của người chưa có pet
   cũng thành dragon để không ai mất tiến trình. */
function migrateOldState(d) {
  let n = 0;
  const pets = Array.isArray(d && d.pets) ? d.pets : [];
  for (const p of pets) {
    const key = String((p && (p.key || p.uniqueId || p.user)) || '');
    if (!key || game.dragons.has(key)) continue;
    game.dragons.set(key, {
      uniqueId: key, nickname: String(p.user || 'Khán giả'), avatarUrl: '',
      element: SYSTEMS[p.system] ? p.system : (p.rare ? 'ice' : 'fire'),
      exp: scoreExpOf(key, p.user), createdAt: Number(p.at) || Date.now(), lastActionAt: Date.now(),
    });
    n++;
  }
  for (const [key, s] of game.scores) {
    if (game.dragons.has(key)) continue;
    game.dragons.set(key, {
      uniqueId: key, nickname: s.user, avatarUrl: '', element: 'fire',
      exp: s.points, createdAt: Date.now(), lastActionAt: Date.now(),
    });
    n++;
  }
  if (n > 0) {
    const top = sortedDragons()[0];
    game.featuredId = top ? top.uniqueId : '';
    logLine(`🔄 MIGRATION luật mới: đã chuyển ${n} rồng/điểm cũ thành đàn rồng của từng người.`);
    saveDragons();
  }
}
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) { migrateOldState(null); return; }
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (d && Array.isArray(d.dragons)) {
      for (const raw of d.dragons) {
        if (!raw || !raw.uniqueId) continue;
        const key = String(raw.uniqueId);
        game.dragons.set(key, {
          uniqueId: key,
          nickname: String(raw.nickname || 'Khán giả'),
          avatarUrl: String(raw.avatarUrl || ''),
          element: SYSTEMS[raw.element] ? raw.element : 'fire',
          exp: Math.max(0, Number(raw.exp) || 0),
          createdAt: Number(raw.createdAt) || Date.now(),
          lastActionAt: Number(raw.lastActionAt) || Date.now(),
        });
      }
      game.featuredId = String(d.featuredId || '');
      if (!game.dragons.has(game.featuredId)) {
        const top = sortedDragons()[0];
        game.featuredId = top ? top.uniqueId : '';
      }
      logLine(`💾 Đã nạp đàn rồng đã lưu: ${game.dragons.size} con.`);
      return;
    }
    migrateOldState(d); // state.json định dạng cũ {level, expInLevel, totalExp, pets?}
  } catch (e) { console.error('[save] Không đọc được state.json:', e.message); }
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

function sortedDragons() {
  return [...game.dragons.values()].sort((a, b) => (b.exp - a.exp) || (a.createdAt - b.createdAt));
}
function featuredRaw() {
  return game.dragons.get(game.featuredId) || sortedDragons()[0] || null;
}
function publicDragon(d) {
  const pr = levelProgress(d.exp);
  const sys = SYSTEMS[d.element] || SYSTEMS.fire;
  return {
    uniqueId: d.uniqueId, nickname: d.nickname, avatarUrl: d.avatarUrl,
    element: d.element, sysName: sys.name, color: sys.color,
    exp: Math.floor(d.exp), level: pr.lv, levelName: LEVELS[pr.lv - 1].name, img: LEVELS[pr.lv - 1].img,
    expInLevel: Math.floor(pr.into), expNeed: pr.span, progress: Math.round(pr.pct * 10) / 10,
    mouth: MOUTHS[pr.lv], createdAt: d.createdAt, lastActionAt: d.lastActionAt,
  };
}
function publicState() {
  const list = sortedDragons().map(publicDragon);
  const featured = list.find((d) => d.uniqueId === game.featuredId) || list[0] || null;
  return {
    dragons: list,
    featuredId: featured ? featured.uniqueId : '',
    featured,
    top: list.slice(0, 10).map((d) => ({ user: d.nickname, uniqueId: d.uniqueId, points: d.exp, level: d.level })),
    /* Tương thích client cũ: các trường rồng-chung nay trỏ về dragon
       FEATURED (không còn rồng chung nữa) để client cũ không lỗi. */
    level: featured ? featured.level : 1,
    levelName: featured ? featured.levelName : 'Trứng Rồng',
    img: featured ? featured.img : 'egg.webp',
    expInLevel: featured ? featured.expInLevel : 0,
    expNeed: featured ? featured.expNeed : 1000,
    totalExp: featured ? featured.exp : 0,
    mouth: featured ? featured.mouth : null,
    pets: [],
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
function banner(text, ms) { fx({ fx: 'banner', text, ms: ms || 4200 }); }

/* ------------------------------ Luật chơi ------------------------------ */
function addScore(user, uniqueId, pts) {
  if (!user || pts <= 0) return;
  const key = String(uniqueId || user);
  const cur = game.scores.get(key) || { user, points: 0 };
  cur.user = user; cur.points += pts;
  game.scores.set(key, cur);
  saveScores();
}

/* Tạo dragon cho người xem ở TƯƠNG TÁC ĐẦU TIÊN bất kỳ. */
function ensureDragon(ev) {
  const key = String(ev.uniqueId || ev.user);
  let d = game.dragons.get(key);
  if (d) {
    if (ev.user) d.nickname = ev.user;
    if (ev.avatarUrl) d.avatarUrl = ev.avatarUrl;
    d.lastActionAt = Date.now();
    game.featuredId = key;
    return { dragon: d, created: false };
  }
  d = {
    uniqueId: key,
    nickname: ev.user || 'Khán giả',
    avatarUrl: ev.avatarUrl || '',
    element: COMMON_SYSTEMS[Math.floor(Math.random() * COMMON_SYSTEMS.length)],
    exp: 0,
    createdAt: Date.now(),
    lastActionAt: Date.now(),
  };
  game.dragons.set(key, d);
  game.featuredId = key;
  fx({ fx: 'dragon-new', uniqueId: key, nickname: d.nickname, element: d.element });
  logLine(`🐉 RỒNG MỚI: ${d.nickname} nhận rồng riêng hệ ${SYSTEMS[d.element].name} (tương tác đầu tiên: ${ev.type}).`);
  if (ev.type === 'follow' || ev.type === 'gift') {
    banner(`🐉 Chào ${d.nickname} — bạn đã có 1 con rồng riêng hệ ${SYSTEMS[d.element].name}, hãy nuôi nó tiến hóa nhé!`);
  }
  saveDragons();
  return { dragon: d, created: true };
}

/* Cộng EXP cho dragon của CHÍNH người hành động; lo tiến hóa/nở. */
function applyExp(dragon, baseExp) {
  let gained = baseExp;
  if (Date.now() < game.goldenUntil) gained *= 2;
  if (gained <= 0) return { gained: 0, fromLevel: levelOf(dragon.exp), toLevel: levelOf(dragon.exp) };
  const fromLevel = levelOf(dragon.exp);
  dragon.exp += gained;
  dragon.lastActionAt = Date.now();
  const toLevel = levelOf(dragon.exp);
  if (toLevel > fromLevel) {
    game.featuredId = dragon.uniqueId;
    const lvName = LEVELS[toLevel - 1].name;
    if (fromLevel === 1) {
      fx({ fx: 'hatch', uniqueId: dragon.uniqueId, nickname: dragon.nickname, toLevel, mouth: MOUTHS[toLevel] });
      banner(`🐣 Rồng của ${dragon.nickname} ĐÃ NỞ — lên CẤP 2 (${lvName})!`);
      fx({ fx: 'tts', text: `Rồng của ${dragon.nickname} đã nở!` });
      logLine(`🐣 NỞ: rồng của ${dragon.nickname} lên CẤP 2 (${lvName}) — tổng EXP ${Math.floor(dragon.exp)}.`);
    } else {
      fx({ fx: 'evolve', uniqueId: dragon.uniqueId, nickname: dragon.nickname, toLevel, mouth: MOUTHS[toLevel] });
      banner(`✨ Rồng của ${dragon.nickname} TIẾN HÓA lên CẤP ${toLevel} — ${lvName}!`);
      fx({ fx: 'tts', text: `Rồng của ${dragon.nickname} đã tiến hóa lên cấp ${toLevel}, ${lvName}!` });
      logLine(`✨ TIẾN HÓA: rồng của ${dragon.nickname} CẤP ${fromLevel} → CẤP ${toLevel} (${lvName}) — tổng EXP ${Math.floor(dragon.exp)}.`);
    }
  }
  saveDragons();
  return { gained, fromLevel, toLevel };
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (!['like', 'chat', 'follow', 'share', 'gift'].includes(type)) return null;
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  const ev = { type, user: s(raw.user, 60) || 'Khán giả', uniqueId: s(raw.uniqueId || raw.user, 60), avatarUrl: s(raw.avatarUrl, 300) };
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
  if (game.paused) { logLine(`⏸️ Đang tạm dừng — bỏ qua sự kiện ${ev.type} (${source}).`); return { ev, gained: 0, dragon: null }; }
  /* Like từ extension là bộ đếm của CẢ PHÒNG (uniqueId 'room') — không
     thuộc về ai nên không tạo dragon và không cộng EXP cho ai. */
  const isRoomLikes = ev.uniqueId === 'room';
  let dragon = null, created = false;
  if (!isRoomLikes) {
    const r = ensureDragon(ev);
    dragon = r.dragon; created = r.created;
  }
  let res = { gained: 0, fromLevel: dragon ? levelOf(dragon.exp) : 0, toLevel: dragon ? levelOf(dragon.exp) : 0 };
  let fired = false;
  if (ev.type === 'like') {
    if (dragon) { res = applyExp(dragon, ev.count * 1); addScore(ev.user, ev.uniqueId, res.gained); }
    fx({ fx: 'hearts', count: Math.min(30, ev.count), user: ev.user });
  } else if (ev.type === 'chat') {
    const isFeed = /ăn/i.test(ev.text || '');
    if (dragon) { res = applyExp(dragon, isFeed ? 10 : 5); addScore(ev.user, ev.uniqueId, res.gained); }
    if (isFeed && dragon) {
      fx({ fx: 'feed', user: ev.user });
      banner(`🍖 ${ev.user} cho rồng của mình ăn! +${res.gained} EXP`);
    }
  } else if (ev.type === 'share') {
    if (dragon) { res = applyExp(dragon, 20); addScore(ev.user, ev.uniqueId, res.gained); }
    banner(`🔁 ${ev.user} vừa chia sẻ phòng live!`);
  } else if (ev.type === 'follow') {
    if (dragon) { res = applyExp(dragon, 50); addScore(ev.user, ev.uniqueId, res.gained); }
    if (!created) banner(`➕ ${ev.user} vừa follow — rồng của bạn +${res.gained} EXP!`);
    logLine(`➕ FOLLOW: ${ev.user} → rồng ${created ? 'MỚI' : 'của bạn'} +${res.gained} EXP [${source}]`);
  } else if (ev.type === 'gift') {
    if (dragon) { res = applyExp(dragon, ev.coins * 10); addScore(ev.user, ev.uniqueId, res.gained); }
    const big = ev.coins >= BIG_GIFT_COINS;
    if (big && dragon) {
      if (dragon.element !== 'ice') {
        dragon.element = 'ice';
        fx({ fx: 'ice-upgrade', uniqueId: dragon.uniqueId, nickname: dragon.nickname });
        banner(`❄️ Rồng của ${ev.user} nâng cấp thành hệ BĂNG ĐÊM hiếm!`);
        saveDragons();
      }
      const lv = levelOf(dragon.exp);
      fx({ fx: 'fire', uniqueId: dragon.uniqueId, nickname: ev.user, user: ev.user, coins: ev.coins, level: lv, mouth: MOUTHS[lv] });
      fired = true;
      banner(`🔥 ${ev.user} tặng quà lớn ${ev.coins} xu — rồng của bạn PHUN LỬA ăn mừng!`);
      fx({ fx: 'tts', text: `Cảm ơn ${ev.user} tặng quà lớn! Rồng của bạn phun lửa ăn mừng!` });
    } else if (dragon) {
      banner(`🎁 ${ev.user} tặng ${ev.giftName} (${ev.coins} xu) — rồng của bạn +${res.gained} EXP!`);
    }
    logLine(`🎁 QUÀ: ${ev.user} tặng ${ev.giftName} — ${ev.coins} xu (+${res.gained} EXP cho rồng của ${ev.user}) [${source}]`);
  }
  fx({ fx: 'event', event: ev, gained: res.gained });
  pushState();
  return { ev, gained: res.gained, dragon, created, fromLevel: res.fromLevel, toLevel: res.toLevel, fired };
}

/* ------------------------------ Giờ vàng ------------------------------ */
function startGolden(source) {
  game.goldenUntil = Date.now() + 60 * 1000;
  game.nextGoldenAt = Date.now() + 30 * 60 * 1000;
  fx({ fx: 'golden' });
  banner('🌟 GIỜ VÀNG! Nhân đôi EXP cho MỌI rồng trong 60 giây — thả tim, comment, tặng quà ngay!');
  fx({ fx: 'tts', text: 'Giờ vàng! Nhân đôi kinh nghiệm trong sáu mươi giây!' });
  logLine(`🌟 GIỜ VÀNG bắt đầu (60 giây, ×2 EXP cho mọi dragon) [${source}]`);
  pushState();
}
setInterval(() => {
  const now = Date.now();
  if (now >= game.nextGoldenAt && now >= game.goldenUntil) startGolden('tự động mỗi 30 phút');
  if (game.goldenUntil && now > game.goldenUntil) { game.goldenUntil = 0; pushState(); }
}, 1000).unref();

/* ------------------------------ DEMO ------------------------------
   Nhiều người xem giả lập, MỖI NGƯỜI NUÔI DRAGON RIÊNG. EXP phân bổ
   theo "hồ sơ" từng người: người hay tặng quà lớn (big cao) lên cấp
   nhanh, người nhẹ tay ở cấp thấp — để thấy nhiều dragon ở nhiều cấp
   khác nhau và có tiến hóa diễn ra, không dồn hết vào 1 người. */
const DEMO_PROFILES = [
  { user: 'Chị Hằng', w: 6, big: 0.55 },
  { user: 'Minh Quân', w: 4, big: 0.38 },
  { user: 'Tuấn Anh', w: 3, big: 0.22 },
  { user: 'Linh Cá', w: 2, big: 0.10 },
  { user: 'Hùng Dũng', w: 1, big: 0.05 },
  { user: 'Mai Anh', w: 1, big: 0.02 },
  { user: 'Bé Na', w: 1, big: 0 },
  { user: 'Khánh Ly', w: 1, big: 0 },
  { user: 'Thảo Nguyên', w: 1, big: 0 },
  { user: 'Đức Huy', w: 1, big: 0 },
  { user: 'Phương Thảo', w: 1, big: 0 },
  { user: 'Anh Tuấn', w: 1, big: 0 },
];
const DEMO_TOTAL_W = DEMO_PROFILES.reduce((a, p) => a + p.w, 0);
function pickDemoProfile() {
  let x = Math.random() * DEMO_TOTAL_W;
  for (const p of DEMO_PROFILES) { x -= p.w; if (x <= 0) return p; }
  return DEMO_PROFILES[0];
}
const DEMO_CHATS = ['ăn', 'cho rồng ăn đi', 'rồng của mình dễ thương quá', 'ăn nữa nè', 'cố lên sắp lên cấp rồi', 'xin vía rồng lớn nhanh', 'ăn ăn ăn', 'rồng của tui cấp mấy rồi'];
function demoAct() {
  const prof = pickDemoProfile();
  const user = prof.user;
  const r = Math.random();
  if (r < 0.30) dispatchEvent({ type: 'like', user, count: 10 + Math.floor(Math.random() * 80) }, 'DEMO');
  else if (r < 0.54) dispatchEvent({ type: 'chat', user, text: DEMO_CHATS[Math.floor(Math.random() * DEMO_CHATS.length)] }, 'DEMO');
  else if (r < 0.64) dispatchEvent({ type: 'follow', user }, 'DEMO');
  else if (r < 0.72) dispatchEvent({ type: 'share', user }, 'DEMO');
  else if (Math.random() < prof.big) dispatchEvent({ type: 'gift', user, coins: 199 + Math.floor(Math.random() * 300), giftName: 'Sư tử' }, 'DEMO');
  else dispatchEvent({ type: 'gift', user, coins: 1 + Math.floor(Math.random() * 30), giftName: 'Hoa hồng' }, 'DEMO');
}
let demoTimer = null;
function scheduleDemo() {
  clearTimeout(demoTimer);
  demoTimer = setTimeout(() => {
    if (serverState.mode === 'demo') {
      demoAct();
      if (Math.random() < 0.6) demoAct(); // nhịp phòng đông: thường có 2 người cùng lúc
    }
    scheduleDemo();
  }, 1300 + Math.random() * 1300);
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
  c.on(E.CHAT, (d) => dispatchEvent({ type: 'chat', user: userOf(d), uniqueId: d.user && d.user.uniqueId, avatarUrl: avatarOf(d), text: d.comment || d.content || '' }, 'TikTok'));
  c.on(E.LIKE, (d) => dispatchEvent({ type: 'like', user: userOf(d), uniqueId: d.user && d.user.uniqueId, avatarUrl: avatarOf(d), count: d.likeCount ?? d.count ?? 1 }, 'TikTok'));
  c.on(E.GIFT, (d) => {
    if (d.gift && d.gift.type === 1 && d.repeatEnd !== 1 && d.repeatEnd !== true) return; // quà chuỗi: chỉ tính khi kết thúc
    const count = Math.max(1, Math.floor(Number(d.repeatCount || d.comboCount || 1)));
    const per = Number((d.extendedGiftInfo && d.extendedGiftInfo.diamondCount) ?? (d.gift && d.gift.diamondCount) ?? d.diamondCount);
    const coins = per > 0 ? per * count : count;
    dispatchEvent({ type: 'gift', user: userOf(d), uniqueId: d.user && d.user.uniqueId, avatarUrl: avatarOf(d), coins, giftName: (d.extendedGiftInfo && d.extendedGiftInfo.name) || (d.gift && d.gift.name) || 'Quà tặng' }, 'TikTok');
  });
  c.on(E.FOLLOW, (d) => dispatchEvent({ type: 'follow', user: userOf(d), uniqueId: d.user && d.user.uniqueId, avatarUrl: avatarOf(d) }, 'TikTok'));
  c.on(E.SHARE, (d) => dispatchEvent({ type: 'share', user: userOf(d), uniqueId: d.user && d.user.uniqueId, avatarUrl: avatarOf(d) }, 'TikTok'));
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
function stateSnap() {
  const f = featuredRaw();
  return { dragons: game.dragons.size, featuredId: f ? f.uniqueId : '', featuredLevel: f ? levelOf(f.exp) : 0, featuredExp: f ? Math.floor(f.exp) : 0 };
}

/* Chuẩn hoá payload của extension relay → sự kiện nội bộ (cùng shape
   với /test-event để dùng chung dispatchEvent). */
function relayToEvent(kind, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pl = (raw.player && typeof raw.player === 'object') ? raw.player : {};
  const user = String(pl.nickname || 'Khán giả').slice(0, 60);
  const uniqueId = String(pl.uniqueId || pl.nickname || 'viewer').slice(0, 60);
  const avatarUrl = String(pl.avatarUrl || '').slice(0, 300);
  if (kind === 'chat') return { type: 'chat', user, uniqueId, avatarUrl, text: String(raw.comment == null ? '' : raw.comment) };
  if (kind === 'gift') return { type: 'gift', user, uniqueId, avatarUrl, coins: Math.max(1, Math.floor(Number(raw.diamonds) || 10)), giftName: String(raw.giftName || 'Món Quà').slice(0, 80) };
  if (kind === 'follow') return { type: 'follow', user, uniqueId, avatarUrl };
  if (kind === 'like') return { type: 'like', user: 'Phòng live', uniqueId: 'room', count: Math.max(1, Math.floor(Number(raw.count) || 1)) };
  if (kind === 'share') return { type: 'share', user, uniqueId, avatarUrl };
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
    const before = stateSnap();
    const out = dispatchEvent(ev, `relay-${kind}`);
    if (!out) return jsonRes(res, 400, { ok: false, error: 'Sự kiện không hợp lệ' }, CORS_HEADERS);
    const R = serverState.relay;
    R.lastAt = Date.now(); R.lastKind = kind; R.count += 1; R.byKind[kind] = (R.byKind[kind] || 0) + 1;
    if (kind !== 'like' || R.byKind.like === 1) {
      logLine(`📡 RELAY ${kind.toUpperCase()} ← ${ev.user}${kind === 'gift' ? ` (${ev.coins} xu)` : ''} [tổng relay: ${R.count}]`);
    }
    pushState();
    jsonRes(res, 200, {
      ok: true, gained: out.gained, before, after: stateSnap(),
      dragon: out.dragon ? publicDragon(out.dragon) : null,
      fireTriggered: !!out.fired,
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
      const before = stateSnap();
      const out = dispatchEvent(raw, 'test-event');
      if (!out) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'Sự kiện không hợp lệ (type phải là like/chat/follow/share/gift)' })); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true, gained: out.gained, before, after: stateSnap(),
        dragon: out.dragon ? publicDragon(out.dragon) : null,
        created: !!out.created, fromLevel: out.fromLevel, toLevel: out.toLevel,
        fireTriggered: !!out.fired,
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

let simFollowN = 0;
let simNewN = 0;
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
      if (m.sim === 'like100') dispatchEvent({ type: 'like', user: 'Khách Test', uniqueId: 'sim_khachtest', count: 100 }, 'admin');
      else if (m.sim === 'feed') dispatchEvent({ type: 'chat', user: 'Bạn Mới', uniqueId: 'sim_banmoi', text: 'ăn' }, 'admin');
      else if (m.sim === 'newUser') {
        simNewN += 1;
        dispatchEvent({ type: 'chat', user: `Người Mới ${simNewN}`, uniqueId: `sim_nguoimoi_${simNewN}`, text: 'xin chào cả phòng' }, 'admin');
      } else if (m.sim === 'follow') {
        simFollowN += 1;
        dispatchEvent({ type: 'follow', user: `Người Follow ${simFollowN}`, uniqueId: `sim_follow_${simFollowN}` }, 'admin');
      } else if (m.sim === 'giftSmall') dispatchEvent({ type: 'gift', user: 'Fan Cứng', uniqueId: 'sim_fancung', coins: 10, giftName: 'Hoa hồng' }, 'admin');
      else if (m.sim === 'giftBig') dispatchEvent({ type: 'gift', user: 'Fan Cứng', uniqueId: 'sim_fancung', coins: 299, giftName: 'Sư tử' }, 'admin');
      else if (m.sim === 'golden') startGolden('admin');
      else if (m.sim === 'fire') {
        const f = featuredRaw();
        if (f) {
          const lv = levelOf(f.exp);
          fx({ fx: 'fire', uniqueId: f.uniqueId, nickname: f.nickname, user: f.nickname, coins: 0, level: lv, mouth: MOUTHS[lv] });
          banner(`🔥 Host kích hoạt rồng của ${f.nickname} PHUN LỬA!`);
        } else {
          logLine('⚠️ Chưa có dragon nào để phun lửa — hãy tạo rồng trước (nút "Người mới vào").');
        }
      } else if (m.sim === 'pause') { game.paused = true; logLine('⏸️ Đã TẠM DỪNG nhận EXP.'); pushState(); }
      else if (m.sim === 'resume') { game.paused = false; logLine('▶️ Đã TIẾP TỤC nhận EXP.'); pushState(); }
      break;
    }
    case 'tts': game.tts = !!m.on; logLine(`🔊 TTS sân khấu: ${game.tts ? 'BẬT' : 'TẮT'}`); pushState(); break;
    case 'resetSession':
      game.scores.clear(); saveScores();
      logLine('🧹 Reset phiên: đã xoá điểm NGÀY. Đàn rồng của mọi người GIỮ NGUYÊN.');
      banner('🧹 Phiên mới bắt đầu — đàn rồng vẫn ở đây!');
      pushState();
      break;
    case 'resetDragons':
    case 'resetDragon': // tên cũ — giữ tương thích
      game.dragons.clear(); game.featuredId = ''; saveDragons(); flushDragons();
      logLine('🗑️ Đã RESET TOÀN BỘ ĐÀN RỒNG theo lệnh admin (mọi dragon về 0, xoá khỏi state.json).');
      banner('🥚 Đàn rồng đã reset — mọi người nuôi lại từ trứng!');
      pushState();
      break;
  }
}

/* ------------------------------ Khởi động ------------------------------ */
loadScores();
loadState();
server.listen(PORT, () => {
  const f = featuredRaw();
  logLine(`🐉 NUÔI RỒNG ONLINE (luật mới: mỗi người 1 rồng) chạy tại http://localhost:${PORT} — sân khấu / , quản trị /admin`);
  logLine(`🎛️ Chế độ mặc định: DEMO (tự sinh sự kiện). Đàn rồng hiện có ${game.dragons.size} con${f ? `, featured: rồng của ${f.nickname} (cấp ${levelOf(f.exp)})` : ''}.`);
  scheduleDemo();
});
server.on('error', (e) => { console.error('Lỗi server:', e.message); });
