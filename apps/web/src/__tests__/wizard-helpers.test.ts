import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultData, loadDraft, saveDraft, clearDraft, buildPayload,
  validatePersonal, validateEmployment, DRAFT_KEY,
  EMPTY_BANK, EMPTY_EMERGENCY, EMPTY_ACADEMIC, EMPTY_ACTIVITY, EMPTY_EXPERIENCE, EMPTY_FAMILY,
  emptyAddress, addressesEqual, hasAddressValue,
} from '../pages/hr/wizard/wizard-helpers';

describe('wizard-helpers', () => {
  describe('defaultData', () => {
    it('returns empty strings and sensible defaults', () => {
      const d = defaultData();
      expect(d.full_name).toBe('');
      expect(d.contract_type).toBe('permanent');
      expect(d.working_days).toBe('26');
      expect(d.same_address).toBe(false);
      expect(d.banks).toHaveLength(1);
      expect(d.addresses).toHaveLength(2);
      expect(d.emergencyContacts).toHaveLength(1);
      expect(d.academics).toHaveLength(1);
      expect(d.extraCurriculars).toHaveLength(1);
      expect(d.experiences).toHaveLength(1);
      expect(d.familyMembers).toHaveLength(1);
    });
  });

  describe('emptyAddress', () => {
    it('creates address with given type', () => {
      const a = emptyAddress('permanent');
      expect(a.type).toBe('permanent');
      expect(a.country).toBe('');
      expect(a.city).toBe('');
    });
  });

  describe('localStorage draft helpers', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('saveDraft / loadDraft round-trips', () => {
      const data = defaultData();
      data.full_name = 'Test User';
      saveDraft(data);
      const loaded = loadDraft();
      expect(loaded).not.toBeNull();
      expect(loaded!.full_name).toBe('Test User');
    });

    it('loadDraft returns null when empty', () => {
      expect(loadDraft()).toBeNull();
    });

    it('clearDraft removes the stored key', () => {
      saveDraft(defaultData());
      clearDraft();
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    });
  });

  describe('validatePersonal', () => {
    it('requires full_name', () => {
      const d = defaultData();
      expect(validatePersonal(d).full_name).toBeDefined();
    });

    it('passes with valid full_name', () => {
      const d = defaultData();
      d.full_name = 'John Doe';
      expect(Object.keys(validatePersonal(d))).toHaveLength(0);
    });
  });

  describe('validateEmployment', () => {
    it('catches contract_end_date before joining_date', () => {
      const d = defaultData();
      d.joining_date = '2025-06-01';
      d.contract_end_date = '2025-01-01';
      expect(validateEmployment(d).contract_end_date).toBeDefined();
    });

    it('passes with valid date range', () => {
      const d = defaultData();
      d.joining_date = '2025-01-01';
      d.contract_end_date = '2025-12-31';
      expect(Object.keys(validateEmployment(d))).toHaveLength(0);
    });

    it('passes with no dates', () => {
      expect(Object.keys(validateEmployment(defaultData()))).toHaveLength(0);
    });
  });

  describe('buildPayload', () => {
    it('strips empty banks', () => {
      const d = defaultData();
      const p = buildPayload(d);
      expect(p.banks).toHaveLength(0);
    });

    it('keeps banks with data', () => {
      const d = defaultData();
      d.banks = [{ ...EMPTY_BANK, bank_name: 'DBBL', account_number: '12345' }];
      const p = buildPayload(d);
      expect(p.banks).toHaveLength(1);
      expect(p.banks[0].bank_name).toBe('DBBL');
    });

    it('converts numeric fields', () => {
      const d = defaultData();
      d.probation_months = '6';
      d.working_days = '22';
      const p = buildPayload(d);
      expect(p.employee.probation_months).toBe(6);
      expect(p.employee.working_days).toBe(22);
    });

    it('omits empty optional fields', () => {
      const d = defaultData();
      d.full_name = 'Test';
      const p = buildPayload(d);
      expect(p.employee.email).toBeUndefined();
      expect(p.employee.photo_file_id).toBeUndefined();
      expect(p.employee.full_name).toBe('Test');
    });

    it('filters empty repeatable sections', () => {
      const d = defaultData();
      d.emergencyContacts = [{ ...EMPTY_EMERGENCY }];
      d.academics = [{ ...EMPTY_ACADEMIC }];
      d.extraCurriculars = [{ ...EMPTY_ACTIVITY }];
      d.experiences = [{ ...EMPTY_EXPERIENCE }];
      d.familyMembers = [{ ...EMPTY_FAMILY }];
      const p = buildPayload(d);
      expect(p.emergencyContacts).toHaveLength(0);
      expect(p.academics).toHaveLength(0);
      expect(p.extraCurriculars).toHaveLength(0);
      expect(p.experiences).toHaveLength(0);
      expect(p.familyMembers).toHaveLength(0);
    });

    it('keeps repeatable items with data', () => {
      const d = defaultData();
      d.emergencyContacts = [{ name: 'Jane', relationship: 'Mother', phone: '0171', email: '', address: '' }];
      d.academics = [{ degree: 'BSc', field_of_study: 'CS', institution: 'DU', board: '', result: '3.5', start_year: '2018', end_year: '2022', grade: '', attachment_url: '' }];
      const p = buildPayload(d);
      expect(p.emergencyContacts).toHaveLength(1);
      expect(p.academics).toHaveLength(1);
      expect(p.academics[0].start_year).toBe(2018);
    });

    it('filters addresses by content', () => {
      const d = defaultData();
      d.addresses = [
        { type: 'present', country: 'Bangladesh', state: '', district: 'Dhaka', city: '', thana: '', zip: '', address_line1: '123 Main St', address_line2: '' },
        { type: 'permanent', country: '', state: '', district: '', city: '', thana: '', zip: '', address_line1: '', address_line2: '' },
      ];
      const p = buildPayload(d);
      expect(p.addresses).toHaveLength(1);
      expect(p.addresses[0].type).toBe('present');
    });

    it('copies present address into permanent payload when same_address is checked', () => {
      const d = defaultData();
      d.same_address = true;
      d.addresses = [
        { type: 'present', country: 'Bangladesh', state: 'Dhaka', district: 'Dhaka', city: '', thana: 'Gulshan', zip: '1212', address_line1: '123 Main St', address_line2: 'Flat 5A' },
        { type: 'permanent', country: '', state: '', district: '', city: '', thana: '', zip: '', address_line1: '', address_line2: '' },
      ];
      const p = buildPayload(d);
      expect(p.addresses).toHaveLength(2);
      expect(p.addresses[0].type).toBe('present');
      expect(p.addresses[1]).toMatchObject({
        type: 'permanent',
        country: 'Bangladesh',
        state: 'Dhaka',
        district: 'Dhaka',
        thana: 'Gulshan',
        zip: '1212',
        address_line1: '123 Main St',
        address_line2: 'Flat 5A',
      });
    });

    it('drops both empty addresses even when same_address is checked', () => {
      const d = defaultData();
      d.same_address = true;
      const p = buildPayload(d);
      expect(p.addresses).toHaveLength(0);
    });
  });

  describe('addressesEqual / hasAddressValue', () => {
    it('treats identical content as equal regardless of type', () => {
      const present = emptyAddress('present');
      const permanent = { ...present, type: 'permanent' };
      present.country = 'Bangladesh';
      present.address_line1 = '123 Main St';
      permanent.country = 'Bangladesh';
      permanent.address_line1 = '123 Main St';
      expect(addressesEqual(present, permanent)).toBe(true);
    });

    it('treats differing content as unequal', () => {
      const a = emptyAddress('present');
      a.district = 'Dhaka';
      const b = emptyAddress('permanent');
      b.district = 'Chittagong';
      expect(addressesEqual(a, b)).toBe(false);
    });

    it('reports empty addresses as having no value', () => {
      expect(hasAddressValue(emptyAddress('present'))).toBe(false);
      const a = emptyAddress('present');
      a.city = 'Dhaka';
      expect(hasAddressValue(a)).toBe(true);
    });
  });
});
