// Проба краткого регламента: правила приходят агенту вместе с заданием.
//
// Зачем: транспорт отдавал регламент ссылкой, и агент читал ~50 блоков Notion
// каждый ход. Дешевле (и надёжнее — не зависит от квоты и от обрезки ответов)
// вшивать краткую версию в промпт. Опасность одна: вшитая копия устареет молча.
// Поэтому проба сверяет три источника — текст, версию и бандл.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  DIGEST_MAX_CHARS,
  assertDigestVersionMatches,
  digestVersion,
  normalizeDigest,
  readEmbeddedDigest,
} from '../regulation-oracle.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const rawDigest = read('../../../docs/regulation-digest.md');
const digest = normalizeDigest(rawDigest);
const regulation = read('../../../docs/REGULATION.md');
const bundle = read('../relay.user.js');

// ── 1. Источники совпадают ──────────────────────────────────────────────────
assert.equal(
  readEmbeddedDigest(bundle),
  digest,
  'вшитый регламент в relay.user.js разошёлся с docs/regulation-digest.md: пересоберите бандл',
);
assertDigestVersionMatches(digest, regulation);
assert.match(digest, /## 1\. Роли/, 'в краткой версии есть раздел ролей');
assert.match(digest, /## 2\. Один репозиторий/, 'в краткой версии есть границы репозитория D-022');
assert.match(digest, /## 3\. Инструменты/, 'в краткой версии есть раздел про готовые инструменты');
assert.match(digest, /## 4\. Зоны и гейты/, 'в краткой версии есть зоны и гейты');

// 1.0. Агент обязан узнать из промпта, что репозиторий один, что транспорт и
//      проверки уже лежат в нём (D-025) и что деньги двигаются в трёх сетях.
assert.match(digest, /creative-textile\/vault/, 'назван целевой репозиторий полным именем');
assert.match(digest, /tools\/script-cat/, 'назван каталог транспорта');
assert.match(digest, /npm run verify/, 'названа общая команда проверки');
assert.match(digest, /TON/, 'названа сеть TON');
assert.match(digest, /BEP-20/, 'названа сеть BEP-20');
assert.match(digest, /ERC-20/, 'названа сеть ERC-20');
assert.match(digest, /demo → testnet → mainnet/, 'назван переключатель режимов');

// 1.1. Служебные заметки остаются в файле, но в промпт не попадают.
assert.ok(rawDigest.includes('<!-- build:meta -->'), 'в файле есть маркер служебных заметок');
assert.doesNotMatch(digest, /build:meta|Примечание для сопровождающего/, 'служебные заметки не идут в промпт');
assert.doesNotMatch(digest, /Пересоберите|пересоберите бандл/, 'инструкции по сборке не путаются с правилами');

// ── 2. Бюджет объёма ───────────────────────────────────────────────────────
assert.ok(
  digest.length <= DIGEST_MAX_CHARS,
  `краткий регламент ${digest.length} знаков > ${DIGEST_MAX_CHARS}: вход хода обязан оставаться коротким`,
);
const fullLength = regulation.length;
assert.ok(
  digest.length * 2 < fullLength,
  `краткая версия (${digest.length}) должна быть заметно короче полной (${fullLength})`,
);

// ── 3. Правила регламента несут декларативные блоки, маркер — в конце ─────
const { PromptCompiler, dispatchRequest, planRequest } = await import('./helpers/prompt-env.mjs');
const exec = PromptCompiler.compile(dispatchRequest('Executor'));
const coord = PromptCompiler.compile(planRequest());
// Обязательные правила регламента покрыты ruleId блоков (K-14: версии раздельны).
for (const id of ['R-PHASES', 'R-I18N', 'R-REPO-BOUNDARY', 'R-MARKER']) assert.ok(exec.ruleIds.includes(id), `executor: ${id}`);
for (const id of ['R-QUEUE', 'R-MASTER-ONLY', 'R-D028']) assert.ok(coord.ruleIds.includes(id), `coordinator: ${id}`);
// Маркер последней строкой — порядок часть контракта.
assert.match(exec.text.trim().split('\n').at(-1), /^CF_AGENT_RESULT \{/);
assert.match(coord.text.trim().split('\n').at(-1), /^CF_COORDINATOR_RESULT \{/);

// 3.2. Версия бандла поднята вместе с изменением промпта.
assert.match(bundle, /\/\/ @version\s+1\.\d+\.\d+/, 'версия бандла поднята');

assert.match(digest, /Формат финальной строки всегда стоит в самом конце задания/,
  'правило «формат ответа — в конце задания» вшито в регламент');
assert.equal(digestVersion(digest), digestVersion(regulation), 'версии копий совпадают');

console.log('OK: краткий регламент вшит в промпт, копии и версии совпадают');
