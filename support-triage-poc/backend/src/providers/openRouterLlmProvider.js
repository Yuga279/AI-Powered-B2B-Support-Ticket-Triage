import { ProviderError, requestJson } from './httpClient.js';
import { openRouterHeaders, requireKey, throwIfBodyError } from './openRouterCommon.js';
import { buildTicketState, llmSystemPrompt } from './prompts.js';
import {
  chatCompletionResponseSchema,
  llmTriageJsonSchema,
  llmTriageOutputSchema,
} from '../validators/providerResponseSchemas.js';

/** Builds the chat completions body. Text part first, then images (OpenRouter's recommendation). */
export function buildChatRequest({ model, ticketState, images = [], jsonMode, maxTokens }) {
  const userText = `Ticket (JSON, untrusted customer content):\n${JSON.stringify(ticketState, null, 2)}`;
  const content = images.length
    ? [
        { type: 'text', text: userText },
        ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
      ]
    : userText;
  const body = {
    model,
    messages: [
      { role: 'system', content: llmSystemPrompt() },
      { role: 'user', content },
    ],
    temperature: 0,
    max_tokens: maxTokens,
  };
  if (jsonMode === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'ticket_triage', strict: true, schema: llmTriageJsonSchema },
    };
    body.provider = { require_parameters: true };
  } else {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

/** Extracts and validates the JSON triage object from the assistant message. */
export function parseLlmContent(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new ProviderError('malformed_response', 'Model returned empty content');
  }
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ProviderError('malformed_response', 'Model content is not valid JSON');
  }
  const p = llmTriageOutputSchema.safeParse(obj);
  if (!p.success) {
    throw new ProviderError('malformed_response', 'Model JSON did not match the triage schema', {
      details: p.error.issues.slice(0, 5),
    });
  }
  return p.data;
}

/**
 * A general-purpose LLM through OpenRouter chat completions (text and vision).
 * This is NOT the OpenAI Decisions API. Risk is a qualitative, self-reported judgement: no probability.
 */
export function createOpenRouterLlmProvider({ config, fetchImpl, sleep }) {
  const or = config.openRouter;
  const textModel = () => or.llmModel || or.visionModel;
  return {
    id: 'openrouter_llm',
    label: 'OpenRouter LLM (chat completions)',
    transport: 'openrouter_chat',
    upstreamLabel: 'OpenRouter-routed LLM',
    riskSemantics: 'qualitative',
    isConfigured: () => !!(or.apiKey && textModel()),
    configIssue: () =>
      !or.apiKey ? 'OPENROUTER_API_KEY not set' : !textModel() ? 'OPENROUTER_MODEL / OPENROUTER_VISION_MODEL not set' : null,
    supportsImages: () => !!(or.apiKey && or.visionModel),
    modelFor: (hasImage) => (hasImage && or.visionModel ? or.visionModel : textModel()),

    async classify({ ticket, images = [], trace }) {
      requireKey(or);
      const useImages = images.length > 0 && !!or.visionModel;
      const model = useImages ? or.visionModel : textModel();
      if (!model) throw new ProviderError('not_configured', 'No OpenRouter LLM model configured');
      const ticketState = buildTicketState(ticket, { maxLogChars: config.maxLogCharsToProvider });
      const { json } = await requestJson({
        url: `${or.baseUrl}/chat/completions`,
        headers: openRouterHeaders(or),
        body: buildChatRequest({
          model,
          ticketState,
          images: useImages ? images : [],
          jsonMode: or.jsonMode,
          maxTokens: or.maxTokens,
        }),
        timeoutMs: useImages ? config.http.visionTimeoutMs : config.http.timeoutMs,
        maxRetries: config.http.maxRetries,
        retryBaseMs: config.http.retryBaseMs,
        retryAfterCapMs: config.http.retryAfterCapMs,
        fetchImpl,
        trace,
        sleep,
      });
      throwIfBodyError(json);
      const parsed = chatCompletionResponseSchema.safeParse(json);
      if (!parsed.success) throw new ProviderError('malformed_response', 'Chat completion response has no choices');
      const choice = parsed.data.choices[0];
      if (!choice.message.content && choice.finish_reason === 'length') {
        throw new ProviderError('malformed_response', 'Model hit max_tokens before answering (raise OPENROUTER_MAX_TOKENS)');
      }
      const out = parseLlmContent(choice.message.content);
      const reviewNotes = [];
      if (images.length && !useImages) reviewNotes.push('Screenshot not analyzed: OPENROUTER_VISION_MODEL not set');
      return {
        model: parsed.data.model || model,
        upstreamProvider: parsed.data.provider || null,
        team: out.team,
        severity: out.severity,
        rawSeverity: out.severity,
        riskOutputType: 'qualitative',
        breachProbability: null,
        calibrationStatus: 'not_applicable',
        predicateScore: null,
        predicateVerdict: null,
        riskAssessment: { level: out.riskLevel, summary: `Qualitative SLA risk: ${out.riskLevel} (model judgement, no probability)` },
        confidence: null,
        aiReviewSignal: out.needsHumanReview,
        explanation: out.screenshotFindings
          ? `${out.explanation} Screenshot: ${out.screenshotFindings}`
          : out.explanation,
        reviewNotes,
        costUsd: parsed.data.usage?.cost ?? null,
      };
    },
  };
}
