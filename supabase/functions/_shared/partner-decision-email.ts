import { PartnerEmailDecision } from './email-templates/partner/application-decision.ts';
export type SavedPartnerDecision = { review_id: string; organization_id: string; application_id: string; recipient: string; partner_name: string; decision: string; notes: string; tenant_id: string | null };
export async function deliverPartnerDecisionEmail(saved: SavedPartnerDecision, options: { url: string; token: string; fetcher?: typeof fetch }): Promise<{ status: string; log_id?: string | null; error?: string }> {
  if (!['under_review','approved','rejected','suspended','more_information'].includes(saved.decision)) return { status: 'failed', error: 'Unsupported partner decision' };
  if (!options.token) return { status: 'failed', error: 'Email dispatcher is not configured' };
  if (!saved.review_id || !saved.recipient) return { status: 'failed', error: 'Saved review or partner email is missing' };
  try {
    const response = await (options.fetcher ?? fetch)(`${options.url}/functions/v1/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
      body: JSON.stringify({ template: 'partner.application_decision', to: saved.recipient,
        idempotency_key: `partner-decision:${saved.review_id}`,
        props: { company_name: saved.partner_name, decision: saved.decision as PartnerEmailDecision, notes: saved.notes, review_id: saved.review_id } }),
      signal: AbortSignal.timeout(35_000),
    });
    const result = await response.json().catch(() => ({}));
    const status = result?.data?.status;
    const logId = result?.data?.log_id ?? result?.log_id ?? null;
    if (response.ok && result?.success === true && status === 'sent') return { status: 'sent', log_id: logId };
    if (response.ok && result?.success === true && ['sending','queued'].includes(status)) return { status: 'pending', log_id: logId };
    return { status: 'failed', log_id: logId, error: String(result?.error || 'Email delivery failed').slice(0, 300) };
  } catch { return { status: 'unknown', error: 'Email delivery could not be confirmed' }; }
}
