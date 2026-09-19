/**
 * MONA — LINE จดคำขอร้าน (Google Apps Script + Sheets)
 * เก็บทุก state ใน Sheet เดียวกับสคริปต์นี้ ไม่ต้องมีเซิร์ฟเวอร์แยก
 *
 * ตั้งค่าก่อนใช้งาน (Project Settings > Script properties):
 *   CHANNEL_ACCESS_TOKEN  = LINE Messaging API channel access token
 *   BOSS_USER_ID          = LINE userId ของบอส (U ตามด้วย hex 32 ตัว)
 *   WEBHOOK_KEY           = (ไม่บังคับ แต่แนะนำ) รหัสลับสุ่มยาวๆ ถ้าตั้งไว้ ต้องต่อท้าย
 *                           Webhook URL เป็น ...?key=<รหัส> ไม่งั้นโค้ดจะไม่รับ event
 *
 * แล้วรัน setupSheets() หนึ่งครั้ง, จากนั้น setupTriggers() หนึ่งครั้ง
 * Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone
 * เอา URL ไปวางเป็น Webhook URL ใน LINE Developers
 * (ปุ่ม Verify จะขึ้น "302 Found" เสมอ เพราะ Apps Script ตอบ redirect — ไม่กระทบการรับ event จริง)
 *
 * ข้อจำกัดที่ต้องรู้: Apps Script doPost ไม่เห็น HTTP header ของ request
 * จึงตรวจลายเซ็น X-Line-Signature (HMAC) ไม่ได้ ตัวป้องกันคือ URL ที่เดายาก
 * + WEBHOOK_KEY ด้านบน ไม่เหมาะกับบอทที่มีเงินจริงผูกอยู่
 */

const SHEET_REQUESTS = 'requests';
const SHEET_GROUPS = 'groups';
const SHEET_EVENTS = 'processed_events';
const TZ = 'Asia/Bangkok';
const STATUS_OPEN = 'OPEN', STATUS_ORDERED = 'ORDERED', STATUS_PICKUP = 'PICKUP',
      STATUS_DONE = 'DONE', STATUS_CANCELLED = 'CANCELLED';
const PAGE_SIZE = 15, MAX_FLEX_BYTES = 45000;
const C_RED = '#b81d2e', C_BLUE = '#1c5a9c', C_PALE = '#dbe6f3', C_BAND = '#e8ecf3',
      C_INK = '#1f2937', C_MUTED = '#8a94a3', C_WHITE = '#ffffff';

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_REQUESTS,
    ['id','created_at','requested_by_name','requested_by_id','group_id','text',
     'status','source_message_id','updated_at','snoozed_until','version']);
  ensureSheet_(ss, SHEET_GROUPS, ['group_id','bound_at']);
  ensureSheet_(ss, SHEET_EVENTS, ['event_id','processed_at']);
  ss.getSheetByName('Sheet1') && ss.deleteSheet(ss.getSheetByName('Sheet1'));
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendEveningSummary').timeBased().atHour(17).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('sendMorningReminder').timeBased().atHour(10).nearMinute(0).everyDays(1).inTimezone(TZ).create();
}

// ---------- webhook entry ----------

function doGet(e) {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  const webhookKey = prop_('WEBHOOK_KEY');
  if (webhookKey && (!e.parameter || e.parameter.key !== webhookKey)) {
    return ContentService.createTextOutput('forbidden');
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(handleEvent_);
  } catch (err) {
    Logger.log('doPost error: ' + err);
  } finally {
    try { lock.releaseLock(); } catch (err) { /* lock was never acquired */ }
  }
  return ContentService.createTextOutput('ok');
}

function handleEvent_(event) {
  const eventId = event.webhookEventId;
  if (eventId && alreadyProcessed_(eventId)) return;
  try {
    if (event.type === 'message' && event.message.type === 'text') handleMessage_(event);
    else if (event.type === 'postback') handlePostback_(event);
  } finally {
    if (eventId) markProcessed_(eventId);
  }
}

