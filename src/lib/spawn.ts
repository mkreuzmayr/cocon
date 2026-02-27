import { spawn } from 'node:child_process';

export function execAsync(
  command: string,
  args: string[],
  options?: { stdout?: boolean }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: options?.stdout !== false ? Buffer.concat(stdoutChunks).toString('utf-8') : '',
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}
