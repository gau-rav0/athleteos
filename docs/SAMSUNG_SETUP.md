# Samsung Health Data SDK blocker

The official SDK AAR is absent. No Samsung API or Galaxy S21 FE / Watch6 behavior has been physically tested. This is a compilation-safe source adapter and injectable bridge boundary, not a working Samsung integration. The app reports SDK_MISSING or SDK_BRIDGE_REQUIRED; it never reports a successful Samsung read.

1. Obtain the current **Samsung Health Data SDK** only from [Samsung's official developer portal](https://developer.samsung.com/health/data/overview.html), accepting its license yourself.
2. Place its binary at `android/app/libs/samsung-health-data-api.aar`. `git check-ignore` must confirm it is excluded.
3. Implement `SamsungSdkBridge` against that version's `com.samsung.android.sdk.health.data` API and wire it into `AppGraph`. Build and verify the bridge against the actual AAR. Adding the AAR alone does not enable reads.
4. Use `HealthDataService.getStore(context)`, read-only `Permission` sets per supported `DataType`, and the SDK's availability and permission APIs. Follow the [current permission guide](https://developer.samsung.com/health/data/guide/hello-sdk/permission-request.html). Never use `com.samsung.android.sdk.healthdata` from the deprecated SDK.
5. Preserve data-point UIDs, original offsets, source/device fields, modified timestamps and a versioned raw payload in `HealthRecord`. Use provider `samsung_health` and the same type names as the importer. Missing device IDs stay null. Do not rename proprietary Energy Score as RMSSD.
6. Adapt the SDK's actual change/deletion facilities. If a type lacks durable change tokens, use a safe read watermark plus complete-window and known-ID reconciliation; do not fake a Changes API. Commit changes and the new watermark through `SyncStore.apply`.
7. Configure Samsung Health developer mode/partner access as required by the exact SDK version and package/signing certificate. Check Samsung Health version and type availability on the phone. Production partner authorization is separate from developer mode.
8. Physically test every available target type and denial/revocation, updates, deletions and overlap with a private historical export. Run the seven-day gate in DEVICE_VALIDATION.md before considering Phase 1 complete.

Targets: Activity Summary, Energy Score, Exercise, Heart Rate, Sleep, Steps, Skin Temperature, Blood Oxygen, Body Composition, Floors Climbed, User Profile. Unsupported types must remain unsupported; absent observations must remain missing.
