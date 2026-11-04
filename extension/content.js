// Nuôi Rồng Relay — TikTok Live → server Nuôi Rồng Online (localhost:3001)
// Fork từ bản relay mẫu của anh Quang: giữ cơ chế MutationObserver quét DOM
// trang live, trích avatar thật, chống gửi trùng 600ms, badge trạng thái.
// KHÁC BẢN MẪU: không lọc lệnh game nữa — chuyển tiếp MỌI comment dạng chat
// (nội dung thô), follow/share bắt từ dòng thông báo hệ thống, quà cố đọc
// tên + số lượng/kim cương từ text dòng quà, like theo dõi hiệu số bộ đếm tim.
console.log('[Nuôi Rồng Relay] Khởi động — chuyển tiếp sự kiện về http://localhost:3001');

const SERVER_URL = 'http://localhost:3001';
const processedNodes = new WeakSet();
const recentActions = new Map(); // uniqueId|kind|sig -> timestamp
const userAvatarCache = new Map(); // cleanId -> avatarUrl
let count = 0;

// Gửi event tới server game
async function sendEventToGame(endpoint, payload) {
  try {
    const res = await fetch(`${SERVER_URL}/api/relay/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      count++;
      updateBadge(`Đã nhận ${count} sự kiện 🟢`);
      console.log(`[Nuôi Rồng Relay] GỬI [${endpoint}]:`, payload);
    } else {
      console.warn(`[Nuôi Rồng Relay] Server trả ${res.status} cho [${endpoint}]`);
    }
  } catch (e) {
    updateBadge('Không nối được server 🔴');
    console.warn('[Nuôi Rồng Relay] Lỗi gửi server (server Nuôi Rồng đã chạy ở cổng 3001 chưa?):', e);
  }
}

// Chống trùng: cùng user + cùng loại + cùng nội dung trong 600ms thì bỏ qua
function isDuplicate(uniqueId, kind, sig) {
  const key = `${uniqueId}|${kind}|${sig}`;
  const now = Date.now();
  const last = recentActions.get(key);
  if (last && now - last < 600) return true;
  recentActions.set(key, now);
  if (recentActions.size > 400) {
    for (const [k, t] of recentActions) if (now - t > 5000) recentActions.delete(k);
  }
  return false;
}

// Trích xuất ảnh đại diện thật từ TikTok (giữ nguyên cơ chế bản mẫu)
function extractAvatar(node, cleanId, isHost) {
  if (userAvatarCache.has(cleanId)) {
    return userAvatarCache.get(cleanId);
  }
  try {
    if (isHost) {
      const hostAvatarImg = document.querySelector(
        'header img, [data-e2e*="live-owner"] img, [class*="LiveAvatar"] img, [class*="avatar"] img, div[class*="UserInfo"] img'
      );
      if (hostAvatarImg && hostAvatarImg.src && hostAvatarImg.src.startsWith('http')) {
        const src = hostAvatarImg.src;
        if (!/badge|gift|emoji|icon/i.test(src)) {
          userAvatarCache.set(cleanId, src);
          return src;
        }
      }
    }
    const container =
      node.closest?.('[data-e2e*="chat"], .chat-message, [class*="ChatMessage"], [class*="chat-item"], li') || node;
    const imgs = Array.from(container.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src') || '';
      if (!src.startsWith('http')) continue;
      const lower = (img.className + ' ' + src + ' ' + (img.alt || '')).toLowerCase();
      if (/badge|level|emoji|gift|rank|medal|coin|star|arrow/i.test(lower)) continue;
      if (/avt|avatar|user|tiktokcdn|byteoversea/i.test(lower) || img.width >= 16) {
        userAvatarCache.set(cleanId, src);
        return src;
      }
    }
    const bgElements = Array.from(container.querySelectorAll('[style*="background-image"]'));
    for (const el of bgElements) {
      const match = el.style.backgroundImage.match(/url\(["']?(https:[^"')]+)["']?\)/);
      if (match && match[1] && !/badge|gift|emoji/i.test(match[1])) {
        userAvatarCache.set(cleanId, match[1]);
        return match[1];
      }
    }
  } catch (e) {
    // ignore
  }
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanId}`;
}

// Lọc và làm sạch chuỗi huy hiệu / tag của TikTok (giữ nguyên bản mẫu)
function cleanBadge(str) {
  return str
    .replace(/Chủ\s*phòng|Host|Quản\s*trị\s*viên|Quản\s*trị|Fan\s*cứng|Cấp\s*\d+|Top\s*\d+|Thành\s*viên/gi, '')
    .replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '')
    .trim();
}

function makeCleanId(nickname) {
  return (
    nickname
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]/g, '') || 'viewer'
  );
}

