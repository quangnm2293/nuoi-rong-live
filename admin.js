/* NUÔI RỒNG ONLINE — admin.js: điều khiển server qua WebSocket (role admin). */
'use strict';
const $ = (id) => document.getElementById(id);
const logEl = $('log');
function addLog(line) {
  const div = document.createElement('div');
  div.textContent = line;
  logEl.appendChild(div);
  while (logEl.children.length > 220) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
let ws = null;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=admin`);
  ws.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.kind === 'log') addLog(msg.line);
    else if (msg.kind === 'state') renderState(msg.state);
    else if (msg.kind === 'status') renderStatus(msg);
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}
connect();
function cmd(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ kind: 'cmd' }, obj))); }

function fmt(n) { return Number(n || 0).toLocaleString('vi-VN'); }
function renderState(s) {
  const g = s.golden && s.golden.active ? ` • 🌟 GIỜ VÀNG còn ${Math.max(0, Math.round((s.golden.until - Date.now()) / 1000))}s` : '';
  $('dragonStatus').innerHTML =
    `<span class="pillStat">CẤP <b>${s.level}</b> — ${s.levelName}</span>` +
    `<span class="pillStat">EXP cấp: <b>${fmt(s.expInLevel)}${s.expNeed ? ' / ' + fmt(s.expNeed) : ''}</b></span>` +
    `<span class="pillStat">Tổng EXP: <b>${fmt(s.totalExp)}</b></span>` +
    `<span class="pillStat">Rồng riêng: <b>${(s.pets || []).length}</b></span>` +
    `<span class="pillStat">${s.paused ? '⏸️ ĐANG TẠM DỪNG' : '▶️ Đang nhận EXP'}${g}</span>`;
  $('btnTts').textContent = s.tts ? '🔊 TTS sân khấu: BẬT' : '🔇 TTS sân khấu: TẮT';
  $('btnTts').classList.toggle('active', !s.tts);
  $('btnPause').textContent = s.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.mode));
  renderRelay(s.relay);
  const tb = $('topBody');
  tb.innerHTML = (s.top && s.top.length)
    ? s.top.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.user)}</td><td>${fmt(p.points)}</td></tr>`).join('')
    : '<tr><td colspan="3">Chưa có điểm hôm nay.</td></tr>';
  renderConn(s.conn, s.mode);
}
function renderStatus(msg) { renderConn(msg.conn, msg.mode); if (msg.state) renderRelay(msg.state.relay); }
function renderConn(conn, mode) {
  if (!conn) return;
  const st = { idle: '⚪ Chưa kết nối', connecting: '🟡 Đang kết nối…', connected: '🟢 ĐÃ BÁM PHÒNG', error: '🔴 Lỗi', disconnected: '🟠 Mất kết nối' }[conn.status] || conn.status;
  const modeLabel = { demo: 'DEMO', relay: 'RELAY (EXTENSION)', manual: 'THỦ CÔNG' }[mode] || (mode || '').toUpperCase();
  $('connStatus').innerHTML = `TLC thử nghiệm: <b>${st}</b>${conn.username ? ` — @${esc(conn.username)}` : ''}` +
    `${conn.viewers ? ` • 👁 ${fmt(conn.viewers)} mắt xem` : ''}<br>${esc(conn.message || '')}` +
    `<br><span class="muted">Chế độ hiện tại: ${modeLabel}</span>`;
}
function renderRelay(relay) {
  const el = $('relayStatus');
  if (!el) return;
  if (!relay || !relay.lastAt) {
    el.innerHTML = '📡 RELAY (extension): <b>đang chờ sự kiện</b> — mở tab phòng live TikTok trong Chrome có cài extension.';
    return;
  }
  const when = new Date(relay.lastAt).toLocaleTimeString('vi-VN', { hour12: false });
  const kinds = Object.entries(relay.byKind || {}).map(([k, n]) => `${k}×${n}`).join(' • ');
  el.innerHTML = `📡 RELAY (extension): <b>đã nhận sự kiện</b> — lần gần nhất ${esc(when)} (${esc(relay.lastKind || '')}), tổng ${fmt(relay.count)} sự kiện${kinds ? ` — ${esc(kinds)}` : ''}`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('btnConnect').addEventListener('click', () => cmd({ cmd: 'connect', username: $('username').value }));
$('btnDisconnect').addEventListener('click', () => cmd({ cmd: 'disconnect' }));
document.querySelectorAll('#modeSeg button').forEach((b) =>
  b.addEventListener('click', () => cmd({ cmd: 'setMode', mode: b.dataset.mode })));
document.querySelectorAll('[data-sim]').forEach((b) =>
  b.addEventListener('click', () => cmd({ cmd: 'sim', sim: b.dataset.sim })));
$('btnTts').addEventListener('click', () => {
  const on = !$('btnTts').textContent.includes('BẬT');
  cmd({ cmd: 'tts', on });
});
let pausedUi = false;
$('btnPause').addEventListener('click', () => {
  pausedUi = $('btnPause').textContent.includes('Tạm dừng');
  cmd({ cmd: 'sim', sim: pausedUi ? 'pause' : 'resume' });
});
$('btnResetSession').addEventListener('click', () => {
  if (confirm('Reset phiên? Xoá điểm Bảng Vàng hôm nay + toàn bộ rồng riêng. Cấp rồng chính giữ nguyên.')) cmd({ cmd: 'resetSession' });
});
$('btnResetDragon').addEventListener('click', () => {
  if (confirm('RESET CẤP RỒNG về cấp 1 (trứng) và xoá tổng EXP đã lưu? Hành động này không hoàn tác được.')) cmd({ cmd: 'resetDragon' });
});
addLog('Đã mở trang quản trị — đang chờ server…');
