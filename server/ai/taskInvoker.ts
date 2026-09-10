import type { InvokeParams, InvokeResult } from "../_core/llm";
import { routeAiTask } from "./taskRouter";
import type { AiTask } from "./types";

export function createAiTaskInvoker(task: AiTask, context: { storeId?: number | null; customerId?: number | null; conversationId?: number | null } = {}) {
  return async (params: InvokeParams): Promise<InvokeResult> => {
    const result = await routeAiTask({
      task,
      messages: params.messages,
      storeId: context.storeId,
      customerId: context.customerId,
      conversationId: context.conversationId,
      responseFormat: params.responseFormat ?? params.response_format ?? (params.outputSchema || params.output_schema ? {
        type: "json_schema",
        json_schema: params.outputSchema ?? params.output_schema!,
      } : undefined),
    });
    return {
      id: result.id,
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: result.finishReason }],
      usage: { prompt_tokens: result.inputTokens, completion_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens },
    };
  };
}
