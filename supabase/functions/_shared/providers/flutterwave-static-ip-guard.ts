export interface FlutterwaveStaticIpGuard {
  required: boolean;
  ready: boolean;
  blocked: boolean;
}

function envTrue(name: string): boolean {
  return String(Deno.env.get(name) || "").trim().toLowerCase() === "true";
}

export function getFlutterwaveStaticIpGuard(): FlutterwaveStaticIpGuard {
  const required = envTrue("FLW_STATIC_IP_REQUIRED");
  const ready = envTrue("FLW_STATIC_IP_READY");
  return {
    required,
    ready,
    blocked: required && !ready,
  };
}

