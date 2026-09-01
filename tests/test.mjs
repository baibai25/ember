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

const TASKS = [{ id: 't1', name: 'スクワット10回', order: 0, archived: false }];
function base(over) {
  return Object.assign({
    version: 1, settings: { dayBoundaryHour: 4 }, tasks: TASKS,
    logs: {}, shieldsConsumed: {}.constructor === Object ? [] : [],
    meta: { lastCheckedDate: null, bestStreak: 0, lastBackupAt: null }
  }, over);
}
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
  // 一昨日まで達成、昨日が空白、シールドなし → 途切れて0
  const a = boot(base({ logs: daysBack('2026-08-19', 5) }), '2026-08-21');
  ok('昨日が空白でシールドなし → 連続0', a.html('hero').includes('>0</span> 日連続'), a.html('hero'));
}

console.log('\n― シールドの自動消費 ―');
{
  // 14日達成（=14pt=2枚）、昨日だけ未達 → 1枚消費して連続維持、日数は増えない
  const logs = daysBack('2026-08-19', 14);
  const a = boot(base({ logs }), '2026-08-21');
  const s = a.state();
  ok('未達1日をシールドで自動的に埋める', s.shieldsConsumed.length === 1 && s.shieldsConsumed[0] === '2026-08-20', JSON.stringify(s.shieldsConsumed));
  ok('シールド日は連続を維持するが日数は増えない（14のまま）', a.html('hero').includes('>14</span>'), a.html('hero').slice(0, 120));
}
{
  // 7日達成（=1枚）、未達が3日 → 埋め切れないので消費しない
  const logs = daysBack('2026-08-17', 7);
  const a = boot(base({ logs }), '2026-08-21');
  ok('埋め切れないときはシールドを浪費しない', a.state().shieldsConsumed.length === 0, JSON.stringify(a.state().shieldsConsumed));
  ok('その場合は連続0になる', a.html('hero').includes('>0</span> 日連続'));
}
{
  // 記録が1件もない新規ユーザー
  const a = boot(base({}), '2026-08-21');
  ok('新規ユーザーでシールド消費が走らない', a.state().shieldsConsumed.length === 0);
  ok('新規ユーザーは連続0', a.html('hero').includes('>0</span> 日連続'));
}

console.log('\n― ポイントとシールドの生成 ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 15) }), '2026-08-21');
  a.w.document.getElementById('nav-settings').click();
  ok('15日達成 → 累計15pt', a.text('s-pt') === '15', a.text('s-pt'));
  ok('15pt → シールド2枚', a.text('s-sh') === '2 枚', a.text('s-sh'));
  ok('次の1枚まで あと6日', a.html('hero').includes('あと 6 日'), a.html('hero'));
}

console.log('\n― 記録操作と巻き戻し ―');
{
  const a = boot(base({ logs: daysBack('2026-08-20', 3) }), '2026-08-21');
  // カレンダーで今日のセルを押して記録する
  const todayCell = [...a.w.document.querySelectorAll('.cell')].find(c => c.classList.contains('today'));
  todayCell.click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('カレンダー経由で今日を記録 → 4日連続', a.html('hero').includes('>4<'), a.html('hero').slice(0, 80));
  ok('自己ベストが更新される', a.state().meta.bestStreak === 4, String(a.state().meta.bestStreak));
}
{
  // シールドで守った日を後から「やってた」に直す → シールドが返却される
  const logs = daysBack('2026-08-19', 14);
  const a = boot(base({ logs }), '2026-08-21');
  ok('前提：シールドを1枚消費している', a.state().shieldsConsumed.length === 1);
  const cells = [...a.w.document.querySelectorAll('.cell')];
  const shieldCell = cells.find(c => c.classList.contains('shield'));
  ok('カレンダーにシールド表示が出ている', !!shieldCell);
  shieldCell.click();
  a.w.document.querySelector('#sheet-body .toggle').click();
  ok('達成に修正するとシールドが返却される', a.state().shieldsConsumed.length === 0, JSON.stringify(a.state().shieldsConsumed));
  ok('その日が達成としてカウントされ15日連続になる', a.html('hero').includes('>15<'), a.html('hero').slice(0, 80));
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
  a.w.confirm = () => true;
  a.w.document.querySelector('#task-editor .mini.danger').click();
  ok('削除はアーカイブであり物理削除ではない', a.state().tasks.length === 1 && a.state().tasks[0].archived === true, JSON.stringify(a.state().tasks));
}
{
  // アーカイブしても過去の記録と連続日数は残る
  const a = boot(base({ logs: daysBack('2026-08-21', 6), tasks: [{ id: 't1', name: '懸垂', order: 0, archived: true }] }), '2026-08-21');
  ok('アーカイブ後も連続日数は保持される', a.html('hero').includes('>6<'), a.html('hero').slice(0, 80));
}

console.log('\n― データ保存 ―');
{
  const a = boot(base({ logs: daysBack('2026-08-21', 2) }), '2026-08-21');
  ok('localStorageに書き込まれている', !!a.state().logs['2026-08-21']);
  ok('lastCheckedDateが今日で更新される', a.state().meta.lastCheckedDate === '2026-08-21', a.state().meta.lastCheckedDate);
}
{
  // 壊れたデータからの復旧
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
    beforeParse(w) { w.localStorage.setItem('ember.v1', '{壊れたJSON'); }
  });
  ok('壊れた保存データでもクラッシュしない', !!dom.window.document.getElementById('hero').textContent);
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

