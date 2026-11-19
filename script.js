/* =========================================================
   注文書 作成ツール — script.js
   純粋なフロントエンドのみ。外部通信は行いません。
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     ユーティリティ
     --------------------------------------------------------- */

  // 全角英数字・記号を半角に正規化
  function toHalfWidth(str) {
    return String(str)
      .replace(/[！-～]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, ' ');
  }

  // 通貨文字列 → 数値
  function parseMoney(str) {
    if (str === null || str === undefined) return 0;
    var cleaned = toHalfWidth(String(str)).replace(/[^\d.-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  // 数値 → 千分位カンマ
  function comma(n) {
    var rounded = Math.round(n);
    var neg = rounded < 0;
    var s = String(Math.abs(rounded));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  // 数値 → ¥1,234
  function yen(n) {
    return '¥' + comma(n);
  }

  // 和暦の元号（新しい順）。start はその元号の開始年（西暦）。
  var ERAS = [
    { name: '令和', start: 2019 },
    { name: '平成', start: 1989 },
    { name: '昭和', start: 1926 },
    { name: '大正', start: 1912 },
    { name: '明治', start: 1868 }
  ];

  // 西暦年 → { name: '令和', year: 8 }（該当なしは null）
  function toWarekiYear(year) {
    for (var i = 0; i < ERAS.length; i++) {
      if (year >= ERAS[i].start) {
        return { name: ERAS[i].name, year: year - ERAS[i].start + 1 };
      }
    }
    return null;
  }

  // 書式設定（和暦 / 西暦）を取得
  function currentDateStyle() {
    var el = document.querySelector('input[name="dateStyle"]:checked');
    return el && el.value === 'wareki' ? 'wareki' : 'seireki';
  }

  // "2026-10-11" → "2026年10月11日" / 和暦時は "令和8年10月11日"（元年は「元年」）
  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;

    var year = Number(m[1]);
    var month = Number(m[2]);
    var day = Number(m[3]);

    if (currentDateStyle() === 'wareki') {
      var era = toWarekiYear(year);
      if (era) {
        return era.name + (era.year === 1 ? '元' : String(era.year)) + '年' + month + '月' + day + '日';
      }
    }
    return year + '年' + month + '月' + day + '日';
  }

  // 数量は小数第2位まで、整数ならそのまま
  function formatQty(n) {
    if (!isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function $(id) { return document.getElementById(id); }

  function todayISO() {
    return dateToISO(new Date());
  }

  function dateToISO(d) {
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // "2026-10-11" に n 日を足した ISO 文字列を返す
  function addDays(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + Number(n));
    return dateToISO(d);
  }

  /* ---------------------------------------------------------
     状態
     --------------------------------------------------------- */

  var rowSeq = 0;
  var rows = []; // { id, name, qty, unit, price }

  var DEFAULTS = {
    issuerName: '山田 太郎 / Yamada Design',
    issuerAddress: '〒150-0001\n東京都渋谷区神宮前1-2-3 サンプルビル5F',
    issuerPerson: '山田 太郎',
    issuerPhone: '090-1234-5678',
    issuerEmail: 'info@yamada-design.example',
    supplierName: '株式会社サンプル商会',
    supplierHonorific: '御中',
    supplierAddress: '〒541-0041\n大阪府大阪市中央区北浜1-2-3 サンプルビル2F',
    supplierPerson: '佐藤 様',
    subject: '事務所備品のご注文',
    orderNo: 'CHU-2026-001',
    deliveryPreset: '14',
    paymentPreset: '月末締め翌月末払い',
    paymentTerms: '月末締め翌月末払い（銀行振込・振込手数料は当方負担）',
    notes: '納入場所：弊社事務所（上記住所）\n納入方法：ヤマト運輸 着払い\n納品書・請求書は商品に同梱してください。',
    conditions: '納品物に不備があった場合は速やかにご連絡のうえ、交換をお願いいたします。\n本注文は注文番号単位で完結します。',
    taxRate: '10'
  };

  var DEFAULT_ROWS = [
    { name: 'オフィスチェア（型番：OC-210）', qty: 4, unit: '脚', price: 28000 },
    { name: 'A4 コピー用紙 500枚入', qty: 10, unit: '冊', price: 550 },
    { name: 'トナーカートリッジ（純正）', qty: 2, unit: '個', price: 8800 },
    { name: '設置・組み立て作業費', qty: 1, unit: '式', price: 12000 }
  ];

  /* ---------------------------------------------------------
     明細行の生成・操作
     --------------------------------------------------------- */

  function createRow(data) {
    rowSeq += 1;
    var row = {
      id: 'r' + rowSeq,
      name: data && data.name != null ? data.name : '',
      qty: data && data.qty != null ? data.qty : 1,
      unit: data && data.unit != null ? data.unit : '',
      price: data && data.price != null ? data.price : 0,
      rate: data && data.rate != null ? Number(data.rate) : currentTaxRate()
    };
    rows.push(row);
    return row;
  }

  function buildRowElement(row) {
    var el = document.createElement('div');
    el.className = 'row';
    el.dataset.id = row.id;
    el.innerHTML =
      '<input type="text" class="i-name" aria-label="品名・品番" placeholder="品名・品番">' +
      '<input type="text" class="i-qty num" aria-label="数量" inputmode="decimal" placeholder="1">' +
      '<input type="text" class="i-unit" aria-label="単位" placeholder="個">' +
      '<input type="text" class="i-price num" aria-label="単価（税抜）" inputmode="numeric" placeholder="0">' +
      '<select class="i-rate" aria-label="税率"><option value="10">10%</option><option value="8">8%</option></select>' +
      '<button type="button" class="btn btn-icon i-del" aria-label="この行を削除">' +
        '<svg viewBox="0 0 16 16" class="ic" aria-hidden="true">' +
          '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" ' +
          'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
      '</button>';

    el.querySelector('.i-name').value = row.name;
    el.querySelector('.i-qty').value = formatQty(row.qty);
    el.querySelector('.i-unit').value = row.unit;
    el.querySelector('.i-price').value = row.price ? comma(row.price) : '';
    el.querySelector('.i-rate').value = String(row.rate || 10);

    return el;
  }

  function addRowToDOM(data) {
    var row = createRow(data);
    var el = buildRowElement(row);
    $('rowsContainer').appendChild(el);
    return el;
  }

  function renderAllRows() {
    var container = $('rowsContainer');
    container.innerHTML = '';
    rows = [];
    rowSeq = 0;
    DEFAULT_ROWS.forEach(function (r) { addRowToDOM(r); });
  }

  function findRow(id) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  /* ---------------------------------------------------------
     計算（税率は全体で1つ）
     --------------------------------------------------------- */

  function currentTaxRate() {
    return $('taxRate').value === '8' ? 8 : 10;
  }

  function computeTotals() {
    var lines = rows.map(function (row) {
      return {
        row: row,
        amount: Math.round(row.qty * row.price),
        rate: Number(row.rate) === 8 ? 8 : 10
      };
    });

    var groups = { 10: { rate: 10, subtotal: 0, tax: 0 }, 8: { rate: 8, subtotal: 0, tax: 0 } };
    var subtotal = 0;
    lines.forEach(function (line) {
      if (line.amount <= 0) return;
      subtotal += line.amount;
      groups[line.rate].subtotal += line.amount;
    });
    [10, 8].forEach(function (r) { groups[r].tax = Math.floor(groups[r].subtotal * r / 100); });

    var used = [10, 8].map(function (r) { return groups[r]; }).filter(function (g) { return g.subtotal > 0; });
    return {
      lines: lines,
      groups: used,
      rate: used.length === 1 ? used[0].rate : 0,
      subtotal: subtotal,
      tax: groups[10].tax + groups[8].tax,
      grand: subtotal + groups[10].tax + groups[8].tax
    };
  }

  /* ---------------------------------------------------------
     プレビューの描画
     --------------------------------------------------------- */

  function placeholder(text) {
    return '<span class="ph">' + text + '</span>';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setOptionalText(el, value) {
    var text = String(value || '').trim();
    el.hidden = !text;
    el.textContent = text;
  }

  /* 書式（字体・太字）を紙面へ反映。日付の西暦/和暦は formatDate 側で参照。 */
  function applyDocStyle() {
    var paperEl = $('paper');
    if (!paperEl) return;

    var fontEl = document.querySelector('input[name="docFont"]:checked');
    var weightEl = document.querySelector('input[name="docWeight"]:checked');
    var font = fontEl ? fontEl.value : 'gothic';
    var isBold = !!weightEl && weightEl.value === 'bold';

    paperEl.classList.toggle('font-mincho', font === 'mincho');
    paperEl.classList.toggle('font-gothic', font !== 'mincho');
    paperEl.classList.toggle('doc-bold', isBold);
  }

  function renderPreview() {
    applyDocStyle();

    /* --- 注文元 --- */
    var issuerName = $('issuerName').value.trim();
    $('pvIssuerName').innerHTML = issuerName
      ? escapeHtml(issuerName)
      : placeholder('自社名・屋号を入力');

    setOptionalText($('pvIssuerAddress'), $('issuerAddress').value);
    setOptionalText($('pvIssuerPerson'), $('issuerPerson').value.trim() ? '担当：' + $('issuerPerson').value.trim() : '');
    setOptionalText($('pvIssuerPhone'), $('issuerPhone').value.trim() ? 'TEL：' + $('issuerPhone').value.trim() : '');
    setOptionalText($('pvIssuerEmail'), $('issuerEmail').value.trim() ? 'Email：' + $('issuerEmail').value.trim() : '');

    /* --- 注文先 --- */
    var supplierName = $('supplierName').value.trim();
    $('pvSupplierName').innerHTML = supplierName
      ? escapeHtml(supplierName)
      : placeholder('注文先を入力');
    $('pvHonorific').textContent = $('supplierHonorific').value;

    setOptionalText($('pvSupplierAddress'), $('supplierAddress').value);
    $('pvSupplierAddrLine').hidden = !$('supplierAddress').value.trim();

    setOptionalText($('pvSupplierPerson'), $('supplierPerson').value);
    $('pvSupplierPersonLine').hidden = !$('supplierPerson').value.trim();

    /* --- 件名 --- */
    var subject = $('subject').value.trim();
    $('pvSubjectLine').hidden = !subject;
    $('pvSubject').textContent = subject;

    /* --- 注文日・注文番号 --- */
    var dateISO = $('orderDate').value;
    $('pvOrderDate').innerHTML = dateISO
      ? escapeHtml(formatDate(dateISO))
      : placeholder('未入力');

    var orderNo = $('orderNo').value.trim();
    $('pvOrderNoLine').hidden = !orderNo;
    $('pvOrderNo').textContent = orderNo;

    /* --- 納期 --- */
    var deliveryISO = $('deliveryDate').value;
    var preset = $('deliveryPreset').value;
    if (deliveryISO) {
      var deliveryText = formatDate(deliveryISO);
      if (preset !== '0') deliveryText += '（注文日から' + preset + '日）';
      $('pvDelivery').textContent = deliveryText;
    } else {
      $('pvDelivery').innerHTML = placeholder('未入力');
    }

    /* --- 支払条件 --- */
    var payment = $('paymentTerms').value.trim();
    if (payment) {
      $('pvPayment').textContent = payment;
    } else {
      $('pvPayment').innerHTML = placeholder('未入力');
    }

    /* --- 明細 --- */
    var totals = computeTotals();
    var tbody = $('pvItems');
    tbody.innerHTML = '';

    if (!totals.lines.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">明細がありません</td></tr>';
    } else {
      totals.lines.forEach(function (line) {
        var tr = document.createElement('tr');

        var nameCell = document.createElement('td');
        nameCell.className = 'td-name';
        var nameText = line.row.name.trim();
        nameCell.innerHTML = '<span class="item-name">' +
          (nameText ? escapeHtml(nameText) : placeholder('品名未入力')) + '</span>';

        var qtyCell = document.createElement('td');
        qtyCell.className = 'td-qty';
        qtyCell.textContent = formatQty(line.row.qty);

        var unitCell = document.createElement('td');
        unitCell.className = 'td-unit';
        unitCell.textContent = line.row.unit.trim();

        var priceCell = document.createElement('td');
        priceCell.className = 'td-price';
        priceCell.textContent = yen(line.row.price);

        var amountCell = document.createElement('td');
        amountCell.className = 'td-amount';
        amountCell.textContent = yen(line.amount);

        tr.appendChild(nameCell);
        tr.appendChild(qtyCell);
        tr.appendChild(unitCell);
        tr.appendChild(priceCell);
        tr.appendChild(amountCell);
        tbody.appendChild(tr);
      });
    }

    /* --- 小計・消費税・合計 --- */
    $('pvSubtotal').textContent = yen(totals.subtotal);
    $('pvTaxLabel').textContent = (totals.groups.length === 1 && totals.groups[0].rate)
      ? '消費税（' + totals.groups[0].rate + '%）'
      : '消費税（合計）';
    $('pvTaxTotal').textContent = yen(totals.tax);
    var breakEl = $('pvTaxBreak');
    if (breakEl) {
      if (totals.groups.length > 1) {
        breakEl.hidden = false;
        breakEl.textContent = totals.groups.map(function (g) {
          return g.rate + '%対象 ' + yen(g.subtotal) + '（税 ' + yen(g.tax) + '）';
        }).join(' / ');
      } else {
        breakEl.hidden = true;
      }
    }
    $('pvTotal').textContent = yen(totals.grand);
    $('pvGrand').textContent = yen(totals.grand);

    /* --- 備考・条件 --- */
    var notes = $('notes').value.trim();
    $('pvNotesBlock').hidden = !notes;
    $('pvNotes').textContent = notes;

    var conditions = $('conditions').value.trim();
    $('pvConditionsBlock').hidden = !conditions;
    $('pvConditions').textContent = conditions;

    /* --- 注記 --- */
    var paperNote = $('pvPaperNote');
    if (totals.lines.length) {
      paperNote.hidden = false;
      paperNote.textContent =
        '※ 消費税額は1円未満を切り捨てています。' +
        '※ 本注文書は適格請求書ではありません。' +
        '※ 納期・支払条件・金額にご不明な点があれば、注文元担当者までご連絡ください。';
    } else {
      paperNote.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     納期の自動計算
     --------------------------------------------------------- */

  function syncDeliveryFromOrderDate() {
    var preset = $('deliveryPreset').value;
    var dateISO = $('orderDate').value;
    if (preset === '0' || !dateISO) return;
    $('deliveryDate').value = addDays(dateISO, Number(preset));
  }

  function handleDeliveryPresetChange() {
    var preset = $('deliveryPreset').value;
    if (preset === '0') return; // 日付を指定する：今の値をそのまま使う
    syncDeliveryFromOrderDate();
  }

  // 日付を直接編集したら「日付を指定する」に切り替える
  function handleDeliveryDateInput() {
    $('deliveryPreset').value = '0';
  }

  /* ---------------------------------------------------------
     支払条件の同期
     --------------------------------------------------------- */

  function handlePaymentPresetChange() {
    var preset = $('paymentPreset').value;
    if (preset === '0') return; // 自由入力：今の値をそのまま使う
    $('paymentTerms').value = preset;
  }

  // 支払条件を直接編集したら「自由入力する」に切り替える
  function handlePaymentTermsInput() {
    $('paymentPreset').value = '0';
  }

  /* ---------------------------------------------------------
     イベント
     --------------------------------------------------------- */

  function handleRowInput(event) {
    var rowEl = event.target.closest('.row');
    if (!rowEl) return;
    var row = findRow(rowEl.dataset.id);
    if (!row) return;

    if (event.target.classList.contains('i-name')) {
      row.name = event.target.value;
    } else if (event.target.classList.contains('i-qty')) {
      row.qty = parseMoney(event.target.value);
    } else if (event.target.classList.contains('i-unit')) {
      row.unit = event.target.value;
    } else if (event.target.classList.contains('i-price')) {
      row.price = parseMoney(event.target.value);
    } else if (event.target.classList.contains('i-rate')) {
      row.rate = Number(event.target.value) === 8 ? 8 : 10;
    }
    renderPreview();
  }

  function handleRowCommit(event) {
    // 単価の入力欄からフォーカスが外れたらカンマ区切りに整形
    if (event.target.classList.contains('i-price')) {
      var rowEl = event.target.closest('.row');
      var row = rowEl && findRow(rowEl.dataset.id);
      if (row) event.target.value = row.price ? comma(row.price) : '';
    } else if (event.target.classList.contains('i-qty')) {
      var rowEl2 = event.target.closest('.row');
      var row2 = rowEl2 && findRow(rowEl2.dataset.id);
      if (row2) event.target.value = formatQty(row2.qty);
    }
  }

  function handleRowDelete(event) {
    var btn = event.target.closest('.i-del');
    if (!btn) return;
    var rowEl = btn.closest('.row');
    if (!rowEl) return;

    var id = rowEl.dataset.id;
    rows = rows.filter(function (r) { return r.id !== id; });
    rowEl.remove();

    if (!rows.length) addRowToDOM({ name: '', qty: 1, unit: '', price: 0 });

    renderPreview();
  }

  // フォーム項目に初期値を流し込む（明細行は別途）
  function applyFieldDefaults() {
    $('issuerName').value = DEFAULTS.issuerName;
    $('issuerAddress').value = DEFAULTS.issuerAddress;
    $('issuerPerson').value = DEFAULTS.issuerPerson;
    $('issuerPhone').value = DEFAULTS.issuerPhone;
    $('issuerEmail').value = DEFAULTS.issuerEmail;
    $('supplierName').value = DEFAULTS.supplierName;
    $('supplierHonorific').value = DEFAULTS.supplierHonorific;
    $('supplierAddress').value = DEFAULTS.supplierAddress;
    $('supplierPerson').value = DEFAULTS.supplierPerson;
    $('subject').value = DEFAULTS.subject;
    $('orderNo').value = DEFAULTS.orderNo;
    $('notes').value = DEFAULTS.notes;
    $('conditions').value = DEFAULTS.conditions;
    $('taxRate').value = DEFAULTS.taxRate;
    $('orderDate').value = todayISO();
    $('deliveryPreset').value = DEFAULTS.deliveryPreset;
    syncDeliveryFromOrderDate();
    $('paymentPreset').value = DEFAULTS.paymentPreset;
    $('paymentTerms').value = DEFAULTS.paymentTerms;

    // 書式は既定（ゴシック体・通常・西暦）に戻す
    var fontDefault = document.querySelector('input[name="docFont"][value="gothic"]');
    var weightDefault = document.querySelector('input[name="docWeight"][value="normal"]');
    var dateDefault = document.querySelector('input[name="dateStyle"][value="seireki"]');
    if (fontDefault) fontDefault.checked = true;
    if (weightDefault) weightDefault.checked = true;
    if (dateDefault) dateDefault.checked = true;
  }

  function resetForm() {
    applyFieldDefaults();
    renderAllRows();
    renderPreview();
  }

  /* ---------------------------------------------------------
     初期化
     --------------------------------------------------------- */


  /* ---------------------------------------------------------
     前回入力の保存・復元（この端末内のみ / サーバー送信なし）
     --------------------------------------------------------- */
  var PROFILE_KEY = 'chumonsho.profile.v1';
  var PROFILE_FIELDS = ['issuerName','issuerPerson','issuerAddress','issuerPhone','issuerEmail','supplierName','supplierHonorific','supplierAddress','conditions','notes'];
  var profileStore = (function () {
    try {
      var k = '__cm_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) { return null; }
  })();
  var profileTimer = null;

  function queueSaveProfile() {
    if (!profileStore) return;
    if (profileTimer) clearTimeout(profileTimer);
    profileTimer = setTimeout(function () {
      var data = {};
      PROFILE_FIELDS.forEach(function (id) { var el = $(id); if (el) data[id] = el.value; });
      data.rows = rows.map(function (r) { return { name: r.name, qty: r.qty, unit: r.unit, price: r.price }; });
      try { profileStore.setItem(PROFILE_KEY, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), fields: data })); } catch (e) {}
    }, 500);
  }

  function restoreProfile() {
    if (!profileStore) return false;
    var raw, parsed;
    try { raw = profileStore.getItem(PROFILE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try { parsed = JSON.parse(raw); } catch (e) { return false; }
    if (!parsed || parsed.v !== 1 || !parsed.fields) return false;
    var f = parsed.fields, filled = 0;
    PROFILE_FIELDS.forEach(function (id) {
      var el = $(id);
      if (el && f[id] !== undefined) { el.value = f[id]; filled++; }
    });
    if (Array.isArray(f.rows) && f.rows.length) {
      var container = $('rowsContainer');
      container.innerHTML = '';
      rows = [];
      rowSeq = 0;
      f.rows.slice(0, 50).forEach(function (r) { addRowToDOM({ name: r.name, qty: r.qty, unit: r.unit, price: r.price }); });
      filled++;
    }
    return filled > 0;
  }

  function showProfileHint() {
    var form = $('orderForm');
    if (!form || !form.parentNode) return;
    var bar = document.createElement('div');
    bar.className = 'profile-hint no-print';
    bar.innerHTML = '前回入力した内容を復元しました。<button type="button" class="profile-delete" id="profileDelete">保存データを削除</button>';
    form.parentNode.insertBefore(bar, form);
    $('profileDelete').addEventListener('click', function () {
      try { profileStore.removeItem(PROFILE_KEY); } catch (e) {}
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
  }

  function init() {
    applyFieldDefaults();

    rowSeq = 0;
    rows = [];
    DEFAULT_ROWS.forEach(function (r) { addRowToDOM(r); });

    if (restoreProfile()) {
      showProfileHint();
      renderPreview();
    }

    $('orderForm').addEventListener('input', function (event) {
      if (event.target.closest('.row')) return;
      if (event.target.id === 'deliveryDate') handleDeliveryDateInput();
      if (event.target.id === 'orderDate') syncDeliveryFromOrderDate();
      if (event.target.id === 'paymentTerms') handlePaymentTermsInput();
      renderPreview();
    });
    $('orderForm').addEventListener('change', function (event) {
      if (event.target.closest('.row')) return;
      if (event.target.id === 'deliveryPreset') handleDeliveryPresetChange();
      if (event.target.id === 'paymentPreset') handlePaymentPresetChange();
      renderPreview();
    });

    var rowsContainer = $('rowsContainer');
    rowsContainer.addEventListener('input', handleRowInput);
    rowsContainer.addEventListener('change', handleRowInput);
    rowsContainer.addEventListener('focusout', handleRowCommit);
    rowsContainer.addEventListener('click', handleRowDelete);

    $('addRowBtn').addEventListener('click', function () {
      var el = addRowToDOM({ name: '', qty: 1, unit: '', price: 0 });
      renderPreview();
      var input = el.querySelector('.i-name');
      if (input) input.focus();
    });

    $('printBtn').addEventListener('click', function () {
      window.print();
    });

    $('resetBtn').addEventListener('click', resetForm);

    $('orderForm').addEventListener('input', queueSaveProfile);
    $('orderForm').addEventListener('change', queueSaveProfile);
    $('rowsContainer').addEventListener('input', queueSaveProfile);
    $('rowsContainer').addEventListener('change', queueSaveProfile);

    renderPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* =========================================================
   シェア（バイラル導線） — 既存機能には触れない独立モジュール
   ========================================================= */
(function () {
  'use strict';

  var SHARE_URL = "https://www.reveriel.com/chumonsho-pdf/";
  var SHARE_TEXT = '無料・登録不要で注文書（発注書）を作成してPDF保存できるツール';
  var COPY_DONE = 'コピーしました';
  var COPY_FAIL = 'コピーできませんでした';

  function byId(id) { return document.getElementById(id); }

  function shareText() { return SHARE_TEXT; }

  function openExternal(url) {
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function buildTweetUrl() {
    return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) +
      '&url=' + encodeURIComponent(SHARE_URL);
  }
  function buildLineUrl() {
    return 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(SHARE_URL);
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(
            function () { resolve(true); },
            function () { resolve(fallbackCopy(text)); }
          );
          return;
        }
      } catch (e) { /* fallthrough */ }
      resolve(fallbackCopy(text));
    });
  }

  function init() {
    var xBtn = byId('shareXBtn');
    var lBtn = byId('shareLineBtn');
    var cBtn = byId('shareCopyBtn');
    var urlText = byId('shareUrlText');
    if (!xBtn || !lBtn || !cBtn) return;

    if (urlText) urlText.textContent = SHARE_URL;

    xBtn.addEventListener('click', function () { openExternal(buildTweetUrl()); });
    lBtn.addEventListener('click', function () { openExternal(buildLineUrl()); });

    var copyLabel = byId('shareCopyLabel');
    var resetTimer = null;
    cBtn.addEventListener('click', function () {
      var original = copyLabel ? copyLabel.textContent : '';
      copyText(SHARE_URL).then(function (ok) {
        if (!copyLabel) return;
        copyLabel.textContent = ok ? COPY_DONE : COPY_FAIL;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () { copyLabel.textContent = original; }, 1800);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
