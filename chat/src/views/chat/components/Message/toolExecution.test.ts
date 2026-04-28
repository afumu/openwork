import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractFilePath,
  extractToolValueFields,
  extractWriteContent,
  getToolExecutionDisplayModel,
  normalizeToolName,
  parseToolExecutionValue,
  stringifyToolValue,
} from './toolExecution'

describe('tool execution rendering model', () => {
  it('normalizes common Claude and Codex tool aliases', () => {
    assert.equal(normalizeToolName('bash'), 'Bash')
    assert.equal(normalizeToolName('exec_command'), 'Bash')
    assert.equal(normalizeToolName('update_plan'), 'UpdatePlan')
    assert.equal(normalizeToolName('apply_patch'), 'Edit')
  })

  it('extracts structured input and result before falling back to previews', () => {
    const model = getToolExecutionDisplayModel({
      event: 'end',
      input: { command: 'rg OpenSandbox service/src' },
      phase: 'completed',
      result: { stdout: 'service/src/foo.ts\n', stderr: '' },
      result_preview: 'ignored when result exists',
      tool_call_id: 'bash-1',
      tool_name: 'Bash',
    })

    assert.equal(model.toolName, 'Bash')
    assert.equal(model.status, 'complete')
    assert.equal(model.summary, 'rg OpenSandbox service/src')
    assert.deepEqual(model.input, { command: 'rg OpenSandbox service/src' })
    assert.deepEqual(model.result, { stdout: 'service/src/foo.ts\n', stderr: '' })
  })

  it('builds readable summaries for file edits and plans', () => {
    assert.equal(
      getToolExecutionDisplayModel({
        args_preview: JSON.stringify({
          file_path: '/workspace/src/app.ts',
          new_string: 'new',
          old_string: 'old',
        }),
        event: 'start',
        phase: 'executing',
        tool_call_id: 'edit-1',
        tool_name: 'Edit',
      }).summary,
      'app.ts'
    )

    assert.equal(
      getToolExecutionDisplayModel({
        event: 'end',
        input: {
          plan: [
            { status: 'completed', step: 'Inspect renderer' },
            { status: 'in_progress', step: 'Implement cards' },
          ],
        },
        phase: 'completed',
        tool_call_id: 'plan-1',
        tool_name: 'update_plan',
      }).summary,
      '1/2 completed'
    )
  })

  it('keeps workflow step titles readable', () => {
    const model = getToolExecutionDisplayModel({
      display_title: 'Claude Code 容器已启动',
      event: 'start',
      kind: 'workflow_step',
      phase: 'executing',
      tool_call_id: 'runtime-1',
      tool_name: 'opensandbox_agent',
    })

    assert.equal(model.toolName, 'OpenWork')
    assert.equal(model.summary, 'Claude Code 容器已启动')
  })

  it('parses JSON previews and keeps plain text intact', () => {
    assert.deepEqual(parseToolExecutionValue('{"query":"OpenSandbox"}'), {
      query: 'OpenSandbox',
    })
    assert.equal(parseToolExecutionValue('plain output'), 'plain output')
  })

  it('extracts write content and paths from complete or streaming JSON input', () => {
    const completeInput = {
      content: 'line 1\nline 2\nline 3',
      file_path: '/workspace/src/generated.ts',
    }
    assert.equal(extractWriteContent(completeInput), 'line 1\nline 2\nline 3')
    assert.equal(extractFilePath(completeInput, undefined), '/workspace/src/generated.ts')

    const streamingInput =
      '{"file_path":"/workspace/src/generated.ts","content":"line 1\\nline 2\\nline 3'
    assert.equal(extractWriteContent(streamingInput), 'line 1\nline 2\nline 3')
    assert.equal(extractFilePath(streamingInput, undefined), '/workspace/src/generated.ts')
  })

  it('stringifies full tool values unless a caller explicitly asks for truncation', () => {
    const longText = 'x'.repeat(5001)
    assert.equal(stringifyToolValue(longText), longText)
    assert.equal(stringifyToolValue(longText, 10), 'xxxxxxxxxx...')
  })

  it('turns generic JSON tool parameters into readable fields', () => {
    const fields = extractToolValueFields({
      description: 'Search files',
      prompt: 'Find every OpenSandbox runtime reference',
      path: '/workspace/service/src',
      nested: { limit: 20 },
    })

    assert.deepEqual(
      fields.map(field => [field.key, field.label, field.value]),
      [
        ['description', 'Description', 'Search files'],
        ['prompt', 'Prompt', 'Find every OpenSandbox runtime reference'],
        ['path', 'Path', '/workspace/service/src'],
        ['nested', 'Nested', '{\n  "limit": 20\n}'],
      ]
    )
    assert.equal(fields.find(field => field.key === 'nested')?.multiline, true)
  })
})
