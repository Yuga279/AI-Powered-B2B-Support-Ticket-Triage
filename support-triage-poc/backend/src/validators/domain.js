export const TEAMS = ['billing', 'infrastructure', 'auth_identity', 'frontend', 'unknown'];
export const ROUTABLE_TEAMS = TEAMS.filter((t) => t !== 'unknown');
export const ENVIRONMENTS = ['production', 'staging', 'development'];
export const PROVIDER_IDS = ['jev', 'luna', 'openrouter_llm'];
export const RISK_OUTPUT_TYPES = ['probability', 'predicate', 'qualitative'];
// calibrated: independently validated calibration (no current provider produces this)
// vendor_claimed: vendor states the model is calibrated; not independently validated
// unknown: numeric signal with undocumented calibration (e.g. Luna predicate score)
// not_applicable: no numeric probability (qualitative output, or no AI result)
export const CALIBRATION_STATUSES = ['calibrated', 'vendor_claimed', 'unknown', 'not_applicable'];
export const RESULT_STATUSES = ['ok', 'invalid', 'failed', 'unavailable'];
export const RISK_LEVELS = ['low', 'medium', 'high', 'unknown'];
