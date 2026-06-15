import type { Workflow, WorkflowVersion, Execution, ExecutionLog, WorkflowJson, IntegrationStatus, WorkflowStep, ExecutionChatMessage, ExecutionChatResponse } from "./types"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail ?? res.statusText
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// Workflows — plan + create in one step
export const planWorkflow = (naturalLanguage: string): Promise<Workflow> =>
  req("/api/workflows/", {
    method: "POST",
    body: JSON.stringify({ natural_language: naturalLanguage }),
  })

export const listWorkflows = (): Promise<Workflow[]> =>
  req("/api/workflows/")

export const getWorkflow = (id: string): Promise<Workflow> =>
  req(`/api/workflows/${id}`)

export const updateWorkflow = (
  id: string,
  patch: { name?: string; workflow_json?: WorkflowJson }
): Promise<Workflow> =>
  req(`/api/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  })

export const deleteWorkflow = (id: string): Promise<void> =>
  req(`/api/workflows/${id}`, { method: "DELETE" })

export const replanWorkflow = (id: string): Promise<Workflow> =>
  req(`/api/workflows/${id}/replan`, { method: "POST" })

// Workflow review — approve / reject
export const approveWorkflow = (
  id: string,
  execute: boolean = true
): Promise<Execution | Workflow> =>
  req(`/api/workflows/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ execute }),
  })

export const rejectWorkflow = (id: string, reason?: string): Promise<Workflow> =>
  req(`/api/workflows/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  })

// Step-level CRUD (for review / modify flow)
export const listSteps = (workflowId: string): Promise<WorkflowStep[]> =>
  req(`/api/workflows/${workflowId}/steps`)

export const addStep = (
  workflowId: string,
  step: { name: string; integration: string; action: string; params?: Record<string, unknown>; description?: string; insert_after?: string }
): Promise<Workflow> =>
  req(`/api/workflows/${workflowId}/steps`, {
    method: "POST",
    body: JSON.stringify(step),
  })

export const updateStep = (
  workflowId: string,
  stepId: string,
  patch: { name?: string; integration?: string; action?: string; params?: Record<string, unknown>; description?: string }
): Promise<Workflow> =>
  req(`/api/workflows/${workflowId}/steps/${stepId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })

export const deleteStep = (workflowId: string, stepId: string): Promise<Workflow> =>
  req(`/api/workflows/${workflowId}/steps/${stepId}`, { method: "DELETE" })

// Executions
export const executeWorkflow = (id: string, opts?: { start_from_step?: number }): Promise<Execution> =>
  req(`/api/workflows/${id}/execute`, {
    method: "POST",
    body: opts ? JSON.stringify(opts) : undefined,
  })

export const listExecutions = (workflowId: string): Promise<Execution[]> =>
  req(`/api/workflows/${workflowId}/executions`)

export const getExecution = (id: string): Promise<Execution> =>
  req(`/api/executions/${id}`)

export const getExecutionLogs = (id: string): Promise<ExecutionLog[]> =>
  req(`/api/executions/${id}/logs`)

export const resumeExecution = (id: string): Promise<Execution> =>
  req(`/api/executions/${id}/resume`, { method: "POST" })

// Version history
export const getWorkflowVersions = (id: string): Promise<WorkflowVersion[]> =>
  req(`/api/workflows/${id}/versions`)

// Integration management
export const getIntegrationStatus = (): Promise<IntegrationStatus[]> =>
  req("/api/integrations/status")

export const saveSlackToken = (bot_token: string): Promise<{ integration: string; connected: boolean }> =>
  req("/api/integrations/slack", {
    method: "POST",
    body: JSON.stringify({ bot_token }),
  })

export const disconnectIntegration = (name: string): Promise<{ disconnected: string[] }> =>
  req(`/api/integrations/${name}`, { method: "DELETE" })

// Execution session chat
export const chatWithExecution = (
  executionId: string,
  message: string,
  history: ExecutionChatMessage[],
): Promise<ExecutionChatResponse> =>
  req(`/api/executions/${executionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message, history }),
  })

// Workflow session chat
export const chatWithWorkflow = (
  workflowId: string,
  message: string,
): Promise<{ reply: string; workflow_json?: WorkflowJson }> =>
  req(`/api/workflows/${workflowId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  })

// Schedule management
export const enableSchedule = (
  id: string,
  scheduleTimezone: string = "UTC"
): Promise<Workflow> =>
  req(`/api/workflows/${id}/schedule/enable`, {
    method: "POST",
    body: JSON.stringify({ schedule_enabled: true, schedule_timezone: scheduleTimezone }),
  })

export const disableSchedule = (id: string): Promise<Workflow> =>
  req(`/api/workflows/${id}/schedule/disable`, { method: "POST" })

export const updateSchedule = (
  id: string,
  scheduleEnabled: boolean,
  scheduleTimezone: string = "UTC"
): Promise<Workflow> =>
  req(`/api/workflows/${id}/schedule`, {
    method: "PUT",
    body: JSON.stringify({ schedule_enabled: scheduleEnabled, schedule_timezone: scheduleTimezone }),
  })

export const getScheduleStatus = (id: string): Promise<Workflow> =>
  req(`/api/workflows/${id}/schedule/status`)

