/**
 * Minimal, dependency-free CLI argument parser shared by every script in `@langquest/scripts`.
 *
 * Every script declares its flags once (`FlagSpec[]`); `parseArgs` produces a typed object,
 * `--help` renders usage from the same declaration, and `--dry-run` is a first-class, always
 * available boolean so no script can forget it. Scripts never read `process.argv` directly:
 * `main(argv, io)` receives the arguments, which keeps them testable.
 */

export type FlagType = 'string' | 'boolean' | 'number' | 'list';

export interface FlagSpec {
  name: string;
  type: FlagType;
  description: string;
  /** Rendered in `--help`; also applied when the flag is absent. */
  default?: string | number | boolean | string[];
  required?: boolean;
  /** Short alias, e.g. `-o`. */
  alias?: string;
  /** Allowed values (validated). */
  choices?: readonly string[];
}

export interface CliSpec {
  name: string;
  summary: string;
  /** Multi-line description shown under the summary in `--help`. */
  description?: string;
  flags: FlagSpec[];
  examples?: string[];
}

export type FlagValue = string | number | boolean | string[] | undefined;

export interface ParsedArgs {
  flags: Record<string, FlagValue>;
  positionals: string[];
  help: boolean;
  dryRun: boolean;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const BUILT_IN_FLAGS: FlagSpec[] = [
  { name: 'help', type: 'boolean', description: 'Show this help and exit.', alias: '-h' },
  { name: 'dry-run', type: 'boolean', description: 'Validate and report what would be done without writing files or touching the database.' },
];

const camel = (name: string): string => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Render `--help` text for a spec. */
export function renderHelp(spec: CliSpec): string {
  const all = [...spec.flags, ...BUILT_IN_FLAGS];
  const width = Math.max(...all.map((f) => `--${f.name}${f.type === 'boolean' ? '' : ` <${f.type}>`}`.length)) + 2;
  const lines: string[] = [];
  lines.push(`${spec.name} — ${spec.summary}`);
  lines.push('');
  if (spec.description) {
    lines.push(spec.description.trim());
    lines.push('');
  }
  lines.push(`Usage: pnpm --filter @langquest/scripts ${spec.name} -- [flags]`);
  lines.push('');
  lines.push('Flags:');
  for (const f of all) {
    const head = `--${f.name}${f.type === 'boolean' ? '' : ` <${f.type}>`}`.padEnd(width);
    const parts = [f.description];
    if (f.choices) parts.push(`(one of: ${f.choices.join(', ')})`);
    if (f.default !== undefined) parts.push(`[default: ${Array.isArray(f.default) ? f.default.join(',') : String(f.default)}]`);
    if (f.required) parts.push('[required]');
    if (f.alias) parts.push(`(alias ${f.alias})`);
    lines.push(`  ${head}${parts.join(' ')}`);
  }
  if (spec.examples?.length) {
    lines.push('');
    lines.push('Examples:');
    for (const e of spec.examples) lines.push(`  ${e}`);
  }
  return lines.join('\n');
}

/**
 * Parse argv (without the node/script prefix). Supports `--flag value`, `--flag=value`,
 * `--no-flag` for booleans, `-x` aliases, repeated list flags and comma-separated lists.
 * Throws `CliUsageError` on unknown flags, missing required flags or bad values.
 */
export function parseArgs(spec: CliSpec, argv: readonly string[]): ParsedArgs {
  const all = [...spec.flags, ...BUILT_IN_FLAGS];
  const byName = new Map(all.map((f) => [f.name, f]));
  const byAlias = new Map(all.filter((f) => f.alias).map((f) => [f.alias!, f]));
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];

  const setValue = (f: FlagSpec, raw: string | undefined, negated = false): void => {
    const key = camel(f.name);
    switch (f.type) {
      case 'boolean':
        flags[key] = !negated;
        return;
      case 'number': {
        if (raw === undefined) throw new CliUsageError(`--${f.name} expects a number`);
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new CliUsageError(`--${f.name} expects a number, got "${raw}"`);
        flags[key] = n;
        return;
      }
      case 'list': {
        if (raw === undefined) throw new CliUsageError(`--${f.name} expects a value`);
        const prev = (flags[key] as string[] | undefined) ?? [];
        flags[key] = [...prev, ...raw.split(',').map((s) => s.trim()).filter(Boolean)];
        return;
      }
      default: {
        if (raw === undefined) throw new CliUsageError(`--${f.name} expects a value`);
        if (f.choices && !f.choices.includes(raw)) throw new CliUsageError(`--${f.name} must be one of ${f.choices.join(', ')}; got "${raw}"`);
        flags[key] = raw;
      }
    }
  };