function alreadyProcessed_(eventId) {
  const sh = sheet_(SHEET_EVENTS);
  if (sh.getLastRow() < 2) return false;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat();
  return ids.includes(eventId);
}

function markProcessed_(eventId) {
  sheet_(SHEET_EVENTS).appendRow([eventId, new Date()]);
}

// ---------- message handling ----------

function handleMessage_(event) {
  const source = event.source, text = event.message.text || '';
  if (source.type === 'group') {
    const request = groupRequestText_(event, text);
    if (request === null) return; // ordinary chatter
    handleGroupRequest_(event, source.groupId, request);
  } else if (source.type === 'user') {
    handleDirect_(event, source.userId, text.trim());
  }
}

// A group message is meant for the bot when it @mentions the bot, or (fallback for LINE clients that
// do not list the bot in the @ picker) starts with "#สั่ง". Returns the request text, or null if neither.
function groupRequestText_(event, text) {
  const mention = event.message.mention;
  const mentioned = !!(mention && mention.mentionees && mention.mentionees.some(m => m.isSelf));
  const body = mentioned ? stripMentions_(text, mention) : text.trim();
  const trigger = /^[#＃\/]\s*สั่ง\s*([\s\S]*)$/.exec(body);
  if (trigger) return trigger[1].replace(/\s+/g, ' ').trim();
  return mentioned ? body : null;
}

function handleGroupRequest_(event, groupId, cleanText) {
  if (!isGroupBound_(groupId)) {
    if (sheet_(SHEET_GROUPS).getLastRow() > 1) { // one shop group only; a second group cannot bind itself
      reply_(event.replyToken, 'กลุ่มนี้ยังไม่ได้เปิดใช้งานบอทสั่งของค่ะ');
      return;
    }
    bindGroup_(groupId);
    if (cleanText) { // first tag can double as a request; a replyToken works only once
      addRequest_(event, groupId, cleanText);
      reply_(event.replyToken, 'ผูกกลุ่มร้านนี้เป็นกลุ่มแจ้งของแล้ว และจดแล้วค่ะ');
    } else {
      reply_(event.replyToken, 'ผูกกลุ่มร้านนี้เป็นกลุ่มแจ้งของแล้วค่ะ แท็กพร้อมของที่ต้องสั่งได้เลย');
    }
    return;
  }
  // Quoting (swipe-reply) an existing request edits/cancels it; quoting any other message is
  // just a habit, so that tag falls through and is logged as a new request.
  const quotedId = event.message.quotedMessageId;
  const quotedRow = quotedId ? findRowByMessageId_(quotedId) : null;
  if (quotedRow) {
    editOrCancel_(event, quotedRow, cleanText);
    return;
  }
  if (!cleanText) {
    reply_(event.replyToken, 'แท็กบอทแล้วพิมพ์ของที่ต้องสั่งต่อท้ายได้เลยค่ะ เช่น สั่งกล่องส้น 10 ใบ');
    return;
  }
  if (/^(ยกเลิก|cancel)$/i.test(cleanText)) { // a bare "cancel" with nothing quoted must not become a request
    reply_(event.replyToken, 'ถ้าจะยกเลิก ให้กดตอบกลับ (Reply) ข้อความคำขอเดิม แล้วพิมพ์ ยกเลิก ค่ะ');
    return;
  }
  addRequest_(event, groupId, cleanText);
  reply_(event.replyToken, 'จดแล้ว');
}

function stripMentions_(text, mention) {
  if (!mention || !mention.mentionees || !mention.mentionees.length) return text.trim();
  let out = text;
  mention.mentionees.slice().sort((a, b) => b.index - a.index).forEach(m => {
    out = out.slice(0, m.index) + out.slice(m.index + m.length);
  });
  return out.replace(/\s+/g, ' ').trim();
}

function addRequest_(event, groupId, text) {
  const sh = sheet_(SHEET_REQUESTS);
  const now = new Date();
  sh.appendRow([Utilities.getUuid(), now, cell_(displayName_(event.source)), event.source.userId, groupId, cell_(text),
    STATUS_OPEN, event.message.id, now, '', 1]);
}

// Sheets parses appended strings like typed input: "=..." becomes a formula and "35-36" or "1/2"
// becomes a date. A leading apostrophe forces plain text (and is not stored).
function cell_(value) {
  const s = String(value);
  return /^[=+\-@]/.test(s) || /^[\d\s\/.:,\-]+$/.test(s) ? "'" + s : s;
}

function editOrCancel_(event, row, newText) {
  const requesterId = row.values[3], bossId = prop_('BOSS_USER_ID');
  const actorId = event.source.userId;
  if (actorId !== requesterId && actorId !== bossId) {
    reply_(event.replyToken, 'แก้ไขหรือยกเลิกได้เฉพาะคนที่ขอหรือบอสค่ะ');
    return;
  }
  const sh = sheet_(SHEET_REQUESTS);
  const isCancel = !newText || /^(ยกเลิก|cancel)$/i.test(newText);
  if (isCancel) {
    sh.getRange(row.rowIndex, 7).setValue(STATUS_CANCELLED); // status
    sh.getRange(row.rowIndex, 9).setValue(new Date());        // updated_at
    reply_(event.replyToken, 'ยกเลิกแล้ว');
  } else {
    sh.getRange(row.rowIndex, 6).setValue(cell_(newText)); // text
    sh.getRange(row.rowIndex, 7).setValue(STATUS_OPEN);
    sh.getRange(row.rowIndex, 9).setValue(new Date());
    sh.getRange(row.rowIndex, 10).setValue('');        // clear snooze
    sh.getRange(row.rowIndex, 11).setValue(Number(row.values[10]) + 1); // version++
    reply_(event.replyToken, 'แก้ไขแล้ว');
  }
}

function handleDirect_(event, userId, text) {
  if (/^myid$/i.test(text)) { // lets anyone read their own LINE userId, e.g. to set BOSS_USER_ID
    reply_(event.replyToken, 'LINE userId ของคุณ: ' + userId);
    return;
  }
  if (userId !== prop_('BOSS_USER_ID')) return; // personal command is boss-only
  if (text === 'ต้องสั่ง') sendTaskCards_(event.replyToken, 0, openRows_(null), 'open');
  else if (text === 'สั่งแล้ว') sendTaskCards_(event.replyToken, 0, handledRows_(), 'done');
}

// ---------- postback (ปุ่มบนการ์ด) ----------

function handlePostback_(event) {
  if (event.source.userId !== prop_('BOSS_USER_ID')) return;
  const data = parsePostback_(event.postback.data);
  if (data.a === 'page') {
    const done = data.m === 'done';
    sendTaskCards_(event.replyToken, Number(data.o) || 0, done ? handledRows_() : openRows_(null), done ? 'done' : 'open');
    return;
  }
  if (data.a === 'all') {
    const result = closeCardBatch_(data.ids);
    reply_(event.replyToken, 'ทำแล้ว ' + result.changed + ' รายการ' +
      (result.skipped ? ' · ข้าม ' + result.skipped + ' รายการที่เปลี่ยนแปลงแล้ว' : ''));
    return;
  }
  const row = findRowById_(data.id);
  if (!row || String(row.values[10]) !== String(data.v)) {
    reply_(event.replyToken, 'รายการเปลี่ยนแปลงหรือจัดการไปแล้ว พิมพ์ "ต้องสั่ง" เพื่อดูรายการล่าสุด');
    return;
  }
  const sh = sheet_(SHEET_REQUESTS);
  const undoHint = ' (ย้อนกลับ: พิมพ์ "สั่งแล้ว")';
  const map = { order: [STATUS_ORDERED, 'บันทึกว่าสั่งแล้ว' + undoHint], pickup: [STATUS_PICKUP, 'บันทึกว่ารอไปเอาแล้ว ไม่ต้องยืนยันรับของ' + undoHint], cancel: [STATUS_CANCELLED, 'ยกเลิกแล้ว'] };
  if (data.a === 'undo') {
    if (row.values[6] !== STATUS_ORDERED && row.values[6] !== STATUS_PICKUP) {
      reply_(event.replyToken, 'รายการเปลี่ยนแปลงหรือจัดการไปแล้ว พิมพ์ "สั่งแล้ว" เพื่อดูรายการล่าสุด');
      return;
    }
    sh.getRange(row.rowIndex, 7).setValue(STATUS_OPEN);
    sh.getRange(row.rowIndex, 9).setValue(new Date());
    sh.getRange(row.rowIndex, 10).setValue('');
    sh.getRange(row.rowIndex, 11).setValue(Number(row.values[10]) + 1); // old cards for this row go stale
    reply_(event.replyToken, 'ย้อนกลับแล้ว งานกลับไปอยู่ในรายการค้าง');
    return;
  }
  if (data.a === 'snooze') {
    sh.getRange(row.rowIndex, 10).setValue(nextCutoff_());
    reply_(event.replyToken, 'เลื่อนเตือนถึงพรุ่งนี้ 17:00 น.');
    return;
  }
  const outcome = map[data.a];
  if (!outcome) return;
  sh.getRange(row.rowIndex, 7).setValue(outcome[0]);
  sh.getRange(row.rowIndex, 9).setValue(new Date());
  reply_(event.replyToken, outcome[1]);
}

// idsCsv = "id:version,id:version". Closes only rows still OPEN at the version shown on the card.
function closeCardBatch_(idsCsv) {
  const wanted = {};
  idsCsv.split(',').forEach(pair => { const [id, v] = pair.split(':'); wanted[id] = v; });
  const sh = sheet_(SHEET_REQUESTS);
  const data = sh.getDataRange().getValues();
  let changed = 0;
  for (let r = 1; r < data.length; r++) {
    const id = data[r][0];
    if (!(id in wanted)) continue;
    if (data[r][6] === STATUS_OPEN && String(data[r][10]) === String(wanted[id])) {
      sh.getRange(r + 1, 7).setValue(STATUS_DONE);
      sh.getRange(r + 1, 9).setValue(new Date());
      changed++;
    }
  }
  return { changed: changed, skipped: Object.keys(wanted).length - changed };
}

function parsePostback_(str) {
  const out = {};
  str.split('&').forEach(pair => { const [k, v] = pair.split('='); out[k] = decodeURIComponent(v); });
  return out;
}

// ---------- scheduled summaries ----------

function sendEveningSummary() { pushTaskCards_(openRows_(null)); }

function sendMorningReminder() {
  const cutoff = yesterdayCutoff_();
  const rows = openRows_(null).filter(r => new Date(r.values[1]) < cutoff);
  pushTaskCards_(rows);
}

function pushTaskCards_(rows) {
  if (!rows.length) return;
  callLine_('/v2/bot/message/push', { to: prop_('BOSS_USER_ID'), messages: [fitCarousel_(rows, 0).flex] });
}

function sendTaskCards_(replyToken, offset, allRows, mode) {
  if (offset >= allRows.length) {
    reply_(replyToken, mode === 'done' ? 'ไม่มีรายการที่สั่งแล้วใน 7 วันที่ผ่านมาค่ะ' : 'ไม่มีรายการรอจัดการค่ะ');
    return;
  }
  reply_(replyToken, null, [fitCarousel_(allRows, offset, mode).flex]);
}

// LINE rejects a carousel over 50 KB (silently, from the user's view), so page by real JSON size
// instead of a fixed task count. The "next page" button carries the offset of the first unseen task.
function fitCarousel_(allRows, offset, mode) {
  const rest = allRows.slice(offset);
  let n = Math.min(PAGE_SIZE, rest.length);
  for (;;) {
    const flex = buildCarousel_(rest.slice(0, n), rest.length > n ? offset + n : null, mode);
    if (n <= 5 || utf8Length_(JSON.stringify(flex)) <= MAX_FLEX_BYTES) return { flex: flex, shown: n };
    n -= 5;
  }
}

function utf8Length_(s) {
  return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, 'x').length;
}

