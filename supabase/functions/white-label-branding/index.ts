/** Retired competing writer. Branding changes go through authenticated partner settings. */
Deno.serve((req) =>
  new Response(
    req.method === "OPTIONS" ? null : JSON.stringify({
      success: false,
      code: "branding_endpoint_retired",
      error: "Manage branding in the Partner Portal.",
    }),
    {
      status: req.method === "OPTIONS" ? 204 : 410,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, apikey, content-type, x-client-info",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  )
);
