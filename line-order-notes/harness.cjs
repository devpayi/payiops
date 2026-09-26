const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const CODE = require('path').join(__dirname, 'Code.gs');
const TOKEN = process.env.LINE_TOKEN || '';
const BOSS = 'Uboss00000000000000000000000000001';
const STAFF = 'Ustaff0000000000000000000000000002';
const GROUP = 'Cgroup000000000000000000000000001';

function makeEnv() {
  const store = {};       // sheet name -> rows
  const calls = [];       // captured LINE API calls
  const cache = new Map();
  const props = { CHANNEL_ACCESS_TOKEN: 'tok', BOSS_USER_ID: BOSS };
  const sheet = name => {
    const rows = store[name];
    return {
      getLastRow: () => rows.length,
      appendRow: arr => rows.push(arr.map(v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v))),
      deleteRows: (start, n) => { rows.splice(start - 1, n); },
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      getRange: (r, c, nr, nc) => ({
        getValues: () => {
          if (nr !== undefined && nr < 1) throw new Error('範囲の行数には 1 以上を指定してください。');
          const out = [];
          for (let i = 0; i < (nr || 1); i++) {
            const row = [];
            for (let j = 0; j < (nc || 1); j++) row.push((rows[r - 1 + i] || [])[c - 1 + j] ?? '');
            out.push(row);
          }
          return out;
        },
        setValue: v => { rows[r - 1][c - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; },
      }),
    };
  };
  const ss = {
    getSheetByName: n => (store[n] ? sheet(n) : null),
    insertSheet: n => { store[n] = []; return sheet(n); },
    deleteSheet: () => {},
  };
  const fmt = (date, tz, f) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
    return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const ctx = {
    console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, Map, Set, Promise, encodeURIComponent, decodeURIComponent,
    Logger: { log: m => calls.push({ log: m }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    ContentService: { createTextOutput: t => ({ text: t }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, atHour: () => t, nearMinute: () => t, everyDays: () => t, inTimezone: () => t, create: () => t }; return t; } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: fmt,
      parseDate: (s, tz, f) => new Date(s.replace(' ', 'T') + '+07:00'),
    },
    UrlFetchApp: {
      fetch: (url, opts = {}) => {
        if (!opts.method || opts.method === 'get') {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ displayName: 'Mona' }) };
        }
        calls.push({ url, payload: JSON.parse(opts.payload) });
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CODE, 'utf8') + '\n;this.__api = { doPost, doGet, setupSheets, sendEveningSummary, sendMorningReminder, cell_, stripMentions_, openRows_};', ctx);
  ctx.__api.setupSheets();
  return { api: ctx.__api, store, calls, props };
}

let n = 0;
const eid = () => 'evt' + ++n;
const post = (env, events, query) => env.api.doPost({ parameter: query || {}, postData: { contents: JSON.stringify({ destination: 'Ubot', events }) } });
const mention = (text, name = '@เหมียวสั่งมา') => {
  const idx = text.indexOf(name);
  return { mentionees: [{ index: idx, length: name.length, type: 'user', userId: 'Ubot', isSelf: true }] };
};
const groupMsg = (text, o = {}) => ({
  type: 'message', webhookEventId: o.eid || eid(), replyToken: 'rt' + n,
  source: { type: 'group', groupId: o.group || GROUP, userId: o.user || STAFF },
  message: { type: 'text', id: o.mid || 'm' + n, text, ...(o.noMention ? {} : { mention: mention(text) }), ...(o.quoted ? { quotedMessageId: o.quoted } : {}) },
});
const direct = (text, user = BOSS) => ({ type: 'message', webhookEventId: eid(), replyToken: 'rt' + n, source: { type: 'user', userId: user }, message: { type: 'text', id: 'm' + n, text } });
const postback = (data, user = BOSS) => ({ type: 'postback', webhookEventId: eid(), replyToken: 'rt' + n, source: { type: 'user', userId: user }, postback: { data } });

