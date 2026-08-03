// ============================================================
// overlay-skin.js — HỆ SKIN MÙA LỄ DÙNG CHUNG cho các overlay (PK Đôi, THI ĐẤU NHÓM, Đường đua…).
// CHỈ trang trí (khung/hạt/màu/marker). KHÔNG đụng logic điểm/độ rộng/thứ hạng.
// Expose qua window.OverlaySkin. Dùng cho cả overlay lẫn app (nhãn "auto → …").
//
// Vì các overlay này dựng lại root.innerHTML mỗi render (không mount bền), lớp hạt được gắn ở
// <body> (tạo MỘT LẦN, không bị render xoá → animation chạy liên tục, không búng), và cờ data-skin
// đặt trên <body> để CSS `body[data-skin] .fx-*` (hạt) và `body[data-skin] .<thanh>` (khung) cùng khớp.
// ============================================================
(function () {
  const SKIN_VALUES = ['none', 'noel', 'halloween', 'newyear', 'tet', 'valentine', 'trungthu', 'birthday'];
  // Bảng ngày ÂM LỊCH quy về DƯƠNG (đủ dùng vài năm; hết bảng thì auto bỏ qua — vẫn chọn tay được).
  const LUNAR = {
    tet:      { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03' }, // Mồng 1 Tết
    trungthu: { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12' }, // Rằm 15/8
  };
  const AUTO_LABEL = {
    none: '(không có dịp)', noel: '🎄 Noel', halloween: '🎃 Halloween', newyear: '🎆 Năm mới',
    tet: '🧧 Tết', valentine: '💗 Valentine', trungthu: '🌕 Trung thu', birthday: '🎂 Sinh nhật',
  };
  const SKIN_EMOJI = { noel: '🎄', halloween: '🎃', newyear: '🎆', tet: '🧧', valentine: '💗', trungthu: '🌕', birthday: '🎂', none: '' };

  // ---- LỊCH SỰ KIỆN (VN + quốc tế) → map vào 7 skin sẵn có ----
  // tier 'season' = phủ CẢ THÁNG (auto từ đầu tháng, vd Noel); tier 'event' = cửa sổ ~1 tuần
  // (lead ngày trước + tail ngày sau) → tự đè lên mùa khi tới gần. Nhiều dịp cùng active:
  // event thắng season; cùng bậc → cái bắt đầu MUỘN hơn (gần cao trào) thắng.
  // Ngày: md=[tháng,ngày] dương | lunar='tet'/'trungthu' (theo bảng LUNAR) | range=[[m,d],[m,d]] (mùa, cho phép vắt qua năm).
  const CALENDAR = [
    { skin: 'newyear',   name: 'Tết Dương lịch',        tier: 'event',  range: [[12, 27], [1, 3]] },
    { skin: 'tet',       name: 'Tết Nguyên Đán',        tier: 'event',  lunar: 'tet',      lead: 10, tail: 8 },
    { skin: 'valentine', name: 'Lễ Tình nhân 14/2',     tier: 'event',  md: [2, 14],       lead: 7,  tail: 1 },
    { skin: 'valentine', name: 'Quốc tế Phụ nữ 8/3',    tier: 'event',  md: [3, 8],        lead: 6,  tail: 1 },
    { skin: 'birthday',  name: 'Quốc tế Thiếu nhi 1/6', tier: 'event',  md: [6, 1],        lead: 6,  tail: 1 },
    { skin: 'trungthu',  name: 'Tết Trung Thu',         tier: 'event',  lunar: 'trungthu', lead: 8,  tail: 3 },
    { skin: 'valentine', name: 'Phụ nữ Việt Nam 20/10', tier: 'event',  md: [10, 20],      lead: 6,  tail: 1 },
    { skin: 'halloween', name: 'Halloween 31/10',       tier: 'event',  md: [10, 31],      lead: 9,  tail: 1 },
    { skin: 'noel',      name: 'Giáng Sinh (Noel)',     tier: 'season', range: [[12, 1], [12, 26]] },
  ];
  const _tw = (t) => (t === 'event' ? 2 : 1);
  const _addDays = (dt, n) => { const d = new Date(dt.getTime()); d.setDate(d.getDate() + n); return d; };
  // Quy 1 mục lịch về {start,end,peak} DƯƠNG cho năm yy (null nếu thiếu dữ liệu, vd hết bảng âm lịch).
  function _range(ev, yy) {
    if (ev.lunar) {
      const mmdd = LUNAR[ev.lunar] && LUNAR[ev.lunar][yy];
      if (!mmdd) return null;
      const [m, d] = mmdd.split('-').map(Number);
      const peak = new Date(yy, m - 1, d);
      return { start: _addDays(peak, -(ev.lead || 7)), end: _addDays(_addDays(peak, ev.tail || 1), 1), peak };
    }
    if (ev.md) {
      const peak = new Date(yy, ev.md[0] - 1, ev.md[1]);
      return { start: _addDays(peak, -(ev.lead || 7)), end: _addDays(_addDays(peak, ev.tail || 1), 1), peak };
    }
    if (ev.range) {
      const [[m1, d1], [m2, d2]] = ev.range;
      const start = new Date(yy, m1 - 1, d1);
      let end = new Date(yy, m2 - 1, d2);
      if (end < start) end = new Date(yy + 1, m2 - 1, d2); // mùa vắt qua năm (vd 27/12 → 3/1)
      return { start, end: _addDays(end, 1), peak: start };
    }
    return null;
  }
  // Các dịp đang "active" tại thời điểm now (xét cả năm trước để bắt mùa vắt qua năm).
  function _activeEvents(now) {
    const y = now.getFullYear(), out = [];
    for (const ev of CALENDAR) {
      for (const yy of [y - 1, y]) {
        const r = _range(ev, yy);
        if (r && now >= r.start && now < r.end) { out.push({ ev, r }); break; }
      }
    }
    return out;
  }
  function autoSkinByDate(now = new Date()) {
    const active = _activeEvents(now);
    if (!active.length) return 'none';
    active.sort((a, b) => (_tw(b.ev.tier) - _tw(a.ev.tier)) || (b.r.start - a.r.start));
    return active[0].ev.skin;
  }
  // Danh sách dịp có RANGE giao với tháng hiện tại (để "báo tháng này có gì"), sắp theo ngày cao trào.
  function monthEvents(now = new Date()) {
    const y = now.getFullYear(), m = now.getMonth();
    const mStart = new Date(y, m, 1), mEnd = new Date(y, m + 1, 1);
    const seen = new Set(), list = [];
    for (const ev of CALENDAR) {
      for (const yy of [y - 1, y, y + 1]) {
        const r = _range(ev, yy);
        if (r && r.end > mStart && r.start < mEnd) {
          if (seen.has(ev.name)) break;
          seen.add(ev.name);
          list.push({ name: ev.name, skin: ev.skin, peak: r.peak, tier: ev.tier });
          break;
        }
      }
    }
    list.sort((a, b) => a.peak - b.peak);
    return list;
  }
  function resolveSkin(skin) {
    const s = String(skin || 'auto').toLowerCase();
    if (s === 'auto') return autoSkinByDate();
    return SKIN_VALUES.includes(s) ? s : 'none';
  }
  // Nhãn cho app: 'auto' → tóm tắt CẢ THÁNG + dịp đang áp; chọn tay → tên dịp.
  function autoLabel(skinRaw, now = new Date()) {
    const s = String(skinRaw || 'auto').toLowerCase();
    if (s !== 'auto') return AUTO_LABEL[resolveSkin(s)] || '';
    const cur = autoSkinByDate(now);
    const evs = monthEvents(now);
    const parts = evs.map(e => `${SKIN_EMOJI[e.skin] || ''}${e.name.replace(/\s*\d+\/\d+$/, '')} ${e.peak.getDate()}/${e.peak.getMonth() + 1}`);
    const head = `Tháng ${now.getMonth() + 1}: ` + (parts.length ? parts.join(' · ') : 'chưa có dịp nổi bật');
    return head + ' — đang: ' + (AUTO_LABEL[cur] || AUTO_LABEL.none);
  }

  // Markup hạt/khung cho từng skin — vẽ vào lớp .ovl-skin-fx (ở <body>). Vị trí/độ trễ/tốc độ
  // biến thiên bằng :nth-child trong CSS nên JS chỉ lặp phần tử. Chỉ tạo lại khi ĐỔI skin.
  function skinFxHtml(skin) {
    const rep = (cls, n) => Array.from({ length: n }, () => `<span class="${cls}"></span>`).join('');
    const garland = '<span class="fx-garland">' + Array.from({ length: 12 }, () => '<i></i>').join('') + '</span>';
    switch (skin) {
      case 'tet':
        return '<span class="fx-lantern l1"></span><span class="fx-lantern l2"></span>' + rep('fx-petal', 14) + rep('fx-spark', 8);
      case 'noel':
        return '<span class="fx-tree"></span><span class="fx-santa"></span>' + garland + rep('fx-snow', 18);
      case 'halloween':
        return '<span class="fx-moon2"></span>' + rep('fx-bat', 6) + rep('fx-ghost', 4);
      case 'newyear':
        return rep('fx-firework', 5) + rep('fx-spark', 10) + rep('fx-confetti', 10);
      case 'valentine':
        return rep('fx-heart', 16);
      case 'trungthu':
        return '<span class="fx-moon"></span><span class="fx-lantern l1"></span><span class="fx-lantern l2"></span>' + rep('fx-firefly', 12);
      case 'birthday':
        return rep('fx-confetti', 16) + rep('fx-balloon', 6);
      default:
        return '';
    }
  }

  // Áp skin lên trang overlay: đặt data-skin trên <body> + đảm bảo có lớp hạt bền ở <body>.
  // Gọi mỗi render là an toàn (rẻ): chỉ dựng lại hạt khi ĐỔI skin.
  function applySkin(skinRaw) {
    const resolved = resolveSkin(skinRaw);
    const body = document.body;
    if (!body) return resolved;
    const want = (resolved && resolved !== 'none') ? resolved : '';
    if ((body.dataset.skin || '') !== want) { if (want) body.dataset.skin = want; else delete body.dataset.skin; }
    let fx = document.getElementById('ovlSkinFx');
    if (!fx) {
      fx = document.createElement('div');
      fx.id = 'ovlSkinFx'; fx.className = 'ovl-skin-fx'; fx.setAttribute('aria-hidden', 'true');
      body.appendChild(fx); // ở <body>, KHÔNG nằm trong root bị dựng lại → hạt chạy liên tục
    }
    if (fx._skin !== resolved) { fx._skin = resolved; fx.innerHTML = want ? skinFxHtml(resolved) : ''; }
    return resolved;
  }

  window.OverlaySkin = { SKIN_VALUES, LUNAR, CALENDAR, autoSkinByDate, monthEvents, resolveSkin, autoLabel, skinFxHtml, applySkin };
})();
