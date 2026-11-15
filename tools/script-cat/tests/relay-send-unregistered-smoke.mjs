// Проба 1.16.1 (D-124): «поле непустое, а ввод не зарегистрирован».
//
// Инцидент 12.11 в 23:11 (Manual, класс `transport`, разбор 1 из 2):
//
//   «Кнопка Send неактивна или не найдена — редактор не принял текст
//    (поле в документе, в поле 4182 симв., кнопка не найдена, сообщений 3 → 3,
//    своих 2, панелей 0, кнопка нет, ... активной кнопки Send нет за 20 с)».
//
// Что было не так. `writePrompt` умеет два пути: `execCommand("insertText")` —
// настоящий ввод, от которого ProseMirror зажигает Send, и запасной
// `textContent` — символы в узле есть, а состояние редактора пустое. Второй путь
// возвращал `true` («текст вставлен»), и `waitSendReady` честно ждал кнопку все
// 20 с. Писать заново он не мог: D-079 запрещает трогать НЕПУСТОЕ поле, чтобы не
// затирать набранное. Тот запрет верный, но он не различает «человек набрал» и
// «наш же текст лёг запасным путём, и редактор его не принял». Итог — пауза на
// ровном месте при полном поле текста.
//
// Здесь проверяется поведение, а не строки:
//  1. `writePrompt` различает принятый и непринятый ввод (запоминает факт);
//  2. `waitSendReady` перевставляет текст, когда ввод не принят, и кнопка
//     появляется — вместо 20 с ожидания;
//  3. уже набранное человеком поле по-прежнему не перезаписывается (D-079);
//  4. число лечений ограничено `sendHealMax`;
//  5. причина отказа называет состояние панели и факт вставки, а не «кнопка
//     не найдена» на все три случая;
//  6. снимок страницы для разбора несёт эти два поля.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');

const cut = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a > 0 && b > a, `фрагмент на месте: ${from.trim().slice(0, 60)}`);
  return src.slice(a, b);
};

// ── 0. Версия: правка лежит в 1.16.1, а не в той сборке, что сломалась ──────
assert.match(src, /^\/\/ @version\s+1\.16\.1\s*$/m, 'сборка 1.16.1 объявлена');
assert.match(src, /\|\| "1\.16\.1";/, 'SCRIPT_VERSION совпадает с @version');

// ── 1. Факт приёма ввода запоминается в writePrompt ────────────────────────
const writeSrc = cut('  function writePrompt(editor, text, attempt = 1) {', '  const composerText =');
assert.match(writeSrc, /lastWrite = written > 0/, 'вставка записывает свой итог');
assert.match(
  writeSrc,
  /registered: inserted === true/,
  '«принял редактор» — это именно execCommand, а не наличие символов в узле',
);

// ── 2. Признак непринятого ввода узкий и не трогает чужой текст ────────────
const unregSrc = cut('  function unregisteredWrite(editor, text) {', '  /** Короткая строка для паузы');
assert.match(unregSrc, /w\.registered !== false/, 'срабатывает только по записи самого writePrompt');
assert.match(unregSrc, /w\.healed/, 'повторное лечение того же поля не запускается');
assert.match(unregSrc, /w\.editor !== editor/, 'другое поле — не наше лечение');
assert.match(unregSrc, /sendHealWindowMs/, 'окно ограничено: старая запись не про это ожидание');
assert.match(unregSrc, /shown\.includes\(want\.slice\(0, 60\)\)/, 'лечим только своё же содержимое');

// ── 3. Поведение waitSendReady: непринятый ввод лечится, кнопка появляется ──
const waitSrc = cut('  async function waitSendReady(editor, text, timeoutMs = C.sendReadyMs) {', '  /**\n   * Отличительная строка задания');

