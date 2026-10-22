import type { ComponentType } from 'react';
import type { JointId } from '../../core/build/types';
import { DiscsDockHUD } from './discs/DiscsDockHUD';
import { InteractiveDiscsView } from './discs/InteractiveDiscsView';

export interface JointUi {
  Options?: ComponentType;        // se monta bajo el dropdown "Unión"
  Dock?: ComponentType;           // se monta en App.tsx
  ViewportLayer?: ComponentType;  // se monta en Viewport3D.tsx junto a SlicedPlatesView
}

export const JOINT_UI: Record<JointId, JointUi> = {
  discs: {
    Dock: DiscsDockHUD,
    ViewportLayer: InteractiveDiscsView,
  },
  none: {},
  rod: {},
};