/* ------------------------------- QUÀ TẶNG ------------------------------- */
// Giá xu tham khảo của vài quà phổ biến (chỉ dùng khi dòng quà có số lượng
// mà không ghi rõ kim cương). Không chắc → fallback 10 như bản mẫu.
const GIFT_PRICE_HINTS = [
  { re: /hoa\s*hồng|rose/i, per: 1 },
  { re: /tiktok/i, per: 1 },
  { re: /kẹo|candy/i, per: 1 },
  { re: /donut|bánh\s*vòng/i, per: 30 },
  { re: /kem|ice\s*cream/i, per: 10 },
  { re: /sư\s*tử|lion/i, per: 2999 },
  { re: /thiên\s*hà|galaxy/i, per: 1000 },
];

function parseGift(comment, rawText) {
  const text = `${comment} ${rawText || ''}`;
  if (!/(tặng|sent|gave|gift|gửi)/i.test(text)) return null;
  // Tên quà: sau chữ "tặng"/"sent", bỏ phần số lượng ở cuối
  let giftName = 'Món Quà';
  const nameMatch = text.match(/(?:tặng|sent|gave|gửi)\s+(.+?)(?:\s*[x×]\s*\d+|\s+\d+\s*(?:kim cương|diamonds?|xu)|$)/i);
  if (nameMatch && nameMatch[1] && nameMatch[1].trim().length >= 2) {
    giftName = nameMatch[1].trim().slice(0, 60);
  }
  // Kim cương ghi rõ trong text?
  const diaMatch = text.match(/(\d[\d.,]*)\s*(?:kim\s*cương|diamonds?)/i);
  if (diaMatch) {
    const d = parseInt(diaMatch[1].replace(/[.,]/g, ''), 10);
    if (d > 0) return { giftName, diamonds: d };
  }
  // Số lượng ×N / xN
  const qtyMatch = text.match(/[x×]\s*(\d+)/i) || text.match(/\b(\d+)\s*cái\b/i);
  const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
  for (const hint of GIFT_PRICE_HINTS) {
    if (hint.re.test(text)) return { giftName, diamonds: hint.per * qty };
  }
  if (qty > 1) return { giftName, diamonds: qty }; // tối thiểu 1 xu/cái
  return { giftName, diamonds: 10, fallback: true };
}

