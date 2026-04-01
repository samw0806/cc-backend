import { Anthropic } from '@anthropic-ai/sdk'
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages'

let client: Anthropic | null = null

export function createClaudeClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL
  })
}

function getClaudeClient(): Anthropic {
  if (!client) {
    client = createClaudeClient()
  }

  return client
}

// 工具的 schema 定义（供 Claude API 使用）
export const TOOLS: Tool[] = [
  {
    name: 'Read',
    description: 'Read the contents of a file. Returns line-numbered output.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Start line (1-based, default 1)' },
        limit: { type: 'number', description: 'Max lines to return (default 2000)' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'Write',
    description: 'Write content to a file (creates or overwrites). Prefer Edit for modifying existing files.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Full content to write' }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'Edit',
    description: 'Perform an exact string replacement in a file. old_string must appear exactly once.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique in file)' },
        new_string: { type: 'string', description: 'Text to replace it with' }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern, sorted by modification time.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")' },
        path: { type: 'string', description: 'Directory to search in (default: cwd)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Grep',
    description: 'Search file contents using regex. Uses ripgrep when available.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search (default: cwd)' },
        glob: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
        '-i': { type: 'boolean', description: 'Case insensitive search' },
        '-A': { type: 'number', description: 'Lines of context after match' },
        '-B': { type: 'number', description: 'Lines of context before match' },
        '-C': { type: 'number', description: 'Lines of context around match' },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches'],
          description: 'content shows matching lines, files_with_matches shows only file paths'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Bash',
    description: 'Execute a shell command. Avoid destructive commands (rm -rf, sudo, etc).',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'WebFetch',
    description: 'Fetch a URL and return its text content (HTML is converted to plain text).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP/HTTPS URL to fetch' }
      },
      required: ['url']
    }
  }
]

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; toolInput: any }
  | { type: 'complete'; stopReason: string; usage: any }
  | { type: 'error'; error: string }

export async function* streamChat(
  messages: MessageParam[],
  systemPrompt?: string,
  model?: string
): AsyncGenerator<StreamChunk> {
  try {
    const stream = getClaudeClient().messages.stream({
      model: model ?? 'claude-opus-4-6',
      max_tokens: 8192,
      messages,
      tools: TOOLS,
      system: systemPrompt,
    })

    // 追踪当前正在收集的 tool_use 块
    const toolUseBlocks: Record<number, {
      id: string
      name: string
      inputJson: string
    }> = {}

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'tool_use') {
          // 初始化 tool_use 块收集
          toolUseBlocks[event.index] = {
            id: block.id,
            name: block.name,
            inputJson: ''
          }
        }
      }

      if (event.type === 'content_block_delta') {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          yield { type: 'text', content: delta.text }
        } else if (delta.type === 'input_json_delta') {
          // 累积工具输入 JSON
          if (toolUseBlocks[event.index]) {
            toolUseBlocks[event.index].inputJson += delta.partial_json
          }
        }
      }

      if (event.type === 'content_block_stop') {
        const block = toolUseBlocks[event.index]
        if (block) {
          // 工具输入收集完毕，解析 JSON 并 yield
          let parsedInput = {}
          try {
            parsedInput = block.inputJson ? JSON.parse(block.inputJson) : {}
          } catch (e) {
            console.error('[Claude] Failed to parse tool input JSON:', block.inputJson)
          }
          yield {
            type: 'tool_use',
            toolName: block.name,
            toolUseId: block.id,
            toolInput: parsedInput
          }
          delete toolUseBlocks[event.index]
        }
      }

      if (event.type === 'message_delta') {
        if (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'tool_use') {
          yield {
            type: 'complete',
            stopReason: event.delta.stop_reason,
            usage: event.usage
          }
        }
      }
    }
  } catch (error: any) {
    yield { type: 'error', error: error.message }
  }
}
