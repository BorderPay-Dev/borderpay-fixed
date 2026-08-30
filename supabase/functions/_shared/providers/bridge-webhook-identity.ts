export type BridgeIdentityField =
  | "name"
  | "country"
  | "phone"
  | "address"
  | "dob"
  | "email"
  | "idNumber"
  | "idType";

export interface BridgeWebhookIdentityEvidence {
  values: Partial<Record<BridgeIdentityField, string>>;
  sources: Partial<Record<BridgeIdentityField, string>>;
  eventIds: string[];
}

const valueAt = (input: unknown, path: string[]): string => {
  let current: unknown = input;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return String(current ?? "").trim();
};

const first = (input: unknown, paths: string[][]): { value: string; path: string } => {
  for (const path of paths) {
    const value = valueAt(input, path);
    if (value) return { value, path: path.join(".") };
  }
  return { value: "", path: "" };
};

export function extractBridgeWebhookIdentity(
  events: Array<{ event_id?: unknown; event_type?: unknown; payload?: unknown }>,
): BridgeWebhookIdentityEvidence {
  const values: Partial<Record<BridgeIdentityField, string>> = {};
  const sources: Partial<Record<BridgeIdentityField, string>> = {};
  const eventIds: string[] = [];
  const paths: Record<BridgeIdentityField, string[][]> = {
    name: [["full_name"], ["name"]],
    country: [["country"], ["country_code"], ["residential_address", "country"]],
    phone: [["phone"], ["phone_number"]],
    address: [["address"]],
    dob: [["date_of_birth"], ["birth_date"], ["dob"]],
    email: [["email"]],
    idNumber: [["id_number"], ["identification_number"], ["identity_document", "number"]],
    idType: [["id_type"], ["document_type"], ["identity_document", "type"]],
  };

  for (const event of events) {
    const eventObject = (event.payload as any)?.event_object;
    if (!eventObject || typeof eventObject !== "object") continue;
    const eventId = String(event.event_id || "").trim();
    if (eventId && !eventIds.includes(eventId)) eventIds.push(eventId);
    const eventType = String(event.event_type || "bridge_event").trim();
    const firstName = valueAt(eventObject, ["first_name"]);
    const lastName = valueAt(eventObject, ["last_name"]);
    if (!values.name && (firstName || lastName)) {
      values.name = [firstName, lastName].filter(Boolean).join(" ");
      sources.name = `${eventType}:event_object.first_name,last_name`;
    }
    const residential = (eventObject as any).residential_address;
    if (!values.address && residential && typeof residential === "object") {
      const address = ["street_line_1", "street_line_2", "city", "state", "postal_code"]
        .map((key) => valueAt(residential, [key]))
        .filter(Boolean)
        .join(", ");
      if (address) {
        values.address = address;
        sources.address = `${eventType}:event_object.residential_address`;
      }
    }
    for (const field of Object.keys(paths) as BridgeIdentityField[]) {
      if (values[field]) continue;
      const found = first(eventObject, paths[field]);
      if (!found.value) continue;
      values[field] = found.value;
      sources[field] = `${eventType}:event_object.${found.path}`;
    }
  }
  return { values, sources, eventIds };
}
