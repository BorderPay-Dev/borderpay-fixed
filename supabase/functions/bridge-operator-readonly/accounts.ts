const text = (value: unknown): string => String(value ?? "").trim();

export function virtualAccountRows(row: any) {
  const details =
    row?.account_details && typeof row.account_details === "object"
      ? row.account_details
      : {};
  const rawInstructions = details?.source_deposit_instructions ??
    details?.deposit_instructions ?? details?.payment_instructions ?? details;
  const candidates: any[] = Array.isArray(rawInstructions)
    ? rawInstructions
    : rawInstructions && typeof rawInstructions === "object" &&
        !rawInstructions.currency && !rawInstructions.payment_rail &&
        ["USD", "EUR", "GBP"].some((currency) =>
          rawInstructions[currency] || rawInstructions[currency.toLowerCase()]
        )
    ? ["USD", "EUR", "GBP"].flatMap((currency) => {
      const value = rawInstructions[currency] ||
        rawInstructions[currency.toLowerCase()];
      return value && typeof value === "object"
        ? [{ currency, ...value }]
        : [];
    })
    : [rawInstructions];

  return candidates.map((instructions, index) => {
    const bank = instructions?.bank_account &&
        typeof instructions.bank_account === "object"
      ? instructions.bank_account
      : instructions;
    const address = instructions?.bank_address &&
        typeof instructions.bank_address === "object"
      ? Object.values(instructions.bank_address).filter(Boolean).join(", ")
      : instructions?.bank_address;
    return {
      id: `${text(row?.virtual_account_id)}${
        candidates.length > 1 ? `:${index}` : ""
      }`,
      currency: text(instructions?.currency || row?.currency).toUpperCase(),
      rail: text(instructions?.payment_rail || instructions?.rail || row?.rail)
        .toLowerCase(),
      status: text(row?.status || details?.status || "active").toLowerCase(),
      account_holder_name: text(
        instructions?.account_holder_name ||
          instructions?.bank_beneficiary_name ||
          instructions?.beneficiary_name || instructions?.beneficiary?.name ||
          instructions?.beneficiary?.business_name ||
          bank?.account_holder_name ||
          bank?.bank_beneficiary_name || bank?.beneficiary_name ||
          details?.account_holder_name || details?.bank_beneficiary_name ||
          details?.beneficiary_name || row?.account_holder_name ||
          row?.bank_beneficiary_name || row?.beneficiary_name,
      ),
      bank_name: text(instructions?.bank_name || bank?.bank_name),
      bank_address: text(address || bank?.bank_address),
      account_number: text(
        instructions?.bank_account_number || instructions?.account_number ||
          bank?.bank_account_number || bank?.account_number,
      ),
      sort_code: text(
        instructions?.sort_code || instructions?.bank_sort_code ||
          bank?.sort_code || bank?.bank_sort_code || details?.sort_code || details?.bank_sort_code ||
          (String(instructions?.currency || row?.currency).toUpperCase() === "GBP"
            ? instructions?.bank_routing_number || instructions?.routing_number || bank?.bank_routing_number || bank?.routing_number
            : ""),
      ),
      routing_number: text(
        instructions?.bank_routing_number || instructions?.routing_number ||
          bank?.bank_routing_number || bank?.routing_number,
      ),
      iban: text(instructions?.iban || bank?.iban),
      bic: text(
        instructions?.bic || instructions?.swift_code || bank?.bic ||
          bank?.swift_code,
      ),
      created_at: text(row?.created_at || details?.created_at),
    };
  }).filter((account) =>
    account.currency || account.rail || account.account_number || account.iban
  );
}