const replies = env => env.calls.filter(c => c.url && c.url.endsWith('/reply'));
const pushes = env => env.calls.filter(c => c.url && c.url.endsWith('/push'));
const lastText = env => { const r = replies(env).pop(); return r && r.payload.messages[0].text; };
const reqRows = env => env.store.requests.slice(1);
const cardData = card => JSON.stringify(card);

async function validate(kind, messages, label) {
  if (!TOKEN) return 'skipped (no LINE_TOKEN)';
  const res = await fetch('https://api.line.me/v2/bot/message/validate/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ messages }) });
  const body = await res.text();
  assert.strictEqual(res.status, 200, label + ' invalid flex: ' + body);
  return 'ok';
}

const results = [];
const test = async (name, fn) => {
  try { const note = await fn(); results.push(['PASS', name, note || '']); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
};

(async () => {
  await test('first tag binds group + logs request with ONE reply (replyToken single-use)', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา สั่งกาแฟหน่อย')]);
    assert.strictEqual(env.store.groups.length, 2);
    assert.strictEqual(reqRows(env).length, 1);
    assert.strictEqual(reqRows(env)[0][5], 'สั่งกาแฟหน่อย');
    assert.strictEqual(replies(env).length, 1);
  });

  await test('bare first tag binds group, no request', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา')]);
    assert.strictEqual(env.store.groups.length, 2);
    assert.strictEqual(reqRows(env).length, 0);
    assert.strictEqual(replies(env).length, 1);
  });

  await test('mention at start/middle/end is stripped from stored text', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา a')]); // bind
    post(env, [groupMsg('@เหมียวสั่งมา เอาโฟมมาด้วย')]);
    post(env, [groupMsg('สั่งหมึกให้หน่อยงับ @เหมียวสั่งมา เอาฟ้าเยอะๆ')]);
    post(env, [groupMsg('สั่งหมึกสีฟ้าให้หน่อยงับ @เหมียวสั่งมา')]);
    const t = reqRows(env).map(r => r[5]);
    assert.deepStrictEqual(t, ['a', 'เอาโฟมมาด้วย', 'สั่งหมึกให้หน่อยงับ เอาฟ้าเยอะๆ', 'สั่งหมึกสีฟ้าให้หน่อยงับ']);
    assert.ok(t.every(x => !x.includes('@')));
    assert.strictEqual(lastText(env), 'จดแล้ว');
  });

  await test('ordinary chatter / other-user mention ignored', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา x')]);
    const before = env.calls.length;
    post(env, [groupMsg('คุยเล่นเฉยๆ', { noMention: true })]);
    const other = groupMsg('@somebody hi'); other.message.mention = { mentionees: [{ index: 0, length: 9, type: 'user', userId: 'Uother', isSelf: false }] };
    post(env, [other]);
    assert.strictEqual(env.calls.length, before);
    assert.strictEqual(reqRows(env).length, 1);
  });

  await test('duplicate webhookEventId (redelivery) stored once, replied once', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    const e = groupMsg('@เหมียวสั่งมา ของ1', { eid: 'dup1' });
    post(env, [e]); post(env, [e]);
    assert.strictEqual(reqRows(env).length, 2);
    assert.strictEqual(replies(env).length, 2);
  });

  await test('WEBHOOK_KEY enforced only when set', async () => {
    const env = makeEnv();
    env.props.WEBHOOK_KEY = 'secret123';
    post(env, [groupMsg('@เหมียวสั่งมา x')]);
    assert.strictEqual(env.store.groups.length, 1);
    post(env, [groupMsg('@เหมียวสั่งมา x')], { key: 'wrong' });
    assert.strictEqual(env.store.groups.length, 1);
    post(env, [groupMsg('@เหมียวสั่งมา x')], { key: 'secret123' });
    assert.strictEqual(env.store.groups.length, 2);
  });

  await test('text that Sheets would parse (=formula, 35-36, 1/2) is forced to text', async () => {
    const env = makeEnv();
    const { cell_ } = env.api;
    assert.strictEqual(cell_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
    assert.strictEqual(cell_('35-36'), "'35-36");
    assert.strictEqual(cell_('1/2'), "'1/2");
    assert.strictEqual(cell_('10'), "'10");
    assert.strictEqual(cell_('เอาโฟม 10'), 'เอาโฟม 10');
    post(env, [groupMsg('@เหมียวสั่งมา x')]);
    post(env, [groupMsg('@เหมียวสั่งมา 35-36')]);
    assert.strictEqual(reqRows(env)[1][5], '35-36');
  });

  await test('boss "ต้องสั่ง" -> valid flex card; non-boss ignored; empty -> text', async () => {
    const env = makeEnv();
    post(env, [direct('ต้องสั่ง')]);
    assert.strictEqual(lastText(env), 'ไม่มีรายการรอจัดการค่ะ');
    post(env, [groupMsg('@เหมียวสั่งมา สั่งกาแฟหน่อย')]);
    post(env, [groupMsg('@เหมียวสั่งมา เอาลัง')]);
    const before = replies(env).length;
    post(env, [direct('ต้องสั่ง', STAFF)]);
    assert.strictEqual(replies(env).length, before);
    post(env, [direct('ต้องสั่ง')]);
    const r = replies(env).pop();
    assert.strictEqual(r.payload.messages[0].type, 'flex');
    const s = cardData(r.payload.messages[0]);
    assert.ok(s.includes('สั่งกาแฟหน่อย') && s.includes('เอาลัง') && s.includes('Mona'));
    return await validate('reply', r.payload.messages, 'card');
  });

  await test('postbacks: order / pickup / cancel / snooze + stale version', async () => {
    const env = makeEnv();
    for (const t of ['a1', 'b2', 'c3', 'd4']) post(env, [groupMsg('@เหมียวสั่งมา ' + t)]);
    let rows = reqRows(env);
    const id = i => rows[i][0];
    post(env, [postback(`a=order&id=${id(0)}&v=1`)]);
    assert.strictEqual(reqRows(env)[0][6], 'ORDERED');
    assert.strictEqual(lastText(env), 'บันทึกว่าสั่งแล้ว', 'button replies state only the outcome, no command hints');
    post(env, [postback(`a=pickup&id=${id(1)}&v=1`)]);
    assert.strictEqual(reqRows(env)[1][6], 'PICKUP');
    post(env, [postback(`a=cancel&id=${id(2)}&v=1`)]);
    assert.strictEqual(reqRows(env)[2][6], 'CANCELLED');
    post(env, [postback(`a=snooze&id=${id(3)}&v=1`)]);
    const snoozed = reqRows(env)[3][9];
    assert.ok(snoozed instanceof Date && snoozed > new Date(), 'snoozed_until should be a future Date');
    assert.strictEqual(env.api.openRows_().length, 0);
    assert.strictEqual(lastText(env), 'เลื่อนเตือนถึงพรุ่งนี้ 17:00 น.');
    const before = replies(env).length;
    post(env, [postback(`a=order&id=${id(0)}&v=1`, STAFF)]); // non-boss
    assert.strictEqual(replies(env).length, before);
    post(env, [postback(`a=order&id=${id(3)}&v=99`)]); // stale
    assert.ok(lastText(env).includes('เปลี่ยนแปลงหรือจัดการไปแล้ว'));
    assert.strictEqual(reqRows(env)[3][6], 'OPEN');
  });

  await test('quote-edit by requester bumps version, clears snooze; old card button becomes stale', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    post(env, [groupMsg('@เหมียวสั่งมา ของเดิม', { mid: 'orig1', user: STAFF })]);
    const id = reqRows(env)[1][0];
    post(env, [postback(`a=snooze&id=${id}&v=1`)]);
    assert.ok(reqRows(env)[1][9] instanceof Date);
    post(env, [groupMsg('@เหมียวสั่งมา ของใหม่', { quoted: 'orig1', user: STAFF })]);
    let row = reqRows(env)[1];
    assert.strictEqual(row[5], 'ของใหม่'); assert.strictEqual(row[10], 2); assert.strictEqual(row[9], '');
    assert.strictEqual(lastText(env), 'แก้ไขแล้ว');
    post(env, [postback(`a=order&id=${id}&v=1`)]);
    assert.ok(lastText(env).includes('เปลี่ยนแปลงหรือจัดการไปแล้ว'));
    assert.strictEqual(reqRows(env)[1][6], 'OPEN');
  });

  await test('quote-cancel by boss/requester; stranger ignored; unknown quote handled', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    post(env, [groupMsg('@เหมียวสั่งมา x', { mid: 'q1', user: STAFF })]);
    const before = replies(env).length;
    post(env, [groupMsg('@เหมียวสั่งมา ยกเลิก', { quoted: 'q1', user: 'Ustranger00000000000000000000000009' })]);
    assert.strictEqual(lastText(env), 'แก้ไขหรือยกเลิกได้เฉพาะคนที่ขอหรือบอสค่ะ');
    assert.strictEqual(reqRows(env)[1][6], 'OPEN');
    post(env, [groupMsg('@เหมียวสั่งมา ยกเลิก', { quoted: 'q1', user: STAFF })]);
    assert.strictEqual(reqRows(env)[1][6], 'CANCELLED');
    assert.strictEqual(lastText(env), 'ยกเลิกแล้ว');
    const rowsBefore = reqRows(env).length;
    post(env, [groupMsg('@เหมียวสั่งมา สั่งอันนี้ด้วย', { quoted: 'not-a-request', user: STAFF })]);
    assert.strictEqual(reqRows(env).length, rowsBefore + 1, 'quoting a non-request message logs a new request');
    assert.strictEqual(lastText(env), 'จดแล้ว');
  });

  await test('"ทำแล้วทั้งหมด" closes only rows still at card version; skips edited/handled', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    for (const t of ['r1', 'r2', 'r3']) post(env, [groupMsg('@เหมียวสั่งมา ' + t, { mid: 'mid_' + t })]);
    post(env, [direct('ต้องสั่ง')]);
    const card = replies(env).pop().payload.messages[0];
    const footerBtn = card.contents.contents[0].footer.contents[0];
    assert.ok(footerBtn.action.data.length < 300, 'postback data must stay < 300 chars');
    post(env, [groupMsg('@เหมียวสั่งมา r2 แก้', { quoted: 'mid_r2', user: STAFF })]); // edited after card
    const rows = reqRows(env);
    post(env, [postback(`a=order&id=${rows[3][0]}&v=1`)]); // r3 handled after card
    post(env, [groupMsg('@เหมียวสั่งมา r4 ใหม่หลังการ์ด')]);
    post(env, [postback(footerBtn.action.data)]);
    const after = reqRows(env);
    const status = t => after.find(r => r[5].startsWith(t))[6];
    assert.strictEqual(status('bind'), 'DONE'); // a bind message was also a request ('bind')
    assert.strictEqual(status('r1'), 'DONE');
    assert.strictEqual(status('r2'), 'OPEN');
    assert.strictEqual(status('r3'), 'ORDERED');
    assert.strictEqual(status('r4'), 'OPEN');
    assert.strictEqual(lastText(env), 'ทำแล้ว 2 รายการ · ข้าม 2 รายการที่เปลี่ยนแปลงแล้ว');
  });

  await test('30 open requests: 15 per page + next-page bubble (offset paging); data<300', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    for (let i = 0; i < 29; i++) post(env, [groupMsg('@เหมียวสั่งมา งาน' + (i + 1))]);
    assert.strictEqual(env.api.openRows_().length, 30);
    post(env, [direct('ต้องสั่ง')]);
    const card = replies(env).pop().payload.messages[0];
    assert.strictEqual(card.contents.contents.length, 4, '3 cards of 5 + next-page bubble');
    const next = card.contents.contents[3].body.contents[0].action.data;
    assert.strictEqual(next, 'a=page&o=15');
    for (const b of card.contents.contents.slice(0, 3)) assert.ok(b.footer.contents[0].action.data.length < 300);
    const v = await validate('reply', [card], 'page1');
    post(env, [postback(next)]);
    const page2 = replies(env).pop().payload.messages[0];
    assert.strictEqual(page2.contents.contents.length, 3, 'last page has no next bubble');
    await validate('reply', [page2], 'page2');
    return v;
  });

  await test('very long task texts: every page stays under LINE 50KB and all tasks stay reachable', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    const long = 'สั่งของยาวมาก'.repeat(35);
    for (let i = 0; i < 24; i++) post(env, [groupMsg('@เหมียวสั่งมา ' + i + long)]);
    let offset = 0, seen = 0, pages = 0, note = '';
    const all = env.api.openRows_().length;
    let data = null;
    post(env, [direct('ต้องสั่ง')]);
    for (;;) {
      const card = replies(env).pop().payload.messages[0];
      const bytes = Buffer.byteLength(JSON.stringify(card));
      assert.ok(bytes <= 45000 + 3000, 'page ' + pages + ' is ' + bytes + ' bytes');
      const bubbles = card.contents.contents;
      const hasNext = bubbles[bubbles.length - 1].footer === undefined;
      const taskBubbles = hasNext ? bubbles.slice(0, -1) : bubbles;
      seen += taskBubbles.reduce((n, b) => n + b.body.contents.length, 0);
      note = await validate('reply', [card], 'long page ' + pages);
      pages++;
      if (!hasNext) break;
      post(env, [postback(bubbles[bubbles.length - 1].body.contents[0].action.data)]);
      assert.ok(pages < 20, 'paging did not terminate');
    }
    assert.strictEqual(seen, all, 'every task must appear on exactly one page');
    return pages + ' pages, ' + note;
  });

  await test('evening summary pushes valid card to boss only when open items exist', async () => {
    const env = makeEnv();
    env.api.sendEveningSummary();
    assert.strictEqual(pushes(env).length, 0);
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    env.api.sendEveningSummary();
    const p = pushes(env);
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].payload.to, BOSS);
    return await validate('push', p[0].payload.messages, 'push');
  });

  await test('morning reminder only includes items created before yesterday 17:00', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา old')]);
    post(env, [groupMsg('@เหมียวสั่งมา fresh')]);
    env.api.sendMorningReminder();
    assert.strictEqual(pushes(env).length, 0);
    env.store.requests[1][1] = new Date(Date.now() - 3 * 86400000);
    env.api.sendMorningReminder();
    const p = pushes(env);
    assert.strictEqual(p.length, 1);
    const s = cardData(p[0].payload.messages[0]);
    assert.ok(s.includes('old') && !s.includes('fresh'));
  });

  await test('non-text events (sticker, follow, unsend) do not crash or reply', async () => {
    const env = makeEnv();
    post(env, [{ type: 'message', webhookEventId: eid(), replyToken: 'x', source: { type: 'group', groupId: GROUP, userId: STAFF }, message: { type: 'sticker', id: '1' } },
      { type: 'follow', webhookEventId: eid(), replyToken: 'y', source: { type: 'user', userId: STAFF } },
      { type: 'unsend', webhookEventId: eid(), source: { type: 'group', groupId: GROUP, userId: STAFF }, unsend: { messageId: '1' } }]);
    assert.strictEqual(replies(env).length, 0);
    assert.ok(!env.calls.some(c => c.log));
  });

  await test('formula-injection text stored as text', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    post(env, [groupMsg('@เหมียวสั่งมา =HYPERLINK("http://evil","x")')]);
    assert.strictEqual(reqRows(env)[1][5], '=HYPERLINK("http://evil","x")');
  });

  await test('"myid" DM returns the sender own userId (boss or not); other DM text stays boss-only', async () => {
    const env = makeEnv();
    post(env, [direct('myid', STAFF)]);
    assert.ok(lastText(env).includes(STAFF));
    post(env, [direct('MyId', BOSS)]);
    assert.ok(lastText(env).includes(BOSS));
    const before = replies(env).length;
    post(env, [direct('ต้องสั่ง', STAFF)]);
    assert.strictEqual(replies(env).length, before);
  });

  await test('only the first group can bind; another group tagging is refused and logs nothing', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา งานร้านจริง')]);
    assert.strictEqual(env.store.groups.length, 2);
    post(env, [groupMsg('@เหมียวสั่งมา งานกลุ่มทดสอบ', { group: 'Cothergroup00000000000000000000009' })]);
    assert.strictEqual(env.store.groups.length, 2);
    assert.strictEqual(reqRows(env).length, 1);
    assert.strictEqual(lastText(env), 'กลุ่มนี้ยังไม่ได้เปิดใช้งานบอทสั่งของค่ะ');
    post(env, [groupMsg('@เหมียวสั่งมา งานร้านจริง2')]);
    assert.strictEqual(reqRows(env).length, 2);
  });

  await test('properly tagged messages never go unanswered: bare tag gets a hint', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    const before = replies(env).length;
    post(env, [groupMsg('@เหมียวสั่งมา')]);
    assert.strictEqual(replies(env).length, before + 1);
    assert.ok(lastText(env).includes('แท็กบอทแล้วพิมพ์ของที่ต้องสั่ง'));
    assert.strictEqual(reqRows(env).length, 1);
  });

  await test('"#สั่ง" fallback works without an @ mention; plain chatter and lookalikes are ignored', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    post(env, [groupMsg('#สั่ง กล่องส้น 10 ใบ', { noMention: true, mid: 'h1', user: STAFF })]);
    assert.strictEqual(reqRows(env).length, 2);
    assert.strictEqual(reqRows(env)[1][5], 'กล่องส้น 10 ใบ');
    assert.strictEqual(lastText(env), 'จดแล้ว');
    post(env, [groupMsg('/สั่งหมึกฟ้า', { noMention: true })]);
    assert.strictEqual(reqRows(env)[2][5], 'หมึกฟ้า');
    const before = env.calls.length;
    post(env, [groupMsg('สั่งข้าวกันไหม', { noMention: true })]);
    post(env, [groupMsg('เดี๋ยวพรุ่งนี้ #สั่ง ของ', { noMention: true })]);
    post(env, [groupMsg('คุยเล่น', { noMention: true })]);
    assert.strictEqual(env.calls.length, before);
    assert.strictEqual(reqRows(env).length, 3);
    post(env, [groupMsg('#สั่ง ยกเลิก', { noMention: true, quoted: 'h1', user: STAFF })]);
    assert.strictEqual(reqRows(env)[1][6], 'CANCELLED');
    post(env, [groupMsg('#สั่ง', { noMention: true })]);
    assert.ok(lastText(env).includes('แท็กบอทแล้วพิมพ์ของที่ต้องสั่ง') || lastText(env).includes('พิมพ์ของที่ต้องสั่ง'));
    post(env, [groupMsg('#สั่ง ของกลุ่มอื่น', { noMention: true, group: 'Cothergroup00000000000000000000009' })]);
    assert.strictEqual(lastText(env), 'กลุ่มนี้ยังไม่ได้เปิดใช้งานบอทสั่งของค่ะ');
    assert.strictEqual(reqRows(env).length, 3);
  });

  await test('boss can undo "สั่งแล้ว": DM "สั่งแล้ว" lists handled tasks; undo reopens, stale cards die; cancel works', async () => {
    const env = makeEnv();
    post(env, [direct('สั่งแล้ว')]);
    assert.ok(lastText(env).includes('ไม่มีรายการที่สั่งแล้ว'));
    post(env, [groupMsg('@เหมียวสั่งมา a1')]);
    post(env, [groupMsg('@เหมียวสั่งมา b2')]);
    post(env, [groupMsg('@เหมียวสั่งมา c3')]);
    const rows = () => reqRows(env);
    const id = i => rows()[i][0];
    post(env, [postback(`a=order&id=${id(0)}&v=1`)]);
    post(env, [postback(`a=pickup&id=${id(1)}&v=1`)]);
    assert.strictEqual(env.api.openRows_().length, 1);
    const before = replies(env).length;
    post(env, [direct('สั่งแล้ว', STAFF)]);
    assert.strictEqual(replies(env).length, before, 'non-boss gets nothing');
    post(env, [direct('สั่งแล้ว')]);
    const card = replies(env).pop().payload.messages[0];
    const s = cardData(card);
    const shown = [];
    JSON.stringify(card, (k, v) => { if (k === 'text' && typeof v === 'string') shown.push(v); return v; });
    assert.ok(shown.includes('a1') && shown.includes('b2') && !shown.includes('c3'), 'only handled tasks listed');
    assert.ok(s.includes('a=undo') && s.includes('รอไปเอา') && s.includes('ย้อนกลับ'));
    const note = await validate('reply', [card], 'handled card');
    post(env, [postback(`a=undo&id=${id(0)}&v=2`)]); // "order" now bumps version too (repeat taps must not re-fire)
    assert.strictEqual(rows()[0][6], 'OPEN');
    assert.strictEqual(rows()[0][10], 3);
    assert.strictEqual(lastText(env), 'ย้อนกลับแล้ว งานกลับไปอยู่ในรายการค้าง');
    assert.strictEqual(env.api.openRows_().length, 2);
    post(env, [postback(`a=undo&id=${id(0)}&v=2`)]);
    assert.ok(lastText(env).includes('เปลี่ยนแปลงหรือจัดการไปแล้ว'));
    post(env, [postback(`a=order&id=${id(0)}&v=1`)]);
    assert.ok(lastText(env).includes('เปลี่ยนแปลงหรือจัดการไปแล้ว'), 'the old open-card button is stale after undo');
    assert.strictEqual(rows()[0][6], 'OPEN');
    post(env, [postback(`a=cancel&id=${id(1)}&v=2`)]); // "pickup" bumped id(1) to version 2
    assert.strictEqual(rows()[1][6], 'CANCELLED');
    post(env, [postback(`a=undo&id=${id(2)}&v=1`)]);
    assert.strictEqual(rows()[2][6], 'OPEN', 'undo on a task that was never ordered changes nothing');
    assert.strictEqual(rows()[2][10], 1);
    return note;
  });

  await test('handled list only shows the last 7 days and pages with m=done', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    for (let i = 0; i < 20; i++) post(env, [groupMsg('@เหมียวสั่งมา งาน' + i)]);
    const all = reqRows(env);
    all.forEach(r => post(env, [postback(`a=order&id=${r[0]}&v=1`)]));
    env.store.requests[1][8] = new Date(Date.now() - 10 * 86400000);
    post(env, [direct('สั่งแล้ว')]);
    const card = replies(env).pop().payload.messages[0];
    const bubbles = card.contents.contents;
    const next = bubbles[bubbles.length - 1].body.contents[0].action.data;
    assert.strictEqual(next, 'a=page&o=15&m=done');
    assert.ok(!cardData(card).includes('งานที่ไม่มี') && !cardData(card).includes('"bind"'), 'old task excluded');
    post(env, [postback(next)]);
    const page2 = replies(env).pop().payload.messages[0];
    assert.ok(cardData(page2).includes('a=undo'));
    assert.strictEqual(page2.contents.contents.length, 1);
  });

  await test('"@บอท ยกเลิก" / "#สั่ง ยกเลิก" without a quoted request logs nothing and explains how', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    post(env, [groupMsg('@เหมียวสั่งมา ยกเลิก')]);
    assert.ok(lastText(env).includes('กดตอบกลับ (Reply)'));
    post(env, [groupMsg('#สั่ง ยกเลิก', { noMention: true })]);
    assert.ok(lastText(env).includes('กดตอบกลับ (Reply)'));
    assert.strictEqual(reqRows(env).length, 1, 'only the bind request exists');
  });

  await test('doGet reports the deployed version (so a deploy can be checked in a browser)', async () => {
    const env = makeEnv();
    assert.ok(/^ok \d{4}-\d{2}-\d{2}\.\d+$/.test(env.api.doGet({}).text));
  });

  const logText = env => (env.store.log || []).slice(1).map(r => r[1]).join('\n');

  await test('log tab: wrong/missing WEBHOOK_KEY is recorded as FORBIDDEN once per cause, right key is not', async () => {
    const env = makeEnv();
    env.props.WEBHOOK_KEY = 'k';
    post(env, [groupMsg('@เหมียวสั่งมา a')]);
    assert.ok(logText(env).includes('FORBIDDEN') && logText(env).includes('missing'));
    const n = env.store.log.length;
    for (let i = 0; i < 10; i++) post(env, [groupMsg('@เหมียวสั่งมา a')]);
    assert.strictEqual(env.store.log.length, n, 'repeats of the same rejection are not logged again');
    post(env, [groupMsg('@เหมียวสั่งมา a')], { key: 'nope' });
    assert.ok(logText(env).includes('wrong'));
    const before = env.store.log.length;
    post(env, [groupMsg('@เหมียวสั่งมา a')], { key: 'k' });
    assert.ok(!logText(env).split('\n').slice(before - 1).some(l => l.includes('FORBIDDEN')));
    assert.strictEqual(env.store.groups.length, 2);
  });

  await test('log tab: an internal error is recorded, the other events still run, LINE still gets ok', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    delete env.store.requests;
    const out = post(env, [groupMsg('@เหมียวสั่งมา งาน1'), direct('myid', STAFF)]);
    assert.strictEqual(out.text, 'ok');
    assert.ok(logText(env).includes('ERROR'), 'the failure must be visible in the log tab');
    assert.ok(lastText(env).includes(STAFF), 'the second event was still handled');
  });

  await test('chatter that does not call the bot touches no Sheet at all; a mistyped "#สัง" is logged; log stays bounded', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา bind')]);
    const snap = () => JSON.stringify([env.store.requests, env.store.groups, env.store.processed_events, env.store.log]);
    const before = snap();
    for (let i = 0; i < 20; i++) post(env, [groupMsg('คุยเล่นเฉยๆ ' + i, { noMention: true })]);
    const other = groupMsg('@somebody hi'); other.message.mention = { mentionees: [{ index: 0, length: 9, type: 'user', userId: 'Uother', isSelf: false }] };
    post(env, [other]);
    assert.strictEqual(snap(), before, 'no reads/writes for chatter or a mention of someone else');
    post(env, [groupMsg('#สัง ข้าว', { noMention: true })]);
    assert.ok(logText(env).includes('ignored'));
    for (let i = 0; i < 450; i++) post(env, [groupMsg('@เหมียวสั่งมา x' + i)]);
    assert.ok(env.store.log.length <= 401, 'log rows: ' + env.store.log.length);
  });

  await test('doPost run by hand (no event) does not throw', async () => {
    const env = makeEnv();
    assert.strictEqual(env.api.doPost(undefined).text, 'no event');
  });

  await test('every boss button reply is just the outcome: no command hints, no instructions', async () => {
    const env = makeEnv();
    post(env, [groupMsg('@เหมียวสั่งมา a1')]);
    post(env, [groupMsg('@เหมียวสั่งมา b2')]);
    post(env, [groupMsg('@เหมียวสั่งมา c3')]);
    post(env, [groupMsg('@เหมียวสั่งมา d4')]);
    const id = i => reqRows(env)[i][0];
    const texts = [];
    for (const a of ['order', 'pickup', 'snooze', 'cancel']) {
      post(env, [postback(`a=${a}&id=${id(texts.length)}&v=1`)]);
      texts.push(lastText(env));
    }
    post(env, [postback(`a=undo&id=${id(0)}&v=2`)]);
    texts.push(lastText(env));
    post(env, [postback(`a=order&id=${id(0)}&v=99`)]);
    texts.push(lastText(env));
    post(env, [direct('สั่งแล้ว')]);
    post(env, [postback(`a=all&ids=${id(2)}:1`)]);
    texts.push(lastText(env));
    assert.deepStrictEqual(texts.slice(0, 4), ['บันทึกว่าสั่งแล้ว', 'บันทึกว่ารอไปเอาแล้ว', 'เลื่อนเตือนถึงพรุ่งนี้ 17:00 น.', 'ยกเลิกแล้ว']);
    assert.strictEqual(texts[5], 'รายการนี้เปลี่ยนแปลงหรือจัดการไปแล้ว');
    for (const t of texts) assert.ok(!/พิมพ์|คำสั่ง/.test(t), 'no instructions in: ' + t);
  });

  for (const [s, name, note] of results) console.log(s.padEnd(5), name, note ? '— ' + note : '');
  console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' passed');
  process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
})();
