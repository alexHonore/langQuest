import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHARACTER_UUID_NAMESPACE, CHARACTER_UUID_NAME_PREFIX, characterKey, characterUuid, sha1Bytes, uuidV5 } from './character-uuid';

/** Independent reference: node:crypto SHA-1 with the RFC 4122 v5 version/variant bits applied. */
function referenceV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

describe('pure SHA-1 / uuid v5', () => {
  it('matches node:crypto on empty, short, multi-block and non-ASCII inputs', () => {
    const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), "l'été ☕ العربية 日本語 🎉"];
    for (const input of inputs) {
      const expected = createHash('sha1').update(Buffer.from(input, 'utf8')).digest('hex');
      const actual = Buffer.from(sha1Bytes(Buffer.from(input, 'utf8'))).toString('hex');
      expect(actual, input.length.toString()).toBe(expected);
    }
  });
  it('produces RFC 4122 v5 uuids (known vector: DNS namespace + www.example.com)', () => {
    const dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(uuidV5(dns, 'www.example.com')).toBe(referenceV5(dns, 'www.example.com'));
    expect(uuidV5(dns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidV5(dns, 'www.example.com')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('characterUuid', () => {
  it('is deterministic, namespaced and prefixed', () => {
    expect(characterUuid('ary-cafe-staff-nadia')).toBe(referenceV5(CHARACTER_UUID_NAMESPACE, `${CHARACTER_UUID_NAME_PREFIX}ary-cafe-staff-nadia`));
    expect(characterUuid('ary-cafe-staff-nadia')).toBe(characterUuid('ary-cafe-staff-nadia'));
    expect(characterUuid('ary-cafe-staff-nadia')).not.toBe(characterUuid('ary-neighbour-youssef'));
    expect(characterKey('ary-cafe-staff-nadia')).toBe('ary-cafe-staff-nadia');
  });
  it('pins the namespace (changing it would orphan every FK to characters.id)', () => {
    expect(CHARACTER_UUID_NAMESPACE).toBe('d0a6e7c4-9d2b-4f3a-8e1c-5b7f2c9a1e34');
    expect(CHARACTER_UUID_NAME_PREFIX).toBe('langquest.character:');
  });
});
