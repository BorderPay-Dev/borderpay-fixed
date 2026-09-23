begin;
alter table public.predeposit_agreement_templates add column if not exists agreement_type text not null default 'b2b';
alter table public.predeposit_agreement_templates add constraint predeposit_agreement_type_check check (agreement_type in ('b2b','d2c','b2c'));
insert into public.predeposit_agreement_templates(version,title,body,status,agreement_type)
values ('borderpay-d2c-draft-1','Standard D2C Direct-to-Consumer Agreement',$terms$D2C DIRECT-TO-CONSUMER AGREEMENT

Seller: {{seller}}
Buyer: {{buyer}}
Commercial reference: {{invoice}}
Contract value: {{amount}} {{currency}}

DRAFT FOR REVIEW - NOT EXECUTED
These standard terms require adaptation to the product, sales channel and applicable consumer law before use. They do not record the consumer's acceptance.

1. Parties and scope
The Seller supplies its own branded goods or services directly to the consumer through its direct sales channel. The Seller remains the contracting trader and the contact for delivery, returns and after-sales support.
The Buyer purchases for personal, household or other non-business use. A purchase for resale or business purposes requires the appropriate business agreement. The attached invoice identifies the goods or services, quantities, descriptions and price.

2. Order and acceptance
Before accepting an order, the Seller must provide its legal name, trading and contact address, contact details, product characteristics, total price, delivery information and applicable cancellation terms. The consumer must receive these terms in a durable form and affirmatively accept the order. A merchant signature, invoice, pre-ticked box or document download alone does not prove consumer acceptance. Retain the order confirmation and evidence of acceptance.

3. Price, taxes and payment
The invoice must state the full amount payable and currency, including applicable taxes and delivery charges. Any additional charge requires clear disclosure and the consumer’s express agreement before payment. Additional charges and their treatment: {{additional_charges}}
Payment instructions, where included, are subject to the receiving account's eligibility. The payer must be the named buyer unless an alternative is permitted and documented. This agreement does not enable consumer payments on a business-only receiving route. GBP receiving remains corporate-to-corporate and cannot be used with this consumer agreement.

4. Delivery and performance
Agreed delivery or performance arrangements: {{delivery}}
The Seller must disclose delivery times, delivery costs and any relevant service or digital-content requirements before acceptance. Provide confirmation and available tracking or performance records. Transfer of risk, delivery remedies and service performance are subject to mandatory consumer law; these terms do not shift statutory risk to the consumer.

5. Cancellation, withdrawal and returns
Transaction-specific arrangements: {{cancellations_returns}}
These arrangements apply only to the extent consistent with mandatory law. The Seller must disclose applicable cooling-off or withdrawal periods, how to cancel, return procedures, who bears permitted return costs and the required cancellation form or contact channel. Any lawful exception must be disclosed before the consumer commits. Do not assume that all personalized goods, services or digital products are exempt. Where early performance or digital delivery requires express consent and acknowledgment about withdrawal rights, obtain and retain that consent separately.

6. Refunds, defects and guarantees
Refunds must be handled within the periods and by the means required by applicable law. The Seller remains responsible for statutory remedies for defective or non-conforming goods or services. Commercial warranties supplement and do not replace statutory rights. Refund processing must be linked to the original order and payment and must comply with applicable payment-service procedures.

7. Customer support and complaints
Consumer support and complaints contact: {{support_contact}}
The Seller must provide an accessible complaint channel and any dispute-resolution information required in the consumer’s market. A manufacturer’s support channel does not replace the consumer’s rights against the Seller. Nothing in these terms imposes mandatory arbitration, restricts access to competent courts or removes a non-waivable consumer remedy.

8. Personal information and records
Use buyer details only for lawful order fulfilment, support, payment and required recordkeeping, in accordance with the Seller’s disclosed privacy notice. Collect only information needed for the transaction or legally required checks. Do not require a consumer to supply business registration or tax identifiers solely because this template was selected. Keep order, acceptance, delivery and refund records securely for the applicable retention period.

9. Payment-service role
BorderPay provides payment services and document tooling and is not the seller of the goods or services. Bank and payment-provider eligibility, review requirements and applicable laws continue to apply. This draft does not certify document authenticity or guarantee payment acceptance, settlement or release from a compliance review.

10. Mandatory rights and changes
Mandatory consumer protections applicable to the transaction prevail over conflicting terms. No governing-law or jurisdiction choice in a separate document may remove protections that cannot lawfully be waived. Changes to price, scope or terms after acceptance require a lawful basis and the consumer’s agreement where required. The Seller must obtain appropriate legal review for the markets and products served before adopting these standard terms.
$terms$,'draft','d2c')
on conflict (version) do nothing;
insert into public.predeposit_agreement_templates(version,title,body,status,agreement_type)
values ('borderpay-b2c-draft-1','Standard B2C Consumer Sales Agreement',$terms$B2C CONSUMER SALES AGREEMENT

Seller: {{seller}}
Buyer: {{buyer}}
Commercial reference: {{invoice}}
Contract value: {{amount}} {{currency}}

DRAFT FOR REVIEW - NOT EXECUTED
These standard terms require adaptation to the product, sales channel and applicable consumer law before use. They do not record the consumer's acceptance.

1. Parties and scope
The Seller acts as the contracting retailer or service supplier selling to the consumer for personal use. Any manufacturer, marketplace or delivery partner is identified where relevant; their involvement does not remove the Seller’s obligations to the consumer.
The Buyer purchases for personal, household or other non-business use. A purchase for resale or business purposes requires the appropriate business agreement. The attached invoice identifies the goods or services, quantities, descriptions and price.

2. Order and acceptance
Before accepting an order, the Seller must provide its legal name, trading and contact address, contact details, product characteristics, total price, delivery information and applicable cancellation terms. The consumer must receive these terms in a durable form and affirmatively accept the order. A merchant signature, invoice, pre-ticked box or document download alone does not prove consumer acceptance. Retain the order confirmation and evidence of acceptance.

3. Price, taxes and payment
The invoice must state the full amount payable and currency, including applicable taxes and delivery charges. Any additional charge requires clear disclosure and the consumer’s express agreement before payment. Additional charges and their treatment: {{additional_charges}}
Payment instructions, where included, are subject to the receiving account's eligibility. The payer must be the named buyer unless an alternative is permitted and documented. This agreement does not enable consumer payments on a business-only receiving route. GBP receiving remains corporate-to-corporate and cannot be used with this consumer agreement.

4. Delivery and performance
Agreed delivery or performance arrangements: {{delivery}}
The Seller must disclose delivery times, delivery costs and any relevant service or digital-content requirements before acceptance. Provide confirmation and available tracking or performance records. Transfer of risk, delivery remedies and service performance are subject to mandatory consumer law; these terms do not shift statutory risk to the consumer.

5. Cancellation, withdrawal and returns
Transaction-specific arrangements: {{cancellations_returns}}
These arrangements apply only to the extent consistent with mandatory law. The Seller must disclose applicable cooling-off or withdrawal periods, how to cancel, return procedures, who bears permitted return costs and the required cancellation form or contact channel. Any lawful exception must be disclosed before the consumer commits. Do not assume that all personalized goods, services or digital products are exempt. Where early performance or digital delivery requires express consent and acknowledgment about withdrawal rights, obtain and retain that consent separately.

6. Refunds, defects and guarantees
Refunds must be handled within the periods and by the means required by applicable law. The Seller remains responsible for statutory remedies for defective or non-conforming goods or services. Commercial warranties supplement and do not replace statutory rights. Refund processing must be linked to the original order and payment and must comply with applicable payment-service procedures.

7. Customer support and complaints
Consumer support and complaints contact: {{support_contact}}
The Seller must provide an accessible complaint channel and any dispute-resolution information required in the consumer’s market. A manufacturer’s support channel does not replace the consumer’s rights against the Seller. Nothing in these terms imposes mandatory arbitration, restricts access to competent courts or removes a non-waivable consumer remedy.

8. Personal information and records
Use buyer details only for lawful order fulfilment, support, payment and required recordkeeping, in accordance with the Seller’s disclosed privacy notice. Collect only information needed for the transaction or legally required checks. Do not require a consumer to supply business registration or tax identifiers solely because this template was selected. Keep order, acceptance, delivery and refund records securely for the applicable retention period.

9. Payment-service role
BorderPay provides payment services and document tooling and is not the seller of the goods or services. Bank and payment-provider eligibility, review requirements and applicable laws continue to apply. This draft does not certify document authenticity or guarantee payment acceptance, settlement or release from a compliance review.

10. Mandatory rights and changes
Mandatory consumer protections applicable to the transaction prevail over conflicting terms. No governing-law or jurisdiction choice in a separate document may remove protections that cannot lawfully be waived. Changes to price, scope or terms after acceptance require a lawful basis and the consumer’s agreement where required. The Seller must obtain appropriate legal review for the markets and products served before adopting these standard terms.
$terms$,'draft','b2c')
on conflict (version) do nothing;
commit;
