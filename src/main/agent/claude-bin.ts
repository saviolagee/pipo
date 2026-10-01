// Localiza e executa o binário `claude` do Claude Code instalado na máquina do usuário.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const isWin = process.platform === 'win32';

/** Diretórios comuns onde o instalador oficial e o npm colocam o `claude`. */
function candidateDirs(): string[] {
  const home = homedir();
  if (isWin) {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [join(home, '.local', 'bin'), join(appData, 'npm'), join(local, 'Programs', 'claude'), join(local, 'AnthropicClaude')];
  }
  return [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', join(home, '.npm-global', 'bin'), join(home, '.volta', 'bin'), join(home, '.bun', 'bin')];
}

/** PATH ampliado: apps abertos pelo Finder/Explorer não herdam o PATH do shell. */
export function augmentedPath(): string {
  const parts = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const d of candidateDirs()) if (!parts.includes(d)) parts.push(d);
  return parts.join(delimiter);
}

let cached: string | null | undefined;

export function findClaude(force = false): string | null {
  if (cached !== undefined && !force) return cached;
  const names = isWin ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'] : ['claude'];
  for (const dir of augmentedPath().split(delimiter)) {
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p)) {
        cached = p;
        return p;
      }
    }
  }
  cached = null;
  return null;
}

export function claudeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: augmentedPath() };
  // Evita que o CLI se ache dentro de outra sessão do Claude Code (ex.: rodando o Pipo pelo terminal do Claude).
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_REMOTE_SESSION_ID;
  delete env.ELECTRON_RUN_AS_NODE;
  // O Pipo usa a assinatura logada no Claude Code: uma chave de API no ambiente teria precedência.
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function quoteWin(a: string): string {
  if (a === '') return '""';
  if (!/[\s"&|<>^%]/.test(a)) return a;
  return `"${a.replace(/"/g, '""')}"`;
}

/** Sobe o CLI. Em .cmd/.bat do Windows é preciso shell; os argumentos são citados manualmente. */
export function spawnClaude(bin: string, args: string[], opts: SpawnOptions): ChildProcess {
  const needsShell = isWin && /\.(cmd|bat)$/i.test(bin);
  if (needsShell) {
    return spawn(quoteWin(bin), args.map(quoteWin), { ...opts, shell: true, windowsHide: true, env: opts.env ?? claudeEnv() });
  }
  return spawn(bin, args, { ...opts, windowsHide: true, env: opts.env ?? claudeEnv() });
}

/** Executa e coleta stdout/stderr com timeout. O prompt vai pelo stdin (sem problemas de aspas). */
export function runClaude(bin: string, args: string[], opts: { cwd: string; stdin?: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawnClaude(bin, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin?.end(opts.stdin ?? '');
  });
}
