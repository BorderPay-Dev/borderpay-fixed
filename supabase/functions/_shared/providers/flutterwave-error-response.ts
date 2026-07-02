export interface FlutterwaveErrorPayload {
  code: string;
  error: string;
  status: number;
}

export function mapFlutterwaveErrorResponse(
  errorCode: string | undefined | null,
  fallbackMessage: string,
): FlutterwaveErrorPayload {
  const code = String(errorCode || "").trim();

  if (code === "flutterwave_ip_not_allowlisted") {
    return {
      code,
      error: "Flutterwave is not yet activated for live transfers. We are finalizing provider IP allowlisting.",
      status: 503,
    };
  }

  if (code === "flutterwave_account_inactive") {
    return {
      code,
      error: "Flutterwave account is not active yet. Local rails will be available after provider activation.",
      status: 503,
    };
  }

  if (code === "flutterwave_auth_error") {
    return {
      code,
      error: "Flutterwave credentials are not active in this environment yet.",
      status: 503,
    };
  }

  if (code === "flutterwave_rate_limited") {
    return {
      code,
      error: "Provider is rate-limited right now. Please retry shortly.",
      status: 429,
    };
  }

  if (code === "flutterwave_validation_error") {
    return {
      code,
      error: "Some payment details are invalid or incomplete. Please review and try again.",
      status: 400,
    };
  }

  if (code === "flutterwave_upstream_unavailable" || code === "flutterwave_timeout") {
    return {
      code,
      error: "Provider is temporarily unavailable. Please retry shortly.",
      status: 502,
    };
  }

  return {
    code: "upstream_error",
    error: fallbackMessage,
    status: 502,
  };
}
