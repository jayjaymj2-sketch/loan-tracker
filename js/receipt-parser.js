(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.ReceiptParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function normalizeReceiptText(text){
    const thaiDigits = { '๐':'0','๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9' };
    return String(text || '')
      .replace(/[๐-๙]/g, digit => thaiDigits[digit])
      .replace(/[|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toNumber(value){
    if(value == null) return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeYear(year){
    const numeric = Number(year);
    return numeric >= 2400 ? numeric - 543 : numeric;
  }

  function parseDate(clean, warnings){
    const labelled = clean.match(/(?:\(Date\)|\bDate\b|วันที่(?:ชำระ)?|วันชำระ)[^0-9]{0,24}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
    const fallback = clean.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
    const match = labelled || fallback;
    if(!match){
      warnings.push('ไม่พบวันที่ในใบเสร็จ กรุณากรอกเอง');
      return null;
    }
    const year = normalizeYear(match[3]);
    const month = Number(match[2]);
    const day = Number(match[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if(date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day){
      warnings.push('วันที่ที่อ่านได้ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
      return null;
    }
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function labelledValues(clean, labelPattern){
    const regex = new RegExp(`(?:${labelPattern})[^0-9]{0,36}([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, 'gi');
    return [...clean.matchAll(regex)].map(match => toNumber(match[1])).filter(value => value != null);
  }

  function firstValue(clean, labelPattern){
    const values = labelledValues(clean, labelPattern);
    return values.length ? values[0] : null;
  }

  function parseSCBReceiptText(text){
    const clean = normalizeReceiptText(text);
    const fields = {};
    const warnings = [];

    fields.date = parseDate(clean, warnings);

    // PDF ของ SCB บางรุ่นวางป้ายทั้งหมดก่อนตัวเลข จึงอ่านรูปแบบชุดนี้ก่อน
    const batched = clean.match(
      /\(Principal\)[^(]*\(Interest\)[^(]*\(Principal\)[^(]*\(Interest\)[^0-9]*([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})/i
    );
    if(batched){
      fields.principalPaid = toNumber(batched[1]);
      fields.interest = toNumber(batched[2]);
      fields.balanceAfter = toNumber(batched[3]);
    }else{
      const withoutDefaultInterest = clean.replace(/(?:\(Default\s*interest\)|ดอกเบี้ยผิดนัด)[^0-9]{0,24}[0-9,]+(?:\.\d{1,2})?/gi, ' ');
      const principalValues = labelledValues(clean, '\\(Principal\\)|\\bPrincipal(?: paid)?\\b|เงินต้น(?:ที่ตัด)?');
      const balanceValues = labelledValues(clean, '\\bOutstanding(?: principal)?(?: balance)?\\b|\\bBalance(?: after)?\\b|ยอด(?:เงินต้น)?คงเหลือ(?:หลังชำระ)?');

      if(principalValues.length >= 2){
        fields.principalPaid = Math.min(...principalValues);
        fields.balanceAfter = Math.max(...principalValues);
      }else if(principalValues.length === 1){
        fields.principalPaid = principalValues[0];
      }
      if(balanceValues.length) fields.balanceAfter = Math.max(...balanceValues);
      fields.interest = firstValue(withoutDefaultInterest, '\\(Interest\\)|\\bInterest\\b|ดอกเบี้ย(?:งวดนี้)?');
    }

    fields.amount = firstValue(clean, '\\(Total\\)|\\bTotal(?: payment)?\\b|ยอดชำระ(?:รวม)?|รวมเป็นเงิน|จำนวนเงิน(?:ที่ชำระ)?');

    // OCR บางครั้งอ่านป้ายบางช่องไม่ได้ แต่ค่าที่เหลือสามารถหากันได้อย่างแน่นอน
    if(fields.amount == null && fields.principalPaid != null && fields.interest != null){
      fields.amount = Math.round((fields.principalPaid + fields.interest) * 100) / 100;
      warnings.push('ไม่พบยอดชำระรวม — คำนวณจากเงินต้นและดอกเบี้ยให้แทน');
    }
    if(fields.principalPaid == null && fields.amount != null && fields.interest != null){
      fields.principalPaid = Math.max(Math.round((fields.amount - fields.interest) * 100) / 100, 0);
      warnings.push('ไม่พบเงินต้นที่ตัด — คำนวณจากยอดชำระและดอกเบี้ยให้แทน');
    }
    if(fields.interest == null && fields.amount != null && fields.principalPaid != null){
      fields.interest = Math.max(Math.round((fields.amount - fields.principalPaid) * 100) / 100, 0);
      warnings.push('ไม่พบยอดดอกเบี้ย — คำนวณจากยอดชำระและเงินต้นให้แทน');
    }

    if(fields.principalPaid == null || fields.balanceAfter == null){
      warnings.push('ไม่พบยอดเงินต้นหรือยอดคงเหลือ กรุณากรอกเอง');
    }
    if(fields.interest == null) warnings.push('ไม่พบยอดดอกเบี้ย กรุณากรอกเอง');
    if(fields.amount == null) warnings.push('ไม่พบยอดชำระรวม กรุณากรอกเอง');

    const ok = !!fields.date && fields.principalPaid != null && fields.balanceAfter != null;
    return { ok, fields, warnings, normalizedText: clean };
  }

  return { normalizeReceiptText, parseSCBReceiptText };
});
