import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 启动前把服务目录下的 .env、.env.local 写进 process.env。
 * 覆盖已有变量，避免外层 shell 里的 DB_DATABASE / PORT 指到别的库或端口。
 * .env.local 后加载，专门给本机 mall 启动。
 * 必须在读取装饰器参数之前执行。
 */
function applyEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadServiceEnv() {
  const cwd = process.cwd();
  applyEnvFile(resolve(cwd, '.env'));
  applyEnvFile(resolve(cwd, '.env.local'));
}

loadServiceEnv();

export function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
