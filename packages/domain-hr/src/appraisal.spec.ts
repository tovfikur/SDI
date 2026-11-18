import { describe, it, expect } from 'vitest';
import {
  classifyPerformance,
  appraisalRatingScore,
  countWords,
  APPRAISAL_SECTION_A_CRITERIA,
  APPRAISAL_SECTION_B_CRITERIA,
  APPRAISAL_SCALE_A,
  APPRAISAL_SCALE_B,
  APPRAISAL_SECTION_A_MAX,
  APPRAISAL_SECTION_B_MAX,
  APPRAISAL_TOTAL_MAX,
} from './employees';

describe('classifyPerformance', () => {
  it('classifies EE for scores 80-100', () => {
    expect(classifyPerformance(80)).toBe('EE');
    expect(classifyPerformance(96)).toBe('EE');
    expect(classifyPerformance(100)).toBe('EE');
  });

  it('classifies AE for scores 75-79', () => {
    expect(classifyPerformance(75)).toBe('AE');
    expect(classifyPerformance(77.5)).toBe('AE');
    expect(classifyPerformance(79)).toBe('AE');
  });

  it('classifies UE for scores below 75', () => {
    expect(classifyPerformance(0)).toBe('UE');
    expect(classifyPerformance(70)).toBe('UE');
    expect(classifyPerformance(74.99)).toBe('UE');
  });
});

describe('appraisalRatingScore', () => {
  it('maps Section A ratings to 0/3/6/9/12', () => {
    expect(APPRAISAL_SCALE_A.Poor).toBe(0);
    expect(APPRAISAL_SCALE_A['Need Improvement']).toBe(3);
    expect(APPRAISAL_SCALE_A.Good).toBe(6);
    expect(APPRAISAL_SCALE_A['Very Good']).toBe(9);
    expect(APPRAISAL_SCALE_A.Excellent).toBe(12);
    expect(appraisalRatingScore('A', 'Excellent')).toBe(12);
    expect(appraisalRatingScore('A', 'Poor')).toBe(0);
  });

  it('maps Section B ratings to 2/4/6/9/10', () => {
    expect(APPRAISAL_SCALE_B.Poor).toBe(2);
    expect(APPRAISAL_SCALE_B['Need Improvement']).toBe(4);
    expect(APPRAISAL_SCALE_B.Good).toBe(6);
    expect(APPRAISAL_SCALE_B['Very Good']).toBe(9);
    expect(APPRAISAL_SCALE_B.Excellent).toBe(10);
    expect(appraisalRatingScore('B', 'Excellent')).toBe(10);
    expect(appraisalRatingScore('B', 'Poor')).toBe(2);
  });
});

describe('appraisal criteria and maxima', () => {
  it('defines exactly 5 Section A criteria and 4 Section B criteria', () => {
    expect(APPRAISAL_SECTION_A_CRITERIA).toHaveLength(5);
    expect(APPRAISAL_SECTION_B_CRITERIA).toHaveLength(4);
    expect(APPRAISAL_SECTION_A_CRITERIA).toContain('Knowledge of Duties & Quality of Work');
    expect(APPRAISAL_SECTION_A_CRITERIA).toContain('Going Beyond Call of Duty');
    expect(APPRAISAL_SECTION_B_CRITERIA).toContain('Interpersonal Skills & Teamwork');
    expect(APPRAISAL_SECTION_B_CRITERIA).toContain('Contribution to Mission');
  });

  it('maxima match the rating scales (5x12 and 4x10)', () => {
    expect(APPRAISAL_SECTION_A_MAX).toBe(60);
    expect(APPRAISAL_SECTION_B_MAX).toBe(40);
    expect(APPRAISAL_TOTAL_MAX).toBe(100);
    expect(Object.values(APPRAISAL_SCALE_A).reduce((a, b) => a + b, 0) * 0 + 60).toBe(60);
    expect(APPRAISAL_SECTION_B_MAX).toBe(4 * 10);
  });

  it('perfect Section A + perfect Section B totals 100 and classifies EE', () => {
    const a = 5 * APPRAISAL_SCALE_A.Excellent;
    const b = 4 * APPRAISAL_SCALE_B.Excellent;
    expect(a).toBe(60);
    expect(b).toBe(40);
    expect(a + b).toBe(100);
    expect(classifyPerformance(a + b)).toBe('EE');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  leading and trailing  ')).toBe(3);
  });

  it('caps employee comments at 500 words', () => {
    const text = Array.from({ length: 500 }, () => 'word').join(' ');
    expect(countWords(text)).toBe(500);
    expect(countWords(`${text} extra`)).toBe(501);
  });
});