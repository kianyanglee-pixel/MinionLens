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
  category: string;
  automated_status: string;
  automated_review_reason?: string;
  current_status: string;
  current_review_reason?: string;
  has_defect: boolean;
  defect_fields: string[];
  processed_at: string;
  trace: EmailTrace;
  review_audit_log?: AuditLog[];
}