function buildCarousel_(rows, nextOffset, mode) {
  const done = mode === 'done';
  const groups = chunk_(rows, 5);
  const bubbles = groups.map(group => ({
    type: 'bubble',
    size: 'giga',
    styles: { header: { backgroundColor: C_BAND }, footer: { backgroundColor: C_BAND } },
    header: {
      type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm',
      contents: [
        { type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', contents: [
          { type: 'box', layout: 'vertical', width: '10px', height: '10px', cornerRadius: '10px', backgroundColor: C_BLUE, contents: [] },
          { type: 'text', text: 'ULTRAMAN MISSIONS', weight: 'bold', size: 'sm', color: C_INK, flex: 1, wrap: true },
          { type: 'text', text: group.length + (done ? ' งาน · สั่งแล้ว' : ' งาน'), size: 'xs', color: C_MUTED },
        ]},
        { type: 'box', layout: 'vertical', height: '2px', backgroundColor: C_RED, contents: [] },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: group.map((r, i) => taskBlock_(r, i > 0, done)),
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm',
      contents: done ? [
        { type: 'text', text: 'ย้อนกลับ = กลับไปเป็นงานค้าง • ยกเลิก = เลิกงานนี้', size: 'xxs', color: C_MUTED, wrap: true },
      ] : [
        actionBox_('ทำแล้วทั้งหมด', C_RED, C_WHITE, 'sm', 'a=all&ids=' + group.map(r => r.values[0] + ':' + r.values[10]).join(',')),
        { type: 'text', text: 'ทำทั้งหมดเฉพาะการ์ดนี้ • เลื่อน = พรุ่งนี้ 17:00', size: 'xxs', color: C_MUTED, wrap: true },
      ],
    },
  }));
  if (nextOffset !== null && nextOffset !== undefined) bubbles.push({
    type: 'bubble',
    size: 'giga',
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', justifyContent: 'center', contents: [
      actionBox_('หน้าถัดไป', C_BLUE, C_WHITE, 'sm', 'a=page&o=' + nextOffset + (done ? '&m=done' : '')),
    ]},
  });
  return { type: 'flex', altText: (done ? 'รายการที่สั่งแล้ว ' : 'รายการค้าง ') + rows.length + ' งาน', contents: { type: 'carousel', contents: bubbles } };
}

