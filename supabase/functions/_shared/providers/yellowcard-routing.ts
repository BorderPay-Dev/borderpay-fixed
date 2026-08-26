import { normalizeYellowCardCountryCode } from "./yellowcard-commercial-policy.ts";

export type YellowCardDirection = "receive" | "payout";
export type YellowCardRail = "bank" | "mobile_money";

const text = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => text(value).toLowerCase();
const upper = (value: unknown) => text(value).toUpperCase();

function providerCode(value: any): string {
  if (value && typeof value === "object") {
    return text(value.code || value.countryCode || value.iso2 || value.alpha2 || value.name);
  }
  return text(value);
}

function providerActive(row: any): boolean {
  if (row?.active === true || row?.isActive === true || row?.is_active === true) return true;
  return yellowCardActive(row?.apiStatus || row?.api_status || row?.status);
}

export function yellowCardRows(value: any, key: string): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.[key])) return value.data[key];
  if (Array.isArray(value?.data?.items)) return value.data.items;
  if (Array.isArray(value?.data?.data)) return value.data.data;
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

function linkedChannelIds(network: any): string[] {
  const linked = Array.isArray(network?.channelIds)
    ? network.channelIds
    : Array.isArray(network?.channel_ids)
      ? network.channel_ids
      : network?.channelId
        ? [network.channelId]
        : network?.channel_id
          ? [network.channel_id]
          : Array.isArray(network?.channels)
            ? network.channels.map((channel: any) => channel?.id || channel)
            : [];
  return linked.map(text).filter(Boolean);
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
    (normalizeYellowCardCountryCode(providerCode(channel?.country || channel?.countryCode || channel?.country_code)) ||
      upper(providerCode(channel?.country || channel?.countryCode || channel?.country_code))) === country &&
    upper(providerCode(channel?.currency || channel?.countryCurrency || channel?.localCurrency || channel?.currencyCode)) === currency &&
    yellowCardRail(channel?.channelType || channel?.channel_type || channel?.type) === input.rail &&
    yellowCardDirection(channel?.rampType || channel?.ramp_type || channel?.direction) === input.direction &&
    providerActive(channel)
  );
  const amountChannels = channels.filter((channel) => supportsAmount(channel, input.amount));
  const eligibleChannelIds = new Set(amountChannels.map((channel) => text(channel?.id)).filter(Boolean));
  const networks = networkRows.filter((network) => {
    const networkCountry = providerCode(network?.country || network?.countryCode || network?.country_code);
    if ((normalizeYellowCardCountryCode(networkCountry) || upper(networkCountry)) !== country ||
      !providerActive(network) ||
      yellowCardAccountType(network?.accountNumberType || network?.account_number_type || network?.account_type || network?.type) !== input.rail) return false;
    const linked = linkedChannelIds(network);
    // Yellow Card Receive is intentionally submitted with channelType so the
    // provider can choose a healthy channel. Some production Network records
    // therefore omit channel linkage. Payout still requires an exact linked
    // channel because its request carries channelId.
    return input.direction === "receive" && linked.length === 0
      ? true
      : linked.some((channelId) => eligibleChannelIds.has(channelId));
  });
  const requestedNetworkId = text(input.networkId);
  const selectedNetwork = requestedNetworkId
    ? networks.find((network) => text(network?.id) === requestedNetworkId) || null
    : networks.length === 1 ? networks[0] : null;
  const linkedIds = new Set(linkedChannelIds(selectedNetwork));
  const selectedChannel = requestedNetworkId
    ? selectedNetwork
      ? input.direction === "receive" && linkedIds.size === 0
        ? amountChannels[0] || null
        : amountChannels.find((channel) => linkedIds.has(text(channel?.id))) || null
      : null
    : selectedNetwork
      ? input.direction === "receive" && linkedIds.size === 0
        ? amountChannels[0] || null
        : amountChannels.find((channel) => linkedIds.has(text(channel?.id))) || null
      : amountChannels[0] || null;

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
