import { JSDOM } from 'jsdom';
import fs from 'fs';

// 実際に配信される index.html をそのまま読み込んで検証する
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// 「今日」を固定して起動する
function boot(seed, nowISO) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    pretendToBeVisual: true,
    beforeParse(w) {
      // 2026-08-21 12:00 ローカル を「今日」にする
      const fixed = new Date(nowISO + 'T12:00:00').getTime();
      const RealDate = w.Date;
      w.Date = class extends RealDate {
        constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
        static now() { return fixed; }
      };
      if (seed) w.localStorage.setItem('ember.v1', JSON.stringify(seed));
    }
  });
  const w = dom.window;
  return {
    w,
    state: () => JSON.parse(w.localStorage.getItem('ember.v1')),
    text: id => w.document.getElementById(id).textContent,
    html: id => w.document.getElementById(id).innerHTML,
  };
}

const TASKS = [{ id: 't1', name: 'スクワット10回', order: 0, archived: false, createdAt: '2026-01-01' }];
function base(over) {
  return Object.assign({
    version: 2, settings: { dayBoundaryHour: 4 }, tasks: TASKS,
    logs: {}, meta: { lastBackupAt: null }
  }, over);
}
// from〜to（両端含む）の毎日に ids を記録した logs
function span(from, to, ids = ['t1']) {
  const logs = {};
  const d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    logs[k] = ids.slice();
  }
  return logs;
}
function without(logs, ...dates) { for (const d of dates) delete logs[d]; return logs; }
const TWO = [
  { id: 't1', name: 'スクワット', order: 0, archived: false, createdAt: '2026-01-01' },
  { id: 't2', name: '懸垂', order: 1, archived: false, createdAt: '2026-01-01' }
];
// 設定画面の集計値（描画は毎回走るので、ホームにいたままでも読める）
function stats(a) { return { days: a.text('s-days'), sh: a.text('s-sh'), best: a.text('s-best'), used: a.text('s-used') }; }
// カレンダーの週の結果列。行の上から順に 'earn' / 'protect' / 'reset' / ''
function marks(a) { return [...a.w.document.querySelectorAll('#grid .wk')].map(e => e.classList[1] || ''); }
// 達成時のホームの「今週」欄
function outlook(a) { const s = a.w.document.querySelectorAll('#hero .stat b'); return s.length ? s[2].textContent : null; }
// カレンダーのマスの日付。消化数バッジを持つマスもあるので、先頭のテキストだけを見る
function day(cell) { return cell.childNodes[0] ? cell.childNodes[0].textContent : ''; }
// マスに出ている消化数バッジ（なければ null）
function badge(cell) { const b = cell.querySelector('.count'); return b ? b.textContent : null; }

function daysBack(endISO, n) { // endISO を含む n 日分の logs
  const logs = {};
  const d = new Date(endISO + 'T12:00:00');
  for (let i = 0; i < n; i++) {
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    logs[k] = ['t1'];
    d.setDate(d.getDate() - 1);
  }
  return logs;
}

