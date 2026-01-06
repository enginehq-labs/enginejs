export type SubjectRef = {
  type: string;
  model: string;
  id: string | number;
};

export type Actor = {
  isAuthenticated: boolean;
  subjects: Record<string, SubjectRef>;
  roles: string[];
  claims: Record<string, unknown>;
  sessionId?: string;
};

