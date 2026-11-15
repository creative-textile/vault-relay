#!/usr/bin/env node
// Проверка переносимого комплекта: имена файлов и тексты, без исключений для истории проекта.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve, relative, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const forbidden = ['nar', 'thex'].join('');
// Vault: комплект перенесён из другого проекта, и его прежние имена не должны
// просачиваться в промпты, сборку и документацию агентов. Проверка идёт по
// исполняемым источникам, промптам и руководствам; журнал решений и история
// выпусков намеренно исключены: это архив, а не текст для агента.
const forbiddenProjects = [['syn', 'apse'].join(''), ['creative', '36711'].join('')];
const ARCHIVE = new Set(['DECISIONS.md', 'scriptcat-update.md', 'agent-protocol.json']);
const ignoredDirs = new Set(['node_modules', '.git']);

export function findPortableNameLeaks(root, extraFiles = []) {
  const leaks = [];
  const inspect = (path, label, directory = false) => {
    if (label.toLowerCase().includes(forbidden)) leaks.push(`${label}: имя`);
    for (const token of forbiddenProjects) {
      if (label.toLowerCase().includes(token)) leaks.push(`${label}: имя прежнего проекта`);
    }
    if (directory) {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        const stat = statSync(child);
        if (stat.isDirectory() && ignoredDirs.has(name)) continue;
        inspect(child, `${label}/${name}`, stat.isDirectory());
      }
      return;
    }
    const text = readFileSync(path, 'utf8');
    const archive = ARCHIVE.has(label.split('/').at(-1));
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.toLowerCase().includes(forbidden)) leaks.push(`${label}:${index + 1}: текст`);
      if (archive) return;
      for (const token of forbiddenProjects) {
        if (line.toLowerCase().includes(token)) leaks.push(`${label}:${index + 1}: текст прежнего проекта`);
      }
    });
  };
  for (const name of readdirSync(root)) {
    const path = join(root, name), stat = statSync(path);
    if (stat.isDirectory() && ignoredDirs.has(name)) continue;
    inspect(path, name, stat.isDirectory());
  }
  for (const path of extraFiles) inspect(path, relative(process.cwd(), path), false);
  return leaks;
}

// Provisioning-контур не должен зашивать имена проекта/ролей. Запретные токены
// bootstrap-фильтра (например WARDEN как внутренний токен) не являются
// named-role привилегией и проверяются отдельно: запрещены сравнения имени роли.
export function findProvisionProjectLeaks(root) {
  const leaks = [];
  for (const name of ['31-provision-core.js', '32-provision-dom.js', '33-provision-flow.js', '34-provision-ui.js']) {
    const path = join(root, 'src', name);
    const text = readFileSync(path, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      if (new RegExp(forbiddenProjects.join('|'), 'i').test(line)) leaks.push(`src/${name}:${index + 1}: проектное имя`);
      if (/norm\(["']Warden|===\s*["']Warden|name\s*===\s*["']Coordinator["']/i.test(line)) {
        leaks.push(`src/${name}:${index + 1}: named-role привилегия`);
      }
    });
  }
  return leaks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const extra = fileURLToPath(new URL('../../docs/scriptcat-update.md', import.meta.url));
  const leaks = [...findPortableNameLeaks(root, [extra]), ...findProvisionProjectLeaks(root)];
  if (leaks.length) {
    console.error(`Запрещённые названия в переносимом комплекте:\n${leaks.join('\n')}`);
    process.exitCode = 1;
  } else console.log('OK: переносимый ScriptCat и его руководство не содержат прежнее имя проекта; provisioning без проектных имён');
}
