/* แบบฟอร์ม PDF ใบสมัครงาน/ประวัติพนักงาน — สร้างจาก "คำถามในฟอร์ม" เท่านั้น
 * กฎของบอส (2026-09-21): ทุกคำถามที่ wizard ถามต้องอยู่ในไฟล์ (ต่อให้ไม่บังคับ/ไม่มีคำตอบ ก็ปล่อยช่องว่าง)
 * และอะไรที่ wizard ไม่ได้ถาม ห้ามมีในไฟล์ (ไม่มี "ใบสมัครเลขที่", รูปถ่าย, เพศ, บัตรหมดอายุ, ลายเซ็น ฯลฯ)
 *
 * ไฟล์เดียวใช้ร่วมกัน 3 ที่ (ไม่ต้องแก้ 3 สำเนาอีกแล้ว):
 *   public/apply.html, public/employee.html  — <script src="/hr-pdf-form.js">
 *   src/pages/HRPeople.jsx                   — โหลด script นี้เองตอนเปิด drawer
 * ใช้: window.HRPdfForm.build(get, kind) -> HTML string  (kind = 'applicant' | 'employee')
 *   get(key) คืนค่าคำตอบของ key นั้น (string | array | array ของ object สำหรับ education_history/work_history)
 * ถ้าเพิ่ม/แก้คำถามใน wizard ต้องมาแก้ SECTIONS ตรงนี้ให้ตรงด้วย (key เดียวกับใน answers)
 */
