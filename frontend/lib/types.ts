export type ExecutionStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "waiting_input"
export type LogStatus = "success" | "failed" | "skipped"

export interface PendingInput {
  question: string
  integration: string
  resource_type: string
  resource_name: string
  step_index: number
  step_name: string
  spreadsheet_id?: string
}

export interface WorkflowStep {
  id: string
  name: string
  type: string
  integration: string
  action: string
  params: Record<string, unknown>
  description?: string
}

export interface WorkflowTrigger {
  type: string
  source: string
  condition?: string
}

export interface WorkflowJson {
  name: string
  trigger: WorkflowTrigger
  steps: WorkflowStep[]
  explanation: string
}

export type WorkflowStatus = "draft" | "approved" | "rejected"

export interface Workflow {
  id: string
  name: string
  original_input: string
  workflow_json: WorkflowJson
  explanation: string
  status: WorkflowStatus
  created_at: string
  updated_at: string
  schedule_enabled: boolean
  schedule_timezone: string
  next_run: string | null
}

export type ChangeField =
  | { field: "name";             before: string; after: string }
  | { field: "step_added";       step_name: string; step_id: string }
  | { field: "step_removed";     step_name: string; step_id: string }
  | { field: "step_name";        step_id: string; before: string; after: string }
  | { field: "step_action";      step_id: string; step_name: string; before: string; after: string }
  | { field: "step_params";      step_id: string; step_name: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { field: "steps_reordered" }

export interface WorkflowVersion {
  id: string
  workflow_id: string
  version_number: number
  name: string
  workflow_json: WorkflowJson
  change_summary: string
  changed_fields: ChangeField[] | null
  created_at: string
}

export interface IntegrationStatus {
  integration: "gmail" | "slack" | "sheets"
  connected: boolean
  connected_at: string | null
}

export interface Execution {
  id: string
  workflow_id: string
  status: ExecutionStatus
  current_step: number
  started_at: string | null
  completed_at: string | null
  error: string | null
  duration_seconds?: number | null
  pending_input?: PendingInput | null
}

// ── Execution session chat ─────────────────────────────────────────────────

export interface ExecutionChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ExecutionChatResponse {
  reply: string
}

export interface ExecutionLog {
  id: string
  execution_id: string
  step_index: number
  step_name: string
  integration: string
  action: string
  status: LogStatus
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
  error: string | null
  retry_count: number
  started_at: string | null
  created_at: string
  updated_at: string | null
}
