// Server-only Shopify helpers. GraphQL Admin API only (REST is forbidden by project rules).

export const SHOPIFY_API_VERSION = "2025-07";

export const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_orders",
].join(",");

export const WEBHOOK_TOPICS = [
  "INVENTORY_LEVELS_UPDATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_CREATE",
  "PRODUCTS_DELETE",
  "ORDERS_CREATE",
  "ORDERS_CANCELLED",
  "APP_UNINSTALLED",
] as const;

export function normalizeDomain(input: string): string {
  const value = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return value;
}

export function isValidShopDomain(domain: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verifies the base64 `X-Shopify-Hmac-Sha256` header against the raw webhook body. */
export async function verifyWebhookHmac(rawBody: string, header: string | null): Promise<boolean> {
  const secret = process.env["SHOPIFY_API_SECRET"];
  if (!secret || !header) return false;
  return timingSafeEqual(toBase64(await hmacSha256(secret, rawBody)), header);
}

/** Verifies the hex `hmac` query param on the OAuth callback. */
export async function verifyOAuthHmac(url: URL): Promise<boolean> {
  const secret = process.env["SHOPIFY_API_SECRET"];
  if (!secret) return false;
  const provided = url.searchParams.get("hmac");
  if (!provided) return false;
  const message = [...url.searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return timingSafeEqual(toHex(await hmacSha256(secret, message)), provided);
}

export function buildAuthorizeUrl(params: {
  domain: string;
  state: string;
  redirectUri: string;
}): string {
  const apiKey = process.env["SHOPIFY_API_KEY"];
  if (!apiKey) throw new Error("SHOPIFY_API_KEY is not configured");
  const url = new URL(`https://${params.domain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", apiKey);
  url.searchParams.set("scope", SHOPIFY_SCOPES);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeAccessToken(
  domain: string,
  code: string,
): Promise<{ access_token: string; scope: string }> {
  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["SHOPIFY_API_KEY"],
      client_secret: process.env["SHOPIFY_API_SECRET"],
      code,
    }),
  });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  return (await response.json()) as { access_token: string; scope: string };
}

export type GraphQLResult<T> = { data?: T; errors?: Array<{ message: string }> };

/** GraphQL Admin API call with throttle-aware backoff. */
export async function shopifyGraphQL<T>(
  args: {
    domain: string;
    accessToken: string;
    apiVersion?: string;
    query: string;
    variables?: Record<string, unknown>;
  },
  attempt = 0,
): Promise<T> {
  const version = args.apiVersion || SHOPIFY_API_VERSION;
  const response = await fetch(`https://${args.domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": args.accessToken,
    },
    body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
  });

  if (response.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return shopifyGraphQL<T>(args, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Shopify GraphQL HTTP ${response.status} for ${args.domain}`);
  }

  const body = (await response.json()) as GraphQLResult<T> & {
    extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number } } };
  };

  const available = body.extensions?.cost?.throttleStatus?.currentlyAvailable;
  if (typeof available === "number" && available < 200) {
    await new Promise((r) => setTimeout(r, 1200));
  }

  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) throw new Error("Shopify GraphQL returned no data");
  return body.data;
}

export async function fetchShopInfo(domain: string, accessToken: string) {
  const data = await shopifyGraphQL<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string };
  }>({
    domain,
    accessToken,
    query: `query { shop { name myshopifyDomain currencyCode } }`,
  });
  return data.shop;
}

export async function registerWebhooks(
  domain: string,
  accessToken: string,
  callbackUrl: string,
): Promise<{ registered: string[]; failed: Array<{ topic: string; message: string }> }> {
  const registered: string[] = [];
  const failed: Array<{ topic: string; message: string }> = [];

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const data = await shopifyGraphQL<{
        webhookSubscriptionCreate: {
          userErrors: Array<{ message: string }>;
          webhookSubscription: { id: string } | null;
        };
      }>({
        domain,
        accessToken,
        query: `
          mutation register($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
              webhookSubscription { id }
              userErrors { message }
            }
          }`,
        variables: { topic, sub: { callbackUrl, format: "JSON" } },
      });
      const errors = data.webhookSubscriptionCreate.userErrors;
      if (errors.length && !errors[0]!.message.toLowerCase().includes("already")) {
        failed.push({ topic, message: errors[0]!.message });
      } else {
        registered.push(topic);
      }
    } catch (error) {
      failed.push({ topic, message: error instanceof Error ? error.message : "unknown" });
    }
  }

  return { registered, failed };
}

/** Resolves an inventory item to its SKU on the source store. */
export async function lookupSkuByInventoryItem(
  domain: string,
  accessToken: string,
  apiVersion: string,
  inventoryItemId: string | number,
): Promise<{ sku: string | null; productTitle: string | null }> {
  const data = await shopifyGraphQL<{
    inventoryItem: {
      sku: string | null;
      variant: { sku: string | null; product: { title: string } | null } | null;
    } | null;
  }>({
    domain,
    accessToken,
    apiVersion,
    query: `
      query item($id: ID!) {
        inventoryItem(id: $id) {
          sku
          variant { sku product { title } }
        }
      }`,
    variables: { id: `gid://shopify/InventoryItem/${inventoryItemId}` },
  });
  return {
    sku: data.inventoryItem?.sku ?? data.inventoryItem?.variant?.sku ?? null,
    productTitle: data.inventoryItem?.variant?.product?.title ?? null,
  };
}