const STATUS_LABEL = { ORDERED: 'สั่งแล้ว', PICKUP: 'รอไปเอา' };

function taskBlock_(r, withSeparator, done) {
  const id = r.values[0], v = r.values[10];
  const meta = (done ? (STATUS_LABEL[r.values[6]] || '') + ' · ' : '') + String(r.values[2]) + ' · ' +
    Utilities.formatDate(new Date(r.values[1]), TZ, 'dd/MM HH:mm');
  const title = { type: 'text', text: String(r.values[5]), wrap: true, weight: 'bold', size: 'md', color: C_INK, flex: 1 };
  const titleRow = done ? [title] : [title,
    { type: 'text', text: 'ยกเลิก', size: 'xs', color: C_MUTED, align: 'end', flex: 0, action: { type: 'postback', label: 'ยกเลิก', data: 'a=cancel&id=' + id + '&v=' + v } }];
  const buttons = done ? [
    actionBox_('ย้อนกลับ', C_BLUE, C_WHITE, 'xs', 'a=undo&id=' + id + '&v=' + v, 1),
    actionBox_('ยกเลิก', C_PALE, '#3b4a5f', 'xs', 'a=cancel&id=' + id + '&v=' + v, 1),
  ] : [
    actionBox_('สั่งแล้ว', C_RED, C_WHITE, 'xs', 'a=order&id=' + id + '&v=' + v, 1),
    actionBox_('รอไปเอา', C_BLUE, C_WHITE, 'xs', 'a=pickup&id=' + id + '&v=' + v, 1),
    actionBox_('เลื่อนเตือน', C_PALE, '#3b4a5f', 'xs', 'a=snooze&id=' + id + '&v=' + v, 1),
  ];
  const content = {
    type: 'box', layout: 'vertical', spacing: 'sm',
    contents: [
      { type: 'box', layout: 'horizontal', contents: titleRow },
      { type: 'text', text: meta, size: 'xxs', color: C_MUTED },
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: buttons },
    ],
  };
  return withSeparator ? { type: 'box', layout: 'vertical', margin: 'lg', spacing: 'lg', contents: [{ type: 'separator', color: '#d5dbe4' }, content] } : content;
}

