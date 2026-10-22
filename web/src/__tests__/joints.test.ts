import { describe, it, expect } from 'vitest';
import { TECHNIQUES, JOINTS, getJoint, getTechnique } from '../core/build/registry';
import { DEFAULT_BUILD } from '../core/build/types';
import { ValidationError } from '../core/validator';
import { useSculptureStore } from '../store/useSculptureStore';

describe('Joints and Techniques Registry', () => {
  it('exposes exactly 2 techniques and 3 joints with exact labels', () => {
    expect(TECHNIQUES.length).toBe(2);
    expect(TECHNIQUES.map((t) => ({ id: t.id, label: t.label }))).toEqual([
      { id: 'stacked', label: 'Planos apilados' },
      { id: 'waffle', label: 'Waffle' },
    ]);

    expect(JOINTS.length).toBe(3);
    expect(JOINTS.map((j) => ({ id: j.id, label: j.label }))).toEqual([
      { id: 'none', label: 'Sin separación' },
      { id: 'discs', label: 'Con discos' },
      { id: 'rod', label: 'Con varilla' },
    ]);
  });

  it('marks waffle and rod as unavailable with reason "Próximamente"', () => {
    const waffle = getTechnique('waffle');
    expect(waffle.available).toBe(false);
    expect(waffle.unavailableReason).toBe('Próximamente');

    const rod = getJoint('rod');
    expect(rod.available).toBe(false);
    expect(rod.unavailableReason).toBe('Próximamente');
  });

  it('has DEFAULT_BUILD as stacked + discs', () => {
    expect(DEFAULT_BUILD).toEqual({
      techniqueId: 'stacked',
      jointId: 'discs',
    });
  });

  it('throws ValidationError when attempting to select waffle or rod and does not mutate build', () => {
    const store = useSculptureStore.getState();
    const initialBuild = { ...store.build };

    expect(() => store.setTechnique('waffle')).toThrow(ValidationError);
    expect(() => store.setTechnique('waffle')).toThrow('La técnica «Waffle» aún no está disponible.');
    expect(useSculptureStore.getState().build).toEqual(initialBuild);

    expect(() => store.setJoint('rod')).toThrow(ValidationError);
    expect(() => store.setJoint('rod')).toThrow('La unión «Con varilla» aún no está disponible.');
    expect(useSculptureStore.getState().build).toEqual(initialBuild);
  });
});
