/**
 * Provider adapter. Ported verbatim from poc/seo-dashboard/lib/ai-recommend/provider.ts (only the
 * ./types import gained a .js extension for NodeNext ESM). No filesystem, no crawler dependency —
 * pure fetch against the configured LLM. Development target: Gemini on Google AI Studio's free
 * tier (GEMINI_API_KEY, set in server/.env); createProviderFromEnv also supports OpenRouter /
 * NVIDIA / OpenAI-compatible endpoints.
 */
import type { AiProvider, AiProviderResult, JsonSchema } from "./types.js";

const DEFAULT_MODEL = "gemini-3.6-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 90_000;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Gemini's `responseSchema` is a constrained subset of an OpenAPI 3.0 Schema Object: `type` is a
 *  proto enum written UPPERCASE, and unrecognized keys like `$schema`/`additionalProperties` are
 *  rejected outright. This converts our provider-agnostic lowercase JsonSchema into that shape. */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  return transform(schema) as JsonSchema;
}

function transform(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(transform);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "additionalProperties" || key === "$schema") continue;
      if (key === "type" && typeof value === "string") {
        out[key] = value.toUpperCase();
        continue;
      }
      out[key] = transform(value);
    }
    return out;
  }
  return node;
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1]!, data: match[2]! };
}

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GeminiProviderOptions) {
    if (!opts.apiKey) throw new Error("GeminiProvider requires an apiKey — set GEMINI_API_KEY.");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;
    imageDataUrl?: string | null;
  }): Promise<AiProviderResult | null> {
    const parts: Record<string, unknown>[] = [{ text: input.userPrompt }];
    if (input.imageDataUrl) {
      const parsed = parseDataUrl(input.imageDataUrl);
      if (parsed) parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.data } });
    }

    const body = {
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(input.schema),
        temperature: 0.2,
      },
    };

    const url = `${API_BASE}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    let res: Response | null = null;
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        try {
          res = await this.fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error(
              `AI request timed out after ${Math.round(this.timeoutMs / 1000)}s — the model took too long. ` +
                `Try again, or generate per-rule (fewer pages at once) if this keeps happening. ` +
                `You can raise the limit with GEMINI_TIMEOUT_MS (milliseconds).`,
            );
          }
          throw err;
        }

        if (!res.ok) {
          const isRetryable = res.status === 429 || res.status === 503 || res.status === 500 || res.status === 502;
          if (isRetryable && attempt < maxAttempts) {
            const delay = 1000 * Math.pow(2, attempt);
            console.warn(`[Gemini] API error ${res.status}. Retrying in ${delay}ms... (Attempt ${attempt}/${maxAttempts})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          const text = await res.text().catch(() => "");
          throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 500)}`);
        }

        break; // Success
      } finally {
        clearTimeout(timer);
      }
    }

    if (!res) throw new Error("Gemini API request failed unexpectedly.");

    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const selfReportedConfidence = typeof record.selfReportedConfidence === "number" ? record.selfReportedConfidence : null;
    return { raw: parsed, selfReportedConfidence, model: this.model };
  }
}

/** Best-effort fetch of a crawled image's bytes for the vision call. Never throws — a failed
 *  fetch just degrades generation to text-only context. */
export async function fetchImageAsDataUrl(url: string, timeoutMs = 10_000, maxBytes = 4 * 1024 * 1024): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    if (!contentType || !contentType.startsWith("image/")) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface OpenAiCompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  providerName: string;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAiCompatibleProviderOptions) {
    this.name = opts.providerName;
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;
    imageDataUrl?: string | null;
  }): Promise<AiProviderResult | null> {
    let userContent: unknown = input.userPrompt;
    if (input.imageDataUrl) {
      userContent = [
        { type: "text", text: input.userPrompt },
        { type: "image_url", image_url: { url: input.imageDataUrl } },
      ];
    }

    const body = {
      model: this.model,
      messages: [
        { role: "system", content: input.systemPrompt + `\n\nYou MUST return ONLY valid JSON matching this schema:\n${JSON.stringify(input.schema)}` },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    };

    const url = `${this.baseUrl}/chat/completions`;
    let res: Response | null = null;
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        try {
          res = await this.fetchImpl(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${this.apiKey}`,
              "http-referer": "https://autonomous-seo-platform.local",
              "x-title": "Autonomous SEO Platform",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error(`AI request timed out after ${Math.round(this.timeoutMs / 1000)}s.`);
          }
          throw err;
        }

        if (!res.ok) {
          const isRetryable = res.status === 429 || res.status === 503 || res.status === 500 || res.status === 502;
          if (isRetryable && attempt < maxAttempts) {
            const delay = 1000 * Math.pow(2, attempt);
            console.warn(`[${this.name}] API error ${res.status}. Retrying in ${delay}ms... (Attempt ${attempt}/${maxAttempts})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          const text = await res.text().catch(() => "");
          throw new Error(`${this.name} API error ${res.status}: ${text.slice(0, 500)}`);
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    if (!res) throw new Error(`${this.name} API request failed unexpectedly.`);

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return null;

    let parsed: unknown;
    try {
      const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const selfReportedConfidence = typeof record.selfReportedConfidence === "number" ? record.selfReportedConfidence : null;
    return { raw: parsed, selfReportedConfidence, model: json.model ?? this.model };
  }
}

/** Reads API keys from environment. Prioritizes OPENROUTER, then NVIDIA, then OPENAI, and falls back to GEMINI. */
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const timeoutMs = env.AI_TIMEOUT_MS ? Number(env.AI_TIMEOUT_MS) : env.GEMINI_TIMEOUT_MS ? Number(env.GEMINI_TIMEOUT_MS) : undefined;
  const parsedTimeout = Number.isFinite(timeoutMs) && timeoutMs! > 0 ? timeoutMs : undefined;

  if (env.OPENROUTER_API_KEY) {
    return new OpenAiCompatibleProvider({
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
      model: env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
      timeoutMs: parsedTimeout,
      providerName: "openrouter",
    });
  }

  if (env.NVIDIA_API_KEY) {
    return new OpenAiCompatibleProvider({
      apiKey: env.NVIDIA_API_KEY,
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: env.NVIDIA_MODEL || "meta/llama-3.1-405b-instruct",
      timeoutMs: parsedTimeout,
      providerName: "nvidia",
    });
  }

  if (env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: "https://api.openai.com/v1",
      model: env.OPENAI_MODEL || "gpt-4o",
      timeoutMs: parsedTimeout,
      providerName: "openai",
    });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No AI provider configured. Set OPENROUTER_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY " +
        "in server/.env before generating AI recommendations.",
    );
  }
  return new GeminiProvider({ apiKey, model: env.GEMINI_MODEL, timeoutMs: parsedTimeout });
}

/** True when at least one provider key is present — the route uses this to answer 503 (instead of
 *  throwing) when generation is requested but nothing is configured. */
export function hasProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY || env.NVIDIA_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY);
}
