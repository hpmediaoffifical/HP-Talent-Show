// Vạch chia dọc bằng ẢNH cho overlay FX (PK Đôi FX + PK Nhóm FX).
// Ảnh gốc 120x2000 (RGBA) nằm ở renderer/fx-assets, phục vụ qua /fx-assets/<file>.
// Dùng chung để 2 overlay luôn có CÙNG danh sách kiểu và cùng cách chọn ngẫu nhiên.
//
// Vì sao là <i> nền ảnh chứ không phải <img>: vạch phải kéo giãn đúng chiều cao sân khấu và
// đè lên vạch CSS sẵn có; background-size 100% 100% làm việc đó gọn nhất và không thêm node ảnh
// có thể bị OBS bôi đen như các lớp vừa animate vừa filter.
(function (global) {
  // id → tên file trong /fx-assets. Giữ id ngắn để lưu vào config gọn.
  const FILES = {
    black: 'divider-black.png',
    chinese: 'divider-chinese.png',
    ink: 'divider-ink.png',
    lava: 'divider-lava.png',
    princess: 'divider-princess.png',
    'bolt-cyan': 'divider-bolt-cyan.png',
    'bolt-orange': 'divider-bolt-orange.png',
    'bolt-purple': 'divider-bolt-purple.png',
  };
  const IDS = Object.keys(FILES);

  // Bề rộng hiển thị (px, theo hệ toạ độ sân khấu 1080 của overlay) — ảnh gốc rộng 120px nhưng
  // phần lớn là quầng sáng trong suốt, nên vẽ rộng hơn nét vạch thật khá nhiều.
  const WIDTH = {
    black: 44, chinese: 60, ink: 64, lava: 96, princess: 72,
    'bolt-cyan': 132, 'bolt-orange': 132, 'bolt-purple': 132,
  };

  // 'none' → không dùng ảnh (giữ vạch CSS cũ). 'auto' → đổi theo vòng/trận (seed).
  function resolve(style, seed) {
    const s = String(style || 'none');
    if (FILES[s]) return s;
    if (s !== 'auto') return '';
    const n = Number(seed) || 0;
    return IDS[((n % IDS.length) + IDS.length) % IDS.length];
  }

  function url(id) { return FILES[id] ? '/fx-assets/' + FILES[id] : ''; }

  // Gắn/gỡ vạch ảnh lên một phần tử vạch có sẵn (.pkfx-seam / .pkgfx-seam).
  // scale: hệ số bề rộng (PK Nhóm chia nhiều cột nên vạch phải mảnh hơn).
  function apply(seamEl, id, scale) {
    if (!seamEl) return;
    const u = url(id);
    seamEl.classList.toggle('has-seam-img', !!u);
    if (!u) { seamEl.style.removeProperty('--seam-img'); seamEl.style.removeProperty('--seam-img-w'); return; }
    seamEl.style.setProperty('--seam-img', `url("${u}")`);
    seamEl.style.setProperty('--seam-img-w', Math.round((WIDTH[id] || 64) * (Number(scale) || 1)) + 'px');
  }

  global.OverlayDivider = { IDS, FILES, resolve, url, apply };
})(window);
