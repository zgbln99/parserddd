import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  formatIssues,
  validateFineSet,
  validateRuleSet,
} from "../validators/schema-validator.js";
import type {
  FineIndex,
  FineMapping,
  FineSet,
  Rule,
  RuleCategory,
  RuleIndex,
  RuleSet,
} from "../types/rule.js";

export class RuleLoadError extends Error {
  readonly source_path: string;
  readonly issues: readonly { path: string; message: string }[];

  constructor(source_path: string, message: string, issues: readonly { path: string; message: string }[] = []) {
    super(`[${source_path}] ${message}`);
    this.name = "RuleLoadError";
    this.source_path = source_path;
    this.issues = issues;
  }
}

/**
 * Load a single rule-set YAML file and validate it against the JSON schema.
 *
 * Throws RuleLoadError on any schema violation — we never silently accept a
 * partial rule set, because a missing parameter would silently default the
 * downstream evaluator to "compliant".
 */
export function loadRuleSetFile(file_path: string): RuleSet {
  const abs = resolve(file_path);
  const raw = readFileSync(abs, "utf8");
  const parsed = safeParse(raw, abs);
  const result = validateRuleSet(parsed);
  if (!result.ok) {
    throw new RuleLoadError(
      abs,
      "rule set failed schema validation:\n" + formatIssues(result.issues),
      result.issues,
    );
  }
  const data = result.value as RuleSet;
  return Object.freeze({ ...data, source_path: abs });
}

/**
 * Load a single fine-mapping YAML file and validate it against the schema.
 */
export function loadFineSetFile(file_path: string): FineSet {
  const abs = resolve(file_path);
  const raw = readFileSync(abs, "utf8");
  const parsed = safeParse(raw, abs);
  const result = validateFineSet(parsed);
  if (!result.ok) {
    throw new RuleLoadError(
      abs,
      "fine set failed schema validation:\n" + formatIssues(result.issues),
      result.issues,
    );
  }
  const data = result.value as Omit<FineSet, "currency"> & { currency?: string };
  return Object.freeze({
    ...data,
    currency: data.currency ?? "EUR",
    source_path: abs,
  } as FineSet);
}

function safeParse(raw: string, source: string): unknown {
  try {
    return parseYaml(raw, { strict: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RuleLoadError(source, `YAML parse error: ${message}`);
  }
}

/**
 * Recursively load every YAML file under the given directories and build a
 * fine + rule index.
 *
 * Resolution rules:
 * - Files named "fines*.yaml" or whose top-level has `fines:` go to the fine index.
 * - Files with top-level `rules:` go to the rule index.
 * - Anything else is rejected — there is no third bucket.
 *
 * Duplicate rule_id across rule sets throws — the engine must have a single
 * authoritative definition per rule id.
 */
export async function loadComplianceBundle(
  ...roots: string[]
): Promise<{ rules: RuleIndex; fines: FineIndex }> {
  const ruleSets: RuleSet[] = [];
  const fineSets: FineSet[] = [];

  for (const root of roots) {
    for (const file of await walkYaml(resolve(root))) {
      const raw = readFileSync(file, "utf8");
      const parsed = safeParse(raw, file);
      if (isFineSetShape(parsed)) {
        fineSets.push(loadFineSetFile(file));
      } else if (isRuleSetShape(parsed)) {
        ruleSets.push(loadRuleSetFile(file));
      } else {
        throw new RuleLoadError(
          file,
          "YAML does not look like a rule set (missing `rules:`) or fine set (missing `fines:`)",
        );
      }
    }
  }

  return {
    rules: buildRuleIndex(ruleSets),
    fines: buildFineIndex(fineSets),
  };
}

async function walkYaml(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(root, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await walkYaml(full)));
    } else if (extname(entry) === ".yaml" || extname(entry) === ".yml") {
      out.push(full);
    }
  }
  return out.sort();
}

function isFineSetShape(x: unknown): x is { fines: unknown[] } {
  return (
    typeof x === "object" &&
    x !== null &&
    Array.isArray((x as { fines?: unknown }).fines)
  );
}

function isRuleSetShape(x: unknown): x is { rules: unknown[] } {
  return (
    typeof x === "object" &&
    x !== null &&
    Array.isArray((x as { rules?: unknown }).rules)
  );
}

export function buildRuleIndex(rule_sets: readonly RuleSet[]): RuleIndex {
  const by_id = new Map<string, Rule>();
  const by_category = new Map<RuleCategory, Rule[]>();
  for (const set of rule_sets) {
    for (const rule of set.rules) {
      if (by_id.has(rule.rule_id)) {
        throw new RuleLoadError(
          set.source_path,
          `duplicate rule_id ${rule.rule_id} (also defined in another rule set)`,
        );
      }
      by_id.set(rule.rule_id, rule);
      const list = by_category.get(rule.category) ?? [];
      list.push(rule);
      by_category.set(rule.category, list);
    }
  }
  const frozen = new Map<RuleCategory, readonly Rule[]>();
  for (const [k, v] of by_category) frozen.set(k, Object.freeze([...v]));
  return Object.freeze({
    rule_sets: Object.freeze([...rule_sets]),
    by_id,
    by_category: frozen,
  });
}

export function buildFineIndex(fine_sets: readonly FineSet[]): FineIndex {
  const by_rule_id = new Map<string, FineMapping>();
  for (const set of fine_sets) {
    for (const fine of set.fines) {
      if (by_rule_id.has(fine.violation_reference)) {
        // last-wins is wrong for fines because multiple jurisdictions may
        // define different amounts. For now we throw and require explicit
        // jurisdictional separation.
        throw new RuleLoadError(
          set.source_path,
          `duplicate fine for ${fine.violation_reference}; multi-jurisdiction fines must live in separate indices`,
        );
      }
      by_rule_id.set(fine.violation_reference, fine);
    }
  }
  return Object.freeze({
    fine_sets: Object.freeze([...fine_sets]),
    by_rule_id,
  });
}
