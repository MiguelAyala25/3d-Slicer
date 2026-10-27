import { describe, it, expect, beforeEach } from 'vitest';
import { TECHNIQUES, JOINTS, getJoint, getTechnique } from '../core/build/registry';
import { DEFAULT_BUILD } from '../core/build/types';
import { ValidationError } from '../core/validator';
import { useSculptureStore } from '../store/useSculptureStore';

describe('Joints and Techniques Registry', () => {
  beforeEach(() => {
    // Reset store to known initial state
    useSculptureStore.setState({
      build: { ...DEFAULT_BUILD },
      discs: [],
    });
  });

  it('exposes exactly 2 techniques and 4 joints with exact labels', () => {
    expect(TECHNIQUES.length).toBe(2);
    expect(TECHNIQUES.map((t) => ({ id: t.id, label: t.label }))).toEqual([
      { id: 'stacked', label: 'Planos apilados' },
      { id: 'waffle', label: 'Waffle' },
    ]);

    expect(JOINTS.length).toBe(4);
    expect(JOINTS.map((j) => ({ id: j.id, label: j.label }))).toEqual([
      { id: 'none', label: 'Sin separación' },
      { id: 'discs', label: 'Con discos' },
      { id: 'slots', label: 'Encaje por ranuras' },
      { id: 'rod', label: 'Con varilla' },
    ]);
  });

  it('marks waffle as available and rod as unavailable with reason "Próximamente"', () => {
    const waffle = getTechnique('waffle');
    expect(waffle.available).toBe(true);

    const rod = getJoint('rod');
    expect(rod.available).toBe(false);
    expect(rod.unavailableReason).toBe('Próximamente');

    const slots = getJoint('slots');
    expect(slots.available).toBe(true);
  });

  it('has DEFAULT_BUILD as stacked + discs', () => {
    expect(DEFAULT_BUILD).toEqual({
      techniqueId: 'stacked',
      jointId: 'discs',
    });
  });

  it('allows selecting waffle and switches joint to slots automatically', () => {
    const store = useSculptureStore.getState();
    const outcome = store.setTechnique('waffle');

    expect(outcome).toEqual({ needsConfirmation: false, discCount: 0 });
    expect(useSculptureStore.getState().build).toEqual({
      techniqueId: 'waffle',
      jointId: 'slots',
    });
  });

  it('requests confirmation when switching to waffle with existing discs', () => {
    const store = useSculptureStore.getState();
    // Simulate existing discs
    useSculptureStore.setState({
      build: { techniqueId: 'stacked', jointId: 'discs' },
      discs: [
        { id: 1, gapIndex: 0, x: 0, y: 0, diameter: 5 },
        { id: 2, gapIndex: 1, x: 0, y: 0, diameter: 5 },
      ],
    });

    // Unconfirmed attempt: returns needsConfirmation: true
    const attempt = store.setTechnique('waffle');
    expect(attempt).toEqual({ needsConfirmation: true, discCount: 2 });
    expect(useSculptureStore.getState().build.techniqueId).toBe('stacked');
    expect(useSculptureStore.getState().discs.length).toBe(2);

    // Confirmed attempt: clears discs and switches to waffle
    const confirmed = store.setTechnique('waffle', { confirmed: true });
    expect(confirmed).toEqual({ needsConfirmation: false, discCount: 0 });
    expect(useSculptureStore.getState().build).toEqual({
      techniqueId: 'waffle',
      jointId: 'slots',
    });
    expect(useSculptureStore.getState().discs.length).toBe(0);
  });

  it('throws ValidationError when attempting to select rod and does not mutate build', () => {
    const store = useSculptureStore.getState();
    const initialBuild = { ...store.build };

    expect(() => store.setJoint('rod')).toThrow(ValidationError);
    expect(() => store.setJoint('rod')).toThrow('La unión «Con varilla» aún no está disponible.');
    expect(useSculptureStore.getState().build).toEqual(initialBuild);
  });

  it('throws ValidationError when selecting slots in stacked mode or discs in waffle mode', () => {
    const store = useSculptureStore.getState();

    // In stacked mode, slots is not allowed
    expect(() => store.setJoint('slots')).toThrow(
      'La unión «Encaje por ranuras» es exclusiva de la técnica «Waffle».'
    );

    // Switch to waffle mode
    store.setTechnique('waffle');

    // In waffle mode, discs is not allowed
    expect(() => store.setJoint('discs')).toThrow(
      'La técnica «Waffle» solo admite la unión «Encaje por ranuras».'
    );
  });
});
