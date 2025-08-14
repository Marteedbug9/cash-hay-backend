export interface BusinessAccountRequest {
  id: string;
  user_id: string;
  company_name: string;
  legal_status: string;
  business_type: string;
  contact_email_enc: string | null;
  contact_email_bidx: string | null;
  contact_phone_enc: string | null;
  contact_phone_bidx: string | null;
  tax_id_enc: string | null;
  reason: string | null;
  members_count: number | null;
  created_at: string;
  updated_at?: string | null;
}
