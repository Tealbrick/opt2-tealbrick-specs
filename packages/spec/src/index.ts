// @opt2-tealbrick/spec — the frozen opt2 interface contract (data and types only, no runtime logic).
// Subpath imports are preferred: "@opt2-tealbrick/spec/manifest", "/credentials", "/bridge", "/routes", "/sdk", "/admin", "/host", "/models".

export * as admin from "./admin.ts";
export * as bridge from "./bridge.ts";
export * as credentials from "./credentials.ts";
export * as host from "./host.ts";
export * as manifest from "./manifest.ts";
export * as models from "./models.ts";
export * as routes from "./routes.ts";
export * as sdk from "./sdk.ts";
export const SPEC_VERSION = "0.1.69" as const;
