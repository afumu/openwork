import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenWorkCliError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const defaultTemplatesDir = path.join(packageRoot, 'templates');

export function getTemplatesDir() {
  return process.env.OPENWORK_TEMPLATES_DIR || defaultTemplatesDir;
}

export async function loadTemplates(templatesDir = getTemplatesDir()) {
  const configPath = path.join(templatesDir, 'templates.json');
  let raw;

  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new OpenWorkCliError(
      'TEMPLATE_CONFIG_INVALID',
      `Unable to read templates registry at ${configPath}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const registry = JSON.parse(raw);
  if (!Array.isArray(registry.templates)) {
    throw new OpenWorkCliError('TEMPLATE_CONFIG_INVALID', 'templates.json must contain templates[]');
  }

  return registry;
}

export function findTemplate(registry, name) {
  const template = registry.templates.find(item => item.name === name);
  if (!template) {
    throw new OpenWorkCliError('TEMPLATE_NOT_FOUND', `Template "${name}" not found`, {
      available: registry.templates.map(item => item.name),
    });
  }
  return template;
}

export async function loadTemplateConfig(template) {
  const templatePath = path.resolve(getTemplatesDir(), template.location);
  const configPath = path.join(templatePath, 'template.openwork.json');
  let config;

  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new OpenWorkCliError(
      'TEMPLATE_CONFIG_INVALID',
      `Unable to read template config for ${template.name}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  if (!config.commands || typeof config.commands !== 'object') {
    throw new OpenWorkCliError(
      'TEMPLATE_CONFIG_INVALID',
      `Template ${template.name} must define commands`,
    );
  }

  return { config, templatePath };
}

export function validateTemplateParams(config, params) {
  const schema = config.paramsSchema || { properties: {} };
  const properties = schema.properties || {};
  const normalized = {};

  for (const [key, definition] of Object.entries(properties)) {
    const input = params[key] ?? definition.default;
    if (input === undefined) continue;

    if (definition.type === 'number') {
      const value = Number(input);
      if (!Number.isFinite(value)) {
        throw new OpenWorkCliError('PARAM_VALIDATION_FAILED', `${key} must be a number`);
      }
      if (definition.minimum !== undefined && value < definition.minimum) {
        throw new OpenWorkCliError(
          'PARAM_VALIDATION_FAILED',
          `${key} must be greater than or equal to ${definition.minimum}`,
        );
      }
      if (definition.maximum !== undefined && value > definition.maximum) {
        throw new OpenWorkCliError(
          'PARAM_VALIDATION_FAILED',
          `${key} must be less than or equal to ${definition.maximum}`,
        );
      }
      normalized[key] = value;
      continue;
    }

    const value = String(input);
    if (definition.pattern && !new RegExp(definition.pattern).test(value)) {
      throw new OpenWorkCliError('PARAM_VALIDATION_FAILED', `${key} does not match ${definition.pattern}`);
    }
    normalized[key] = value;
  }

  return normalized;
}
