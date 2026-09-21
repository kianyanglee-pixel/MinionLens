export interface RunSummary {
  run_id: string;
  started_at: string;
  completed_at?: string;
  email_count: number;
  mismatch_count: number;
  needs_review_count: number;
  clear_count?: number;
  spam_count?: number;
}

export interface FieldComparison {
  label: string;
  match: boolean | null;
  siValue: any;
  blValue: any;
}

export interface EmailTrace {
  comparison: {
    bl_path: string;
    si_path: string;
    field_comparisons: Record<string, FieldComparison>;
  } | null;
  classification: {
    category: string;
    confidence: string;
    reason: string;
  };
}

export interface AuditLog {
  id: number;
  email_id: string;
  escalated_at: string;
  review_reason: string;
  automated_result: string;
  action: string;
  resolved_at?: string;
  resolved_by?: string;
  human_decision?: string;
  notes?: string;
}

export interface EmailRecord {
  email_id: string;
  email_name: string;
  // Needed to scope a resolve action to this run — email_id alone is only
  // unique within a run (bare id, no run_id prefix), not across runs.
  run_id: string;
  category: string;
  automated_status: string;
  automated_review_reason?: string;
  current_status: string;
  current_review_reason?: string;
  has_defect: boolean;
  defect_fields: string[];
  awaiting_sender_response: boolean;
  is_processing_failure: boolean;
  processed_at: string;
  trace: EmailTrace;
  // PostgREST returns this as a single object (not an array!) when the
  // relationship resolves to at most one row — which it always does here,
  // since review_audit_log has a unique(email_id, run_id) constraint — or
  // null when there's no escalation at all. Never an array in practice.
  review_audit_log?: AuditLog | null;
}

export interface OriginalEmail {
  sender: string;
  subject: string;
  body: string;
  attachments: string[];
}