import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

// 工具的 schema 定义（供 Claude API 使用）
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'Read',
    description: 'Read the contents of a file at the given path',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to read'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'Write',
    description: 'Write content to a file at the given path (creates or overwrites)',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to write'
        },
        content: {
          type: 'string',
          description: 'Content to write to the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g. "**/*.ts")'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (optional, defaults to cwd)'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Bash',
    description: 'Execute a shell command in the working directory',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default 30000)'
        }
      },
      required: ['command']
    }
  }
]

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; toolInput: any }
  | { type: 'complete'; stopReason: string; usage: any }
  | { type: 'error'; error: string }

export async function* streamChat(
  messages: Anthropic.MessageParam[],
  systemPrompt?: string
): AsyncGenerator<StreamChunk> {
  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-5',
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