  // `pnpm run <script> -- <args>` forwards the `--` itself; the first one is a separator to skip,
  // a second one ends flag parsing (everything after it is positional).
  let separatorSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--') {
      if (!separatorSeen) {
        separatorSeen = true;
        continue;
      }
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      let name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
      let negated = false;
      if (!byName.has(name) && name.startsWith('no-') && byName.get(name.slice(3))?.type === 'boolean') {
        name = name.slice(3);
        negated = true;
      }
      const f = byName.get(name);
      if (!f) throw new CliUsageError(`Unknown flag --${name}. Run with --help.`);
      if (f.type === 'boolean') {
        if (inline !== undefined) setValue(f, undefined, inline === 'false' || inline === '0');
        else setValue(f, undefined, negated);
        continue;
      }
      if (inline !== undefined) setValue(f, inline);
      else {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('-') && next.length > 1 && Number.isNaN(Number(next)))) throw new CliUsageError(`--${name} expects a value`);
        setValue(f, next);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const f = byAlias.get(arg);
      if (!f) throw new CliUsageError(`Unknown flag ${arg}. Run with --help.`);
      if (f.type === 'boolean') setValue(f, undefined);
      else {
        const next = argv[i + 1];
        if (next === undefined) throw new CliUsageError(`${arg} expects a value`);
        setValue(f, next);
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }

  const help = flags.help === true;
  for (const f of all) {
    const key = camel(f.name);
    if (flags[key] === undefined && f.default !== undefined) flags[key] = Array.isArray(f.default) ? [...f.default] : f.default;
    if (!help && f.required && flags[key] === undefined) throw new CliUsageError(`--${f.name} is required. Run with --help.`);
  }
  return { flags, positionals, help, dryRun: flags.dryRun === true };
}

/** Structured console used by every script; tests inject a capturing implementation. */
export interface CliIo {
  log(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

export const consoleIo: CliIo = {
  log: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

/** Capturing io for tests. */
export function memoryIo(): CliIo & { lines: string[]; warnings: string[]; errors: string[] } {
  const lines: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return { lines, warnings, errors, log: (l) => lines.push(l), warn: (l) => warnings.push(l), error: (l) => errors.push(l) };
}

/** Typed accessors for parsed flags. */
export const flagString = (p: ParsedArgs, name: string): string | undefined => {
  const v = p.flags[camel(name)];
  return typeof v === 'string' ? v : undefined;
};
export const flagNumber = (p: ParsedArgs, name: string): number | undefined => {
  const v = p.flags[camel(name)];
  return typeof v === 'number' ? v : undefined;
};
export const flagBool = (p: ParsedArgs, name: string): boolean => p.flags[camel(name)] === true;
export const flagList = (p: ParsedArgs, name: string): string[] => {
  const v = p.flags[camel(name)];
  return Array.isArray(v) ? v : [];
};

/**
 * Standard entry: parse, print help, run, map `CliUsageError` to exit code 2 and any other
 * error to exit code 1. `main` returns the process exit code.
 */
export async function runCli(spec: CliSpec, argv: readonly string[], main: (args: ParsedArgs, io: CliIo) => Promise<number>, io: CliIo = consoleIo): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(spec, argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      io.error(err.message);
      io.error('');
      io.error(renderHelp(spec));
      return 2;
    }
    throw err;
  }
  if (parsed.help) {
    io.log(renderHelp(spec));
    return 0;
  }
  try {
    return await main(parsed, io);
  } catch (err) {
    if (err instanceof CliUsageError) {
      io.error(err.message);
      return 2;
    }
    io.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return 1;
  }
}

/** True when this module file is the process entry (works under tsx and node). */
export function isDirectRun(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const path = new URL(importMetaUrl).pathname;
    return path === entry || path.endsWith(entry) || entry.endsWith(path.split('/').pop() ?? '\u0000');
  } catch {
    return false;
  }
}
