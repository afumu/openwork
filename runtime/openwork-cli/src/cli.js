import path from 'node:path';
import { toCliError } from './errors.js';
import { formatError, printJson, printText } from './output.js';
import { writeProjectConfig } from './projectConfig.js';
import { getProjectStatus, runLifecycleCommand } from './runCommand.js';
import { renderString, renderTemplateToWorkspace } from './templateRender.js';
import {
  findTemplate,
  loadTemplateConfig,
  loadTemplates,
  validateTemplateParams,
} from './templateRegistry.js';
import { OpenWorkCliError } from './errors.js';
import { runViteProxy } from './viteProxy.js';

function hasFlag(args, flag) {
  return args.includes(flag);
}

function readOption(args, longName, shortName) {
  const longIndex = args.indexOf(longName);
  if (longIndex >= 0) return args[longIndex + 1];
  if (shortName) {
    const shortIndex = args.indexOf(shortName);
    if (shortIndex >= 0) return args[shortIndex + 1];
  }
  return undefined;
}

function readPositional(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('-')) {
      if (index + 1 < args.length && !args[index + 1].startsWith('-')) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function collectTemplateParams(args) {
  const known = new Set([
    '--template',
    '-t',
    '--workspace',
    '--install',
    '--dev',
    '--force',
    '--here',
    '--json',
  ]);
  const params = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--') || known.has(arg)) {
      if ((arg === '--template' || arg === '-t' || arg === '--workspace') && index + 1 < args.length) {
        index += 1;
      }
      continue;
    }
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = args[index + 1];
    params[key] = next && !next.startsWith('-') ? next : true;
    if (next && !next.startsWith('-')) index += 1;
  }

  return params;
}

function renderCommands(commands, context) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, commandParts]) => [
      name,
      Array.isArray(commandParts)
        ? commandParts.map(part => renderString(String(part), context))
        : commandParts,
    ]),
  );
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const json = hasFlag(args, '--json');

  try {
    if (command === 'templates') {
      const registry = await loadTemplates();
      const payload = {
        ok: true,
        selectionGuide:
          'Read the user request, choose the closest template from useCases/examples/avoidWhen, and ask a short clarification if the fit is unclear. Do not invent template names.',
        templates: registry.templates.map(({
          name,
          title,
          description,
          useCases,
          avoidWhen,
          examples,
          tags,
          devPort,
        }) => ({
          name,
          title,
          description,
          useCases,
          avoidWhen,
          examples,
          tags,
          devPort,
        })),
      };
      if (json) printJson(payload);
      else payload.templates.forEach(template => printText(`${template.name} - ${template.title}`));
      return payload;
    }

    if (command === 'init') {
      const templateName = readOption(args, '--template', '-t');
      const workspaceRoot =
        readOption(args, '--workspace') || process.env.OPENWORK_WORKSPACE || process.cwd();
      const here = hasFlag(args, '--here');
      const force = hasFlag(args, '--force');
      const install = hasFlag(args, '--install');
      const dev = hasFlag(args, '--dev');
      const [projectName] = readPositional(args);
      const registry = await loadTemplates();
      const template = findTemplate(registry, templateName);
      const { config, templatePath } = await loadTemplateConfig(template);
      const params = validateTemplateParams(config, {
        ...collectTemplateParams(args),
        ...(projectName ? { appName: projectName } : {}),
      });
      const context = {
        ...params,
        appName: params.appName || projectName || 'openwork-app',
        devPort: params.port || template.devPort || 9000,
        packageName: (params.appName || projectName || 'openwork-app').toLowerCase(),
      };
      context.proxyTargetPort = Number(context.devPort) + 1;
      const workspace = here ? workspaceRoot : path.resolve(workspaceRoot, context.appName);

      await renderTemplateToWorkspace({
        context,
        force,
        templatePath,
        workspace,
      });

      const projectConfig = {
        schemaVersion: 1,
        name: context.appName,
        template: template.name,
        createdAt: new Date().toISOString(),
        workspace,
        devPort: context.devPort,
        commands: renderCommands(config.commands, context),
      };
      await writeProjectConfig(workspace, projectConfig);

      if (install && (config.commands.install || []).length > 0) {
        await runLifecycleCommand({ commandName: 'install', streamOutput: !json, workspace });
      }
      if (dev) {
        await runLifecycleCommand({ commandName: 'dev', detached: true, workspace });
      }

      const payload = {
        ok: true,
        action: 'init',
        template: template.name,
        workspace,
        projectConfig: `${workspace.replace(/\/+$/g, '')}/.openwork/project.json`,
        installed: install && (config.commands.install || []).length > 0,
        devStarted: dev,
        port: context.devPort,
      };
      if (json) printJson(payload);
      else printText(`Initialized ${template.name} in ${workspace}`);
      return payload;
    }

    if (['dev', 'build', 'start'].includes(command)) {
      const workspace = readOption(args, '--workspace') || process.env.OPENWORK_WORKSPACE || process.cwd();
      const logFile = readOption(args, '--log-file');
      const payload = await runLifecycleCommand({
        commandName: command,
        logFile,
        streamOutput: !json,
        workspace,
      });
      if (json) printJson(payload);
      else printText(`${command} completed`);
      return payload;
    }

    if (command === 'status') {
      const workspace = readOption(args, '--workspace') || process.env.OPENWORK_WORKSPACE || process.cwd();
      const payload = await getProjectStatus(workspace);
      if (json) printJson(payload);
      else printText(`${payload.template} in ${workspace}`);
      return payload;
    }

    if (command === 'vite-proxy') {
      await runViteProxy(args);
      return { ok: true };
    }

    throw new OpenWorkCliError('UNKNOWN_COMMAND', `Unknown command: ${command || '(empty)'}`);
  } catch (error) {
    const cliError = toCliError(error);
    if (json) printJson(formatError(cliError));
    else process.stderr.write(`${cliError.code}: ${cliError.message}\n`);
    process.exitCode = 1;
    return formatError(cliError);
  }
}
