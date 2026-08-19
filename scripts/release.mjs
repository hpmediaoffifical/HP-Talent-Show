// Phát hành 1 lệnh: kiểm tra -> build (nếu thiếu) -> push -> tạo GitHub release.
// Dùng: npm run release
//
// Vì sao có file này: bước `gh release create` bị chốt an toàn của Claude Code chặn, trợ lý không
// tự chạy được. Gom cả chuỗi vào đây để người dùng chỉ phải gõ đúng 1 lệnh thay vì dán lệnh dài.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const VER = pkg.version;
const TAG = `v${VER}`;
const EXE = resolve(ROOT, `release/HP-GROUP-LIVE-Setup-${VER}.exe`);
const MAP = `${EXE}.blockmap`;
const YML = resolve(ROOT, 'release/latest.yml');
const NOTES = resolve(ROOT, `release/NOTES-${VER}.md`);

const say = (m) => console.log(m);
const die = (m) => { console.error(`\n❌ ${m}\n`); process.exit(1); };
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

say(`\n📦 Phát hành ${TAG}\n`);

// 1) Ghi chú phát hành — bắt buộc, viết trước để release có nội dung tử tế.
if (!existsSync(NOTES)) die(`Thiếu ghi chú phát hành: release/NOTES-${VER}.md`);

// 2) Tag đã tồn tại thì dừng — tránh lỡ tay đè lên bản đã phát hành.
try {
  execFileSync('gh', ['release', 'view', TAG], { cwd: ROOT, stdio: 'ignore' });
  die(`Release ${TAG} ĐÃ có trên GitHub. Bump version trong package.json rồi chạy lại.`);
} catch { /* chưa có -> đúng như mong đợi */ }

// 3) Cây làm việc phải sạch phần mã nguồn (config/*.json app tự ghi lúc chạy thì bỏ qua).
const dirty = sh('git status --porcelain')
  .split('\n').filter(Boolean)
  .filter((l) => !/^.. config\//.test(l) && !/^.. release\//.test(l));
if (dirty.length) die(`Còn thay đổi chưa commit:\n   ${dirty.join('\n   ')}`);

// 4) Build nếu chưa có file cài của đúng version này.
if (!existsSync(EXE)) {
  say('🔨 Chưa có file cài, đang build (vài phút)...');
  execSync('npm run dist', { cwd: ROOT, stdio: 'inherit' });
}
for (const f of [EXE, MAP, YML]) if (!existsSync(f)) die(`Thiếu file: ${f}`);
if (!readFileSync(YML, 'utf8').includes(`version: ${VER}`)) {
  die(`release/latest.yml không phải của ${VER} — chạy "npm run dist" lại.`);
}

// 5) Đẩy nhánh hiện tại lên GitHub.
const branch = sh('git rev-parse --abbrev-ref HEAD');
say(`⬆️  Push nhánh ${branch}...`);
execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: 'inherit' });

// 6) Tạo release. Tiêu đề lấy từ dòng đầu của commit mới nhất.
const title = sh('git log -1 --pretty=%s');
say(`🚀 Tạo release ${TAG} (upload ~320MB, mất vài phút)...`);
execFileSync('gh', [
  'release', 'create', TAG, EXE, MAP, YML,
  '--target', branch,
  '--title', title,
  '--notes-file', NOTES,
], { cwd: ROOT, stdio: 'inherit' });

say(`\n✅ Xong. Máy khác mở app sẽ thấy bản ${TAG}.\n`);
