import assert from "node:assert/strict";
import { allowedRoute } from "../infrastructure/yellowcard-relay/server.mjs";

assert.equal(allowedRoute("GET", "/channels", { country: "KE" }), true);
assert.equal(allowedRoute("POST", "/receive", {}), true);
assert.equal(allowedRoute("POST", "/send", {}), true);
assert.equal(allowedRoute("GET", "/send/sequence-id/89cd5f28-3784-53c1-bb38-87ffa646ad1c", {}), true);
assert.equal(allowedRoute("GET", "/webhooks", {}), true);
assert.equal(allowedRoute("POST", "/webhooks", {}), true);
assert.equal(allowedRoute("PUT", "/webhooks", {}), true);
assert.equal(allowedRoute("DELETE", "/webhooks/89cd5f28-3784-53c1-bb38-87ffa646ad1c", {}), true);

assert.equal(allowedRoute("POST", "/transfers", {}), false);
assert.equal(allowedRoute("POST", "/send", { bypass: true }), false);
assert.equal(allowedRoute("GET", "/webhooks", { page: 2 }), false);

console.log("Yellow Card relay production route gate passed.");
