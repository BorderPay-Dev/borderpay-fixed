/** Keep named EUR/USD beneficiaries distinct from GBP provider instructions. */
export function receivingAccountHolder(currency: string, fields: Record<string, any>): string | undefined {
  const values = currency.toUpperCase() === 'GBP'
    ? [fields.bank_beneficiary_name, fields.account_holder_name, fields.beneficiary_name, fields.account_holder, fields.account_name]
    : [fields.account_holder_name, fields.account_name, fields.beneficiary_name, fields.account_holder, fields.bank_beneficiary_name];
  return values.find(value => typeof value === 'string' && value.trim())?.trim();
}
export function receivingAccountInstructions(currency: string): string {
  return currency.toUpperCase() === 'GBP'
    ? 'Share these details to receive GBP by bank transfer. Use the provider account holder and reference exactly as shown so the payment reaches your BorderPay account.'
    : `Share these details to receive ${currency.toUpperCase()} by bank transfer. Use the account holder name and bank details exactly as shown.`;
}
