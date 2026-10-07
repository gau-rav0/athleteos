export const TYPES = new Set([
  "steps",
  "sleep",
  "heart_rate",
  "exercise",
  "weight",
  "body_fat",
  "active_calories",
  "total_calories",
  "distance",
  "speed",
  "floors",
  "hrv_rmssd",
  "activity_summary",
  "energy_score",
  "skin_temperature",
  "blood_oxygen",
  "body_composition",
  "user_profile",
  "sleep_stage",
  "steps_daily",
  "pedometer_day_summary",
  "floors_daily",
  "hrv_envelope",
  "respiratory_rate",
  "movement",
  "stress",
  "nap",
  "food_intake",
  "nutrition",
  "water",
  "ecg",
  "mood",
  "heart_health_score",
  "training_load_goal",
  "device_metadata",
  "source_metadata",
  "vendor_raw",
]);
export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 512): boolean {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= max;
}
function timestamp(value: unknown): boolean {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function offset(value: unknown): boolean {
  if (value === "Z") return true;
  if (typeof value !== "string" || !/^[+-]\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return false;
  }
  const [hours, minutes, seconds = "0"] = value.slice(1).split(":");
  return Number(hours) <= 18 && Number(minutes) <= 59 &&
    Number(seconds) <= 59 &&
    (Number(hours) < 18 || (Number(minutes) === 0 && Number(seconds) === 0));
}
const RECORD_KEYS = new Set([
  "provider",
  "record_type",
  "source_uid",
  "source_package",
  "source_device_id",
  "device_provenance",
  "start_time",
  "end_time",
  "source_zone_offset",
  "end_zone_offset",
  "source_created_at",
  "source_updated_at",
  "schema_version",
  "payload",
  "deleted",
  "ingestion_origin",
  "source_priority",
  "client_revision",
  "observed_at",
]);
export function validRecord(record: unknown): record is ObjectValue {
  if (
    !object(record) || Object.keys(record).some((key) => !RECORD_KEYS.has(key))
  ) return false;
  if (
    !["health_connect", "samsung_health"].includes(String(record.provider)) ||
    !TYPES.has(String(record.record_type)) || !text(record.source_uid)
  ) return false;
  if (
    record.record_type === "hrv_rmssd" && record.provider !== "health_connect"
  ) return false;
  if (
    record.schema_version !== 1 || !object(record.payload) ||
    !object(record.device_provenance)
  ) return false;
  if (
    typeof record.deleted !== "boolean" ||
    !["live", "historical"].includes(String(record.ingestion_origin))
  ) return false;
  if (
    !Number.isSafeInteger(record.client_revision) ||
    Number(record.client_revision) < 1 || !timestamp(record.observed_at)
  ) return false;
  if (
    !Number.isSafeInteger(record.source_priority) ||
    Number(record.source_priority) < 0 || Number(record.source_priority) > 300
  ) return false;
  for (
    const key of [
      "start_time",
      "end_time",
      "source_created_at",
      "source_updated_at",
    ]
  ) {
    if (record[key] != null && !timestamp(record[key])) return false;
  }
  const undatedHistorical = record.provider === "samsung_health" &&
    record.ingestion_origin === "historical" &&
    new Set([
      "vendor_raw",
      "training_load_goal",
      "device_metadata",
      "source_metadata",
      "user_profile",
    ]).has(String(record.record_type));
  if (!record.deleted && !timestamp(record.start_time) && !undatedHistorical) {
    return false;
  }
  if (
    record.start_time && record.end_time &&
    Date.parse(String(record.end_time)) < Date.parse(String(record.start_time))
  ) return false;
  for (const key of ["source_zone_offset", "end_zone_offset"]) {
    if (record[key] != null && !offset(record[key])) return false;
  }
  for (const key of ["source_package", "source_device_id"]) {
    if (record[key] != null && !text(record[key])) return false;
  }
  return new TextEncoder().encode(JSON.stringify(record.payload)).length <=
    1835008;
}
export function validBatch(
  body: unknown,
): body is ObjectValue & {
  device: ObjectValue;
  records: ObjectValue[];
  runs: ObjectValue[];
} {
  if (
    !object(body) ||
    Object.keys(body).some((key) =>
      !["device", "records", "runs"].includes(key)
    )
  ) return false;
  if (
    !object(body.device) ||
    Object.keys(body.device).some((key) =>
      !["device_uid", "platform", "model", "app_version"].includes(key)
    )
  ) return false;
  if (
    !text(body.device.device_uid, 128) ||
    !["android", "offline_import"].includes(String(body.device.platform)) ||
    !text(body.device.app_version, 64)
  ) return false;
  if (body.device.model != null && !text(body.device.model, 128)) return false;
  if (
    !Array.isArray(body.records) || body.records.length > 500 ||
    !body.records.every(validRecord)
  ) return false;
  const identities = body.records.map((r) =>
    JSON.stringify([r.provider, r.record_type, r.source_uid])
  );
  if (new Set(identities).size !== identities.length) return false;
  if (!Array.isArray(body.runs) || body.runs.length > 100) return false;
  return body.runs.every((run) =>
    object(run) && Object.keys(run).every((key) =>
      [
        "id",
        "started_at",
        "finished_at",
        "status",
        "records_read",
        "records_failed",
        "error_code",
        "source_results",
      ].includes(key)
    ) &&
    typeof run.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      run.id,
    ) &&
    timestamp(run.started_at) && timestamp(run.finished_at) &&
    Date.parse(String(run.finished_at)) >= Date.parse(String(run.started_at)) &&
    ["SUCCESS", "PARTIAL_FAILURE"].includes(String(run.status)) &&
    Number.isSafeInteger(run.records_read) && Number(run.records_read) >= 0 &&
    Number.isSafeInteger(run.records_failed) &&
    Number(run.records_failed) >= 0 &&
    (run.source_results == null ||
      (object(run.source_results) &&
        Object.keys(run.source_results).length <= 64 &&
        Object.entries(run.source_results).every(([key, value]) => {
          const [provider, type, extra] = key.split(":");
          return extra === undefined &&
            ["health_connect", "samsung_health"].includes(provider) &&
            TYPES.has(type) &&
            [
              "SUCCESS",
              "QUARANTINED",
              "PERMISSION_REQUIRED",
              "PERMISSION_REVOKED",
              "HISTORY_REQUIRED_FOR_TOKEN_RESET",
              "UNSUPPORTED",
              "SDK_MISSING",
              "SDK_BRIDGE_REQUIRED",
              "PLATFORM_MISSING",
              "PLATFORM_UPDATE_REQUIRED",
              "PLATFORM_UNAVAILABLE",
              "SOURCE_FAILED",
            ].includes(String(value));
        }))) &&
    (run.error_code == null ||
      (typeof run.error_code === "string" &&
        /^[A-Z_]{1,64}$/.test(run.error_code)))
  );
}