/* ------------------------------ PHÂN TÍCH NODE ------------------------------ */
function parseChatMessage(node) {
  if (!node || processedNodes.has(node)) return;
  if (node.id === 'tiktok-relay-container' || (node.closest && node.closest('#tiktok-relay-container'))) {
    return;
  }
  processedNodes.add(node);

  const rawText = (node.innerText || node.textContent || '').trim();
  if (!rawText || rawText.length > 300) return;

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return;

  const isHost = /chủ\s*phòng|host/i.test(rawText);

  // --- Dòng thông báo HỆ THỐNG (1 dòng, không có cấu trúc tên: nội dung) ---
  if (lines.length === 1) {
    const line = lines[0];
    const firstToken = cleanBadge(line.split(/\s+/)[0] || '');
    // Follow: "xxx đã theo dõi chủ phòng" / "xxx followed the host"
    if (/đã\s*(theo\s*dõi|follow)|followed|đang\s*theo\s*dõi/i.test(line) && firstToken.length >= 2) {
      const cleanId = makeCleanId(firstToken);
      const uniqueId = `user_${cleanId}`;
      if (isDuplicate(uniqueId, 'follow', '')) return;
      sendEventToGame('follow', {
        player: { uniqueId, nickname: firstToken, avatarUrl: extractAvatar(node, cleanId, isHost) },
      });
      return;
    }
    // Share: "xxx đã chia sẻ buổi live" / "xxx shared the LIVE"
    if (/đã\s*chia\s*sẻ|shared/i.test(line) && firstToken.length >= 2) {
      const cleanId = makeCleanId(firstToken);
      const uniqueId = `user_${cleanId}`;
      if (isDuplicate(uniqueId, 'share', '')) return;
      sendEventToGame('share', {
        player: { uniqueId, nickname: firstToken, avatarUrl: extractAvatar(node, cleanId, isHost) },
      });
      return;
    }
    // Tham gia phòng → bỏ qua (không phải sự kiện game)
    if (/đã\s*tham\s*gia|joined|entered/i.test(line)) return;
  }

  // --- Dòng CHAT thường: tách nickname + nội dung ---
  let nickname = '';
  let comment = '';
  if (lines.length >= 2) {
    const line0Clean = cleanBadge(lines[0]);
    if (line0Clean.length >= 2) {
      nickname = line0Clean;
      comment = lines.slice(1).join(' ');
    } else if (lines.length >= 3) {
      nickname = cleanBadge(lines[1]);
      comment = lines.slice(2).join(' ');
    }
  } else {
    const line = lines[0];
    if (line.includes(':')) {
      const idx = line.indexOf(':');
      nickname = cleanBadge(line.slice(0, idx));
      comment = line.slice(idx + 1).trim();
    }
  }
  if (!nickname || nickname.length < 2 || !comment) return;

  const cleanId = makeCleanId(nickname);
  const uniqueId = `user_${cleanId}`;
  const avatarUrl = extractAvatar(node, cleanId, isHost);

  // Quà tặng (dòng quà trong feed chat): ưu tiên bắt trước khi coi là chat
  const gift = parseGift(comment, rawText);
  if (gift) {
    if (isDuplicate(uniqueId, 'gift', `${gift.giftName}|${gift.diamonds}`)) return;
    if (gift.fallback) {
      console.log(`[Nuôi Rồng Relay] 🎁 Không đọc được giá quà "${gift.giftName}" — dùng mặc định 10 kim cương.`);
    }
    sendEventToGame('gift', {
      player: { uniqueId, nickname, avatarUrl },
      giftName: gift.giftName,
      diamonds: gift.diamonds,
    });
    return;
  }

  // Chat thường: chuyển tiếp NGUYÊN VĂN nội dung thô (server tự tính EXP,
  // comment có chữ "ăn" được +10 và hiệu ứng cho ăn ở phía server).
  if (isDuplicate(uniqueId, 'chat', comment)) return;
  console.log(`[Nuôi Rồng Relay] 💬 [${nickname}]: "${comment}"`);
  sendEventToGame('chat', {
    player: { uniqueId, nickname, avatarUrl },
    comment,
  });
}

