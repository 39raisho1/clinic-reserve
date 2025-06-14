// functions/test.js
const dayjs = require('dayjs');
require('dayjs/plugin/utc');
require('dayjs/plugin/timezone');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));

const TZ = 'Asia/Tokyo';
const OPEN_DAYS = ['monday','thursday','friday','saturday','sunday'];
const RANGES = [
  { start: '08:30', end: '12:30' },
  { start: '14:30', end: '18:00' },
];

function isReservationOpen(now = dayjs().tz(TZ)) {
  console.log('【DEBUG】今の時刻:', now.format('YYYY-MM-DD HH:mm'));
  const weekday = now.format('dddd').toLowerCase();
  console.log('【DEBUG】曜日:', weekday);
  if (!OPEN_DAYS.includes(weekday)) {
    console.log('【DEBUG】休診日です');
    return false;
  }
  const today = now.format('YYYY-MM-DD');
  for (const { start, end } of RANGES) {
    const s = dayjs.tz(`${today} ${start}`, 'YYYY-MM-DD HH:mm', TZ);
    const e = dayjs.tz(`${today} ${end}`,   'YYYY-MM-DD HH:mm', TZ);
    console.log(`【DEBUG】比較: ${s.format('HH:mm')}～${e.format('HH:mm')}`);
    if (now.isBetween(s, e, null, '[)')) {
      console.log('【DEBUG】受付時間内です');
      return true;
    }
  }
  console.log('【DEBUG】時間外です');
  return false;
}

// 実行部
const now = dayjs().tz(TZ);
console.log('=== テスト開始 ===');
console.log('現在時刻:', now.format('YYYY-MM-DD HH:mm'));
console.log('予約受付中？', isReservationOpen(now) ? 'YES' : 'NO');
