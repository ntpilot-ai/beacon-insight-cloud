export type HorizonMode = "guided" | "full";

export interface NoteAttachment {
  id:         string;
  kind:       "image";
  /** v1: data URL inline. v2 swap: a real storage URL. */
  data_url:   string;
  filename?:  string;
  byte_size?: number;
  created_at: string;
}

export interface Note {
  id:                 string;
  title:              string;
  subject:            string;
  body:               string;
  tags:               string[];
  attachments?:       NoteAttachment[];
  source_session_id?: string;
  source_message_id?: string;
  mode_when_saved?:   HorizonMode;
  created_at:         string;
  updated_at:         string;
}

export const DEFAULT_SUBJECTS = [
  "English",
  "Maths",
  "Science",
  "History",
  "Geography",
  "Computing",
  "Languages",
  "Art",
  "Other",
];

export const HORIZON_MODE_COPY: Record<HorizonMode, { label: string; explainer: string }> = {
  guided: {
    label:     "Guided",
    explainer: "Horizon will ask questions back and help you think it through — great for assessed work.",
  },
  full: {
    label:     "Full help",
    explainer: "Horizon will give you direct answers and worked examples — useful when you want to learn fast.",
  },
};
