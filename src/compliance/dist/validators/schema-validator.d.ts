export interface ValidationIssue {
    readonly path: string;
    readonly message: string;
    readonly keyword: string;
    readonly params: unknown;
}
export type ValidationResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly issues: readonly ValidationIssue[];
};
/**
 * Singleton Ajv instance with our schemas registered.
 *
 * We compile schemas once at startup; loaders should never construct their
 * own Ajv instance because schema $id collisions would silently swallow
 * validation errors.
 */
declare class SchemaValidator {
    private readonly ajv;
    private readonly compiled;
    constructor();
    private register;
    validate<T>(key: "compliance-rule" | "fine-mapping", data: unknown): ValidationResult<T>;
}
export declare function getValidator(): SchemaValidator;
/** Convenience helper used in tests + loaders. */
export declare function validateRuleSet(data: unknown): ValidationResult<unknown>;
export declare function validateFineSet(data: unknown): ValidationResult<unknown>;
export declare function formatIssues(issues: readonly ValidationIssue[]): string;
export {};
//# sourceMappingURL=schema-validator.d.ts.map