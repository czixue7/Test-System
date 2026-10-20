import React from 'react';
import UpdateStageCard, { type UpdateStageCardProps } from './UpdateStageCard';

interface UpdateControlProps extends UpdateStageCardProps {
  expanded: boolean;
  onStart: () => void;
}

/** The launch button and expanded status share one slot in the dialog. */
export default function UpdateControl({ expanded, onStart, ...card }: UpdateControlProps) {
  return <div className={`about-update-control ${expanded ? 'about-update-control--expanded' : ''}`}>
    <button type="button" className="about-update-launch" onClick={onStart} disabled={expanded} tabIndex={expanded ? -1 : 0} aria-hidden={expanded} aria-expanded={expanded} aria-controls="about-update-content">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7a8 8 0 1 0 0 10M20 3v5h-5" /></svg>
      检查更新
    </button>
    <div className="about-update-reveal" aria-hidden={!expanded} id="about-update-content">
      <div className="about-update-reveal-inner">{expanded && <UpdateStageCard {...card} />}</div>
    </div>
  </div>;
}
