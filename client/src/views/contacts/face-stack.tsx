import type { ReactNode } from 'react';
import type { MemberFace } from '../../api/shared.ts';
import { FaceAvatar } from './contact-avatar.tsx';

const SHOWN = 5;

export function FaceStack({ faces, size }: { faces: readonly MemberFace[]; size: number }): ReactNode {
  return (
    <span className="face-stack" aria-hidden="true">
      {faces.slice(0, SHOWN).map((face) => <FaceAvatar key={face.accountId} name={face.name} avatar={face.avatar}
        size={size} />)}
    </span>
  );
}
