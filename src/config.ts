import type { GemicoreHttpClient } from "./http.ts";

/** `GET /v1/config`: every config value the app has, by key. Values keep the JSON type an admin saved. */
export type AppConfig = Record<string, unknown>;

/** `GET /v1/flags`: the app's flags that are on. A flag that is off or unknown is absent, so read it as false. */
export type FeatureFlags = Record<string, boolean>;

/** Per-app config values set in the admin. Secret key only, since config may hold values kept from browsers. */
export class ConfigClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Every config value of the app, keyed by name. Secret key only. */
  get(): Promise<AppConfig> {
    return this.http.request("/v1/config", { method: "GET" });
  }
}

/** Per-app feature flags set in the admin. Works with a publishable or a secret key. */
export class FlagsClient {
  constructor(private readonly http: GemicoreHttpClient) {}

  /** Enabled, gradual rollout and A/B test all count as on; Gemicore does not split users by percentage. */
  list(): Promise<FeatureFlags> {
    return this.http.request("/v1/flags", { method: "GET" });
  }
}
