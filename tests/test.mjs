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
  ok('深夜1時半は前日(8/21)扱いになる', todayCell && todayCell.textContent === '21', todayCell && todayCell.textContent);
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
  ok('カレンダーが35マス', a.w.document.querySelectorAll('.cell').length === 35, String(a.w.document.querySelectorAll('.cell').length));
  ok('達成マスが10個', a.w.document.querySelectorAll('.cell.done').length === 10, String(a.w.document.querySelectorAll('.cell.done').length));
  ok('未来のマスが操作不能', a.w.document.querySelectorAll('.cell.future').length > 0);
  ok('タスク行が描画される', a.w.document.querySelectorAll('.task').length === 1);
  ok('達成済みのタスクに done が付く', a.w.document.querySelector('.task').classList.contains('done'));
}

console.log('\n― カレンダーの月表示 ―');
{
  const a = boot(base({}), '2026-08-21');
  ok('期間ラベルが表示される', /^\d+\/\d+ – \d+\/\d+$/.test(a.text('range')), a.text('range'));
  const first = [...a.w.document.querySelectorAll('.cell.first')];
  ok('月初のマスに first が付く', first.length >= 1, String(first.length));
  ok('月初のマスは「8/1」形式で表示される', first.every(c => /^\d+\/1$/.test(c.textContent)), first.map(c => c.textContent).join(','));
  const normal = [...a.w.document.querySelectorAll('.cell:not(.first)')];
  ok('それ以外のマスは日付のみ', normal.every(c => /^\d+$/.test(c.textContent)));
}
{
  // 月をまたがない5週間でも期間ラベルは出る
  const a = boot(base({}), '2026-08-28');
  ok('月をまたがなくても期間ラベルは出る', a.text('range').includes('–'), a.text('range'));
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
