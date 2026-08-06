# Yellow Card sandbox technical review evidence — 2026-08-06

Environment: Yellow Card sandbox. Tester: `adhiamboadhiambo22@gmail.com`.

## End-to-end transaction evidence

| Flow | Expected result | Yellow Card transaction ID | Sequence ID | Final provider status |
| --- | --- | --- | --- | --- |
| Receive / mobile money | success | `796484ae-e379-55ad-8b35-3fd7eb81bf7e` | `4428a39f-28d9-495f-8b75-cd7ec8ffea70` | `settlement_complete` |
| Send / mobile money | success | `bd5bb5c9-07bf-51bf-bcc0-4a3066090e94` | `2603f2c2-217e-46ff-b82a-4387924ff5ae` | `complete` |
| Receive / bank | success | `38cc470f-d78f-57b9-af72-1deb5309b4ce` | `d21ed0ea-ee97-4c3c-a7ce-3f74149fb46b` | `settlement_complete` |
| Send / bank | success | `5d5b862a-25d5-52ec-a45c-2ebd60fd37ac` | `5556c28d-5d5d-4b9f-90e6-9d6c500ae9e3` | `complete` |
| Receive / mobile money | failure | `43768365-3ae1-550d-85e8-910c2c186b43` | `6ea8adde-6c9d-45c5-a815-d7aedc41282e` | `failed` |
| Send / mobile money | failure | `38b61999-a842-5926-8938-aff43126b441` | `a2b010b6-4b00-4ff2-8706-ae28f59224d3` | `failed` |
| Receive / bank | failure | `ac41a229-8984-5637-96ef-7a34cd26339e` | `f4023662-5917-4d23-b30b-6d322e418dae` | `pending_refund` |
| Send / bank | failure | `35af19b1-fc5c-5656-9b19-fccff6b28181` | `e8695bcf-3140-4656-b3f0-70f2c82c65aa` | `failed` |

The Receive / bank failure simulation is tracked separately because Yellow Card left the original request in `processing` when both independent failure controls were supplied at once:

- original provider transaction: `b9d812ea-7493-55b4-8bdb-8b06ffdb780d`
- original sequence: `414d49eb-5c34-4972-9b31-25a419291145`
- replacement provider transaction: `ac41a229-8984-5637-96ef-7a34cd26339e`
- replacement sequence: `f4023662-5917-4d23-b30b-6d322e418dae`

The replacement keeps the bank collection leg successful and uses Yellow Card's documented failure crypto address for the direct-settlement failure. Yellow Card accepted that failure and moved the transaction to `pending_refund`; its refund lifecycle documentation defines this as the provider processing the refund. Capture the later `refunded` or `refund_failed` transition if Yellow Card requests the terminal refund state.

## Sandbox controls used

Source: [Yellow Card Sandbox Testing](https://docs.yellowcard.engineering/docs/sandbox-testing-api.md), updated 2026-04-09.

- bank success account: `1111111111`
- bank failure account: `0000000000`
- mobile-money success account: `+{countryCode}1111111111`
- mobile-money failure account: `+{countryCode}0000000000`
- ERC20 success settlement address: `0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe`
- ERC20 failure settlement address: `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`
- crypto Receive into a Send transaction: `Successful` or `Failure` in sender name

## Pricing authority

Customer pricing is sourced exclusively from the signed **Yellow Card Treasury Portal Order Form — Standard Pricing, Addendum 1**, dated 2026-07-08. Yellow Card confirmed that commercial pricing is authoritative because sandbox pricing may not be updated. The sandbox response currently demonstrates that expected difference:

| Kenya flow | Amount | Signed provider fee | Sandbox-reported provider fee |
| --- | ---: | ---: | ---: |
| Receive / mobile money | KES 5,000 | KES 38.50 (0.77%) | KES 100 (2%) |
| Receive / bank | KES 300,000 | KES 1,500 (1%, capped) | KES 6,000 (2%) |
| Send / mobile money | KES 1,000 | KES 126 flat | KES 20.50 (2.05%) |
| Send / bank | KES 1,000 | KES 29 (2.9%) | KES 10.25 (1.025%) |

BorderPay displays the commercial-document provider fee plus a server-controlled 1% BorderPay rail markup for both individual and business accounts. Provider-reported sandbox fees are diagnostic reconciliation data only and never replace customer pricing.
