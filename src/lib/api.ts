import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

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

function toApiError(error: { message: string; code?: string }, status = 400): ApiError {
  const msg = error.message.toLowerCase();
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
    return new ApiError(401, 'That email and password combination did not match. Please verify your credentials and try again.');
  }
  if (msg.includes('email not confirmed')) {
    return new ApiError(401, 'Your email has not been confirmed yet. Please contact your workspace administrator.');
  }
  if (msg.includes('already registered') || msg.includes('already been registered') || (error.code === '23505' && msg.includes('email'))) {
    return new ApiError(409, 'An account with this email already exists.');
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return new ApiError(429, 'Too many attempts. Please wait a moment before trying again.');
  }
  return new ApiError(status, error.message || 'Request failed.');
}

let unauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

export const auth = {
  async signIn(email: string, password: string): Promise<AppUser> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toApiError(error, 401);
    if (!data.user) throw new ApiError(401, 'Sign-in failed. Please try again.');
    return await loadProfile(data.user.id);
  },

  async signUp(email: string, password: string, fullName: string): Promise<AppUser> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw toApiError(error, 400);
    if (!data.user) throw new ApiError(400, 'Sign-up failed. Please try again.');
    return await loadProfile(data.user.id);
  },

  async me(): Promise<AppUser> {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) throw new ApiError(401, 'Not authenticated');
    return await loadProfile(sessionData.session.user.id);
  },

  async signOut() {
    await supabase.auth.signOut();
  },

  onAuthStateChange(callback: (session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
  },

  getSession() {
    return supabase.auth.getSession();
  },
};

async function loadProfile(userId: string): Promise<AppUser> {
  const { data, error } = await supabase
    .from('app_profiles')
    .select('id, email, full_name, role, department, active')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toApiError(error, 500);
  if (!data) throw new ApiError(404, 'Workspace profile not found. Please contact your administrator.');
  return data as AppUser;
}

export const api = {
  async getAssets(): Promise<unknown[]> {
    const { data, error } = await supabase.from('it_assets').select('*').order('created_at', { ascending: false });
    if (error) throw toApiError(error, 500);
    return data ?? [];
  },

  async createAsset(body: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await supabase
      .from('it_assets')
      .insert({ ...body, status: 'AVAILABLE', condition: 'NEW' })
      .select('*')
      .single();
    if (error) throw toApiError(error, 400);
    return data;
  },

  async getInvoices(): Promise<unknown[]> {
    const { data, error } = await supabase.from('it_invoices').select('*').order('created_at', { ascending: false });
    if (error) throw toApiError(error, 500);
    return data ?? [];
  },

  async getTickets(): Promise<unknown[]> {
    const { data, error } = await supabase.from('it_tickets').select('*').order('created_at', { ascending: false });
    if (error) throw toApiError(error, 500);
    return data ?? [];
  },

  async createTicket(body: Record<string, unknown>): Promise<unknown> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userName = sessionData.session?.user?.user_metadata?.full_name ?? 'Service Desk';
    const ticketNumber = `TKT-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabase
      .from('it_tickets')
      .insert({
        ticket_number: ticketNumber,
        title: body.title,
        category: body.category || 'Other',
        priority: body.priority || 'MEDIUM',
        status: 'OPEN',
        assignee: body.assignee || 'Service Desk',
        requester: body.requester || userName,
        due_label: body.due_label || 'Due in 3 days',
      })
      .select('*')
      .single();
    if (error) throw toApiError(error, 400);
    return data;
  },

  async getPurchaseRequests(): Promise<unknown[]> {
    const { data, error } = await supabase.from('it_purchase_requests').select('*').order('created_at', { ascending: false });
    if (error) throw toApiError(error, 500);
    return data ?? [];
  },

  async createPurchaseRequest(body: Record<string, unknown>): Promise<unknown> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userName = sessionData.session?.user?.user_metadata?.full_name ?? 'Workspace user';
    const { data: profileData } = await supabase
      .from('app_profiles')
      .select('full_name, department')
      .eq('id', sessionData.session?.user?.id ?? '')
      .maybeSingle();
    const requestNumber = `PR-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabase
      .from('it_purchase_requests')
      .insert({
        request_number: requestNumber,
        title: body.title,
        requester: body.requester || profileData?.full_name || userName,
        department: body.department || profileData?.department || 'General',
        amount: Number(body.amount),
        status: 'PENDING_APPROVAL',
        needed_by: body.needed_by,
      })
      .select('*')
      .single();
    if (error) throw toApiError(error, 400);
    return data;
  },

  async uploadDocument(file: File, documentType: string): Promise<AppDocument> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) throw new ApiError(401, 'Sign in required');

    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

    const storagePath = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const upload = await supabase.storage.from('it-documents').upload(storagePath, file, { contentType: file.type, upsert: false });
    if (upload.error) throw toApiError(upload.error, 400);

    const { data, error } = await supabase
      .from('app_documents')
      .insert({
        storage_path: storagePath,
        original_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        sha256,
        document_type: documentType,
        extraction_status: 'UPLOADED',
        uploaded_by: userId,
      })
      .select('*')
      .single();
    if (error) throw toApiError(error, 400);
    return data as unknown as AppDocument;
  },

  async updateDocument(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.from('app_documents').update(updates).eq('id', id);
    if (error) throw toApiError(error, 400);
  },

  async processInvoice(imageDataUrl: string, filename: string, documentId?: string): Promise<{ extraction: Record<string, unknown> }> {
    const result = await supabase.functions.invoke('process-invoice', {
      body: { imageDataUrl, filename, document_id: documentId },
    });
    if (result.error || !result.data?.extraction) {
      throw new ApiError(502, 'AI invoice review is not available right now. Please try again later.');
    }
    return result.data as { extraction: Record<string, unknown> };
  },
};

export { supabase };