/* ------------------------------ BẮT LIKE (best-effort) ------------------------------ */
// TikTok không phát sự kiện like qua DOM chat. Cách khả thi: đọc bộ đếm tim
// trên trang live (data-e2e like count) theo chu kỳ và gửi HIỆU SỐ dương.
// Đây là best-effort: nếu TikTok đổi DOM/không tìm thấy phần tử tin cậy thì
// chỉ log cảnh báo, KHÔNG đoán số. Số hiển thị có thể bị rút gọn (1,2 N) nên
// hiệu số chỉ gần đúng.
function parseLikeText(txt) {
  if (!txt) return null;
  const m = String(txt).replace(/\s+/g, '').match(/(\d+(?:[.,]\d+)?)([kKmMnN]?)/);
  if (!m) return null;
  let v = parseFloat(m[1].replace(',', '.'));
  if (/[kKnN]/.test(m[2])) v *= 1000;
  else if (/[mM]/.test(m[2])) v *= 1000000;
  return Math.floor(v);
}
function findLikeCount() {
  const sels = [
    '[data-e2e="live-like-count"]',
    '[data-e2e*="like-count"]',
    '[data-e2e="like-count"]',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el) { const v = parseLikeText(el.textContent); if (v != null) return v; }
  }
  // Dự phòng: phần tử có aria-label chứa "lượt thích/likes" kèm số
  const cand = document.querySelectorAll('[aria-label*="thích" i], [aria-label*="like" i]');
  for (const el of cand) {
    const v = parseLikeText(el.getAttribute('aria-label'));
    if (v != null) return v;
  }
  return null;
}
let lastLikeCount = null;
let likeWarnLogged = false;
function initLikeWatcher() {
  if (!/\/live\b/.test(location.pathname)) {
    console.log('[Nuôi Rồng Relay] Không phải trang /live — bỏ qua bắt like.');
    return;
  }
  setInterval(() => {
    const cur = findLikeCount();
    if (cur == null) {
      if (!likeWarnLogged) {
        likeWarnLogged = true;
        console.warn('[Nuôi Rồng Relay] ⚠️ Chưa tìm thấy bộ đếm tim đáng tin trên trang (data-e2e like count) — tính năng bắt like tạm treo, các sự kiện khác vẫn chạy.');
      }
      return;
    }
    if (lastLikeCount == null) {
      lastLikeCount = cur; // mốc nền lần đầu: không gửi (tránh cộng dồn số cũ)
      console.log(`[Nuôi Rồng Relay] ❤️ Bắt đầu theo dõi bộ đếm tim ở mốc ${cur}.`);
      return;
    }
    if (cur > lastLikeCount) {
      const delta = Math.min(cur - lastLikeCount, 5000);
      lastLikeCount = cur;
      sendEventToGame('like', {
        player: { uniqueId: 'room', nickname: 'Phòng live' },
        count: delta,
      });
    } else if (cur < lastLikeCount) {
      lastLikeCount = cur; // phòng mới / đếm reset → đặt lại mốc
    }
  }, 1500);
  console.log('[Nuôi Rồng Relay] Đang theo dõi bộ đếm tim (best-effort, chu kỳ 1,5s).');
}

/* ------------------------------ OBSERVER + BADGE ------------------------------ */
function initObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (node.id === 'tiktok-relay-container') continue;
          const chatItems = node.querySelectorAll?.('[data-e2e*="chat"], .chat-message, [class*="ChatMessage"], [class*="chat-item"]');
          if (chatItems && chatItems.length > 0) {
            chatItems.forEach((c) => parseChatMessage(c));
          } else {
            parseChatMessage(node);
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[Nuôi Rồng Relay] Đang lắng nghe MutationObserver!');
}

function updateBadge(txt) {
  const el = document.getElementById('relay-badge-status');
  if (el) el.innerText = txt;
}

function initBadge() {
  if (document.getElementById('tiktok-relay-container')) return;
  const div = document.createElement('div');
  div.id = 'tiktok-relay-container';
  div.innerHTML = `🐉 <b>Nuôi Rồng Relay:</b> <span id="relay-badge-status" style="color:#4ade80;">Sẵn sàng nhận sự kiện 🟢</span>`;
  div.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    z-index: 99999999;
    background: rgba(15, 23, 42, 0.95);
    color: white;
    border: 2px solid #38bdf8;
    border-radius: 20px;
    padding: 6px 14px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    pointer-events: none;
  `;
  document.body.appendChild(div);
}

setTimeout(() => {
  initBadge();
  initObserver();
  initLikeWatcher();
}, 1500);
