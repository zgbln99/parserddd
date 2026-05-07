import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "..", "schemas");
/**
 * Singleton Ajv instance with our schemas registered.
 *
 * We compile schemas once at startup; loaders should never construct their
 * own Ajv instance because schema $id collisions would silently swallow
 * validation errors.
 */
class SchemaValidator {
    ajv;
    compiled = new Map();
    constructor() {
        this.ajv = new Ajv2020({
            allErrors: true,
            strict: true,
            strictSchema: true,
            strictTypes: true,
            strictTuples: true,
            verbose: false,
        });
        addFormats(this.ajv);
        this.register("compliance-rule", "compliance-rule.schema.json");
        this.register("fine-mapping", "fine-mapping.schema.json");
    }
    register(key, file) {
        const path = resolve(SCHEMA_DIR, file);
        const raw = readFileSync(path, "utf8");
        const schema = JSON.parse(raw);
        this.compiled.set(key, this.ajv.compile(schema));
    }
    validate(key, data) {
        const fn = this.compiled.get(key);
        if (!fn) {
            throw new Error(`schema not registered: ${key}`);
        }
        if (fn(data)) {
            return { ok: true, value: data };
        }
        return {
            ok: false,
            issues: (fn.errors ?? []).map(toIssue),
        };
    }
}
function toIssue(e) {
    return {
        path: e.instancePath || "/",
        message: e.message ?? "validation error",
        keyword: e.keyword,
        params: e.params,
    };
}
let singleton = null;
export function getValidator() {
    if (!singleton)
        singleton = new SchemaValidator();
    return singleton;
}
/** Convenience helper used in tests + loaders. */
export function validateRuleSet(data) {
    return getValidator().validate("compliance-rule", data);
}
export function validateFineSet(data) {
    return getValidator().validate("fine-mapping", data);
}
export function formatIssues(issues) {
    return issues
        .map((i) => `  ${i.path || "/"}: ${i.message} (${i.keyword})`)
        .join("\n");
}
//# sourceMappingURL=schema-validator.js.map