/** Finds a variant on the destination store by SKU and reads its current available quantity. */
export async function findVariantBySku(
  domain: string,
  accessToken: string,
  apiVersion: string,
  sku: string,
): Promise<{
  variantId: string;
  inventoryItemId: string;
  locationId: string;
  available: number;
  title: string;
} | null> {
  const data = await shopifyGraphQL<{
    productVariants: {
      nodes: Array<{
        id: string;
        displayName: string;
        inventoryItem: {
          id: string;
          inventoryLevels: {
            nodes: Array<{
              location: { id: string };
              quantities: Array<{ name: string; quantity: number }>;
            }>;
          };
        };
      }>;
    };
  }>({
    domain,
    accessToken,
    apiVersion,
    query: `
      query bySku($query: String!) {
        productVariants(first: 2, query: $query) {
          nodes {
            id
            displayName
            inventoryItem {
              id
              inventoryLevels(first: 5) {
                nodes {
                  location { id }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }`,
    variables: { query: `sku:'${sku.replace(/'/g, "")}'` },
  });

  const variant = data.productVariants.nodes[0];
  const level = variant?.inventoryItem.inventoryLevels.nodes[0];
  if (!variant || !level) return null;

  return {
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
    locationId: level.location.id,
    available: level.quantities[0]?.quantity ?? 0,
    title: variant.displayName,
  };
}

/** Writes an absolute available quantity on the destination store. */
export async function setInventoryQuantity(args: {
  domain: string;
  accessToken: string;
  apiVersion: string;
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  referenceNote: string;
}): Promise<void> {
  const data = await shopifyGraphQL<{
    inventorySetQuantities: { userErrors: Array<{ message: string }> };
  }>({
    domain: args.domain,
    accessToken: args.accessToken,
    apiVersion: args.apiVersion,
    query: `
      mutation setQty($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors { message }
        }
      }`,
    variables: {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId: args.inventoryItemId,
            locationId: args.locationId,
            quantity: args.quantity,
          },
        ],
      },
    },
  });
  const errors = data.inventorySetQuantities.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

export type InventoryStateItem = {
  variantId: string;
  inventoryItemId: string;
  locationId: string;
  sku: string | null;
  available: number;
  title: string;
};

/** Paginates through all product variants and returns their current available inventory. */
export async function fetchAllInventoryState(
  domain: string,
  accessToken: string,
  apiVersion: string,
): Promise<InventoryStateItem[]> {
  const items: InventoryStateItem[] = [];
  let cursor: string | null = null;
  const pageSize = 100;

  for (let page = 0; page < 50; page++) {
    const data = await shopifyGraphQL<{
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          displayName: string;
          sku: string | null;
          inventoryItem: {
            id: string;
            inventoryLevels: {
              nodes: Array<{
                location: { id: string };
                quantities: Array<{ name: string; quantity: number }>;
              }>;
            };
          };
        }>;
      };
    }>({
      domain,
      accessToken,
      apiVersion,
      query: `
        query inventoryState($first: Int!, $after: String) {
          productVariants(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              displayName
              sku
              inventoryItem {
                id
                inventoryLevels(first: 5) {
                  nodes {
                    location { id }
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }`,
      variables: { first: pageSize, after: cursor },
    });

    for (const variant of data.productVariants.nodes) {
      const level = variant.inventoryItem.inventoryLevels.nodes[0];
      if (!level) continue;
      items.push({
        variantId: variant.id,
        inventoryItemId: variant.inventoryItem.id,
        locationId: level.location.id,
        sku: variant.sku,
        available: level.quantities[0]?.quantity ?? 0,
        title: variant.displayName,
      });
    }

    if (!data.productVariants.pageInfo.hasNextPage) break;
    cursor = data.productVariants.pageInfo.endCursor;
    if (!cursor) break;
  }

  return items;
}
