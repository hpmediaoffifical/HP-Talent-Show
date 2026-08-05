// HP GROUP LIVE — Renderer logic.
// Mọi giao tiếp với main đi qua window.api (xem preload.js).

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const TOAST_MAX = 5; // chỉ hiển thị tối đa 5 thông báo; dư thì bỏ cái cũ nhất cho gọn
function toast(msg, kind = '') {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  c.appendChild(t);
  // Giữ tối đa TOAST_MAX toast trên màn hình — vượt quá thì xoá ngay các toast cũ nhất.
  const items = c.querySelectorAll('.toast');
  for (let i = 0; i < items.length - TOAST_MAX; i++) items[i].remove();
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, 2400);
  setTimeout(() => t.remove(), 2800);
}

// Cấu hình reset overlay OBS (đồng bộ từ settings ở loadSettings()).
const obsResetCfg = { wsPort: 4455, overlayPort: 18282, autoReset: false };
let obsResetBusy = false;

// Reset (refresh cache) các Browser Source OBS trỏ tới overlay localhost của app.
// manual=true khi bấm nút / Ctrl+R (hiện toast), false khi tự chạy lúc khởi động (im lặng nếu OBS chưa mở).
async function resetObsOverlays(manual = true) {
  if (obsResetBusy) return;
  if (!window.ObsReset) return;
  obsResetBusy = true;
  try {
    const r = await window.ObsReset.resetOverlays({ port: obsResetCfg.wsPort, overlayPort: obsResetCfg.overlayPort });
    if (manual) {
      if (r.matched > 0) toast(`🔄 Đã reset ${r.matched} overlay OBS`, 'success');
      else toast('🔄 Đã kết nối OBS nhưng chưa thấy Browser Source overlay nào của app');
    }
  } catch (e) {
    if (manual) toast('⚠ Không kết nối được OBS. Hãy bật Tools → WebSocket Server Settings và kiểm tra cổng.', 'error');
  } finally {
    obsResetBusy = false;
  }
}

function askConfirm(message, title = 'Xác nhận') {
  return new Promise((resolve) => {
    const overlay = $('#confirmOverlay');
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    overlay.hidden = false;
    const cleanup = (value) => {
      overlay.hidden = true;
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      overlay.removeEventListener('mousedown', onBackdrop);
      resolve(value);
    };
    const yes = $('#confirmYes');
    const no = $('#confirmNo');
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    overlay.addEventListener('mousedown', onBackdrop);
    no.focus();
  });
}

// ===== Popup thoát ứng dụng (thay dialog gốc — main gửi 'app:confirmQuit', ta trả confirmQuitResult) =====
(() => {
  const overlay = $('#quitOverlay');
  if (!overlay) return;
  let open = false;
  const respond = async (ok) => {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey);
    // Trước khi thoát hẳn: GHI NGAY mọi chỉnh sửa còn đang chờ (chống mất thông số vừa sửa).
    if (ok) { try { await flushAllSaves(); } catch {} }
    window.api.app.confirmQuitResult(ok);
  };
  const cancel = () => respond(false);
  const confirm = () => respond(true);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
  const show = () => {
    if (open) return;
    open = true;
    overlay.hidden = false;
    document.addEventListener('keydown', onKey);
    $('#quitCancel')?.focus(); // mặc định an toàn: nhấn Enter = Ở lại
  };
  $('#quitCancel')?.addEventListener('click', cancel);
  $('#quitClose')?.addEventListener('click', cancel);
  $('#quitConfirm')?.addEventListener('click', confirm);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cancel(); });
  window.api.on('app:confirmQuit', show);
})();

// Dự phòng chống mất chỉnh sửa cuối: ẩn cửa sổ (alt-tab/minimize) hoặc thoát bằng đường khác
// (native quit, before-quit) → ghi ngay các thay đổi đang chờ. Dirty-aware nên không ghi thừa.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAllSaves(); });
window.addEventListener('beforeunload', () => { flushAllSaves(); });

// ===== Tab routing =====
$$('.nav-btn').forEach(b => b.addEventListener('click', () => {
  $$('.nav-btn').forEach(x => x.classList.toggle('active', x === b));
  const id = b.dataset.tab;
  $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === id));
  // Giữ ngăn cha (NHIỆM VỤ…) mở khi đang xem một mục con của nó — và đóng các ngăn khác
  // để mỗi lúc chỉ 1 nhóm mở (tránh danh sách quá dài gây lỗi hiển thị).
  const grp = b.closest('.nav-group');
  if (grp) { openNavGroupExclusive(grp); }
  if (id === 'set-overlay') { refreshOverlayUrls(); ovBuildVisList?.(); ovSyncUI?.(); }
  if (id === 'mvphonor') mvpRenderStage?.();
  if (id === 'luckywheel') { lwRefreshSpinners?.(); renderLwPreview?.(); }
  if (id === 'mtrio') mtOnShow?.();
  if (id === 'cardflip') cfOnShow?.();
  if (id === 'groups') loadKcData?.(); // nạp KIM CƯƠNG TỔNG cho Hồ Sơ Nhóm
  // Ẩn/hiện overlay theo cảnh: mở tab có overlay → tự áp cảnh (nếu bật) + cập nhật nút nổi thanh trên.
  ovOnTab?.(id);
}));

// ===== Ẩn/hiện overlay theo "cảnh" (tự-theo-menu + ghim + bật/tắt tay) =====
// Cơ chế: app phát bản đồ {khoá cảnh -> bool} về server → mọi overlay tự làm trong suốt khi khoá của nó
// = false (không đụng engine/nhạc/video). Khoá cảnh = tên sự kiện SSE (pk-duo & FX chung 'pkduo', v.v.).
// Bản đăng ký overlay theo NHÓM (scene) → mỗi nhóm gồm ≥1 overlay OBS riêng (mỗi cái 1 khoá vis độc lập).
// color = màu nhận diện nhóm (viền/nền nhạt) để KHÔNG nhìn nhầm giữa các nhóm; trải đều vòng màu.
const OV_SCENES = [
  { scene: 'pkduo',       label: '⚔️ PK Đôi',       color: '#ef4444', items: [{ key: 'pkduo', name: 'Thanh máu' }, { key: 'pkduofx', name: 'Hiệu ứng FX' }] },
  { scene: 'kcduo',       label: '🔁 Giữ / Đổi',    color: '#6366f1', items: [{ key: 'kcduo', name: 'Overlay' }] },
  { scene: 'pkgroup',     label: '🧩 PK Nhóm',      color: '#22c55e', items: [{ key: 'pkgroup', name: 'Overlay' }] },
  { scene: 'ranking',     label: '🏆 Thi đấu nhóm', color: '#f59e0b', items: [{ key: 'ranking', name: 'Dọc' }, { key: 'rankinggrid', name: 'Ngang' }] },
  { scene: 'score',       label: '🎯 Tính điểm',    color: '#3b82f6', items: [{ key: 'score', name: 'Bảng' }, { key: 'scorebar', name: 'Đường đua' }, { key: 'scorecard', name: 'Kêu gọi' }, { key: 'scoretimer', name: 'Thời gian' }] },
  { scene: 'sticker',     label: '🥚 Đập trứng',    color: '#f97316', items: [{ key: 'sticker', name: 'Overlay' }] },
  { scene: 'giftmenu',    label: '🎁 Menu Quà',     color: '#a855f7', items: [{ key: 'giftmenu', name: 'Overlay' }] },
  { scene: 'mvphonor',    label: '🏅 Vinh danh',    color: '#eab308', items: [{ key: 'mvphonor', name: 'Overlay' }] },
  { scene: 'luckywheel',  label: '🎡 Vòng quay',    color: '#ec4899', items: [{ key: 'luckywheel', name: 'Overlay' }] },
  { scene: 'missiontrio', label: '📋 Bộ ba',        color: '#14b8a6', items: [{ key: 'missiontrio', name: 'Overlay' }] },
  { scene: 'cardflip',    label: '🃏 Thẻ bài',      color: '#8b5cf6', items: [{ key: 'cardflip', name: 'Bảng' }, { key: 'cardflipfx', name: 'Lật 3D' }] },
  { scene: 'dancevideo',  label: '🎵 Nhạc Dance',   color: '#0ea5e9', items: [{ key: 'dancevideo', name: 'WEBM 1' }, { key: 'dancevideo2', name: 'WEBM 2' }, { key: 'dancevideo3', name: 'WEBM 3' }] },
  { scene: 'interact',    label: '💬 Tương tác',    color: '#64748b', items: [{ key: 'interact', name: 'Overlay' }] },
];
const OV_SCENE_BY = Object.fromEntries(OV_SCENES.map(s => [s.scene, s]));
const OV_KEYS_OF = (scene) => (OV_SCENE_BY[scene]?.items || []).map(i => i.key);
// Tab (data-tab) → cảnh overlay tương ứng. Tab không có overlay (creators/groups/set-*) không đổi cảnh.
const OV_TAB_TO_SCENE = { connect: 'interact', score: 'score', pkduo: 'pkduo', kcduo: 'kcduo', pkgroup: 'pkgroup', ranking: 'ranking', musiclist: 'dancevideo', stickerdance: 'sticker', mvphonor: 'mvphonor', luckywheel: 'luckywheel', mtrio: 'missiontrio', cardflip: 'cardflip' };
const OV_SCENE_LABEL = Object.fromEntries(OV_SCENES.map(s => [s.scene, s.label]));
let ovVis = { autoScene: true, pinned: {}, vis: {} };
// Cảnh (scene) đang "trên sóng" theo menu — CHỈ đổi khi mở một tab có overlay. Tab không overlay
// (Cài đặt/Creator…) GIỮ nguyên cảnh cũ (khỏi làm tắt hết khi vào Cài đặt). '' = chưa mở game nào ⇒
// chưa ẩn ai (giữ mặc định HIỆN). KHÔNG lưu vào settings — chỉ là trạng thái phiên hiện tại.
let ovActiveScene = '';

function ovCurrentTab() { return document.querySelector('.nav-btn.active')?.dataset.tab || ''; }

async function ovLoadVisibility() {
  try { ovVis = await api.overlay.getVisibility(); } catch { ovVis = { autoScene: true, pinned: { interact: true, giftmenu: true }, vis: {} }; }
  ovVis.vis = ovVis.vis || {}; ovVis.pinned = ovVis.pinned || {};
  // Lúc mở app: cảnh chưa "trên sóng" (ovActiveScene = '') ⇒ hiệu lực = lựa chọn tay (mặc định HIỆN),
  // giống hành vi cũ. Chỉ khi bấm vào một game thì mới bắt đầu tự-theo-menu.
  ovBuildVisList(); ovSyncUI();
  ovPushEffective();
}
async function ovSave(patch) {
  // Lưu LỰA CHỌN TAY (autoScene/pinned/vis) — mặc định HIỆN, chỉ đổi khi người dùng bấm.
  try { ovVis = await api.overlay.setVisibility(patch); } catch {}
  ovVis.vis = ovVis.vis || {}; ovVis.pinned = ovVis.pinned || {};
  ovSyncUI();
  ovPushEffective(); // phát lại bản đồ HIỆU LỰC sau mỗi thay đổi
}
// Bản đồ HIỆU LỰC = những gì THỰC SỰ hiện trên OBS/TikTok. Tính từ: lựa chọn tay (mặc định HIỆN) +
// cảnh đang mở + ghim. KHÔNG ghi ngược vào ovVis.vis ⇒ auto-ẩn theo menu không làm hỏng lựa chọn tay
// (sửa lỗi: mở game khác rồi quay lại thì overlay tự hiện lại đúng, không bị "ẩn dính").
function ovEffectiveVis() {
  const auto = ovVis.autoScene !== false;
  const scene = ovActiveScene; // '' ⇒ chưa mở game nào → chưa ẩn ai
  const vis = {};
  for (const s of OV_SCENES) for (const it of s.items) {
    const k = it.key;
    const manualOn = ovVis.vis[k] !== false;                 // lựa chọn tay (mặc định HIỆN)
    if (!auto || !scene) { vis[k] = manualOn; continue; }     // tắt tự-theo-menu / chưa mở game: chỉ theo tay
    const onAir = (s.scene === scene) || !!ovVis.pinned[k];   // cảnh đang mở hoặc đang ghim
    vis[k] = onAir && manualOn;                               // cảnh khác: ẩn (nhưng KHÔNG lưu vào tay)
  }
  return vis;
}
function ovPushEffective() { try { api.overlay.applyVisibility(ovEffectiveVis()); } catch {} }
// Gọi khi đổi tab: ghi nhớ cảnh đang mở (nếu tab có overlay) rồi phát lại bản đồ hiệu lực. Luôn cập nhật nút nổi.
function ovOnTab(tabId) {
  const sc = OV_TAB_TO_SCENE[tabId];
  if (sc) { ovActiveScene = sc; if (ovVis.autoScene) ovPushEffective(); }
  ovUpdateTopToggle(tabId);
}
// Nút nổi ở thanh trên: phản ánh + bật/tắt nhanh overlay của tab đang xem.
function ovUpdateTopToggle(tabId) {
  const wrap = document.getElementById('ovQuick');
  const btn = document.getElementById('ovQuickBtn');
  if (!wrap || !btn) return;
  const sc = OV_TAB_TO_SCENE[tabId != null ? tabId : ovCurrentTab()];
  if (!sc) { wrap.hidden = true; return; }
  wrap.hidden = false;
  // Nhóm có nhiều overlay: "đang hiện" = còn ÍT NHẤT 1 overlay hiện.
  const on = OV_KEYS_OF(sc).some(k => ovVis.vis[k] !== false);
  btn.dataset.scene = sc;
  btn.classList.toggle('on', on);
  btn.textContent = (on ? '🟢 ' : '⚪ ') + OV_SCENE_LABEL[sc].replace(/^\S+\s/, '') + (on ? ' · đang hiện' : ' · đang ẩn');
  btn.title = on ? 'Overlay đang HIỆN trên OBS/TikTok — bấm để ẩn tất cả' : 'Overlay đang ẨN — bấm để hiện tất cả';
}
// Dựng bảng điều khiển từng overlay trong panel LINK OVERLAY (1 lần).
function ovBuildVisList() {
  const box = document.getElementById('ovlVisList');
  if (!box || box.dataset.built) return;
  box.innerHTML = OV_SCENES.map(s => {
    const multi = s.items.length > 1;
    const btns = (k) => `<button class="ovl-vis-toggle" data-vis-toggle="${k}" type="button"></button>
      <button class="ovl-vis-pin" data-vis-pin="${k}" type="button">📌 Ghim</button>`;
    const head = `<div class="ovl-vis-head"><span class="ovl-vis-dot"></span><span class="ovl-vis-title">${s.label}</span>${
      multi ? `<span class="ovl-vis-count">${s.items.length} overlay</span>` : btns(s.items[0].key)}</div>`;
    const rows = multi ? `<div class="ovl-vis-items">${s.items.map(it => `
      <div class="ovl-vis-item"><span class="ovl-vis-iname">${it.name}</span>${btns(it.key)}</div>`).join('')}</div>` : '';
    return `<div class="ovl-vis-card${multi ? ' multi' : ''}" data-scene="${s.scene}" style="--ov-accent:${s.color}">${head}${rows}</div>`;
  }).join('');
  box.dataset.built = '1';
  box.querySelectorAll('[data-vis-toggle]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.visToggle;
    ovSave({ vis: { [k]: ovVis.vis[k] === false } }); // đảo: đang ẩn(false) → hiện(true) và ngược lại
  }));
  box.querySelectorAll('[data-vis-pin]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.visPin;
    ovSave({ pinned: { [k]: !ovVis.pinned[k] } });
  }));
}
// Đồng bộ mọi nút/checkbox theo trạng thái hiện tại.
function ovSyncUI() {
  const auto = document.getElementById('ovlAutoScene');
  if (auto) auto.checked = ovVis.autoScene !== false;
  document.querySelectorAll('[data-vis-toggle]').forEach(b => {
    const on = ovVis.vis[b.dataset.visToggle] !== false;
    b.classList.toggle('on', on);
    b.textContent = on ? '🟢 Hiện' : '⚪ Ẩn';
  });
  document.querySelectorAll('[data-vis-pin]').forEach(b => {
    const pinned = !!ovVis.pinned[b.dataset.visPin];
    b.classList.toggle('on', pinned);
    b.title = pinned ? 'Đang ghim (luôn hiện) — bấm để bỏ ghim' : 'Ghim: luôn hiện, không bị tự ẩn khi chuyển menu';
  });
  ovUpdateTopToggle(ovCurrentTab());
}
// Nút nổi thanh trên: đảo hiện/ẩn cảnh của tab đang xem.
document.getElementById('ovQuickBtn')?.addEventListener('click', () => {
  const sc = document.getElementById('ovQuickBtn').dataset.scene;
  if (!sc) return;
  const keys = OV_KEYS_OF(sc);
  const anyOn = keys.some(k => ovVis.vis[k] !== false);
  const vis = {}; keys.forEach(k => vis[k] = !anyOn); // đang hiện → ẩn HẾT; đang ẩn → hiện HẾT
  ovSave({ vis });
});
// Công tắc tổng "Tự hiện/ẩn theo menu". BẬT → phát lại hiệu lực theo cảnh đang mở; TẮT → hiện hết theo tay.
// (ovSave đã tự gọi ovPushEffective, dùng ovActiveScene hiện tại nên không cần áp cảnh thủ công.)
document.getElementById('ovlAutoScene')?.addEventListener('change', (e) => {
  ovSave({ autoScene: e.target.checked });
});

// ===== Ngăn menu con (parent gập/mở) =====
// Kiểu accordion: mở 1 nhóm thì đóng hết nhóm còn lại (chỉ 1 nhóm mở tại một thời điểm).
function openNavGroupExclusive(grp) {
  $$('.nav-group').forEach(g => {
    const on = g === grp;
    g.classList.toggle('open', on);
    g.querySelector('.nav-parent')?.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
}
$$('.nav-parent').forEach(p => p.addEventListener('click', () => {
  const grp = p.closest('.nav-group');
  if (!grp) return;
  // Đang mở thì bấm lại để gập; đang đóng thì mở và đóng các nhóm khác.
  if (grp.classList.contains('open')) {
    grp.classList.remove('open');
    p.setAttribute('aria-expanded', 'false');
  } else {
    openNavGroupExclusive(grp);
  }
}));

// ===== Thu gọn sidebar (bấm logo HP) =====
(() => {
  const sidebar = document.querySelector('.sidebar');
  const btn = $('#brandToggle');
  if (!sidebar || !btn) return;
  const KEY = 'hp.sidebarCollapsed';
  // Icon lá (mục không có menu con): dời title -> data-tip để dùng tooltip CSS mượt,
  // tránh tooltip mặc định của hệ điều hành nhảy trùng khi thu gọn.
  sidebar.querySelectorAll('.nav > .nav-btn[title]').forEach((b) => {
    b.setAttribute('data-tip', b.getAttribute('title'));
    b.removeAttribute('title');
  });
  const apply = (on) => sidebar.classList.toggle('collapsed', !!on);
  // Đặt trạng thái ban đầu KHÔNG animate, rồi bật transition lại sau khi đã vẽ xong.
  sidebar.classList.add('no-anim');
  try { apply(localStorage.getItem(KEY) === '1'); } catch {}
  requestAnimationFrame(() => requestAnimationFrame(() => sidebar.classList.remove('no-anim')));
  btn.addEventListener('click', () => {
    const on = !sidebar.classList.contains('collapsed');
    apply(on);
    if (!on) closeAllFlyouts();
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  });

  // ===== Flyout menu con khi thu gọn — điều khiển bằng JS =====
  // Vì :hover thuần với panel cao dễ bị: (1) không thu lại, (2) nhiều panel đè nhau.
  // JS đảm bảo mỗi lúc chỉ 1 panel mở, và có độ trễ đóng để rê qua khe icon→panel không rớt.
  const groups = Array.from(sidebar.querySelectorAll('.nav-group'));
  let flyoutTimer = null;
  const closeAllFlyouts = () => {
    clearTimeout(flyoutTimer);
    groups.forEach((g) => g.classList.remove('flyout-open'));
  };
  const openFlyout = (g) => {
    clearTimeout(flyoutTimer);
    groups.forEach((x) => x.classList.toggle('flyout-open', x === g));
  };
  const scheduleClose = () => {
    clearTimeout(flyoutTimer);
    flyoutTimer = setTimeout(closeAllFlyouts, 160);
  };
  groups.forEach((g) => {
    g.addEventListener('mouseenter', () => { if (sidebar.classList.contains('collapsed')) openFlyout(g); });
    g.addEventListener('mouseleave', () => { if (sidebar.classList.contains('collapsed')) scheduleClose(); });
    // Bấm 1 mục con -> đóng flyout ngay
    g.querySelectorAll('.nav-sub .nav-btn').forEach((b) => b.addEventListener('click', closeAllFlyouts));
  });
  // Rời hẳn sidebar -> đóng
  sidebar.addEventListener('mouseleave', closeAllFlyouts);
})();

// Open external
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-ext]');
  if (a) { e.preventDefault(); window.api.shell.openExternal(a.dataset.ext); }
});

// ============================================================
// State
// ============================================================
let creators = [];
let groups = [];
let giftMaster = []; // [{id, name, icon, webm, diamond}]
let pkCfg = null;
let kcCfg = null; // GIỮ / ĐỔI (Keep/Change)
let pkGroupCfg = null;
let pkGroupMvpTotals = new Map();
let pkGroupMvpTotalsGroupId = '';
let pkGroupMvpTotalsRenderKey = '';
let musicItems = [];                 // DANH SÁCH NHẠC: [{giftId, giftName, icon, diamond, audioPath, volume}]
let musicCfg = { duckWaiting: true, bgEnabled: false, paused: false };
// NHẠC DANCE theo NHÓM: mỗi nhóm một danh sách quà riêng ('' = TALENT SHOW dùng file gốc).
// musicGroupId: nhóm mà musicItems đang hiển thị. musicBaseItems: danh sách gốc (TALENT SHOW).
let musicGroupId = '';
let musicBaseItems = [];
let danceVideoCfg = null;            // cấu hình overlay Video NHẠC DANCE (title, vị trí/size mặc định, maxClipSec…)
// Vị trí video hợp lệ cho mỗi mục quà ('default' = theo cấu hình overlay).
const DANCE_POS = ['default', 'full', 'center', 'tl', 'tr', 'bl', 'br'];
// 3 overlay NHẠC DANCE độc lập (mỗi cái 1 link OBS riêng). Mỗi quà chọn 1 kênh để phát video.
const DANCE_CHANNELS = ['webm1', 'webm2', 'webm3'];
function danceChannelOf(item) { const o = String(item && item.overlay || 'webm1'); return DANCE_CHANNELS.includes(o) ? o : 'webm1'; }
// Nhận diện file VIDEO theo đuôi (bỏ query) → phát trên overlay OBS; còn lại (mp3…) phát trong app.
function isVideoFile(p) { return /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(String(p || '').split('?')[0].split('#')[0]); }
let stickerCfg = null;               // STICKER DANCE config (editor model)
let groupProfiles = {}; // { [groupId]: { live, pkGroup, defaultGift, stats } } — thông số riêng mỗi nhóm
let currentEditingCreator = null;
let currentEditingGroup = null;
let stats = { gifts: 0, diamond: 0, donors: new Set(), viewers: 0 };
let ttConnected = false;
let ttConnecting = false;
let liveUsername = '';
// Bản DEV (chạy nguồn) = true → mở khoá mọi tính năng để test. Bản CÀI = false → cần LIVE.
// Nạp 1 lần lúc khởi động (initLicenseGate); mặc định false để bản CÀI an toàn nếu chưa kịp nạp.
let IS_DEV = false;
let activeGroupId = ''; // '' = TALENT SHOW (mở tất cả); id = chỉ nhóm đó. KHÔNG lưu vào settings.
const TALENT_SHOW_CONNECT_ID = 'hpmedia.official'; // ID TikTok đại diện của 🎤 TALENT SHOW (tự điền ô kết nối)
let autoConnectPref = false; // Tự động kết nối khi mở app (popup Kết nối).
let defaultAutoConnectPref = false; // Cài đặt cũ/TALENT SHOW, dùng làm mặc định khi nhóm chưa chọn riêng.
let savedActiveGroupId = null;
let savedLastUsername = '';
let talentShowUsername = '';
let activeGroupChangeSeq = 0;
let scoreLinkRanking = false;
let scoreLinkVoteLock = false;
let latestScoreState = null;
// Áp điểm 🎯 Tính điểm vào BXH: nhớ batch đã áp theo từng lượt chạy (chống cộng trùng + cho hoàn tác).
let scoreApplyBatchId = null;   // id batch trong sổ áp điểm (để hoàn tác)
let scoreApplyRunKey = '';      // khóa lượt chạy đã áp (runStartedAt) — sang lượt mới thì cho áp lại
let lastCommitBatchId = null;   // batch chốt vòng gần nhất (dành cho hoàn tác nếu cần)
let scoreDurationSyncing = false;
let scoreTargetSyncing = false;
let scoreAutoRoundHandled = false;
let scoreStoppedManually = false;
let lastScoreHistRunKey = '';   // chống ghi trùng 1 lượt Tính điểm vào lịch sử
let rankHistHeSo = 2;           // hệ số KIM CƯƠNG TƯƠI đang chọn ở modal lịch sử THI ĐẤU NHÓM
// ==== TỰ LƯU: gom mọi bộ lưu có debounce → FLUSH ngay khi ẩn/đóng app, không mất chỉnh sửa CUỐI ====
// Mỗi saver nhớ cờ "dirty": chỉ ghi khi thực sự có thay đổi chưa lưu → flush trên blur/hidden rất rẻ.
const _autoSavers = [];
function makeAutoSaver(saveFn, delay) {
  delay = delay || 250;
  let timer = null, dirty = false;
  function run() { timer = null; dirty = false; try { return saveFn(); } catch {} }
  const saver = {
    schedule(after) { dirty = true; clearTimeout(timer); timer = setTimeout(run, delay); if (after) { try { after(); } catch {} } },
    flush() { if (!dirty) return; clearTimeout(timer); return run(); }, // chỉ ghi khi còn thay đổi chưa lưu
    cancel() { clearTimeout(timer); timer = null; dirty = false; },
    get pending() { return dirty; },
  };
  _autoSavers.push(saver);
  return saver;
}
// Ghi NGAY mọi thay đổi đang chờ (dùng khi thoát/ẩn app). Trả promise để nơi gọi có thể await.
async function flushAllSaves() { for (const s of _autoSavers) { try { await s.flush(); } catch {} } }
let scoreSoundAudio = null;
let scoreSoundRunKey = '';
let scoreSoundLastStatus = '';
let scoreSoundInitialized = false;
let scoreSoundWarningPlayed = false;
let scoreSoundGoalPlayed = false;
let scoreSoundResultPlayed = false;
let settingsPreviewAudio = null;
let bannerItems = [];
let bannerIndex = 0;
let bannerTimer = null;
let tickerItems = [];
let tickerTimer = null;
const TICKER_REFRESH_MS = 60_000;
const collapsedCreatorGroups = new Set();
let chatFontSize = 18;
const userAvatarCache = new Map();
const giftDonors = new Set();
const logInteractAt = { chatList: 0, giftList: 0 };
let latestUpdateInfo = null;
let reviewStateTimer = null;

function giftToPkGift(g) {
  return { giftName: g.name, giftId: g.id, icon: g.icon, diamond: g.diamond };
}

function pkGiftModeKey() { return pkCfg?.joinMode ? 'joinGifts' : 'fixedGifts'; }

function getTeam(side) { return side === 'A' ? pkCfg.teamA : pkCfg.teamB; }

// Quà mặc định đã dùng — CHỈ xét creator trong CÙNG NHÓM (khác nhóm dùng lại quà là hợp lệ,
// không được ẩn xám). groupId truyền vào để lọc theo nhóm của creator đang sửa; nếu không truyền
// thì theo nhóm đang chọn (activeGroupId), '' = TALENT SHOW xét tất cả.
function creatorGiftUsage(exceptCreatorId = '', groupId = null) {
  const usedBy = {};
  const scope = groupId != null
    ? creators.filter(c => String(c.groupId || '') === String(groupId || ''))
    : (activeGroupId ? creators.filter(c => c.groupId === activeGroupId) : creators);
  for (const c of scope) {
    if (exceptCreatorId && c.id === exceptCreatorId) continue;
    if (c.defaultGiftId) usedBy[String(c.defaultGiftId)] = c.nickname || c.tiktokId || 'Creator';
  }
  return usedBy;
}

function normalizeId(value) { return String(value || '').trim().replace(/^@/, '').toLowerCase(); }

function getLiveConnectionConfig(groupId) {
  const gid = String(groupId || '');
  if (!gid) {
    return {
      username: normalizeId(talentShowUsername) || TALENT_SHOW_CONNECT_ID,
      autoConnect: defaultAutoConnectPref,
    };
  }
  const group = groups.find(g => g.id === gid);
  const profile = getGroupProfile(gid);
  const live = profile.live && typeof profile.live === 'object' && !Array.isArray(profile.live) ? profile.live : {};
  return {
    username: normalizeId(live.username) || normalizeId(group?.tiktokId),
    autoConnect: typeof live.autoConnect === 'boolean' ? live.autoConnect : defaultAutoConnectPref,
  };
}

function syncLiveConnectionUi(groupId, updateUsername = true, force = false) {
  const live = getLiveConnectionConfig(groupId);
  autoConnectPref = !!live.autoConnect;
  if ($('#autoConnectChk')) $('#autoConnectChk').checked = autoConnectPref;
  // Bình thường KHÔNG đổi ô ID khi đang LIVE/kết nối (giữ id đang chạy). Nhưng khi ĐỔI NHÓM thật
  // (force) hoặc mở popup, phải nạp lại ID theo ĐÚNG nhóm đang chọn → tránh hiện id nhóm khác.
  if (updateUsername && (force || (!ttConnected && !ttConnecting)) && $('#ttUsername')) $('#ttUsername').value = live.username;
  return live;
}

// Dọn lỗi rò rỉ ID: một ID LIVE riêng (override) TRÙNG tiktokId của NHÓM KHÁC gần như chắc chắn là
// dữ liệu bị stamp nhầm khi lướt nhóm lúc đang kết nối → gỡ bỏ để mỗi nhóm về đúng ID của mình.
function sanitizeLeakedLiveOverrides() {
  const otherIds = new Set(groups.map(g => normalizeId(g.tiktokId)).filter(Boolean));
  const pending = [];
  for (const g of groups) {
    const gid = g.id;
    const profile = groupProfiles[gid];
    const live = profile && profile.live;
    if (!live || typeof live !== 'object') continue;
    const override = normalizeId(live.username);
    if (!override) continue;
    const ownId = normalizeId(g.tiktokId);
    // Override = id của MỘT nhóm khác (không phải id của chính nhóm này) → rò rỉ, xoá đi.
    if (override !== ownId && otherIds.has(override)) {
      const nextLive = { ...live };
      delete nextLive.username;
      groupProfiles[gid] = { ...profile, live: nextLive };
      pending.push(saveGroupProfilePatch(gid, { live: nextLive }));
    }
  }
  return Promise.allSettled(pending);
}

function saveLiveConnectionConfig(groupId, patch = {}) {
  const gid = String(groupId || '');
  const hasUsername = Object.prototype.hasOwnProperty.call(patch, 'username');
  if (!gid) {
    const settingsPatch = {};
    if (hasUsername) {
      talentShowUsername = normalizeId(patch.username);
      settingsPatch.talentShowUsername = talentShowUsername;
    }
    if (typeof patch.autoConnect === 'boolean') {
      defaultAutoConnectPref = patch.autoConnect;
      autoConnectPref = patch.autoConnect;
      settingsPatch.autoConnect = patch.autoConnect;
    }
    return Object.keys(settingsPatch).length
      ? window.api.settings.set(settingsPatch).catch(() => {})
      : Promise.resolve();
  }

  const profile = getGroupProfile(gid);
  const live = profile.live && typeof profile.live === 'object' && !Array.isArray(profile.live) ? { ...profile.live } : {};
  if (hasUsername) {
    const username = normalizeId(patch.username);
    const groupUsername = normalizeId(groups.find(g => g.id === gid)?.tiktokId);
    if (username && username !== groupUsername) live.username = username;
    else delete live.username;
  }
  if (typeof patch.autoConnect === 'boolean') live.autoConnect = patch.autoConnect;
  return saveGroupProfilePatch(gid, { live });
}

function getStartupGroupId() {
  if (typeof savedActiveGroupId === 'string') {
    return !savedActiveGroupId || groups.some(g => g.id === savedActiveGroupId) ? savedActiveGroupId : null;
  }
  if (!savedLastUsername) return null;
  return groups.find(g => normalizeId(g.tiktokId) === savedLastUsername)?.id || '';
}

async function restoreAutoConnection() {
  const groupId = getStartupGroupId();
  if (groupId == null) return false;
  const live = getLiveConnectionConfig(groupId);
  if (!live.autoConnect || !live.username) return false;
  await setActiveGroup(groupId);
  const activeLive = getLiveConnectionConfig(activeGroupId);
  if (activeGroupId !== groupId || !activeLive.autoConnect || !activeLive.username) return false;
  setTimeout(() => {
    if (activeGroupId === groupId && !ttConnected && !ttConnecting) startConnect(activeLive.username);
  }, 900);
  return true;
}

// ===== Bộ lọc theo chế độ nhóm =====
function visibleGroups() { return activeGroupId ? groups.filter(g => g.id === activeGroupId) : groups; }
function visibleCreators() { return activeGroupId ? creators.filter(c => c.groupId === activeGroupId) : creators; }

function filePathToUrl(filePath) {
  const s = String(filePath || '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return 'file:///' + s.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:').split('/').map((part, i) => i === 0 ? part : encodeURIComponent(part)).join('/');
}

function soundNameFromValue(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const decoded = decodeURIComponent(s.replace(/^file:\/\/\//i, ''));
    return decoded.split(/[\\/]/).filter(Boolean).pop() || s;
  } catch {
    return s.split(/[\\/]/).filter(Boolean).pop() || s;
  }
}

// Tên file KHÔNG kèm đuôi (mp3/wav/…): "Một hai ba.mp3" → "Một hai ba".
function soundBaseName(value) { return soundNameFromValue(value).replace(/\.[^.\s\\/]+$/, ''); }

function setSoundInput(id, value) {
  const input = $('#' + id);
  input.dataset.path = value || '';
  input.value = soundNameFromValue(value);
}

function soundValue(id) {
  const input = $('#' + id);
  return input.dataset.path || input.value.trim();
}

function gameplaySoundEnabled() {
  const el = $('#gameSoundEnabled');
  return !el || el.checked;
}

function gameplaySoundValue(id) {
  return gameplaySoundEnabled() ? soundValue(id) : '';
}

function creatorAvatarValue(creator) {
  return creator?.avatar || '../logo/hp-logo.png';
}

function safeAvatarUrl(value) {
  const s = String(value || '').trim();
  return s || '../logo/hp-logo.png';
}

// ============================================================
// Avatar dropdown — phủ lên <select> gốc để hiện avatar nhóm/creator.
// Giữ nguyên <select> làm nguồn value + sự kiện 'change' nên toàn bộ
// logic hiện có (applyPkCreator, các listener đọc sel.value...) không đổi.
// ============================================================
const AVATAR_FALLBACK = '../logo/hp-logo.png';

// Fallback avatar toàn app: ảnh avatar lỗi (URL hỏng/hết hạn) → tự thay bằng logo HP.
// Chỉ áp cho avatar (theo class), KHÔNG đụng icon quà. Bắt ở pha capture vì sự kiện 'error' của <img> không bubble.
const AVATAR_SELECTOR = '.avatar, .cc-ava, .gc-avatar, .rk-avatar, .av-select__ava, .pkg-member-check img, .score-review-user img, .js-avatar';
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || el.dataset.avFallback) return;
  if (!el.matches(AVATAR_SELECTOR)) return;
  el.dataset.avFallback = '1';
  el.src = AVATAR_FALLBACK;
}, true);

function avatarForGroupId(id) {
  const g = (typeof groups !== 'undefined' ? groups : []).find(x => String(x.id) === String(id));
  return g?.avatar || '';
}
function avatarForCreatorId(id) {
  const c = (typeof creators !== 'undefined' ? creators : []).find(x => String(x.id) === String(id));
  return c?.avatar || '';
}

// Chuẩn hoá TikTok ID để so khớp (bỏ @, thường hoá).
function normTiktokId(v) { return String(v || '').trim().replace(/^@/, '').toLowerCase(); }

// Làm sạch Nick Name lấy từ TikTok: bỏ icon/emoji/ký hiệu, CHỈ giữ chữ (kể cả tiếng Việt)
// và số; gộp khoảng trắng thừa. Dùng khi bấm Tải avatar / tự lấy Nick Name.
function cleanNickname(name) {
  return String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tìm avatar/nickname ĐÃ BIẾT của một TikTok ID từ creator/nhóm khác đang có trong máy.
// Dùng để TÁI SỬ DỤNG NGAY khi thêm/sửa một thành viên trùng ID đã tồn tại — không phụ thuộc
// mạng (oembed nay bỏ avatar, tikwm hay bị giới hạn tần suất) nên "bấm Tải"/lưu vẫn ra avatar.
// Ưu tiên bản còn hạn (avatarNeedsRefetch=false); nếu không có thì lấy tạm bản bất kỳ có avatar.
function knownProfileForTiktokId(tiktokId, exceptCreatorId = '') {
  const id = normTiktokId(tiktokId);
  if (!id) return null;
  const cs = (typeof creators !== 'undefined' ? creators : []);
  const gs = (typeof groups !== 'undefined' ? groups : []);
  const fresh = (av) => av && !avatarNeedsRefetch(av);
  const cFresh = cs.find(x => (x.id || '') !== exceptCreatorId && normTiktokId(x.tiktokId) === id && fresh(x.avatar));
  if (cFresh) return { avatar: cFresh.avatar, nickname: cFresh.nickname || cFresh.channelName || '' };
  const gFresh = gs.find(x => normTiktokId(x.tiktokId) === id && fresh(x.avatar));
  if (gFresh) return { avatar: gFresh.avatar, nickname: gFresh.name || '' };
  const cAny = cs.find(x => (x.id || '') !== exceptCreatorId && normTiktokId(x.tiktokId) === id && x.avatar);
  if (cAny) return { avatar: cAny.avatar, nickname: cAny.nickname || cAny.channelName || '' };
  const gAny = gs.find(x => normTiktokId(x.tiktokId) === id && x.avatar);
  if (gAny) return { avatar: gAny.avatar, nickname: gAny.name || '' };
  return null;
}

function closeAllAvatarSelects(except) {
  document.querySelectorAll('.av-select.is-open').forEach(w => {
    if (w === except) return;
    w.classList.remove('is-open');
    const p = w.querySelector('.av-select__panel');
    if (p) p.hidden = true;
  });
}

function enhanceAvatarSelect(sel, resolveAvatar) {
  if (!sel || sel.dataset.avEnhanced) return;
  sel.dataset.avEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'av-select';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'av-select__btn';
  btn.innerHTML = '<img class="av-select__ava" alt="" /><span class="av-select__label"></span><span class="av-select__caret">▾</span>';
  const panel = document.createElement('div');
  panel.className = 'av-select__panel';
  panel.hidden = true;

  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel); // di chuyển select vào wrap (giữ nguyên listener + value)
  wrap.appendChild(btn);
  wrap.appendChild(panel);

  const avImg = btn.querySelector('.av-select__ava');
  const label = btn.querySelector('.av-select__label');
  const fallback = (img) => { img.onerror = () => { img.onerror = null; img.src = AVATAR_FALLBACK; }; };

  const optAvatar = (value) => (value === '' ? '' : (resolveAvatar ? resolveAvatar(value) : '')) || AVATAR_FALLBACK;

  function syncButton() {
    const opt = sel.options[sel.selectedIndex];
    label.textContent = opt ? opt.textContent : '';
    const hasValue = sel.value !== '';
    avImg.src = optAvatar(sel.value);
    avImg.classList.toggle('is-placeholder', !hasValue);
    fallback(avImg);
  }

  function buildPanel() {
    panel.innerHTML = '';
    for (const opt of Array.from(sel.options)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'av-select__opt' + (opt.value === sel.value ? ' is-active' : '');
      item.dataset.value = opt.value;
      const img = document.createElement('img');
      img.className = 'av-select__ava';
      img.src = optAvatar(opt.value);
      if (opt.value === '') img.classList.add('is-placeholder');
      fallback(img);
      const span = document.createElement('span');
      span.textContent = opt.textContent;
      item.append(img, span);
      item.addEventListener('click', () => {
        sel.value = opt.value;
        close();
        syncButton();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      panel.appendChild(item);
    }
  }

  function open() {
    if (sel.disabled) return;
    closeAllAvatarSelects(wrap);
    buildPanel();
    panel.hidden = false;
    wrap.classList.add('is-open');
    const active = panel.querySelector('.av-select__opt.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    panel.hidden = true;
    wrap.classList.remove('is-open');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.contains('is-open') ? close() : open();
  });

  // Khi render lại options (innerHTML) → dựng lại panel + đồng bộ nút.
  new MutationObserver(() => {
    syncButton();
    if (wrap.classList.contains('is-open')) buildPanel();
  }).observe(sel, { childList: true });

  // Bắt cả những chỗ gán trực tiếp sel.value = ... (không đổi innerHTML).
  const valueDesc = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return valueDesc.get.call(this); },
    set(v) {
      valueDesc.set.call(this, v);
      syncButton();
      if (wrap.classList.contains('is-open')) buildPanel();
    },
  });

  syncButton();
}

let avatarSelectsGlobalWired = false;
function initAvatarSelects() {
  ['#pkAgroup', '#pkBgroup', '#pkgGroup', '#crGroup'].forEach(s => enhanceAvatarSelect($(s), avatarForGroupId));
  ['#pkAcreator', '#pkBcreator', '#scCreatorSelect'].forEach(s => enhanceAvatarSelect($(s), avatarForCreatorId));
  if (!avatarSelectsGlobalWired) {
    avatarSelectsGlobalWired = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.av-select.is-open').forEach(w => {
        if (!w.contains(e.target)) {
          w.classList.remove('is-open');
          const p = w.querySelector('.av-select__panel');
          if (p) p.hidden = true;
        }
      });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllAvatarSelects(null); });
  }
}

function testSoundValue(value) {
  const soundUrl = String(value || '').trim();
  if (!soundUrl) {
    toast('Chưa chọn file âm thanh', 'error');
    return;
  }
  const audio = new Audio(soundUrl);
  audio.currentTime = 0;
  audio.play().catch(() => toast('Không phát được âm thanh này', 'error'));
}

function playSettingsSound(id, volumeId) {
  const soundUrl = String(soundValue(id) || '').trim();
  if (!soundUrl) {
    toast('Chưa chọn file âm thanh', 'error');
    return;
  }
  stopSettingsSound();
  settingsPreviewAudio = new Audio(soundUrl);
  settingsPreviewAudio.volume = Math.max(0, Math.min(1, (Number($('#' + volumeId)?.value) || 0) / 100));
  settingsPreviewAudio.play().catch(() => toast('Không phát được âm thanh này', 'error'));
}

function stopSettingsSound() {
  if (!settingsPreviewAudio) return;
  settingsPreviewAudio.pause();
  settingsPreviewAudio.currentTime = 0;
  settingsPreviewAudio = null;
}

function playScoreSound(value) {
  const soundUrl = String(value || '').trim();
  if (!soundUrl) return;
  try {
    if (!scoreSoundAudio) scoreSoundAudio = new Audio();
    scoreSoundAudio.pause();
    scoreSoundAudio.src = soundUrl;
    scoreSoundAudio.currentTime = 0;
    scoreSoundAudio.play().catch(() => {});
  } catch {}
}

function scoreRunKey(st = {}) {
  return String(st.runStartedAt || st.endAt || 'idle');
}

function handleScoreGameplaySound(st = {}, prevStatus = '') {
  const status = st.status || 'idle';
  if (!scoreSoundInitialized) {
    scoreSoundInitialized = true;
    scoreSoundLastStatus = status;
    scoreSoundRunKey = ['prestart', 'running', 'grace'].includes(status) ? scoreRunKey(st) : 'idle';
    return;
  }
  const key = ['prestart', 'running', 'grace'].includes(status) ? scoreRunKey(st) : 'idle';
  if (key !== scoreSoundRunKey) {
    scoreSoundRunKey = key;
    scoreSoundWarningPlayed = false;
    scoreSoundGoalPlayed = false;
    scoreSoundResultPlayed = false;
  }
  if (status !== scoreSoundLastStatus) {
    if (['prestart', 'running'].includes(status) && !['prestart', 'running', 'grace'].includes(prevStatus)) playScoreSound(st.startSound);
    if (status === 'success' && !scoreSoundResultPlayed) { scoreSoundResultPlayed = true; playScoreSound(st.successSound); }
    if (status === 'failed' && !scoreSoundResultPlayed) { scoreSoundResultPlayed = true; playScoreSound(st.failSound); }
  }
  const remainingMs = Number(st.remainingMs) || 0;
  if (!scoreSoundWarningPlayed && ['running', 'grace'].includes(status) && remainingMs <= 10000 && remainingMs > 0) {
    scoreSoundWarningPlayed = true;
    playScoreSound(st.warningSound);
  }
  const target = Math.max(1, Number(st.target) || 1);
  const score = Math.max(0, Number(st.score) || 0);
  if (!scoreSoundGoalPlayed && ['running', 'grace'].includes(status) && score >= target) {
    scoreSoundGoalPlayed = true;
    playScoreSound(st.goalSound);
  }
  scoreSoundLastStatus = status;
}

async function loadAudioOutputs(selectedId = 'default') {
  const sel = $('#audioOutput');
  if (!sel) return;
  sel.innerHTML = '<option value="default">Thiết bị phát mặc định</option>';
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const d of devices.filter(x => x.kind === 'audiooutput')) {
      const opt = document.createElement('option');
      opt.value = d.deviceId || 'default';
      opt.textContent = d.label || `Thiết bị phát ${sel.length}`;
      sel.appendChild(opt);
    }
    sel.value = Array.from(sel.options).some(o => o.value === selectedId) ? selectedId : 'default';
  } catch {}
}

// ============================================================
// Gift Picker
// ============================================================
const GiftPicker = (() => {
  let resolver = null;
  let filtered = [];
  let bound = false;
  let currentOpts = {};
  let selectedIds = new Set();
  let coinFilter = null; // null = tất cả; số = lọc theo mức coin

  function open(opts = {}) {
    if (!bound) bind(); // defensive — đảm bảo handler luôn được gắn
    return new Promise((resolve) => {
      resolver = resolve;
      currentOpts = opts;
      selectedIds = new Set((opts.selected || []).map(String));
      coinFilter = null;
      $('#gpCoins')?.querySelectorAll('.gp-coin').forEach(b => b.classList.toggle('is-active', b.dataset.coin === ''));
      $('#giftPicker').classList.add('is-open');
      $('#gpTitle').textContent = opts.title || '🎁 Chọn quà';
      $('#gpCount').textContent = `${giftMaster.length} quà`;
      $('#gpDone').hidden = !opts.multi;
      $('#gpQuery').value = '';
      setTimeout(() => $('#gpQuery')?.focus(), 50);
      render();
    });
  }
  function close(value) {
    const overlay = $('#giftPicker');
    if (overlay) overlay.classList.remove('is-open');
    $('#gpDone').hidden = true;
    const r = resolver; resolver = null;
    currentOpts = {};
    selectedIds = new Set();
    if (r) r(value || null);
  }
  function isOpen() { return $('#giftPicker')?.classList.contains('is-open'); }
  function render() {
    const q = $('#gpQuery').value.trim().toLowerCase();
    const sort = $('#gpSort').value;
    const disabledIds = new Set((currentOpts.disabledIds || []).map(String));
    const excludeIds = new Set((currentOpts.excludeIds || []).map(String));
    const priorityIds = new Set((currentOpts.priorityIds || []).map(String));
    const priorityLabel = currentOpts.priorityLabel || '🎵';
    const usedBy = currentOpts.usedBy || {};
    filtered = giftMaster.filter(g => {
      if (excludeIds.has(String(g.id))) return false;
      if (coinFilter != null && Number(g.diamond) < coinFilter) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || String(g.id).includes(q);
    });
    switch (sort) {
      case 'name-asc': filtered.sort((a, b) => a.name.localeCompare(b.name, 'vi')); break;
      case 'name-desc': filtered.sort((a, b) => b.name.localeCompare(a.name, 'vi')); break;
      case 'dia-asc': filtered.sort((a, b) => a.diamond - b.diamond); break;
      case 'dia-desc': filtered.sort((a, b) => b.diamond - a.diamond); break;
      case 'id-asc': filtered.sort((a, b) => Number(a.id) - Number(b.id)); break;
    }
    filtered.sort((a, b) => Number(selectedIds.has(String(b.id))) - Number(selectedIds.has(String(a.id))));
    // Quà ưu tiên (vd đã gán nhạc ở NHẠC DANCE) luôn lên ĐẦU danh sách.
    if (priorityIds.size) filtered.sort((a, b) => Number(priorityIds.has(String(b.id))) - Number(priorityIds.has(String(a.id))));
    const grid = $('#gpGrid');
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="gp-empty">Không tìm thấy quà phù hợp.</div>';
      return;
    }
    // Hiển thị full tất cả quà (lazy-load ảnh để vẫn mượt)
    grid.innerHTML = filtered.map(g => {
      const id = String(g.id);
      const disabled = disabledIds.has(id);
      const selected = selectedIds.has(id);
      const priority = priorityIds.has(id);
      return `
      <div class="gp-item${disabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''}${priority ? ' is-priority' : ''}" data-id="${escapeAttr(g.id)}" title="${escapeAttr(g.name)}">
        ${priority ? `<div class="gp-prio">${escapeHtml(priorityLabel)}</div>` : ''}
        ${g.icon ? `<img loading="lazy" src="${escapeAttr(g.icon)}" onerror="this.style.visibility='hidden'" />` : '<div style="width:56px;height:56px"></div>'}
        <div class="gp-iname">${escapeHtml(g.name)}</div>
        <div class="gp-iid">ID ${escapeHtml(g.id)}</div>
        <div class="gp-idia">🪙 ${escapeHtml(String(g.diamond || 0))}</div>
        ${disabled ? `<div class="gp-used">${escapeHtml(usedBy[id] || 'Đã chọn')}</div>` : ''}
      </div>
    `;
    }).join('');
    grid.querySelectorAll('.gp-item').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (disabledIds.has(String(id))) return;
      const g = giftMaster.find(x => String(x.id) === id);
      if (!g) return;
      if (currentOpts.multi) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        render();
      } else {
        close(g);
      }
    }));
  }
  function bind() {
    if (bound) return;
    const overlay = $('#giftPicker');
    if (!overlay) return; // DOM chưa sẵn
    $('#gpClose')?.addEventListener('click', (e) => { e.preventDefault(); close(null); });
    $('#gpDone')?.addEventListener('click', (e) => {
      e.preventDefault();
      close(giftMaster.filter(g => selectedIds.has(String(g.id))));
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    $('#gpQuery')?.addEventListener('input', render);
    $('#gpSort')?.addEventListener('change', render);
    $('#gpCoins')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.gp-coin');
      if (!btn) return;
      coinFilter = btn.dataset.coin === '' ? null : Number(btn.dataset.coin);
      $('#gpCoins').querySelectorAll('.gp-coin').forEach(b => b.classList.toggle('is-active', b === btn));
      render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(null); }
    });
    $('#gpRefresh')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = $('#gpRefresh');
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '⏳';
      try {
        const r = await window.api.gifts.refresh();
        if (r.ok) {
          await loadGiftMaster();
          toast(`✅ Đã cập nhật ${r.count} quà`, 'success');
        } else {
          toast('⚠ ' + (r.error || 'Lỗi refresh'), 'error');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
        render();
      }
    });
    bound = true;
  }

  // Auto-bind ngay khi script load (script ở cuối body nên DOM sẵn rồi).
  // Không phụ thuộc vào init() — kể cả init() throw thì popup vẫn close được.
  if (document.readyState !== 'loading') bind();
  else document.addEventListener('DOMContentLoaded', bind);

  return { open, close, bind };
})();

async function loadGiftMaster() {
  const r = await window.api.gifts.list();
  giftMaster = r.gifts || [];
}

// ============================================================
// Init
// ============================================================
// ============================================================
// DANH SÁCH NHẠC — quà → clip audio, hàng đợi phát, nhạc nền (Nhạc chờ)
// ============================================================
function clampVol01(v) { return Math.max(0, Math.min(1, (Number(v) || 0) / 100)); }
function currentOutputDeviceId() { const el = $('#audioOutput'); return el && el.value ? el.value : 'default'; }

// Nhạc nền = "Nhạc chờ" trong Cài đặt. Phát lặp; tạm dừng (duck) khi có clip quà phát.
const WaitingMusic = (() => {
  let audio = null, enabled = false, ducked = false, loadedSrc = '';
  function ensure() { if (!audio) { audio = new Audio(); audio.loop = true; } return audio; }
  function vol() { return clampVol01($('#waitingVolume')?.value ?? 100); }
  async function applySink(a) { try { if (a.setSinkId) await a.setSinkId(currentOutputDeviceId()); } catch {} }
  // Chỉ set src khi ĐỔI file → tránh reset currentTime (phát lại từ đầu).
  function load() {
    const s = soundValue('waitingSoundName'); if (!s) return false;
    const url = filePathToUrl(s);
    const a = ensure();
    if (loadedSrc !== url) { a.src = url; loadedSrc = url; }
    return true;
  }
  async function start() {
    enabled = true; ducked = false;
    if (!load()) return;
    const a = ensure();
    a.volume = vol();
    await applySink(a);
    a.play().catch(() => {});
  }
  function stop() { enabled = false; ducked = false; if (audio) { audio.pause(); try { audio.currentTime = 0; } catch {} } }
  // Tạm dừng khi clip quà phát — GIỮ nguyên vị trí.
  function duck() { if (!enabled || !audio) return; ducked = true; audio.pause(); }
  // Phát TIẾP từ vị trí đang dừng (không set lại src → không từ đầu).
  function unduck() {
    if (!enabled) return;
    ducked = false;
    const a = ensure();
    if (loadedSrc) { a.volume = vol(); a.play().catch(() => {}); }
  }
  function refreshVolume() { if (audio && !ducked) audio.volume = vol(); }
  return { start, stop, duck, unduck, refreshVolume, isEnabled: () => enabled };
})();

// Bật/tắt nhạc nền — đồng bộ giữa nút "▶ Phát nhạc nền" (toolbar), checkbox và Play/Dừng Nhạc chờ.
function startBgMusic() {
  musicCfg.bgEnabled = true; scheduleMusicSave();
  WaitingMusic.start();
  updateBgControls();
}
function stopBgMusic() {
  musicCfg.bgEnabled = false; scheduleMusicSave();
  WaitingMusic.stop();
  updateBgControls();
}
function updateBgControls() {
  const on = WaitingMusic.isEnabled();
  const btn = $('#mlBgToggle');
  if (btn) { btn.textContent = on ? '⏹ 🎶 Nhạc nền' : '▶ 🎶 Nhạc nền'; btn.classList.toggle('is-on', on); }
}

// ⏸ Ngưng/mở lại toàn bộ NHẠC DANCE (nhạc nền + clip biểu diễn) để dùng tính năng khác không bị tự phát.
function setMusicPaused(paused) {
  musicCfg.paused = !!paused;
  scheduleMusicSave();
  if (musicCfg.paused) {
    WaitingMusic.stop();   // dừng nhạc nền (giữ nguyên bgEnabled để mở lại)
    MusicQueue.stopAll();  // dừng clip đang phát (audio+video) + xóa danh sách phát
    Backgrounds.stopAll(); // dừng lớp nền mọi overlay
  } else if (musicCfg.bgEnabled) {
    WaitingMusic.start();  // mở lại nhạc nền nếu trước đó đang bật
  }
  updateMusicPausedUI();
  updateBgControls();
}
function updateMusicPausedUI() {
  const paused = !!musicCfg.paused;
  const cb = $('#mlPaused'); if (cb) cb.checked = paused;
  const panel = document.querySelector('.panel[data-panel="musiclist"]');
  if (panel) panel.classList.toggle('ml-paused', paused);
  // Khoá điều khiển nhạc nền khi đang ngưng.
  const bgBtn = $('#mlBgToggle'); if (bgBtn) bgBtn.disabled = paused;
}

// Báo cho STICKER DANCE để icon quà phóng to trong lúc phát hiệu ứng.
// Cấu hình âm thanh MỞ MÀN đọc trực tiếp từ DOM (áp dụng ngay, không cần bấm Lưu).
function preEffectCfg() {
  return {
    enabled: !!$('#preEffectEnabled')?.checked,
    sound: soundValue('preEffectSoundName'),
    volume: Number($('#preEffectVolume')?.value) || 0,
  };
}
// Ducking nhạc nền cho 1 mục: cờ per-item (on/off) ghi đè cờ chung; 'inherit' → theo cờ chung.
function effectiveDuck(item) {
  const o = item && item.videoDuck;
  if (o === 'on') return true;
  if (o === 'off') return false;
  return musicCfg.duckWaiting !== false;
}
function signalStickerStart(giftId) { window.api.stickerdance.signal({ type: 'perform-start', giftId }).catch(() => {}); }
function signalStickerEnd(giftId) { window.api.stickerdance.signal({ type: 'perform-end', giftId }).catch(() => {}); }
// Đẩy số lượt còn trong hàng đợi cho STICKER DANCE để chế độ "Đếm lùi" khớp với "Đang chờ".
// Gửi CẢ theo giftId lẫn giftName để ô Đập Trứng khớp giống hệt cách phát nhạc (giftId HOẶC tên):
// quà gán nhạc mà giftId của mục nhạc lệch giftId ô lưới vẫn đếm/nở trứng nhờ khớp theo tên.
function pushStickerQueueCounts(st) {
  st = st || MusicQueue.state();
  const pending = {};        // giftId -> số lượt
  const pendingByName = {};   // tên (thường hoá) -> số lượt
  const add = (it) => {
    if (!it || !it.giftId) return;
    pending[it.giftId] = (pending[it.giftId] || 0) + 1;
    const nm = String(it.giftName || '').toLowerCase();
    if (nm) pendingByName[nm] = (pendingByName[nm] || 0) + 1;
  };
  add(st.current);
  for (const it of st.waiting) add(it);
  window.api.stickerdance.signal({ type: 'queue', pending, pendingByName }).catch(() => {});
}

// Hàng đợi hiệu ứng: phát lần lượt. Mỗi ĐƠN VỊ quà = 1 lượt phát (combo x5 → 5 lượt) để STICKER DANCE
// đếm lùi khớp với số quà đã nhận. Giữ metadata (tên/icon) để hiển thị "đang phát" + "hàng chờ".
const MusicQueue = (() => {
  const q = [];              // hàng chờ: {uid, giftId, giftName, icon, name, audioPath, volume}
  let audio = null, pre = null, current = null, playing = false, seq = 0;
  // Video (mp4/webm) phát trên overlay OBS, không dùng <audio> cục bộ. videoPlayId = lượt đang chờ overlay
  // báo phát xong (qua IPC dancevideo:ended); videoTimer = dự phòng nếu overlay rớt kết nối.
  let videoPlayId = null, videoTimer = null, videoChannel = null, videoTimerAt = 0, videoTimerMs = 0;
  // ⏸ TẠM DỪNG mục ĐANG PHÁT (khác STOP ALL): giữ nguyên hàng chờ, chỉ ngưng clip hiện tại.
  // pausedEls = các <audio> thực sự đang phát lúc bấm tạm dừng (để tiếp tục đúng cái đang chạy).
  let paused = false, pausedEls = [];
  let speedFactor = 1; // "Tốc độ theo quà": hệ số nhân tạm thời cho AUDIO đang/ sẽ phát (video do overlay lo)
  let onChange = () => {};
  // GIỮ CHUỖI: mỗi giftId có "mốc hết máu" (ms). Tặng quà → làm đầy lại; cạn dần theo thời lượng.
  const streaks = new Map(); // giftId -> mốc hết chuỗi (Date.now ms)
  function streakGameOn() { return !!(typeof stickerCfg !== 'undefined' && stickerCfg && stickerCfg.streakEnabled); }
  function stealOn() { return streakGameOn() && stickerCfg && stickerCfg.streakSteal !== false; }
  function streakMs() { return Math.max(1, Math.min(120, Number(stickerCfg?.streakSeconds) || 10)) * 1000; }
  function refreshStreak(giftId) { if (!giftId) return; streaks.set(String(giftId), Date.now() + streakMs()); pushStreakState(); }
  function pushStreakState() {
    const obj = {}; streaks.forEach((v, k) => { obj[k] = v; });
    window.api.stickerdance.signal({ type: 'streak', streaks: obj }).catch(() => {});
  }
  // Chọn lượt phát kế tiếp. GIỮ CHUỖI: ưu tiên quà CÒN MÁU, giữa chúng lấy quà nhiều clip chờ nhất
  // (hoà → còn máu lâu hơn). Không quà nào còn máu → phát bình thường (FIFO). Tắt game → FIFO.
  // ƯU TIÊN giờ là VỊ TRÍ chèn (xử lý lúc enqueue) → pickNext chỉ cần lấy đầu hàng (FIFO thuần).
  function pickNext() {
    if (!q.length) return null;
    if (!streakGameOn()) return q.shift();
    const now = Date.now();
    const groups = new Map(); // giftId -> {count, until}
    for (const it of q) {
      const g = String(it.giftId);
      const e = groups.get(g) || { count: 0, until: streaks.get(g) || 0 };
      e.count++; groups.set(g, e);
    }
    // 1) Ưu tiên quà CÒN MÁU: nhiều clip chờ nhất (hoà → còn máu lâu hơn).
    let best = null;
    for (const [g, e] of groups) {
      if (e.until <= now) continue; // hết máu → chưa xét ở vòng này
      if (!best || e.count > best.count || (e.count === best.count && e.until > best.until)) best = { g, ...e };
    }
    // 2) Không quà nào còn máu → ÉP phát quà có SỐ LƯỢNG lớn nhất (hoà → còn máu lâu hơn, rồi thứ tự hàng chờ).
    if (!best) {
      for (const [g, e] of groups) {
        if (!best || e.count > best.count || (e.count === best.count && e.until > best.until)) best = { g, ...e };
      }
    }
    const i = q.findIndex(it => String(it.giftId) === best.g);
    return q.splice(i, 1)[0];
  }
  // CƯỚP CHUỖI: đang phát quà A, nếu quà B (còn máu, khác A) vượt số lượng → cắt ngang, BỎ A hiện tại,
  // nhảy sang B ngay. Cũng cướp nếu A đã hết máu mà B còn máu. Gọi mỗi khi có quà mới vào hàng.
  function trySteal() {
    if (!stealOn() || !playing || !current) return;
    const now = Date.now();
    const counts = new Map();
    for (const it of q) { const g = String(it.giftId); counts.set(g, (counts.get(g) || 0) + 1); }
    const curG = String(current.giftId);
    const curAlive = (streaks.get(curG) || 0) > now;
    const curCount = (counts.get(curG) || 0) + 1; // +1 cho item đang phát (tránh bị cướp khi hoà)
    let ch = null; // challenger: quà CÒN MÁU, khác quà đang phát, nhiều clip nhất
    for (const [g, cnt] of counts) {
      if (g === curG) continue;
      const until = streaks.get(g) || 0;
      if (until <= now) continue;
      if (!ch || cnt > ch.count || (cnt === ch.count && until > ch.until)) ch = { g, count: cnt, until };
    }
    if (!ch) return;
    if (curAlive && ch.count <= curCount) return; // A còn máu và không thua số lượng → giữ nguyên
    if (audio) { try { audio.pause(); } catch {} }   // cắt nhạc A; step() sẽ bỏ A hiện tại + chọn B (max còn máu)
    step();
  }
  function ensure() { if (!audio) { audio = new Audio(); audio.addEventListener('ended', step); } return audio; }
  function enqueue(item) {
    // Trần 1000 khớp với ô nhập "▶ DS" & repeatCount thực tế — KHÔNG chặn ở 50, kẻo hàng đợi
    // (và số đếm lùi trên OBS) bị kẹt ở 50 khi tặng/bấm thử > 50 quà.
    const plays = Math.max(1, Math.min(1000, Number(item.plays) || 1));
    // Nhiều file nhạc → MỖI lượt phát bốc NGẪU NHIÊN 1 file; lưu luôn tên file (bỏ đuôi) cho hàng đợi hiển thị.
    const pool = Array.isArray(item.audios) && item.audios.length ? item.audios : (item.audioPath ? [item.audioPath] : []);
    const rate = musicRate(item.speed);
    const priority = clampInt(item.priority, 0, 0, 999);
    const pre = (item.preEnabled && Array.isArray(item.preAudios) && item.preAudios.length)
      ? { audios: item.preAudios.slice(), volume: item.preVolume } : null;
    const ch = danceChannelOf(item);
    const duck = item.videoDuck || 'inherit';
    const batch = [];
    for (let i = 0; i < plays; i++) {
      const ap = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
      // AUDIO lẫn VIDEO vào CHUNG 1 danh sách phát, LẦN LƯỢT theo đúng thứ tự tặng (FIFO) — không đè nhau.
      // Video phát trên overlay đã chọn (item.overlay); audio phát <audio> cục bộ. Combo N → N hàng.
      batch.push({ uid: 'q' + (++seq), seqNo: seq, giftId: String(item.giftId || ''), giftName: item.giftName || '', icon: item.icon || '', name: item.name || item.giftName || '', audioPath: ap, audioName: soundBaseName(ap), volume: item.volume, rate, priority, pre, videoDuck: duck, overlay: ch });
    }
    // ƯU TIÊN = VỊ TRÍ chèn vào hàng chờ (1 = ngay dưới quà đang phát; 3 = hàng thứ 3…). 0 = thường (nối đuôi).
    // Combo N → chèn cả cụm N liền nhau tại vị trí đó. Khi BẬT Giữ chuỗi, pickNext tự xếp lại theo luật chuỗi.
    if (priority >= 1) { const at = Math.max(0, Math.min(q.length, priority - 1)); q.splice(at, 0, ...batch); }
    else q.push(...batch);
    if (streakGameOn()) refreshStreak(String(item.giftId || '')); // tặng quà → làm đầy máu chuỗi
    notify();
    if (q.length && !playing) step();
    else if (playing) trySteal(); // đang phát → kiểm tra cướp chuỗi
  }
  async function step() {
    paused = false; pausedEls = []; // rời clip cũ → bỏ trạng thái ⏸ (clip mới luôn phát bình thường)
    stopPre(); // dừng âm thanh mở màn cũ (nếu đang phát)
    // Rời khỏi clip video đang phát → dừng luôn video trên overlay (không để nó phát tiếp khi bỏ qua/cướp).
    if (current) { signalStickerEnd(current.giftId); if (isVideoFile(current.audioPath)) cancelVideo(); current = null; }
    const item = pickNext();
    if (!item) { playing = false; duckRefresh(); notify(); return; }
    playing = true; current = item;
    // Duck nhạc nền: gộp cả nhạc đang phát lẫn video các kênh (mỗi cái có cờ per-item / cờ chung).
    duckRefresh();
    signalStickerStart(item.giftId);
    notify();
    // Âm thanh MỞ MÀN: ưu tiên "Bật nhạc trước" RIÊNG của quà; không có thì dùng cấu hình chung.
    const ip = item.pre;
    if (ip && Array.isArray(ip.audios) && ip.audios.length) {
      const snd = ip.audios[Math.floor(Math.random() * ip.audios.length)];
      playIntro({ sound: snd, volume: ip.volume }, () => playClip(item));
    } else {
      const pe = preEffectCfg();
      if (pe.enabled && pe.sound) playIntro(pe, () => playClip(item));
      else playClip(item);
    }
  }
  // Trần thời lượng 1 clip video (dự phòng nếu overlay không báo "phát xong" — vd OBS chưa mở/rớt kết nối).
  function maxClipMs() { const s = Number(danceVideoCfg && danceVideoCfg.maxClipSec) || 90; return Math.max(5, s) * 1000 + 2000; }
  function cancelVideo() {
    videoPlayId = null;
    if (videoTimer) { clearTimeout(videoTimer); videoTimer = null; }
    videoTimerMs = 0; videoTimerAt = 0;
    try { window.api.dancevideo.stopMain(videoChannel); } catch {}
    videoChannel = null;
  }
  // Overlay báo clip video (khớp playId) phát xong/lỗi → bước sang lượt kế như <audio>.ended.
  function onVideoEnded(pid) {
    if (!pid || pid !== videoPlayId) return;
    videoPlayId = null;
    if (videoTimer) { clearTimeout(videoTimer); videoTimer = null; }
    step();
  }
  // Video: KHÔNG dùng <audio> cục bộ; gửi lệnh cho overlay OBS phát (cả hình + tiếng qua OBS).
  function playVideoClip(item) {
    if (audio) { try { audio.pause(); } catch {} } // đảm bảo không có clip mp3 chạy song song
    const pid = 'dv' + (++seq);
    videoPlayId = pid;
    videoChannel = item.overlay || danceChannelOf(item); // overlay đã chọn cho quà này (WEBM 1/2/3)
    const rate = Number(item.rate) > 0 ? Number(item.rate) : undefined;
    window.api.dancevideo.play({ channel: videoChannel, playId: pid, src: item.audioPath, volume: item.volume, rate })
      .then((r) => {
        if (pid !== videoPlayId) return; // đã chuyển lượt trong lúc chờ
        if (videoTimer) clearTimeout(videoTimer);
        // Có overlay OBS: chờ overlay báo "phát xong" (timer chỉ là trần dự phòng).
        // Không có overlay: bỏ qua nhanh (~1.8s) để hàng đợi không kẹt cả phút.
        videoTimerMs = (r && r.clients > 0) ? maxClipMs() : 1800;
        videoTimerAt = Date.now();
        videoTimer = paused ? null : setTimeout(() => onVideoEnded(pid), videoTimerMs);
        if (paused && videoChannel) { try { window.api.dancevideo.setPaused({ channel: videoChannel, paused: true }); } catch {} }
      })
      .catch(() => onVideoEnded(pid));
  }
  async function playClip(item) {
    if (isVideoFile(item.audioPath)) return playVideoClip(item);
    const a = ensure();
    try { if (a.setSinkId) await a.setSinkId(currentOutputDeviceId()); } catch {}
    if (current !== item) return; // đã bị chuyển lượt (skip/cướp) trong lúc chờ → bỏ
    a.src = filePathToUrl(item.audioPath);
    a.volume = clampVol01(item.volume);
    try { a.currentTime = 0; } catch {}
    try { a.playbackRate = audioRateFor(item); } catch {}
    a.play().catch(() => step());
  }
  // Tốc độ audio thực = tốc độ riêng quà × hệ số "Tốc độ theo quà" (nếu đang bật), chặn 0.25..4x.
  function audioRateFor(item) { return Math.max(0.25, Math.min(4, (Number(item && item.rate) || 1) * speedFactor)); }
  // Bật/tắt hệ số tốc độ tạm thời — áp NGAY cho clip audio đang phát + mọi clip audio phát sau.
  function setSpeedFactor(f) {
    speedFactor = Number(f) > 0 ? Number(f) : 1;
    if (audio && current && !isVideoFile(current.audioPath)) { try { audio.playbackRate = audioRateFor(current); } catch {} }
  }
  function ensurePre() { if (!pre) pre = new Audio(); return pre; }
  function stopPre() { if (pre) { try { pre.onended = null; pre.onerror = null; pre.pause(); } catch {} } }
  function playIntro(pe, onDone) {
    const p = ensurePre();
    try { if (p.setSinkId) p.setSinkId(currentOutputDeviceId()); } catch {}
    p.src = filePathToUrl(pe.sound);
    p.volume = clampVol01(pe.volume);
    try { p.currentTime = 0; } catch {}
    let done = false;
    const go = () => { if (done) return; done = true; onDone(); };
    p.onended = go; p.onerror = go;
    p.play().catch(go);
  }
  function skipCurrent() { clearPause(); stopPre(); if (audio) audio.pause(); step(); }     // bỏ cái đang phát → sang cái kế
  // ⏸ TẠM DỪNG / TIẾP TỤC mục đang phát (audio local + video overlay). KHÔNG đụng hàng chờ.
  function isPaused() { return paused; }
  function clearPause() { // dọn cờ tạm dừng khi rời clip (skip/stopAll/step) — không giữ trạng thái ⏸ sang clip mới
    paused = false; pausedEls = [];
    if (videoChannel) { try { window.api.dancevideo.setPaused({ channel: videoChannel, paused: false }); } catch {} }
  }
  function setPaused(on) {
    on = !!on;
    if (on === paused) return;
    if (on && !current) return; // không có gì đang phát → khỏi tạm dừng
    paused = on;
    if (paused) {
      // Ngưng <audio> đang phát (nhạc mở màn hoặc clip chính) + ghi lại để tiếp tục đúng cái đó.
      pausedEls = [];
      for (const el of [pre, audio]) { if (el && !el.paused && !el.ended && el.src) { pausedEls.push(el); try { el.pause(); } catch {} } }
      // Video: pause trên overlay + đóng băng timer dự phòng (trừ đi phần đã trôi).
      if (current && isVideoFile(current.audioPath) && videoChannel) {
        try { window.api.dancevideo.setPaused({ channel: videoChannel, paused: true }); } catch {}
        if (videoTimer) { videoTimerMs = Math.max(0, videoTimerMs - (Date.now() - videoTimerAt)); clearTimeout(videoTimer); videoTimer = null; }
      }
    } else {
      for (const el of pausedEls) { try { el.play().catch(() => {}); } catch {} }
      pausedEls = [];
      if (current && isVideoFile(current.audioPath) && videoChannel) {
        try { window.api.dancevideo.setPaused({ channel: videoChannel, paused: false }); } catch {}
        if (videoPlayId && !videoTimer) { videoTimerAt = Date.now(); const pid = videoPlayId; videoTimer = setTimeout(() => onVideoEnded(pid), Math.max(300, videoTimerMs)); }
      }
    }
    notify();
  }
  function togglePause() { setPaused(!paused); }
  // 🎲 XÚC XẮC: xáo trộn NGẪU NHIÊN thứ tự hàng chờ (Fisher–Yates) để các quà giống nhau không
  // dồn 1 cụm — ví dụ 6 AMY liền nhau sẽ được trộn xen kẽ với CoCo/HARLEY/… Giữ nguyên cái đang phát.
  function shuffle() { for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; } notify(); }
  function clearAll() { q.length = 0; notify(); }                  // xóa toàn bộ hàng chờ (giữ cái đang phát)
  // Ngưng hẳn: dừng clip đang phát + âm mở màn, xóa hàng chờ, thả duck nhạc nền.
  function stopAll() {
    q.length = 0;
    clearPause();
    stopPre();
    if (audio) { try { audio.pause(); } catch {} }
    cancelVideo(); // dừng luôn clip video đang phát trên overlay
    if (current) { signalStickerEnd(current.giftId); }
    current = null; playing = false;
    duckRefresh();
    notify();
  }
  function clearCount(n) { q.splice(0, Math.max(0, Number(n) || 0)); notify(); }  // xóa N cái đầu hàng chờ
  function removeUid(uid) { const i = q.findIndex(x => x.uid === uid); if (i >= 0) { q.splice(i, 1); notify(); } }
  // Bấm icon trên thanh rail → DỒN mọi lượt của quà này lên ĐẦU hàng đợi để "phát ngay".
  // Không cắt clip đang phát (chờ hết cái hiện tại rồi tới quà vừa bấm).
  function bumpGiftToTop(giftId) {
    const gid = String(giftId || ''); if (!gid) return;
    const mine = [], rest = [];
    for (const it of q) (String(it.giftId) === gid ? mine : rest).push(it);
    if (!mine.length) return;
    // TẮT Giữ chuỗi: pickNext lấy đầu hàng → chỉ cần dồn lên đầu là được chọn kế tiếp.
    q.length = 0; q.push(...mine, ...rest);
    if (streakGameOn()) refreshStreak(gid); // BẬT Giữ chuỗi: làm đầy máu để được luật chuỗi ưu tiên
    notify();
    if (!playing) step(); // rảnh → phát ngay; đang phát → chờ hết clip hiện tại
  }
  function state() { return { current, waiting: q.slice(), total: q.length, paused }; }
  // Nhạc đang phát CÓ muốn tắt nhạc nền không (để duckRefresh gộp với các kênh video).
  function wantsDuck() { return !!(current && effectiveDuck(current)); }
  function setOnChange(fn) { onChange = fn || (() => {}); }
  function notify() { try { onChange(state()); } catch {} }
  return { enqueue, skipCurrent, shuffle, clearAll, stopAll, clearCount, removeUid, bumpGiftToTop, state, wantsDuck, setOnChange, pushStreak: pushStreakState, onVideoEnded, setSpeedFactor, setPaused, togglePause, isPaused };
})();

// (Đã gộp video vào MusicQueue — không còn hàng đợi video riêng. Video & mp3 phát LẦN LƯỢT chung 1 danh sách.)
// ==== Lớp NỀN riêng cho từng overlay — độc lập, đè lên tất cả (không xếp hàng với danh sách phát) ====
const Backgrounds = (() => {
  const active = {}; const timers = {}; // ch -> {giftId,name,icon,count} / setTimeout
  function maxClipMs() { const s = Number(danceVideoCfg && danceVideoCfg.maxClipSec) || 90; return Math.max(5, s) * 1000 + 2000; }
  function play(item, clips, volume, rate) {
    const ch = danceChannelOf(item);
    try { window.api.dancevideo.playBackground({ channel: ch, clips, volume, rate }); } catch {}
    active[ch] = { channel: ch, giftId: item.giftId, name: item.name || item.giftName || '', icon: item.icon || '', count: clips.length };
    // Nền không báo "phát xong" từng clip → dọn hiển thị bằng trần dự phòng (số clip × maxClip).
    if (timers[ch]) clearTimeout(timers[ch]);
    timers[ch] = setTimeout(() => { active[ch] = null; timers[ch] = null; notifyVideoQueues(); }, clips.length * maxClipMs() + 1500);
    notifyVideoQueues();
  }
  function clear(ch) { if (timers[ch]) { clearTimeout(timers[ch]); timers[ch] = null; } active[ch] = null; }
  function onEnded(ch) { clear(ch); notifyVideoQueues(); }
  function stopAll() { for (const ch of DANCE_CHANNELS) { try { window.api.dancevideo.stopBackground(ch); } catch {} clear(ch); } notifyVideoQueues(); }
  function list() { return DANCE_CHANNELS.map(ch => active[ch]).filter(Boolean); }
  return { play, onEnded, stopAll, list };
})();
// Nhạc nền tạm dừng khi mục đang phát (audio HOẶC video) yêu cầu duck.
function duckRefresh() {
  const want = MusicQueue.wantsDuck();
  if (want) WaitingMusic.duck(); else WaitingMusic.unduck();
}
// Lớp nền đổi trạng thái → vẽ lại phần danh sách phát.
function notifyVideoQueues() { try { renderMusicQueue(); } catch {} }

// Gói dữ liệu 1 quà để đưa vào hàng đợi (kèm tốc độ, ưu tiên, nhạc-trước riêng).
function musicQueuePayload(x, plays) {
  return {
    giftId: x.giftId, giftName: x.giftName, icon: x.icon, name: x.name,
    audios: x.audios, audioPath: x.audioPath, volume: x.volume,
    speed: x.speed, priority: x.priority,
    preEnabled: x.preEnabled, preAudios: x.preAudios, preVolume: x.preVolume,
    overlay: x.overlay, videoDuck: x.videoDuck, plays,
  };
}
const MusicList = {
  onGift(d) {
    if (musicCfg.paused) return; // ⏸ NHẠC DANCE đang ngưng → không phát clip biểu diễn
    if (!musicItems.length) return;
    const gid = String(d.giftId || ''), gname = String(d.giftName || '').toLowerCase();
    const item = musicItems.find(m => String(m.giftId) === gid || (m.giftName && String(m.giftName).toLowerCase() === gname));
    if (!item || !item.audioPath) return;
    if (item.autoEnabled === false) return; // ⏸ TẮT kích hoạt tự động → quà lên vẫn không tự phát (chỉ ▶ DS thủ công)
    const plays = Math.max(1, Number(d.repeatCount) || 1);
    if (item.bgMode) { playBackgroundItem(item, plays); return; } // "Chạy nền": đè lên trên, KHÔNG vào hàng đợi
    MusicQueue.enqueue(musicQueuePayload(item, plays));
  },
};
// ==== TỐC ĐỘ THEO QUÀ: quà chỉ định → tự tăng/giảm tốc độ nhạc/video trong X giây rồi trả về ====
const SPEED_MODES = ['audio', 'video', 'both'];
const SPEED_MODE_LABEL = { audio: '🎵 Audio', video: '🎬 Video', both: '🎵🎬 Cả hai' };
function normalizeSpeedGift(g) {
  g = g || {};
  return {
    id: String(g.id || '') || mlNewId(),
    giftId: String(g.giftId || ''),
    giftName: g.giftName || '',
    icon: g.icon || '',
    speed: clampInt(g.speed, 0, -75, 200),        // %chênh so với 1x (0 = 1.0× bình thường; âm = chậm, dương = nhanh)
    duration: clampInt(g.duration, 10, 1, 600),   // thời gian giữ tốc độ (giây), mặc định 10
    mode: SPEED_MODES.includes(g.mode) ? g.mode : 'both',
    enabled: g.enabled !== false,
  };
}
function normalizeSpeedGifts(arr) { return Array.isArray(arr) ? arr.map(normalizeSpeedGift) : []; }
// Bộ điều khiển tốc độ: mỗi lượt tặng (kể cả combo N) & mỗi rule XẾP HÀNG thành các đoạn tốc độ,
// phát LẦN LƯỢT mỗi đoạn `duration` giây đến khi hết — nhanh/chậm/nhanh xen kẽ vẫn đúng thứ tự.
const SpeedControl = (() => {
  let queue = [];      // [{mode, factor, duration}]
  let cur = null;      // đoạn đang chạy {mode, factor, duration, endsAt}
  let timer = null;
  // Đặt TUYỆT ĐỐI tốc độ audio & video theo đoạn (null = trả cả hai về 1.0×).
  function applySegment(seg) {
    const aF = seg && (seg.mode === 'audio' || seg.mode === 'both') ? seg.factor : 1;
    const vF = seg && (seg.mode === 'video' || seg.mode === 'both') ? seg.factor : 1;
    MusicQueue.setSpeedFactor(aF);
    try { window.api.dancevideo.setSpeed({ factor: vF }); } catch {}
  }
  function startNext() {
    const seg = queue.shift() || null;
    cur = seg ? { ...seg, endsAt: Date.now() + seg.duration * 1000 } : null;
    applySegment(cur);
    if (timer) { clearTimeout(timer); timer = null; }
    if (cur) timer = setTimeout(startNext, cur.duration * 1000);
    updateSpeedActiveUI();
  }
  // Đưa `times` đoạn của rule vào cuối hàng (times = số lần tặng, combo → N).
  // Mỗi đoạn nhớ `ruleId` để CHỈNH REALTIME: kéo thanh tốc độ khi đang chạy → cập nhật ngay đoạn đó.
  function enqueue(rule, times) {
    if (!rule) return;
    const factor = musicRate(rule.speed); // 1 + speed/100, chặn 0.25..3x
    const duration = clampInt(rule.duration, 10, 1, 600);
    const mode = SPEED_MODES.includes(rule.mode) ? rule.mode : 'both';
    const n = clampInt(times, 1, 1, 1000);
    for (let i = 0; i < n; i++) queue.push({ ruleId: rule.id || '', mode, factor, duration });
    if (!cur) startNext(); else updateSpeedActiveUI(); // rảnh → chạy ngay; đang chạy → nối đuôi
  }
  function trigger(rule) { enqueue(rule, 1); }  // ▶ Chạy thử = 1 đoạn
  // REALTIME: người dùng chỉnh tốc độ/chế độ của 1 quà trong lúc nó đang chạy → áp NGAY cho đoạn
  // đang chạy + các đoạn cùng quà còn chờ, không phải đợi hết đoạn rồi mới đổi.
  function liveUpdate(rule) {
    if (!rule || !rule.id) return;
    const factor = musicRate(rule.speed);
    const mode = SPEED_MODES.includes(rule.mode) ? rule.mode : 'both';
    let touched = false;
    for (const seg of queue) { if (seg.ruleId === rule.id) { seg.factor = factor; seg.mode = mode; touched = true; } }
    if (cur && cur.ruleId === rule.id) { cur.factor = factor; cur.mode = mode; applySegment(cur); touched = true; }
    if (touched) updateSpeedActiveUI();
  }
  // Dừng hẳn: xóa hàng chờ, trả tốc độ về bình thường ngay.
  function revert() {
    queue = [];
    if (timer) { clearTimeout(timer); timer = null; }
    cur = null;
    applySegment(null);
    updateSpeedActiveUI();
  }
  // Quà lên → nếu khớp 1 rule đang bật thì xếp N đoạn (N = số lần tặng/combo).
  function onGift(d) {
    if (musicCfg.paused) return;
    const gid = String(d.giftId || ''), gname = String(d.giftName || '').toLowerCase();
    const rule = (musicCfg.speedGifts || []).find(r => r.enabled && (String(r.giftId) === gid || (r.giftName && String(r.giftName).toLowerCase() === gname)));
    if (rule) enqueue(rule, Math.max(1, Number(d.repeatCount) || 1));
  }
  function isActive() { return !!cur || queue.length > 0; }
  function pending() { return queue.length + (cur ? 1 : 0); }
  return { trigger, enqueue, revert, onGift, isActive, pending, liveUpdate };
})();
// "Chạy nền": phát các clip VIDEO của quà tuần tự trên lớp nền overlay (đè lên tất cả), combo → N lượt.
// Không có file video → coi như thường (đưa vào 🎬 Hàng đợi) để không mất tác dụng khi user bật nhầm.
function playBackgroundItem(item, plays) {
  const vids = (item.audios || []).filter(isVideoFile);
  if (!vids.length) {
    MusicQueue.enqueue(musicQueuePayload(item, plays));
    return;
  }
  const clips = [];
  for (let i = 0; i < plays; i++) clips.push(vids[Math.floor(Math.random() * vids.length)]);
  const rate = musicRate(item.speed) !== 1 ? musicRate(item.speed) : undefined;
  Backgrounds.play(item, clips, item.volume, rate);
}

// Tốc độ phát: lưu speed = %chênh so với 1x (0 = bình thường). rate = 1 + speed/100, chặn 0.25..3x.
function musicRate(speed) { const s = Number(speed) || 0; return Math.max(0.25, Math.min(3, 1 + s / 100)); }
function normalizeMusicItem(m) {
  // Hỗ trợ NHIỀU file nhạc cho 1 quà (audios[]). Giữ audioPath = file đầu để tương thích code cũ + hiển thị.
  let audios = Array.isArray(m.audios) ? m.audios.map(x => String(x || '')).filter(Boolean) : [];
  if (!audios.length && m.audioPath) audios = [String(m.audioPath)];
  // Nhạc mở màn RIÊNG cho quà này (Bật nhạc trước) — phát ngẫu nhiên 1 file trước clip chính.
  let preAudios = Array.isArray(m.preAudios) ? m.preAudios.map(x => String(x || '')).filter(Boolean) : [];
  if (!preAudios.length && m.preSound) preAudios = [String(m.preSound)];
  return {
    giftId: String(m.giftId || ''), giftName: m.giftName || '', icon: m.icon || '',
    diamond: Number(m.diamond) || 0, audios, audioPath: audios[0] || '',
    name: m.name || m.giftName || '',
    volume: Number.isFinite(Number(m.volume)) ? Number(m.volume) : 100,
    qty: clampInt(m.qty, 1, 1, 1000),
    autoEnabled: m.autoEnabled !== false, // Kích hoạt tự động khi có quà (mặc định BẬT); TẮT = chỉ phát khi bấm ▶ DS thủ công
    subGroup: String(m.subGroup || ''),   // KHU CON (phân nhóm con); '' = chưa phân khu
    overlay: DANCE_CHANNELS.includes(m.overlay) ? m.overlay : 'webm1', // overlay OBS phát video (webm1/2/3)
    speed: clampInt(m.speed, 0, -75, 200), // Tốc độ Audio/Video: %chênh so với 1x (0 = bình thường)
    priority: clampInt(m.priority, 0, 0, 999), // Ưu tiên trong hàng đợi (cao hơn = phát trước)
    // ==== Nhạc mở màn riêng cho quà (Bật nhạc trước) ====
    preEnabled: !!m.preEnabled,
    preAudios,
    preVolume: Number.isFinite(Number(m.preVolume)) ? Number(m.preVolume) : 100,
    // ==== Video (mp4/webm) trên overlay OBS ====
    bgMode: !!m.bgMode, // "Chạy nền": đè lên tất cả, không theo hàng đợi
    videoPos: DANCE_POS.includes(m.videoPos) ? m.videoPos : 'default', // vị trí trên overlay
    videoSize: clampInt(m.videoSize, 0, 0, 100), // % chiều rộng (0 = theo overlay)
    videoDuck: (m.videoDuck === 'on' || m.videoDuck === 'off') ? m.videoDuck : 'inherit', // ghi đè duck nhạc nền
  };
}
// Danh mục KHU CON dùng chung cho mọi danh sách (base + nhóm): [{id, name, collapsed}].
function normalizeSubGroups(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.map(g => ({
    id: String(g && g.id || '').trim(),
    name: String(g && g.name || '').trim() || 'Khu con',
    collapsed: !!(g && g.collapsed),
  })).filter(g => g.id && !seen.has(g.id) && seen.add(g.id));
}
function musicNameFor(giftId) { const m = musicItems.find(x => String(x.giftId) === String(giftId)); return m ? (m.name || m.giftName || '') : ''; }
// Đồng bộ TÊN 2 chiều giữa 🎵 NHẠC DANCE (m.name) và ✨ Sticker Dance (cell.text) theo cùng giftId.
// Cập nhật thẳng vào DOM ô đối diện (không re-render) để không mất focus khi đang gõ.
function syncNameToSticker(giftId, name) {
  if (!stickerCfg || !Array.isArray(stickerCfg.cells)) return;
  let changed = false;
  stickerCfg.cells.forEach(cell => {
    // Chỉ ghi đè khi tên THỰC SỰ khác (bỏ qua khác biệt do xuống dòng) → không xoá mất
    // các dấu Enter người dùng đã đặt trong ô khi NHẠC DANCE (1 dòng) echo tên về.
    if (String(cell.giftId) === String(giftId) && oneLineName(cell.text) !== oneLineName(name)) {
      cell.text = name; changed = true;
      const el = $(`.sd-e-cell[data-row="${cell.row}"][data-col="${cell.col}"] .sd-e-text`);
      if (el && el.value !== name) { el.value = name; autoGrowTa(el); }
    }
  });
  if (changed) scheduleStickerSave();
}
function syncNameToMusic(giftId, name) {
  let changed = false;
  musicItems.forEach((m, i) => {
    if (String(m.giftId) === String(giftId) && m.name !== name) {
      m.name = name; changed = true;
      const el = $(`.ml-row[data-i="${i}"] .ml-name`);
      if (el && el.value !== name) el.value = name;
    }
  });
  if (changed) scheduleMusicSave();
}
async function loadMusicListConfig() {
  const st = await window.api.musiclist.getState().catch(() => null);
  musicItems = Array.isArray(st?.items) ? st.items.map(normalizeMusicItem) : [];
  // NHẠC DANCE mặc định LUÔN bật STOP ALL khi mở app để không tự phát nhạc; user tự tắt khi cần dùng.
  musicCfg = { duckWaiting: st?.duckWaiting !== false, bgEnabled: !!st?.bgEnabled, paused: true, displayLimit: clampInt(st?.displayLimit, 50, 1, 500), videoLimit: clampInt(st?.videoLimit, 10, 1, 100), subGroups: normalizeSubGroups(st?.subGroups), speedGifts: normalizeSpeedGifts(st?.speedGifts), railIconScale: clampFloat(st?.railIconScale, 1, 0.7, 1.8), railCountScale: clampFloat(st?.railCountScale, 1, 0.7, 2), railCountBg: st?.railCountBg !== false };
  musicBaseItems = musicItems.map(normalizeMusicItem); // chốt danh sách gốc TALENT SHOW
  musicGroupId = '';
  danceVideoCfg = await window.api.dancevideo.getConfig().catch(() => null); // cấu hình overlay Video
}
// File gốc (music-list.json) LUÔN giữ danh sách TALENT SHOW + các cờ chung; danh sách riêng của
// nhóm lưu trong hồ sơ nhóm (groupProfiles[gid].music).
function collectMusicCfg() {
  const items = musicGroupId ? (musicBaseItems || []) : musicItems;
  return { items, duckWaiting: musicCfg.duckWaiting, bgEnabled: musicCfg.bgEnabled, paused: musicCfg.paused, displayLimit: musicCfg.displayLimit, videoLimit: musicCfg.videoLimit, subGroups: normalizeSubGroups(musicCfg.subGroups), speedGifts: normalizeSpeedGifts(musicCfg.speedGifts), railIconScale: musicCfg.railIconScale, railCountScale: musicCfg.railCountScale, railCountBg: musicCfg.railCountBg };
}
const _musicSaver = makeAutoSaver(() => {
  // Đang ở nhóm → lưu danh sách quà vào hồ sơ nhóm; cờ chung + danh sách gốc vẫn ghi file gốc.
  if (musicGroupId) saveGroupProfilePatch(musicGroupId, { music: musicItems.map(normalizeMusicItem) });
  else musicBaseItems = musicItems.map(normalizeMusicItem);
  return window.api.musiclist.setConfig(collectMusicCfg()).catch(() => {});
});
function scheduleMusicSave() { _musicSaver.schedule(); }
// Đổi nhóm đang chọn → chốt danh sách hiện tại, nạp danh sách của nhóm mới.
// Nhóm chưa có hồ sơ → TỰ THÊM quà mặc định của các Creator trong nhóm (như bấm 👤 Creator).
// Nhóm đã có hồ sơ → nạp lại, đồng thời bổ sung Creator mới chưa có trong danh sách.
function musicItemsForGroup(groupId) {
  const prof = getGroupProfile(groupId).music;
  const items = Array.isArray(prof) ? prof.map(normalizeMusicItem) : [];
  const members = (creators || []).filter(c => String(c.groupId || '') === String(groupId || ''));
  for (const c of members) {
    if (!c.defaultGiftId && !c.defaultGiftName) continue;
    const gid = String(c.defaultGiftId || '');
    if (gid && items.some(m => String(m.giftId) === gid)) continue; // tránh trùng quà
    const cname = c.nickname || c.tiktokId || 'Creator';
    const base = gid ? (musicBaseItems || []).find(m => String(m.giftId) === gid) : null;
    items.push(normalizeMusicItem({
      giftId: gid, giftName: c.defaultGiftName, icon: c.defaultGiftIcon, name: cname,
      audios: base?.audios, volume: base?.volume, // kế thừa nhạc/âm lượng nếu quà này đã gán ở bản gốc
    }));
  }
  return items;
}
function switchMusicGroup(newId) {
  newId = newId || '';
  if (newId === musicGroupId) { renderMusicList(); return; }
  _musicSaver.cancel();
  // Chốt danh sách hiện tại vào đúng nơi lưu trước khi rời.
  if (musicGroupId) saveGroupProfilePatch(musicGroupId, { music: musicItems.map(normalizeMusicItem) });
  else musicBaseItems = musicItems.map(normalizeMusicItem);
  // Nạp danh sách của nhóm mới (hoặc quay về danh sách gốc TALENT SHOW).
  musicItems = newId ? musicItemsForGroup(newId) : (musicBaseItems || []).map(normalizeMusicItem);
  musicGroupId = newId;
  renderMusicList();
  scheduleMusicSave(); // lưu danh sách vừa tự-thêm vào hồ sơ nhóm
}

let musicPreviewAudio = null;
let musicPreviewGift = '';
// Nghe thử clip quà: tắt (duck) nhạc nền như khi tặng quà + PHÓNG TO icon bên Sticker Dance,
// nghe xong phát lại nhạc nền và thu nhỏ icon.
function previewMusic(m) {
  const pool = Array.isArray(m.audios) && m.audios.length ? m.audios : (m.audioPath ? [m.audioPath] : []);
  if (!pool.length) { toast('Chưa chọn file âm thanh', 'error'); return; }
  stopPreviewMusic();
  if (musicCfg.duckWaiting !== false) WaitingMusic.duck();
  musicPreviewGift = String(m.giftId || '');
  if (musicPreviewGift) signalStickerStart(musicPreviewGift);
  const done = () => {
    WaitingMusic.unduck();
    if (musicPreviewGift) { signalStickerEnd(musicPreviewGift); musicPreviewGift = ''; }
  };
  musicPreviewAudio = new Audio(filePathToUrl(pool[Math.floor(Math.random() * pool.length)]));
  musicPreviewAudio.volume = clampVol01(m.volume);
  try { musicPreviewAudio.playbackRate = musicRate(m.speed); } catch {}
  musicPreviewAudio.addEventListener('ended', done);
  musicPreviewAudio.addEventListener('error', done);
  musicPreviewAudio.play().catch(() => { done(); toast('Không phát được âm thanh này', 'error'); });
}
function stopPreviewMusic() {
  if (musicPreviewAudio) { musicPreviewAudio.pause(); musicPreviewAudio = null; WaitingMusic.unduck(); }
  if (musicPreviewGift) { signalStickerEnd(musicPreviewGift); musicPreviewGift = ''; }
}

// ID ngẫu nhiên cho KHU CON.
function mlNewId() { return 'sg' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function musicSubGroups() { return (musicCfg.subGroups = normalizeSubGroups(musicCfg.subGroups)); }
function musicSubGroupName(id) { const g = musicSubGroups().find(x => x.id === String(id || '')); return g ? g.name : ''; }
// Badge phụ (tốc độ / nhạc-trước) hiển thị trên hàng. WEBM & ƯU TIÊN là chip riêng (bấm được / nổi bật).
function mlRowBadges(m) {
  const b = [];
  if (Number(m.speed)) b.push(`⏩ ${m.speed > 0 ? '+' : ''}${m.speed}%`);
  if (m.preEnabled && (m.preAudios || []).length) b.push('🎼 Nhạc trước');
  return b;
}
// Chip overlay video — BẤM để đổi nhanh WEBM 1 → 2 → 3 (chỉ hiện khi quà có file video).
function mlWebmChipHtml(m) {
  if (!(m.audios || []).some(isVideoFile)) return '';
  const name = danceOverlayName(danceChannelOf(m));
  return `<button type="button" class="ml-webm-chip" title="Bấm để đổi overlay phát video: WEBM 1 → 2 → 3. Hiện tại: ${escapeAttr(name)}">🖥 ${escapeHtml(name)}</button>`;
}
// Chip ƯU TIÊN #N — số N là VỊ TRÍ chèn vào hàng chờ khi tặng (1 = ngay dưới quà đang phát).
function mlPrioChipHtml(m) {
  const n = clampInt(m.priority, 0, 0, 999);
  if (!n) return '';
  return `<span class="ml-prio-badge" title="Ưu tiên: khi tặng, quà chèn vào vị trí thứ ${n} của hàng chờ (dưới quà đang phát)">#${n}</span>`;
}
// Trạng thái phát nhạc nền của 1 quà — 1 nút bấm luân phiên 3 trạng thái ngay trên hàng:
//   off = chạy CHUNG với nhạc nền · on = TẠM DỪNG nhạc nền · bg = CHẠY NỀN (đè lên tất cả).
// 'inherit' (mặc định) hiển thị như 'on' (tạm dừng). bgMode ưu tiên hiển thị 'bg'.
const ML_STATUS_META = {
  off: { ic: '🎶', txt: 'CHUNG NHẠC', cls: 'off' },
  on:  { ic: '🔇', txt: 'DỪNG NHẠC',  cls: 'on'  },
  bg:  { ic: '🅱', txt: 'CHẠY NỀN',   cls: 'bg'  },
};
const ML_STATUS_NEXT = { off: 'on', on: 'bg', bg: 'off' };
function mlStatusState(m) { return m.bgMode ? 'bg' : (m.videoDuck === 'off' ? 'off' : 'on'); }
function applyMlStatus(m, s) {
  if (s === 'bg') { m.bgMode = true; }
  else { m.bgMode = false; m.videoDuck = (s === 'off') ? 'off' : 'on'; }
}
function mlStatusChipHtml(m) {
  const meta = ML_STATUS_META[mlStatusState(m)];
  return `<button type="button" class="ml-status ml-status-${meta.cls}" title="Bấm để đổi trạng thái: Chạy chung nhạc nền → Tạm dừng nhạc nền → Chạy nền (đè lên tất cả). ‘Chạy nền’: video/mp3 phát đè, không xếp hàng.">${meta.ic} ${escapeHtml(meta.txt)}</button>`;
}
// HTML 1 hàng quà (dạng thẻ).
function mlRowHtml(m, i) {
  const audios = Array.isArray(m.audios) ? m.audios : [];
  const nVideo = audios.filter(isVideoFile).length;
  const audioTitle = audios.length ? audios.map(a => (isVideoFile(a) ? '🎬 ' : '🎵 ') + soundBaseName(a)).join('\n') : 'Chưa có nhạc/video — bấm để chọn';
  const firstName = audios.length ? soundBaseName(audios[0]) : '';
  const firstIco = audios.length && isVideoFile(audios[0]) ? '🎬' : '🎵';
  const audioLabel = audios.length
    ? (audios.length === 1 ? `${firstIco} ${escapeHtml(firstName)}` : `${firstIco} ${escapeHtml(firstName)} +${audios.length - 1}`)
    : '🎵 Chọn nhạc/video';
  const badges = mlRowBadges(m).map(t => `<span class="ml-badge">${escapeHtml(t)}</span>`).join('');
  const giftLabel = m.giftName || ('ID ' + m.giftId);
  return `
    <div class="ml-row${audios.length ? '' : ' no-audio'}${m.autoEnabled === false ? ' auto-off' : ''}" data-i="${i}">
      <img class="ml-icon" src="${escapeAttr(m.icon || '../logo/hp-logo.png')}" onerror="this.style.visibility='hidden'" title="${escapeAttr(giftLabel)}" />
      <div class="ml-main">
        <div class="ml-fields">
          <input class="ml-name" type="text" placeholder="${escapeAttr(giftLabel)}" value="${escapeAttr(m.name || '')}" title="Tên hiển thị (đồng bộ 2 chiều với Sticker Dance). Quà gốc: ${escapeAttr(giftLabel)}" />
          <button class="ml-audio-btn${audios.length ? '' : ' no-audio'}" type="button" title="${escapeAttr(audioTitle)}"><span class="ml-audio-btn-label">${audioLabel}</span><span class="ml-audio-btn-caret">⚙</span></button>
          ${mlStatusChipHtml(m)}
          ${mlWebmChipHtml(m)}
          ${mlPrioChipHtml(m)}
          ${badges ? `<span class="ml-badges">${badges}</span>` : ''}
        </div>
      </div>
      <div class="ml-side">
        <label class="ml-auto${m.autoEnabled === false ? ' is-off' : ''}" title="BẬT: quà này lên là tự phát nhạc/clip. TẮT: quà lên vẫn KHÔNG tự phát — chỉ chạy khi bấm ▶ DS thủ công."><input type="checkbox" class="ml-auto-input"${m.autoEnabled !== false ? ' checked' : ''} /> ⚡ Auto</label>
        <div class="ml-enq">
          <input class="ml-qty" type="number" min="1" max="1000" value="${clampInt(m.qty, 1, 1, 1000)}" title="Số lượng đưa vào danh sách phát (được ghi nhớ)" />
          <button class="ghost tiny ml-add" type="button" title="Đưa quà này vào danh sách để phát">▶ DS</button>
        </div>
        <button class="ghost tiny danger ml-del" type="button" title="Xóa khỏi danh sách">✕</button>
      </div>
    </div>`;
}
function renderMusicList() {
  const list = $('#mlList'); if (!list) return;
  const groups = musicSubGroups();
  if ($('#mlEmpty')) $('#mlEmpty').hidden = musicItems.length > 0 || groups.length > 0;
  if (!groups.length) {
    // Không có KHU CON → danh sách phẳng như trước.
    list.innerHTML = musicItems.map((m, i) => mlRowHtml(m, i)).join('');
  } else {
    const validIds = new Set(groups.map(g => g.id));
    const buckets = new Map(groups.map(g => [g.id, []]));
    const defItems = [];
    musicItems.forEach((m, i) => {
      const gid = validIds.has(m.subGroup) ? m.subGroup : '';
      if (gid) buckets.get(gid).push(i); else defItems.push(i);
    });
    const sectionHtml = (gid, idxs, collapsed, isDefault, name) => {
      const body = idxs.map(i => mlRowHtml(musicItems[i], i)).join('')
        || '<div class="ml-sec-empty hint">Chưa có quà — bấm “＋ Thêm quà”, hoặc chọn KHU CON này trong ⚙ Cài đặt của quà khác.</div>';
      const nameEl = isDefault
        ? `<b class="ml-sec-name">${escapeHtml(name)}</b>`
        : `<input class="ml-sec-name-input" type="text" value="${escapeAttr(name)}" placeholder="Tên khu con…" title="Đổi tên khu con" />`;
      return `<div class="ml-sec${collapsed ? ' is-collapsed' : ''}" data-gid="${escapeAttr(gid)}">
        <div class="ml-sec-head">
          <button class="ml-sec-toggle" type="button" title="Gập/mở khu">${collapsed ? '▸' : '▾'}</button>
          ${nameEl}
          <span class="ml-sec-count">${idxs.length} mục</span>
          <span class="mlq-spacer"></span>
          <button class="ghost tiny ml-sec-add" type="button" title="Thêm quà vào khu này">＋ Thêm quà</button>
          ${isDefault ? '' : `<button class="ghost tiny ml-sec-up" type="button" title="Đưa khu lên trên">▲</button><button class="ghost tiny ml-sec-down" type="button" title="Đưa khu xuống dưới">▼</button><button class="ghost tiny danger ml-sec-del" type="button" title="Xoá khu (quà chuyển về KHU CREATOR)">🗑</button>`}
        </div>
        <div class="ml-sec-body">${body}</div>
      </div>`;
    };
    let html = '';
    if (defItems.length) html += sectionHtml('', defItems, false, true, 'KHU CREATOR');
    groups.forEach(g => { html += sectionHtml(g.id, buckets.get(g.id) || [], g.collapsed, false, g.name); });
    list.innerHTML = html;
  }
  wireMusicRows(list);
  wireMusicSections(list);
}
// Gắn sự kiện cho từng hàng quà.
function wireMusicRows(scope) {
  scope.querySelectorAll('.ml-row').forEach(row => {
    const i = Number(row.dataset.i), m = musicItems[i];
    if (!m) return;
    row.querySelector('.ml-name').addEventListener('input', (e) => { m.name = e.target.value; syncNameToSticker(m.giftId, m.name); scheduleMusicSave(); });
    row.querySelector('.ml-audio-btn').addEventListener('click', () => openAudioModal(m));
    row.querySelector('.ml-status')?.addEventListener('click', () => {
      applyMlStatus(m, ML_STATUS_NEXT[mlStatusState(m)]);
      scheduleMusicSave(); renderMusicList();
    });
    row.querySelector('.ml-webm-chip')?.addEventListener('click', () => {
      const idx = DANCE_CHANNELS.indexOf(danceChannelOf(m));
      m.overlay = DANCE_CHANNELS[(idx + 1) % DANCE_CHANNELS.length]; // WEBM 1 → 2 → 3 → 1
      scheduleMusicSave(); renderMusicList();
    });
    row.querySelector('.ml-qty').addEventListener('change', (e) => { m.qty = clampInt(e.target.value, 1, 1, 1000); e.target.value = m.qty; scheduleMusicSave(); });
    row.querySelector('.ml-add').addEventListener('click', () => enqueueFromRow(m, row.querySelector('.ml-qty').value));
    row.querySelector('.ml-auto-input').addEventListener('change', (e) => { m.autoEnabled = e.target.checked; scheduleMusicSave(); renderMusicList(); });
    row.querySelector('.ml-del').addEventListener('click', async () => {
      const nameShown = m.name || m.giftName || ('ID ' + m.giftId);
      const ok = await window.api.shell.confirm({ title: 'Xóa quà', message: `Xóa "${nameShown}" khỏi danh sách nhạc?`, detail: 'Hành động này không thể hoàn tác.', defaultYes: true });
      if (!ok) return;
      musicItems.splice(i, 1); renderMusicList(); scheduleMusicSave();
    });
  });
}
// Gắn sự kiện cho từng KHU CON (gập/mở, đổi tên, thêm quà, di chuyển, xoá).
function wireMusicSections(scope) {
  scope.querySelectorAll('.ml-sec').forEach(sec => {
    const gid = sec.dataset.gid;
    const groups = musicSubGroups();
    const g = groups.find(x => x.id === gid);
    sec.querySelector('.ml-sec-toggle')?.addEventListener('click', () => {
      if (g) { g.collapsed = !g.collapsed; renderMusicList(); scheduleMusicSave(); }
      else { sec.classList.toggle('is-collapsed'); } // "Chưa phân khu" chỉ gập tạm, không lưu
    });
    sec.querySelector('.ml-sec-name-input')?.addEventListener('input', (e) => { if (g) { g.name = e.target.value; scheduleMusicSave(); } });
    sec.querySelector('.ml-sec-add')?.addEventListener('click', async () => {
      const picked = await GiftPicker.open({ title: `🎵 Chọn quà cho khu “${g ? g.name : 'KHU CREATOR'}”`, excludeIds: musicItems.map(m => m.giftId) });
      if (!picked) return;
      musicItems.push(normalizeMusicItem({ giftId: picked.id, giftName: picked.name, icon: picked.icon, diamond: picked.diamond, subGroup: gid }));
      renderMusicList(); scheduleMusicSave();
    });
    const moveGroup = (dir) => {
      const idx = groups.findIndex(x => x.id === gid); if (idx < 0) return;
      const j = idx + dir; if (j < 0 || j >= groups.length) return;
      [groups[idx], groups[j]] = [groups[j], groups[idx]];
      renderMusicList(); scheduleMusicSave();
    };
    sec.querySelector('.ml-sec-up')?.addEventListener('click', () => moveGroup(-1));
    sec.querySelector('.ml-sec-down')?.addEventListener('click', () => moveGroup(1));
    sec.querySelector('.ml-sec-del')?.addEventListener('click', async () => {
      if (!g) return;
      const ok = await window.api.shell.confirm({ title: 'Xoá khu con', message: `Xoá khu “${g.name}”?`, detail: 'Các quà trong khu sẽ chuyển về “KHU CREATOR”, không bị xoá.' });
      if (!ok) return;
      musicItems.forEach(m => { if (m.subGroup === gid) m.subGroup = ''; });
      musicCfg.subGroups = groups.filter(x => x.id !== gid);
      renderMusicList(); scheduleMusicSave();
    });
  });
}
// Popup quản lý danh sách nhạc của 1 quà (gọn hơn khi có nhiều file): thêm / nghe thử / xoá từng file.
let audioModalPreview = null;
let audioModalPreviewBtn = null;
// Trả nút "Nghe thử" đang phát về biểu tượng ▶ ban đầu.
function resetAudioModalPreviewBtn() { if (audioModalPreviewBtn) { audioModalPreviewBtn.textContent = '▶'; audioModalPreviewBtn.title = 'Nghe/xem thử'; audioModalPreviewBtn.classList.remove('is-playing'); audioModalPreviewBtn = null; } }
function stopAudioModalPreview() { if (audioModalPreview) { try { audioModalPreview.pause(); } catch {} audioModalPreview = null; } resetAudioModalPreviewBtn(); }
// Phát 1 file nghe thử với nút bấm dạng bật/tắt: bấm lần nữa (hoặc bấm nút khác) là dừng.
function toggleAudioModalPreview(btn, src, volume, isVideo) {
  // Đang phát chính file này → bấm lại để dừng.
  if (audioModalPreviewBtn === btn) { stopAudioModalPreview(); return; }
  stopAudioModalPreview();
  const el = document.createElement(isVideo ? 'video' : 'audio');
  el.src = src;
  el.volume = clampVol01(volume);
  el.addEventListener('ended', () => { if (audioModalPreview === el) stopAudioModalPreview(); });
  audioModalPreview = el;
  audioModalPreviewBtn = btn;
  btn.textContent = '⏸'; btn.title = 'Dừng'; btn.classList.add('is-playing');
  el.play().catch(() => { toast('Không phát được file này', 'error'); stopAudioModalPreview(); });
}
// Nhãn tốc độ hiển thị (rate + %).
function musicSpeedLabel(speed) { const s = Number(speed) || 0; return `${musicRate(s).toFixed(2)}×` + (s ? ` (${s > 0 ? '+' : ''}${s}%)` : ''); }
function clampVolInt(v) { return Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : 100; }
function openAudioModal(m) {
  stopAudioModalPreview();
  const overlay = document.createElement('div');
  overlay.className = 'ml-modal-overlay';
  const giftLabel = m.giftName || ('ID ' + m.giftId);
  const posOpt = (val, label) => `<option value="${val}"${(m.videoPos || 'default') === val ? ' selected' : ''}>${label}</option>`;
  const duckOpt = (val, label) => `<option value="${val}"${(m.videoDuck || 'inherit') === val ? ' selected' : ''}>${label}</option>`;
  const sgOpt = (val, label, sel) => `<option value="${escapeAttr(val)}"${sel ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const sgOptions = sgOpt('', 'KHU CREATOR', !m.subGroup) + musicSubGroups().map(g => sgOpt(g.id, g.name, m.subGroup === g.id)).join('');
  overlay.innerHTML = `
    <div class="ml-modal" role="dialog" aria-modal="true">
      <div class="ml-modal-head">
        <img src="${escapeAttr(m.icon || '../logo/hp-logo.png')}" onerror="this.style.visibility='hidden'" />
        <div class="ml-modal-title"><b>${escapeHtml(m.name || giftLabel)}</b><small>Nhạc &amp; video — mỗi lượt phát ngẫu nhiên 1 file (video hiện trên overlay OBS)</small></div>
        <button class="ml-modal-close" type="button" title="Đóng">✕</button>
      </div>

      <div class="ml-modal-sec"><div class="ml-mv-h">🎵 Âm thanh &amp; hiệu ứng</div>
        <div class="ml-modal-list"></div>
        <div class="ml-modal-foot">
          <button class="ml-modal-add primary" type="button">＋ Thêm nhạc</button>
          <button class="ml-modal-add-video ghost" type="button">🎬 Thêm video</button>
          <button class="ml-modal-add-folder ghost" type="button" title="Nạp mọi file nhạc/video trong 1 thư mục">📁 Chọn thư mục</button>
          <span class="ml-modal-hint hint"></span>
        </div>
      </div>

      <div class="ml-modal-sec ml-modal-pre">
        <label class="ml-switch ml-pre-toggle" title="Phát 1 file mở màn (ngẫu nhiên) TRƯỚC clip chính của riêng quà này. Ưu tiên hơn 'Âm thanh trước hiệu ứng' chung."><input type="checkbox" class="ml-pre-enabled"${m.preEnabled ? ' checked' : ''} /> 🎼 Bật nhạc trước (riêng quà này)</label>
        <div class="ml-pre-list"></div>
        <div class="ml-pre-foot">
          <button class="ml-pre-add ghost tiny" type="button">＋ Thêm nhạc trước</button>
          <label class="ml-mv-vol">🔊 Âm lượng <input type="range" class="ml-pre-volume" min="0" max="100" value="${clampVolInt(m.preVolume)}" /></label>
        </div>
      </div>

      <div class="ml-modal-sec"><div class="ml-mv-h">ℹ️ Thông tin &amp; cách chạy</div>
        <div class="ml-mv-row ml-mv-row-speed">
          <label class="ml-mv-speed-wrap">🔊 Âm lượng clip
            <span class="ml-mv-speed-line"><small>Nhỏ</small><input type="range" class="ml-vol-input-modal" min="0" max="100" value="${clampVolInt(m.volume ?? 100)}" /><small>To</small><b class="ml-mv-speed-val ml-vol-val-modal">${clampVolInt(m.volume ?? 100)}%</b></span>
          </label>
        </div>
        <div class="ml-mv-row">
          <label>KHU CON
            <select class="ml-mv-subgroup">${sgOptions}</select>
          </label>
          <label>Ưu tiên (vị trí)
            <input type="number" class="ml-mv-priority" min="0" max="999" value="${clampInt(m.priority, 0, 0, 999)}" title="VỊ TRÍ chèn vào hàng chờ khi tặng: 1 = ngay dưới quà đang phát, 3 = hàng thứ 3 (đợi 2 lượt mới tới). 0 = thường (nối đuôi). Hiện #N ngoài hàng." />
          </label>
        </div>
        <div class="ml-mv-row ml-mv-row-speed">
          <label class="ml-mv-speed-wrap">Tốc độ Audio/Video
            <span class="ml-mv-speed-line"><small>Chậm</small><input type="range" class="ml-mv-speed" min="-75" max="200" step="5" value="${clampInt(m.speed, 0, -75, 200)}" /><small>Nhanh</small><b class="ml-mv-speed-val ml-speed-val-modal">${musicSpeedLabel(m.speed)}</b></span>
          </label>
        </div>
      </div>

      <div class="ml-modal-sec ml-modal-video">
        <div class="ml-mv-h">🎬 Cài đặt video (áp dụng cho file mp4/webm)</div>
        <label class="ml-switch ml-mv-bg" title="Phát ĐÈ lên tất cả hiệu ứng khác, KHÔNG theo hàng đợi (combo → phát tuần tự trên lớp nền của overlay đã chọn)"><input type="checkbox" class="ml-mv-bgmode"${m.bgMode ? ' checked' : ''} /> Chạy nền (đè lên tất cả)</label>
        <div class="ml-mv-row">
          <label>Overlay phát
            <select class="ml-mv-overlay" title="Chọn overlay OBS để phát video quà này (mỗi WEBM 1 link riêng)">
              ${DANCE_CHANNELS.map(ch => `<option value="${ch}"${danceChannelOf(m) === ch ? ' selected' : ''}>${escapeHtml(danceOverlayName(ch))}</option>`).join('')}
            </select>
          </label>
          <label>Nhạc nền
            <select class="ml-mv-duck">
              ${duckOpt('inherit', 'Mặc định (tạm dừng)')}${duckOpt('off', 'Chạy chung nhạc nền')}${duckOpt('on', 'Tạm dừng nhạc nền')}
            </select>
          </label>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const listEl = overlay.querySelector('.ml-modal-list');
  const hintEl = overlay.querySelector('.ml-modal-hint');
  // Danh sách "nhạc trước" riêng của quà.
  const preListEl = overlay.querySelector('.ml-pre-list');
  function refreshPre() {
    const pre = m.preAudios || [];
    preListEl.innerHTML = pre.length
      ? pre.map((a, ai) => `<div class="ml-modal-item" data-ai="${ai}">
          <span class="ml-modal-ic">🎼</span>
          <span class="ml-modal-name" title="${escapeAttr(soundNameFromValue(a))}">${escapeHtml(soundBaseName(a))}</span>
          <button class="ml-pre-play ghost tiny" type="button" title="Nghe thử">▶</button>
          <button class="ml-pre-del ghost tiny danger" type="button" title="Bỏ file">✕</button>
        </div>`).join('')
      : '<div class="ml-modal-empty">Chưa có nhạc mở màn. Bấm “＋ Thêm nhạc trước”.</div>';
    preListEl.querySelectorAll('.ml-pre-play').forEach(btn => btn.addEventListener('click', () => {
      const ai = Number(btn.closest('.ml-modal-item').dataset.ai);
      toggleAudioModalPreview(btn, filePathToUrl(m.preAudios[ai]), m.preVolume, false);
    }));
    preListEl.querySelectorAll('.ml-pre-del').forEach(btn => btn.addEventListener('click', () => {
      const ai = Number(btn.closest('.ml-modal-item').dataset.ai);
      m.preAudios.splice(ai, 1); scheduleMusicSave(); renderMusicList(); refreshPre();
    }));
  }
  function refresh() {
    const audios = m.audios || [];
    const nAudio = audios.filter(a => !isVideoFile(a)).length, nVideo = audios.filter(isVideoFile).length;
    hintEl.textContent = audios.length ? `${nAudio} nhạc · ${nVideo} video` : 'Chưa có file';
    listEl.innerHTML = audios.length
      ? audios.map((a, ai) => `<div class="ml-modal-item${isVideoFile(a) ? ' is-video' : ''}" data-ai="${ai}">
          <span class="ml-modal-ic">${isVideoFile(a) ? '🎬' : '🎵'}</span>
          <span class="ml-modal-name" title="${escapeAttr(soundNameFromValue(a))}">${escapeHtml(soundBaseName(a))}</span>
          <button class="ml-modal-play ghost tiny" type="button" title="Nghe/xem thử">▶</button>
          <button class="ml-modal-del ghost tiny danger" type="button" title="Bỏ file">✕</button>
        </div>`).join('')
      : '<div class="ml-modal-empty">Chưa có file nào. Bấm “＋ Thêm nhạc” hoặc “🎬 Thêm video”.</div>';
    listEl.querySelectorAll('.ml-modal-play').forEach(btn => btn.addEventListener('click', () => {
      const ai = Number(btn.closest('.ml-modal-item').dataset.ai);
      toggleAudioModalPreview(btn, filePathToUrl(m.audios[ai]), m.volume, isVideoFile(m.audios[ai]));
    }));
    listEl.querySelectorAll('.ml-modal-del').forEach(btn => btn.addEventListener('click', () => {
      const ai = Number(btn.closest('.ml-modal-item').dataset.ai);
      m.audios.splice(ai, 1); m.audioPath = m.audios[0] || '';
      scheduleMusicSave(); renderMusicList(); refresh();
    }));
  }
  overlay.querySelector('.ml-modal-add').addEventListener('click', async () => {
    const files = await window.api.shell.pickAudios();
    if (!Array.isArray(files) || !files.length) return;
    m.audios = [...(m.audios || []), ...files.map(filePathToUrl)];
    m.audioPath = m.audios[0] || '';
    scheduleMusicSave(); renderMusicList(); refresh();
    toast(`Đã thêm ${files.length} nhạc`, 'success');
  });
  overlay.querySelector('.ml-modal-add-video').addEventListener('click', async () => {
    const files = await window.api.shell.pickVideos();
    if (!Array.isArray(files) || !files.length) return;
    m.audios = [...(m.audios || []), ...files.map(filePathToUrl)];
    m.audioPath = m.audios[0] || '';
    scheduleMusicSave(); renderMusicList(); refresh();
    toast(`Đã thêm ${files.length} video`, 'success');
  });
  // Chọn cả THƯ MỤC → nạp mọi file nhạc + video bên trong.
  overlay.querySelector('.ml-modal-add-folder').addEventListener('click', async () => {
    const files = await window.api.shell.pickMediaFolder();
    if (!Array.isArray(files) || !files.length) { toast('Thư mục không có file nhạc/video', ''); return; }
    m.audios = [...(m.audios || []), ...files.map(filePathToUrl)];
    m.audioPath = m.audios[0] || '';
    scheduleMusicSave(); renderMusicList(); refresh();
    toast(`Đã nạp ${files.length} file từ thư mục`, 'success');
  });
  // ==== Nhạc trước (riêng quà) ====
  overlay.querySelector('.ml-pre-enabled').addEventListener('change', (e) => { m.preEnabled = e.target.checked; scheduleMusicSave(); renderMusicList(); });
  overlay.querySelector('.ml-pre-add').addEventListener('click', async () => {
    const files = await window.api.shell.pickAudios();
    if (!Array.isArray(files) || !files.length) return;
    m.preAudios = [...(m.preAudios || []), ...files.map(filePathToUrl)];
    if (!m.preEnabled) { m.preEnabled = true; overlay.querySelector('.ml-pre-enabled').checked = true; }
    scheduleMusicSave(); renderMusicList(); refreshPre();
    toast(`Đã thêm ${files.length} nhạc mở màn`, 'success');
  });
  overlay.querySelector('.ml-pre-volume').addEventListener('input', (e) => { m.preVolume = clampVolInt(e.target.value); scheduleMusicSave(); });
  // ==== KHU CON / Ưu tiên / Tốc độ ====
  overlay.querySelector('.ml-mv-subgroup').addEventListener('change', (e) => { m.subGroup = String(e.target.value || ''); scheduleMusicSave(); renderMusicList(); });
  overlay.querySelector('.ml-mv-priority').addEventListener('change', (e) => { m.priority = clampInt(e.target.value, 0, 0, 999); e.target.value = m.priority; scheduleMusicSave(); renderMusicList(); });
  const speedEl = overlay.querySelector('.ml-mv-speed'), speedVal = overlay.querySelector('.ml-speed-val-modal');
  speedEl.addEventListener('input', (e) => { m.speed = clampInt(e.target.value, 0, -75, 200); speedVal.textContent = musicSpeedLabel(m.speed); });
  speedEl.addEventListener('change', () => { scheduleMusicSave(); renderMusicList(); });
  // Âm lượng clip của riêng quà này (chuyển từ hàng danh sách vào đây).
  const volEl = overlay.querySelector('.ml-vol-input-modal'), volVal = overlay.querySelector('.ml-vol-val-modal');
  volEl.addEventListener('input', (e) => { m.volume = clampVolInt(e.target.value); volVal.textContent = m.volume + '%'; });
  volEl.addEventListener('change', () => { scheduleMusicSave(); renderMusicList(); });
  // Cài đặt video per-item (lưu ngay, không cần đóng modal).
  overlay.querySelector('.ml-mv-bgmode').addEventListener('change', (e) => { m.bgMode = e.target.checked; scheduleMusicSave(); });
  overlay.querySelector('.ml-mv-overlay').addEventListener('change', (e) => { m.overlay = DANCE_CHANNELS.includes(e.target.value) ? e.target.value : 'webm1'; scheduleMusicSave(); renderMusicList(); });
  overlay.querySelector('.ml-mv-duck').addEventListener('change', (e) => { m.videoDuck = (e.target.value === 'on' || e.target.value === 'off') ? e.target.value : 'inherit'; scheduleMusicSave(); });
  const closeModal = () => { stopAudioModalPreview(); overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  overlay.querySelector('.ml-modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onKey);
  refresh();
  refreshPre();
}

// Đưa N lượt phát của 1 quà vào hàng đợi hiệu ứng (phát qua MusicQueue: duck nhạc nền + phóng to icon Sticker).
function enqueueFromRow(m, qty) {
  if (!m.audioPath) { toast('Quà này chưa chọn nhạc/video', 'error'); return; }
  const n = clampInt(qty, 1, 1, 1000);
  MusicQueue.enqueue(musicQueuePayload(m, n));
  toast(`Đã đưa ${n}× "${m.name || m.giftName || m.giftId}" vào danh sách phát`, 'success');
}

// ---- DANH SÁCH PHÁT: "đang phát" + "hàng chờ" (audio + video CHUNG, theo thứ tự tặng) ----
// pos = 0 → đang phát; 1..N → số thứ tự tới lượt (tặng trước số nhỏ, lên trước).
function mlqItemHtml(it, cls, pos) {
  const label = it.name || it.giftName || ('ID ' + it.giftId);
  const isVid = isVideoFile(it.audioPath);
  const file = it.audioName || soundBaseName(it.audioPath);
  const num = cls === 'live' ? '<span class="mlq-now">▶</span>' : `<span class="mlq-num">${pos}</span>`;
  return `<div class="mlq-item ${cls}${isVid ? ' is-video' : ''}" data-uid="${escapeAttr(it.uid || '')}">
    ${num}
    <img src="${escapeAttr(it.icon || '../logo/hp-logo.png')}" onerror="this.style.visibility='hidden'" />
    <span class="mlq-name">${escapeHtml(label)}</span>
    ${file ? `<span class="mlq-file" title="${escapeAttr(file)}">${isVid ? '🎬' : '🎵'} ${escapeHtml(file)}</span>` : ''}
    ${isVid ? `<span class="mlq-ov">${escapeHtml(danceOverlayName(it.overlay))}</span>` : ''}
    ${cls === 'wait' ? '<button class="mlq-x" type="button" title="Xóa khỏi danh sách phát">✕</button>' : '<em class="mlq-live">Đang phát</em>'}
  </div>`;
}
// Gói 1 mục cho cửa sổ DANH SÁCH PHÁT tách rời (chỉ dữ liệu, không HTML — cửa sổ tự dựng).
let playlistWindowOn = false;
function playlistWindowItem(it) {
  if (!it) return null;
  return {
    uid: it.uid || '',
    label: it.name || it.giftName || ('ID ' + it.giftId),
    icon: it.icon || '',
    file: it.audioName || soundBaseName(it.audioPath),
    isVid: isVideoFile(it.audioPath),
    overlayName: isVideoFile(it.audioPath) ? danceOverlayName(it.overlay) : '',
  };
}
// Đẩy trạng thái DANH SÁCH PHÁT sang cửa sổ tách rời (nếu đang mở) để hiển thị realtime.
function broadcastPlaylistWindow(st) {
  if (!playlistWindowOn) return;
  st = st || MusicQueue.state();
  const limit = clampInt(musicCfg.displayLimit, 50, 1, 500);
  const waiting = st.waiting.slice(0, limit).map(playlistWindowItem);
  try {
    window.api.playlist.push({
      current: st.current ? playlistWindowItem(st.current) : null,
      waiting,
      total: st.total,
      extra: Math.max(0, st.total - waiting.length),
      paused: !!st.paused,
    });
  } catch {}
}
// Tên overlay theo cấu hình (đổi tên được); fallback WEBM 1/2/3.
function danceOverlayName(ch) {
  const o = ((danceVideoCfg && danceVideoCfg.overlays) || []).find(x => x && x.id === ch);
  return (o && o.name) || ({ webm1: 'WEBM 1', webm2: 'WEBM 2', webm3: 'WEBM 3' }[ch] || ch);
}
// Dải "Chạy nền" — các clip đang phát ĐÈ lên trên (không xếp hàng). Ẩn khi trống.
function renderBackgroundsStrip() {
  const wrap = $('#mlqVideo'); if (!wrap) return;
  const bgs = Backgrounds.list();
  wrap.innerHTML = bgs.length ? `
    <div class="mlqv-bg">
      <b class="mlqv-bg-h">🅱 Chạy nền (đè lên trên)</b>
      ${bgs.map(b => `<span class="mlqv-bg-item"><img src="${escapeAttr(b.icon || '../logo/hp-logo.png')}" onerror="this.style.display='none'" /><span>${escapeHtml(b.name || ('ID ' + b.giftId))}</span><em>${escapeHtml(danceOverlayName(b.channel))}</em></span>`).join('')}
    </div>` : '';
}
// Áp kích thước icon/số + cờ "Nền dưới số" cho thanh rail (biến CSS trên wrap).
function applyMusicRailCfg() {
  const wrap = $('#mlqRailWrap'); if (!wrap) return;
  wrap.style.setProperty('--rail-icon-scale', clampFloat(musicCfg.railIconScale, 1, 0.7, 1.8));
  wrap.style.setProperty('--rail-count-scale', clampFloat(musicCfg.railCountScale, 1, 0.7, 2));
  wrap.classList.toggle('no-rail-count-bg', musicCfg.railCountBg === false);
}
// Thanh icon quà đang chờ: gộp số lượt theo giftId (kể cả cái đang phát), bấm để đẩy lên đầu.
function renderMusicRail(st) {
  const rail = $('#mlqRail'); if (!rail) return;
  const counts = new Map(), meta = new Map(), order = [];
  for (const it of [st.current, ...st.waiting].filter(Boolean)) {
    const gid = String(it.giftId || ''); if (!gid) continue;
    if (!counts.has(gid)) { order.push(gid); meta.set(gid, it); }
    counts.set(gid, (counts.get(gid) || 0) + 1);
  }
  if (!order.length) { rail.innerHTML = '<span class="mlq-rail-hint">Chưa có quà nào trong danh sách phát.</span>'; return; }
  rail.innerHTML = order.map(gid => {
    const it = meta.get(gid), name = it.name || it.giftName || ('ID ' + gid), icon = it.icon || '';
    return `<button class="mlq-rail-gift" data-gift="${escapeAttr(gid)}" title="${escapeAttr(name)} — bấm để đẩy lên đầu, phát ngay khi hết clip hiện tại">
      ${icon ? `<img src="${escapeAttr(icon)}" onerror="this.replaceWith('🎁')" />` : '🎁'}
      <small>${counts.get(gid)}</small>
    </button>`;
  }).join('');
  rail.querySelectorAll('.mlq-rail-gift').forEach(btn => btn.addEventListener('click', () => MusicQueue.bumpGiftToTop(btn.dataset.gift)));
}
function renderMusicQueue(st) {
  renderBackgroundsStrip();
  st = st || MusicQueue.state();
  renderMusicRail(st);
  const cur = $('#mlqCurrent'), listEl = $('#mlqList'), countEl = $('#mlqCount');
  if (!listEl) return;
  const limit = clampInt(musicCfg.displayLimit, 50, 1, 500);
  if (cur) cur.innerHTML = st.current ? mlqItemHtml(st.current, 'live') : '<div class="mlq-idle">Chưa có mục nào đang phát.</div>';
  const shown = st.waiting.slice(0, limit);
  const extra = st.total - shown.length;
  listEl.innerHTML = shown.map((it, i) => mlqItemHtml(it, 'wait', i + 1)).join('')
    + (extra > 0 ? `<div class="mlq-more">+${extra} mục nữa đang chờ…</div>` : '');
  if (countEl) countEl.textContent = `Đang chờ: ${st.total}`;
  pushStickerQueueCounts(st);
  listEl.querySelectorAll('.mlq-item.wait .mlq-x').forEach(btn => {
    btn.addEventListener('click', () => { MusicQueue.removeUid(btn.closest('.mlq-item').dataset.uid); });
  });
  const skip = $('#mlqSkip'); if (skip) skip.disabled = !st.current;
  const pauseBtn = $('#mlqPause');
  if (pauseBtn) {
    pauseBtn.disabled = !st.current;
    pauseBtn.textContent = st.paused ? '▶' : '⏸';
    pauseBtn.title = st.paused ? 'Tiếp tục mục đang tạm dừng' : 'Tạm dừng mục đang phát (không xóa hàng chờ)';
    pauseBtn.classList.toggle('is-paused', !!st.paused);
  }
  if (cur) cur.classList.toggle('is-paused', !!st.paused);
  broadcastPlaylistWindow(st);
}
// ==== UI: Tốc độ theo quà ====
function speedRules() { return (musicCfg.speedGifts = normalizeSpeedGifts(musicCfg.speedGifts)); }
// Sắc thái theo hướng tốc độ: NHANH (>0) nóng · CHẬM (<0) mát · 1.0× xám.
function sgSpeedClass(s) { const n = Number(s) || 0; return n > 0 ? 'sg-fast' : (n < 0 ? 'sg-slow' : 'sg-normal'); }
function sgRowHtml(r, i) {
  const label = r.giftName || (r.giftId ? ('ID ' + r.giftId) : '');
  return `<div class="sg-row${r.enabled ? '' : ' is-off'}" data-i="${i}">
    <button class="sg-gift${r.icon ? '' : ' is-empty'}" type="button" title="${label ? 'Bấm để đổi quà: ' + escapeAttr(label) : 'Bấm để chọn quà kích hoạt tốc độ'}">
      ${r.icon ? `<img src="${escapeAttr(r.icon)}" onerror="this.replaceWith('🎁')" />` : '🎁'}
    </button>
    <span class="sg-gift-name${label ? '' : ' is-empty'}" title="${escapeAttr(label || 'Chưa chọn quà')}">${escapeHtml(label || 'Chọn quà')}</span>
    <span class="sg-speed-line ${sgSpeedClass(r.speed)}"><small class="sg-slow-lbl">Chậm</small><input type="range" class="sg-speed-input" min="-75" max="200" step="5" value="${r.speed}" /><small class="sg-fast-lbl">Nhanh</small><b class="sg-speed-val">${musicSpeedLabel(r.speed)}</b></span>
    <label class="sg-dur">⏱ <input type="number" class="sg-dur-input" min="1" max="600" value="${r.duration}" /> giây</label>
    <select class="sg-mode-input" title="Áp dụng cho">${SPEED_MODES.map(m => `<option value="${m}"${r.mode === m ? ' selected' : ''}>${SPEED_MODE_LABEL[m]}</option>`).join('')}</select>
    <label class="sg-en" title="Bật/tắt quà tốc độ này"><input type="checkbox" class="sg-en-input"${r.enabled ? ' checked' : ''} /> Bật</label>
    <button class="ghost tiny sg-test" type="button" title="Chạy thử tốc độ này ngay (không cần tặng quà)">▶ Thử</button>
    <button class="ghost tiny danger sg-del" type="button" title="Xóa quà tốc độ">✕</button>
  </div>`;
}
function renderSpeedGifts() {
  const list = $('#sgList'); if (!list) return;
  const rules = speedRules();
  list.innerHTML = rules.length
    ? rules.map((r, i) => sgRowHtml(r, i)).join('')
    : '<div class="sg-empty hint">Chưa có quà tốc độ. Bấm “＋ Thêm quà tốc độ”: chọn quà → đặt mức nhanh/chậm, thời gian (mặc định 10 giây) & chế độ (Audio / Video / Cả hai). Khi quà đó được tặng là tự đổi tốc độ trong khoảng thời gian rồi trả về.</div>';
  wireSpeedRows(list);
  updateSpeedActiveUI();
}
function wireSpeedRows(scope) {
  const rules = speedRules(); // GỌI 1 LẦN: mỗi lần gọi speedRules() sẽ tạo mảng object MỚI → gọi trong vòng lặp làm hàng trước bị "mồ côi" (mất chỉnh sửa)
  scope.querySelectorAll('.sg-row').forEach(row => {
    const i = Number(row.dataset.i), r = rules[i];
    if (!r) return;
    row.querySelector('.sg-gift').addEventListener('click', async () => {
      const g = await GiftPicker.open({ title: '⚡ Chọn quà điều khiển tốc độ' });
      if (!g) return;
      r.giftId = String(g.id || ''); r.giftName = g.name || ''; r.icon = g.icon || '';
      scheduleMusicSave(); renderSpeedGifts();
    });
    const sEl = row.querySelector('.sg-speed-input'), sVal = row.querySelector('.sg-speed-val'), sLine = sEl.closest('.sg-speed-line');
    sEl.addEventListener('input', (e) => {
      r.speed = clampInt(e.target.value, 0, -75, 200);
      sVal.textContent = musicSpeedLabel(r.speed);
      if (sLine) { sLine.classList.remove('sg-fast', 'sg-slow', 'sg-normal'); sLine.classList.add(sgSpeedClass(r.speed)); }
      SpeedControl.liveUpdate(r); // đang chạy quà này → đổi tốc độ NGAY theo tay kéo
    });
    sEl.addEventListener('change', () => scheduleMusicSave());
    row.querySelector('.sg-dur-input').addEventListener('change', (e) => { r.duration = clampInt(e.target.value, 10, 1, 600); e.target.value = r.duration; scheduleMusicSave(); });
    row.querySelector('.sg-mode-input').addEventListener('change', (e) => { r.mode = SPEED_MODES.includes(e.target.value) ? e.target.value : 'both'; scheduleMusicSave(); SpeedControl.liveUpdate(r); });
    row.querySelector('.sg-en-input').addEventListener('change', (e) => { r.enabled = e.target.checked; scheduleMusicSave(); renderSpeedGifts(); });
    row.querySelector('.sg-test').addEventListener('click', () => {
      SpeedControl.trigger(r);
      toast(`⚡ Chạy thử: ${musicSpeedLabel(r.speed)} · ${r.duration}s · ${SPEED_MODE_LABEL[r.mode]}`, 'success');
    });
    row.querySelector('.sg-del').addEventListener('click', async () => {
      const nm = r.giftName ? `“${r.giftName}”` : 'quà tốc độ này';
      const ok = await window.api.shell.confirm({ title: 'Xóa quà tốc độ', message: `Xóa ${nm} khỏi Tốc độ theo quà?`, detail: 'Hành động này không thể hoàn tác.' });
      if (!ok) return;
      speedRules().splice(i, 1); scheduleMusicSave(); renderSpeedGifts();
    });
  });
}
// Sáng đèn thẻ + bật nút "Về bình thường" (kèm số đoạn còn lại) khi đang có hiệu ứng tốc độ chạy.
function updateSpeedActiveUI() {
  const on = SpeedControl.isActive();
  const n = SpeedControl.pending();
  const card = document.querySelector('.sg-card'); if (card) card.classList.toggle('sg-live', on);
  const reset = $('#sgReset'); if (reset) { reset.disabled = !on; reset.textContent = on ? `↩ Về bình thường (${n})` : '↩ Về bình thường'; }
}
function updateMusicBgHint() {
  const el = $('#mlBgHint'); if (!el) return;
  const name = soundNameFromValue(soundValue('waitingSoundName'));
  el.textContent = name ? ('Nhạc nền hiện tại: ' + name) : '⚠ Chưa chọn "Nhạc chờ" trong Cài đặt → nhạc nền sẽ không phát.';
}
function wireMusicListTab() {
  $('#mlAddGift')?.addEventListener('click', async () => {
    const g = await GiftPicker.open({ title: '🎵 Chọn quà cho danh sách nhạc', excludeIds: musicItems.map(m => m.giftId) });
    if (!g) return;
    musicItems.push(normalizeMusicItem({ giftId: g.id, giftName: g.name, icon: g.icon, diamond: g.diamond }));
    renderMusicList(); scheduleMusicSave();
  });
  // Tạo KHU CON mới (phân nhóm con danh sách quà).
  $('#mlAddSubGroup')?.addEventListener('click', () => {
    const groups = musicSubGroups();
    groups.push({ id: mlNewId(), name: `Khu ${groups.length + 1}`, collapsed: false });
    musicCfg.subGroups = groups;
    renderMusicList(); scheduleMusicSave();
    toast('Đã tạo KHU CON — đổi tên & thêm quà vào khu', 'success');
  });
  // Thêm quà mặc định của từng Creator vào NHẠC DANCE, đặt TÊN theo Creator đó.
  $('#mlAddCreators')?.addEventListener('click', () => {
    const list = (typeof visibleCreators === 'function' ? visibleCreators() : creators) || [];
    let added = 0;
    for (const c of list) {
      if (!c.defaultGiftId && !c.defaultGiftName) continue;
      const gid = String(c.defaultGiftId || '');
      if (gid && musicItems.some(m => String(m.giftId) === gid)) continue; // tránh trùng quà
      const cname = c.nickname || c.tiktokId || 'Creator';
      musicItems.push(normalizeMusicItem({ giftId: gid, giftName: c.defaultGiftName, icon: c.defaultGiftIcon, name: cname }));
      added++;
    }
    if (added) { renderMusicList(); scheduleMusicSave(); toast(`Đã thêm ${added} quà mặc định từ Creator`, 'success'); }
    else toast('Không có quà mặc định mới để thêm (có thể đã thêm rồi)', '');
  });
  $('#mlBgToggle')?.addEventListener('click', () => { WaitingMusic.isEnabled() ? stopBgMusic() : startBgMusic(); });
  // Cờ "Tạm dừng nhạc nền" chung đã bỏ khỏi giao diện — mỗi quà tự chỉnh trong ⚙ Cài đặt (mục Nhạc nền).
  $('#mlPaused')?.addEventListener('change', (e) => setMusicPaused(e.target.checked));
  $('#waitingVolume')?.addEventListener('input', () => WaitingMusic.refreshVolume());
  updateMusicPausedUI();
  // Hàng đợi hiệu ứng
  MusicQueue.setOnChange(renderMusicQueue);
  if ($('#mlqLimit')) {
    $('#mlqLimit').value = clampInt(musicCfg.displayLimit, 50, 1, 500);
    $('#mlqLimit').addEventListener('input', (e) => { musicCfg.displayLimit = clampInt(e.target.value, 50, 1, 500); scheduleMusicSave(); renderMusicQueue(); });
  }
  // Thanh rail: nút ⚙ mở/đóng panel + 3 điều khiển kích thước/nền số.
  // ⚙ Popup kích thước icon/số: mở/đóng bằng nút ⚙, nút ✕, bấm ra ngoài, hoặc phím Esc.
  const railGear = $('#mlqRailGear'), railPanel = $('#mlqRailSettings');
  if (railGear && railPanel) {
    const closeRailSettings = () => {
      if (railPanel.hidden) return;
      railPanel.hidden = true;
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onEsc, true);
    };
    const onOutside = (e) => { if (!railPanel.contains(e.target) && e.target !== railGear && !railGear.contains(e.target)) closeRailSettings(); };
    const onEsc = (e) => { if (e.key === 'Escape') closeRailSettings(); };
    const openRailSettings = () => {
      railPanel.hidden = false;
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onEsc, true);
    };
    railGear.addEventListener('click', () => { railPanel.hidden ? openRailSettings() : closeRailSettings(); });
    $('#mlqRailSettingsClose')?.addEventListener('click', closeRailSettings);
  }
  if ($('#mlqRailIcon')) {
    $('#mlqRailIcon').value = clampFloat(musicCfg.railIconScale, 1, 0.7, 1.8);
    $('#mlqRailIcon').addEventListener('input', (e) => { musicCfg.railIconScale = clampFloat(e.target.value, 1, 0.7, 1.8); applyMusicRailCfg(); scheduleMusicSave(); });
  }
  if ($('#mlqRailCount')) {
    $('#mlqRailCount').value = clampFloat(musicCfg.railCountScale, 1, 0.7, 2);
    $('#mlqRailCount').addEventListener('input', (e) => { musicCfg.railCountScale = clampFloat(e.target.value, 1, 0.7, 2); applyMusicRailCfg(); scheduleMusicSave(); });
  }
  if ($('#mlqRailBg')) {
    $('#mlqRailBg').checked = musicCfg.railCountBg !== false;
    $('#mlqRailBg').addEventListener('change', (e) => { musicCfg.railCountBg = e.target.checked; applyMusicRailCfg(); scheduleMusicSave(); });
  }
  applyMusicRailCfg();
  // Xóa tất cả = NGƯNG luôn clip đang phát + xóa sạch danh sách phát (không giữ lại cái đang chạy).
  $('#mlqClearAll')?.addEventListener('click', () => { MusicQueue.stopAll(); Backgrounds.stopAll(); toast('Đã ngưng & xóa toàn bộ danh sách phát', 'success'); });
  $('#mlqClearN')?.addEventListener('click', () => { const n = clampInt($('#mlqClearNum')?.value, 10, 1, 100000); MusicQueue.clearCount(n); toast(`Đã xóa ${n} quà đầu hàng chờ`, 'success'); });
  $('#mlqSkip')?.addEventListener('click', () => MusicQueue.skipCurrent());
  $('#mlqPause')?.addEventListener('click', () => { MusicQueue.togglePause(); renderMusicQueue(); });
  $('#mlqPopout')?.addEventListener('click', async () => {
    await window.api.playlist.open();
    playlistWindowOn = true;
    broadcastPlaylistWindow();
    toast('🖥 Đã tách DANH SÁCH PHÁT ra cửa sổ riêng', 'success');
  });
  // Cửa sổ tách rời vừa mở/nạp xong → đẩy trạng thái hiện tại sang ngay.
  window.api.on('playlist:requestState', () => { playlistWindowOn = true; broadcastPlaylistWindow(); });
  $('#mlqShuffle')?.addEventListener('click', () => { MusicQueue.shuffle(); toast('🎲 Đã xáo trộn thứ tự hàng chờ', 'success'); });
  // Tốc độ theo quà
  $('#sgAdd')?.addEventListener('click', () => { speedRules().push(normalizeSpeedGift({})); scheduleMusicSave(); renderSpeedGifts(); });
  $('#sgReset')?.addEventListener('click', () => { SpeedControl.revert(); toast('↩ Đã trả tốc độ về bình thường', 'success'); });
  updateMusicBgHint();
  wireDanceVideoPanel();
  // Overlay báo clip video phát xong/lỗi → danh sách phát bước sang lượt kế.
  window.api.on('dancevideo:ended', (d) => {
    try {
      if (d && d.layer === 'bg') { Backgrounds.onEnded(d.channel); return; }
      MusicQueue.onVideoEnded(d && d.playId); // video nằm chung danh sách phát, khớp theo playId
    } catch {}
  });
  renderMusicList();
  renderMusicQueue();
  renderSpeedGifts();
  if (!musicCfg.paused && musicCfg.bgEnabled) WaitingMusic.start();
  updateBgControls();
}

// Overlay Video NHẠC DANCE: 3 overlay độc lập (webm1/2/3), mỗi cái 1 link OBS riêng (1080×1920).
function danceOverlaysList() {
  const arr = (danceVideoCfg && Array.isArray(danceVideoCfg.overlays)) ? danceVideoCfg.overlays : null;
  return DANCE_CHANNELS.map((id, i) => {
    const found = arr ? arr.find(o => o && o.id === id) : null;
    return { id, name: (found && found.name) || `WEBM ${i + 1}` };
  });
}
function renderDanceOverlays() {
  const wrap = $('#dvOverlays'); if (!wrap) return;
  const roles = { webm1: 'Video WEBM thường', webm2: 'Chạy nền', webm3: 'Biến Hình' };
  wrap.innerHTML = danceOverlaysList().map(o => `
    <div class="dv-ov" data-id="${escapeAttr(o.id)}">
      <span class="dv-ov-badge">${escapeHtml(o.id.toUpperCase())}</span>
      <input class="dv-ov-name" type="text" value="${escapeAttr(o.name)}" placeholder="Tên overlay…" title="Đổi tên overlay" />
      <span class="dv-ov-role hint">${escapeHtml(roles[o.id] || '')}</span>
      <span class="mlq-spacer"></span>
      <button class="primary dv-ov-copy" type="button">📋 COPY OBS</button>
    </div>`).join('');
  wrap.querySelectorAll('.dv-ov').forEach(row => {
    const id = row.dataset.id;
    const nameEl = row.querySelector('.dv-ov-name');
    nameEl.addEventListener('input', (e) => { // cập nhật tên tại chỗ (để dải hàng đợi hiển thị đúng)
      const overlays = danceOverlaysList().map(o => o.id === id ? { ...o, name: e.target.value } : o);
      danceVideoCfg = { ...(danceVideoCfg || {}), overlays };
      renderMusicQueue();
    });
    nameEl.addEventListener('change', () => { // lưu khi rời ô
      const overlays = danceOverlaysList();
      window.api.dancevideo.setConfig({ overlays }).then(cfg => { if (cfg) danceVideoCfg = cfg; }).catch(() => {});
    });
    row.querySelector('.dv-ov-copy').addEventListener('click', async () => {
      const url = await window.api.dancevideo.getUrl(id);
      await window.api.shell.copyText(url);
      toast(`Đã copy link OBS ${danceOverlayName(id)}`, 'success');
    });
  });
}
function wireDanceVideoPanel() {
  renderDanceOverlays();
  $('#dvStopBg')?.addEventListener('click', () => { Backgrounds.stopAll(); toast('Đã dừng video nền trên mọi overlay', 'success'); });
}

// ============================================================
// STICKER DANCE — bảng lưới quà (cấu hình + kéo-thả)
// ============================================================
function clampInt(v, def, min, max) { let n = Math.round(Number(v)); if (!Number.isFinite(n)) n = def; return Math.max(min, Math.min(max, n)); }
function clampFloat(v, def, min, max) { let n = Number(v); if (!Number.isFinite(n)) n = def; return Math.max(min, Math.min(max, n)); }
// Ô nhập tên trong editor Đập Trứng là <textarea> tự giãn cao theo số dòng (gõ Enter xuống dòng)
// → không che mất chữ, khỏi phải chỉnh Cỡ chữ. Cao tối thiểu 1 dòng, tăng theo nội dung.
const _FIELD_SIZING = (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content'));
function autoGrowTa(el) { if (!el || _FIELD_SIZING) return; el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 22) + 'px'; }
// Gộp xuống-dòng thành 1 dòng (dùng khi đồng bộ sang NHẠC DANCE — tên nhạc là ô 1 dòng).
function oneLineName(s) { return String(s || '').replace(/\s*\n+\s*/g, ' '); }
function normalizeStickerCfg(c) {
  c = c || {};
  return {
    content: c.content || 'STICKER DANCE',
    rows: clampInt(c.rows, 3, 1, 12), cols: clampInt(c.cols, 6, 1, 12),
    countMode: c.countMode === 'countdown' ? 'countdown' : 'cumulative',
    labelPos: c.labelPos === 'top' ? 'top' : 'bottom',
    labelLong: c.labelLong === 'clip' ? 'clip' : 'scroll',   // cấu hình cũ 'wrap' → 'scroll'
    labelScrollSpeed: clampInt(c.labelScrollSpeed, 4, 1, 10),
    cells: Array.isArray(c.cells) ? c.cells.map(x => ({
      row: Number(x.row) || 0, col: Number(x.col) || 0, giftId: String(x.giftId || ''),
      giftName: x.giftName || '', icon: x.icon || '', diamond: Number(x.diamond) || 0, text: x.text || '',
      target: Math.max(0, Number(x.target) || 0), special: !!x.special,
    })) : [],
    bg: /^#[0-9a-f]{6}$/i.test(c.bg) ? c.bg : '#2b2f3a',
    bgOpacity: clampInt(c.bgOpacity, 55, 0, 100),
    iconSize: clampInt(c.iconSize, 66, 36, 140),
    textSize: clampInt(c.textSize, 14, 8, 40),
    overlayScale: clampInt(c.overlayScale, 100, 20, 400),
    gap: clampInt(c.gap, 14, 0, 80),
    colGap: clampInt(c.colGap, clampInt(c.gap, 14, 0, 80), 0, 120),
    rowGap: clampInt(c.rowGap, clampInt(c.gap, 14, 0, 80), -120, 120),
    animIcon: c.animIcon !== false,
    enlargeTop: c.enlargeTop !== false,
    perfBg: ['none', 'gold', 'pink', 'blue', 'dark'].includes(c.perfBg) ? c.perfBg : 'gold',
    perfBorder: ['none', 'glow', 'neon', 'rainbow', 'ring'].includes(c.perfBorder) ? c.perfBorder : 'glow',
    perfName: ['random', 'pill', 'metal', 'rainbow', 'eq', 'lights'].includes(c.perfName) ? c.perfName : 'random',
    perfSparkle: !!c.perfSparkle,
    perfRipple: !!c.perfRipple,
    perfShine: !!c.perfShine,
    perfNotes: !!c.perfNotes,
    showMedals: c.showMedals !== false,
    showCrown: c.showCrown !== false,
    showLevelUp: c.showLevelUp !== false,
    eggWhenZero: c.eggWhenZero !== false,
    eggSize: clampInt(c.eggSize, 85, 40, 140),
    eggSkin: ['ivory', 'gold', 'pink', 'blue', 'dino'].includes(c.eggSkin) ? c.eggSkin : 'ivory',
    eggSkinRandom: !!c.eggSkinRandom,
    streakEnabled: !!c.streakEnabled,
    streakSeconds: clampInt(c.streakSeconds, 10, 1, 120),
    streakSteal: c.streakSteal !== false,
    streakBarColor: ['tiktok', 'blue', 'health'].includes(c.streakBarColor) ? c.streakBarColor : 'tiktok',
  };
}
// Gói chủ đề: set nhanh cả bộ hiệu ứng ô đang biểu diễn.
const STICKER_PRESETS = {
  party:   { perfBg: 'pink', perfBorder: 'rainbow', perfSparkle: true,  perfRipple: true,  perfShine: false, perfNotes: true  },
  luxury:  { perfBg: 'gold', perfBorder: 'glow',    perfSparkle: true,  perfRipple: false, perfShine: true,  perfNotes: false },
  neon:    { perfBg: 'dark', perfBorder: 'neon',    perfSparkle: false, perfRipple: true,  perfShine: true,  perfNotes: false },
  music:   { perfBg: 'blue', perfBorder: 'ring',    perfSparkle: true,  perfRipple: false, perfShine: false, perfNotes: true  },
  minimal: { perfBg: 'none', perfBorder: 'glow',    perfSparkle: false, perfRipple: false, perfShine: false, perfNotes: false },
};
// ===== Sticker Dance theo NHÓM =====
// stickerGroupId: nhóm mà stickerCfg đang hiển thị ('' = TALENT SHOW dùng file gốc).
// stickerBaseCfg: bản cấu hình TALENT SHOW (file gốc), giữ để khôi phục khi quay về.
let stickerGroupId = '';
let stickerBaseCfg = null;
function cloneStickerCfg(c) { return normalizeStickerCfg(JSON.parse(JSON.stringify(c || {}))); }
async function loadStickerDanceConfig() {
  const cfg = await window.api.stickerdance.getConfig().catch(() => null);
  stickerCfg = normalizeStickerCfg(cfg);
  stickerBaseCfg = cloneStickerCfg(stickerCfg);
  stickerGroupId = '';
}
// Đẩy cấu hình hiện tại xuống engine + lưu ĐÚNG CHỖ: file gốc nếu TALENT SHOW, hồ sơ nhóm nếu đang ở nhóm.
function pushStickerLive() {
  if (!stickerCfg) return;
  if (stickerGroupId) {
    window.api.stickerdance.apply(stickerCfg).catch(() => {});
    saveGroupProfilePatch(stickerGroupId, { sticker: cloneStickerCfg(stickerCfg) });
  } else {
    window.api.stickerdance.setConfig(stickerCfg).catch(() => {});
    stickerBaseCfg = cloneStickerCfg(stickerCfg);
  }
}
const _stickerSaver = makeAutoSaver(() => pushStickerLive());
function scheduleStickerSave() { _stickerSaver.schedule(); }
// Đổi nhóm đang chọn → lưu cấu hình nhóm/base cũ, nạp cấu hình nhóm mới (hoặc lưới trống nếu nhóm chưa có).
function switchStickerGroup(newId) {
  newId = newId || '';
  if (!stickerCfg || newId === stickerGroupId) return;
  _stickerSaver.cancel();
  // Chốt cấu hình hiện tại vào đúng nơi lưu trước khi rời.
  if (stickerGroupId) saveGroupProfilePatch(stickerGroupId, { sticker: cloneStickerCfg(stickerCfg) });
  else stickerBaseCfg = cloneStickerCfg(stickerCfg);
  // Nạp cấu hình của nhóm mới.
  if (!newId) {
    stickerCfg = cloneStickerCfg(stickerBaseCfg || stickerCfg);
  } else {
    const prof = getGroupProfile(newId).sticker;
    // Nhóm đã có hồ sơ → nạp; chưa có → kế thừa GIAO DIỆN của base nhưng lưới TRỐNG (MC tự đặt quà cho nhóm).
    stickerCfg = (prof && typeof prof === 'object')
      ? normalizeStickerCfg(prof)
      : { ...cloneStickerCfg(stickerBaseCfg || stickerCfg), cells: [] };
  }
  stickerGroupId = newId;
  applyStickerCfgToInputs();
  renderStickerEditor();
  // Đẩy live xuống engine để OBS đổi ngay (apply-only cho nhóm; setConfig cho base để khớp file).
  if (newId) window.api.stickerdance.apply(stickerCfg).catch(() => {});
  else window.api.stickerdance.setConfig(stickerCfg).catch(() => {});
}
function stickerCellAt(r, c) { return stickerCfg.cells.find(x => x.row === r && x.col === c); }
function setStickerCell(r, c, data) { removeStickerCell(r, c); stickerCfg.cells.push({ row: r, col: c, ...data }); }
function removeStickerCell(r, c) { stickerCfg.cells = stickerCfg.cells.filter(x => !(x.row === r && x.col === c)); }
function pruneStickerCells() { stickerCfg.cells = stickerCfg.cells.filter(x => x.row < stickerCfg.rows && x.col < stickerCfg.cols); }
// Kéo icon: di chuyển sang ô trống (giữ nguyên thông tin), hoặc HOÁN ĐỔI với quà ở ô đích.
function moveStickerCell(fr, fc, tr, tc) {
  if (fr === tr && fc === tc) return;
  const from = stickerCellAt(fr, fc); if (!from) return;
  const to = stickerCellAt(tr, tc);
  from.row = tr; from.col = tc;
  if (to && to !== from) { to.row = fr; to.col = fc; }
}
function renderStickerEditor() {
  const grid = $('#sdGrid'); if (!grid || !stickerCfg) return;
  grid.style.setProperty('--sd-cols', stickerCfg.cols);
  let html = '';
  for (let r = 0; r < stickerCfg.rows; r++) {
    for (let c = 0; c < stickerCfg.cols; c++) {
      const cell = stickerCellAt(r, c);
      const has = !!(cell && cell.giftId);
      html += `<div class="sd-e-cell${has ? ' has' : ''}${has && cell.special ? ' special' : ''}" data-row="${r}" data-col="${c}" draggable="${has ? 'true' : 'false'}" title="${has ? escapeAttr(cell.giftName || cell.giftId) : ''}">
        <div class="sd-e-icon">${has ? (cell.icon ? `<img src="${escapeAttr(cell.icon)}" onerror="this.style.visibility='hidden'" />` : '🎁') : '＋'}</div>
        <textarea class="sd-e-text" rows="1" placeholder="Tên (Enter xuống dòng)" ${has ? '' : 'disabled'}>${has ? escapeHtml(cell.text || '') : ''}</textarea>
        ${has ? `<div class="sd-e-extra">
          <input class="sd-e-target" type="number" min="0" placeholder="🎯" value="${cell.target ? cell.target : ''}" title="Mục tiêu để hiện thanh tiến trình (bỏ trống/0 = tắt)" />
          <button class="sd-e-special${cell.special ? ' on' : ''}" type="button" title="Quà đặc biệt: viền bong bóng + lấp lánh (dành cho quà không clip/audio)">✨</button>
        </div>` : ''}
        ${has ? '<button class="sd-e-del" type="button" title="Xóa quà">✕</button>' : ''}
      </div>`;
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.sd-e-text').forEach(autoGrowTa);
  grid.querySelectorAll('.sd-e-cell').forEach(el => {
    const r = Number(el.dataset.row), c = Number(el.dataset.col);
    el.querySelector('.sd-e-icon').addEventListener('click', async () => {
      // Quà đã dùng ở ô KHÁC → ẩn xám tránh trùng. Quà đã gán nhạc ở NHẠC DANCE → ưu tiên lên đầu.
      const usedElsewhere = stickerCfg.cells.filter(x => x.giftId && !(x.row === r && x.col === c)).map(x => String(x.giftId));
      const g = await GiftPicker.open({
        title: '🥚 Chọn quà cho ô Đập Trứng',
        disabledIds: usedElsewhere,
        usedBy: Object.fromEntries(usedElsewhere.map(id => [id, 'Đã dùng ở ô khác'])),
        priorityIds: musicItems.map(m => String(m.giftId)),
        priorityLabel: '🎵 Có nhạc',
      });
      if (!g) return;
      // Nhãn ưu tiên: giữ nhãn cũ nếu có, nếu trống thì tự lấy TÊN đã đặt ở NHẠC DANCE (liên kết 2 mục).
      const existing = stickerCellAt(r, c);
      const label = existing?.text || musicNameFor(String(g.id)) || '';
      // Giữ nguyên mục tiêu & cờ "đặc biệt" khi đổi quà ở ô này.
      setStickerCell(r, c, { giftId: String(g.id), giftName: g.name, icon: g.icon, diamond: Number(g.diamond) || 0, text: label, target: Math.max(0, Number(existing?.target) || 0), special: !!existing?.special });
      renderStickerEditor(); scheduleStickerSave();
    });
    const txt = el.querySelector('.sd-e-text');
    if (txt) txt.addEventListener('input', (e) => { const cell = stickerCellAt(r, c); if (cell) { cell.text = e.target.value; autoGrowTa(e.target); syncNameToMusic(cell.giftId, oneLineName(e.target.value)); scheduleStickerSave(); } });
    const tgt = el.querySelector('.sd-e-target');
    if (tgt) tgt.addEventListener('input', (e) => { const cell = stickerCellAt(r, c); if (cell) { cell.target = Math.max(0, Number(e.target.value) || 0); scheduleStickerSave(); } });
    const sp = el.querySelector('.sd-e-special');
    if (sp) sp.addEventListener('click', () => { const cell = stickerCellAt(r, c); if (cell) { cell.special = !cell.special; renderStickerEditor(); scheduleStickerSave(); } });
    const del = el.querySelector('.sd-e-del');
    if (del) del.addEventListener('click', () => { removeStickerCell(r, c); renderStickerEditor(); scheduleStickerSave(); });
    el.addEventListener('dragstart', (e) => {
      if (!stickerCellAt(r, c)) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-sticker', JSON.stringify({ r, c }));
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types || []).includes('application/x-sticker')) return;
      e.preventDefault(); el.classList.add('drag-over'); e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drag-over');
      try { const d = JSON.parse(e.dataTransfer.getData('application/x-sticker') || '{}'); moveStickerCell(Number(d.r), Number(d.c), r, c); renderStickerEditor(); scheduleStickerSave(); } catch {}
    });
  });
}
// Số hiển thị cạnh mỗi thanh trượt Sticker Dance → biết ngay chỉ số đang chỉnh là bao nhiêu.
const STICKER_RANGE_IDS = ['sdLabelScrollSpeed', 'sdIconSize', 'sdTextSize', 'sdColGap', 'sdRowGap', 'sdEggSize', 'sdBgOpacity'];
function wireStickerRangeReadouts() {
  STICKER_RANGE_IDS.forEach(id => {
    const el = $('#' + id);
    if (!el || el._rv) return;
    const out = document.createElement('span');
    out.className = 'sd-rv';
    out.style.cssText = 'margin-left:8px;padding:1px 7px;border-radius:6px;background:rgba(120,140,170,.18);font:600 12px/1.4 inherit;min-width:22px;text-align:center;display:inline-block;vertical-align:middle';
    el.insertAdjacentElement('afterend', out);
    el._rv = out;
    const upd = () => { out.textContent = el.value; };
    el.addEventListener('input', upd);
    upd();
  });
}
function refreshStickerRangeReadouts() {
  STICKER_RANGE_IDS.forEach(id => { const el = $('#' + id); if (el && el._rv) el._rv.textContent = el.value; });
}
function applyStickerCfgToInputs() {
  if (!stickerCfg) return;
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v; };
  set('sdRows', stickerCfg.rows); set('sdCols', stickerCfg.cols);
  set('sdCountMode', stickerCfg.countMode); set('sdLabelPos', stickerCfg.labelPos);
  set('sdLabelLong', stickerCfg.labelLong); set('sdLabelScrollSpeed', stickerCfg.labelScrollSpeed);
  set('sdIconSize', stickerCfg.iconSize); set('sdTextSize', stickerCfg.textSize);
  set('sdColGap', stickerCfg.colGap); set('sdRowGap', stickerCfg.rowGap);
  set('sdBg', stickerCfg.bg); set('sdBgOpacity', stickerCfg.bgOpacity);
  if ($('#sdAnimIcon')) $('#sdAnimIcon').checked = stickerCfg.animIcon !== false;
  if ($('#sdEnlargeTop')) $('#sdEnlargeTop').checked = stickerCfg.enlargeTop !== false;
  set('sdPerfBg', stickerCfg.perfBg); set('sdPerfBorder', stickerCfg.perfBorder); set('sdPerfName', stickerCfg.perfName);
  const chk = (id, v) => { const el = $('#' + id); if (el) el.checked = !!v; };
  chk('sdPerfSparkle', stickerCfg.perfSparkle);
  chk('sdPerfRipple', stickerCfg.perfRipple);
  chk('sdPerfShine', stickerCfg.perfShine);
  chk('sdPerfNotes', stickerCfg.perfNotes);
  chk('sdShowMedals', stickerCfg.showMedals !== false);
  chk('sdShowCrown', stickerCfg.showCrown !== false);
  chk('sdShowLevelUp', stickerCfg.showLevelUp !== false);
  chk('sdEggZero', stickerCfg.eggWhenZero !== false);
  set('sdEggSize', stickerCfg.eggSize);
  set('sdEggSkin', stickerCfg.eggSkin);
  chk('sdEggSkinRandom', !!stickerCfg.eggSkinRandom);
  if ($('#sdEggSkin')) $('#sdEggSkin').disabled = !!stickerCfg.eggSkinRandom;
  chk('sdStreakEnabled', stickerCfg.streakEnabled);
  set('sdStreakSeconds', stickerCfg.streakSeconds);
  chk('sdStreakSteal', stickerCfg.streakSteal !== false);
  set('sdStreakBarColor', stickerCfg.streakBarColor);
  refreshStickerRangeReadouts();
}
function wireStickerDanceTab() {
  wireStickerRangeReadouts();
  $('#sdRows')?.addEventListener('change', () => { stickerCfg.rows = clampInt($('#sdRows').value, 3, 1, 12); $('#sdRows').value = stickerCfg.rows; pruneStickerCells(); renderStickerEditor(); scheduleStickerSave(); });
  $('#sdCols')?.addEventListener('change', () => { stickerCfg.cols = clampInt($('#sdCols').value, 6, 1, 12); $('#sdCols').value = stickerCfg.cols; pruneStickerCells(); renderStickerEditor(); scheduleStickerSave(); });
  $('#sdCountMode')?.addEventListener('change', () => { stickerCfg.countMode = $('#sdCountMode').value === 'countdown' ? 'countdown' : 'cumulative'; scheduleStickerSave(); });
  $('#sdLabelPos')?.addEventListener('change', () => { stickerCfg.labelPos = $('#sdLabelPos').value === 'top' ? 'top' : 'bottom'; scheduleStickerSave(); });
  $('#sdLabelLong')?.addEventListener('change', () => { stickerCfg.labelLong = $('#sdLabelLong').value === 'clip' ? 'clip' : 'scroll'; scheduleStickerSave(); });
  $('#sdLabelScrollSpeed')?.addEventListener('input', () => { stickerCfg.labelScrollSpeed = clampInt($('#sdLabelScrollSpeed').value, 4, 1, 10); scheduleStickerSave(); });
  $('#sdIconSize')?.addEventListener('input', () => { stickerCfg.iconSize = clampInt($('#sdIconSize').value, 66, 36, 140); scheduleStickerSave(); });
  $('#sdTextSize')?.addEventListener('input', () => { stickerCfg.textSize = clampInt($('#sdTextSize').value, 14, 8, 40); scheduleStickerSave(); });
  $('#sdColGap')?.addEventListener('input', () => { stickerCfg.colGap = clampInt($('#sdColGap').value, 14, 0, 120); scheduleStickerSave(); });
  $('#sdRowGap')?.addEventListener('input', () => { stickerCfg.rowGap = clampInt($('#sdRowGap').value, 0, -120, 120); scheduleStickerSave(); });
  $('#sdBg')?.addEventListener('input', () => { stickerCfg.bg = $('#sdBg').value; scheduleStickerSave(); });
  $('#sdBgOpacity')?.addEventListener('input', () => { stickerCfg.bgOpacity = clampInt($('#sdBgOpacity').value, 55, 0, 100); scheduleStickerSave(); });
  $('#sdAnimIcon')?.addEventListener('change', () => { stickerCfg.animIcon = $('#sdAnimIcon').checked; scheduleStickerSave(); });
  $('#sdEnlargeTop')?.addEventListener('change', () => { stickerCfg.enlargeTop = $('#sdEnlargeTop').checked; scheduleStickerSave(); });
  $('#sdPerfBg')?.addEventListener('change', () => { stickerCfg.perfBg = $('#sdPerfBg').value; scheduleStickerSave(); });
  $('#sdPerfBorder')?.addEventListener('change', () => { stickerCfg.perfBorder = $('#sdPerfBorder').value; scheduleStickerSave(); });
  $('#sdPerfName')?.addEventListener('change', () => { stickerCfg.perfName = $('#sdPerfName').value; scheduleStickerSave(); });
  $('#sdPerfSparkle')?.addEventListener('change', () => { stickerCfg.perfSparkle = $('#sdPerfSparkle').checked; scheduleStickerSave(); });
  $('#sdPerfRipple')?.addEventListener('change', () => { stickerCfg.perfRipple = $('#sdPerfRipple').checked; scheduleStickerSave(); });
  $('#sdPerfShine')?.addEventListener('change', () => { stickerCfg.perfShine = $('#sdPerfShine').checked; scheduleStickerSave(); });
  $('#sdPerfNotes')?.addEventListener('change', () => { stickerCfg.perfNotes = $('#sdPerfNotes').checked; scheduleStickerSave(); });
  $('#sdShowMedals')?.addEventListener('change', () => { stickerCfg.showMedals = $('#sdShowMedals').checked; scheduleStickerSave(); });
  $('#sdShowCrown')?.addEventListener('change', () => { stickerCfg.showCrown = $('#sdShowCrown').checked; scheduleStickerSave(); });
  $('#sdShowLevelUp')?.addEventListener('change', () => { stickerCfg.showLevelUp = $('#sdShowLevelUp').checked; scheduleStickerSave(); });
  $('#sdEggZero')?.addEventListener('change', () => { stickerCfg.eggWhenZero = $('#sdEggZero').checked; scheduleStickerSave(); });
  $('#sdEggSize')?.addEventListener('input', () => { stickerCfg.eggSize = clampInt($('#sdEggSize').value, 85, 40, 140); scheduleStickerSave(); });
  $('#sdEggSkin')?.addEventListener('change', () => { stickerCfg.eggSkin = $('#sdEggSkin').value; scheduleStickerSave(); });
  $('#sdEggSkinRandom')?.addEventListener('change', () => { stickerCfg.eggSkinRandom = $('#sdEggSkinRandom').checked; if ($('#sdEggSkin')) $('#sdEggSkin').disabled = stickerCfg.eggSkinRandom; scheduleStickerSave(); });
  $('#sdStreakEnabled')?.addEventListener('change', () => { stickerCfg.streakEnabled = $('#sdStreakEnabled').checked; scheduleStickerSave(); MusicQueue.pushStreak(); });
  $('#sdStreakSeconds')?.addEventListener('change', () => { stickerCfg.streakSeconds = clampInt($('#sdStreakSeconds').value, 10, 1, 120); $('#sdStreakSeconds').value = stickerCfg.streakSeconds; scheduleStickerSave(); });
  $('#sdStreakSteal')?.addEventListener('change', () => { stickerCfg.streakSteal = $('#sdStreakSteal').checked; scheduleStickerSave(); });
  $('#sdStreakBarColor')?.addEventListener('change', () => { stickerCfg.streakBarColor = $('#sdStreakBarColor').value; scheduleStickerSave(); });
  $('#sdPerfPreset')?.addEventListener('change', (e) => {
    const p = STICKER_PRESETS[e.target.value];
    e.target.value = ''; // trả về "— Chọn nhanh —" vì trạng thái thật nằm ở từng ô
    if (!p) return;
    Object.assign(stickerCfg, p);
    applyStickerCfgToInputs();
    scheduleStickerSave();
    toast('Đã áp dụng chủ đề hiệu ứng', 'success');
  });
  $('#sdReset')?.addEventListener('click', async () => { await window.api.stickerdance.reset().catch(() => {}); toast('Đã reset số đếm Đập Trứng', 'success'); });
  $('#sdCopyUrl')?.addEventListener('click', async () => { const url = await window.api.stickerdance.getUrl(); await window.api.shell.copyText(url); toast('Đã copy link OBS Đập Trứng', 'success'); });
  applyStickerCfgToInputs();
  renderStickerEditor();
}

// ============================================================
// MENU QUÀ (thông tin quà) — overlay ĐỘC LẬP trong tab Đập Trứng.
// Chỉ hiển thị danh sách "ICON QUÀ | Nội dung"; không đếm/không nhịp/không số lượng.
// ============================================================
let giftMenuCfg = null;
// Menu Quà theo NHÓM (giống Sticker Dance): '' = TALENT SHOW dùng file gốc; nhóm = hồ sơ nhóm.
let giftMenuGroupId = '';
let giftMenuBaseCfg = null;
const GM_ICON_FX = ['none', 'bubble', 'ring', 'glow', 'orbit', 'ripple', 'sparkle', 'neon', 'rays'];
const GM_ICON_ANIM = ['none', 'float', 'shake', 'flip', 'swing', 'bounce', 'wobble', 'spin', 'pulse', 'tada', 'heartbeat', 'jelly'];
const GM_TEXT_FX = ['none', 'glow', 'shine', 'rainbow', 'neon', 'fire', 'pulse', 'wave', 'shadow3d', 'glitch'];
function gmColor(v, fb) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : fb; }
function gmNewId() { return 'gm' + Math.random().toString(36).slice(2, 9); }
function normalizeGiftMenuCfg(c) {
  c = (c && typeof c === 'object') ? c : {};
  const items = Array.isArray(c.items) ? c.items : [];
  return {
    items: items.filter(x => x && typeof x === 'object').map(x => ({
      id: x.id || gmNewId(),
      giftId: x.giftId != null ? String(x.giftId) : '',
      giftName: x.giftName || '',
      icon: x.icon || '',
      text: typeof x.text === 'string' ? x.text : '',
      color: gmColor(x.color, ''),  // '' = dùng màu chữ chung
      bg: gmColor(x.bg, ''),        // '' = không có nền riêng
    })),
    textColor: gmColor(c.textColor, '#ffe14d'),
    textSize: clampInt(c.textSize, 34, 12, 80),
    bold: c.bold !== false,
    textStroke: c.textStroke !== false,
    align: c.align === 'center' ? 'center' : 'left',
    // Chỉ còn 2 trạng thái: 'scroll' (chạy) / 'off' (hiển thị đúng nội dung đã nhập). 'wrap' cũ → 'off'.
    longText: (c.longText === 'scroll' || (c.longText == null && c.marquee !== false)) ? 'scroll' : 'off',
    speed: clampInt(c.speed, 5, 1, 10),
    marqueeWidth: clampInt(c.marqueeWidth, 360, 120, 900),
    maxChars: clampInt(c.maxChars, 0, 0, 120),
    textFx: GM_TEXT_FX.includes(c.textFx) ? c.textFx : 'none',
    iconSize: clampInt(c.iconSize, 84, 40, 180),
    iconFx: GM_ICON_FX.includes(c.iconFx) ? c.iconFx : 'bubble',
    iconAnim: GM_ICON_ANIM.includes(c.iconAnim) ? c.iconAnim : 'float',
    gap: clampInt(c.gap, 18, 0, 80),
    rowGap: clampInt(c.rowGap, 16, 0, 80),
    overlayScale: clampInt(c.overlayScale, 100, 40, 200),
    panel: ['none', 'rows', 'full'].includes(c.panel) ? c.panel : 'none',
    bg: gmColor(c.bg, '#3a0d12'),
    bgOpacity: clampInt(c.bgOpacity, 0, 0, 100),
    showTitle: !!c.showTitle,
    title: typeof c.title === 'string' ? c.title : '',
  };
}
function cloneGiftMenuCfg(c) { return normalizeGiftMenuCfg(JSON.parse(JSON.stringify(c || {}))); }
async function loadGiftMenuConfig() {
  const cfg = await window.api.giftmenu.getConfig().catch(() => null);
  giftMenuCfg = normalizeGiftMenuCfg(cfg);
  giftMenuBaseCfg = cloneGiftMenuCfg(giftMenuCfg);
  giftMenuGroupId = '';
}
// Đẩy live + lưu ĐÚNG CHỖ: file gốc nếu TALENT SHOW, hồ sơ nhóm nếu đang ở nhóm.
function pushGiftMenuLive() {
  if (!giftMenuCfg) return;
  if (giftMenuGroupId) {
    window.api.giftmenu.apply(giftMenuCfg).catch(() => {});
    saveGroupProfilePatch(giftMenuGroupId, { giftMenu: cloneGiftMenuCfg(giftMenuCfg) });
  } else {
    window.api.giftmenu.setConfig(giftMenuCfg).catch(() => {});
    giftMenuBaseCfg = cloneGiftMenuCfg(giftMenuCfg);
  }
}
const _gmSaver = makeAutoSaver(() => pushGiftMenuLive());
function scheduleGiftMenuSave() { _gmSaver.schedule(); }
// Đổi nhóm đang chọn → chốt cấu hình cũ, nạp cấu hình nhóm mới (kế thừa giao diện base nếu nhóm chưa có).
function switchGiftMenuGroup(newId) {
  newId = newId || '';
  if (!giftMenuCfg || newId === giftMenuGroupId) return;
  _gmSaver.cancel();
  if (giftMenuGroupId) saveGroupProfilePatch(giftMenuGroupId, { giftMenu: cloneGiftMenuCfg(giftMenuCfg) });
  else giftMenuBaseCfg = cloneGiftMenuCfg(giftMenuCfg);
  if (!newId) {
    giftMenuCfg = cloneGiftMenuCfg(giftMenuBaseCfg || giftMenuCfg);
  } else {
    const prof = getGroupProfile(newId).giftMenu;
    giftMenuCfg = (prof && typeof prof === 'object')
      ? normalizeGiftMenuCfg(prof)
      : { ...cloneGiftMenuCfg(giftMenuBaseCfg || giftMenuCfg), items: [] };
  }
  giftMenuGroupId = newId;
  applyGiftMenuCfgToInputs();
  renderGiftMenuEditor();
  if (newId) window.api.giftmenu.apply(giftMenuCfg).catch(() => {});
  else window.api.giftmenu.setConfig(giftMenuCfg).catch(() => {});
}
function gmItemAt(id) { return giftMenuCfg.items.find(x => x.id === id); }
function renderGiftMenuEditor() {
  const list = $('#gmList'); if (!list || !giftMenuCfg) return;
  if (!giftMenuCfg.items.length) {
    list.innerHTML = '<div class="gm-empty-row">Chưa có dòng nào. Bấm “＋ Thêm dòng” để tạo bảng Menu Quà.</div>';
    return;
  }
  list.innerHTML = giftMenuCfg.items.map((it, i) => `
    <div class="gm-item" data-id="${escapeAttr(it.id)}" draggable="true">
      <span class="gm-drag" title="Kéo để đổi thứ tự">⠿</span>
      <span class="gm-item-num">${i + 1}</span>
      <div class="gm-item-icon${it.icon ? ' has' : ''}" title="${it.giftName ? escapeAttr(it.giftName) : 'Chọn quà'}">${it.icon ? `<img src="${escapeAttr(it.icon)}" onerror="this.style.visibility='hidden'" />` : '🎁'}</div>
      <textarea class="gm-item-text" rows="1" placeholder="Nội dung (VD: FOCUS CAM) — Enter để xuống dòng">${escapeHtml(it.text || '')}</textarea>
      <span class="gm-item-opts">
        <label class="gm-swatch${it.color ? ' is-set' : ''}" data-kind="color" title="Màu chữ riêng cho dòng (mặc định = màu chung)"><input class="gm-item-color" type="color" value="${it.color || giftMenuCfg.textColor}" /><b>A</b></label>
        <button class="gm-item-color-reset" type="button" title="Ép màu chữ dòng này về màu chung">↺</button>
        <label class="gm-swatch${it.bg ? ' is-set' : ''}" data-kind="bg" title="Màu nền riêng của dòng"><input class="gm-item-bg" type="color" value="${it.bg || giftMenuCfg.bg}" /><b>▧</b></label>
        <button class="gm-item-bg-reset" type="button" title="Reset: bỏ nền riêng của dòng">↺</button>
      </span>
      <button class="gm-item-del" type="button" title="Xoá dòng">✕</button>
    </div>`).join('');
  list.querySelectorAll('.gm-item').forEach(el => {
    const id = el.dataset.id;
    const colorSwatch = el.querySelector('.gm-swatch[data-kind="color"]');
    const bgSwatch = el.querySelector('.gm-swatch[data-kind="bg"]');
    const colorInput = el.querySelector('.gm-item-color');
    const bgInput = el.querySelector('.gm-item-bg');
    el.querySelector('.gm-item-icon').addEventListener('click', async () => {
      const g = await GiftPicker.open({ title: '📜 Chọn quà cho Menu Quà' });
      if (!g) return;
      const it = gmItemAt(id); if (!it) return;
      it.giftId = String(g.id); it.giftName = g.name; it.icon = g.icon;
      if (!it.text) it.text = g.name || '';
      renderGiftMenuEditor(); scheduleGiftMenuSave();
    });
    el.querySelector('.gm-item-text').addEventListener('input', (e) => { const it = gmItemAt(id); if (it) { it.text = e.target.value; scheduleGiftMenuSave(); } });
    colorInput.addEventListener('input', (e) => { const it = gmItemAt(id); if (it) { it.color = e.target.value; colorSwatch.classList.add('is-set'); scheduleGiftMenuSave(); } });
    el.querySelector('.gm-item-color-reset').addEventListener('click', () => { const it = gmItemAt(id); if (it) { it.color = ''; colorInput.value = giftMenuCfg.textColor; colorSwatch.classList.remove('is-set'); scheduleGiftMenuSave(); } });
    bgInput.addEventListener('input', (e) => { const it = gmItemAt(id); if (it) { it.bg = e.target.value; bgSwatch.classList.add('is-set'); scheduleGiftMenuSave(); } });
    el.querySelector('.gm-item-bg-reset').addEventListener('click', () => { const it = gmItemAt(id); if (it) { it.bg = ''; bgInput.value = giftMenuCfg.bg; bgSwatch.classList.remove('is-set'); scheduleGiftMenuSave(); } });
    el.querySelector('.gm-item-del').addEventListener('click', () => { giftMenuCfg.items = giftMenuCfg.items.filter(x => x.id !== id); renderGiftMenuEditor(); scheduleGiftMenuSave(); });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-gm', id); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => { if (!Array.from(e.dataTransfer.types || []).includes('application/x-gm')) return; e.preventDefault(); el.classList.add('drag-over'); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drag-over');
      const from = e.dataTransfer.getData('application/x-gm'), to = id;
      if (!from || from === to) return;
      const arr = giftMenuCfg.items;
      const fi = arr.findIndex(x => x.id === from), ti = arr.findIndex(x => x.id === to);
      if (fi < 0 || ti < 0) return;
      const [moved] = arr.splice(fi, 1); arr.splice(ti, 0, moved);
      renderGiftMenuEditor(); scheduleGiftMenuSave();
    });
  });
}
function applyGiftMenuCfgToInputs() {
  if (!giftMenuCfg) return;
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v; };
  const chk = (id, v) => { const el = $('#' + id); if (el) el.checked = !!v; };
  set('gmTextColor', giftMenuCfg.textColor);
  set('gmTextSize', giftMenuCfg.textSize);
  set('gmAlign', giftMenuCfg.align);
  set('gmTextFx', giftMenuCfg.textFx);
  chk('gmBold', giftMenuCfg.bold);
  chk('gmStroke', giftMenuCfg.textStroke);
  chk('gmScroll', giftMenuCfg.longText === 'scroll');
  set('gmSpeed', giftMenuCfg.speed);
  set('gmMarqueeWidth', giftMenuCfg.marqueeWidth);
  set('gmMaxChars', giftMenuCfg.maxChars);
  set('gmIconSize', giftMenuCfg.iconSize);
  set('gmIconFx', giftMenuCfg.iconFx);
  set('gmIconAnim', giftMenuCfg.iconAnim);
  set('gmGap', giftMenuCfg.gap);
  set('gmRowGap', giftMenuCfg.rowGap);
  set('gmScale', giftMenuCfg.overlayScale);
  set('gmPanel', giftMenuCfg.panel);
  set('gmBg', giftMenuCfg.bg);
  set('gmBgOpacity', giftMenuCfg.bgOpacity);
  chk('gmShowTitle', giftMenuCfg.showTitle);
  set('gmTitle', giftMenuCfg.title);
}
function wireGiftMenuTab() {
  $('#gmAddItem')?.addEventListener('click', () => {
    giftMenuCfg.items.push({ id: gmNewId(), giftId: '', giftName: '', icon: '', text: '', color: '' });
    renderGiftMenuEditor(); scheduleGiftMenuSave();
  });
  const onColor = (id, key) => $('#' + id)?.addEventListener('input', () => { giftMenuCfg[key] = $('#' + id).value; scheduleGiftMenuSave(); });
  const onInt = (id, key, def, min, max) => $('#' + id)?.addEventListener('input', () => { giftMenuCfg[key] = clampInt($('#' + id).value, def, min, max); scheduleGiftMenuSave(); });
  const onSel = (id, key, allowed) => $('#' + id)?.addEventListener('change', () => { const v = $('#' + id).value; giftMenuCfg[key] = allowed.includes(v) ? v : allowed[0]; scheduleGiftMenuSave(); });
  const onChk = (id, key) => $('#' + id)?.addEventListener('change', () => { giftMenuCfg[key] = $('#' + id).checked; scheduleGiftMenuSave(); });
  onColor('gmTextColor', 'textColor');
  onInt('gmTextSize', 'textSize', 34, 12, 80);
  onSel('gmAlign', 'align', ['left', 'center']);
  onSel('gmTextFx', 'textFx', GM_TEXT_FX);
  onChk('gmBold', 'bold');
  onChk('gmStroke', 'textStroke');
  $('#gmScroll')?.addEventListener('change', () => { giftMenuCfg.longText = $('#gmScroll').checked ? 'scroll' : 'off'; scheduleGiftMenuSave(); });
  onInt('gmSpeed', 'speed', 5, 1, 10);
  onInt('gmMarqueeWidth', 'marqueeWidth', 360, 120, 900);
  onInt('gmMaxChars', 'maxChars', 0, 0, 120);
  onInt('gmIconSize', 'iconSize', 84, 40, 180);
  onSel('gmIconFx', 'iconFx', GM_ICON_FX);
  onSel('gmIconAnim', 'iconAnim', GM_ICON_ANIM);
  onInt('gmGap', 'gap', 18, 0, 80);
  onInt('gmRowGap', 'rowGap', 16, 0, 80);
  onInt('gmScale', 'overlayScale', 100, 40, 200);
  onSel('gmPanel', 'panel', ['none', 'rows', 'full']);
  onColor('gmBg', 'bg');
  onInt('gmBgOpacity', 'bgOpacity', 0, 0, 100);
  onChk('gmShowTitle', 'showTitle');
  $('#gmTitle')?.addEventListener('input', () => { giftMenuCfg.title = $('#gmTitle').value; scheduleGiftMenuSave(); });
  $('#gmCopyUrl')?.addEventListener('click', async () => { const url = await window.api.giftmenu.getUrl(); await window.api.shell.copyText(url); toast('Đã copy link OBS Menu Quà', 'success'); });
  applyGiftMenuCfgToInputs();
  renderGiftMenuEditor();
}

// ============================================================
// VINH DANH (MVP Honor) — thẻ avatar Creator idol TOP / User cống hiến
// ============================================================
let mvpCfg = { cards: [] };
let mvpSelId = '';
const MVP_FRAME_COUNT = 41;
const MVP_FRAMES = Array.from({ length: MVP_FRAME_COUNT }, (_, i) => `mvp-frames/${i + 1}.png`);
// Ảnh plaque danh hiệu cùng bộ với khung avatar: N.png → Na.png.
function mvpPlaqueSrc(frame) { const s = String(frame || ''); return /\.png$/i.test(s) ? s.replace(/\.png$/i, 'a.png') : ''; }
const MVP_CANVAS_H = { '1:1': 1080, '3:4': 1440, '9:16': 1920 }; // rộng luôn 1080; chỉ đổi chiều cao

async function loadMvpHonorConfig() {
  const cfg = await window.api.mvphonor.getConfig().catch(() => null);
  mvpCfg = cfg && Array.isArray(cfg.cards) ? cfg : { cards: [] };
  if (!MVP_CANVAS_H[mvpCfg.canvas]) mvpCfg.canvas = '1:1';
  // Cấu hình "trình chiếu" (config-level) — đặt mặc định nếu file cũ chưa có.
  // revealAutoHide = thời gian "Chuyển" (giây) giữa các khung avatar khi AUTO xoay vòng.
  if (typeof mvpCfg.revealStagger !== 'number') mvpCfg.revealStagger = 0.6;
  if (typeof mvpCfg.revealAutoHide !== 'number' || mvpCfg.revealAutoHide < 1) mvpCfg.revealAutoHide = 5;
  mvpCfg.revealSound = false;   // đã bỏ âm thanh trình chiếu
  if (!['fade', 'slideDown', 'zoomOut'].includes(mvpCfg.revealExit)) mvpCfg.revealExit = 'fade';
  mvpCfg.revealNonce = Number(mvpCfg.revealNonce) || 0;
  if (typeof mvpCfg.autoPlay !== 'boolean') mvpCfg.autoPlay = false;
  if (!mvpCfg.cards.some(c => c.id === mvpSelId)) mvpSelId = mvpCfg.cards[0]?.id || '';
}

function mvpNewCard() {
  const id = 'mh_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  return {
    id, mode: 'creator', creatorId: '', tiktokId: '', avatar: '', name: '', text: 'TOP 1',
    frame: MVP_FRAMES[0], usePlaqueImg: true, layout: 'attached', avatarSize: 150, frameScale: 150, nameSize: 40, fontSize: 40,
    color: '#ffffff', textStyle: 'plaque', bgColor: '#8f8474', bgColor2: '#463f31', bgOpacity: 100,
    entryAnim: 'popBounce', celebrate: false, showName: false, showText: true, show: true, overlay: { x: 120, y: 200, scale: 1, rot: 0 },
  };
}
function mvpSel() { return mvpCfg.cards.find(c => c.id === mvpSelId) || null; }
function mvpPush() { window.api.mvphonor.setConfig(mvpCfg).catch(() => {}); }
const _mvpSaver = makeAutoSaver(() => mvpPush());
function mvpScheduleSave() { _mvpSaver.schedule(); }

function mvpCreatorOf(c) { return c.creatorId ? creators.find(x => x.id === c.creatorId) : null; }
function mvpResolveAvatar(c) {
  if (c.mode === 'creator') { const cr = mvpCreatorOf(c); if (cr) return cr.avatar || ''; return ''; }
  return c.avatar || '';
}
function mvpResolveName(c) {
  if (c.name) return c.name;
  if (c.mode === 'creator') { const cr = mvpCreatorOf(c); if (cr) return cr.nickname || cr.tiktokId || ''; }
  return '';
}
function mvpHexRgba(hex, op) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(100, Number(op) === 0 ? 0 : (Number(op) || 100))) / 100})`;
}
function mvpTextBg(c) {
  if (c.textStyle === 'gradient') return `linear-gradient(135deg, ${mvpHexRgba(c.bgColor, c.bgOpacity)}, ${mvpHexRgba(c.bgColor2, c.bgOpacity)})`;
  if (c.textStyle === 'plaque') return `linear-gradient(180deg, ${mvpHexRgba(c.bgColor, c.bgOpacity)}, ${mvpHexRgba(c.bgColor2, c.bgOpacity)})`;
  if (c.textStyle === 'neon') return 'transparent';
  return mvpHexRgba(c.bgColor, c.bgOpacity);
}

// Dựng phần tử hình ảnh của thẻ (dùng trong khung xem trước). Cùng cấu trúc với overlay OBS.
function mvpBuildVisual(c) {
  const avSize = c.avatarSize, frameW = Math.round(avSize * (c.frameScale / 100)), hasFrame = !!c.frame;
  const root = document.createElement('div'); root.className = 'mhv-card' + (c.layout === 'vertical' ? ' vertical' : c.layout === 'attached' ? ' attached' : '');
  const inner = document.createElement('div'); inner.className = 'mhv-inner';
  const avwrap = document.createElement('div'); avwrap.className = 'mhv-avwrap';
  avwrap.style.width = (hasFrame ? frameW : avSize) + 'px';
  if (!hasFrame) avwrap.style.height = avSize + 'px';
  const av = document.createElement('img'); av.className = 'mhv-av'; av.style.width = av.style.height = avSize + 'px';
  const src = mvpResolveAvatar(c); av.src = src || '../logo/hp-logo.png';
  av.onerror = () => { av.onerror = null; av.src = '../logo/hp-logo.png'; };
  avwrap.appendChild(av);
  if (hasFrame) { const fr = document.createElement('img'); fr.className = 'mhv-frame'; fr.src = c.frame; avwrap.appendChild(fr); }
  if (c.showName && mvpResolveName(c)) { const nm = document.createElement('div'); nm.className = 'mhv-name'; nm.style.fontSize = (c.nameSize || 40) + 'px'; nm.textContent = mvpResolveName(c); avwrap.appendChild(nm); }
  inner.appendChild(avwrap);
  if (c.text && c.showText !== false) {
    const tx = document.createElement('div'); tx.className = 'mhv-text style-' + c.textStyle;
    tx.style.fontSize = c.fontSize + 'px'; tx.style.color = c.color;
    tx.style.background = mvpTextBg(c); tx.style.setProperty('--mvp-link-color', c.bgColor);
    tx.style.setProperty('--mvp-plaque-w', frameW + 'px');
    if (c.textStyle === 'neon') tx.style.textShadow = `0 0 6px ${c.bgColor}, 0 0 14px ${c.bgColor}, 0 0 26px ${c.bgColor2}`;
    else if (c.textStyle === 'plaque') tx.style.textShadow = '0 2px 3px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.18)';
    // Ảnh plaque Na.png (khớp khung) — tải xong thì đè ảnh, lỗi/không có thì giữ plaque CSS.
    const psrc = (c.textStyle === 'plaque' && c.usePlaqueImg !== false && hasFrame) ? mvpPlaqueSrc(c.frame) : '';
    if (psrc) {
      const pim = document.createElement('img'); pim.className = 'mhv-plaque-img'; pim.alt = '';
      pim.onload = () => { tx.classList.add('has-plaque-img'); if (pim.naturalWidth && pim.naturalHeight) tx.style.aspectRatio = pim.naturalWidth + ' / ' + pim.naturalHeight; };
      pim.onerror = () => { tx.classList.remove('has-plaque-img'); };
      pim.src = psrc; tx.appendChild(pim);
    }
    const lbl = document.createElement('span'); lbl.className = 'mhv-text-label'; lbl.textContent = c.text;
    tx.appendChild(lbl);
    inner.appendChild(tx);
  }
  root.appendChild(inner);
  return root;
}

function mvpRenderStage() {
  const stage = $('#mhStage'); if (!stage) return;
  const box = stage.parentElement;
  const h = MVP_CANVAS_H[mvpCfg.canvas] || MVP_CANVAS_H['1:1'];
  box.style.aspectRatio = `1080 / ${h}`;
  stage.style.width = '1080px'; stage.style.height = h + 'px';
  const scale = (box.clientWidth || 300) / 1080;
  stage.style.transform = `scale(${scale})`;
  stage.innerHTML = '';
  for (const c of mvpCfg.cards) {
    const el = mvpBuildVisual(c);
    el.classList.add('mhv-pos');
    el.dataset.id = c.id;
    el.style.left = c.overlay.x + 'px'; el.style.top = c.overlay.y + 'px';
    el.style.setProperty('--mh-t', `scale(${c.overlay.scale}) rotate(${c.overlay.rot}deg)`);
    if (c.id === mvpSelId) el.classList.add('sel');
    if (c.show === false) el.classList.add('off');
    mvpAttachDrag(el, c, scale);
    stage.appendChild(el);
  }
  if (mvpAuto.on) mvpAutoEnforce();   // giữ đúng chỉ khung hiện tại hiện sau khi dựng lại
}

function mvpAttachDrag(el, c, scale) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (mvpSelId !== c.id) { mvpSelId = c.id; mvpRenderCards(); mvpApplyToInputs(); mvpRenderStage(); return; }
    const sx = e.clientX, sy = e.clientY, ox = c.overlay.x, oy = c.overlay.y;
    try { el.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      c.overlay.x = Math.round(ox + (ev.clientX - sx) / scale);
      c.overlay.y = Math.round(oy + (ev.clientY - sy) / scale);
      el.style.left = c.overlay.x + 'px'; el.style.top = c.overlay.y + 'px';
      if ($('#mhX')) $('#mhX').value = c.overlay.x;
      if ($('#mhY')) $('#mhY').value = c.overlay.y;
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      try { el.releasePointerCapture(ev.pointerId); } catch {}
      mvpScheduleSave();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

function mvpRenderCards() {
  const box = $('#mhCards'); if (!box) return;
  box.innerHTML = '';
  if (!mvpCfg.cards.length) { box.innerHTML = '<div class="mvp-empty">Chưa có thẻ. Nhấn “＋ Thêm thẻ”.</div>'; }
  mvpCfg.cards.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'mvp-card-item' + (c.id === mvpSelId ? ' active' : '') + (c.show === false ? ' off' : '');
    const av = mvpResolveAvatar(c) || '../logo/hp-logo.png';
    item.innerHTML =
      `<div class="mci-thumb"><img src="${av}" onerror="this.onerror=null;this.src='../logo/hp-logo.png'"/>${c.frame ? `<img class="mci-frame" src="${c.frame}"/>` : ''}</div>`
      + `<div class="mci-info"><div class="mci-title">${(mvpResolveName(c) || 'Thẻ ' + (i + 1))}</div>`
      + `<div class="mci-sub">${c.mode === 'user' ? '🎁 User' : '⭐ Creator'} · ${(c.text || '').split('\n')[0] || '—'}</div></div>`
      + `<div class="mci-actions">`
      + `<button class="mci-btn" data-mh-toggle="${c.id}" title="Hiện/ẩn trên OBS">${c.show === false ? '🚫' : '👁'}</button>`
      + `<button class="mci-btn" data-mh-del="${c.id}" title="Xoá thẻ">🗑</button>`
      + `</div>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-mh-toggle]') || e.target.closest('[data-mh-del]')) return;
      mvpSelId = c.id; mvpRenderCards(); mvpApplyToInputs(); mvpRenderStage();
    });
    box.appendChild(item);
  });
  box.querySelectorAll('[data-mh-toggle]').forEach(b => b.addEventListener('click', () => {
    const c = mvpCfg.cards.find(x => x.id === b.dataset.mhToggle); if (!c) return;
    c.show = c.show === false; mvpRenderCards(); mvpRenderStage(); mvpScheduleSave();
  }));
  box.querySelectorAll('[data-mh-del]').forEach(b => b.addEventListener('click', () => {
    mvpCfg.cards = mvpCfg.cards.filter(x => x.id !== b.dataset.mhDel);
    if (mvpSelId === b.dataset.mhDel) mvpSelId = mvpCfg.cards[0]?.id || '';
    mvpRenderCards(); mvpApplyToInputs(); mvpRenderStage(); mvpScheduleSave();
  }));
}

function mvpRefreshCreatorSelect() {
  const sel = $('#mhCreator'); if (!sel) return;
  const list = visibleCreators();
  const c = mvpSel();
  sel.innerHTML = '<option value="">— Chọn Creator —</option>'
    + list.map(cr => `<option value="${cr.id}">${cr.nickname || cr.tiktokId || cr.id}</option>`).join('');
  if (c && c.mode === 'creator') sel.value = c.creatorId || '';
  mvpRenderCards(); mvpRenderStage();
}

function mvpApplyToInputs() {
  const c = mvpSel();
  const body = $('#mhCfgBody'), empty = $('#mhCfgEmpty');
  if (body) body.style.display = c ? '' : 'none';
  if (empty) empty.style.display = c ? 'none' : '';
  if (!c) return;
  if ($('#mhModeCreator')) $('#mhModeCreator').checked = c.mode !== 'user';
  if ($('#mhModeUser')) $('#mhModeUser').checked = c.mode === 'user';
  if ($('#mhCreatorRow')) $('#mhCreatorRow').style.display = c.mode === 'user' ? 'none' : '';
  if ($('#mhUploadRow')) $('#mhUploadRow').style.display = c.mode === 'user' ? '' : 'none';
  if ($('#mhCreator')) $('#mhCreator').value = c.creatorId || '';
  if ($('#mhUploadName')) $('#mhUploadName').textContent = c.mode === 'user' && c.avatar ? 'Đã có ảnh' : 'Chưa có ảnh';
  if ($('#mhTiktokId')) $('#mhTiktokId').value = c.tiktokId || '';
  if ($('#mhFetchHint')) $('#mhFetchHint').textContent = 'Lấy 1 lần rồi tự lưu trong máy — không tải lại từ TikTok.';
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('#mhName', c.name || ''); if ($('#mhShowName')) $('#mhShowName').checked = !!c.showName;
  if ($('#mhShowText')) $('#mhShowText').checked = c.showText !== false;
  set('#mhText', c.text || ''); set('#mhLayout', ['horizontal', 'vertical', 'attached'].includes(c.layout) ? c.layout : 'attached'); set('#mhAnim', c.entryAnim);
  set('#mhAvatarSize', c.avatarSize); set('#mhFrameScale', c.frameScale); set('#mhNameSize', c.nameSize || 40); set('#mhFontSize', c.fontSize);
  set('#mhTextStyle', c.textStyle); set('#mhColor', c.color); set('#mhBg', c.bgColor); set('#mhBg2', c.bgColor2);
  set('#mhBgOpacity', c.bgOpacity); set('#mhX', c.overlay.x); set('#mhY', c.overlay.y);
  set('#mhScale', Math.round(c.overlay.scale * 100)); set('#mhRot', c.overlay.rot);
  if ($('#mhUsePlaqueImg')) $('#mhUsePlaqueImg').checked = c.usePlaqueImg !== false;
  if ($('#mhCelebrate')) $('#mhCelebrate').checked = !!c.celebrate;
  mvpRenderSkins();
}

// Nạp các ô cấu hình "trình chiếu" (config-level, không theo thẻ) từ mvpCfg vào giao diện.
function mvpApplyRevealInputs() {
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('#mhRevealAutoHide', mvpCfg.revealAutoHide > 0 ? mvpCfg.revealAutoHide : 5);
  set('#mhRevealExit', mvpCfg.revealExit || 'fade');
  $('#mhAuto')?.classList.toggle('active', !!mvpCfg.autoPlay);
}

function mvpRenderSkins() {
  const box = $('#mhSkins'); if (!box) return;
  const c = mvpSel(); const cur = c?.frame || '';
  const q = ($('#mhSkinFilter')?.value || '').replace(/\D+/g, '');
  const list = MVP_FRAMES.map((f, i) => ({ f, num: i + 1 }))
    .filter(x => !q || String(x.num).includes(q));
  // Ô "Không khung" chỉ hiện khi không lọc.
  const noneTile = q ? '' :
    `<button class="mvp-skin no-frame${cur ? '' : ' sel'}" data-mh-frame="" title="Không khung">`
    + `<span class="mvp-skin-thumb"><img class="mvp-skin-ava" src="mvp-frames/avatar.png" alt="" onerror="this.style.visibility='hidden'"/></span>`
    + `<span class="mvp-skin-num">∅</span></button>`;
  const tiles = list.map(({ f, num }) =>
    `<button class="mvp-skin${f === cur ? ' sel' : ''}" data-mh-frame="${f}" title="Khung ${num}">`
    + `<span class="mvp-skin-thumb">`
    + `<img class="mvp-skin-ava" src="mvp-frames/avatar.png" alt="" onerror="this.style.visibility='hidden'"/>`
    + `<img class="mvp-skin-frame" src="${f}" alt="" onerror="this.closest('.mvp-skin')?.classList.add('broken')"/>`
    + `</span>`
    + `<span class="mvp-skin-num">${num}</span>`
    + `<span class="mvp-skin-badge" title="Có ảnh khung danh hiệu ${num}a.png">🎀</span>`
    + `<img class="mvp-skin-probe" src="${mvpPlaqueSrc(f)}" alt="" onload="this.closest('.mvp-skin')?.classList.add('has-plaque');this.remove()" onerror="this.remove()"/>`
    + `</button>`).join('');
  box.innerHTML = noneTile + tiles || '<div class="mvp-hint">Không có khung khớp số.</div>';
  box.querySelectorAll('[data-mh-frame]').forEach(b => b.addEventListener('click', () => {
    const c2 = mvpSel(); if (!c2) return; c2.frame = b.dataset.mhFrame || '';
    mvpRenderSkins(); mvpRenderStage(); mvpRenderCards(); mvpScheduleSave();
  }));
}

function mvpEditSel(fn) { const c = mvpSel(); if (!c) return; fn(c); mvpRenderStage(); mvpRenderCards(); mvpScheduleSave(); }

// ===== Màn công bố — diễn lại trong khung xem trước (khớp hành vi overlay OBS) =====
const MVP_ANIM_CLASSES = ['anim-popBounce', 'anim-zoomFade', 'anim-slideRight', 'anim-slideUp', 'anim-flip', 'anim-dropBounce', 'anim-spotlight', 'anim-zoomShake'];
let mvpRevealTimers = [];
function mvpClearRevealTimers() { mvpRevealTimers.forEach(clearTimeout); mvpRevealTimers = []; }
function mvpPreviewReveal() {
  const stage = $('#mhStage'); if (!stage) return;
  mvpClearRevealTimers();
  const stagger = Math.max(0, Math.min(5, Number(mvpCfg.revealStagger) || 0));
  const autoHide = Math.max(0, Math.min(120, Number(mvpCfg.revealAutoHide) || 0));
  const exit = ['fade', 'slideDown', 'zoomOut'].includes(mvpCfg.revealExit) ? mvpCfg.revealExit : 'fade';
  const sound = mvpCfg.revealSound !== false;
  const list = mvpCfg.cards.filter(c => c.show !== false)
    .map(c => ({ c, el: stage.querySelector(`[data-id="${c.id}"]`) }))
    .filter(x => x.el);
  if (!list.length) return;
  list.forEach(({ el }) => { el.classList.add('reveal-hidden'); el.querySelector('.mhv-inner')?.classList.remove('exit-fade', 'exit-slideDown', 'exit-zoomOut'); });
  list.forEach(({ c, el }, i) => {
    mvpRevealTimers.push(setTimeout(() => {
      el.classList.remove('reveal-hidden');
      const inner = el.querySelector('.mhv-inner');
      if (inner) { inner.classList.remove(...MVP_ANIM_CLASSES); if (c.entryAnim && c.entryAnim !== 'none') { void inner.offsetWidth; inner.classList.add('anim-' + c.entryAnim); } }
      if (sound) mvpRevealBlip(i, list.length);
      if (c.celebrate) mvpConfettiPreview(el);
    }, Math.round(i * stagger * 1000)));
  });
  if (autoHide > 0) {
    const endAt = ((list.length - 1) * stagger + autoHide) * 1000;
    mvpRevealTimers.push(setTimeout(() => {
      list.forEach(({ el }) => { const inner = el.querySelector('.mhv-inner'); if (inner) { inner.classList.remove(...MVP_ANIM_CLASSES); inner.classList.add('exit-' + exit); } });
      mvpRevealTimers.push(setTimeout(() => { list.forEach(({ el }) => { el.classList.add('reveal-hidden'); el.querySelector('.mhv-inner')?.classList.remove('exit-' + exit); }); }, 520));
    }, Math.round(endAt)));
  }
}
function mvpConfettiPreview(el) {
  const wrap = document.createElement('div'); wrap.className = 'mhv-confetti';
  const colors = ['#ff3d71', '#ffd23f', '#2ec4ff', '#38d67a', '#c86bff', '#ff9f1c'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('i');
    const a = (i / 16) * Math.PI * 2 + (i % 2 ? 0.35 : -0.2), dist = 54 + (i % 4) * 20;
    p.style.setProperty('--cx', (Math.cos(a) * dist).toFixed(1) + 'px');
    p.style.setProperty('--cy', (Math.sin(a) * dist - 36).toFixed(1) + 'px');
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (i * 7) + 'ms';
    wrap.appendChild(p);
  }
  el.appendChild(wrap);
  setTimeout(() => { try { wrap.remove(); } catch {} }, 1500);
}
let mvpActx = null;
function mvpAc() { try { if (!mvpActx) mvpActx = new (window.AudioContext || window.webkitAudioContext)(); if (mvpActx.state === 'suspended') mvpActx.resume(); } catch { mvpActx = null; } return mvpActx; }
function mvpBlip(freq, dur, vol) {
  const a = mvpAc(); if (!a) return;
  const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
  o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function mvpRevealBlip(i, total) {
  const scale = [523, 587, 659, 698, 784, 880, 988, 1047];
  mvpBlip(scale[Math.min(i, scale.length - 1)], 0.18, 0.18);
  if (i === total - 1) [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => mvpBlip(f, 0.22, 0.2), 120 + k * 90));
}

// ===== AUTO — xoay vòng liên tục trong khung xem trước (khớp overlay OBS) =====
const mvpAuto = { on: false, timers: [], idx: 0, curId: '' };
function mvpAutoClear() { mvpAuto.timers.forEach(clearTimeout); mvpAuto.timers = []; }
function mvpAutoStop() {
  mvpAuto.on = false; mvpAuto.curId = ''; mvpAutoClear();
  const stage = $('#mhStage'); if (!stage) return;
  stage.querySelectorAll('.mhv-pos').forEach(el => { el.classList.remove('reveal-hidden'); el.querySelector('.mhv-inner')?.classList.remove('exit-fade', 'exit-slideDown', 'exit-zoomOut'); });
}
function mvpAutoStart() { if (mvpAuto.on) return; mvpClearRevealTimers(); mvpAuto.on = true; mvpAuto.idx = 0; mvpAutoTick(); }
function mvpAutoTick() {
  if (!mvpAuto.on) return;
  mvpAutoClear();
  const stage = $('#mhStage'); if (!stage) return;
  const list = mvpCfg.cards.filter(c => c.show !== false).map(c => ({ c, el: stage.querySelector(`[data-id="${c.id}"]`) })).filter(x => x.el);
  if (!list.length) { mvpAuto.timers.push(setTimeout(mvpAutoTick, 1000)); return; }
  const dwell = (Number(mvpCfg.revealAutoHide) > 0 ? Number(mvpCfg.revealAutoHide) : 5) * 1000;
  const exit = ['fade', 'slideDown', 'zoomOut'].includes(mvpCfg.revealExit) ? mvpCfg.revealExit : 'fade';
  const cur = list[mvpAuto.idx % list.length];
  mvpAuto.curId = cur.c.id;
  list.forEach(({ el }) => { el.classList.add('reveal-hidden'); el.querySelector('.mhv-inner')?.classList.remove('exit-fade', 'exit-slideDown', 'exit-zoomOut'); });
  cur.el.classList.remove('reveal-hidden');
  const inner = cur.el.querySelector('.mhv-inner');
  if (inner) { inner.classList.remove(...MVP_ANIM_CLASSES); if (cur.c.entryAnim && cur.c.entryAnim !== 'none') { void inner.offsetWidth; inner.classList.add('anim-' + cur.c.entryAnim); } }
  if (cur.c.celebrate) mvpConfettiPreview(cur.el);
  mvpAuto.timers.push(setTimeout(() => {
    if (inner) { inner.classList.remove(...MVP_ANIM_CLASSES); inner.classList.add('exit-' + exit); }
    mvpAuto.timers.push(setTimeout(() => {
      if (inner) inner.classList.remove('exit-' + exit);
      cur.el.classList.add('reveal-hidden');
      mvpAuto.idx = (mvpAuto.idx + 1) % Math.max(1, list.length);
      mvpAutoTick();
    }, 520));
  }, dwell));
}
function mvpAutoEnforce() {
  const stage = $('#mhStage'); if (!stage) return;
  stage.querySelectorAll('.mhv-pos').forEach(el => { el.classList.toggle('reveal-hidden', el.dataset.id !== mvpAuto.curId); });
}

function wireMvpHonorTab() {
  $('#mhAddCard')?.addEventListener('click', () => {
    const card = mvpNewCard();
    // gợi ý: nếu đang xem 1 nhóm & có Creator, gán luôn Creator đầu tiên
    const first = visibleCreators()[0]; if (first) card.creatorId = first.id;
    mvpCfg.cards.push(card); mvpSelId = card.id;
    mvpRenderCards(); mvpRefreshCreatorSelect(); mvpApplyToInputs(); mvpRenderStage(); mvpScheduleSave();
  });
  $('#mhClear')?.addEventListener('click', async () => {
    if (!mvpCfg.cards.length) return;
    const ok = await window.api.shell.confirm({ message: 'Xoá toàn bộ thẻ vinh danh?', confirmText: 'Xoá hết', cancelText: 'Huỷ' }).catch(() => true);
    if (!ok) return;
    mvpCfg.cards = []; mvpSelId = ''; mvpRenderCards(); mvpApplyToInputs(); mvpRenderStage(); mvpScheduleSave();
  });

  $('#mhModeCreator')?.addEventListener('change', () => mvpEditSel(c => { c.mode = 'creator'; mvpApplyToInputs(); }));
  $('#mhModeUser')?.addEventListener('change', () => mvpEditSel(c => { c.mode = 'user'; mvpApplyToInputs(); }));
  $('#mhCreator')?.addEventListener('change', () => mvpEditSel(c => { c.creatorId = $('#mhCreator').value; }));
  $('#mhUploadBtn')?.addEventListener('click', () => $('#mhUpload')?.click());
  $('#mhUpload')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast('Ảnh quá lớn (tối đa 4MB)', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { mvpEditSel(c => { c.avatar = String(reader.result || ''); }); if ($('#mhUploadName')) $('#mhUploadName').textContent = 'Đã có ảnh'; };
    reader.readAsDataURL(file); e.target.value = '';
  });
  $('#mhTiktokId')?.addEventListener('input', () => mvpEditSel(c => { c.tiktokId = $('#mhTiktokId').value.trim(); }));
  $('#mhTiktokId')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#mhFetchAvatar')?.click(); } });
  $('#mhFetchAvatar')?.addEventListener('click', async () => {
    const c = mvpSel(); if (!c) return;
    const id = ($('#mhTiktokId')?.value || '').trim().replace(/^@/, '');
    if (!id) { toast('Nhập ID TikTok trước đã', 'error'); return; }
    const btn = $('#mhFetchAvatar'), hint = $('#mhFetchHint');
    btn?.classList.add('is-loading'); if (hint) hint.textContent = 'Đang lấy avatar từ TikTok…';
    try {
      const r = await window.api.tt.fetchAvatarData(id);
      if (!r?.dataUrl) { if (hint) hint.textContent = '⚠ Không lấy được avatar cho ID này.'; toast('Không lấy được avatar', 'error'); return; }
      mvpEditSel(cc => {
        cc.tiktokId = id;
        cc.avatar = r.dataUrl;                         // lưu dataURL vào máy, không tải lại từ TikTok
        if (!cc.name && r.nickname) cc.name = r.nickname;
      });
      if ($('#mhName')) $('#mhName').value = mvpSel()?.name || '';
      if ($('#mhUploadName')) $('#mhUploadName').textContent = 'Đã có ảnh';
      if (hint) hint.textContent = '✓ Đã lấy & lưu avatar trong máy.';
      toast('Đã lấy avatar TikTok', 'success');
    } catch {
      if (hint) hint.textContent = '⚠ Lỗi khi lấy avatar.';
      toast('Lỗi khi lấy avatar', 'error');
    } finally { btn?.classList.remove('is-loading'); }
  });
  $('#mhName')?.addEventListener('input', () => mvpEditSel(c => { c.name = $('#mhName').value; }));
  $('#mhShowName')?.addEventListener('change', () => mvpEditSel(c => { c.showName = $('#mhShowName').checked; }));
  $('#mhShowText')?.addEventListener('change', () => mvpEditSel(c => { c.showText = $('#mhShowText').checked; }));
  $('#mhText')?.addEventListener('input', () => mvpEditSel(c => { c.text = $('#mhText').value; }));
  $('#mhLayout')?.addEventListener('change', () => mvpEditSel(c => { c.layout = ['horizontal', 'vertical', 'attached'].includes($('#mhLayout').value) ? $('#mhLayout').value : 'attached'; }));
  $('#mhAnim')?.addEventListener('change', () => mvpEditSel(c => { c.entryAnim = $('#mhAnim').value; }));
  $('#mhCelebrate')?.addEventListener('change', () => mvpEditSel(c => { c.celebrate = $('#mhCelebrate').checked; }));
  $('#mhAvatarSize')?.addEventListener('input', () => mvpEditSel(c => { c.avatarSize = clampInt($('#mhAvatarSize').value, 150, 60, 400); }));
  $('#mhFrameScale')?.addEventListener('input', () => mvpEditSel(c => { c.frameScale = clampInt($('#mhFrameScale').value, 150, 80, 300); }));
  $('#mhNameSize')?.addEventListener('input', () => mvpEditSel(c => { c.nameSize = clampInt($('#mhNameSize').value, 40, 12, 120); }));
  $('#mhFontSize')?.addEventListener('input', () => mvpEditSel(c => { c.fontSize = clampInt($('#mhFontSize').value, 40, 12, 140); }));
  $('#mhUsePlaqueImg')?.addEventListener('change', () => mvpEditSel(c => { c.usePlaqueImg = $('#mhUsePlaqueImg').checked; }));
  $('#mhSkinFilter')?.addEventListener('input', () => mvpRenderSkins());
  $('#mhTextStyle')?.addEventListener('change', () => mvpEditSel(c => { c.textStyle = $('#mhTextStyle').value; }));
  $('#mhColor')?.addEventListener('input', () => mvpEditSel(c => { c.color = $('#mhColor').value; }));
  $('#mhBg')?.addEventListener('input', () => mvpEditSel(c => { c.bgColor = $('#mhBg').value; }));
  $('#mhBg2')?.addEventListener('input', () => mvpEditSel(c => { c.bgColor2 = $('#mhBg2').value; }));
  $('#mhBgOpacity')?.addEventListener('input', () => mvpEditSel(c => { c.bgOpacity = clampInt($('#mhBgOpacity').value, 100, 0, 100); }));
  $('#mhX')?.addEventListener('input', () => mvpEditSel(c => { c.overlay.x = Math.round(Number($('#mhX').value) || 0); }));
  $('#mhY')?.addEventListener('input', () => mvpEditSel(c => { c.overlay.y = Math.round(Number($('#mhY').value) || 0); }));
  $('#mhScale')?.addEventListener('input', () => mvpEditSel(c => { c.overlay.scale = Math.max(0.2, Math.min(4, (Number($('#mhScale').value) || 100) / 100)); }));
  $('#mhRot')?.addEventListener('input', () => mvpEditSel(c => { c.overlay.rot = Math.max(-180, Math.min(180, Number($('#mhRot').value) || 0)); }));
  $('#mhPosReset')?.addEventListener('click', () => mvpEditSel(c => {
    c.overlay.scale = 1; c.overlay.rot = 0;              // về thẳng hàng ngang/dọc (mặc định)
    if ($('#mhScale')) $('#mhScale').value = 100;
    if ($('#mhRot')) $('#mhRot').value = 0;
  }));
  $('#mhCopyUrl')?.addEventListener('click', async () => { const url = await window.api.mvphonor.getUrl(); await window.api.shell.copyText(url); toast('Đã copy link OBS Vinh danh', 'success'); });

  // ----- Trình chiếu (config-level): thời gian "Chuyển" giữa các khung + kiểu ẩn -----
  const saveRevealCfg = () => { mvpScheduleSave(); };
  $('#mhRevealAutoHide')?.addEventListener('input', () => { mvpCfg.revealAutoHide = Math.max(1, Math.min(120, Math.round(Number($('#mhRevealAutoHide').value) || 5))); saveRevealCfg(); });
  $('#mhRevealExit')?.addEventListener('change', () => { mvpCfg.revealExit = ['fade', 'slideDown', 'zoomOut'].includes($('#mhRevealExit').value) ? $('#mhRevealExit').value : 'fade'; saveRevealCfg(); });
  $('#mhAuto')?.addEventListener('click', () => {
    const on = !mvpCfg.autoPlay;
    if (on && !mvpCfg.cards.some(c => c.show !== false)) { toast('Chưa có thẻ nào để chạy AUTO', 'error'); return; }
    mvpCfg.autoPlay = on;
    $('#mhAuto')?.classList.toggle('active', on);
    mvpPush();                                  // đồng bộ ngay sang overlay OBS
    if (on) { mvpAutoStart(); toast('⏩ AUTO: đang xoay vòng từng khung avatar', 'success'); }
    else { mvpAutoStop(); toast('Đã dừng AUTO'); }
  });

  $('#mhCanvas')?.addEventListener('change', () => {
    mvpCfg.canvas = MVP_CANVAS_H[$('#mhCanvas').value] ? $('#mhCanvas').value : '1:1';
    mvpRenderStage(); mvpScheduleSave();
  });

  // Popup ⚙ (nền Review · AUTO): mở 1 cái thì đóng cái kia; bấm ra ngoài thì đóng.
  const mhPops = $$('.mvp-panel .mvp-pop');
  mhPops.forEach(d => d.addEventListener('toggle', () => { if (d.open) mhPops.forEach(o => { if (o !== d) o.open = false; }); }));
  document.addEventListener('click', (e) => { mhPops.forEach(d => { if (d.open && !d.contains(e.target)) d.open = false; }); });

  window.addEventListener('resize', () => { if ($('.panel[data-panel="mvphonor"]')?.classList.contains('active')) mvpRenderStage(); });

  if ($('#mhCanvas')) $('#mhCanvas').value = mvpCfg.canvas || '1:1';
  mvpRefreshCreatorSelect();
  mvpRenderCards();
  mvpApplyToInputs();
  mvpApplyRevealInputs();
  mvpRenderStage();
  if (mvpCfg.autoPlay) mvpAutoStart();
}

// ============================================================
// VÒNG QUAY MAY MẮN (Lucky Wheel)
// ============================================================
const LW_PALETTE = ['#ff3d71', '#00e0c7', '#7a5cff', '#ff9f1c', '#2ec4ff', '#ff5db1', '#38d67a', '#ffd23f', '#c86bff', '#4c8dff'];
let lwCfg = { title: 'VÒNG QUAY MAY MẮN', showTitle: true, style: 'neon', spinSeconds: 5, slowSec: 3, sound: true, confetti: true, showResult: true, edgeStops: true, autoRemove: false, pushDrawnTop: false, autoContest: true, contestAssignmentsInitialized: false, selectedSpinner: null, segments: [], history: [] };
// segId của ô đã trúng (đã xám danh sách) NHƯNG còn trên vòng quay app/OBS — sẽ bị loại khỏi
// vòng quay khi BẮT ĐẦU lượt quay kế tiếp. null nếu không có ô nào đang chờ loại.
let lwPendingDrawn = null;
// Chế độ thi đấu: id Creator vừa bị cảnh báo "đã có STT" — bấm QUAY lần nữa cùng người này để GHI ĐÈ.
let lwContestDupArm = null;
// Tăng mỗi khi huỷ/reset lượt thi để kết quả của animation cũ không gán STT trở lại.
let lwContestEpoch = 0;
// Các thay đổi STT đi qua một hàng đợi để thao tác Khôi phục luôn thắng kết quả quay đến trễ.
let lwPerfOrderQueue = Promise.resolve();

function lwNormalize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    title: typeof c.title === 'string' ? c.title : 'VÒNG QUAY MAY MẮN',
    showTitle: c.showTitle !== false,
    style: ['neon', 'gold', 'pastel', 'dark'].includes(c.style) ? c.style : 'neon',
    fontScale: clampInt(c.fontScale, 100, 50, 200),
    spinSeconds: clampInt(c.spinSeconds, 5, 2, 15),
    slowSec: clampInt(c.slowSec, 3, 0, 6),
    sound: c.sound !== false, confetti: c.confetti !== false, showResult: c.showResult !== false,
    edgeStops: c.edgeStops !== false,
    autoRemove: c.autoRemove === true,
    pushDrawnTop: c.pushDrawnTop === true,
    autoContest: c.autoContest !== false, // Chế độ thi đấu: gán STT cho Creator (mặc định BẬT — hợp TALENT SHOW)
    // Đánh dấu đã có nguồn STT chính thức; tránh tự dựng lại STT sau khi user chủ động xoá.
    contestAssignmentsInitialized: c.contestAssignmentsInitialized === true,
    showCount: c.showCount !== false, spinCount: Math.max(0, Math.round(Number(c.spinCount) || 0)),
    selectedSpinner: c.selectedSpinner?.name ? { id: String(c.selectedSpinner.id || ''), name: String(c.selectedSpinner.name), avatar: String(c.selectedSpinner.avatar || '') } : null,
    segments: Array.isArray(c.segments) ? c.segments.map((s, i) => {
      const contestOrder = Math.max(0, Math.round(Number(s.contestOrder) || 0));
      return {
        id: s.id || ('lw_' + Math.random().toString(36).slice(2, 9)),
        text: String(s.text || ''), note: String(s.note || ''),
        type: ['reward', 'penalty', 'info'].includes(s.type) ? s.type : 'info',
        color: /^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : LW_PALETTE[i % LW_PALETTE.length],
        weight: clampInt(s.weight, 10, 1, 100),
        jackpot: s.jackpot === true,
        won: s.won === true,     // ĐÃ trúng: xám trong danh sách + hiện tên/avatar (từ lúc ra kết quả)
        drawn: s.drawn === true, // ĐÃ loại khỏi vòng quay app/OBS (từ lượt quay kế tiếp)
        wonBy: String(s.wonBy || ''), wonAvatar: String(s.wonAvatar || ''),
        wonCreatorId: String(s.wonCreatorId || ''),
        // Liên kết bền vững giữa ô quay và STT để đổi người/khôi phục đồng bộ được OBS.
        contestCreatorId: contestOrder ? String(s.contestCreatorId || '') : '',
        contestOrder,
        contestSpinId: contestOrder ? String(s.contestSpinId || '') : '',
      };
    }) : [],
    history: Array.isArray(c.history) ? c.history : [],
  };
}

async function loadLuckyWheelConfig() {
  const cfg = await window.api.luckywheel.getConfig().catch(() => null);
  lwCfg = lwNormalize(cfg);
  // Tắt chế độ chỉ ẨN chip STT trên OBS; dữ liệu Creator/ô quay vẫn được giữ để bật lại hiện ngay.
  await window.api.ranking.setConfig({ showPerfOrder: lwCfg.autoContest }).catch(() => {});
  if (!lwCfg.segments.length) {
    // Ô mẫu để người dùng thấy ngay cách dùng
    lwCfg.segments = [
      { id: 'lw_a', text: 'Thưởng 50K', note: 'Chuyển khoản', type: 'reward', color: LW_PALETTE[0] },
      { id: 'lw_b', text: 'Hát 1 bài', note: '', type: 'penalty', color: LW_PALETTE[1] },
      { id: 'lw_c', text: 'x2 điểm', note: '', type: 'reward', color: LW_PALETTE[2] },
      { id: 'lw_d', text: 'Hít đất 10 cái', note: '', type: 'penalty', color: LW_PALETTE[3] },
      { id: 'lw_e', text: 'May mắn lần sau', note: '', type: 'info', color: LW_PALETTE[4] },
      { id: 'lw_f', text: 'JACKPOT', note: 'Phần thưởng lớn', type: 'reward', color: LW_PALETTE[5], weight: 1, jackpot: true },
    ];
    // Đẩy ô mẫu sang engine/overlay ngay để OBS có nội dung ở lần đầu (chưa cần người dùng sửa).
    lwPush();
  }
}

function lwPush() { return window.api.luckywheel.setConfig(lwCfg).catch(() => {}); }
const _lwSaver = makeAutoSaver(() => lwPush());
function lwScheduleSave() { _lwSaver.schedule(); }
// Vòng quay chỉ hiện các ô CHƯA quay (drawn=false). Ô đã quay bị làm xám trong danh sách
// nhưng biến mất khỏi vòng quay ở app + OBS. Chỉ số ô trúng (spin.index) tính theo tập này.
function lwPool() { return lwCfg.segments.filter(s => !s.drawn); }
// "Xám trong danh sách" = đã trúng (won) hoặc đã loại khỏi vòng quay (drawn).
function lwIsGrayed(s) { return !!(s && (s.won || s.drawn)); }
// Đẩy các ô đã quay (xám) lên đầu danh sách để dễ kiểm soát — sắp xếp ỔN ĐỊNH nên thứ tự
// tương đối của nhóm chưa quay giữ nguyên → vòng quay (lwPool) KHÔNG đổi hình.
function lwSortDrawn() {
  if (!lwCfg.pushDrawnTop) return;
  lwCfg.segments = lwCfg.segments
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (lwIsGrayed(b.s) ? 1 : 0) - (lwIsGrayed(a.s) ? 1 : 0) || a.i - b.i)
    .map(x => x.s);
}
// Xáo trộn NGẪU NHIÊN thứ tự các ô (Fisher–Yates) → vòng quay app + OBS đảo vị trí số,
// tránh cảm giác chạy tuần tự 1→N. Không đổi nội dung/kết quả, chỉ đổi vị trí trên vòng.
function lwShuffleSegments() {
  if (lwPreviewSpinning) { toast('Đang quay, thử lại sau', 'error'); return; }
  if (lwCfg.segments.length < 2) { toast('Cần ít nhất 2 ô để xáo trộn', 'error'); return; }
  const a = lwCfg.segments;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  renderLwSegList(); renderLwPreview(); lwPush();
  toast('Đã xáo trộn thứ tự vòng quay', 'success');
}
function lwNewSeg() {
  const i = lwCfg.segments.length;
  return {
    id: 'lw_' + Math.random().toString(36).slice(2, 9), text: 'Số ' + (i + 1), note: '', type: 'info',
    color: LW_PALETTE[i % LW_PALETTE.length], weight: 10, jackpot: false, won: false, drawn: false,
    wonBy: '', wonAvatar: '', wonCreatorId: '', contestCreatorId: '', contestOrder: 0, contestSpinId: '',
  };
}

function lwClearContestAssignment(seg) {
  if (!seg) return;
  seg.contestCreatorId = '';
  seg.contestOrder = 0;
  seg.contestSpinId = '';
}

function lwClearAllContestAssignments() {
  lwCfg.segments.forEach(lwClearContestAssignment);
}

function lwAssignContestOrder(seg, creatorId, order, spinId = '') {
  const id = String(creatorId || '');
  const n = Math.max(0, Math.round(Number(order) || 0));
  if (!seg || !id || !n) { lwClearContestAssignment(seg); return; }
  // Mỗi Creator chỉ giữ STT mới nhất; ô cũ vẫn giữ người trúng nhưng không còn sở hữu STT.
  lwCfg.segments.forEach(s => { if (s !== seg && s.contestCreatorId === id) lwClearContestAssignment(s); });
  seg.contestCreatorId = id;
  seg.contestOrder = n;
  seg.contestSpinId = String(spinId || '');
  lwCfg.contestAssignmentsInitialized = true;
}

function lwContestAssignments() {
  return lwCfg.segments.reduce((list, seg) => {
    const creatorId = String(seg.contestCreatorId || '');
    const order = Math.max(0, Math.round(Number(seg.contestOrder) || 0));
    if (creatorId && order) list.push({ creatorId, order });
    return list;
  }, []);
}

function lwContestOrderFromText(text) {
  const match = String(text || '').match(/-?\d+/);
  const order = match ? parseInt(match[0], 10) : 0;
  return order > 0 ? order : 0;
}

// Chỉ dùng một lần để cứu dữ liệu của bản trước: lúc đó ô đã quay có Creator nhưng chưa lưu liên kết STT.
function lwRestoreLegacyContestAssignments() {
  if (lwCfg.contestAssignmentsInitialized || lwCfg.segments.some(s => s.contestCreatorId && Number(s.contestOrder) > 0)) return 0;
  let restored = 0;
  for (const seg of lwCfg.segments) {
    const creatorId = String(seg.wonCreatorId || '');
    const order = lwContestOrderFromText(seg.text);
    if (!seg.won || !creatorId || !order || !creators.some(c => c.id === creatorId)) continue;
    lwAssignContestOrder(seg, creatorId, order);
    restored += 1;
  }
  return restored;
}

function lwInvalidateContestSpin() { lwContestEpoch += 1; }

function lwSyncContestPerfOrders() {
  const assignments = lwContestAssignments();
  const sync = async () => {
    const result = await window.api.ranking.syncPerfOrders(assignments).catch(() => null);
    if (result?.ok) await refreshCreators();
    return result;
  };
  const next = lwPerfOrderQueue.then(sync, sync);
  lwPerfOrderQueue = next.catch(() => {});
  return next;
}

// Tạo hàng loạt: thay danh sách ô hiện tại bằng dãy "Số 1 → Số N" (bốc số/rút thăm).
function lwGenerateNumbers(n) {
  const count = clampInt(n, 10, 1, 200);
  lwCfg.segments = Array.from({ length: count }, (_, i) => ({
    id: 'lw_' + Math.random().toString(36).slice(2, 9),
    text: 'Số ' + (i + 1), note: '', type: 'info',
    color: LW_PALETTE[i % LW_PALETTE.length], weight: 10, jackpot: false, won: false, drawn: false,
    wonBy: '', wonAvatar: '', wonCreatorId: '', contestCreatorId: '', contestOrder: 0, contestSpinId: '',
  }));
  renderLwSegList(); renderLwPreview(); lwPush();
}

// Chỉ số nhỏ gọn trên thanh "Nội dung": tổng ô đã tạo · ô còn lại (chưa quay) · số lượt đã quay.
function lwUpdateSegStats() {
  const el = $('#lwSegStats'); if (!el) return;
  const total = lwCfg.segments.length;
  const left = lwCfg.segments.filter(s => !lwIsGrayed(s)).length;
  const spins = Math.max(0, Math.round(Number(lwCfg.spinCount) || 0));
  el.innerHTML =
    `<span class="lw-stat" title="Tổng số ô đã tạo">🎡 <b>${total}</b></span>` +
    `<span class="lw-stat lw-stat-left" title="Số ô còn lại (chưa quay)">🟢 <b>${left}</b></span>` +
    `<span class="lw-stat" title="Số lượt đã quay">🎯 <b>${spins}</b></span>`;
}

function renderLwSegList() {
  const box = $('#lwSegList'); if (!box) return;
  lwSortDrawn();
  lwUpdateSegStats();
  if (!lwCfg.segments.length) { box.innerHTML = '<div class="lw-empty">Chưa có ô nào. Nhấn <b>＋ Thêm ô</b>.</div>'; return; }
  box.innerHTML = lwCfg.segments.map((s, i) => { const g = lwIsGrayed(s); return `
    <div class="lw-seg${g ? ' lw-seg-drawn' : ''}" data-i="${i}">
      <div class="lw-seg-row" data-i="${i}">
        <input type="color" class="lw-seg-color" data-i="${i}" value="${s.color}" title="Màu ô" />
        <input type="text" class="lw-seg-text" data-i="${i}" value="${escAttr(s.text)}" placeholder="Nội dung ô" />
        ${g ? (s.wonBy
          ? `<span class="lw-seg-wonby" data-i="${i}" title="Người quay: ${escAttr(s.wonBy)} — bấm để chọn lại"><img class="lw-won-av js-avatar" src="${escAttr(safeAvatarUrl(s.wonAvatar))}" alt="" /><span class="lw-won-name">${escAttr(s.wonBy)}</span></span>`
          : `<span class="lw-seg-wonby lw-won-none" data-i="${i}" title="Bấm để chọn người quay">＋ tên</span>`) : ''}
        ${g ? `<button class="lw-seg-restore" data-i="${i}" type="button" title="Khôi phục ô đã quay và xoá STT thi đấu liên quan">↩️</button>` : ''}
        <button class="lw-seg-gear" data-i="${i}" type="button" title="Cài đặt: loại kết quả · tỷ lệ · quà lớn">⚙️</button>
        <button class="lw-seg-del" data-i="${i}" type="button" title="Xoá ô">🗑</button>
      </div>
      <div class="lw-seg-adv" data-i="${i}" hidden>
        <select class="lw-seg-type" data-i="${i}" title="Loại kết quả">
          <option value="reward"${s.type === 'reward' ? ' selected' : ''}>🎁 Thưởng</option>
          <option value="penalty"${s.type === 'penalty' ? ' selected' : ''}>⚡ Phạt</option>
          <option value="info"${s.type === 'info' ? ' selected' : ''}>✨ Thông tin</option>
        </select>
        <label class="lw-seg-weight" title="Tỷ lệ tương đối"><span>×</span><input type="number" class="lw-seg-weight-input" data-i="${i}" min="1" max="100" value="${s.weight}" /></label>
        <label class="lw-seg-jackpot" title="Quà lớn: hiệu ứng ánh sáng và âm thanh riêng"><input type="checkbox" data-i="${i}"${s.jackpot ? ' checked' : ''} /><span>⭐ Quà lớn</span></label>
      </div>
    </div>`; }).join('');
  box.querySelectorAll('.lw-seg-gear').forEach(el => el.addEventListener('click', () => {
    const adv = box.querySelector('.lw-seg-adv[data-i="' + el.dataset.i + '"]');
    if (adv) { adv.hidden = !adv.hidden; el.classList.toggle('open', !adv.hidden); }
  }));
  box.querySelectorAll('.lw-seg-color').forEach(el => el.addEventListener('input', () => { lwCfg.segments[+el.dataset.i].color = el.value; renderLwPreview(); lwScheduleSave(); }));
  box.querySelectorAll('.lw-seg-text').forEach(el => el.addEventListener('input', () => { lwCfg.segments[+el.dataset.i].text = el.value; renderLwPreview(); lwScheduleSave(); }));
  box.querySelectorAll('.lw-seg-type').forEach(el => el.addEventListener('change', () => { lwCfg.segments[+el.dataset.i].type = el.value; lwScheduleSave(); }));
  box.querySelectorAll('.lw-seg-weight-input').forEach(el => el.addEventListener('input', () => { lwCfg.segments[+el.dataset.i].weight = clampInt(el.value, 10, 1, 100); lwScheduleSave(); }));
  box.querySelectorAll('.lw-seg-jackpot input').forEach(el => el.addEventListener('change', () => { lwCfg.segments[+el.dataset.i].jackpot = el.checked; lwScheduleSave(); }));
  box.querySelectorAll('.lw-seg-wonby').forEach(el => el.addEventListener('click', () => lwOpenWonEditor(+el.dataset.i, el)));
  box.querySelectorAll('.lw-seg-restore').forEach(el => el.addEventListener('click', async () => {
    const s = lwCfg.segments[+el.dataset.i];
    if (!s) return;
    lwInvalidateContestSpin();
    if (lwPendingDrawn === s.id) lwPendingDrawn = null;
    s.won = false; s.drawn = false; s.wonBy = ''; s.wonAvatar = ''; s.wonCreatorId = '';
    lwClearContestAssignment(s);
    lwCfg.contestAssignmentsInitialized = true;
    renderLwSegList(); renderLwPreview();
    await lwPush();
    await lwSyncContestPerfOrders();
  }));
  box.querySelectorAll('.lw-seg-del').forEach(el => el.addEventListener('click', () => { lwCfg.segments.splice(+el.dataset.i, 1); renderLwSegList(); renderLwPreview(); lwScheduleSave(); }));
}

function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// Sửa lại người quay trúng cho 1 ô đã xám (chọn nhầm người thì đổi lại) — popup gắn dưới chip.
function lwCloseWonEditor() {
  document.getElementById('lwWonPop')?.remove();
  if (lwWonEditorCleanup) { lwWonEditorCleanup(); lwWonEditorCleanup = null; }
}
let lwWonEditorCleanup = null;
function lwOpenWonEditor(i, anchorEl) {
  lwCloseWonEditor();
  const seg = lwCfg.segments[i]; if (!seg || !anchorEl) return;
  const list = visibleCreators();
  const selectedWinnerId = String(seg.wonCreatorId || list.find(cr => (cr.nickname || cr.tiktokId || cr.id) === seg.wonBy)?.id || '');
  const pop = document.createElement('div');
  pop.id = 'lwWonPop';
  pop.className = 'lw-won-pop';
  pop.innerHTML = `
    <div class="lw-won-pop-title">Người quay trúng "${escAttr(seg.text) || 'ô này'}"</div>
    <select class="lw-won-pop-sel">
      <option value="">— Chọn thành viên —</option>
      ${list.map(cr => { const nm = cr.nickname || cr.tiktokId || cr.id; return `<option value="${escAttr(cr.id)}"${cr.id === selectedWinnerId ? ' selected' : ''}>${escAttr(nm)}</option>`; }).join('')}
    </select>
    <input class="lw-won-pop-name" type="text" placeholder="hoặc gõ tên tự do…" value="${escAttr(seg.wonBy)}" />
    <div class="lw-won-pop-actions">
      <button class="lw-won-pop-clear" type="button">🗑️ Xoá tên</button>
      <button class="lw-won-pop-apply" type="button">✔ Áp dụng</button>
    </div>`;
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 266)) + 'px';
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + 'px';
  const sel = pop.querySelector('.lw-won-pop-sel');
  const name = pop.querySelector('.lw-won-pop-name');
  sel.addEventListener('change', () => { if (sel.value) { const cr = list.find(c => c.id === sel.value); if (cr) name.value = cr.nickname || cr.tiktokId || cr.id; } });
  const apply = async () => {
    let wonBy = name.value.trim(), wonAvatar = '', wonCreatorId = '';
    if (sel.value) {
      const cr = list.find(c => c.id === sel.value);
      if (cr) { wonBy = cr.nickname || cr.tiktokId || cr.id; wonAvatar = cr.avatar || ''; wonCreatorId = cr.id; }
    }
    const contestOrder = Math.max(0, Math.round(Number(seg.contestOrder) || 0));
    seg.wonBy = wonBy; seg.wonAvatar = wonAvatar; seg.wonCreatorId = wonCreatorId;
    if (contestOrder) {
      if (wonCreatorId) lwAssignContestOrder(seg, wonCreatorId, contestOrder, seg.contestSpinId);
      else lwClearContestAssignment(seg);
    }
    lwCloseWonEditor(); renderLwSegList(); renderLwPreview();
    await lwPush();
    if (contestOrder) await lwSyncContestPerfOrders();
  };
  pop.querySelector('.lw-won-pop-apply').addEventListener('click', apply);
  pop.querySelector('.lw-won-pop-clear').addEventListener('click', async () => {
    const contestOrder = Math.max(0, Math.round(Number(seg.contestOrder) || 0));
    seg.wonBy = ''; seg.wonAvatar = ''; seg.wonCreatorId = '';
    lwClearContestAssignment(seg);
    lwCloseWonEditor(); renderLwSegList(); renderLwPreview();
    await lwPush();
    if (contestOrder) await lwSyncContestPerfOrders();
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') lwCloseWonEditor(); });
  // Đóng khi bấm ra ngoài hoặc cuộn danh sách (popup gắn theo toạ độ chip).
  const onDoc = (e) => { if (!pop.contains(e.target) && !(e.target instanceof Node && e.target.closest?.('.lw-seg-wonby'))) lwCloseWonEditor(); };
  const onScroll = () => lwCloseWonEditor();
  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  document.getElementById('lwSegList')?.addEventListener('scroll', onScroll, { passive: true });
  lwWonEditorCleanup = () => { document.removeEventListener('mousedown', onDoc); document.getElementById('lwSegList')?.removeEventListener('scroll', onScroll); };
  setTimeout(() => name.focus(), 0);
}

let lwPreviewRot = null;    // góc quay hiện tại của preview (radian); null = vị trí nghỉ
let lwPreviewSpinning = false;

function lwDrawPreviewAt(rot) {
  const cv = $('#lwPreview'); if (!cv) return;
  const ctx = cv.getContext('2d'); const S = cv.width, C = S / 2, R = C - 12;
  ctx.clearRect(0, 0, S, S);
  const segs = lwPool();
  const rims = { neon: '#0d0d1a', gold: '#3a2607', pastel: '#f0e6ff', dark: '#0b0e13' };
  const rim = rims[lwCfg.style] || '#0d0d1a';
  if (!segs.length) { ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(30,30,40,.5)'; ctx.fill(); ctx.lineWidth = 14; ctx.strokeStyle = rim; ctx.stroke(); return; }
  const seg = Math.PI * 2 / segs.length;
  const r = (rot == null) ? (-Math.PI / 2 - seg / 2) : rot; // nghỉ: ô đầu ở đỉnh
  ctx.save(); ctx.translate(C, C); ctx.rotate(r);
  const baseFont = segs.length <= 6 ? 27 : segs.length <= 10 ? 21 : 16;
  const font = Math.round(baseFont * (lwCfg.fontScale || 100) / 100);
  for (let i = 0; i < segs.length; i++) {
    const a0 = i * seg, a1 = (i + 1) * seg;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath();
    const face = ctx.createRadialGradient(0, 0, R * .06, 0, 0, R);
    face.addColorStop(0, lwShadeColor(segs[i].color, .3));
    face.addColorStop(.48, segs[i].color);
    face.addColorStop(1, lwShadeColor(segs[i].color, -.22));
    ctx.fillStyle = face; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.stroke();
    ctx.save(); ctx.rotate(a0 + seg / 2);
    ctx.fillStyle = lwTextColor(segs[i].color); ctx.font = '800 ' + font + 'px "Be Vietnam Pro", sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3;
    const t = segs[i].text || '';
    ctx.fillText(t.length > 16 ? t.slice(0, 15) + '…' : t, R - 12, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.lineWidth = 14; ctx.strokeStyle = rim; ctx.stroke();
  ctx.beginPath(); ctx.arc(C, C, 34, 0, Math.PI * 2); ctx.fillStyle = ({ neon: '#e8365d', gold: '#c8a24a', pastel: '#ff87ab', dark: '#4c8dff' })[lwCfg.style] || '#e8365d'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
}
function renderLwPreview() { if (!lwPreviewSpinning) lwDrawPreviewAt(lwPreviewRot); }

function lwPlayPreviewEdgeCatch(offset) {
  const pointer = document.querySelector('.lw-preview-pointer');
  if (!pointer) return;
  const cls = offset < 0 ? 'lw-edge-catch-left' : 'lw-edge-catch-right';
  pointer.classList.remove('lw-edge-catch-left', 'lw-edge-catch-right');
  void pointer.offsetWidth;
  pointer.classList.add(cls);
}

function lwAnimatePreview(index, durSec, landingOffset, edgeCatch) {
  const pool = lwPool();
  const n = pool.length; if (!n) return;
  const seg = Math.PI * 2 / n;
  const norm = (a) => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };
  const start = (lwPreviewRot == null) ? (-Math.PI / 2 - seg / 2) : lwPreviewRot;
  const offset = Math.max(-0.465, Math.min(0.465, Number(landingOffset) || 0));
  const target = -Math.PI / 2 - index * seg - seg / 2 - offset * seg;
  const dur = Math.max(2, Math.min(15, durSec || 5)) * 1000;
  const turns = 5 + Math.floor(dur / 1500);
  const final = start + turns * Math.PI * 2 + norm(target - norm(start));
  const k = lwTailPower(lwCfg.slowSec);
  lwPreviewSpinning = true;
  let t0 = null, catchTriggered = false, scanIdx = -1;
  function frame(ts) {
    if (!t0) t0 = ts;
    const p = Math.min((ts - t0) / dur, 1);
    lwPreviewRot = start + (final - start) * lwEaseWheel(p, k);
    if (p > 0.93 && Math.abs(offset) > 0.36) {
      const settle = (p - 0.93) / 0.07;
      const edgeStrength = Math.max(0, Math.min(1, (Math.abs(offset) - 0.36) / 0.105));
      const settleAmount = 0.035 + edgeStrength * 0.085;
      lwPreviewRot += -Math.sign(offset) * seg * settleAmount * Math.sin(Math.PI * settle) * (1 - 0.25 * settle);
    }
    if (!catchTriggered && edgeCatch && p > 0.935) {
      catchTriggered = true;
      lwPlayPreviewEdgeCatch(offset);
    }
    // Nháy nhanh ô đang nằm dưới mũi tên → chậm dần theo vòng quay (cảm giác "máy xèng").
    if (p < 1) {
      const ci = ((Math.floor(norm(-Math.PI / 2 - lwPreviewRot) / seg) % n) + n) % n;
      if (ci !== scanIdx) { scanIdx = ci; lwShowScan(pool[ci]); }
    }
    lwDrawPreviewAt(lwPreviewRot);
    if (p < 1) requestAnimationFrame(frame);
    else { lwPreviewRot = norm(final); lwPreviewSpinning = false; }
  }
  requestAnimationFrame(frame);
}

// Quay như đời thực: bung nhanh lúc đầu rồi chậm rải dần, bò từng chút ở cuối.
// slowSec (0–6) càng lớn đuôi càng dài; đoạn đầu (a) là Hermite bậc 3 khớp vị trí+vận tốc
// với ease-out tại mốc a và vận tốc 0 ở t=0 → khởi động êm, không giật.
function lwTailPower(slowSec) { const s = Math.max(0, Math.min(6, Number(slowSec)) || 0); return 2.2 + s * 0.6; }
function lwEaseWheel(t, k) {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  const a = 0.14;
  const G = 1 - Math.pow(1 - a, k);
  const D = k * Math.pow(1 - a, k - 1);
  if (t < a) {
    const b = (3 * G - D * a) / (a * a);
    const c = (D - 2 * G / a) / (a * a);
    return b * t * t + c * t * t * t;
  }
  return 1 - Math.pow(1 - t, k);
}

// Thẻ "quét nhanh" hiển thị ô đang lướt qua mũi tên trong lúc quay (bảng điều khiển).
function lwShowScan(s) {
  const box = $('#lwLast'); if (!box || !s) return;
  box.className = 'lw-last lw-last-scan';
  box.style.setProperty('--lw-scan', s.color || '#888');
  box.innerHTML = `<span class="lw-scan-dot"></span><span class="lw-scan-text">${escAttr(s.text) || '—'}</span>`;
}
function lwTextColor(hex) {
  const h = String(hex || '#888').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#2a2233' : '#fff';
}
function lwShadeColor(hex, amount) {
  const h = String(hex || '#888').replace('#', '');
  const rgb = [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  return 'rgb(' + rgb.map(v => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))).join(',') + ')';
}

function lwRefreshSpinners() {
  const sel = $('#lwSpinnerSel'); if (!sel) return;
  const cur = sel.value;
  const list = visibleCreators();
  sel.innerHTML = '<option value="">— Không chọn —</option>' + list.map(cr => `<option value="${cr.id}">${cr.nickname || cr.tiktokId || cr.id}</option>`).join('');
  const savedId = lwCfg.selectedSpinner?.id || '';
  const target = list.some(cr => cr.id === cur) ? cur : savedId;
  const selected = list.find(cr => cr.id === target);
  if (selected) {
    sel.value = target;
    if (lwCfg.selectedSpinner?.id === selected.id) {
      const next = { id: selected.id, name: selected.nickname || selected.tiktokId || 'Creator', avatar: selected.avatar || '' };
      if (next.name !== lwCfg.selectedSpinner.name || next.avatar !== lwCfg.selectedSpinner.avatar) {
        lwCfg.selectedSpinner = next;
        lwPush();
      }
    }
  }
  else if (lwCfg.selectedSpinner?.id) {
    // Đổi nhóm: không giữ avatar của thành viên thuộc nhóm trước trên overlay.
    lwCfg.selectedSpinner = null;
    lwPush();
  }
}

function lwGetSpinner() {
  const sel = $('#lwSpinnerSel'); const free = $('#lwSpinnerName');
  const id = sel ? sel.value : '';
  // Dropdown chỉ hiển thị nhóm active, vì vậy avatar cũng phải lấy từ đúng tập này.
  if (id) { const cr = visibleCreators().find(c => c.id === id); if (cr) return { id: cr.id, name: cr.nickname || cr.tiktokId || 'Creator', avatar: cr.avatar || '' }; }
  const name = (free && free.value.trim()) || '';
  return name ? { name, avatar: '' } : null;
}

function lwSyncSelectedSpinner() {
  lwCfg.selectedSpinner = lwGetSpinner();
  lwPush();
}

// 🏆 Chế độ thi đấu: quay gán STT xong thì TỰ nhảy dropdown sang Creator KẾ chưa có STT.
// Tránh "kẹt" khi dropdown vẫn dính người vừa gán → mỗi lần bấm QUAY lại báo trùng chính họ.
// Hết người chưa gán thì bỏ chọn + báo đã xong.
function lwContestAdvanceAfter(afterId) {
  const sel = $('#lwSpinnerSel'); if (!sel) return;
  const list = visibleCreators();
  const idx = list.findIndex(c => c.id === afterId);
  let next = null;
  for (let k = 1; k <= list.length; k++) {
    const c = list[(Math.max(0, idx) + k) % list.length];
    if (c && !(Number(c.perfOrder) > 0)) { next = c; break; }
  }
  lwContestDupArm = null;
  sel.classList.remove('lw-invalid');
  if (next) {
    sel.value = next.id;
    if ($('#lwSpinnerName')) $('#lwSpinnerName').value = '';
    lwSyncSelectedSpinner(); // cập nhật selectedSpinner + đẩy avatar người kế lên tâm vòng quay OBS
    toast(`➡️ Người quay kế: ${next.nickname || next.tiktokId || 'Creator'}`, 'info');
  } else {
    sel.value = '';
    lwCfg.selectedSpinner = null; lwPush();
    toast('✅ Mọi Creator đã có STT — hết người để quay', 'success');
  }
}

function lwTypeLabel(t) { return t === 'reward' ? '🎁 Thưởng' : t === 'penalty' ? '⚡ Phạt' : '✨ Thông tin'; }
function lwFmtTime(iso) { try { const d = new Date(iso); return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); } catch { return ''; } }
function lwBuildCsv() {
  const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
  return ['Thời gian,Người quay,Kết quả,Ghi chú,Loại'].concat(
    (lwCfg.history || []).map(x => [lwFmtTime(x.time), x.member, x.text, x.note, lwTypeLabel(x.type)].map(esc).join(','))
  ).join('\r\n');
}

function lwUpdateCountInput() { const inp = $('#lwSpinCount'); if (inp && document.activeElement !== inp) inp.value = lwCfg.spinCount || 0; lwUpdateSegStats(); }

function renderLwHistory() {
  const box = $('#lwHistTable'); const stats = $('#lwStats');
  const h = lwCfg.history || [];
  if (stats) {
    const rw = h.filter(x => x.type === 'reward').length, pn = h.filter(x => x.type === 'penalty').length;
    const byName = {}; h.forEach(x => { if (x.member) byName[x.member] = (byName[x.member] || 0) + 1; });
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1])[0];
    stats.innerHTML = `Lượt quay: <b>${lwCfg.spinCount || 0}</b> · Lưu: <b>${h.length}</b> · 🎁 <b>${rw}</b> · ⚡ <b>${pn}</b>` + (top ? ` · Nhiều nhất: <b>${escAttr(top[0])}</b> (${top[1]})` : '');
  }
  lwUpdateCountInput();
  if (!box) return;
  if (!h.length) { box.innerHTML = '<div class="lw-empty">Chưa có lượt quay nào.</div>'; return; }
  box.innerHTML = `<table class="lw-table"><thead><tr><th>Thời gian</th><th>Người quay</th><th>Kết quả</th><th>Ghi chú</th><th>Loại</th><th></th></tr></thead><tbody>`
    + h.slice(0, 60).map(x => `<tr class="lw-r-${x.type}"><td>${lwFmtTime(x.time)}</td><td>${escAttr(x.member) || '—'}</td><td><b>${escAttr(x.text)}</b></td><td>${escAttr(x.note) || ''}</td><td>${lwTypeLabel(x.type)}</td><td><button class="lw-hist-del" data-id="${escAttr(x.id)}" type="button" title="Xoá lượt lỗi (tự trừ đếm)">🗑</button></td></tr>`).join('')
    + '</tbody></table>';
  box.querySelectorAll('.lw-hist-del').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.id;
    const nc = await window.api.luckywheel.removeHistory(id).catch(() => null);
    lwCfg.history = lwCfg.history.filter(x => x.id !== id);
    if (typeof nc === 'number') lwCfg.spinCount = nc;
    renderLwHistory();
  }));
}

async function lwDoSpin() {
  if (!lwCfg.segments.length) { toast('Chưa có ô nào để quay', 'error'); return; }
  const btn = $('#lwSpinBtn');
  if (btn?.disabled) return;
  // 🏆 CHẾ ĐỘ THI ĐẤU: bắt buộc chọn 1 Creator thật (không phải tên gõ tay) trước khi quay.
  // Quay xong sẽ lọc SỐ từ ô trúng (vd "Số 10" → 10) gán làm STT thi đấu cho Creator đó.
  const contest = !!lwCfg.autoContest;
  if (contest) {
    const selEl = $('#lwSpinnerSel');
    const sp = lwGetSpinner();
    if (!sp?.id) {
      selEl?.classList.add('lw-invalid');
      toast('🏆 Chế độ thi đấu: hãy CHỌN 1 Creator trong danh sách trước khi quay', 'error');
      return;
    }
    // Trùng người đã có STT → cảnh báo (viền đỏ); bấm QUAY lần nữa CÙNG người để GHI ĐÈ.
    const cr = creators.find(c => c.id === sp.id);
    if (cr && Number(cr.perfOrder) > 0 && lwContestDupArm !== sp.id) {
      lwContestDupArm = sp.id;
      selEl?.classList.add('lw-invalid');
      toast(`⚠️ "${sp.name}" đã có STT ${Math.round(cr.perfOrder)} — bấm QUAY lần nữa để GHI ĐÈ, hoặc chọn người khác`, 'error');
      return;
    }
    lwContestDupArm = null;
    selEl?.classList.remove('lw-invalid');
  }
  // BẮT ĐẦU lượt mới → giờ mới loại ô của lượt TRƯỚC (làm xám + bỏ khỏi vòng quay app/OBS).
  // Đồng bộ sang engine TRƯỚC khi quay để lượt mới không trúng lại ô đó và hình vòng quay khớp.
  if (lwPendingDrawn) {
    if (lwCfg.autoRemove) {
      const prev = lwCfg.segments.find(s => s.id === lwPendingDrawn);
      if (prev && !prev.drawn) {
        prev.drawn = true; // giờ mới BỎ khỏi vòng quay (app + OBS); vẫn xám trong danh sách
        renderLwSegList(); renderLwPreview(); await window.api.luckywheel.setConfig(lwCfg).catch(() => {});
      }
    }
    lwPendingDrawn = null;
  }
  if (!lwPool().length) { toast('Đã quay hết ô — bấm ♻️ Khôi phục để quay tiếp', 'error'); return; }
  const contestEpoch = lwContestEpoch;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang quay…'; }
  const spinner = lwGetSpinner();
  const r = await window.api.luckywheel.spin({ spinner }).catch(() => null);
  const secs = clampInt(lwCfg.spinSeconds, 5, 2, 15);
  if (r && typeof r.index === 'number') lwAnimatePreview(r.index, secs, r.landingOffset, r.edgeCatch);
  if (r && typeof r.spinCount === 'number') { lwCfg.spinCount = r.spinCount; lwUpdateCountInput(); }
  if (r && r.record) {
    lwCfg.history.unshift(r.record);
    if (lwCfg.history.length > 300) lwCfg.history.length = 300;
    const last = $('#lwLast'); if (last) { last.className = 'lw-last'; last.innerHTML = ''; }
    // Hé lộ kết quả + cập nhật lịch sử SAU khi vòng quay dừng (đồng bộ thời lượng)
    const rec = r.record;
    setTimeout(async () => {
      renderLwHistory();
      if (last) {
        const tag = rec.type === 'reward' ? '🎁 THƯỞNG' : rec.type === 'penalty' ? '⚡ PHẠT' : '✨ KẾT QUẢ';
        last.className = 'lw-last lw-result-card lw-rt-' + rec.type;
        last.innerHTML = `<div class="lw-rc-tag">${tag}</div>`
          + `<div class="lw-rc-text">${escAttr(rec.text)}</div>`
          + (rec.note ? `<div class="lw-rc-note">${escAttr(rec.note)}</div>` : '')
          + (rec.member ? `<div class="lw-rc-who">🎯 ${escAttr(rec.member)}</div>` : '');
      }
      // Ra kết quả → XÁM LIỀN trong danh sách + gắn tên/avatar người quay (won=true).
      // NHƯNG chưa loại khỏi vòng quay (chưa set drawn) → app + OBS vẫn còn ô đó tới lượt kế.
      if (lwCfg.autoRemove && rec.segId) {
        const seg = lwCfg.segments.find(s => s.id === rec.segId);
        if (seg) {
          seg.won = true;
          seg.wonBy = (spinner && spinner.name) || rec.member || '';
          seg.wonAvatar = (spinner && spinner.avatar) || '';
          // Creator ID chỉ mang nghĩa STT khi quay trong Chế độ thi đấu.
          seg.wonCreatorId = contest && spinner?.id ? spinner.id : '';
          lwPendingDrawn = rec.segId; // đánh dấu để LƯỢT KẾ loại khỏi vòng quay
          renderLwSegList(); renderLwPreview(); lwPush();
        }
      }
      // 🏆 Chế độ thi đấu: lọc SỐ từ ô trúng → gán STT thi đấu cho Creator đang chọn → OBS THI ĐẤU DỌC/NGANG.
      if (contest && spinner?.id && contestEpoch === lwContestEpoch && lwCfg.autoContest) {
        const order = lwContestOrderFromText(rec.text);
        const seg = lwCfg.segments.find(s => s.id === rec.segId);
        if (order && seg) {
          seg.wonCreatorId = spinner.id;
          lwAssignContestOrder(seg, spinner.id, order, rec.id);
          await lwPush();
          const synced = await lwSyncContestPerfOrders();
          if (synced?.ok) {
            lwContestAdvanceAfter(spinner.id); // tự nhảy sang người kế chưa có STT
            toast(`🏆 Gán STT ${order} cho ${spinner.name}`, 'success');
          } else toast('Không thể đồng bộ STT thi đấu', 'error');
        } else {
          toast(`⚠️ Ô "${rec.text}" không có số — không gán được STT thi đấu`, 'error');
        }
      }
    }, secs * 1000 + 150);
  }
  setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🎯 QUAY NGAY'; } }, secs * 1000 + 300);
}

// 🔄 Xoá toàn bộ STT thi đấu của mọi Creator (bắt đầu lượt thi mới). Dùng chung cho tab VÒNG QUAY + THI ĐẤU NHÓM.
async function lwClearPerfOrders() {
  const withOrder = creators.filter(c => Number(c.perfOrder) > 0);
  const hasAssignments = lwCfg.segments.some(s => Number(s.contestOrder) > 0);
  const count = Math.max(withOrder.length, hasAssignments ? 1 : 0);
  const ok = await window.api.shell.confirm({ message: count ? `Xoá toàn bộ Số thứ tự thi đấu (STT) của ${count} Creator để bắt đầu lượt thi mới?` : 'Xoá toàn bộ Số thứ tự thi đấu (STT) để bắt đầu lượt thi mới?', confirmText: 'Xoá STT', cancelText: 'Huỷ' }).catch(() => false);
  if (!ok) return false;
  lwInvalidateContestSpin();
  lwClearAllContestAssignments();
  lwCfg.contestAssignmentsInitialized = true;
  await lwPush();
  const synced = await lwSyncContestPerfOrders();
  if (!synced?.ok) { toast('Không thể xoá STT thi đấu', 'error'); return false; }
  lwContestDupArm = null;
  $('#lwSpinnerSel')?.classList.remove('lw-invalid');
  toast(count ? `Đã xoá STT thi đấu của ${count} Creator` : 'Đã xoá STT thi đấu', 'success');
  return true;
}

function lwCloseTools() { const p = $('#lwToolsPop'); if (p) p.hidden = true; }
function wireLuckyWheelTab() {
  $('#lwAddSeg')?.addEventListener('click', () => { lwCfg.segments.push(lwNewSeg()); renderLwSegList(); renderLwPreview(); lwScheduleSave(); });
  $('#lwShuffle')?.addEventListener('click', lwShuffleSegments);
  // Nút ⚙️ Công cụ: mở/đóng popup (Tạo dãy · Khôi phục · Xoá tất cả); bấm ra ngoài thì đóng.
  $('#lwToolsBtn')?.addEventListener('click', (e) => { e.stopPropagation(); const p = $('#lwToolsPop'); if (p) p.hidden = !p.hidden; });
  document.addEventListener('click', (e) => {
    const p = $('#lwToolsPop'); if (!p || p.hidden) return;
    const t = e.target;
    if (t instanceof Node && !p.contains(t) && t !== $('#lwToolsBtn') && !$('#lwToolsBtn')?.contains(t)) p.hidden = true;
  });
  $('#lwBatchGen')?.addEventListener('click', async () => {
    const n = clampInt($('#lwBatchQty')?.value, 10, 1, 200);
    if (lwCfg.segments.length) {
      const ok = await window.api.shell.confirm({ message: `Tạo dãy Số 1 → Số ${n} sẽ thay toàn bộ ${lwCfg.segments.length} ô hiện có?`, confirmText: 'Tạo dãy', cancelText: 'Huỷ' }).catch(() => false);
      if (!ok) return;
    }
    lwGenerateNumbers(n);
    lwCloseTools();
    toast(`Đã tạo dãy Số 1 → Số ${n}`, 'success');
  });
  $('#lwRestoreAll')?.addEventListener('click', async () => {
    const grayed = lwCfg.segments.filter(lwIsGrayed).length;
    const hasAssignments = lwCfg.segments.some(s => Number(s.contestOrder) > 0);
    const hasPerfOrders = creators.some(c => Number(c.perfOrder) > 0);
    if (!grayed && !hasAssignments && !hasPerfOrders) { toast('Không có ô xám nào', 'error'); return; }
    lwInvalidateContestSpin();
    lwPendingDrawn = null;
    lwCfg.segments.forEach(s => {
      s.won = false; s.drawn = false; s.wonBy = ''; s.wonAvatar = ''; s.wonCreatorId = '';
      lwClearContestAssignment(s);
    });
    lwCfg.contestAssignmentsInitialized = true;
    // Khôi phục = bắt đầu lượt mới → đưa số lượt đã quay về 0 cho đúng logic.
    lwCfg.spinCount = 0;
    renderLwSegList(); renderLwPreview(); renderLwHistory();
    await lwPush(); // đẩy lại đủ ô + spinCount=0 sang engine/OBS (setConfig gộp cả lwCfg)
    // setConfig KHÔNG xoá spin → OBS còn treo thẻ kết quả + chip người quay cũ. reset() dọn sạch realtime.
    await window.api.luckywheel.reset().catch(() => {});
    // Khôi phục = lượt thi mới → xoá luôn STT thi đấu để badge #STT trên OBS THI ĐẤU DỌC/NGANG biến mất.
    const synced = await lwSyncContestPerfOrders();
    lwContestDupArm = null; $('#lwSpinnerSel')?.classList.remove('lw-invalid');
    lwCloseTools();
    if (synced?.ok) toast(grayed ? `Đã khôi phục ${grayed} ô đã quay + xoá STT thi đấu` : 'Đã xoá STT thi đấu', 'success');
    else toast('Không thể đồng bộ STT thi đấu', 'error');
  });
  $('#lwClearAll')?.addEventListener('click', async () => {
    if (!lwCfg.segments.length) { toast('Danh sách đang trống', 'error'); return; }
    const ok = await window.api.shell.confirm({ message: `Xoá TẤT CẢ ${lwCfg.segments.length} ô khỏi danh sách?`, confirmText: 'Xoá tất cả', cancelText: 'Huỷ' }).catch(() => false);
    if (!ok) return;
    lwCfg.segments = [];
    renderLwSegList(); renderLwPreview(); lwPush();
    lwCloseTools();
    toast('Đã xoá tất cả ô', 'success');
  });
  $('#lwAutoRemove')?.addEventListener('change', () => { lwCfg.autoRemove = $('#lwAutoRemove').checked; lwScheduleSave(); });
  $('#lwAutoContest')?.addEventListener('change', async () => {
    const enabled = $('#lwAutoContest').checked;
    // Bật tay → cảnh báo gọn: tính năng dành cho TALENT SHOW, ô phải là SỐ (STT) không phải nội dung.
    if (enabled) {
      const ok = await window.api.shell.confirm({
        title: '🏆 Chế độ thi đấu',
        message: 'Tính năng dành cho TALENT SHOW — bạn chắc chắn dùng?',
        detail: 'Mỗi ô Vòng quay phải là 1 SỐ thứ tự (STT), không phải nội dung.',
        confirmText: 'Bật',
        cancelText: 'Huỷ',
      }).catch(() => false);
      if (!ok) { $('#lwAutoContest').checked = false; return; }
    }
    await lwApplyContest(enabled);
  });
  $('#lwClearPerf')?.addEventListener('click', lwClearPerfOrders);
  $('#lwPushDrawnTop')?.addEventListener('change', () => { lwCfg.pushDrawnTop = $('#lwPushDrawnTop').checked; renderLwSegList(); lwPush(); });
  $('#lwTitleInput')?.addEventListener('input', () => { lwCfg.title = $('#lwTitleInput').value; lwScheduleSave(); });
  $('#lwShowTitle')?.addEventListener('change', () => { lwCfg.showTitle = $('#lwShowTitle').checked; lwPush(); });
  $('#lwStyle')?.addEventListener('change', () => { lwCfg.style = $('#lwStyle').value; renderLwPreview(); lwScheduleSave(); });
  $('#lwFontScale')?.addEventListener('input', () => { lwCfg.fontScale = clampInt($('#lwFontScale').value, 100, 50, 200); if ($('#lwFontVal')) $('#lwFontVal').textContent = lwCfg.fontScale + '%'; renderLwPreview(); lwScheduleSave(); });
  $('#lwSeconds')?.addEventListener('input', () => { lwCfg.spinSeconds = clampInt($('#lwSeconds').value, 5, 2, 15); lwScheduleSave(); });
  $('#lwSlowSec')?.addEventListener('input', () => { lwCfg.slowSec = clampInt($('#lwSlowSec').value, 3, 0, 6); if ($('#lwSlowVal')) $('#lwSlowVal').textContent = lwCfg.slowSec + 's'; lwScheduleSave(); });
  $('#lwSound')?.addEventListener('change', () => { lwCfg.sound = $('#lwSound').checked; lwScheduleSave(); });
  $('#lwConfetti')?.addEventListener('change', () => { lwCfg.confetti = $('#lwConfetti').checked; lwScheduleSave(); });
  $('#lwShowResult')?.addEventListener('change', () => { lwCfg.showResult = $('#lwShowResult').checked; lwScheduleSave(); });
  $('#lwShowCount')?.addEventListener('change', () => { lwCfg.showCount = $('#lwShowCount').checked; lwScheduleSave(); });
  $('#lwEdgeStops')?.addEventListener('change', () => { lwCfg.edgeStops = $('#lwEdgeStops').checked; lwScheduleSave(); });
  $('#lwSpinnerSel')?.addEventListener('change', () => { if ($('#lwSpinnerSel').value && $('#lwSpinnerName')) $('#lwSpinnerName').value = ''; lwContestDupArm = null; $('#lwSpinnerSel')?.classList.remove('lw-invalid'); lwSyncSelectedSpinner(); });
  $('#lwSpinnerName')?.addEventListener('input', () => { if ($('#lwSpinnerName').value.trim() && $('#lwSpinnerSel')) $('#lwSpinnerSel').value = ''; lwSyncSelectedSpinner(); });
  $('#lwSpinCount')?.addEventListener('change', async () => {
    const n = Math.max(0, Math.round(Number($('#lwSpinCount').value) || 0));
    lwCfg.spinCount = n; await window.api.luckywheel.setCount(n).catch(() => {}); renderLwHistory();
  });
  $('#lwCountMinus')?.addEventListener('click', async () => {
    const n = Math.max(0, (lwCfg.spinCount || 0) - 1);
    lwCfg.spinCount = n; if ($('#lwSpinCount')) $('#lwSpinCount').value = n;
    await window.api.luckywheel.setCount(n).catch(() => {}); renderLwHistory();
  });
  $('#lwSpinBtn')?.addEventListener('click', lwDoSpin);
  document.addEventListener('keydown', (e) => {
    const active = document.querySelector('.panel[data-panel="luckywheel"]')?.classList.contains('active');
    const target = e.target;
    const editing = target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
    if (!active || editing || !e.ctrlKey || e.shiftKey || e.altKey || e.code !== 'Space') return;
    e.preventDefault();
    lwDoSpin();
  });
  $('#lwClearHist')?.addEventListener('click', async () => {
    if (!lwCfg.history.length) return;
    const ok = await window.api.shell.confirm({ message: 'Xoá toàn bộ lịch sử quay?', confirmText: 'Xoá', cancelText: 'Huỷ' }).catch(() => true);
    if (!ok) return;
    await window.api.luckywheel.clearHistory().catch(() => {});
    // Engine.clearHistory đưa spinCount về 0 → sync lwCfg để app khớp OBS (tránh app hiện số cũ).
    lwCfg.history = []; lwCfg.spinCount = 0; renderLwHistory();
  });
  $('#lwExport')?.addEventListener('click', async () => {
    const h = lwCfg.history || []; if (!h.length) { toast('Chưa có dữ liệu', 'error'); return; }
    await window.api.shell.copyText(lwBuildCsv()).catch(() => {});
    toast('Đã copy CSV lịch sử', 'success');
  });
  $('#lwDownload')?.addEventListener('click', async () => {
    const r = await window.api.luckywheel.export().catch(() => null);
    if (r?.ok) toast(`Đã tải ${r.count} lượt quay`, 'success');
    else if (r?.reason === 'empty') toast('Chưa có dữ liệu', 'error');
    else if (r?.reason !== 'canceled') toast('Không thể tải CSV', 'error');
  });
  $('#lwCopyUrl')?.addEventListener('click', async () => { const url = await window.api.luckywheel.getUrl(); await window.api.shell.copyText(url); toast('Đã copy link OBS Vòng quay', 'success'); });

  // Đồng bộ input với config đã tải
  if ($('#lwTitleInput')) $('#lwTitleInput').value = lwCfg.title;
  if ($('#lwShowTitle')) $('#lwShowTitle').checked = lwCfg.showTitle;
  if ($('#lwStyle')) $('#lwStyle').value = lwCfg.style;
  if ($('#lwFontScale')) $('#lwFontScale').value = lwCfg.fontScale;
  if ($('#lwFontVal')) $('#lwFontVal').textContent = (lwCfg.fontScale || 100) + '%';
  if ($('#lwSeconds')) $('#lwSeconds').value = lwCfg.spinSeconds;
  if ($('#lwSlowSec')) $('#lwSlowSec').value = lwCfg.slowSec;
  if ($('#lwSlowVal')) $('#lwSlowVal').textContent = (lwCfg.slowSec != null ? lwCfg.slowSec : 3) + 's';
  if ($('#lwSound')) $('#lwSound').checked = lwCfg.sound;
  if ($('#lwConfetti')) $('#lwConfetti').checked = lwCfg.confetti;
  if ($('#lwShowResult')) $('#lwShowResult').checked = lwCfg.showResult;
  if ($('#lwShowCount')) $('#lwShowCount').checked = lwCfg.showCount;
  if ($('#lwEdgeStops')) $('#lwEdgeStops').checked = lwCfg.edgeStops;
  if ($('#lwAutoRemove')) $('#lwAutoRemove').checked = lwCfg.autoRemove;
  if ($('#lwAutoContest')) $('#lwAutoContest').checked = lwCfg.autoContest;
  if ($('#lwPushDrawnTop')) $('#lwPushDrawnTop').checked = lwCfg.pushDrawnTop;
  if ($('#lwSpinCount')) $('#lwSpinCount').value = lwCfg.spinCount || 0;
  lwRefreshSpinners();
  if ($('#lwSpinnerName') && !lwCfg.selectedSpinner?.id) $('#lwSpinnerName').value = lwCfg.selectedSpinner?.name || '';
  renderLwSegList();
  renderLwPreview();
  renderLwHistory();
}

// ===================== NHIỆM VỤ · BỘ BA (3 KPI, 2 overlay Dọc/Ngang) =====================
const MT_KPIS = ['donors', 'likes', 'points'];
const MT_KPI_LABEL = { donors: 'Người tặng', likes: 'Số tim', points: 'Số điểm' };
const MT_GEO_V = { boxWidth: 300, gap: 14, titleFontSize: 30, valueFontSize: 35, overlayScale: 200 };
const MT_GEO_H = { boxWidth: 180, gap: 150, titleFontSize: 25, valueFontSize: 20, overlayScale: 200 };
let mtCfg = null;
let mtEditLayout = 'vertical';   // bố cục đang chỉnh/xem trước (không lưu vào config)
let mtValues = { donors: 0, likes: 0, points: 0 };
let mtRunning = false;

function mtDefaultCfg() {
  return {
    barColor1: '#ff2f87', barColor2: '#ff8ed1', borderAlpha: 0.55,
    order: ['donors', 'likes', 'points'],
    items: {
      donors: { enabled: true, label: MT_KPI_LABEL.donors, target: 100 },
      likes: { enabled: true, label: MT_KPI_LABEL.likes, target: 50000 },
      points: { enabled: true, label: MT_KPI_LABEL.points, target: 100000 },
    },
    vertical: { ...MT_GEO_V },
    horizontal: { ...MT_GEO_H },
  };
}
function mtNumOr(v, dv) { return Number.isFinite(+v) ? +v : dv; }
function mtNormalizeGeo(g, d) {
  g = g || {};
  return {
    boxWidth: mtNumOr(g.boxWidth, d.boxWidth), gap: mtNumOr(g.gap, d.gap),
    titleFontSize: mtNumOr(g.titleFontSize, d.titleFontSize),
    valueFontSize: mtNumOr(g.valueFontSize, d.valueFontSize),
    overlayScale: mtNumOr(g.overlayScale, d.overlayScale),
  };
}
function mtNormalize(c) {
  c = c || {};
  const d = mtDefaultCfg();
  const items = {};
  for (const k of MT_KPIS) items[k] = { ...d.items[k], ...(c.items && c.items[k]) };
  let order = Array.isArray(c.order) ? c.order.filter(k => items[k]) : d.order.slice();
  for (const k of d.order) if (!order.includes(k)) order.push(k);
  return {
    barColor1: c.barColor1 || d.barColor1, barColor2: c.barColor2 || d.barColor2,
    borderAlpha: mtNumOr(c.borderAlpha, d.borderAlpha),
    order, items,
    vertical: mtNormalizeGeo(c.vertical, MT_GEO_V),
    horizontal: mtNormalizeGeo(c.horizontal, MT_GEO_H),
  };
}
function mtGeo() { return mtCfg[mtEditLayout]; }
function mtFmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
function mtParseInt(s) { return Math.max(0, parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0); }
function mtFillGradient(c1, c2) {
  return `linear-gradient(90deg, color-mix(in srgb, ${c2}, transparent 84%) 0%, color-mix(in srgb, ${c2}, transparent 42%) 26%, ${c2} 56%, ${c1} 100%)`;
}

async function loadMissionTrioConfig() {
  const st = await window.api.missiontrio.getState().catch(() => null);
  mtCfg = mtNormalize(st || {});
  if (st) { mtValues = st.values || mtValues; mtRunning = !!st.running; }
  mtFillForm(); mtRenderKpiList(); mtRenderPreview(); mtUpdateRunUI();
}
function mtPushLive() { if (mtCfg) window.api.missiontrio.setConfig(mtCfg).catch(() => {}); }
const _mtSaver = makeAutoSaver(() => mtPushLive());
function mtScheduleSave() { _mtSaver.schedule(mtRenderPreview); }

function mtFillForm() {
  if (!mtCfg) return;
  const g = mtGeo();
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v; };
  set('mtLayout', mtEditLayout);
  set('mtBoxWidth', g.boxWidth); set('mtGap', g.gap);
  set('mtTitleSize', g.titleFontSize); set('mtValueSize', g.valueFontSize);
  set('mtColor1', mtCfg.barColor1); set('mtColor2', mtCfg.barColor2); set('mtScale', g.overlayScale);
  if ($('#mtScaleVal')) $('#mtScaleVal').textContent = `${g.overlayScale}%`;
  const ba = Math.round((mtCfg.borderAlpha ?? 0.55) * 100);
  set('mtBorderAlpha', ba);
  if ($('#mtBorderAlphaVal')) $('#mtBorderAlphaVal').textContent = `${ba}%`;
}

function mtRenderKpiList() {
  const box = $('#mtKpiList');
  if (!box || !mtCfg) return;
  box.innerHTML = mtCfg.order.map((k, idx) => {
    const it = mtCfg.items[k] || {};
    return `<div class="mt-kpi-row" data-k="${k}">
      <label class="mt-kpi-en"><input type="checkbox" class="mt-en" ${it.enabled !== false ? 'checked' : ''} /></label>
      <input class="mt-label" type="text" value="${escapeHtml(it.label || '')}" placeholder="Tên hiển thị" />
      <input class="mt-target" type="text" inputmode="numeric" value="${mtFmt(it.target)}" />
      <div class="mt-kpi-move">
        <button type="button" class="ghost tiny mt-up" title="Lên"${idx === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" class="ghost tiny mt-down" title="Xuống"${idx === mtCfg.order.length - 1 ? ' disabled' : ''}>▼</button>
      </div>
    </div>`;
  }).join('');
}

// Preview trong app LUÔN NẰM NGANG + gọn (OBS mới hiển thị theo bố cục riêng). Kích thước cố định
// cho gọn, chỉ phản ánh số liệu + màu + độ mờ viền + báo hiệu hoàn thành (không theo geo OBS).
function mtRenderPreview() {
  const box = $('#mtPreview');
  if (!box || !mtCfg) return;
  const grad = mtFillGradient(mtCfg.barColor1, mtCfg.barColor2);
  const shown = mtCfg.order.filter(k => mtCfg.items[k] && mtCfg.items[k].enabled !== false);
  const allDone = shown.length > 0 && shown.every(k => (Number(mtValues[k]) || 0) >= Math.max(1, Number(mtCfg.items[k].target) || 1));
  const rows = shown.map(k => {
    const it = mtCfg.items[k];
    const target = Math.max(1, Number(it.target) || 1);
    const val = Math.max(0, Number(mtValues[k]) || 0);
    const pct = Math.max(0, Math.min(100, (val / target) * 100));
    return `<div class="mtp-item${val >= target ? ' mtp-done' : ''}">
      <div class="mtp-title">${escapeHtml(it.label || MT_KPI_LABEL[k])}</div>
      <div class="mtp-bar" style="--mt-run:${mtCfg.barColor1}">
        <div class="mtp-fill" style="width:${pct}%;background:${grad}"></div>
        <div class="mtp-val"><b>${mtFmt(val)}</b><span>/${mtFmt(target)}</span></div>
      </div>
    </div>`;
  }).join('');
  box.className = `mt-preview mt-h${allDone ? ' mt-all-done' : ''}`;
  const clk = (p) => `${(-(Date.now() % p) / 1000).toFixed(3)}s`;
  box.style.setProperty('--mt-border-alpha', String(mtCfg.borderAlpha ?? 0.55));
  box.style.setProperty('--mt-clock', clk(900));
  box.style.setProperty('--mt-run-clock', clk(1400));
  box.style.setProperty('--mt-flow-clock', clk(1000));
  box.innerHTML = rows || '<span class="muted">Chưa bật KPI nào</span>';
}

function mtUpdateRunUI() {
  const el = $('#mtRunState');
  if (el) { el.textContent = mtRunning ? '● Đang chạy' : '● Đang dừng'; el.classList.toggle('on', mtRunning); }
  if ($('#mtStart')) $('#mtStart').textContent = mtRunning ? '▶ CHẠY LẠI' : '▶ BẮT ĐẦU';
}

function mtOnShow() { mtRenderPreview(); }

function wireMissionTrioTab() {
  // Thông số hình học ghi vào ĐÚNG bố cục đang chỉnh (mtCfg[mtEditLayout]).
  const num = (id, key, min, max) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('input', () => {
      let v = parseInt(el.value, 10); if (!Number.isFinite(v)) return;
      if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v);
      mtGeo()[key] = v; mtScheduleSave();
    });
  };
  num('mtBoxWidth', 'boxWidth', 120, 900);
  num('mtGap', 'gap', 0, 400);
  num('mtTitleSize', 'titleFontSize', 10, 60);
  num('mtValueSize', 'valueFontSize', 10, 60);
  // Đổi "Bố cục đang chỉnh" → chỉ nạp lại form theo loại đó, KHÔNG lưu (không đổi config).
  $('#mtLayout')?.addEventListener('change', () => {
    mtEditLayout = $('#mtLayout').value === 'horizontal' ? 'horizontal' : 'vertical';
    mtFillForm(); mtRenderPreview();
  });
  $('#mtColor1')?.addEventListener('input', () => { mtCfg.barColor1 = $('#mtColor1').value; mtScheduleSave(); });
  $('#mtColor2')?.addEventListener('input', () => { mtCfg.barColor2 = $('#mtColor2').value; mtScheduleSave(); });
  $('#mtBorderAlpha')?.addEventListener('input', () => { const p = Math.max(5, Math.min(100, parseInt($('#mtBorderAlpha').value, 10) || 55)); mtCfg.borderAlpha = p / 100; if ($('#mtBorderAlphaVal')) $('#mtBorderAlphaVal').textContent = `${p}%`; mtScheduleSave(); });
  $('#mtScale')?.addEventListener('input', () => { mtGeo().overlayScale = parseInt($('#mtScale').value, 10) || 100; if ($('#mtScaleVal')) $('#mtScaleVal').textContent = `${mtGeo().overlayScale}%`; mtScheduleSave(); });

  $('#mtKpiList')?.addEventListener('input', (e) => {
    const row = e.target.closest('.mt-kpi-row'); if (!row) return;
    const k = row.dataset.k; const it = mtCfg.items[k]; if (!it) return;
    if (e.target.classList.contains('mt-en')) it.enabled = e.target.checked;
    else if (e.target.classList.contains('mt-label')) it.label = e.target.value;
    else if (e.target.classList.contains('mt-target')) it.target = Math.max(1, mtParseInt(e.target.value) || 1);
    mtScheduleSave();
  });
  $('#mtKpiList')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('mt-target')) { const k = e.target.closest('.mt-kpi-row')?.dataset.k; if (k) e.target.value = mtFmt(mtCfg.items[k].target); }
  });
  $('#mtKpiList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const row = e.target.closest('.mt-kpi-row'); if (!row) return;
    const i = mtCfg.order.indexOf(row.dataset.k);
    if (btn.classList.contains('mt-up') && i > 0) { [mtCfg.order[i - 1], mtCfg.order[i]] = [mtCfg.order[i], mtCfg.order[i - 1]]; }
    else if (btn.classList.contains('mt-down') && i < mtCfg.order.length - 1) { [mtCfg.order[i + 1], mtCfg.order[i]] = [mtCfg.order[i], mtCfg.order[i + 1]]; }
    else return;
    mtRenderKpiList(); mtScheduleSave();
  });

  $('#mtStart')?.addEventListener('click', async () => {
    if (!requireLive('BẮT ĐẦU NHIỆM VỤ · BỘ BA')) return;
    await window.api.missiontrio.start();
    mtRunning = true; mtValues = { donors: 0, likes: 0, points: 0 };
    mtRenderPreview(); mtUpdateRunUI();
    toast('NHIỆM VỤ · BỘ BA: bắt đầu đếm từ 0', 'success');
  });
  $('#mtReset')?.addEventListener('click', async () => {
    await window.api.missiontrio.reset();
    mtRunning = false; mtValues = { donors: 0, likes: 0, points: 0 };
    mtRenderPreview(); mtUpdateRunUI();
    toast('Đã reset NHIỆM VỤ · BỘ BA', '');
  });
  const copy = async (mode, name) => {
    const url = await window.api.missiontrio.getUrl(mode);
    await window.api.shell.copyText(url);
    toast(`Đã copy link OBS BỘ BA · ${name}`, 'success');
  };
  $('#mtCopyV')?.addEventListener('click', () => copy('vertical', 'Dọc'));
  $('#mtCopyH')?.addEventListener('click', () => copy('horizontal', 'Ngang'));
  $$('.mt-test [data-bump]').forEach(btn => btn.addEventListener('click', async () => {
    const amt = Math.max(1, parseInt($('#mtTestAmt')?.value, 10) || 1);
    await window.api.missiontrio.bump(btn.dataset.bump, amt);
  }));

  window.api.on('missiontrio:state', (st) => {
    if (!st) return;
    if (st.values) mtValues = st.values;
    mtRunning = !!st.running;
    mtRenderPreview(); mtUpdateRunUI();
  });
}

// ===================== THẺ BÀI (táp tim để lật thẻ) =====================
let cfCfg = null;
let cfHearts = 0;
let cfRunning = false;

function cfDefaultCfg() {
  return {
    title: 'Thẻ bài', heartTarget: 1000, cardStyle: 'gold', cardSize: 156, fontSize: 20, cardTextSize: 30,
    bgColor: '#000000', bgAlpha: 0.80, titleColor: '#ffd94a', barColor: '#ff2f87',
    barTextColor: '#ffffff', runningColor: '#ff5a5a', doneColor: '#38e08a', edges: true, scale: 100,
    fx: true, spinMs: 3000, fxStyle: 'random', sound: true, soundVolume: 70, particles: true,
    cards: [],
  };
}
const CF_FX_STYLES = ['ring', 'fan', 'stack', 'fly', 'wave', 'tunnel', 'helix', 'spiral'];
// 'random' = CHẾ ĐỘ: mỗi lần bấm Lật thẻ, overlay tự bốc 1 kiểu ngẫu nhiên (không lặp). Xử lý ở overlay.
function cfValidStyle(v) { return CF_FX_STYLES.includes(v) || v === 'random'; }
function cfFmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('vi-VN'); }
function cfParseInt(s) { return Math.max(0, parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0); }
function cfRgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return `rgba(11,11,15,${a})`;
  const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function cfNormalize(c) {
  const d = cfDefaultCfg(); c = c || {};
  const cards = Array.isArray(c.cards) ? c.cards.map(x => ({
    id: x && x.id ? String(x.id) : `c${Math.random().toString(36).slice(2, 8)}`,
    text: String((x && x.text) || ''), flipped: !!(x && x.flipped), selected: !!(x && x.selected),
    flipAt: Number(x && x.flipAt) || 0,
  })) : d.cards;
  return {
    title: c.title != null ? String(c.title) : d.title,
    heartTarget: Number.isFinite(+c.heartTarget) ? +c.heartTarget : d.heartTarget,
    cardStyle: c.cardStyle === 'pink' ? 'pink' : 'gold',
    cardSize: Number.isFinite(+c.cardSize) ? +c.cardSize : d.cardSize,
    fontSize: Number.isFinite(+c.fontSize) ? +c.fontSize : d.fontSize,
    cardTextSize: Number.isFinite(+c.cardTextSize) ? Math.max(8, Math.min(90, +c.cardTextSize)) : d.cardTextSize,
    bgColor: /^#[0-9a-f]{6}$/i.test(c.bgColor) ? c.bgColor : d.bgColor,
    bgAlpha: Number.isFinite(+c.bgAlpha) ? Math.max(0, Math.min(1, +c.bgAlpha)) : d.bgAlpha,
    titleColor: /^#[0-9a-f]{6}$/i.test(c.titleColor) ? c.titleColor : d.titleColor,
    barColor: /^#[0-9a-f]{6}$/i.test(c.barColor) ? c.barColor : d.barColor,
    barTextColor: /^#[0-9a-f]{6}$/i.test(c.barTextColor) ? c.barTextColor : d.barTextColor,
    runningColor: /^#[0-9a-f]{6}$/i.test(c.runningColor) ? c.runningColor : d.runningColor,
    doneColor: /^#[0-9a-f]{6}$/i.test(c.doneColor) ? c.doneColor : d.doneColor,
    edges: c.edges != null ? !!c.edges : d.edges,
    scale: Number.isFinite(+c.scale) ? +c.scale : d.scale,
    fx: c.fx != null ? !!c.fx : d.fx,
    spinMs: Number.isFinite(+c.spinMs) ? Math.max(800, Math.min(8000, +c.spinMs)) : d.spinMs,
    fxStyle: cfValidStyle(c.fxStyle) ? c.fxStyle : d.fxStyle,
    sound: c.sound != null ? !!c.sound : d.sound,
    soundVolume: Number.isFinite(+c.soundVolume) ? Math.max(0, Math.min(100, +c.soundVolume)) : d.soundVolume,
    particles: c.particles != null ? !!c.particles : d.particles,
    cards,
  };
}

async function loadCardFlipConfig() {
  const st = await window.api.cardflip.getState().catch(() => null);
  cfCfg = cfNormalize(st || {});
  if (cfCfg.cards.length === 0) cfCfg.cards = [cfNewCard('A'), cfNewCard('B'), cfNewCard('C')];
  if (st) { cfHearts = Number(st.hearts) || 0; cfRunning = !!st.running; }
  cfFillForm(); cfRenderCardList(); cfRenderPreview(); cfUpdateRunUI();
}
function cfNewCard(text = '') { return { id: `c${Math.random().toString(36).slice(2, 8)}`, text: String(text), flipped: false, selected: false, flipAt: 0 }; }
function cfPushLive() { if (cfCfg) window.api.cardflip.setConfig(cfCfg).catch(() => {}); }
const _cfSaver = makeAutoSaver(() => cfPushLive());
function cfScheduleSave() { _cfSaver.schedule(cfRenderPreview); }

function cfFillForm() {
  if (!cfCfg) return;
  const set = (id, v) => { const el = $('#' + id); if (el != null && el) el.value = v; };
  set('cfTitleInput', cfCfg.title);
  set('cfTarget', cfFmt(cfCfg.heartTarget));
  set('cfHearts', cfFmt(cfHearts));
  set('cfStyle', cfCfg.cardStyle);
  set('cfBgColor', cfCfg.bgColor);
  set('cfTitleColor', cfCfg.titleColor);
  set('cfBarColor', cfCfg.barColor);
  set('cfBarText', cfCfg.barTextColor);
  set('cfRunningColor', cfCfg.runningColor);
  set('cfDoneColor', cfCfg.doneColor);
  const bgA = Math.round(cfCfg.bgAlpha * 100);
  set('cfBgAlpha', bgA); if ($('#cfBgAlphaVal')) $('#cfBgAlphaVal').textContent = `${bgA}%`;
  set('cfCardSize', cfCfg.cardSize); if ($('#cfCardSizeVal')) $('#cfCardSizeVal').textContent = `${cfCfg.cardSize}px`;
  set('cfFontSize', cfCfg.fontSize); if ($('#cfFontSizeVal')) $('#cfFontSizeVal').textContent = `${cfCfg.fontSize}px`;
  set('cfCardText', cfCfg.cardTextSize); if ($('#cfCardTextVal')) $('#cfCardTextVal').textContent = `${cfCfg.cardTextSize}px`;
  set('cfScale', cfCfg.scale); if ($('#cfScaleVal')) $('#cfScaleVal').textContent = `${cfCfg.scale}%`;
  if ($('#cfEdges')) $('#cfEdges').checked = cfCfg.edges;
  if ($('#cfFx')) $('#cfFx').checked = cfCfg.fx;
  set('cfSpinMs', cfCfg.spinMs); if ($('#cfSpinMsVal')) $('#cfSpinMsVal').textContent = `${(cfCfg.spinMs / 1000).toFixed(1)}s`;
  set('cfFxStyle', cfCfg.fxStyle);
  if ($('#cfSound')) $('#cfSound').checked = cfCfg.sound;
  set('cfSoundVol', cfCfg.soundVolume); if ($('#cfSoundVolVal')) $('#cfSoundVolVal').textContent = `${cfCfg.soundVolume}%`;
  if ($('#cfParticles')) $('#cfParticles').checked = cfCfg.particles;
}

function cfRenderCardList() {
  const box = $('#cfCardList'); if (!box || !cfCfg) return;
  box.innerHTML = cfCfg.cards.map((c, i) => `
    <div class="cf-card-row" data-id="${c.id}">
      <span class="cf-drag" draggable="true" title="Kéo để đổi thứ tự">⠿</span>
      <textarea class="cf-card-text" rows="2" placeholder="Nội dung thẻ ${i + 1}">${escapeHtml(c.text)}</textarea>
      <div class="cf-row-toggles">
        <label class="cf-switch"><input type="checkbox" class="cf-flip" ${c.flipped ? 'checked' : ''} /><span class="cf-switch-ui"></span><em>Lật thẻ</em></label>
        <label class="cf-switch"><input type="checkbox" class="cf-select" ${c.selected ? 'checked' : ''} /><span class="cf-switch-ui"></span><em>Chọn thẻ</em></label>
      </div>
      <button type="button" class="cf-del" title="Xoá thẻ">🗑</button>
    </div>`).join('');
}

// Preview trong app: thu nhỏ, dùng ẢNH THẬT (đường dẫn tương đối trong renderer/). Bấm thẻ để lật thử.
function cfRenderPreview() {
  const box = $('#cfPreview'); if (!box || !cfCfg) return;
  const style = cfCfg.cardStyle;
  const target = Math.max(0, cfCfg.heartTarget);
  const done = cfHearts >= target;
  const pct = target > 0 ? Math.max(0, Math.min(100, (cfHearts / target) * 100)) : (done ? 100 : 0);
  box.style.setProperty('--cf-bg', cfRgba(cfCfg.bgColor, cfCfg.bgAlpha));
  box.style.setProperty('--cf-title', cfCfg.titleColor);
  box.style.setProperty('--cf-bar', cfCfg.barColor);
  box.style.setProperty('--cf-bartext', cfCfg.barTextColor);
  box.style.setProperty('--cf-running', cfCfg.runningColor);
  box.style.setProperty('--cf-done', cfCfg.doneColor);
  box.classList.toggle('cf-done', done);
  const cards = cfCfg.cards.map(c => `
    <div class="cfp-card ${c.flipped ? 'cfp-flipped' : ''} ${c.selected && !c.flipped ? 'cfp-selected' : ''}" data-id="${c.id}">
      <div class="cfp-face cfp-back" style="background-image:url('card-assets/${style}/back.png')"></div>
      <div class="cfp-face cfp-front" style="background-image:url('card-assets/${style}/front.png')"><span>${escapeHtml(c.text)}</span></div>
    </div>`).join('') || '<span class="muted">Chưa có thẻ nào</span>';
  box.innerHTML = `
    <div class="cfp-info">
      <div class="cfp-title">${escapeHtml(cfCfg.title || 'Thẻ bài')}</div>
      <div class="cfp-bar"><div class="cfp-fill" style="width:${pct}%"></div><div class="cfp-num">${cfFmt(cfHearts)} / ${cfFmt(target)}</div></div>
      <div class="cfp-status">${done ? 'THÀNH CÔNG' : 'ĐANG THỰC HIỆN'}</div>
    </div>
    <div class="cfp-sep"></div>
    <div class="cfp-deck">${cards}</div>`;
}

function cfUpdateRunUI() {
  const el = $('#cfRunState');
  if (el) { el.textContent = cfRunning ? '● Đang đếm tim' : '● Đang dừng'; el.classList.toggle('on', cfRunning); }
  if ($('#cfStart')) $('#cfStart').textContent = cfRunning ? '▶ Đếm lại từ 0' : '▶ Bắt đầu đếm tim';
}

function cfOnShow() { cfRenderPreview(); }

function wireCardFlipTab() {
  const onText = (id, apply) => { const el = $('#' + id); if (el) el.addEventListener('input', () => { apply(el.value); cfScheduleSave(); }); };
  const onColor = (id, key) => { const el = $('#' + id); if (el) el.addEventListener('input', () => { cfCfg[key] = el.value; cfScheduleSave(); }); };

  onText('cfTitleInput', v => cfCfg.title = v.slice(0, 80));
  $('#cfTarget')?.addEventListener('input', () => { cfCfg.heartTarget = cfParseInt($('#cfTarget').value); cfScheduleSave(); });
  $('#cfTarget')?.addEventListener('change', () => { $('#cfTarget').value = cfFmt(cfCfg.heartTarget); });
  // "Tim hiện tại" là số RUNTIME → đặt trực tiếp vào engine (không lưu vào config).
  $('#cfHearts')?.addEventListener('input', () => { cfHearts = cfParseInt($('#cfHearts').value); window.api.cardflip.setHearts(cfHearts); cfRenderPreview(); });
  $('#cfHearts')?.addEventListener('change', () => { $('#cfHearts').value = cfFmt(cfHearts); });

  $('#cfStyle')?.addEventListener('change', () => { cfCfg.cardStyle = $('#cfStyle').value === 'pink' ? 'pink' : 'gold'; cfScheduleSave(); });
  onColor('cfBgColor', 'bgColor'); onColor('cfTitleColor', 'titleColor'); onColor('cfBarColor', 'barColor');
  onColor('cfBarText', 'barTextColor'); onColor('cfRunningColor', 'runningColor'); onColor('cfDoneColor', 'doneColor');
  $('#cfBgAlpha')?.addEventListener('input', () => { const p = parseInt($('#cfBgAlpha').value, 10) || 0; cfCfg.bgAlpha = p / 100; if ($('#cfBgAlphaVal')) $('#cfBgAlphaVal').textContent = `${p}%`; cfScheduleSave(); });
  $('#cfCardSize')?.addEventListener('input', () => { cfCfg.cardSize = parseInt($('#cfCardSize').value, 10) || 128; if ($('#cfCardSizeVal')) $('#cfCardSizeVal').textContent = `${cfCfg.cardSize}px`; cfScheduleSave(); });
  $('#cfFontSize')?.addEventListener('input', () => { cfCfg.fontSize = parseInt($('#cfFontSize').value, 10) || 16; if ($('#cfFontSizeVal')) $('#cfFontSizeVal').textContent = `${cfCfg.fontSize}px`; cfScheduleSave(); });
  $('#cfCardText')?.addEventListener('input', () => { cfCfg.cardTextSize = parseInt($('#cfCardText').value, 10) || 18; if ($('#cfCardTextVal')) $('#cfCardTextVal').textContent = `${cfCfg.cardTextSize}px`; cfScheduleSave(); });
  $('#cfScale')?.addEventListener('input', () => { cfCfg.scale = parseInt($('#cfScale').value, 10) || 100; if ($('#cfScaleVal')) $('#cfScaleVal').textContent = `${cfCfg.scale}%`; cfScheduleSave(); });
  $('#cfEdges')?.addEventListener('change', () => { cfCfg.edges = $('#cfEdges').checked; cfScheduleSave(); });
  $('#cfFx')?.addEventListener('change', () => { cfCfg.fx = $('#cfFx').checked; cfScheduleSave(); });
  $('#cfSpinMs')?.addEventListener('input', () => { cfCfg.spinMs = parseInt($('#cfSpinMs').value, 10) || 3000; if ($('#cfSpinMsVal')) $('#cfSpinMsVal').textContent = `${(cfCfg.spinMs / 1000).toFixed(1)}s`; cfScheduleSave(); });
  $('#cfFxStyle')?.addEventListener('change', () => { const v = $('#cfFxStyle').value; cfCfg.fxStyle = cfValidStyle(v) ? v : 'ring'; cfScheduleSave(); });
  $('#cfSound')?.addEventListener('change', () => { cfCfg.sound = $('#cfSound').checked; cfScheduleSave(); });
  $('#cfSoundVol')?.addEventListener('input', () => { cfCfg.soundVolume = parseInt($('#cfSoundVol').value, 10) || 0; if ($('#cfSoundVolVal')) $('#cfSoundVolVal').textContent = `${cfCfg.soundVolume}%`; cfScheduleSave(); });
  $('#cfParticles')?.addEventListener('change', () => { cfCfg.particles = $('#cfParticles').checked; cfScheduleSave(); });

  $('#cfStart')?.addEventListener('click', async () => {
    if (!requireLive('BẮT ĐẦU đếm tim THẺ BÀI')) return;
    await window.api.cardflip.startHearts();
    cfRunning = true; cfHearts = 0; if ($('#cfHearts')) $('#cfHearts').value = '0';
    cfRenderPreview(); cfUpdateRunUI();
    toast('THẺ BÀI: bắt đầu đếm tim từ 0', 'success');
  });
  $('#cfResetHearts')?.addEventListener('click', async () => {
    await window.api.cardflip.resetHearts();
    cfRunning = false; cfHearts = 0; if ($('#cfHearts')) $('#cfHearts').value = '0';
    cfRenderPreview(); cfUpdateRunUI();
    toast('Đã đặt lại tim', '');
  });
  $('#cfAddCard')?.addEventListener('click', () => {
    cfCfg.cards.push(cfNewCard('Nội dung'));
    cfRenderCardList(); cfScheduleSave();
  });
  $('#cfShuffle')?.addEventListener('click', () => {
    for (let i = cfCfg.cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cfCfg.cards[i], cfCfg.cards[j]] = [cfCfg.cards[j], cfCfg.cards[i]]; }
    cfRenderCardList(); cfScheduleSave();
    toast('Đã xáo trộn thẻ', '');
  });

  // Sự kiện trong danh sách thẻ (text / lật / chọn / xoá).
  const list = $('#cfCardList');
  list?.addEventListener('input', (e) => {
    const row = e.target.closest('.cf-card-row'); if (!row) return;
    const c = cfCfg.cards.find(x => x.id === row.dataset.id); if (!c) return;
    if (e.target.classList.contains('cf-card-text')) { c.text = e.target.value; cfScheduleSave(); }
  });
  list?.addEventListener('change', (e) => {
    const row = e.target.closest('.cf-card-row'); if (!row) return;
    const c = cfCfg.cards.find(x => x.id === row.dataset.id); if (!c) return;
    if (e.target.classList.contains('cf-flip')) { c.flipped = e.target.checked; window.api.cardflip.flip(c.id, c.flipped); cfRenderPreview(); }
    else if (e.target.classList.contains('cf-select')) { c.selected = e.target.checked; window.api.cardflip.select(c.id, c.selected); cfRenderPreview(); }
  });
  list?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cf-del'); if (!btn) return;
    const row = e.target.closest('.cf-card-row'); if (!row) return;
    cfCfg.cards = cfCfg.cards.filter(x => x.id !== row.dataset.id);
    cfRenderCardList(); cfScheduleSave();
  });
  // Kéo-thả đổi thứ tự (dùng tay nắm ⠿).
  let dragId = null;
  list?.addEventListener('dragstart', (e) => { const h = e.target.closest('.cf-drag'); if (!h) { e.preventDefault(); return; } dragId = h.closest('.cf-card-row')?.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
  list?.addEventListener('dragover', (e) => { e.preventDefault(); const row = e.target.closest('.cf-card-row'); $$('.cf-card-row').forEach(r => r.classList.toggle('cf-drop-hint', r === row)); });
  list?.addEventListener('drop', (e) => {
    e.preventDefault(); $$('.cf-card-row').forEach(r => r.classList.remove('cf-drop-hint'));
    const row = e.target.closest('.cf-card-row'); if (!row || !dragId) return;
    const from = cfCfg.cards.findIndex(x => x.id === dragId); const to = cfCfg.cards.findIndex(x => x.id === row.dataset.id);
    if (from < 0 || to < 0 || from === to) return;
    const [m] = cfCfg.cards.splice(from, 1); cfCfg.cards.splice(to, 0, m);
    dragId = null; cfRenderCardList(); cfScheduleSave();
  });
  list?.addEventListener('dragend', () => { dragId = null; $$('.cf-card-row').forEach(r => r.classList.remove('cf-drop-hint')); });

  // Bấm thẻ trong PREVIEW để lật thử.
  $('#cfPreview')?.addEventListener('click', (e) => {
    const card = e.target.closest('.cfp-card'); if (!card) return;
    const c = cfCfg.cards.find(x => x.id === card.dataset.id); if (!c) return;
    c.flipped = !c.flipped; window.api.cardflip.flip(c.id, c.flipped);
    cfRenderCardList(); cfRenderPreview();
  });

  $('#cfCopy')?.addEventListener('click', async () => {
    const url = await window.api.cardflip.getUrl();
    await window.api.shell.copyText(url);
    toast('Đã copy link OBS THẺ BÀI (thanh ngang)', 'success');
  });
  $('#cfCopyFx')?.addEventListener('click', async () => {
    const url = await window.api.cardflip.getFxUrl();
    await window.api.shell.copyText(url);
    toast('Đã copy link OBS THẺ BÀI · Lật 3D', 'success');
  });

  // State từ engine (kể cả khi lật bằng cách BẤM trên overlay/OBS) → đồng bộ runtime, không phá thao tác đang gõ.
  window.api.on('cardflip:state', (st) => {
    if (!st || !cfCfg) return;
    cfHearts = Number(st.hearts) || 0; cfRunning = !!st.running;
    const inHearts = document.activeElement === $('#cfHearts');
    if (!inHearts && $('#cfHearts')) $('#cfHearts').value = cfFmt(cfHearts);
    const ids = (st.cards || []).map(c => c.id).join(',');
    const curIds = cfCfg.cards.map(c => c.id).join(',');
    if (ids === curIds) {
      // Cùng bộ thẻ → chỉ cập nhật lật/chọn (không đụng text đang gõ).
      const editing = document.activeElement && document.activeElement.classList?.contains('cf-card-text');
      (st.cards || []).forEach(sc => { const c = cfCfg.cards.find(x => x.id === sc.id); if (c) { c.flipped = !!sc.flipped; c.selected = !!sc.selected; } });
      if (!editing) cfRenderCardList();
      else { (st.cards || []).forEach(sc => { const row = $(`.cf-card-row[data-id="${sc.id}"]`); if (row) { const f = row.querySelector('.cf-flip'); const s = row.querySelector('.cf-select'); if (f) f.checked = !!sc.flipped; if (s) s.checked = !!sc.selected; } }); }
    }
    cfRenderPreview(); cfUpdateRunUI();
  });
}

async function init() {
  startBootExtras();
  await initLicenseGate();
  setBootStatus('Đang tải danh sách quà'); setBootProgress(42);
  await loadGiftMaster();
  setBootStatus('Đang tải thành viên'); setBootProgress(52);
  await refreshCreators();
  setBootStatus('Đang tải nhóm'); setBootProgress(62);
  await refreshGroups();
  await refreshGroupProfiles();
  await sanitizeLeakedLiveOverrides();
  setBootStatus('Đang tải cấu hình'); setBootProgress(74);
  await loadPkConfig();
  await loadKcConfig();
  await loadPkGroupConfig();
  await loadRankingConfig();
  await loadScoreConfig();
  await loadMusicListConfig();
  await loadStickerDanceConfig();
  await loadMvpHonorConfig();
  await loadLuckyWheelConfig();
  await loadGiftMenuConfig();
  await loadMissionTrioConfig();
  await loadCardFlipConfig();
  setBootStatus('Đang chuẩn bị overlay OBS'); setBootProgress(88);
  await refreshOverlayUrls();
  await ovLoadVisibility();
  await loadSettings();
  setBootStatus('Sẵn sàng!'); setBootProgress(100);
  wireTtEvents();
  wireConnectTab();
  wireGroupLauncher();
  wireCreatorTab();
  wireGroupTab();
  wirePkDuoTab();
  wireKcDuoTab();
  wirePkGroupTab();
  wireHistoryUI();
  wireRankingTab();
  initRankingLinks();
  wireScoreTab();
  wireHistoryModals();
  wireMusicListTab();
  wireStickerDanceTab();
  wireMvpHonorTab();
  wireLuckyWheelTab();
  wireGiftMenuTab();
  wireMissionTrioTab();
  wireCardFlipTab();
  wireOverlaysTab();
  wireSettingsTab();
  initAvatarSelects();
  loadLiveBanners();
  startLiveTickerAutoRefresh();
  checkUpdatesOnStartup();

  const licenseOk = $('#licenseOverlay')?.hidden !== false;
  // Khôi phục đúng nhóm trước rồi mới tự kết nối. Không dùng ID toàn cục của nhóm khác.
  const autoConnectionScheduled = licenseOk && await restoreAutoConnection();
  // Không có tự kết nối thì vẫn buộc chọn nhóm như trước.
  if (licenseOk && groups.length && !autoConnectionScheduled) openGroupLauncher(true);

  // Nền: tự lấy lại avatar nhóm/creator theo ID TikTok nếu thiếu hoặc URL đã hết hạn.
  autoRefetchStaleAvatars();

  // Ctrl + R: reset nhanh overlay OBS (chặn reload trang mặc định của Chromium).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      resetObsOverlays(true);
    }
  });
  // KHÔNG tự reset khi khởi động. Chỉ chạy nếu user CHỦ ĐỘNG bật "Tự động reset" trong Cài đặt
  // (mặc định TẮT). Overlay đã tự hồi phục qua overlay-sse.js nên không cần auto-reset nữa.
  if (obsResetCfg.autoReset) setTimeout(() => resetObsOverlays(false), 1500);

  // Dự phòng: nếu không có launcher/license overlay nào hiện (vd chưa có nhóm),
  // vẫn phải gỡ màn hình tải để vào thẳng giao diện chính.
  hideBootSplash();
}

// Cổng LIVE: bản CÀI chính thức bắt buộc kết nối TikTok LIVE mới cho chạy các tính năng
// (Tính điểm, PK Đôi/Nhóm, NHIỆM VỤ, THẺ BÀI…). Bản DEV luôn mở để test thoải mái.
// Trả true = được phép chạy; false = đã chặn + đã báo toast.
function requireLive(featureName) {
  if (IS_DEV || ttConnected) return true;
  toast(`🔒 Cần kết nối TikTok LIVE trước khi ${featureName}`, 'error');
  return false;
}

async function initLicenseGate() {
  wireLicenseUi();
  IS_DEV = await window.api.app.isDev().catch(() => false);
  const version = await window.api.app.getVersion().catch(() => '0.1.0');
  $('#appVersionText').textContent = version;
  if ($('#updateCurrentVer')) $('#updateCurrentVer').textContent = 'v' + version;
  if ($('#bootVer')) $('#bootVer').textContent = 'v' + version;
  document.title = `HP GROUP LIVE — Phiên bản v${version}`;
  setBootStatus('Đang kiểm tra bản quyền'); setBootProgress(12);
  const st = await window.api.license.check().catch(e => ({ ok: false, error: e.message || String(e), license: {} }));
  renderLicenseState(st);
  if (!st.ok) { showLicenseOverlay(st.error || 'Chưa kích hoạt KEY bản quyền.'); return; }
  // Bản quyền hợp lệ → hiện gọn tình trạng KEY (VIP · HSD) ngay trên splash.
  const lic = st.license || {};
  const bits = ['Bản quyền hợp lệ ✓'];
  if (lic.vip) bits.push(lic.vip);
  if (lic.expiresAt) bits.push('HSD ' + lic.expiresAt);
  setBootStatus(bits.join(' · ')); setBootProgress(30);
}

// ===== Màn hình tải (boot splash) =====
// Giữ splash hiện tối thiểu BOOT_MIN_MS để máy mạnh không bị "nháy" 1 cái rồi biến.
const BOOT_MIN_MS = 1700;
const bootSplashT0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
let bootTipTimer = null;

// Cập nhật dòng trạng thái đang tải (giữ nguyên 3 chấm động bên cạnh).
function setBootStatus(text) {
  const el = document.getElementById('bootStatus');
  if (el) el.textContent = text;
}
// Cập nhật thanh tiến trình (0–100).
function setBootProgress(pct) {
  const el = document.getElementById('bootProgress');
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
// Lời chào theo giờ + mẹo xoay vòng — chạy khi splash bật.
function startBootExtras() {
  // Lời chào theo 6 khung giờ (khuya 22h→2h vắt qua nửa đêm; mờ sáng 3–5h).
  const hour = new Date().getHours();
  let greet;
  if (hour >= 6 && hour <= 10) greet = 'Chào buổi sáng ☀️ Khởi động ngày mới nào!';
  else if (hour >= 11 && hour <= 13) greet = 'Chào buổi trưa 🍜 Nạp năng lượng rồi LIVE thôi!';
  else if (hour >= 14 && hour <= 17) greet = 'Chào buổi chiều 🌤️ Bùng nổ cùng HP nào!';
  else if (hour >= 18 && hour <= 21) greet = 'Chào buổi tối 🎤 Giờ vàng lên sóng rồi!';
  else if (hour >= 3 && hour <= 5) greet = 'Trời còn mờ sáng 🌄 Dậy sớm chiến sớm nhé!';
  else greet = 'Đã khuya rồi 🌙 Giữ sức, cháy hết mình nhé!';
  const g = document.getElementById('bootGreet');
  if (g) g.textContent = greet;

  const tips = [
    'Mẹo: Ctrl + R để reset nhanh overlay OBS',
    'Mẹo: Chọn nhóm để lọc mọi thông số theo nhóm đó',
    'Mẹo: Bật "Tự động kết nối" để vào LIVE ngay khi mở app',
    'Mẹo: TALENT SHOW gộp toàn bộ Creator của mọi nhóm',
    'Mẹo: Kéo-thả để sắp xếp thứ tự hiển thị trên OBS',
  ];
  const tipEl = document.getElementById('bootTip');
  if (!tipEl) return;
  let i = 0;
  tipEl.textContent = tips[0];
  bootTipTimer = setInterval(() => {
    i = (i + 1) % tips.length;
    tipEl.style.opacity = '0';
    setTimeout(() => { tipEl.textContent = tips[i]; tipEl.style.opacity = '1'; }, 320);
  }, 2600);
}

// Ẩn splash — chạy 1 lần, fade mượt rồi gỡ khỏi luồng; dọn timer mẹo.
function hideBootSplash() {
  const el = document.getElementById('bootSplash');
  if (!el || el.hidden || el.classList.contains('is-hiding')) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wait = BOOT_MIN_MS - (now - bootSplashT0);
  if (wait > 0) { setTimeout(hideBootSplash, wait); return; }
  setBootProgress(100);
  if (bootTipTimer) { clearInterval(bootTipTimer); bootTipTimer = null; }
  el.classList.add('is-hiding');
  setTimeout(() => { el.hidden = true; }, 480);
}

function showLicenseOverlay(message = '') {
  const ov = $('#licenseOverlay');
  if (!ov) return;
  hideBootSplash(); // để lộ ô nhập KEY (splash nằm trên license overlay)
  ov.hidden = false;
  $('#licenseOverlayStatus').textContent = message;
  $('#licenseKeyInput').focus();
}

function hideLicenseOverlay() {
  const ov = $('#licenseOverlay');
  if (ov) ov.hidden = true;
}

function renderLicenseState(st = {}) {
  const license = st.license || st || {};
  const key = license.key || '';
  if ($('#licenseKeySettings')) $('#licenseKeySettings').value = key;
  if ($('#licenseDeviceId')) $('#licenseDeviceId').textContent = `Thiết bị: ${license.deviceId || ''}`;
  if ($('#licenseDeviceSettings')) $('#licenseDeviceSettings').value = license.deviceId || '';
  if ($('#licenseVipText')) $('#licenseVipText').textContent = license.vip || '—';
  if ($('#licenseExpireText')) $('#licenseExpireText').textContent = license.expiresAt || '—';
  if ($('#licenseStatusText')) $('#licenseStatusText').textContent = st.ok ? (st.offline ? 'Hợp lệ (offline)' : 'Hợp lệ') : (st.error || license.status || 'Không hợp lệ');
  if ($('#licenseVersionText')) $('#licenseVersionText').textContent = license.appVersion || $('#appVersionText')?.textContent || '—';
}

async function activateLicenseFrom(inputId) {
  const key = $('#' + inputId)?.value.trim();
  const btn = inputId === 'licenseKeyInput' ? $('#licenseActivateBtn') : $('#licenseActivateSettings');
  if (btn) btn.disabled = true;
  try {
    const st = inputId === 'licenseKeyInput'
      ? await window.api.license.activate(key)
      : await window.api.license.check();
    renderLicenseState(st);
    if (!st.ok) {
      $('#licenseOverlayStatus').textContent = st.error || 'KEY không hợp lệ.';
      if (inputId !== 'licenseKeyInput') showLicenseOverlay(st.error || 'Vui lòng kích hoạt lại KEY bản quyền.');
      toast(st.error || 'KEY không hợp lệ', 'error');
      return;
    }
    hideLicenseOverlay();
    toast(inputId === 'licenseKeyInput' ? 'Đã kích hoạt bản quyền' : 'KEY bản quyền hợp lệ', 'success');
  } catch (e) {
    const msg = e.message || String(e);
    $('#licenseOverlayStatus').textContent = msg;
    toast(msg, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireLicenseUi() {
  $('#licenseActivateBtn')?.addEventListener('click', () => activateLicenseFrom('licenseKeyInput'));
  $('#licenseKeyInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') activateLicenseFrom('licenseKeyInput'); });
  $('#licenseActivateSettings')?.addEventListener('click', () => activateLicenseFrom('licenseKeySettings'));
  $('#licenseClearSettings')?.addEventListener('click', async () => {
    if (!await askConfirm('Xóa KEY đã lưu trên máy này?', 'Xóa KEY')) return;
    const st = await window.api.license.clear();
    renderLicenseState(st);
    showLicenseOverlay('Đã xóa KEY. Vui lòng kích hoạt lại.');
  });
  $('#btnCheckUpdate')?.addEventListener('click', () => checkForUpdate(true));
  $('#btnInstallUpdate')?.addEventListener('click', installLatestUpdate);
  $('#versionCheckBtn')?.addEventListener('click', () => checkForUpdate(true));
}

// Dọn nội dung ghi chú bản mới thành các dòng gọn, thân thiện — bỏ các dòng nhạy cảm/kỹ thuật.
function cleanReleaseNotes(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return '• Cải thiện hiệu năng và sửa một số lỗi nhỏ.';
  const banned = /(github|google\s*sheet|gitlab|\brepo\b|commit|api\.|token|http(s)?:\/\/|\.exe\b|bảo mật|security)/i;
  const lines = text.split('\n')
    .map(l => l.replace(/^#{1,6}\s*/, '').replace(/^\s*[-*]\s+/, '• ').replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter(l => l && !banned.test(l));
  const out = lines.slice(0, 14).join('\n').trim();
  return out || '• Cải thiện hiệu năng và sửa một số lỗi nhỏ.';
}

async function checkForUpdate(manual = false) {
  const status = $('#updateStatus');
  const banner = $('#updateBanner');
  const installBtn = $('#btnInstallUpdate');
  const card = $('#updateCard');
  if (status) status.textContent = '⏳ Đang kiểm tra bản cập nhật…';
  try {
    latestUpdateInfo = await window.api.updates.check();
    const cur = latestUpdateInfo.current || '—';
    if ($('#updateCurrentVer')) $('#updateCurrentVer').textContent = 'v' + cur;
    if (latestUpdateInfo.hasUpdate) {
      if ($('#updateLatestVer')) $('#updateLatestVer').textContent = 'v' + latestUpdateInfo.latest;
      if ($('#updateNotes')) $('#updateNotes').textContent = cleanReleaseNotes(latestUpdateInfo.notes);
      if (banner) banner.hidden = false;
      if (installBtn) installBtn.hidden = false;
      card?.classList.add('has-update');
      if (status) status.textContent = `🎉 Bản mới v${latestUpdateInfo.latest} đã sẵn sàng — bấm “⬇ Tải & cài bản mới”.`;
      toast(`🎉 Đã có bản mới v${latestUpdateInfo.latest}`, 'success');
    } else {
      if (banner) banner.hidden = true;
      if (installBtn) installBtn.hidden = true;
      card?.classList.remove('has-update');
      if (status) status.textContent = `✅ Bạn đang dùng bản mới nhất (v${cur}).`;
      if (manual) toast('Đang dùng bản mới nhất', 'success');
    }
  } catch (e) {
    if (status) status.textContent = '⚠ Chưa kiểm tra được cập nhật lúc này. Vui lòng thử lại sau.';
    if (manual) toast('Chưa kiểm tra được cập nhật', 'error');
  }
}

function checkUpdatesOnStartup() {
  setTimeout(async () => {
    await checkForUpdate(false);
    // Tự thông báo khi có bản mới: hỏi Có/Không ngay lúc mở app → đồng ý thì tải & cài luôn,
    // khỏi phải tự vào phần Cài đặt tìm nút. Từ chối thì vẫn còn banner + nút để cài sau.
    if (latestUpdateInfo?.hasUpdate) {
      const ok = await askConfirm(
        `Đã có bản mới v${latestUpdateInfo.latest} (bạn đang dùng v${latestUpdateInfo.current || '—'}). Tải và cài đặt ngay bây giờ?`,
        '🎉 Có bản cập nhật mới'
      );
      if (ok) installLatestUpdate();
    }
  }, 1800);
}

async function installLatestUpdate() {
  if (!latestUpdateInfo) await checkForUpdate(true);
  if (!latestUpdateInfo?.hasUpdate) return;
  $('#btnInstallUpdate').disabled = true;
  const prog = $('#updateProgress'), bar = $('#updateProgressBar'), pctEl = $('#updateProgressPct');
  const mb = b => (Number(b) / 1048576).toFixed(0);
  const setBar = (pct) => { if (bar) bar.style.width = `${pct}%`; if (pctEl) pctEl.textContent = `${pct}%`; };
  if (prog) prog.hidden = false;
  setBar(0);
  $('#updateStatus').textContent = 'Đang tải bản cập nhật, vui lòng chờ...';
  const off = window.api.updates.onProgress?.(({ received, total, pct }) => {
    setBar(pct || 0);
    $('#updateStatus').textContent = total
      ? `Đang tải: ${pct}% (${mb(received)}/${mb(total)} MB)`
      : `Đang tải: ${mb(received)} MB...`;
  });
  try {
    await window.api.updates.install(latestUpdateInfo);
    setBar(100);
    $('#updateStatus').textContent = 'Đã tải xong — đang mở installer, ứng dụng sẽ tự đóng để cập nhật.';
  } catch (e) {
    $('#btnInstallUpdate').disabled = false;
    if (prog) prog.hidden = true;
    const msg = e.message || String(e);
    $('#updateStatus').textContent = `Cập nhật thất bại: ${msg}`;
    toast(msg, 'error');
  } finally {
    if (typeof off === 'function') off();
  }
}

function startLiveTickerAutoRefresh() {
  loadLiveTicker();
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(loadLiveTicker, TICKER_REFRESH_MS);
}

async function loadLiveBanners() {
  const box = $('#liveBanner');
  if (!box || !window.api.banner?.list) return;
  try {
    const res = await window.api.banner.list();
    bannerItems = res?.banners || [];
    bannerIndex = 0;
    renderLiveBanner();
    clearInterval(bannerTimer);
    if (bannerItems.length > 1) bannerTimer = setInterval(() => {
      bannerIndex = (bannerIndex + 1) % bannerItems.length;
      renderLiveBanner();
    }, 8000);
  } catch {
    renderLiveBannerError();
  }
}

function renderLiveBannerError() {
  const box = $('#liveBanner');
  if (!box) return;
  box.className = 'live-banner-placeholder';
  box.innerHTML = '<strong>Chưa tải được banner</strong><span>Kiểm tra quyền chia sẻ Google Sheet.</span>';
}

function renderLiveBanner() {
  const box = $('#liveBanner');
  if (!box) return;
  const item = bannerItems[bannerIndex];
  if (!item) {
    box.className = 'live-banner-placeholder';
    box.innerHTML = '<strong>Banner vinh danh / thông tin</strong><span>Thêm ảnh tại sheet Banner, cột A.</span>';
    return;
  }
  box.className = `live-banner${item.link ? ' clickable' : ''}`;
  box.innerHTML = `
    <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.note || 'Banner')}" />
    ${item.note ? `<span>${escapeHtml(item.note)}</span>` : ''}
  `;
  box.onclick = item.link ? () => window.api.shell.openExternal(item.link) : null;
}

async function loadLiveTicker() {
  const box = $('#liveTicker');
  const track = $('#liveTickerTrack');
  if (!box || !track || !window.api.ticker?.list) return;
  try {
    const res = await window.api.ticker.list();
    tickerItems = res?.tickers || [];
    renderLiveTicker();
  } catch {
    tickerItems = [];
    renderLiveTicker();
  }
}

function renderLiveTicker() {
  const box = $('#liveTicker');
  const track = $('#liveTickerTrack');
  if (!box || !track) return;
  const text = tickerItems.map(t => t.text).filter(Boolean).join('     •     ');
  box.hidden = !text;
  track.textContent = text ? `${text}     •     ${text}` : '';
}

// ============================================================
// TikTok connection events
// ============================================================
function wireTtEvents() {
  window.api.on('tt:connected', (info) => {
    $('#connDot').classList.add('live');
    $('#connDot').classList.remove('connecting');
    $('#bottomLive')?.classList.add('is-live');
    $('#connLabel').textContent = 'Đang LIVE';
    $('#connHost').textContent = `@${info.username}`;
    if ($('#hostInfo')) $('#hostInfo').hidden = false;
    if ($('#hostAvatar')) $('#hostAvatar').src = info.avatar || '../logo/hp-logo.png';
    if ($('#hostNick')) $('#hostNick').textContent = info.nickname || info.username;
    if ($('#hostHandle')) $('#hostHandle').textContent = '@' + info.username + (info.roomId ? ` · room ${info.roomId}` : '');
    if ($('#hostTitle')) $('#hostTitle').textContent = info.title || '';
    ttConnecting = false;
    ttConnected = true;
    liveUsername = info.username || $('#ttUsername').value.trim();
    $('#btnConnect').disabled = false;
    $('#btnConnect').textContent = '■ Ngắt';
    $('#btnConnect').classList.remove('primary');
    $('#btnConnect').classList.add('ghost');
    toast(`✅ Kết nối @${info.username}`, 'success');
  });
  window.api.on('tt:disconnected', () => {
    $('#connDot').classList.remove('live', 'connecting');
    $('#bottomLive')?.classList.remove('is-live');
    $('#connLabel').textContent = 'Đã ngắt';
    $('#connHost').textContent = '';
    ttConnecting = false;
    ttConnected = false;
    liveUsername = '';
    $('#btnConnect').disabled = false;
    $('#btnConnect').textContent = '▶ Kết nối';
    $('#btnConnect').classList.add('primary');
    $('#btnConnect').classList.remove('ghost');
  });
  window.api.on('tt:error', (info) => {
    const msg = (info && typeof info.message === 'string' && info.message) || 'Lỗi kết nối';
    // Lỗi runtime không fatal khi vẫn đang LIVE: lib tự phục hồi, đừng phá trạng thái
    // kết nối và đừng spam toast đỏ (đây là nguyên nhân "lỗi thường xuyên sau khi LIVE").
    if (info && info.fatal === false && ttConnected) {
      console.warn('[tt:error non-fatal]', msg);
      return;
    }
    $('#connDot').classList.remove('live', 'connecting');
    $('#bottomLive')?.classList.remove('is-live');
    $('#connLabel').textContent = 'Lỗi';
    toast('⚠ ' + msg, 'error');
    ttConnecting = false;
    ttConnected = false;
    liveUsername = '';
    $('#btnConnect').disabled = false;
    $('#btnConnect').textContent = '▶ Kết nối';
    $('#btnConnect').classList.add('primary');
    $('#btnConnect').classList.remove('ghost');
  });

  window.api.on('tt:chat', (d) => {
    const list = $('#chatList');
    const div = document.createElement('div');
    div.className = 'item chat-item';
    div.innerHTML = `
      <img class="avatar" src="${escapeAttr(d.avatar || '../logo/hp-logo.png')}" alt="" />
      <div>${levelBadge(d.level)}<span class="who">${escapeHtml(d.nickname || d.uniqueId)}</span><div class="comment">${escapeHtml(d.comment || '')}</div></div>
    `;
    const img = div.querySelector('.avatar');
    wireUserPopupAvatar(img, d);
    img.onerror = () => fillAvatarFromTikTok(img, d.uniqueId || d.userId || d.nickname);
    if (!d.avatar) fillAvatarFromTikTok(img, d.uniqueId || d.userId || d.nickname);
    prependLog(list, div);
  });

  window.api.on('tt:gift', (d) => {
    const shouldProcess = d.shouldProcess || d.repeatEnd;
    if (shouldProcess) { try { MusicList.onGift(d); } catch {} try { SpeedControl.onGift(d); } catch {} }
    stats.gifts += shouldProcess ? Math.max(1, d.repeatCount) : 0;
    const giftDiamond = Number(d.diamondCount) || Number((giftMaster.find(g => String(g.id) === String(d.giftId)) || giftMaster.find(g => String(g.name || '').toLowerCase() === String(d.giftName || '').toLowerCase()))?.diamond) || 0;
    stats.diamond += shouldProcess ? giftDiamond * Math.max(1, d.repeatCount) : 0;
    if (d.uniqueId) stats.donors.add(d.uniqueId);
    if (shouldProcess) {
      const list = $('#giftList');
      const div = document.createElement('div');
      div.className = 'item gift-item';
      const repeat = Math.max(1, Number(d.repeatCount) || 1);
      const coinEach = giftDiamond;
      const totalCoin = coinEach * repeat;
      const donorKey = d.uniqueId || d.nickname || '';
      const isFirstGift = donorKey && !giftDonors.has(donorKey);
      if (donorKey) giftDonors.add(donorKey);
      div.innerHTML = `
        <img class="avatar" src="${escapeAttr(d.avatar || '../logo/hp-logo.png')}" alt="" />
        <div>
          ${levelBadge(d.level)}<span class="who">${escapeHtml(d.nickname || d.uniqueId)}</span>${isFirstGift ? '<span class="first-gift">Lần đầu tặng</span>' : ''}
          <div class="gift-line"><span class="gift-label">Quà tặng:</span>${d.giftIcon ? `<img class="gift-icon" src="${escapeAttr(d.giftIcon)}" alt="" />` : '🎁'}<span>${escapeHtml(String(d.giftId || ''))} - ${escapeHtml(d.giftName || '')}</span></div>
          <div class="gift-meta"><span>Số lần: x${formatCompact(repeat)}</span><span>Kim cương: ${formatCompact(totalCoin)}</span></div>
        </div>
      `;
      const avatar = div.querySelector('.avatar');
      wireUserPopupAvatar(avatar, d);
      avatar.onerror = () => fillAvatarFromTikTok(avatar, d.uniqueId || d.userId || d.nickname);
      if (!d.avatar) fillAvatarFromTikTok(avatar, d.uniqueId || d.userId || d.nickname);
      const giftIcon = div.querySelector('.gift-icon');
      if (giftIcon) wireGiftIconDrag(giftIcon, d.giftId, d.giftName);
      prependLog(list, div);
      if (isFirstGift) toast(`${d.nickname || d.uniqueId} lần đầu tặng quà`, 'success');
    }
    refreshStats();
  });

  window.api.on('tt:roomUser', (d) => { stats.viewers = d.viewerCount || 0; refreshStats(); });

  window.api.on('pkduo:state', (st) => renderPkPreview(st));
  // Engine tự cập nhật chuỗi WIN sau mỗi trận → đồng bộ ô nhập + bộ nhớ pkCfg (không đè khi đang gõ tay).
  window.api.on('pkduo:config', (cfg) => {
    if (!cfg) return;
    if (pkCfg) {
      if (cfg.teamA) pkCfg.teamA.winStreak = Math.max(0, Number(cfg.teamA.winStreak) || 0);
      if (cfg.teamB) pkCfg.teamB.winStreak = Math.max(0, Number(cfg.teamB.winStreak) || 0);
    }
    const aEl = $('#pkAstreak'), bEl = $('#pkBstreak');
    if (aEl && document.activeElement !== aEl) aEl.value = Math.max(0, Number(cfg.teamA?.winStreak) || 0);
    if (bEl && document.activeElement !== bEl) bEl.value = Math.max(0, Number(cfg.teamB?.winStreak) || 0);
    updatePkTotalMatches();
  });
  window.api.on('pkgroup:state', (st) => renderPkGroupPreview(st));
  window.api.on('ranking:state', (st) => renderRkPreview(st));
  window.api.on('score:state', (st) => renderScPreview(st));
}

function refreshStats() {
  $('#stViewers').textContent = formatNumber(stats.viewers);
  $('#stGifts').textContent = formatNumber(stats.gifts);
  $('#stDiamond').textContent = formatNumber(stats.diamond);
  $('#stDonors').textContent = formatNumber(stats.donors.size);
}

function setChatFontSize(size) {
  chatFontSize = Math.max(13, Math.min(30, Number(size) || 18));
  document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`);
}

function markLogInteraction(id) { logInteractAt[id] = Date.now(); }

function prependLog(list, div) {
  const active = Date.now() - (logInteractAt[list.id] || 0) < 10000;
  const before = list.scrollTop;
  list.prepend(div);
  while (list.childElementCount > 200) list.lastChild.remove();
  if (active) list.scrollTop = before + div.offsetHeight + 4;
  else list.scrollTop = 0;
}

async function fillAvatarFromTikTok(img, uniqueId) {
  const id = String(uniqueId || '').trim().replace(/^@/, '');
  if (!id || userAvatarCache.has(id)) {
    if (userAvatarCache.get(id)) img.src = userAvatarCache.get(id);
    return;
  }
  userAvatarCache.set(id, '');
  try {
    const p = await window.api.tt.fetchProfile(id);
    if (p?.avatar) {
      userAvatarCache.set(id, p.avatar);
      img.src = p.avatar;
    }
  } catch {}
}

function wireGiftIconDrag(img, giftId, giftName) {
  img.draggable = true;
  let preparing = false;
  async function prepare() {
    if (img.dataset.dragFile || preparing) return;
    preparing = true;
    try {
      const file = await window.api.shell.prepareGiftDrag({ url: img.src, giftId, giftName });
      if (file) img.dataset.dragFile = file;
    } catch {}
    finally { preparing = false; }
  }
  img.addEventListener('mouseenter', prepare);
  img.addEventListener('mousedown', prepare);
  img.addEventListener('dragstart', (e) => {
    if (img.dataset.dragFile) {
      e.preventDefault();
      window.api.shell.startGiftDrag(img.dataset.dragFile);
      return;
    }
    e.preventDefault();
    prepare().then(() => {
      if (img.dataset.dragFile) window.api.shell.startGiftDrag(img.dataset.dragFile);
      else toast('Đang chuẩn bị icon quà, kéo lại lần nữa.', 'error');
    });
  });
}

function openUserPopup(data) {
  $('#userPopupAvatar').src = data.avatar || '../logo/hp-logo.png';
  $('#userPopupName').textContent = data.nickname || data.uniqueId || 'Người dùng TikTok';
  $('#userPopupId').textContent = data.uniqueId ? '@' + data.uniqueId : '';
  $('#userPopupLevel').textContent = data.level ? `Lv ${data.level}` : '';
  $('#userPopupHeart').textContent = data.heartCount ? `❤ ${formatCompact(data.heartCount)}` : '';
  $('#userPopupFollowers').textContent = data.followerCount ? `Follow: ${formatCompact(data.followerCount)}` : '';
  $('#userPopupFollowing').textContent = data.followingCount ? `Đang follow: ${formatCompact(data.followingCount)}` : '';
  $('#userPopupBio').textContent = data.signature || '';
  $('#userPopup').hidden = false;
  hydrateUserPopup(data);
}

function closeUserPopup() { $('#userPopup').hidden = true; }

function wireUserPopupAvatar(img, data) {
  img.addEventListener('click', () => openUserPopup({
    avatar: img.src || data.avatar,
    nickname: data.nickname,
    uniqueId: data.uniqueId,
    level: data.level,
    heartCount: data.heartCount,
    followerCount: data.followerCount,
    followingCount: data.followingCount,
    signature: data.signature,
  }));
}

async function hydrateUserPopup(data) {
  if (data.followerCount || !data.uniqueId) return;
  try {
    const p = await window.api.tt.fetchProfile(data.uniqueId);
    if ($('#userPopup').hidden) return;
    if (p.avatar) $('#userPopupAvatar').src = p.avatar;
    if (p.nickname) $('#userPopupName').textContent = p.nickname;
    $('#userPopupHeart').textContent = p.heartCount ? `❤ ${formatCompact(p.heartCount)}` : $('#userPopupHeart').textContent;
    $('#userPopupFollowers').textContent = p.followerCount ? `Follow: ${formatCompact(p.followerCount)}` : $('#userPopupFollowers').textContent;
    $('#userPopupFollowing').textContent = p.followingCount ? `Đang follow: ${formatCompact(p.followingCount)}` : $('#userPopupFollowing').textContent;
    $('#userPopupBio').textContent = p.signature || $('#userPopupBio').textContent;
  } catch {}
}

function levelBadge(level) {
  return level ? `<span class="user-level">Lv ${escapeHtml(level)}</span>` : '';
}

// ============================================================
// Connect tab
// ============================================================
function wireConnectTab() {
  setChatFontSize(chatFontSize);
  $('#chatFontDown').addEventListener('click', () => setChatFontSize(chatFontSize - 1));
  $('#chatFontUp').addEventListener('click', () => setChatFontSize(chatFontSize + 1));
  // Nút xuất nhanh overlay gộp TƯƠNG TÁC + QUÀ ngay từ tab này (khỏi vào Link Overlay).
  $('#feedQuickReview')?.addEventListener('click', async () => {
    const state = await window.api.review.getState().catch(() => ({}));
    const r = state.interact?.open ? await window.api.review.close('interact') : await window.api.review.open('interact');
    if (!r?.ok) { toast(r?.error || 'Không mở được cửa sổ Review', 'error'); return; }
    toast(state.interact?.open ? 'Đã đóng Review overlay gộp' : 'Đã mở Review overlay gộp', 'success');
  });
  $('#feedQuickCopy')?.addEventListener('click', async () => {
    const url = await window.api.interact.getUrl();
    await window.api.shell.copyText(url);
    toast('📋 Đã copy link OBS (1080×1920)', 'success');
  });
  $('#userPopupClose').addEventListener('click', closeUserPopup);
  $('#userPopup').addEventListener('mousedown', e => { if (e.target === $('#userPopup')) closeUserPopup(); });
  $('#connDot').addEventListener('click', (e) => {
    const username = String(liveUsername || $('#ttUsername').value || '').trim().replace(/^@/, '');
    if (!ttConnected || !username) return; // chưa LIVE → để sự kiện nổi lên nút trạng thái (mở popup)
    e.stopPropagation(); // đang LIVE → mở trang live, không mở popup
    window.api.shell.openExternal(`https://tiktok.com/@${encodeURIComponent(username)}/live`);
  });
  ['chatList', 'giftList'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener('mouseenter', () => markLogInteraction(id));
    el.addEventListener('mousemove', () => markLogInteraction(id));
    el.addEventListener('wheel', () => markLogInteraction(id), { passive: true });
  });
  // Nút Kết nối/Ngắt nằm trong popup Kết nối.
  $('#btnConnect').addEventListener('click', async () => {
    if (ttConnected) {
      const ok = await askConfirm('Bạn có muốn ngắt kết nối TikTok LIVE?', 'Ngắt kết nối');
      if (!ok) return;
      $('#btnConnect').disabled = true;
      try {
        await window.api.tt.disconnect();
        toast('Đã ngắt kết nối');
      } finally {
        $('#btnConnect').disabled = false;
      }
      return;
    }
    const u = $('#ttUsername').value.trim();
    if (!u) { toast('Nhập ID TikTok LIVE trước đã.', 'error'); $('#ttUsername').focus(); return; }
    closeConnectModal();
    startConnect(u);
  });

  // Thanh dưới tối giản: bấm nút trạng thái → mở popup kết nối
  $('#connStatus')?.addEventListener('click', openConnectModal);
  $('#connectModalClose')?.addEventListener('click', closeConnectModal);
  $('#connectModalCancel')?.addEventListener('click', closeConnectModal);
  $('#connectModal')?.addEventListener('mousedown', e => { if (e.target === $('#connectModal')) closeConnectModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#connectModal')?.hidden) closeConnectModal(); });
  $('#autoConnectChk')?.addEventListener('change', (e) => {
    autoConnectPref = e.target.checked;
    // CHỈ lưu tuỳ chọn tự-kết-nối; KHÔNG kèm username (lúc đang LIVE ô ID có thể là id nhóm khác → rò rỉ).
    saveLiveConnectionConfig(activeGroupId, { autoConnect: autoConnectPref });
  });
  $('#ttUsername').addEventListener('change', () => {
    // Chỉ lưu ID khi người dùng THỰC SỰ sửa ô (không đang kết nối/kết nối dở) → tránh stamp id nhóm khác.
    if (ttConnected || ttConnecting) return;
    saveLiveConnectionConfig(activeGroupId, { username: $('#ttUsername').value });
  });
  $('#ttUsername').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnConnect').click(); });
  $('#modeSelect')?.addEventListener('change', async (e) => {
    // Lưu ID đang gõ cho nhóm ĐANG chọn TRƯỚC khi đổi — nhưng KHÔNG khi đang kết nối (ô đang giữ id đã
    // kết nối, có thể của nhóm khác → nếu lưu sẽ rò rỉ sang nhóm bị rời đi).
    if (!ttConnected && !ttConnecting) {
      saveLiveConnectionConfig(activeGroupId, { username: $('#ttUsername')?.value || '' });
    }
    await setActiveGroup(e.target.value);
  });
}

function openConnectModal() {
  const m = $('#connectModal');
  if (!m) return;
  // Luôn đồng bộ dropdown + ô ID theo ĐÚNG nhóm đang chọn mỗi lần mở (kể cả đang kết nối) → khỏi hiện id nhóm khác.
  renderModeSelect();
  syncLiveConnectionUi(activeGroupId, true, true);
  m.hidden = false;
  setTimeout(() => $('#ttUsername')?.focus(), 30);
}
function closeConnectModal() {
  const m = $('#connectModal');
  if (m) m.hidden = true;
}

// Bắt đầu kết nối TikTok LIVE với ID cho trước (dùng chung cho nút thanh dưới + popup).
async function startConnect(u) {
  if (ttConnecting) return;
  const groupId = activeGroupId;
  u = String(u || '').trim().replace(/^@/, '');
  if (!u) { toast('Nhập ID TikTok LIVE trước đã.', 'error'); return; }
  ttConnecting = true;
  await saveLiveConnectionConfig(groupId, { username: u });
  $('#connDot').classList.add('connecting');
  $('#connLabel').textContent = 'Đang kết nối...';
  $('#btnConnect').disabled = true;
  try {
    const result = await window.api.tt.connect(u);
    if (result?.ok === false) throw new Error(result.error || 'Không thể kết nối TikTok LIVE.');
  } catch (e) {
    $('#connDot').classList.remove('connecting');
    $('#bottomLive')?.classList.remove('is-live');
    $('#connLabel').textContent = 'Lỗi';
    $('#btnConnect').textContent = '▶ Kết nối';
    $('#btnConnect').classList.add('primary');
    $('#btnConnect').classList.remove('ghost');
    toast('⚠ ' + e.message, 'error');
  } finally {
    ttConnecting = false;
    if (!ttConnected) $('#btnConnect').disabled = false;
  }
}

// ============================================================
// Creators
// ============================================================
async function refreshCreators() {
  creators = await window.api.creators.list();
  renderCreators();
  renderCreatorGroupSelect();
  renderPkCreatorSelects?.();
  renderPkGroupMembers?.();
  renderScoreCreatorSelect?.();
  renderKcCreatorSelects?.();
  propagateDefaultGiftToBattles();
  propagateCreatorNamesToBattles();
  checkDuplicateDefaultGifts();
}

// Đổi Nick Name ở Hồ sơ Creator → lan tên hiển thị xuống PK Đôi / PK Nhóm.
// Nickname là "nguồn sự thật" cho tên: nơi nào đang bám 1 creator (theo creatorId) thì luôn
// đồng bộ theo nickname hiện tại, kể cả tên đã gõ tay trước đó. (Thi đấu nhóm vốn đọc nickname realtime.)
function propagateCreatorNamesToBattles() {
  // PK Đôi
  if (pkCfg) {
    let changed = false;
    for (const side of ['A', 'B']) {
      const team = getTeam(side);
      if (!team || !team.creatorId) continue;
      const c = creatorById(team.creatorId);
      if (!c) continue;
      const nm = c.nickname || c.tiktokId || '';
      if (!nm) continue;
      if (team.creatorName !== nm) { team.creatorName = nm; changed = true; }
      // Tên hiển thị chỉ tự bám nickname khi user CHƯA gõ tay (nameOverride) và ô đang không nhập.
      const input = $('#pk' + side + 'name');
      const editing = input && document.activeElement === input;
      if (!team.nameOverride && !editing && team.name !== nm) { team.name = nm; changed = true; }
    }
    if (changed) {
      const aEl = $('#pkAname'), bEl = $('#pkBname');
      if (aEl && document.activeElement !== aEl && !pkCfg.teamA?.nameOverride) aEl.value = pkCfg.teamA?.name || 'TEAM A';
      if (bEl && document.activeElement !== bEl && !pkCfg.teamB?.nameOverride) bEl.value = pkCfg.teamB?.name || 'TEAM B';
      window.api.pkduo?.setConfig({ teamA: pkCfg.teamA, teamB: pkCfg.teamB }).catch(() => {});
    }
  }
  // PK Nhóm
  if (pkGroupCfg && Array.isArray(pkGroupCfg.participants)) {
    let changed = false;
    for (const p of pkGroupCfg.participants) {
      const c = creatorById(p.creatorId || p.id);
      if (!c) continue;
      const nm = c.nickname || c.tiktokId || '';
      // Bỏ qua nếu user đã tự đặt tên hiển thị riêng cho creator này.
      if (nm && !p.nameOverride && p.name !== nm) { p.name = nm; changed = true; }
    }
    if (changed) {
      window.api.pkgroup?.setConfig({ participants: pkGroupCfg.participants }).catch(() => {});
      renderPkGroupMembers?.();
    }
  }
}

// Đổi quà mặc định ở Hồ sơ Creator → đẩy realtime xuống engine PK Nhóm / PK Đôi
// (chỉ những nơi ĐANG KẾ THỪA, không đụng nơi đã ghi đè). Thi đấu nhóm vốn đã đọc default realtime.
function propagateDefaultGiftToBattles() {
  // PK Nhóm
  if (pkGroupCfg && Array.isArray(pkGroupCfg.participants)) {
    let changed = false;
    for (const p of pkGroupCfg.participants) {
      if (p.giftOverride && isRealGift(p.gifts?.[0])) continue;
      const c = creatorById(p.creatorId || p.id) || creatorById(p.tiktokId);
      const def = c ? creatorDefaultGift(c) : null;
      if (!sameGiftStrict(p.gifts?.[0], def)) { p.gifts = def ? [def] : []; p.giftOverride = false; changed = true; }
    }
    // Patch tối thiểu: chỉ participants, tránh clobber field khác đang chờ autosave
    if (changed) window.api.pkgroup?.setConfig({ participants: pkGroupCfg.participants }).catch(() => {});
  }
  // PK Đôi (chỉ chế độ Chọn Phe mới bám quà mặc định)
  if (pkCfg && pkCfg.joinMode) {
    let changed = false;
    for (const side of ['A', 'B']) {
      const team = getTeam(side);
      if (team.giftOverride && isRealGift((team.joinGifts || [])[0])) continue;
      const c = team.creatorId ? creatorById(team.creatorId) : null;
      const def = c ? creatorDefaultGift(c) : null;
      if (!sameGiftStrict((team.joinGifts || [])[0], def)) {
        team.joinGifts = def ? [def] : [];
        team.gifts = team.joinGifts;
        team.giftOverride = false;
        changed = true;
      }
    }
    if (changed) {
      renderPkGifts?.();
      window.api.pkduo?.setConfig({ teamA: pkCfg.teamA, teamB: pkCfg.teamB }).catch(() => {});
    }
  }
}

// Rà soát Thi đấu nhóm: TALENT SHOW (tất cả) gộp mọi nhóm → quà mặc định phải duy nhất,
// tránh 1 quà bị tính cho nhiều creator. (Lúc lưu creator đã chặn trùng; hàm này bắt dữ liệu cũ.)
function checkDuplicateDefaultGifts() {
  const byGift = new Map();
  for (const c of creators) {
    if (!c.defaultGiftId) continue;
    const k = String(c.defaultGiftId);
    if (!byGift.has(k)) byGift.set(k, []);
    byGift.get(k).push(c.nickname || c.tiktokId || 'Creator');
  }
  const dups = [...byGift.values()].filter(a => a.length > 1);
  const sig = dups.map(a => a.slice().sort().join('/')).sort().join('|');
  if (sig === checkDuplicateDefaultGifts._sig) return; // tránh toast lặp
  checkDuplicateDefaultGifts._sig = sig;
  if (dups.length) {
    const detail = dups.map(a => a.join(' = ')).join('; ');
    toast(`⚠️ Quà mặc định trùng giữa Creator (ảnh hưởng Thi đấu nhóm TALENT SHOW): ${detail}. Hãy đặt quà riêng.`, 'error');
  }
}

function renderCreators() {
  const cs = visibleCreators();
  const list = $('#creatorsList');
  const countEl = $('#crCount');
  if (countEl) countEl.textContent = cs.length ? `${cs.length}` : '';
  list.innerHTML = '';
  if (cs.length === 0) {
    list.innerHTML = '<div class="hint">Chưa có Creator nào. Hãy thêm Creator đầu tiên.</div>';
    return;
  }
  const groupsById = new Map(groups.map(g => [g.id, g]));
  const buckets = new Map();
  for (const c of cs) {
    const key = c.groupId && groupsById.has(c.groupId) ? c.groupId : '__ungrouped';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  const groupKeys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === '__ungrouped') return 1;
    if (b === '__ungrouped') return -1;
    return (groupsById.get(a)?.name || '').localeCompare(groupsById.get(b)?.name || '', 'vi');
  });
  const groupedCount = groupKeys.filter(k => k !== '__ungrouped').length;
  const summary = document.createElement('div');
  summary.className = 'creator-summary';
  summary.innerHTML = `<span>Tổng <b>${formatNumber(cs.length)}</b> Creator</span><span>·</span><span><b>${formatNumber(groupedCount)}</b> nhóm có thành viên</span>`;
  list.appendChild(summary);
  for (const key of groupKeys) {
    const members = buckets.get(key).slice().sort((a, b) => (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi'));
    const group = groupsById.get(key);
    const groupName = group?.name || 'Chưa thuộc nhóm';
    const groupColor = group?.color || '#9CA3AF';
    const isCollapsed = collapsedCreatorGroups.has(key);
    const groupWrap = document.createElement('div');
    groupWrap.className = `creator-group${isCollapsed ? ' is-collapsed' : ''}`;
    groupWrap.innerHTML = `
      <button class="creator-group-head" type="button" data-toggle-group="${escapeAttr(key)}">
        <span class="creator-group-title"><i class="creator-group-color" style="background:${escapeAttr(groupColor)}"></i>${escapeHtml(groupName)}</span>
        <span class="creator-group-meta">${formatNumber(members.length)} thành viên · ${isCollapsed ? 'Hiện' : 'Ẩn'}</span>
      </button>
      <div class="creator-group-body"></div>
    `;
    const body = groupWrap.querySelector('.creator-group-body');
    for (const c of members) {
      body.appendChild(createCreatorRow(c, group));
    }
    list.appendChild(groupWrap);
  }
  list.querySelectorAll('[data-toggle-group]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.toggleGroup;
    if (collapsedCreatorGroups.has(key)) collapsedCreatorGroups.delete(key);
    else collapsedCreatorGroups.add(key);
    renderCreators();
  }));
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editCreator(b.dataset.edit)));
  list.querySelectorAll('[data-gift]').forEach(b => {
    const handler = () => pickCreatorGiftQuick(b.dataset.gift);
    b.addEventListener('click', handler);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
  list.querySelectorAll('[data-gift-clear]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    clearCreatorGiftQuick(b.dataset.giftClear);
  }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Xoá Creator này?')) return;
    await window.api.creators.remove(b.dataset.del);
    await refreshCreators();
    toast('Đã xoá Creator', 'success');
  }));
}

async function updateCreatorQuick(creator) {
  await window.api.creators.upsert(creator);
  await refreshCreators();
  toast('🔄 Đã cập nhật Creator', 'success');
}

// Bấm trực tiếp vào ô quà ở mỗi dòng Creator để chọn/đổi quà mặc định
async function pickCreatorGiftQuick(id) {
  const c = creators.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!c) { toast('Không tìm thấy Creator này', 'error'); return; }
  const usedBy = creatorGiftUsage(c.id || '', c.groupId || '');
  const g = await GiftPicker.open({
    title: `🎁 Chọn quà mặc định cho ${c.nickname || c.tiktokId}`,
    disabledIds: Object.keys(usedBy),
    usedBy,
  });
  if (!g) return;
  await window.api.creators.upsert({
    ...c,
    defaultGiftId: g.id ? String(g.id) : '',
    defaultGiftName: g.name || '',
    defaultGiftIcon: g.icon || '',
  });
  await refreshCreators();
  toast(`🎁 Đã đặt quà "${g.name}" cho ${c.nickname || c.tiktokId}`, 'success');
}

// Gỡ quà mặc định của creator (nút "x") — về trạng thái chưa đặt quà.
async function clearCreatorGiftQuick(id) {
  const c = creators.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!c) { toast('Không tìm thấy Creator này', 'error'); return; }
  if (!c.defaultGiftId && !c.defaultGiftName) return;
  await window.api.creators.upsert({ ...c, defaultGiftId: '', defaultGiftName: '', defaultGiftIcon: '' });
  await refreshCreators();
  toast(`🗑 Đã gỡ quà mặc định của ${c.nickname || c.tiktokId}`, 'success');
}

// Chip UID nhận quà cho mỗi dòng thành viên: có UID → tích xanh + số (phát hiện nhanh ai đã lấy),
// chưa có → cảnh báo vàng để biết cần "Lấy UID". Dùng chung cho danh sách Creator + Hồ sơ nhóm.
function uidBadge(c) {
  const uid = c && c.userId ? String(c.userId) : '';
  return uid
    ? `<span class="cc-uid ok" title="UID nhận quà: ${escapeAttr(uid)}">✓ UID ${escapeHtml(uid)}</span>`
    : `<span class="cc-uid no" title="Chưa có UID nhận quà — bấm Cài đặt rồi 🎯 Lấy UID">⚠ Chưa có UID</span>`;
}

function createCreatorRow(c, g) {
  const creatorKey = c.id || c.tiktokId || '';
  const div = document.createElement('div');
  div.className = 'creator-card';
  div.innerHTML = `
      <img class="cc-ava" src="${escapeAttr(c.avatar || '../logo/hp-logo.png')}" />
      <div class="cc-body">
        <div class="cc-meta">
          <span class="cc-name">${escapeHtml(c.nickname || c.tiktokId)}</span>
          <span>@${escapeHtml(c.tiktokId)}</span>
        </div>
        <div class="cc-meta">
          ${g ? `<span class="cc-group-pill" style="background:${escapeAttr(g.color || '#FE2C55')}">${escapeHtml(g.name)}</span>` : '<span>Chưa thuộc nhóm</span>'}
          ${uidBadge(c)}
        </div>
        <div class="cc-gift-wrap">
          <div class="cc-gift cc-gift-pick" data-gift="${escapeAttr(creatorKey)}" role="button" tabindex="0" title="Bấm để chọn quà mặc định">
            ${c.defaultGiftIcon ? `<img src="${escapeAttr(c.defaultGiftIcon)}" />` : '🎁'}
            <span>${escapeHtml(c.defaultGiftName || '(chưa đặt quà mặc định)')}</span>
            <span class="cc-gift-edit">✏️</span>
          </div>
          ${(c.defaultGiftId || c.defaultGiftName) ? `<button class="cc-gift-clear" data-gift-clear="${escapeAttr(creatorKey)}" type="button" title="Gỡ quà mặc định">✕</button>` : ''}
        </div>
      </div>
      <div class="cc-actions">
        <button class="ghost tiny" data-edit="${escapeAttr(creatorKey)}" type="button">Cài đặt</button>
        <button class="warn tiny" data-del="${escapeAttr(creatorKey)}" type="button" title="Xoá">🗑</button>
      </div>
    `;
  return div;
}

function renderCreatorGroupSelect() {
  const sel = $('#crGroup');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Không thuộc nhóm —</option>';
  for (const g of visibleGroups()) {
    const opt = document.createElement('option');
    opt.value = g.id; opt.textContent = g.name;
    sel.appendChild(opt);
  }
  // Ở chế độ nhóm, mặc định gán creator mới vào nhóm đang chọn
  sel.value = activeGroupId ? activeGroupId : current;
}

// ===== Chế độ NHÓM | TALENT SHOW =====
function renderModeSelect() {
  const sel = $('#modeSelect');
  if (!sel) return;
  // Nếu nhóm đang chọn đã bị xóa thì tự về TALENT SHOW
  if (activeGroupId && !groups.some(g => g.id === activeGroupId)) activeGroupId = '';
  // Xếp theo KIM CƯƠNG giảm dần + vương miện top 1/2/3 (giống màn Chọn nhóm & Hồ Sơ Nhóm).
  sel.innerHTML = '<option value="">🎤 TALENT SHOW (Tất cả)</option>' +
    groupsByKc(groups).map(g => {
      const crown = kcCrown(kcRankOf(g.id));
      return `<option value="${escapeAttr(g.id)}">${crown ? crown + ' ' : '👥 '}${escapeHtml(g.name || g.tiktokId || 'Nhóm')}</option>`;
    }).join('');
  sel.value = activeGroupId;
  const bar = $('#bottomLive');
  if (bar) bar.classList.toggle('mode-group', !!activeGroupId);
}

async function setActiveGroup(id) {
  const nextGroupId = String(id || '');
  const changeSeq = ++activeGroupChangeSeq;
  const prevGroupId = activeGroupId; // để biết lựa chọn nhóm có ĐỔI thật không (chỉ auto khi đổi)
  activeGroupId = nextGroupId;
  // Đổi nhóm (nhất là chọn từ launcher "bên ngoài") → NẠP LẠI Creator/Nhóm mới nhất từ main
  // (avatar vừa fetch, thành viên vừa đổi) để vào APP hiện ĐẦY ĐỦ thông tin + avatar nhóm mới,
  // không dính dữ liệu cũ trong bộ nhớ renderer.
  try {
    creators = await window.api.creators.list();
    groups = await window.api.groups.list();
    await refreshGroupProfiles?.();
  } catch {}
  // Người dùng đổi nhanh nhiều nhóm: chỉ lần chọn mới nhất mới được phép cập nhật UI/lưu ID.
  if (changeSeq !== activeGroupChangeSeq) return false;
  // Nhóm vừa chọn không còn tồn tại → về TALENT SHOW cho an toàn.
  if (activeGroupId && !groups.some(g => g.id === activeGroupId)) activeGroupId = '';
  // Đồng bộ dropdown Chế độ (khi gọi từ launcher/lập trình, không phải từ sự kiện change).
  const sel = $('#modeSelect');
  if (sel && sel.value !== activeGroupId) sel.value = activeGroupId;
  const bar = $('#bottomLive');
  if (bar) bar.classList.toggle('mode-group', !!activeGroupId);
  // ID LIVE và tuỳ chọn tự kết nối là dữ liệu RIÊNG từng nhóm. Khi ĐỔI nhóm thật → nạp lại ID theo
  // đúng nhóm mới (kể cả đang kết nối) để không hiện id nhóm khác; refresh nền cùng nhóm thì giữ nguyên.
  syncLiveConnectionUi(activeGroupId, true, activeGroupId !== prevGroupId);
  savedActiveGroupId = activeGroupId;
  window.api.settings.set({ lastActiveGroupId: activeGroupId }).catch(() => {});
  // Chọn nhóm từ launcher/popup không tự phát sự kiện change. Đồng bộ select PK Nhóm về nhóm mới
  // và nạp lại hồ sơ/thành viên đầy đủ (kể cả khi giá trị select trùng) → luôn thấy đúng nhóm mới.
  // selectAllPkGroupMembers chỉ điền khi participants rỗng nên không ghi đè lựa chọn thủ công.
  const pkgGroup = $('#pkgGroup');
  if (activeGroupId && pkgGroup) {
    pkgGroup.value = activeGroupId;
    if (pkGroupCfg) pkgGroup.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // 🏆 THI ĐẤU NHÓM: chọn RIÊNG 1 nhóm → tên nhóm lặp lại thừa ở mọi hàng → TỰ tắt cho thanh gọn (thấp) hơn;
  // về TALENT SHOW (nhiều nhóm) → tự bật lại. Chỉ chạy khi lựa chọn NHÓM thực sự đổi (không đè chỉnh tay giữa chừng).
  if (activeGroupId !== prevGroupId) {
    window.api.ranking.setConfig({ showGroupName: !activeGroupId }).catch(() => {});
  }
  if (activeGroupId && kcCfg) {
    applyKcDefaultMembers(activeGroupId);
    scheduleKcAutoSave();
  }
  applyActiveGroupMode();
  return true;
}

// Bật/tắt 🏆 Chế độ thi đấu (đồng bộ STT sang THI ĐẤU NHÓM). silent=true dùng khi tự đổi theo chế độ (không toast/không hỏi).
async function lwApplyContest(enabled, { silent = false } = {}) {
  if (!lwCfg) return;
  if ($('#lwAutoContest')) $('#lwAutoContest').checked = enabled;
  lwCfg.autoContest = enabled;
  if (!enabled) lwInvalidateContestSpin();
  const recovered = enabled ? lwRestoreLegacyContestAssignments() : 0;
  await lwPush();
  const shown = await window.api.ranking.setConfig({ showPerfOrder: enabled }).catch(() => null);
  const tracked = (lwCfg.segments || []).some(s => s.contestCreatorId && Number(s.contestOrder) > 0);
  let synced = true;
  if (enabled && (tracked || recovered)) synced = !!(await lwSyncContestPerfOrders())?.ok;
  lwContestDupArm = null;
  $('#lwSpinnerSel')?.classList.remove('lw-invalid');
  const rankingState = await window.api.ranking.getState().catch(() => null);
  if (rankingState) renderRkPreview(rankingState);
  if (silent) return;
  if (!shown || !synced) { toast('Không thể đồng bộ STT thi đấu', 'error'); return; }
  if (enabled) toast(recovered ? `Đã bật Chế độ thi đấu và khôi phục STT cho ${recovered} Creator` : 'Đã bật Chế độ thi đấu, STT hiển thị lại trên THI ĐẤU NHÓM', 'success');
  else toast('Đã tắt Chế độ thi đấu, STT tạm ẩn trên THI ĐẤU NHÓM', 'success');
}

function applyActiveGroupMode() {
  // 🏆 Chế độ thi đấu MẶC ĐỊNH theo chế độ: TALENT SHOW (mở tất cả) → bật; chọn NHÓM → tắt. Vẫn cho bật/tắt tay sau đó.
  if (lwCfg) {
    const contestDefault = !activeGroupId;
    if (lwCfg.autoContest !== contestDefault) lwApplyContest(contestDefault, { silent: true }).catch(() => {});
  }
  renderCreators();
  renderGroups();
  renderCreatorGroupSelect();
  renderPkCreatorSelects?.();
  renderPkGroupGroupSelect?.();
  renderPkGroupMembers?.();
  renderScoreCreatorSelect?.();
  renderKcCreatorSelects?.();
  renderKcCreatorSelects?.();
  // Sticker Dance: mỗi nhóm một bảng quà riêng ('' = TALENT SHOW dùng file gốc).
  switchStickerGroup?.(activeGroupId);
  // Menu Quà: mỗi nhóm một bảng menu riêng.
  switchGiftMenuGroup?.(activeGroupId);
  // Vinh danh: cập nhật lại danh sách Creator theo nhóm đang chọn.
  mvpRefreshCreatorSelect?.();
  // Vòng quay: danh sách người quay theo nhóm đang chọn.
  lwRefreshSpinners?.();
  // NHẠC DANCE: mỗi nhóm một danh sách quà riêng, tự thêm Creator của nhóm & loại nhóm khác.
  switchMusicGroup?.(activeGroupId);
  // Ranking gom dữ liệu ở main process → đẩy bộ lọc xuống engine
  window.api.ranking?.setConfig({ activeGroupId }).catch(() => {});
}

// ============================================================
// Launcher chọn nhóm khi mở app (Netflix-style profile picker)
// ============================================================
let launcherSelId = null; // null = chưa chọn; '' = TALENT SHOW; id = nhóm cụ thể
let launcherMandatory = false; // true = màn chọn nhóm bắt buộc khi mở app (không cho X/Esc thoát)
let launcherEntering = false;

function membersOfGroup(groupId) {
  return creators.filter(c => c.groupId === groupId);
}

// ===== KIM CƯƠNG TỔNG theo nhóm =====
// Lấy từ sheet DAILY DATA (khớp tiktokId KÊNH ĐẠI DIỆN nhóm ↔ cột C, Kim cương ở cột H).
// Dùng để xếp hạng nhóm cao→thấp + gắn vương miện top 1/2/3 ở màn Chọn nhóm và Hồ Sơ Nhóm.
let kcData = { byGroup: {}, total: 0, totalDeltaPct: null, period: '', fetchedAt: 0, rank: {} };
let kcLoading = false;

function kcOfGroup(gid) {
  const e = kcData.byGroup[gid];
  return e && e.kc != null ? e.kc : null;
}
function kcDeltaOf(gid) {
  const e = kcData.byGroup[gid];
  return e && e.deltaPct != null ? e.deltaPct : null;
}
function kcRankOf(gid) { return kcData.rank[gid] || null; }
// Vương miện top 1/2/3 (top1 = 👑, top2 = 🥈, top3 = 🥉).
function kcCrown(rank) { return rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ''; }

// Badge "so với tháng trước": xanh ▲ tăng, đỏ ▼ giảm (dùng % chuẩn hóa của sheet).
function kcDeltaBadge(delta) {
  if (delta == null || !isFinite(delta)) return '';
  const cls = delta > 0 ? 'is-up' : (delta < 0 ? 'is-down' : 'is-flat');
  const arrow = delta > 0 ? '▲' : (delta < 0 ? '▼' : '▬');
  const sign = delta > 0 ? '+' : '';
  const val = `${sign}${delta.toFixed(2)}%`.replace('.', ',');
  return `<span class="kc-delta ${cls}" title="So với tháng trước (chuẩn hóa theo kỳ)">${arrow} ${val}</span>`;
}

// Rút gọn "2026-07-01 ~ 2026-07-22" → "22/07/2026" (lấy mốc cuối kỳ).
function kcPeriodLabel(period) {
  const s = String(period || '').trim();
  if (!s) return '';
  const end = (s.split('~').pop() || s).trim();
  const m = end.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${String(m[3]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}/${m[1]}`;
  return end;
}

// Sắp xếp nhóm theo Kim cương giảm dần (nhóm chưa có số KC xếp cuối, giữ thứ tự gốc).
function groupsByKc(list) {
  return list.slice().sort((a, b) => {
    const ka = kcOfGroup(a.id), kb = kcOfGroup(b.id);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return kb - ka;
  });
}

// Nạp KC (throttle 60s trừ khi force). Xong thì vẽ lại các màn đang mở.
async function loadKcData(force = false) {
  if (kcLoading) return kcData;
  if (!force && kcData.fetchedAt && Date.now() - kcData.fetchedAt < 60000) return kcData;
  kcLoading = true;
  try {
    const r = await window.api?.kc?.getGroups?.();
    if (r && r.byGroup) {
      kcData.byGroup = r.byGroup;
      kcData.total = Number(r.total) || 0;
      kcData.totalDeltaPct = (r.totalDeltaPct == null ? null : Number(r.totalDeltaPct));
      kcData.period = r.period || '';
      kcData.fetchedAt = Date.now();
      const ranked = Object.values(r.byGroup).filter(x => x && x.kc != null).sort((a, b) => b.kc - a.kc);
      const rank = {};
      ranked.forEach((x, i) => { rank[x.groupId] = i + 1; });
      kcData.rank = rank;
      applyKcToUi();
    }
  } catch { /* offline: giữ số cũ */ }
  finally { kcLoading = false; }
  return kcData;
}

// Vẽ lại các màn có hiển thị KC (nếu đang mở).
function applyKcToUi() {
  renderModeSelect(); // dropdown "CHẾ ĐỘ / NHÓM" xếp lại theo KC khi có dữ liệu mới
  if (!$('#groupLauncher')?.hidden) { renderGroupLauncher(); markLauncherSelection(); }
  if (document.querySelector('.panel[data-panel="groups"]')?.classList.contains('active')) {
    try { renderGroups(); } catch {}
  }
}

// ===== Kim cương 12 tháng (chỉ dùng cho chart trong Hồ Sơ Nhóm đầy đủ) =====
let kcMonths = { byGroup: {}, fetchedAt: 0 };
let kcMonthsLoading = false;

async function loadKcMonths(force = false) {
  if (kcMonthsLoading) return kcMonths;
  if (!force && kcMonths.fetchedAt && Date.now() - kcMonths.fetchedAt < 3 * 3600 * 1000) return kcMonths;
  kcMonthsLoading = true;
  try {
    const r = await window.api?.kc?.getMonths?.();
    if (r && r.byGroup) { kcMonths.byGroup = r.byGroup; kcMonths.fetchedAt = r.fetchedAt || Date.now(); }
  } catch { /* offline: giữ số cũ */ }
  finally { kcMonthsLoading = false; }
  return kcMonths;
}

// Rút gọn số KC cho nhãn chart: 1.200.000 → "1,2M", 913000 → "913k".
function kcShort(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

// Vẽ chart cột 6 tháng gần nhất vào hồ sơ nhóm (bất đồng bộ: nạp xong mới vẽ).
async function drawGroupTrend(gid) {
  const sel = `.gd-trend[data-gid="${gid}"] .gd-trend-chart`;
  await loadKcMonths();
  const wrap = document.querySelector(sel);
  if (!wrap) return; // hồ sơ đã đổi/đóng
  const series = (kcMonths.byGroup[gid] || []).filter(x => x && x.kc != null);
  // Chỉ lấy các tháng ĐÃ HOÀN THÀNH của năm nay (m < tháng hiện tại) để tránh dữ liệu tháng lẻ/năm cũ.
  const curMonth = new Date().getMonth() + 1;
  let done = series.filter(x => x.m < curMonth);
  if (!done.length) done = series.slice();
  const data = done.slice(-6);
  const subEl = document.querySelector(`.gd-trend[data-gid="${gid}"] .gd-trend-sub`);
  if (!data.length) { wrap.innerHTML = '<div class="hint">Chưa có dữ liệu tháng.</div>'; if (subEl) subEl.textContent = ''; return; }
  const g = groups.find(x => x.id === gid);
  const color = (g && g.color) || colorFromId((g && (g.tiktokId || g.id)) || gid);
  const max = Math.max(...data.map(d => d.kc), 1);
  const H = 128; // chiều cao cột tối đa (px)
  const hi = data.reduce((a, b) => b.kc > a.kc ? b : a);
  const lo = data.reduce((a, b) => b.kc < a.kc ? b : a);
  wrap.innerHTML = data.map((d) => {
    const px = Math.max(6, Math.round(d.kc / max * H));
    const cls = d === hi ? ' is-hi' : (d === lo ? ' is-lo' : '');
    const cur = d === data[data.length - 1] ? ' is-cur' : '';
    return `<div class="gd-bar${cls}${cur}">
      <span class="gd-bar-val">${kcShort(d.kc)}</span>
      <span class="gd-bar-col" style="height:${px}px;--c:${escapeAttr(color)}"></span>
      <span class="gd-bar-m">T${d.m}</span>
    </div>`;
  }).join('');
  // Phụ đề: MoM 2 tháng gần nhất trong chart.
  if (subEl && data.length >= 2) {
    const a = data[data.length - 2].kc, b = data[data.length - 1].kc;
    const pct = a > 0 ? (b / a - 1) * 100 : null;
    subEl.innerHTML = pct == null ? '' : `T${data[data.length - 1].m} vs T${data[data.length - 2].m}: ${kcDeltaBadge(pct)}`;
  } else if (subEl) subEl.textContent = '';
}

// Dựng dãy avatar thành viên (chồng nhau) + "+N" nếu vượt quá.
function memberAvatarStack(members, max = 6) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  const imgs = shown.map(m =>
    `<img class="lc-mini" src="${escapeAttr(m.avatar || '../logo/hp-logo.png')}" title="${escapeAttr(m.nickname || m.tiktokId || '')}" onerror="this.onerror=null;this.src='../logo/hp-logo.png'" />`
  ).join('');
  const more = extra > 0 ? `<span class="lc-more">+${extra}</span>` : '';
  return (imgs || more) ? (imgs + more) : '<span class="lc-empty">Chưa có thành viên</span>';
}

function renderGroupLauncher() {
  const grid = $('#launcherGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const hasKc = Object.keys(kcData.byGroup || {}).length > 0;
  const periodLabel = kcPeriodLabel(kcData.period);

  // Lớp KIM CƯƠNG TỔNG — băng ngang đầu lưới (tổng KC toàn bộ nhóm + mốc thời gian).
  const band = document.createElement('div');
  band.className = 'lc-kc-band';
  band.innerHTML = `
    <span class="lc-kc-band-ic">💎</span>
    <span class="lc-kc-band-main">
      <span class="lc-kc-band-label">KIM CƯƠNG TỔNG</span>
      <span class="lc-kc-band-valrow">
        <span class="lc-kc-band-val">${hasKc ? formatNumber(kcData.total) : '—'}</span>
        ${hasKc ? kcDeltaBadge(kcData.totalDeltaPct) : ''}
      </span>
    </span>
    <span class="lc-kc-band-sub">${periodLabel ? `Tính đến ${periodLabel}` : (kcLoading ? 'Đang tải dữ liệu…' : 'Xếp hạng theo Kim cương')}</span>
  `;
  grid.appendChild(band);

  // Thẻ TALENT SHOW (tất cả nhóm) — hero
  const hero = document.createElement('button');
  hero.type = 'button';
  hero.className = 'lc-card lc-hero';
  hero.dataset.gid = '';
  hero.innerHTML = `
    <span class="lc-check">✓</span>
    <img class="lc-ava" src="../logo/hp-logo.png" alt="" />
    <span class="lc-hero-text">
      <span class="lc-name">🎤 TALENT SHOW</span>
      <span class="lc-handle">Tất cả nhóm — gộp toàn bộ Creator</span>
      <span class="lc-count">${formatNumber(creators.length)} Creator · ${formatNumber(groups.length)} nhóm</span>
    </span>
    ${hasKc ? `<span class="lc-kc lc-kc-total">💎 ${formatNumber(kcData.total)}</span>` : ''}
    <span class="lc-members">${memberAvatarStack(creators, 8)}</span>
  `;
  grid.appendChild(hero);

  // Thẻ từng nhóm — xếp theo Kim cương cao→thấp
  for (const g of groupsByKc(groups)) {
    const members = membersOfGroup(g.id);
    const color = g.color || colorFromId(g.tiktokId || g.id);
    const kc = kcOfGroup(g.id);
    const delta = kcDeltaOf(g.id);
    const rank = kcRankOf(g.id);
    const crown = kcCrown(rank);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'lc-card' + (crown ? ' lc-top lc-top-' + rank : '');
    card.dataset.gid = g.id;
    card.innerHTML = `
      <span class="lc-check">✓</span>
      ${crown ? `<span class="lc-crown" title="Hạng ${rank}">${crown}</span>` : ''}
      <img class="lc-ava" src="${escapeAttr(g.avatar || '../logo/hp-logo.png')}" alt="" style="border-color:${escapeAttr(color)}" onerror="this.onerror=null;this.src='../logo/hp-logo.png'" />
      <span class="lc-name">${escapeHtml(g.name || g.tiktokId || 'Nhóm')}</span>
      <span class="lc-handle">@${escapeHtml(g.tiktokId || '—')}</span>
      ${kc != null ? `<span class="lc-kc-row"><span class="lc-kc">💎 ${formatNumber(kc)}</span>${kcDeltaBadge(delta)}</span>` : ''}
      ${g.mc ? `<span class="lc-role">🎤 MC: ${escapeHtml(g.mc)}</span>` : ''}
      ${g.manager ? `<span class="lc-role">🛡️ Quản lý: ${escapeHtml(g.manager)}</span>` : ''}
      <span class="lc-count">${formatNumber(members.length)} thành viên</span>
      <span class="lc-members">${memberAvatarStack(members, 6)}</span>
    `;
    grid.appendChild(card);
  }

  // Chọn 1 lần / vào ngay khi bấm đúp
  grid.querySelectorAll('.lc-card').forEach(card => {
    card.addEventListener('click', () => selectLauncher(card.dataset.gid));
    card.addEventListener('dblclick', () => { selectLauncher(card.dataset.gid); enterFromLauncher(); });
  });
}

function selectLauncher(gid) {
  launcherSelId = gid == null ? null : gid;
  markLauncherSelection();
}

function markLauncherSelection() {
  const grid = $('#launcherGrid');
  if (!grid) return;
  grid.querySelectorAll('.lc-card').forEach(c => c.classList.toggle('is-selected', c.dataset.gid === (launcherSelId ?? '\0')));
  const pick = $('#launcherPick');
  const enter = $('#launcherEnter');
  if (launcherSelId == null) {
    if (pick) pick.textContent = 'Chưa chọn — bấm vào một nhóm hoặc TALENT SHOW';
    if (enter) enter.disabled = true;
    return;
  }
  const g = launcherSelId ? groups.find(x => x.id === launcherSelId) : null;
  const name = g ? (g.name || g.tiktokId || 'Nhóm') : 'TALENT SHOW (Tất cả nhóm)';
  const roles = g ? [g.mc ? `🎤 MC: ${escapeHtml(g.mc)}` : '', g.manager ? `🛡️ Quản lý: ${escapeHtml(g.manager)}` : ''].filter(Boolean).join(' · ') : '';
  if (pick) pick.innerHTML = `Đang chọn: <b>${escapeHtml(name)}</b>${roles ? ` <span class="lc-pick-roles">${roles}</span>` : ''}`;
  if (enter) enter.disabled = false;
}

function openGroupLauncher(mandatory = false) {
  const ov = $('#groupLauncher');
  if (!ov) return;
  launcherMandatory = !!mandatory;
  renderGroupLauncher();
  // Bắt buộc (mở app): buộc chọn chủ động, ẩn nút X. Mở lại trong app: chọn sẵn nhóm hiện tại.
  launcherSelId = mandatory ? null : (activeGroupId || '');
  const closeBtn = $('#launcherClose');
  if (closeBtn) closeBtn.hidden = launcherMandatory;
  markLauncherSelection();
  hideBootSplash(); // để lộ màn chọn nhóm (splash nằm trên launcher)
  ov.hidden = false;
  // Lấy lại avatar nhóm nếu URL đã hết hạn (mở app lâu rồi mới mở lại màn chọn nhóm).
  autoRefetchStaleAvatars();
  // Nạp KIM CƯƠNG TỔNG (sheet DAILY DATA) rồi tự vẽ lại xếp hạng + vương miện.
  loadKcData();
}

function closeGroupLauncher() {
  if (launcherMandatory) return; // màn bắt buộc: chỉ thoát bằng cách chọn nhóm rồi "Vào ứng dụng"
  const ov = $('#groupLauncher');
  if (ov) ov.hidden = true;
}

async function enterFromLauncher() {
  if (launcherSelId == null || launcherEntering) return; // chưa chọn → không cho vào
  const selectedId = launcherSelId;
  launcherEntering = true;
  const enter = $('#launcherEnter');
  if (enter) enter.disabled = true;
  try {
    await setActiveGroup(selectedId);
    if (activeGroupId !== selectedId) return;
    launcherMandatory = false; // đã chọn hợp lệ → mở khoá để đóng màn
    closeGroupLauncher();
    const g = selectedId ? groups.find(x => x.id === selectedId) : null;
    toast(g ? `👥 Vào nhóm: ${g.name || g.tiktokId}` : '🎤 Vào TALENT SHOW (tất cả nhóm)', 'success');
  } finally {
    launcherEntering = false;
    if (!$('#groupLauncher')?.hidden) markLauncherSelection();
  }
}

function wireGroupLauncher() {
  $('#launcherEnter')?.addEventListener('click', enterFromLauncher);
  $('#launcherClose')?.addEventListener('click', closeGroupLauncher);
  $('#openLauncherBtn')?.addEventListener('click', () => { closeConnectModal(); openGroupLauncher(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#groupLauncher')?.hidden) closeGroupLauncher();
    if (e.key === 'Enter' && !$('#groupLauncher')?.hidden && launcherSelId != null) enterFromLauncher();
  });
}

function clearCreatorForm() {
  currentEditingCreator = null;
  $('#crTiktokId').value = '';
  $('#crNickname').value = '';
  $('#crGroup').value = '';
  $('#crAvatarUrl').value = '';
  $('#crAvatarPreview').src = '../logo/hp-logo.png';
  $('#crChannel').textContent = '';
  if ($('#crUserId')) $('#crUserId').value = '';
  setCreatorGiftDisplay(null);
}

function setCreatorGiftDisplay(g) {
  $('#crGiftId').value = g?.id || '';
  $('#crGiftName').value = g?.name || '';
  $('#crGiftIcon').value = g?.icon || '';
  $('#crGiftDisplay').textContent = g ? `${g.name} · 🪙 ${g.diamond}` : '🎁 Chọn quà';
  $('#crGiftIconPreview').src = g?.icon || '';
  const clearBtn = $('#btnClearCrGift');
  if (clearBtn) clearBtn.hidden = !g;
}

function editCreator(id) {
  const c = creators.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!c) { toast('Không tìm thấy Creator này', 'error'); return; }
  currentEditingCreator = c;
  $('#crTiktokId').value = c.tiktokId || '';
  $('#crNickname').value = c.nickname || '';
  $('#crGroup').value = c.groupId || '';
  $('#crAvatarUrl').value = c.avatar || '';
  $('#crAvatarPreview').src = c.avatar || '../logo/hp-logo.png';
  $('#crChannel').textContent = c.channelName || '';
  if ($('#crUserId')) $('#crUserId').value = c.userId || '';
  if (c.defaultGiftId || c.defaultGiftName) {
    const m = giftMaster.find(g => String(g.id) === String(c.defaultGiftId)) || giftMaster.find(g => g.name.toLowerCase() === String(c.defaultGiftName || '').toLowerCase());
    setCreatorGiftDisplay(m || { id: c.defaultGiftId, name: c.defaultGiftName, icon: c.defaultGiftIcon, diamond: 0 });
  } else {
    setCreatorGiftDisplay(null);
  }
  // Scroll to top form
  $('#crTiktokId').focus();
  $('#crTiktokId').scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(`✏️ Đang sửa: ${c.nickname || c.tiktokId}`);
}

function wireCreatorTab() {
  $('#btnPickCrGift').addEventListener('click', async () => {
    const usedBy = creatorGiftUsage(currentEditingCreator?.id || '', $('#crGroup')?.value ?? (currentEditingCreator?.groupId || ''));
    const g = await GiftPicker.open({
      title: '🎁 Chọn quà mặc định cho Creator',
      disabledIds: Object.keys(usedBy),
      usedBy,
    });
    if (g) setCreatorGiftDisplay(g);
  });

  $('#btnClearCrGift').addEventListener('click', () => {
    setCreatorGiftDisplay(null);
    toast('Đã gỡ quà mặc định (nhớ bấm 💾 Lưu)');
  });

  // Chỉ tải khi bấm nút hoặc Enter. Avatar đã lưu là nguồn cho mọi overlay,
  // nên mở/sửa Creator không được tự gọi lại TikTok ID.
  let lastFetchedId = '';
  async function autoFetchCreator(force = false) {
    const u = $('#crTiktokId').value.trim().replace(/^@/, '');
    if (!u) { toast('Nhập TikTok ID trước đã.', 'error'); return; }
    if (!force && u === lastFetchedId) return;
    lastFetchedId = u;
    $('#crSpinner').hidden = false;
    $('#btnLoadCreator').disabled = true;
    try {
      const p = await window.api.tt.fetchProfile(u).catch(() => ({ found: false }));
      // Mạng có thể trả rỗng (tikwm giới hạn tần suất, oembed đã bỏ avatar). Bù bằng dữ liệu
      // đã lưu của cùng TikTok ID để "bấm Tải" luôn ra avatar/nickname nếu ID này từng có.
      const known = knownProfileForTiktokId(u, currentEditingCreator?.id);
      const nickname = cleanNickname(p.nickname || known?.nickname || '');
      const avatar = p.avatar || known?.avatar || '';
      if (nickname) {
        if (!$('#crNickname').value || !currentEditingCreator) $('#crNickname').value = nickname;
        $('#crChannel').textContent = nickname;
      }
      if (avatar) {
        $('#crAvatarUrl').value = avatar;
        $('#crAvatarPreview').src = avatar;
      } else {
        $('#crAvatarUrl').value = '';
        $('#crAvatarPreview').src = '../logo/hp-logo.png';
      }
      // ID nhận quà (= toMemberId của gift). Đã kiểm chứng tikwm user.id KHỚP toMemberId,
      // nên "Tải" tự điền ID đúng. Chỉ điền khi ô trống — không đè ID đã học/nhập tay.
      if (p.userId && $('#crUserId') && !$('#crUserId').value.trim()) {
        $('#crUserId').value = p.userId;
      }
      if (avatar || nickname) {
        toast(p.avatar ? 'Đã tải Nick Name và Avatar' : (avatar ? 'Đã dùng lại avatar đã lưu của ID này' : 'Đã tải Nick Name'), 'success');
      } else {
        toast('Không tìm thấy profile, vẫn có thể lưu thủ công.', 'error');
      }
    } catch (e) { toast('Không tải được profile: ' + (e.message || 'lỗi không xác định'), 'error'); }
    finally {
      $('#crSpinner').hidden = true;
      $('#btnLoadCreator').disabled = false;
    }
  }
  $('#crTiktokId').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); autoFetchCreator(true); }
  });
  // Gõ đúng TikTok ID đã có trong máy → tự điền avatar/nickname NGAY (offline), khỏi bấm Tải.
  // Chỉ điền vào ô đang trống và khi THÊM MỚI (không đè khi đang sửa thành viên có sẵn).
  $('#crTiktokId').addEventListener('input', () => {
    if (currentEditingCreator) return;
    const known = knownProfileForTiktokId($('#crTiktokId').value);
    if (!known) return;
    if (!$('#crAvatarUrl').value.trim() && known.avatar) {
      $('#crAvatarUrl').value = known.avatar;
      $('#crAvatarPreview').src = known.avatar;
    }
    if (!$('#crNickname').value.trim() && known.nickname) {
      $('#crNickname').value = cleanNickname(known.nickname);
      $('#crChannel').textContent = $('#crNickname').value;
    }
  });
  $('#btnLoadCreator').addEventListener('click', () => autoFetchCreator(true));

  $('#btnNewCreator').addEventListener('click', () => { clearCreatorForm(); lastFetchedId = ''; });
  $('#btnRefreshCreatorInfo').addEventListener('click', async () => {
    await refreshGroups();
    await refreshCreators();
    await window.api.ranking.setConfig({});
    toast('🔄 Đã cập nhật thông tin đã setup', 'success');
  });

  $('#btnSaveCreator').addEventListener('click', async () => {
    const tiktokId = $('#crTiktokId').value.trim().replace(/^@/, '');
    if (!tiktokId) { toast('Cần nhập TikTok ID', 'error'); return; }
    const giftId = $('#crGiftId').value.trim();
    // Chỉ chặn trùng quà trong CÙNG NHÓM — khác nhóm được phép dùng lại.
    const grp = String($('#crGroup').value || '');
    const owner = giftId ? creators.find(c => c.id !== currentEditingCreator?.id && String(c.groupId || '') === grp && String(c.defaultGiftId) === String(giftId)) : null;
    if (owner) {
      toast(`Quà này đã được chọn bởi ${owner.nickname || owner.tiktokId || 'Creator khác'} trong nhóm này`, 'error');
      return;
    }
    // TỰ ĐỘNG CẬP NHẬT AVATAR: nếu chưa có avatar (user không bấm Tải, hoặc mạng lỗi) mà TikTok ID
    // này đã từng lưu ở creator/nhóm khác → dùng lại avatar đã biết ngay, khỏi để trơ logo HP.
    let avatarVal = $('#crAvatarUrl').value.trim();
    let nickVal = $('#crNickname').value.trim();
    if (!avatarVal || !nickVal) {
      const known = knownProfileForTiktokId(tiktokId, currentEditingCreator?.id);
      if (!avatarVal && known?.avatar) avatarVal = known.avatar;
      if (!nickVal && known?.nickname) nickVal = known.nickname;
    }
    const payload = {
      id: currentEditingCreator?.id,
      tiktokId,
      nickname: nickVal || tiktokId,
      channelName: $('#crChannel').textContent || '',
      groupId: $('#crGroup').value,
      avatar: avatarVal,
      defaultGiftName: $('#crGiftName').value.trim(),
      defaultGiftId: giftId,
      defaultGiftIcon: $('#crGiftIcon').value.trim(),
      userId: ($('#crUserId')?.value || '').trim(),
    };
    const wasEditing = !!currentEditingCreator;
    await window.api.creators.upsert(payload);
    await refreshCreators();
    clearCreatorForm();
    lastFetchedId = '';
    toast(wasEditing ? '✅ Đã cập nhật Creator' : '💾 Đã thêm Creator', 'success');
    // Còn thiếu avatar (ID hoàn toàn mới, chưa ai lưu) → tự lấy nền theo ID, khỏi cần bấm Tải.
    if (!avatarVal) autoRefetchStaleAvatars();
  });

  // 🎯 Học tất cả ID: tự lấy ID nhận quà (toMemberId = tikwm user.id) cho mọi thành viên chưa có,
  // để mode TikTok khớp chính xác ngay từ quà đầu (không phụ thuộc khớp tên).
  $('#btnLearnAllIds')?.addEventListener('click', async () => {
    const btn = $('#btnLearnAllIds');
    const list = creators.filter(c => c.tiktokId && !c.userId);
    if (!list.length) {
      toast(creators.length ? '✓ Mọi thành viên đã có ID nhận quà' : 'Chưa có thành viên nào', creators.length ? 'success' : 'error');
      return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${list.length}…`;
      try {
        const p = await window.api.tt.fetchProfile(list[i].tiktokId).catch(() => null);
        if (p && p.userId) { await window.api.creators.upsert({ ...list[i], userId: String(p.userId) }); ok++; }
        else fail++;
      } catch { fail++; }
    }
    await refreshCreators();
    btn.disabled = false;
    btn.textContent = orig;
    toast(`🎯 Lấy UID: ${ok} thành viên OK${fail ? ` · ${fail} chưa lấy được (tặng thử để Lấy UID riêng)` : ''}`, ok ? 'success' : 'error');
  });

  // 🎯 Học ID: bật chế độ chộp ID người nhận từ quà KẾ TIẾP trong LIVE nhóm.
  // Bấm → tặng thử 1 quà cho đúng thành viên này trên TikTok → app tự điền ID.
  let _learningRecipient = false;
  const learnBtn = $('#btnLearnRecipient');
  learnBtn?.addEventListener('click', async () => {
    _learningRecipient = !_learningRecipient;
    try { await window.api.creators.armLearnRecipient(_learningRecipient); } catch {}
    learnBtn.classList.toggle('learning', _learningRecipient);
    learnBtn.textContent = _learningRecipient ? '👂 Đang nghe…' : '🎯 Lấy UID';
    toast(_learningRecipient
      ? '👂 Hãy tặng thử 1 quà cho thành viên này trong LIVE — app sẽ chộp ID người nhận'
      : 'Đã tắt Lấy UID');
  });
  window.api.on('tt:recipientLearned', (d) => {
    if (!_learningRecipient) return;
    _learningRecipient = false;
    if (learnBtn) { learnBtn.classList.remove('learning'); learnBtn.textContent = '🎯 Lấy UID'; }
    if ($('#crUserId') && d?.userId) $('#crUserId').value = String(d.userId);
    const who = d?.name ? ` (${d.name})` : '';
    toast(`✅ Đã bắt ID người nhận${who}: ${d?.userId || '?'} — nhớ bấm 💾 Lưu`, 'success');
  });
}

// ============================================================
// Groups
// ============================================================
async function refreshGroups() {
  groups = await window.api.groups.list();
  renderModeSelect();
  renderGroups();
  renderCreatorGroupSelect();
  renderCreators();
  renderPkCreatorSelects?.();
  renderPkGroupGroupSelect?.();
  renderPkGroupMembers?.();
  renderScoreCreatorSelect?.();
  renderKcCreatorSelects?.();
}

// Avatar TikTok là URL ký có tham số 'x-expires' → hết hạn sau ~vài giờ. Nhóm (và creator) lưu URL
// đã ký lúc setup nên khi mở app lại thường đã hết hạn → ảnh rơi về logo HP. Tự lấy lại avatar theo
// ID TikTok khi THIẾU hoặc URL ĐÃ HẾT HẠN. Chạy nền, tuần tự, nghỉ nhẹ để không dội TikTok CDN.
function avatarNeedsRefetch(url) {
  const s = String(url || '').trim();
  if (!s) return true;                    // thiếu avatar → cần lấy
  if (/^data:/i.test(s)) return false;    // dataURL lưu trong máy, không hết hạn
  const m = s.match(/[?&]x-expires=(\d+)/i);
  if (!m) return false;                   // URL không ghi hạn → giữ nguyên
  return Number(m[1]) * 1000 <= Date.now() + 5 * 60 * 1000; // đệm 5 phút
}

let _avatarRefetchRunning = false;
async function autoRefetchStaleAvatars() {
  if (_avatarRefetchRunning) return;
  _avatarRefetchRunning = true;
  try {
    const staleGroups = groups.filter(g => g.tiktokId && avatarNeedsRefetch(g.avatar));
    const staleCreators = creators.filter(c => c.tiktokId && avatarNeedsRefetch(c.avatar));
    // Gom theo TikTok ID: mỗi ID chỉ lấy MẠNG 1 lần rồi áp cho MỌI bản trùng ID (nhiều thành
    // viên cùng 1 ID, hoặc creator trùng ID với nhóm). Giảm số request → tránh tikwm giới hạn
    // tần suất (nguyên nhân "bấm Tải/tự cập nhật không ra avatar" khi có nhiều thành viên).
    const ids = new Map(); // normId -> raw tiktokId
    for (const x of [...staleGroups, ...staleCreators]) {
      const key = normTiktokId(x.tiktokId);
      if (key && !ids.has(key)) ids.set(key, x.tiktokId);
    }
    let groupsChanged = false, creatorsChanged = false;
    for (const [key, raw] of ids) {
      // Ưu tiên avatar CÒN HẠN đã có sẵn của cùng ID (offline, không tốn mạng).
      let avatar = knownProfileForTiktokId(raw)?.avatar || '';
      if (!avatar || avatarNeedsRefetch(avatar)) {
        try {
          const p = await window.api.tt.fetchProfile(raw);
          if (p?.found && p.avatar) avatar = p.avatar;
        } catch {}
        await new Promise(r => setTimeout(r, 150));
      }
      if (!avatar) continue;
      for (const g of staleGroups) {
        if (normTiktokId(g.tiktokId) === key && g.avatar !== avatar) {
          await window.api.groups.upsert({ id: g.id, avatar });
          groupsChanged = true;
        }
      }
      for (const c of staleCreators) {
        if (normTiktokId(c.tiktokId) === key && c.avatar !== avatar) {
          await window.api.creators.upsert({ id: c.id, avatar });
          creatorsChanged = true;
        }
      }
    }
    if (groupsChanged) await refreshGroups();
    if (creatorsChanged) await refreshCreators();
    // Cập nhật lại màn "Chọn nhóm" nếu đang mở để thấy avatar vừa lấy.
    if ((groupsChanged || creatorsChanged) && !$('#groupLauncher')?.hidden) renderGroupLauncher();
  } finally {
    _avatarRefetchRunning = false;
  }
}

function renderGroups() {
  const gs = visibleGroups();
  const list = $('#groupsList');
  const countEl = $('#grCount');
  const panel = document.querySelector('.panel[data-panel="groups"]');
  const listTitle = $('#grListTitle');
  if (countEl) countEl.textContent = gs.length ? `${gs.length}` : '';
  list.innerHTML = '';

  // NHÓM Riêng: đang chọn đúng 1 nhóm → hồ sơ đầy đủ (full-width dossier) thay vì thẻ nhỏ.
  if (activeGroupId && gs.length === 1) {
    panel?.classList.add('groups-solo');
    if (listTitle) listTitle.style.display = 'none';
    renderGroupDossier(gs[0], list);
    drawGroupTrend(gs[0].id); // vẽ chart 6 tháng (bất đồng bộ)
    return;
  }
  panel?.classList.remove('groups-solo');
  if (listTitle) listTitle.style.display = '';

  if (gs.length === 0) {
    list.innerHTML = '<div class="hint">Chưa có nhóm nào.</div>';
    return;
  }
  for (const g of groupsByKc(gs)) {
    const cnt = groupMemberCount(g);
    const color = g.color || colorFromId(g.tiktokId || g.id);
    const groupKey = g.id || g.tiktokId || '';
    const prof = getGroupProfile(g.id);
    const matches = Number(prof.stats?.matches) || 0;
    const dg = prof.defaultGift;
    const hasGift = dg && (dg.giftId || dg.giftName);
    const kc = kcOfGroup(g.id);
    const delta = kcDeltaOf(g.id);
    const rank = kcRankOf(g.id);
    const crown = kcCrown(rank);
    const div = document.createElement('div');
    div.className = 'group-card' + (crown ? ' gc-top gc-top-' + rank : '');
    div.innerHTML = `
      <div class="gc-head">
        <div class="gc-ava-wrap">
          <img class="gc-avatar" src="${escapeAttr(g.avatar || '../logo/hp-logo.png')}" alt="" style="border-color:${escapeAttr(color)}" />
          ${crown ? `<span class="gc-crown" title="Hạng ${rank}">${crown}</span>` : ''}
        </div>
        <div class="gc-info">
          <strong>${escapeHtml(g.name)}</strong>
          <span class="gc-handle">@${escapeHtml(g.tiktokId || '—')}</span>
          ${(g.mc || g.manager) ? `<span class="gc-roles">${g.mc ? `🎤 MC: ${escapeHtml(g.mc)}` : ''}${g.mc && g.manager ? ' · ' : ''}${g.manager ? `🛡️ QL: ${escapeHtml(g.manager)}` : ''}</span>` : ''}
          <span class="gc-meta">${kc != null ? `💎 ${formatNumber(kc)} ${kcDeltaBadge(delta)}` : ''}${kc != null && (matches || hasGift) ? ' · ' : ''}${matches ? `🎮 ${matches} trận` : ''}${hasGift ? `${matches ? ' · ' : ''}🎁 ${escapeHtml(dg.giftName || '')}` : ''}</span>
        </div>
        <span class="gc-count">${cnt} thành viên</span>
      </div>
      <div class="gc-actions">
        <button class="ghost tiny" data-edit="${escapeAttr(groupKey)}" type="button">✏️ Sửa</button>
        <button class="warn tiny" data-del="${escapeAttr(groupKey)}" type="button">🗑 Xoá</button>
      </div>
    `;
    list.appendChild(div);
  }
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editGroup(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Xoá nhóm này? Creator thuộc nhóm sẽ thành chưa-nhóm.')) {
      await window.api.groups.remove(b.dataset.del); await refreshGroups();
    }
  }));
}

// NHÓM Riêng: hồ sơ nhóm đầy đủ, trải hết chiều ngang màn hình.
// Hero (avatar, tên, @id, MC/Quản lý/quà nhóm, thống kê) + lưới thành viên (avatar, tên, quà riêng/kế thừa).
function renderGroupDossier(g, list) {
  const color = g.color || colorFromId(g.tiktokId || g.id);
  const prof = getGroupProfile(g.id);
  const matches = Number(prof.stats?.matches) || 0;
  const dg = prof.defaultGift;
  const hasGift = dg && (dg.giftId || dg.giftName);
  const members = creators.filter(c => c.groupId === g.id)
    .slice().sort((a, b) => (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi'));
  const ownGiftCount = members.filter(c => c.defaultGiftId || c.defaultGiftName).length;
  const kc = kcOfGroup(g.id);
  const delta = kcDeltaOf(g.id);
  const rank = kcRankOf(g.id);
  const crown = kcCrown(rank);
  const periodLabel = kcPeriodLabel(kcData.period);

  const chips = [];
  chips.push(`<span class="gd-chip">🎤 <b>MC</b> ${g.mc ? escapeHtml(g.mc) : '<i>—</i>'}</span>`);
  chips.push(`<span class="gd-chip">🛡️ <b>Quản lý</b> ${g.manager ? escapeHtml(g.manager) : '<i>—</i>'}</span>`);
  chips.push(`<span class="gd-chip gd-chip-gift">${hasGift && dg.giftIcon ? `<img src="${escapeAttr(dg.giftIcon)}" alt=""/>` : '🎁'} <b>Quà nhóm</b> ${hasGift ? escapeHtml(dg.giftName || '') : '<i>chưa đặt</i>'}</span>`);

  const dossier = document.createElement('div');
  dossier.className = 'group-dossier' + (crown ? ' gd-top gd-top-' + rank : '');
  dossier.style.setProperty('--gd-color', color);
  dossier.innerHTML = `
    <div class="gd-hero">
      <div class="gd-ava-wrap">
        <img class="gd-avatar" src="${escapeAttr(g.avatar || '../logo/hp-logo.png')}" alt="" />
        ${crown ? `<span class="gd-crown" title="Hạng ${rank}">${crown}</span>` : ''}
      </div>
      <div class="gd-hero-main">
        <div class="gd-title-row">
          <h2 class="gd-name">${escapeHtml(g.name || 'Nhóm')}</h2>
          ${rank ? `<span class="gd-rank-badge">Hạng ${rank}</span>` : ''}
          <button class="ghost tiny gd-edit-group" type="button">✏️ Sửa nhóm</button>
        </div>
        <div class="gd-handle">@${escapeHtml(g.tiktokId || '—')}${g.channelName ? ` · ${escapeHtml(g.channelName)}` : ''}</div>
        <div class="gd-chips">${chips.join('')}</div>
      </div>
      <div class="gd-stats">
        <div class="gd-stat gd-stat-kc"><b>💎 ${kc != null ? formatNumber(kc) : '—'}</b><span>Kim cương tổng${periodLabel ? ` · ${periodLabel}` : ''}</span>${delta != null ? `<span class="gd-kc-delta">${kcDeltaBadge(delta)}</span>` : ''}</div>
        <div class="gd-stat"><b>${members.length}</b><span>Thành viên</span></div>
        <div class="gd-stat"><b>${ownGiftCount}</b><span>Có quà riêng</span></div>
        <div class="gd-stat"><b>${matches}</b><span>Trận đấu</span></div>
      </div>
    </div>
    <div class="gd-trend" data-gid="${escapeAttr(g.id)}">
      <div class="gd-trend-head">
        <h3>📈 Kim cương theo tháng <span class="gd-trend-note">6 tháng gần nhất</span></h3>
        <span class="gd-trend-sub"></span>
      </div>
      <div class="gd-trend-chart"><div class="hint">Đang tải dữ liệu tháng…</div></div>
    </div>
    <div class="gd-members-head">
      <h3>👤 Thành viên <span class="rf-count">${members.length}</span></h3>
      <button class="ghost tiny gd-goto-creators" type="button">＋ Quản lý thành viên</button>
    </div>
    <div class="gd-members"></div>
  `;

  const memWrap = dossier.querySelector('.gd-members');
  if (!members.length) {
    memWrap.innerHTML = '<div class="hint">Chưa có thành viên. Thêm ở tab THÀNH VIÊN.</div>';
  } else {
    for (const c of members) {
      const own = creatorDefaultGift(c);
      const inherited = own ? null : groupDefaultGift(g.id);
      const gift = own || inherited;
      const memberKey = c.id || c.tiktokId || '';
      const card = document.createElement('div');
      card.className = 'gd-member';
      card.innerHTML = `
        <img class="gdm-ava" src="${escapeAttr(c.avatar || '../logo/hp-logo.png')}" alt="" style="border-color:${escapeAttr(color)}" />
        <div class="gdm-body">
          <div class="gdm-name">${escapeHtml(c.nickname || c.tiktokId || '')}</div>
          <div class="gdm-handle">@${escapeHtml(c.tiktokId || '')} ${uidBadge(c)}</div>
          <div class="cc-gift-wrap">
            <div class="gdm-gift${gift ? '' : ' is-empty'}" data-gift="${escapeAttr(memberKey)}" role="button" tabindex="0" title="Bấm để chọn quà riêng">
              ${gift?.icon ? `<img src="${escapeAttr(gift.icon)}" alt=""/>` : '🎁'}
              <span>${gift ? escapeHtml(gift.giftName || '') : '(chưa đặt quà)'}</span>
              ${inherited ? '<em class="gdm-inh">kế thừa nhóm</em>' : ''}
              <span class="gdm-gift-edit">✏️</span>
            </div>
            ${own ? `<button class="cc-gift-clear" data-gift-clear="${escapeAttr(memberKey)}" type="button" title="Gỡ quà riêng">✕</button>` : ''}
          </div>
        </div>
        <button class="ghost tiny gdm-edit" data-edit-creator="${escapeAttr(memberKey)}" type="button">Cài đặt</button>
      `;
      memWrap.appendChild(card);
    }
  }

  list.appendChild(dossier);

  dossier.querySelector('.gd-edit-group')?.addEventListener('click', () => {
    editGroup(g.id || g.tiktokId);
    document.querySelector('.panel[data-panel="groups"]')?.scrollTo?.({ top: 0, behavior: 'smooth' });
  });
  dossier.querySelector('.gd-goto-creators')?.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="creators"]')?.click();
  });
  dossier.querySelectorAll('[data-gift]').forEach(b => {
    const handler = () => pickCreatorGiftQuick(b.dataset.gift);
    b.addEventListener('click', handler);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
  dossier.querySelectorAll('[data-gift-clear]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    clearCreatorGiftQuick(b.dataset.giftClear);
  }));
  dossier.querySelectorAll('[data-edit-creator]').forEach(b => b.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="creators"]')?.click();
    editCreator(b.dataset.editCreator);
  }));
}

function clearGroupForm() {
  currentEditingGroup = null;
  $('#grTiktokId').value = '';
  $('#grName').value = '';
  $('#grMC').value = '';
  $('#grManager').value = '';
  $('#grAvatar').value = '';
  $('#grAvatarPreview').src = '../logo/hp-logo.png';
  $('#grChannel').textContent = '';
  setGroupGiftDisplay(null);
}

function setGroupGiftDisplay(g) {
  $('#grGiftId').value = g?.id || '';
  $('#grGiftName').value = g?.name || '';
  $('#grGiftIcon').value = g?.icon || '';
  $('#grGiftDisplay').textContent = g ? `${g.name}${g.diamond ? ` · 🪙 ${g.diamond}` : ''}` : '🎁 Chọn quà';
  $('#grGiftIconPreview').src = g?.icon || '';
}

function editGroup(id) {
  const g = groups.find(x => x.id === id || (!x.id && x.tiktokId === id));
  if (!g) { toast('Không tìm thấy nhóm này', 'error'); return; }
  currentEditingGroup = g;
  $('#grTiktokId').value = g.tiktokId || '';
  $('#grName').value = g.name || '';
  $('#grMC').value = g.mc || '';
  $('#grManager').value = g.manager || '';
  $('#grAvatar').value = g.avatar || '';
  $('#grAvatarPreview').src = g.avatar || '../logo/hp-logo.png';
  $('#grChannel').textContent = groupInfoText(g, g.channelName || '');
  // Nạp quà mặc định của nhóm (từ hồ sơ nhóm)
  const dg = getGroupProfile(g.id).defaultGift;
  if (dg && (dg.giftId || dg.giftName)) {
    const m = giftMaster.find(x => String(x.id) === String(dg.giftId))
      || giftMaster.find(x => x.name && x.name.toLowerCase() === String(dg.giftName || '').toLowerCase());
    setGroupGiftDisplay(m || { id: dg.giftId, name: dg.giftName, icon: dg.giftIcon, diamond: 0 });
  } else {
    setGroupGiftDisplay(null);
  }
  $('#grTiktokId').focus();
  $('#grTiktokId').scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(`✏️ Đang sửa: ${g.name}`);
}

function wireGroupTab() {
  let lastFetchedGroupId = '';

  $('#btnPickGrGift').addEventListener('click', async () => {
    const g = await GiftPicker.open({ title: '🎁 Chọn quà mặc định cho Nhóm' });
    if (g) setGroupGiftDisplay(g);
  });

  async function autoFetchGroup(force = false) {
    const u = $('#grTiktokId').value.trim().replace(/^@/, '');
    if (!u) { toast('Nhập ID nhóm trước đã.', 'error'); return; }
    if (!force && u === lastFetchedGroupId) return;
    lastFetchedGroupId = u;
    $('#grSpinner').hidden = false;
    $('#btnLoadGroup').disabled = true;
    try {
      const p = await window.api.tt.fetchProfile(u);
      if (p.found) {
        if (p.nickname) {
          if (!$('#grName').value || !currentEditingGroup) $('#grName').value = p.nickname;
          $('#grChannel').textContent = groupInfoText({ id: currentEditingGroup?.id, tiktokId: u }, p.nickname);
        }
        if (p.avatar) {
          $('#grAvatar').value = p.avatar;
          $('#grAvatarPreview').src = p.avatar;
        } else {
          $('#grAvatar').value = '';
          $('#grAvatarPreview').src = '../logo/hp-logo.png';
        }
        toast('Đã tải Avatar và tên nhóm', 'success');
      } else {
        toast('Không tìm thấy nhóm, vẫn có thể lưu thủ công.', 'error');
      }
    } catch (e) { toast('Không tải được nhóm: ' + (e.message || 'lỗi không xác định'), 'error'); }
    finally {
      $('#grSpinner').hidden = true;
      $('#btnLoadGroup').disabled = false;
    }
  }
  $('#grTiktokId').addEventListener('blur', autoFetchGroup);
  $('#grTiktokId').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); autoFetchGroup(true); }
  });
  $('#btnLoadGroup').addEventListener('click', () => autoFetchGroup(true));

  $('#btnNewGroup').addEventListener('click', () => { clearGroupForm(); lastFetchedGroupId = ''; });

  $('#btnSaveGroup').addEventListener('click', async () => {
    const tiktokId = $('#grTiktokId').value.trim().replace(/^@/, '');
    const name = $('#grName').value.trim();
    if (!tiktokId) { toast('Cần ID nhóm (TikTok ID)', 'error'); return; }
    if (!name) { toast('Cần tên nhóm', 'error'); return; }
    const duplicate = groups.find(g => g.id !== currentEditingGroup?.id && normalizeId(g.tiktokId) === normalizeId(tiktokId));
    if (duplicate) {
      toast(`ID nhóm @${tiktokId} đã tồn tại: ${duplicate.name}`, 'error');
      return;
    }
    const payload = {
      id: currentEditingGroup?.id,
      tiktokId,
      name,
      mc: $('#grMC').value.trim(),
      manager: $('#grManager').value.trim(),
      channelName: $('#grChannel').textContent || '',
      avatar: $('#grAvatar').value.trim(),
      color: colorFromId(tiktokId),
    };
    const wasEditing = !!currentEditingGroup;
    const list = await window.api.groups.upsert(payload);
    // Gắn quà mặc định vào hồ sơ nhóm vừa lưu (cần id của nhóm)
    let savedId = currentEditingGroup?.id;
    if (!savedId && Array.isArray(list)) {
      savedId = list.find(g => normalizeId(g.tiktokId) === normalizeId(tiktokId))?.id;
    }
    if (savedId) {
      saveGroupProfilePatch(savedId, {
        defaultGift: {
          giftId: $('#grGiftId').value.trim(),
          giftName: $('#grGiftName').value.trim(),
          giftIcon: $('#grGiftIcon').value.trim(),
        },
      });
    }
    await refreshGroups();
    clearGroupForm();
    lastFetchedGroupId = '';
    toast(wasEditing ? '✅ Đã cập nhật nhóm' : '💾 Đã thêm nhóm', 'success');
  });
}

function groupMemberCount(group) {
  if (!group) return 0;
  return creators.filter(c => c.groupId === group.id).length;
}

function groupInfoText(group, name) {
  const cnt = groupMemberCount(group);
  return [name, `${cnt} thành viên`].filter(Boolean).join(' · ');
}

// Deterministic color từ string id — dùng cho ranking badge khi user không chọn màu thủ công
function colorFromId(id) {
  if (!id) return '#FE2C55';
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 72%, 52%)`;
}

// ============================================================
// Hồ sơ nhóm — mỗi nhóm lưu THÔNG SỐ RIÊNG (PK Nhóm,
// quà mặc định, thống kê). Đổi nhóm là tự nạp lại thông số của nhóm đó.
// ============================================================
async function refreshGroupProfiles() {
  try { groupProfiles = (await window.api.groupProfiles.getAll()) || {}; }
  catch { groupProfiles = {}; }
}

function getGroupProfile(groupId) {
  const gid = String(groupId || '');
  return (gid && groupProfiles[gid] && typeof groupProfiles[gid] === 'object') ? groupProfiles[gid] : {};
}

// Ghi 1 phần hồ sơ của nhóm (merge). Cập nhật cục bộ ngay để UI đồng bộ, rồi lưu file.
function saveGroupProfilePatch(groupId, patch) {
  const gid = String(groupId || '');
  if (!gid) return Promise.resolve(null);
  groupProfiles[gid] = { ...(groupProfiles[gid] || {}), ...(patch || {}) };
  return window.api.groupProfiles.save(gid, patch)
    .then(saved => { if (saved) groupProfiles[gid] = saved; })
    .catch(() => {});
}

// Quà mặc định của NHÓM (fallback khi creator chưa có quà riêng) → pkGift
function groupDefaultGift(groupId) {
  const g = getGroupProfile(groupId).defaultGift;
  if (!g || (!g.giftId && !g.giftName)) return null;
  const master = giftMaster.find(x => String(x.id) === String(g.giftId))
    || giftMaster.find(x => x.name && x.name.toLowerCase() === String(g.giftName || '').toLowerCase());
  return giftToPkGift(master || { id: g.giftId, name: g.giftName, icon: g.giftIcon, diamond: 0 });
}

// ===== PK Nhóm: chụp / nạp thông số theo nhóm =====
const PKG_PROFILE_FIELDS = ['content', 'layoutMode', 'playMode', 'creatorLive', 'tiktokCombine', 'pointsBy', 'noteEnabled', 'noteText', 'noteBgColor', 'noteTextColor', 'noteSpeedSec', 'noteEffect', 'separatedGap', 'autoTextContrast', 'showMvpTotals', 'durationSec', 'prepSec', 'delaySec', 'textSize', 'nameSize', 'giftSize', 'overlayScale', 'smartColor', 'creatorColors', 'participants'];

// Chụp thông số PK Nhóm hiện tại thành object (KHÔNG đọc DOM — caller tự sync trước).
function pkGroupProfileSnapshot() {
  const snap = {};
  for (const k of PKG_PROFILE_FIELDS) if (k in (pkGroupCfg || {})) snap[k] = pkGroupCfg[k];
  // participants: bỏ điểm runtime, giữ tên/màu/quà/streak (thông tin cá nhân)
  snap.participants = (pkGroupCfg?.participants || []).map(p => ({ ...p, score: 0 }));
  return JSON.parse(JSON.stringify(snap));
}

// Lưu thông số PK Nhóm hiện tại vào hồ sơ của 1 nhóm.
function snapshotPkGroupToProfile(groupId) {
  if (!groupId || !pkGroupCfg) return;
  saveGroupProfilePatch(groupId, { pkGroup: pkGroupProfileSnapshot() });
}

// Nạp thông số PK Nhóm đã lưu của 1 nhóm vào pkGroupCfg (nếu chưa có hồ sơ → danh sách trống).
function applyPkGroupProfile(groupId) {
  const prof = getGroupProfile(groupId).pkGroup;
  if (prof && typeof prof === 'object') {
    for (const k of PKG_PROFILE_FIELDS) if (k in prof) pkGroupCfg[k] = prof[k];
    pkGroupCfg.participants = Array.isArray(prof.participants) ? prof.participants : [];
    pkGroupCfg.creatorColors = prof.creatorColors || {};
  } else {
    pkGroupCfg.participants = [];
  }
  pkGroupCfg.groupId = groupId;
  applyPkGroupCfgToInputs();
}

// PK Đôi luôn lấy hai creator đầu tiên của nhóm vừa chọn, không dùng creator đã nhớ từ nhóm khác.
function populatePkDuoTeamsFromGroup(groupId) {
  const group = groups.find(g => g.id === groupId);
  const members = group ? membersOfGroup(groupId).slice(0, 2) : [];
  for (const [index, side] of ['A', 'B'].entries()) {
    const team = getTeam(side);
    const creator = members[index];
    team.groupId = group?.id || '';
    team.groupName = group?.name || '';
    team.creatorId = creator?.id || '';
    team.creatorName = creator?.nickname || creator?.tiktokId || '';
    team.creatorAvatar = creator?.avatar || '../logo/hp-logo.png';
    if (!creator) team.name = `TEAM ${side}`;
    $(`#pk${side}group`).value = group?.id || '';
    renderPkCreatorSelect(side);
    $(`#pk${side}creator`).value = creator?.id || '';
    applyPkCreator(side, { applyDefaultGift: true, syncName: true });
  }
  renderPkGifts();
}

// ============================================================
// PK Đôi
// ============================================================
async function loadPkConfig() {
  const st = await window.api.pkduo.getState();
  pkCfg = {
    teamA: normalizePkTeam(st.teamA, { name: 'TEAM A', color: '#FE2C55' }),
    teamB: normalizePkTeam(st.teamB, { name: 'TEAM B', color: '#25F4EE' }),
    durationSec: st.durationSec || 90, prepSec: st.prepSec ?? 3, delaySec: st.delaySec ?? 5,
    joinMode: !!st.joinMode, tiktokCombine: !!(st.tiktokCombine || st.creatorLive), pointsBy: st.pointsBy || 'diamond',
    bgColor: st.bgColor || '#000000', bgOpacity: st.bgOpacity ?? 88,
    giftSize: st.giftSize || 46, textSize: st.textSize || 21,
    overlayScale: st.overlayScale || 200,
    giftDisplayMode: st.giftDisplayMode || 'scroll',
    content: st.content || 'PK ĐÔI',
    startSound: st.startSound || '', warningSound: st.warningSound || '', teamASound: st.teamASound || '', teamBSound: st.teamBSound || '', drawSound: st.drawSound || '',
    // Cấu hình overlay FX — copy vào pkCfg để giữ (nhớ) lựa chọn đã lưu khi tải lại
    fxEnabled: st.fxEnabled !== false, fxMode: st.fxMode || 'both', fxStyle: st.fxStyle || 'auto', fxThreshold: st.fxThreshold ?? 8,
  };
  syncPkActiveGifts();
  renderPkCreatorSelects();
  $('#pkContent').value = pkCfg.content || '';
  $('#pkAname').value = pkCfg.teamA?.name || 'TEAM A';
  $('#pkAcolor').value = pkCfg.teamA?.color || '#FE2C55';
  $('#pkBname').value = pkCfg.teamB?.name || 'TEAM B';
  $('#pkBcolor').value = pkCfg.teamB?.color || '#25F4EE';
  if ($('#pkAstreak')) $('#pkAstreak').value = Math.max(0, Number(pkCfg.teamA?.winStreak) || 0);
  if ($('#pkBstreak')) $('#pkBstreak').value = Math.max(0, Number(pkCfg.teamB?.winStreak) || 0);
  updatePkTotalMatches();
  const selectedGroupId = activeGroupId || pkCfg.teamA?.groupId || pkCfg.teamB?.groupId || '';
  if (selectedGroupId) {
    populatePkDuoTeamsFromGroup(selectedGroupId);
  } else {
    $('#pkAgroup').value = '';
    $('#pkBgroup').value = '';
    renderPkCreatorSelect('A');
    renderPkCreatorSelect('B');
  }
  // Tách durationSec → h/m/s
  const d = pkCfg.durationSec || 300;
  $('#pkDurH').value = Math.floor(d / 3600);
  $('#pkDurM').value = Math.floor((d % 3600) / 60);
  $('#pkDurS').value = d % 60;
  $('#pkPrep').value = pkCfg.prepSec;
  $('#pkDelay').value = pkCfg.delaySec;
  $('#pkJoinMode').value = String(pkCfg.joinMode);
  if ($('#pkTiktokCombine')) $('#pkTiktokCombine').checked = !!pkCfg.tiktokCombine;
  $('#pkPointsBy').value = pkCfg.pointsBy;
  $('#pkBg').value = pkCfg.bgColor;
  $('#pkBgOpacity').value = pkCfg.bgOpacity;
  $('#pkBgOpacityValue').textContent = `${pkCfg.bgOpacity}%`;
  $('#pkGiftSize').value = pkCfg.giftSize;
  $('#pkGiftDisplayMode').value = pkCfg.giftDisplayMode || 'scroll';
  $('#pkTextSize').value = pkCfg.textSize;
  $('#pkOverlayScale').value = pkCfg.overlayScale;
  $('#pkOverlayScaleValue').textContent = `${$('#pkOverlayScale').value}%`;
  if ($('#pkFxEnabled')) $('#pkFxEnabled').value = String(pkCfg.fxEnabled !== false);
  if ($('#pkFxMode')) $('#pkFxMode').value = pkCfg.fxMode || 'both';
  if ($('#pkFxStyle')) $('#pkFxStyle').value = pkCfg.fxStyle || 'auto';
  if ($('#pkFxThreshold')) { $('#pkFxThreshold').value = pkCfg.fxThreshold ?? 8; $('#pkFxThresholdValue').textContent = `${$('#pkFxThreshold').value}%`; }
  if ($('#pkChampsEnabled')) $('#pkChampsEnabled').value = String(pkCfg.championsEnabled !== false);
  if ($('#pkChampNames')) $('#pkChampNames').value = String(pkCfg.championNames === true);
  if ($('#pkArrowStyle')) $('#pkArrowStyle').value = pkCfg.arrowStyle || 'random';
  if ($('#pkSelectFx')) $('#pkSelectFx').value = pkCfg.selectFx || 'random';
  if ($('#pkSkin')) { $('#pkSkin').value = pkCfg.skin || 'auto'; updateSkinHint('pkSkin', 'pkSkinHint'); }
  setSoundInput('pkSndStart', pkCfg.startSound || '');
  setSoundInput('pkSndWarn', pkCfg.warningSound || '');
  setSoundInput('pkSndAwin', pkCfg.teamASound || '');
  setSoundInput('pkSndBwin', pkCfg.teamBSound || '');
  setSoundInput('pkSndDraw', pkCfg.drawSound || '');
  renderPkGifts();
  renderPkPreview({ ...st, teamA: pkCfg.teamA, teamB: pkCfg.teamB });
}

function normalizePkTeam(team, fallback) {
  const t = { ...fallback, ...(team || {}) };
  t.fixedGifts = Array.isArray(t.fixedGifts) ? t.fixedGifts : (Array.isArray(t.gifts) ? t.gifts : []);
  t.joinGifts = Array.isArray(t.joinGifts) ? t.joinGifts : [];
  t.gifts = Array.isArray(t.gifts) ? t.gifts : t.fixedGifts;
  t.winStreak = Math.max(0, Number(t.winStreak) || 0);
  return t;
}

function syncPkActiveGifts() {
  if (!pkCfg) return;
  const key = pkCfg.joinMode ? 'joinGifts' : 'fixedGifts';
  if (pkCfg.joinMode) {
    pkCfg.teamA.joinGifts = (pkCfg.teamA.joinGifts || []).slice(0, 1);
    pkCfg.teamB.joinGifts = (pkCfg.teamB.joinGifts || []).slice(0, 1);
  }
  pkCfg.teamA.gifts = pkCfg.teamA[key] || [];
  pkCfg.teamB.gifts = pkCfg.teamB[key] || [];
}

function savePkActiveGifts() {
  const key = pkGiftModeKey();
  pkCfg.teamA[key] = pkCfg.joinMode ? (pkCfg.teamA.gifts || []).slice(0, 1) : (pkCfg.teamA.gifts || []);
  pkCfg.teamB[key] = pkCfg.joinMode ? (pkCfg.teamB.gifts || []).slice(0, 1) : (pkCfg.teamB.gifts || []);
}

function renderPkCreatorSelects() {
  if (!pkCfg || !$('#pkAgroup')) return;
  for (const side of ['A', 'B']) {
    const groupSel = $(`#pk${side}group`);
    const gs = visibleGroups();
    const prev = groupSel.value || getTeam(side).groupId || '';
    const current = activeGroupId ? activeGroupId : prev;
    groupSel.innerHTML = '<option value="">— Chọn nhóm —</option>' + gs.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    groupSel.value = gs.some(g => g.id === current) ? current : '';
    renderPkCreatorSelect(side);
  }
}

function renderPkCreatorSelect(side) {
  const team = getTeam(side);
  const groupId = $(`#pk${side}group`)?.value || team.groupId || '';
  const sel = $(`#pk${side}creator`);
  if (!sel) return;
  const current = sel.value || team.creatorId || '';
  const filtered = visibleCreators().filter(c => !groupId || c.groupId === groupId);
  sel.innerHTML = '<option value="">— Chọn Creator —</option>' + filtered.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`).join('');
  sel.value = filtered.some(c => c.id === current) ? current : '';
}

function applyPkCreator(side, opts = {}) {
  const team = getTeam(side);
  const group = groups.find(g => g.id === $(`#pk${side}group`).value);
  const creator = creators.find(c => c.id === $(`#pk${side}creator`).value);
  team.groupId = group?.id || '';
  team.groupName = group?.name || '';
  team.creatorId = creator?.id || '';
  team.creatorName = creator?.nickname || creator?.tiktokId || '';
  team.creatorAvatar = creator?.avatar || '../logo/hp-logo.png';
  if (group?.color) team.color = group.color;
  // Khi chọn creator: ưu tiên lấy tên hiển thị theo creator đã cài đặt (và bỏ ghi đè tên cũ)
  if (opts.syncName && creator) {
    team.name = creator.nickname || creator.tiktokId || team.name;
    team.nameOverride = false;
  }
  if (creator && pkCfg?.joinMode && (opts.applyDefaultGift || !(team.joinGifts || []).length)) {
    const gift = creatorDefaultGift(creator);
    if (gift) {
      team.joinGifts = [gift];
      team.gifts = team.joinGifts;
      team.giftOverride = false; // đang bám quà mặc định của creator
      renderPkGifts();
    }
  }
  $(`#pk${side}name`).value = team.name || (side === 'A' ? 'TEAM A' : 'TEAM B');
  $(`#pk${side}color`).value = normalizeHexColor(team.color, side === 'A' ? '#FE2C55' : '#25F4EE');
}

function creatorDefaultGift(creator) {
  if (!creator?.defaultGiftId && !creator?.defaultGiftName) return null;
  const master = giftMaster.find(g => String(g.id) === String(creator.defaultGiftId))
    || giftMaster.find(g => g.name.toLowerCase() === String(creator.defaultGiftName || '').toLowerCase());
  return giftToPkGift(master || {
    id: creator.defaultGiftId,
    name: creator.defaultGiftName,
    icon: creator.defaultGiftIcon,
    diamond: 0,
  });
}

// ===== Kế thừa quà mặc định (realtime) + Ghi đè =====
// Nguyên tắc: creator.defaultGift là "nguồn sự thật". Các nơi (PK Nhóm / PK Đôi) chỉ lưu OVERRIDE.
// Không override → luôn resolve theo quà mặc định hiện tại của creator → realtime tức thì.
function isRealGift(g) {
  return !!(g && (g.giftId || g.id || g.giftName || g.name || g.icon));
}

// So sánh chặt (id + tên + icon) — dùng khi đồng bộ quà kế thừa để cập nhật cả icon/tên xuống overlay
function sameGiftStrict(a, b) {
  if (!a || !b) return !a && !b;
  return String(a.giftId || a.id || '') === String(b.giftId || b.id || '')
    && String(a.giftName || a.name || '') === String(b.giftName || b.name || '')
    && String(a.icon || '') === String(b.icon || '');
}

function creatorById(idOrTiktok) {
  return creators.find(x => x.id === idOrTiktok || x.tiktokId === idOrTiktok) || null;
}

function normalizeHexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function renderPkGifts() {
  const joinMode = !!pkCfg?.joinMode;
  for (const side of ['A', 'B']) {
    const wrap = $(`#pk${side}gifts`);
    wrap.dataset.team = side;
    wrap.innerHTML = '';
    const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
    (team.gifts || []).forEach((g, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = g.giftName || g.giftId || '';
      chip.draggable = !joinMode;
      chip.dataset.side = side;
      chip.dataset.index = String(i);
      chip.innerHTML = `${g.icon ? `<img src="${escapeAttr(g.icon)}" />` : '🎁'}<button type="button">×</button>`;
      if (!joinMode) {
        chip.addEventListener('dragstart', (e) => {
          // Bấm nút × không được kích hoạt kéo-thả (nếu không click xóa sẽ biến thành drag → khó bấm)
          if (e.target.closest('button')) { e.preventDefault(); return; }
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-pk-gift', JSON.stringify({ side, index: i }));
          chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      }
      chip.querySelector('button').addEventListener('click', () => {
        team.gifts.splice(i, 1);
        savePkActiveGifts();
        if (joinMode) { team.giftOverride = false; applyPkCreator(side, { applyDefaultGift: true }); }
        renderPkGifts();
        schedulePkAutoSave();
      });
      wrap.appendChild(chip);
    });
    // Join mode + đang ghi đè → nút về quà mặc định
    if (joinMode && team.giftOverride && isRealGift((team.gifts || [])[0])) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'ghost tiny pk-reset-gift';
      reset.title = 'Về quà mặc định của Creator';
      reset.textContent = '🔄 Mặc định';
      reset.addEventListener('click', () => {
        team.giftOverride = false;
        applyPkCreator(side, { applyDefaultGift: true });
        renderPkGifts();
        schedulePkAutoSave();
        toast(`🔄 Đội ${side} về quà mặc định`, 'success');
      });
      wrap.appendChild(reset);
    }
  }
  $$('.pk-pick-master').forEach(btn => {
    btn.textContent = joinMode ? 'Chọn quà kích hoạt' : '+ Thêm quà';
  });
}

function pkDropIndex(zone, e) {
  const chips = Array.from(zone.querySelectorAll('.chip:not(.dragging)'));
  for (const chip of chips) {
    const rect = chip.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2 || (Math.abs(e.clientY - (rect.top + rect.height / 2)) < rect.height / 2 && e.clientX > rect.left + rect.width / 2);
    if (e.clientY < rect.bottom && e.clientX < rect.right) return Number(chip.dataset.index || 0) + (isAfter ? 1 : 0);
  }
  return chips.length;
}

function movePkGift(fromSide, toSide, index, toIndex = null) {
  if (!['A', 'B'].includes(fromSide) || !['A', 'B'].includes(toSide)) return false;
  const fromTeam = getTeam(fromSide);
  const toTeam = getTeam(toSide);
  const gift = fromTeam.gifts?.[index];
  if (!gift) return false;
  toTeam.gifts = toTeam.gifts || [];
  const giftId = String(gift.giftId || gift.id || '');
  if (fromSide !== toSide && giftId && toTeam.gifts.some(g => String(g.giftId || g.id || '') === giftId)) return false;
  fromTeam.gifts.splice(index, 1);
  let insertAt = Number.isFinite(Number(toIndex)) ? Number(toIndex) : toTeam.gifts.length;
  if (fromSide === toSide && insertAt > index) insertAt -= 1;
  insertAt = Math.max(0, Math.min(toTeam.gifts.length, insertAt));
  toTeam.gifts.splice(insertAt, 0, gift);
  savePkActiveGifts();
  renderPkGifts();
  return { moved: true, reordered: fromSide === toSide };
}

function pkGiftIds(side) {
  const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
  return new Set((team.gifts || []).map(g => String(g.giftId)));
}

function addPkGifts(side, gifts) {
  const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
  const other = side === 'A' ? pkCfg.teamB : pkCfg.teamA;
  team.gifts = team.gifts || [];
  if (pkCfg.joinMode) {
    const first = gifts?.[0];
    if (!first) return [];
    const pkGift = first.giftName ? first : giftToPkGift(first);
    const id = String(pkGift.giftId || pkGift.id || '');
    if (id && (other.gifts || []).some(g => String(g.giftId || g.id || '') === id)) return [];
    team.gifts = [pkGift];
    team.joinGifts = team.gifts;
    team.giftOverride = true; // chọn tay quà kích hoạt = ghi đè
    return [pkGift];
  }
  const existing = new Set(team.gifts.map(g => String(g.giftId)));
  const blocked = new Set((other.gifts || []).map(g => String(g.giftId)));
  const added = [];
  for (const g of gifts) {
    const id = String(g.id || g.giftId);
    if (existing.has(id) || blocked.has(id)) continue;
    const pkGift = g.giftName ? g : giftToPkGift(g);
    team.gifts.push(pkGift);
    existing.add(id);
    added.push(pkGift);
  }
  return added;
}

const _pkSaver = makeAutoSaver(() => {
  if (!pkCfg) return;
  return window.api.pkduo.setConfig(collectPkCfg()).catch(() => {});
});
function schedulePkAutoSave() { _pkSaver.schedule(); }

// 🎨 Nhãn skin auto: để "Tự động theo ngày" → hiện dịp đang áp hôm nay ("auto → 🎄 Noel" /
// "auto → (không có dịp)"); chọn tay → tên dịp. Dùng chung cho PK Nhóm / PK Đôi / Thi đấu.
function updateSkinHint(selectId, hintId) {
  const sel = document.getElementById(selectId), hint = document.getElementById(hintId);
  if (!sel || !hint || !window.OverlaySkin) return;
  const txt = OverlaySkin.autoLabel(sel.value);
  hint.textContent = txt;
  hint.title = txt; // hàng gọn 1 dòng (ellipsis) → rê chuột xem đầy đủ kế hoạch cả tháng
}
function wireSkinHint(selectId, hintId) {
  const sel = document.getElementById(selectId);
  if (sel) sel.addEventListener('change', () => updateSkinHint(selectId, hintId));
  updateSkinHint(selectId, hintId);
}

function wirePkDuoTab() {
  $('#pkJoinMode').addEventListener('change', () => {
    savePkActiveGifts();
    pkCfg.joinMode = $('#pkJoinMode').value === 'true';
    syncPkActiveGifts();
    if (pkCfg.joinMode) {
      applyPkCreator('A', { applyDefaultGift: !(pkCfg.teamA.joinGifts || []).length });
      applyPkCreator('B', { applyDefaultGift: !(pkCfg.teamB.joinGifts || []).length });
    }
    renderPkGifts();
    schedulePkAutoSave();
    toast(pkCfg.joinMode ? 'Đang chỉnh bảng quà Chọn Phe' : 'Đang chỉnh bảng quà Cố định');
  });
  $('#pkTiktokCombine')?.addEventListener('change', () => {
    pkCfg.tiktokCombine = $('#pkTiktokCombine').checked;
    schedulePkAutoSave();
    toast(pkCfg.tiktokCombine
      ? '📡 Kết hợp TikTok BẬT: quà tặng đúng Creator của phe tự cộng — chọn đúng Creator khi tặng trên TikTok.'
      : '📡 Kết hợp TikTok TẮT — chỉ tính theo chế độ nền.', 'success');
  });

  for (const side of ['A', 'B']) {
    $(`#pk${side}group`).addEventListener('change', () => {
      const nextGid = $(`#pk${side}group`).value;
      populatePkDuoTeamsFromGroup(nextGid);
      schedulePkAutoSave();
    });
    $(`#pk${side}creator`).addEventListener('change', () => {
      applyPkCreator(side, { applyDefaultGift: true, syncName: true });
      schedulePkAutoSave();
    });
  }

  $$('.pk-pick-master').forEach(btn => btn.addEventListener('click', async () => {
    const side = btn.dataset.team;
    const otherSide = side === 'A' ? 'B' : 'A';
    // Quà đội kia đã chọn: hiện XÁM + nhãn "Đội X" (không ẩn) để MC dễ nhận biết, không chọn trùng.
    const otherTeam = getTeam(otherSide);
    const otherLabel = (otherTeam.name || `TEAM ${otherSide}`).trim();
    const otherIds = [...pkGiftIds(otherSide)];
    const usedBy = Object.fromEntries(otherIds.map(id => [id, `Đội ${otherSide} • ${otherLabel}`]));
    const selected = await GiftPicker.open({
      title: pkCfg.joinMode ? `🎁 Chọn 1 quà kích hoạt cho Đội ${side}` : `🎁 Chọn nhiều quà cho Đội ${side}`,
      multi: !pkCfg.joinMode,
      disabledIds: otherIds,
      usedBy,
      selected: [...pkGiftIds(side)],
    });
    const picked = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    if (!picked.length) return;
    const added = addPkGifts(side, picked);
    savePkActiveGifts();
    renderPkGifts();
    schedulePkAutoSave();
    toast(pkCfg.joinMode ? `Đã chọn quà kích hoạt cho Đội ${side}` : `Đã thêm ${added.length} quà cho Đội ${side}`, added.length ? 'success' : 'error');
  }));

  $$('.pk-gifts').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types || []).includes('application/x-pk-gift')) return;
      e.preventDefault();
      zone.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/x-pk-gift') || '{}');
        const result = movePkGift(data.side, zone.dataset.team, Number(data.index), pkDropIndex(zone, e));
        if (result?.moved) {
          schedulePkAutoSave();
          toast(result.reordered ? `Đã sắp xếp quà Team ${zone.dataset.team}` : `Đã chuyển quà sang Team ${zone.dataset.team}`, 'success');
        }
      } catch {}
    });
  });

  $$('.pk-sound-file').forEach(btn => btn.addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) {
      setSoundInput(btn.dataset.target, filePathToUrl(file));
      await window.api.pkduo.setConfig(collectPkCfg());
      toast('Đã lưu âm thanh PK Đôi', 'success');
    }
  }));

  $('#pkBgOpacity').addEventListener('input', () => { $('#pkBgOpacityValue').textContent = `${$('#pkBgOpacity').value}%`; });
  $('#pkOverlayScale').addEventListener('input', () => {
    $('#pkOverlayScaleValue').textContent = `${$('#pkOverlayScale').value}%`;
    schedulePkAutoSave();
  });
  $('#pkFxThreshold')?.addEventListener('input', () => {
    $('#pkFxThresholdValue').textContent = `${$('#pkFxThreshold').value}%`;
    schedulePkAutoSave();
  });
  ['pkContent','pkAname','pkBname','pkAstreak','pkBstreak','pkAcolor','pkBcolor','pkDurH','pkDurM','pkDurS','pkPrep','pkDelay','pkPointsBy','pkBg','pkBgOpacity','pkTextSize','pkGiftSize','pkGiftDisplayMode','pkChampsEnabled','pkChampNames','pkArrowStyle','pkSelectFx','pkSkin','pkFxEnabled','pkFxMode','pkFxStyle'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', schedulePkAutoSave);
  });
  wireSkinHint('pkSkin', 'pkSkinHint');
  // 🎲 Đổi skin mũi tên ngẫu nhiên NGAY (chọn 1 skin cụ thể khác skin đang chọn) → áp dụng realtime.
  $('#pkArrowRandom')?.addEventListener('click', () => {
    const sel = $('#pkArrowStyle'); if (!sel) return;
    const pool = ['classic', 'core', 'rope', 'cannon'].filter(v => v !== sel.value);
    sel.value = pool[Math.floor(Math.random() * pool.length)];
    schedulePkAutoSave();
    toast('Mũi tên: ' + (sel.options[sel.selectedIndex]?.text || sel.value), 'success');
  });
  // Gõ tay Tên hiển thị → đánh dấu ghi đè, để nickname creator không tự đè lại (vẫn sửa được tự do).
  for (const side of ['A', 'B']) {
    $('#pk' + side + 'name')?.addEventListener('input', () => {
      const t = getTeam(side);
      if (t) t.nameOverride = true;
    });
  }

  // Cấu hình PK Đôi tự lưu real-time (schedulePkAutoSave). Ctrl+S để lưu thủ công tức thì.
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('.panel[data-panel="pkduo"]')?.classList.contains('active')) {
      e.preventDefault();
      await updatePkConfig();
    }
  });
  $('#pkStart').addEventListener('click', async () => {
    if ($('#pkStart').dataset.running === 'true') {
      await window.api.pkduo.stop();
      return;
    }
    if (!requireLive('BẮT ĐẦU PK Đôi')) return;
    await window.api.pkduo.setConfig(collectPkCfg());
    await window.api.pkduo.start();
  });
  $('#pkReset').addEventListener('click', async () => { await window.api.pkduo.reset(); });
  $('#pkResetAll')?.addEventListener('click', async () => {
    if (!confirm('RESET TẤT CẢ PK Đôi?\nXoá điểm, trạng thái VÀ chuỗi WIN của cả 2 phe (không hoàn tác).')) return;
    await window.api.pkduo.resetAll();
    toast('🗑️ Đã reset tất cả PK Đôi (kể cả chuỗi WIN)', 'success');
  });
  $('#pkAddA').addEventListener('click', () => testPkDuoGift('A', 1));
  $('#pkAddB').addEventListener('click', () => testPkDuoGift('B', 1));
  $('#pkSubA')?.addEventListener('click', () => testPkDuoGift('A', -1));
  $('#pkSubB')?.addEventListener('click', () => testPkDuoGift('B', -1));
  $('#pkCopyUrl').addEventListener('click', async () => {
    const url = await window.api.pkduo.getUrl();
    await window.api.shell.copyText(url);
    toast('📋 Đã copy link PK Đôi', 'success');
  });
  // Popup "🧪 Nhanh" (Test +100 / link OBS): bấm 1 mục hoặc click ra ngoài thì tự đóng.
  document.querySelectorAll('.pk-quick-menu button').forEach(b =>
    b.addEventListener('click', () => b.closest('details.pk-quick')?.removeAttribute('open')));
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.pk-quick[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
}

// Test quà PK Đôi: cộng/trừ quà phe A/B × số lượng nhập ở popup 🧪 Nhanh (sign<0 = trừ).
async function testPkDuoGift(side, sign = 1) {
  await window.api.pkduo.setConfig(collectPkCfg());
  const qty = Math.max(1, parseInt($('#pkTestQty')?.value, 10) || 1);
  const res = await window.api.pkduo.testGift(side, qty, sign);
  if (!res) { toast('Không test được quà phe này', 'error'); return; }
  const team = side === 'A' ? pkCfg.teamA : pkCfg.teamB;
  const name = team?.name || (side === 'A' ? 'TEAM A' : 'TEAM B');
  const sgn = res.points < 0 ? '−' : '+';
  toast(`${name}: ${sgn}${formatNumber(Math.abs(res.points))} (×${res.qty})${res.giftName ? ` · ${res.giftName}` : ''}`, 'success');
}

async function updatePkConfig() {
  const cfg = collectPkCfg();
  await window.api.pkduo.setConfig(cfg);
  toast('🔄 Đã cập nhật PK Đôi', 'success');
}

// Đếm tổng số trận PK Đôi đã lưu (xóa trận sai qua modal Lịch sử).
async function updatePkTotalMatches() {
  const el = $('#pkTotalMatches');
  if (!el) return;
  try {
    const list = await window.api.history.list({ type: 'duo' });
    el.textContent = `🏆 Tổng trận: ${Array.isArray(list) ? list.length : 0}`;
  } catch { el.textContent = ''; }
}

function collectPkCfg() {
  savePkActiveGifts();
  // Đồng bộ tên đang gõ vào team trước, tránh applyPkCreator ghi đè lại tên cũ
  pkCfg.teamA.name = $('#pkAname').value.trim() || 'TEAM A';
  pkCfg.teamB.name = $('#pkBname').value.trim() || 'TEAM B';
  applyPkCreator('A');
  applyPkCreator('B');
  savePkActiveGifts();
  const h = Number($('#pkDurH').value) || 0;
  const m = Number($('#pkDurM').value) || 0;
  const s = Number($('#pkDurS').value) || 0;
  const durationSec = Math.max(5, h * 3600 + m * 60 + s);
  return {
    teamA: { ...pkCfg.teamA, name: $('#pkAname').value.trim() || 'TEAM A', color: $('#pkAcolor').value, gifts: pkCfg.teamA.gifts || [], winStreak: Math.max(0, parseInt($('#pkAstreak')?.value, 10) || 0) },
    teamB: { ...pkCfg.teamB, name: $('#pkBname').value.trim() || 'TEAM B', color: $('#pkBcolor').value, gifts: pkCfg.teamB.gifts || [], winStreak: Math.max(0, parseInt($('#pkBstreak')?.value, 10) || 0) },
    durationSec,
    prepSec: Number($('#pkPrep').value) || 0,
    delaySec: Number($('#pkDelay').value) || 0,
    joinMode: $('#pkJoinMode').value === 'true',
    tiktokCombine: !!$('#pkTiktokCombine')?.checked,
    pointsBy: $('#pkPointsBy').value,
    bgColor: $('#pkBg').value,
    bgOpacity: Number($('#pkBgOpacity').value),
    giftSize: Number($('#pkGiftSize').value),
    giftDisplayMode: $('#pkGiftDisplayMode').value,
    textSize: Number($('#pkTextSize').value),
    overlayScale: Math.max(80, Math.min(300, Number($('#pkOverlayScale').value) || 200)),
    content: $('#pkContent').value.trim() || 'PK ĐÔI',
    startSound: gameplaySoundValue('scSndStart'),
    warningSound: gameplaySoundValue('scSndWarn'),
    teamASound: gameplaySoundValue('scSndSuccess'),
    teamBSound: gameplaySoundValue('scSndSuccess'),
    drawSound: gameplaySoundValue('scSndFail'),
    // Overlay FX toàn màn hình
    fxEnabled: $('#pkFxEnabled') ? $('#pkFxEnabled').value === 'true' : true,
    fxMode: $('#pkFxMode') ? $('#pkFxMode').value : 'both',
    fxStyle: $('#pkFxStyle') ? $('#pkFxStyle').value : 'auto',
    fxThreshold: $('#pkFxThreshold') ? Math.max(0, Math.min(60, Number($('#pkFxThreshold').value) || 8)) : 8,
    // Vinh danh TOP 3 người tặng quà (hiện trên overlay banner)
    championsEnabled: $('#pkChampsEnabled') ? $('#pkChampsEnabled').value === 'true' : true,
    championNames: $('#pkChampNames') ? $('#pkChampNames').value === 'true' : false,
    arrowStyle: $('#pkArrowStyle') ? $('#pkArrowStyle').value : 'random',
    selectFx: $('#pkSelectFx') ? $('#pkSelectFx').value : 'random',
    skin: $('#pkSkin') ? $('#pkSkin').value : 'auto',
  };
}

function renderPkPreview(st) {
  const sec = Math.ceil((st.remainingMs || 0) / 1000);
  const statusText = st.status === 'prestart' ? `Sắp bắt đầu — ${sec}s`
    : st.status === 'running' ? `Đang đấu — ${sec}s`
    : st.status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : st.status === 'finished' ? 'Đã kết thúc'
    : 'Chờ bắt đầu';
  const a = st.teamA || {}; const b = st.teamB || {};
  // CHỈ đồng bộ avatar để preview luôn tươi; KHÔNG gộp cả object team từ state engine.
  // State engine phát theo nhịp tim (~1s) mang cấu hình ĐÃ LƯU — nếu gộp đè sẽ cuốn phăng
  // quà vừa chỉnh tay chưa kịp auto-save (đội A/B "mất bớt" quà). pkCfg là nguồn sự thật khi biên tập.
  if (pkCfg) {
    if (a.creatorAvatar) pkCfg.teamA.creatorAvatar = a.creatorAvatar;
    if (b.creatorAvatar) pkCfg.teamB.creatorAvatar = b.creatorAvatar;
  }
  const running = st.status === 'prestart' || st.status === 'running' || st.status === 'grace';
  const startBtn = $('#pkStart');
  if (startBtn) {
    startBtn.dataset.running = running ? 'true' : 'false';
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('primary', !running);
    startBtn.classList.toggle('warn', running);
  }
  $('#pkPreview').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:680px">
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; align-items:center; font-size:13px; opacity:.92">
        <div style="display:flex; align-items:center; gap:8px; color:${escapeAttr(a.color || '#FE2C55')}">${a.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(a.creatorAvatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />` : ''}<b>${escapeHtml(a.name || 'TEAM A')}</b></div>
        <span style="text-align:center">${escapeHtml(statusText)}</span>
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; color:${escapeAttr(b.color || '#25F4EE')}"><b>${escapeHtml(b.name || 'TEAM B')}</b>${b.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(b.creatorAvatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" />` : ''}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px">
        <strong style="font-size:24px; min-width:70px; text-align:center; line-height:1">${formatNumber(st.scoreA || 0)}</strong>
        <div style="flex:1; height:18px; border-radius:10px; background:linear-gradient(90deg, ${escapeAttr(a.color || '#FE2C55')} 0 ${50 + (st.push || 0)}%, ${escapeAttr(b.color || '#25F4EE')} ${50 + (st.push || 0)}% 100%); transition:all .3s"></div>
        <strong style="font-size:24px; min-width:70px; text-align:center; line-height:1">${formatNumber(st.scoreB || 0)}</strong>
      </div>
    </div>
  `;

  // TOP người tặng quà cho mỗi đội (avatar trên, tên dưới) — cạnh nút "+ Thêm quà"
  const giverHtml = (g, i) => {
    const rank = i + 1;
    const av = g.avatar
      ? `<img class="js-avatar" src="${escapeAttr(g.avatar)}" onerror="this.onerror=null;this.src='../logo/hp-logo.png'" />`
      : `<img src="../logo/hp-logo.png" />`;
    const label = g.total ? `${escapeHtml(g.nickname || g.uniqueId || '')} • ${formatNumber(g.total)}` : escapeHtml(g.nickname || g.uniqueId || '');
    return `<div class="pk-giver top${rank}" title="${escapeAttr(label)}"><div class="pk-giver-avawrap"><div class="pk-giver-ava">${av}</div><span class="pk-giver-rank">${rank}</span></div><span class="pk-giver-name">${escapeHtml(g.nickname || g.uniqueId || '')}</span></div>`;
  };
  const topA = Array.isArray(st.topA) ? st.topA : [];
  const topB = Array.isArray(st.topB) ? st.topB : [];
  if ($('#pkTopA')) $('#pkTopA').innerHTML = topA.slice(0, 3).map(giverHtml).join('');
  if ($('#pkTopB')) $('#pkTopB').innerHTML = topB.slice(0, 3).map(giverHtml).join('');
}

// ============================================================
// GIỮ / ĐỔI (Keep/Change) — kế thừa cơ chế PK Đôi (Chọn Phe 1 quà + TikTok theo UID),
// bỏ avatar/champions/FX; thêm ghế nóng, chuỗi trụ ghế, số vòng, ngưỡng lật kèo, vị trí đồng hồ.
// ============================================================
function kcGetTeam(side) { return side === 'A' ? kcCfg.teamA : kcCfg.teamB; }
function kcGiftModeKey() { return kcCfg?.joinMode ? 'joinGifts' : 'fixedGifts'; }
function normalizeKcTeam(team, fallback) {
  const t = { ...fallback, ...(team || {}) };
  t.name = fallback.name;
  t.nameOverride = true;
  t.fixedGifts = Array.isArray(t.fixedGifts) ? t.fixedGifts : (Array.isArray(t.gifts) ? t.gifts : []);
  t.joinGifts = Array.isArray(t.joinGifts) ? t.joinGifts : [];
  t.gifts = Array.isArray(t.gifts) ? t.gifts : t.fixedGifts;
  return t;
}
// Quà mặc định của Giữ/Đổi: HOA HỒNG (Rose) trên TikTok (id 5655) — lấy icon chuẩn từ giftMaster, có fallback.
function kcRoseGift() {
  const m = giftMaster.find(g => String(g.id) === '5655') || giftMaster.find(g => /^rose$/i.test(String(g.name || '').trim()));
  return m ? giftToPkGift(m) : { giftName: 'Rose', giftId: '5655', icon: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.webp', diamond: 1 };
}
function syncKcActiveGifts() {
  if (!kcCfg) return;
  const key = kcCfg.joinMode ? 'joinGifts' : 'fixedGifts';
  if (kcCfg.joinMode) {
    kcCfg.teamA.joinGifts = (kcCfg.teamA.joinGifts || []).slice(0, 1);
    kcCfg.teamB.joinGifts = (kcCfg.teamB.joinGifts || []).slice(0, 1);
  }
  kcCfg.teamA.gifts = kcCfg.teamA[key] || [];
  kcCfg.teamB.gifts = kcCfg.teamB[key] || [];
}
function saveKcActiveGifts() {
  const key = kcGiftModeKey();
  kcCfg.teamA[key] = kcCfg.joinMode ? (kcCfg.teamA.gifts || []).slice(0, 1) : (kcCfg.teamA.gifts || []);
  kcCfg.teamB[key] = kcCfg.joinMode ? (kcCfg.teamB.gifts || []).slice(0, 1) : (kcCfg.teamB.gifts || []);
}

async function loadKcConfig() {
  const st = await window.api.kcduo.getState();
  const needsForcedDefaults = st.teamA?.name !== 'KEEP/GIỮ' || st.teamB?.name !== 'CHANGE/ĐỔI';
  kcCfg = {
    teamA: normalizeKcTeam(st.teamA, { name: 'KEEP/GIỮ', color: '#e60045' }),
    teamB: normalizeKcTeam(st.teamB, { name: 'CHANGE/ĐỔI', color: '#00afdb' }),
    performerName: st.performerName || '', nextName: st.nextName || '',
    rotationOrder: Array.isArray(st.rotationOrder) ? st.rotationOrder.map(n => String(n || '').trim()).filter(Boolean) : [],
    rotationSkip: Array.isArray(st.rotationSkip) ? st.rotationSkip.map(n => String(n || '').trim()).filter(Boolean) : [],
    defendStreak: Math.max(0, Number(st.defendStreak) || 0), totalRounds: Math.max(0, Number(st.totalRounds) || 0),
    flipMargin: Math.max(0, Number(st.flipMargin) || 0), flipMarginMode: st.flipMarginMode === 'point' ? 'point' : 'percent',
    durationSec: st.durationSec || 90, prepSec: st.prepSec ?? 3, delaySec: st.delaySec ?? 5,
    joinMode: !!st.joinMode, tiktokCombine: st.tiktokCombine !== false, pointsBy: st.pointsBy || 'diamond',
    content: st.content == null ? 'GIỮ / ĐỔI' : st.content, timerPos: ['left', 'right', 'center'].includes(st.timerPos) ? st.timerPos : 'center',
    giftSize: st.giftSize || 46, textSize: st.textSize || 21, overlayScale: st.overlayScale || 200,
    giftDisplayMode: st.giftDisplayMode || 'scroll', skin: st.skin || 'auto',
    startSound: st.startSound || '', warningSound: st.warningSound || '', keepSound: st.keepSound || '', changeSound: st.changeSound || '', drawSound: st.drawSound || '',
  };
  // Mặc định quà tính điểm GIỮ = HOA HỒNG khi chưa cấu hình (không đụng ĐỔI để 2 phe không trùng quà).
  {
    const key = kcCfg.joinMode ? 'joinGifts' : 'fixedGifts';
    if (!(kcCfg.teamA[key] || []).length) { kcCfg.teamA[key] = [kcRoseGift()]; scheduleKcAutoSave(); }
  }
  syncKcActiveGifts();
  renderKcCreatorSelects();
  // Khi app đang khóa vào một nhóm, nhóm đó là mặc định của cả hai phe.
  // Ở TALENT SHOW vẫn giữ lựa chọn nhóm riêng của từng phe đã lưu.
  if (activeGroupId) { applyKcDefaultMembers(activeGroupId); scheduleKcAutoSave(); }
  $('#kcContent').value = kcCfg.content || '';
  $('#kcPerformer').value = kcCfg.performerName || '';
  $('#kcNextName').value = kcCfg.nextName || '';
  $('#kcDefend').value = kcCfg.defendStreak;
  $('#kcRounds').value = kcCfg.totalRounds;
  $('#kcFlipMargin').value = kcCfg.flipMargin;
  $('#kcFlipMode').value = kcCfg.flipMarginMode;
  $('#kcTimerPos').value = kcCfg.timerPos;
  $('#kcAname').value = kcCfg.teamA?.name || 'KEEP/GIỮ';
  $('#kcAcolor').value = normalizeHexColor(kcCfg.teamA?.color, '#FE2C55');
  $('#kcBname').value = kcCfg.teamB?.name || 'CHANGE/ĐỔI';
  $('#kcBcolor').value = normalizeHexColor(kcCfg.teamB?.color, '#00D5FF');
  const d = kcCfg.durationSec || 90;
  $('#kcDurH').value = Math.floor(d / 3600);
  $('#kcDurM').value = Math.floor((d % 3600) / 60);
  $('#kcDurS').value = d % 60;
  $('#kcPrep').value = kcCfg.prepSec;
  $('#kcDelay').value = kcCfg.delaySec;
  $('#kcJoinMode').value = String(kcCfg.joinMode);
  if ($('#kcTiktokCombine')) $('#kcTiktokCombine').checked = !!kcCfg.tiktokCombine;
  $('#kcPointsBy').value = kcCfg.pointsBy;
  $('#kcTextSize').value = kcCfg.textSize;
  $('#kcGiftSize').value = kcCfg.giftSize;
  $('#kcGiftDisplayMode').value = kcCfg.giftDisplayMode || 'scroll';
  $('#kcOverlayScale').value = kcCfg.overlayScale;
  $('#kcOverlayScaleValue').textContent = `${$('#kcOverlayScale').value}%`;
  if ($('#kcSkin')) { $('#kcSkin').value = kcCfg.skin || 'auto'; updateSkinHint('kcSkin', 'kcSkinHint'); }
  renderKcGifts();
  renderKcPreview(st);
  if (needsForcedDefaults) scheduleKcAutoSave();
}

function renderKcCreatorSelects() {
  if (!kcCfg || !$('#kcAgroup')) return;
  for (const side of ['A', 'B']) {
    const groupSel = $(`#kc${side}group`);
    const gs = visibleGroups();
    const groupField = groupSel.closest('label');
    if (groupField) groupField.hidden = !!activeGroupId;
    const current = activeGroupId || kcGetTeam(side).groupId || '';
    groupSel.innerHTML = '<option value="">— Chọn nhóm —</option>' + gs.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    groupSel.value = gs.some(g => g.id === current) ? current : '';
    renderKcCreatorSelect(side);
  }
  renderKcMemberNames();
}
// Người đang diễn / người kế tiếp chỉ lấy từ các nhóm đã chọn ở Giữ/Đổi. Khi 2 phe dùng
// hai nhóm khác nhau thì gộp thành viên của cả hai, nhưng không khóa lựa chọn đã chọn.
function kcMemberGroupIds() {
  if (activeGroupId) return [activeGroupId];
  return [...new Set(['A', 'B'].map(side => $(`#kc${side}group`)?.value).filter(Boolean))];
}
// Tên thành viên (đã gộp/khử trùng) của các nhóm đang chọn, theo THỨ TỰ GỐC (lúc thêm vào nhóm).
function kcCurrentMemberNames() {
  const groupIds = kcMemberGroupIds();
  const members = groupIds.length
    ? creators.filter(c => groupIds.includes(c.groupId))
    : visibleCreators();
  return [...new Set(members.map(c => (c.nickname || c.tiktokId || '').trim()).filter(Boolean))];
}
// Sắp lại theo THỨ TỰ LƯỢT DIỄN đã lưu (kcCfg.rotationOrder): tên đã xếp lên trước đúng thứ tự;
// thành viên mới (chưa xếp) nối vào cuối theo thứ tự gốc. Tên lạ trong order tự bị bỏ qua.
function kcOrderedNames(names) {
  const set = new Set(names), seen = new Set(), out = [];
  for (const n of (kcCfg?.rotationOrder || [])) {
    const s = String(n || '').trim();
    if (s && set.has(s) && !seen.has(s)) { out.push(s); seen.add(s); }
  }
  for (const n of names) if (!seen.has(n)) { out.push(n); seen.add(n); }
  return out;
}
function renderKcMemberNames() {
  const names = kcOrderedNames(kcCurrentMemberNames());
  for (const [id, placeholder] of [
    ['kcPerformer', '— Chọn người đang diễn —'],
    ['kcNextName', '— Chọn người kế tiếp —'],
  ]) {
    const select = $('#' + id);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>` + names.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
    select.value = names.includes(current) ? current : '';
  }
  renderKcOrderList();
}
// Tên thành viên OFFLINE / không tham gia lượt này (bỏ tích) — bị bỏ qua khi xoay vòng chọn người kế.
function kcIsSkipped(name) {
  return (kcCfg?.rotationSkip || []).map(n => String(n || '').trim()).includes(String(name || '').trim());
}
function setKcSkipped(name, skipped) {
  if (!kcCfg) return;
  const nm = String(name || '').trim();
  let arr = (kcCfg.rotationSkip || []).map(n => String(n || '').trim()).filter(Boolean);
  if (skipped) { if (!arr.includes(nm)) arr.push(nm); }
  else arr = arr.filter(n => n !== nm);
  kcCfg.rotationSkip = arr;
}
// Bảng "Thứ tự lượt diễn": mỗi thành viên 1 dòng — ô tích tham gia + nút ↑ / ↓ đổi vị trí.
function renderKcOrderList() {
  const box = $('#kcOrderList');
  if (!box) return;
  const names = kcOrderedNames(kcCurrentMemberNames());
  if (!names.length) {
    box.innerHTML = '<div class="kc-order-empty">Chưa có thành viên trong nhóm đã chọn.</div>';
    return;
  }
  box.innerHTML = names.map((n, i) => {
    const off = kcIsSkipped(n);
    return `
    <div class="kc-order-row${off ? ' kc-order-off' : ''}" data-name="${escapeAttr(n)}">
      <span class="kc-order-idx">${i + 1}</span>
      <label class="kc-order-join" title="Bỏ tích nếu thành viên OFFLINE / không tham gia lượt này — sẽ bị bỏ qua khi xoay vòng">
        <input type="checkbox" class="kc-order-check"${off ? '' : ' checked'} />
      </label>
      <span class="kc-order-name" title="${escapeAttr(n)}">${escapeHtml(n)}${off ? ' <span class="kc-order-tag">nghỉ</span>' : ''}</span>
      <span class="kc-order-btns">
        <button type="button" data-dir="-1" title="Lên trên"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" data-dir="1" title="Xuống dưới"${i === names.length - 1 ? ' disabled' : ''}>↓</button>
      </span>
    </div>`;
  }).join('');
}
// Đổi chỗ 1 thành viên theo hướng dir (-1 lên / +1 xuống); lưu lại rotationOrder rồi vẽ lại.
function moveKcOrder(name, dir) {
  const names = kcOrderedNames(kcCurrentMemberNames());
  const i = names.indexOf(name), j = i + dir;
  if (i < 0 || j < 0 || j >= names.length) return;
  [names[i], names[j]] = [names[j], names[i]];
  if (kcCfg) kcCfg.rotationOrder = names;
  renderKcMemberNames();
  scheduleKcAutoSave();
}
function renderKcCreatorSelect(side) {
  const team = kcGetTeam(side);
  const groupId = activeGroupId || $(`#kc${side}group`)?.value || team.groupId || '';
  const sel = $(`#kc${side}creator`);
  if (!sel) return;
  const current = sel.value || team.creatorId || '';
  const filtered = visibleCreators().filter(c => !groupId || c.groupId === groupId);
  sel.innerHTML = '<option value="">— Chọn thành viên —</option>' + filtered.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`).join('');
  sel.value = filtered.some(c => c.id === current) ? current : '';
}
function applyKcCreator(side, opts = {}) {
  const team = kcGetTeam(side);
  const group = groups.find(g => g.id === (activeGroupId || $(`#kc${side}group`).value));
  const creator = creators.find(c => c.id === $(`#kc${side}creator`).value);
  team.groupId = group?.id || '';
  team.groupName = group?.name || '';
  team.creatorId = creator?.id || '';
  team.creatorName = creator?.nickname || creator?.tiktokId || '';
  if (opts.syncName && creator && !team.nameOverride) {
    team.name = creator.nickname || creator.tiktokId || team.name;
  }
  if (creator && kcCfg?.joinMode && (opts.applyDefaultGift || !(team.joinGifts || []).length)) {
    const gift = creatorDefaultGift(creator);
    if (gift) {
      team.joinGifts = [gift];
      team.gifts = team.joinGifts;
      team.giftOverride = false;
      renderKcGifts();
    }
  }
  $(`#kc${side}name`).value = team.name || (side === 'A' ? 'GIỮ' : 'ĐỔI');
}
// Mặc định gán NHÓM chỉ định + THÀNH VIÊN tính điểm cho cả 2 phe (giống PK Đôi), nhưng KHÔNG đổi
// tên phe (giữ nhãn GIỮ/ĐỔI trên overlay) và KHÔNG đụng quà tính điểm. Giữ thành viên đã chọn nếu
// còn trong nhóm; phe chưa chọn thì lấy thành viên kế chưa dùng để 2 phe không trùng người.
function applyKcDefaultMembers(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  const members = membersOfGroup(groupId);
  const used = new Set();
  for (const side of ['A', 'B']) {
    const team = kcGetTeam(side);
    let creator = members.find(c => c.id === team.creatorId && !used.has(c.id));
    if (!creator) creator = members.find(c => !used.has(c.id));
    if (creator) used.add(creator.id);
    team.groupId = group.id;
    team.groupName = group.name;
    team.creatorId = creator?.id || '';
    team.creatorName = creator?.nickname || creator?.tiktokId || '';
    const gsel = $(`#kc${side}group`); if (gsel) gsel.value = group.id;
    renderKcCreatorSelect(side);
    const csel = $(`#kc${side}creator`); if (csel) csel.value = creator?.id || '';
  }
  renderKcMemberNames();
}

function renderKcGifts() {
  const joinMode = !!kcCfg?.joinMode;
  for (const side of ['A', 'B']) {
    const wrap = $(`#kc${side}gifts`);
    if (!wrap) continue;
    wrap.dataset.team = side;
    wrap.innerHTML = '';
    const team = kcGetTeam(side);
    (team.gifts || []).forEach((g, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = g.giftName || g.giftId || '';
      chip.innerHTML = `${g.icon ? `<img src="${escapeAttr(g.icon)}" />` : '🎁'}<button type="button">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        team.gifts.splice(i, 1);
        saveKcActiveGifts();
        if (joinMode) { team.giftOverride = false; applyKcCreator(side, { applyDefaultGift: true }); }
        renderKcGifts();
        scheduleKcAutoSave();
      });
      wrap.appendChild(chip);
    });
  }
  $$('.kc-pick-master').forEach(btn => { btn.textContent = joinMode ? 'Chọn quà kích hoạt' : '+ Thêm quà'; });
}

function kcGiftIds(side) {
  const team = kcGetTeam(side);
  return new Set((team.gifts || []).map(g => String(g.giftId || g.id || '')));
}
function addKcGifts(side, gifts) {
  const team = kcGetTeam(side);
  const other = side === 'A' ? kcCfg.teamB : kcCfg.teamA;
  team.gifts = team.gifts || [];
  if (kcCfg.joinMode) {
    const first = gifts?.[0];
    if (!first) return [];
    const g = first.giftName ? first : giftToPkGift(first);
    const id = String(g.giftId || g.id || '');
    if (id && (other.gifts || []).some(x => String(x.giftId || x.id || '') === id)) return [];
    team.gifts = [g];
    team.joinGifts = team.gifts;
    team.giftOverride = true;
    return [g];
  }
  const existing = new Set(team.gifts.map(g => String(g.giftId || g.id || '')));
  const blocked = new Set((other.gifts || []).map(g => String(g.giftId || g.id || '')));
  const added = [];
  for (const g of gifts) {
    const id = String(g.id || g.giftId);
    if (existing.has(id) || blocked.has(id)) continue;
    const pkGift = g.giftName ? g : giftToPkGift(g);
    team.gifts.push(pkGift);
    existing.add(id);
    added.push(pkGift);
  }
  return added;
}

const _kcSaver = makeAutoSaver(() => {
  if (!kcCfg) return;
  return window.api.kcduo.setConfig(collectKcCfg()).catch(() => {});
});
function scheduleKcAutoSave() { _kcSaver.schedule(); }

function collectKcCfg() {
  saveKcActiveGifts();
  kcCfg.teamA.name = 'KEEP/GIỮ';
  kcCfg.teamA.nameOverride = true;
  kcCfg.teamB.name = 'CHANGE/ĐỔI';
  kcCfg.teamB.nameOverride = true;
  applyKcCreator('A');
  applyKcCreator('B');
  saveKcActiveGifts();
  const h = Number($('#kcDurH').value) || 0;
  const m = Number($('#kcDurM').value) || 0;
  const s = Number($('#kcDurS').value) || 0;
  const durationSec = Math.max(5, h * 3600 + m * 60 + s);
  return {
    teamA: { ...kcCfg.teamA, name: 'KEEP/GIỮ', nameOverride: true, color: $('#kcAcolor').value, gifts: kcCfg.teamA.gifts || [] },
    teamB: { ...kcCfg.teamB, name: 'CHANGE/ĐỔI', nameOverride: true, color: $('#kcBcolor').value, gifts: kcCfg.teamB.gifts || [] },
    performerName: $('#kcPerformer').value.trim(),
    nextName: $('#kcNextName').value.trim(),
    rotationOrder: Array.isArray(kcCfg.rotationOrder) ? kcCfg.rotationOrder : [],
    rotationSkip: Array.isArray(kcCfg.rotationSkip) ? kcCfg.rotationSkip : [],
    defendStreak: Math.max(0, parseInt($('#kcDefend').value, 10) || 0),
    totalRounds: Math.max(0, parseInt($('#kcRounds').value, 10) || 0),
    flipMargin: Math.max(0, Number($('#kcFlipMargin').value) || 0),
    flipMarginMode: $('#kcFlipMode').value === 'point' ? 'point' : 'percent',
    timerPos: $('#kcTimerPos').value,
    durationSec,
    prepSec: Number($('#kcPrep').value) || 0,
    delaySec: Number($('#kcDelay').value) || 0,
    joinMode: $('#kcJoinMode').value === 'true',
    tiktokCombine: !!$('#kcTiktokCombine')?.checked,
    pointsBy: $('#kcPointsBy').value,
    giftSize: Number($('#kcGiftSize').value),
    giftDisplayMode: $('#kcGiftDisplayMode').value,
    textSize: Number($('#kcTextSize').value),
    overlayScale: Math.max(80, Math.min(300, Number($('#kcOverlayScale').value) || 200)),
    content: $('#kcContent').value.trim(),
    startSound: gameplaySoundValue('scSndStart'),
    warningSound: gameplaySoundValue('scSndWarn'),
    keepSound: gameplaySoundValue('scSndSuccess'),
    changeSound: gameplaySoundValue('scSndSuccess'),
    drawSound: gameplaySoundValue('scSndFail'),
    skin: $('#kcSkin') ? $('#kcSkin').value : 'auto',
  };
}

// State từ engine (~1s/nhịp) mang cấu hình ĐÃ LƯU — chỉ đọc để cập nhật chỉ số động (điểm/vòng/trụ),
// KHÔNG gộp đè kcCfg (tránh cuốn phăng quà/tên đang chỉnh tay chưa auto-save).
function renderKcPreview(st) {
  if (!st) return;
  const sec = Math.ceil((st.remainingMs || 0) / 1000);
  const statusText = st.status === 'prestart' ? `Sắp bắt đầu — ${sec}s`
    : st.status === 'running' ? `Đang chạy — ${sec}s`
    : st.status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : st.status === 'finished' ? (st.winnerSide === 'B' ? 'KẾT THÚC · ĐỔI NGƯỜI' : 'KẾT THÚC · GIỮ GHẾ')
    : 'Chờ bắt đầu';
  const a = st.teamA || {}; const b = st.teamB || {};
  const running = ['prestart', 'running', 'grace'].includes(st.status);
  const startBtn = $('#kcStart');
  if (startBtn) {
    startBtn.dataset.running = running ? 'true' : 'false';
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('primary', !running);
    startBtn.classList.toggle('warn', running);
  }
  const push = Number(st.push || 0);
  const seat = String(st.performerName || '').trim();
  const box = $('#kcPreview');
  if (!box) return;
  box.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:680px">
      <div style="display:flex; justify-content:space-between; font-size:12px; opacity:.85">
        <span>MVP: <b>${formatNumber(st.defendStreak || 0)}</b></span>
        ${seat ? `<span>🎤 <b>${escapeHtml(seat)}</b></span>` : ''}
        <span>🔁 Vòng: <b>${formatNumber(st.totalRounds || 0)}</b></span>
      </div>
      <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; font-size:13px; opacity:.92">
        <b style="color:${escapeAttr(a.color || '#FE2C55')}">${escapeHtml(a.name || 'GIỮ')}</b>
        <span style="text-align:center">${escapeHtml(statusText)}</span>
        <b style="text-align:right; color:${escapeAttr(b.color || '#00D5FF')}">${escapeHtml(b.name || 'ĐỔI')}</b>
      </div>
      <div style="display:flex; align-items:center; gap:8px">
        <strong style="font-size:24px; min-width:70px; text-align:center; line-height:1">${formatNumber(st.scoreA || 0)}</strong>
        <div style="flex:1; height:18px; border-radius:10px; background:linear-gradient(90deg, ${escapeAttr(a.color || '#FE2C55')} 0 ${50 + push}%, ${escapeAttr(b.color || '#00D5FF')} ${50 + push}% 100%); transition:all .3s"></div>
        <strong style="font-size:24px; min-width:70px; text-align:center; line-height:1">${formatNumber(st.scoreB || 0)}</strong>
      </div>
    </div>`;
}

// Broadcast kcduo:config (engine tự cập nhật sau ván) → đồng bộ các ô chỉ số + tên phe.
function applyKcConfigBroadcast(cfg) {
  if (!cfg || !kcCfg) return;
  if (typeof cfg.defendStreak === 'number') { kcCfg.defendStreak = cfg.defendStreak; if (document.activeElement !== $('#kcDefend')) $('#kcDefend').value = cfg.defendStreak; }
  if (typeof cfg.totalRounds === 'number') { kcCfg.totalRounds = cfg.totalRounds; if (document.activeElement !== $('#kcRounds')) $('#kcRounds').value = cfg.totalRounds; }
  if (typeof cfg.performerName === 'string') { kcCfg.performerName = cfg.performerName; if (document.activeElement !== $('#kcPerformer')) $('#kcPerformer').value = cfg.performerName; }
  if (typeof cfg.nextName === 'string') { kcCfg.nextName = cfg.nextName; if (document.activeElement !== $('#kcNextName')) $('#kcNextName').value = cfg.nextName; }
}

async function testKcDuoGift(side, sign = 1) {
  await window.api.kcduo.setConfig(collectKcCfg());
  const qty = Math.max(1, parseInt($('#kcTestQty')?.value, 10) || 1);
  const res = await window.api.kcduo.testGift(side, qty, sign);
  if (!res) { toast('Không test được quà phe này', 'error'); return; }
  const team = side === 'A' ? kcCfg.teamA : kcCfg.teamB;
  const name = team?.name || (side === 'A' ? 'GIỮ' : 'ĐỔI');
  const sgn = res.points < 0 ? '−' : '+';
  toast(`${name}: ${sgn}${formatNumber(Math.abs(res.points))} (×${res.qty})${res.giftName ? ` · ${res.giftName}` : ''}`, 'success');
}

function wireKcDuoTab() {
  if (!$('#kcJoinMode')) return;
  $('#kcJoinMode').addEventListener('change', () => {
    saveKcActiveGifts();
    kcCfg.joinMode = $('#kcJoinMode').value === 'true';
    syncKcActiveGifts();
    if (kcCfg.joinMode) {
      applyKcCreator('A', { applyDefaultGift: !(kcCfg.teamA.joinGifts || []).length });
      applyKcCreator('B', { applyDefaultGift: !(kcCfg.teamB.joinGifts || []).length });
    }
    renderKcGifts();
    scheduleKcAutoSave();
    toast(kcCfg.joinMode ? 'Đang chỉnh quà Chọn Phe' : 'Đang chỉnh quà Cố định');
  });
  $('#kcTiktokCombine')?.addEventListener('change', () => {
    kcCfg.tiktokCombine = $('#kcTiktokCombine').checked;
    scheduleKcAutoSave();
    toast(kcCfg.tiktokCombine
      ? '📡 Kết hợp TikTok BẬT: quà tặng đúng Creator của phe tự cộng — chọn đúng Creator khi tặng trên TikTok.'
      : '📡 Kết hợp TikTok TẮT — chỉ tính theo chế độ nền.', 'success');
  });

  for (const side of ['A', 'B']) {
    $(`#kc${side}group`).addEventListener('change', () => {
      renderKcCreatorSelect(side);
      const csel = $(`#kc${side}creator`);
      if (csel && !csel.value) { // tự chọn thành viên đầu (khác phe kia) nếu nhóm mới chưa có ai
        const otherId = kcGetTeam(side === 'A' ? 'B' : 'A').creatorId;
        const first = membersOfGroup($(`#kc${side}group`).value).find(c => c.id !== otherId);
        if (first) csel.value = first.id;
      }
      applyKcCreator(side); // không syncName/không ép quà: giữ nhãn GIỮ/ĐỔI + quà tính điểm
      renderKcMemberNames();
      scheduleKcAutoSave();
    });
    $(`#kc${side}creator`).addEventListener('change', () => {
      applyKcCreator(side); // chỉ gán người tính điểm, giữ nhãn phe + quà
      scheduleKcAutoSave();
    });
    $(`#kc${side}name`).addEventListener('input', () => {
      const t = kcGetTeam(side);
      if (t) t.nameOverride = true;
    });
  }

  // Thứ tự lượt diễn: bấm ↑ / ↓ để đổi vị trí thành viên (uỷ quyền sự kiện trên cả danh sách).
  $('#kcOrderList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-dir]');
    if (!btn) return;
    const name = btn.closest('.kc-order-row')?.dataset.name;
    if (name) moveKcOrder(name, Number(btn.dataset.dir));
  });
  // Ô tích tham gia: bỏ tích = OFFLINE → thêm vào rotationSkip (bị bỏ qua khi xoay vòng chọn người kế).
  $('#kcOrderList')?.addEventListener('change', (e) => {
    const cb = e.target.closest('.kc-order-check');
    if (!cb) return;
    const name = cb.closest('.kc-order-row')?.dataset.name;
    if (!name) return;
    setKcSkipped(name, !cb.checked);
    renderKcOrderList();
    scheduleKcAutoSave();
  });

  $$('.kc-pick-master').forEach(btn => btn.addEventListener('click', async () => {
    const side = btn.dataset.team;
    const otherSide = side === 'A' ? 'B' : 'A';
    const otherTeam = kcGetTeam(otherSide);
    const otherLabel = (otherTeam.name || (otherSide === 'A' ? 'GIỮ' : 'ĐỔI')).trim();
    const otherIds = [...kcGiftIds(otherSide)];
    const usedBy = Object.fromEntries(otherIds.map(id => [id, `Phe ${otherLabel}`]));
    const selected = await GiftPicker.open({
      title: kcCfg.joinMode ? `🎁 Chọn 1 quà kích hoạt cho phe ${otherSide === 'A' ? 'ĐỔI' : 'GIỮ'}` : `🎁 Chọn quà cho phe ${side === 'A' ? 'GIỮ' : 'ĐỔI'}`,
      multi: !kcCfg.joinMode,
      disabledIds: otherIds,
      usedBy,
      selected: [...kcGiftIds(side)],
    });
    const picked = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    if (!picked.length) return;
    const added = addKcGifts(side, picked);
    saveKcActiveGifts();
    renderKcGifts();
    scheduleKcAutoSave();
    toast(added.length ? `Đã thêm quà cho phe ${side === 'A' ? 'GIỮ' : 'ĐỔI'}` : 'Không thêm được (trùng phe kia?)', added.length ? 'success' : 'error');
  }));

  $('#kcOverlayScale').addEventListener('input', () => {
    $('#kcOverlayScaleValue').textContent = `${$('#kcOverlayScale').value}%`;
    scheduleKcAutoSave();
  });
  ['kcContent', 'kcPerformer', 'kcNextName', 'kcDefend', 'kcRounds', 'kcFlipMargin', 'kcFlipMode', 'kcTimerPos', 'kcAname', 'kcBname', 'kcAcolor', 'kcBcolor', 'kcDurH', 'kcDurM', 'kcDurS', 'kcPrep', 'kcDelay', 'kcPointsBy', 'kcTextSize', 'kcGiftSize', 'kcGiftDisplayMode', 'kcSkin'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    // Ô màu nghe 'input' (cập nhật REALTIME khi kéo bảng màu), chỉ SELECT dùng 'change'.
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', scheduleKcAutoSave);
  });
  wireSkinHint('kcSkin', 'kcSkinHint');

  $('#kcStart').addEventListener('click', async () => {
    if ($('#kcStart').dataset.running === 'true') { await window.api.kcduo.stop(); return; }
    if (!requireLive('BẮT ĐẦU Giữ/Đổi')) return;
    await window.api.kcduo.setConfig(collectKcCfg());
    await window.api.kcduo.start();
  });
  $('#kcReset').addEventListener('click', async () => { await window.api.kcduo.reset(); });
  $('#kcResetAll')?.addEventListener('click', async () => {
    if (!confirm('RESET TẤT CẢ Giữ/Đổi?\nXoá điểm, chuỗi trụ ghế, số vòng và người kế (không hoàn tác).')) return;
    await window.api.kcduo.resetAll();
    toast('🗑️ Đã reset tất cả Giữ/Đổi', 'success');
  });
  $('#kcAddA').addEventListener('click', () => testKcDuoGift('A', 1));
  $('#kcAddB').addEventListener('click', () => testKcDuoGift('B', 1));
  $('#kcSubA')?.addEventListener('click', () => testKcDuoGift('A', -1));
  $('#kcSubB')?.addEventListener('click', () => testKcDuoGift('B', -1));
  $('#kcCopyUrl').addEventListener('click', async () => {
    const url = await window.api.kcduo.getUrl();
    await window.api.shell.copyText(url);
    toast('📋 Đã copy link Giữ/Đổi', 'success');
  });
  document.querySelectorAll('.panel[data-panel="kcduo"] .pk-quick-menu button').forEach(b =>
    b.addEventListener('click', () => b.closest('details.pk-quick')?.removeAttribute('open')));

  window.api.on('kcduo:state', (st) => renderKcPreview(st));
  window.api.on('kcduo:config', (cfg) => applyKcConfigBroadcast(cfg));
}

// ============================================================
// PK Nhóm
// ============================================================
// Ghi chú riêng cho 🎮 Chế độ TikTok: tự bật + hiển thị khi chọn mode này (đồng bộ với default & migration ở main.js).
const PKG_TIKTOK_NOTE = 'Chọn Creator tại hộp quà tặng trong App trước khi tặng quà để đảm bảo điểm hoạt động đúng tính năng';
function syncPkGroupMvpTotalsFromState(st = {}) {
  if (!Array.isArray(st.participants)) return;
  const totals = new Map();
  st.participants.forEach(p => {
    const id = String(p.creatorId || p.id || '');
    if (id) totals.set(id, Math.max(0, Math.floor(Number(p.mvpTotal) || 0)));
  });
  pkGroupMvpTotals = totals;
  pkGroupMvpTotalsGroupId = String(st.groupId || '');
}
function pkGroupMvpTotalFor(creatorId) {
  const groupId = String($('#pkgGroup')?.value || pkGroupCfg?.groupId || '');
  return pkGroupMvpTotalsGroupId === groupId ? (pkGroupMvpTotals.get(String(creatorId || '')) || 0) : 0;
}
function renderPkGroupMvpTotals() {
  const wrap = $('#pkgMvpTotals');
  if (!wrap || !pkGroupCfg || wrap.contains(document.activeElement)) return;
  const groupId = $('#pkgGroup')?.value || pkGroupCfg.groupId || '';
  const members = visibleCreators().filter(c => c.groupId === groupId);
  if (!groupId) {
    wrap.innerHTML = '<div class="hint">Chọn nhóm để quản lý tổng MVP.</div>';
    return;
  }
  if (!members.length) {
    wrap.innerHTML = '<div class="hint">Nhóm này chưa có Creator.</div>';
    return;
  }
  const renderKey = `${groupId}|${members.map(c => `${c.id}:${pkGroupMvpTotalFor(c.id)}:${c.nickname || c.tiktokId || ''}:${c.avatar || ''}`).join('|')}`;
  if (renderKey === pkGroupMvpTotalsRenderKey) return;
  pkGroupMvpTotalsRenderKey = renderKey;
  wrap.innerHTML = members.map(c => {
    const total = pkGroupMvpTotalFor(c.id);
    return `<div class="pkg-mvp-total-row" data-id="${escapeAttr(c.id)}"><img src="${escapeAttr(c.avatar || '../logo/hp-logo.png')}" /><div class="pkg-mvp-total-name"><b>${escapeHtml(c.nickname || c.tiktokId || 'Creator')}</b></div><input class="pkg-mvp-total-input" type="number" min="0" max="999999" value="${total}" title="Tổng MVP" /><button class="ghost tiny pkg-mvp-total-save" type="button">Lưu</button></div>`;
  }).join('');
  wrap.querySelectorAll('.pkg-mvp-total-row').forEach(row => {
    const save = async () => {
      const creatorId = row.dataset.id;
      const input = row.querySelector('.pkg-mvp-total-input');
      const total = Math.max(0, Math.min(999999, Math.floor(Number(input?.value) || 0)));
      if (input) input.value = total;
      const saved = await window.api.pkgroup.setMvpTotal(creatorId, groupId, total);
      if (!saved) { toast('Không lưu được tổng MVP', 'error'); return; }
      pkGroupMvpTotalsGroupId = String(groupId);
      pkGroupMvpTotals.set(creatorId, Number(saved.total) || 0);
      pkGroupMvpTotalsRenderKey = '';
      renderPkGroupMvpTotals();
      toast(`🏆 Đã đặt tổng MVP: ${formatNumber(saved.total)}`, 'success');
    };
    row.querySelector('.pkg-mvp-total-save').addEventListener('click', save);
    row.querySelector('.pkg-mvp-total-input').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  });
}
async function loadPkGroupConfig() {
  const st = await window.api.pkgroup.getState();
  syncPkGroupMvpTotalsFromState(st);
  pkGroupCfg = {
    content: st.content || 'PK NHÓM',
    groupId: st.groupId || '',
    layoutMode: st.layoutMode || 'joined',
    playMode: st.playMode || 'fixed',
    tiktokCombine: !!(st.tiktokCombine || st.creatorLive),
    pointsBy: st.pointsBy || 'diamond',
    noteEnabled: !!st.noteEnabled,
    noteText: st.noteText || 'Chọn Creator tại hộp quà tặng trong App trước khi tặng quà để đảm bảo điểm hoạt động đúng tính năng',
    noteBgColor: st.noteBgColor || '#1f2430',
    noteTextColor: st.noteTextColor || '#ffffff',
    noteSpeedSec: st.noteSpeedSec || 16,
    noteEffect: st.noteEffect || 'soft',
    separatedGap: st.separatedGap ?? 180,
    autoTextContrast: !!st.autoTextContrast,
    showMvpTotals: !!st.showMvpTotals,
    durationSec: st.durationSec || 90,
    prepSec: st.prepSec ?? 3,
    delaySec: st.delaySec ?? 5,
    textSize: st.textSize || 30,
    nameSize: st.nameSize || 100,
    giftSize: st.giftSize || 60,
    overlayScale: st.overlayScale || 200,
    selectFx: st.selectFx || 'random',
    creatorColors: st.creatorColors || {},
    smartColor: st.smartColor !== false,
    participants: Array.isArray(st.participants) ? st.participants : [],
  };
  renderPkGroupGroupSelect();
  // Hồ sơ nhóm: nếu nhóm đang chọn đã có thông số riêng → nạp lại; nếu chưa → tạo hồ sơ từ cấu hình hiện tại.
  if (pkGroupCfg.groupId) {
    if (getGroupProfile(pkGroupCfg.groupId).pkGroup) applyPkGroupProfile(pkGroupCfg.groupId);
    else snapshotPkGroupToProfile(pkGroupCfg.groupId);
  }
  applyPkGroupCfgToInputs();
  renderPkGroupMembers();
  renderPkGroupMvpTotals();
  renderPkGroupPreview(st);
}

// Đổ toàn bộ thông số PK Nhóm hiện tại vào các input (dùng khi tải lần đầu và khi đổi nhóm).
function applyPkGroupCfgToInputs() {
  $('#pkgContent').value = pkGroupCfg.content;
  $('#pkgGroup').value = pkGroupCfg.groupId;
  $('#pkgLayoutMode').value = pkGroupCfg.layoutMode;
  $('#pkgPlayMode').value = pkGroupCfg.playMode === 'creator' ? 'fixed' : pkGroupCfg.playMode;
  if ($('#pkgTiktokCombine')) $('#pkgTiktokCombine').checked = !!(pkGroupCfg.tiktokCombine || pkGroupCfg.creatorLive);
  $('#pkgPointsBy').value = pkGroupCfg.pointsBy;
  $('#pkgNoteEnabled').checked = !!pkGroupCfg.noteEnabled;
  $('#pkgNoteText').value = pkGroupCfg.noteText || '';
  $('#pkgNoteBg').value = pkGroupCfg.noteBgColor || '#1f2430';
  $('#pkgNoteColor').value = pkGroupCfg.noteTextColor || '#ffffff';
  $('#pkgNoteSpeed').value = pkGroupCfg.noteSpeedSec || 16;
  $('#pkgNoteEffect').value = pkGroupCfg.noteEffect || 'soft';
  $('#pkgSeparatedGap').value = pkGroupCfg.separatedGap ?? 180;
  $('#pkgSeparatedGapValue').textContent = `${$('#pkgSeparatedGap').value}px`;
  const d = pkGroupCfg.durationSec || 300;
  $('#pkgDurH').value = Math.floor(d / 3600);
  $('#pkgDurM').value = Math.floor((d % 3600) / 60);
  $('#pkgDurS').value = d % 60;
  $('#pkgPrep').value = pkGroupCfg.prepSec;
  $('#pkgDelay').value = pkGroupCfg.delaySec;
  $('#pkgTextSize').value = pkGroupCfg.textSize;
  $('#pkgNameSize').value = pkGroupCfg.nameSize;
  $('#pkgGiftSize').value = pkGroupCfg.giftSize;
  $('#pkgOverlayScale').value = Math.max(80, Math.min(300, pkGroupCfg.overlayScale));
  $('#pkgOverlayScaleValue').textContent = `${$('#pkgOverlayScale').value}%`;
  if ($('#pkgSmartColor')) $('#pkgSmartColor').checked = pkGroupCfg.smartColor !== false;
  if ($('#ovlAutoTextContrast')) $('#ovlAutoTextContrast').checked = !!pkGroupCfg.autoTextContrast;
  if ($('#pkgShowMvpTotals')) $('#pkgShowMvpTotals').checked = !!pkGroupCfg.showMvpTotals;
  if ($('#pkgSelectFx')) $('#pkgSelectFx').value = pkGroupCfg.selectFx || 'random';
  if ($('#pkgSkin')) { $('#pkgSkin').value = pkGroupCfg.skin || 'auto'; updateSkinHint('pkgSkin', 'pkgSkinHint'); }
}

function renderPkGroupGroupSelect() {
  const sel = $('#pkgGroup');
  if (!sel) return;
  const gs = visibleGroups();
  const prev = sel.value || pkGroupCfg?.groupId || '';
  const current = activeGroupId ? activeGroupId : prev;
  sel.innerHTML = '<option value="">— Chọn nhóm —</option>' + gs.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(groupInfoText(g, g.name))}</option>`).join('');
  sel.value = gs.some(g => g.id === current) ? current : '';
}

// Sinh màu hex từ HSL — dùng để phối màu đều, không trùng lặp cho các Creator.
function pkgHslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const val = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * val).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Gán màu KHÁC NHAU cho từng Creator theo thứ tự hiển thị (hue chia đều vòng tròn màu).
// Giữ nguyên màu người dùng đã tự chọn nếu chưa bị trùng; nếu trùng thì đẩy sang hue trống.
function ensureDistinctPkgColors(orderedMembers) {
  const map = new Map();
  const used = new Set();
  const norm = h => String(h || '').toLowerCase();
  const n = Math.max(1, orderedMembers.length);
  orderedMembers.forEach((c, i) => {
    let color = normalizeHexColor(pkGroupCfg?.creatorColors?.[c.id],
      normalizeHexColor(pkGroupCfg?.creatorColors?.[c.tiktokId], ''));
    if (!color || used.has(norm(color))) {
      let tries = 0;
      do {
        const hue = Math.round((i * 360 / n + tries * 43) % 360);
        color = pkgHslToHex(hue, 70, 55);
        tries++;
      } while (used.has(norm(color)) && tries < 30);
    }
    used.add(norm(color));
    map.set(c.id, color);
  });
  return map;
}

// Phối lại màu toàn bộ thành viên: chia đều hue để chắc chắn không trùng (nút "Phối lại màu").
function autoAssignPkgColors() {
  if (!pkGroupCfg) return;
  syncPkGroupMembersFromDom();
  const groupId = $('#pkgGroup')?.value || pkGroupCfg.groupId || '';
  const members = visibleCreators().filter(c => c.groupId === groupId);
  const order = new Map((pkGroupCfg.participants || []).map((p, i) => [p.creatorId || p.id, i]));
  const ordered = members.slice().sort((a, b) => {
    const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi');
  });
  const n = Math.max(1, ordered.length);
  pkGroupCfg.creatorColors = { ...(pkGroupCfg.creatorColors || {}) };
  ordered.forEach((c, i) => {
    const color = pkgHslToHex(Math.round((i * 360 / n) % 360), 70, 55);
    pkGroupCfg.creatorColors[c.id] = color;
    const p = (pkGroupCfg.participants || []).find(x => x.creatorId === c.id || x.id === c.id);
    if (p) p.color = color;
  });
  renderPkGroupMembers();
  schedulePkGroupAutoSave();
}

function pkGroupParticipantForCreator(c) {
  const old = pkGroupCfg.participants.find(p => p.creatorId === c.id || p.id === c.id) || {};
  // Giữ override cũ nếu có; ngược lại luôn bám quà mặc định hiện tại (không đông cứng)
  const override = !!old.giftOverride && isRealGift(old.gifts?.[0]);
  const gift = override ? old.gifts[0] : (creatorDefaultGift(c) || groupDefaultGift(pkGroupCfg?.groupId));
  const palette = ['#FE2C55', '#25F4EE', '#A855F7', '#F59E0B', '#22C55E', '#3B82F6', '#EC4899', '#14B8A6'];
  const color = palette[Math.abs(String(c.id || c.tiktokId || '').split('').reduce((n, ch) => n + ch.charCodeAt(0), 0)) % palette.length];
  const savedColor = pkGroupCfg?.creatorColors?.[c.id] || pkGroupCfg?.creatorColors?.[c.tiktokId];
  return {
    id: old.id || c.id,
    creatorId: c.id,
    tiktokId: c.tiktokId || '',
    name: old.name || c.nickname || c.tiktokId || 'Creator',
    avatar: c.avatar || old.avatar || '../logo/hp-logo.png',
    color: normalizeHexColor(old.color, normalizeHexColor(savedColor, normalizeHexColor(c.color, color))),
    giftOverride: override,
    gifts: gift ? [gift] : [],
    streak: Number(old.streak) || 0,
  };
}

function selectAllPkGroupMembers(groupId) {
  if (!pkGroupCfg || !groupId || (pkGroupCfg.participants || []).length) return;
  pkGroupCfg.participants = visibleCreators()
    .filter(c => c.groupId === groupId)
    .map(pkGroupParticipantForCreator);
}

function renderPkGroupMembers() {
  const wrap = $('#pkgMembers');
  if (!wrap || !pkGroupCfg) return;
  // Đang gõ trong danh sách (tên/streak) thì KHÔNG dựng lại — tránh nền tự làm mới avatar
  // xoá mất thao tác đang nhập (dữ liệu đã đồng bộ realtime qua listener input).
  if (wrap.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
  const groupId = $('#pkgGroup')?.value || pkGroupCfg.groupId || '';
  const members = visibleCreators().filter(c => c.groupId === groupId);
  const selected = new Map((pkGroupCfg.participants || []).map(p => [p.creatorId || p.id, p]));
  if (!groupId) {
    wrap.innerHTML = '<div class="hint">Chọn một nhóm để hiện danh sách Creator.</div>';
    return;
  }
  if (!members.length) {
    wrap.innerHTML = '<div class="hint">Nhóm này chưa có Creator.</div>';
    return;
  }
  const order = new Map((pkGroupCfg.participants || []).map((p, i) => [p.creatorId || p.id, i]));
  const displayMembers = members.slice().sort((a, b) => {
    const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi');
  });
  const smartColor = pkGroupCfg.smartColor !== false;
  const colorMap = smartColor ? ensureDistinctPkgColors(displayMembers) : null;
  if (colorMap) {
    pkGroupCfg.creatorColors = { ...(pkGroupCfg.creatorColors || {}) };
    let changed = false;
    const norm = h => String(h || '').toLowerCase();
    displayMembers.forEach(c => {
      const col = colorMap.get(c.id);
      if (norm(pkGroupCfg.creatorColors[c.id]) !== norm(col)) { pkGroupCfg.creatorColors[c.id] = col; changed = true; }
      const part = (pkGroupCfg.participants || []).find(x => x.creatorId === c.id || x.id === c.id);
      if (part && norm(part.color) !== norm(col)) { part.color = col; changed = true; }
    });
    if (changed) schedulePkGroupAutoSave();
  }
  wrap.innerHTML = displayMembers.map(c => {
    const p = selected.get(c.id) || pkGroupParticipantForCreator(c);
    const checked = selected.has(c.id) ? 'checked' : '';
    // Không override → hiện quà mặc định hiện tại của creator (realtime)
    const override = !!p.giftOverride && isRealGift(p.gifts?.[0]);
    const gift = override ? p.gifts[0] : (creatorDefaultGift(c) || groupDefaultGift(pkGroupCfg?.groupId));
    const rowColor = colorMap ? colorMap.get(c.id) : normalizeHexColor(p.color, '#FE2C55');
    return `<div class="pkg-member" data-id="${escapeAttr(c.id)}">
      <label class="pkg-member-check" title="Bật hoặc tắt Creator tham gia PK Nhóm"><input type="checkbox" ${checked} /> <img src="${escapeAttr(c.avatar || '../logo/hp-logo.png')}" /><b>${escapeHtml(c.nickname || c.tiktokId)}</b></label>
      <div class="pkg-order-tools"><button class="ghost tiny pkg-move-up" type="button">↑</button><button class="ghost tiny pkg-move-down" type="button">↓</button></div>
      <input class="pkg-name" value="${escapeAttr(p.name || '')}" maxlength="20" placeholder="Tên hiển thị" />
      <input class="pkg-color" type="color" value="${escapeAttr(rowColor)}" />
      <input class="pkg-streak-input" type="number" min="0" max="999" value="${Number(p.streak) || 0}" title="MVP chuỗi" />
      <div class="pkg-gift-cell">
        <button class="ghost tiny pkg-pick-gift${override ? ' is-override' : ''}" type="button" title="${override ? 'Đang ghi đè quà — bấm để đổi' : 'Đang theo quà mặc định của Creator (realtime)'}">${gift?.icon ? `<img src="${escapeAttr(gift.icon)}" />` : '🎁'} ${escapeHtml(gift?.giftName || gift?.name || 'Chọn quà')}</button>
        ${override ? '<button class="ghost tiny pkg-reset-gift" type="button" title="Về quà mặc định">🔄</button>' : ''}
      </div>
      <div class="pkg-test-cell" title="Nhập số lượng rồi bấm ＋ để cộng điểm (quà × số lượng), － để trừ khi lỡ cộng sai">
        <input class="pkg-test-qty" type="number" min="1" max="9999" value="1" aria-label="Số lượng quà test" />
        <button class="pkg-test-gift" type="button" title="Cộng điểm (quà × số lượng)">＋</button>
        <button class="pkg-test-minus" type="button" title="Trừ điểm (lỡ cộng sai)">－</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.pkg-member').forEach(row => {
    const creator = creators.find(c => c.id === row.dataset.id);
    row.querySelector('input[type="checkbox"]').addEventListener('change', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); renderPkGroupMembers(); });
    row.querySelector('.pkg-name').addEventListener('input', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); });
    row.querySelector('.pkg-color').addEventListener('change', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); });
    row.querySelector('.pkg-streak-input').addEventListener('input', () => {
      enforcePkGroupMvpInput(row);
      syncPkGroupMembersFromDom();
      window.api.pkgroup.setConfig(collectPkGroupCfg()).catch(() => {});
    });
    row.querySelector('.pkg-pick-gift').addEventListener('click', async () => {
      syncPkGroupMembersFromDom();
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id) || pkGroupParticipantForCreator(creator);
      const picked = await GiftPicker.open({
        title: `🎁 Chọn quà cho ${p.name}`,
        multi: pkGroupCfg.playMode === 'fixed',
        selected: (p.gifts || []).map(g => String(g.giftId || g.id || '')),
      });
      const gifts = Array.isArray(picked) ? picked : (picked ? [picked] : []);
      if (!gifts.length) return;
      p.gifts = gifts.map(g => g.giftName ? g : giftToPkGift(g));
      p.giftOverride = true; // chọn tay = ghi đè, không bám mặc định nữa
      const idx = pkGroupCfg.participants.findIndex(x => x.creatorId === p.creatorId || x.id === p.id);
      if (idx >= 0) pkGroupCfg.participants[idx] = p;
      else pkGroupCfg.participants.push(p);
      renderPkGroupMembers();
      schedulePkGroupAutoSave();
    });
    row.querySelector('.pkg-reset-gift')?.addEventListener('click', () => {
      syncPkGroupMembersFromDom();
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id);
      if (!p) return;
      p.giftOverride = false; // gỡ ghi đè → tự về quà mặc định
      const def = creatorDefaultGift(creator);
      p.gifts = def ? [def] : [];
      renderPkGroupMembers();
      schedulePkGroupAutoSave();
      toast(`🔄 ${p.name || creator.nickname || creator.tiktokId} về quà mặc định`, 'success');
    });
    const pkgTestPoints = async (sign) => {
      await window.api.pkgroup.setConfig(collectPkGroupCfg());
      const p = pkGroupCfg.participants.find(x => x.creatorId === creator.id || x.id === creator.id);
      if (!p) { toast('Cần tích chọn thành viên trước', 'error'); return; }
      const qty = Math.max(1, parseInt(row.querySelector('.pkg-test-qty')?.value, 10) || 1);
      const res = await window.api.pkgroup.testGift(p.id, qty, sign);
      if (!res) { toast('Không test được quà thành viên này', 'error'); return; }
      const sgn = res.points < 0 ? '−' : '+';
      toast(`${p.name}: ${sgn}${formatNumber(Math.abs(res.points))} (×${res.qty})${res.giftName ? ` · ${res.giftName}` : ''}`, 'success');
    };
    row.querySelector('.pkg-test-gift').addEventListener('click', () => pkgTestPoints(1));
    row.querySelector('.pkg-test-minus').addEventListener('click', () => pkgTestPoints(-1));
    row.querySelector('.pkg-move-up').addEventListener('click', () => movePkGroupParticipant(creator.id, -1));
    row.querySelector('.pkg-move-down').addEventListener('click', () => movePkGroupParticipant(creator.id, 1));
  });
}

function movePkGroupParticipant(creatorId, dir) {
  syncPkGroupMembersFromDom();
  const idx = pkGroupCfg.participants.findIndex(p => (p.creatorId || p.id) === creatorId);
  if (idx < 0) { toast('Cần tích chọn thành viên trước', 'error'); return; }
  const next = idx + dir;
  if (next < 0 || next >= pkGroupCfg.participants.length) return;
  const [item] = pkGroupCfg.participants.splice(idx, 1);
  pkGroupCfg.participants.splice(next, 0, item);
  renderPkGroupMembers();
  schedulePkGroupAutoSave();
}

function enforcePkGroupMvpInput(changedRow) {
  const changedInput = changedRow.querySelector('.pkg-streak-input');
  const changedValue = Math.max(0, Number(changedInput?.value) || 0);
  if (changedInput) changedInput.value = changedValue;
  if (changedValue <= 0) return;
  const changedId = changedRow.dataset.id;
  const activeOwner = (pkGroupCfg?.participants || []).find(p => Number(p.streak) > 0);
  if (!activeOwner || (activeOwner.creatorId || activeOwner.id) === changedId) return;
  changedInput.value = 0;
  const activeName = activeOwner.name || activeOwner.tiktokId || 'Creator đang MVP';
  toast(`Cần đưa MVP của ${activeName} về 0 trước khi chuyển MVP`, 'error');
}

function normalizePkGroupMvpInputs() {
  const activeRows = $$('#pkgMembers .pkg-member').filter(row => (Number(row.querySelector('.pkg-streak-input')?.value) || 0) > 0);
  if (activeRows.length <= 1) return true;
  const activeOwner = (pkGroupCfg?.participants || []).find(p => Number(p.streak) > 0);
  const keepId = activeOwner ? (activeOwner.creatorId || activeOwner.id) : activeRows[0].dataset.id;
  activeRows.forEach(row => {
    if (row.dataset.id !== keepId) row.querySelector('.pkg-streak-input').value = 0;
  });
  toast('Chỉ được có 1 Creator MVP > 0. Hãy đưa MVP hiện tại về 0 trước khi chuyển.', 'error');
  return false;
}

function syncPkGroupMembersFromDom() {
  if (!pkGroupCfg) return;
  normalizePkGroupMvpInputs();
  pkGroupCfg.creatorColors = { ...(pkGroupCfg.creatorColors || {}) };
  const prev = new Map((pkGroupCfg.participants || []).map(p => [p.creatorId || p.id, p]));
  const participants = [];
  $$('#pkgMembers .pkg-member').forEach(row => {
    const checked = row.querySelector('input[type="checkbox"]')?.checked;
    if (!checked) return;
    const c = creators.find(x => x.id === row.dataset.id);
    if (!c) return;
    const old = prev.get(c.id) || pkGroupParticipantForCreator(c);
    const color = normalizeHexColor(row.querySelector('.pkg-color')?.value, old.color || '#FE2C55');
    pkGroupCfg.creatorColors[c.id] = color;
    // Không override → luôn đồng bộ lại quà mặc định hiện tại của creator
    const isOverride = !!old.giftOverride && isRealGift(old.gifts?.[0]);
    let gifts = old.gifts || [];
    if (!isOverride) {
      const def = creatorDefaultGift(c) || groupDefaultGift(pkGroupCfg?.groupId);
      gifts = def ? [def] : [];
    }
    const typedName = row.querySelector('.pkg-name')?.value.trim() || '';
    const nick = c.nickname || c.tiktokId || '';
    participants.push({
      ...old,
      id: old.id || c.id,
      creatorId: c.id,
      tiktokId: c.tiktokId || '',
      avatar: c.avatar || old.avatar || '../logo/hp-logo.png',
      name: typedName || nick || 'Creator',
      // Gõ tên khác nickname → ghi đè (không bị nickname tự đè lại); trùng nickname → theo realtime.
      nameOverride: !!typedName && typedName !== nick,
      color,
      giftOverride: isOverride,
      gifts,
      streak: Math.max(0, Number(row.querySelector('.pkg-streak-input')?.value) || 0),
    });
  });
  pkGroupCfg.participants = participants;
}

const _pkGroupSaver = makeAutoSaver(async () => {
  if (!pkGroupCfg) return;
  try {
    await window.api.pkgroup.setConfig(collectPkGroupCfg());
    // Đồng bộ luôn vào hồ sơ của nhóm đang chọn (đã sync DOM trong collectPkGroupCfg)
    if (pkGroupCfg.groupId) snapshotPkGroupToProfile(pkGroupCfg.groupId);
  } catch {}
});
function schedulePkGroupAutoSave() { _pkGroupSaver.schedule(); }

function wirePkGroupTab() {
  $('#pkgGroup').addEventListener('change', () => {
    const prevGroupId = pkGroupCfg.groupId || '';
    const nextGroupId = $('#pkgGroup').value;
    // Lưu thông số hiện tại vào hồ sơ nhóm cũ trước khi chuyển
    if (prevGroupId && prevGroupId !== nextGroupId) {
      syncPkGroupMembersFromDom();
      snapshotPkGroupToProfile(prevGroupId);
    }
    // Nạp lại thông số riêng của nhóm mới (participants, màu, quà, streak... theo từng creator).
    applyPkGroupProfile(nextGroupId);
    pkGroupMvpTotals = new Map();
    pkGroupMvpTotalsGroupId = '';
    pkGroupMvpTotalsRenderKey = '';
    // Lần đầu chọn nhóm (hoặc hồ sơ cũ rỗng), toàn bộ Creator cùng tham gia mặc định.
    // MC chỉ cần bỏ tích những người nghỉ; lựa chọn đó được lưu theo hồ sơ nhóm.
    selectAllPkGroupMembers(nextGroupId);
    renderPkGroupMembers();
    renderPkGroupMvpTotals();
    schedulePkGroupAutoSave();
  });
  $('#pkgSeparatedGap').addEventListener('input', async () => {
    $('#pkgSeparatedGapValue').textContent = `${$('#pkgSeparatedGap').value}px`;
    syncPkGroupMembersFromDom();
    if (pkGroupCfg) {
      pkGroupCfg.separatedGap = Math.max(0, Math.min(800, Number($('#pkgSeparatedGap').value) || 0));
      try { await window.api.pkgroup.setConfig(collectPkGroupCfg()); } catch {}
    }
  });
  $('#pkgOverlayScale').addEventListener('input', async () => {
    $('#pkgOverlayScaleValue').textContent = `${$('#pkgOverlayScale').value}%`;
    syncPkGroupMembersFromDom();
    if (pkGroupCfg) {
      pkGroupCfg.overlayScale = Math.max(80, Math.min(300, Number($('#pkgOverlayScale').value) || 200));
      try { await window.api.pkgroup.setConfig(collectPkGroupCfg()); } catch {}
    }
  });
  ['pkgContent','pkgLayoutMode','pkgPointsBy','pkgNoteEnabled','pkgNoteText','pkgNoteBg','pkgNoteColor','pkgNoteSpeed','pkgNoteEffect','pkgDurH','pkgDurM','pkgDurS','pkgPrep','pkgDelay','pkgTextSize','pkgNameSize','pkgGiftSize','pkgSelectFx','pkgSkin'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', () => { syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); renderPkGroupMembers(); });
  });
  wireSkinHint('pkgSkin', 'pkgSkinHint');
  $('#pkgPlayMode').addEventListener('change', () => {
    syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); renderPkGroupMembers();
  });
  // 📡 Kết hợp TikTok: BẬT → tự bật ghi chú + điền câu hướng dẫn chọn Creator (riêng cho chế độ này)
  // để overlay tự hiển thị đúng nội dung. TẮT mà ghi chú vẫn đang là câu đó → trả field trống.
  $('#pkgTiktokCombine')?.addEventListener('change', () => {
    if ($('#pkgTiktokCombine').checked) {
      $('#pkgNoteEnabled').checked = true;
      $('#pkgNoteText').value = PKG_TIKTOK_NOTE;
      toast('📡 Kết hợp TikTok BẬT: quà tặng đúng Creator tự cộng — đã bật ghi chú "Chọn Creator tại hộp quà tặng…".', 'success');
    } else if ($('#pkgNoteText').value.trim() === PKG_TIKTOK_NOTE) {
      $('#pkgNoteText').value = '';
    }
    syncPkGroupMembersFromDom(); schedulePkGroupAutoSave(); renderPkGroupMembers();
  });
  $('#pkgSmartColor').addEventListener('change', () => {
    pkGroupCfg.smartColor = $('#pkgSmartColor').checked;
    if (pkGroupCfg.smartColor) autoAssignPkgColors();
    else schedulePkGroupAutoSave();
  });
  $('#ovlAutoTextContrast')?.addEventListener('change', () => {
    pkGroupCfg.autoTextContrast = $('#ovlAutoTextContrast').checked;
    schedulePkGroupAutoSave();
  });
  $('#pkgShowMvpTotals')?.addEventListener('change', async () => {
    if (!pkGroupCfg) return;
    pkGroupCfg.showMvpTotals = $('#pkgShowMvpTotals').checked;
    try {
      await window.api.pkgroup.setConfig(collectPkGroupCfg());
      if (pkGroupCfg.groupId) snapshotPkGroupToProfile(pkGroupCfg.groupId);
    } catch {}
  });
  $('#pkgEditMvpTotals')?.addEventListener('click', () => {
    const editor = $('#pkgMvpTotalEditor');
    if (!editor) return;
    editor.open = !editor.open;
    if (editor.open) renderPkGroupMvpTotals();
  });
  $('#pkgAutoColor').addEventListener('click', autoAssignPkgColors);
  // Cấu hình PK Nhóm tự lưu real-time (schedulePkGroupAutoSave) — không cần nút Cập nhật.
  $('#pkgStart').addEventListener('click', async () => {
    if ($('#pkgStart').dataset.running === 'true') { await window.api.pkgroup.stop(); return; }
    if (!requireLive('BẮT ĐẦU PK Nhóm')) return;
    const cfg = collectPkGroupCfg();
    if (!cfg.participants.length) { toast('Cần tích ít nhất 1 Creator', 'error'); return; }
    await window.api.pkgroup.setConfig(cfg);
    await window.api.pkgroup.start();
  });
  $('#pkgReset').addEventListener('click', async () => { await window.api.pkgroup.reset(); });
  $('#pkgResetAll')?.addEventListener('click', async () => {
    if (!confirm('RESET TẤT CẢ PK Nhóm?\nXoá điểm, trạng thái VÀ chuỗi WIN của tất cả Creator (không hoàn tác).')) return;
    await window.api.pkgroup.resetAll();
    toast('🗑️ Đã reset tất cả PK Nhóm (kể cả chuỗi WIN)', 'success');
  });
  $('#pkgCopyUrl').addEventListener('click', async () => {
    const url = await window.api.pkgroup.getUrl();
    await window.api.shell.copyText(url);
    toast('📋 Đã copy link PK Nhóm', 'success');
  });
}

async function updatePkGroupConfig() {
  await window.api.pkgroup.setConfig(collectPkGroupCfg());
  toast('🔄 Đã cập nhật PK Nhóm', 'success');
}

function collectPkGroupCfg() {
  syncPkGroupMembersFromDom();
  const h = Number($('#pkgDurH').value) || 0;
  const m = Number($('#pkgDurM').value) || 0;
  const s = Number($('#pkgDurS').value) || 0;
  const cfg = {
    ...pkGroupCfg,
    content: $('#pkgContent').value.trim() || 'PK NHÓM',
    groupId: $('#pkgGroup').value,
    layoutMode: $('#pkgLayoutMode').value,
    playMode: $('#pkgPlayMode').value,
    tiktokCombine: !!$('#pkgTiktokCombine')?.checked,
    pointsBy: $('#pkgPointsBy').value || 'diamond',
    noteEnabled: $('#pkgNoteEnabled').checked,
    noteText: $('#pkgNoteText').value.trim(),
    noteBgColor: $('#pkgNoteBg').value,
    noteTextColor: $('#pkgNoteColor').value,
    noteSpeedSec: Math.max(6, Number($('#pkgNoteSpeed').value) || 16),
    noteEffect: $('#pkgNoteEffect').value,
    separatedGap: Math.max(0, Math.min(800, Number($('#pkgSeparatedGap').value) || 0)),
    autoTextContrast: !!$('#ovlAutoTextContrast')?.checked,
    showMvpTotals: !!$('#pkgShowMvpTotals')?.checked,
    durationSec: Math.max(5, h * 3600 + m * 60 + s),
    prepSec: Number($('#pkgPrep').value) || 0,
    delaySec: Number($('#pkgDelay').value) || 0,
    textSize: Number($('#pkgTextSize').value),
    nameSize: Math.max(60, Math.min(200, Number($('#pkgNameSize').value) || 100)),
    giftSize: Number($('#pkgGiftSize').value),
    overlayScale: Math.max(80, Math.min(300, Number($('#pkgOverlayScale').value) || 200)),
    selectFx: $('#pkgSelectFx')?.value || 'random',
    skin: $('#pkgSkin')?.value || 'auto',
    creatorColors: pkGroupCfg.creatorColors || {},
  };
  // Đồng bộ NGƯỢC toàn bộ giá trị vừa đọc từ DOM vào pkGroupCfg. Quan trọng: hồ sơ nhóm
  // (pkGroupProfileSnapshot) đọc từ pkGroupCfg — nếu không sync, nó lưu Giao diện/Thời gian CŨ vào
  // profile và ghi đè config khi mở lại (đúng lỗi "không tự lưu thông số Giao diện và thời gian").
  Object.assign(pkGroupCfg, cfg);
  return cfg;
}

function renderPkGroupPreview(st = {}) {
  syncPkGroupMvpTotalsFromState(st);
  const participants = st.participants || pkGroupCfg?.participants || [];
  if (pkGroupCfg && Array.isArray(st.participants) && ['grace', 'finished'].includes(st.status)) {
    const streakById = new Map(st.participants.map(p => [p.id || p.creatorId, Number(p.streak) || 0]));
    pkGroupCfg.participants = (pkGroupCfg.participants || []).map(p => ({ ...p, streak: streakById.get(p.id) ?? streakById.get(p.creatorId) ?? 0 }));
    $$('#pkgMembers .pkg-member').forEach(row => {
      const p = pkGroupCfg.participants.find(x => (x.creatorId || x.id) === row.dataset.id);
      const input = row.querySelector('.pkg-streak-input');
      if (input && p) input.value = Number(p.streak) || 0;
    });
  }
  const sec = Math.ceil((st.remainingMs || 0) / 1000);
  const statusText = st.status === 'prestart' ? `Sắp bắt đầu — ${sec}s`
    : st.status === 'running' ? `Đang đấu — ${sec}s`
    : st.status === 'grace' ? 'ĐANG TÍNH ĐIỂM'
    : st.status === 'finished' ? 'Đã kết thúc'
    : 'Chờ bắt đầu';
  const running = st.status === 'prestart' || st.status === 'running' || st.status === 'grace';
  const startBtn = $('#pkgStart');
  if (startBtn) {
    startBtn.dataset.running = running ? 'true' : 'false';
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('primary', !running);
    startBtn.classList.toggle('warn', running);
  }
  const total = participants.reduce((sum, p) => sum + (Number(p.score) || 0), 0);
  const max = Math.max(1, ...participants.map(p => Number(p.score) || 0));
  $('#pkgPreview').innerHTML = `<div class="pkg-preview-box"><b>${escapeHtml(statusText)}</b>${participants.map(p => {
    const score = Number(p.score) || 0;
    const width = (st.layoutMode || pkGroupCfg?.layoutMode) === 'separated' ? Math.max(4, score / max * 100) : Math.max(4, total ? score / total * 100 : 100 / Math.max(1, participants.length));
    const scoreColor = width >= 50 ? textColorForPreview(p.color || '#FE2C55') : '#111827';
    return `<div class="pkg-preview-row"><span style="color:${escapeAttr(p.color || '#FE2C55')}">${escapeHtml(p.name || 'Creator')}</span><div><i style="width:${width}%;background:${escapeAttr(p.color || '#FE2C55')}"></i><b style="color:${escapeAttr(scoreColor)}">${formatNumber(score)}</b></div></div>`;
  }).join('')}</div>`;
  renderPkGroupMvpTotals();
}

function textColorForPreview(bg) {
  const m = String(bg || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.62 ? '#111827' : '#ffffff';
}

// ============================================================
// Ranking
// ============================================================
async function loadRankingConfig() {
  const st = await window.api.ranking.getState();
  $('#rkTitle').value = st.title || 'TOP IDOL';
  $('#rkMode').value = st.mode || 'creator';
  $('#rkMaxRows').value = st.maxRows ?? 10;
  $('#rkRankFrom').value = st.rankFrom ?? 1;
  $('#rkRankTo').value = st.rankTo ?? 0;
  $('#rkNameMode').value = st.nameMode || 'two-line';
  $('#rkNameMaxChars').value = st.nameMaxChars || 6;
  $('#rkPointsBy').value = st.pointsBy || 'diamond';
  $('#rkStreak').value = st.streakColor || '#67e8f9';
  $('#rkTitleColor').value = st.overlayTitleColor || '#ffffff';
  $('#rkBg').value = st.overlayBgColor || '#2a2d37';
  $('#rkBoardColor').value = st.overlayBoardColor || '#000000';
  $('#rkBgOpacity').value = st.overlayBgOpacity ?? 70;
  $('#rkBoardOpacity').value = st.overlayBoardOpacity ?? 75;
  $('#rkActiveBg').value = st.activeBgColor || '#ffca3a';
  $('#rkActiveBgOpacity').value = st.activeBgOpacity ?? 55;
  const legacyActiveFx = { spotlight: 'shine', sparkle: 'royal', pulse: 'neon' };
  const activeFx = legacyActiveFx[st.activeBgFx] || st.activeBgFx;
  $('#rkActiveFx').value = ['off', 'shine', 'neon', 'gold', 'rainbow', 'royal', 'plasma', 'flash', 'live'].includes(activeFx) ? activeFx : 'off';
  if ($('#rkSkin')) { $('#rkSkin').value = st.skin || 'auto'; updateSkinHint('rkSkin', 'rkSkinHint'); }
  $('#rkActiveSync').checked = !!st.activeBarSync;
  $('#rkShowRank').checked = st.showRank !== false;
  $('#rkShowAvatar').checked = st.showAvatar !== false;
  $('#rkShowGift').checked = st.showGift !== false;
  $('#rkShowRound').checked = st.showRound !== false;
  if ($('#rkShowGroupName')) $('#rkShowGroupName').checked = st.showGroupName !== false;
  if ($('#rkShowTopColors')) $('#rkShowTopColors').checked = st.showTopColors !== false;
  $('#rkShowActive').checked = st.showActive !== false;
  $('#rkHideAllScores').checked = !!st.hideAllScores;
  $('#rkGridRows').value = st.gridRows || 3;
  $('#rkGridCols').value = st.gridCols || 3;
  $('#rkGridFlow').value = st.gridFlow || 'row';
  $('#rkAvatarScale').value = Math.max(80, Math.min(170, Number(st.avatarScale) || 130));
  $('#rkAvatarScaleValue').textContent = `${$('#rkAvatarScale').value}%`;
  $('#rkGiftScale').value = Math.max(80, Math.min(180, Number(st.giftScale) || 145));
  $('#rkGiftScaleValue').textContent = `${$('#rkGiftScale').value}%`;
  $('#rkOverlayScale').value = st.overlayScale || 200;
  $('#rkOverlayScaleValue').textContent = `${$('#rkOverlayScale').value}%`;
  if ($('#rkScoreFloor')) $('#rkScoreFloor').value = formatNumber(Math.max(0, Number(st.scoreFloor) || 0));
  renderRkPreview(st);
}

// ===== Liên kết trò chơi → THI ĐẤU NHÓM (đồng bộ mọi ô tích: tiêu đề từng tab + bảng tổng) =====
// 4 trò: pkduo/pkgroup/sticker dùng settings.rankingLinks; score dùng scoreLinkRanking (cơ chế riêng).
let rankingLinks = { pkduo: false, pkgroup: false, sticker: false, kcduo: false };
const GAME_LINK_LABEL = { pkduo: 'PK Đôi', kcduo: 'Giữ/Đổi', pkgroup: 'PK Nhóm', score: 'Tính điểm', sticker: 'Đập Trứng/Dance' };
// Mỗi trò có nhiều ô tích (tiêu đề + bảng tổng, riêng score còn ô trong thẻ) → luôn set cùng lúc.
const GAME_LINK_BOXES = {
  pkduo: ['#pkLinkRanking', '#rkLinkPkduo'],
  kcduo: ['#kcLinkRanking', '#rkLinkKcduo'],
  pkgroup: ['#pkgLinkRanking', '#rkLinkPkgroup'],
  score: ['#scLinkTop', '#rkLinkScore'],
  sticker: ['#sdLinkRanking', '#rkLinkSticker'],
};
function gameLinkChecked(key) { return key === 'score' ? !!scoreLinkRanking : !!rankingLinks[key]; }
function applyGameLinksToUI() {
  for (const key of Object.keys(GAME_LINK_BOXES)) {
    const on = gameLinkChecked(key);
    for (const sel of GAME_LINK_BOXES[key]) { const el = $(sel); if (el) el.checked = on; }
  }
}
// Bật/tắt Liên kết cho 🎯 Tính điểm (cơ chế scoreLinkRanking + tự cộng khi kết thúc lượt).
async function setScoreLink(checked) {
  scoreLinkRanking = !!checked;
  applyGameLinksToUI();
  await window.api.settings.set({ scoreLinkRanking });
  renderScoreBridge();
}
async function setGameLink(key, checked) {
  applyGameLinksToUI(); // phản hồi tức thì mọi ô song sinh
  if (key === 'score') { await setScoreLink(checked); }
  else {
    rankingLinks[key] = !!checked;
    const next = await window.api.ranking.setLinks({ [key]: !!checked });
    if (next) rankingLinks = next;
    applyGameLinksToUI();
  }
  toast(`${checked ? 'Đã BẬT' : 'Đã TẮT'} liên kết ${GAME_LINK_LABEL[key]} ↔ THI ĐẤU NHÓM`, 'success');
}
async function initRankingLinks() {
  try { const l = await window.api.ranking.getLinks(); if (l) rankingLinks = l; } catch {}
  applyGameLinksToUI();
  for (const key of Object.keys(GAME_LINK_BOXES)) {
    for (const sel of GAME_LINK_BOXES[key]) {
      const el = $(sel);
      if (el) el.addEventListener('change', () => setGameLink(key, el.checked));
    }
  }
  window.api.on('ranking:links', (l) => { if (l) { rankingLinks = l; applyGameLinksToUI(); } });
  const vbtn = $('#rkValidateLinks');
  if (vbtn) vbtn.addEventListener('click', validateRankingLinks);
}

// 🔍 Soi các nguồn Liên kết ĐANG BẬT xem creatorId đã gắn có hợp lệ không → cảnh báo trước LIVE.
async function validateRankingLinks() {
  const box = $('#rkLinksReport');
  let res;
  try { res = await window.api.ranking.validateLinks(); } catch { res = null; }
  if (!box) { if (res) toast(res.problems?.length ? `⚠️ ${res.problems.length} liên kết có vấn đề` : '✅ Liên kết OK', res.problems?.length ? 'error' : 'success'); return; }
  box.hidden = false;
  if (!res) { box.className = 'rk-links-report is-bad'; box.textContent = '❌ Không kiểm tra được (thử lại).'; return; }
  if (!res.anyOn) { box.className = 'rk-links-report'; box.textContent = 'ℹ️ Chưa bật liên kết trò chơi nào.'; return; }
  const probs = res.problems || [];
  if (!probs.length) {
    box.className = 'rk-links-report is-ok';
    box.textContent = '✅ Mọi nguồn đang bật đều gắn Creator hợp lệ — điểm sẽ vào BXH đúng.';
    return;
  }
  box.className = 'rk-links-report is-bad';
  box.innerHTML = `<div class="rk-links-report-head">⚠️ ${probs.length} chỗ có thể KHÔNG cộng đúng vào BXH:</div>` +
    probs.map(p => `<div class="rk-links-report-row"><b>${escapeHtml(p.game)}</b> · ${escapeHtml(p.who)} — ${escapeHtml(p.issue)}</div>`).join('');
}

function wireRankingTab() {
  let rkTimer = null;
  const collectRkCfg = () => ({
    title: $('#rkTitle').value.trim() || 'TOP IDOL',
    mode: $('#rkMode').value,
    maxRows: Number($('#rkMaxRows').value),
    rankFrom: Number($('#rkRankFrom').value) || 1,
    rankTo: Number($('#rkRankTo').value) || 0,
    nameMode: $('#rkNameMode').value,
    nameMaxChars: Math.max(3, Math.min(40, parseInt($('#rkNameMaxChars').value, 10) || 6)),
    pointsBy: $('#rkPointsBy').value || 'diamond', // đã bỏ option "Số lượng quà"; config cũ 'count' → select rỗng → fallback Coin
    streakColor: $('#rkStreak').value,
    overlayTitleColor: $('#rkTitleColor').value,
    overlayBgColor: $('#rkBg').value,
    overlayBoardColor: $('#rkBoardColor').value,
    overlayBgOpacity: Number($('#rkBgOpacity').value),
    overlayBoardOpacity: Number($('#rkBoardOpacity').value),
    activeBgColor: $('#rkActiveBg').value,
    activeBgOpacity: Number($('#rkActiveBgOpacity').value),
    activeBgFx: $('#rkActiveFx').value || 'gold',
    skin: $('#rkSkin') ? $('#rkSkin').value : 'auto',
    activeBarSync: $('#rkActiveSync').checked,
    showRank: $('#rkShowRank').checked,
    showAvatar: $('#rkShowAvatar').checked,
    showGift: $('#rkShowGift').checked,
    showRound: $('#rkShowRound').checked,
    showGroupName: $('#rkShowGroupName') ? $('#rkShowGroupName').checked : true,
    showTopColors: $('#rkShowTopColors') ? $('#rkShowTopColors').checked : true,
    showActive: $('#rkShowActive').checked,
    hideAllScores: $('#rkHideAllScores').checked,
    gridRows: Number($('#rkGridRows').value) || 3,
    gridCols: Number($('#rkGridCols').value) || 3,
    gridFlow: $('#rkGridFlow').value,
    avatarScale: Math.max(80, Math.min(170, Number($('#rkAvatarScale').value) || 130)),
    giftScale: Math.max(80, Math.min(180, Number($('#rkGiftScale').value) || 145)),
    overlayScale: Math.max(80, Math.min(300, Number($('#rkOverlayScale').value) || 200)),
    scoreFloor: Math.max(0, parseNumberInput($('#rkScoreFloor')?.value) || 0),
    activeGroupId,
  });
  $('#rkOverlayScale').addEventListener('input', () => { $('#rkOverlayScaleValue').textContent = `${$('#rkOverlayScale').value}%`; updateRkRealtime(); });
  $('#rkAvatarScale').addEventListener('input', () => { $('#rkAvatarScaleValue').textContent = `${$('#rkAvatarScale').value}%`; updateRkRealtime(); });
  $('#rkGiftScale').addEventListener('input', () => { $('#rkGiftScaleValue').textContent = `${$('#rkGiftScale').value}%`; updateRkRealtime(); });
  const updateRkRealtime = () => {
    clearTimeout(rkTimer);
    rkTimer = setTimeout(async () => {
      await window.api.ranking.setConfig(collectRkCfg());
    }, 180);
  };
  ['rkTitle','rkMode','rkMaxRows','rkRankFrom','rkRankTo','rkNameMode','rkNameMaxChars','rkPointsBy','rkStreak','rkTitleColor','rkBg','rkBoardColor','rkBgOpacity','rkBoardOpacity','rkActiveBg','rkActiveBgOpacity','rkActiveFx','rkActiveSync','rkShowRank','rkShowAvatar','rkShowGift','rkShowRound','rkShowGroupName','rkShowTopColors','rkShowActive','rkHideAllScores','rkGridRows','rkGridCols','rkGridFlow','rkAvatarScale','rkGiftScale','rkSkin'].forEach(id => {
    const el = $('#' + id);
    el.addEventListener('input', updateRkRealtime);
    el.addEventListener('change', updateRkRealtime);
  });
  wireSkinHint('rkSkin', 'rkSkinHint');
  $('#rkSaveCfg').addEventListener('click', async () => {
    await window.api.ranking.setConfig(collectRkCfg());
    toast('Đã cập nhật Thi đấu nhóm', 'success');
  });
  $('#rkStartRound').addEventListener('click', async () => {
    // Chụp bảng của vòng ĐANG kết thúc trước khi NEW ROUND reset điểm về 0.
    await recordRankingSnapshot(`Vòng (trước NEW ROUND)`);
    const round = await window.api.ranking.startRound();
    await refreshCreators();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast(`🔄 NEW ROUND: R${round}`, 'success');
  });
  $('#rkResetRound').addEventListener('click', async () => {
    await window.api.ranking.resetRound();
    await refreshCreators();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast('RESET ROUND: R0', 'success');
  });
  $('#rkReset').addEventListener('click', async () => {
    if (confirm('Reset toàn bộ điểm Thi đấu nhóm?')) {
      await window.api.ranking.reset();
      await refreshCreators();
      const st = await window.api.ranking.getState();
      renderRkPreview(st);
      toast('↺ RESET ĐIỂM', 'success');
    }
  });
  // 🔄 XOÁ STT: xoá toàn bộ Số thứ tự thi đấu (gán từ 🎡 VÒNG QUAY) để bắt đầu lượt thi mới.
  $('#rkClearPerfOrder')?.addEventListener('click', async () => {
    if (await lwClearPerfOrders()) {
      const st = await window.api.ranking.getState();
      renderRkPreview(st);
    }
  });
  // 🧹 XÓA LỊCH SỬ: dọn gameplayHistory của MỌI Creator một lượt (hỏi Có/Không tránh bấm nhầm).
  $('#rkClearAllHistory')?.addEventListener('click', async () => {
    const targets = creators.filter(c => Array.isArray(c.gameplayHistory) && c.gameplayHistory.length);
    if (!targets.length) { toast('Không có lịch sử nào để xóa', 'info'); return; }
    if (!await askConfirm(`Xóa toàn bộ lịch sử gameplay của ${targets.length} Creator trong THI ĐẤU NHÓM?`, 'Xóa toàn bộ lịch sử')) return;
    for (const c of targets) {
      await window.api.creators.upsert({ ...c, gameplayHistory: [] });
    }
    await refreshCreators();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast(`Đã xóa lịch sử của ${targets.length} Creator`, 'success');
  });
  // 🔒 CHỐT VÒNG: gộp điểm live của vòng vào điểm chính thức (contestPoints) rồi dọn live về 0.
  $('#rkCommitRound')?.addEventListener('click', async () => {
    const res = await window.api.ranking.commitRound();
    if (res?.ok) {
      const n = (res.batch?.entries || []).length;
      lastCommitBatchId = res.batch?.id || null;
      toast(`🔒 Đã chốt vòng: gộp điểm live cho ${n} creator`, 'success');
      await refreshCreators();
      await recordRankingSnapshot('🔒 Chốt vòng');
    } else if (res?.reason === 'empty') {
      toast('Vòng này chưa có điểm live để chốt', 'error');
    } else if (res?.reason === 'not-creator-mode') {
      toast('Chốt vòng chỉ dùng ở chế độ xếp hạng Creator', 'error');
    } else {
      toast('Chốt vòng thất bại', 'error');
    }
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
  });
  $('#rkCopyUrl').addEventListener('click', async () => {
    const url = await window.api.ranking.getUrl(); await window.api.shell.copyText(url);
    toast('📋 THI ĐẤU DỌC', 'success');
  });
  $('#rkCopyGridUrl').addEventListener('click', async () => {
    const url = await window.api.ranking.getGridUrl(); await window.api.shell.copyText(url);
    toast('📋 THI ĐẤU NGANG', 'success');
  });
  $('#rkScoreToggle').addEventListener('click', async () => {
    const c = getVotedCreator();
    if (!c) { toast('Chưa chọn Creator VOTE', 'error'); return; }
    const running = ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
    if (running) {
      scoreStoppedManually = true;
      await window.api.score.stop();
      toast('■ Đã dừng Tính điểm', 'success');
    } else {
      if (!requireLive('BẮT ĐẦU Tính điểm')) return;
      await syncScoreDurationFromBridge();
      await syncScoreToCreator(c);
      scoreAutoRoundHandled = false;
      scoreStoppedManually = false;
      await window.api.score.start();
      toast(`▶ Tính điểm: ${c.nickname || c.tiktokId}`, 'success');
    }
  });
  $('#rkScoreReset').addEventListener('click', async () => {
    await window.api.score.reset();
    toast('↺ Đã reset Tính điểm', 'success');
  });
  ['rkScoreMin', 'rkScoreSec'].forEach(id => $('#' + id).addEventListener('input', syncScoreDurationFromBridge));
  $('#rkScoreTarget').addEventListener('input', syncScoreTargetFromBridge);
  $('#rkScoreTarget').addEventListener('blur', () => {
    $('#rkScoreTarget').value = formatNumber(parseNumberInput($('#rkScoreTarget').value) || 1000);
  });
  // Điểm sàn: lưu vào cấu hình THI ĐẤU NHÓM + tính lại Mục tiêu cho Creator đang VOTE.
  $('#rkScoreFloor')?.addEventListener('input', updateRkRealtime);
  $('#rkScoreFloor')?.addEventListener('blur', async () => {
    $('#rkScoreFloor').value = formatNumber(parseNumberInput($('#rkScoreFloor').value) || 0);
    await window.api.ranking.setConfig(collectRkCfg());
    const voted = getVotedCreator();
    if (voted && scoreLinkRanking) await applyAutoTargetForVote({ ...voted, voteActive: true });
  });
  $('#rkLockVoteRunning').addEventListener('change', async () => {
    scoreLinkVoteLock = $('#rkLockVoteRunning').checked;
    await window.api.settings.set({ scoreLinkVoteLock });
    renderScoreBridge();
    const st = await window.api.ranking.getState();
    renderRkPreview(st);
    toast(scoreLinkVoteLock ? 'Đã bật Khóa VOTE' : 'Đã tắt Khóa VOTE', 'success');
  });
}

function getVotedCreator() {
  return creators.find(c => !!c.voteActive) || null;
}

async function syncScoreToCreator(c) {
  const cfg = collectScoreCfg();
  cfg.creatorName = c.nickname || c.tiktokId || '';
  cfg.creatorAvatar = c.avatar || '';
  $('#scCreatorName').value = cfg.creatorName;
  $('#scCreatorAvatar').value = cfg.creatorAvatar;
  if ($('#scCreatorSelect')) $('#scCreatorSelect').value = c.id || '';
  await window.api.score.setConfig(cfg);
}

function getRequiredTargetForCreator(creatorId) {
  const rows = Array.from(document.querySelectorAll('#rkPreview .rk-row'));
  const idx = rows.findIndex(row => row.querySelector('[data-rk-points]')?.dataset.rkPoints === String(creatorId));
  if (idx <= 0) return Math.max(1, parseNumberInput($('#scTarget').value) || 1000);
  const current = parseNumberInput(rows[idx].querySelector('[data-rk-points]')?.value || '0');
  const above = parseNumberInput(rows[idx - 1].querySelector('[data-rk-points]')?.value || '0');
  // Điểm sàn (mặc định 0): yêu cầu = (điểm TOP trên − điểm người đang VOTE) + Điểm sàn.
  // Để 0/để trống → tính bình thường (chỉ cần hơn TOP trên 1 điểm).
  const floor = Math.max(0, parseNumberInput($('#rkScoreFloor')?.value) || 0);
  return Math.max(1, above - current + (floor > 0 ? floor : 1));
}

async function applyAutoTargetForVote(c) {
  if (!scoreLinkRanking || !c) return;
  const target = getRequiredTargetForCreator(c.id || c.tiktokId);
  scoreTargetSyncing = true;
  $('#rkScoreTarget').value = formatNumber(target);
  $('#scTarget').value = formatNumber(target);
  scoreTargetSyncing = false;
  await window.api.score.setConfig(collectScoreCfg());
}

async function syncScoreTargetFromBridge() {
  if (scoreTargetSyncing) return;
  const target = Math.max(1, parseNumberInput($('#rkScoreTarget').value) || 1000);
  scoreTargetSyncing = true;
  $('#scTarget').value = formatNumber(target);
  scoreTargetSyncing = false;
  await window.api.score.setConfig(collectScoreCfg());
}

async function syncScoreTargetFromScoreTab() {
  if (scoreTargetSyncing) return;
  const target = Math.max(1, parseNumberInput($('#scTarget').value) || 1000);
  scoreTargetSyncing = true;
  $('#rkScoreTarget').value = formatNumber(target);
  scoreTargetSyncing = false;
  scheduleScoreAutoSave();
}

async function syncScoreDurationFromBridge() {
  if (scoreDurationSyncing) return;
  const m = Math.max(0, Number($('#rkScoreMin').value) || 0);
  const s = Math.max(0, Math.min(59, Number($('#rkScoreSec').value) || 0));
  scoreDurationSyncing = true;
  $('#scDurH').value = 0;
  $('#scDurM').value = m;
  $('#scDurS').value = s;
  scoreDurationSyncing = false;
  await window.api.score.setConfig(collectScoreCfg());
}

async function syncScoreDurationFromScoreTab() {
  if (scoreDurationSyncing) return;
  const h = Number($('#scDurH').value) || 0;
  const m = Number($('#scDurM').value) || 0;
  const s = Number($('#scDurS').value) || 0;
  const total = h * 3600 + m * 60 + s;
  scoreDurationSyncing = true;
  $('#rkScoreMin').value = Math.floor(total / 60);
  $('#rkScoreSec').value = total % 60;
  scoreDurationSyncing = false;
  scheduleScoreAutoSave();
}

function renderScoreBridge() {
  const box = $('#rkScoreBridge');
  if (!box) return;
  const c = getVotedCreator();
  box.hidden = !scoreLinkRanking;
  $('#rkScoreBridgeName').textContent = c ? `Đang VOTE: ${c.nickname || c.tiktokId}` : '';
  const running = ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
  const toggle = $('#rkScoreToggle');
  toggle.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
  toggle.classList.toggle('warn', running);
  toggle.classList.toggle('primary', !running);
  ['rkScoreToggle', 'rkScoreReset', 'rkScoreTarget', 'rkScoreMin', 'rkScoreSec'].forEach(id => { const b = $('#' + id); if (b) b.disabled = !c; });
  const lock = $('#rkLockVoteRunning');
  if (lock) lock.checked = scoreLinkVoteLock;
  applyVoteLockState();
  // Nút cộng tay dự phòng: nhận cả Creator đang tính điểm (khi chưa VOTE) để không kẹt điểm sau khi DỪNG tay.
  renderScoreApply(c || creators.find(x => String(x.id) === String(latestScoreState?.creatorId || '')));
}

// TỰ ĐỘNG cộng điểm Tính điểm vào BXH khi lượt kết thúc (đã bật Liên kết). Idempotent theo lượt chạy.
async function autoApplyScoreToRanking(st) {
  // Ưu tiên Creator đang VOTE; nếu chưa VOTE (vd bắt đầu từ tab TÍNH ĐIỂM) → dùng Creator đang tính điểm.
  // Nhờ vậy "hết giờ tự cộng" chạy dù bắt đầu từ đâu, KHÔNG phụ thuộc PK Nhóm hay trò chơi khác.
  const c = getVotedCreator() || creators.find(x => String(x.id) === String(st?.creatorId || ''));
  const score = Math.max(0, Number(st?.score) || 0);
  const runKey = String(st?.runStartedAt || st?.resultAt || '');
  if (scoreApplyBatchId && scoreApplyRunKey === runKey) return; // đã cộng cho lượt này rồi
  if (score <= 0) return; // không có điểm để cộng
  if (!c) { toast('⚠ Chưa chọn Creator (VOTE hoặc ở tab Tính điểm) → không thể tự cộng điểm vào BXH', 'error'); return; }
  const res = await window.api.ranking.applyScore(c.id, score, `🎯 Tính điểm (${st.status === 'success' ? 'đạt' : 'chưa đạt'})`);
  if (res?.ok) {
    scoreApplyBatchId = res.batch.id;
    scoreApplyRunKey = runKey;
    toast(`Tự cộng ${formatNumber(score)} điểm vào BXH cho ${c.nickname || c.tiktokId}`, 'success');
    await refreshCreators();
    renderScoreBridge();
  }
}

// Ô kết quả cộng điểm: TỰ ĐỘNG đã lo phần cộng; ô này hiện trạng thái "đã cộng + hoàn tác",
// hoặc nút cộng TAY dự phòng khi bạn tự bấm DỪNG (lúc đó không tự cộng).
function renderScoreApply(votedCreator) {
  const box = $('#rkScoreApply');
  if (!box) return;
  const st = latestScoreState;
  const ended = st && ['success', 'failed'].includes(st.status);
  const score = Math.max(0, Number(st?.score) || 0);
  const runKey = String(st?.runStartedAt || st?.resultAt || '');
  if (!ended || score <= 0) { box.innerHTML = ''; return; }
  const appliedThisRun = scoreApplyBatchId && scoreApplyRunKey === runKey;
  if (appliedThisRun) {
    box.innerHTML = `<span class="rk-score-applied">✅ Đã cộng ${formatNumber(score)} vào BXH</span>
      <button class="ghost tiny" data-score-undo type="button">↩ Hoàn tác</button>`;
    box.querySelector('[data-score-undo]').onclick = async () => {
      const res = await window.api.ranking.undoApply(scoreApplyBatchId);
      if (res?.ok) { scoreApplyBatchId = null; scoreApplyRunKey = ''; toast('Đã hoàn tác điểm Tính điểm khỏi BXH', 'success'); await refreshCreators(); }
      else toast('Không hoàn tác được', 'error');
      renderScoreBridge();
    };
  } else if (votedCreator) {
    box.innerHTML = `<button class="primary tiny" data-score-apply type="button" title="Cộng tay ${formatNumber(score)} vào BXH cho ${escapeHtml(votedCreator.nickname || votedCreator.tiktokId)}">➕ Cộng tay ${formatNumber(score)} vào BXH</button>`;
    box.querySelector('[data-score-apply]').onclick = async () => {
      const res = await window.api.ranking.applyScore(votedCreator.id, score, `🎯 Tính điểm (${st.status === 'success' ? 'đạt' : 'chưa đạt'})`);
      if (res?.ok) { scoreApplyBatchId = res.batch.id; scoreApplyRunKey = runKey; toast(`Đã cộng ${formatNumber(score)} điểm vào BXH`, 'success'); await refreshCreators(); }
      else toast('Cộng điểm thất bại', 'error');
      renderScoreBridge();
    };
  } else {
    box.innerHTML = '';
  }
}

function isLinkedScoreRunning() {
  return scoreLinkRanking && scoreLinkVoteLock && ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
}

// ===================== LỊCH SỬ 🎯 Tính điểm + 🏆 THI ĐẤU NHÓM =====================
function fmtHistTime(ms) {
  const d = new Date(Number(ms) || 0);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Idol đang gắn với phiên Tính điểm: ưu tiên VOTE, rồi dropdown CREATOR, cuối cùng theo tên trong config.
function currentScoreCreatorInfo() {
  const voted = getVotedCreator();
  const selId = $('#scCreatorSelect')?.value;
  let c = voted || (selId ? creators.find(x => x.id === selId) : null);
  if (!c) {
    const nm = ($('#scCreatorName')?.value || latestScoreState?.creatorName || '').trim();
    if (nm) c = creators.find(x => (x.nickname || x.tiktokId) === nm);
  }
  return {
    name: c?.nickname || c?.tiktokId || latestScoreState?.creatorName || $('#scCreatorName')?.value || 'Không tên',
    tiktokId: c?.tiktokId || '',
  };
}
// Chụp bảng THI ĐẤU NHÓM hiện tại thành 1 mốc (kèm Điểm sàn để tính KIM CƯƠNG TƯƠI về sau).
async function recordRankingSnapshot(label) {
  try {
    const floor = Math.max(0, parseNumberInput($('#rkScoreFloor')?.value) || 0);
    const groupsById = new Map(groups.map(g => [g.id, g]));
    const rows = visibleCreators().map(c => ({
      name: c.nickname || c.tiktokId || '',
      tiktokId: c.tiktokId || '',
      groupName: groupsById.get(c.groupId)?.name || '',
      points: Number(c.contestPoints) || 0,
      round: Number(c.voteRound) || 0,
    })).sort((a, b) => b.points - a.points);
    if (!rows.length) return null;
    const res = await window.api.rankingHistory.add({ label: label || 'Chụp bảng', floor, mode: 'creator', rows });
    if ($('#rankHistModal')?.classList.contains('is-open')) renderRankHist();
    return res;
  } catch { return null; }
}
function kcTuoi(points, floor, heSo) {
  const pts = Number(points) || 0, f = Number(floor) || 0, k = Math.max(1, Number(heSo) || 2);
  const du = pts - f;
  return du >= 0 ? f + du * k : pts;
}

async function openScoreHist() { $('#scoreHistModal').classList.add('is-open'); await renderScoreHist(); }
function closeScoreHist() { $('#scoreHistModal').classList.remove('is-open'); }
async function renderScoreHist() {
  const body = $('#scoreHistBody');
  if (!body) return;
  const list = await window.api.scoreHistory.list();
  $('#scoreHistCount').textContent = `${list.length} lượt`;
  if (!list.length) { body.innerHTML = '<div class="hint">Chưa có lịch sử. Chạy 🎯 Tính điểm đến khi kết thúc, hoặc bấm 📸 Chụp để lưu.</div>'; return; }
  body.innerHTML = list.map(e => `
    <div class="shist-row">
      <div class="shist-main"><b>${escapeHtml(e.name || '?')}</b> <span class="shist-tid">${escapeHtml(e.tiktokId || '—')}</span></div>
      <div class="shist-pts">${formatNumber(e.points || 0)}${e.target ? ` / ${formatNumber(e.target)}` : ''} ${e.status === 'success' ? '🏆' : e.status === 'failed' ? '❌' : ''}</div>
      <div class="shist-time">${fmtHistTime(e.at)}</div>
      <button class="ghost tiny" data-sh-del="${e.id}" type="button" title="Xóa lượt này">🗑</button>
    </div>`).join('');
  body.querySelectorAll('[data-sh-del]').forEach(b => b.addEventListener('click', async () => {
    await window.api.scoreHistory.remove(b.dataset.shDel); renderScoreHist();
  }));
}

async function openRankHist() { $('#rankHistModal').classList.add('is-open'); await renderRankHist(); }
function closeRankHist() { $('#rankHistModal').classList.remove('is-open'); }
async function renderRankHist() {
  const body = $('#rankHistBody');
  if (!body) return;
  const list = await window.api.rankingHistory.list();
  $('#rankHistCount').textContent = `${list.length} mốc`;
  if (!list.length) { body.innerHTML = '<div class="hint">Chưa có mốc nào. Bấm 📸 CHỤP BẢNG, hoặc CHỐT VÒNG / NEW ROUND sẽ tự lưu.</div>'; return; }
  body.innerHTML = list.map(snap => {
    const floor = Number(snap.floor) || 0;
    const rows = (snap.rows || []).slice().sort((a, b) => (b.points || 0) - (a.points || 0)).map((r, i) => {
      const du = Math.max(0, (Number(r.points) || 0) - floor);
      const kc = Math.round(kcTuoi(r.points, floor, rankHistHeSo));
      return `<tr><td>${i + 1}</td><td>${escapeHtml(r.name || '')}</td><td>${escapeHtml(r.groupName || '')}</td><td class="num">${formatNumber(Number(r.points) || 0)}</td><td class="num">${formatNumber(du)}</td><td class="num kc">${formatNumber(kc)}</td></tr>`;
    }).join('');
    return `<details class="rhist-snap">
      <summary><b>${escapeHtml(snap.label || 'Mốc')}</b> · ${fmtHistTime(snap.at)} · sàn ${formatNumber(floor)} · ${(snap.rows || []).length} người
        <button class="ghost tiny" data-rh-del="${snap.id}" type="button" title="Xóa mốc này">🗑</button></summary>
      <table class="rhist-table"><thead><tr><th>#</th><th>Tên idol</th><th>Nhóm</th><th>Điểm</th><th>Điểm dư</th><th>KC Tươi ×${rankHistHeSo}</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
  }).join('');
  body.querySelectorAll('[data-rh-del]').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    await window.api.rankingHistory.remove(b.dataset.rhDel); renderRankHist();
  }));
}
function wireHistoryModals() {
  $('#scHistoryBtn')?.addEventListener('click', () => openScoreHist());
  $('#scSnapshot')?.addEventListener('click', async () => {
    const info = currentScoreCreatorInfo();
    const score = Math.max(0, Number(latestScoreState?.score) || 0);
    await window.api.scoreHistory.add({ name: info.name, tiktokId: info.tiktokId, points: score, target: Math.max(0, Number(latestScoreState?.target) || 0), status: 'snapshot' });
    toast(`📸 Đã lưu ${formatNumber(score)} điểm cho ${info.name}`, 'success');
    if ($('#scoreHistModal')?.classList.contains('is-open')) renderScoreHist();
  });
  $('#scoreHistClose')?.addEventListener('click', closeScoreHist);
  $('#scoreHistModal')?.addEventListener('click', (e) => { if (e.target === $('#scoreHistModal')) closeScoreHist(); });
  $('#scoreHistExport')?.addEventListener('click', async () => {
    const res = await window.api.scoreHistory.export();
    if (res?.ok) toast(`Đã xuất ${res.count} lượt ra CSV`, 'success');
    else if (res?.reason === 'empty') toast('Chưa có lịch sử để xuất', 'error');
    else if (res?.reason !== 'canceled') toast('Xuất CSV thất bại', 'error');
  });
  $('#scoreHistClear')?.addEventListener('click', async () => {
    if (!await askConfirm('Xóa toàn bộ lịch sử Tính điểm?', 'Xóa lịch sử')) return;
    await window.api.scoreHistory.clear(); renderScoreHist();
  });

  $('#rkHistoryBtn')?.addEventListener('click', () => openRankHist());
  $('#rkSnapshot')?.addEventListener('click', async () => {
    const res = await recordRankingSnapshot('📸 Chụp tay');
    if (res?.ok || res?.entry) toast('📸 Đã chụp bảng vào lịch sử', 'success');
    else toast('Chưa có dữ liệu để chụp', 'error');
  });
  $('#rankHistClose')?.addEventListener('click', closeRankHist);
  $('#rankHistModal')?.addEventListener('click', (e) => { if (e.target === $('#rankHistModal')) closeRankHist(); });
  $('#rankHistHeSo')?.addEventListener('change', () => { rankHistHeSo = Number($('#rankHistHeSo').value) || 2; renderRankHist(); });
  $('#rankHistExport')?.addEventListener('click', async () => {
    const res = await window.api.rankingHistory.export(rankHistHeSo);
    if (res?.ok) toast(`Đã xuất ${res.count} mốc ra CSV`, 'success');
    else if (res?.reason === 'empty') toast('Chưa có mốc để xuất', 'error');
    else if (res?.reason !== 'canceled') toast('Xuất CSV thất bại', 'error');
  });
  $('#rankHistClear')?.addEventListener('click', async () => {
    if (!await askConfirm('Xóa toàn bộ lịch sử THI ĐẤU NHÓM?', 'Xóa lịch sử')) return;
    await window.api.rankingHistory.clear(); renderRankHist();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#scoreHistModal')?.classList.contains('is-open')) closeScoreHist();
    if ($('#rankHistModal')?.classList.contains('is-open')) closeRankHist();
  });
}

function applyVoteLockState() {
  const locked = isLinkedScoreRunning();
  document.querySelectorAll('[data-rk-toggle="voteActive"]').forEach(btn => {
    btn.disabled = locked;
  });
}

async function bumpVotedCreatorRound() {
  const c = getVotedCreator();
  if (!c) return;
  const nextRound = (Number(c.voteRound) || 0) + 1;
  await updateRankingCreator(c.id || c.tiktokId, {
    voteRound: nextRound,
    __history: { at: Date.now(), label: `Auto round R${nextRound}` },
  }, `Round ${c.nickname || c.tiktokId}: R${nextRound}`);
}

async function markVotedCreatorLost() {
  const c = getVotedCreator();
  if (!c || c.lost) return;
  await updateRankingCreator(c.id || c.tiktokId, {
    lost: true,
    __history: { at: Date.now(), label: 'Tự động THUA: không đạt mục tiêu vượt hạng' },
  }, `${c.nickname || c.tiktokId} đã bị loại`);
}

async function updateRankingCreator(id, patch, message = 'Đã cập nhật Thi đấu nhóm') {
  const c = creators.find(x => x.id === id || x.tiktokId === id);
  if (!c) return;
  const historyEntry = patch.__history;
  const cleanPatch = { ...patch };
  delete cleanPatch.__history;
  const gameplayHistory = Object.prototype.hasOwnProperty.call(cleanPatch, 'gameplayHistory')
    ? cleanPatch.gameplayHistory
    : historyEntry
    ? [historyEntry, ...(Array.isArray(c.gameplayHistory) ? c.gameplayHistory : [])].slice(0, 30)
    : c.gameplayHistory;
  await window.api.creators.upsert({ ...c, ...cleanPatch, gameplayHistory });
  await refreshCreators();
  const st = await window.api.ranking.getState();
  renderRkPreview(st);
  renderScoreBridge();
  toast(message, 'success');
}

function rankLabel(rank, hidden) {
  if (hidden) return 'Ẩn';
  // 👑 Vương miện TOP 1/2/3 (vàng/bạc/đồng) — khớp overlay OBS dọc + ngang.
  if (rank === 1 || rank === 2 || rank === 3) {
    const c = rank === 1 ? '#ffd75e' : (rank === 2 ? '#dfe8f7' : '#f8ad6b');
    return `<svg class="rk-crown-mini" viewBox="0 0 24 20" width="18" height="15" aria-hidden="true" style="vertical-align:-2px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))"><path d="M2.6 7.2l3.6 3.8L12 3.3l5.8 7.7 3.6-3.8-1.5 9.7H4.1L2.6 7.2z" fill="${c}" stroke="rgba(60,40,0,.42)" stroke-width=".7" stroke-linejoin="round"/><circle cx="12" cy="3.3" r="1.6" fill="#fff" opacity=".9"/></svg>`;
  }
  const n = Number(rank) || 0;
  return n > 0 && n < 10 ? `0${n}` : String(n || '');
}

function pointHistoryHtml(id) {
  const c = creators.find(x => x.id === id || x.tiktokId === id);
  const history = Array.isArray(c?.gameplayHistory) ? c.gameplayHistory.slice(0, 8) : [];
  if (!history.length) return '<div class="rk-history-empty">Chưa có lịch sử</div>';
  return history.map(h => {
    const t = h.at ? new Date(h.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
    const delta = Number(h.delta);
    const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
    const value = Number.isFinite(delta) ? `${sign}${formatNumber(Math.abs(delta))}` : escapeHtml(h.label || 'Cập nhật');
    const detail = Number.isFinite(Number(h.before)) && Number.isFinite(Number(h.after)) && Number.isFinite(delta)
      ? `${formatNumber(h.before)} ${sign || '+'} ${formatNumber(Math.abs(delta))} = ${formatNumber(h.after)}`
      : (h.label || '');
    return `<div class="rk-history-line"><b>${escapeHtml(value)}</b><span>${escapeHtml(detail)}</span><i>${escapeHtml(t)}</i></div>`;
  }).join('');
}

async function adjustRankingPoints(id, sign, amountText) {
  const c = creators.find(x => x.id === id || x.tiktokId === id);
  if (!c) return;
  const before = Number(c.contestPoints) || 0;
  const amount = parseNumberInput(amountText);
  if (!amount) { toast('Số điểm không hợp lệ', 'error'); return; }
  const delta = amount * sign;
  const next = Math.max(0, before + delta);
  await updateRankingCreator(id, {
    contestPoints: next,
    __history: { at: Date.now(), before, delta, label: sign > 0 ? 'Cộng KC' : 'Trừ KC', after: next },
  }, sign > 0 ? 'Đã cộng điểm' : 'Đã trừ điểm');
}

function openPointMenu(input) {
  $('.rk-point-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'rk-point-menu';
  menu.innerHTML = `
    <label>Nhập KC cần thay đổi
      <input data-point-value type="text" inputmode="numeric" value="1.000" />
    </label>
    <div class="rk-point-actions">
      <button data-point-action="plus" type="button">CỘNG</button>
      <button data-point-action="minus" type="button">TRỪ</button>
    </div>
  `;
  document.body.appendChild(menu);
  const rect = input.getBoundingClientRect();
  const bottomBarHeight = document.querySelector('.bottom-live')?.getBoundingClientRect().height || 0;
  const menuHeight = menu.offsetHeight;
  const below = rect.bottom + 6;
  const availableBottom = window.innerHeight - bottomBarHeight - 6;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
  // Open upward when the bottom bar would cover the point actions.
  menu.style.top = `${below + menuHeight > availableBottom ? Math.max(6, rect.top - menuHeight - 6) : below}px`;
  const close = () => {
    document.removeEventListener('mousedown', onOutside);
    menu.remove();
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  const valueInput = menu.querySelector('[data-point-value]');
  valueInput.focus();
  valueInput.select();
  menu.querySelectorAll('[data-point-action]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const amountText = valueInput.value;
    close();
    await adjustRankingPoints(input.dataset.rkPoints, btn.dataset.pointAction === 'plus' ? 1 : -1, amountText);
  }));
  valueInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const amountText = valueInput.value;
    close();
    await adjustRankingPoints(input.dataset.rkPoints, 1, amountText);
  });
}

function renderRkPreview(st) {
  const el = $('#rkPreview');
  const showCreatorControls = st.mode === 'creator';
  const rows = Array.isArray(st.rows) ? st.rows.slice() : [];
  if (showCreatorControls) {
    const visibleIds = new Set(rows.map(r => r.id));
    const groupsById = new Map(groups.map(g => [g.id, g]));
    const hiddenRows = visibleCreators().filter(c => c.hideObs && !visibleIds.has(c.id)).map(c => {
      const g = groupsById.get(c.groupId);
      return {
        id: c.id,
        rank: 'ẩn',
        name: c.nickname || c.tiktokId,
        avatar: c.avatar || '',
        initials: (c.nickname || c.tiktokId || '?').trim().slice(0, 2).toUpperCase(),
        points: Number(c.contestPoints) || 0,
        round: Number(c.voteRound) || 0,
        giftIcon: c.defaultGiftIcon || '',
        groupName: g?.name || '',
        hideScore: !!c.hideScore,
        lost: !!c.lost,
        voteActive: !!c.voteActive,
        active: !!c.voteActive,
        hideObs: true,
        obsDisplayOrder: Number(c.obsDisplayOrder),
      };
    });
    // Giữ nguyên vị trí hàng tại thời điểm ẩn, không dồn Creator xuống cuối danh sách.
    hiddenRows.sort((a, b) => a.obsDisplayOrder - b.obsDisplayOrder).forEach(r => {
      const position = Number.isFinite(r.obsDisplayOrder) ? Math.max(0, Math.min(r.obsDisplayOrder, rows.length)) : rows.length;
      rows.splice(position, 0, r);
    });
  }
  if (rows.length === 0) {
    el.innerHTML = '<div class="hint">Chưa có dữ liệu — cần Creator + nối LIVE. Tạo creator có "Quà mặc định" trùng với gift người xem tặng.</div>';
    return;
  }
  el.innerHTML = rows.slice(0, 30).map((r) => `
    <div class="rk-row${r.active ? ' is-active' : ''}${r.lost ? ' is-lost' : ''}${r.hideObs ? ' is-hidden-obs' : ''}">
      <div class="rk-left">
        ${st.showRank === false ? '' : `<span class="rk-rank">${rankLabel(r.rank, r.hideObs)}</span>`}
        ${st.showAvatar === false ? '' : `<img class="rk-avatar" src="${escapeAttr(safeAvatarUrl(r.avatar))}" onerror="this.onerror=null;this.src='../logo/hp-logo.png'" />`}
        <div class="rk-person">
          <span class="rk-name">${escapeHtml(r.name)}${st.showPerfOrder !== false && Number(r.perfOrder) > 0 ? ` <span class="rk-perf" title="Số thứ tự thi đấu (gán từ VÒNG QUAY)">#${Math.round(r.perfOrder)}</span>` : ''}</span>
          ${st.showGroupName === false ? '' : `<span class="rk-group">${r.groupName ? escapeHtml(r.groupName) : 'Chưa nhóm'}</span>`}
        </div>
      </div>
      ${showCreatorControls ? `<div class="rk-scorebox">
        ${st.showGift === false || !r.giftIcon ? '' : `<img class="rk-gift-icon" src="${escapeAttr(r.giftIcon)}" />`}
        <input class="rk-mini-input" data-rk-points="${escapeAttr(r.id)}" type="text" inputmode="numeric" value="${formatNumber(r.points)}" title="Điểm thi đấu" />
        <span class="rk-round-chip">R<input data-rk-round="${escapeAttr(r.id)}" type="number" min="0" value="${Number(r.round) || 0}" title="Round" /></span>
        <div class="rk-actions">
          <button class="rk-pill${r.voteActive ? ' on' : ''}" data-rk-toggle="voteActive" data-id="${escapeAttr(r.id)}" type="button" ${scoreLinkRanking && scoreLinkVoteLock && ['prestart','running','grace'].includes(latestScoreState?.status) ? 'disabled' : ''}>VOTE</button>
          <button class="rk-pill${r.lost ? ' on danger' : ''}" data-rk-toggle="lost" data-id="${escapeAttr(r.id)}" type="button">THUA</button>
          <button class="rk-pill${r.hideScore ? ' on' : ''}" data-rk-toggle="hideScore" data-id="${escapeAttr(r.id)}" type="button">Ẩn điểm</button>
          <button class="rk-pill${r.hideObs ? ' on' : ''}" data-rk-toggle="hideObs" data-id="${escapeAttr(r.id)}" type="button">${r.hideObs ? 'Hiện OBS' : 'Ẩn OBS'}</button>
        </div>
        <details class="rk-more"><summary>⚙</summary><div class="rk-more-pop">
          <div class="rk-history-title">Lịch sử gameplay</div>
          <button class="rk-clear-history" data-rk-clear-history="${escapeAttr(r.id)}" type="button">Xóa lịch sử</button>
          ${pointHistoryHtml(r.id)}
        </div></details>
      </div>` : `<div class="rk-scorebox readonly">${r.hideScore || st.hideAllScores ? '<span class="rk-pts muted" title="Ẩn điểm">•••</span>' : `<span class="rk-pts">${formatNumber(r.points)}</span>`}${st.showRound === false ? '' : `<span class="rk-round-chip">R${Number(r.round) || 0}</span>`}</div>`}
    </div>
  `).join('');
  el.querySelectorAll('[data-rk-points]').forEach(input => input.addEventListener('change', async () => {
    const c = creators.find(x => x.id === input.dataset.rkPoints || x.tiktokId === input.dataset.rkPoints);
    const before = Number(c?.contestPoints) || 0;
    const after = parseNumberInput(input.value);
    await updateRankingCreator(input.dataset.rkPoints, {
      contestPoints: after,
      __history: { at: Date.now(), before, delta: after - before, label: 'Sửa KC', after },
    }, 'Đã cập nhật điểm');
  }));
  el.querySelectorAll('[data-rk-points]').forEach(input => input.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openPointMenu(input);
  }));
  el.querySelectorAll('[data-rk-round]').forEach(input => input.addEventListener('change', async () => {
    await updateRankingCreator(input.dataset.rkRound, {
      voteRound: Number(input.value) || 0,
      __history: { at: Date.now(), label: `Sửa round R${Number(input.value) || 0}` },
    }, 'Đã cập nhật round');
  }));
  el.querySelectorAll('[data-rk-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const c = creators.find(x => x.id === btn.dataset.id || x.tiktokId === btn.dataset.id);
    if (!c) return;
    const key = btn.dataset.rkToggle;
    if (key === 'voteActive' && isLinkedScoreRunning()) {
      toast('Đang chạy Tính điểm liên kết, VOTE đang bị khóa', 'error');
      applyVoteLockState();
      return;
    }
    if (key === 'voteActive') {
      await window.api.ranking.setActive('');
    }
    if (key === 'voteActive' && !c.voteActive) {
      for (const other of creators) {
        if (other.id !== c.id && other.voteActive) await window.api.creators.upsert({ ...other, voteActive: false });
      }
    }
    const creatorRow = btn.closest('.rk-row');
    const obsDisplayOrder = creatorRow ? Array.from(el.querySelectorAll('.rk-row')).indexOf(creatorRow) : undefined;
    await updateRankingCreator(btn.dataset.id, {
      [key]: !c[key],
      ...(key === 'hideObs' ? { obsDisplayOrder: !c.hideObs ? obsDisplayOrder : undefined } : {}),
      __history: { at: Date.now(), label: `${btn.textContent.trim()} ${!c[key] ? 'ON' : 'OFF'}` },
    }, `Đã cập nhật ${btn.textContent.trim()}`);
    if (key === 'voteActive' && !c.voteActive && scoreLinkRanking) {
      const fresh = creators.find(x => x.id === c.id || x.tiktokId === c.tiktokId) || c;
      await applyAutoTargetForVote({ ...fresh, voteActive: true });
      await syncScoreToCreator({ ...fresh, voteActive: true });
    } else if (key === 'voteActive' && c.voteActive && scoreLinkRanking) {
      // Bỏ VOTE khi đang liên kết → xóa Creator bên Tính điểm để 2 bên vẫn khớp
      $('#scCreatorName').value = '';
      $('#scCreatorAvatar').value = '';
      if ($('#scCreatorSelect')) $('#scCreatorSelect').value = '';
      await window.api.score.setConfig(collectScoreCfg());
    }
  }));
  el.querySelectorAll('[data-rk-clear-history]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!await askConfirm('Xóa toàn bộ lịch sử gameplay của Creator này?', 'Xóa lịch sử')) return;
    await updateRankingCreator(btn.dataset.rkClearHistory, { gameplayHistory: [] }, 'Đã xóa lịch sử');
  }));
  renderScoreBridge();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.rk-more[open]').forEach(d => { d.open = false; });
  document.querySelector('.rk-point-menu')?.remove();
});

// ============================================================
// Score
// ============================================================
async function loadScoreConfig() {
  const st = await window.api.score.getState();
  // Mục tiêu điểm: TRỐNG (0) = chế độ "không mục tiêu" (chỉ cộng điểm bình thường, bỏ KPI). Có nhập >0 = như cũ.
  const rawTarget = Number(st.target) || 0;
  $('#scTarget').value = rawTarget > 0 ? formatNumber(rawTarget) : '';
  // Bridge "Tính điểm liên kết" luôn cần mục tiêu ≥1 (panel này bị khoá khi chưa liên kết)
  $('#rkScoreTarget').value = formatNumber(rawTarget > 0 ? rawTarget : 1000);
  const dMs = Number(st.durationMs) || 180000;
  const dSec = Math.floor(dMs / 1000);
  $('#scDurH').value = Math.floor(dSec / 3600);
  $('#scDurM').value = Math.floor((dSec % 3600) / 60);
  $('#scDurS').value = dSec % 60;
  $('#scPrep').value = st.prepSec ?? 3;
  $('#scDelay').value = Math.floor((st.delayMs ?? 5000) / 1000);
  $('#scContent').value = st.content || '';
  $('#scCreatorName').value = st.creatorName || '';
  $('#scCreatorAvatar').value = st.creatorAvatar || '';
  renderScoreCreatorSelect(st);
  $('#scTheme').value = ['douyin', 'vip', 'neon', 'battle', 'luxury', 'sunset', 'ocean', 'candy', 'custom'].includes(st.themePreset) ? st.themePreset : 'douyin';
  $('#scSize').value = st.overlaySize || 'medium';
  if ($('#scSkin')) { $('#scSkin').value = st.skin || 'auto'; updateSkinHint('scSkin', 'scSkinHint'); }
  $('#scBarStyle').value = st.barStyle || 'pill';
  if ($('#scLayout')) $('#scLayout').value = ['bar', 'card', 'timer'].includes(st.scoreLayout) ? st.scoreLayout : (st.cardLayout ? 'card' : 'bar');
  $('#scCompact').checked = false;
  $('#scHideAvatar').checked = !!st.hideAvatar;
  $('#scHideCreator').checked = !!st.hideCreator;
  if ($('#scColorByProgress')) $('#scColorByProgress').checked = !!st.colorByProgress;
  if ($('#scKpiX2')) $('#scKpiX2').value = st.kpiX2 ? 'true' : 'false';
  $('#scShowGiftUser').checked = false;
  $('#scShowTopUsers').checked = false;
  $('#scShowSpeed').checked = false;
  // Số trên thanh / Time / Over / Viền: luôn TRẮNG (không còn ô chọn màu) → ép cứng #ffffff
  $('#scTimeColor').value = '#ffffff';
  $('#scScoreFontSize').value = Math.max(12, Math.min(48, Number(st.scoreFontSize) || 18));
  $('#scContentColor').value = st.contentColor || '#f0eef6';
  $('#scOverColor').value = '#ffffff';
  $('#scBarColor1').value = st.barColor1 || '#b93678';
  $('#scBarColor2').value = st.barColor2 || '#ff8ed1';
  $('#scWaveColor').value = st.waveColor || '#ffffff';
  if ($('#scBorderColor')) $('#scBorderColor').value = '#ffffff';
  if ($('#scBorderOpacity')) { const o = Number.isFinite(Number(st.barBorderOpacity)) ? Number(st.barBorderOpacity) : 50; $('#scBorderOpacity').value = o; $('#scBorderOpacityValue').textContent = `${o}%`; }
  if ($('#scBorderWidth')) { const w = Number.isFinite(Number(st.barBorderWidth)) ? Number(st.barBorderWidth) : 1; $('#scBorderWidth').value = w; $('#scBorderWidthValue').textContent = `${w}px`; }
  if ($('#scShowRemaining')) $('#scShowRemaining').checked = !!st.showRemaining;
  if ($('#scFxGlowBorder')) $('#scFxGlowBorder').checked = !!st.fxGlowBorder;
  if ($('#scFxGlass')) $('#scFxGlass').checked = !!st.fxGlass;
  if ($('#scFxSparkle')) $('#scFxSparkle').checked = !!st.fxSparkle;
  if ($('#scFxSpotlight')) $('#scFxSpotlight').checked = !!st.fxSpotlight;
  if ($('#scFxAvatarAura')) $('#scFxAvatarAura').checked = !!st.fxAvatarAura;
  if ($('#scFxScoreBounce')) $('#scFxScoreBounce').checked = !!st.fxScoreBounce;
  if ($('#scFxFloatPoints')) $('#scFxFloatPoints').checked = !!st.fxFloatPoints;
  if ($('#scFxCardBreathe')) $('#scFxCardBreathe').checked = !!st.fxCardBreathe;
  if ($('#scFxLiquid')) $('#scFxLiquid').checked = !!st.fxLiquid;
  if ($('#scRunnerForcePink')) $('#scRunnerForcePink').checked = !!st.runnerForcePink;
  if ($('#scRunnerDust')) $('#scRunnerDust').checked = st.runnerDust !== false;
  if ($('#scTimerTop5')) $('#scTimerTop5').checked = st.timerTop5 !== false;
  if ($('#scTimerTail')) $('#scTimerTail').value = /^#[0-9a-f]{6}$/i.test(st.timerTailColor || '') ? st.timerTailColor : '#a15cf0';
  if ($('#scTimerFinalTick')) $('#scTimerFinalTick').checked = st.timerFinalTick !== false;
  if ($('#scRunnerBadgeMode')) $('#scRunnerBadgeMode').value = ['points', 'gift'].includes(st.runnerBadgeMode) ? st.runnerBadgeMode : 'points';
  if ($('#scAvatarThreshold')) $('#scAvatarThreshold').value = Math.max(1, Number(st.avatarThreshold) || 1000);
  if ($('#scCardBgOpacity')) { const c = Number.isFinite(Number(st.cardBgOpacity)) ? Number(st.cardBgOpacity) : 88; $('#scCardBgOpacity').value = c; $('#scCardBgOpacityValue').textContent = `${c}%`; }
  if ($('#scKpiMult')) $('#scKpiMult').value = String([2, 3, 5].includes(Number(st.kpiMult)) ? Number(st.kpiMult) : 2);
  syncScoreThemeChips();
  $('#scBigThreshold').value = st.bigGiftThreshold || 500;
  $('#scPointsBy').value = st.pointsBy || 'diamond';
  $('#scOverlayScale').value = st.overlayScale || 200;
  $('#scOverlayScaleValue').textContent = `${$('#scOverlayScale').value}%`;
  setSoundInput('scSndStart', st.startSound || '');
  setSoundInput('scSndDash', st.dashSound || '');
  setSoundInput('scSndWarn', st.warningSound || '');
  setSoundInput('scSndGoal', st.goalSound || '');
  setSoundInput('scSndX2', st.x2Sound || '');
  setSoundInput('scSndSuccess', st.successSound || '');
  setSoundInput('scSndFail', st.failSound || '');
  reflectScoreTargetMode();
  renderScPreview(st);
  const total = Math.floor((Number(st.durationMs) || 180000) / 1000);
  $('#rkScoreMin').value = Math.floor(total / 60);
  $('#rkScoreSec').value = total % 60;
}

// Mục tiêu TRỐNG → mờ + khoá KPI (không có mục tiêu thì KPI vô nghĩa).
function reflectScoreTargetMode() {
  const noTarget = !(parseNumberInput($('#scTarget')?.value) > 0);
  document.querySelector('.sc-kpix2-row')?.classList.toggle('is-off', noTarget);
  if ($('#scKpiX2')) $('#scKpiX2').disabled = noTarget;
  if ($('#scKpiMult')) $('#scKpiMult').disabled = noTarget;
}

function collectScoreCfg() {
  const h = Number($('#scDurH').value) || 0;
  const m = Number($('#scDurM').value) || 0;
  const s = Number($('#scDurS').value) || 0;
  const durationMs = Math.max(5000, (h * 3600 + m * 60 + s) * 1000);
  return {
    target: parseNumberInput($('#scTarget').value), // 0 (trống) = không mục tiêu: chỉ cộng điểm, bỏ KPI
    durationMs,
    prepSec: Number($('#scPrep').value) || 0,
    delayMs: Math.max(0, Number($('#scDelay').value) || 0) * 1000,
    content: $('#scContent').value.trim(),
    creatorName: $('#scCreatorName').value.trim(),
    creatorAvatar: $('#scCreatorAvatar').value.trim(),
    creatorId: $('#scCreatorSelect')?.value || '',
    themePreset: $('#scTheme').value,
    skin: $('#scSkin') ? $('#scSkin').value : 'auto',
    overlaySize: $('#scSize').value,
    barStyle: $('#scBarStyle').value,
    scoreLayout: ['bar', 'card', 'timer'].includes($('#scLayout')?.value) ? $('#scLayout').value : 'bar',
    cardLayout: $('#scLayout')?.value === 'card', // giữ đồng bộ cho cấu hình/preview đời cũ
    compactMode: false,
    hideAvatar: $('#scHideAvatar').checked,
    hideCreator: $('#scHideCreator').checked,
    colorByProgress: $('#scColorByProgress')?.checked || false,
    kpiX2: $('#scKpiX2')?.value === 'true',
    kpiMult: [2, 3, 5].includes(Number($('#scKpiMult')?.value)) ? Number($('#scKpiMult').value) : 2,
    showRemaining: $('#scShowRemaining')?.checked || false,
    fxGlowBorder: $('#scFxGlowBorder')?.checked || false,
    fxGlass: $('#scFxGlass')?.checked || false,
    fxSparkle: $('#scFxSparkle')?.checked || false,
    fxSpotlight: $('#scFxSpotlight')?.checked || false,
    fxAvatarAura: $('#scFxAvatarAura')?.checked || false,
    fxScoreBounce: $('#scFxScoreBounce')?.checked || false,
    fxFloatPoints: $('#scFxFloatPoints')?.checked || false,
    fxCardBreathe: $('#scFxCardBreathe')?.checked || false,
    fxLiquid: $('#scFxLiquid')?.checked || false,
    runnerForcePink: $('#scRunnerForcePink')?.checked || false,
    runnerDust: $('#scRunnerDust') ? $('#scRunnerDust').checked : true,
    timerTop5: $('#scTimerTop5') ? $('#scTimerTop5').checked : true,
    timerTailColor: /^#[0-9a-f]{6}$/i.test($('#scTimerTail')?.value || '') ? $('#scTimerTail').value : '#a15cf0',
    timerFinalTick: $('#scTimerFinalTick') ? $('#scTimerFinalTick').checked : true,
    runnerBadgeMode: ['points', 'gift'].includes($('#scRunnerBadgeMode')?.value) ? $('#scRunnerBadgeMode').value : 'points',
    avatarThreshold: Math.max(1, Number($('#scAvatarThreshold')?.value) || 1000),
    barBorderColor: $('#scBorderColor')?.value || '#ffffff',
    barBorderOpacity: Math.max(0, Math.min(100, Number($('#scBorderOpacity')?.value) || 0)),
    barBorderWidth: Math.max(0, Math.min(6, Number($('#scBorderWidth')?.value) || 0)),
    cardBgOpacity: Math.max(0, Math.min(100, Number.isFinite(Number($('#scCardBgOpacity')?.value)) ? Number($('#scCardBgOpacity').value) : 88)),
    showGiftUser: false,
    showTopUsers: false,
    showSpeed: false,
    timeColor: $('#scTimeColor').value,
    scoreFontSize: Math.max(12, Math.min(48, Number($('#scScoreFontSize').value) || 18)),
    contentColor: $('#scContentColor').value,
    overColor: $('#scOverColor').value,
    barColor1: $('#scBarColor1').value,
    barColor2: $('#scBarColor2').value,
    waveColor: $('#scWaveColor').value,
    bigGiftThreshold: Math.max(1, Number($('#scBigThreshold').value) || 500),
    pointsBy: $('#scPointsBy').value,
    overlayScale: Math.max(80, Math.min(300, Number($('#scOverlayScale').value) || 200)),
    startSound: gameplaySoundValue('scSndStart'),
    dashSound: gameplaySoundValue('scSndDash'),
    warningSound: gameplaySoundValue('scSndWarn'),
    goalSound: gameplaySoundValue('scSndGoal'),
    x2Sound: gameplaySoundValue('scSndX2'),
    successSound: gameplaySoundValue('scSndSuccess'),
    failSound: gameplaySoundValue('scSndFail'),
  };
}

function renderScoreCreatorSelect(st = latestScoreState || {}) {
  const sel = $('#scCreatorSelect');
  if (!sel) return;
  const currentName = st.creatorName || $('#scCreatorName')?.value || '';
  const currentAvatar = st.creatorAvatar || $('#scCreatorAvatar')?.value || '';
  const current = creators.find(c => {
    const nameMatches = (c.nickname || c.tiktokId || '') === currentName;
    const avatarMatches = !currentAvatar || currentAvatar === '../logo/hp-logo.png' || c.avatar === currentAvatar;
    return nameMatches && avatarMatches;
  })?.id || '';
  sel.innerHTML = '<option value="">— Chọn —</option>' + visibleCreators()
    .slice()
    .sort((a, b) => (a.nickname || a.tiktokId || '').localeCompare(b.nickname || b.tiktokId || '', 'vi'))
    .map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`)
    .join('');
  sel.value = current;
}

async function applyScoreCreatorSelect() {
  const c = creators.find(x => x.id === $('#scCreatorSelect').value);
  $('#scCreatorName').value = c ? (c.nickname || c.tiktokId || '') : '';
  $('#scCreatorAvatar').value = c ? creatorAvatarValue(c) : '';
  renderScPreview({ ...(latestScoreState || collectScoreCfg()), ...collectScoreCfg(), score: latestScoreState?.score || 0, status: latestScoreState?.status || 'idle', timeText: latestScoreState?.timeText || '00:00' });
  scheduleScoreAutoSave();
  // Khi bật liên kết: chọn Creator bên Tính điểm cũng tự VOTE bên Thi đấu nhóm để 2 bên đồng bộ
  if (scoreLinkRanking) await syncScoreSelectToVote(c);
}

// Đồng bộ lựa chọn Creator bên 🎯 Tính điểm → VOTE bên 🏆 Thi đấu nhóm
async function syncScoreSelectToVote(c) {
  if (isLinkedScoreRunning()) {
    // Đang chạy Tính điểm liên kết → VOTE bị khóa, khôi phục dropdown theo Creator đang VOTE
    const voted = getVotedCreator();
    if ($('#scCreatorSelect')) $('#scCreatorSelect').value = voted?.id || '';
    toast('Đang chạy Tính điểm liên kết, VOTE đang bị khóa', 'error');
    return;
  }
  const voted = getVotedCreator();
  if (!c) {
    // Bỏ chọn Creator → bỏ VOTE để 2 bên vẫn khớp nhau
    if (voted) {
      await window.api.creators.upsert({ ...voted, voteActive: false });
      await refreshCreators();
      const st = await window.api.ranking.getState();
      renderRkPreview(st);
      renderScoreBridge();
    }
    return;
  }
  if (voted && voted.id === c.id) return; // đã VOTE đúng Creator, không cần làm lại
  await window.api.ranking.setActive('');
  for (const other of creators) {
    if (other.id !== c.id && other.voteActive) await window.api.creators.upsert({ ...other, voteActive: false });
  }
  await updateRankingCreator(c.id, {
    voteActive: true,
    __history: { at: Date.now(), label: 'VOTE ON (Tính điểm)' },
  }, `VOTE: ${c.nickname || c.tiktokId}`);
  const fresh = creators.find(x => x.id === c.id) || c;
  await applyAutoTargetForVote({ ...fresh, voteActive: true });
}

const _scoreSaver = makeAutoSaver(() => window.api.score.setConfig(collectScoreCfg()).catch(() => {}));
function scheduleScoreAutoSave() { _scoreSaver.schedule(); }

// Bảng màu preset: [bar1, bar2, wave, over]
const SCORE_THEMES = {
  douyin:  ['#b93678', '#ff8ed1', '#ffffff', '#ffffff'],
  vip:     ['#b76b00', '#ffd36a', '#fff4c1', '#ffffff'],
  neon:    ['#00a6ff', '#35ffcf', '#e7ffff', '#ffffff'],
  battle:  ['#8f101f', '#ff4b4b', '#ffe1e1', '#ffffff'],
  luxury:  ['#4c2a85', '#c79cff', '#f6edff', '#ffffff'],
  sunset:  ['#ff6a3d', '#ffc46b', '#fff3dd', '#ffffff'],
  ocean:   ['#0088cc', '#22e0c8', '#e3fbff', '#ffffff'],
  candy:   ['#ff8fcf', '#c9a9ff', '#fff2fb', '#ffffff'],
};

// Chip "đang chọn" = preset có đúng 4 màu trùng với 4 ô màu hiện tại
function syncScoreThemeChips() {
  const now = [
    $('#scBarColor1')?.value, $('#scBarColor2')?.value,
    $('#scWaveColor')?.value, $('#scOverColor')?.value,
  ].map(c => (c || '').toLowerCase());
  $$('#scThemeChips .stc-chip').forEach(chip => {
    const cols = SCORE_THEMES[chip.dataset.theme] || [];
    const match = cols.length === 4 && cols.every((c, i) => c.toLowerCase() === now[i]);
    chip.classList.toggle('is-active', match);
  });
}

// Áp preset: đổ 4 màu, cập nhật select + chip, đẩy config để preview cập nhật
function applyScoreTheme(t, { save = true } = {}) {
  const cols = SCORE_THEMES[t];
  if (!cols) return;
  $('#scTheme').value = t;
  $('#scBarColor1').value = cols[0];
  $('#scBarColor2').value = cols[1];
  $('#scWaveColor').value = cols[2];
  $('#scOverColor').value = cols[3];
  syncScoreThemeChips();
  if (save) scheduleScoreAutoSave();
}

function wireScoreTab() {
  // Theme picker → auto-fill 4 color pickers
  $('#scTheme').addEventListener('change', () => {
    applyScoreTheme($('#scTheme').value);
  });
  // Chip preset nhanh (ngoài drawer) → áp theme 1 chạm
  $$('#scThemeChips .stc-chip').forEach(chip => {
    chip.addEventListener('click', () => applyScoreTheme(chip.dataset.theme));
  });
  $('#scTarget').addEventListener('input', () => { syncScoreTargetFromScoreTab(); reflectScoreTargetMode(); });
  $('#scTarget').addEventListener('blur', () => {
    const v = parseNumberInput($('#scTarget').value);
    $('#scTarget').value = v > 0 ? formatNumber(v) : ''; // trống = không mục tiêu
    reflectScoreTargetMode();
  });
  ['scDurH', 'scDurM', 'scDurS'].forEach(id => $('#' + id).addEventListener('input', syncScoreDurationFromScoreTab));
  // Accordion: mở 1 thẻ gập nhóm thì tự đóng các thẻ còn lại (gọn, đỡ cuộn)
  $$('.sc-group').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) $$('.sc-group').forEach(o => { if (o !== d) o.open = false; });
  }));
  $('#scOverlayScale').addEventListener('input', () => { $('#scOverlayScaleValue').textContent = `${$('#scOverlayScale').value}%`; scheduleScoreAutoSave(); });
  $('#scBorderOpacity')?.addEventListener('input', () => { $('#scBorderOpacityValue').textContent = `${$('#scBorderOpacity').value}%`; scheduleScoreAutoSave(); });
  $('#scBorderWidth')?.addEventListener('input', () => { $('#scBorderWidthValue').textContent = `${$('#scBorderWidth').value}px`; scheduleScoreAutoSave(); });
  $('#scCardBgOpacity')?.addEventListener('input', () => { $('#scCardBgOpacityValue').textContent = `${$('#scCardBgOpacity').value}%`; scheduleScoreAutoSave(); });
  ['scPrep','scDelay','scTheme','scSize','scBarStyle','scLayout','scContent','scHideAvatar','scHideCreator','scColorByProgress','scKpiX2','scKpiMult','scShowRemaining','scFxGlowBorder','scFxGlass','scFxSparkle','scFxSpotlight','scFxAvatarAura','scFxScoreBounce','scFxFloatPoints','scFxCardBreathe','scFxLiquid','scRunnerForcePink','scRunnerDust','scTimerTop5','scTimerTail','scTimerFinalTick','scBorderColor','scTimeColor','scScoreFontSize','scContentColor','scOverColor','scBarColor1','scBarColor2','scWaveColor','scSkin'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', scheduleScoreAutoSave);
  });
  wireSkinHint('scSkin', 'scSkinHint');
  // Sửa tay một trong 4 ô màu preset → cập nhật lại chip cho khớp
  ['scBarColor1','scBarColor2','scWaveColor','scOverColor'].forEach(id => {
    $('#' + id)?.addEventListener('input', syncScoreThemeChips);
  });
  // ⚡ Preset màu nhanh cho THỜI GIAN: 1 bấm đổi Màu 1 + Màu 2 + Màu lem cuối
  $$('.sc-preset-chip').forEach(btn => btn.addEventListener('click', () => {
    if ($('#scBarColor1')) $('#scBarColor1').value = btn.dataset.c1;
    if ($('#scBarColor2')) $('#scBarColor2').value = btn.dataset.c2;
    if ($('#scTimerTail')) $('#scTimerTail').value = btn.dataset.tail;
    $$('.sc-preset-chip').forEach(b => b.classList.toggle('is-active', b === btn));
    syncScoreThemeChips();
    scheduleScoreAutoSave();
  }));
  $('#scCreatorSelect').addEventListener('change', applyScoreCreatorSelect);
  $$('.score-sound-file').forEach(btn => btn.addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) {
      setSoundInput(btn.dataset.target, filePathToUrl(file));
      await window.api.settings.set({ audio: {
        gameSoundEnabled: gameplaySoundEnabled(),
        startSound: soundValue('scSndStart'),
        warningSound: soundValue('scSndWarn'),
        goalSound: soundValue('scSndGoal'),
        successSound: soundValue('scSndSuccess'),
        failSound: soundValue('scSndFail'),
      } });
      await window.api.score.setConfig(collectScoreCfg());
      await window.api.pkduo.setConfig(collectPkCfg());
      toast('Đã lưu âm thanh Score', 'success');
    }
  }));
  $$('.score-sound-test').forEach(btn => btn.addEventListener('click', () => {
    testSoundValue(soundValue(btn.dataset.target));
  }));
  $('#scSaveCfg').addEventListener('click', async () => {
    await window.api.score.setConfig(collectScoreCfg());
    toast('💾 Đã lưu Score', 'success');
  });
  // Ô "Liên kết" của Tính điểm được wire chung trong initRankingLinks (đồng bộ với tiêu đề + bảng tổng).
  $('#scStart').addEventListener('click', async () => {
    const running = ['prestart', 'running', 'grace'].includes(latestScoreState?.status);
    if (running) {
      scoreStoppedManually = true;
      await window.api.score.stop();
      toast('■ Đã dừng', 'success');
    } else {
      if (!requireLive('BẮT ĐẦU Tính điểm')) return;
      await window.api.score.setConfig(collectScoreCfg());
      scoreAutoRoundHandled = false;
      scoreStoppedManually = false;
      await window.api.score.start();
      toast('▶ Score: bắt đầu', 'success');
    }
  });
  $('#scReset').addEventListener('click', async () => {
    if (confirm('Reset điểm về 0?')) { await window.api.score.reset(); toast('↺ Reset', 'success'); }
  });
  $('#scTestPlus').addEventListener('click', async () => {
    await window.api.score.addPoints(Math.max(1, Number($('#scTestPoints').value) || 100), { uniqueId: 'test-user', nickname: 'Test user', avatar: '../logo/hp-logo.png' });
  });
  $('#scTestMinus').addEventListener('click', async () => {
    await window.api.score.addPoints(-Math.max(1, Number($('#scTestPoints').value) || 100), { uniqueId: 'test-user', nickname: 'Test user', avatar: '../logo/hp-logo.png' });
  });
  $('#scCopyUrl').addEventListener('click', async () => {
    const url = await window.api.score.getUrl(); await window.api.shell.copyText(url);
    toast('📋 Đã copy link Score', 'success');
  });
  // 2 nguồn OBS tách kiểu: mỗi link render cố định 1 phong cách → thêm 2 Browser Source riêng trong OBS,
  // bật/tắt con mắt + đặt vị trí độc lập, không còn lệch chiều cao khi chuyển ĐƯỜNG ĐUA ↔ KÊU GỌI.
  $('#scCopyUrlBar')?.addEventListener('click', async () => {
    const url = await window.api.score.getBarUrl(); await window.api.shell.copyText(url);
    toast('📋 Đã copy link ĐƯỜNG ĐUA', 'success');
  });
  $('#scCopyUrlCard')?.addEventListener('click', async () => {
    const url = await window.api.score.getCardUrl(); await window.api.shell.copyText(url);
    toast('📋 Đã copy link KÊU GỌI', 'success');
  });
  $('#scCopyUrlTimer')?.addEventListener('click', async () => {
    const url = await window.api.score.getTimerUrl(); await window.api.shell.copyText(url);
    toast('📋 Đã copy link THỜI GIAN', 'success');
  });
  // ⚙️ Popover công cụ (COPY OBS + TEST) — gọn hàng điều khiển, bấm ngoài/Esc để đóng
  const scToolsBtn = $('#scToolsBtn');
  const scToolsPop = $('#scToolsPop');
  if (scToolsBtn && scToolsPop) {
    const closeTools = () => { scToolsPop.hidden = true; scToolsBtn.setAttribute('aria-expanded', 'false'); };
    scToolsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = scToolsPop.hidden;
      scToolsPop.hidden = !open;
      scToolsBtn.setAttribute('aria-expanded', String(open));
    });
    scToolsPop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (!scToolsPop.hidden) closeTools(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !scToolsPop.hidden) closeTools(); });
  }
}

function renderScPreview(st) {
  const prevStatus = latestScoreState?.status;
  latestScoreState = st;
  handleScoreGameplaySound(st, prevStatus);
  // TỰ GHI LỊCH SỬ Tính điểm khi kết thúc 1 lượt (độc lập với Liên kết BXH) — 1 lượt chỉ ghi 1 lần.
  if (['running', 'grace'].includes(prevStatus) && ['success', 'failed'].includes(st.status)) {
    const runKey = String(st.runStartedAt || st.resultAt || '');
    if (runKey && runKey !== lastScoreHistRunKey) {
      lastScoreHistRunKey = runKey;
      const info = currentScoreCreatorInfo();
      window.api.scoreHistory.add({
        name: info.name, tiktokId: info.tiktokId,
        points: Math.max(0, Number(st.score) || 0),
        target: Math.max(0, Number(st.target) || 0),
        status: st.status,
      }).then(() => { if ($('#scoreHistModal')?.classList.contains('is-open')) renderScoreHist(); }).catch(() => {});
    }
  }
  if (scoreLinkRanking && !scoreStoppedManually && !scoreAutoRoundHandled && ['running', 'grace'].includes(prevStatus) && ['success', 'failed'].includes(st.status)) {
    scoreAutoRoundHandled = true;
    (async () => {
      // Đã bật Liên kết → TỰ ĐỘNG cộng điểm đạt được vào BXH cho Creator VOTE (vẫn hoàn tác được).
      await autoApplyScoreToRanking(st);
      await bumpVotedCreatorRound();
      // Không đạt số điểm cần để vượt hạng thì mặc định loại Creator đang VOTE.
      if (st.status === 'failed') await markVotedCreatorLost();
    })().catch(() => {});
  }
  if (['idle', 'prestart', 'running'].includes(st.status)) {
    scoreAutoRoundHandled = false;
    if (st.status !== 'idle') scoreStoppedManually = false;
  }
  renderScoreBridge();
  applyVoteLockState();
  // Mục tiêu = 0 (trống) → chế độ "không mục tiêu": thanh đầy, ẩn mục tiêu/Over/KPI (khớp overlay OBS).
  const noTarget = !(Number(st.target) > 0);
  const target = noTarget ? 0 : Math.max(1, Number(st.target) || 1);
  const score = Math.max(0, Number(st.score) || 0);
  const pct = noTarget ? 100 : Math.min(100, Math.round((score / target) * 100));
  const barColor1 = st.barColor1 || '#ff6aa9';
  const barColor2 = st.barColor2 || '#8eb6ff';
  // Đổi màu theo %: hành trình sắc màu theo tiến độ (khớp overlay OBS)
  const reviewFill = st.colorByProgress
    ? (() => { const h = 280 - 250 * Math.max(0, Math.min(1, pct / 100));
        return `linear-gradient(90deg, hsl(${(h + 16).toFixed(0)},88%,67%), hsl(${h.toFixed(0)},90%,61%), hsl(${(h - 14).toFixed(0)},92%,55%))`; })()
    : `linear-gradient(90deg, ${barColor1}, ${barColor2})`;
  const reviewIdleColor = (hex, pct) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16), t = pct / 100;
    const base = [23, 35, 51];
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (base[i] - v) * t));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  };
  const reviewIdle = `linear-gradient(90deg, ${reviewIdleColor(barColor2, 58)} 0%, ${reviewIdleColor(barColor1, 60)} 100%)`;
  const reviewEdge = `${barColor1}ad`;
  const status = st.status || 'idle';
  const running = ['prestart', 'running', 'grace'].includes(status);
  const startBtn = $('#scStart');
  if (startBtn) {
    startBtn.textContent = running ? '■ DỪNG' : '▶ BẮT ĐẦU';
    startBtn.classList.toggle('warn', running);
    startBtn.classList.toggle('primary', !running);
  }
  const statusLabel =
    status === 'prestart' ? '⏳ Chuẩn bị' :
    status === 'running' ? '▶ Đang chạy' :
    status === 'grace' ? '⏱ ĐANG TÍNH ĐIỂM' :
    status === 'success' ? '🏆 THÀNH CÔNG' :
    status === 'failed' ? '❌ Không hoàn thành' :
    '⏸ Chờ bắt đầu';
  const statusClass =
    status === 'prestart' ? 'is-prep' :
    status === 'running' ? 'is-run' :
    status === 'grace' ? 'is-grace' :
    status === 'success' ? 'is-win' :
    status === 'failed' ? 'is-lose' :
    'is-idle';
  const recent = Array.isArray(st.recentGifts) ? st.recentGifts : [];
  const topUsers = Array.isArray(st.topUsers) ? st.topUsers : [];
  const visibleRecent = recent.slice(0, 5);
  const visibleTopUsers = topUsers.slice(0, 5);
  // TRÊN CÙNG: khối thông tin gọn (thời gian + thanh máu + creator + điểm + trạng thái).
  const scoreFont = Math.max(12, Math.min(48, Number(st.scoreFontSize) || 18));
  const over = noTarget ? 0 : Math.max(0, score - target);
  const scLayoutMode = ['bar', 'card', 'timer'].includes(st.scoreLayout) ? st.scoreLayout : (st.cardLayout ? 'card' : 'bar');
  if (scLayoutMode === 'timer') {
    // Preview khớp THỜI GIAN: thanh đếm lùi (đầy→cạn, đầu hồng → đích tím) + đồng hồ vòng · avatar/tên · giai đoạn · Điểm.
    const durMs = Math.max(1, Number(st.durationMs) || 1);
    const remMs = Number(st.remainingMs) || 0;
    // MÉP MÁU (fillP) bò đều tới số 9: đầu→9s = 5%→73% (tuyến tính), rồi 9→0s = 73%→100% (hết giờ rút sạch). Khớp overlay.
    let fillP = 73;
    if (['success', 'failed', 'grace'].includes(status)) fillP = 100;
    else if (status === 'prestart') fillP = 5;
    else if (remMs > 9000) { const frac = (remMs - 9000) / Math.max(1, durMs - 9000); fillP = 5 + (73 - 5) * (1 - frac); }
    else { const tt = Math.max(0, Math.min(9, remMs / 1000)); fillP = 73 + (100 - 73) * (1 - tt / 9); }
    const tPct = 100 - fillP; // bề rộng máu = 100−fillP
    const secLeft = Math.ceil((Number(st.remainingMs) || 0) / 1000);
    const finalCount = status === 'running' && secLeft >= 1 && secLeft <= 9;
    // Chip chỉ hiện khi CHUẨN BỊ/ĐANG CHẠY; ẩn ở idle/grace/kết thúc (tránh chip "00" dư sau đồng hồ)
    const hideClock = !(status === 'prestart' || status === 'running');
    const clockText = finalCount ? String(secLeft) : status === 'prestart' ? 'SẴN SÀNG' : (st.timeText || '00:00');
    const phase = status === 'prestart' ? 'CHUẨN BỊ' : status === 'grace' ? 'ĐỢI CHỐT ĐIỂM'
      : (status === 'success' || status === 'failed') ? 'CHỐT ĐIỂM'
      : status === 'running' ? 'ĐANG NƯỚC RÚT' : 'CHỜ BẮT ĐẦU';
    const clockCls = `sc-rt-clock${finalCount ? ' is-final' : ''}${hideClock ? ' is-hidden' : ''}`;
    // Chip = màu đầu thanh (barColor1) → đồng bộ tại điểm tiếp xúc; final/hidden thì không nền.
    const chipBg = `;background:linear-gradient(180deg,rgba(255,255,255,.32) 0%,rgba(255,255,255,0) 48%,rgba(0,0,0,.24) 100%),${barColor1}`;
    // Số 9→1 nổi ở vùng gần đồng hồ (73%→91%); chip pill bám mép máu (fillP).
    const tNum = Math.max(0, Math.min(9, remMs / 1000));
    const chipPos = finalCount ? (91 - (tNum / 9) * 18) : fillP;
    const clockStyle = hideClock ? '' : finalCount ? `left:${chipPos.toFixed(2)}%` : `left:${chipPos.toFixed(2)}%${chipBg}`;
    // Đầu thanh = barColor1 (đồng bộ chip) → lem sang barColor2 (Preset) → màu lem cuối trong suốt dần về đồng hồ.
    const tailC = /^#[0-9a-f]{6}$/i.test(st.timerTailColor || '') ? st.timerTailColor : '#a15cf0';
    const fillGrad = `linear-gradient(90deg, ${barColor1} 0%, ${barColor1} 13%, ${barColor2} 60%, ${tailC}b8 84%, ${tailC}24 100%)`;
    const spin = status === 'running' || status === 'grace' ? ' is-spin' : '';
    // TOP5: container LUÔN render khi bật (chừa chỗ) → avatar hiện lên không làm giật thanh (khớp overlay).
    const t5on = st.timerTop5 !== false;
    const t5 = t5on && Array.isArray(st.topUsers) ? st.topUsers.slice(0, 5) : [];
    const t5html = t5on ? `<div class="sc-rt-top5">${t5.map((u, i) => `<span class="sc-rt-t5 r${i + 1}" style="z-index:${10 - i}" title="${escapeAttr(u.nickname || u.user || '')}">${i === 0 ? '<b>👑</b>' : ''}${u.avatar ? `<img src="${escapeAttr(u.avatar)}" onerror="this.onerror=null;this.style.visibility='hidden'" />` : '<img />'}<i>${i + 1}</i></span>`).join('')}</div>` : '';
    // ── CHỈ TRONG APP (không ra OBS): danh sách TOP 5 người tặng có TÊN ĐẦY ĐỦ (trái) + số điểm TO cho MC (phải) ──
    const mcTop5 = t5.length
      ? `<div class="sc-rt-mc-top5">${t5.map((u, i) => `<div class="sc-rt-mcrow r${i + 1}"><i class="sc-rt-mcrank">${i + 1}</i>${u.avatar ? `<img src="${escapeAttr(u.avatar)}" onerror="this.onerror=null;this.style.visibility='hidden'" />` : '<img />'}<span class="sc-rt-mcname">${escapeHtml(u.nickname || u.user || '—')}</span><b class="sc-rt-mcpts">${formatNumber(Math.floor(u.points || 0))}</b></div>`).join('')}</div>`
      : `<div class="sc-rt-mc-top5"><div class="sc-rt-mc-empty">Chưa có người tặng</div></div>`;
    const mcScore = `<div class="sc-rt-mc-score"><small>ĐIỂM</small><b>${formatNumber(score)}</b></div>`;
    const mcBottom = `<div class="sc-rt-bottom">${mcTop5}${t5html}${mcScore}</div>`;
    $('#scPreview').innerHTML = `
      <div class="sc-rev-timer status-${status}">
        <div class="sc-rt-barwrap">
          <div class="sc-rt-track"><i style="width:${tPct}%;background:${fillGrad}"></i></div>
          <div class="${clockCls}" style="${clockStyle}">${escapeHtml(clockText)}</div>
          <div class="sc-rt-dial${spin}"><span></span></div>
        </div>
        <div class="sc-rt-info">
          <div class="sc-rt-person">${st.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(st.creatorAvatar)}" />` : '<span>HP</span>'}<strong>${escapeHtml(st.creatorName || 'Creator')}</strong></div>
          <div class="sc-rt-phase">${escapeHtml(phase)}</div>
          <div class="sc-rt-score"><small>ĐIỂM</small><b>${formatNumber(score)}</b></div>
        </div>
        ${mcBottom}
      </div>
    `;
  } else if (scLayoutMode === 'card') {
    // Preview khớp Thẻ HUD góc GỌN: tên idol trên cùng · avatar to giữa-trái · đồng hồ/trạng thái giữa · thanh máu ôm đáy
    const isWord = ['success', 'failed', 'grace'].includes(status);
    const clockText = status === 'success' ? 'THÀNH CÔNG' : status === 'failed' ? 'KHÔNG HOÀN THÀNH' : status === 'grace' ? 'ĐANG TÍNH ĐIỂM' : (st.timeText || '00:00');
    const clockColor = status === 'success' ? '#65ff9a' : status === 'failed' ? '#ff6b7d' : (st.timeColor || '#ffffff');
    const title = (st.content && st.content.trim()) ? st.content : (st.creatorName || 'Creator');
    const kpiMult = [2, 3, 5].includes(Number(st.kpiMult)) ? Number(st.kpiMult) : 2;
    const kpiTotal = score <= target ? score : target + (score - target) * kpiMult;
    const showKpi2 = !noTarget && !!st.kpiX2 && score > target;
    $('#scPreview').innerHTML = `
      <div class="sc-rev-card${!noTarget && score >= target ? ' kpi-met' : ''}">
        <div class="sc-rev-tab">${escapeHtml(title)}</div>
        <div class="sc-rev-mid">
          ${st.creatorAvatar ? `<img class="sc-rev-avatar js-avatar" src="${escapeAttr(st.creatorAvatar)}" />` : '<div class="sc-rev-avatar sc-rev-avatar--ph">HP</div>'}
          <div class="sc-rev-clock${isWord ? ' is-word' : ''}" style="color:${clockColor}">${escapeHtml(clockText)}</div>
          ${showKpi2 ? `<div class="sc-rev-kpi2">x${kpiMult} → ${formatNumber(kpiTotal)} điểm</div>` : ''}
        </div>
        <div class="sc-rev-bar${noTarget ? ' is-free' : ''}" style="--score-review-fill:${escapeAttr(reviewFill)};--score-review-idle:${escapeAttr(reviewIdle)};--score-review-edge:${escapeAttr(reviewEdge)}">
          <i class="${score > 0 ? 'has-fill' : ''}" style="width:${pct}%"></i>
          <div class="sc-rev-labels${over > 0 ? ' has-over' : ''}">
            ${over > 0 ? `<span class="sc-rev-over" style="--sc-over:${escapeAttr(st.overColor || '#fff2a8')}"><small>+OVER</small><b>${formatNumber(over)}</b></span>` : ''}
            <span class="sc-rev-score">${formatNumber(score)}</span>
            ${noTarget ? '' : `<span class="sc-rev-target"><small>ĐIỂM</small><b>${formatNumber(target)}</b></span>`}
          </div>
        </div>
      </div>
    `;
  } else {
  // Người chạy kiểu Douyin trong preview (ĐƯỜNG ĐUA) — khớp overlay OBS: vòng theo màu, ẩn khi cán đích, quà lớn +KC + avatar.
  const scGoalReached = !noTarget && score >= target;
  const scRunning = ['prestart', 'running', 'grace'].includes(status);
  const scGift = !!st.lastAdd && ['running', 'grace'].includes(status);
  const scAvaThr = Math.max(1, Number(st.avatarThreshold) || 1000);
  const scBig = !!st.lastAdd && Number(st.lastAdd) >= scAvaThr && !!st.lastAddAvatar;
  const scBadge = scGift ? `+${formatNumber(Math.max(0, Number(st.lastAdd) || 0))}` : '';
  const scPop = Math.max(6, Math.min(93, pct));
  const scRunLite = st.runnerForcePink ? '#ff8cc6' : barColor2;
  const scRunDark = st.runnerForcePink ? '#f0327f' : barColor1;
  const scRunFig = '<svg viewBox="0 0 24 24"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/></svg>';
  const scAvaHtml = (scGift && scBig) ? `<img class="sc-rev-ava" src="${escapeAttr(st.lastAddAvatar)}" onerror="this.style.display='none'" />` : '';
  // Cán đích: ẩn hình người (is-goal) nhưng vẫn giữ huy hiệu quà để kích cầu phần dư — khớp overlay OBS.
  const scRunner = scRunning ? `<span class="sc-rev-run${scGift ? ' has-gift' : ''}${scBig ? ' has-ava' : ''}${scGoalReached ? ' is-goal' : ''}" style="left:${scPop}%;--rl:${escapeAttr(scRunLite)};--rd:${escapeAttr(scRunDark)}">${scGift ? `<span class="sc-rev-badge">${escapeHtml(scBadge)}${scAvaHtml}</span>` : ''}<span class="sc-rev-fig">${scRunFig}</span></span>` : '';
  $('#scPreview').innerHTML = `
    <div class="score-review-card${!noTarget && score >= target ? ' kpi-met' : ''}">
      <div class="score-review-topline">
        <span class="score-review-chip ${statusClass}">${escapeHtml(statusLabel)}</span>
        <div class="score-review-time">${escapeHtml(st.timeText || '00:00')}</div>
        ${noTarget ? '<span class="score-review-chip score-review-chip--free">TỰ DO</span>' : `<span class="score-review-chip score-review-chip--pct">${pct}%</span>`}
      </div>
      <div class="score-review-progress${noTarget ? ' is-free' : ''}" style="--score-review-fill:${escapeAttr(reviewFill)};--score-review-idle:${escapeAttr(reviewIdle)};--score-review-edge:${escapeAttr(reviewEdge)}"><i class="${score > 0 ? 'has-fill' : ''}" style="width:${pct}%"></i><span class="score-review-sheen" style="width:${pct}%"></span><b>⚑</b>${scRunner}</div>
      <div class="score-review-head">
        <div class="score-review-creator">
          ${st.creatorAvatar ? `<img class="js-avatar" src="${escapeAttr(st.creatorAvatar)}" />` : '<span>HP</span>'}
          <strong>${escapeHtml(st.creatorName || 'Creator')}</strong>
        </div>
        ${over > 0 ? `<div class="score-review-over" style="--sc-over:${escapeAttr(st.overColor || '#ffffff')}"><small>+ DƯ</small><b>${formatNumber(over)}</b></div>` : ''}
        <div class="score-review-score" style="font-size:${scoreFont}px"><small>ĐIỂM</small><b>${formatNumber(score)}</b>${noTarget ? '' : `<span>/ ${formatNumber(target)}</span>`}</div>
      </div>
    </div>
  `;
  }
  // CUỐI TRANG: danh sách quà/user (ít dùng) — render riêng ra khối dưới cùng.
  const listsEl = $('#scReviewLists');
  if (listsEl) listsEl.innerHTML = `
    <div class="score-review-columns">
      <section>
        <div class="score-review-section-head"><b>Quà vừa tính điểm</b><span>mới nhất ở trên</span></div>
        <div class="score-review-list">
          ${visibleRecent.length ? visibleRecent.map(g => `<div class="score-review-gift">${g.giftIcon ? `<img src="${escapeAttr(g.giftIcon)}" />` : '<em>🎁</em>'}<div><b>${escapeHtml(g.user)}</b><span>${escapeHtml(g.giftName)} x${formatCompact(g.repeat)} · +${formatNumber(g.points)}</span></div></div>`).join('') : '<div class="score-review-empty">Chưa có quà nào được tính điểm trong phiên này.</div>'}
        </div>
      </section>
      <section>
        <div class="score-review-section-head"><b>Tổng điểm theo user</b><span>cao nhất ở trên</span></div>
        <div class="score-review-total">Tổng số người tặng: ${formatNumber(topUsers.length)}</div>
        <div class="score-review-list">
          ${visibleTopUsers.length ? visibleTopUsers.map((u, i) => `<div class="score-review-user"><b>${i + 1}</b>${u.avatar ? `<img src="${escapeAttr(u.avatar)}" />` : '<em>👤</em>'}<span><strong>${escapeHtml(u.nickname || u.user || '?')}</strong><small>@${escapeHtml(u.user || '?')}</small></span><mark>${formatNumber(u.points)}</mark></div>`).join('') : '<div class="score-review-empty">Chưa có user nào tặng điểm trong vòng đấu.</div>'}
        </div>
      </section>
    </div>
  `;
  wireScoreReviewListDrag();
}

function wireScoreReviewListDrag() {
  $$('#scReviewLists .score-review-list, #scPreview .score-review-list').forEach(list => {
    let dragging = false;
    let startY = 0;
    let startTop = 0;
    list.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startTop = list.scrollTop;
      list.classList.add('dragging');
      list.setPointerCapture?.(e.pointerId);
    });
    list.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      list.scrollTop = startTop - (e.clientY - startY);
    });
    const stop = (e) => {
      dragging = false;
      list.classList.remove('dragging');
      if (e?.pointerId != null) list.releasePointerCapture?.(e.pointerId);
    };
    list.addEventListener('pointerup', stop);
    list.addEventListener('pointercancel', stop);
    list.addEventListener('pointerleave', stop);
  });
}

// ============================================================
// Overlays page
// ============================================================
async function refreshOverlayUrls() {
  const [pk, pkfx, kc, pkg, rk, rkGrid, sc, sticker, lw, mvp, mtrio, card, cardFx, interact, giftMenu, dance1, dance2, dance3, scBar, scCard, scTimer] = await Promise.all([
    window.api.pkduo.getUrl(), window.api.pkduo.getFxUrl(), window.api.kcduo.getUrl(), window.api.pkgroup.getUrl(), window.api.ranking.getUrl(), window.api.ranking.getGridUrl(), window.api.score.getUrl(), window.api.stickerdance.getUrl(), window.api.luckywheel.getUrl(), window.api.mvphonor.getUrl(), window.api.missiontrio.getUrl(), window.api.cardflip.getUrl(), window.api.cardflip.getFxUrl(), window.api.interact.getUrl(),
    window.api.giftmenu.getUrl(), window.api.dancevideo.getUrl('webm1'), window.api.dancevideo.getUrl('webm2'), window.api.dancevideo.getUrl('webm3'),
    window.api.score.getBarUrl(), window.api.score.getCardUrl(), window.api.score.getTimerUrl(),
  ]);
  const urls = { urlPk: pk, urlPkFx: pkfx, urlKc: kc, urlPkg: pkg, urlRk: rk, urlRkGrid: rkGrid, urlSc: sc, urlSticker: sticker, urlLw: lw, urlMvp: mvp, urlMtrio: mtrio, urlCard: card, urlCardFx: cardFx, urlInteract: interact, urlGiftMenu: giftMenu, urlDance1: dance1, urlDance2: dance2, urlDance3: dance3, urlScBar: scBar, urlScCard: scCard, urlScTimer: scTimer };
  $$('[data-copy]').forEach(button => { button.dataset.url = urls[button.dataset.copy]; });
  await refreshReviewButtons();
}

async function refreshReviewButtons() {
  const state = await window.api.review.getState().catch(() => ({}));
  $$('[data-review-toggle]').forEach(btn => {
    const type = btn.dataset.reviewToggle;
    const open = !!state[type]?.open;
    btn.classList.toggle('is-on', open);
    btn.textContent = open ? 'Đóng Review' : '🖥 Review';
  });
  $$('[data-review-top]').forEach(btn => {
    const type = btn.dataset.reviewTop;
    const on = state[type]?.alwaysOnTop !== false;
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '📌 BỎ GHIM' : '📍 GHIM';
  });
  $$('[data-review-click]').forEach(btn => {
    const type = btn.dataset.reviewClick;
    const on = !!state[type]?.clickThrough;
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '🖱 Đang xuyên' : '🖱 Xuyên';
  });
  $$('[data-review-bg]').forEach(input => {
    const type = input.dataset.reviewBg;
    const bg = state[type]?.background || 'transparent';
    input.value = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#000000';
    input.classList.toggle('is-transparent', bg === 'transparent');
  });
  $$('[data-review-alpha]').forEach(input => {
    const type = input.dataset.reviewAlpha;
    input.value = Math.round((Number(state[type]?.backgroundAlpha) || 0) * 100);
    input.disabled = (state[type]?.background || 'transparent') === 'transparent';
  });
  $$('[data-review-bg-clear]').forEach(btn => {
    const type = btn.dataset.reviewBgClear;
    btn.classList.toggle('is-on', (state[type]?.background || 'transparent') === 'transparent');
  });
}

function wireOverlaysTab() {
  if (!reviewStateTimer) reviewStateTimer = setInterval(refreshReviewButtons, 1000);

  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const v = b.dataset.url;
    await window.api.shell.copyText(v);
    toast('📋 Đã copy', 'success');
  }));

  // Công tắc chế độ link dùng chung: OBS (127.0.0.1) ↔ TikTok Studio (hpstudio.obs). Áp cho MỌI nút copy.
  const linkModeToggle = $('#ovlTikTokLinks');
  // Banner trạng thái dòng hosts: chỉ hiện cảnh báo khi ĐANG bật TikTok mà thiếu hosts.
  function applyHostsStatus(st) {
    const banner = $('#ovlHostsBanner'), ok = $('#ovlHostsOk');
    if (!banner || !ok) return;
    const needed = !!st?.needed;               // bật TikTok + thiếu hosts → cần sửa
    const present = !!st?.present;
    banner.hidden = !needed;
    ok.hidden = !(present && !!linkModeToggle?.checked); // đang dùng TikTok và đã có hosts → báo sẵn sàng
  }
  function refreshHostsBanner() { window.api.hosts?.status().then(applyHostsStatus).catch(() => {}); }
  if (linkModeToggle) {
    window.api.overlay?.getLinkMode().then(on => { linkModeToggle.checked = !!on; refreshHostsBanner(); }).catch(() => {});
    linkModeToggle.addEventListener('change', async () => {
      const on = linkModeToggle.checked;
      await window.api.overlay?.setLinkMode(on).catch(() => {});
      await refreshOverlayUrls(); // cập nhật lại dataset các nút data-copy (nút trong từng tab tự lấy link mới khi bấm)
      refreshHostsBanner();
      toast(on ? '🔗 Link chuyển sang TikTok Studio (hpstudio.obs)' : '🔗 Link về OBS (127.0.0.1)', 'success');
    });
  }
  // Nút "Sửa nhanh": tự nâng quyền (UAC) ghi dòng hosts, rồi cập nhật banner.
  $('#ovlHostsFix')?.addEventListener('click', async () => {
    toast('Đang xin quyền để ghi hosts… (bấm "Yes" ở cửa sổ UAC)', 'info');
    const r = await window.api.hosts?.fix().catch(() => null);
    if (r?.present) toast('✅ Đã cài dòng hosts — link TikTok Studio sẵn sàng', 'success');
    else toast('Chưa ghi được hosts (bị từ chối quyền admin?). Thử lại hoặc thêm tay.', 'error');
    refreshHostsBanner();
  });
  // Main tự cài hosts lúc khởi động → nhận trạng thái để cập nhật banner mà không cần hỏi lại.
  window.api.on?.('hosts:status', applyHostsStatus);

  $$('[data-review-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.dataset.reviewToggle;
    const state = await window.api.review.getState().catch(() => ({}));
    const r = state[type]?.open ? await window.api.review.close(type) : await window.api.review.open(type);
    if (!r?.ok) { toast(r?.error || 'Không thao tác được Overlay Review', 'error'); return; }
    await refreshReviewButtons();
    toast(state[type]?.open ? 'Đã đóng Overlay Review' : 'Đã mở Overlay Review', 'success');
  }));

  $$('[data-review-top]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.dataset.reviewTop;
    const state = await window.api.review.getState().catch(() => ({}));
    const next = state[type]?.alwaysOnTop === false;
    await window.api.review.setAlwaysOnTop(type, next);
    await refreshReviewButtons();
    toast(next ? 'Overlay Review luôn nổi' : 'Overlay Review không luôn nổi', 'success');
  }));

  $$('[data-review-click]').forEach(btn => btn.addEventListener('click', async () => {
    const type = btn.dataset.reviewClick;
    const state = await window.api.review.getState().catch(() => ({}));
    const next = !state[type]?.clickThrough;
    const r = await window.api.review.setClickThrough(type, next);
    if (!r?.ok) { toast(r?.error || 'Không bật được xuyên chuột', 'error'); return; }
    await refreshReviewButtons();
    toast(next ? 'Review cho chuột xuyên qua lớp dưới' : 'Review nhận chuột/kéo thả lại', 'success');
  }));

  $$('[data-review-bg]').forEach(input => input.addEventListener('input', async () => {
    const alpha = Number($(`[data-review-alpha="${input.dataset.reviewBg}"]`)?.value || 100) / 100;
    const r = await window.api.review.setBackground(input.dataset.reviewBg, input.value, alpha);
    if (!r?.ok) { toast(r?.error || 'Không đổi được màu nền Review', 'error'); return; }
    await refreshReviewButtons();
  }));

  $$('[data-review-alpha]').forEach(input => input.addEventListener('input', async () => {
    const color = $(`[data-review-bg="${input.dataset.reviewAlpha}"]`)?.value || '#000000';
    const r = await window.api.review.setBackground(input.dataset.reviewAlpha, color, Number(input.value) / 100);
    if (!r?.ok) { toast(r?.error || 'Không đổi được độ trong suốt Review', 'error'); return; }
    await refreshReviewButtons();
  }));

  $$('[data-review-bg-clear]').forEach(btn => btn.addEventListener('click', async () => {
    const r = await window.api.review.setBackground(btn.dataset.reviewBgClear, 'transparent', 0);
    if (!r?.ok) { toast(r?.error || 'Không đổi được màu nền Review', 'error'); return; }
    await refreshReviewButtons();
    toast('Review trở về nền trong suốt', 'success');
  }));

  wireInteractConfig();
}

// ---- Tuỳ chỉnh overlay TƯƠNG TÁC + QUÀ ----
let interactCfg = null;
function fillInteractUI(cfg) {
  if (!cfg) return;
  interactCfg = cfg;
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v; };
  const chk = (id, v) => { const el = $('#' + id); if (el) el.checked = v; };
  chk('ifShowGift', cfg.showGift !== false);
  chk('ifShowChat', cfg.showChat !== false);
  chk('ifShowAvatar', cfg.showAvatar !== false);
  chk('ifShowGiftName', cfg.showGiftName !== false);
  chk('ifShowRepeat', cfg.showRepeat !== false);
  chk('ifShowCoin', cfg.showCoin !== false);
  set('ifNewest', cfg.newest === 'bottom' ? 'bottom' : 'top');
  set('ifBgColor', cfg.bgColor || '#000000');
  set('ifBgOpacity', cfg.bgOpacity ?? 55);
  set('ifAvatar', cfg.avatarSize ?? 56);
  set('ifName', cfg.nameSize ?? 30);
  set('ifComment', cfg.commentSize ?? 34);
  set('ifGift', cfg.giftSize ?? 32);
  set('ifSplit', Math.round((Number(cfg.splitRatio) || 0.5) * 100));
  set('feedOpQuick', cfg.bgOpacity ?? 55);
  const feedOpVal = $('#feedOpQuickVal'); if (feedOpVal) feedOpVal.textContent = (cfg.bgOpacity ?? 55) + '%';
  $('#ifBgOpacityVal').textContent = (cfg.bgOpacity ?? 55) + '%';
  $('#ifAvatarVal').textContent = cfg.avatarSize ?? 56;
  $('#ifNameVal').textContent = cfg.nameSize ?? 30;
  $('#ifCommentVal').textContent = cfg.commentSize ?? 34;
  $('#ifGiftVal').textContent = cfg.giftSize ?? 32;
  $('#ifSplitVal').textContent = Math.round((Number(cfg.splitRatio) || 0.5) * 100) + '%';
}

async function wireInteractConfig() {
  try { fillInteractUI(await window.api.interact.getConfig()); } catch {}
  // Overlay tự báo khi kéo vạch chia (đổi splitRatio) → cập nhật thanh trượt cho khớp.
  window.api.on('interact:state', (cfg) => fillInteractUI(cfg));

  const saveFromUI = async () => {
    let showGift = $('#ifShowGift').checked;
    let showChat = $('#ifShowChat').checked;
    if (!showGift && !showChat) { showChat = true; $('#ifShowChat').checked = true; toast('Phải giữ ít nhất 1 cột (Tương tác hoặc Quà tặng)', 'error'); }
    const cfg = {
      showGift, showChat,
      showAvatar: $('#ifShowAvatar').checked,
      showGiftName: $('#ifShowGiftName').checked,
      showRepeat: $('#ifShowRepeat').checked,
      showCoin: $('#ifShowCoin').checked,
      newest: $('#ifNewest').value === 'bottom' ? 'bottom' : 'top',
      bgColor: $('#ifBgColor').value,
      bgOpacity: Number($('#ifBgOpacity').value),
      avatarSize: Number($('#ifAvatar').value),
      nameSize: Number($('#ifName').value),
      commentSize: Number($('#ifComment').value),
      giftSize: Number($('#ifGift').value),
      splitRatio: Number($('#ifSplit').value) / 100,
    };
    $('#ifBgOpacityVal').textContent = cfg.bgOpacity + '%';
    $('#ifAvatarVal').textContent = cfg.avatarSize;
    $('#ifNameVal').textContent = cfg.nameSize;
    $('#ifCommentVal').textContent = cfg.commentSize;
    $('#ifGiftVal').textContent = cfg.giftSize;
    $('#ifSplitVal').textContent = Math.round(cfg.splitRatio * 100) + '%';
    try { interactCfg = await window.api.interact.setConfig(cfg); } catch {}
  };
  ['ifShowGift', 'ifShowChat', 'ifShowAvatar', 'ifShowGiftName', 'ifShowRepeat', 'ifShowCoin',
    'ifNewest', 'ifBgColor', 'ifBgOpacity', 'ifAvatar', 'ifName', 'ifComment', 'ifGift', 'ifSplit']
    .forEach(id => { const el = $('#' + id); if (el) el.addEventListener('input', saveFromUI); });

  // Thanh trượt nhanh ở khung 💬 TƯƠNG TÁC: chỉ chỉnh độ mờ/trong suốt NỀN overlay (giữ nguyên màu chữ).
  // Đồng bộ 2 chiều với thanh trong CÀI ĐẶT; chỉ vá bgOpacity lên config hiện tại để không mất tuỳ chỉnh khác.
  const feedOpQuick = $('#feedOpQuick');
  if (feedOpQuick) feedOpQuick.addEventListener('input', async () => {
    const v = Math.max(0, Math.min(100, Number(feedOpQuick.value) || 0));
    const lbl = $('#feedOpQuickVal'); if (lbl) lbl.textContent = v + '%';
    const s = $('#ifBgOpacity'); if (s) s.value = v;
    const sv = $('#ifBgOpacityVal'); if (sv) sv.textContent = v + '%';
    const cfg = { ...(interactCfg || {}), bgOpacity: v };
    try { interactCfg = await window.api.interact.setConfig(cfg); } catch {}
  });
  // Bấm ra ngoài thì đóng popover 🌗 Nền
  document.addEventListener('click', (e) => {
    const d = $('.feed-op[open]'); if (d && !d.contains(e.target)) d.removeAttribute('open');
  });
}

// ============================================================
// Settings
// ============================================================
async function loadSettings() {
  const s = await window.api.settings.get();
  savedActiveGroupId = typeof s.lastActiveGroupId === 'string' ? s.lastActiveGroupId : null;
  savedLastUsername = normalizeId(s.lastUsername);
  talentShowUsername = normalizeId(s.talentShowUsername);
  // Chuyển dữ liệu bản cũ: ID toàn cục khớp nhóm nào thì nhóm đó sẽ được khôi phục lúc tự kết nối.
  // Nếu không khớp nhóm nào, đó là ID TALENT SHOW cũ.
  if (!talentShowUsername && (savedActiveGroupId === ''
    || (savedActiveGroupId == null && savedLastUsername && !groups.some(g => normalizeId(g.tiktokId) === savedLastUsername)))) {
    talentShowUsername = savedLastUsername;
  }
  defaultAutoConnectPref = !!s.autoConnect;
  syncLiveConnectionUi(activeGroupId);
  scoreLinkRanking = !!s.scoreLinkRanking;
  scoreLinkVoteLock = !!s.scoreLinkVoteLock;
  if (typeof applyGameLinksToUI === 'function') applyGameLinksToUI(); // đồng bộ mọi ô Liên kết (tiêu đề + bảng tổng)
  if ($('#rkLockVoteRunning')) $('#rkLockVoteRunning').checked = scoreLinkVoteLock;
  renderScoreBridge();
  // OBS WebSocket reset overlay
  const obs = s.obs || {};
  obsResetCfg.wsPort = Number(obs.wsPort) || 4455;
  obsResetCfg.overlayPort = Number(s.overlayPort) || obsResetCfg.overlayPort;
  // MẶC ĐỊNH TẮT tự động reset: chỉ reset khi user chủ động (Ctrl+R hoặc nút). Phải bật rõ ràng mới auto.
  obsResetCfg.autoReset = obs.autoReset === true;
  if ($('#obsWsPort')) $('#obsWsPort').value = obsResetCfg.wsPort;
  if ($('#obsAutoReset')) $('#obsAutoReset').checked = obsResetCfg.autoReset;
  if ($('#obsWsPass')) $('#obsWsPass').placeholder = obs.hasPassword ? '(đã lưu — để trống nếu giữ nguyên)' : '•••••';
  // Auto-contrast màu chữ overlay (điều khiển PK Nhóm) — nguồn dữ liệu ưu tiên là pkGroupCfg,
  // fallback về settings.overlay cũ để không mất cấu hình đã lưu trước đây.
  const ov = s.overlay || {};
  if ($('#ovlAutoTextContrast')) $('#ovlAutoTextContrast').checked = !!(pkGroupCfg?.autoTextContrast ?? ov.autoTextContrast);
  const audio = s.audio || {};
  if ($('#gameSoundEnabled')) $('#gameSoundEnabled').checked = audio.gameSoundEnabled !== false;
  await loadAudioOutputs(audio.outputDeviceId || 'default');
  $('#waitingSoundName').dataset.path = audio.waitingSound || '';
  $('#waitingSoundName').value = soundNameFromValue(audio.waitingSound || '');
  $('#waitingVolume').value = audio.waitingVolume ?? 100;
  $('#preEffectSoundName').dataset.path = audio.preEffectSound || '';
  $('#preEffectSoundName').value = soundNameFromValue(audio.preEffectSound || '');
  $('#preEffectVolume').value = audio.preEffectVolume ?? 100;
  if ($('#preEffectEnabled')) $('#preEffectEnabled').checked = !!audio.preEffectEnabled;
  if (audio.startSound) setSoundInput('scSndStart', audio.startSound);
  if (audio.warningSound) setSoundInput('scSndWarn', audio.warningSound);
  if (audio.goalSound) setSoundInput('scSndGoal', audio.goalSound);
  if (audio.successSound) setSoundInput('scSndSuccess', audio.successSound);
  if (audio.failSound) setSoundInput('scSndFail', audio.failSound);
}

async function refreshDataBackupHint() {
  const el = $('#dataBackupHint');
  if (!el) return;
  try {
    const c = await window.api.data.counts();
    el.innerHTML = `📦 Hiện có: <b>${c.creators}</b> Creator · <b>${c.groups}</b> Nhóm`;
  } catch { el.textContent = '📦 Không đọc được số lượng dữ liệu'; }
}

function wireDataBackup() {
  $('#btnExportData')?.addEventListener('click', async () => {
    // Ghi NGAY mọi chỉnh sửa đang chờ (slider/ô lưới vừa kéo) TRƯỚC khi xuất → file JSON không sót thông số mới nhất.
    try { await flushAllSaves(); } catch {}
    const res = await window.api.data.export();
    if (res?.ok) toast(`Đã xuất ${res.creators} Creator + ${res.groups} Nhóm + cấu hình chung`, 'success');
    else if (res?.reason && res.reason !== 'canceled') toast('Xuất dữ liệu thất bại', 'error');
  });
  $('#btnImportData')?.addEventListener('click', async () => {
    if (!confirm('Nhập dữ liệu từ file?\n• Creator/Nhóm trùng ID sẽ được cập nhật, dữ liệu mới sẽ được thêm (không xoá dữ liệu hiện có).\n• Cấu hình CHUNG (sticker, nhạc, menu quà, PK, vòng quay...) sẽ được GHI ĐÈ theo file nhập.')) return;
    const res = await window.api.data.import();
    if (res?.ok) {
      toast(`Nhập xong: +${res.creatorsAdded} / ↻${res.creatorsUpdated} Creator, +${res.groupsAdded} / ↻${res.groupsUpdated} Nhóm${res.configsRestored ? `, ${res.configsRestored} cấu hình chung — nên khởi động lại app để mọi bảng cập nhật đủ` : ''}`, 'success');
      creators = await window.api.creators.list();
      groups = await window.api.groups.list();
      await refreshGroupProfiles();
      renderCreators?.();
      renderGroups?.();
      renderPkGroupGroupSelect?.();
      refreshDataBackupHint();
    } else if (res?.reason === 'parse') toast('File không hợp lệ', 'error');
    else if (res?.reason === 'empty') toast('File không có dữ liệu Creator/Nhóm', 'error');
    else if (res?.reason && res.reason !== 'canceled') toast('Nhập dữ liệu thất bại', 'error');
  });
  refreshDataBackupHint();
}

function wireSettingsTab() {
  wireDataBackup();
  wireObsReset();
  $('#audioOutput').addEventListener('mousedown', () => loadAudioOutputs($('#audioOutput').value));
  $('#btnPickWaitingSound').addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) setSoundInput('waitingSoundName', filePathToUrl(file));
  });
  $('#btnPickPreEffectSound').addEventListener('click', async () => {
    const file = await window.api.shell.pickAudio();
    if (file) setSoundInput('preEffectSoundName', filePathToUrl(file));
  });
  // Nhạc chờ = nhạc nền của NHẠC DANCE: Play/Dừng điều khiển vòng lặp duckable (để clip quà tạm dừng được).
  $('#btnPlayWaitingSound')?.addEventListener('click', startBgMusic);
  $('#btnStopWaitingSound')?.addEventListener('click', stopBgMusic);
  $('#btnPlayPreEffectSound')?.addEventListener('click', () => playSettingsSound('preEffectSoundName', 'preEffectVolume'));
  $('#btnStopPreEffectSound')?.addEventListener('click', stopSettingsSound);
  $('#preEffectEnabled')?.addEventListener('change', () => window.api.settings.set({ audio: { preEffectEnabled: !!$('#preEffectEnabled').checked } }).catch(() => {}));
  $('#gameSoundEnabled')?.addEventListener('change', async () => {
    await window.api.settings.set({ audio: { gameSoundEnabled: gameplaySoundEnabled() } });
    scheduleScoreAutoSave();
    schedulePkAutoSave();
  });
  $('#btnSaveSettings').addEventListener('click', async () => {
    await window.api.settings.set({
      audio: {
        outputDeviceId: $('#audioOutput').value || 'default',
        gameSoundEnabled: gameplaySoundEnabled(),
        startSound: soundValue('scSndStart'),
        warningSound: soundValue('scSndWarn'),
        goalSound: soundValue('scSndGoal'),
        successSound: soundValue('scSndSuccess'),
        failSound: soundValue('scSndFail'),
        waitingSound: soundValue('waitingSoundName'),
        waitingVolume: Number($('#waitingVolume').value) || 0,
        preEffectSound: soundValue('preEffectSoundName'),
        preEffectVolume: Number($('#preEffectVolume').value) || 0,
        preEffectEnabled: !!$('#preEffectEnabled')?.checked,
      },
    });
    toast('💾 Đã lưu cài đặt âm thanh', 'success');
  });
}

// Cấu hình + nút reset overlay OBS qua WebSocket.
function wireObsReset() {
  const saveObs = async () => {
    const port = parseInt($('#obsWsPort')?.value, 10);
    if (port > 0 && port < 65536) obsResetCfg.wsPort = port;
    obsResetCfg.autoReset = !!$('#obsAutoReset')?.checked;
    const patch = { obs: { wsPort: obsResetCfg.wsPort, autoReset: obsResetCfg.autoReset } };
    const pw = $('#obsWsPass')?.value || '';
    if (pw) patch.obs.wsPassword = pw;
    await window.api.settings.set(patch);
    if ($('#obsWsPass')) { $('#obsWsPass').value = ''; if (pw) $('#obsWsPass').placeholder = '(đã lưu — để trống nếu giữ nguyên)'; }
  };
  $('#btnSaveObs')?.addEventListener('click', async () => {
    await saveObs();
    toast('💾 Đã lưu cấu hình OBS WebSocket', 'success');
  });
  $('#btnObsResetNow')?.addEventListener('click', async () => {
    await saveObs();       // lưu trước để dùng đúng port/mật khẩu vừa nhập
    await resetObsOverlays(true);
  });
}

// ============================================================
// Utils
// ============================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function formatNumber(n) {
  return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('vi-VN');
}
function parseNumberInput(value) {
  const clean = String(value ?? '').replace(/[.,\s]/g, '');
  return Math.max(0, Math.round(Number(clean) || 0));
}
function formatCompact(n) {
  return formatNumber(n);
}

// ============================================================
// LỊCH SỬ trận đấu — modal xem lại + xuất CSV (đối chiếu)
// ============================================================
let historyCurrentFilter = null; // null = tất cả | 'group' | 'duo'
function histPad(n) { return String(n).padStart(2, '0'); }
function histFmtDate(ms) { const d = new Date(Number(ms) || 0); return `${histPad(d.getDate())}/${histPad(d.getMonth() + 1)}/${d.getFullYear()}`; }
function histFmtTime(ms) { const d = new Date(Number(ms) || 0); return `${histPad(d.getHours())}:${histPad(d.getMinutes())}`; }

async function openHistory(filter) {
  historyCurrentFilter = filter || null;
  $('#histTitle').textContent = filter === 'group' ? '📜 Lịch sử PK Nhóm'
    : filter === 'duo' ? '📜 Lịch sử PK Đôi' : '📜 Lịch sử trận đấu';
  $('#historyModal').classList.add('is-open');
  await renderHistory();
}
function closeHistory() { $('#historyModal').classList.remove('is-open'); }

async function renderHistory() {
  const body = $('#histBody');
  if (!body) return;
  const list = await window.api.history.list(historyCurrentFilter ? { type: historyCurrentFilter } : undefined);
  $('#histCount').textContent = `${list.length} trận`;
  if (!list.length) {
    body.innerHTML = '<div class="hist-empty">Chưa có trận nào được lưu.<br/>Kết thúc một trận PK để tự động lưu vào đây.</div>';
    return;
  }
  body.innerHTML = list.map(m => {
    const typeClass = m.type === 'duo' ? 'duo' : 'group';
    const typeLabel = m.type === 'duo' ? 'PK Đôi' : 'PK Nhóm';
    const parts = (m.participants || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const items = parts.map((p, i) => {
      const isWin = m.type === 'duo'
        ? (m.winnerSide && m.winnerSide !== 'draw' && p.name === m.winnerName)
        : (p.name === m.winnerName && (p.score || 0) > 0);
      return `<span class="hist-item${isWin ? ' win' : ''}"><b>${i + 1}.</b><i class="d" style="background:${escapeAttr(p.color || '#888')}"></i>${escapeHtml(p.name || '—')} <em>${formatNumber(p.score || 0)}</em></span>`;
    }).join('<span class="sep">|</span>');
    const sub = [m.groupName, m.pointsBy === 'count' ? 'Số quà' : 'Coin'].filter(Boolean).join(' · ');
    const applied = m.applied && Array.isArray(m.applied.entries) ? m.applied.entries : null;
    let applyBar = '';
    if (applied) {
      const detail = applied.map(e => `${escapeHtml(e.name)}: +${formatNumber(e.delta)}`).join(' · ');
      applyBar = `<div class="hist-apply is-done">
        <span class="hist-applied" title="${escapeAttr(detail)}">✅ Đã cộng vào THI ĐẤU NHÓM (${applied.length} creator)</span>
        <button class="hist-undo" data-undo="${escapeAttr(m.id)}" type="button">↩ Hoàn tác</button>
      </div>`;
    } else if (m.liveLinked) {
      // Trận chơi khi đang BẬT Liên kết → điểm đã tính LIVE. KHÔNG hiện nút áp tay (tránh cộng đôi).
      applyBar = `<div class="hist-apply is-live">
        <span class="hist-live" title="Trận này chơi khi bật 🔗 Liên kết THI ĐẤU NHÓM nên điểm đã được cộng trực tiếp (LIVE). Không cần áp tay.">🔗 Đã cộng LIVE (Liên kết)</span>
      </div>`;
    } else {
      applyBar = `<div class="hist-apply">
        <button class="hist-apply-btn" data-apply="${escapeAttr(m.id)}" data-type="${typeClass}" type="button">➕ Áp điểm vào THI ĐẤU NHÓM</button>
      </div>`;
    }
    return `<div class="hist-card">
      <div class="hist-card-head">
        <span class="hist-badge ${typeClass}">${typeLabel}</span>
        <span class="hist-round">Vòng ${m.roundNo || 1}</span>
        <span class="hist-title">${escapeHtml(m.content || '')}</span>
        <span class="hist-meta">${histFmtDate(m.finishedAt)} ${histFmtTime(m.finishedAt)}</span>
        <button class="hist-del" data-id="${escapeAttr(m.id)}" title="Xóa trận này">✕</button>
      </div>
      ${sub ? `<div class="hist-sub">${escapeHtml(sub)}</div>` : ''}
      <div class="hist-line">${items}</div>
      ${applyBar}
    </div>`;
  }).join('');
  body.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const m = list.find(x => x.id === btn.dataset.id);
      if (m && m.applied && !confirm('Trận này đã cộng điểm vào THI ĐẤU NHÓM. Xoá sẽ TRỪ lại số điểm đó. Tiếp tục?')) return;
      await window.api.history.remove(btn.dataset.id); renderHistory(); updatePkTotalMatches();
    });
  });
  body.querySelectorAll('[data-undo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await window.api.history.unapply(btn.dataset.undo);
      if (res?.ok) { toast('Đã hoàn tác điểm khỏi THI ĐẤU NHÓM', 'success'); await refreshCreators(); }
      else toast('Không hoàn tác được', 'error');
      renderHistory();
    });
  });
  body.querySelectorAll('[data-apply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = list.find(x => x.id === btn.dataset.apply);
      if (!m) return;
      if (btn.dataset.type === 'duo') openApplyDuoMenu(btn, m);
      else applyMatchToRanking(m.id);
    });
  });
}

// PK Nhóm: khớp theo tiktokId, cộng thẳng. Báo rõ số Creator không khớp.
async function applyMatchToRanking(id, mapping) {
  const res = await window.api.history.apply(id, mapping);
  if (res?.ok) {
    const n = (res.applied || []).length;
    const miss = (res.unmatched || []).length;
    toast(`Đã cộng điểm cho ${n} creator${miss ? ` · ${miss} phe không khớp Creator` : ''}`, miss ? 'error' : 'success');
    await refreshCreators();
  } else if (res?.reason === 'no-match') {
    toast('Không có phe nào khớp Creator (kiểm tra tiktokId hoặc chọn tay ở PK Đôi)', 'error');
  } else if (res?.reason === 'already-applied') {
    toast('Trận này đã áp điểm rồi', 'error');
  } else if (res?.reason === 'live-linked') {
    // Trận đã cộng điểm LIVE (Liên kết) → không áp tay để khỏi cộng đôi (nút cũng đã bị ẩn).
    toast('Trận này đã cộng điểm LIVE qua Liên kết — không cần áp tay', 'error');
  } else {
    toast('Áp điểm thất bại', 'error');
  }
  renderHistory();
}

// PK Đôi: 2 phe chỉ có tên → cho chọn Creator cho từng phe rồi mới cộng.
function openApplyDuoMenu(anchor, match) {
  $('.hist-duo-menu')?.remove();
  const parts = Array.isArray(match.participants) ? match.participants : [];
  const opts = ['<option value="">— Bỏ qua phe này —</option>']
    .concat(visibleCreators().map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nickname || c.tiktokId)}</option>`))
    .join('');
  const menu = document.createElement('div');
  menu.className = 'hist-duo-menu';
  menu.innerHTML = `
    <div class="hist-duo-title">Chọn Creator nhận điểm</div>
    ${parts.map((p, i) => `
      <label class="hist-duo-row">
        <span class="hist-duo-side"><i class="d" style="background:${escapeAttr(p.color || '#888')}"></i>${escapeHtml(p.name || 'Phe ' + (i + 1))} <em>+${formatNumber(p.score || 0)}</em></span>
        <select data-side="${i}">${opts}</select>
      </label>`).join('')}
    <div class="hist-duo-actions">
      <button data-duo-cancel type="button">Huỷ</button>
      <button data-duo-ok type="button" class="primary">Cộng điểm</button>
    </div>`;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12)}px`;
  const close = () => { document.removeEventListener('mousedown', onOutside); menu.remove(); };
  const onOutside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  menu.querySelector('[data-duo-cancel]').addEventListener('click', close);
  menu.querySelector('[data-duo-ok]').addEventListener('click', async () => {
    const mapping = {};
    menu.querySelectorAll('select[data-side]').forEach(sel => { if (sel.value) mapping[sel.dataset.side] = sel.value; });
    if (!Object.keys(mapping).length) { toast('Chưa chọn Creator nào', 'error'); return; }
    close();
    await applyMatchToRanking(match.id, mapping);
  });
}

function wireHistoryUI() {
  $('#pkgHistory')?.addEventListener('click', () => openHistory('group'));
  $('#pkHistory')?.addEventListener('click', () => openHistory('duo'));
  $('#histClose')?.addEventListener('click', closeHistory);
  $('#historyModal')?.addEventListener('click', (e) => { if (e.target === $('#historyModal')) closeHistory(); });
  $('#histExport')?.addEventListener('click', async () => {
    const res = await window.api.history.export(historyCurrentFilter ? { type: historyCurrentFilter } : undefined);
    if (res?.ok) toast(`Đã xuất ${res.count} trận ra file CSV`, 'success');
    else if (res?.reason === 'empty') toast('Chưa có trận nào để xuất', 'error');
    else if (res?.reason && res.reason !== 'canceled') toast('Xuất file thất bại', 'error');
  });
  $('#histClear')?.addEventListener('click', async () => {
    const label = historyCurrentFilter === 'group' ? 'PK Nhóm' : historyCurrentFilter === 'duo' ? 'PK Đôi' : 'tất cả';
    if (!confirm(`Xóa toàn bộ lịch sử ${label}? Không thể hoàn tác.`)) return;
    await window.api.history.clear(historyCurrentFilter ? { type: historyCurrentFilter } : undefined);
    renderHistory();
  });
  window.api.on('history:changed', () => { if ($('#historyModal')?.classList.contains('is-open')) renderHistory(); updatePkTotalMatches(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#historyModal')?.classList.contains('is-open')) closeHistory(); });
}

init().catch(e => { console.error(e); hideBootSplash(); toast('Lỗi init: ' + e.message, 'error'); });
// Chốt an toàn: dù init treo/lỗi, không bao giờ kẹt ở màn hình tải quá 10s.
setTimeout(hideBootSplash, 10000);