console.log('\n― 連続日数の計算 ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 5) }), '2026-08-21');
  ok('今日を含む5日連続 → 5', a.html('hero').includes('class="bignum">5<'), a.html('hero').slice(0, 80));
}
{
  // 昨日まで5日、今日はまだ未達 → 連続は維持されて表示は5（まだ1日は終わっていない）
  const a = boot(base({ logs: daysBack('2026-08-20', 5) }), '2026-08-21');
  ok('今日未達でも昨日までの5日は保持', a.html('hero').includes('>5</span>'), a.html('hero').slice(0, 120));
}
{
  // 8/15(土)に登録して8/15〜8/19 達成、昨日(8/20)が空白。週の途中なので途切れず、空白日の分だけ増えない
  const a = boot(base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-08-15' })], logs: daysBack('2026-08-19', 5) }), '2026-08-21');
  ok('週の途中の空白日では途切れない（5を保持）', a.html('hero').includes('>5</span> 日連続'), a.html('hero'));
}
{
  // 最初の週（8/10〜）は土曜(8/15)が空白でシールドもない → 週末でリセットし、8/16(日)から数え直す
  const a = boot(base({ logs: Object.assign(span('2026-08-10', '2026-08-14'), span('2026-08-16', '2026-08-21')) }), '2026-08-21');
  ok('未達の週がシールドなしで終わると、翌日曜から数え直す', a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
}
{
  // 毎日つないでいても、懸垂を一度もやらなかった週はリセットされる（週ごと無効）
  const a = boot(base({ tasks: TWO, logs: Object.assign(span('2026-08-09', '2026-08-15'), span('2026-08-16', '2026-08-21', ['t1', 't2'])) }), '2026-08-21');
  ok('全タスクをやらなかった週は丸ごと無効になる', a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
  ok('その週の結果列はリセット', marks(a)[2] === 'reset', marks(a).join(','));
}
{
  // 記録が1件もない新規ユーザー
  const a = boot(base({}), '2026-08-21');
  ok('新規ユーザーは連続0', a.html('hero').includes('>0</span> 日連続'));
  ok('新規ユーザーはシールド0', stats(a).sh === '0 枚', stats(a).sh);
}

console.log('\n― 週の判定とシールド ―');
{
  // 8/9〜8/15 を毎日つないだ → +1枚。今週の8/16〜8/21 も続いている
  const a = boot(base({ logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('毎日つなぎ全タスクをやった週 → シールド +1', stats(a).sh === '1 枚', stats(a).sh);
  ok('連続は週をまたいで続く（13）', a.html('hero').includes('class="bignum">13<'), a.html('hero').slice(0, 80));
  ok('結果列に獲得が出る', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  // 今週はまだ終わっていないので、毎日つないでいても付与しない
  const a = boot(base({ logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  ok('今週分のシールドは週末まで付与しない', stats(a).sh === '0 枚', stats(a).sh);
  ok('今週の結果列は空欄', marks(a)[3] === '', marks(a).join(','));
}
{
  // 7/26週=獲得、8/2週=8/5が空白でシールド消費、8/9週=獲得、今週も継続
  const a = boot(base({ logs: without(span('2026-07-26', '2026-08-21'), '2026-08-05') }), '2026-08-21');
  ok('空白日のある週は1枚使って連続を維持する', stats(a).sh === '1 枚' && stats(a).used === '1 週', JSON.stringify(stats(a)));
  ok('空白日は日数に数えない（7+6+7+6=26）', a.html('hero').includes('class="bignum">26<'), a.html('hero').slice(0, 80));
  ok('結果列が 獲得・消費・獲得 と並ぶ', marks(a).slice(0, 3).join(',') === 'earn,protect,earn', marks(a).join(','));
}
{
  // 空白日が何日あっても、1つの週で使うのは1枚だけ
  const a = boot(base({ logs: Object.assign(span('2026-07-26', '2026-08-01'), span('2026-08-02', '2026-08-03'), span('2026-08-07', '2026-08-21')) }), '2026-08-21');
  ok('空白日が3日あっても消費は1枚', stats(a).used === '1 週', JSON.stringify(stats(a)));
}
{
  // 7/26週で1枚。8/2週・8/9週は何もしていない → 8/2週で1枚使い、8/9週でリセット。救済はしない
  const a = boot(base({ logs: Object.assign(span('2026-07-26', '2026-08-01'), span('2026-08-16', '2026-08-21')) }), '2026-08-21');
  ok('未達の週が続けば順に使い切る（返却しない）', stats(a).sh === '0 枚' && stats(a).used === '1 週', JSON.stringify(stats(a)));
  ok('使い切った次の週でリセット', marks(a).slice(0, 3).join(',') === 'earn,protect,reset', marks(a).join(','));
  ok('リセット後は今週の分だけ（6）', a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
}
{
  // 最初の週は、最初にタスクを登録した日（8/12 水）から判定する
  const tasks = [Object.assign({}, TASKS[0], { createdAt: '2026-08-12' })];
  const a = boot(base({ tasks, logs: span('2026-08-12', '2026-08-15') }), '2026-08-22');
  ok('最初の週はタスクを登録した日から土曜までで判定する', stats(a).sh === '1 枚', stats(a).sh);
}
{
  // 登録した日に何もしなければ、その日も空白日になる（起点は最初の記録日ではない）
  const tasks = [Object.assign({}, TASKS[0], { createdAt: '2026-08-12' })];
  const a = boot(base({ tasks, logs: span('2026-08-13', '2026-08-15') }), '2026-08-22');
  ok('登録した日も空白日に数える', marks(a)[2] === 'reset', marks(a).join(','));
}
{
  // あとから記録を足しても起点は動かない（記録を増やして結果が悪くなることがない）
  const tasks = [Object.assign({}, TASKS[0], { createdAt: '2026-08-17' })];
  const a = boot(base({ tasks, logs: span('2026-08-17', '2026-08-22') }), '2026-08-24');
  ok('前提：登録日から毎日やった最初の週は +1', marks(a)[3] === 'earn', marks(a).join(','));
  // 登録前の 8/16 はシートに出ないので記録できない。登録後の日を足しても結果は変わらない
  [...a.w.document.querySelectorAll('.cell')].find(c => day(c) === '16').click();
  ok('登録前の日は記録できない', a.text('sheet-body') === 'タスクがありません。', a.text('sheet-body'));
}
{
  // 打ち間違えて登録してすぐ消したタスクは、使い始めた日にも数えない
  const tasks = [
    { id: 't9', name: 'スクワト', order: 0, archived: true, createdAt: '2026-08-09', archivedAt: '2026-08-09' },
    Object.assign({}, TASKS[0], { order: 1, createdAt: '2026-08-11' })
  ];
  const a = boot(base({ tasks, logs: span('2026-08-11', '2026-08-21') }), '2026-08-21');
  ok('打ち間違いのタスクは使い始めた日に数えない', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  // 日曜になった瞬間に先週分が確定する
  const a = boot(base({ logs: span('2026-08-16', '2026-08-22') }), '2026-08-23');
  ok('週が明けるとシールドが付与される', a.html('hero').includes('シールド 1'), a.html('hero'));
  ok('今日が未達でも連続は保持（7）', a.html('hero').includes('>7</span> 日連続'), a.html('hero'));
}
{
  // 自己ベストは記録から導出する。リセットされた週の途中で届いていた日数も含む
  const logs = Object.assign(span('2026-07-26', '2026-08-01', ['t1', 't2']), span('2026-08-02', '2026-08-15'), span('2026-08-16', '2026-08-21', ['t1', 't2']));
  const a = boot(base({ tasks: TWO, logs }), '2026-08-21');
  ok('自己ベストは過去の最長（21）', stats(a).best === '21 日', JSON.stringify(stats(a)));
  ok('リセット後の連続は今週の分（6）', a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
}

console.log('\n― 週に必須のタスク ―');
{
  // 週の途中（8/11 火）に追加したタスクは、その週の判定に入らない
  const tasks = [TWO[0], Object.assign({}, TWO[1], { createdAt: '2026-08-11' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('週の途中で追加したタスクは翌週から必須', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  // 日曜に追加したタスクはその週から必須
  const tasks = [TWO[0], Object.assign({}, TWO[1], { createdAt: '2026-08-09' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('日曜に追加したタスクはその週から必須', marks(a)[2] === 'reset', marks(a).join(','));
}
{
  // 最初の週は、最初の記録日までに登録していたタスクが必須
  const tasks = [TWO[0], Object.assign({}, TWO[1], { createdAt: '2026-08-12' })];
  const a = boot(base({ tasks, logs: span('2026-08-12', '2026-08-21') }), '2026-08-21');
  ok('最初の記録日に登録したタスクは最初の週から必須', marks(a)[2] === 'reset', marks(a).join(','));
}
{
  // その週のうちにアーカイブしても、その週はまだ必須（やらなかったタスクを判定から逃がせない）
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-13' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('アーカイブした週はまだ必須', marks(a)[2] === 'reset', marks(a).join(','));
  ok('翌週からは必須でなくなる', outlook(a) === '+1 枚 見込み', String(outlook(a)));
}
{
  // 抜け道：土曜にアーカイブし、翌日に同じタスクを登録し直しても、その週は救われない
  const tasks = [
    TWO[0],
    Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-15' }),
    { id: 't3', name: '懸垂', order: 2, archived: false, createdAt: '2026-08-16' }
  ];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('土曜にアーカイブして登録し直しても、その週は未達', marks(a)[2] === 'reset', marks(a).join(','));
}
{
  // 判定開始日（日曜）にアーカイブしたタスクは、その週から外れる
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-09' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('日曜にアーカイブしたタスクはその週から必須でない', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  // 今週の判定にまだ入るアーカイブ済みタスクは、シートでもホームと同じく「今週まで」と出す
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-19' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  a.w.document.querySelector('.cell.today').click();
  const labels = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent).join(',');
  ok('シートでも「今週まで」と出す', labels === 'スクワット,懸垂（今週まで）', labels);
}
{
  // 今週の日曜にアーカイブしたタスクはホームにも残らず、今週の見込みにも入らない
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-16' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  ok('今週の日曜にアーカイブしたタスクは今週の見込みに入らない', outlook(a) === '+1 枚 見込み', String(outlook(a)));
  ok('ホームにも残らない', a.w.document.querySelectorAll('.task').length === 1, String(a.w.document.querySelectorAll('.task').length));
}
{
  // 日曜にアーカイブするときは「今週の間だけ残る」と言わない
  const a = boot(base({ tasks: TWO, logs: span('2026-08-16', '2026-08-22') }), '2026-08-23');
  const msgs = []; a.w.confirm = m => { msgs.push(m); return false; };
  a.w.document.querySelectorAll('#task-editor .mini.danger')[1].click();
  ok('日曜のアーカイブでは「今週の間だけ残る」と言わない', !msgs[0].includes('今週の間だけ残ります'), msgs[0]);
}
{
  // 前の週までにアーカイブしたタスクは、その週の判定に入らない
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-08' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('前の週までにアーカイブしたタスクは必須でない', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  // 終わった週の判定は、あとでアーカイブしても変わらない
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-17' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('アーカイブより前の週はそのまま必須', marks(a)[2] === 'reset', marks(a).join(','));
}

{
  // タスクを入れ替えた週（日曜に全部アーカイブし、火曜に新しく登録）は必須タスクがない。
  // 空白日がなければ判定しない（+1も−1もしない）
  const tasks = [
    Object.assign({}, TASKS[0], { createdAt: '2026-08-02', archived: true, archivedAt: '2026-08-09' }),
    Object.assign({}, TWO[1], { createdAt: '2026-08-11' })
  ];
  const logs = Object.assign(span('2026-08-02', '2026-08-10'), span('2026-08-11', '2026-08-21', ['t2']));
  const a = boot(base({ tasks, logs }), '2026-08-21');
  ok('必須タスクのない週ではシールドを獲得しない', stats(a).sh === '1 枚', JSON.stringify(stats(a)));
  ok('必須タスクのない週は判定しない（結果列は空欄）', marks(a).slice(1, 3).join(',') === 'earn,', marks(a).join(','));
  ok('判定しない週は連続も切らない（7+7+6=20）', a.html('hero').includes('class="bignum">20<'), a.html('hero').slice(0, 80));
}
{
  // 必須タスクがなくても、空白日のある週はこれまでどおり −1 かリセット
  const tasks = [
    Object.assign({}, TASKS[0], { createdAt: '2026-08-09', archived: true, archivedAt: '2026-08-09' }),
    Object.assign({}, TWO[1], { createdAt: '2026-08-09', archived: true, archivedAt: '2026-08-10' }),
    Object.assign({}, TWO[0], { id: 't3', createdAt: '2026-08-11' })
  ];
  const logs = Object.assign(without(span('2026-08-09', '2026-08-15', ['t3']), '2026-08-12'), span('2026-08-16', '2026-08-21', ['t3']));
  const a = boot(base({ tasks, logs }), '2026-08-21');
  ok('必須タスクがなくても空白日のある週はリセット', marks(a)[2] === 'reset', marks(a).join(','));
}
{
  // 今週の必須タスクが1つもないとき（日曜にアーカイブして、週の途中で新しく登録した）は「判定なし」
  const tasks = [
    Object.assign({}, TASKS[0], { createdAt: '2026-08-09', archived: true, archivedAt: '2026-08-16' }),
    Object.assign({}, TWO[1], { createdAt: '2026-08-18' })
  ];
  const a = boot(base({ tasks, logs: Object.assign(span('2026-08-09', '2026-08-17'), span('2026-08-18', '2026-08-21', ['t2'])) }), '2026-08-21');
  ok('今週の必須タスクがなければ 判定なし', outlook(a) === '判定なし', String(outlook(a)));
}
{
  // 登録した日より前の日には、そのタスクを記録できない（さかのぼって埋めると最初の週の判定がずれるため）
  const tasks = [Object.assign({}, TASKS[0], { createdAt: '2026-08-19' })];
  const a = boot(base({ tasks, logs: span('2026-08-19', '2026-08-21') }), '2026-08-21');
  [...a.w.document.querySelectorAll('.cell')].find(c => day(c) === '15').click();
  ok('登録前の日のシートにはタスクが出ない', a.text('sheet-body') === 'タスクがありません。', a.text('sheet-body'));
  [...a.w.document.querySelectorAll('.cell')].find(c => day(c) === '19').click();
  ok('登録した日のシートには出る', a.w.document.querySelectorAll('#sheet-body .toggle').length === 1, a.text('sheet-body'));
}
{
  // 登録前の日にすでに記録がある場合（データ由来）は、消せるように出す
  const tasks = [Object.assign({}, TASKS[0], { createdAt: '2026-08-19' })];
  const a = boot(base({ tasks, logs: Object.assign(span('2026-08-19', '2026-08-21'), { '2026-08-15': ['t1'] }) }), '2026-08-21');
  [...a.w.document.querySelectorAll('.cell')].find(c => day(c) === '15').click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('登録前の日の記録はシートから消せる', !a.state().logs['2026-08-15'], JSON.stringify(a.state().logs));
}

console.log('\n― アーカイブしたタスクの過去日 ―');
{
  // 8/9週に必須だった懸垂を、あとでアーカイブした。8/12 のシートから記録を直せる
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-21' })];
  const logs = Object.assign(span('2026-08-09', '2026-08-21'), { '2026-08-10': ['t1', 't2'] });
  const a = boot(base({ tasks, logs }), '2026-08-21');
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '12').click();
  const names = () => [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent);
  ok('その週に必須だったアーカイブ済みタスクがシートに出る', names().join(',') === 'スクワット,懸垂（アーカイブ済み）', names().join(','));
  ok('前提：懸垂をやった8/9週は獲得', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-21' })];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('前提：懸垂をやっていない8/9週はリセット', marks(a)[2] === 'reset', marks(a).join(','));
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '12').click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[1].click();
  ok('アーカイブ済みタスクを過去日に記録して週を直せる', marks(a)[2] === 'earn', marks(a).join(','));
  ok('週の結果がシートの文にも反映される', a.text('sheet-body').includes('この週はシールドを1枚獲得しました。'), a.text('sheet-body'));
}
{
  // その週に必須でなくても、その日に記録があるアーカイブ済みタスクは出す（取り消せるように）
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-11' })];
  const logs = Object.assign(span('2026-08-16', '2026-08-21'), { '2026-08-17': ['t1', 't2'] });
  const a = boot(base({ tasks, logs }), '2026-08-21');
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '17').click();
  const names = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent);
  ok('記録のあるアーカイブ済みタスクはシートに出る', names.includes('懸垂（アーカイブ済み）'), names.join(','));
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '18').click();
  const names2 = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent);
  ok('必須でも記録もないアーカイブ済みタスクは出さない', names2.join(',') === 'スクワット', names2.join(','));
}

console.log('\n― 今週の見込み ―');
{
  const a = boot(base({ tasks: TWO, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  ok('未実施のタスクがあれば あと n タスク', outlook(a) === 'あと 1 タスク', String(outlook(a)));
}
{
  const a = boot(base({ logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  ok('欠けなく全タスク済みなら +1 枚 見込み', outlook(a) === '+1 枚 見込み', String(outlook(a)));
}
{
  const a = boot(base({ logs: without(span('2026-08-09', '2026-08-21'), '2026-08-18') }), '2026-08-21');
  ok('欠けた日があり手持ちがあれば −1 枚 見込み', outlook(a) === '−1 枚 見込み', String(outlook(a)));
}
{
  const a = boot(base({ logs: without(span('2026-08-16', '2026-08-21'), '2026-08-17') }), '2026-08-21');
  ok('欠けた日があり手持ちがなければ 週末でリセット', outlook(a) === '週末でリセット', String(outlook(a)));
}
{
  // 今日はまだ終わっていないので空白日に数えない（記録した瞬間の見込みが正しいこと）
  const a = boot(base({ logs: span('2026-08-16', '2026-08-20') }), '2026-08-21');
  ok('前提：今日は未達なので「今週」欄は出ない', outlook(a) === null);
  a.w.document.querySelector('.cell.today').click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('今日を記録すると +1 枚 見込み', outlook(a) === '+1 枚 見込み', String(outlook(a)));
}

console.log('\n― 記録操作と巻き戻し ―');
{
  const a = boot(base({ logs: daysBack('2026-08-20', 3) }), '2026-08-21');
  // カレンダーで今日のセルを押して記録する
  const todayCell = [...a.w.document.querySelectorAll('.cell')].find(c => c.classList.contains('today'));
  todayCell.click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('カレンダー経由で今日を記録 → 4日連続', a.html('hero').includes('>4<'), a.html('hero').slice(0, 80));
  ok('自己ベストが更新される', stats(a).best === '4 日', stats(a).best);
}
{
  // シールドで守った週の空白日を後から「やってた」に直す → その週は獲得に変わる
  const a = boot(base({ logs: without(span('2026-07-26', '2026-08-21'), '2026-08-05') }), '2026-08-21');
  ok('前提：8/2週はシールド消費', marks(a)[1] === 'protect', marks(a).join(','));
  [...a.w.document.querySelectorAll('.cell')].find(c => day(c) === '5' && !c.classList.contains('out')).click();
  ok('シートに週の結果が出る', a.text('sheet-body').includes('シールドを1枚使って'), a.text('sheet-body'));
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('達成に直すと週の結果も獲得に変わる', marks(a)[1] === 'earn', marks(a).join(','));
  ok('消費が取り消され3枚になる', stats(a).sh === '3 枚' && stats(a).used === '0 週', JSON.stringify(stats(a)));
  ok('その日が数えられ27日連続になる', a.html('hero').includes('>27<'), a.html('hero').slice(0, 80));
}

console.log('\n― 午前4時の区切り ―');
{
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
    beforeParse(w) {
      const fixed = new Date('2026-08-22T01:30:00').getTime(); // 8/22の深夜1時半
      const R = w.Date;
      w.Date = class extends R {
        constructor(...a) { return a.length ? new R(...a) : new R(fixed); }
        static now() { return fixed; }
      };
      w.localStorage.setItem('ember.v1', JSON.stringify(base({ logs: daysBack('2026-08-20', 3) })));
    }
  });
  const w = dom.window;
  const todayCell = [...w.document.querySelectorAll('.cell')].find(c => c.classList.contains('today'));
  ok('深夜1時半は前日(8/21)扱いになる', todayCell && day(todayCell) === '21', todayCell && day(todayCell));
  ok('連続はまだ切れていない（3日を保持）', w.document.getElementById('hero').innerHTML.includes('>3</span>'));
}

console.log('\n― タスク管理 ―');
{
  const a = boot(base({ tasks: [] }), '2026-08-21');
  a.w.document.getElementById('nav-settings').click();
  a.w.document.getElementById('new-task').value = '  トイレでスクワット10回  ';
  a.w.document.getElementById('add-task').click();
  ok('タスクを追加できる（前後の空白を除去）', a.state().tasks.length === 1 && a.state().tasks[0].name === 'トイレでスクワット10回', JSON.stringify(a.state().tasks));
  ok('追加した日を持つ', a.state().tasks[0].createdAt === '2026-08-21', JSON.stringify(a.state().tasks));
  a.w.confirm = () => true;
  a.w.document.querySelector('#task-editor .mini.danger').click();
  ok('削除はアーカイブであり物理削除ではない', a.state().tasks.length === 1 && a.state().tasks[0].archived === true, JSON.stringify(a.state().tasks));
  ok('アーカイブした日を持つ', a.state().tasks[0].archivedAt === '2026-08-21', JSON.stringify(a.state().tasks));
}
{
  // アーカイブしても過去の記録と連続日数は残る
  const a = boot(base({ logs: daysBack('2026-08-21', 6), tasks: [{ id: 't1', name: '懸垂', order: 0, archived: true, createdAt: '2026-01-01', archivedAt: '2026-08-21' }] }), '2026-08-21');
  ok('アーカイブ後も連続日数は保持される', a.html('hero').includes('>6<'), a.html('hero').slice(0, 80));
}

console.log('\n― データ保存 ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 2) }), '2026-08-21');
  ok('localStorageに書き込まれている', !!a.state().logs['2026-08-21']);
}
{
  // 壊れたデータからの復旧
  const alerts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
    beforeParse(w) { w.localStorage.setItem('ember.v1', '{壊れたJSON'); w.alert = m => alerts.push(m); }
  });
  ok('壊れた保存データでもクラッシュしない', !!dom.window.document.getElementById('hero').textContent);
  ok('読めなかった元データは退避する', dom.window.localStorage.getItem('ember.v1.broken') === '{壊れたJSON');
  await new Promise(r => setTimeout(r, 20));
  ok('空の状態で起動したことを知らせる', alerts.length === 1 && alerts[0].includes('ember.v1.broken'), alerts.join('/'));
}

console.log('\n― 描画 ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 10) }), '2026-08-21');
  ok('カレンダーは今月の日数分のマス（8月=31）', a.w.document.querySelectorAll('.cell:not(.out)').length === 31, String(a.w.document.querySelectorAll('.cell:not(.out)').length));
  ok('達成マスが10個', a.w.document.querySelectorAll('.cell.done').length === 10, String(a.w.document.querySelectorAll('.cell.done').length));
  ok('未来のマスが操作不能', a.w.document.querySelectorAll('.cell.future').length > 0);
  ok('タスク行が描画される', a.w.document.querySelectorAll('.task').length === 1);
  ok('達成済みのタスクに done が付く', a.w.document.querySelector('.task').classList.contains('done'));
}

console.log('\n― タスクの今週の回数 ―');
{
  const a = boot(base({
    tasks: [
      { id: 't1', name: 'スクワット', order: 0, archived: false, createdAt: '2026-01-01' },
      { id: 't2', name: '読書', order: 1, archived: false, createdAt: '2026-01-01' },
      { id: 't3', name: '日記', order: 2, archived: false, createdAt: '2026-01-01' }
    ],
    // 8/14 は先週なので今週の回数には入らない
    logs: { '2026-08-14': ['t1', 't2'], '2026-08-19': ['t1'], '2026-08-20': ['t1', 't2'], '2026-08-21': ['t1'] }
  }), '2026-08-21');
  // 再描画のたびに行は作り直されるので、毎回引き直す
  const tally = n => a.w.document.querySelectorAll('.task .tally')[n];

  ok('今週の回数がタスクの行に出る', tally(0).textContent === '今週 3 回', tally(0).textContent);
  ok('タスクごとに独立して数える', tally(1).textContent === '今週 1 回', tally(1).textContent);
  ok('今週やっていないタスクにも 0 を出す', tally(2).textContent === '今週 0 回', tally(2).textContent);
  ok('今週0回の必須タスクだけ色を付ける', tally(2).classList.contains('due') && !tally(0).classList.contains('due') && !tally(1).classList.contains('due'));

  // 今週の過去日を編集すれば追随する（毎回数え直しているため）
  const at = n => [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === String(n));
  at(19).click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[0].click();  // 8/19 の t1 を取り消す
  ok('今週の記録を取り消すと減る', tally(0).textContent === '今週 2 回', tally(0).textContent);
  a.w.document.querySelectorAll('#sheet-body .toggle')[2].click();  // 8/19 に t3 を足す
  ok('今週の記録を足すと増え、色が外れる', tally(2).textContent === '今週 1 回' && !tally(2).classList.contains('due'), tally(2).textContent);
  at(14).click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[0].click();  // 先週の 8/14 の t1 を取り消す
  ok('先週の記録を直しても今週の回数は変わらない', tally(0).textContent === '今週 2 回', tally(0).textContent);

  // 通算回数は設定画面のタスク一覧に出す
  const total = n => a.w.document.querySelectorAll('#task-editor .tally')[n].textContent;
  ok('設定画面に通算回数が出る', total(0) === '通算 2 回' && total(1) === '通算 2 回' && total(2) === '通算 1 回',
     [0, 1, 2].map(total).join(','));
}
{
  const a = boot(base({ logs: {} }), '2026-08-21');
  const t = a.w.document.querySelector('.task .tally');
  ok('記録が1件もなくても 今週 0 回 として出る', t.textContent === '今週 0 回', t.textContent);
  ok('記録がなくても必須なので色が付く', t.classList.contains('due'));
}
{
  // 今週の途中で追加したタスクは今週の判定に入らないので、0回でも色を付けない
  const tasks = [TWO[0], Object.assign({}, TWO[1], { createdAt: '2026-08-18' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  const t = a.w.document.querySelectorAll('.task .tally')[1];
  ok('今週から追加したタスクは0回でも色を付けない', t.textContent === '今週 0 回' && !t.classList.contains('due'), t.className);
}
{
  // 前の週までにアーカイブしたタスクは、記録は残るが行そのものが出ない
  const a = boot(base({
    tasks: [{ id: 't1', name: 'スクワット', order: 0, archived: true, createdAt: '2026-01-01', archivedAt: '2026-08-15' }],
    logs: { '2026-08-14': ['t1'] }
  }), '2026-08-21');
  ok('前の週までにアーカイブしたタスクは行ごと出ない', a.w.document.querySelectorAll('.task .tally').length === 0);
  ok('行がなければ長押しの案内も出ない', a.text('hint') === '', a.text('hint'));
}
{
  // 今週アーカイブしたタスクは今週の判定にまだ入るので、週が終わるまでホームに残す
  const tasks = [TWO[0], Object.assign({}, TWO[1], { archived: true, archivedAt: '2026-08-19' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  const rows = [...a.w.document.querySelectorAll('.task')];
  ok('今週アーカイブしたタスクは「今週まで」付きでホームに残る', rows.length === 2 && rows[1].querySelector('.name').textContent === '懸垂（今週まで）',
     rows.map(r => r.querySelector('.name').textContent).join(','));
  ok('今週まだやっていなければ色が付く', rows[1].querySelector('.tally').classList.contains('due'));
  ok('今週の見込みにも数えられる', outlook(a) === 'あと 1 タスク', String(outlook(a)));
  const b = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-23');
  ok('週が明けるとホームから消える', b.w.document.querySelectorAll('.task').length === 1, String(b.w.document.querySelectorAll('.task').length));
}
{
  // 壊れた記録（配列でない）が混ざっていても描画が止まらない
  const logs = Object.assign(span('2026-08-16', '2026-08-21'), { '2026-08-18': {}, '2026-08-19': 'broken' });
  const a = boot(base({ logs }), '2026-08-21');
  ok('配列でない記録があっても描画できる', a.w.document.querySelectorAll('.cell').length > 0 && a.text('hero') !== '', a.text('hero').slice(0, 40));
  // {} は記録なし、1つだけの文字列は1件の記録として扱う（8/18 だけ欠ける → 連続は 2+3=5）
  ok('配列でない記録は1件の記録として扱い、中身のないものは捨てる', a.html('hero').includes('class="bignum">5<'), a.html('hero').slice(0, 80));
  // どのタスクにも当てはまらない 'broken' はシートに「削除されたタスク」として出て、消せる
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '19').click();
  const labels = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent).join(',');
  ok('文字列だった記録もシートに出る', labels === 'スクワット10回,（削除されたタスク）', labels);
  a.w.document.querySelectorAll('#sheet-body .toggle')[1].click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[0].click();
  ok('シートから直せる', JSON.stringify(a.state().logs['2026-08-19']) === '["t1"]', JSON.stringify(a.state().logs['2026-08-19']));
}
{
  // logs や tasks の形が壊れていても起動できる
  const a = boot(base({ logs: null, tasks: 'broken' }), '2026-08-21');
  ok('logs が null でも起動できる', a.html('hero').includes('>0</span> 日連続'), a.html('hero').slice(0, 80));
}
{
  // 区切り時刻が数字でなくても固まらない（既定の午前4時に戻す）
  const seed = base({ logs: span('2026-08-16', '2026-08-21') }); seed.settings.dayBoundaryHour = 'x';
  const a = boot(seed, '2026-08-21');
  ok('区切り時刻が壊れていても起動できる', a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
  a.w.document.getElementById('nav-settings').click();
  ok('区切り時刻は既定の4時に戻る', a.w.document.getElementById('boundary').value === '4', a.w.document.getElementById('boundary').value);
}
{
  // タスクの中身が壊れていても起動できる
  const a = boot(base({ tasks: [null, 'x', { name: 'idなし' }, TASKS[0]], logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  ok('null や id のないタスクは読み飛ばす', a.w.document.querySelectorAll('.task').length === 1 && a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
  a.w.document.getElementById('nav-settings').click();
  a.w.document.getElementById('new-task').value = '懸垂';
  a.w.document.getElementById('add-task').click();
  ok('壊れたタスクがあってもタスクを追加できる', a.state().tasks.length === 2, JSON.stringify(a.state().tasks));
}
{
  // 日付として正しくないキーや、文字列でない id は捨てる
  const logs = Object.assign(span('2026-08-20', '2026-08-21'), { '2020-1-1x': ['t1'], '2026-8-1': ['t1'], '2026-02-30': ['t1'], '2026-08-19': [null] });
  const a = boot(base({ logs }), '2026-08-21');
  ok('正しくない日付キーがあっても連続が出る', a.html('hero').includes('class="bignum">2<'), a.html('hero').slice(0, 80));
  ok('正しくない日付キーは保存し直すと消える', (a.w.document.querySelector('.cell.today').click(), a.w.document.querySelector('#sheet-body .toggle').click(), Object.keys(a.state().logs).join(',') === '2026-08-20'), Object.keys(a.state().logs).join(','));
}
{
  // 未来日のログは通算回数にも数えない（達成日数とそろえる）
  const a = boot(base({ logs: Object.assign(span('2026-08-20', '2026-08-21'), { '2026-09-30': ['t1'] }) }), '2026-08-21');
  ok('未来日のログは通算回数に数えない', a.w.document.querySelector('#task-editor .tally').textContent === '通算 2 回' && stats(a).days === '2 日',
     a.w.document.querySelector('#task-editor .tally').textContent + ' / ' + stats(a).days);
}
{
  // 壊れたバックアップを復元しても、その後の起動が止まらない
  const a = boot(base({ logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  a.w.confirm = () => true; a.w.alert = () => {};
  a.w.restore(new a.w.File([JSON.stringify({ logs: null })], 'broken.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 50));
  ok('logs が null のバックアップを復元しても描画できる', a.html('hero').includes('>0</span> 日連続'), a.html('hero').slice(0, 80));
  ok('保存されるデータの形もそろっている', JSON.stringify(a.state().logs) === '{}' && Array.isArray(a.state().tasks), JSON.stringify(a.state()));
}
{
  // 今週登録して今週アーカイブしたタスクは今週の判定に入らないので、ホームにも残さない
  const tasks = [TWO[0], Object.assign({}, TWO[1], { createdAt: '2026-08-18', archived: true, archivedAt: '2026-08-19' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  ok('判定に入らないアーカイブ済みタスクはホームに残さない', a.w.document.querySelectorAll('.task').length === 1, String(a.w.document.querySelectorAll('.task').length));
}
{
  // アーカイブ時の確認文：今週の判定に入っているタスクだけ「ホームに残る」と伝える
  const tasks = [TWO[0], Object.assign({}, TWO[1], { createdAt: '2026-08-18' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21') }), '2026-08-21');
  const msgs = []; a.w.confirm = m => { msgs.push(m); return false; };
  const del = a.w.document.querySelectorAll('#task-editor .mini.danger');
  del[0].click(); del[1].click();
  ok('今週の判定に入っているタスクは「今週の間だけ残る」と伝える', msgs[0].includes('今週の間だけ残ります'), msgs[0]);
  ok('今週の判定に入らないタスクにはそう伝えない', !msgs[1].includes('今週の間だけ残ります'), msgs[1]);
}
{
  // 記録がまだなくても、起点は登録した日（8/17）。それより後にアーカイブしたタスクは今週まだ必須
  const tasks = [
    Object.assign({}, TASKS[0], { createdAt: '2026-08-17', archived: true, archivedAt: '2026-08-18' }),
    Object.assign({}, TWO[1], { createdAt: '2026-08-17', archived: true, archivedAt: '2026-08-19' })
  ];
  const a = boot(base({ tasks }), '2026-08-19');
  const home = [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent).join(',');
  ok('記録がなくても、登録日より後にアーカイブしたタスクはホームに残る', home === 'スクワット10回（今週まで）,懸垂（今週まで）', home);
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '18').click();
  const sheet = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent).join(',');
  ok('シートにもホームと同じく出る', sheet === 'スクワット10回（今週まで）,懸垂（今週まで）', sheet);
}
{
  // 登録した日にアーカイブした打ち間違いのタスクは、最初の週の必須に入らない
  const tasks = [
    Object.assign({}, TASKS[0], { createdAt: '2026-08-10' }),
    { id: 't9', name: 'スクワト', order: 1, archived: true, createdAt: '2026-08-10', archivedAt: '2026-08-10' }
  ];
  const a = boot(base({ tasks, logs: span('2026-08-10', '2026-08-21') }), '2026-08-21');
  ok('登録した日にアーカイブしたタスクは最初の週でも必須でない', marks(a)[2] === 'earn', marks(a).join(','));
}
{
  // どのタスクにも当てはまらない記録は捨てず、シートに「削除されたタスク」として出して消せるようにする
  const a = boot(base({ logs: Object.assign(span('2026-08-20', '2026-08-21'), { '2026-08-19': ['zz'] }) }), '2026-08-21');
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '19').click();
  const labels = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent);
  ok('存在しないタスクの記録はシートに「削除されたタスク」として出る', labels.join(',') === 'スクワット10回,（削除されたタスク）', labels.join(','));
  a.w.document.querySelectorAll('#sheet-body .toggle')[1].click();
  ok('シートから消せる', !a.state().logs['2026-08-19'], JSON.stringify(a.state().logs));
}
{
  // タスク欄が壊れていても、記録は消さない
  const a = boot(base({ tasks: { broken: true }, logs: span('2026-08-20', '2026-08-21') }), '2026-08-21');
  a.w.document.querySelector('.cell.today').click();
  a.w.document.querySelector('#sheet-body .toggle').click();   // 削除されたタスクとして出ている t1 を取り消す
  ok('タスク欄が壊れていても記録は残る', JSON.stringify(Object.keys(a.state().logs)) === '["2026-08-20"]', JSON.stringify(a.state().logs));
}
{
  // 日曜に登録してすぐアーカイブした（打ち間違いの取り消し）タスクは、その週の必須に入らない
  const tasks = [TASKS[0], { id: 't9', name: 'スクワト', order: 1, archived: true, createdAt: '2026-08-16', archivedAt: '2026-08-16' }];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  ok('登録した日にアーカイブしたタスクは必須にしない', outlook(a) === '+1 枚 見込み', String(outlook(a)));
  ok('ホームにも残さない', a.w.document.querySelectorAll('.task').length === 1, String(a.w.document.querySelectorAll('.task').length));
}
{
  // アーカイブ時の確認文：今日登録したタスクには「今週の間だけ残る」と言わない
  // 日曜（8/23）に登録したタスクは今週の必須に入るが、今日アーカイブすれば打ち間違いの取り消し扱い
  const tasks = [TASKS[0], { id: 't9', name: 'スクワト', order: 1, archived: false, createdAt: '2026-08-23' }];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-22') }), '2026-08-23');
  const msgs = []; a.w.confirm = m => { msgs.push(m); return false; };
  a.w.document.querySelectorAll('#task-editor .mini.danger')[1].click();
  ok('今日登録したタスクには「今週の間だけ残る」と言わない', !msgs[0].includes('今週の間だけ残ります'), msgs[0]);
}
{
  // 今週の判定に入らないタスクをアーカイブすると、すぐホームから消える（確認文どおり）
  const tasks = [TASKS[0], { id: 't9', name: 'B', order: 1, archived: false, createdAt: '2026-08-18' }];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-20') }), '2026-08-20');
  const msgs = []; a.w.confirm = m => { msgs.push(m); return true; };
  a.w.document.querySelectorAll('#task-editor .mini.danger')[1].click();
  ok('判定に入らないタスクは確認文で「残る」と言わない', !msgs[0].includes('今週の間だけ残ります'), msgs[0]);
  ok('アーカイブするとすぐホームから消える', [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent).join(',') === 'スクワット10回',
     [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent).join(','));
}
{
  // アーカイブ済みタスクの今日の記録を誤って消しても、その日のうちは行が残り戻せる
  const tasks = [TASKS[0], { id: 't9', name: '懸垂', order: 1, archived: true, createdAt: '2026-08-18', archivedAt: '2026-08-21' }];
  const a = boot(base({ tasks, logs: Object.assign(span('2026-08-16', '2026-08-21'), { '2026-08-21': ['t1', 't9'] }) }), '2026-08-21');
  a.w.document.querySelector('.cell.today').click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[1].click();   // 懸垂の記録を消す
  const labels = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent);
  ok('記録を消してもその日のうちは行が残る', labels.join(',') === 'スクワット10回,懸垂（アーカイブ済み）', labels.join(','));
}
{
  // 並び順が欠けたり重なったりしていても、0から振り直して並べ替えできる
  const tasks = [
    { id: 'a', name: 'A', order: 1, archived: false, createdAt: '2026-01-01' },
    { id: 'b', name: 'B', archived: false, createdAt: '2026-01-01' },
    { id: 'c', name: 'C', order: 1, archived: false, createdAt: '2026-01-01' }
  ];
  const a = boot(base({ tasks }), '2026-08-21');
  const names = () => [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent).join(',');
  ok('並び順は今の並びのまま振り直す', names() === 'A,C,B', names());
  a.w.document.getElementById('nav-settings').click();
  a.w.document.querySelectorAll('#task-editor .row')[1].querySelectorAll('.mini')[0].click();   // C を上へ
  ok('振り直した並び順で上下ボタンが効く', names() === 'C,A,B', names());
}
{
  // 週の途中で登録し、翌週にアーカイブしたタスクも、存在していた日のシートには出る（記録し忘れを直せる）
  const tasks = [TASKS[0], { id: 't9', name: '懸垂', order: 1, archived: true, createdAt: '2026-08-12', archivedAt: '2026-08-18' }];
  const a = boot(base({ tasks, logs: span('2026-08-09', '2026-08-21') }), '2026-08-21');
  [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '13').click();
  const labels = [...a.w.document.querySelectorAll('#sheet-body .toggle .t')].map(e => e.textContent);
  ok('存在していた日のシートにはアーカイブ済みタスクが出る', labels.join(',') === 'スクワット10回,懸垂（アーカイブ済み）', labels.join(','));
}
{
  // 今日記録したタスクをアーカイブしても、今日の記録はホームから取り消せる
  const tasks = [TASKS[0], { id: 't9', name: '懸垂', order: 1, archived: true, createdAt: '2026-08-18', archivedAt: '2026-08-21' }];
  const a = boot(base({ tasks, logs: Object.assign(span('2026-08-16', '2026-08-21'), { '2026-08-21': ['t1', 't9'] }) }), '2026-08-21');
  const names = [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent);
  ok('今日記録のあるアーカイブ済みタスクはホームに残る', names.join(',') === 'スクワット10回,懸垂（アーカイブ済み）', names.join(','));
}
{
  // 同じ日に同じタスクが重複して入っていても1回として数え、1回の操作で取り消せる
  const a = boot(base({ logs: { '2026-08-21': ['t1', 't1'] } }), '2026-08-21');
  ok('重複した記録は1回として数える', a.w.document.querySelector('.task .tally').textContent === '今週 1 回', a.w.document.querySelector('.task .tally').textContent);
  a.w.document.querySelector('.cell.today').click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('重複していても1回の操作で取り消せる', !a.state().logs['2026-08-21'], JSON.stringify(a.state().logs));
}
{
  // 年を打ち間違えた古すぎる記録は捨てる。画面で選べない設定値も既定値に戻す
  const seed = base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-08-20' })], logs: Object.assign(span('2026-08-20', '2026-08-21'), { '1026-10-20': ['t1'] }) });
  seed.settings.dayBoundaryHour = 12; seed.settings.theme = 'sepia';
  const a = boot(seed, '2026-08-21');
  ok('古すぎる日付の記録は捨てる（その月までは遡れない）', a.html('hero').includes('class="bignum">2<') && a.w.document.getElementById('grid-prev').disabled, a.html('hero').slice(0, 80));
  a.w.document.getElementById('nav-settings').click();
  ok('選べない区切り時刻は既定の4時に戻る', a.w.document.getElementById('boundary').value === '4', a.w.document.getElementById('boundary').value);
  ok('選べないテーマはシステムに戻る', a.w.document.getElementById('theme').value === 'system' && !a.w.document.documentElement.hasAttribute('data-theme'),
     a.w.document.getElementById('theme').value);
}
{
  // 並び順が欠けたタスクや文字列の archived があっても、追加・並べ替えが壊れない
  const tasks = [{ id: 't1', name: 'スクワット', archived: 'false', createdAt: '2026-01-01' }, { id: 't2', name: '懸垂', order: 1, archived: false, createdAt: '2026-01-01' }];
  const a = boot(base({ tasks }), '2026-08-21');
  ok('文字列の archived はアーカイブ扱いにしない', a.w.document.querySelectorAll('.task').length === 2, String(a.w.document.querySelectorAll('.task').length));
  a.w.document.getElementById('nav-settings').click();
  a.w.document.getElementById('new-task').value = '読書';
  a.w.document.getElementById('add-task').click();
  ok('並び順が欠けていても新しいタスクの並び順は数値になる', a.state().tasks.every(t => Number.isFinite(t.order)), JSON.stringify(a.state().tasks.map(t => t.order)));
}

console.log('\n― 行の長押し ―');
// jsdom に PointerEvent はないので MouseEvent で代用する（ハンドラが見るのは座標とボタンだけ）
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pointer(el, type, x = 0, y = 0) {
  const w = el.ownerDocument.defaultView;
  el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}
// 実時間で requestAnimationFrame を回す必要があるので、PRESS_MS(500ms) より少し長く待つ
const HOLD = 650;
function row(a) { return a.w.document.querySelector('.task'); }
function logged(a, date = '2026-08-21') { return (a.state().logs[date] || []).includes('t1'); }

{
  const a = boot(base({}), '2026-08-21');
  ok('行が押下対象になっている', row(a).getAttribute('role') === 'button');
  ok('行に入れ子のボタンを持たない', row(a).querySelector('button') === null);
  ok('未達の行は aria-pressed が false', row(a).getAttribute('aria-pressed') === 'false');
  ok('丸はスクリーンリーダーから隠す', row(a).querySelector('.btn').getAttribute('aria-hidden') === 'true');

  // 名前の上（丸ではない場所）から押し始める
  pointer(row(a), 'pointerdown', 20, 20);
  await sleep(HOLD);
  pointer(row(a), 'pointerup', 20, 20);
  ok('行のどこを長押ししても記録される', logged(a), JSON.stringify(a.state().logs));
  ok('記録した行は aria-pressed が true', row(a).getAttribute('aria-pressed') === 'true');
  ok('記録すると今週の回数がその場で増える', row(a).querySelector('.tally').textContent === '今週 1 回',
     row(a).querySelector('.tally').textContent);
}
{
  // 丸から押し始めても、行のハンドラまで伝播して同じように記録される
  const a = boot(base({}), '2026-08-21');
  pointer(row(a).querySelector('.btn'), 'pointerdown', 20, 20);
  await sleep(HOLD);
  pointer(row(a), 'pointerup', 20, 20);
  ok('丸の上から押し始めても記録される', logged(a), JSON.stringify(a.state().logs));
}
{
  const a = boot(base({ logs: { '2026-08-21': ['t1'] } }), '2026-08-21');
  pointer(row(a), 'pointerdown', 20, 20);
  await sleep(HOLD);
  pointer(row(a), 'pointerup', 20, 20);
  ok('もう一度長押しすると取り消せる', !logged(a), JSON.stringify(a.state().logs));
  ok('取り消すと今週の回数も戻る', row(a).querySelector('.tally').textContent === '今週 0 回',
     row(a).querySelector('.tally').textContent);
}
{
  const a = boot(base({}), '2026-08-21');
  pointer(row(a), 'pointerdown', 20, 20);
  await sleep(200);
  pointer(row(a), 'pointerup', 20, 20);
  await sleep(450);
  ok('途中で離せば記録されない', !logged(a), JSON.stringify(a.state().logs));
}
{
  // 指が動いたらスクロールの意図とみなす（タスク欄からページを送れなくならないように）
  const a = boot(base({}), '2026-08-21');
  pointer(row(a), 'pointerdown', 20, 20);
  pointer(row(a), 'pointermove', 22, 60);
  await sleep(HOLD);
  pointer(row(a), 'pointerup', 22, 60);
  ok('指を動かしたら記録しない', !logged(a), JSON.stringify(a.state().logs));
}
{
  const a = boot(base({}), '2026-08-21');
  pointer(row(a), 'pointerdown', 20, 20);
  pointer(row(a), 'pointermove', 24, 26);   // 10px 以内の揺れは押し続けているとみなす
  await sleep(HOLD);
  pointer(row(a), 'pointerup', 24, 26);
  ok('わずかな指の揺れでは中断しない', logged(a), JSON.stringify(a.state().logs));
}
{
  const a = boot(base({}), '2026-08-21');
  pointer(row(a), 'pointercancel', 20, 20);  // 押していないところに来ても壊れない
  pointer(row(a), 'pointerdown', 20, 20);
  pointer(row(a), 'pointercancel', 20, 20);  // ブラウザがスクロールを引き取った
  await sleep(HOLD);
  ok('pointercancel で中断する', !logged(a), JSON.stringify(a.state().logs));
}
{
  // キーボードも押しっぱなしで記録する（操作を1つに揃える）
  const a = boot(base({}), '2026-08-21');
  const key = (el, type) => el.dispatchEvent(new a.w.KeyboardEvent(type, { key: 'Enter', bubbles: true }));
  key(row(a), 'keydown');
  await sleep(HOLD);
  ok('キーボードの押しっぱなしでも記録される', logged(a), JSON.stringify(a.state().logs));
}
{
  const a = boot(base({}), '2026-08-21');
  const el = row(a);
  el.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(200);
  el.dispatchEvent(new a.w.KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  await sleep(450);
  ok('途中でキーを離せば記録されない', !logged(a), JSON.stringify(a.state().logs));
}

console.log('\n― カレンダーの月表示 ―');
{
  const a = boot(base({}), '2026-08-21');
  ok('見出しに今月が出る', a.text('grid-title') === '8月', a.text('grid-title'));
  ok('見出しの右に年が出る', a.text('range') === '2026年', a.text('range'));
  const cells = [...a.w.document.querySelectorAll('.cell')];
  const days = cells.filter(c => !c.classList.contains('out'));
  ok('1日から月末までが並ぶ', days.map(day).join(',') === [...Array(31)].map((_, i) => i + 1).join(','), days.map(day).join(','));
  ok('記録がなければマスは日付のみ', cells.every(c => /^\d+$/.test(c.textContent)));
  // 2026-08-01 は土曜なので、前に7月の26〜31日が並ぶ
  const lead = cells.findIndex(c => !c.classList.contains('out'));
  ok('1日が曜日の列に揃う（土曜=6マス手前から）', lead === 6, String(lead));
  ok('前の月のマスに日付が出る', cells.slice(0, 6).map(day).join(',') === '26,27,28,29,30,31', cells.slice(0, 6).map(day).join(','));
  ok('後ろは翌月のマスで埋まる', cells.slice(37).map(day).join(',') === '1,2,3,4,5', cells.slice(37).map(day).join(','));
  ok('グリッドは7の倍数で埋まる', cells.length % 7 === 0, String(cells.length));
  ok('各週の右に結果列が1つずつある', a.w.document.querySelectorAll('#grid .wk').length === cells.length / 7, String(a.w.document.querySelectorAll('#grid .wk').length));
  const kids = [...a.w.document.getElementById('grid').children];
  ok('結果列は土曜のマスの直後に並ぶ', kids.every((e, i) => e.classList.contains(i % 8 === 7 ? 'wk' : 'cell')));
  const fresh = boot(base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-08-21' })] }), '2026-08-21');
  ok('今日使い始めたなら結果列はすべて空欄', marks(fresh).every(m => m === '') && [...fresh.w.document.querySelectorAll('#grid .wk')].every(e => e.textContent === ''));
}
{
  const a = boot(base({ logs: Object.assign(without(span('2026-07-26', '2026-08-08'), '2026-08-05')) }), '2026-08-21');
  const wk = [...a.w.document.querySelectorAll('#grid .wk')];
  ok('獲得の週は +1', wk[0].textContent === '+1', wk[0].textContent);
  ok('消費の週は −1', wk[1].textContent === '−1', wk[1].textContent);
  ok('リセットの週は ×', wk[2].textContent === '×' && wk[2].classList.contains('reset'), wk[2].textContent);
  ok('結果列に読み上げ用の説明がある', wk[1].getAttribute('aria-label') === 'シールドを1枚使って連続を維持した週', wk[1].getAttribute('aria-label'));
  ok('結果列は画像として読み上げられる', wk[1].getAttribute('role') === 'img', String(wk[1].getAttribute('role')));
}
{
  // 月末に近い日でも表示は同じ1か月分（月めくりはしない）
  const a = boot(base({}), '2026-08-28');
  ok('月末が近くても今月のまま', a.text('grid-title') === '8月' && a.w.document.querySelectorAll('.cell:not(.out)').length === 31, a.text('grid-title'));
}
{
  // 月初でも過去日は表示せず、その月だけを出す
  const a = boot(base({}), '2026-09-01');
  ok('月初は9月の30マス', a.text('grid-title') === '9月' && a.w.document.querySelectorAll('.cell:not(.out)').length === 30, a.text('grid-title'));
  ok('今日以外はすべて未来', a.w.document.querySelectorAll('.cell:not(.out).future').length === 29, String(a.w.document.querySelectorAll('.cell:not(.out).future').length));
  ok('前の月にはみ出した8月末は未来にしない', [...a.w.document.querySelectorAll('.cell.out')].slice(0, 2).every(c => !c.classList.contains('future')));
}

console.log('\n― 月めくり ―');
{
  const a = boot(base({}), '2026-08-21');
  const wd = [...a.w.document.querySelectorAll('.wd span')].map(e => e.textContent);
  ok('曜日の見出しは日曜が一番左', wd.join(',') === '日,月,火,水,木,金,土', wd.join(','));
}
{
  // 7月と8月に記録がある → 7月まで戻れる
  const a = boot(base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-07-03' })], logs: Object.assign(daysBack('2026-07-05', 3), daysBack('2026-08-21', 3)) }), '2026-08-21');
  const prev = a.w.document.getElementById('grid-prev');
  const next = a.w.document.getElementById('grid-next');
  ok('初期表示は今月', a.text('grid-title') === '8月', a.text('grid-title'));
  ok('今月では次の月へ進めない', next.disabled);
  ok('記録がある前月へは戻れる', !prev.disabled);
  prev.click();
  ok('前の月へめくれる', a.text('grid-title') === '7月' && a.text('range') === '2026年', a.text('grid-title'));
  ok('7月は31マス', a.w.document.querySelectorAll('.cell:not(.out)').length === 31, String(a.w.document.querySelectorAll('.cell:not(.out)').length));
  // 2026-07-01 は水曜なので、前に6月の28〜30日が並ぶ
  const cells = [...a.w.document.querySelectorAll('.cell')];
  ok('めくった先でも1日が曜日の列に揃う', cells.findIndex(c => !c.classList.contains('out')) === 3, String(cells.findIndex(c => !c.classList.contains('out'))));
  ok('めくった先も前の月のマスが出る', cells.slice(0, 3).map(day).join(',') === '28,29,30', cells.slice(0, 3).map(day).join(','));
  ok('過去の月では今日のマスが出ない', a.w.document.querySelectorAll('.cell.today').length === 0);
  ok('7月の達成が3マス', a.w.document.querySelectorAll('.cell.done').length === 3, String(a.w.document.querySelectorAll('.cell.done').length));
  ok('記録より前の月へは戻れない', a.w.document.getElementById('grid-prev').disabled);
  a.w.document.getElementById('grid-next').click();
  ok('次の月で今月に戻れる', a.text('grid-title') === '8月', a.text('grid-title'));
  ok('今月に戻ると次へは進めない', a.w.document.getElementById('grid-next').disabled);
}
{
  // 今月使い始めて記録が1件もなければ、めくる先がない
  const a = boot(base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-08-21' })] }), '2026-08-21');
  ok('今月使い始めて記録がなければ両方とも押せない', a.w.document.getElementById('grid-prev').disabled && a.w.document.getElementById('grid-next').disabled);
}
{
  // 記録がなくても、使い始めた月まではさかのぼれる（判定済みの週を確かめ、記録し忘れを直せる）
  const a = boot(base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-07-20' })] }), '2026-08-21');
  ok('使い始めた月まではさかのぼれる', !a.w.document.getElementById('grid-prev').disabled);
  a.w.document.getElementById('grid-prev').click();
  ok('使い始めた月より前へは戻れない', a.text('grid-title') === '7月' && a.w.document.getElementById('grid-prev').disabled, a.text('grid-title'));
}
{
  // id に " が入っていても、長押しで記録したあとの演出が壊れない
  const tasks = [Object.assign({}, TASKS[0], { id: 't"1' })];
  const a = boot(base({ tasks }), '2026-08-21');
  const errors = []; a.w.addEventListener('error', e => errors.push(e.message));
  const el = a.w.document.querySelector('.task');
  el.dispatchEvent(new a.w.MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20 }));
  await new Promise(r => setTimeout(r, 650));
  el.dispatchEvent(new a.w.MouseEvent('pointerup', { bubbles: true, clientX: 20, clientY: 20 }));
  ok('id に " が入っていても記録でき、エラーにならない', JSON.stringify(a.state().logs['2026-08-21']) === '["t\\"1"]' && !errors.length,
     JSON.stringify(a.state().logs) + ' ' + errors.join('/'));
}
{
  // 時計が戻って登録日が今日より後になっても、ホームからは記録できる
  const a = boot(base({ tasks: [Object.assign({}, TASKS[0], { createdAt: '2026-08-22' })] }), '2026-08-21');
  ok('登録日が今日より後でもホームに出る', a.w.document.querySelectorAll('.task').length === 1, String(a.w.document.querySelectorAll('.task').length));
}
{
  // 今日記録した、今週の判定に入らないタスクをアーカイブすると「今日の間だけ残る」と伝える
  const tasks = [TASKS[0], { id: 't9', name: 'B', order: 1, archived: false, createdAt: '2026-08-19' }];
  const a = boot(base({ tasks, logs: Object.assign(span('2026-08-16', '2026-08-21'), { '2026-08-21': ['t1', 't9'] }) }), '2026-08-21');
  const msgs = []; a.w.confirm = m => { msgs.push(m); return true; };
  a.w.document.querySelectorAll('#task-editor .mini.danger')[1].click();
  ok('今日の記録があれば「今日の間だけ残る」と伝える', msgs[0].includes('今日の間だけ残ります'), msgs[0]);
  ok('実際に今日の間はホームに残る', [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent).join(',') === 'スクワット10回,B（アーカイブ済み）',
     [...a.w.document.querySelectorAll('.task .name')].map(e => e.textContent).join(','));
}
{
  // 達成日数も、使い始めた日より前の記録は数えない（連続日数とそろえる）
  const tasks = [
    { id: 'a', name: 'A', order: 0, archived: true, createdAt: '2026-08-17', archivedAt: '2026-08-17' },
    Object.assign({}, TASKS[0], { order: 1, createdAt: '2026-08-19' })
  ];
  const a = boot(base({ tasks, logs: Object.assign({ '2026-08-17': ['a'] }, span('2026-08-19', '2026-08-21')) }), '2026-08-21');
  ok('使い始めた日より前の記録は達成日数に数えない', stats(a).days === '3 日' && stats(a).best === '3 日', JSON.stringify(stats(a)));
}
{
  // 数値の id や、配列でない1件だけの記録でも、タスクと記録を失わない
  const a = boot(base({ tasks: [{ id: 1, name: 'スクワット', order: 0, archived: false, createdAt: '2026-08-16' }],
    logs: Object.assign(span('2026-08-16', '2026-08-20', [1]), { '2026-08-21': 1 }) }), '2026-08-21');
  ok('数値の id でもタスクと記録を読み込める', a.w.document.querySelectorAll('.task').length === 1 && a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
  a.w.document.querySelector('.cell.today').click();
  ok('読み込んだ記録はシートで操作できる', a.w.document.querySelector('#sheet-body .toggle').classList.contains('on'), a.text('sheet-body'));
}
{
  // 登録日が文字列でなくても読み込みで落ちず、ほかのデータが消えない
  const tasks = [Object.assign({}, TASKS[0], { createdAt: ['2026-08-16'] }), Object.assign({}, TWO[1], { createdAt: '2026-08-16' })];
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21', ['t1', 't2']) }), '2026-08-21');
  ok('文字列でない登録日があってもデータを読み込める', a.w.document.querySelectorAll('.task').length === 2 && a.html('hero').includes('class="bignum">6<'), a.html('hero').slice(0, 80));
}
{
  // 登録日の年が壊れていても、使い始めた日が大昔にならない
  const tasks = [Object.assign({}, TASKS[0], { createdAt: '1026-10-01' }), Object.assign({}, TWO[1], { createdAt: '2026-08-16' })];
  const t0 = Date.now();
  const a = boot(base({ tasks, logs: span('2026-08-16', '2026-08-21', ['t2']) }), '2026-08-21');
  ok('壊れた登録日は持たない', !('createdAt' in a.w.eval('state').tasks.find(x => x.id === 't1')), JSON.stringify(a.w.eval('state').tasks));
  ok('使い始めた日は正しい登録日から', marks(a).every(m => m === '') && a.html('hero').includes('class="bignum">6<'), marks(a).join(',') + ' ' + (Date.now() - t0) + 'ms');
}
{
  // 登録した日にアーカイブしたタスクは、記録があっても打ち間違い扱い（記録の足し引きで起点が動かないように）
  const tasks = [
    { id: 'a', name: 'A', order: 0, archived: true, createdAt: '2026-08-19', archivedAt: '2026-08-19' },
    Object.assign({}, TASKS[0], { order: 1, createdAt: '2026-08-20' })
  ];
  const a = boot(base({ tasks, logs: Object.assign({ '2026-08-19': ['a'] }, span('2026-08-20', '2026-08-21')) }), '2026-08-21');
  ok('登録した日にアーカイブしたタスクは、記録があっても使い始めた日に数えない', a.html('hero').includes('class="bignum">2<'), a.html('hero').slice(0, 80));
}
{
  // 記録を足しても使い始めた日は動かず、過去の週の結果が悪くならない
  const tasks = [
    { id: 'a', name: 'A', order: 0, archived: true, createdAt: '2026-08-17', archivedAt: '2026-08-17' },
    Object.assign({}, TASKS[0], { order: 1, createdAt: '2026-08-19' })
  ];
  const without_ = boot(base({ tasks, logs: span('2026-08-19', '2026-08-22') }), '2026-08-23');
  const with_ = boot(base({ tasks, logs: Object.assign({ '2026-08-17': ['a'] }, span('2026-08-19', '2026-08-22')) }), '2026-08-23');
  ok('打ち間違いタスクの記録があってもなくても週の結果は同じ', marks(without_)[3] === 'earn' && marks(with_)[3] === 'earn', marks(without_).join(',') + ' / ' + marks(with_).join(','));
}
{
  // アプリの関数がブラウザの window.history を上書きしない
  const a = boot(base({}), '2026-08-21');
  ok('window.history はブラウザのまま', typeof a.w.history === 'object' && typeof a.w.history.pushState === 'function', typeof a.w.history);
}
{
  // めくった先の過去日も編集できる
  const a = boot(base({ logs: daysBack('2026-07-05', 3) }), '2026-08-21');
  a.w.document.getElementById('grid-prev').click();
  const cell = [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '10');
  cell.click();
  ok('めくった先の日付でシートが開く', a.text('sheet-date') === '7月10日（金）', a.text('sheet-date'));
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('めくった先の日を記録できる', !!a.state().logs['2026-07-10'], JSON.stringify(a.state().logs));
  ok('記録しても表示中の月は動かない', a.text('grid-title') === '7月', a.text('grid-title'));
}

console.log('\n― 消化数バッジ ―');
{
  // 8/21 は3個、8/20 は1個、8/19 は未達
  const a = boot(base({
    tasks: [
      { id: 't1', name: 'スクワット', order: 0, archived: false, createdAt: '2026-01-01' },
      { id: 't2', name: '読書', order: 1, archived: false, createdAt: '2026-01-01' },
      { id: 't3', name: '日記', order: 2, archived: false, createdAt: '2026-01-01' }
    ],
    // 8/22 は未来。復元データ由来の未来日ログでもバッジを出さないことを確かめる
    logs: { '2026-08-20': ['t1'], '2026-08-21': ['t1', 't2', 't3'], '2026-08-22': ['t1'] }
  }), '2026-08-21');
  // 再描画のたびにマスは作り直されるので、毎回引き直す
  const at = n => [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === String(n));

  ok('複数消化した日にその個数が出る', badge(at(21)) === '3', String(badge(at(21))));
  ok('1個の日にも数が出る', badge(at(20)) === '1', String(badge(at(20))));
  ok('未達の日にはバッジが出ない', badge(at(19)) === null, String(badge(at(19))));
  ok('未来の日にはバッジが出ない', badge(at(22)) === null, String(badge(at(22))));
  ok('バッジがあってもマスの日付は変わらない', day(at(21)) === '21', day(at(21)));
  ok('バッジの数だけ描画される', a.w.document.querySelectorAll('.cell .count').length === 2,
     String(a.w.document.querySelectorAll('.cell .count').length));

  // 記録すると即座に増える
  at(21).click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[0].click();  // t1 を取り消す
  ok('記録を取り消すとバッジも減る', badge(at(21)) === '2', String(badge(at(21))));
}
{
  // シールドで守った週の空白日も、消化していないのでバッジを出さない
  const a = boot(base({ logs: without(span('2026-07-26', '2026-08-21'), '2026-08-05') }), '2026-08-21');
  const gap = [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === '5');
  ok('前提：その週はシールド消費', marks(a)[1] === 'protect', marks(a).join(','));
  ok('シールドで守った週の空白日にはバッジが出ない', badge(gap) === null && !gap.classList.contains('done'), String(badge(gap)));
}
{
  // 前の月のマスでも同じように出る
  const a = boot(base({ logs: { '2026-07-31': ['t1'] } }), '2026-08-21');
  const out = [...a.w.document.querySelectorAll('.cell.out')].find(c => day(c) === '31');
  ok('前の月のマスにもバッジが出る', badge(out) === '1', String(badge(out)));
}

console.log('\n― 前後の月のマス ―');
{
  const a = boot(base({ logs: daysBack('2026-07-31', 4) }), '2026-08-21');
  const out = [...a.w.document.querySelectorAll('.cell.out')];
  ok('前の月の達成もそのまま出る', out.filter(c => c.classList.contains('done')).length === 4, String(out.filter(c => c.classList.contains('done')).length));
  ok('翌月のマスは未来として扱う', out.filter(c => day(c) === '1')[0].classList.contains('future'));
  // 7月31日のマス（8月のカレンダーの先頭行）を押して取り消す
  out.find(c => day(c) === '31').click();
  ok('前の月のマスからシートを開ける', a.text('sheet-date') === '7月31日（金）', a.text('sheet-date'));
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('前の月のマスから記録を取り消せる', !a.state().logs['2026-07-31'], JSON.stringify(a.state().logs));
  ok('表示中の月は8月のまま', a.text('grid-title') === '8月', a.text('grid-title'));
}

console.log('\n― テーマ ―');
{
  const a = boot(base({}), '2026-08-21');
  ok('既定はシステム追従（data-theme を付けない）', !a.w.document.documentElement.hasAttribute('data-theme'));
  a.w.document.getElementById('nav-settings').click();
  ok('設定のセレクトが system', a.w.document.getElementById('theme').value === 'system');

  const sel = a.w.document.getElementById('theme');
  sel.value = 'dark'; sel.dispatchEvent(new a.w.Event('change'));
  ok('ダークを選ぶと data-theme="dark" になる', a.w.document.documentElement.getAttribute('data-theme') === 'dark');
  ok('選択が保存される', a.state().settings.theme === 'dark', JSON.stringify(a.state().settings));

  sel.value = 'light'; sel.dispatchEvent(new a.w.Event('change'));
  ok('ライトを選ぶと data-theme="light" になる', a.w.document.documentElement.getAttribute('data-theme') === 'light');

  sel.value = 'system'; sel.dispatchEvent(new a.w.Event('change'));
  ok('システムに戻すと data-theme が外れる', !a.w.document.documentElement.hasAttribute('data-theme'));
}
{
  // 再起動しても保存したテーマが復元される（ちらつき防止のhead内スクリプト経由）
  const seed = base({}); seed.settings.theme = 'light';
  const a = boot(seed, '2026-08-21');
  ok('再起動後もライトが維持される', a.w.document.documentElement.getAttribute('data-theme') === 'light');
  ok('設定画面にも反映されている', (a.w.document.getElementById('nav-settings').click(), a.w.document.getElementById('theme').value === 'light'));
}

console.log('\n― 名称とコピー ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 3) }), '2026-08-21');
  ok('タイトルが Ember', a.w.document.title === 'Ember', a.w.document.title);
  ok('ホーム画面名が Ember', a.w.document.querySelector('meta[name="apple-mobile-web-app-title"]').content === 'Ember');
  const body = a.w.document.body.textContent;
  ok('「ひとつ押せばいい」が消えている', !body.includes('押せばいい'));
  ok('「また1日目」が消えている', !body.includes('また1日目'));
  ok('「まだやれる」が消えている', !body.includes('まだやれる'));
  ok('空白入りの「日 連 続」ではなくなっている', !body.includes('日 連 続'));
  ok('達成日の見出しは「今日やったこと」', a.text('tasks-title') === '今日やったこと', a.text('tasks-title'));
}
{
  const a = boot(base({ tasks: [] }), '2026-08-21');
  ok('未達日の見出しは「今日やること」', a.text('tasks-title') === '今日やること', a.text('tasks-title'));
  const empty = a.w.document.querySelector('.empty');
  ok('タスク未登録なら空状態を出す', !!empty);
  ok('空状態のコピーから説教が消えている', empty && !empty.textContent.includes('ばかばかしい'), empty && empty.textContent);
}

console.log('\n― 反応する色（連続日数に連動）―');
function ember(a) { return a.w.document.documentElement.style.getPropertyValue('--ember'); }
function heat(a) { return parseFloat(a.w.document.documentElement.style.getPropertyValue('--heat')); }
{
  const a0 = boot(base({ tasks: TASKS }), '2026-08-21');                       // 連続0
  const a7 = boot(base({ logs: daysBack('2026-08-21', 7) }), '2026-08-21');    // 連続7
  const a40 = boot(base({ logs: daysBack('2026-08-21', 40) }), '2026-08-21');  // 連続40

  ok('--ember が設定される', /^rgb\(\d+,\d+,\d+\)$/.test(ember(a0)), ember(a0));
  ok('連続0日と7日で色が変わる', ember(a0) !== ember(a7), ember(a0) + ' / ' + ember(a7));
  ok('7日と40日でさらに変わる', ember(a7) !== ember(a40), ember(a7) + ' / ' + ember(a40));

  // ライト側は連続が伸びるほど暗く沈む
  const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.299 * r + 0.587 * g + 0.114 * b; };
  ok('ライトでは連続が伸びるほど色が深く沈む', lum(ember(a40)) < lum(ember(a7)) && lum(ember(a7)) < lum(ember(a0)),
    [lum(ember(a0)), lum(ember(a7)), lum(ember(a40))].map(Math.round).join(' → '));

  ok('--heat が 0 から始まる', heat(a0) === 0, String(heat(a0)));
  ok('--heat が 30日で上限1になる', heat(a40) === 1, String(heat(a40)));
  ok('--heat が途中で中間値をとる', heat(a7) > 0 && heat(a7) < 1, String(heat(a7)));
  ok('派生変数も同時に設定される',
    !!a7.w.document.documentElement.style.getPropertyValue('--ember-soft') &&
    !!a7.w.document.documentElement.style.getPropertyValue('--ember-glow'));
}
{
  // ダークはランプが逆向き（伸びるほど明るく燃える）
  const seed = base({ logs: daysBack('2026-08-21', 40) }); seed.settings.theme = 'dark';
  const dark40 = boot(seed, '2026-08-21');
  const seed7 = base({ logs: daysBack('2026-08-21', 7) }); seed7.settings.theme = 'dark';
  const dark7 = boot(seed7, '2026-08-21');
  const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.299 * r + 0.587 * g + 0.114 * b; };
  ok('ダークでは連続が伸びるほど明るく燃える', lum(ember(dark40)) > lum(ember(dark7)),
    Math.round(lum(dark7 && lum ? ember(dark7) : '')) + ' → ' + Math.round(lum(ember(dark40))));

  // テーマを切り替えるとランプも切り替わる
  const sel = dark40.w.document.getElementById('theme');
  const before = ember(dark40);
  sel.value = 'light'; sel.dispatchEvent(new dark40.w.Event('change'));
  ok('テーマ変更でランプが切り替わる', ember(dark40) !== before, before + ' → ' + ember(dark40));
}
{
  // 記録した瞬間に色と熱量が更新される
  const a = boot(base({ logs: daysBack('2026-08-20', 6) }), '2026-08-21');
  const before = ember(a), hBefore = heat(a);
  const todayCell = [...a.w.document.querySelectorAll('.cell')].find(c => c.classList.contains('today'));
  todayCell.click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('記録すると色が更新される', ember(a) !== before, before + ' → ' + ember(a));
  ok('記録すると熱量が上がる', heat(a) > hBefore, hBefore + ' → ' + heat(a));
}

console.log('\n― Editorial の構造 ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 13) }), '2026-08-21');
  ok('マストヘッドが出ている', !!a.w.document.querySelector('.masthead'));
  ok('達成日は bignum を使う', !!a.w.document.querySelector('.bignum'));
  ok('サブ数値が3つ並ぶ', a.w.document.querySelectorAll('.stat').length === 3);
  ok('達成の瞬間用のフラッシュ要素がある', !!a.w.document.getElementById('flash'));
  ok('ダーク用のオーラ要素がある', !!a.w.document.getElementById('aura'));
}
{
  const a = boot(base({ logs: daysBack('2026-08-20', 4) }), '2026-08-21');
  ok('未達日は statline を使う', !!a.w.document.querySelector('.statline'));
  ok('未達日は bignum を出さない', !a.w.document.querySelector('.bignum'));
}

console.log('\n― ナビゲーション ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 3) }), '2026-08-21');
  const home = a.w.document.getElementById('nav-home');
  const setg = a.w.document.getElementById('nav-settings');

  ok('ホームにアイコンが入っている', !!home.querySelector('svg'));
  ok('設定にアイコンが入っている', !!setg.querySelector('svg'));
  ok('ラベルも残っている', home.textContent.includes('ホーム') && setg.textContent.includes('設定'));
  ok('アイコンは currentColor を継承する', a.w.document.querySelector('nav button svg').getAttribute('viewBox') === '0 0 24 24');
  ok('スクリーンリーダーからは隠す', [...a.w.document.querySelectorAll('nav button svg')].every(s => s.getAttribute('aria-hidden') === 'true'));

  ok('初期状態はホームが選択されている', home.classList.contains('on') && !setg.classList.contains('on'));
  setg.click();
  ok('設定に切り替わる', setg.classList.contains('on') && !home.classList.contains('on'));
  ok('設定画面が表示される', !a.w.document.getElementById('view-settings').classList.contains('hidden'));
  home.click();
  ok('ホームに戻れる', home.classList.contains('on') && !a.w.document.getElementById('view-home').classList.contains('hidden'));
}

console.log('\n' + '='.repeat(46));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
