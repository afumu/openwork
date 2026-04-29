import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenWorkCliError } from './errors.js';
import { getRuntimeConfigPath, readProjectConfig, writeRuntimeConfig } from './projectConfig.js';

async function readRuntimeConfig(workspace) {
  try {
    return JSON.parse(await readFile(getRuntimeConfigPath(workspace), 'utf8'));
  } catch {
    return {};
  }
}

function defaultLogFile(workspace, commandName) {
  return path.join(workspace, '.openwork', 'logs', `${commandName}.log`);
}

export async function runLifecycleCommand({
  commandName,
  detached = false,
  logFile,
  streamOutput = true,
  workspace,
}) {
  const project = await readProjectConfig(workspace);
  const command = project.commands?.[commandName];

  if (!command) {
    throw new OpenWorkCliError('COMMAND_NOT_CONFIGURED', `${commandName} is not configured`);
  }

  if (command.length === 0) {
    return {
      ok: true,
      command: commandName,
      exitCode: 0,
      logFile: null,
      skipped: true,
      workspace,
    };
  }

  const [bin, ...args] = command;
  const resolvedLogFile = logFile || defaultLogFile(workspace, commandName);
  await mkdir(path.dirname(resolvedLogFile), { recursive: true });
  const logStream = createWriteStream(resolvedLogFile, { flags: 'w' });

  if (detached) {
    const child = spawn(bin, args, {
      cwd: workspace,
      detached: true,
      stdio: ['ignore', logStream, logStream],
    });
    child.unref();
    await writeRuntimeConfig(workspace, {
      [commandName]: {
        logFile: resolvedLogFile,
        pid: child.pid,
        port: project.devPort,
        startedAt: new Date().toISOString(),
      },
    });
    return {
      ok: true,
      command: commandName,
      detached: true,
      logFile: resolvedLogFile,
      pid: child.pid,
      workspace,
    };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', chunk => {
      if (streamOutput) process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on('data', chunk => {
      if (streamOutput) process.stderr.write(chunk);
      logStream.write(chunk);
    });
    child.on('error', error => {
      logStream.end();
      reject(new OpenWorkCliError('COMMAND_FAILED', error.message, { command: commandName }));
    });
    child.on('close', code => {
      logStream.end();
      if (code !== 0) {
        reject(
          new OpenWorkCliError(
            'COMMAND_FAILED',
            `${commandName} exited with code ${code}`,
            { command: commandName, exitCode: code, logFile: resolvedLogFile },
          ),
        );
        return;
      }
      resolve({
        ok: true,
        command: commandName,
        exitCode: 0,
        logFile: resolvedLogFile,
        workspace,
      });
    });
  });
}

export async function getProjectStatus(workspace) {
  const project = await readProjectConfig(workspace);
  const runtime = await readRuntimeConfig(workspace);
  return {
    ok: true,
    initialized: true,
    workspace,
    template: project.template,
    devPort: project.devPort,
    dev: runtime.dev
      ? {
          logFile: runtime.dev.logFile,
          pid: runtime.dev.pid,
          port: runtime.dev.port,
          running: runtime.dev.pid ? true : false,
        }
      : {
          running: false,
        },
  };
}
