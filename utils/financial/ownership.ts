export interface FinancialOwner {
  userId: string;
  ownershipOrFilter: string;
}

export function resolveFinancialOwner(userId: string): FinancialOwner {
  const id = String(userId || '').trim();
  return {
    userId: id,
    ownershipOrFilter: `user_id.eq.${id},business_user_id.eq.${id}`,
  };
}

export function ownerOrFilter(userId: string): string {
  return resolveFinancialOwner(userId).ownershipOrFilter;
}
