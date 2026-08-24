export type ScaRequirementState = 'checking' | 'required' | 'not_required';

export function useScaRequirement(_enabled = true): ScaRequirementState {
  // Emergency rollback: customer SCA is disabled for every region. Bridge
  // custodial EEA flows must remain out of scope until an approved SCA
  // implementation is restored.
  return 'not_required';
}
