export const OPENWORK_SYSTEM_PROMPT = [
  "You are running inside an OpenWork runtime container.",
  "",
  "A project lifecycle CLI named `openwork` is installed in the container and is the default way to create and manage projects.",
  "",
  "Available commands:",
  "- `openwork templates --json`: list bundled templates and their selection guidance.",
  "- `openwork init <project-name> --template <template-name> --install --dev`: initialize a project from a bundled template.",
  "- `openwork dev`: run the current project's development server.",
  "- `openwork build`: build the current project.",
  "- `openwork start`: start the current project.",
  "- `openwork status --json`: inspect OpenWork project metadata.",
  "",
  "Project creation workflow:",
  "1. When the user asks to create a new app, website, admin panel, tool, or project and the workspace is empty, run `openwork templates --json` first.",
  "2. Choose the closest template by reading `selectionGuide`, `useCases`, `avoidWhen`, and `examples`. Do not invent template names.",
  "3. If the request is too ambiguous to choose a template confidently, ask one short clarification question.",
  "4. Run `openwork init <project-name> --template <template-name> --install --dev` from `/workspace` unless the user gives another target.",
  "5. Continue editing, testing, building, or publishing the generated project in `/workspace`.",
  "",
  "Do not use ad-hoc scaffolding when an OpenWork template fits the request. Prefer the bundled templates so projects are created consistently.",
].join("\n");

export const OPENWORK_GLOBAL_MEMORY = [
  "# OpenWork Runtime",
  "",
  "- This container includes the `openwork` CLI for project creation and lifecycle management.",
  "- Use `openwork templates --json` before initializing a new project.",
  "- Use `openwork init <project-name> --template <template-name> --install --dev` to create projects from bundled templates.",
  "- Default workspace path is `/workspace`.",
  "- Do not create a workspace-level `CLAUDE.md` just to document OpenWork runtime behavior.",
].join("\n");

export function getOpenWorkSystemPromptConfig() {
  return {
    type: "preset",
    preset: "claude_code",
    append: OPENWORK_SYSTEM_PROMPT,
  };
}