console.log('\n― タスクの通算回数 ―');
{
  const a = boot(base({
    tasks: [
      { id: 't1', name: 'スクワット', order: 0, archived: false },
      { id: 't2', name: '読書', order: 1, archived: false },
      { id: 't3', name: '日記', order: 2, archived: false }
    ],
    logs: { '2026-08-19': ['t1'], '2026-08-20': ['t1', 't2'], '2026-08-21': ['t1'] }
  }), '2026-08-21');
  // 再描画のたびに行は作り直されるので、毎回引き直す
  const tally = n => a.w.document.querySelectorAll('.task .tally')[n].textContent;

  ok('通算回数がタスクの行に出る', tally(0) === '3 回', tally(0));
  ok('タスクごとに独立して数える', tally(1) === '1 回', tally(1));
  ok('1度もやっていないタスクにも 0 を出す', tally(2) === '0 回', tally(2));

  // 過去日を編集すれば通算も追随する（連続日数と同じく毎回数え直しているため）
  const at = n => [...a.w.document.querySelectorAll('.cell:not(.out)')].find(c => day(c) === String(n));
  at(19).click();
  a.w.document.querySelectorAll('#sheet-body .toggle')[0].click();  // 8/19 の t1 を取り消す
  ok('過去日を取り消すと通算が減る', tally(0) === '2 回', tally(0));
  a.w.document.querySelectorAll('#sheet-body .toggle')[1].click();  // 8/19 に t2 を足す
  ok('過去日を足すと通算が増える', tally(1) === '2 回', tally(1));
}
{
  const a = boot(base({ logs: {} }), '2026-08-21');
  ok('記録が1件もなくても 0 回として出る', a.w.document.querySelector('.task .tally').textContent === '0 回',
     a.w.document.querySelector('.task .tally').textContent);
}
{
  // アーカイブされたタスクの記録は残るが、行そのものが出ない
  const a = boot(base({
    tasks: [{ id: 't1', name: 'スクワット', order: 0, archived: true }],
    logs: { '2026-08-21': ['t1'] }
  }), '2026-08-21');
  ok('アーカイブ済みのタスクは行ごと出ない', a.w.document.querySelectorAll('.task .tally').length === 0);
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
  ok('記録すると通算回数がその場で増える', row(a).querySelector('.tally').textContent === '1 回',
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
  ok('取り消すと通算回数も戻る', row(a).querySelector('.tally').textContent === '0 回',
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
  const a = boot(base({ logs: Object.assign(daysBack('2026-07-05', 3), daysBack('2026-08-21', 3)) }), '2026-08-21');
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
  // 記録が1件もなければ、めくる先がない
  const a = boot(base({}), '2026-08-21');
  ok('記録がなければ両方とも押せない', a.w.document.getElementById('grid-prev').disabled && a.w.document.getElementById('grid-next').disabled);
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
      { id: 't1', name: 'スクワット', order: 0, archived: false },
      { id: 't2', name: '読書', order: 1, archived: false },
      { id: 't3', name: '日記', order: 2, archived: false }
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
  // シールドで埋めた日は消化していないのでバッジを出さない
  const a = boot(base({ logs: daysBack('2026-08-19', 14) }), '2026-08-21');
  const shieldCell = [...a.w.document.querySelectorAll('.cell')].find(c => c.classList.contains('shield'));
  ok('前提：シールドのマスがある', !!shieldCell);
  ok('シールドの日にはバッジが出ない', badge(shieldCell) === null, String(badge(shieldCell)));
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
{
  // 旧バージョンの保存データ（themeキーなし）からの移行
  const old = { version:1, settings:{ dayBoundaryHour:4 }, tasks:TASKS, logs:daysBack('2026-08-21',3), shieldsConsumed:[], meta:{ lastCheckedDate:null, bestStreak:0, lastBackupAt:null } };
  const a = boot(old, '2026-08-21');
  ok('themeキーが無い古いデータでも壊れない', a.html('hero').includes('class="bignum">3<'), a.html('hero').slice(0,60));
  a.w.document.getElementById('nav-settings').click();
  ok('既定値の system が補われる', a.w.document.getElementById('theme').value === 'system');
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

console.log('\n― 旧バージョンからの移行 ―');
{
  const seed = base({ logs: daysBack('2026-08-21', 9) });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
    beforeParse(w) {
      const fixed = new Date('2026-08-21T12:00:00').getTime();
      const R = w.Date;
      w.Date = class extends R { constructor(...a){ return a.length ? new R(...a) : new R(fixed); } static now(){ return fixed; } };
      w.localStorage.setItem('tsuzukeru.v1', JSON.stringify(seed));   // 旧キーだけ存在する状態
    }
  });
  const w = dom.window;
  ok('旧キーのデータを引き継ぐ', w.document.getElementById('hero').innerHTML.includes('class="bignum">9<'), w.document.getElementById('hero').innerHTML.slice(0, 60));
  ok('新キーに移し替えられている', !!w.localStorage.getItem('ember.v1'));
  ok('旧キーは削除される', w.localStorage.getItem('tsuzukeru.v1') === null);
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
