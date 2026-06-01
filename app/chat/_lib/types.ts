export type MessageRole = "user" | "assistant" | "system";

export type MessageState = "normal" | "warn" | "block" | "escalate";

export interface Message {
  id:        string;
  role:      MessageRole;
  content:   string;
  state:     MessageState;
  risk?:     string;
  matched?:  string[];
  model?:    string;
  streaming?: boolean;
  timestamp: Date;
}

export interface Session {
  id:         string;
  title:      string;
  updated_at: string;
  created_at: string;
}

export interface ModelOption {
  id:        string;
  label:     string;
  vendor:    string;
  available: boolean;
}
