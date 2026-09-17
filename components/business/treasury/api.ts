import { authAPI, BASE_URL, ANON_KEY, supabase } from '../../../utils/supabase/client';
import { treasuryRequest } from './request';
async function request<T>(body: Record<string, unknown>) {
  return treasuryRequest<T>({
    url: `${BASE_URL}/bridge-operator-readonly`, key: ANON_KEY, body,
    token: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token || authAPI.getToken();
    },
  });
}
export const treasuryAPI = {
  getSnapshot: <T>() => request<T>({ action: 'snapshot' }),
  send: (input: Record<string, string>) => {
    const { pin, ...transfer } = input;
    return request<{ transfer_id: string; state: string }>({ action: 'transfer', request: transfer, pin });
  },
};