// A box with a postback action instead of a `button`, because button labels have a fixed (large) font size.
function actionBox_(label, bg, fg, size, data, flex) {
  const box = {
    type: 'box', layout: 'vertical', backgroundColor: bg, cornerRadius: '6px',
    paddingTop: '10px', paddingBottom: '10px', justifyContent: 'center',
    action: { type: 'postback', label: label, data: data },
    contents: [{ type: 'text', text: label, align: 'center', weight: 'bold', size: size, color: fg }],
  };
  if (flex !== undefined) box.flex = flex;
  return box;
}

function chunk_(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- data access ----------

function openRows_(_unused) {
  const sh = sheet_(SHEET_REQUESTS);
  const data = sh.getDataRange().getValues();
  const now = new Date();
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const values = data[r];
    if (values[6] !== STATUS_OPEN) continue;
    if (values[9] && new Date(values[9]) > now) continue; // snoozed
    rows.push({ rowIndex: r + 1, values });
  }
  return rows;
}

// Requests the boss marked ordered / waiting-for-pickup in the last 7 days, newest first (for undo).
function handledRows_() {
  const cutoff = Date.now() - 7 * 86400000;
  const data = sheet_(SHEET_REQUESTS).getDataRange().getValues();
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const status = data[r][6];
    if ((status === STATUS_ORDERED || status === STATUS_PICKUP) && new Date(data[r][8]).getTime() >= cutoff) {
      rows.push({ rowIndex: r + 1, values: data[r] });
    }
  }
  return rows.sort((a, b) => new Date(b.values[8]) - new Date(a.values[8]));
}

