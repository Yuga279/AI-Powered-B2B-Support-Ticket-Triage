const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const errorResponses = {
  400: { description: 'Validation error', content: json(ref('Error')) },
  404: { description: 'Not found', content: json(ref('Error')) },
};
const ticketIdParam = { name: 'ticketId', in: 'path', required: true, schema: { type: 'string' } };
const providerEnum = ['jev', 'luna', 'openrouter_llm'];

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Support Triage POC API',
    version: '0.1.0',
    description:
      'AI-assisted B2B ticket triage. Real providers (TypeSafe Jev, OpenAI GPT-6 Luna Decisions, general LLMs) are all called via OpenRouter. ' +
      'Escalations are recorded only (no notifications are sent). No authentication: POC only.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Tickets' }, { name: 'Triage' }, { name: 'Providers' }, { name: 'Dashboard' }, { name: 'System' }],
  paths: {
    '/api/tickets': {
      post: {
        tags: ['Tickets'],
        summary: 'Create a ticket (JSON or multipart with optional screenshot), optionally triage it',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: ref('TicketCreate') },
            'multipart/form-data': {
              schema: {
                allOf: [ref('TicketCreate')],
                properties: { screenshot: { type: 'string', format: 'binary', description: 'PNG/JPEG/WebP, max 5 MB' } },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: json(ref('TicketCreateResponse')) },
          409: { description: 'Duplicate ticketId', content: json(ref('Error')) },
          413: { description: 'Upload too large', content: json(ref('Error')) },
          415: { description: 'Unsupported image type', content: json(ref('Error')) },
          ...errorResponses,
        },
      },
      get: {
        tags: ['Tickets'],
        summary: 'List tickets with latest classification',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['new', 'triaged', 'review_required', 'escalated', 'reviewed'] } },
          { name: 'team', in: 'query', schema: { type: 'string', enum: ['billing', 'infrastructure', 'auth_identity', 'frontend', 'unknown'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/tickets/{ticketId}': {
      get: {
        tags: ['Tickets'],
        summary: 'Ticket detail with full triage history, escalations and reviews',
        parameters: [ticketIdParam],
        responses: { 200: { description: 'OK' }, ...errorResponses },
      },
    },
    '/api/tickets/{ticketId}/review': {
      patch: {
        tags: ['Tickets'],
        summary: 'Record a human review decision',
        parameters: [ticketIdParam],
        requestBody: { required: true, content: json(ref('ReviewRequest')) },
        responses: { 200: { description: 'OK' }, ...errorResponses },
      },
    },
    '/api/triage/{ticketId}': {
      post: {
        tags: ['Triage'],
        summary: 'Run triage (auto routing, or a single provider). Each call creates a new run.',
        parameters: [ticketIdParam],
        requestBody: {
          required: false,
          content: json({
            type: 'object',
            properties: {
              provider: { type: 'string', enum: providerEnum },
            },
          }),
        },
        responses: { 200: { description: 'Triage outcome', content: json(ref('TriageResponse')) }, ...errorResponses },
      },
    },
    '/api/triage/compare': {
      post: {
        tags: ['Triage'],
        summary: 'Send the same ticket to 2+ providers; partial failures are returned, not thrown',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['ticketId', 'providers'],
            properties: {
              ticketId: { type: 'string' },
              providers: { type: 'array', minItems: 2, items: { type: 'string', enum: providerEnum } },
            },
          }),
        },
        responses: { 200: { description: 'Comparison' }, ...errorResponses },
      },
    },
    '/api/providers': {
      get: {
        tags: ['Providers'],
        summary: 'Provider configuration (never returns keys). probe=true checks the OpenRouter key via GET /key.',
        parameters: [{ name: 'probe', in: 'query', schema: { type: 'boolean' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/dashboard/stats': { get: { tags: ['Dashboard'], summary: 'Aggregate statistics', responses: { 200: { description: 'OK' } } } },
    '/api/escalations': { get: { tags: ['Dashboard'], summary: 'Simulated escalation events', responses: { 200: { description: 'OK' } } } },
    '/health': { get: { tags: ['System'], summary: 'Health check', responses: { 200: { description: 'OK' } } } },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
          },
        },
      },
      TicketCreate: {
        type: 'object',
        required: ['subject', 'description', 'affectedUsers', 'minutesUntilSlaDeadline'],
        properties: {
          ticketId: { type: 'string', example: 'TCK-1001' },
          subject: { type: 'string', example: 'Checkout API returning 502 for all EU customers' },
          description: { type: 'string' },
          logs: { type: 'string' },
          environment: { type: 'string', enum: ['production', 'staging', 'development'], default: 'production' },
          affectedUsers: { type: 'integer', example: 1200 },
          minutesUntilSlaDeadline: { type: 'integer', example: 30 },
          triageMode: { type: 'string', enum: ['none', 'auto', 'manual'], default: 'none' },
          providers: { type: 'array', items: { type: 'string', enum: providerEnum } },
        },
      },
      TicketCreateResponse: {
        type: 'object',
        properties: { ticket: { type: 'object' }, triage: { type: 'object', nullable: true }, triageError: { type: 'object', nullable: true } },
      },
      ReviewRequest: {
        type: 'object',
        required: ['decision', 'reviewer'],
        properties: {
          decision: { type: 'string', enum: ['confirmed', 'overridden', 'dismissed'] },
          team: { type: 'string', enum: ['billing', 'infrastructure', 'auth_identity', 'frontend', 'unknown'] },
          severity: { type: 'integer', minimum: 1, maximum: 5 },
          reviewer: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      TriageResult: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['ok', 'invalid', 'failed', 'unavailable'] },
          team: { type: 'string' },
          severity: { type: 'integer', nullable: true },
          riskAssessment: { type: 'object', properties: { level: { type: 'string' }, summary: { type: 'string' } } },
          breachProbability: { type: 'number', nullable: true, description: 'Only for riskOutputType=probability' },
          riskOutputType: { type: 'string', enum: ['probability', 'predicate', 'qualitative'], nullable: true },
          calibrationStatus: { type: 'string', enum: ['calibrated', 'vendor_claimed', 'unknown', 'not_applicable'] },
          predicateScore: { type: 'number', nullable: true, description: 'Luna predicate score; NOT a probability' },
          predicateVerdict: { type: 'boolean', nullable: true },
          explanation: { type: 'string' },
          humanReviewRequired: { type: 'boolean' },
          reviewReasons: { type: 'array', items: { type: 'string' } },
          durationMs: { type: 'integer' },
          costUsd: { type: 'number', nullable: true },
          error: { type: 'object', nullable: true },
          decidedAt: { type: 'string', format: 'date-time' },
        },
      },
      TriageResponse: {
        type: 'object',
        properties: {
          ticket: { type: 'object' },
          run: { type: 'object' },
          result: ref('TriageResult'),
          attempts: { type: 'array', items: { type: 'object' } },
          escalations: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};
