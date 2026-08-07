import { normalizeYellowCardCountryCode } from "./yellowcard-commercial-policy.ts";

export type YellowCardDirection = "receive" | "payout";
export type YellowCardRail = "bank" | "mobile_money";

const text = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => text(value).toLowerCase();
const upper = (value: unknown) => text(value).toUpperCase();

export function yellowCardRows(value: any, key: string): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.[key])) return value.data[key];
  return [];
}

export function yellowCardActive(value: unknown): boolean {
  return ["active", "enabled", "available"].includes(lower(value));
}

export function yellowCardRail(value: unknown): YellowCardRail | null {
  const normalized = lower(value).replaceAll("-", "_");
  if (["momo", "mobile", "mobile_money", "mobilemoney"].includes(normalized)) return "mobile_money";
  if (["bank", "eft", "p2p"].includes(normalized)) return "bank";
  return null;
}

export function yellowCardDirection(value: unknown): YellowCardDirection | null {
  const normalized = lower(value).replaceAll("-", "").replaceAll("_", "");
  if (["withdraw", "withdrawal", "send", "payment", "payout", "offramp"].includes(normalized)) return "payout";
  if (["deposit", "receive", "collection", "payin", "onramp"].includes(normalized)) return "receive";
  return null;
}

export function yellowCardAccountType(value: unknown): YellowCardRail | null {
  const normalized = lower(value).replaceAll("-", "_");
  if (["phone", "momo", "mobile", "mobile_money", "mobilemoney", "msisdn"].includes(normalized)) return "mobile_money";
  if (["account", "account_number", "bank", "bank_account", "eft", "p2p"].includes(normalized)) return "bank";
  return null;
}

export function yellowCardProviderChannelType(rail: YellowCardRail): "bank" | "momo" {
  return rail === "mobile_money" ? "momo" : "bank";
}

function supportsAmount(channel: any, amount?: number | null): boolean {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return true;
  const value = Number(amount);
  const minimum = Number(channel?.min);
  const maximum = Number(channel?.max);
  return !(Number.isFinite(minimum) && value < minimum) &&
    !(Number.isFinite(maximum) && maximum > 0 && value > maximum);
}

export function resolveYellowCardRouting(input: {
  channels: any;
  networks: any;
  direction: YellowCardDirection;
  country: string;
  currency: string;
  rail: YellowCardRail;
  networkId?: string | null;
  amount?: number | null;
}) {
  const country = upper(input.country);
  const currency = upper(input.currency);
  const channelRows = yellowCardRows(input.channels, "channels");
  const networkRows = yellowCardRows(input.networks, "networks");
  const channels = channelRows.filter((channel) =>
    (normalizeYellowCardCountryCode(channel?.country) || upper(channel?.country)) === country &&
    upper(channel?.currency || channel?.countryCurrency) === currency &&
    yellowCardRail(channel?.channelType) === input.rail &&
    yellowCardDirection(channel?.rampType) === input.direction &&
    yellowCardActive(channel?.apiStatus || channel?.status)
  );
  const amountChannels = channels.filter((channel) => supportsAmount(channel, input.amount));
  const networks = networkRows.filter((network) =>
    (normalizeYellowCardCountryCode(network?.country) || upper(network?.country)) === country &&
    yellowCardActive(network?.status || network?.apiStatus) &&
    yellowCardAccountType(network?.accountNumberType || network?.account_type) === input.rail
  );
  const requestedNetworkId = text(input.networkId);
  const selectedNetwork = requestedNetworkId
    ? networks.find((network) => text(network?.id) === requestedNetworkId) || null
    : networks.length === 1 ? networks[0] : null;
  const linkedIds = new Set(
    Array.isArray(selectedNetwork?.channelIds) ? selectedNetwork.channelIds.map(text) : [],
  );
  const selectedChannel = amountChannels.find((channel) => linkedIds.has(text(channel?.id))) ||
    amountChannels[0] || null;

  return {
    channels,
    amountChannels,
    networks,
    selectedChannel,
    selectedNetwork,
    channelAvailable: channels.length > 0,
    amountAvailable: amountChannels.length > 0,
    networkAvailable: networks.length > 0,
  };
}

export function mergeYellowCardRows(values: any[], key: string): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];
  values.flatMap((value) => yellowCardRows(value, key)).forEach((row, index) => {
    const identity = text(row?.id || row?.code || `${upper(row?.country)}:${text(row?.name)}:${index}`);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    merged.push(row);
  });
  return merged;
}
