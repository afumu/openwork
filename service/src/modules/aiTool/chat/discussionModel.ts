export const DEFAULT_DISCUSSION_MODEL = 'gpt-5.3-codex';

function normalizeModelName(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveDiscussionModel(
  configValue: unknown,
  envModel = process.env.PI_DISCUSSION_MODEL,
) {
  const explicitModel = normalizeModelName(envModel);
  if (explicitModel) {
    return explicitModel;
  }

  const directConfigModel = normalizeModelName(configValue);
  if (directConfigModel) {
    return directConfigModel;
  }

  if (configValue && typeof configValue === 'object') {
    const nestedConfigModel = normalizeModelName(
      (configValue as { openaiBaseModel?: unknown }).openaiBaseModel,
    );
    if (nestedConfigModel) {
      return nestedConfigModel;
    }
  }

  return DEFAULT_DISCUSSION_MODEL;
}
