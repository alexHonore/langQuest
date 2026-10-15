import { describe, expect, it } from 'vitest';
import { CliUsageError, memoryIo, parseArgs, renderHelp, runCli, type CliSpec } from './cli';

const spec: CliSpec = {
  name: 'demo',
  summary: 'demo cli',
  flags: [
    { name: 'target', type: 'string', description: 'target', required: true, choices: ['spa', 'fra'] },
    { name: 'limit', type: 'number', description: 'limit', default: 10 },
    { name: 'sources', type: 'list', description: 'sources', default: ['eng'] },
    { name: 'apply', type: 'boolean', description: 'apply', default: false },
    { name: 'out', type: 'string', description: 'out', alias: '-o' },
  ],
};

describe('parseArgs', () => {
  it('parses strings, numbers, lists, booleans, aliases and --no- negation', () => {
    const p = parseArgs(spec, ['--target', 'spa', '--limit=5', '--sources', 'eng,fra', '--sources', 'rus', '--apply', '-o', 'x.jsonl', '--dry-run']);
    expect(p.flags).toMatchObject({ target: 'spa', limit: 5, sources: ['eng', 'fra', 'rus'], apply: true, out: 'x.jsonl', dryRun: true });
    expect(p.dryRun).toBe(true);
    const neg = parseArgs(spec, ['--target', 'fra', '--no-apply']);
    expect(neg.flags.apply).toBe(false);
    expect(neg.flags.limit).toBe(10);
    expect(neg.flags.sources).toEqual(['eng']);
  });

  it('rejects unknown flags, bad choices, missing required flags and bad numbers', () => {
    expect(() => parseArgs(spec, ['--target', 'spa', '--bogus'])).toThrow(CliUsageError);
    expect(() => parseArgs(spec, ['--target', 'deu'])).toThrow(/one of/);
    expect(() => parseArgs(spec, [])).toThrow(/required/);
    expect(() => parseArgs(spec, ['--target', 'spa', '--limit', 'abc'])).toThrow(/number/);
  });

  it('skips the first `--` (forwarded by pnpm run) and treats a second one as end of flags', () => {
    const p = parseArgs(spec, ['--', '--target', 'spa', '--', '--not-a-flag']);
    expect(p.flags.target).toBe('spa');
    expect(p.positionals).toEqual(['--not-a-flag']);
  });

  it('--help short-circuits required validation', () => {
    const p = parseArgs(spec, ['--help']);
    expect(p.help).toBe(true);
    expect(renderHelp(spec)).toContain('--target <string>');
    expect(renderHelp(spec)).toContain('--dry-run');
  });
});

describe('runCli', () => {
  it('returns 0 and prints help for --help, 2 for usage errors, 1 for thrown errors', async () => {
    const io = memoryIo();
    expect(await runCli(spec, ['--help'], async () => 0, io)).toBe(0);
    expect(io.lines.join('\n')).toContain('Usage:');
    const io2 = memoryIo();
    expect(await runCli(spec, ['--nope'], async () => 0, io2)).toBe(2);
    expect(io2.errors[0]).toMatch(/Unknown flag/);
    const io3 = memoryIo();
    expect(
      await runCli(
        spec,
        ['--target', 'spa'],
        async () => {
          throw new Error('boom');
        },
        io3,
      ),
    ).toBe(1);
    expect(io3.errors[0]).toContain('boom');
  });
});
