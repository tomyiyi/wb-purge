import { z } from 'zod';

/** 一条命令规则。passthrough 是为了不丢掉 WorkBuddy 自己写入的未知字段。 */
export const CommandRuleSchema = z
  .object({
    approval: z.enum(['allow', 'deny', 'ask']),
    execEnv: z.string().optional(),
  })
  .passthrough();

export const PermissionConfigSchema = z
  .object({
    customProfiles: z.record(z.string(), z.unknown()).optional(),
    resourceAuthorization: z.record(z.string(), z.unknown()).optional(),
    rules: z
      .object({
        commandRules: z.record(z.string(), CommandRuleSchema).default({}),
        mcpRules: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    _migrationVersion: z.number().optional(),
    activeProfileId: z.string().optional(),
  })
  .passthrough();
export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;

export const SnapshotManifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(6).max(60),
    createdAt: z.string().min(10),
    files: z
      .array(
        z
          .object({
            target: z.enum(['global', 'work']),
            file: z.string().min(1),
            sha256: z.string().length(64),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;

export type Target = 'global' | 'work';

/** 三道真闸。本工具只会读、不会改；发现被关掉就拒绝写入。 */
export const GuardrailSchema = z.object({
  dangerChecker: z.boolean(),
  sandbox: z.boolean(),
  reviewer: z.string(),
});
export type Guardrail = z.infer<typeof GuardrailSchema>;

export type StatusReport = {
  target: Target;
  activeProfile: string;
  ruleCount: number;
  guardrails: Guardrail & { ok: boolean };
  destructiveAllows: string[];
  presets: { name: string; missing: number; covered: number; total: number }[];
};
