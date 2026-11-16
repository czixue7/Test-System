import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import AboutAppCard from './AboutAppCard';
import AboutUpdatePanel from './AboutUpdatePanel';
import { CURRENT_VERSION, CURRENT_VERSION_HASH } from '../utils/updater';
import { useUpdaterStore } from '../store/updaterStore';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 「关于」弹窗：展示版本信息与更新面板。
 * 启动时自动检测到更新使用独立的 UpdateDialog，不与本弹窗共用。
 */
const AboutDialog: React.FC<AboutDialogProps> = ({ open, onClose }) => {
  const [panelStarted, setPanelStarted] = useState(false);
  const updateActive = useUpdaterStore(state => state.checkingUpdate || state.downloadStatus !== 'idle');

  useEffect(() => {
    if (open) setPanelStarted(false);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} className="about-dialog w-full max-w-sm" containerClassName="about-overlay">
      <div className="about-body text-center">
        <AboutAppCard version={CURRENT_VERSION} build={CURRENT_VERSION_HASH} compact={panelStarted || updateActive} />
        <AboutUpdatePanel expanded={panelStarted || updateActive} onExpand={() => setPanelStarted(true)} />
      </div>
      <div className="about-actions">
        <button type="button" onClick={onClose} className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-colors">确定</button>
      </div>
    </Modal>
  );
};

export default AboutDialog;