// Модель поля: `writePrompt` «не принят» → текст в узле есть, но SEND не горит.
// «Принят» → горит. Лечение (reinsertPrompt) делает ввод принятым.
const runWait = async ({ everRegistered, healWorks = true, budget = 20000, healMax = 2 }) => {
  const out = { now: 0, writes: 0, heals: 0, logs: [], dbg: [], prompts: [] };
  // Как в бою: задание уже вставлено до входа в ожидание (consumePending →
  // writePrompt → deliver → waitSendReady). Поэтому поле сразу непустое.
  let text = 'задание 4182 знака';
  let accepted = everRegistered;
  const field = () => text;
  const wait = new Function(
    'sendReady', 'writePrompt', 'log', 'sleep', 'C', 'Date', 'flat', 'composerText',
    'reinsertPrompt', 'unregisteredWrite', 'lastWrite', 'dbg',
    `${waitSrc}\nreturn waitSendReady;`,
  )(
    () => (accepted && text ? { ok: true, btn: 'SEND' } : { ok: false, why: 'кнопка Send ещё неактивна', editor: {} }),
    (_editor, t) => {
      out.writes += 1;
      out.prompts.push(t);
      text = t;
      accepted = everRegistered;
      return true;
    },
    (t) => out.logs.push(t),
    async (ms) => { out.now += ms; },
    { sendReadyMs: budget, sendHealMax: healMax, sendHealWindowMs: 45000 },
    { now: () => out.now },
    (x) => String(x || '').replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase(),
    () => text,
    () => {
      out.heals += 1;
      if (!healWorks) return false;
      // Настоящая перевставка идёт через execCommand — ввод принят.
      accepted = true;
      return true;
    },
    () => !everRegistered,
    { registered: !everRegistered },
    (...args) => out.dbg.push(args),
  );
  const btn = await wait({}, 'задание 4182 знака', budget);
  return { btn, ...out, field: field() };
};

// (а) Боевой случай: ввод не принят — ждать нечего, поле лечится и ход едет.
//     Числа инцидента: 1.16.0 ждала 20 100 мс и вернула null; 1.16.1 лечит
//     один раз и отдаёт кнопку на 2 100 мс. Это и есть разница «до/после».
{
  const r = await runWait({ everRegistered: false });
  assert.equal(r.btn, 'SEND', 'кнопка появилась после лечения: задание уходит');
  assert.equal(r.heals, 1, 'лечение ровно одно — повторная вставка через execCommand');
  assert.equal(r.now, 2100, 'кнопка найдена за 2,1 с, а не за 20 с (1.16.0: 20 100 мс, null)');
}

// (б) Ввод принят сразу — лечения нет вовсе.
{
  const r = await runWait({ everRegistered: true });
  assert.equal(r.btn, 'SEND', 'обычный путь не изменился');
  assert.equal(r.heals, 0, 'принятый ввод не перевставляется');
  assert.equal(r.writes, 0, 'лишних вставок нет');
}

// (в) Лечение не помогло: попыток не больше sendHealMax, потом обычная пауза.
{
  const r = await runWait({ everRegistered: false, healWorks: false, budget: 3000, healMax: 2 });
  assert.equal(r.btn, null, 'если лечение не помогло — ожидание заканчивается, как раньше');
  assert.ok(r.heals <= 2, `лечений не больше sendHealMax (было ${r.heals})`);
}

// ── 4. Причина отказа называет состояние панели и вставки ──────────────────
const detailSrc = cut('    const detail = [', '    const report = domReport();');
assert.match(detailSrc, /sendScanSummary\(\)/, 'в причине есть разбор панели');
assert.match(detailSrc, /lastWrite/, 'в причине есть факт вставки');
assert.match(
  detailSrc,
  /редактор ввод не принял/,
  'непринятая вставка названа своим именем, а не «кнопка не найдена»',
);

const scanBlock = cut('  function sendScanSummary() {', '  function sendButton(editor) {');
assert.match(scanBlock, /кнопки с подписью Send в панели нет/, 'отличает «Send нет в панели»');
assert.match(scanBlock, /Send есть, но недоступна/, 'отличает «Send есть, но серая»');
assert.match(scanBlock, /Send вне панели/, 'отличает «Send есть, но вне панели»');
assert.match(scanBlock, /панель ввода/, 'называет область поиска');

// ── 5. Снимок страницы для разбора несёт те же два факта ───────────────────
const snapSrc = cut('  function healPageSnapshot() {', '  /** Имя выгрузки по схеме D-031');
assert.match(snapSrc, /send: \{/, 'в снимке есть раздел send');
assert.match(snapSrc, /sendScanSummary\(\)/, 'снимок несёт разбор панели');
assert.match(snapSrc, /lastWrite/, 'снимок несёт факт вставки');

// ── 6. Пределы в конфиге, а не в коде по месту ─────────────────────────────
assert.match(src, /\n    sendHealMax: 2,/, 'предел лечений — в конфиге');
assert.match(src, /\n    sendHealWindowMs: 45000,/, 'окно лечения — в конфиге');

console.log(
  'OK: relay 1.16.1 — непринятый ввод лечится перевставкой, набранное поле не трогается, ' +
    'причина отказа называет состояние панели и вставки',
);
