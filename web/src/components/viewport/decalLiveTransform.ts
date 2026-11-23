export interface LiveDecalTransform {
  id: string;
  centerX: number;
  centerZ: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
}

let activeLiveTransform: LiveDecalTransform | null = null;

export function setLiveDecalTransform(next: LiveDecalTransform | null): void {
  activeLiveTransform = next;
}

export function getLiveDecalTransform(): LiveDecalTransform | null {
  return activeLiveTransform;
}