(function () {
  var LV = ['ดีมาก', 'ดี', 'พอใช้', 'ไม่ได้'];
  var T = function (key, label, grow) { return { t: 't', key: key, label: label, grow: grow }; };
  var C = function (key, label, options) { return { t: 'c', key: key, label: label, options: options }; };
  var Y = function (key, label) { return { t: 'y', key: key, label: label }; };
  var F = function (key, label) { return { t: 'f', key: key, label: label }; };

  var TITLE = C('title', 'คำนำหน้า', ['นาย', 'นาง', 'นางสาว']);
  var PERSONAL = { title: 'ข้อมูลส่วนตัว', rows: [
    [TITLE],
    [T('full_name', 'ชื่อ-นามสกุล', 2), T('nickname', 'ชื่อเล่น')],
    [T('age', 'อายุ'), T('birth_date', 'วันเดือนปีเกิด')],
    [T('nationality', 'สัญชาติ'), T('ethnicity', 'เชื้อชาติ'), T('religion', 'ศาสนา')],
    [T('hometown', 'ภูมิลำเนาเดิม (จังหวัด)')],
  ] };
  var SIBLINGS = { title: 'พี่น้อง', rows: [[T('siblings', 'จำนวนพี่น้อง'), T('birth_order', 'เป็นบุตรคนที่')]] };
  var CONTACT = { title: 'ที่อยู่และการติดต่อ', rows: [
    [T('address', 'ที่อยู่ปัจจุบัน (บ้านเลขที่/ถนน/ซอย)', 3)],
    [T('sub_district', 'ตำบล/แขวง'), T('district', 'อำเภอ/เขต')],
    [T('province', 'จังหวัด'), T('postal_code', 'รหัสไปรษณีย์')],
    [T('mobile_phone', 'เบอร์มือถือ'), T('home_phone', 'โทรศัพท์บ้าน')],
    [T('email', 'Email')],
  ] };
  var FAMILY = { title: 'ที่พักอาศัย/ครอบครัว', rows: [
    [C('residence_type', 'ประเภทที่อยู่อาศัยปัจจุบัน', ['บ้านตัวเอง', 'บ้านญาติ', 'ห้องเช่า/บ้านเช่า', 'อื่นๆ'])],
    [T('residence_years', 'อาศัยมาแล้วกี่ปี')],
    [C('marital_status', 'สถานภาพครอบครัว', ['โสด', 'แต่งงาน', 'หย่าร้าง', 'แยกกันอยู่'])],
    [T('spouse_name', 'ชื่อคู่สมรส'), T('spouse_occupation', 'อาชีพคู่สมรส')],
    [T('children_count', 'จำนวนบุตร')],
  ] };
  var PARENTS = { title: 'ข้อมูลบิดา-มารดา', rows: [
    [T('father_name', 'ชื่อบิดา'), T('father_status', 'สถานะบิดา / อาชีพ')],
    [T('father_address', 'ที่อยู่/จังหวัดบิดา')],
    [T('mother_name', 'ชื่อมารดา'), T('mother_status', 'สถานะมารดา / อาชีพ')],
    [T('mother_address', 'ที่อยู่/จังหวัดมารดา')],
  ] };
  var MILITARY = { title: 'สถานะทางการทหาร', rows: [[C('military_status', '', ['ได้รับการยกเว้น', 'ศึกษาวิชาทหาร (รด.)', 'ผ่านการเกณฑ์ทหารแล้ว', 'ไม่เกี่ยวข้อง/ไม่ระบุ'])]] };
  var EDUCATION = { title: 'ประวัติการศึกษา', rows: [
    [C('education_level', 'วุฒิการศึกษาสูงสุด', ['ต่ำกว่า ม.6', 'ม.6 / ปวช.', 'ปวส. / อนุปริญญา', 'ปริญญาตรี', 'ปริญญาโท', 'ปริญญาเอก', 'อื่นๆ'])],
    [{ t: 'table', key: 'education_history', minRows: 1, blankRows: 3, cols: [
      ['level', 'ระดับการศึกษา'], ['school', 'สถาบันการศึกษา'], ['major', 'สาขาวิชาเอก'], ['year', 'ปีที่จบการศึกษา'], ['gpa', 'เกรดเฉลี่ย'],
    ] }],
    [T('education_activities', 'กิจกรรม/รางวัลระหว่างการศึกษา', 3)],
    [T('favorite_subject', 'สาขาวิชาที่ชอบเป็นพิเศษ')],
  ] };
  var WORK = { title: 'ประสบการณ์การทำงาน', rows: [
    [C('has_work_experience', 'มีประสบการณ์การทำงานมาก่อนหรือไม่', ['ไม่มี', 'มี'])],
    [{ t: 'table', key: 'work_history', minRows: 2, blankRows: 5, cols: [
      ['company', 'ชื่อสถานประกอบการ'], ['salary', 'เงินเดือน'], ['from', 'ทำงานตั้งแต่ (เดือน/ปี)'], ['to', 'ถึง (เดือน/ปี)'],
      ['position', 'หน้าที่/ตำแหน่ง'], ['reason_left', 'สาเหตุที่ออก'],
    ] }],
  ] };
  var SKILLS = { title: 'ทักษะและความสามารถ', rows: [
    [C('english_speak', 'ภาษาอังกฤษ - การพูด', LV)],
    [C('english_read', 'ภาษาอังกฤษ - การอ่าน', LV)],
    [C('english_write', 'ภาษาอังกฤษ - การเขียน', LV)],
    [T('other_language', 'ภาษาอื่นๆ')],
    [C('office_skills', 'อุปกรณ์สำนักงานที่ใช้เป็น', ['เครื่องถ่ายเอกสาร', 'เครื่องปริ้นเตอร์/สแกนเนอร์', 'เครื่องรูดบัตร'])],
    [C('computer_level', 'ความสามารถใช้คอมพิวเตอร์', LV)],
    [C('computer_programs', 'โปรแกรม/เครื่องมือที่ใช้ได้', ['Excel', 'Word', 'PowerPoint', 'Canva', 'Google Docs/Sheets', 'โปรแกรมบัญชี', 'ระบบขายออนไลน์ (Shopee/TikTok Shop)', 'AI (ChatGPT ฯลฯ)', 'อื่นๆ'])],
  ] };

  var SECTIONS = {
    applicant: [
      { title: 'ตำแหน่งงาน', rows: [
        [T('position', 'ตำแหน่งงานที่สมัคร')],
        [T('expected_salary', 'เงินเดือนที่ต้องการ'), T('available_date', 'วันที่เริ่มงานได้')],
        [C('current_status', 'สถานภาพการทำงานปัจจุบัน', ['ว่างงาน', 'ทำงานประจำ', 'ทำงาน Part-Time', 'กำลังศึกษาอยู่'])],
      ] },
      { title: 'เอกสารที่เตรียมมา', rows: [[C('documents_ready', '', ['สำเนาบัตรประชาชน', 'สำเนาทะเบียนบ้าน', 'ใบรับรองวุฒิการศึกษา', 'หนังสือรับรองการทำงาน'])]] },
      PERSONAL, SIBLINGS, CONTACT, FAMILY,
      { title: 'สุขภาพและประวัติ', rows: [[Y('criminal_record', 'ประวัติอาชญากรรม')], [Y('health_condition', 'โรคประจำตัว')]] },
      PARENTS, MILITARY, EDUCATION, WORK, SKILLS,
      { title: 'บุคคลอ้างอิง', rows: [
        [T('reference_name', 'ชื่อบุคคลอ้างอิง / ความสัมพันธ์'), T('reference_occupation', 'อาชีพบุคคลอ้างอิง')],
        [T('reference_phone', 'เบอร์โทรบุคคลอ้างอิง'), T('heard_from', 'ทราบข่าวการสมัครงานจาก')],
      ] },
      { title: 'ยืนยันและส่งใบสมัคร', rows: [[{ t: 'ok', key: 'confirmed', label: 'ข้าพเจ้าขอรับรองว่าข้อมูลที่กรอกในใบสมัครนี้เป็นความจริงทุกประการ' }]] },
    ],
    employee: [
      { title: 'ตำแหน่งงาน', rows: [[T('position', 'ตำแหน่งงาน'), T('start_date', 'วันที่เริ่มงาน')]] },
      { title: 'เอกสารประจำตัว', rows: [
        [T('id_card_number', 'เลขบัตรประชาชน')],
        [F('id_card_photo', 'รูปบัตรประชาชน')],
        [T('house_registration_address', 'ที่อยู่ตามทะเบียนบ้าน', 3)],
        [F('house_registration_photo', 'รูปทะเบียนบ้าน')],
      ] },
      PERSONAL, SIBLINGS, CONTACT, FAMILY,
      { title: 'สุขภาพและประวัติ', rows: [
        [T('weight', 'น้ำหนัก (กก.)'), T('height', 'ส่วนสูง (ซม.)')],
        [C('blood_type', 'กรุ๊ปเลือด', ['A', 'B', 'AB', 'O', 'ไม่รู้'])],
        [Y('criminal_record', 'ประวัติอาชญากรรม')], [Y('health_condition', 'โรคประจำตัว')],
      ] },
      PARENTS, MILITARY, EDUCATION, WORK, SKILLS,
      { title: 'บุคคลอ้างอิง', rows: [
        [T('reference_name', 'ชื่อบุคคลอ้างอิง / ความสัมพันธ์'), T('reference_occupation', 'อาชีพบุคคลอ้างอิง')],
        [T('reference_phone', 'เบอร์โทรบุคคลอ้างอิง')],
      ] },
      { title: 'บัญชีธนาคาร', rows: [[T('bank_name', 'ธนาคาร'), T('bank_account_number', 'เลขบัญชี'), T('bank_account_name', 'ชื่อบัญชี')]] },
      { title: 'บุคคลที่ติดต่อได้กรณีฉุกเฉิน', rows: [[T('emergency_contact_name', 'ชื่อ'), T('emergency_contact_relation', 'ความสัมพันธ์'), T('emergency_contact_phone', 'เบอร์โทร')]] },
      { title: 'ยืนยันและส่งข้อมูล', rows: [[{ t: 'ok', key: 'confirmed', label: 'ข้าพเจ้าขอรับรองว่าข้อมูลที่กรอกเป็นความจริงทุกประการ' }]] },
    ],
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function str(v) { return v == null ? '' : (Array.isArray(v) ? v.join(', ') : String(v)).trim(); }
  function list(v) {
    if (Array.isArray(v)) return v.map(str).filter(Boolean);
    return str(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // ขนาดตัวอักษร/ช่องไฟ ปรับให้แต่ละฟอร์มเต็ม 2 หน้า A4 พอดี (ฟอร์มพนักงานยาวกว่า เลยเล็กกว่านิดหน่อย)
  // fs=ขนาดตัวอักษร px, lh=line-height, gap=ระยะระหว่างบรรทัดช่องกรอก, sec=ระยะระหว่างหัวข้อ, pad=padding เซลล์ตาราง
  var SCALES = {
    applicant: { fs: 12.5, lh: 1.6, gap: 5, sec: 6, pad: 3, rowh: 20 },
    employee: { fs: 14, lh: 1.8, gap: 9, sec: 11, pad: 5, rowh: 26 },
  };
  // ฟอร์มเปล่าไว้ปริ้นให้กรอกมือ — ช่องสูงขึ้น ตารางมีแถวว่างเพิ่ม ไม่ต้องพยายามให้พอดี 2-3 หน้า
  var BLANK_SCALES = {
    applicant: { fs: 13, lh: 1.9, gap: 14, sec: 14, pad: 6, rowh: 34, blank: true },
    employee: { fs: 13, lh: 1.85, gap: 11, sec: 11, pad: 5, rowh: 28, blank: true },
  };
  var S = SCALES.applicant;

  function blank(value, grow) {
    return '<span style="display:inline-block;border-bottom:1px dotted #333;min-width:70px;flex:' + (grow || 1) + ';padding:0 4px;font-weight:600;min-height:' + (S.blank ? '2.2em' : '1.5em') + ';overflow-wrap:anywhere">' + (esc(value) || '&nbsp;') + '</span>';
  }
  function chk(label, checked) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:14px"><span style="font-family:monospace;font-size:' + (S.fs + 2) + 'px">' + (checked ? '☑' : '☐') + '</span>' + esc(label) + '</span>';
  }
  function line(inner) {
    return '<div style="break-inside:avoid;display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px 8px;margin-bottom:' + S.gap + 'px;font-size:' + S.fs + 'px">' + inner + '</div>';
  }
  function table(cols, rows, minRows) {
    var data = rows.slice();
    while (data.length < minRows) data.push({});
    var head = cols.map(function (c) { return '<th style="border:1px solid #333;padding:' + S.pad + 'px 6px;background:#f1f5f9;font-weight:700">' + esc(c[1]) + '</th>'; }).join('');
    var body = data.map(function (r) {
      return '<tr style="break-inside:avoid">' + cols.map(function (c) { return '<td style="border:1px solid #333;padding:' + S.pad + 'px 6px;height:' + S.rowh + 'px">' + esc(r[c[0]]) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:' + (S.fs - 1) + 'px;margin-bottom:' + S.gap + 'px"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function renderItem(it, get) {
    var v = get(it.key);
    var label = it.label ? '<span>' + esc(it.label) + ' :</span>' : '';
    if (it.t === 't') return label + blank(str(v), it.grow);
    if (it.t === 'f') return label + blank(str(v) ? 'แนบไฟล์แล้ว' : '', 1);
    if (it.t === 'c') {
      var picked = list(v);
      return label + it.options.map(function (o) { return chk(o, picked.indexOf(o) >= 0); }).join('');
    }
    if (it.t === 'y') {
      var s = str(v), no = s === 'ไม่มี', yes = !!s && !no;
      return label + chk('ไม่มี', no) + chk('มี (ระบุ)', yes) + blank(yes ? s : '', 2);
    }
    if (it.t === 'ok') {
      var on = !!str(v) && str(v) !== 'false';
      return chk(it.label, on);
    }
    return '';
  }

  function build(get, kind, override) {
    var isEmp = kind === 'employee';
    S = Object.assign({}, (override && override.blank ? BLANK_SCALES : SCALES)[isEmp ? 'employee' : 'applicant'], override || {});
    var out = '<div style="font-family:-apple-system,\'Noto Sans Thai\',Arial,sans-serif;color:#111;font-size:' + S.fs + 'px;line-height:' + S.lh + '">' +
      '<div style="text-align:center;margin:0 0 ' + S.sec + 'px"><div style="font-size:' + (S.fs + 5) + 'px;font-weight:800">' + (isEmp ? 'ประวัติพนักงาน' : 'ใบสมัครงาน') + '</div>' +
      '<div style="font-size:' + (S.fs - 1) + 'px;color:#555">PAYI</div></div>';
    var secs = SECTIONS[isEmp ? 'employee' : 'applicant'];
    secs.forEach(function (sec, i) {
      // section สุดท้ายไม่เว้นล่าง — กัน margin ล้นหน้ากระดาษจนได้หน้าว่างต่อท้าย
      out += '<div style="' + (S.blank ? '' : 'break-inside:avoid;') + 'margin-bottom:' + (i === secs.length - 1 ? 0 : S.sec) + 'px"><div style="break-after:avoid;font-weight:700;margin:4px 0 ' + S.gap + 'px;border-bottom:1px solid #333">' + (i + 1) + '. ' + esc(sec.title) + '</div>';
      sec.rows.forEach(function (row) {
        if (row.length === 1 && row[0].t === 'table') {
          var it = row[0];
          var rows = get(it.key);
          if (!Array.isArray(rows)) rows = [];
          out += table(it.cols, rows.filter(function (r) { return r && typeof r === 'object'; }), S.blank ? it.blankRows || it.minRows : it.minRows);
          return;
        }
        out += line(row.map(function (it) {
          // ไม่มีข้อมูลในระบบว่าเลือก "มี/ไม่มี" ประสบการณ์ทำงาน — เดาจาก work_history ถ้า wizard ไม่ได้ส่งมา
          if (it.key === 'has_work_experience' && !str(get(it.key))) {
            var wh = get('work_history');
            return renderItem(it, function () { return Array.isArray(wh) && wh.length ? 'มี' : ''; });
          }
          return renderItem(it, get);
        }).join(''));
      });
      out += '</div>';
    });
    return out + '</div>';
  }

  window.HRPdfForm = { build: build };
})();