function findRowByMessageId_(messageId) {
  const sh = sheet_(SHEET_REQUESTS);
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) if (data[r][7] === messageId) return { rowIndex: r + 1, values: data[r] };
  return null;
}

function findRowById_(id) {
  const sh = sheet_(SHEET_REQUESTS);
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) if (data[r][0] === id) return { rowIndex: r + 1, values: data[r] };
  return null;
}

function isGroupBound_(groupId) {
  const sh = sheet_(SHEET_GROUPS);
  if (sh.getLastRow() < 2) return false;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat();
  return ids.includes(groupId);
}

function bindGroup_(groupId) {
  sheet_(SHEET_GROUPS).appendRow([groupId, new Date()]);
}

function seventeenHundred_(dayOffset) {
  const day = Utilities.formatDate(new Date(Date.now() + dayOffset * 86400000), TZ, 'yyyy-MM-dd');
  return Utilities.parseDate(day + ' 17:00:00', TZ, 'yyyy-MM-dd HH:mm:ss');
}

function nextCutoff_() { return seventeenHundred_(1); }

function yesterdayCutoff_() { return seventeenHundred_(-1); }

// ---------- LINE API helpers ----------

function displayName_(source) {
  try {
    const path = source.type === 'group' ? '/v2/bot/group/' + source.groupId + '/member/' + source.userId : '/v2/bot/profile/' + source.userId;
    const res = UrlFetchApp.fetch('https://api.line.me' + path, { headers: { Authorization: 'Bearer ' + prop_('CHANNEL_ACCESS_TOKEN') } });
    return JSON.parse(res.getContentText()).displayName || 'ไม่ทราบชื่อ';
  } catch (e) { return 'ไม่ทราบชื่อ'; }
}

function reply_(replyToken, text, messages) {
  callLine_('/v2/bot/message/reply', { replyToken: replyToken, messages: messages || [{ type: 'text', text: text }] });
}

function callLine_(path, payload) {
  const res = UrlFetchApp.fetch('https://api.line.me' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    Logger.log('LINE API error ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}
