import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "..", "schemas");

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
  readonly params: unknown;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Singleton Ajv instance with our schemas registered.
 *
 * We compile schemas once at startup; loaders should never construct their
 * own Ajv instance because schema $id collisions would silently swallow
 * validation errors.
 */
class SchemaValidator {
  private readonly ajv: Ajv2020;
  private readonly compiled: Map<string, ValidateFunction> = new Map();

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

  private register(key: string, file: string): void {
    const path = resolve(SCHEMA_DIR, file);
    const raw = readFileSync(path, "utf8");
    const schema = JSON.parse(raw) as Record<string, unknown>;
    this.compiled.set(key, this.ajv.compile(schema));
  }

  validate<T>(key: "compliance-rule" | "fine-mapping", data: unknown): ValidationResult<T> {
    const fn = this.compiled.get(key);
    if (!fn) {
      throw new Error(`schema not registered: ${key}`);
    }
    if (fn(data)) {
      return { ok: true, value: data as T };
    }
    return {
      ok: false,
      issues: (fn.errors ?? []).map(toIssue),
    };
  }
}

function toIssue(e: ErrorObject): ValidationIssue {
  return {
    path: e.instancePath || "/",
    message: e.message ?? "validation error",
    keyword: e.keyword,
    params: e.params,
  };
}

let singleton: SchemaValidator | null = null;
export function getValidator(): SchemaValidator {
  if (!singleton) singleton = new SchemaValidator();
  return singleton;
}

/** Convenience helper used in tests + loaders. */
export function validateRuleSet(data: unknown): ValidationResult<unknown> {
  return getValidator().validate("compliance-rule", data);
}

export function validateFineSet(data: unknown): ValidationResult<unknown> {
  return getValidator().validate("fine-mapping", data);
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((i) => `  ${i.path || "/"}: ${i.message} (${i.keyword})`)
    .join("\n");
}
