import { describe, expect, it } from 'vitest';
import { dec, text } from '../numbers';
import { gainSkill, initialSkills, masteryProgress, skillSources, threshold } from './skills';

describe('independent proficiency and mastery contracts', () => {
  it('derives a legacy mastery baseline from the largest saved child, without modifying the children or save', () => {
    const skills = initialSkills();
    skills.sword = { level: 10, xp: threshold('sword', 10) };
    skills.greatsword = { level: 5, xp: threshold('greatsword', 5) };
    const before = structuredClone(skills);
    expect(masteryProgress(skills, 'weapon-mastery')).toEqual(skills.sword);
    expect(masteryProgress(skills, 'manual-mastery')).toEqual({ level: 0, xp: '0' });
    expect(skills).toEqual(before);
  });

  it('uses pre-award levels for the exponential bonus and credits only the newly earned gap to the parent', () => {
    const skills = initialSkills();
    skills['weapon-mastery'] = { level: 10, xp: threshold('weapon-mastery', 10) };
    const parentXp = skills['weapon-mastery'].xp;
    gainSkill(skills, 'sword', '10', 0);
    expect(skills.sword.xp).toBe(text(dec(10).mul(dec('1.1').pow(10)).toDecimalPlaces(2)));
    expect(skills['weapon-mastery'].xp).toBe(parentXp);
    skills.sword = { level: 10, xp: parentXp };
    gainSkill(skills, 'sword', '10', 0);
    const earned = dec(10).mul('1.05').mul('1.05').toDecimalPlaces(2);
    expect(skills['weapon-mastery'].xp).toBe(text(dec(parentXp).plus(earned)));
    expect(skills.sword.xp).toBe(skills['weapon-mastery'].xp);
    expect(skills.greatsword).toBeUndefined();
  });

  it('links independent manuals and the reference artifact, but not unarmed practice', () => {
    const skills = initialSkills();
    skills['cloudstep-art'] = { level: 0, xp: '0' };
    skills['mountainforce-art'] = { level: 0, xp: '0' };
    skills['returning-lamp'] = { level: 0, xp: '0' };
    gainSkill(skills, 'cloudstep-art', '10', 0);
    expect(skills['manual-mastery']!.xp).toBe('10');
    gainSkill(skills, 'mountainforce-art', '4', 0);
    expect(skills['manual-mastery']!.xp).toBe('10');
    expect(skills['cloudstep-art'].xp).toBe('10');
    gainSkill(skills, 'returning-lamp', '20', 0);
    expect(skills['manual-mastery']!.xp).toBe('20');
    gainSkill(skills, 'unarmed', '100', 0);
    expect(skills['weapon-mastery']).toBeUndefined();
  });

  it('keeps over-threshold and post-cap XP without repeating stat or milestone rewards', () => {
    const skills = initialSkills();
    skills.unarmed = { level: 59, xp: text(dec(threshold('unarmed', 60)).minus(1)) };
    gainSkill(skills, 'unarmed', '10', 0);
    expect(skills.unarmed).toEqual({ level: 60, xp: text(dec(threshold('unarmed', 60)).plus(9)) });
    const sources = skillSources(skills, 'unarmed');
    expect(gainSkill(skills, 'unarmed', '10', 0)).toBe(false);
    expect(skills.unarmed.xp).toBe(text(dec(threshold('unarmed', 60)).plus(19)));
    expect(skillSources(skills, 'unarmed')).toEqual(sources);
    skills['weapon-mastery'] = { level: 300, xp: threshold('weapon-mastery', 300) };
    const before = dec(skills['weapon-mastery'].xp);
    gainSkill(skills, 'weapon-mastery', '10', 0);
    expect(skills['weapon-mastery'].level).toBe(300);
    expect(dec(skills['weapon-mastery'].xp).minus(before).toString()).toBe('10');
    skills.trade = { level: 999, xp: threshold('trade', 999) };
    const huge = skills.trade.xp;
    gainSkill(skills, 'trade', '10', 0);
    expect(BigInt(skills.trade.xp) - BigInt(huge)).toBe(10n);
  });
});
