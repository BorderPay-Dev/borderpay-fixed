-- Proposed terms only. An authorized operator must review and approve a version before use.
insert into public.predeposit_agreement_templates(version,title,body,status)
values('borderpay-b2b-draft-1','Standard B2B Commercial Agreement',$terms$B2B COMMERCIAL AGREEMENT

Seller: {{seller}}
Buyer: {{buyer}}
Commercial reference: {{invoice}}
Contract value: {{amount}} {{currency}}

1. Commercial purpose
The Seller agrees to supply the goods or services itemized in the attached invoice. The item descriptions, quantities, deliverable references, service periods and currency in that invoice form part of this agreement. The parties confirm that the invoice relates to an actual commercial transaction and not to a transfer of funds without underlying goods or services.

2. Delivery and acceptance
The Seller will deliver the stated goods or services according to the delivery dates, specifications and acceptance criteria agreed in writing with the Buyer. Where these are not stated in the invoice, the parties must document them separately before performance. Evidence of delivery, fulfillment or service acceptance must be retained.

3. Payment
The Buyer must pay the amount stated on the invoice from a bank account held in the Buyer's exact legal name, using the approved receiving instructions and required payment reference. A different remitter requires prior review and supporting documentation. GBP payments under this agreement must be corporate-to-corporate. The invoice and payment instructions do not authorize a payment from an undisclosed third party.

4. Business records and supporting evidence
Each party confirms that the business identity, tax information and commercial descriptions it provides are accurate to the best of its knowledge. The Seller will retain the purchase order, relevant order records, executed agreement and, for physical goods, applicable inventory, dispatch and shipping evidence. Source-of-funds and commercial rationale information may be requested where required.

5. Taxes, charges and changes
The parties must identify applicable taxes, delivery charges, payment deadlines and any other agreed charges in the invoice or a written schedule. Changes to scope, price, buyer or currency must be agreed in writing and reflected in a revised invoice. Neither party may use this agreement to justify an unrelated payment.

6. Cancellations, returns and disputes
The parties' written cancellation, return, warranty and dispute terms apply to the commercial supply. If no such terms have been agreed, the parties must agree them before the transaction proceeds. Any refund must follow the payment service's applicable procedures and be linked to the original transaction.

7. Payment-service role
BorderPay provides payment services and document tooling. It is not the seller of the underlying goods or services and does not guarantee delivery or acceptance. Payment instructions remain subject to account eligibility, applicable laws, review requirements and the terms of the receiving financial institution. Document approval is not a guarantee that a payment will settle without further review.

8. Execution
The Seller's authorized representative confirms authority to enter this agreement and to apply the recorded signature to this invoice revision. The Buyer must receive this agreement and accept the commercial terms before paying. The merchant must retain evidence of the Buyer's acceptance; attaching a custom contract may be appropriate where both parties' execution is required.

This template must be adapted to the actual transaction and applicable law. Any separately executed agreement takes precedence where expressly stated and consistent with the approved invoice.
$terms$,'draft')
on conflict(version) do nothing;
