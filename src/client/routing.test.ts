import assert from "node:assert/strict";
import test from "node:test";

import { adminRouteHref, getClientRoute } from "./routing";

test("hash admin route opens admin without requiring a server /admin path", () => {
  assert.equal(adminRouteHref, "/#/admin");
  assert.deepEqual(getClientRoute({ hash: "#/admin", pathname: "/" }), { kind: "admin" });
});

test("legacy /admin path still opens admin when server route fallback is available", () => {
  assert.deepEqual(getClientRoute({ hash: "", pathname: "/admin" }), { kind: "admin" });
});
