/**
 * TypeScript/JavaScript client for the AI Agent Platform.
 * Works in browsers (Angular, React, Vue) and Node 18+ (global fetch).
 *
 *   const client = new AgentPlatformClient({ baseUrl: "https://agents.example.com", token: () => auth.getToken() });
 *   const res = await client.chat("Compare inventory valuation with trading exposure");
 *   for await (const ev of client.chatStream("Show inventory valuation")) console.log(ev.event_type);
 */

export type ExecutionStatus =
  | "CREATED" | "PLANNING" | "VALIDATING" | "READY" | "RUNNING" | "WAITING"
  | "COMPLETED" | "FAILED" | "CANCELLED" | "REJECTED";

export type StepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELLED";

export interface ErrorInfo {
  code: string;
  message: string;
  category: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  correlation_id?: string | null;
}

export interface MetricArtifact { type: "metric"; title: string; value: number | string; format?: string; currency?: string | null }
export interface TableArtifact {
  type: "table"; title: string; currency?: string | null;
  columns: { field: string; label: string; data_type: string }[];
  rows: Record<string, unknown>[];
}
export interface ChartArtifact {
  type: "chart"; title: string; chart_type: "bar" | "line" | "pie"; x: string; y: string[];
  data: Record<string, unknown>[]; currency?: string | null;
}
export interface CitationsArtifact {
  type: "citations"; title: string;
  items: { index: number; filename: string; page?: number | null; snippet: string; document_id: string }[];
}
export interface TextArtifact { type: "text"; title?: string | null; text: string }
export type Artifact = MetricArtifact | TableArtifact | ChartArtifact | CitationsArtifact | TextArtifact
  | { type: string; [key: string]: unknown };

export interface PlanStep {
  step_id: string; capability: string; agent_id?: string | null; agent_version?: string | null;
  depends_on: string[]; input_mapping: Record<string, string>; condition?: string | null;
}
export interface StepRecord {
  step_id: string; capability: string; agent_id?: string | null; status: StepStatus; attempts: number;
  duration_ms?: number | null; error?: ErrorInfo | null; skip_reason?: string | null;
}
export interface ChatResponse {
  request_id: string; execution_id: string; conversation_id: string; status: ExecutionStatus;
  capability: string | null; capabilities: string[]; response: string;
  plan: { plan_id: string; steps: PlanStep[] } | null;
  steps: Record<string, StepRecord>; ui: Artifact[]; citations: Record<string, unknown>[];
  error?: ErrorInfo | null;
}
export interface PlatformEvent {
  event_id: string; event_type: string; timestamp: string; execution_id?: string | null;
  payload: Record<string, unknown>;
}
export interface ChatRequest {
  message: string; conversation_id?: string; capabilities?: string[];
  variables?: Record<string, unknown>; attachments?: string[]; metadata?: Record<string, unknown>;
}

export class PlatformApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.detail ?? `HTTP ${status}`);
  }
  get code(): string | undefined { return this.body?.error?.code; }
}

export interface ClientOptions {
  baseUrl: string;
  /** Static token or a function returning the current (e.g. OIDC) access token. */
  token: string | (() => string | Promise<string>);
  fetch?: typeof fetch;
}

export class AgentPlatformClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  private async headers(json = true): Promise<Record<string, string>> {
    const token = typeof this.options.token === "function" ? await this.options.token() : this.options.token;
    return { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method, headers: await this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new PlatformApiError(res.status, data);
    return data as T;
  }

  chat(message: string | ChatRequest): Promise<ChatResponse> {
    const body = typeof message === "string" ? { message } : message;
    return this.request("POST", "/api/v1/chat", body);
  }

  submit(request: ChatRequest): Promise<{ execution_id: string; links: Record<string, string> }> {
    return this.request("POST", "/api/v1/chat", { ...request, mode: "async" });
  }

  /** Streams lifecycle events; the last event's payload.response is the full ChatResponse. */
  async *chatStream(message: string | ChatRequest, signal?: AbortSignal): AsyncGenerator<PlatformEvent> {
    const body = typeof message === "string" ? { message } : message;
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/chat/stream`, {
      method: "POST", headers: await this.headers(), body: JSON.stringify(body), signal,
    });
    if (!res.ok || !res.body) throw new PlatformApiError(res.status, await res.json().catch(() => null));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n");
        if (data) yield JSON.parse(data) as PlatformEvent;
      }
    }
  }

  getExecution(executionId: string) { return this.request<any>("GET", `/api/v1/executions/${executionId}`); }
  cancel(executionId: string) { return this.request<any>("POST", `/api/v1/executions/${executionId}/cancel`); }
  previewPlan(message: string) { return this.request<any>("POST", "/api/v1/plans/preview", { message }); }
  listAgents() { return this.request<any[]>("GET", "/api/v1/agents"); }
  listCapabilities() { return this.request<any[]>("GET", "/api/v1/capabilities"); }
  listConversations() { return this.request<any[]>("GET", "/api/v1/conversations"); }

  async uploadDocument(file: Blob, filename: string, knowledgeBase = "default"): Promise<any> {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("knowledge_base", knowledgeBase);
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/documents`, {
      method: "POST", headers: await this.headers(false), body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new PlatformApiError(res.status, data);
    return data;
  }
}
