import { POSTING_ROLES } from '../constants/posting-roles';
import { findTemplate, POSTING_TEMPLATES } from './posting-templates';

describe('posting-templates', () => {
  it('exposes at least one template', () => {
    expect(POSTING_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('has a unique docType for every template', () => {
    const docTypes = POSTING_TEMPLATES.map((t) => t.docType);
    expect(new Set(docTypes).size).toBe(docTypes.length);
  });

  it('has a non-empty title and docType on every template', () => {
    for (const t of POSTING_TEMPLATES) {
      expect(t.docType.length).toBeGreaterThan(0);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it('has at least one debit line in every template', () => {
    for (const t of POSTING_TEMPLATES) {
      expect(t.lines.some((l) => l.side === 'debit')).toBe(true);
    }
  });

  it('has at least one credit line in every template', () => {
    for (const t of POSTING_TEMPLATES) {
      expect(t.lines.some((l) => l.side === 'credit')).toBe(true);
    }
  });

  it('only uses roles that exist in POSTING_ROLES', () => {
    for (const t of POSTING_TEMPLATES) {
      for (const line of t.lines) {
        expect(Object.prototype.hasOwnProperty.call(POSTING_ROLES, line.role)).toBe(true);
      }
    }
  });

  it('only posts amounts declared in the template amounts', () => {
    for (const t of POSTING_TEMPLATES) {
      for (const line of t.lines) {
        expect(t.amounts).toContain(line.amount);
      }
    }
  });

  it('findTemplate returns the template for every known docType', () => {
    for (const t of POSTING_TEMPLATES) {
      expect(findTemplate(t.docType)).toBe(t);
    }
  });

  it('findTemplate returns undefined for an unknown docType', () => {
    expect(findTemplate('does.not.exist')).toBeUndefined();
  });
});
