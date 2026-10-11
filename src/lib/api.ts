const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type AppUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  department: string;
  active: boolean;
};

export type WorkspaceSettings = {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  currency: string;
  timezone: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  purchaseOrderPrefix: string;
  paymentTermsDays: number;
  requirePurchaseOrder: boolean;
  approvalThreshold: number;
  approvalLevels: number;
  defaultApproverRole: string;
  autoApproveLimit: number;
  notificationsEmail: boolean;
  notificationsInApp: boolean;
  notifyPurchaseRequests: boolean;
  notifyInvoices: boolean;
  notifyApprovals: boolean;
  notifySlaBreaches: boolean;
  apEscalationEnabled: boolean;
  apEscalationAfterHours: number;
  apEscalationRepeatHours: number;
  apEscalationEmail: string;
  slaLowResponseHours: number;
  slaLowResolutionHours: number;
  slaMediumResponseHours: number;
  slaMediumResolutionHours: number;
  slaHighResponseHours: number;
  slaHighResolutionHours: number;
  slaUrgentResponseHours: number;
  slaUrgentResolutionHours: number;
};

export type AppDocument = {
  id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  document_type: string;
  extraction_status: string;
  extracted_fields: Record<string, unknown>;
  confidence: number | null;
  review_reason: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

let unauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('itam_token');
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  const isSignInRequest = /^\/api\/auth\/(signin|signup|google)$/.test(path);
  if (response.status === 401 && !isSignInRequest) {
    localStorage.removeItem('itam_token');
    unauthorizedHandler?.();
    throw new ApiError(401, 'Your session expired. Please sign in again.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? 'Request failed.';
    throw new ApiError(response.status, message);
  }
  return data as T;
}

async function requestDownload(path: string): Promise<Blob> {
  const token = localStorage.getItem('itam_token');
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 401) {
    localStorage.removeItem('itam_token');
    unauthorizedHandler?.();
    throw new ApiError(401, 'Your session expired. Please sign in again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, (data as { error?: string } | null)?.error ?? 'Download failed.');
  }
  return response.blob();
}

export const api = {
  get<T>(path: string) {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown) {
    return request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<T>(path: string, body: unknown) {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  },
  patch<T>(path: string, body: unknown) {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  },
  download(path: string) {
    return requestDownload(path);
  },
  del<T>(path: string) {
    return request<T>(path, { method: 'DELETE' });
  },
  upload<T>(path: string, file: File, extra: Record<string, string> = {}) {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    return request<T>(path, { method: 'POST', body: form });
  },
};

export const auth = {
  async signIn(email: string, password: string): Promise<AppUser> {
    const data = await api.post<{ token: string; user: AppUser }>('/api/auth/signin', { email, password });
    localStorage.setItem('itam_token', data.token);
    return data.user;
  },
  async signUp(email: string, password: string, fullName: string): Promise<AppUser> {
    const data = await api.post<{ token: string; user: AppUser }>('/api/auth/signup', {
      email,
      password,
      full_name: fullName,
    });
    localStorage.setItem('itam_token', data.token);
    return data.user;
  },
  async signInWithGoogle(credential: string): Promise<AppUser> {
    const data = await api.post<{ token: string; user: AppUser }>('/api/auth/google', { credential });
    localStorage.setItem('itam_token', data.token);
    return data.user;
  },
  me(): Promise<AppUser> {
    return api.get<AppUser>('/api/auth/me');
  },
  signOut() {
    localStorage.removeItem('itam_token');
  },
};
